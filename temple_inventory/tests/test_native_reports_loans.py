"""Report/export contracts exercised against real native stock and permissions."""

import base64
from unittest.mock import patch

import frappe

from temple_inventory import activities, browse, catalog, native_api
from temple_inventory.projections import group_page, report_page
from temple_inventory.report_query import validate_query
from temple_inventory.tests.helpers import NativeReportTestCase


class NativeReportsLoansTests(NativeReportTestCase):
	def test_loan_records_scope_includes_linked_settlement_documents_only_in_all_scope(self):
		self.receipt(10)
		open_loan = self.submit(
			self.create(self.movement("Loan", 5, self.a, self.loan_leaf, ti_borrower="部分归还"))
		)
		settlement = self.submit(self.settlement(open_loan, 2))
		settled_loan = self.submit(
			self.create(self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="全部归还"))
		)
		self.submit(self.settlement(settled_loan, 3))
		query = self.query("loans", "records", loan=open_loan.name, loanScope="all")
		query["scope"]["period"] = {"key": "all", "from": "", "to": ""}
		all_rows = browse.operation_page(query, records=True)["rows"]
		self.assertEqual({row["document"] for row in all_rows}, {open_loan.name, settlement.name})
		settlement_row = next(row for row in all_rows if row["document"] == settlement.name)
		self.assertEqual(settlement_row["kind"], "Return")
		self.assertEqual(settlement_row["whole"]["original_loans"], [open_loan.name])
		loan_row = next(row for row in all_rows if row["document"] == open_loan.name)
		self.assertEqual(
			loan_row["whole"]["settlement_records"],
			[{"name": settlement.name, "kind": "Return"}],
		)

		outstanding = {**query, "loanScope": "outstanding"}
		outstanding_rows = browse.operation_page(outstanding, records=True)["rows"]
		self.assertEqual([row["document"] for row in outstanding_rows], [open_loan.name])

		draft = self.create(self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="草稿"))
		draft_query = self.query("loans", "records", statuses=[0], loanScope="outstanding")
		draft_query["scope"]["period"] = {"key": "all", "from": "", "to": ""}
		draft_rows = browse.operation_page(draft_query, records=True)["rows"]
		self.assertIn(draft.name, {row["document"] for row in draft_rows})

	def test_activity_option_search_is_permission_checked_active_and_searchable(self):
		active = activities.save_activity(
			{
				"title": f"Picker title {self.token}",
				"activity_type": "TI-TYPE-OTHER",
				"notes": f"unique notes {self.token}",
			}
		)
		archived = activities.save_activity(
			{"title": f"Picker archived {self.token}", "activity_type": "TI-TYPE-OTHER"}
		)
		frappe.db.set_value("Inventory Activity", archived["name"], "status", "Archived")
		with patch("temple_inventory.activities.frappe.get_list", wraps=frappe.get_list) as get_list:
			result = activities.search_activities(f"unique notes {self.token}")
		self.assertEqual([row["name"] for row in result["rows"]], [active["name"]])
		self.assertEqual(result["rows"][0]["type_label"], "其它")
		self.assertTrue(any(call.args[0] == "Inventory Activity" for call in get_list.call_args_list))
		self.assertNotIn(archived["name"], {row["name"] for row in activities.search_activities()["rows"]})
		self.assertEqual(
			activities.activity_label(archived["name"]),
			{"name": archived["name"], "title": archived["title"], "archived": True},
		)

	def test_movement_history_preloads_only_permission_readable_primary_images(self):
		self.receipt(3)
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"history-primary-{self.token}.png",
				"content": base64.b64decode(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
				),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "image",
			}
		).insert()
		item = frappe.get_doc("Item", self.item)
		catalog.set_item_image(self.item, str(item.modified), file.name)
		query = self.query("movements", "lines", statuses=[1])
		page = browse.movement_history(query, item_code=self.item)
		self.assertEqual(page["rows"][0]["image"], file.file_url)
		with patch("frappe.core.doctype.file.file.File.has_permission", return_value=False):
			denied = browse.movement_history(query, item_code=self.item)
		self.assertEqual(denied["rows"][0]["image"], "")
		frappe.db.set_value("Item", self.item, "image", "", update_modified=False)
		missing = browse.movement_history(query, item_code=self.item)
		self.assertEqual(missing["rows"][0]["image"], "")

	def test_flat_loan_history_rows_carry_readable_primary_images(self):
		self.receipt(3)
		self.submit(self.create(self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="演出团队")))
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"loan-history-{self.token}.png",
				"content": base64.b64decode(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
				),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "image",
			}
		).insert()
		item = frappe.get_doc("Item", self.item)
		catalog.set_item_image(self.item, str(item.modified), file.name)
		query = {**self.query("loans", "items"), "itemCodes": [self.item], "restrictItems": True}
		for scope in ("outstanding", "all"):
			rows = browse.operation_contributions(query, loan_scope=scope)["rows"]
			self.assertTrue(rows)
			self.assertEqual({row["image"] for row in rows}, {file.file_url})
		with patch("frappe.core.doctype.file.file.File.has_permission", return_value=False):
			denied = browse.operation_contributions(query, loan_scope="all")["rows"]
		self.assertEqual({row["image"] for row in denied}, {""})

	def test_return_record_page_includes_original_loan_identity_for_multiple_loans(self):
		self.receipt(10)
		loans = [
			self.submit(self.create(self.movement("Loan", 2, self.a, self.loan_leaf, ti_borrower="演出团队")))
			for _ in range(2)
		]
		return_data = self.movement("Return", 1, self.loan_leaf, self.a, ti_borrower="演出团队")
		return_data["items"] = []
		for loan in loans:
			line = self.movement("Return", 1, self.loan_leaf, self.a)["items"][0]
			line.update(
				{
					"ti_original_loan": loan.name,
					"ti_original_loan_line": loan["items"][0].name,
					"ti_settlement_outcome": "Returned",
				}
			)
			return_data["items"].append(line)
		returned = self.submit(self.create(return_data))
		query = self.query("movements", "records", statuses=[1], groupBy=["kind"], record=returned.name)
		page = group_page(query, parent_path=["Return"])
		self.assertEqual(page["matched_count"], 1)
		row = page["rows"][0]
		expected = [
			{"name": loan.name, "borrower": "演出团队", "date": str(loan.posting_date)} for loan in loans
		]
		self.assertEqual(row["whole"]["original_loan_details"], expected)
		browse_page = browse.operation_page(query, records=True)
		browse_row = next(row for row in browse_page["rows"] if row["document"] == returned.name)
		self.assertEqual(browse_row["whole"]["original_loan_details"], expected)

	def test_loan_item_contributions_keep_items_view_and_apply_independent_stable_sort(self):
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "TI-LOAN-HISTORY-" + self.token,
				"item_name": "Second loan history item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		self.receipt(10)
		other_receipt = self.movement(quantity=10)
		other_receipt["items"][0]["item_code"] = other.name
		self.submit(self.create(other_receipt))
		data = self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="History Sort")
		data["items"].append(dict(data["items"][0], item_code=other.name, qty=4))
		loan = self.submit(self.create(data))
		self.submit(self.settlement(loan, 3))
		query = self.query("loans", "items", loan=loan.name, statuses=[1], sortBy="item_name")
		page = browse.operation_contributions(
			query,
			item_code=self.item,
			loan_scope="all",
			history_sort_by="document",
			history_sort="asc",
			page_length=1,
		)
		self.assertEqual(page["matched_count"], 2)
		self.assertEqual(page["next_start"], 1)
		self.assertEqual(page["rows"][0]["document"], loan.name)
		all_item_query = {**query, "scope": {**query["scope"], "item": ""}}
		all_items = browse.operation_contributions(
			all_item_query,
			loan_scope="all",
			history_sort_by="document",
			history_sort="asc",
		)
		self.assertEqual(all_items["matched_count"], 3)
		self.assertEqual({row["item_code"] for row in all_items["rows"]}, {self.item, other.name})
		self.assertTrue(any(row["can_settle"] for row in all_items["rows"]))
		return_row = next(row for row in all_items["rows"] if row["kind"] == "Return")
		self.assertEqual(return_row["quantity"], -3)
		self.assertEqual(return_row["original_loans"], [loan.name])
		open_item_loan = next(
			row for row in all_items["rows"] if row["kind"] == "Loan" and row["item_code"] == other.name
		)
		self.assertEqual(open_item_loan["outstanding"], 4)
		self.assertEqual(open_item_loan["loan_status"], "Open")
		with self.assertRaises(frappe.ValidationError):
			browse.operation_contributions(
				query,
				item_code=self.item,
				loan_scope="all",
				history_sort_by="unsupported",
			)
		outcome_query = {**query, "view": "outcomes"}
		with self.assertRaises(frappe.ValidationError):
			browse.operation_contributions(outcome_query, item_code=self.item)

	def test_grouped_native_record_leaves_include_whole_quantities_and_settlement_state(self):
		self.receipt(8)
		loan = self.submit(
			self.create(self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="Grouped Loan"))
		)
		query = self.query("loans", "records", groupBy=["borrower"], loan=loan.name)
		children = group_page(
			query,
			parent_path=["Grouped Loan"],
		)
		self.assertEqual(children["row_grain"], "record")
		self.assertEqual(len(children["rows"]), 1)
		row = children["rows"][0]
		self.assertEqual(row["row_grain"], "record")
		self.assertEqual(row["whole"]["quantities"], [{"uom": "Nos", "qty": 3.0}])
		self.assertEqual(row["whole"]["loan_status"], "Open")
		self.assertTrue(row["can_settle"])

	def test_filter_contract_validates_tracking_people_borrower_and_item_status(self):
		query = self.query(
			"loans",
			"records",
			scope={"item": self.item, "warehouses": [self.root], "tracking": "expiry"},
			person={"name": "张三", "role": "handler"},
			borrower="办公室",
			itemStatus="disabled",
			loanOutcome="damaged",
		)
		self.assertEqual(query["scope"]["tracking"], "expiry")
		self.assertEqual(query["person"], {"name": "张三", "role": "handler"})
		self.assertEqual(query["borrower"], "办公室")
		self.assertEqual(query["itemStatus"], "disabled")
		item_outcome_query = self.query("loans", "items", loanOutcome="lost")
		self.assertEqual(item_outcome_query["loanOutcome"], "lost")
		with self.assertRaises(frappe.ValidationError):
			validate_query({**query, "person": {"name": "张三", "role": "witness"}})
		with self.assertRaises(frappe.ValidationError):
			validate_query({**query, "scope": {**query["scope"], "tracking": "invalid"}})

	def test_grouped_projection_retains_exact_allocation_detail_and_original_loan_lines(self):
		loan = self.loan(5)
		self.submit(self.settlement(loan, 2))
		result = report_page(self.query("loans", "outcomes", groupBy=["item"]))
		self.assertEqual(result["rows"][0]["outstanding"], 3)
		self.assertIn("outcomes", {table["id"] for table in result["tables"]})
		settlements = report_page(self.query("loans", "settlements"))
		self.assertEqual(settlements["rows"][0]["original_loan_line"], loan["items"][0].name)

	def test_activity_indirect_settlement_relation_follows_exact_original_line(self):
		loan = self.loan()
		settlement = self.settlement(loan)
		# A compatible native Desk settlement may retain the original link without
		# repeating its activity. The native model permits this only when blank.
		desk = frappe.get_doc("Stock Entry", settlement.name)
		desk.ti_activity = None
		desk.save()
		desk.submit()
		query = self.query("activities", "records")
		query["scope"]["activity"] = self.activity.name
		result = report_page(query)
		linked = [row for row in result["rows"] if row["document"] == settlement.name]
		self.assertEqual(len(linked), 1)
		self.assertEqual(linked[0]["relationship"], "original_loan")
		metadata = report_page({**query, "view": "metadata"})["rows"][0]
		self.assertEqual(metadata["count_Loan"], 1)
		self.assertEqual(metadata["count_Return"], 0)
		overview = activities.load_activity(self.activity.name)
		self.assertEqual(overview["summary"]["count_Loan"], 1)
		self.assertEqual(overview["summary"]["count_Return"], 0)
		self.assertEqual(overview["outstanding_line_count"], 1)
		self.assertEqual(overview["loan_totals"][0]["outstanding"], 3)
		self.assertEqual(overview["movement_totals"][0]["kind"], "Loan")
		self.assertNotIn("can_write", overview)
		self.assertNotIn("can_delete", overview)

	def test_activity_relations_include_direct_and_original_loan_activities(self):
		from temple_inventory.report_sources import ReportContext, activity_relations

		loan = self.loan(5)
		direct_activity = activities.save_activity(
			{"title": f"Direct activity {self.token}", "activity_type": "TI-TYPE-OTHER"}
		)
		row = {
			"activity": direct_activity["name"],
			"original_loan": loan.name,
			"original_loan_line": loan["items"][0].name,
			"item_code": self.item,
			"docstatus": 1,
		}
		context = ReportContext(self.query("activities", "records"))
		with patch("temple_inventory.report_sources.movement_rows", return_value=[row]):
			direct = list(activity_relations(context, direct_activity["name"], lifetime=True))
			original = list(activity_relations(context, self.activity.name, lifetime=True))
		self.assertEqual([value["relationship"] for value in direct], ["direct"])
		self.assertEqual([value["relationship"] for value in original], ["original_loan"])

	def test_loan_record_status_uses_complete_original_before_allocation_filters(self):
		self.receipt(10)
		data = self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="Whole Loan")
		data["items"].append(dict(data["items"][0], qty=4))
		loan = self.submit(self.create(data))
		self.submit(self.settlement(loan, 3))
		line = loan["items"][0].name
		query = self.query(
			"loans", "outcomes", loan=loan.name, restrictAllocations=True, allocationKeys=[line]
		)
		open_rows = report_page({**query, "loanStatus": "open"})["rows"]
		self.assertEqual(len(open_rows), 1)
		self.assertEqual(open_rows[0]["outstanding"], 0)
		self.assertEqual(open_rows[0]["loan_status"], "Open")
		self.assertEqual(report_page({**query, "loanStatus": "settled"})["matched_count"], 0)
		complete = report_page(self.query("loans", "outcomes", loan=loan.name, loanStatus="open"))
		self.assertEqual(complete["matched_count"], 2)
		self.assertEqual(sum(row["outstanding"] for row in complete["rows"]), 4)

	def test_draft_and_cancelled_loan_records_have_no_current_outstanding_balance(self):
		self.receipt(5)
		draft = self.create(self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="Loan Lifecycle"))
		rows = report_page(self.query("loans", "outcomes", loan=draft.name, statuses=[0]))["rows"]
		self.assertEqual(rows[0]["borrowed"], 3)
		self.assertEqual(rows[0]["outstanding"], 0)
		completed = self.submit(draft)
		native_api.cancel_document("Stock Entry", completed.name, completed.version)
		self.assertEqual(native_api.loan_detail(completed.name)["items"][0]["outstanding_qty"], 0)
		query = self.query("loans", "outcomes", loan=completed.name, statuses=[2])
		self.assertEqual(report_page(query)["rows"][0]["outstanding"], 0)
		self.assertEqual(report_page({**query, "loanStatus": "settled"})["matched_count"], 0)
