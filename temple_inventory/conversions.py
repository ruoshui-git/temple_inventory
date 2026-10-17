"""Explicit Item conversion edits, independent of stock-document line factors."""

import frappe

from temple_inventory.native_access import load_locked, require_app
from temple_inventory.native_stock import number, validate_precision


@frappe.whitelist(methods=["POST"])
def save_item_conversions(item_code, version, conversions):
	require_app()
	item = load_locked("Item", item_code, version)
	values = frappe.parse_json(conversions)
	if not isinstance(values, list):
		frappe.throw("换算内容无效")
	seen = set()
	existing = {row.uom: row for row in item.uoms}
	rows = []
	for value in values:
		unit_name = value.get("uom")
		if not unit_name or unit_name in seen:
			frappe.throw("每个计量单位只能有一个常用换算")
		seen.add(unit_name)
		unit = frappe.get_doc("UOM", unit_name)
		unit.check_permission("read")
		factor = number(value.get("conversion_factor"), "换算系数")
		if unit_name == item.stock_uom and factor != 1:
			frappe.throw("库存单位的换算系数必须是 1")
		row = existing.get(unit_name) or item.append("uoms", {"uom": unit_name})
		validate_precision(factor, row.precision("conversion_factor"), "换算系数")
		row.conversion_factor = float(factor)
		rows.append(row)
	if item.stock_uom not in seen:
		stock_row = existing.get(item.stock_uom) or item.append("uoms", {"uom": item.stock_uom})
		stock_row.conversion_factor = 1
		rows.insert(0, stock_row)
	item.set("uoms", rows)
	item.save()
	return {
		"item_code": item.name,
		"version": str(item.modified),
		"stock_uom": item.stock_uom,
		"conversions": [row.as_dict() for row in item.uoms],
	}
