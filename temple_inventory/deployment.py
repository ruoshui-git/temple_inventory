"""Idempotent site integration for Desk visibility and branding."""

import frappe


def after_migrate():
	logo = "/assets/temple_inventory/logo.png"
	icon = frappe.db.exists("Desktop Icon", "物资管理")
	if icon:
		doc = frappe.get_doc("Desktop Icon", icon)
	else:
		doc = frappe.new_doc("Desktop Icon")
		doc.label = "物资管理"
		doc.icon_type = "App"
		doc.link_type = "External"
		doc.link = "/inventory"
		doc.app = "temple_inventory"
	doc.label = "物资管理"
	doc.icon_type = "App"
	doc.link_type = "External"
	doc.link = "/inventory"
	doc.app = "temple_inventory"
	doc.logo_url = logo
	doc.hidden = 0
	doc.standard = 1
	doc.save(ignore_permissions=True)
	for name in frappe.get_all("Desktop Icon", filters={"app": "erpnext"}, pluck="name", limit_page_length=0):
		if name != "Stock":
			frappe.db.set_value("Desktop Icon", name, "hidden", 1, update_modified=False)
	for name in frappe.get_all("Workspace", filters={"app": "erpnext", "name": ["!=", "Stock"]}, pluck="name", limit_page_length=0):
		frappe.db.set_value("Workspace", name, "is_hidden", 1, update_modified=False)
	website = frappe.get_single("Website Settings")
	website.favicon = logo
	website.save(ignore_permissions=True)
	frappe.clear_cache()
