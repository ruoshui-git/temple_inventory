"""Reset only temple-inventory development data and seed the fixed structure."""

import frappe

from temple_inventory.inventory_api import ensure_seed_structure


def execute():
	settings = frappe.get_single("Temple Inventory Settings")
	company = settings.company or frappe.db.get_value("Company", {}, "name")
	if not company:
		frappe.throw("No Company exists; cannot seed temple inventory warehouses")
	entry_names = frappe.get_all(
		"Stock Entry", filters={"ti_movement_kind": ("is", "set")}, pluck="name", limit_page_length=0
	)
	entry_names_set = set(entry_names)
	item_names = set()
	for name in entry_names:
		entry = frappe.get_doc("Stock Entry", name)
		item_names.update(row.item_code for row in entry.items if row.item_code)
	for name in frappe.get_all("Inventory Workspace", filters={"company": company}, pluck="name", limit_page_length=0):
		for file_name in frappe.get_all("File", filters={"attached_to_doctype": "Inventory Workspace", "attached_to_name": name}, pluck="name"):
			frappe.delete_doc("File", file_name, force=True, ignore_permissions=True)
		doc = frappe.get_doc("Inventory Workspace", name)
		doc.flags.reset_service = True
		doc.delete(force=True, ignore_permissions=True)
	for name in entry_names:
		entry = frappe.get_doc("Stock Entry", name)
		if entry.docstatus == 1:
			entry.cancel()
		if frappe.db.exists("Stock Entry", name):
			frappe.delete_doc("Stock Entry", name, force=True, ignore_permissions=True)
	if entry_names_set:
		frappe.db.sql(
			"delete from `tabStock Ledger Entry` where voucher_type=%s and voucher_no in %s",
			("Stock Entry", tuple(entry_names_set)),
		)
	for item_name in item_names:
		if not frappe.db.exists("Item", item_name):
			continue
		other = frappe.db.sql(
			"""select sed.parent from `tabStock Entry Detail` sed
			join `tabStock Entry` se on se.name=sed.parent
			where sed.item_code=%s and se.name not in %s limit 1""",
			(item_name, tuple(entry_names_set) or ("",)),
		)
		if not other:
			frappe.delete_doc("Item", item_name, force=True, ignore_permissions=True)
	root = settings.root_warehouse
	if root and frappe.db.exists("Warehouse", root):
		r = frappe.db.get_value("Warehouse", root, ["lft", "rgt"], as_dict=True)
		warehouses = frappe.get_all(
			"Warehouse", filters={"lft": [">=", r.lft], "rgt": ["<=", r.rgt]}, fields=["name", "lft"], order_by="lft desc"
		)
		for row in warehouses:
			if frappe.db.exists("Warehouse", row.name):
				frappe.delete_doc("Warehouse", row.name, force=True, ignore_permissions=True)
	for row in frappe.get_all("Inventory Activity", pluck="name", limit_page_length=0):
		frappe.delete_doc("Inventory Activity", row, force=True, ignore_permissions=True)
	for field in ("root_warehouse", "pending_warehouse", "leased_warehouse", "default_lease_program_warehouse", "damaged_warehouse"):
		settings.set(field, None)
	settings.set("allowed_warehouses", [])
	settings.set("company", company)
	settings.save(ignore_permissions=True)
	ensure_seed_structure(company)
