"""Adopt existing, explicitly typed physical leaves into the app allowlist."""

import frappe

from temple_inventory.inventory_api import _allow_warehouses, _warehouse_is_below


def execute():
	if not frappe.db.exists("DocType", "Temple Inventory Settings"):
		return
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.company or not settings.physical_root_warehouse:
		return
	existing = {row.warehouse for row in settings.allowed_warehouses if row.warehouse}
	locations = frappe.get_all(
		"Warehouse",
		filters={
			"company": settings.company,
			"is_group": 0,
			"warehouse_type": ("in", ["Location", "库位"]),
		},
		pluck="name",
		limit_page_length=0,
	)
	eligible = [
		name
		for name in locations
		if name not in existing
		and _warehouse_is_below(
			frappe.db.get_value("Warehouse", name, "parent_warehouse"),
			settings.physical_root_warehouse,
		)
	]
	if eligible:
		_allow_warehouses(settings, eligible)
