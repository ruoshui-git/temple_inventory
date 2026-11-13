"""Versioned editing of ERPNext stock documents; no shadow server drafts."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import hashlib
import re

import frappe
from frappe.utils import cint

from temple_inventory.native_access import (
	NATIVE_DOCTYPES,
	check_document_scope,
	check_version,
	load_locked,
	require_app,
	retry_native_job,
	retry_native_request,
)
from temple_inventory.native_balances import entry_bundle, reconciliation_allocations
from temple_inventory.native_stock import (
	MOVEMENT_PURPOSES,
	batch_quantities,
	loan_balances_many,
	preserve_copied_conversions,
)

HEADER_FIELDS = {
	"company",
	"posting_date",
	"posting_time",
	"remarks",
	"ti_movement_kind",
	"ti_time_mode",
	"ti_source_text",
	"ti_purpose_text",
	"ti_activity",
	"ti_borrower",
	"ti_recorder_name",
	"ti_handler_name",
	"ti_reviewer_name",
}
QUEUED_ROW_THRESHOLD = 100
SETTLEMENT_KINDS = ("Return", "Damage", "Loss")
SETTLEMENT_HEADER_FIELDS = {"ti_activity", "ti_borrower"}
ENTRY_LINE_FIELDS = {
	"item_code",
	"qty",
	"uom",
	"conversion_factor",
	"s_warehouse",
	"t_warehouse",
	"batch_no",
	"serial_no",
	"serial_and_batch_bundle",
	"use_serial_batch_fields",
	"basic_rate",
	"allow_zero_valuation_rate",
	"ti_original_loan",
	"ti_original_loan_line",
	"ti_settlement_outcome",
	"ti_allocation_note",
}
COUNT_LINE_FIELDS = {"item_code", "warehouse", "batch_no", "qty", "use_serial_batch_fields"}
OPENING_LINE_FIELDS = COUNT_LINE_FIELDS | {"valuation_rate", "serial_no", "allow_zero_valuation_rate"}
COUNT_HEADER_FIELDS = {
	"ti_time_mode",
	"ti_notes",
}
REVIEW_FIELDS = {
	"item_code",
	"warehouse",
	"batch_no",
	"stock_uom",
	"baseline_qty",
	"actual_qty",
	"review_state",
	"reason",
}


def _identity(doctype):
	if doctype not in NATIVE_DOCTYPES:
		frappe.throw("不支持的库存记录类型")
	return doctype


def _doctype_needs_document_check(doctype):
	"""Keep per-document checks when a controller or hook adds read rules."""
	from frappe.model.base_document import get_controller
	from frappe.model.document import Document

	controller = get_controller(doctype)
	return (
		controller.check_permission is not Document.check_permission
		or controller.has_permission is not Document.has_permission
		or bool(frappe.get_hooks("has_permission").get(doctype))
	)


def _stock_entry_needs_document_check():
	return _doctype_needs_document_check("Stock Entry") or bool(
		frappe.permissions.get_user_permissions(frappe.session.user).get("Warehouse")
	)


def _serialize_bundle_caches(rows):
	"""Preload permission-filtered bundles and batches for one document response."""
	from collections import defaultdict

	names = {
		row.get(field)
		for row in rows
		for field in ("serial_and_batch_bundle", "current_serial_and_batch_bundle")
		if row.get(field)
	}
	if not names:
		return {}, {}
	if _doctype_needs_document_check("Serial and Batch Bundle"):
		return {}, {}
	meta = frappe.get_meta("Serial and Batch Bundle")
	entries_field = meta.get_field("entries")
	child_doctype = entries_field.options if entries_field else None
	bundles = frappe.get_list(
		"Serial and Batch Bundle",
		filters={"name": ["in", sorted(names)]},
		fields=["*"],
		limit_page_length=0,
	)
	bundle_names = {row.name for row in bundles}
	entries = defaultdict(list)
	if child_doctype and bundle_names:
		for row in frappe.get_all(
			child_doctype,
			filters={
				"parent": ["in", sorted(bundle_names)],
				"parenttype": "Serial and Batch Bundle",
				"parentfield": "entries",
			},
			fields=["*"],
			order_by="parent asc, idx asc",
			limit_page_length=0,
		):
			entries[row.parent].append(frappe._dict({**dict(row), "doctype": child_doctype}))
	batch_names = sorted(
		{entry.batch_no for rows in entries.values() for entry in rows if entry.get("batch_no")}
	)
	batch_docs = {}
	if batch_names and not _doctype_needs_document_check("Batch"):
		batch_docs = {
			row.name: frappe.get_doc({**dict(row), "doctype": "Batch"})
			for row in frappe.get_list(
				"Batch",
				filters={"name": ["in", batch_names]},
				fields=["*"],
				limit_page_length=0,
			)
		}
	bundle_docs = {}
	for row in bundles:
		bundle = frappe.get_doc({**dict(row), "doctype": "Serial and Batch Bundle"})
		bundle.__dict__["entries"] = entries.get(row.name, [])
		bundle.flags.ti_permission_filtered_batches = not _doctype_needs_document_check("Batch") and all(
			not entry.get("batch_no") or entry.batch_no in batch_docs for entry in bundle.entries
		)
		bundle_docs[row.name] = bundle
	return bundle_docs, batch_docs


def _require_supported_edit(doc):
	if doc.doctype == "Stock Entry":
		if doc.purpose not in set(MOVEMENT_PURPOSES.values()):
			frappe.throw("此库存用途请在 ERPNext 中处理")
	elif doc.purpose not in ("Stock Reconciliation", "Opening Stock"):
		frappe.throw("此盘点调整用途请在 ERPNext 中处理")


def _request_key(doctype, request_id):
	if not isinstance(request_id, str) or not 16 <= len(request_id) <= 128:
		frappe.throw("请提供有效的创建请求标识")
	return hashlib.sha256(f"{frappe.session.user}\0{doctype}\0{request_id}".encode()).hexdigest()


def _apply_lines(doc, values, fieldname="items"):
	if not isinstance(values, list) or (fieldname == "items" and not values):
		frappe.throw("至少需要一条完整明细")
	existing = {row.name: row for row in doc.get(fieldname, [])}
	used = set()
	rows = []
	allowed = (
		ENTRY_LINE_FIELDS
		if doc.doctype == "Stock Entry"
		else (OPENING_LINE_FIELDS if doc.purpose == "Opening Stock" else COUNT_LINE_FIELDS)
	)
	if fieldname == "ti_count_review":
		allowed = REVIEW_FIELDS
	for value in values:
		name = value.get("name")
		if name:
			if name not in existing or name in used:
				frappe.throw("明细标识无效，请重新载入", frappe.TimestampMismatchError)
			used.add(name)
			row = existing[name]
		else:
			row = doc.append(fieldname, {})
			if (
				doc.doctype == "Stock Entry"
				and doc.get("ti_movement_kind") == "Receive"
				and "basic_rate" not in value
				and "allow_zero_valuation_rate" not in value
			):
				# Donated Items may have no prior valuation. Native ERPNext still
				# derives an existing rate and clears this allowance when it finds one.
				row.allow_zero_valuation_rate = 1
		for field in allowed:
			if field in value:
				row.set(field, value[field])
		rows.append(row)
	# Retain row objects and all unknown native fields, including Desk extensions.
	doc.set(fieldname, rows)


def _apply(doc, data):
	if not isinstance(data, dict):
		frappe.throw("记录内容无效")
	if doc.doctype == "Stock Reconciliation" and "ti_borrower" in data:
		frappe.throw("盘点调整不支持借用方字段")
	allowed = HEADER_FIELDS | (COUNT_HEADER_FIELDS if doc.doctype == "Stock Reconciliation" else set())
	if doc.doctype == "Stock Reconciliation":
		allowed.discard("remarks")
	if doc.doctype == "Stock Entry" and (data.get("ti_movement_kind") or doc.get("ti_movement_kind")) in (
		SETTLEMENT_KINDS
	):
		# Settlement borrower and activity come from the original loan lines on validate.
		allowed -= SETTLEMENT_HEADER_FIELDS
	for field in allowed:
		if field in data:
			value = data[field]
			doc.set(field, value)
	if doc.doctype == "Stock Reconciliation":
		if doc.is_new():
			purpose = data.get("purpose", "Stock Reconciliation")
			if purpose not in ("Stock Reconciliation", "Opening Stock"):
				frappe.throw("不支持此盘点用途")
			doc.purpose = purpose
			if purpose == "Opening Stock":
				from temple_inventory.opening import set_difference_account

				set_difference_account(doc)
		else:
			_require_supported_edit(doc)
	if "items" in data:
		_apply_lines(doc, data["items"])
	if doc.doctype == "Stock Reconciliation" and "ti_count_review" in data:
		_apply_lines(doc, data["ti_count_review"], "ti_count_review")
	if doc.doctype == "Stock Entry" and doc.get("ti_time_mode") == "Current":
		current = frappe.utils.now_datetime()
		doc.posting_date, doc.posting_time = current.date(), current.time()
	doc.set_posting_time = 1
	if doc.doctype == "Stock Entry":
		kind = doc.get("ti_movement_kind")
		if kind not in MOVEMENT_PURPOSES:
			frappe.throw("请选择受支持的操作类型")
		purpose = MOVEMENT_PURPOSES[kind]
		if not doc.is_new() and doc.purpose != purpose:
			frappe.throw("不能更改已保存记录的库存用途")
		doc.purpose = purpose
		if doc.is_new():
			doc.stock_entry_type = purpose


def serialize(doc):
	doc.check_permission("read")
	bundle_cache = {}
	batch_permissions = {}
	rows = [*(doc.get("items") or []), *(doc.get("ti_count_review") or [])]
	bundle_docs, batch_docs = _serialize_bundle_caches(rows)

	def check_batch(name):
		if name not in batch_permissions:
			batch = batch_docs.get(name)
			if not batch:
				batch = frappe.get_doc("Batch", name)
				batch.check_permission("read")
			batch_permissions[name] = batch
		return batch_permissions[name]

	def load_bundle(name):
		return bundle_docs.get(name)

	from temple_inventory.native_stock import warehouse_scopes

	visible_warehouses = warehouse_scopes()[1]
	check_document_scope(
		doc,
		visible_warehouses=visible_warehouses,
		batch_checker=check_batch,
		bundle_cache=bundle_cache,
		bundle_loader=load_bundle,
	)
	if doc.doctype == "Stock Entry":
		kind = doc.get("ti_movement_kind") or {
			"Material Receipt": "Receive",
			"Material Issue": "Issue",
			"Material Transfer": "Transfer",
		}.get(doc.purpose)
	else:
		kind = {"Opening Stock": "Opening", "Stock Reconciliation": "Reconcile"}.get(doc.purpose)
	data = doc.as_dict()
	if doc.doctype == "Stock Reconciliation":
		for original, line in zip(doc.get("items"), data["items"], strict=True):
			line["recorded_count_allocations"] = reconciliation_allocations(
				original,
				batch_checker=check_batch,
				bundle_cache=bundle_cache,
				bundle_loader=load_bundle,
			)
	# The sample seeder discards responses, so it skips their display lookups.
	if doc.doctype in ("Stock Entry", "Stock Reconciliation") and not frappe.flags.ti_sample_seeding:
		display_rows = list(data.get("items", []))
		if doc.doctype == "Stock Reconciliation":
			display_rows += list(data.get("ti_count_review", []))
		item_codes = sorted({line.get("item_code") for line in display_rows if line.get("item_code")})
		from temple_inventory.catalog import item_display_summaries

		item_metadata = item_display_summaries(item_codes)
		batch_metadata = {}

		def get_batch(name):
			if name not in batch_metadata:
				batch_metadata[name] = (
					frappe.db.get_value("Batch", name, ["expiry_date", "manufacturing_date"], as_dict=True)
					or frappe._dict()
				)
			return batch_metadata[name]

		for line in display_rows:
			metadata = item_metadata.get(line.get("item_code"), {})
			line["ti_display_item_name"] = metadata.get("item_name", "")
			line["ti_display_image"] = metadata.get("image", "")
			if doc.doctype == "Stock Entry" or doc.purpose == "Opening Stock":
				line["ti_display_tracks_batch"] = bool(metadata.get("has_batch_no"))
				line["ti_display_tracks_expiry"] = bool(metadata.get("has_expiry_date"))
				line["ti_display_tracks_serial"] = bool(metadata.get("has_serial_no"))
				line["ti_display_serial_no_series"] = metadata.get("serial_no_series", "")
				if doc.purpose == "Opening Stock" and line.get("batch_no"):
					batch = get_batch(line["batch_no"])
					line["ti_display_expiry_date"] = str(batch.expiry_date or "")
					line["ti_display_manufacturing_date"] = str(batch.manufacturing_date or "")
		for original, line in zip(doc.get("items"), data["items"], strict=True):
			if doc.doctype != "Stock Entry":
				continue
			bundle = entry_bundle(
				original,
				batch_checker=check_batch,
				bundle_cache=bundle_cache,
				bundle_loader=load_bundle,
			)
			line["serials"] = []
			if bundle:
				line["serials"] = [entry.serial_no for entry in bundle.entries if entry.serial_no]
			elif original.get("serial_no"):
				line["serials"] = [
					serial.strip()
					for serial in original.serial_no.replace(",", "\n").splitlines()
					if serial.strip()
				]
			if bundle:
				line["recorded_bundle"] = bundle.name
				line["recorded_batch_allocations"] = []
				for allocation in bundle.entries:
					batch = get_batch(allocation.batch_no) if allocation.batch_no else None
					line["recorded_batch_allocations"].append(
						{
							"name": allocation.name,
							"batch_no": allocation.batch_no,
							"stock_qty": abs(allocation.qty),
							"expiry_date": str(batch.expiry_date or "") if batch else "",
							"manufacturing_date": str(batch.manufacturing_date or "") if batch else "",
						}
					)
			elif line.get("batch_no"):
				batch = get_batch(line.batch_no)
				line["recorded_batch_allocations"] = [
					{
						"name": "",
						"batch_no": line.batch_no,
						"stock_qty": abs(line.transfer_qty or line.qty),
						"expiry_date": str(batch.expiry_date or "") if batch else "",
						"manufacturing_date": str(batch.manufacturing_date or "") if batch else "",
					}
				]
	permissions = {
		ptype: doc.has_permission(ptype) for ptype in ("write", "submit", "cancel", "amend", "delete")
	}
	permissions["create"] = frappe.has_permission(doc.doctype, "create")
	editable = bool(doc.docstatus == 0 and kind and permissions["write"])
	queue_error = ""
	if (
		doc.doctype == "Stock Reconciliation"
		and doc.docstatus == 0
		and len(doc.get("items", [])) > QUEUED_ROW_THRESHOLD
	):
		failure_prefix = frappe._("Action Failed")
		comments = frappe.get_all(
			"Comment",
			filters={
				"reference_doctype": "Stock Reconciliation",
				"reference_name": doc.name,
				"comment_type": "Comment",
				"content": ["like", f"{failure_prefix}%"],
			},
			fields=["content"],
			order_by="creation desc",
			limit_page_length=1,
		)
		if comments and comments[0].content.startswith(failure_prefix):
			content = comments[0].content[len(failure_prefix) :]
			if any(
				marker in content
				for marker in (
					"QueryDeadlockError",
					"QueryTimeoutError",
					"Record has changed since last read",
					"Lock wait timeout",
				)
			):
				queue_error = "后台确认与另一项库存操作发生冲突，未作任何更改，请重新确认。"
			elif "Traceback (most recent call last)" in content:
				queue_error = "后台操作失败，未作任何更改，请重试或联系管理员。"
			else:
				queue_error = re.sub(r"<[^>]*>", "", content).strip()
	data.update(
		{
			"identity": {"doctype": doc.doctype, "name": doc.name},
			"version": str(doc.modified),
			"kind": kind,
			"editable": editable,
			"queued": bool(getattr(doc, "is_locked", False)),
			"queue_error": queue_error,
			"actions": {
				"edit": editable,
				"submit": bool(doc.docstatus == 0 and kind and permissions["submit"]),
				"cancel": bool(doc.docstatus == 1 and kind and permissions["cancel"]),
				"amend": bool(doc.docstatus == 2 and kind and permissions["amend"] and permissions["create"]),
				"delete": bool(doc.docstatus == 0 and kind and permissions["delete"]),
				"duplicate": bool(
					doc.doctype == "Stock Entry" and kind and kind != "Opening" and permissions["create"]
				),
				"attach": bool(doc.docstatus != 2 and permissions["write"]),
				"remove_attachment": bool(
					(doc.docstatus == 0 and permissions["write"])
					or (doc.docstatus == 1 and permissions["cancel"])
				),
			},
		}
	)
	return data


@frappe.whitelist()
def load_document(doctype, name):
	require_app()
	return serialize(frappe.get_doc(_identity(doctype), name))


@frappe.whitelist(methods=["POST"])
@retry_native_request
def create_document(doctype, request_id, data):
	require_app()
	doctype = _identity(doctype)
	key = _request_key(doctype, request_id)
	# Lock the account before testing absence. The native unique field is an
	# additional DB constraint, including callers outside this endpoint.
	frappe.get_doc("User", frappe.session.user, for_update=True)
	existing = frappe.db.get_value(doctype, {"ti_request_key": key}, "name", for_update=True)
	if existing:
		return serialize(frappe.get_doc(doctype, existing))
	doc = frappe.new_doc(doctype)
	doc.check_permission("create")
	doc.ti_request_key = key
	doc.ti_request_user = frappe.session.user
	_apply(doc, frappe.parse_json(data))
	doc.insert()
	return serialize(doc)


@frappe.whitelist(methods=["POST"])
@retry_native_request
def save_document(doctype, name, version, data):
	require_app()
	doc = load_locked(_identity(doctype), name, version)
	check_document_scope(doc)
	_require_supported_edit(doc)
	if doc.docstatus != 0:
		frappe.throw("此记录已完成或取消，请保留输入并重新载入")
	_apply(doc, frappe.parse_json(data))
	doc.save()
	return serialize(doc)


@frappe.whitelist(methods=["POST"])
@retry_native_request
def submit_document(doctype, name, version):
	require_app()
	doc = frappe.get_doc(_identity(doctype), name, for_update=True)
	doc.check_permission("submit")
	check_document_scope(doc)
	if doc.docstatus == 1 and doc.get("ti_confirmation_version") == str(version):
		return serialize(doc)
	check_version(doc, version)
	_require_supported_edit(doc)
	if doc.docstatus != 0:
		frappe.throw("只能确认草稿")
	doc.ti_confirmation_version = str(version)
	if doc.doctype == "Stock Entry" and not doc.get("ti_movement_kind"):
		doc.ti_movement_kind = {
			"Material Receipt": "Receive",
			"Material Issue": "Issue",
			"Material Transfer": "Transfer",
		}[doc.purpose]
	if doc.get("ti_time_mode") == "Current":
		current = frappe.utils.now_datetime()
		doc.posting_date, doc.posting_time = current.date(), current.time()
		doc.set_posting_time = 1
	if len(doc.get("items") or []) > QUEUED_ROW_THRESHOLD and doc.doctype == "Stock Reconciliation":
		frappe.db.set_value(
			doc.doctype,
			doc.name,
			{
				"ti_confirmation_version": str(version),
				"posting_date": doc.posting_date,
				"posting_time": doc.posting_time,
				"set_posting_time": 1,
			},
			update_modified=False,
		)
	if doc.doctype == "Stock Reconciliation" and len(doc.get("items") or []) > QUEUED_ROW_THRESHOLD:
		_enqueue_queued_action(doc, "submit", frappe.session.user)
		return serialize(doc)
	doc.submit()
	return serialize(doc)


def _enqueue_queued_action(doc, action, user):
	from frappe.model.document import Document
	from frappe.utils.background_jobs import enqueue

	timeout = 4600 if action == "submit" else 2000
	doc.check_if_locked()
	Document.lock(doc)
	return enqueue(
		"temple_inventory.native_api.run_queued_action",
		doctype=doc.doctype,
		name=doc.name,
		action=action,
		queued_by=user,
		timeout=timeout,
		enqueue_after_commit=True,
	)


def run_queued_action(doctype, name, action, queued_by):
	"""Run a queued count action as its initiating user, retrying fresh documents."""
	if doctype != "Stock Reconciliation" or action not in ("submit", "cancel"):
		frappe.throw("不支持的后台操作")
	previous_user = frappe.session.user
	frappe.set_user(queued_by)
	frappe.local.user_perms = None
	frappe.local.role_permissions = {}
	from frappe.model.document import Document

	doc = frappe.get_doc(doctype, name)
	Document.unlock(doc)
	try:

		def attempt():
			frappe.local.inventory_cache_revision_touched = False
			document = frappe.get_doc(doctype, name)
			document.check_permission(action)
			getattr(document, f"_{action}")()
			return document

		doc = retry_native_job(attempt)
	except Exception:
		frappe.db.rollback()
		if frappe.message_log:
			message = frappe.message_log[-1].get("message")
		else:
			message = "<pre><code>" + frappe.get_traceback() + "</pre></code>"
		doc.add_comment("Comment", frappe._("Action Failed") + "<br><br>" + message)
	finally:
		doc.notify_update()
		frappe.local.inventory_cache_revision_touched = False
		frappe.set_user(previous_user)
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}


@frappe.whitelist(methods=["POST"])
@retry_native_request
def delete_document(doctype, name, version):
	require_app()
	doc = load_locked(_identity(doctype), name, version, "delete")
	check_document_scope(doc)
	_require_supported_edit(doc)
	if doc.docstatus != 0:
		frappe.throw("只能删除草稿")
	doc.delete()
	return {"deleted": True, "doctype": doctype, "name": name}


@frappe.whitelist(methods=["POST"])
@retry_native_request
def cancel_document(doctype, name, version):
	require_app()
	doc = load_locked(_identity(doctype), name, version, "cancel")
	check_document_scope(doc)
	_require_supported_edit(doc)
	if doc.docstatus != 1:
		frappe.throw("只能取消已提交记录")
	if doc.doctype == "Stock Reconciliation" and len(doc.get("items") or []) > QUEUED_ROW_THRESHOLD:
		_enqueue_queued_action(doc, "cancel", frappe.session.user)
		return serialize(doc)
	doc.cancel()
	return serialize(doc)


@frappe.whitelist(methods=["POST"])
@retry_native_request
def duplicate_document(doctype, name, version, request_id):
	"""Copy a readable native movement without changing reusable Item conversions."""
	require_app()
	if doctype != "Stock Entry":
		frappe.throw("盘点需要重新核对当前账面基准，不能复制旧盘点")
	original = load_locked(doctype, name, version, "read")
	check_document_scope(original)
	_require_supported_edit(original)
	frappe.has_permission(doctype, "create", throw=True)
	frappe.get_doc("User", frappe.session.user, for_update=True)
	key = _request_key(doctype, request_id)
	existing = frappe.db.get_value(doctype, {"ti_request_key": key}, "name", for_update=True)
	if existing:
		return serialize(frappe.get_doc(doctype, existing))
	copied = frappe.copy_doc(original, ignore_no_copy=False)
	copied.docstatus = 0
	copied.amended_from = None
	copied.ti_confirmation_version = None
	copied.ti_request_key, copied.ti_request_user = key, frappe.session.user
	current = frappe.utils.now_datetime()
	copied.posting_date, copied.posting_time = current.date(), current.time()
	copied.set_posting_time = 1
	copied.ti_time_mode = "Manual"
	if not copied.ti_movement_kind:
		copied.ti_movement_kind = serialize(original)["kind"]
	_copy_zero_valuation_allowance(original, copied)
	_copy_entry_batches(original, copied)
	with preserve_copied_conversions(original, copied):
		copied.insert()
	return serialize(copied)


@frappe.whitelist(methods=["POST"])
@retry_native_request
def amend_document(doctype, name, version, request_id):
	require_app()
	doc = load_locked(_identity(doctype), name, version, "read")
	check_document_scope(doc)
	_require_supported_edit(doc)
	if doc.docstatus != 2:
		frappe.throw("只能修订已取消记录")
	frappe.has_permission(doctype, "amend", doc=doc, throw=True)
	frappe.get_doc("User", frappe.session.user, for_update=True)
	key = _request_key(doctype, request_id)
	existing = frappe.db.get_value(doctype, {"ti_request_key": key}, "name", for_update=True)
	if existing:
		return serialize(frappe.get_doc(doctype, existing))
	amended = frappe.copy_doc(doc, ignore_no_copy=doctype != "Stock Entry")
	amended.docstatus = 0
	amended.posting_date, amended.posting_time = doc.posting_date, doc.posting_time
	amended.set_posting_time = 1
	amended.amended_from = doc.name
	amended.ti_request_key = key
	amended.ti_request_user = frappe.session.user
	amended.check_permission("create")
	if doctype == "Stock Entry":
		_copy_zero_valuation_allowance(doc, amended)
		_copy_entry_batches(doc, amended)
	elif doc.purpose == "Opening Stock":
		_copy_opening_allocations(doc, amended)
	amended.insert()
	return serialize(amended)


def _copy_zero_valuation_allowance(original, copied):
	"""Restore the no-copy allowance for each matching copied Stock Entry row."""
	for previous, row in zip(original.get("items"), copied.get("items"), strict=True):
		row.allow_zero_valuation_rate = previous.allow_zero_valuation_rate


def _copy_opening_allocations(original, copied):
	"""Restore serials and batch identities retained by cancelled native bundles."""
	from temple_inventory.native_balances import reconciliation_serial_allocations

	for previous, row in zip(original.get("items"), copied.get("items"), strict=True):
		item = frappe.get_cached_value("Item", row.item_code, ["has_batch_no", "has_serial_no"], as_dict=True)
		row.use_serial_batch_fields = 1
		row.serial_and_batch_bundle = None
		if item.has_serial_no:
			allocations = reconciliation_serial_allocations(previous)
			serials = allocations.get("actual_serials") or []
			if not serials and previous.get("serial_no"):
				serials = [
					value.strip()
					for value in previous.serial_no.replace(",", "\n").splitlines()
					if value.strip()
				]
			row.serial_no = "\n".join(serials)
		elif item.has_batch_no:
			bundle = entry_bundle(previous)
			batches = sorted({entry.batch_no for entry in bundle.entries if entry.batch_no}) if bundle else []
			row.batch_no = batches[0] if len(batches) == 1 else previous.batch_no


def _copy_entry_batches(original, copied):
	"""Copy native allocations, never reuse a cancelled voucher's bundle.

	ERPNext detaches the bundle link when cancelling. The native bundle still
	retains its exact voucher/child/warehouse identity; no batch is guessed from
	current stock or Item defaults.
	"""
	for previous, row in zip(original.get("items"), copied.get("items"), strict=True):
		item = frappe.get_doc("Item", row.item_code)
		if item.has_serial_no:
			if not row.s_warehouse:
				row.serial_no = None
				row.serial_and_batch_bundle = None
				row.use_serial_batch_fields = 1
			else:
				bundle = entry_bundle(previous)
				serials = [entry.serial_no for entry in bundle.entries if entry.serial_no] if bundle else []
				if not serials and previous.get("serial_no"):
					serials = [
						value.strip()
						for value in previous.serial_no.replace(",", "\n").splitlines()
						if value.strip()
					]
				row.serial_no = "\n".join(serials)
				row.serial_and_batch_bundle = None
				row.use_serial_batch_fields = 1
			continue
		if not item.has_batch_no:
			continue
		warehouse = row.s_warehouse or row.t_warehouse
		bundle = entry_bundle(previous)
		if not bundle:
			if not previous.batch_no:
				frappe.throw("原明细缺少可核对的批次明细，请在 ERPNext 中处理")
			frappe.get_doc("Batch", previous.batch_no).check_permission("read")
			row.batch_no, row.use_serial_batch_fields = previous.batch_no, 1
			continue
		new_bundle = frappe.copy_doc(bundle, ignore_no_copy=False)
		new_bundle.docstatus = 0
		new_bundle.is_cancelled = 0
		new_bundle.voucher_type = copied.doctype
		new_bundle.warehouse = warehouse
		new_bundle.type_of_transaction = "Outward" if row.s_warehouse else "Inward"
		new_bundle.posting_datetime = frappe.utils.get_datetime(
			f"{copied.posting_date} {copied.posting_time}"
		)
		for entry in new_bundle.entries:
			entry.qty = abs(entry.qty) * (-1 if row.s_warehouse else 1)
			entry.is_cancelled = 0
		new_bundle.insert()
		row.serial_and_batch_bundle = new_bundle.name
		row.batch_no, row.use_serial_batch_fields = None, 0


@frappe.whitelist()
def loan_detail(name):
	require_app()
	loan = frappe.get_doc("Stock Entry", name)
	data = serialize(loan)
	if loan.ti_movement_kind != "Loan":
		frappe.throw("此记录不是借出记录")
	data["balance_at"] = str(frappe.utils.now_datetime())
	data["activity_title"] = ""
	if loan.ti_activity:
		activity = frappe.get_doc("Inventory Activity", loan.ti_activity)
		if activity.has_permission("read"):
			data["activity_title"] = activity.title
	balance_views = loan_balances_many([name], views=True)[name]
	balances = balance_views["quantity"]
	batch_balances = balance_views["batch"]
	serial_balances = balance_views["serial"]
	for row in data["items"]:
		outcomes = balances[row.name]
		serial_outcomes = serial_balances[row.name]
		lent_serials = list(row.get("serials") or [])
		settled_serials = set().union(*serial_outcomes.values()) if serial_outcomes else set()
		row["outcomes"] = {key: float(value) for key, value in outcomes.items()}
		row["outstanding_qty"] = (
			float(row.transfer_qty) - float(sum(outcomes.values())) if loan.docstatus == 1 else 0
		)
		row["allocations"] = [
			{
				"batch_no": batch,
				"borrowed_qty": float(quantity),
				"outcomes": {key: float(value) for key, value in batch_balances[(row.name, batch)].items()},
				"outstanding_qty": float(quantity - sum(batch_balances[(row.name, batch)].values()))
				if loan.docstatus == 1
				else 0,
			}
			for batch, quantity in batch_quantities(row).items()
		]
		row["lent_serials"] = lent_serials
		row["settled_serials"] = {
			key: sorted(serial_outcomes.get(key, set())) for key in ("Returned", "Damaged", "Lost")
		}
		row["outstanding_serials"] = (
			sorted(set(lent_serials) - settled_serials) if loan.docstatus == 1 else []
		)
	return data


@frappe.whitelist()
def outstanding_loan_groups(search="", start=0, page_length=30):
	"""Return permission-scoped summaries for borrowers with outstanding loans."""
	require_app()
	start, page_length = max(0, cint(start)), min(50, max(1, cint(page_length)))
	query = (search or "").strip()
	activity_names = (
		frappe.get_list(
			"Inventory Activity",
			filters={"title": ["like", f"%{query}%"]},
			fields=["name"],
			limit_page_length=100,
			pluck="name",
		)
		if query
		else []
	)
	or_filters = (
		[
			{"ti_borrower": ["like", f"%{query}%"]},
			{"name": ["like", f"%{query}%"]},
			*([{"ti_activity": ["in", activity_names]}] if activity_names else []),
		]
		if query
		else None
	)
	loan_rows = frappe.get_list(
		"Stock Entry",
		filters={"docstatus": 1, "ti_movement_kind": "Loan"},
		or_filters=or_filters,
		fields=["name", "posting_date", "ti_borrower"],
		order_by="posting_date desc, modified desc",
		limit_page_length=0,
	)
	if _stock_entry_needs_document_check():
		loan_rows = [row for row in loan_rows if frappe.has_permission("Stock Entry", "read", doc=row.name)]
	if not loan_rows:
		return {"rows": [], "next": None}
	loan_names = [row.name for row in loan_rows]
	name_placeholders = ", ".join(["%s"] * len(loan_names))
	originals = frappe.get_all(
		"Stock Entry Detail",
		filters={"parent": ["in", loan_names], "parenttype": "Stock Entry", "parentfield": "items"},
		fields=["name", "parent", "item_code", "transfer_qty"],
	)
	settlements = frappe.db.sql(
		f"""
		select original.parent as loan_name, original.name as original_line,
		       sum(line.transfer_qty) as settled_qty
		from `tabStock Entry Detail` line
		join `tabStock Entry` parent on parent.name = line.parent
		join `tabStock Entry Detail` original on original.name = line.ti_original_loan_line
		join `tabStock Entry` loan on loan.name = original.parent
		where line.ti_original_loan in ({name_placeholders}) and parent.docstatus = 1
		  and loan.name = line.ti_original_loan and loan.docstatus = 1
		  and loan.ti_movement_kind = 'Loan' and loan.company = parent.company
		  and original.item_code = line.item_code and original.t_warehouse = line.s_warehouse
		  and ((parent.ti_movement_kind = 'Return' and parent.purpose = 'Material Transfer'
		        and line.ti_settlement_outcome in ('Returned', 'Damaged'))
		    or (parent.ti_movement_kind = 'Damage' and parent.purpose = 'Material Transfer'
		        and line.ti_settlement_outcome = 'Damaged')
		    or (parent.ti_movement_kind = 'Loss' and parent.purpose = 'Material Issue'
		        and line.ti_settlement_outcome = 'Lost'))
		group by original.parent, original.name
		""",
		loan_names,
		as_dict=True,
	)
	settled = {(row.loan_name, row.original_line): float(row.settled_qty or 0) for row in settlements}
	item_codes = list({row.item_code for row in originals})
	visible_items = (
		set(
			frappe.get_list(
				"Item",
				filters={"name": ["in", item_codes]},
				fields=["name"],
				limit_page_length=0,
				pluck="name",
			)
		)
		if item_codes
		else set()
	)
	by_loan = {}
	for line in originals:
		if (
			line.item_code in visible_items
			and float(line.transfer_qty or 0) - settled.get((line.parent, line.name), 0) > 0
		):
			by_loan.setdefault(line.parent, set()).add(line.item_code)
	groups = {}
	for row in loan_rows:
		items = by_loan.get(row.name)
		if not items:
			continue
		borrower = row.ti_borrower or ""
		group = groups.setdefault(
			borrower,
			{"borrower": borrower, "loan_count": 0, "item_count": 0, "latest_date": str(row.posting_date)},
		)
		group["loan_count"] += 1
		group["item_count"] += len(items)
		group["latest_date"] = max(group["latest_date"], str(row.posting_date))
	ordered = sorted(groups.values(), key=lambda row: (row["latest_date"], row["borrower"]), reverse=True)
	page = ordered[start : start + page_length]
	return {"rows": page, "next": start + len(page) if start + len(page) < len(ordered) else None}


@frappe.whitelist()
def outstanding_loans(search="", borrower=None, start=0, page_length=10):
	"""List readable submitted loans with outstanding lines for the return editor."""
	require_app()
	start, page_length = max(0, cint(start)), min(20, max(1, cint(page_length)))
	filters = {"docstatus": 1, "ti_movement_kind": "Loan"}
	if borrower is not None:
		filters["ti_borrower"] = borrower
	query = (search or "").strip()
	activity_names = (
		frappe.get_list(
			"Inventory Activity",
			filters={"title": ["like", f"%{query}%"]},
			fields=["name"],
			limit_page_length=100,
			pluck="name",
		)
		if query and query.casefold() not in str(borrower or "").casefold()
		else []
	)
	or_filters = None
	if query and query.casefold() not in str(borrower or "").casefold():
		or_filters = [{"name": ["like", f"%{query}%"]}]
		if activity_names:
			or_filters.append({"ti_activity": ["in", activity_names]})
	rows = frappe.get_list(
		"Stock Entry",
		filters=filters,
		or_filters=or_filters
		if borrower is not None
		else (
			[
				{"ti_borrower": ["like", f"%{query}%"]},
				{"name": ["like", f"%{query}%"]},
				*([{"ti_activity": ["in", activity_names]}] if activity_names else []),
			]
			if query
			else None
		),
		fields=["name", "posting_date", "ti_borrower", "ti_activity"],
		order_by="posting_date desc, modified desc",
		start=start,
		page_length=page_length,
	)
	rows = [row for row in rows if frappe.has_permission("Stock Entry", "read", doc=row.name)]
	if not rows:
		return {"rows": [], "next": None}
	from temple_inventory.native_access import check_document_scope

	readable_rows = []
	for row in rows:
		loan = frappe.get_doc("Stock Entry", row.name)
		if not loan.has_permission("read"):
			continue
		check_document_scope(loan)
		readable_rows.append(row)
	rows = readable_rows
	if not rows:
		return {"rows": [], "next": None}
	loan_names = [row.name for row in rows]
	lines = frappe.get_all(
		"Stock Entry Detail",
		filters={"parent": ["in", loan_names], "parenttype": "Stock Entry", "parentfield": "items"},
		fields=["name", "parent", "item_code", "transfer_qty"],
		order_by="parent, idx asc",
	)
	item_codes = sorted({line.item_code for line in lines if line.item_code})
	items = frappe.get_list(
		"Item",
		filters={"name": ["in", item_codes or [""]]},
		fields=["name", "item_name", "stock_uom", "image"],
		limit_page_length=0,
	)
	if _doctype_needs_document_check("Item"):
		items = [item for item in items if frappe.has_permission("Item", "read", doc=item.name)]
	visible_items = {item.name: item for item in items}
	from temple_inventory.catalog import _image

	item_images = {name: _image(item)[0] for name, item in visible_items.items()}
	balance_views = loan_balances_many(loan_names, views=True)
	activity_titles = {}
	activity_names = sorted({row.ti_activity for row in rows if row.ti_activity})
	if activity_names:
		if _doctype_needs_document_check("Inventory Activity"):
			for activity_name in activity_names:
				activity = frappe.get_doc("Inventory Activity", activity_name)
				if activity.has_permission("read"):
					activity_titles[activity_name] = activity.title
		else:
			activity_titles = {
				row.name: row.title
				for row in frappe.get_list(
					"Inventory Activity",
					filters={"name": ["in", activity_names]},
					fields=["name", "title"],
					limit_page_length=0,
				)
			}
	lines_by_loan = {}
	for line in lines:
		if line.item_code in visible_items:
			quantity_outcomes = balance_views[line.parent]["quantity"][line.name]
			quantity = float(line.transfer_qty or 0) - float(sum(quantity_outcomes.values()))
			if quantity > 0:
				item = visible_items[line.item_code]
				lines_by_loan.setdefault(line.parent, []).append(
					{
						"code": item.name,
						"name": item.item_name,
						"image": item_images.get(item.name, ""),
						"uom": item.stock_uom,
						"quantity": quantity,
					}
				)
	results = []
	for row in rows:
		loan_items = lines_by_loan.get(row.name, [])
		if loan_items:
			results.append(
				{
					"name": row.name,
					"date": str(row.posting_date),
					"borrower": row.ti_borrower or "",
					"activity": activity_titles.get(row.ti_activity, ""),
					"items": loan_items,
				}
			)
	return {"rows": results, "next": start + len(rows) if len(rows) == page_length else None}


@frappe.whitelist()
def editor_clock():
	require_app()
	return {"timestamp": str(frappe.utils.now_datetime())}
