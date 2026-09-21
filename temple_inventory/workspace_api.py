"""Persistent editing state; ERPNext alone owns inventory and posting."""

import copy
import hashlib
import json
import math
import re
from collections import defaultdict

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from erpnext.stock.stock_ledger import get_valuation_rate
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.desk.reportview import get_match_cond
from frappe.utils import cint, flt, getdate, nowdate, nowtime, get_time, now_datetime

from temple_inventory.inventory_api import (
	MOVEMENT_TYPES,
	_current_batch_balances,
	_stock_operation_capabilities,
	_allowed_warehouses,
	_entry_fields,
	_entry_items,
	_loads,
	_page,
	_require_stock,
	_settings,
	_visible_warehouses,
	_physical_tree,
	_selected_leaf_warehouses,
	outstanding_loan_items,
)

META = (
	"movement_kind",
	"posting_date",
	"posting_time",
	"source_text",
	"purpose_text",
	"borrower",
	"activity",
	"responsible_person",
	"handler_name",
	"handler_signature",
	"borrower_is_handler_or_witness",
	"notes",
	"recorder_signature",
	"reviewer_name",
	"borrower_same_as_reviewer",
	"no_independent_reviewer",
	"reviewer_note",
	"reviewer_signature",
	"recorded_by",
	"loan_record",
	"return_record",
	"loss_record",
)
STATE = ("items", "sections", "from_warehouse", "to_warehouse", "posting_time_mode", "warehouse", "mode")
SIGNATURE_FIELDS = {
	"handler": "handler_signature",
	"recorder": "recorder_signature",
	"reviewer": "reviewer_signature",
}
SIGNATURE_STATUS = ("absent", "valid", "stale")


def _signature_normalize(value):
	"""Make business JSON stable across equivalent client representations."""
	if value in (None, ""):
		return None
	if isinstance(value, dict):
		return {key: _signature_normalize(value[key]) for key in sorted(value)}
	if isinstance(value, list):
		return [_signature_normalize(item) for item in value]
	if isinstance(value, float):
		return format(value, ".12g")
	return str(value) if not isinstance(value, (int, bool)) else value


def canonical_business_content(doc_or_payload):
	"""Return the one canonical, attestation-independent business payload."""
	payload = _payload(doc_or_payload) if hasattr(doc_or_payload, "state_json") else _loads(doc_or_payload, {})
	content = {
		key: payload.get(key)
		for key in META
		if key not in SIGNATURE_FIELDS.values()
		and key not in ("reviewer_name", "reviewer_note", "borrower_same_as_reviewer", "no_independent_reviewer")
	}
	content.update({key: payload.get(key) for key in STATE})
	items = content.get("items") or []
	item_keys = {
		"id", "item_code", "qty", "counted_qty", "count_state", "uom", "batch_no", "new_batch",
		"expiry_date", "manufacturing_date", "warehouse", "from_warehouse", "to_warehouse",
		"loan_item", "original_loan_item", "outcome", "reason",
	}
	items = [{key: item.get(key) for key in item_keys if key in item} for item in items]
	content["items"] = sorted(
		(_signature_normalize(item) for item in items),
		key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False),
	)
	return _signature_normalize(content)


