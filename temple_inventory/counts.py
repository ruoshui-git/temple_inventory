"""Physical review context on native reconciliations, with native ledger baselines."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

from decimal import Decimal

import frappe
from frappe.utils import get_datetime

from temple_inventory.activities import validate_assignment
from temple_inventory.native_access import (
	check_company,
	check_document_scope,
	require_app,
	retry_native_request,
)
from temple_inventory.native_balances import lock_stock_locations
from temple_inventory.native_stock import (
	number,
	validate_precision,
	validate_request_identity,
	warehouse_scopes,
)


def _key(row):
	return row.get("item_code"), row.get("warehouse"), row.get("batch_no") or ""


def _lock_count_locations():
	_settings, _visible, physical, _leased, _damaged = warehouse_scopes()
	warehouses = tuple(sorted(physical))
	if warehouses:
		frappe.db.sql(
			"""select name from `tabWarehouse` where name in %(warehouses)s
			order by name for update""",
			{"warehouses": warehouses},
		)


def _baseline(timestamp, *, lock=False, previous_rows=None):
	_settings, _visible, physical, _leased, _damaged = warehouse_scopes()
	warehouses = sorted(set(physical))
	if not warehouses:
		frappe.throw("没有可访问的实体末级盘点位置")
	readable_warehouses = set(
		frappe.get_list("Warehouse", filters={"name": ["in", warehouses]}, pluck="name")
	)
	if readable_warehouses != set(warehouses):
		frappe.throw("盘点位置包含无权访问的实体末级位置", frappe.PermissionError)
	posting = get_datetime(timestamp)
	if not timestamp:
		frappe.throw("请选择盘点时间")
	previous = {_key(row): row for row in (previous_rows or [])}
	added = {key[0] for key in previous}
	where_args = {"warehouses": tuple(warehouses), "posting": posting}
	ledger_rows = frappe.db.sql(
		"""select item_code, warehouse, sum(actual_qty) as qty
		from `tabStock Ledger Entry`
		where warehouse in %(warehouses)s and is_cancelled = 0 and docstatus = 1
		and posting_datetime <= %(posting)s and serial_and_batch_bundle is null
		and batch_no is null group by item_code, warehouse""",
		where_args,
		as_dict=True,
	)
	batch_rows = frappe.db.sql(
		"""select sle.item_code, sle.warehouse, sbe.batch_no, sum(sbe.qty) as qty
		from `tabStock Ledger Entry` sle
		inner join `tabSerial and Batch Entry` sbe on sbe.parent = sle.serial_and_batch_bundle
		where sle.warehouse in %(warehouses)s and sle.is_cancelled = 0 and sle.docstatus = 1
		and sle.posting_datetime <= %(posting)s and sle.serial_and_batch_bundle is not null
		and sbe.docstatus = 1 and sbe.is_cancelled = 0 and sbe.batch_no is not null
		group by sle.item_code, sle.warehouse, sbe.batch_no
		union all
		select item_code, warehouse, batch_no, sum(actual_qty) as qty
		from `tabStock Ledger Entry`
		where warehouse in %(warehouses)s and is_cancelled = 0 and docstatus = 1
		and posting_datetime <= %(posting)s and serial_and_batch_bundle is null
		and batch_no is not null group by item_code, warehouse, batch_no""",
		where_args,
		as_dict=True,
	)
	quantities = {}
	for entry in ledger_rows:
		quantities[(entry.item_code, entry.warehouse, "")] = float(entry.qty or 0)
	for entry in batch_rows:
		key = (entry.item_code, entry.warehouse, entry.batch_no or "")
		quantities[key] = quantities.get(key, 0) + float(entry.qty or 0)
	for key in previous:
		quantities.setdefault(key, 0)
	selected = sorted({key[0] for key, qty in quantities.items() if qty} | added)
	items = frappe.get_list(
		"Item",
		filters={"name": ["in", selected or [""]], "disabled": 0, "is_stock_item": 1},
		fields=["name", "item_name", "image", "stock_uom", "has_batch_no", "has_serial_no"],
		limit_page_length=0,
	)
	items_by_name = {row.name: row for row in items}
	from temple_inventory.catalog import item_display_summaries

	display_items = item_display_summaries(sorted(items_by_name))
	by_item = {}
	for (item_code, warehouse, batch), quantity in quantities.items():
		if quantity or (item_code, warehouse, batch) in previous:
			by_item.setdefault(item_code, []).append((warehouse, batch, quantity))
	rows = []
	for code in sorted(items_by_name):
		item = items_by_name[code]
		if item.has_serial_no:
			frappe.throw("物资管理暂不支持序列号盘点")
		display = display_items.get(code, {})
		for warehouse, batch, quantity in by_item.get(code, ()):
			if item.has_batch_no != bool(batch):
				continue
			rows.append(
				{
					"item_code": code,
					"item_name": display.get("item_name") or item.item_name,
					"image": display.get("image") or "",
					"warehouse": warehouse,
					"batch_no": batch or None,
					"stock_uom": item.stock_uom,
					"baseline_qty": float(quantity),
					"actual_qty": None,
					"review_state": "Unreviewed",
					"reason": "",
				}
			)
	batch_names = {row["batch_no"] for row in rows if row["batch_no"]}
	if batch_names:
		permitted = set(frappe.get_list("Batch", filters={"name": ["in", list(batch_names)]}, pluck="name"))
		if batch_names - permitted:
			frappe.throw("无权读取盘点批次", frappe.PermissionError)
	return {"rows": rows, "timestamp": str(posting), "warehouses": warehouses}


@frappe.whitelist()
def count_baseline(timestamp, previous_rows=None):
	require_app()
	if not frappe.has_permission("Stock Reconciliation", "create") and not frappe.has_permission(
		"Stock Reconciliation", "write"
	):
		frappe.throw("没有创建或编辑盘点的权限", frappe.PermissionError)
	result = _baseline(timestamp, previous_rows=frappe.parse_json(previous_rows) or [])
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
		state = row.get("review_state")
		if state == "Unreviewed":
			row["difference"] = 0
			continue
		if Decimal(str(row.get("baseline_qty"))) != Decimal(str(book["baseline_qty"])):
			frappe.throw("账面数量已变化，请刷新并重新核对", frappe.TimestampMismatchError)
		if state != "Reviewed" or row.get("actual_qty") in (None, ""):
			frappe.throw("请填写实点数量，或清空为未核对")
		reviewed += 1
		actual = number(row.get("actual_qty"), "实点数量", allow_zero=True)
		validate_precision(actual, precision, "实点数量")
		if frappe.get_cached_value("UOM", book["stock_uom"], "must_be_whole_number"):
			if actual != actual.to_integral_value():
				frappe.throw("库存单位要求整数实点数量")
		difference = actual - Decimal(str(book["baseline_qty"]))
		row["difference"] = float(difference)
		if difference:
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
	reviews = data.get("ti_count_review") or []
	_lock_count_locations()
	baseline = _baseline(
		f"{data.get('posting_date')} {data.get('posting_time')}",
		lock=True,
		previous_rows=reviews,
	)
	current = {_key(row): row for row in baseline["rows"]}
	stale = [
		row
		for row in reviews
		if row.get("review_state") == "Reviewed" and row.get("actual_qty") not in (None, "")
		if _key(row) in current
		and Decimal(str(row.get("baseline_qty") or 0)) != Decimal(str(current[_key(row)]["baseline_qty"]))
	]
	if stale:
		labels = "、".join(f"{row.get('item_code')}@{row.get('warehouse')}" for row in stale)
		frappe.throw(f"基准已变化的盘点行：{labels}。请逐行确认仍按当前实点后再保存或确认。")
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
		by_key = {_key(row): row.name for row in existing.get("items")}
		for row in data["items"]:
			if _key(row) in by_key:
				row["name"] = by_key[_key(row)]
	frappe.flags.ti_count_baseline = baseline
	try:
		if name:
			return native_api.save_document("Stock Reconciliation", name, version, data)
		return native_api.create_document("Stock Reconciliation", request_id, data)
	finally:
		frappe.flags.pop("ti_count_baseline", None)


def _native_values(doc):
	return [(_key(row), row.qty) for row in doc.get("items")]


def before_validate(doc, method=None):
	lock_stock_locations(doc)
	validate_request_identity(doc)
	validate_assignment(doc)
	if not doc.get("ti_count_review"):
		return
	_lock_count_locations()
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
			return
	baseline = frappe.flags.get("ti_count_baseline") or _baseline(
		f"{doc.posting_date} {doc.posting_time}",
		lock=True,
		previous_rows=[row.as_dict() for row in doc.ti_count_review],
	)
	review_dicts = [row.as_dict() for row in doc.ti_count_review]
	current = {_key(row): row for row in baseline["rows"]}
	stale = [
		row
		for row in review_dicts
		if row.get("review_state") == "Reviewed" and row.get("actual_qty") not in (None, "")
		if _key(row) in current
		and Decimal(str(row.get("baseline_qty") or 0)) != Decimal(str(current[_key(row)]["baseline_qty"]))
	]
	if stale:
		labels = "、".join(f"{row.get('item_code')}@{row.get('warehouse')}" for row in stale)
		frappe.throw(f"基准已变化的盘点行：{labels}。请重新核对后再提交。")
	differences = _differences(review_dicts, baseline["rows"])
	for row, value in zip(doc.ti_count_review, review_dicts, strict=True):
		row.difference = value["difference"]
	actual = {_key(row): Decimal(str(row.qty)) for row in doc.get("items")}
	expected = {_key(row): Decimal(str(row["qty"])) for row in differences}
	if not differences or len(actual) != len(doc.get("items")) or actual != expected:
		frappe.throw("原生调整明细与已核对差异不一致，请重新核对")
