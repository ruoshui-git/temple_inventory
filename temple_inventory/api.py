import frappe

from temple_inventory.inventory_api import *  # noqa: F403


def has_app_permission():
	return frappe.session.user != "Guest" and frappe.has_permission("Stock Entry", "read")
