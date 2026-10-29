"""Native supporting records, full-dataset search and dashboard integration."""

import copy
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.utils import add_days, now_datetime, nowdate

from temple_inventory import (
	browse,
	catalog,
	conversions,
	counts,
	native_api,
)
from temple_inventory.report_sources import ReportContext
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogItemsTests(NativeDocumentTests):
	def test_operation_items_filters_an_item_permission_failure_per_code(self):
		blocked = catalog.save_item(
			{"item_code": f"TI-BLOCKED-{self.token}", "item_name": "Blocked", "stock_uom": "Nos"}
		)["item_code"]
		from frappe.model.document import Document

		original = Document.check_permission

		def check_permission(doc, permtype="read", permlevel=None):
			if doc.doctype == "Item" and doc.name == blocked and permtype == "read":
				raise frappe.PermissionError
			return original(doc, permtype, permlevel)

		with patch.object(Document, "check_permission", autospec=True, side_effect=check_permission):
			result = catalog.operation_items([self.item, blocked])
		self.assertEqual([row["item_code"] for row in result["items"]], [self.item])
		self.assertEqual(result["errors"][0]["item_code"], blocked)

	def test_blank_item_code_uses_the_native_item_series(self):
		result = catalog.save_item({"item_name": "Generated code", "stock_uom": "Nos"})
		self.assertRegex(result["item_code"], r"^ITM-\d{6}$")

	def test_duplicate_preserves_recorded_factor_without_item_write_and_does_not_authorize_other_creations(
		self,
	):
		unit = catalog.create_uom("Copy Package " + self.token, True)["name"]
		item = frappe.get_doc("Item", self.item)
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 5}])
		data = self.movement(quantity=2)
		data["items"][0].update({"uom": unit, "conversion_factor": 5})
		original = self.submit(self.create(data))
		item.reload()
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 8}])
		permission = frappe.has_permission
		request_id = str(uuid4())
		with patch(
			"frappe.has_permission",
			side_effect=lambda dt, ptype="read", *args, **kwargs: (
				False if dt == "Item" and ptype == "write" else permission(dt, ptype, *args, **kwargs)
			),
		):
			copied = native_api.duplicate_document("Stock Entry", original.name, original.version, request_id)
			self.assertNotEqual(copied.name, original.name)
			self.assertEqual(copied.docstatus, 0)
			self.assertFalse(copied.amended_from)
			self.assertFalse(copied.ti_confirmation_version)
			self.assertNotEqual(copied["items"][0].name, original["items"][0].name)
			self.assertEqual(copied["items"][0].conversion_factor, 5)
			self.assertEqual(copied["items"][0].qty, 2)
			self.assertEqual(
				native_api.duplicate_document(
					"Stock Entry", original.name, original.version, request_id
				).name,
				copied.name,
			)
			with self.assertRaises(frappe.TimestampMismatchError):
				native_api.duplicate_document("Stock Entry", original.name, "stale", str(uuid4()))
			with self.assertRaises(frappe.PermissionError):
				self.create(data)
			copied = native_api.save_document("Stock Entry", copied.name, copied.version, {"remarks": "copy"})
			self.assertEqual(self.submit(copied)["items"][0].conversion_factor, 5)
		self.assertEqual(frappe.get_doc("Item", self.item).uoms[-1].conversion_factor, 8)

	def test_timestamped_item_stock_uses_the_balance_before_a_later_receipt(self):
		from temple_inventory.native_balances import stock_balance

		self.receipt(5)
		timestamp = add_days(nowdate(), -1) + " 23:59:59"
		self.assertEqual(stock_balance(self.item, self.a, timestamp), 0)
		result = catalog.operation_items([self.item], timestamp)["items"][0]
		self.assertFalse(any(row["warehouse"] == self.a for row in result["stock"]))

	def test_inventory_browser_pages_complete_totals_and_sorts_available_quantity(self):
		# Stock browse uses the same sanitized Item metadata as selectors and details.
		frappe.db.set_value("Item", self.item, "item_group", catalog.item_group_root())
		self.receipt(10)
		self.submit(self.create(self.movement("Loan", 9, self.a, self.loan_leaf, ti_borrower="Borrower")))
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "TI-BROWSE-" + self.token,
				"item_name": "Second Item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		data = self.movement(quantity=3)
		data["items"][0]["item_code"] = other.name
		self.submit(self.create(data))
		query = {
			"dataset": "inventory",
			"sortBy": "available",
			"sort": "asc",
			"scope": {"warehouses": [self.root]},
		}
		result = browse.inventory_page(query, page_length=1)
		self.assertEqual(result["matched_count"], 2)
		self.assertEqual(result["rows"][0]["code"], self.item)
		self.assertEqual(result["rows"][0]["category"], "")
		self.assertEqual(result["rows"][0]["available"], 1)
		self.assertEqual(result["rows"][0]["loaned"], 9)
		self.assertEqual(sum(row["available"] for row in result["summary"]), 4)
		self.assertEqual(result["next_start"], 1)
		self.assertEqual(browse.inventory_page(query, start=1, page_length=1)["rows"][0]["code"], other.name)
		restricted = browse.inventory_page({**query, "restrictItems": True, "itemCodes": []})
		self.assertEqual(restricted["matched_count"], 0)
		self.assertEqual(restricted["rows"], [])

	def test_item_history_uses_only_effective_damage_and_loss_events_after_cancellation(self):
		receipt = self.movement(quantity=4)
		receipt.update({"posting_time": "08:00:00", "ti_time_mode": "Manual"})
		self.submit(self.create(receipt))
		loan_data = self.movement("Loan", 4, self.a, self.loan_leaf, ti_borrower="History")
		loan_data.update({"posting_time": "09:00:00", "ti_time_mode": "Manual"})
		loan = self.submit(self.create(loan_data))
		damage_data = self.movement(
			"Damage", 1, self.loan_leaf, self.damaged, ti_borrower="History", posting_time="12:00:00"
		)
		damage_data["ti_time_mode"] = "Manual"
		damage_data["items"][0].update(
			{
				"ti_original_loan": loan.name,
				"ti_original_loan_line": loan["items"][0].name,
				"ti_settlement_outcome": "Damaged",
			}
		)
		damage = self.submit(self.create(damage_data))
		loss_data = self.movement(
			"Loss", 1, self.loan_leaf, None, ti_borrower="History", posting_time="10:00:00"
		)
		loss_data["ti_time_mode"] = "Manual"
		loss_data["items"][0].update(
			{
				"ti_original_loan": loan.name,
				"ti_original_loan_line": loan["items"][0].name,
				"ti_settlement_outcome": "Lost",
			}
		)
		loss = self.submit(self.create(loss_data))
		query = {"dataset": "loans", "view": "items", "loan": loan.name}
		history = browse.operation_contributions(
			query, item_code=self.item, loan_scope="all", history_sort="asc"
		)
		self.assertTrue(history["history_complete"])
		self.assertEqual([row["kind"] for row in history["rows"]], ["Loan", "Loss", "Damage"])
		self.assertEqual([row["quantity"] for row in history["rows"]], [4.0, -1.0, -1.0])
		frappe.get_doc("Stock Entry", loss.name).cancel()
		updated = browse.operation_contributions(
			query, item_code=self.item, loan_scope="all", history_sort="asc"
		)
		self.assertTrue(updated["history_complete"])
		self.assertEqual([row["kind"] for row in updated["rows"]], ["Loan", "Damage"])
		self.assertEqual([row["quantity"] for row in updated["rows"]], [4.0, -1.0])
		movement_history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1, 2],
				"scope": {"item": self.item},
			},
			item_code=self.item,
		)
		balance_effects = {row["document"]: row["loan_balance_effect"] for row in movement_history["rows"]}
		self.assertEqual(balance_effects[loan.name], 4.0)
		self.assertEqual(balance_effects[damage.name], -1.0)
		self.assertEqual(balance_effects[loss.name], 0.0)
		available_data = self.movement(quantity=1)
		available_data.update({"posting_time": "11:00:00", "ti_time_mode": "Manual"})
		self.submit(self.create(available_data))
		later_data = self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="History")
		later_data.update({"posting_time": "12:00:00", "ti_time_mode": "Manual"})
		later = self.submit(self.create(later_data))
		item_history_query = {"dataset": "loans", "view": "records", "statuses": [1]}
		item_history = browse.loan_item_history(item_history_query, self.item)
		self.assertEqual(
			[row["document"] for row in item_history["rows"][:2]],
			[later.name, loan.name],
		)
		self.assertEqual(
			browse.loan_item_history(
				{**item_history_query, "restrictItems": True, "itemCodes": []}, self.item
			)["rows"],
			[],
		)
		self.assertEqual(frappe.get_doc("Stock Entry", damage.name).docstatus, 1)
		original_parent = ReportContext.parent

		def hide_damage(context, doctype, name):
			if doctype == "Stock Entry" and name == damage.name:
				return None
			return original_parent(context, doctype, name)

		with patch.object(ReportContext, "parent", hide_damage):
			incomplete = browse.operation_contributions(query, item_code=self.item, loan_scope="all")
			incomplete_movement_history = browse.movement_history(
				{
					"dataset": "movements",
					"view": "lines",
					"statuses": [1, 2],
					"loan": loan.name,
					"scope": {"item": self.item},
				},
				item_code=self.item,
			)
		self.assertFalse(incomplete["history_complete"])
		self.assertFalse(incomplete_movement_history["history_complete"])

	def test_native_draft_filters_match_one_allocation_and_counts_keep_native_identity(self):
		self.receipt(10)
		self.submit(self.create(self.movement("Transfer", 4, self.a, self.b)))
		data = self.movement("Transfer", 2, self.a, self.b)
		data["items"].append({**data["items"][0], "s_warehouse": self.b, "t_warehouse": self.a})
		draft = self.create(data)
		query = {
			"dataset": "movements",
			"record": draft.name,
			"scope": {"sources": [self.a], "destinations": [self.a]},
		}
		self.assertEqual(browse.native_drafts(query)["matched_count"], 0)
		query["scope"]["destinations"] = [self.b]
		row = browse.native_drafts(query)["rows"][0]
		self.assertEqual(row["allocation_count"], 1)
		self.assertEqual(row["whole"]["line_count"], 2)
		count = counts.save_count(str(uuid4()), self.count_data(5, "Reviewed"))
		page = browse.counts_page({"dataset": "counts", "record": count.name, "statuses": [0]})
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["rows"][0]["doctype"], "Stock Reconciliation")
		self.assertEqual(page["rows"][0]["whole"]["version"], count.version)
		self.assertEqual(browse.counts_page({"dataset": "counts", "record": count.name})["matched_count"], 0)

	def test_movement_history_narrows_available_effect_to_explicit_warehouse(self):
		self.receipt(10)
		transfer = self.submit(self.create(self.movement("Transfer", 3, self.a, self.b)))
		base = {
			"dataset": "movements",
			"view": "lines",
			"statuses": [1],
			"scope": {"item": self.item, "warehouses": [self.root]},
		}
		whole_group = browse.movement_history(base, item_code=self.item)
		narrow_location = browse.movement_history(base, item_code=self.item, warehouse=self.a)
		group_transfer = next(row for row in whole_group["rows"] if row["document"] == transfer.name)
		narrow_transfer = next(row for row in narrow_location["rows"] if row["document"] == transfer.name)
		self.assertAlmostEqual(group_transfer["available_effect"], 0)
		self.assertAlmostEqual(narrow_transfer["available_effect"], -3)

		# Two reconciliations move the available-stock basis between leaves while
		# keeping the inherited group total unchanged.
		def reconcile(warehouse, delta):
			posting = now_datetime()
			baseline = counts.count_baseline([warehouse], str(posting), "Selected", [self.item])
			rows = copy.deepcopy(baseline["rows"])
			for row in rows:
				row.update(
					{
						"actual_qty": float(row["baseline_qty"]) + delta,
						"review_state": "Reviewed",
						"reason": "调整效果测试",
					}
				)
			data = {
				"company": self.company,
				"posting_date": str(posting.date()),
				"posting_time": str(posting.time()),
				"ti_count_warehouses": [warehouse],
				"ti_count_scope": "Selected",
				"ti_count_items": [self.item],
				"ti_baseline_timestamp": baseline["timestamp"],
				"ti_baseline_fingerprint": baseline["fingerprint"],
				"ti_count_review": rows,
			}
			draft = counts.save_count(str(uuid4()), data)
			native_api.submit_document("Stock Reconciliation", draft.name, draft.version)

		# A has 7 after transfer, B has 3; adjustment lines swap those balances.
		reconcile(self.a, -3)
		reconcile(self.b, 3)
		reconciliations_group = browse.movement_history(base, item_code=self.item)
		reconciliations_a = browse.movement_history(base, item_code=self.item, warehouse=self.a)
		reconcile_group_effect = sum(
			row["available_effect"] for row in reconciliations_group["rows"] if row["kind"] == "Reconcile"
		)
		reconcile_a_effect = sum(
			row["available_effect"] for row in reconciliations_a["rows"] if row["kind"] == "Reconcile"
		)
		self.assertAlmostEqual(reconcile_group_effect, 0)
		self.assertAlmostEqual(reconcile_a_effect, -3)
		unrelated = browse.movement_history(
			{**base, "scope": {"item": self.item, "warehouses": [self.b]}},
			item_code=self.item,
			warehouse=self.a,
		)
		self.assertEqual(unrelated["rows"], [])

	def test_history_endpoints_sort_complete_matching_results_before_paging(self):
		self.receipt(10)
		issue = self.movement("Issue", 3, self.a, None)
		self.submit(self.create(issue))
		movement_query = {
			"dataset": "movements",
			"view": "lines",
			"statuses": [1],
			"scope": {"item": self.item},
			"sortBy": "stock_qty",
			"sort": "asc",
		}
		movement_first = browse.movement_history(
			movement_query, item_code=self.item, start=0, page_length=1, sort_by="stock_qty", sort="asc"
		)
		movement_second = browse.movement_history(
			movement_query, item_code=self.item, start=1, page_length=1, sort_by="stock_qty", sort="asc"
		)
		self.assertEqual(movement_first["matched_count"], movement_second["matched_count"])
		self.assertLessEqual(movement_first["rows"][0]["quantity"], movement_second["rows"][0]["quantity"])
		self.assertEqual(
			movement_first["rows"][0]["id"],
			browse.movement_history(
				movement_query, item_code=self.item, page_length=1, sort_by="stock_qty", sort="asc"
			)["rows"][0]["id"],
		)

		for quantity in (1, 4):
			self.submit(
				self.create(
					self.movement(
						"Loan", quantity, self.a, self.loan_leaf, ti_borrower="History Sort Borrower"
					)
				)
			)
		loan_query = {
			"dataset": "loans",
			"view": "outcomes",
			"statuses": [1],
			"scope": {"item": self.item},
			"sortBy": "borrowed",
			"sort": "asc",
		}
		loan_first = browse.loan_item_history(
			loan_query, self.item, start=0, page_length=1, sort_by="borrowed", sort="asc"
		)
		loan_second = browse.loan_item_history(
			loan_query, self.item, start=1, page_length=1, sort_by="borrowed", sort="asc"
		)
		self.assertGreaterEqual(loan_second["rows"][0]["borrowed"], loan_first["rows"][0]["borrowed"])
		self.assertEqual(
			loan_first["rows"][0]["id"],
			browse.loan_item_history(loan_query, self.item, page_length=1, sort_by="borrowed", sort="asc")[
				"rows"
			][0]["id"],
		)

	def test_record_exports_expand_partial_item_matches_to_whole_movement_and_loan_documents(self):
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-REPORT-UNIT-{self.token}",
				"item_name": "Report unit test item",
				"item_group": "All Item Groups",
				"stock_uom": "Kg",
				"is_stock_item": 1,
			}
		).insert()
		receipt_data = self.movement("Receive", 10)
		receipt_data["items"].append(
			{**receipt_data["items"][0], "item_code": other.name, "qty": 10, "transfer_qty": 10, "uom": "Kg"}
		)
		self.submit(self.create(receipt_data))
		movement_data = self.movement("Transfer", 5, self.a, self.b)
		movement_data["items"].append(
			{**movement_data["items"][0], "item_code": other.name, "qty": 2, "transfer_qty": 2, "uom": "Kg"}
		)
		movement = self.submit(self.create(movement_data))
		history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item},
			},
			item_code=self.item,
			start=0,
			page_length=1,
		)
		self.assertEqual(history["matched_count"], 2)
		self.assertEqual(len(history["rows"]), 1)
		self.assertEqual(history["next_start"], 1)
		self.assertEqual(history["rows"][0]["item_code"], self.item)
		self.assertEqual(history["rows"][0]["source_warehouse"], self.a)
		self.assertEqual(history["rows"][0]["destination_warehouse"], self.b)
		self.assertAlmostEqual(history["rows"][0]["quantity"], 5)
		self.assertAlmostEqual(history["rows"][0]["available_effect"], 0)
		group_scoped = browse.movement_history(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item, "warehouses": [self.root]},
			},
			item_code=self.item,
			warehouse=self.a,
		)
		self.assertIn(movement.name, {row["document"] for row in group_scoped["rows"]})
		unrelated_warehouse = browse.movement_history(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item, "warehouses": [self.b]},
			},
			item_code=self.item,
			warehouse=self.a,
		)
		self.assertEqual(unrelated_warehouse["rows"], [])
		conflicting_item = browse.movement_history(
			{"dataset": "movements", "view": "records", "scope": {"item": "OTHER-ITEM"}},
			item_code=self.item,
		)
		self.assertEqual(conflicting_item["rows"], [])
		empty_restriction = browse.movement_history(
			{"dataset": "movements", "view": "records", "restrictItems": True, "itemCodes": []},
			item_code=self.item,
		)
		self.assertEqual(empty_restriction["rows"], [])
		conflicting_batch = browse.movement_history(
			{"dataset": "movements", "view": "records", "batchNo": "OTHER-BATCH"},
			item_code=self.item,
			batch_no="TI-BATCH-REQUEST",
		)
		self.assertEqual(conflicting_batch["rows"], [])
		movement_page = browse.report_page(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item},
			}
		)
		movement_rows = [row for row in movement_page["rows"] if row["document"] == movement.name]
		self.assertEqual({row["stock_uom"]: row["stock_qty"] for row in movement_rows}, {"Nos": 5, "Kg": 2})
		self.assertEqual(sum(row["available_effect"] for row in movement_rows), 0)

		loan_data = self.movement(
			"Loan", 5, self.a, self.loan_leaf, ti_borrower="报告测试借用方", ti_activity=self.activity.name
		)
		loan_data["items"].append(
			{**loan_data["items"][0], "item_code": other.name, "qty": 3, "transfer_qty": 3, "uom": "Kg"}
		)
		loan = self.submit(self.create(loan_data))
		loan_page = browse.report_page(
			{
				"dataset": "loans",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item},
			}
		)
		loan_rows = [row for row in loan_page["rows"] if row["document"] == loan.name]
		self.assertEqual({row["stock_uom"]: row["borrowed"] for row in loan_rows}, {"Nos": 5, "Kg": 3})
		self.assertEqual({row["stock_uom"]: row["outstanding"] for row in loan_rows}, {"Nos": 5, "Kg": 3})

	def test_available_effects_use_selected_loaned_and_damaged_leaves_consistently(self):
		self.receipt(10)
		damage = self.submit(self.create(self.movement("Damage", 2, self.a, self.damaged)))
		loan = self.loan(3)
		transfer = self.submit(self.create(self.movement("Transfer", 2, self.a, self.b)))
		for doc, default_effect, scoped_effect, warehouse in (
			(damage, -2, 2, self.damaged),
			(loan, -3, 3, self.loan_leaf),
			(transfer, 0, -2, self.a),
		):
			base = {"dataset": "movements", "view": "records", "statuses": [1], "record": doc.name}
			default = browse.operation_page(base, records=True)["rows"][0]["whole"]["available_effects"]
			scoped = browse.operation_page({**base, "scope": {"warehouses": [warehouse]}}, records=True)[
				"rows"
			][0]["whole"]["available_effects"]
			self.assertEqual(default, [{"uom": "Nos", "qty": default_effect}])
			self.assertEqual(scoped, [{"uom": "Nos", "qty": scoped_effect}])

		line_query = {
			"dataset": "movements",
			"view": "lines",
			"statuses": [1],
			"scope": {"warehouses": [self.damaged]},
		}
		line = browse.report_page(line_query)["rows"]
		damage_line = next(row for row in line if row["document"] == damage.name)
		self.assertEqual(damage_line["available_effect"], 2)
