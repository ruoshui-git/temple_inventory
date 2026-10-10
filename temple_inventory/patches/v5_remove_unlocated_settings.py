"""Remove the retired virtual-warehouse links from existing settings rows."""

import frappe


def execute():
	"""Clear legacy singleton columns without deleting stock or warehouses.

	An existing 未定位 Warehouse is intentionally left for the development
	verifier to report; deleting it could discard ledger history. Fresh
	initialization no longer creates the warehouse.
	"""
	columns = {
		row["Field"]
		for row in frappe.db.sql("desc `tabTemple Inventory Settings`", as_dict=True)
	}
	legacy = [field for field in ("pending_warehouse", "unlocated_warehouse") if field in columns]
	if legacy:
		frappe.db.sql(
			f"update `tabTemple Inventory Settings` set {', '.join(f'{field}=null' for field in legacy)}"
		)
