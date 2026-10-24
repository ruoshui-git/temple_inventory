"""Idempotent site integration for Desk visibility and branding."""

import frappe


def _erpnext_workspace_names():
	"""Return ERPNext workspaces using the v16 Workspace -> Module Def relationship."""
	rows = frappe.db.sql(
		"""
		select workspace.name
		from `tabWorkspace` as workspace
		inner join `tabModule Def` as module_def on module_def.name = workspace.module
		where module_def.app_name = %s and workspace.name != %s
		""",
		("erpnext", "Stock"),
		as_dict=True,
	)
	return [row.name for row in rows]


def after_install():
	"""Reference records a fresh site needs before its first migrate.

	The Desktop Icon is a shipped standard record synced by Frappe; creating it here
	would make developer mode rewrite the shipped JSON.
	"""
	from temple_inventory.activities import seed_activity_types
	from temple_inventory.notifications import register_types

	seed_activity_types()
	register_types()


def after_migrate():
	after_install()
	logo = "/assets/temple_inventory/logo.png"
	icon = frappe.db.exists("Desktop Icon", "物资管理")
	doc = frappe.get_doc("Desktop Icon", icon) if icon else frappe.new_doc("Desktop Icon")
	icon_values = {
		"label": "物资管理",
		"icon_type": "App",
		"link_type": "External",
		"link": "/inventory",
		"app": "temple_inventory",
		"logo_url": logo,
		"hidden": 0,
		"standard": 1,
	}
	if not icon or any(doc.get(field) != value for field, value in icon_values.items()):
		for field, value in icon_values.items():
			setattr(doc, field, value)
		doc.save(ignore_permissions=True)
	for name in frappe.get_all("Desktop Icon", filters={"app": "erpnext"}, pluck="name", limit_page_length=0):
		if name != "Stock":
			frappe.db.set_value("Desktop Icon", name, "hidden", 1, update_modified=False)
	for name in _erpnext_workspace_names():
		frappe.db.set_value("Workspace", name, "is_hidden", 1, update_modified=False)
	website = frappe.get_single("Website Settings")
	website.favicon = logo
	website.save(ignore_permissions=True)
	frappe.clear_cache()
