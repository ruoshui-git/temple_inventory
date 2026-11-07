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


def entry_bundle(
	row, fieldname="serial_and_batch_bundle", *, batch_checker=None, bundle_cache=None, bundle_loader=None
):
	"""Resolve the exact original bundle even after native cancellation detaches it."""
	if fieldname not in ("serial_and_batch_bundle", "current_serial_and_batch_bundle"):
		raise ValueError("Unsupported native bundle field")
	name = row.get(fieldname)
	cache_key = (
		(fieldname, name)
		if name
		else (
			fieldname,
			row.get("parenttype") or row.get("doctype"),
			row.get("parent"),
			row.get("name"),
			row.get("warehouse") or row.get("s_warehouse") or row.get("t_warehouse"),
			row.get("_parent_docstatus"),
		)
	)
	if bundle_cache is not None and cache_key in bundle_cache:
		bundle = bundle_cache[cache_key]
		if bundle and bundle.item_code != row.get("item_code"):
			frappe.throw("批次明细不属于此物品")
		return bundle
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
		if not frappe.has_permission("Stock Reconciliation", "read"):
			return None
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
		if bundle_cache is not None:
			bundle_cache[cache_key] = None
		return None
	bundle = bundle_loader(name) if bundle_loader else None
	bundle = bundle or frappe.get_doc("Serial and Batch Bundle", name)
	bundle.check_permission("read")
	if bundle.item_code != row.get("item_code"):
		frappe.throw("批次明细不属于此物品")
	for allocation in bundle.entries:
		if allocation.batch_no:
			if batch_checker:
				batch_checker(allocation.batch_no)
			else:
				frappe.get_doc("Batch", allocation.batch_no).check_permission("read")
	if bundle_cache is not None:
		bundle_cache[cache_key] = bundle
	return bundle


def reconciliation_allocations(row, *, batch_checker=None, bundle_cache=None, bundle_loader=None):
	"""Join recorded book/actual bundles, including book batches counted as zero.

	The book bundle reverses the previous quantities (negative for positive stock).
	Do not query today's ledger: a cancelled count must retain its original baseline.
	"""
	current = entry_bundle(
		row,
		"current_serial_and_batch_bundle",
		batch_checker=batch_checker,
		bundle_cache=bundle_cache,
		bundle_loader=bundle_loader,
	)
	actual = entry_bundle(
		row, batch_checker=batch_checker, bundle_cache=bundle_cache, bundle_loader=bundle_loader
	)
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


def ledger_rows_at(warehouses, timestamp):
	"""Latest running balance per Item/warehouse at one posting boundary (get_previous_sle order)."""
	return frappe.db.sql(
		"""select item_code, warehouse, qty_after_transaction as qty from (
			select item_code, warehouse, qty_after_transaction, row_number() over (
				partition by item_code, warehouse order by posting_datetime desc, creation desc
			) as position
			from `tabStock Ledger Entry`
			where warehouse in %(warehouses)s and is_cancelled = 0 and posting_datetime <= %(posting)s
		) latest where position = 1""",
		{"warehouses": tuple(warehouses), "posting": get_datetime(timestamp)},
		as_dict=True,
	)


def batch_rows_at(warehouses, timestamp):
	"""Signed batch quantities per Item/warehouse/batch, from bundles and legacy batch_no rows.

	Rows are not merged across the two sources; callers sum them per batch.
	"""
	args = {"warehouses": tuple(warehouses), "posting": get_datetime(timestamp)}
	return frappe.db.sql(
		"""select sle.item_code, sle.warehouse, sbe.batch_no, sum(sbe.qty) as qty
		from `tabStock Ledger Entry` sle
		inner join `tabSerial and Batch Entry` sbe on sbe.parent = sle.serial_and_batch_bundle
		where sle.warehouse in %(warehouses)s and sle.is_cancelled = 0 and sle.docstatus = 1
		and sle.posting_datetime <= %(posting)s and sle.serial_and_batch_bundle is not null
		and sbe.docstatus = 1 and sbe.is_cancelled = 0 and sbe.batch_no is not null
		group by sle.item_code, sle.warehouse, sbe.batch_no
		union all
		select item_code, warehouse, batch_no, sum(actual_qty) as qty
		from `tabStock Ledger Entry`
		where warehouse in %(warehouses)s and is_cancelled = 0 and docstatus = 1
		and posting_datetime <= %(posting)s and serial_and_batch_bundle is null
		and batch_no is not null group by item_code, warehouse, batch_no""",
		args,
		as_dict=True,
	)


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


