"""Native ledger/bundle quantity queries with an explicit posting boundary.

These queries follow the installed ERPNext Serial and Batch Bundle/SLE storage.
They include expired/disabled batch stock, ignore reservations for physical counts,
exclude cancelled native rows, and never cap historical stock by future availability.
"""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

from collections import defaultdict

import frappe
from erpnext.stock.stock_ledger import get_previous_sle
from frappe.utils import get_datetime


def entry_bundle(row, fieldname="serial_and_batch_bundle", *, batch_checker=None):
	"""Resolve the exact original bundle even after native cancellation detaches it."""
	if fieldname not in ("serial_and_batch_bundle", "current_serial_and_batch_bundle"):
		raise ValueError("Unsupported native bundle field")
	name = row.get(fieldname)
	if not name and row.get("parenttype") == "Stock Entry" and row.get("parent") and row.get("name"):
		parent_docstatus = row.get("_parent_docstatus")
		if parent_docstatus is None:
			parent_docstatus = frappe.db.get_value("Stock Entry", row.parent, "docstatus")
		if parent_docstatus == 2:
			candidates = frappe.get_all(
				"Serial and Batch Bundle",
				filters={
					"voucher_type": "Stock Entry",
					"voucher_no": row.parent,
					"voucher_detail_no": row.name,
					"warehouse": row.get("s_warehouse") or row.get("t_warehouse"),
				},
				pluck="name",
				limit_page_length=2,
			)
			if len(candidates) > 1:
				frappe.throw("原明细包含多个批次明细版本，请在 ERPNext 中核对")
			name = candidates[0] if candidates else None
	if (
		not name
		and row.get("doctype") == "Stock Reconciliation Item"
		and row.get("parent")
		and row.get("name")
		and (
			row.get("_parent_docstatus")
			if row.get("_parent_docstatus") is not None
			else frappe.db.get_value("Stock Reconciliation", row.parent, "docstatus")
		)
		== 2
	):
		book = fieldname == "current_serial_and_batch_bundle"
		quantity = float(row.get("current_qty" if book else "qty") or 0)
		if quantity:
			candidates = frappe.get_all(
				"Serial and Batch Bundle",
				filters={
					"voucher_type": "Stock Reconciliation",
					"voucher_no": row.parent,
					"voucher_detail_no": row.name,
					"warehouse": row.warehouse,
					"type_of_transaction": "Outward" if book and quantity > 0 else "Inward",
				},
				pluck="name",
				limit_page_length=2,
			)
			if len(candidates) > 1:
				frappe.throw("原盘点明细包含多个批次明细版本，请在 ERPNext 中核对")
			name = candidates[0] if candidates else None
	if not name:
		return None
	bundle = frappe.get_doc("Serial and Batch Bundle", name)
	bundle.check_permission("read")
	if bundle.item_code != row.item_code:
		frappe.throw("批次明细不属于此物品")
	for allocation in bundle.entries:
		if allocation.batch_no:
			if batch_checker:
				batch_checker(allocation.batch_no)
			else:
				frappe.get_doc("Batch", allocation.batch_no).check_permission("read")
	return bundle


def reconciliation_allocations(row, *, batch_checker=None):
	"""Join recorded book/actual bundles, including book batches counted as zero.

	The book bundle reverses the previous quantities (negative for positive stock).
	Do not query today's ledger: a cancelled count must retain its original baseline.
	"""
	current = entry_bundle(row, "current_serial_and_batch_bundle", batch_checker=batch_checker)
	actual = entry_bundle(row, batch_checker=batch_checker)
	if not current and not actual:
		baseline = float(row.get("current_qty") or 0)
		quantity = float(row.get("qty") or 0)
		return [
			{
				"batch_no": row.get("batch_no") or "",
				"baseline_qty": baseline,
				"actual_qty": quantity,
				"difference": quantity - baseline,
				"bundle_line": "",
				"current_bundle_line": "",
			}
		]
	allocations = {}
	for bundle, quantity_field, identity_field, sign in (
		(current, "baseline_qty", "current_bundle_line", -1),
		(actual, "actual_qty", "bundle_line", 1),
	):
		for entry in bundle.entries if bundle else []:
			batch = entry.batch_no or ""
			allocation = allocations.setdefault(
				batch,
				{
					"batch_no": batch,
					"baseline_qty": 0.0,
					"actual_qty": 0.0,
					"bundle_line": "",
					"current_bundle_line": "",
				},
			)
			allocation[quantity_field] += sign * float(entry.qty)
			allocation[identity_field] = allocation[identity_field] or entry.name
	for allocation in allocations.values():
		allocation["difference"] = allocation["actual_qty"] - allocation["baseline_qty"]
	return [allocations[batch] for batch in sorted(allocations)]


def stock_balance(item_code, warehouse, timestamp, *, lock=False):
	posting = get_datetime(timestamp)
	row = get_previous_sle(
		frappe._dict(
			item_code=item_code, warehouse=warehouse, posting_date=posting.date(), posting_time=posting.time()
		),
		for_update=lock,
	)
	return float(row.get("qty_after_transaction") or 0)


def batch_balances(item_code, warehouse, timestamp, *, lock=False, include_zero=False):
	from frappe.query_builder.functions import Sum

	ledger = frappe.qb.DocType("Stock Ledger Entry")
	entry = frappe.qb.DocType("Serial and Batch Entry")
	condition = (
		(ledger.item_code == item_code)
		& (ledger.warehouse == warehouse)
		& (ledger.is_cancelled == 0)
		& (ledger.docstatus == 1)
		& (ledger.posting_datetime <= get_datetime(timestamp))
	)
	modern = (
		frappe.qb.from_(ledger)
		.join(entry)
		.on(ledger.serial_and_batch_bundle == entry.parent)
		.select(entry.batch_no, Sum(entry.qty).as_("qty"))
		.where(condition & (entry.docstatus == 1) & (entry.is_cancelled == 0) & entry.batch_no.isnotnull())
		.groupby(entry.batch_no)
	)
	legacy = (
		frappe.qb.from_(ledger)
		.select(ledger.batch_no, Sum(ledger.actual_qty).as_("qty"))
		.where(condition & ledger.serial_and_batch_bundle.isnull() & ledger.batch_no.isnotnull())
		.groupby(ledger.batch_no)
	)
	if lock:
		modern, legacy = modern.for_update(), legacy.for_update()
	result = defaultdict(float)
	for query in (modern, legacy):
		for row in query.run(as_dict=True):
			if row.batch_no:
				result[row.batch_no] += float(row.qty or 0)
	return [
		{"batch_no": batch, "qty": quantity}
		for batch, quantity in sorted(result.items())
		if quantity or include_zero
	]


def lock_stock_locations(doc, method=None):
	"""Coordinate counts with ordinary native stock submissions in either editor."""
	if doc.doctype not in (
		"Stock Entry",
		"Stock Reconciliation",
		"Purchase Receipt",
		"Purchase Invoice",
		"Delivery Note",
		"Sales Invoice",
		"Subcontracting Receipt",
		"Stock Reservation Entry",
	):
		return
	locations = set()
	for row in doc.get("items") or []:
		for field in ("warehouse", "s_warehouse", "t_warehouse"):
			if row.get(field):
				locations.add(row.get(field))
	count_warehouses = doc.get("ti_count_warehouses") or []
	if isinstance(count_warehouses, str):
		count_warehouses = frappe.parse_json(count_warehouses) or []
	locations.update(name for name in count_warehouses if name)
	for location in sorted(locations):
		frappe.db.get_value("Warehouse", location, "name", for_update=True)