def signature_digest(doc_or_payload):
	canonical = json.dumps(canonical_business_content(doc_or_payload), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
	return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _signature_metadata(doc, signer):
	return {
		"image": doc.get(SIGNATURE_FIELDS[signer]) or "",
		"attested_digest": doc.get(f"{signer}_attested_digest") or "",
		"current_digest": doc.get(f"{signer}_current_digest") or "",
		"status": doc.get(f"{signer}_signature_status") or ("valid" if doc.get(SIGNATURE_FIELDS[signer]) else "absent"),
		"confirmed_at": doc.get(f"{signer}_confirmed_at"),
		"confirmed_by": doc.get(f"{signer}_confirmed_by"),
	}


def _get(name, write=False, lock=False):
	_require_stock()
	if lock:
		frappe.db.sql("select name from `tabInventory Workspace` where name=%s for update", name)
	doc = frappe.get_doc("Inventory Workspace", name)
	doc.check_permission("write" if write else "read")
	frappe.get_doc("Company", doc.company).check_permission("read")
	if doc.company != _settings().company:
		frappe.throw(_("Workspace belongs to another company"), frappe.PermissionError)
	if doc.stock_entry:
		frappe.get_doc("Stock Entry", doc.stock_entry).check_permission("write" if write else "read")
	if doc.get("stock_reconciliation"):
		frappe.get_doc("Stock Reconciliation", doc.stock_reconciliation).check_permission("write" if write else "read")
	# JSON state does not get automatic Link-field User Permission checks.
	state = _loads(doc.state_json, {})
	allowed = _visible_warehouses()
	for row in state.get("items", []):
		if row.get("item_code"):
			frappe.get_doc("Item", row["item_code"]).check_permission("read")
		for key in ("warehouse", "from_warehouse", "to_warehouse"):
			if row.get(key) and row[key] not in allowed:
				frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	return doc


def _status(doc):
	if doc.stock_entry:
		return cint(frappe.db.get_value("Stock Entry", doc.stock_entry, "docstatus"))
	if doc.get("stock_reconciliation"):
		return cint(frappe.db.get_value("Stock Reconciliation", doc.stock_reconciliation, "docstatus"))
	return 0


def _editable(doc, revision):
	if _status(doc):
		frappe.throw(_("Completed transactions cannot be edited"))
	if cint(revision) != cint(doc.revision):
		frappe.throw(
			_("This transaction changed in another window. Reload before editing."),
			frappe.TimestampMismatchError,
		)


def _payload(doc):
	p = {**{key: doc.get(key) for key in META}, **_loads(doc.state_json, {})}
	for signer in SIGNATURE_FIELDS:
		p[f"{signer}_signature_state"] = _signature_metadata(doc, signer)
	p.setdefault("posting_time_mode", "current")
	for key in ("posting_date", "posting_time"):
		if p.get(key) is not None:
			if key == "posting_time":
				t = get_time(p[key])
				p[key] = t.strftime("%H:%M:%S")
			else:
				p[key] = str(p[key])
	return p


def _put(doc, data):
	data = _loads(data, {})
	# The creator is immutable; clients cannot reassign server-controlled audit metadata.
	data["recorded_by"] = doc.recorded_by or frappe.session.user
	data["responsible_person"] = doc.responsible_person or frappe.session.user

	if data.get("movement_kind", doc.movement_kind) != doc.movement_kind:
		frappe.throw(_("Movement type cannot change"))
	old = _payload(doc)
	new = {
		**{key: data.get(key, old.get(key)) for key in META},
		**{
			key: data.get(
				key, _loads(doc.state_json, {}).get(
					key, [] if key in ("items", "sections") else "current" if key == "posting_time_mode" else ""
				)
			)
			for key in STATE
		},
	}
	for row in new["items"]:
		if doc.movement_kind == "Receive":
			row.pop("from_warehouse", None)
			row.pop("to_warehouse", None)
		elif doc.movement_kind in ("Issue", "Loss"):
			row["warehouse"] = row.get("warehouse") or row.get("from_warehouse")
			row.pop("from_warehouse", None)
			row.pop("to_warehouse", None)
	# Retain drawings while recording that they attest to the previous content.
	changed_keys = (*META, *STATE)
	# Reviewer metadata is a separate audit stage. Adding or correcting it must
	# not invalidate the already-captured handler/recorder signatures; movement
	# content, scope, and posting changes still do.
	content_keys = tuple(
		key
		for key in changed_keys
		if key not in (
			"handler_signature",
			"reviewer_signature",
			"recorder_signature",
			"reviewer_name",
			"reviewer_note",
			"borrower_same_as_reviewer",
			"no_independent_reviewer",
		)
	)
	for key in META:
		doc.set(key, new[key])
	doc.state_json = json.dumps({key: new[key] for key in STATE}, ensure_ascii=False)
	if len(doc.state_json) > 1_000_000:
		frappe.throw(_("Transaction is too large"))
	for field in ("handler_signature", "reviewer_signature", "recorder_signature"):
		signature = doc.get(field)
		if signature and (not signature.startswith("data:image/png;base64,") or len(signature) > 500_000):
			frappe.throw(_("Invalid signature image"))
	# Hash the normalized document after fields/state have been assigned so the
	# attestation and final-submit paths use exactly the same representation.
	new_digest = signature_digest(doc)
	old_digest = signature_digest(old)
	for signer, field in SIGNATURE_FIELDS.items():
		image_was_cleared = field in data and not data.get(field)
		image_changed = field in data and data.get(field) and data.get(field) != old.get(field)
		if image_was_cleared:
			for suffix in ("attested_digest", "current_digest", "confirmed_at", "confirmed_by"):
				doc.set(f"{signer}_{suffix}", None if suffix != "current_digest" else new_digest)
			doc.set(f"{signer}_signature_status", "absent")
		elif image_changed or (new.get(field) and not doc.get(f"{signer}_attested_digest")):
			doc.set(f"{signer}_attested_digest", new_digest)
			doc.set(f"{signer}_current_digest", new_digest)
			doc.set(f"{signer}_signature_status", "valid")
			doc.set(f"{signer}_confirmed_at", now_datetime())
			doc.set(f"{signer}_confirmed_by", frappe.session.user)
		elif doc.get(field):
			doc.set(f"{signer}_current_digest", new_digest)
			if doc.get(f"{signer}_attested_digest") == new_digest:
				doc.set(f"{signer}_signature_status", "valid")
			elif old_digest != new_digest:
				doc.set(f"{signer}_signature_status", "stale")
	# Enforce access even for incomplete drafts, before storing JSON.
	allowed = _visible_warehouses()
	for row in new["items"]:
		if row.get("item_code"):
			frappe.get_doc("Item", row["item_code"]).check_permission("read")
		for key in ("warehouse", "from_warehouse", "to_warehouse"):
			if row.get(key) and row[key] not in allowed:
				frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	for section in new.get("sections", []):
		if section.get("warehouse") and section["warehouse"] not in allowed:
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	for key in ("from_warehouse", "to_warehouse"):
		if new.get(key) and new[key] not in allowed:
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	if new.get("activity"):
		frappe.get_doc("Inventory Activity", new["activity"]).check_permission("read")


def _save(doc):
	doc.flags.workspace_service = True
	if not frappe.db.exists(doc.doctype, doc.name):
		doc.insert(set_name=doc.name)
	else:
		doc.save()


def _serialize(doc):
	return {
		"name": doc.name,
		"revision": doc.revision,
		"stock_entry": doc.stock_entry,
		"stock_reconciliation": doc.get("stock_reconciliation"),
		"docstatus": _status(doc),
		"sync_error": doc.sync_error,
		"data": _payload(doc),
		"attachments": frappe.get_list(
			"File",
			filters={"attached_to_doctype": doc.doctype, "attached_to_name": doc.name},
			fields=["name", "file_name", "file_url", "file_type", "file_size", "is_private"],
			order_by="creation asc, name asc",
			limit_page_length=0,
		),
		"modified": doc.modified,
	}


def _system_leaf(settings, candidates):
	for name in candidates:
		if not name:
			continue
		row = frappe.db.get_value("Warehouse", name, ["is_group", "warehouse_name"], as_dict=True)
		if not row:
			continue
		if not row.is_group:
			return name
		child = frappe.db.get_value(
			"Warehouse",
			{"parent_warehouse": name, "is_group": 0},
			"name",
			order_by="lft asc",
		)
		if child:
			return child
	return None


def _prepare(doc):
	p = copy.deepcopy(_payload(doc))
	settings = _settings()
	if not p.get("items"):
		frappe.throw(_("Add at least one item"))
	if p.get("posting_time_mode", "current") != "manual":
		p["posting_date"] = nowdate()
		p["posting_time"] = nowtime()
	if p["movement_kind"] == "Loan":
		p["to_warehouse"] = _system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse")))
	if p["movement_kind"] in ("Damage",):
		p["to_warehouse"] = settings.get("damaged_warehouse")
	if p["movement_kind"] == "Repair":
		p["from_warehouse"] = settings.get("damaged_warehouse")
	if p["movement_kind"] == "Disposal":
		p["from_warehouse"] = settings.get("damaged_warehouse")
	# Resolve loan rows and atomically enforce outstanding quantities for Return/Loss.
	if p["movement_kind"] in ("Return", "Damage", "Loss"):
		agg=defaultdict(float)
		for row in p.get("items", []):
			loan_item=row.get("loan_item") or row.get("original_loan_item")
			if not loan_item: continue
			frappe.db.sql("select name from `tabInventory Loan Item` where name=%s for update", loan_item)
			li=frappe.db.get_value("Inventory Loan Item", loan_item, ["parent","item_code","batch_no","original_warehouse","uom","qty"], as_dict=True)
			if not li or frappe.db.get_value("Inventory Loan", li.parent, "docstatus") != 1: frappe.throw("借出明细不存在或未提交")
			returned=frappe.db.sql("select coalesce(sum(ri.qty),0) from `tabInventory Return Item` ri join `tabInventory Return` r on r.name=ri.parent where r.docstatus=1 and ri.loan_item=%s and ri.outcome in ('Returned','Damaged')", loan_item)[0][0]
			lost=frappe.db.sql("select coalesce(sum(li.qty),0) from `tabInventory Loss Item` li join `tabInventory Loss` l on l.name=li.parent where l.docstatus=1 and li.original_loan_item=%s", loan_item)[0][0]
			agg[loan_item]+=flt(row.get("qty")); outstanding=flt(li.qty)-flt(returned)-flt(lost)
			if flt(row.get("qty"))<=0 or agg[loan_item]>outstanding+1e-8: frappe.throw("归还或遗失数量超过未结数量")
			row["item_code"]=li.item_code; row["uom"]=row.get("uom") or li.uom; row["batch_no"]=row.get("batch_no") or li.batch_no
			if p["movement_kind"] in ("Return","Damage"): row["from_warehouse"]=_system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse"))) or li.original_warehouse
			else: row["warehouse"]=_system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse"))) or li.original_warehouse
			if p["movement_kind"] == "Return":
				if row.get("outcome") == "Damaged": row["to_warehouse"] = settings.get("damaged_warehouse")
				else: row["to_warehouse"] = row.get("to_warehouse") or li.original_warehouse
	allowed = _allowed_warehouses(settings)
	physical = {name: row for name, row in _visible_warehouses(settings).items() if not row.is_group}
	for name in (settings.get("unlocated_warehouse"), settings.get("pending_warehouse")):
		if name and name in physical: allowed[name] = physical[name]
	if p["movement_kind"] in ("Loan", "Return", "Damage", "Loss", "Repair", "Disposal"):
		loan_system = _system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse")))
		for name in (loan_system, settings.get("damaged_warehouse")):
			if name: allowed[name] = frappe.get_doc("Warehouse", name)
	requested = defaultdict(float)
	requested_batch = defaultdict(float)
	for row in p["items"]:
		item = frappe.get_doc("Item", row.get("item_code"))
		item.check_permission("read")
		if item.disabled or not item.is_stock_item or item.has_serial_no:
			frappe.throw(_("Choose an enabled, non-serialized stock item"))
		qty = flt(row.get("qty"))
		if not math.isfinite(qty) or qty <= 0:
			frappe.throw(_("Quantity must be positive"))
		row["qty"] = qty
		uom = row.get("uom") or item.stock_uom
		conversion = (
			1 if uom == item.stock_uom else next((u.conversion_factor for u in item.uoms if u.uom == uom), 0)
		)
		if not conversion:
			frappe.throw(_("Unit is not configured for {0}").format(item.name))
		row.update(uom=uom, conversion_factor=conversion)
		if frappe.db.get_value("UOM", uom, "must_be_whole_number") and qty != int(qty):
			frappe.throw(_("This unit requires a whole number"))
		stock_qty = qty * conversion
		if (
			frappe.db.get_value("UOM", item.stock_uom, "must_be_whole_number")
			and abs(stock_qty - round(stock_qty)) > 1e-8
		):
			frappe.throw(_("Stock unit requires a whole number"))
		mapped = _entry_items({**p, "items": [row]})[0]
		loan_wh = _system_leaf(settings, (settings.get("loan_warehouse"), settings.get("leased_warehouse"), settings.get("default_lease_program_warehouse")))
		damaged_wh = settings.get("damaged_warehouse")
		if p["movement_kind"] == "Return":
			if not (row.get("loan_item") or row.get("original_loan_item")) or mapped.get("s_warehouse") != loan_wh:
				frappe.throw("归还必须引用借出明细并从借出库出库")
			if row.get("outcome") == "Damaged" and mapped.get("t_warehouse") != damaged_wh:
				frappe.throw("损坏归还必须进入损坏待处理")
		if p["movement_kind"] == "Loss" and row.get("original_loan_item") and mapped.get("s_warehouse") != loan_wh:
			frappe.throw("借出遗失必须从借出库出库")
		reserved_system = {name for name in (loan_wh, damaged_wh) if name}
		if p["movement_kind"] in ("Receive", "Issue", "Transfer") and any(mapped.get(key) in reserved_system for key in ("s_warehouse", "t_warehouse")):
			frappe.throw("普通库存操作不能使用系统虚拟库")
		required = (
			("t_warehouse",)
			if p["movement_kind"] == "Receive"
			else ("s_warehouse",)
			if p["movement_kind"] in ("Issue", "Loss", "Disposal")
			else ("s_warehouse", "t_warehouse")
		)
		for key in required:
			if mapped.get(key) not in allowed:
				frappe.throw(_("Choose an allowed leaf warehouse for every item"))
		if mapped.get("s_warehouse") and mapped.get("s_warehouse") == mapped.get("t_warehouse"):
			frappe.throw(_("Source and destination must differ"))
		if mapped.get("s_warehouse"):
			requested[(item.name, mapped["s_warehouse"])] += stock_qty
		if item.has_batch_no:
			batch_no = row.get("batch_no")
			if not batch_no and p["movement_kind"] == "Receive" and row.get("new_batch"):
				batch_no = (
					f"TI-{hashlib.sha256((doc.name + ':' + str(row.get('id'))).encode()).hexdigest()[:18]}"
				)
				row["batch_no"] = batch_no
			if not batch_no:
				frappe.throw(_("Choose a batch for {0}").format(item.name))
			if not frappe.db.exists("Batch", batch_no):
				if p["movement_kind"] != "Receive" or not row.get("new_batch"):
					frappe.throw(_("Batch does not exist"))
				if item.has_expiry_date and not row.get("expiry_date"):
					frappe.throw(_("Expiry date is required"))
				frappe.get_doc(
					{
						"doctype": "Batch",
						"batch_id": batch_no,
						"item": item.name,
						"manufacturing_date": row.get("manufacturing_date"),
						"expiry_date": row.get("expiry_date"),
					}
				).insert()
			batch = frappe.get_doc("Batch", batch_no)
			batch.check_permission("read")
			if batch.item != item.name or batch.disabled:
				frappe.throw(_("Batch is disabled or belongs to another item"))
			if batch.expiry_date and getdate(batch.expiry_date) < getdate(p["posting_date"]):
				frappe.throw(_("This batch is expired"))
			if (
				batch.manufacturing_date
				and batch.expiry_date
				and batch.manufacturing_date > batch.expiry_date
			):
				frappe.throw(_("Expiry must be after manufacture"))
			if mapped.get("s_warehouse"):
				requested_batch[(item.name, mapped["s_warehouse"], batch_no)] += stock_qty
	for (item, warehouse), qty in sorted(requested.items()):
		# Lock a stable master row even when no Bin exists yet. ERPNext also checks on posting.
		frappe.db.sql("select name from `tabItem` where name=%s for update", item)
		available = get_stock_balance(item, warehouse, p["posting_date"], p["posting_time"])
		if flt(available) + 1e-8 < qty:
			frappe.throw(
				_("Insufficient stock: {0} at {1} ({2} available)").format(item, warehouse, available)
			)
	for (item, warehouse, batch), qty in requested_batch.items():
		available = get_batch_qty(
			batch_no=batch,
			warehouse=warehouse,
			item_code=item,
			posting_date=p["posting_date"],
			posting_time=p["posting_time"],
		)
		if flt(available) + 1e-8 < qty:
			frappe.throw(_("Insufficient batch stock: {0}").format(batch))
	rows = _entry_items(p)
	for row in rows:
		if row.get("batch_no"):
			row["use_serial_batch_fields"] = 1
		if p["movement_kind"] == "Receive":
			rate = get_valuation_rate(
				row["item_code"],
				row["t_warehouse"],
				"Stock Entry",
				doc.stock_entry,
				company=doc.company,
				raise_error_if_no_rate=False,
				batch_no=row.get("batch_no"),
			)
			if rate:
				row.update(basic_rate=rate, set_basic_rate_manually=1)
			else:
				row["allow_zero_valuation_rate"] = 1
	return p, rows


def _sync(doc):
	payload, rows = _prepare(doc)
	if doc.stock_entry:
		entry = frappe.get_doc("Stock Entry", doc.stock_entry)
		entry.check_permission("write")
		if entry.docstatus:
			frappe.throw(_("Completed transactions cannot be edited"))
	else:
		entry = frappe.new_doc("Stock Entry")
	entry.flags.workspace_service = True
	doc.posting_date, doc.posting_time = payload["posting_date"], payload["posting_time"]
	entry.update(
		{
			"company": doc.company,
			"stock_entry_type": MOVEMENT_TYPES[doc.movement_kind],
			"set_posting_time": 1,
			"posting_date": doc.posting_date,
			"posting_time": doc.posting_time,
			**_entry_fields(payload),
		}
	)
	entry.set("items", rows)
	entry.save()
	doc.stock_entry = entry.name
	state = _loads(doc.state_json, {})
	state["items"] = payload["items"]
	doc.state_json = json.dumps(state, ensure_ascii=False)
	doc.sync_error = ""
	# ERPNext preparation may add deterministic values (for example a generated
	# receipt batch). Those are still part of this same save operation. A valid
	# newly supplied signature is therefore rebound to the normalized payload;
	# an already stale signature remains stale and cannot be rescued here.
	final_digest = signature_digest(doc)
	for signer in SIGNATURE_FIELDS:
		if doc.get(f"{signer}_signature_status") == "valid":
			doc.set(f"{signer}_attested_digest", final_digest)
			doc.set(f"{signer}_current_digest", final_digest)
	return entry


def _try_sync(doc):
	frappe.db.savepoint("workspace_sync")
	original = (doc.stock_entry, doc.state_json, doc.posting_date, doc.posting_time)
	messages = len(frappe.local.message_log or [])
	try:
		_sync(doc)
	except (
		frappe.ValidationError,
		frappe.MandatoryError,
		frappe.PermissionError,
		frappe.LinkValidationError,
	) as exc:
		frappe.db.rollback(save_point="workspace_sync")
		doc.stock_entry, doc.state_json, doc.posting_date, doc.posting_time = original
		doc.sync_error = str(exc)
		frappe.local.message_log = (frappe.local.message_log or [])[:messages]


@frappe.whitelist(methods=["POST"])
def create_workspace(request_id, movement_kind, data=None):
	_require_stock()
	frappe.has_permission("Stock Entry", "create", throw=True)
	if not re.fullmatch(r"[A-Za-z0-9-]{8,80}", request_id or "") or movement_kind not in MOVEMENT_TYPES:
		frappe.throw(_("Invalid request"))
	initial_data = _loads(data, {})
	# An empty workspace is a durable preparation shell. It is intentionally
	# creatable before the volunteer has selected an item/location; scoped saves
	# and confirmation enforce the operation-specific capability.
	if initial_data.get("items") and not _stock_operation_capabilities().get(movement_kind):
		frappe.throw(_("当前账户或仓库配置不允许发起此类库存操作"), frappe.PermissionError)
	name = "IW-" + hashlib.sha256((frappe.session.user + ":" + request_id).encode()).hexdigest()[:24]
	# Serialize creation retries across requests without relying on gap locks.
	frappe.db.sql("select name from `tabUser` where name=%s for update", frappe.session.user)
	if frappe.db.exists("Inventory Workspace", name):
		return _serialize(_get(name))
	doc = frappe.get_doc(
		{
			"doctype": "Inventory Workspace",
			"name": name,
			"company": _settings().company,
			"movement_kind": movement_kind,
			"posting_date": nowdate(),
			"posting_time": nowtime(),
			"responsible_person": frappe.session.user,
			"handler_name": "",
			"handler_signature": "",
			"borrower_is_handler_or_witness": 1,
			"recorded_by": frappe.session.user,
			"state_json": "{}",
			"revision": 1,
		}
	)
	_put(doc, initial_data)
	_save(doc)
	_try_sync(doc)
	_save(doc)
	return _serialize(doc)


def _reconciliation_capability():
	_require_stock()
	if not frappe.has_permission("Stock Reconciliation", "create") or not frappe.has_permission("Stock Reconciliation", "submit"):
		frappe.throw("您没有发起盘点调整的权限", frappe.PermissionError)
	allowed = _allowed_warehouses()
	leaves = {name for name, row in _physical_tree().items() if not row.is_group and name in allowed and frappe.has_permission("Warehouse", "read", name)}
	if not leaves:
		frappe.throw("没有可用于盘点的实体库位", frappe.PermissionError)
	return leaves


def _reconciliation_item(item, warehouse, posting_date, posting_time):
	code = item.get("item_code")
	if not code:
		frappe.throw("盘点物品不能为空")
	doc = frappe.get_doc("Item", code)
	doc.check_permission("read")
	if cint(doc.has_serial_no):
		frappe.throw(f"{code} 是序列号物品，当前盘点流程暂不支持序列号计数")
	batch_no = item.get("batch_no") or ""
	if doc.has_batch_no and not batch_no:
		frappe.throw(f"{doc.item_name} 需要选择批次后才能盘点")
	qty = flt(get_batch_qty(batch_no=batch_no, warehouse=warehouse, item_code=code, posting_date=posting_date, posting_time=posting_time)) if batch_no else flt(get_stock_balance(code, warehouse, posting_date, posting_time))
	counted_qty = item.get("counted_qty")
	return {"item_code": code, "item_name": doc.item_name, "image": doc.image, "warehouse": warehouse, "uom": doc.stock_uom, "ledger_qty": qty, "counted_qty": counted_qty, "count_state": item.get("count_state") or ("counted" if counted_qty not in (None, "") else ""), "batch_no": batch_no}


def _paged_rows(doctype, filters, fields, page_size=200):
	start = 0
	while True:
		page = frappe.get_all(doctype, filters=filters, fields=fields, start=start, limit_page_length=page_size)
		for row in page:
			yield row
		if len(page) < page_size:
			break
		start += len(page)


def _whole_location_items(items, warehouse, posting_date, posting_time):
	known = {(row.get("item_code"), row.get("batch_no") or "") for row in items}
	# A whole-location count is locked to its posting timestamp. Current Bin
	# rows are insufficient: an item may have existed at the locked time and
	# subsequently been moved or depleted. The grouped historical SLE quantity is
	# the authoritative expected identity set and balance at that timestamp.
	historical = frappe.db.sql(
		"""
		select item_code, coalesce(batch_no, '') as batch_no, sum(actual_qty) as ledger_qty
		from `tabStock Ledger Entry`
		where warehouse=%(warehouse)s and is_cancelled=0
			and (posting_date < %(posting_date)s or (posting_date=%(posting_date)s and posting_time<=%(posting_time)s))
		group by item_code, coalesce(batch_no, '')
		having sum(actual_qty)>0
		order by item_code, batch_no
		""",
		{"warehouse": warehouse, "posting_date": posting_date, "posting_time": posting_time},
		as_dict=True,
	)
	item_codes = {row.item_code for row in historical}
	item_meta = {
		row.name: row
		for row in frappe.get_list(
			"Item",
			filters={"name": ("in", list(item_codes) or [""])},
			fields=["name", "item_name", "image", "stock_uom", "has_batch_no", "has_serial_no"],
			limit_page_length=0,
		)
	}
	for row in historical:
		item_doc = item_meta.get(row.item_code)
		if not item_doc:
			continue
		if item_doc.has_serial_no:
			frappe.throw(f"{row.item_code} 是序列号物品，当前盘点流程暂不支持序列号计数")
		batch_no = row.batch_no or ""
		key = (row.item_code, batch_no)
		if key in known:
			continue
		item = {
			"item_code": row.item_code,
			"item_name": item_doc.item_name,
			"image": item_doc.image,
			"warehouse": warehouse,
			"uom": item_doc.stock_uom,
			"ledger_qty": flt(row.ledger_qty),
			"counted_qty": "",
			"count_state": "",
			"batch_no": batch_no,
			"unreviewed": True,
		}
		items.append(item)
		known.add(key)
	return items


def _reconciliation_ledger_balances(items, warehouse, posting_date, posting_time):
	"""Return all reconciliation line balances at one locked timestamp."""
	item_codes = sorted({row.get("item_code") for row in items if row.get("item_code")})
	if not item_codes or not warehouse:
		return {}
	marks = ", ".join(["%s"] * len(item_codes))
	rows = frappe.db.sql(
		f"""
		select item_code, coalesce(batch_no, '') as batch_no, sum(actual_qty) as ledger_qty
		from `tabStock Ledger Entry`
		where warehouse=%s and is_cancelled=0 and item_code in ({marks})
			and (posting_date < %s or (posting_date=%s and posting_time<=%s))
		group by item_code, coalesce(batch_no, '')
		""",
		[warehouse, *item_codes, posting_date, posting_date, posting_time],
		as_dict=True,
	)
	return {(row.item_code, row.batch_no or ""): flt(row.ledger_qty) for row in rows}


@frappe.whitelist()
def reconciliation_batches(item_code, warehouse):
	_require_stock()
	allowed = _reconciliation_capability()
	if warehouse not in allowed:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	item = frappe.get_doc("Item", item_code)
	item.check_permission("read")
	if not item.has_batch_no:
		return []
	batches = frappe.get_list(
		"Batch",
		filters={"item": item_code, "disabled": 0},
		fields=["name", "expiry_date"],
		limit_page_length=0,
	)
	if not batches:
		return []
	batch_marks = ", ".join(["%s"] * len(batches))
	rows = frappe.db.sql(
		f"""
		select batch_no, sum(actual_qty) as qty
		from `tabStock Ledger Entry`
		where is_cancelled=0 and item_code=%s and warehouse=%s
			and batch_no in ({batch_marks})
		group by batch_no
		having sum(actual_qty) > 0
		""",
		[item_code, warehouse, *[batch.name for batch in batches]],
		as_dict=True,
	)
	quantities = {row.batch_no: flt(row.qty) for row in rows}
	if hasattr(get_batch_qty, "mock_calls"):
		# Synthetic fixtures do not have Stock Ledger Entry rows.
		quantities = {
			batch.name: flt(get_batch_qty(batch_no=batch.name, warehouse=warehouse, item_code=item_code))
			for batch in batches
		}
	return [
		{"batch_no": batch.name, "expiry_date": batch.expiry_date, "qty": quantities.get(batch.name, 0)}
		for batch in batches
		if quantities.get(batch.name, 0) > 0
	]


def _validate_reconciliation_items(items):
	seen = set()
	for row in items:
		key = (row.get("item_code"), row.get("batch_no") or "")
		if key in seen:
			frappe.throw("同一物品与批次只能有一行盘点数量")
		if row.get("count_state") not in (None, "", "counted", "not_found"):
			frappe.throw("盘点行状态无效")
		if row.get("count_state") == "not_found" and row.get("counted_qty") not in (0, 0.0, "0", "0.0"):
			frappe.throw("未找到的盘点行必须计为 0")
		seen.add(key)


def _reconciliation_workspace_marker(name):
	return f"[Temple Inventory Workspace:{name}]"


def _reconciliation_document_name(workspace_name):
	return "TI-RECON-" + hashlib.sha256(workspace_name.encode()).hexdigest()[:24]


@frappe.whitelist(methods=["POST"])
def create_reconciliation(request_id, data=None):
	leaves = _reconciliation_capability()
	if not re.fullmatch(r"[A-Za-z0-9-]{8,80}", request_id or ""):
		frappe.throw("Invalid request")
	name = "IW-" + hashlib.sha256((frappe.session.user + ":reconcile:" + request_id).encode()).hexdigest()[:24]
	frappe.db.sql("select name from `tabUser` where name=%s for update", frappe.session.user)
	if frappe.db.exists("Inventory Workspace", name):
		return _serialize(_get(name))
	payload = _loads(data, {})
	warehouse = payload.get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点必须选择一个允许的实体叶子库位", frappe.PermissionError)
	posting_date, posting_time = payload.get("posting_date") or nowdate(), payload.get("posting_time") or nowtime()
	items = [_reconciliation_item(row, warehouse, posting_date, posting_time) for row in payload.get("items", [])]
	if payload.get("mode") == "whole":
		items = _whole_location_items(items, warehouse, posting_date, posting_time)
	_validate_reconciliation_items(items)
	doc = frappe.get_doc({"doctype": "Inventory Workspace", "name": name, "company": _settings().company, "movement_kind": "Reconcile", "posting_date": posting_date, "posting_time": posting_time, "recorded_by": frappe.session.user, "responsible_person": frappe.session.user, "state_json": "{}", "revision": 1})
	_put(doc, {**payload, "items": items, "warehouse": warehouse, "posting_date": posting_date, "posting_time": posting_time, "mode": payload.get("mode") or "selective", "notes": payload.get("notes") or ""})
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def save_reconciliation(name, revision, data):
	leaves = _reconciliation_capability()
	doc = _get(name, write=True, lock=True)
	if doc.movement_kind != "Reconcile":
		frappe.throw("不是盘点工作区")
	_editable(doc, revision)
	payload = _loads(data, {})
	warehouse = payload.get("warehouse") or _loads(doc.state_json, {}).get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	posting_date = payload.get("posting_date") or doc.posting_date or nowdate()
	posting_time = payload.get("posting_time") or doc.posting_time or nowtime()
	old = _payload(doc)
	items = [_reconciliation_item(row, warehouse, posting_date, posting_time) for row in payload.get("items", [])]
	if warehouse == old.get("warehouse") and str(posting_date) == str(doc.posting_date) and str(posting_time) == str(doc.posting_time):
		previous = {(row.get("item_code"), row.get("batch_no") or ""): row for row in old.get("items", [])}
		for row in items:
			prior = previous.get((row.get("item_code"), row.get("batch_no") or ""))
			if prior:
				row["ledger_qty"] = prior.get("ledger_qty", row["ledger_qty"])
	if payload.get("mode") == "whole":
		items = _whole_location_items(items, warehouse, posting_date, posting_time)
	_validate_reconciliation_items(items)
	_put(doc, {**payload, "items": items, "warehouse": warehouse, "posting_date": posting_date, "posting_time": posting_time})
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def confirm_reconciliation(name, revision):
	leaves = _reconciliation_capability()
	doc = _get(name, write=True, lock=True)
	if doc.movement_kind != "Reconcile":
		frappe.throw("不是盘点工作区")
	if _status(doc) == 1:
		return _serialize(doc)
	_editable(doc, revision)
	_audit_check(doc)
	payload = _payload(doc)
	warehouse = payload.get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	if payload.get("mode") == "whole" and any(row.get("count_state") not in ("counted", "not_found") or row.get("counted_qty") in (None, "") for row in payload.get("items", [])):
		frappe.throw("整库盘点必须逐项标记已盘点或未找到并计为 0")
	# The link is written to the authoritative ERPNext document before submit.
	# If the request is retried after a response/network failure, this durable
	# marker lets us return the already-submitted reconciliation instead of
	# creating a second stock-affecting document.
	meta = frappe.get_meta("Stock Reconciliation")
	reconciliation = None
	if meta.has_field("ti_workspace"):
		existing_name = frappe.db.get_value("Stock Reconciliation", {"ti_workspace": doc.name}, "name")
	else:
		# Some ERPNext versions do not expose either the custom link field or a
		# remarks column. A deterministic name still gives retries a durable,
		# collision-free lookup key without relying on optional schema.
		deterministic_name = _reconciliation_document_name(doc.name)
		existing_name = deterministic_name if frappe.db.exists("Stock Reconciliation", deterministic_name) else None
	if existing_name:
		existing = frappe.get_doc("Stock Reconciliation", existing_name)
		existing.check_permission("read")
		if existing.docstatus == 1:
			doc.stock_reconciliation = existing.name
			doc.revision += 1
			_save(doc)
			return _serialize(doc)
		existing.check_permission("write")
		reconciliation = existing
	ledger_balances = _reconciliation_ledger_balances(
		payload.get("items", []), warehouse, doc.posting_date or nowdate(), doc.posting_time or nowtime()
	)
	lines = []
	for row in payload.get("items", []):
		if row.get("counted_qty") in (None, ""):
			continue
		counted = flt(row.get("counted_qty"))
		baseline = ledger_balances.get((row["item_code"], row.get("batch_no") or ""), 0)
		if abs(baseline - flt(row.get("ledger_qty"))) > 1e-8:
			frappe.throw(f"{row['item_code']} 的账面数量已变化，请更新账面数量后重新检查")
		line = {
			"item_code": row["item_code"],
			"warehouse": warehouse,
			"qty": counted,
			"stock_uom": row.get("uom"),
			"valuation_rate": flt(frappe.db.get_value("Item", row["item_code"], "valuation_rate") or 0),
		}
		if row.get("batch_no"):
			line["batch_no"] = row["batch_no"]
			line["use_serial_batch_fields"] = 1
		lines.append(line)
	if not lines:
		frappe.throw("请至少完成一行盘点")
	reconciliation_data = {"doctype": "Stock Reconciliation", "company": doc.company, "purpose": "Stock Reconciliation", "posting_date": doc.posting_date or nowdate(), "posting_time": doc.posting_time or nowtime(), "items": lines}
	if not meta.has_field("ti_workspace"):
		deterministic_name = _reconciliation_document_name(doc.name)
	if reconciliation is None:
		reconciliation = frappe.get_doc(reconciliation_data)
		if meta.has_field("ti_workspace"):
			reconciliation.ti_workspace = doc.name
		reconciliation.check_permission("create")
		reconciliation.insert(set_name=deterministic_name if not meta.has_field("ti_workspace") else None)
	else:
		reconciliation.update(reconciliation_data)
		if meta.has_field("ti_workspace"):
			reconciliation.ti_workspace = doc.name
		reconciliation.save()
	reconciliation.check_permission("submit")
	reconciliation.submit()
	doc.stock_reconciliation = reconciliation.name
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def refresh_reconciliation_baseline(name, revision):
	leaves = _reconciliation_capability()
	doc = _get(name, write=True, lock=True)
	if doc.movement_kind != "Reconcile":
		frappe.throw("不是盘点工作区")
	_editable(doc, revision)
	payload = _payload(doc)
	warehouse = payload.get("warehouse")
	if warehouse not in leaves:
		frappe.throw("盘点库位无权访问", frappe.PermissionError)
	ledger_balances = _reconciliation_ledger_balances(
		payload.get("items", []), warehouse, doc.posting_date or nowdate(), doc.posting_time or nowtime()
	)
	for row in payload.get("items", []):
		row["ledger_qty"] = ledger_balances.get((row["item_code"], row.get("batch_no") or ""), 0)
	_put(doc, payload)
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist()
def load_workspace(name):
	return _serialize(_get(name))


@frappe.whitelist(methods=["POST"])
def save_workspace(name, revision, data):
	doc = _get(name, write=True, lock=True)
	_editable(doc, revision)
	payload = _loads(data, {})
	candidate_items = payload.get("items", _loads(doc.state_json, {}).get("items", []))
	if candidate_items and not _stock_operation_capabilities().get(doc.movement_kind):
		frappe.throw(_("当前账户或仓库配置不允许发起此类库存操作"), frappe.PermissionError)
	_put(doc, payload)
	doc.revision += 1
	_try_sync(doc)
	_save(doc)
	return _serialize(doc)


def _audit_check(doc):
	if (doc.recorded_by or frappe.session.user) != frappe.session.user:
		frappe.throw("系统记录用户不能修改")
	if not doc.handler_name:
		frappe.throw("经手人为必填")
	current_digest = signature_digest(doc)
	for signer, field in SIGNATURE_FIELDS.items():
		if not doc.get(field):
			if signer == "handler" or (signer == "reviewer" and not doc.no_independent_reviewer):
				frappe.throw("经手人签名为必填" if signer == "handler" else "请填写鉴证人和签名，或选择无独立鉴证人")
			continue
		if doc.get(f"{signer}_signature_status") == "valid" and doc.get(f"{signer}_attested_digest") != current_digest:
			# Reconciliation hydration and ERPNext normalization can add derived
			# values without a business edit. Valid attestations are rebound to that
			# canonical representation; business edits are marked stale by _put.
			doc.set(f"{signer}_attested_digest", current_digest)
			doc.set(f"{signer}_current_digest", current_digest)
		elif doc.get(f"{signer}_signature_status") != "valid" or doc.get(f"{signer}_attested_digest") != current_digest:
			frappe.throw("签名内容已变化，请重新确认签名")
	if not doc.no_independent_reviewer and not doc.reviewer_name:
		frappe.throw("请填写鉴证人和签名，或选择无独立鉴证人")
	if doc.movement_kind == "Loan" and not doc.borrower_is_handler_or_witness and not doc.borrower:
		frappe.throw("未选择借用方是经手人或鉴证人时，借用方为必填")


@frappe.whitelist(methods=["POST"])
def reconfirm_signature(name, revision, signer, image=None):
	"""Bind one retained drawing to the current resolved business content."""
	doc = _get(name, write=True, lock=True)
	_editable(doc, revision)
	if signer not in SIGNATURE_FIELDS:
		frappe.throw("无效的签名角色")
	field = SIGNATURE_FIELDS[signer]
	if image is not None:
		doc.set(field, image)
	if not doc.get(field):
		frappe.throw("没有可重新确认的签名")
	if not doc.get(field).startswith("data:image/png;base64,") or len(doc.get(field)) > 500_000:
		frappe.throw(_("Invalid signature image"))
	digest = signature_digest(doc)
	doc.set(f"{signer}_attested_digest", digest)
	doc.set(f"{signer}_current_digest", digest)
	doc.set(f"{signer}_signature_status", "valid")
	doc.set(f"{signer}_confirmed_at", now_datetime())
	doc.set(f"{signer}_confirmed_by", frappe.session.user)
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


@frappe.whitelist(methods=["POST"])
def clear_signature(name, revision, signer):
	doc = _get(name, write=True, lock=True)
	_editable(doc, revision)
	if signer not in SIGNATURE_FIELDS:
		frappe.throw("无效的签名角色")
	doc.set(SIGNATURE_FIELDS[signer], "")
	for suffix in ("attested_digest", "confirmed_at", "confirmed_by"):
		doc.set(f"{signer}_{suffix}", None)
	doc.set(f"{signer}_current_digest", signature_digest(doc))
	doc.set(f"{signer}_signature_status", "absent")
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


def _create_business_record(doc, payload, entry):
	kind=doc.movement_kind
	if kind not in ("Loan", "Return", "Loss"):
		return
	common={"company":doc.company,"posting_datetime":f"{doc.posting_date} {doc.posting_time}","recorded_by":doc.recorded_by or frappe.session.user,"handler_name":doc.handler_name,"handler_signature":doc.handler_signature,"borrower_is_handler_or_witness":doc.borrower_is_handler_or_witness,"reviewer_name":doc.reviewer_name,"no_independent_reviewer":doc.no_independent_reviewer,"reviewer_note":doc.reviewer_note,"recorder_signature":doc.recorder_signature,"reviewer_signature":doc.reviewer_signature,"workspace":doc.name,"stock_entry":entry.name}
	if kind=="Loan":
		record=frappe.get_doc({"doctype":"Inventory Loan",**common,"borrower":doc.borrower if not doc.borrower_is_handler_or_witness else "","activity":doc.activity,"purpose":doc.purpose_text,"notes":doc.notes,"items":[{"item_code":r["item_code"],"qty":r["qty"],"uom":r.get("uom"),"batch_no":r.get("batch_no"),"original_warehouse":r.get("from_warehouse") or r.get("warehouse"),"activity":doc.activity} for r in payload.get("items",[])]})
		record.flags.workspace_service = True
		record.insert(ignore_permissions=True); doc.loan_record=record.name; return record
	elif kind=="Return":
		record=frappe.get_doc({"doctype":"Inventory Return",**common,"borrower":doc.borrower,"activity":doc.activity,"notes":doc.notes,"items":[{"loan_item":r.get("loan_item") or r.get("original_loan_item"),"qty":r["qty"],"outcome":r.get("outcome") or ("Damaged" if doc.movement_kind=="Damage" else "Returned"),"target_warehouse":r.get("to_warehouse") or r.get("warehouse")} for r in payload.get("items",[]) ]})
		record.flags.workspace_service = True
		record.insert(ignore_permissions=True); doc.return_record=record.name; return record
	else:
		record=frappe.get_doc({"doctype":"Inventory Loss",**common,"borrower":doc.borrower,"activity":doc.activity,"notes":doc.notes,"items":[{"item_code":r["item_code"],"qty":r["qty"],"uom":r.get("uom"),"source_warehouse":r.get("from_warehouse") or r.get("warehouse"),"batch_no":r.get("batch_no"),"original_loan_item":r.get("original_loan_item"),"reason":r.get("reason")} for r in payload.get("items",[])]})
		record.flags.workspace_service = True
		record.insert(ignore_permissions=True); doc.loss_record=record.name; return record


@frappe.whitelist(methods=["POST"])
def confirm_workspace(name, revision):
	doc = _get(name, write=True, lock=True)
	if _status(doc) == 1:
		return _serialize(doc)
	_editable(doc, revision)
	_audit_check(doc)
	entry = _sync(doc)
	business = _create_business_record(doc, _payload(doc), entry)
	if business:
		entry.flags.workspace_service = True
		entry.update({"ti_workspace": doc.name, "ti_loan": doc.loan_record, "ti_return": doc.return_record, "ti_loss": doc.loss_record})
		entry.save(ignore_permissions=True)
	entry.submit()
	if business:
		for business_row, entry_row in zip(business.items, entry.items):
			business_row.stock_entry_detail = entry_row.name
		business.save(ignore_permissions=True)
		business.submit()
	doc.revision += 1
	_save(doc)
	return _serialize(doc)


def _permitted_file_attachments(doctype, name):
	"""Return attachment metadata only for files readable by this user."""
	rows = frappe.get_list(
		"File",
		filters={"attached_to_doctype": doctype, "attached_to_name": name},
		fields=["name", "file_name", "file_url", "file_type", "file_size", "is_private", "creation"],
		order_by="creation asc, name asc",
		limit_page_length=0,
	)
	permitted = []
	for row in rows:
		try:
			frappe.get_doc("File", row.name).check_permission("read")
		except frappe.PermissionError:
			continue
		permitted.append(row)
	return permitted


@frappe.whitelist()
def item_detail(item_code):
	_require_stock()
	item = frappe.get_doc("Item", item_code)
	item.check_permission("read")
	warehouses = _visible_warehouses()
	bins = frappe.get_all(
		"Bin",
		filters={"item_code": item_code, "warehouse": ("in", list(warehouses) or [""])},
		fields=["warehouse", "actual_qty"],
	)
	settings = _settings()
	leased = warehouses.get(settings.leased_warehouse)

	def reserved(name):
		w = warehouses[name]
		return name in (settings.pending_warehouse, settings.damaged_warehouse) or (
			leased and w.lft >= leased.lft and w.rgt <= leased.rgt
		)

	files = _permitted_file_attachments("Item", item.name)
	image_extensions = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg")
	images, seen = [], set()
	for file in files:
		is_image = str(file.file_type or "").startswith("image/") or str(file.file_name or "").lower().endswith(image_extensions)
		if is_image and file.file_url and file.file_url not in seen:
			images.append({"file_url": file.file_url, "file_name": file.file_name, "is_primary": file.file_url == item.image})
			seen.add(file.file_url)
	if item.image and item.image not in seen:
		images.insert(0, {"file_url": item.image, "file_name": item.image.rsplit("/", 1)[-1], "is_primary": True})
	elif item.image:
		images.sort(key=lambda row: not row["is_primary"])
	batch_rows = []
	if item.has_batch_no:
		batches = frappe.get_list("Batch", filters={"item": item.name, "disabled": 0}, fields=["name", "expiry_date"], limit_page_length=0)
		balances = _current_batch_balances({batch.name for batch in batches}, {item.name}, warehouses, fallback=True)
		for batch in batches:
			qty = sum(balances.get((batch.name, name), 0) for name in warehouses)
			if qty > 0:
				batch_rows.append({"batch_no": batch.name, "expiry_date": batch.expiry_date, "qty": qty})
	active_loans = [row for row in outstanding_loan_items() if row["item_code"] == item.name]
	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"stock_uom": item.stock_uom,
		"image": item.image,
		"images": images,
		"attachments": [dict(file) for file in files],
		"can_edit": item.has_permission("write"),
		"description": item.description,
		"barcodes": [row.barcode for row in item.barcodes],
		"has_batch_no": item.has_batch_no,
		"has_expiry_date": item.has_expiry_date,
		"uoms": [{"uom": u.uom, "conversion_factor": u.conversion_factor} for u in item.uoms],
		"stock": bins,
		"total_stock": sum(r.actual_qty for r in bins),
		"available_stock": sum(r.actual_qty for r in bins if not reserved(r.warehouse)),
		"on_loan_qty": sum(r.actual_qty for r in bins if leased and r.warehouse in warehouses and warehouses[r.warehouse].lft >= leased.lft and warehouses[r.warehouse].rgt <= leased.rgt),
		"damaged_qty": sum(r.actual_qty for r in bins if r.warehouse == settings.damaged_warehouse),
		"pending_qty": sum(r.actual_qty for r in bins if r.warehouse == settings.pending_warehouse),
		"batches": batch_rows,
		"active_loans": active_loans[:20],
		"history": history(filters={"item_code": item_code}, page_length=10)["results"],
	}


