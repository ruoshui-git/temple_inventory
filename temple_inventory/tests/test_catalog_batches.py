"""Native supporting records, full-dataset search and dashboard integration."""

from unittest.mock import patch
from uuid import uuid4

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from frappe.utils import add_days, getdate, now_datetime, nowdate

from temple_inventory import (
	browse,
	catalog,
	counts,
	native_api,
	projections,
)
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogBatchesTests(NativeDocumentTests):
	def test_operation_items_batches_accessible_items_and_per_code_errors(self):
		result = catalog.operation_items([self.item, "missing-item-for-batch-test"])
		self.assertEqual([row["item_code"] for row in result["items"]], [self.item])
		self.assertEqual(result["errors"][0]["item_code"], "missing-item-for-batch-test")
		self.assertIn("error", result["errors"][0])

	def test_expiry_tracking_requires_dated_batches_and_batch_tracking_cannot_be_removed(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = catalog.save_item(
			{
				"item_code": f"TI-EXPIRY-GUARD-{self.token}",
				"item_name": "Expiry guard",
				"stock_uom": "Nos",
				"has_batch_no": 1,
			}
		)
		catalog.create_batch(item["item_code"], f"TI-UNDATED-{self.token}")
		current = frappe.get_doc("Item", item["item_code"])
		with self.assertRaises(frappe.ValidationError):
			catalog.save_item(
				{"has_expiry_date": 1}, item_code=item["item_code"], version=str(current.modified)
			)
		with self.assertRaises(frappe.ValidationError):
			catalog.save_item({"has_batch_no": 0}, item_code=item["item_code"], version=str(current.modified))

	def test_receipt_batches_are_idempotent_and_use_the_daily_series(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = catalog.save_item(
			{
				"item_code": f"TI-BATCH-REQUEST-{self.token}",
				"item_name": "Batch request",
				"stock_uom": "Nos",
				"has_batch_no": 1,
			}
		)
		row = {
			"item_code": item["item_code"],
			"batch_id": "",
			"local_id": "line-stable-1",
			"manufacturing_date": None,
			"expiry_date": None,
		}
		first = catalog.receipt_batches([row])["batches"][0]
		second = catalog.receipt_batches([row])["batches"][0]
		self.assertEqual(first["name"], second["name"])
		self.assertRegex(first["name"], r"^\d{8}-\d{3}$")

	def test_generated_receipt_batch_dates_can_be_updated_on_the_same_request(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = catalog.save_item(
			{
				"item_code": f"TI-BATCH-DATE-REQUEST-{self.token}",
				"item_name": "Batch date request",
				"stock_uom": "Nos",
				"has_batch_no": 1,
				"has_expiry_date": 1,
			}
		)
		row = {
			"item_code": item["item_code"],
			"batch_id": "",
			"local_id": "stable-date-line",
			"manufacturing_date": nowdate(),
			"expiry_date": add_days(nowdate(), 30),
		}
		first = catalog.receipt_batches([row])["batches"][0]
		updated_row = {
			**row,
			"batch_id": first["name"],
			"local_id": "native-child-after-reopen",
			"manufacturing_date": add_days(nowdate(), 1),
			"expiry_date": add_days(nowdate(), 45),
		}
		updated = catalog.receipt_batches([updated_row])["batches"][0]
		self.assertEqual(updated["name"], first["name"])
		self.assertEqual(updated["manufacturing_date"], str(getdate(updated_row["manufacturing_date"])))
		self.assertEqual(updated["expiry_date"], str(getdate(updated_row["expiry_date"])))
		with self.assertRaises(frappe.ValidationError):
			catalog.receipt_batches(
				[
					{
						**updated_row,
						"manufacturing_date": add_days(nowdate(), 60),
					}
				]
			)

	def test_item_and_batch_location_views_do_not_request_zero_rows(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		frappe.db.set_value("Item", self.item, "has_batch_no", 1)
		batch = catalog.create_batch(self.item, f"TI-ZERO-{self.token}")
		queries = []
		with patch(
			"temple_inventory.catalog.report_page",
			side_effect=lambda query, **_kwargs: (queries.append(query) or {}),
		):
			catalog.item_detail(self.item)
			catalog.batch_details(batch["name"])
			catalog.batch_locations(batch["name"])
		self.assertTrue(queries)
		self.assertTrue(all(query.get("includeZero") is not True for query in queries))

	def test_batch_amendment_creates_a_new_native_bundle_and_preserves_original_provenance(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, "TI-AMEND-" + self.token)
		data = self.movement(quantity=4)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		completed = self.submit(self.create(data))
		original_bundle = completed["items"][0].serial_and_batch_bundle
		cancelled = native_api.cancel_document("Stock Entry", completed.name, completed.version)
		amended = native_api.amend_document("Stock Entry", cancelled.name, cancelled.version, str(uuid4()))
		self.assertNotEqual(amended["items"][0].serial_and_batch_bundle, original_bundle)
		self.assertEqual(
			frappe.db.get_value("Serial and Batch Bundle", original_bundle, "voucher_no"), completed.name
		)
		posted = self.submit(amended)
		self.assertEqual(posted["items"][0].transfer_qty, 4)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 4)

	def test_expired_receipt_and_batch_count_use_native_bundles(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no, item.has_expiry_date = 1, 1
		item.save()
		batch = catalog.create_batch(
			self.item, "TI-BATCH-" + self.token, add_days(nowdate(), -100), add_days(nowdate(), -10)
		)
		data = self.movement(quantity=4)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		draft = self.create(data)
		completed = self.submit(draft)
		self.assertEqual(completed.docstatus, 1)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 4)
		data = self.count_data(3, "Reviewed")
		self.assertEqual(data["ti_count_review"][0]["batch_no"], batch["name"])
		doc = counts.save_count(str(uuid4()), data)
		native_api.submit_document("Stock Reconciliation", doc.name, doc.version)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 3)

	def test_dashboard_uses_native_stock_scoped_distinct_items_and_six_expiry_buckets(self):
		self.receipt(10)
		self.submit(self.create(self.movement("Transfer", 3, self.a, self.b)))
		scope = {"warehouses": [self.root]}
		inventory = browse.dashboard_card("inventory", scope)
		self.assertEqual(sum(row["stock_qty"] for row in inventory["totals"]), 10)
		distribution = browse.dashboard_card("distribution", scope)
		self.assertEqual(distribution["item_count"], 1)
		self.assertEqual(sum(row["item_count"] for row in distribution["rows"]), 2)
		self.assertEqual(len(browse.dashboard_card("expiry", scope)["buckets"]), 6)
		self.assertEqual(browse.dashboard_card("movement", scope)["matched_count"], 2)
		recent = browse.dashboard_card("movement", scope)["rows"][0]
		self.assertEqual(recent["item_count"], 1)
		self.assertIsInstance(recent["item_names"], list)
		self.assertLessEqual(len(recent["item_names"]), 2)
		self.assertIn(self.a, browse.bootstrap()["physical_leaves"])
		bootstrap = browse.bootstrap()
		self.assertIn(self.loan_leaf, {row["name"] for row in bootstrap["warehouses"]})
		permission = frappe.has_permission
		with patch(
			"frappe.has_permission",
			side_effect=lambda doctype, ptype="read", *args, **kwargs: (
				False
				if doctype == "Stock Entry" and ptype == "submit"
				else permission(doctype, ptype, *args, **kwargs)
			),
		):
			bootstrap = browse.bootstrap()
			self.assertTrue(bootstrap["operations"]["Receive"])
			self.assertTrue(bootstrap["operations"]["Return"])
			self.assertNotIn("stock_entry_submit", bootstrap["operation_requirements"]["Return"])

	def test_multi_batch_native_loan_keeps_original_line_and_per_batch_outcomes(self):
		from temple_inventory.projections import report_page

		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batches = []
		for suffix, quantity in (("A", 3), ("B", 7)):
			batch = catalog.create_batch(self.item, f"TI-MULTI-{self.token}-{suffix}")
			batches.append(batch["name"])
			data = self.movement(quantity=quantity)
			data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		bundle = frappe.get_doc(
			{
				"doctype": "Serial and Batch Bundle",
				"voucher_type": "Stock Entry",
				"company": self.company,
				"item_code": self.item,
				"warehouse": self.a,
				"type_of_transaction": "Outward",
				"posting_datetime": frappe.utils.now_datetime(),
				"entries": [{"batch_no": batches[0], "qty": -2}, {"batch_no": batches[1], "qty": -3}],
			}
		).insert()
		data = self.movement("Loan", 5, self.a, self.loan_leaf, ti_borrower="Batch Borrower")
		data["items"][0].update({"serial_and_batch_bundle": bundle.name, "use_serial_batch_fields": 0})
		loan = self.submit(self.create(data))
		original_line = loan["items"][0].name
		# Another loan makes extra A stock physically available, but does not let
		# the first original line settle more A than its own allocated amount.
		second = self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="Batch Borrower")
		second["items"][0].update({"batch_no": batches[0], "use_serial_batch_fields": 1})
		self.submit(self.create(second))
		data = self.movement("Return", 3, self.loan_leaf, self.b, ti_borrower="Batch Borrower")
		data["posting_date"] = add_days(nowdate(), 1)
		data["items"][0].update(
			{
				"batch_no": batches[0],
				"use_serial_batch_fields": 1,
				"ti_original_loan": loan.name,
				"ti_original_loan_line": original_line,
				"ti_settlement_outcome": "Returned",
			}
		)
		with self.assertRaises(frappe.ValidationError):
			self.create(data)
		data["items"][0]["qty"] = 2
		second_line = dict(data["items"][0], batch_no=batches[1], qty=1)
		data["items"].append(second_line)
		self.submit(self.create(data))
		detail = native_api.loan_detail(loan.name)
		allocations = {row["batch_no"]: row for row in detail["items"][0]["allocations"]}
		self.assertEqual(allocations[batches[0]]["outstanding_qty"], 0)
		self.assertEqual(allocations[batches[1]]["outstanding_qty"], 2)
		# Settled batches keep their outcome rows only in the all-status view.
		query = {"dataset": "loans", "view": "outcomes", "loan": loan.name, "loanStatus": "all"}
		rows = report_page(query)["rows"]
		self.assertEqual({row["original_loan_line"] for row in rows}, {original_line})
		self.assertEqual(
			{row["batch_no"]: row["outstanding"] for row in rows}, {batches[0]: 0, batches[1]: 2}
		)
		batch_history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"loan": loan.name,
				"scope": {"item": self.item},
				"batchNo": batches[1],
			},
			item_code=self.item,
			batch_no=batches[1],
		)
		self.assertTrue(batch_history["history_complete"])
		item_history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"loan": loan.name,
				"scope": {"item": self.item},
			},
			item_code=self.item,
		)
		self.assertTrue(item_history["history_complete"])
		item_query = {
			"dataset": "loans",
			"view": "items",
			"loan": loan.name,
			"scope": {"period": {"key": "custom", "from": nowdate(), "to": nowdate()}},
			"relatedPeriod": {"key": "custom", "from": "1900-01-01", "to": "1900-01-02"},
			"itemLocationKeys": [f'["{self.item}","{self.a}"]'],
		}
		item_page = browse.operation_page(item_query)
		self.assertEqual(item_page["matched_count"], 1)
		self.assertEqual(item_page["rows"][0]["stock_qty"], 2)
		self.assertEqual(item_page["rows"][0]["document_count"], 1)
		history = browse.operation_contributions(item_query, item_code=self.item, history_sort="asc")
		self.assertEqual(history["matched_count"], 1)
		self.assertTrue(history["history_complete"])
		self.assertEqual([row["quantity"] for row in history["rows"]], [3.0])
		self.assertEqual([row["stock_uom"] for row in history["rows"]], ["Nos"])
		self.assertEqual(history["rows"][0]["signed"], True)
		self.assertEqual([row["kind"] for row in history["rows"]], ["Loan"])
		# The ungrouped outstanding list is the 借出清单: open loan lines only, with borrower.
		loan_list = browse.operation_contributions(item_query, history_sort="asc")
		self.assertTrue(loan_list["history_complete"])
		self.assertEqual([row["kind"] for row in loan_list["rows"]], ["Loan"])
		self.assertEqual(loan_list["rows"][0]["borrower"], loan.ti_borrower)
		self.assertEqual(loan_list["rows"][0]["outstanding"], 2.0)
		all_query = {**item_query, "loanStatus": "all"}
		all_item_history = browse.operation_contributions(all_query, item_code=self.item, history_sort="asc")
		self.assertEqual([row["quantity"] for row in all_item_history["rows"]], [5.0, -3.0])
		all_history = browse.operation_contributions(all_query, item_code=self.item, history_sort="asc")
		self.assertEqual([row["quantity"] for row in all_history["rows"]], [5.0, -3.0])

		settled_item = frappe.copy_doc(frappe.get_doc("Item", self.item))
		settled_item.item_code = self.item + "-SETTLED"
		settled_item.item_name = "Settled " + self.item
		settled_item.has_batch_no = settled_item.has_expiry_date = 0
		settled_item.insert()
		receipt = self.movement(quantity=2)
		receipt["items"][0]["item_code"] = settled_item.name
		self.submit(self.create(receipt))
		settled_loan_data = self.movement("Loan", 2, self.a, self.loan_leaf, ti_borrower="Settled Borrower")
		settled_loan_data["items"][0]["item_code"] = settled_item.name
		settled_loan = self.submit(self.create(settled_loan_data))
		settled_return = self.movement("Return", 2, self.loan_leaf, self.b, ti_borrower="Settled Borrower")
		settled_return["items"][0].update(
			{
				"item_code": settled_item.name,
				"ti_original_loan": settled_loan.name,
				"ti_original_loan_line": settled_loan["items"][0].name,
				"ti_settlement_outcome": "Returned",
			}
		)
		self.submit(self.create(settled_return))
		settled_query = {"dataset": "loans", "view": "items", "scope": {"item": settled_item.name}}
		self.assertEqual(browse.operation_page(settled_query)["matched_count"], 0)
		settled_query = {**settled_query, "loanStatus": "settled"}
		settled_page = browse.operation_page(settled_query)
		self.assertEqual(settled_page["matched_count"], 1)
		self.assertEqual(settled_page["rows"][0]["stock_qty"], 0)
		canonical = projections.report_page(
			{
				**settled_query,
				"statuses": [0, 2],
				"loanOutcome": "lost",
				"loanStatus": "settled",
				"outstandingOnly": True,
			}
		)
		self.assertEqual(canonical["query"]["statuses"], [1])
		self.assertEqual(canonical["query"]["loanOutcome"], "lost")
		self.assertEqual(canonical["query"]["loanStatus"], "settled")
		self.assertFalse(canonical["query"]["outstandingOnly"])
		self.assertEqual(canonical["table"], "loan_items")
		self.assertIn("outstanding", canonical["columns"])
		self.assertIn("item_name", canonical["columns"])
		self.assertNotIn("loan_item_page", {table["id"] for table in canonical["tables"]})
		self.assertNotIn("linked_settlements", {table["id"] for table in canonical["tables"]})
		self.assertEqual(projections.report_page(settled_query)["table"], "loan_items")
		settled_projection = projections.report_page(settled_query)
		self.assertEqual(settled_projection["matched_count"], settled_page["matched_count"])
		self.assertEqual(settled_projection["rows"][0]["stock_qty"], settled_page["rows"][0]["stock_qty"])
		for grouping, expected in (("activity", ""), ("month", nowdate()[:7])):
			grouped = projections.report_page({**settled_query, "view": "outcomes", "groupBy": [grouping]})
			self.assertEqual(grouped["table"], "grouped")
			self.assertEqual(grouped["matched_count"], 1)
			self.assertEqual(grouped["rows"][0][grouping], expected)

	def test_expiry_only_batch_keeps_blank_manufacturing_date_and_can_be_received(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(
			self.item,
			f"TI-EXPIRY-ONLY-{self.token}",
			expiry_date=add_days(nowdate(), 30),
		)
		self.assertEqual(batch["manufacturing_date"], "")
		data = self.movement(quantity=1)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		expired = catalog.create_batch(
			self.item,
			f"TI-EXPIRED-ONLY-{self.token}",
			expiry_date=add_days(nowdate(), -1),
		)
		self.assertEqual(expired["manufacturing_date"], "")
		self.assertEqual(expired["expiry_date"], add_days(nowdate(), -1))
		expired_receipt = self.movement(quantity=1)
		expired_receipt["items"][0].update({"batch_no": expired["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(expired_receipt))
		with self.assertRaises(frappe.ValidationError):
			catalog.create_batch(
				self.item,
				f"TI-REVERSED-DATES-{self.token}",
				manufacturing_date=add_days(nowdate(), -1),
				expiry_date=add_days(nowdate(), -2),
			)

	def test_expiry_browser_has_distinct_batch_facets_native_search_and_inclusive_dates(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batches = []
		for index, days in enumerate((-10, 0, 10, None)):
			batch = catalog.create_batch(
				self.item,
				f"TI-EXPIRY-{self.token}-{index}",
				manufacturing_date=add_days(nowdate(), -100),
				expiry_date=add_days(nowdate(), days) if days is not None else None,
			)
			batches.append(batch["name"])
			data = self.movement(quantity=4)
			data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		data = self.movement("Transfer", 2, self.a, self.b)
		data["items"][0].update({"batch_no": batches[1], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		batch_detail = catalog.batch_details(batches[1])
		batch_metadata = catalog.batch_metadata_many([batches[1]])[batches[1]]
		self.assertEqual(batch_metadata["name"], batch_detail["name"])
		self.assertNotIn("locations", batch_metadata)
		self.assertNotIn("history", batch_metadata)
		self.assertEqual(batch_detail["item_code"], self.item)
		self.assertTrue(batch_detail["can_edit"])
		self.assertEqual({row["batch_no"] for row in batch_detail["locations"]["rows"]}, {batches[1]})
		location_page = catalog.batch_locations(batches[1], start=0, page_length=1)
		self.assertGreaterEqual(location_page["matched_count"], 1)
		sorted_locations = catalog.batch_locations(
			batches[1], start=0, page_length=100, sort_by="available", sort="asc"
		)
		self.assertEqual(
			[float(row["available"]) for row in sorted_locations["rows"]],
			sorted(float(row["available"]) for row in sorted_locations["rows"]),
		)
		self.assertEqual(batch_detail["history"]["matched_count"], 2)
		before_batch_qty = {
			warehouse: get_batch_qty(batch_no=batches[1], warehouse=warehouse, for_stock_levels=True)
			for warehouse in (self.a, self.b)
		}
		old_version = batch_detail["version"]
		with self.assertRaises(frappe.ValidationError):
			catalog.save_batch(
				batches[1],
				old_version,
				{
					"manufacturing_date": add_days(nowdate(), -1),
					"expiry_date": add_days(nowdate(), -2),
					"description": "Invalid",
				},
			)
		batch_class = type(frappe.get_doc("Batch", batches[1]))
		check_permission = batch_class.check_permission
		with patch.object(
			batch_class,
			"check_permission",
			side_effect=lambda permission="read", *args, **kwargs: (
				(_ for _ in ()).throw(frappe.PermissionError("Batch write denied"))
				if permission == "write"
				else check_permission(permission, *args, **kwargs)
			),
		):
			with self.assertRaises(frappe.PermissionError):
				catalog.save_batch(
					batches[1],
					old_version,
					{"manufacturing_date": "", "expiry_date": "", "description": "Denied"},
				)
		item_class = type(frappe.get_doc("Item", self.item))
		item_check_permission = item_class.check_permission
		with patch.object(
			item_class,
			"check_permission",
			side_effect=lambda permission="read", *args, **kwargs: (
				(_ for _ in ()).throw(frappe.PermissionError("Item read denied"))
				if permission == "read"
				else item_check_permission(permission, *args, **kwargs)
			),
		):
			with self.assertRaises(frappe.PermissionError):
				catalog.batch_details(batches[1])
		saved_batch = catalog.save_batch(
			batches[1],
			old_version,
			{
				"manufacturing_date": batch_detail["manufacturing_date"],
				"expiry_date": batch_detail["expiry_date"],
				"description": "Reviewed lot",
			},
		)
		self.assertEqual(saved_batch["description"], "Reviewed lot")
		self.assertEqual(
			{
				warehouse: get_batch_qty(batch_no=batches[1], warehouse=warehouse, for_stock_levels=True)
				for warehouse in (self.a, self.b)
			},
			before_batch_qty,
		)
		with self.assertRaises(frappe.TimestampMismatchError):
			catalog.save_batch(
				batches[1], old_version, {"manufacturing_date": "", "expiry_date": "", "description": "Stale"}
			)
		query = {"dataset": "expiry", "scope": {"item": self.item}, "sortBy": "expiry_date"}
		page = browse.expiry_page(query, page_length=1)
		self.assertEqual(page["matched_count"], 5)
		self.assertEqual(page["batch_count"], 4)
		self.assertEqual(page["item_count"], 1)
		self.assertEqual(page["next_start"], 1)
		self.assertEqual(page["facets"], {"all": 4, "expired": 1, "unexpired": 2, "undated": 1})
		self.assertEqual(sum(row["available"] for row in page["totals"]), 16)
		self.assertEqual(page["analysis"]["warehouse"]["matched_count"], 2)
		self.assertEqual(browse.expiry_page({**query, "expiryWindow": "unexpired"})["batch_count"], 2)
		self.assertEqual(browse.expiry_page({**query, "expiryWindow": "undated"})["batch_count"], 1)
		search = browse.expiry_page({**query, "search": batches[1]})
		self.assertEqual(search["matched_count"], 2)
		self.assertEqual(search["facets"], {"all": 1, "expired": 0, "unexpired": 1, "undated": 0})
		exact_batch = browse.expiry_page({**query, "batchNo": batches[1]})
		self.assertEqual(exact_batch["matched_count"], 2)
		self.assertEqual({row["batch_no"] for row in exact_batch["rows"]}, {batches[1]})
		self.assertEqual(browse.expiry_page({**query, "batchNo": batches[1] + "-other"})["matched_count"], 0)
		exact = browse.expiry_page(
			{**query, "restrictAllocations": True, "allocationKeys": [search["rows"][0]["id"]]}
		)
		self.assertEqual(exact["matched_count"], 1)
		self.assertEqual(exact["rows"][0]["batch_no"], batches[1])
		window = {
			**query,
			"expiryWindow": "expired",
			"scope": {
				"item": self.item,
				"period": {"key": "custom", "from": nowdate(), "to": add_days(nowdate(), 1)},
			},
		}
		self.assertEqual(browse.expiry_page(window)["matched_count"], 0)
		self.assertEqual(browse.expiry_page(window)["facets"]["unexpired"], 1)
		self.assertEqual(
			browse.expiry_page({**query, "restrictAllocations": True, "allocationKeys": []})["matched_count"],
			0,
		)

	def test_explicit_zero_stock_batch_row_keeps_its_identity(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, "TI-ZERO-" + self.token)
		data = self.movement(quantity=2)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		data = self.movement("Issue", 2, self.a)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		query = {"dataset": "expiry", "scope": {"item": self.item}}
		self.assertEqual(browse.expiry_page(query)["batch_count"], 0)
		zero = browse.expiry_page({**query, "includeZero": True})
		self.assertEqual(zero["batch_count"], 1)
		self.assertEqual(zero["rows"][0]["batch_no"], batch["name"])
		self.assertEqual(zero["rows"][0]["stock_qty"], 0)
		posting = now_datetime()
		baseline = counts.count_baseline(str(posting))
		zero_row = {
			"item_code": self.item,
			"warehouse": self.a,
			"batch_no": batch["name"],
			"stock_uom": frappe.get_cached_value("Item", self.item, "stock_uom"),
			"baseline_qty": 0,
			"actual_qty": 1,
			"review_state": "Reviewed",
			"reason": "人工加入零库存批次",
		}
		self.assertNotIn(batch["name"], {row["batch_no"] for row in baseline["rows"]})
		rows = [*baseline["rows"], zero_row]
		data = {
			"company": self.company,
			"posting_date": str(posting.date()),
			"posting_time": str(posting.time()),
			"ti_time_mode": "Historical",
			"ti_count_review": rows,
		}
		draft = counts.save_count(str(uuid4()), data)
		completed = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		self.assertEqual(completed["items"][0].valuation_rate, 10)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 1)
