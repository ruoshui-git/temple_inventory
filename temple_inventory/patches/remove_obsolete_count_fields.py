import frappe


def execute():
	for fieldname in (
		"ti_count_scope",
		"ti_count_items",
		"ti_count_warehouses",
		"ti_baseline_timestamp",
		"ti_baseline_fingerprint",
	):
		frappe.delete_doc(
			"Custom Field",
			f"Stock Reconciliation-{fieldname}",
			ignore_missing=True,
		)
