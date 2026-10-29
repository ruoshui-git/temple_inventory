"""Give every user the site's time zone.

Users created at install (Administrator, Guest) keep Frappe's Asia/Kolkata default because
they exist before setup sets the site zone; seeded users already follow it.
"""

import frappe


def execute():
	align_user_time_zones()


def align_user_time_zones():
	time_zone = frappe.db.get_single_value("System Settings", "time_zone") or "America/New_York"
	for user in frappe.get_all("User", fields=["name", "time_zone"]):
		if user.time_zone != time_zone:
			frappe.db.set_value("User", user.name, "time_zone", time_zone, update_modified=False)
		# Desk reads the per-user default that User.on_update keeps in sync with the field.
		frappe.defaults.set_default("time_zone", time_zone, user.name)
