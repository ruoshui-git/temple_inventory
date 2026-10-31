"""Permission-scoped outstanding loan allocations for stock workflows."""

import frappe

from temple_inventory.native_access import require_app
from temple_inventory.report_query import validate_query
from temple_inventory.report_sources import ReportContext, loan_rows


@frappe.whitelist(methods=["POST"])
def outstanding_lines(item_codes):
	"""Return readable open allocations for up to 200 Item codes."""
	require_app()
	if isinstance(item_codes, str):
		item_codes = frappe.parse_json(item_codes)
	if not isinstance(item_codes, list) or len(item_codes) > 200:
		frappe.throw("物品范围无效")
	if any(not isinstance(code, str) or not code or len(code) > 140 for code in item_codes):
		frappe.throw("物品编号无效")
	codes = set(item_codes)
	if not codes:
		return []
	query = validate_query({"dataset": "loans", "view": "items"})
	context = ReportContext(query, load_item_attachments=False, load_item_children=False)
	result = []
	for row in loan_rows(context, item_codes=codes):
		if row["outstanding"] <= 0:
			continue
		result.append(
			{
				"loan": row["document"],
				"original_loan_line": row["original_loan_line"],
				"item_code": row["item_code"],
				"batch_no": row["batch_no"],
				"qty": row["outstanding"],
				"uom": row["stock_uom"],
				"warehouse": row["source_warehouse"],
			}
		)
	return result
