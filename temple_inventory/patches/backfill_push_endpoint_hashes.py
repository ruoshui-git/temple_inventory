"""Populate unique hashes for existing Web Push endpoint URLs."""

import hashlib

import frappe


def execute():
	rows = frappe.get_all(
		"Inventory Push Subscription",
		filters={"endpoint_hash": ["is", "not set"]},
		fields=["name", "endpoint"],
		limit_page_length=0,
	)
	for row in rows:
		frappe.db.set_value(
			"Inventory Push Subscription",
			row.name,
			"endpoint_hash",
			hashlib.sha256(row.endpoint.encode()).hexdigest(),
			update_modified=False,
		)
	frappe.db.sql(
		"""update `tabInventory Push Subscription`
			set last_error = '' where ifnull(last_error, '') != ''"""
	)
