import frappe


def has_app_permission():
	return (
		frappe.session.user != "Guest"
		and "System Manager" in frappe.get_roles()
		and frappe.has_permission("Stock Entry", "read")
	)
