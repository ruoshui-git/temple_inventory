import frappe

from temple_inventory.native_access import erpnext_installed, frontend_account_denial


def has_app_permission():
	"""Apps-screen visibility; must not throw, since a thrown message would reach Desk users."""
	return (
		frontend_account_denial() is None
		and erpnext_installed()
		and bool(frappe.has_permission("Stock Entry", "read"))
	)
