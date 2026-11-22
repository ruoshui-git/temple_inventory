"""Plan and run safe Warehouse document-name synchronization."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import json

import frappe
from frappe.cache_manager import clear_defaults_cache
from frappe.model.naming import validate_name
from frappe.utils import cint

from temple_inventory.configuration import _settings
from temple_inventory.native_access import require_app
from temple_inventory.warehouses import _protected

JOB_ID = "temple-inventory-warehouse-name-sync"
STATUS_KEY = "ti-warehouse-name-sync-status"
RERUN_KEY = "ti-warehouse-name-sync-rerun"
# Set by the first complete explicit run. Until then relabels only change warehouse_name, so a deploy's
# path migration and the importer's relabels never rename documents before the deliberate, backed-up run.
AUTO_SYNC_KEY = "temple_inventory_warehouse_name_sync_enabled"
_REFERENCE_FIELDS = None


def _physical_rows():
	settings = frappe.get_single("Temple Inventory Settings")
	root = settings.physical_root_warehouse
	root_row = frappe.db.get_value("Warehouse", root, ["name", "lft", "rgt", "company"], as_dict=True)
	if not root_row or root_row.company != settings.company:
		frappe.throw("实体仓库根目录配置无效", frappe.ValidationError)
	rows = frappe.get_all(
		"Warehouse",
		filters={
			"company": settings.company,
			"lft": [">=", root_row.lft],
			"rgt": ["<=", root_row.rgt],
		},
		fields=["name", "warehouse_name", "company", "lft", "rgt"],
		order_by="lft asc, name asc",
		limit_page_length=0,
	)
	return settings, [row for row in rows if row.name != root]


def _linked_counts(warehouse_names):
	counts = {name: 0 for name in warehouse_names}
	if not counts:
		return counts
	for doctype, fieldname, fieldtype, options, is_single in _warehouse_reference_fields():
		conditions = []
		values = {"names": tuple(counts), "doctype": doctype, "fieldname": fieldname}
		if fieldtype == "Dynamic Link":
			if not options:
				continue
			if is_single:
				conditions.append(
					f"exists (select 1 from `tabSingles` where doctype=%(doctype)s "
					f"and field='{options}' and value='Warehouse')"
				)
			else:
				conditions.append(f"`{options}` = %(link_doctype)s")
				values["link_doctype"] = "Warehouse"
		if is_single:
			conditions.append("doctype = %(doctype)s and field = %(fieldname)s")
			query = (
				"select value as warehouse_name, count(*) as linked_count from `tabSingles` "
				"where value in %(names)s and " + " and ".join(conditions) + " group by value"
			)
		else:
			query = (
				f"select `{fieldname}` as warehouse_name, count(*) as linked_count "
				f"from `tab{doctype}` where `{fieldname}` in %(names)s"
				+ (" and " + " and ".join(conditions) if conditions else "")
				+ f" group by `{fieldname}`"
			)
		for row in frappe.db.sql(query, values, as_dict=True):
			counts[row.warehouse_name] += row.linked_count
	return counts


def _warehouse_reference_fields():
	global _REFERENCE_FIELDS
	if _REFERENCE_FIELDS is None:
		fields = []
		for doctype in frappe.get_all("DocType", pluck="name", limit_page_length=0):
			meta = frappe.get_meta(doctype)
			if not meta.issingle and not frappe.db.table_exists(doctype):
				continue
			for field in meta.fields:
				if field.fieldtype == "Link" and field.options == "Warehouse":
					fields.append((doctype, field.fieldname, field.fieldtype, "", meta.issingle))
				elif field.fieldtype == "Dynamic Link":
					fields.append((doctype, field.fieldname, field.fieldtype, field.options, meta.issingle))
		_REFERENCE_FIELDS = fields
	return _REFERENCE_FIELDS


def plan():
	"""Return physical Warehouse renames and all conflicts without changing data."""
	settings, rows = _physical_rows()
	protected = _protected(settings)
	company_abbr = frappe.db.get_value("Company", settings.company, "abbr") or ""
	all_names = set(frappe.get_all("Warehouse", pluck="name", limit_page_length=0))
	items, conflicts, targets = [], [], {}
	eligible = [
		row
		for row in rows
		if row.name not in protected and row.name != f"{row.warehouse_name} - {company_abbr}"
	]
	link_counts = _linked_counts([row.name for row in eligible])
	for row in sorted(eligible, key=lambda entry: (entry.lft, entry.name)):
		target = f"{row.warehouse_name} - {company_abbr}"
		item = {
			"old": row.name,
			"new": target,
			"linked_records": link_counts[row.name],
		}
		items.append(item)
		if target in all_names:
			conflicts.append({**item, "reason": "target_exists"})
		if target in targets:
			conflicts.append({**item, "reason": "duplicate_target", "other": targets[target]})
		else:
			targets[target] = row.name
		if len(target) > 140:
			conflicts.append({**item, "reason": "target_too_long"})
		try:
			validate_name("Warehouse", target)
		except Exception as error:
			conflicts.append({**item, "reason": "invalid_target", "detail": str(error)})
	return {
		"planned": items,
		"pending": len(items),
		"conflicts": conflicts,
		"can_run": not conflicts,
	}


def _authorize():
	require_app()
	settings = _settings()
	settings.check_permission("write")
	if not frappe.has_permission("Warehouse", "write"):
		frappe.throw("当前账户无权修改仓库", frappe.PermissionError)
	return settings


def _enqueue(*, after_commit=False):
	from frappe.utils.background_jobs import is_job_enqueued

	if is_job_enqueued(JOB_ID):
		# The running job re-plans before it exits, so this relabel is not lost.
		frappe.cache.set_value(RERUN_KEY, 1)
		return False
	frappe.enqueue(
		"temple_inventory.warehouse_rename.run",
		queue="long",
		timeout=3600,
		enqueue_after_commit=after_commit,
		job_id=JOB_ID,
	)
	return True


def auto_sync_enabled():
	return bool(cint(frappe.db.get_global(AUTO_SYNC_KEY)))


def enqueue_after_relabel():
	"""Queue the checked sync after a committed relabel, once the explicit first run has finished."""
	if not auto_sync_enabled():
		return False
	return _enqueue()


@frappe.whitelist(methods=["POST"])
def sync_document_names(dry_run=1):
	"""Preview or enqueue the app-admin Warehouse document rename job."""
	_authorize()
	current = plan()
	if cint(dry_run):
		return current
	if current["conflicts"]:
		frappe.throw("仓库名称同步存在冲突，请先处理预览中的问题", frappe.ValidationError)
	from frappe.utils.background_jobs import is_job_enqueued

	if is_job_enqueued(JOB_ID):
		frappe.throw("仓库名称同步任务正在排队或运行", frappe.ValidationError)
	_enqueue(after_commit=True)
	return {"queued": True, "job_id": JOB_ID, "pending": current["pending"]}


@frappe.whitelist(methods=["GET"])
def sync_status():
	_authorize()
	from frappe.utils.background_jobs import is_job_enqueued

	state = frappe.cache.get_value(STATUS_KEY) or {}
	current = plan()
	active = bool(is_job_enqueued(JOB_ID))
	running = bool(active and state.get("running"))
	return {
		"queued": active and not running,
		"running": running,
		"pending": current["pending"],
		"conflicts": current["conflicts"],
		"last_result": state.get("last_result"),
		"auto_sync": auto_sync_enabled(),
		"last_error": state.get("last_error")
		or ("后台任务中断" if state.get("running") and not active else ""),
	}


def _set_status(**values):
	state = frappe.cache.get_value(STATUS_KEY) or {}
	state.update(values)
	frappe.cache.set_value(STATUS_KEY, state)


def _replace_json_names(value, old, new):
	if isinstance(value, dict):
		return {key: _replace_json_names(item, old, new) for key, item in value.items()}
	if isinstance(value, list):
		return [_replace_json_names(item, old, new) for item in value]
	return new if value == old else value


def _rewrite_live_json_references(old, new):
	"""Update pending app filters and imports whose exact warehouse references moved."""
	for doctype, states, fields in (
		("Inventory Export Request", ("Queued", "Running"), ("query_json", "tables_json")),
		("Inventory Import", ("Previewed", "Queued", "Running"), ("preview_json",)),
	):
		if not frappe.db.table_exists(doctype):
			continue
		for row in frappe.get_all(
			doctype,
			filters={"status": ["in", list(states)]},
			fields=["name", *fields],
			limit_page_length=0,
		):
			values = {}
			for field in fields:
				raw = row.get(field)
				if not raw:
					continue
				try:
					parsed = json.loads(raw) if isinstance(raw, str) else raw
				except (TypeError, ValueError):
					continue
				rewritten = _replace_json_names(parsed, old, new)
				if rewritten != parsed:
					values[field] = json.dumps(rewritten, ensure_ascii=False)
			if values:
				frappe.db.set_value(doctype, row.name, values, update_modified=False)
	from temple_inventory.preferences import CREATION_LOCATIONS_KEY, VIEWS_KEY
	from temple_inventory.table_preferences import PRESENTATION_KEY, TABLES_KEY

	for row in frappe.get_all(
		"DefaultValue",
		filters={"defkey": ["in", [CREATION_LOCATIONS_KEY, VIEWS_KEY, PRESENTATION_KEY, TABLES_KEY]]},
		fields=["name", "parent", "defvalue"],
		limit_page_length=0,
	):
		if _rewrite_json_field("DefaultValue", row.name, "defvalue", row.defvalue, old, new):
			clear_defaults_cache(row.parent)
	for row in frappe.get_all("List Filter", fields=["name", "filters"], limit_page_length=0):
		_rewrite_json_field("List Filter", row.name, "filters", row.filters, old, new)


def _rewrite_json_field(doctype, name, field, raw, old, new):
	try:
		parsed = json.loads(raw or "null") if isinstance(raw, str) else raw
	except (TypeError, ValueError):
		return False
	rewritten = _replace_json_names(parsed, old, new)
	if rewritten == parsed:
		return False
	frappe.db.set_value(doctype, name, field, json.dumps(rewritten, ensure_ascii=False))
	return True


def run():
	"""Rename one native document at a time; recomputed plans make failures resumable."""
	frappe.cache.delete_value(RERUN_KEY)
	current = plan()
	if current["conflicts"]:
		_set_status(running=False, last_error="conflicts", last_result=current)
		return current
	_set_status(running=True, last_error="")
	renamed = []
	company = frappe.get_single("Temple Inventory Settings").company
	abbr = frappe.db.get_value("Company", company, "abbr") or ""
	from temple_inventory import read_cache

	try:
		while True:
			current = plan()
			if current["conflicts"]:
				frappe.throw("仓库名称同步过程中出现冲突", frappe.ValidationError)
			if not current["planned"]:
				if not frappe.cache.get_value(RERUN_KEY):
					break
				frappe.cache.delete_value(RERUN_KEY)
				continue
			for item in current["planned"]:
				# The same Warehouse row locks are taken by native stock submissions.
				row = frappe.db.get_value(
					"Warehouse", item["old"], ["name", "warehouse_name"], as_dict=True, for_update=True
				)
				if not row:
					continue
				target = row.warehouse_name + " - " + abbr
				if target != item["new"]:
					continue
				if frappe.db.exists("Warehouse", target) or len(target) > 140:
					frappe.throw("仓库名称同步过程中出现冲突", frappe.ValidationError)
				try:
					validate_name("Warehouse", target)
				except Exception:
					frappe.throw("仓库名称同步目标包含无效字符", frappe.ValidationError)
				frappe.rename_doc(
					"Warehouse",
					item["old"],
					target,
					force=True,
					show_alert=False,
					rebuild_search=False,
				)
				# Frappe's generic rename does not update User Permission.for_value for its
				# Dynamic Link field, though that value controls live Warehouse access.
				frappe.db.set_value(
					"User Permission",
					{"allow": "Warehouse", "for_value": item["old"]},
					"for_value",
					target,
					update_modified=False,
				)
				_rewrite_live_json_references(item["old"], target)
				read_cache.invalidate_after_commit()
				frappe.db.commit()
				renamed.append({"old": item["old"], "new": target})
				_set_status(running=True, renamed=len(renamed), last_error="")
		read_cache.invalidate_now()
		frappe.local.temple_inventory_memos = None
		frappe.clear_cache(doctype="Warehouse")
		result = {"renamed": renamed, "pending": plan()["pending"]}
		if not result["pending"]:
			frappe.db.set_global(AUTO_SYNC_KEY, 1)
			frappe.db.commit()
		_set_status(running=False, last_result=result, last_error="")
		return result
	except Exception as error:
		_set_status(running=False, last_error=str(error), last_result={"renamed": renamed})
		frappe.db.rollback()
		raise
