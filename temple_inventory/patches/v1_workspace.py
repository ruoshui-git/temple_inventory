import frappe


def execute():
	for name in ("Room", "Location"):
		if not frappe.db.exists("Warehouse Type", name):
			frappe.get_doc({"doctype": "Warehouse Type", "name": name}).insert()
	for activity in frappe.get_all("Inventory Activity", fields=["name", "date", "start_date"]):
		if activity.date and not activity.start_date:
			frappe.db.set_value(
				"Inventory Activity", activity.name, "start_date", activity.date, update_modified=False
			)
	settings = frappe.get_single("Temple Inventory Settings")
	if settings.root_warehouse and not settings.allowed_warehouses:
		for name in (
			settings.pending_warehouse,
			settings.damaged_warehouse,
			settings.default_lease_program_warehouse,
		):
			if name:
				settings.append("allowed_warehouses", {"warehouse": name})
		settings.save()
