"""Opt-in, rollback-only lock acceptance against the authorized native sample site.

Each contender owns a separate Frappe context and MariaDB connection. This checks
real lock contention and authoritative rejection, without committing test stock.
It does not claim two successful stock submissions racing through a commit.
"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event
from uuid import uuid4

import frappe
from frappe.utils import now_datetime


def _contend(holder, contender, doctype, name):
	site, sites_path = frappe.local.site, str(Path(frappe.local.sites_path).resolve())
	locked, started, finished, release = Event(), Event(), Event(), Event()
	connections = []

	def connect(action, holding=False):
		frappe.init(site=site, sites_path=sites_path)
		frappe.connect()
		frappe.set_user("Administrator")
		try:
			connections.append(frappe.db.sql("select connection_id()")[0][0])
			if holding:
				action()
				locked.set()
				assert release.wait(15), "Contender did not release the native lock"
			else:
				# Observe the real locking SQL at the contested native identity. Do
				# not count unrelated setup/permission queries as time spent waiting.
				original_sql = frappe.db.sql

				def observe_lock(query, *args, **kwargs):
					statement = str(query).casefold()
					values = kwargs.get("values", args[0] if args else None)
					if (
						f"tab{doctype}".casefold() in statement
						and "for update" in statement
						and (name in str(values) or name.casefold() in statement)
					):
						started.set()
					return original_sql(query, *args, **kwargs)

				frappe.db.sql = observe_lock
				return action()
		finally:
			frappe.db.rollback()
			frappe.destroy()
			if not holding:
				finished.set()

	with ThreadPoolExecutor(max_workers=2) as pool:
		owner = pool.submit(connect, holder, True)
		try:
			assert locked.wait(10), "Native lock holder did not start"
			waiting = pool.submit(connect, contender)
			assert started.wait(10), "Independent contender did not start"
			assert not finished.wait(0.5), "Native write did not wait for the competing transaction"
		finally:
			release.set()
		owner.result(timeout=15)
		result = waiting.result(timeout=30)
	assert len(set(connections)) == 2, "Acceptance must use independent database connections"
	return result


def run():
	from temple_inventory import activities, counts, native_api
	from temple_inventory.native_balances import lock_stock_locations
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	frappe.set_user("Administrator")
	warehouse, item_code = "A02 / 无货位 - O", "TI-SAMPLE-N-WORKFLOW"
	loan_name = "MAT-STE-2026-00005"
	loan = frappe.get_doc("Stock Entry", loan_name)
	activity_name = loan.ti_activity
	assert loan.docstatus == 1 and loan.ti_movement_kind == "Loan"
	assert loan.items[0].item_code == item_code
	before = {doctype: frappe.db.count(doctype) for doctype in ("Stock Entry", "Stock Reconciliation")}

	def stock_lock():
		lock_stock_locations(frappe._dict(doctype="Stock Entry", items=[frappe._dict(s_warehouse=warehouse)]))

	def matching_count():
		posting = now_datetime()
		baseline = counts.count_baseline([warehouse], str(posting), "Selected", [item_code])
		for row in baseline["rows"]:
			row.update(actual_qty=row["baseline_qty"], review_state="Reviewed")
		return counts.save_count(
			str(uuid4()),
			{
				"company": loan.company,
				"posting_date": str(posting.date()),
				"posting_time": str(posting.time()),
				"ti_count_warehouses": [warehouse],
				"ti_count_scope": "Selected",
				"ti_count_items": [item_code],
				"ti_baseline_timestamp": baseline["timestamp"],
				"ti_baseline_fingerprint": baseline["fingerprint"],
				"ti_count_review": baseline["rows"],
			},
		)

	assert _contend(stock_lock, matching_count, "Warehouse", warehouse)["no_adjustment"]

	def invalid_movement(settlement=False):
		posting = now_datetime()
		row = {
			"item_code": item_code,
			"qty": 12 if settlement else 100000,
			"uom": loan.items[0].stock_uom,
			"conversion_factor": 1,
			"s_warehouse": loan.items[0].t_warehouse if settlement else warehouse,
		}
		if settlement:
			row.update(
				t_warehouse=warehouse,
				ti_original_loan=loan_name,
				ti_original_loan_line=loan.items[0].name,
				ti_settlement_outcome="Returned",
			)
		try:
			native_api.create_document(
				"Stock Entry",
				str(uuid4()),
				{
					"company": loan.company,
					"posting_date": str(posting.date()),
					"posting_time": str(posting.time()),
					"ti_movement_kind": "Return" if settlement else "Issue",
					"ti_borrower": loan.ti_borrower if settlement else "",
					"ti_activity": loan.ti_activity if settlement else "",
					"items": [row],
				},
			)
		except frappe.ValidationError as error:
			assert ("未归还数量" if settlement else "可用数量") in str(error)
			return "rejected"
		raise AssertionError("Invalid native quantities were accepted")

	assert _contend(stock_lock, invalid_movement, "Warehouse", warehouse) == "rejected"
	assert (
		_contend(
			lambda: frappe.get_doc("Stock Entry", loan_name, for_update=True),
			lambda: invalid_movement(True),
			"Stock Entry",
			loan_name,
		)
		== "rejected"
	)

	def delete_referenced_activity():
		doc = frappe.get_doc("Inventory Activity", activity_name)
		try:
			activities.delete_activity(activity_name, str(doc.modified))
		except frappe.LinkExistsError:
			return "rejected"
		raise AssertionError("Referenced native Activity was deleted")

	assert (
		_contend(
			lambda: activities.lock_document_references(frappe.get_doc("Stock Entry", loan_name)),
			delete_referenced_activity,
			"Inventory Activity",
			activity_name,
		)
		== "rejected"
	)
	after = {doctype: frappe.db.count(doctype) for doctype in before}
	assert after == before
	assert frappe.db.exists("Inventory Activity", activity_name)
	return {"scenarios": 4, "independent_connections": True, "all_rolled_back": True}
