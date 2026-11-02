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
from temple_inventory.native_balances import (
	batch_rows_at,
	entry_bundle,
	ledger_rows_at,
	lock_stock_locations,
	reconciliation_serial_allocations,
	serial_balances_by_location,
)
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
	previous = {_key(row): row for row in (previous_rows or []) if row.get("warehouse") in warehouses}
	added = {key[0] for key in previous}
	# The native balance is the latest entry's running qty (get_previous_sle's order), not a sum:
	# a Stock Reconciliation entry sets qty_after_transaction with actual_qty 0.
	ledger_rows = ledger_rows_at(warehouses, posting)
	batch_rows = batch_rows_at(warehouses, posting)
	quantities = {}
	for entry in ledger_rows:
		quantities[(entry.item_code, entry.warehouse, "")] = float(entry.qty or 0)
	for entry in batch_rows:
		key = (entry.item_code, entry.warehouse, entry.batch_no or "")
		quantities[key] = quantities.get(key, 0) + float(entry.qty or 0)
	serial_sets = {}
	for entry in serial_balances_by_location(warehouses, posting, lock=lock):
		if entry["qty"] > 0:
			serial_sets.setdefault((entry["item_code"], entry["warehouse"]), []).append(entry["serial_no"])
	for serials in serial_sets.values():
		serials.sort()
	for key in previous:
		quantities.setdefault(key, 0)
	selected = sorted(
		{key[0] for key, qty in quantities.items() if qty}
		| {key[0] for key, serials in serial_sets.items() if serials}
		| added
	)
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
		display = display_items.get(code, {})
		allocations = by_item.get(code, ())
		if item.has_serial_no:
			serial_warehouses = {
				warehouse
				for (item_code, warehouse), serials in serial_sets.items()
				if item_code == code and serials
			}
			serial_warehouses.update(key[1] for key in previous if key[0] == code and not key[2])
			allocations = [
				(warehouse, "", float(len(serial_sets.get((code, warehouse), []))))
				for warehouse in serial_warehouses
			]
		for warehouse, batch, quantity in allocations:
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
					"baseline_serials": serial_sets.get((code, warehouse), []) if item.has_serial_no else [],
					"is_serial": bool(item.has_serial_no),
					"actual_serials": None if item.has_serial_no else [],
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


def _stale_labels(rows):
	from temple_inventory.native_topology import present_locations

	warehouses = {row.get("warehouse") for row in rows if row.get("warehouse")}
	settings = frappe.get_single("Temple Inventory Settings")
	location_labels = {
		row["name"]: row["label"]
		for row in present_locations(
			frappe.get_all(
				"Warehouse",
				filters={"company": settings.company},
				fields=[
					"name",
					"warehouse_name",
					"ti_label",
					"ti_short_label",
					"ti_direct_storage",
					"parent_warehouse",
					"is_group",
				],
				limit_page_length=0,
			)
		)
		if row.get("name") in warehouses
	}
	item_names = {
		row.name: row.item_name
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", sorted({row.get("item_code") for row in rows}) or [""]]},
			fields=["name", "item_name"],
			limit_page_length=0,
		)
	}
	return "、".join(
		f"{item_names.get(row.get('item_code'), row.get('item_code'))}（{row.get('item_code')}）·"
		f"{location_labels.get(row.get('warehouse'), row.get('warehouse'))}"
		for row in rows
	)


@frappe.whitelist()
def count_baseline(timestamp, previous_rows=None):
	require_app()
	if not frappe.has_permission("Stock Reconciliation", "create") and not frappe.has_permission(
		"Stock Reconciliation", "write"
	):
		frappe.throw("没有创建或编辑盘点的权限", frappe.PermissionError)
	previous_rows = frappe.parse_json(previous_rows) or []
	result = _baseline(timestamp, previous_rows=previous_rows)
	visible = set(result["warehouses"])
	previous = {_key(row): row for row in previous_rows if row.get("warehouse") in visible}
	for row in result["rows"]:
		old = previous.get(_key(row))
		if not old:
			row["needs_review"] = True
			continue
		row.update({"actual_qty": old.get("actual_qty"), "reason": old.get("reason", "")})
		changed = Decimal(str(old.get("baseline_qty"))) != Decimal(str(row["baseline_qty"])) or (
			row.get("is_serial")
			and set(old.get("baseline_serials") or []) != set(row.get("baseline_serials") or [])
		)
		if row.get("is_serial"):
			row["actual_serials"] = old.get("actual_serials")
			if row["actual_serials"] is None and old.get("review_state") == "Reviewed":
				if Decimal(str(old.get("actual_qty") or 0)) == Decimal(str(row["baseline_qty"])):
					row["actual_serials"] = list(row.get("baseline_serials") or [])
		row["needs_review"] = changed
		row["review_state"] = "Unreviewed" if changed else old.get("review_state", "Unreviewed")
	result["removed_rows"] = [
		row for key, row in previous.items() if key not in {_key(r) for r in result["rows"]}
	]
	return result