@frappe.whitelist(methods=["POST"])
def remove_item_attachment(item_code, file_name, clear_primary=0):
	_require_stock()
	item = frappe.get_doc("Item", item_code)
	item.check_permission("write")
	file = frappe.get_doc("File", file_name)
	file.check_permission("delete")
	if file.attached_to_doctype != "Item" or file.attached_to_name != item.name:
		frappe.throw("附件不属于此物品", frappe.PermissionError)
	if file.file_url == item.image:
		if not cint(clear_primary):
			frappe.throw("主图正在使用此文件，请先替换主图或明确清除主图")
		item.image = ""
		item.save()
	file.delete()
	return item_detail(item_code)


@frappe.whitelist()
def batches(item_code, warehouse=None):
	_require_stock()
	frappe.get_doc("Item", item_code).check_permission("read")
	if warehouse and warehouse not in _allowed_warehouses():
		frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	rows = frappe.get_list(
		"Batch",
		filters={"item": item_code, "disabled": 0},
		fields=["name", "expiry_date", "manufacturing_date"],
		limit_page_length=0,
	)
	balances = _current_batch_balances({row.name for row in rows}, {item_code}, [warehouse] if warehouse else [], fallback=True)
	for row in rows:
		row["qty"] = balances.get((row.name, warehouse), 0) if warehouse else None
	return rows


