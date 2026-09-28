"""Adopt every existing leaf below the configured physical root."""

import frappe

from temple_inventory.inventory_api import _allow_warehouses, _physical_tree


def execute():
	if not frappe.db.exists("DocType", "Temple Inventory Settings"):
		return
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.company or not settings.physical_root_warehouse:
		return
	existing = {row.warehouse for row in settings.allowed_warehouses if row.warehouse}
	leaves = [
		name
		for name, row in _physical_tree(settings).items()
		if not row.is_group and name not in existing
	]
	if leaves:
		_allow_warehouses(settings, leaves)
