"""Versioned editing of ERPNext stock documents; no shadow server drafts."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import hashlib

import frappe

from temple_inventory.native_access import (
	NATIVE_DOCTYPES,
	check_document_scope,
	check_version,
	load_locked,
	require_app,
	retry_native_request,
)
from temple_inventory.native_balances import entry_bundle, reconciliation_allocations
from temple_inventory.native_stock import (
	MOVEMENT_PURPOSES,
	batch_quantities,
	loan_balances,
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
ENTRY_LINE_FIELDS = {
	"item_code",
	"qty",
	"uom",
	"conversion_factor",
	"s_warehouse",
	"t_warehouse",
	"batch_no",
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
COUNT_HEADER_FIELDS = {
	"ti_count_scope",
	"ti_baseline_timestamp",
	"ti_count_warehouses",
	"ti_count_items",
	"ti_baseline_fingerprint",
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


def _require_supported_edit(doc):
	if doc.doctype == "Stock Entry":
		if doc.purpose not in set(MOVEMENT_PURPOSES.values()):
			frappe.throw("此库存用途请在 ERPNext 中处理")
	elif doc.purpose != "Stock Reconciliation":
		frappe.throw("此库存调整用途请在 ERPNext 中处理")


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
	allowed = ENTRY_LINE_FIELDS if doc.doctype == "Stock Entry" else COUNT_LINE_FIELDS
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
	allowed = HEADER_FIELDS | (COUNT_HEADER_FIELDS if doc.doctype == "Stock Reconciliation" else set())
	if doc.doctype == "Stock Reconciliation":
		allowed.discard("remarks")
	for field in allowed:
		if field in data:
			value = data[field]
			if field in ("ti_count_items", "ti_count_warehouses") and not isinstance(value, str):
				value = frappe.as_json(value)
			doc.set(field, value)
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
	else:
		# A frontend count is an adjustment, never a fabricated opening or revaluation.
		if doc.is_new():
			doc.purpose = "Stock Reconciliation"
		else:
			_require_supported_edit(doc)


def serialize(doc):
	doc.check_permission("read")
	check_document_scope(doc)
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
			line["recorded_count_allocations"] = reconciliation_allocations(original)
	if doc.doctype in ("Stock Entry", "Stock Reconciliation"):
		display_rows = list(data.get("items", []))
		if doc.doctype == "Stock Reconciliation":
			display_rows += list(data.get("ti_count_review", []))
		item_codes = sorted({line.get("item_code") for line in display_rows if line.get("item_code")})
		from temple_inventory.catalog import item_display_summaries

		item_metadata = item_display_summaries(item_codes)
		for line in display_rows:
			metadata = item_metadata.get(line.get("item_code"), {})
			line["ti_display_item_name"] = metadata.get("item_name", "")
			line["ti_display_image"] = metadata.get("image", "")
			if doc.doctype == "Stock Entry":
				line["ti_display_tracks_batch"] = bool(metadata.get("has_batch_no"))
				line["ti_display_tracks_expiry"] = bool(metadata.get("has_expiry_date"))
		for original, line in zip(doc.get("items"), data["items"], strict=True):
			if doc.doctype != "Stock Entry":
				continue
			bundle = entry_bundle(original)
			if bundle:
				line["recorded_bundle"] = bundle.name
				line["recorded_batch_allocations"] = []
				for allocation in bundle.entries:
					batch = frappe.get_doc("Batch", allocation.batch_no) if allocation.batch_no else None
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
				batch = frappe.db.get_value(
					"Batch",
					line.batch_no,
					["expiry_date", "manufacturing_date"],
					as_dict=True,
				)
				line["recorded_batch_allocations"] = [
					{
						"name": "",
						"batch_no": line.batch_no,
						"stock_qty": abs(line.transfer_qty or line.qty),
						"expiry_date": str(batch.expiry_date or "") if batch else "",
						"manufacturing_date": str(batch.manufacturing_date or "") if batch else "",
					}
				]
	data.update(
		{
			"identity": {"doctype": doc.doctype, "name": doc.name},
			"version": str(doc.modified),
			"kind": kind,
			"permissions": {
				permission: bool(doc.has_permission(permission))
				for permission in ("write", "submit", "delete", "cancel", "amend")
			},
			"editable": bool(
				doc.docstatus == 0
				and kind
				and kind != "Opening"
				and frappe.has_permission(doc.doctype, "write", doc)
			),
		}
	)
	data["permissions"]["duplicate"] = bool(
		doc.doctype == "Stock Entry"
		and kind in MOVEMENT_PURPOSES
		and frappe.has_permission("Stock Entry", "create")
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
	if doc.doctype == "Stock Entry" and doc.get("ti_time_mode") == "Current":
		current = frappe.utils.now_datetime()
		doc.posting_date, doc.posting_time = current.date(), current.time()
		doc.set_posting_time = 1
	doc.submit()
	return serialize(doc)


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
		_copy_entry_batches(doc, amended)
	amended.insert()
	return serialize(amended)


def _copy_entry_batches(original, copied):
	"""Copy native allocations, never reuse a cancelled voucher's bundle.

	ERPNext detaches the bundle link when cancelling. The native bundle still
	retains its exact voucher/child/warehouse identity; no batch is guessed from
	current stock or Item defaults.
	"""
	for previous, row in zip(original.get("items"), copied.get("items"), strict=True):
		item = frappe.get_doc("Item", row.item_code)
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
	balances = loan_balances(name)
	batch_balances = loan_balances(name, by_batch=True)
	for row in data["items"]:
		outcomes = balances[row.name]
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
	return data


@frappe.whitelist()
def editor_clock():
	require_app()
	return {"timestamp": str(frappe.utils.now_datetime())}