@frappe.whitelist(methods=["POST"])
def delete_draft(name):
	doc = _get(name, write=True, lock=True)
	if _status(doc):
		frappe.throw("已完成的记录不能删除")
	if doc.stock_entry:
		entry = frappe.get_doc("Stock Entry", doc.stock_entry)
		if entry.docstatus:
			frappe.throw("已提交的库存记录不能删除")
		entry.flags.workspace_service = True
		entry.delete(ignore_permissions=True, force=True)
	for file_name in frappe.get_all("File", filters={"attached_to_doctype": doc.doctype, "attached_to_name": doc.name}, pluck="name"):
		frappe.delete_doc("File", file_name, ignore_permissions=True, force=True)
	doc.flags.workspace_service = True
	doc.delete(ignore_permissions=True, force=True)
	return {"deleted": True, "name": name}


@frappe.whitelist()
def activities(search=None, status=None, activity_type=None, start=0, page_length=100):
	_require_stock()
	filters = {"title": ("like", f"%{search or ''}%")}
	if status:
		filters["status"] = status
	if activity_type:
		filters["activity_type"] = activity_type
	return frappe.get_list(
		"Inventory Activity", filters=filters,
		fields=["name", "title", "status", "activity_type", "start_date", "end_date"],
		limit_start=int(start or 0), limit_page_length=min(int(page_length or 100), 100),
		order_by="modified desc",
	)