@frappe.whitelist()
def count_serial_details(name):
	"""Read original and counted serial sets from native reconciliation bundles."""
	require_app()
	doc = frappe.get_doc("Stock Reconciliation", name)
	check_document_scope(doc)
	doc.check_permission("read")
	result = []
	for row in doc.get("items"):
		if not frappe.get_cached_value("Item", row.item_code, "has_serial_no"):
			continue
		result.append(
			{
				"item_code": row.item_code,
				"warehouse": row.warehouse,
				"batch_no": row.batch_no or None,
				**reconciliation_serial_allocations(row),
			}
		)
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
		if book.get("is_serial") and set(row.get("baseline_serials") or []) != set(
			book.get("baseline_serials") or []
		):
			frappe.throw("账面序列号已变化，请刷新并重新核对", frappe.TimestampMismatchError)
		if book.get("is_serial"):
			if state != "Reviewed":
				frappe.throw("请核对每个序列号，或明确盘点为 0")
			if row.get("actual_serials") is None:
				frappe.throw("请核对每个序列号，或明确盘点为 0")
			actual_serials = sorted(set(row.get("actual_serials") or []))
			if len(actual_serials) != len(row.get("actual_serials") or []):
				frappe.throw("序列号不能重复")

			_validate_count_serials(row["item_code"], row["warehouse"], actual_serials)
			actual = Decimal(len(actual_serials))
			if row.get("actual_qty") not in (None, "") and Decimal(str(row["actual_qty"])) != actual:
				frappe.throw("序列号数量与实点数量不一致")
			row["actual_qty"] = int(actual)
			reviewed += 1
			if set(actual_serials) == set(book.get("baseline_serials") or []):
				row["difference"] = 0
				continue
			differences.append({**book, "qty": float(actual), "serials": actual_serials})
			row["difference"] = float(actual - Decimal(str(book["baseline_qty"])))
			continue
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


def _validate_count_serials(item_code, warehouse, serials):
	if not serials:
		return
	_settings, _visible, physical, _leased, _damaged = warehouse_scopes()
	if warehouse not in physical:
		frappe.throw("无权盘点此实体末级位置", frappe.PermissionError)
	rows = frappe.db.get_all(
		"Serial No",
		filters={"name": ["in", serials]},
		fields=["name", "item_code", "status", "warehouse"],
		limit_page_length=0,
	)
	by_name = {row.name: row for row in rows}
	from temple_inventory.native_topology import present_locations

	settings = frappe.get_single("Temple Inventory Settings")
	labels = {
		row["name"]: row["label"]
		for row in present_locations(
			frappe.get_all(
				"Warehouse",
				filters={"company": settings.company},
				fields=[
					"name",
					"warehouse_name",
					"ti_label",
					"ti_short_label",
					"ti_direct_storage",
					"parent_warehouse",
					"is_group",
				],
				limit_page_length=0,
			)
		)
	}
	for serial in serials:
		entry = by_name.get(serial)
		if not entry:
			frappe.throw(f"序列号 {serial} 不存在；盘点不能新建序列号，请先办理入库。")
		if entry.item_code != item_code:
			frappe.throw(f"序列号 {serial} 属于其他物品，不能计入本行。")
		if entry.status == "Active" and entry.warehouse and entry.warehouse != warehouse:
			if entry.warehouse not in physical:
				frappe.throw("无权读取该序列号所在位置", frappe.PermissionError)
			frappe.throw(f"序列号 {serial} 记录在 {labels.get(entry.warehouse, entry.warehouse)}，请先调拨")
		if entry.status != "Active" or entry.warehouse != warehouse:
			frappe.throw(f"序列号 {serial} 当前不在本盘点位置，不能计入实点。")


@frappe.whitelist()
def validate_count_serial(item_code, warehouse, serial):
	require_app()
	serial = str(serial or "").strip()
	if not serial:
		frappe.throw("请输入序列号")
	_validate_count_serials(item_code, warehouse, [serial])
	return {"valid": True}


def _bundle_serials(row, fieldname):
	bundle = entry_bundle(row, fieldname)
	return sorted({entry.serial_no for entry in bundle.entries if entry.serial_no} if bundle else [])


