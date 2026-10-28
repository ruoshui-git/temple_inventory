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
	_ensure_uom_property_setters()


def _ensure_uom_property_setters():
	"""Keep Desk UOM links searchable and display the app-owned title field."""
	if not frappe.get_meta("UOM").has_field("ti_label"):
		# A fresh install runs before fixtures add ti_label; after_migrate applies these.
		return
	for field, prop, value, prop_type in (
		(None, "title_field", "ti_label", "Data"),
		(None, "show_title_field_in_link", "1", "Check"),
		(None, "search_fields", "uom_name,ti_label", "Data"),
		(None, "translated_doctype", "0", "Check"),
	):
		name = frappe.db.get_value(
			"Property Setter",
			{"doc_type": "UOM", "doctype_or_field": "DocType", "property": prop},
			"name",
		)
		if name:
			frappe.db.set_value("Property Setter", name, "value", value, update_modified=False)
		else:
			frappe.make_property_setter(
				{
					"doctype": "UOM",
					"doctype_or_field": "DocType",
					"field_name": field,
					"property": prop,
					"value": value,
					"property_type": prop_type,
				},
				validate_fields_for_doctype=True,
			)
	frappe.clear_cache(doctype="UOM")


def after_migrate():
	after_install()
	from temple_inventory.uom_labels import seed_labels

	seed_labels()
	from temple_inventory.hooks import app_title

	# Set only app_name: saving the whole System Settings doc would revalidate
	# unrelated mandatory fields that a site may legitimately leave unset.
	for doctype in ("Website Settings", "System Settings"):
		if frappe.db.get_single_value(doctype, "app_name") != app_title:
			frappe.db.set_single_value(doctype, "app_name", app_title)
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