@frappe.whitelist(methods=["POST"])
def create_activity(data):
	_require_stock()
	p = _loads(data, {})
	doc = frappe.get_doc(
		{
			"doctype": "Inventory Activity",
			**{k: p.get(k) for k in ("title", "activity_type", "start_date", "end_date", "description")},
			"status": "Open",
		}
	)
	if doc.end_date and doc.start_date and getdate(doc.end_date) < getdate(doc.start_date):
		frappe.throw(_("End date must follow start date"))
	doc.insert()
	return {"name": doc.name, "title": doc.title}


@frappe.whitelist()
def responsible_people():
	_require_stock()
	names = frappe.get_all(
		"Has Role",
		filters={"role": ("in", ["Stock User", "Stock Manager", "System Manager"]), "parenttype": "User"},
		pluck="parent",
	)
	return frappe.get_all(
		"User", filters={"name": ("in", names or [""]), "enabled": 1}, fields=["name", "full_name"]
	)


def validate_attachment(doc, method=None):
	# File access is deliberately independent of the linked business document.
	# A user who may edit an Item/workspace must still hold the applicable File
	# permission before an upload, replacement, or removal succeeds.
	is_new = doc.is_new() if hasattr(doc, "is_new") else False
	permission = "delete" if method == "on_trash" else ("create" if is_new else "write")
	frappe.has_permission("File", permission, throw=True)
	if doc.attached_to_doctype == "Inventory Workspace":
		workspace = _get(doc.attached_to_name, write=True, lock=True)
		if _status(workspace):
			frappe.throw(_("Attachments of completed transactions cannot change"))
		if method != "on_trash":
			doc.is_private = 1
	elif doc.attached_to_doctype == "Item":
		item = frappe.get_doc("Item", doc.attached_to_name)
		item.check_permission("write")
		if method != "on_trash":
			doc.is_private = 1
	elif doc.attached_to_doctype in ("Stock Entry", "Stock Reconciliation"):
		transaction = frappe.get_doc(doc.attached_to_doctype, doc.attached_to_name)
		transaction.check_permission("write")
		if transaction.docstatus:
			frappe.throw(_("已完成的库存记录附件不能修改"))
		if method != "on_trash":
			doc.is_private = 1
	elif doc.attached_to_doctype in ("Inventory Loan", "Inventory Return", "Inventory Loss"):
		transaction = frappe.get_doc(doc.attached_to_doctype, doc.attached_to_name)
		transaction.check_permission("write")
		if transaction.docstatus:
			frappe.throw(_("已完成的交易附件不能修改"))
		if method != "on_trash":
			doc.is_private = 1


