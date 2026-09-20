"""Backfill canonical audit fields on legacy draft workspace records."""

import frappe


def execute():
	if not frappe.db.exists("DocType", "Inventory Workspace"):
		return
	frappe.db.sql(
		"""update `tabInventory Workspace` set borrower_is_handler_or_witness=1
		where borrower_is_handler_or_witness is null"""
	)
