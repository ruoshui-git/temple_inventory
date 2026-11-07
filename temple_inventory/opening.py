"""Native Opening Stock reconciliation support."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe
from frappe.utils import cint, flt, get_datetime, getdate, now_datetime

from temple_inventory.native_access import check_company, require_app
from temple_inventory.native_stock import warehouse_scopes


def set_difference_account(doc):
	if doc.get("expense_account"):
		return doc.expense_account
	from erpnext.stock.doctype.stock_reconciliation.stock_reconciliation import get_difference_account

	account = get_difference_account("Opening Stock", doc.company)
	if not account:
		frappe.throw(f"请先在 ERPNext 为公司 {doc.company} 设置 Temporary（临时）科目，再创建期初库存。")
	doc.expense_account = account
	return account


@frappe.whitelist(methods=["POST"])
def ensure_batch(item_code, batch_id, manufacturing_date=None, expiry_date=None):
	require_app()
	frappe.has_permission("Stock Reconciliation", "create", throw=True)
	from temple_inventory.catalog import check_item
	from temple_inventory.catalog import create_batch as create_native_batch

	item = check_item(item_code)
	if not item.has_batch_no:
		frappe.throw("此物品未启用批次管理。")
	if item.has_expiry_date and not expiry_date:
		frappe.throw(f"物品 {item.item_name}（{item.name}）需要填写批次到期日期。")
	batch_id = str(batch_id or "").strip()
	if not batch_id:
		frappe.throw("请输入批次编号。")
	if manufacturing_date and expiry_date and getdate(manufacturing_date) > getdate(expiry_date):
		frappe.throw("到期日期不能早于生产日期。")
	if frappe.db.exists("Batch", batch_id):
		batch = frappe.get_doc("Batch", batch_id)
		batch.check_permission("read")
		if batch.item != item.name:
			frappe.throw(f"批次 {batch_id} 属于物品 {batch.item}，不能用于物品 {item.name}。")
		if batch.disabled:
			frappe.throw(f"批次 {batch_id} 已停用，请选择其它批次。")
		for field, requested in (("manufacturing_date", manufacturing_date), ("expiry_date", expiry_date)):
			if requested and str(batch.get(field) or "") != str(getdate(requested)):
				frappe.throw(f"批次 {batch_id} 的日期与输入不一致，请核对批次日期。")
		return {"name": batch.name, "item": batch.item}
	return create_native_batch(item.name, batch_id, manufacturing_date, expiry_date)


@frappe.whitelist()
def batch_options(item_code):
	require_app()
	frappe.has_permission("Stock Reconciliation", "create", throw=True)
	from temple_inventory.catalog import check_item

	item = check_item(item_code)
	if not item.has_batch_no:
		return []
	return frappe.get_list(
		"Batch",
		filters={"item": item.name, "disabled": 0},
		fields=["name", "manufacturing_date", "expiry_date"],
		order_by="name asc",
		limit_page_length=100,
	)


@frappe.whitelist(methods=["POST"])
def generate_serials(item_code, quantity):
	require_app()
	frappe.has_permission("Stock Reconciliation", "create", throw=True)
	from frappe.utils import cstr

	from temple_inventory.catalog import check_item

	item = check_item(item_code)
	quantity = cint(quantity)
	if not item.has_serial_no or not item.serial_no_series or quantity < 1 or quantity > 1000:
		frappe.throw("此物品无法按指定数量自动生成序列号。")
	from erpnext.stock.doctype.serial_no.serial_no import get_available_serial_nos

	return [cstr(value) for value in get_available_serial_nos(item.serial_no_series, quantity)]


def _location_labels(warehouses):
	from temple_inventory.native_topology import present_locations

	settings = frappe.get_single("Temple Inventory Settings")
	rows = frappe.get_all(
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
	return {row["name"]: row["label"] for row in present_locations(rows) if row.get("name") in warehouses}


def validate_opening(doc):
	"""Apply opening-only scope and eligibility checks for both Desk and API saves."""
	check_company(doc)
	# The declared date is the point of an opening; submit must not replace it with now.
	doc.ti_time_mode = "Historical"
	doc.set_posting_time = 1
	if not doc.get("expense_account"):
		set_difference_account(doc)
	if get_datetime(f"{doc.posting_date} {doc.posting_time}") > now_datetime():
		frappe.throw("期初日期和时间不能晚于当前时间。")
	_settings, _visible, physical, _leased, _damaged = warehouse_scopes()
	warehouse_names = {row.warehouse for row in doc.items if row.warehouse}
	if warehouse_names - set(physical):
		frappe.throw("期初库存只能录入有权限的实体末级位置；借出与损坏位置请使用盘点调整。")
	if not warehouse_names:
		return
	items = {row.item_code for row in doc.items if row.item_code}
	metadata = {
		row.name: row
		for row in frappe.get_all(
			"Item",
			filters={"name": ["in", sorted(items) or [""]]},
			fields=[
				"name",
				"item_code",
				"item_name",
				"has_batch_no",
				"has_serial_no",
				"has_expiry_date",
				"stock_uom",
				"serial_no_series",
			],
			limit_page_length=0,
		)
	}
	serial_rows = {}
	serial_conflicts = {}
	for row in doc.items:
		if row.item_code not in metadata:
			continue
		item = metadata[row.item_code]
		if cint(item.has_batch_no) and not row.batch_no:
			frappe.throw(f"物品 {item.item_name}（{item.name}）必须指定已存在的批次。")
		if cint(item.has_serial_no) and not row.serial_no and not row.serial_and_batch_bundle:
			frappe.throw(f"物品 {item.item_name}（{item.name}）必须录入序列号。")
		if float(row.qty or 0) <= 0:
			frappe.throw(f"期初库存数量必须大于零：{item.item_name}（{item.name}）。")
		if row.get("valuation_rate") not in (None, "") and float(row.valuation_rate) < 0:
			frappe.throw(f"估值单价不能为负数：{item.item_name}（{item.name}）。")
		if cint(item.has_serial_no) and float(row.qty or 0) % 1:
			frappe.throw(f"序列号物品必须使用整数库存单位数量：{item.item_name}（{item.name}）。")
		if cint(item.has_serial_no) and not cint(
			frappe.get_cached_value("UOM", item.stock_uom, "must_be_whole_number")
		):
			frappe.throw(f"序列号物品的库存单位必须设置为整数量单位：{item.item_name}（{item.name}）。")
		if cint(item.has_serial_no) and row.serial_no:
			serials = [
				value.strip() for value in row.serial_no.replace(",", "\n").splitlines() if value.strip()
			]
			if len(serials) != float(row.qty):
				frappe.throw(f"序列号数量必须与库存数量一致：{item.item_name}（{item.name}）。")
			for serial in serials:
				if serial in serial_rows:
					serial_conflicts[serial] = (item, row.warehouse, f"{item.item_name}（{item.name}）")
				else:
					serial_rows[serial] = (item, row.warehouse)
			row.use_serial_batch_fields = 1
		if cint(item.has_batch_no):
			batch = frappe.db.get_value(
				"Batch", {"name": row.batch_no, "item": row.item_code}, ["name", "expiry_date"], as_dict=True
			)
			if not batch:
				frappe.throw(f"批次 {row.batch_no} 不存在或不属于物品 {item.name}。请先创建批次。")
			if cint(item.has_expiry_date) and not batch.expiry_date:
				frappe.throw(f"物品 {item.item_name}（{item.name}）的批次 {row.batch_no} 必须填写到期日期。")
			row.use_serial_batch_fields = 1
		if not flt(row.get("valuation_rate")):
			from erpnext.stock.utils import get_stock_balance

			rate = get_stock_balance(
				row.item_code,
				row.warehouse,
				doc.posting_date,
				doc.posting_time,
				with_valuation_rate=True,
			)[1]
			if not rate:
				currency = frappe.get_cached_value("Company", doc.company, "default_currency")
				rate = frappe.db.get_value(
					"Item Price",
					{"item_code": row.item_code, "buying": 1, "currency": currency},
					"price_list_rate",
				)
			if not rate:
				rate = frappe.get_cached_value("Item", row.item_code, "valuation_rate")
			if rate:
				row.valuation_rate = rate
			else:
				row.allow_zero_valuation_rate = 1
	if serial_rows:
		serial_docs = frappe.get_all(
			"Serial No",
			filters={"name": ["in", sorted(serial_rows)]},
			fields=["name", "item_code", "warehouse"],
			limit_page_length=0,
		)
		serial_items = {
			row.name: row
			for row in frappe.get_all(
				"Item",
				filters={"name": ["in", sorted({serial.item_code for serial in serial_docs}) or [""]]},
				fields=["name", "item_name"],
				limit_page_length=0,
			)
		}
		for serial in serial_docs:
			requested_item, requested_warehouse = serial_rows[serial.name]
			if serial.warehouse or serial.item_code != requested_item.name:
				serial_conflicts[serial.name] = (
					requested_item,
					serial.warehouse or requested_warehouse,
					f"{serial_items.get(serial.item_code, frappe._dict(name=serial.item_code)).get('item_name') or serial.item_code}（{serial.item_code}）",
				)
	if serial_conflicts:
		presenter_locations = {
			row.warehouse for row in serial_docs if row.name in serial_conflicts and row.warehouse
		}
		presenter_locations.update(value[1] for value in serial_conflicts.values() if value[1])
		labels = _location_labels(presenter_locations)
		serial = sorted(serial_conflicts)[0]
		_requested_item, requested_warehouse, owner = serial_conflicts[serial]
		location = labels.get(requested_warehouse, requested_warehouse) if requested_warehouse else "未知位置"
		frappe.throw(f"序列号 {serial} 属于物品 {owner}，位置 {location}，不能用于此期初库存。")

	pairs = sorted({(row.item_code, row.warehouse) for row in doc.items})
	if not pairs:
		return
	# One set-based lookup covers all active ledger time, submitted openings, and (on submit only) drafts.
	sql = """select item_code, warehouse, block_type, blocker from (
		select item_code, warehouse, 'ledger' as block_type, voucher_no as blocker
		from `tabStock Ledger Entry`
		where is_cancelled = 0 and (item_code, warehouse) in %(pairs)s
		union all
		select ri.item_code, ri.warehouse, 'opening' as block_type, ri.parent as blocker
		from `tabStock Reconciliation Item` ri
		inner join `tabStock Reconciliation` sr on sr.name = ri.parent
		where sr.docstatus = 1 and sr.purpose = 'Opening Stock' and sr.name != %(name)s
		and (ri.item_code, ri.warehouse) in %(pairs)s"""
	if doc.flags.in_submit or cint(doc.docstatus) == 1:
		sql += """
		union all
		select ri.item_code, ri.warehouse, 'draft' as block_type, ri.parent as blocker
		from `tabStock Reconciliation Item` ri
		inner join `tabStock Reconciliation` sr on sr.name = ri.parent
		where sr.docstatus = 0 and sr.purpose = 'Opening Stock' and sr.name != %(name)s
		and (ri.item_code, ri.warehouse) in %(pairs)s"""
	sql += ") candidates group by item_code, warehouse"
	blocked_rows = frappe.db.sql(sql, {"pairs": tuple(pairs), "name": doc.name or ""}, as_dict=True)
	blocked = {(row.item_code, row.warehouse): row for row in blocked_rows}
	if blocked:
		key, blocker = next(iter(blocked.items()))
		item = metadata.get(key[0])
		label = _location_labels({key[1]}).get(key[1], key[1])
		kind = "已有库存流水" if blocker.block_type == "ledger" else "已被期初库存占用"
		frappe.throw(
			f"物品 {item.item_name if item else key[0]}（{key[0]}）在位置 {label} {kind}（{blocker.blocker}）。"
			"请使用盘点调整处理。"
		)