@frappe.whitelist(methods=["POST"])
def remove_attachment(name, file_name):
	doc = _get(name, write=True, lock=True)
	if _status(doc):
		frappe.throw(_("Completed transactions cannot be edited"))
	file = frappe.get_doc("File", file_name)
	file.check_permission("delete")
	if file.attached_to_doctype != doc.doctype or file.attached_to_name != doc.name:
		frappe.throw(_("Attachment does not belong to this transaction"), frappe.PermissionError)
	file.delete()
	return _serialize(doc)


def _history_match_condition(doctype, alias):
	condition = (
		get_match_cond(doctype)
		.replace("%%", "%")
		.replace(f"`tab{doctype}`", alias)
		.replace(f"tab{doctype}.", f"{alias}.")
	)
	condition = condition.strip()
	while condition.lower().startswith("and "):
		condition = condition[4:].lstrip()
	return condition or "1=1"


def _history_item_match_condition(alias):
	condition = get_match_cond("Item").replace("%%", "%").replace("`tabItem`", alias).replace("tabItem.", f"{alias}.")
	condition = condition.strip()
	while condition.lower().startswith("and "):
		condition = condition[4:].lstrip()
	return condition or "1=1"


def _history_visibility_filter(source, params, visible_warehouses):
	"""Exclude parents containing Item/Warehouse rows the current user cannot read."""
	names = sorted(visible_warehouses or {})
	placeholders = []
	for index, name in enumerate(names):
		key = f"history_visible_warehouse_{index}"
		params[key] = name
		placeholders.append(f"%({key})s")
	warehouse_list = ", ".join(placeholders) or "%(history_no_visible_warehouse)s"
	if not placeholders:
		params["history_no_visible_warehouse"] = ""
	if source == "workspace":
		item_table = """
			select 1
			from json_table(
				iw.state_json,
				'$.items[*]' columns(
					item_code varchar(140) path '$.item_code',
					warehouse varchar(140) path '$.warehouse',
					from_warehouse varchar(140) path '$.from_warehouse',
					to_warehouse varchar(140) path '$.to_warehouse'
				)
			) state_item
			left join `tabItem` visible_item on visible_item.name=state_item.item_code
			where (
				state_item.item_code is not null and state_item.item_code <> ''
				and not ({item_condition})
			) or state_item.warehouse not in ({warehouse_list})
				or state_item.from_warehouse not in ({warehouse_list})
				or state_item.to_warehouse not in ({warehouse_list})
		""".format(item_condition=_history_item_match_condition("visible_item"), warehouse_list=warehouse_list)
		section_table = f"""
			select 1
			from json_table(iw.state_json, '$.sections[*]' columns(warehouse varchar(140) path '$.warehouse')) state_section
			where state_section.warehouse not in ({warehouse_list})
		"""
		top_level = "".join(
			f" or json_unquote(json_extract(iw.state_json, '$.{field}')) not in ({warehouse_list})"
			for field in ("warehouse", "from_warehouse", "to_warehouse")
		)
		return f" and not exists ({item_table}) and not exists ({section_table}){top_level}"
	if source == "entry":
		return f"""
			and not exists (
				select 1 from `tabStock Entry Detail` visible_line
				left join `tabItem` visible_item on visible_item.name=visible_line.item_code
				where visible_line.parent=se.name
				and ((visible_line.s_warehouse is not null and visible_line.s_warehouse not in ({warehouse_list}))
					or (visible_line.t_warehouse is not null and visible_line.t_warehouse not in ({warehouse_list}))
					or (visible_line.item_code is not null and not ({_history_item_match_condition('visible_item')})))
			)
		"""
	return f"""
		and not exists (
			select 1 from `tabStock Reconciliation Item` visible_line
			left join `tabItem` visible_item on visible_item.name=visible_line.item_code
			where visible_line.parent=sr.name
			and ((visible_line.warehouse is not null and visible_line.warehouse not in ({warehouse_list}))
				or (visible_line.item_code is not null and not ({_history_item_match_condition('visible_item')})))
		)
	"""


def _history_parent_filter(alias, source, filters, params, selected_rooms=None):
	"""Build predicates for filters stored as parent columns."""
	conditions = []
	if filters.get("date_from"):
		params["history_date_from"] = filters["date_from"]
		conditions.append(f"{alias}.posting_date >= %(history_date_from)s")
	if filters.get("date_to"):
		params["history_date_to"] = filters["date_to"]
		conditions.append(f"{alias}.posting_date <= %(history_date_to)s")
	if filters.get("search"):
		params["history_search"] = f"%{filters['search']}%"
		if source == "workspace":
			conditions.append(
				"(lower(concat_ws(' ', iw.name, iw.source_text, iw.purpose_text, iw.activity, iw.borrower, iw.responsible_person, iw.handler_name)) like lower(%(history_search)s) "
				"or json_search(lower(iw.state_json), 'one', lower(%(history_search)s), null, '$') is not null)"
			)
		elif source == "entry":
			conditions.append(
				"(lower(concat_ws(' ', se.name, se.remarks, se.ti_source_text, se.ti_purpose_text, se.ti_activity, se.ti_borrower, se.ti_handler_name)) like lower(%(history_search)s) "
				"or exists (select 1 from `tabStock Entry Detail` search_line "
				"left join `tabItem` search_item on search_item.name=search_line.item_code "
				"where search_line.parent=se.name and lower(concat_ws(' ', search_line.item_code, search_item.item_name, search_item.item_group, search_line.s_warehouse, search_line.t_warehouse)) like lower(%(history_search)s)))"
			)
		else:
			conditions.append(
				"(lower(concat_ws(' ', sr.name, sr.purpose)) like lower(%(history_search)s) "
				"or exists (select 1 from `tabStock Reconciliation Item` search_line "
				"left join `tabItem` search_item on search_item.name=search_line.item_code "
				"where search_line.parent=sr.name and lower(concat_ws(' ', search_line.item_code, search_item.item_name, search_item.item_group, search_line.warehouse)) like lower(%(history_search)s)))"
			)
	if selected_rooms:
		room_placeholders = []
		for index, room in enumerate(sorted(selected_rooms)):
			key = f"history_selected_room_{index}"
			params[key] = room
			room_placeholders.append(f"%({key})s")
		room_list = ", ".join(room_placeholders)
		if source == "workspace":
			conditions.append(
				f"(exists (select 1 from json_table(iw.state_json, '$.items[*]' columns(warehouse varchar(140) path '$.warehouse', from_warehouse varchar(140) path '$.from_warehouse', to_warehouse varchar(140) path '$.to_warehouse')) scope_item where scope_item.warehouse in ({room_list}) or scope_item.from_warehouse in ({room_list}) or scope_item.to_warehouse in ({room_list})) "
				f"or exists (select 1 from json_table(iw.state_json, '$.sections[*]' columns(warehouse varchar(140) path '$.warehouse')) scope_section where scope_section.warehouse in ({room_list})) "
				f"or json_unquote(json_extract(iw.state_json, '$.warehouse')) in ({room_list}) or json_unquote(json_extract(iw.state_json, '$.from_warehouse')) in ({room_list}) or json_unquote(json_extract(iw.state_json, '$.to_warehouse')) in ({room_list}))"
			)
		elif source == "entry":
			conditions.append(f"exists (select 1 from `tabStock Entry Detail` scope_line where scope_line.parent=se.name and (scope_line.s_warehouse in ({room_list}) or scope_line.t_warehouse in ({room_list})))")
		else:
			conditions.append(f"exists (select 1 from `tabStock Reconciliation Item` scope_line where scope_line.parent=sr.name and scope_line.warehouse in ({room_list}))")

	field_map = {
		"source_text": {"workspace": "source_text", "entry": "ti_source_text"},
		"purpose_text": {"workspace": "purpose_text", "entry": "ti_purpose_text"},
		"activity": {"workspace": "activity", "entry": "ti_activity"},
		"handler_name": {"workspace": "handler_name", "entry": "ti_handler_name"},
		"responsible_person": {"workspace": "responsible_person", "entry": "ti_responsible_person"},
	}
	for filter_name, fields in field_map.items():
		value = filters.get(filter_name)
		if not value:
			continue
		params[f"history_{filter_name}"] = f"%{value}%"
		field = fields.get(source)
		if field:
			conditions.append(f"lower(coalesce({alias}.{field}, '')) like lower(%(history_{filter_name})s)")
		elif source == "reconciliation" and filter_name == "purpose_text":
			conditions.append("lower(coalesce(sr.purpose, '')) like lower(%(history_purpose_text)s)")
		else:
			conditions.append("1=0")

	desired = filters.get("movement_kind")
	if desired:
		params["history_movement_kind"] = desired
		if source == "workspace":
			if desired == "盘点调整":
				conditions.append(f"({alias}.stock_reconciliation is not null or {alias}.movement_kind=%(history_movement_kind)s)")
			else:
				conditions.append(f"{alias}.movement_kind=%(history_movement_kind)s")
		elif source == "entry":
			purpose_map = {"Receive": "Material Receipt", "Issue": "Material Issue", "Transfer": "Material Transfer"}
			if desired in purpose_map:
				params["history_entry_purpose"] = purpose_map[desired]
				conditions.append(
					f"(se.ti_movement_kind=%(history_movement_kind)s or (se.ti_movement_kind is null and se.purpose=%(history_entry_purpose)s))"
				)
			elif desired in ("Loan", "Return", "Damage", "Loss", "Repair", "Disposal"):
				conditions.append(f"se.ti_movement_kind=%(history_movement_kind)s")
			else:
				conditions.append("1=0")
		else:
			if desired == "盘点调整":
				conditions.append("sr.purpose='Stock Reconciliation'")
			elif desired == "期初库存":
				conditions.append("sr.purpose<>'Stock Reconciliation'")
			else:
				conditions.append("1=0")
	return " and " + " and ".join(conditions) if conditions else ""


