"""Move existing expiry digest links to the registered inventory route."""

import frappe


def execute():
	frappe.db.sql(
		"""update `tabNotification Log` set link=%s where link=%s""",
		("/inventory/stock/expiry", "/inventory/expiry"),
	)