def _hydrate_serial_reviews(reviews, items):
	by_key = {_key(row): row for row in items}
	for review in reviews:
		item = by_key.get(_key(review))
		if not item:
			continue
		if item.get("current_serial_and_batch_bundle"):
			review["baseline_serials"] = _bundle_serials(item, "current_serial_and_batch_bundle")
			review["is_serial"] = True
		if item.get("reconcile_all_serial_batch") or item.get("serial_no"):
			review["actual_serials"] = sorted(filter(None, (item.get("serial_no") or "").splitlines()))
			review["is_serial"] = True


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
	if existing:
		_hydrate_serial_reviews(reviews, existing.get("items"))
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
		and (
			Decimal(str(row.get("baseline_qty") or 0)) != Decimal(str(current[_key(row)]["baseline_qty"]))
			or (
				current[_key(row)].get("is_serial")
				and set(row.get("baseline_serials") or [])
				!= set(current[_key(row)].get("baseline_serials") or [])
			)
		)
	]
	if stale:
		labels = _stale_labels(stale)
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
			"use_serial_batch_fields": 0 if row.get("is_serial") and not row["serials"] else 1,
			"reconcile_all_serial_batch": 1 if row.get("is_serial") and not row["serials"] else 0,
			"serial_no": "\n".join(row.get("serials") or []),
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
	frappe.flags.ti_count_review_input = reviews
	try:
		if name:
			return native_api.save_document("Stock Reconciliation", name, version, data)
		return native_api.create_document("Stock Reconciliation", request_id, data)
	finally:
		frappe.flags.pop("ti_count_baseline", None)
		frappe.flags.pop("ti_count_review_input", None)


def _native_values(doc):
	return [
		(
			_key(row),
			row.qty,
			"\n".join(sorted(filter(None, (row.serial_no or "").splitlines()))),
			int(row.reconcile_all_serial_batch or 0),
		)
		for row in doc.get("items")
	]


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
		if (
			old_review == new_review
			and _native_values(previous) != _native_values(doc)
			and not frappe.flags.get("ti_count_review_input")
		):
			# Ordinary Desk edits invalidate custom review context instead of presenting
			# an earlier review as the result of the newly edited reconciliation.
			doc.set("ti_count_review", [])
			return
	baseline = frappe.flags.get("ti_count_baseline")
	if baseline is None:
		baseline = _baseline(
			f"{doc.posting_date} {doc.posting_time}",
			lock=True,
			previous_rows=[row.as_dict() for row in doc.ti_count_review],
		)
	review_dicts = frappe.flags.get("ti_count_review_input") or [row.as_dict() for row in doc.ti_count_review]
	current = {_key(row): row for row in baseline["rows"]}
	_hydrate_serial_reviews(review_dicts, doc.get("items"))
	for row in review_dicts:
		book = current.get(_key(row))
		if book and book.get("is_serial"):
			row.setdefault("baseline_serials", book.get("baseline_serials") or [])
			row["is_serial"] = True
	actual_by_key = {
		_key(row): sorted(filter(None, (row.serial_no or "").splitlines())) for row in doc.get("items")
	}
	for row in review_dicts:
		book = current.get(_key(row))
		if book and book.get("is_serial") and row.get("actual_serials") is None:
			row["actual_serials"] = actual_by_key.get(_key(row), [])
	stale = [
		row
		for row in review_dicts
		if row.get("review_state") == "Reviewed" and row.get("actual_qty") not in (None, "")
		if _key(row) in current
		and (
			Decimal(str(row.get("baseline_qty") or 0)) != Decimal(str(current[_key(row)]["baseline_qty"]))
			or (
				current[_key(row)].get("is_serial")
				and set(row.get("baseline_serials") or [])
				!= set(current[_key(row)].get("baseline_serials") or [])
			)
		)
	]
	if stale:
		labels = _stale_labels(stale)
		frappe.throw(f"基准已变化的盘点行：{labels}。请重新核对后再提交。")
	differences = _differences(review_dicts, baseline["rows"])
	for row, value in zip(doc.ti_count_review, review_dicts, strict=True):
		row.difference = value["difference"]
	expected = {
		(
			_key(row),
			Decimal(str(row["qty"])),
			"\n".join(row.get("serials") or []),
			int(bool(row.get("is_serial") and not row.get("serials"))),
		)
		for row in differences
	}
	by_key = {_key(row): row for row in differences}
	for row in doc.get("items"):
		counted = by_key.get(_key(row))
		if counted and counted.get("is_serial"):
			row.serial_no = "\n".join(counted.get("serials") or [])
			row.use_serial_batch_fields = int(bool(counted.get("serials")))
			row.reconcile_all_serial_batch = int(not counted.get("serials"))
	if not differences or sorted(_native_values(doc), key=str) != sorted(expected, key=str):
		frappe.throw("原生调整明细与已核对差异不一致，请重新核对")