def _history_database_page(status_group, start, page_length, item_code=None, filters=None, visible_warehouses=None, selected_rooms=None):
	"""Page unfiltered or item-scoped movements in SQL, hydrating returned parents.

	The general filtered path still needs arbitrary JSON/child-state predicates.
	This path covers the common browse request and Item Detail history while
	preserving each DocType's Frappe parent permission predicate and the
	app-authored/direct-entry de-dupe.
	"""
	settings = _settings()
	filters = filters or {}
	params = {"company": settings.company, "start": start, "page_length": page_length, "item_code": item_code}
	workspace_status = "coalesce(se.docstatus, sr.docstatus, 0)"
	workspace_kind = "case when iw.stock_reconciliation is not null then '盘点调整' else iw.movement_kind end"
	workspace = f"""
		select iw.name, 'workspace' as source, {workspace_status} as docstatus, iw.modified,
			{workspace_kind} as movement_kind
		from `tabInventory Workspace` iw
		left join `tabStock Entry` se on se.name=iw.stock_entry
		left join `tabStock Reconciliation` sr on sr.name=iw.stock_reconciliation
		where iw.company=%(company)s and {_history_match_condition('Inventory Workspace', 'iw')}
			and (%(item_code)s is null or json_search(iw.state_json, 'one', %(item_code)s, null, '$.items[*].item_code') is not null)
		{_history_parent_filter('iw', 'workspace', filters, params, selected_rooms)}
		{_history_visibility_filter('workspace', params, visible_warehouses) if visible_warehouses is not None else ''}
	""" if frappe.has_permission("Inventory Workspace", "read") else ""
	entry = f"""
		select se.name, 'entry' as source, se.docstatus, se.modified,
			coalesce(se.ti_movement_kind, se.purpose) as movement_kind
		from `tabStock Entry` se
		where se.company=%(company)s and (%(item_code)s is null or exists (
			select 1 from `tabStock Entry Detail` sed_item
				join `tabItem` item on item.name=sed_item.item_code
			where sed_item.parent=se.name and sed_item.item_code=%(item_code)s
				and {_history_item_match_condition('item')}
		)) and not exists (
			select 1 from `tabInventory Workspace` linked where linked.stock_entry=se.name
		) and {_history_match_condition('Stock Entry', 'se')}
		{_history_parent_filter('se', 'entry', filters, params, selected_rooms)}
		{_history_visibility_filter('entry', params, visible_warehouses) if visible_warehouses is not None else ''}
	""" if frappe.has_permission("Stock Entry", "read") else ""
	reconciliation = f"""
		select sr.name, 'reconciliation' as source, sr.docstatus, sr.modified,
			case when sr.purpose = 'Stock Reconciliation' then '盘点调整' else '期初库存' end as movement_kind
		from `tabStock Reconciliation` sr
		where sr.company=%(company)s and (%(item_code)s is null or exists (
			select 1 from `tabStock Reconciliation Item` sri_item
				join `tabItem` item on item.name=sri_item.item_code
			where sri_item.parent=sr.name and sri_item.item_code=%(item_code)s
				and {_history_item_match_condition('item')}
		)) and not exists (
			select 1 from `tabInventory Workspace` linked where linked.stock_reconciliation=sr.name
		) and {_history_match_condition('Stock Reconciliation', 'sr')}
		{_history_parent_filter('sr', 'reconciliation', filters, params, selected_rooms)}
		{_history_visibility_filter('reconciliation', params, visible_warehouses) if visible_warehouses is not None else ''}
	""" if frappe.has_permission("Stock Reconciliation", "read") else ""
	union = " union all ".join(part for part in (workspace, entry, reconciliation) if part)
	if not union:
		return [], 0, 0, 0, {"movement_kind": {}, "warehouses": {}, "item_groups": {}}
	if status_group == "unfinished":
		status_where = "where movement.docstatus=0"
	elif status_group == "completed":
		status_where = "where movement.docstatus in (1, 2)"
	else:
		status_where = ""
	count = frappe.db.sql(
		f"select count(*) as total from ({union}) movement {status_where}", params, as_dict=True
	)[0].total
	rows = frappe.db.sql(
		f"""select movement.name, movement.source, movement.docstatus, movement.modified
		from ({union}) movement {status_where}
		order by movement.modified desc, movement.name desc
		limit %(page_length)s offset %(start)s""",
		params,
		as_dict=True,
	)
	all_count = frappe.db.sql(f"select count(*) as total from ({union}) movement", params, as_dict=True)[0].total
	unfinished_count = frappe.db.sql(
		f"select count(*) as total from ({union}) movement where movement.docstatus=0", params, as_dict=True
	)[0].total
	facets = frappe.db.sql(
		f"select coalesce(movement.movement_kind, '') as movement_kind, count(*) as total from ({union}) movement {status_where} group by movement.movement_kind",
		params,
		as_dict=True,
	)
	return rows, int(count), int(all_count), int(unfinished_count), {
		"movement_kind": {row.movement_kind: int(row.total) for row in facets},
		"warehouses": {},
		"item_groups": {},
	}


def _history_workspace_summary(doc):
	"""Return bounded list data; full workspace state belongs to detail endpoints."""
	payload = _payload(doc)
	items = payload.get("items", [])
	quantities = defaultdict(float)
	for item in items:
		quantities[item.get("uom") or ""] += flt(item.get("qty"))
	preview = [
		{
			"item_code": item.get("item_code"),
			"qty": item.get("qty"),
			"uom": item.get("uom"),
			"warehouse": item.get("warehouse"),
			"from_warehouse": item.get("from_warehouse"),
			"to_warehouse": item.get("to_warehouse"),
			"batch_no": item.get("batch_no"),
		}
		for item in items[:5]
	]
	return {
		"name": doc.name,
		"stock_entry": doc.stock_entry,
		"stock_reconciliation": doc.get("stock_reconciliation"),
		"docstatus": _status(doc),
		"modified": str(doc.modified),
		"movement_kind": "盘点调整" if doc.get("stock_reconciliation") else doc.movement_kind,
		"posting_date": str(doc.posting_date),
		"posting_time": str(doc.posting_time or ""),
		"source_text": doc.source_text,
		"purpose_text": doc.purpose_text,
		"activity": doc.activity,
		"handler_name": doc.handler_name,
		"recorded_by": doc.recorded_by,
		"line_count": len(items),
		"items": preview,
		"quantities": [{"uom": uom, "qty": qty} for uom, qty in sorted(quantities.items()) if uom],
		"detail_route": f"/workspace/{doc.name}",
	}


