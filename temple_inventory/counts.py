"""Physical review context on native reconciliations, with native ledger baselines."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import hashlib
import json
from decimal import Decimal

import frappe
from frappe.utils import get_datetime

from temple_inventory.activities import validate_assignment
from temple_inventory.native_access import (
	check_company,
	check_document_scope,
	check_item,
	require_app,
	retry_native_request,
)
from temple_inventory.native_balances import batch_balances, lock_stock_locations, stock_balance
from temple_inventory.native_stock import (
	number,
	validate_precision,
	validate_request_identity,
	warehouse_scopes,
)


def _key(row):
	return row.get("item_code"), row.get("warehouse"), row.get("batch_no") or ""


def _baseline(warehouse, timestamp, scope, item_codes=None, *, lock=False):
	_settings, _visible, physical, _leased, _damaged = warehouse_scopes()
	if warehouse not in physical:
		frappe.throw("请选择有权限的实体末级盘点位置", frappe.PermissionError)
	frappe.get_doc("Warehouse", warehouse).check_permission("read")
	if scope not in ("Selected", "Full Location"):
		frappe.throw("请选择有效的盘点范围")
	posting = get_datetime(timestamp)
	if not timestamp:
		frappe.throw("请选择盘点基准时间")
	selected = sorted(set(frappe.parse_json(item_codes) or []))
	if scope == "Selected":
		if not selected:
			frappe.throw("请选择盘点物品")
		for code in selected:
			check_item(code)
	else:
		# Scope is a single authorized warehouse; filter Item metadata before exposing rows.
		candidates = frappe.db.sql(
			"""select distinct item_code from `tabStock Ledger Entry`
			where warehouse = %s and is_cancelled = 0
			and timestamp(posting_date, posting_time) <= %s order by item_code"""
			+ (" for update" if lock else ""),
			(warehouse, posting),
			pluck=True,
		)
		if lock:
			selected = [
				code
				for code in candidates
				if frappe.get_doc("Item", code, for_update=True).has_permission("read")
			]
		else:
			selected = frappe.get_list(
				"Item", filters={"name": ["in", candidates or [""]]}, pluck="name", limit_page_length=0
			)
	rows = []
	for code in sorted(selected):
		item = check_item(code, lock=lock)
		if item.has_serial_no:
			frappe.throw("物资管理暂不支持序列号盘点")
		if item.has_batch_no:
			quantities = batch_balances(
				code, warehouse, str(posting), lock=lock, include_zero=scope == "Selected"
			)
			quantities = [
				(row.get("batch_no"), row.get("qty"))
				for row in quantities
				if row.get("batch_no") and (row.get("qty") or scope == "Selected")
			]
		else:
			quantity = stock_balance(code, warehouse, str(posting), lock=lock)
			quantities = [(None, quantity)] if quantity or scope == "Selected" else []
		for batch, quantity in quantities:
			if batch:
				frappe.get_doc("Batch", batch).check_permission("read")
			rows.append(
				{
					"item_code": code,
					"warehouse": warehouse,
					"batch_no": batch,
					"stock_uom": item.stock_uom,
					"baseline_qty": float(quantity),
					"actual_qty": None,
					"review_state": "Unreviewed",
					"reason": "",
				}
			)
	canonical = [(row["item_code"], row["batch_no"], row["baseline_qty"]) for row in rows]
	fingerprint = hashlib.sha256(
		json.dumps([warehouse, str(posting), scope, canonical], ensure_ascii=False).encode()
	).hexdigest()
	return {"rows": rows, "fingerprint": fingerprint, "timestamp": str(posting)}


@frappe.whitelist()
def count_baseline(warehouse, timestamp, scope="Full Location", item_codes=None, previous_rows=None):
	require_app()
	if not frappe.has_permission("Stock Reconciliation", "create") and not frappe.has_permission(
		"Stock Reconciliation", "write"
	):
		frappe.throw("没有创建或编辑盘点的权限", frappe.PermissionError)
	result = _baseline(warehouse, timestamp, scope, item_codes)
	previous = {_key(row): row for row in (frappe.parse_json(previous_rows) or [])}
	for row in result["rows"]:
		old = previous.get(_key(row))
		if not old:
			row["needs_review"] = True
			continue
		row.update({"actual_qty": old.get("actual_qty"), "reason": old.get("reason", "")})
		changed = Decimal(str(old.get("baseline_qty"))) != Decimal(str(row["baseline_qty"]))
		row["needs_review"] = changed
		row["review_state"] = "Unreviewed" if changed else old.get("review_state", "Unreviewed")
	result["removed_rows"] = [
		row for key, row in previous.items() if key not in {_key(r) for r in result["rows"]}
	]
	return result


def _differences(review_rows, baseline_rows):
	precision = frappe.get_precision("Stock Reconciliation Item", "qty")
	baseline = {_key(row): row for row in baseline_rows}
	seen = set()
	differences = []
	reviewed = 0
	for row in review_rows:
		key = _key(row)
		if key in seen or key not in baseline:
			frappe.throw("盘点明细与最新账面范围不一致，请刷新并重新核对", frappe.TimestampMismatchError)
		seen.add(key)
		book = baseline[key]
		row["stock_uom"] = book["stock_uom"]
		if Decimal(str(row.get("baseline_qty"))) != Decimal(str(book["baseline_qty"])):
			frappe.throw("账面数量已变化，请刷新并重新核对", frappe.TimestampMismatchError)
		state = row.get("review_state")
		if state == "Unreviewed":
			row["difference"] = 0
			continue
		if state not in ("Reviewed", "Not Found") or row.get("actual_qty") in (None, ""):
			frappe.throw("请明确填写实点数量或选择未找到")
		reviewed += 1
		actual = number(row.get("actual_qty"), "实点数量", allow_zero=True)
		if state == "Not Found" and actual:
			frappe.throw("未找到的实点数量必须为零")
		validate_precision(actual, precision, "实点数量")
		if frappe.get_cached_value("UOM", book["stock_uom"], "must_be_whole_number"):
			if actual != actual.to_integral_value():
				frappe.throw("库存单位要求整数实点数量")
		difference = actual - Decimal(str(book["baseline_qty"]))
		row["difference"] = float(difference)
		if difference:
			if not (row.get("reason") or "").strip():
				frappe.throw("请填写盘点差异原因")
			differences.append({**book, "qty": float(actual)})
	if seen != set(baseline):
		frappe.throw("盘点范围中有新增或移除的明细，请刷新并重新核对", frappe.TimestampMismatchError)
	if not reviewed:
		frappe.throw("请至少核对一条明细")
	return differences


@frappe.whitelist(methods=["POST"])
@retry_native_request
def save_count(request_id, data, name=None, version=None):
	from temple_inventory import native_api

	require_app()
	data = frappe.parse_json(data)
	if not isinstance(data, dict):
		frappe.throw("盘点内容无效")
	existing = None
	if name:
		existing = native_api.load_locked("Stock Reconciliation", name, version)
		check_document_scope(existing)
		if existing.docstatus != 0:
			frappe.throw("盘点记录已完成或取消，请保留输入并重新载入")
	else:
		frappe.has_permission("Stock Reconciliation", "create", throw=True)
	# Matching counts must use the same current baseline and authorization checks
	# as adjustments. They still create no document.
	frappe.db.get_value("Warehouse", data.get("ti_count_warehouse"), "name", for_update=True)
	baseline = _baseline(
		data.get("ti_count_warehouse"),
		data.get("ti_baseline_timestamp"),
		data.get("ti_count_scope"),
		data.get("ti_count_items"),
		lock=True,
	)
	if data.get("ti_baseline_fingerprint") != baseline["fingerprint"]:
		frappe.throw("账面基准已变化，请刷新并重新核对", frappe.TimestampMismatchError)
	reviews = data.get("ti_count_review") or []
	differences = _differences(reviews, baseline["rows"])
	if not differences:
		# A saved native draft remains untouched; the UI offers explicit deletion.
		return {"no_adjustment": True, "existing_draft": name}
	data["items"] = [
		{
			"item_code": row["item_code"],
			"warehouse": row["warehouse"],
			"batch_no": row["batch_no"],
			"qty": row["qty"],
			"use_serial_batch_fields": 1,
		}
		for row in differences
	]
	# Match existing native rows rather than replacing their identity/unknown fields.
	if name:
		by_review_key = {_key(row): row.name for row in existing.ti_count_review}
		for row in data["ti_count_review"]:
			if not row.get("name") and _key(row) in by_review_key:
				row["name"] = by_review_key[_key(row)]
		by_key = {_key(row): row.name for row in existing.items}
		for row in data["items"]:
			if _key(row) in by_key:
				row["name"] = by_key[_key(row)]
		return native_api.save_document("Stock Reconciliation", name, version, data)
	return native_api.create_document("Stock Reconciliation", request_id, data)


def _native_values(doc):
	return [(_key(row), row.qty) for row in doc.items]


def before_validate(doc, method=None):
	lock_stock_locations(doc)
	validate_request_identity(doc)
	validate_assignment(doc)
	if not doc.get("ti_count_review"):
		return
	check_company(doc)
	previous = doc.get_doc_before_save()
	if previous and previous.get("ti_count_review"):
		from temple_inventory.native_api import REVIEW_FIELDS

		old_review = [{field: row.get(field) for field in REVIEW_FIELDS} for row in previous.ti_count_review]
		new_review = [{field: row.get(field) for field in REVIEW_FIELDS} for row in doc.ti_count_review]
		if old_review == new_review and _native_values(previous) != _native_values(doc):
			# Ordinary Desk edits invalidate custom review context instead of presenting
			# an earlier review as the result of the newly edited reconciliation.
			doc.set("ti_count_review", [])
			doc.ti_count_scope = None
			doc.ti_baseline_timestamp = None
			doc.ti_baseline_fingerprint = None
			return
	baseline = _baseline(
		doc.ti_count_warehouse, doc.ti_baseline_timestamp, doc.ti_count_scope, doc.ti_count_items, lock=True
	)
	if str(get_datetime(doc.ti_baseline_timestamp)) != str(
		get_datetime(f"{doc.posting_date} {doc.posting_time}")
	):
		frappe.throw("盘点基准时间必须与原生库存调整入账时间相同")
	if baseline["fingerprint"] != doc.ti_baseline_fingerprint:
		frappe.throw("账面基准已变化，请刷新并重新核对", frappe.TimestampMismatchError)
	review_dicts = [row.as_dict() for row in doc.ti_count_review]
	differences = _differences(review_dicts, baseline["rows"])
	for row, value in zip(doc.ti_count_review, review_dicts, strict=True):
		row.difference = value["difference"]
	actual = {_key(row): Decimal(str(row.qty)) for row in doc.items}
	expected = {_key(row): Decimal(str(row["qty"])) for row in differences}
	if not differences or len(actual) != len(doc.items) or actual != expected:
		frappe.throw("原生调整明细与已核对差异不一致，请重新核对")
