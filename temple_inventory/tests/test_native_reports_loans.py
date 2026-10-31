"""Report/export contracts exercised against real native stock and permissions."""

import base64
from unittest.mock import patch
from uuid import uuid4

import frappe

from temple_inventory import activities, browse, catalog, loans, native_api
from temple_inventory.projections import group_page, report_page
from temple_inventory.report_query import validate_query
from temple_inventory.tests.helpers import NativeReportTestCase


class NativeReportsLoansTests(NativeReportTestCase):
	def other_activity(self):
		return activities.save_activity(
			{"title": f"Other activity {self.token}", "activity_type": "TI-TYPE-OTHER"}
		)

	def activity_loan(self, quantity, activity, borrower="另一借用方"):
		self.receipt(quantity)
		return self.submit(
			self.create(
				self.movement(
					"Loan",
					quantity,
					self.a,
					self.loan_leaf,
					ti_borrower=borrower,
					ti_activity=activity,
				)
			)
		)

	def mixed_return(self, parts, header_borrower="客户端借用方", header_activity=None):
		"""One Return whose lines settle the given (loan, quantity) pairs, with client header values."""
		data = self.movement(
			"Return", 1, self.loan_leaf, self.b, ti_borrower=header_borrower, ti_activity=header_activity
		)
		data["items"] = []
		for loan, quantity in parts:
			line = self.movement("Return", quantity, self.loan_leaf, self.b)["items"][0]
			line.update(
				{
					"ti_original_loan": loan.name,
					"ti_original_loan_line": loan["items"][0].name,
					"ti_settlement_outcome": "Returned",
				}
			)
			data["items"].append(line)
		return data

	def test_one_loan_status_filter_is_shared_by_items_and_records(self):
		self.receipt(10)
		open_loan = self.submit(
			self.create(self.movement("Loan", 5, self.a, self.loan_leaf, ti_borrower="部分归还"))
		)
		settled_loan = self.submit(
			self.create(self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="全部归还"))
		)
		self.submit(self.settlement(settled_loan, 3))
		for view in ("items", "records"):
			default = report_page(self.query("loans", view))
			settled = report_page(self.query("loans", view, loanStatus="settled"))
			all_rows = report_page(self.query("loans", view, loanStatus="all"))
			if view == "items":
				self.assertEqual(sum(row["borrowed"] for row in default["rows"]), 5)
				self.assertEqual(sum(row["borrowed"] for row in settled["rows"]), 3)
				self.assertEqual(sum(row["borrowed"] for row in all_rows["rows"]), 8)
			else:
				self.assertEqual({row["document"] for row in default["rows"]}, {open_loan.name})
				self.assertEqual({row["document"] for row in settled["rows"]}, {settled_loan.name})
				self.assertTrue(
					{open_loan.name, settled_loan.name} <= {row["document"] for row in all_rows["rows"]}
				)
		item_query = self.query("loans", "items")
		outstanding_history = browse.operation_contributions(item_query, item_code=self.item)
		settled_history = browse.operation_contributions(
			{**item_query, "loanStatus": "settled"}, item_code=self.item
		)
		all_history = browse.operation_contributions({**item_query, "loanStatus": "all"}, item_code=self.item)
		self.assertEqual({row["document"] for row in outstanding_history["rows"]}, {open_loan.name})
		self.assertEqual({row["document"] for row in settled_history["rows"]}, {settled_loan.name})
		self.assertIn(settled_loan.name, {row["document"] for row in all_history["rows"]})
		self.assertTrue(any(row["kind"] == "Return" for row in all_history["rows"]))

	def test_removed_loan_filter_keys_are_ignored_by_normalization(self):
		query = validate_query({"dataset": "loans", "view": "items", "loanScope": "all", "includeZero": True})
		self.assertEqual(query["loanStatus"], "outstanding")
		self.assertNotIn("loanScope", query)
		self.assertNotIn("includeZero", query)

	def test_activity_metadata_page_does_not_build_loan_table(self):
		query = self.query("activities", "metadata")
		query["scope"]["activity"] = self.activity.name
		query["scope"]["item"] = ""
		with patch(
			"temple_inventory.projections.loan_rows", side_effect=AssertionError("unexpected loan scan")
		):
			page = report_page(query)
		self.assertEqual(page["matched_count"], 1)

	def test_activity_counts_exclude_documents_outside_authorized_warehouse_scope(self):
		from temple_inventory.report_sources import ReportContext, activity_rows

		activity = activities.save_activity(
			{"title": f"Restricted activity {self.token}", "activity_type": "TI-TYPE-OTHER"}
		)
		self.submit(self.create(self.movement("Receive", 2, target=self.b, ti_activity=activity["name"])))
		query = self.query("activities", "metadata")
		query["scope"]["activity"] = activity["name"]
		query["scope"]["item"] = ""
		context = ReportContext(query)
		context.selected = {self.a}
		rows = list(activity_rows(context))
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["document_count"], 0)
		self.assertEqual(rows[0]["count_Receive"], 0)

	def test_outstanding_loan_lines_returns_partial_allocations_and_omits_settled(self):
		partly_returned = self.loan(5, borrower="部分归还")
		self.submit(self.settlement(partly_returned, 2))
		settled = self.loan(3, borrower="全部归还")
		self.submit(self.settlement(settled, 3))
		rows = loans.outstanding_lines([self.item])
		self.assertEqual(len(rows), 1)
		self.assertEqual(
			rows[0],
			{
				"loan": partly_returned.name,
				"original_loan_line": partly_returned["items"][0].name,
				"item_code": self.item,
				"batch_no": "",
				"qty": 3,
				"uom": "Nos",
				"warehouse": self.a,
			},
		)

	def test_outstanding_loan_lines_respects_restricted_warehouse_scope(self):
		from temple_inventory.report_sources import ReportContext

		self.submit(self.create(self.movement("Receive", 4, target=self.b)))
		self.submit(self.create(self.movement("Loan", 4, self.b, self.loan_leaf, ti_borrower="受限借用方")))
		original_context = ReportContext

		def restricted_context(*args, **kwargs):
			context = original_context(*args, **kwargs)
			context.selected = {self.a}
			return context

		with patch("temple_inventory.loans.ReportContext", side_effect=restricted_context):
			self.assertEqual(loans.outstanding_lines([self.item]), [])

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
		query = self.query("loans", "records", loan=open_loan.name, loanStatus="all")
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

		outstanding = {**query, "loanStatus": "outstanding"}
		outstanding_rows = browse.operation_page(outstanding, records=True)["rows"]
		self.assertEqual([row["document"] for row in outstanding_rows], [open_loan.name])

		draft = self.create(self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="草稿"))
		draft_query = self.query("loans", "records", statuses=[0], loanStatus="all")
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
			rows = browse.operation_contributions({**query, "loanStatus": scope})["rows"]
			self.assertTrue(rows)
			self.assertEqual({row["image"] for row in rows}, {file.file_url})
		with patch("frappe.core.doctype.file.file.File.has_permission", return_value=False):
			denied = browse.operation_contributions({**query, "loanStatus": "all"})["rows"]
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

	def test_mixed_return_settles_loans_from_several_borrowers_and_activities(self):
		other = self.other_activity()
		first = self.activity_loan(3, self.activity.name, "借用甲")
		second = self.activity_loan(4, other["name"], "借用乙")
		draft = self.create(
			self.mixed_return(
				[(first, 2), (second, 3)], header_borrower="客户端借用方", header_activity=other["name"]
			)
		)
		self.assertEqual(draft.ti_borrower, "")
		self.assertFalse(draft.ti_activity)
		saved = native_api.save_document(
			"Stock Entry",
			draft.name,
			draft.version,
			{"ti_borrower": "再次客户端", "ti_activity": self.activity.name},
		)
		self.assertEqual(saved.ti_borrower, "")
		self.assertFalse(saved.ti_activity)
		returned = self.submit(saved)

		def outstanding(loan):
			return native_api.loan_detail(loan.name)["items"][0]["outstanding_qty"]

		self.assertEqual((outstanding(first), outstanding(second)), (1, 1))
		picker = {
			row["name"] for row in native_api.outstanding_loans(search=self.token, page_length=20)["rows"]
		}
		self.assertTrue({first.name, second.name} <= picker)
		for activity_name in (self.activity.name, other["name"]):
			query = self.query("activities", "metadata")
			query["scope"]["activity"] = activity_name
			query["scope"]["item"] = ""
			self.assertEqual(report_page(query)["rows"][0]["count_Return"], 1)
		for borrower in ("借用甲", "借用乙"):
			page = report_page(self.query("loans", "records", loanStatus="all", borrower=borrower))
			self.assertIn(returned.name, {row["document"] for row in page["rows"]})
			record = next(row for row in page["rows"] if row["document"] == returned.name)
			self.assertEqual(set(record["borrower"].split("、")), {"借用甲", "借用乙"})
		history = browse.operation_contributions(
			{**self.query("loans", "items"), "loanStatus": "all"}, item_code=self.item
		)["rows"]
		returns = [row for row in history if row["document"] == returned.name]
		self.assertEqual({row["borrower"] for row in returns}, {"借用甲", "借用乙"})
		cancelled = native_api.cancel_document("Stock Entry", returned.name, returned.version)
		self.assertEqual((outstanding(first), outstanding(second)), (3, 4))
		amended = native_api.amend_document("Stock Entry", returned.name, cancelled.version, str(uuid4()))
		self.assertEqual(amended.ti_borrower, "")
		self.submit(amended)
		self.assertEqual((outstanding(first), outstanding(second)), (1, 1))

	def test_settlement_from_archived_derived_activity_is_not_blocked(self):
		other = self.other_activity()
		loan = self.activity_loan(2, other["name"])
		frappe.db.set_value("Inventory Activity", other["name"], "status", "Archived", update_modified=False)
		returned = self.submit(self.create(self.mixed_return([(loan, 2)])))
		self.assertEqual(frappe.db.get_value("Stock Entry", returned.name, "ti_activity"), other["name"])
		self.assertEqual(native_api.loan_detail(loan.name)["items"][0]["outstanding_qty"], 0)

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
		query = self.query(
			"loans", "items", loan=loan.name, statuses=[1], sortBy="item_name", loanStatus="all"
		)
		page = browse.operation_contributions(
			query,
			item_code=self.item,
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

	def test_desk_settlement_without_activity_takes_its_original_loan_activity(self):
		loan = self.loan()
		settlement = self.settlement(loan)
		# A Desk save may blank the header; validation derives it from the original loan.
		desk = frappe.get_doc("Stock Entry", settlement.name)
		desk.ti_activity = None
		desk.save()
		desk.submit()
		self.assertEqual(
			frappe.db.get_value("Stock Entry", settlement.name, "ti_activity"), self.activity.name
		)
		query = self.query("activities", "records")
		query["scope"]["activity"] = self.activity.name
		result = report_page(query)
		linked = [row for row in result["rows"] if row["document"] == settlement.name]
		self.assertEqual(len(linked), 1)
		self.assertEqual(linked[0]["relationship"], "direct")
		metadata = report_page({**query, "view": "metadata"})["rows"][0]
		self.assertEqual(metadata["count_Loan"], 1)
		self.assertEqual(metadata["count_Return"], 1)
		overview = activities.load_activity(self.activity.name)
		self.assertEqual(overview["summary"]["count_Loan"], 1)
		self.assertEqual(overview["summary"]["count_Return"], 1)
		self.assertEqual(overview["outstanding_line_count"], 1)
		self.assertEqual(overview["loan_totals"][0]["outstanding"], 3)
		self.assertEqual({row["kind"] for row in overview["movement_totals"]}, {"Loan", "Return"})
		self.assertNotIn("can_write", overview)
		self.assertNotIn("can_delete", overview)

	def test_activity_relations_mark_own_activity_direct_and_loan_activities_as_original(self):
		from temple_inventory.report_sources import ReportContext, activity_relations

		loan = self.loan(5)
		other = self.other_activity()
		second = self.activity_loan(4, other["name"])
		return_doc = self.submit(self.create(self.mixed_return([(loan, 1), (second, 1)])))
		row_direct = {
			"doctype": "Stock Entry",
			"document": loan.name,
			"activity": self.activity.name,
			"original_loan": "",
			"original_loan_line": "",
			"item_code": self.item,
			"docstatus": 1,
			"kind": "Loan",
			"document_id": f"Stock Entry:{loan.name}",
		}
		row_settlement = {
			**row_direct,
			"document": return_doc.name,
			"activity": other["name"],
			"original_loan": second.name,
			"original_loan_line": second["items"][0].name,
			"kind": "Return",
			"document_id": f"Stock Entry:{return_doc.name}",
		}
		context = ReportContext(self.query("activities", "records"))
		with patch(
			"temple_inventory.report_sources.movement_rows", return_value=[row_direct, row_settlement]
		):
			own = list(activity_relations(context, self.activity.name, lifetime=True))
			settled = list(activity_relations(context, other["name"], lifetime=True))
		self.assertEqual([value["relationship"] for value in own], ["direct"])
		self.assertEqual([value["relationship"] for value in settled], ["original_loan"])

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
		open_rows = report_page({**query, "loanStatus": "outstanding"})["rows"]
		self.assertEqual(len(open_rows), 0)
		self.assertEqual(report_page({**query, "loanStatus": "settled"})["matched_count"], 0)
		complete = report_page(self.query("loans", "outcomes", loan=loan.name, loanStatus="outstanding"))
		self.assertEqual(complete["matched_count"], 1)
		self.assertEqual(sum(row["outstanding"] for row in complete["rows"]), 4)

	def test_draft_and_cancelled_loan_records_have_no_current_outstanding_balance(self):
		self.receipt(5)
		draft = self.create(self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="Loan Lifecycle"))
		rows = report_page(self.query("loans", "outcomes", loan=draft.name, statuses=[0], loanStatus="all"))[
			"rows"
		]
		self.assertEqual(rows[0]["borrowed"], 3)
		self.assertEqual(rows[0]["outstanding"], 0)
		completed = self.submit(draft)
		native_api.cancel_document("Stock Entry", completed.name, completed.version)
		self.assertEqual(native_api.loan_detail(completed.name)["items"][0]["outstanding_qty"], 0)
		query = self.query("loans", "outcomes", loan=completed.name, statuses=[2], loanStatus="all")
		self.assertEqual(report_page(query)["rows"][0]["outstanding"], 0)
		self.assertEqual(report_page({**query, "loanStatus": "settled"})["matched_count"], 0)