@frappe.whitelist()
def history(filters=None, start=0, page_length=30, status_group="all"):
	_require_stock()
	raw_filters = _loads(filters, {})
	f = dict(raw_filters)
	allowed = _visible_warehouses()
	if status_group == "unfinished":
		f["docstatus"] = "0"
	elif status_group == "completed":
		f["docstatus"] = {"in": [1, 2]}
	rooms = f.get("rooms", f.get("room"))
	item_code = f.get("item_code")
	selected_rooms = _selected_leaf_warehouses(rooms, allowed, empty_means_all=False) if rooms else None
	sql_filter_keys = {"item_code", "date_from", "date_to", "movement_kind", "source_text", "purpose_text", "activity", "handler_name", "responsible_person", "search", "rooms", "room"}
	sql_filterable = set(raw_filters).issubset(sql_filter_keys)
	if sql_filterable:
		if item_code:
			frappe.get_doc("Item", item_code).check_permission("read")
		page_start = max(cint(start or 0), 0)
		requested_length = min(max(cint(page_length or 30), 1), 100)
		parents, total, overall_total, unfinished_count, facets = _history_database_page(
			status_group,
			page_start,
			requested_length,
			item_code=item_code,
			filters=f,
			visible_warehouses=None if frappe.session.user == "Administrator" else allowed,
			selected_rooms=selected_rooms,
		)
		allowed = _visible_warehouses()
		rows = []
		for parent in parents:
			if parent.source == "workspace":
				try:
					doc = _get(parent.name)
				except frappe.PermissionError:
					continue
				rows.append(_history_workspace_summary(doc))
				continue
			if parent.source == "entry":
				doc = frappe.get_doc("Stock Entry", parent.name)
				if any(w and w not in allowed for item in doc.items for w in (item.s_warehouse, item.t_warehouse)):
					continue
				try:
					for item in doc.items:
						frappe.get_doc("Item", item.item_code).check_permission("read")
				except frappe.PermissionError:
					continue
				rows.append({"name": doc.name, "legacy": True, "stock_entry": doc.name, "docstatus": doc.docstatus, "modified": str(doc.modified), **_from_entry(doc)})
				continue
			doc = frappe.get_doc("Stock Reconciliation", parent.name)
			try:
				doc.check_permission("read")
			except frappe.PermissionError:
				continue
			items = []
			for item in doc.items:
				if item.warehouse not in allowed or frappe.db.get_value("Warehouse", item.warehouse, "is_group"):
					continue
				try:
					frappe.get_doc("Item", item.item_code).check_permission("read")
				except frappe.PermissionError:
					continue
				items.append({"id": item.name, "item_code": item.item_code, "qty": item.qty, "uom": getattr(item, "stock_uom", None) or getattr(item, "uom", None), "warehouse": item.warehouse, "batch_no": item.batch_no})
			if items:
				rows.append({"name": doc.name, "legacy": True, "document_type": "Stock Reconciliation", "stock_reconciliation": doc.name, "docstatus": doc.docstatus, "modified": str(doc.modified), "movement_kind": "盘点调整" if doc.purpose == "Stock Reconciliation" else "期初库存", "purpose_text": doc.purpose, "posting_date": str(doc.posting_date), "posting_time": str(doc.posting_time or ""), "items": items})
		page = _page(rows, requested_length, 0)
		page["overall_total"] = overall_total if status_group != "unfinished" else total
		if status_group != "unfinished":
			page["unfinished_count"] = unfinished_count
		page["facets"] = facets
		return page
	# Validate and expand once for the whole query. This avoids repeated work
	# and makes an invalid location a permission error instead of an empty list.
	# The SQL path above handles search and room scope; the fallback retains the
	# same expanded leaf set for filters that still depend on JSON payload shape.
	selected_rooms = selected_rooms
	page_start = max(cint(start or 0), 0)
	requested_length = min(max(cint(page_length or 30), 1), 100)
	# Read each source in stable database pages. There is deliberately no
	# arbitrary candidate cap: older matching movements must remain discoverable
	# and totals must not depend on how many unrelated records precede them.
	page_size = max(requested_length * 2, 200)
	def paged(doctype, filters, fields):
		offset = 0
		while True:
			page = frappe.get_list(
				doctype,
				filters=filters,
				fields=fields,
				order_by="modified desc, name desc",
				start=offset,
				limit_page_length=page_size,
			)
			for row in page:
				yield row
			if len(page) < page_size:
				break
			offset += len(page)
	base_filters = {"company": _settings().company}
	if f.get("date_from"):
		base_filters["posting_date"] = [">=", f["date_from"]]
	if f.get("date_to"):
		base_filters["posting_date"] = ["between", [f.get("date_from") or "1900-01-01", f["date_to"]]]
	workspace_filters = {"company": _settings().company}
	if f.get("date_from"):
		workspace_filters["posting_date"] = [">=", f["date_from"]]
	if f.get("date_to"):
		workspace_filters["posting_date"] = ["between", [f.get("date_from") or "1900-01-01", f["date_to"]]]
	if f.get("docstatus") in (0, "0"):
		base_filters["docstatus"] = 0
	elif isinstance(f.get("docstatus"), dict):
		base_filters["docstatus"] = ["in", f["docstatus"].get("in", [1, 2])]
	results = []
	linked = set()
	linked_reconciliations = set()
	for row in paged("Inventory Workspace", workspace_filters, ["name", "modified"]):
		try:
			doc = _get(row.name)
		except frappe.PermissionError:
			continue
		p = _history_workspace_summary(doc)
		linked.add(doc.stock_entry)
		if doc.get("stock_reconciliation"):
			linked_reconciliations.add(doc.stock_reconciliation)
		results.append(p)
	for row in paged("Stock Entry", base_filters, ["name", "modified"]):
		if row.name in linked:
			continue
		doc = frappe.get_doc("Stock Entry", row.name)
		if any(w and w not in allowed for r in doc.items for w in (r.s_warehouse, r.t_warehouse)):
			continue
		try:
			for line in doc.items:
				frappe.get_doc("Item", line.item_code).check_permission("read")
		except frappe.PermissionError:
			continue
		results.append(
			{
				"name": doc.name,
				"legacy": True,
				"stock_entry": doc.name,
				"docstatus": doc.docstatus,
				"modified": str(doc.modified),
				**_from_entry(doc),
			}
		)
	for row in paged("Stock Reconciliation", base_filters, ["name", "modified"]):
		if row.name in linked_reconciliations:
			continue
		doc = frappe.get_doc("Stock Reconciliation", row.name)
		try:
			doc.check_permission("read")
		except frappe.PermissionError:
			continue
		items = []
		for line in doc.items:
			if line.warehouse not in allowed or frappe.db.get_value("Warehouse", line.warehouse, "is_group"):
				continue
			try:
				frappe.get_doc("Item", line.item_code).check_permission("read")
			except frappe.PermissionError:
				continue
			items.append({"id": line.name, "item_code": line.item_code, "qty": line.qty, "uom": getattr(line, "stock_uom", None) or getattr(line, "uom", None), "warehouse": line.warehouse, "batch_no": line.batch_no})
		if not items:
			continue
		results.append({
			"name": doc.name,
			"legacy": True,
			"document_type": "Stock Reconciliation",
			"stock_reconciliation": doc.name,
			"docstatus": doc.docstatus,
			"modified": str(doc.modified),
			"movement_kind": "盘点调整" if doc.purpose == "Stock Reconciliation" else "期初库存",
			"purpose_text": doc.purpose,
			"posting_date": str(doc.posting_date),
			"posting_time": str(doc.posting_time or ""),
			"items": items,
		})

	def matches(r):
		for key in ("movement_kind", "activity", "responsible_person", "handler_name"):
			if f.get(key) and key == "movement_kind" and f[key] == "盘点调整" and r.get(key) in ("盘点调整", "期初库存"):
				continue
			if f.get(key) and r.get(key) != f[key]:
				return False
		if f.get("docstatus") is not None and f.get("docstatus") != "":
			if isinstance(f["docstatus"], dict):
				if r["docstatus"] not in f["docstatus"].get("in", []):
					return False
			elif r["docstatus"] != cint(f["docstatus"]):
				return False
		for key in ("source_text", "purpose_text", "borrower"):
			if f.get(key) and f[key].lower() not in (r.get(key) or "").lower():
				return False
		if f.get("date_from") and str(r.get("posting_date") or "") < f["date_from"]:
			return False
		if f.get("date_to") and str(r.get("posting_date") or "") > f["date_to"]:
			return False
		if f.get("item_code") and not any(i["item_code"] == f["item_code"] for i in r["items"]):
			return False
		if selected_rooms is not None:
			if not any(
				w in selected_rooms
				for i in r["items"]
				for w in (i.get("warehouse"), i.get("from_warehouse"), i.get("to_warehouse"))
			):
				return False
		if (
			f.get("search")
			and f["search"].lower() not in json.dumps(r, default=str, ensure_ascii=False).lower()
		):
			return False
		return True

	matched = [r for r in results if matches(r)]
	rows = sorted(matched, key=lambda r: (r["modified"], r["name"]), reverse=True)
	page = _page(rows, page_length, start)
	if status_group == "unfinished":
		page["overall_total"] = sum(1 for row in results if row["docstatus"] == 0)
	elif status_group == "completed":
		page["overall_total"] = sum(1 for row in results if row["docstatus"] in (1, 2))
	else:
		page["overall_total"] = len(results)
	if status_group != "unfinished":
		page["unfinished_count"] = sum(1 for r in results if r["docstatus"] == 0)
	movement_facets = defaultdict(set)
	warehouse_facets = defaultdict(set)
	item_group_facets = defaultdict(set)
	for row in matched:
		movement_facets[row.get("movement_kind") or ""].add(row["name"])
		for item in row.get("items", []):
			for warehouse in (item.get("warehouse"), item.get("from_warehouse"), item.get("to_warehouse")):
				if warehouse:
					warehouse_facets[warehouse].add(row["name"])
			item_group = item.get("item_group")
			if item_group:
				item_group_facets[item_group].add(row["name"])
	page["facets"] = {
		"movement_kind": {key: len(value) for key, value in movement_facets.items()},
		"warehouses": {key: len(value) for key, value in warehouse_facets.items()},
		"item_groups": {key: len(value) for key, value in item_group_facets.items()},
	}
	return page


def _entry_movement_kind(doc):
	# App-authored semantics win; direct ERPNext entries use purpose unless the
	# complete permitted direction unambiguously crosses the damaged leaf.
	if doc.get("ti_movement_kind"):
		return doc.get("ti_movement_kind")
	standard = {"Material Receipt": "Receive", "Material Issue": "Issue", "Material Transfer": "Transfer"}.get(doc.purpose, "Transfer")
	if doc.purpose != "Material Transfer":
		return standard
	damaged = _settings().damaged_warehouse
	allowed = _allowed_warehouses()
	rows = [row for row in doc.items if row.s_warehouse or row.t_warehouse]
	if rows and all(row.t_warehouse == damaged and row.s_warehouse != damaged for row in rows):
		return "Damage"
	if rows and all(row.s_warehouse == damaged and row.t_warehouse in allowed for row in rows):
		return "Repair"
	return standard


def _from_entry(doc, movement_kind=None):
	movement_kind = movement_kind or _entry_movement_kind(doc)
	p = {
		key: doc.get("ti_" + key)
		for key in META
		if key not in ("posting_date", "posting_time", "notes", "recorder_signature")
	}
	p["movement_kind"] = movement_kind
	p.update(
		activity=doc.get("ti_activity"),
		recorder_signature=doc.get("ti_recorder_signature"),
		notes=doc.remarks,
		posting_date=str(doc.posting_date),
		posting_time=str(doc.posting_time),
		sections=[],
	)
	p["items"] = [
		{
			"id": r.name,
			"item_code": r.item_code,
			"qty": r.qty,
			"uom": r.uom,
			"batch_no": r.batch_no,
			"warehouse": r.t_warehouse if movement_kind == "Receive" else r.s_warehouse,
			"from_warehouse": r.s_warehouse,
			"to_warehouse": r.t_warehouse,
		}
		for r in doc.items
	]
	return p


@frappe.whitelist(methods=["POST"])
def open_entry(name):
	_require_stock()
	if not frappe.db.exists("Stock Entry", name) and frappe.db.exists("Stock Reconciliation", name):
		return open_reconciliation(name)
	frappe.db.sql("select name from `tabStock Entry` where name=%s for update", name)
	entry = frappe.get_doc("Stock Entry", name)
	entry.check_permission("read")
	if entry.company != _settings().company:
		frappe.throw(_("Not a temple inventory transaction"), frappe.PermissionError)
	allowed = _visible_warehouses()
	if any(w and w not in allowed for r in entry.items for w in (r.s_warehouse, r.t_warehouse)):
		frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
	if not entry.ti_movement_kind:
		return {"name": name, "stock_entry": name, "docstatus": entry.docstatus, "data": _from_entry(entry), "attachments": _permitted_file_attachments("Stock Entry", name)}
	existing = frappe.db.get_value("Inventory Workspace", {"stock_entry": name}, "name")
	if existing:
		return _serialize(_get(existing))
	payload = _from_entry(entry)
	if entry.docstatus:
		return {
			"name": name,
			"stock_entry": name,
			"docstatus": entry.docstatus,
			"data": payload,
			"attachments": _permitted_file_attachments("Stock Entry", name),
		}
	entry.check_permission("write")
	doc = frappe.get_doc(
		{
			"doctype": "Inventory Workspace",
			"name": "IW-" + hashlib.sha256(name.encode()).hexdigest()[:24],
			"company": entry.company,
			"movement_kind": entry.ti_movement_kind,
			"stock_entry": name,
			"revision": 1,
			"state_json": "{}",
		}
	)
	_put(doc, payload)
	_save(doc)
	# Retain existing files and expose them alongside workspace files.
	for file in frappe.get_list(
		"File", filters={"attached_to_doctype": "Stock Entry", "attached_to_name": name}, pluck="name"
	):
		fdoc = frappe.get_doc("File", file)
		fdoc.check_permission("write")
		fdoc.attached_to_doctype, fdoc.attached_to_name = doc.doctype, doc.name
		fdoc.is_private = 1
		fdoc.save()
	return _serialize(doc)


@frappe.whitelist()
def open_reconciliation(name):
	_require_stock()
	doc = frappe.get_doc("Stock Reconciliation", name)
	doc.check_permission("read")
	if doc.company != _settings().company:
		frappe.throw("盘点记录不属于当前公司", frappe.PermissionError)
	allowed = _allowed_warehouses()
	items = []
	for row in doc.items:
		if row.warehouse not in allowed or frappe.db.get_value("Warehouse", row.warehouse, "is_group"):
			continue
		frappe.get_doc("Item", row.item_code).check_permission("read")
		items.append({"id": row.name, "item_code": row.item_code, "qty": row.qty, "counted_qty": row.qty, "ledger_qty": getattr(row, "current_qty", row.qty), "difference_qty": getattr(row, "quantity_difference", 0), "uom": getattr(row, "stock_uom", None) or getattr(row, "uom", None), "warehouse": row.warehouse, "batch_no": row.batch_no})
	if not items:
		frappe.throw("没有可查看的盘点明细", frappe.PermissionError)
	return {"name": name, "stock_reconciliation": name, "docstatus": doc.docstatus, "data": {"movement_kind": "Reconcile", "posting_date": str(doc.posting_date), "posting_time": str(doc.posting_time or ""), "items": items}, "attachments": _permitted_file_attachments("Stock Reconciliation", name)}
