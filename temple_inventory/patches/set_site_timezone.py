"""Set the sample site's timezone when no timezone has been configured."""

import frappe


def execute():
	if not frappe.db.get_single_value("System Settings", "time_zone"):
		frappe.db.set_single_value("System Settings", "time_zone", "America/New_York")
