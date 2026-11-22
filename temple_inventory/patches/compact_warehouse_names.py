"""Recompute stored physical paths with the compact native separator."""

import frappe

from temple_inventory.warehouse_names import development_name_check


def execute():
	"""Update warehouse_name only; document names change through the explicit warehouse_rename run."""
	if not frappe.db.exists("DocType", "Temple Inventory Settings"):
		return
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.company or not settings.physical_root_warehouse:
		return
	for diff in development_name_check()["diffs"]:
		frappe.db.set_value(
			"Warehouse", diff["name"], "warehouse_name", diff["expected"], update_modified=False
		)
