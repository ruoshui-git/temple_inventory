"""Native UOM management for the inventory frontend."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe
from frappe.utils import cint

from temple_inventory.catalog import create_uom
from temple_inventory.native_access import require_app
from temple_inventory.uom_labels import clear_uom_label_cache


def _transaction_units(names):
	checks = (
		("Stock Entry Detail", ("uom", "stock_uom")),
		("Stock Reconciliation Item", ("uom", "stock_uom")),
		("Bin", ("stock_uom",)),
		("Stock Ledger Entry", ("stock_uom",)),
	)
	quoted_names = ", ".join(frappe.db.escape(name) for name in names)
	queries = []
	for doctype, fields in checks:
		available = [field for field in fields if frappe.get_meta(doctype).has_field(field)]
		for field in available:
			queries.append(
				f"select distinct `{field}` as uom from `tab{doctype}` where `{field}` in ({quoted_names})"
			)
	if not queries or not names:
		return set()
	return {row[0] for row in frappe.db.sql(" union ".join(queries))}


def _unit_row(row, item_counts=None, conversion_counts=None, transaction_units=None):
	item_counts = item_counts or {row.name: frappe.db.count("Item", {"stock_uom": row.name})}
	conversion_counts = conversion_counts or {
		row.name: frappe.db.count("UOM Conversion Detail", {"uom": row.name, "parenttype": "Item"})
	}
	transaction_units = transaction_units if transaction_units is not None else _transaction_units([row.name])
	item_count = item_counts.get(row.name, 0)
	conversion_count = conversion_counts.get(row.name, 0)
	transaction_use = row.name in transaction_units
	deletable = not (item_count or conversion_count or transaction_use)
	return {
		"name": row.name,
		"label": row.ti_label or row.name,
		"must_be_whole_number": bool(row.must_be_whole_number),
		"enabled": bool(row.enabled),
		"category": row.category or "",
		"item_count": item_count,
		"conversion_count": conversion_count,
		"used_in_transactions": transaction_use,
		"deletable": deletable,
		"delete_reason": "已被物品、换算或库存单据引用，不能删除" if not deletable else "",
	}


@frappe.whitelist()
def list_units():
	require_app()
	frappe.has_permission("UOM", "read", throw=True)
	rows = frappe.get_list(
		"UOM",
		fields=["name", "ti_label", "must_be_whole_number", "enabled", "category"],
		limit_page_length=0,
	)
	names = [row.name for row in rows]
	if names:
		quoted_names = ", ".join(frappe.db.escape(name) for name in names)
		item_counts = dict(
			frappe.db.sql(
				f"select stock_uom, count(*) from `tabItem` where stock_uom in ({quoted_names}) "
				"group by stock_uom"
			)
		)
		conversion_counts = dict(
			frappe.db.sql(
				"select uom, count(*) from `tabUOM Conversion Detail` "
				f"where parenttype='Item' and uom in ({quoted_names}) group by uom"
			)
		)
		transaction_units = _transaction_units(names)
	else:
		item_counts, conversion_counts, transaction_units = {}, {}, set()
	result = [_unit_row(row, item_counts, conversion_counts, transaction_units) for row in rows]
	result.sort(key=lambda row: (-row["item_count"], row["name"].casefold()))
	return result


@frappe.whitelist(methods=["POST"])
def list_categories():
	require_app()
	frappe.has_permission("UOM Category", "read", throw=True)
	return frappe.get_list("UOM Category", fields=["name"], limit_page_length=0, order_by="name asc")


@frappe.whitelist(methods=["POST"])
def create_category(category_name):
	require_app()
	frappe.has_permission("UOM Category", "create", throw=True)
	category_name = str(category_name or "").strip()
	if not category_name:
		frappe.throw("请填写单位类别")
	if frappe.db.exists("UOM Category", category_name):
		return {"name": category_name}
	doc = frappe.get_doc({"doctype": "UOM Category", "category_name": category_name})
	doc.check_permission("create")
	doc.insert()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def save_unit(name=None, uom_name=None, label="", must_be_whole_number=False, enabled=True, category=None):
	require_app()
	if name:
		doc = frappe.get_doc("UOM", name, for_update=True)
		doc.check_permission("write")
		if uom_name and str(uom_name).strip() != doc.name:
			frappe.throw("单位名称是原生身份，不能重命名")
		doc.ti_label = str(label or "").strip()
		doc.must_be_whole_number = cint(must_be_whole_number)
		if category is not None:
			doc.category = str(category or "").strip() or None
		if not cint(enabled) and doc.enabled:
			item_count = frappe.db.count("Item", {"stock_uom": doc.name})
			conversion_count = frappe.db.count(
				"UOM Conversion Detail", {"uom": doc.name, "parenttype": "Item"}
			)
			if item_count or conversion_count:
				frappe.throw(
					f"单位正在使用，不能停用：库存单位物品 {item_count} 项，物品单位换算 {conversion_count} 项"
				)
		doc.enabled = cint(enabled)
		doc.save()
	else:
		frappe.has_permission("UOM", "create", throw=True)
		uom_name = str(uom_name or "").strip()
		if not uom_name:
			frappe.throw("请填写单位名称")
		created = create_uom(uom_name, must_be_whole_number, label)
		doc = frappe.get_doc("UOM", created["name"], for_update=True)
		doc.category = str(category or "").strip() or None
		doc.enabled = cint(enabled)
		if doc.category or not doc.enabled:
			doc.save()
	clear_uom_label_cache()
	return _unit_row(doc)


@frappe.whitelist(methods=["POST"])
def delete_unit(name):
	require_app()
	doc = frappe.get_doc("UOM", name, for_update=True)
	doc.check_permission("delete")
	row = _unit_row(doc)
	if not row["deletable"]:
		frappe.throw(row["delete_reason"])
	frappe.delete_doc("UOM", name)
	clear_uom_label_cache()
	return {"name": name, "deleted": True}