def serial_balances(item_code, warehouse, timestamp, *, lock=False, include_zero=False):
	"""Resolve serial ownership at a posting boundary from signed native bundle entries."""
	from frappe.query_builder.functions import Sum

	ledger = frappe.qb.DocType("Stock Ledger Entry")
	entry = frappe.qb.DocType("Serial and Batch Entry")
	query = (
		frappe.qb.from_(ledger)
		.join(entry)
		.on(ledger.serial_and_batch_bundle == entry.parent)
		.select(entry.serial_no, Sum(entry.qty).as_("qty"))
		.where(
			(ledger.item_code == item_code)
			& (ledger.warehouse == warehouse)
			& (ledger.is_cancelled == 0)
			& (ledger.docstatus == 1)
			& (ledger.posting_datetime <= get_datetime(timestamp))
			& entry.serial_no.isnotnull()
			& (entry.docstatus == 1)
			& (entry.is_cancelled == 0)
		)
		.groupby(entry.serial_no)
	)
	if lock:
		query = query.for_update()
	return [
		{"serial_no": row.serial_no, "qty": float(row.qty or 0)}
		for row in query.run(as_dict=True)
		if row.qty or include_zero
	]


def serial_balances_by_location(warehouses, timestamp, *, lock=False, include_zero=False):
	"""Resolve all serialized Item/warehouse balances at one posting boundary."""
	from frappe.query_builder.functions import Sum

	ledger = frappe.qb.DocType("Stock Ledger Entry")
	entry = frappe.qb.DocType("Serial and Batch Entry")
	item = frappe.qb.DocType("Item")
	query = (
		frappe.qb.from_(ledger)
		.join(entry)
		.on(ledger.serial_and_batch_bundle == entry.parent)
		.join(item)
		.on(item.name == ledger.item_code)
		.select(ledger.item_code, ledger.warehouse, entry.serial_no, Sum(entry.qty).as_("qty"))
		.where(
			(ledger.warehouse.isin(warehouses))
			& (ledger.is_cancelled == 0)
			& (ledger.docstatus == 1)
			& (ledger.posting_datetime <= get_datetime(timestamp))
			& entry.serial_no.isnotnull()
			& (entry.docstatus == 1)
			& (entry.is_cancelled == 0)
			& (item.has_serial_no == 1)
			& (item.disabled == 0)
			& (item.is_stock_item == 1)
		)
		.groupby(ledger.item_code, ledger.warehouse, entry.serial_no)
	)
	if lock:
		query = query.for_update()
	return [
		{
			"item_code": row.item_code,
			"warehouse": row.warehouse,
			"serial_no": row.serial_no,
			"qty": float(row.qty or 0),
		}
		for row in query.run(as_dict=True)
		if row.qty or include_zero
	]


def reconciliation_serial_allocations(row, *, bundle_cache=None, bundle_loader=None):
	"""Join the book and counted serial sets stored in native reconciliation bundles."""
	current = entry_bundle(
		row,
		"current_serial_and_batch_bundle",
		bundle_cache=bundle_cache,
		bundle_loader=bundle_loader,
	)
	actual = entry_bundle(row, bundle_cache=bundle_cache, bundle_loader=bundle_loader)
	book = sorted({entry.serial_no for entry in current.entries if entry.serial_no} if current else [])
	present = sorted(
		{entry.serial_no for entry in actual.entries if entry.serial_no}
		if actual
		else set(filter(None, (row.get("serial_no") or "").splitlines()))
	)
	return {
		"baseline_serials": book,
		"actual_serials": present,
		"missing_serials": sorted(set(book) - set(present)),
		"found_serials": sorted(set(present) - set(book)),
	}


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
	locations.update(row.get("warehouse") for row in doc.get("ti_count_review") or [] if row.get("warehouse"))
	for location in sorted(locations):
		frappe.db.get_value("Warehouse", location, "name", for_update=True)
