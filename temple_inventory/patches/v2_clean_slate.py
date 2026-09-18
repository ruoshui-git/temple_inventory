"""Make the warehouse template migration safe for existing and clean sites."""

import frappe


def execute():
	settings = frappe.get_single("Temple Inventory Settings")
	company = settings.company or frappe.db.get_value("Company", {}, "name")
	if not company:
		return
	settings.company = company
	# Existing configured sites already have an intentional warehouse tree.
	# Do not reset or reseed it during migration.
	if settings.root_warehouse:
		settings.initial_seed_completed = 1
		settings.save(ignore_permissions=True)
