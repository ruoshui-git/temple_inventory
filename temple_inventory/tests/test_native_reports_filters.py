"""Report/export contracts exercised against real native stock and permissions."""

import json
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.utils import nowdate

from temple_inventory import activities, catalog, counts, native_api, preferences
from temple_inventory.periods import resolve_period
from temple_inventory.projections import Projection, group_page, report_page
from temple_inventory.report_query import DEFINITIONS, validate_query
from temple_inventory.tests.helpers import NativeReportTestCase


class NativeReportsFiltersTests(NativeReportTestCase):
	def test_period_resolution_matches_shared_frontend_fixture(self):
		fixture_path = Path(__file__).parents[2] / "frontend" / "tests" / "fixtures" / "periods.json"
		fixture = json.loads(fixture_path.read_text())
		for key, expected in fixture["periods"].items():
			filters = {"period_key": key}
			if key == "custom":
				filters.update(date_from=expected["from"], date_to=expected["to"])
			resolved = resolve_period(filters, today_provider=lambda: fixture["site_date"])
			self.assertEqual(resolved["date_from"], expected["from"], key)
			self.assertEqual(resolved["date_to"], expected["to"], key)

	def test_unfiltered_movement_record_fast_path_matches_full_expansion(self):
		self.submit(self.create(self.movement(quantity=2)))
		query = validate_query(
			{
				"dataset": "movements",
				"view": "records",
				"sortBy": "date",
				"sort": "desc",
				"scope": {"period": {"key": "custom", "from": nowdate(), "to": nowdate()}},
			}
		)
		original_fast_path = Projection._complete_unfiltered_movement_records
		fast_path_results = []

		def track_fast_path(projection):
			result = original_fast_path(projection)
			fast_path_results.append(result)
			return result

		with patch.object(Projection, "_complete_unfiltered_movement_records", track_fast_path):
			fast = report_page(query, refresh=True)
		self.assertEqual(fast_path_results, [True])
		with patch.object(Projection, "_complete_unfiltered_movement_records", return_value=False):
			full = report_page(query, refresh=True)
		self.assertGreater(fast["matched_count"], 0)
		fast.pop("snapshot")
		full.pop("snapshot")
		self.maxDiff = None
		self.assertEqual(fast, full)

	def test_six_datasets_and_all_views_have_complete_native_page_contracts(self):
		self.receipt()
		for dataset, definition in DEFINITIONS.items():
			for view in definition["views"]:
				query = self.query(dataset, view)
				if view == "historical":
					query["scope"]["period"] = {"key": "this_month", "from": "", "to": ""}
				result = report_page(query, page_length=1)
				self.assertIn("matched_count", result)
				self.assertIn("snapshot", result)
				self.assertTrue(result["columns"])
				self.assertNotIn("id", result["columns"])
				for table in result["tables"]:
					self.assertNotIn("id", report_page(query, table=table["id"])["columns"])
				self.assertEqual(result["query"]["dataset"], dataset)
				field = {
					("inventory", "summary"): "item",
					("inventory", "locations"): "location",
					("inventory", "historical"): "item",
					("expiry", "batches"): "item",
					("movements", "summary"): "item",
					("movements", "records"): "kind",
					("movements", "lines"): "source",
					("loans", "records"): "borrower",
					("loans", "items"): "item",
					("loans", "outcomes"): "item",
					("loans", "settlements"): "item",
					("activities", "metadata"): "activityType",
					("activities", "records"): "kind",
					("activities", "loans"): "item",
					("counts", "records"): "kind",
					("counts", "lines"): "item",
				}[(dataset, view)]
				grouped = report_page({**query, "groupBy": [field]})
				self.assertEqual(grouped["table"], "grouped")
				self.assertNotIn("id", grouped["columns"])
				self.assertTrue(
					all("group_path" in row and row["group_depth"] == 1 for row in grouped["rows"])
				)
				if grouped["rows"] and field == "item":
					self.assertIn("group_label", grouped["columns"])
					self.assertTrue(grouped["rows"][0]["group_label"])

	def test_group_page_sorts_complete_filtered_groups_and_pages_matching_allocations(self):
		self.receipt(8)
		self.receipt(4)
		issue = self.movement("Issue", 3, self.a, None)
		self.submit(self.create(issue))
		query = self.query("movements", "lines", groupBy=["kind"], sortBy="stock_qty", sort="desc")
		page = report_page(query, page_length=1)
		self.assertEqual(page["matched_count"], 2)
		self.assertEqual(page["next_start"], 1)
		self.assertIn("document", page["leaf_columns"])
		self.assertNotIn("id", page["leaf_columns"])
		self.assertEqual(page["rows"][0]["kind"], "Receive")
		self.assertEqual(page["rows"][0]["stock_qty"], 12)
		groups = group_page(query, parent_path=[], page_length=1)
		self.assertEqual(groups["matched_count"], 2)
		self.assertEqual(groups["next_start"], 1)
		self.assertEqual(groups["rows"][0]["kind"], "Receive")
		children = group_page(
			query,
			parent_path=["Receive"],
			page_length=1,
		)
		self.assertEqual(children["matched_count"], 2)
		self.assertEqual(children["next_start"], 1)
		self.assertEqual(children["row_grain"], "allocation")
		self.assertEqual(children["rows"][0]["stock_qty"], 8)

	def test_quarter_periods_use_site_date_and_calendar_boundaries(self):
		from temple_inventory.periods import resolve_period

		def resolve(key, today):
			return resolve_period({"period_key": key}, today_provider=lambda: today)

		self.assertEqual(
			resolve("this_quarter", "2026-04-05"),
			{"key": "this_quarter", "date_from": "2026-04-01", "date_to": "2026-04-05"},
		)
		self.assertEqual(
			resolve("last_quarter", "2026-01-19"),
			{"key": "last_quarter", "date_from": "2025-10-01", "date_to": "2025-12-31"},
		)
		for key, expected in (
			("q1", ("2026-01-01", "2026-03-31")),
			("q2", ("2026-04-01", "2026-06-30")),
			("q3", ("2026-07-01", "2026-09-30")),
			("q4", ("2026-10-01", "2026-12-31")),
			("last_year", ("2025-01-01", "2025-12-31")),
		):
			resolved = resolve(key, "2026-10-28")
			self.assertEqual((resolved["date_from"], resolved["date_to"]), expected)

	def test_report_line_person_filter_matches_header_names_case_insensitively(self):
		from temple_inventory.report_sources import ReportContext

		query = self.query("movements", "lines", person={"name": "张", "role": "handler"})
		context = ReportContext(query)
		row = {
			"item_code": self.item,
			"source_warehouse": self.a,
			"destination_warehouse": "",
			"warehouse": "",
			"kind": "Issue",
			"handler": "李张三",
			"recorder": "王五",
			"reviewer": "",
		}
		self.assertTrue(context.matches_line(row))
		context.query["person"] = {"name": "张", "role": "reviewer"}
		self.assertFalse(context.matches_line(row))

	def test_people_filter_choices_are_distinct_and_substring_searchable(self):
		from temple_inventory.people import borrowers, recorded_names

		self.submit(self.create(self.movement(ti_recorder_name="测试张三", ti_handler_name="经手张三")))
		loan = self.loan(2, borrower="借用张三")
		recorded = recorded_names(search="张三", role="any")
		self.assertEqual({row["value"] for row in recorded}, {"测试张三", "经手张三"})
		self.assertTrue(all(row["count"] >= 1 for row in recorded))
		self.assertEqual(borrowers(search="张三")[0]["value"], loan.ti_borrower)

	def test_saved_record_scope_requires_exact_doctype_name_and_status(self):
		self.receipt(10)
		for doctype, dataset in (("Stock Entry", "movements"), ("Stock Reconciliation", "counts")):
			draft = (
				self.create(self.movement())
				if doctype == "Stock Entry"
				else counts.save_count(str(uuid4()), self.count_data(9, "Reviewed"))
			)
			for status in (0, 1, 2):
				if status == 1:
					draft = native_api.submit_document(doctype, draft.name, draft.version)
				elif status == 2:
					draft = native_api.cancel_document(doctype, draft.name, draft.version)
				query = self.query(
					dataset, "records", record=draft.name, recordDoctype=doctype, statuses=[status]
				)
				result = report_page(query)
				self.assertGreater(result["matched_count"], 0)
				self.assertEqual({row["document"] for row in result["rows"]}, {draft.name})
				other = "Stock Reconciliation" if doctype == "Stock Entry" else "Stock Entry"
				self.assertEqual(report_page({**query, "recordDoctype": other})["matched_count"], 0)
				with Projection(query) as projection:
					projection.build(related=True)
					self.assertEqual({row["document"] for row in projection.rows("lines")}, {draft.name})
					self.assertIn("line_name", projection.column_names["lines"])
					self.assertIn("document_id", projection.column_names["lines"])
					self.assertIn("id", projection.column_names["lines"])

	def test_empty_restrictive_item_and_allocation_selections_never_widen_scope(self):
		self.receipt()
		for dataset in DEFINITIONS:
			for flag, values in (("restrictItems", "itemCodes"), ("restrictAllocations", "allocationKeys")):
				result = report_page(self.query(dataset, **{flag: True, values: []}))
				self.assertEqual(result["matched_count"], 0, (dataset, flag))
		self.assertEqual(
			report_page(self.query(scope={"warehouses": ["missing-warehouse"]}, includeZero=True))[
				"matched_count"
			],
			0,
		)

	def test_activity_period_matches_date_overlap_and_open_ends(self):
		activities_inside = [
			activities.save_activity(
				{
					"title": f"Overlap {suffix} {self.token}",
					"activity_type": "TI-TYPE-OTHER",
					"start_date": start,
					"end_date": end,
				}
			)
			for suffix, start, end in (
				("before-start", "2026-10-01", "2026-10-22"),
				("open-start", "", "2026-10-22"),
				("open-end", "2026-10-24", ""),
				("unbounded", "", ""),
			)
		]
		outside = activities.save_activity(
			{
				"title": f"No overlap {self.token}",
				"activity_type": "TI-TYPE-OTHER",
				"start_date": "2026-10-26",
				"end_date": "2026-11-01",
			}
		)
		query = self.query(
			"activities",
			"metadata",
			scope={"period": {"key": "custom", "from": "2026-10-21", "to": "2026-10-25"}},
		)
		rows = report_page(query)["rows"]
		names = {row["id"] for row in rows}
		self.assertTrue(all(value["name"] in names for value in activities_inside))
		self.assertNotIn(outside["name"], names)

	def test_activity_uncategorized_scope_requires_a_direct_root_assignment(self):
		category = catalog.create_category("Activity category " + self.token)
		frappe.db.set_value("Item", self.item, "item_group", category["name"])
		self.loan(2)
		query = self.query("activities", "metadata")
		query["scope"]["uncategorized"] = True
		self.assertEqual(report_page(query)["matched_count"], 0)

		frappe.db.set_value("Item", self.item, "item_group", catalog.item_group_root())
		self.assertEqual(report_page(query)["matched_count"], 1)

	def test_named_views_preserve_relative_dates_and_account_isolation(self):
		from frappe.cache_manager import clear_defaults_cache

		self.addCleanup(clear_defaults_cache, "Administrator")
		query = self.query("movements")
		query["scope"]["period"]["key"] = "last_30_days"
		view = preferences.save_named_view("常用 " + self.token, query)
		self.assertEqual(view["query"]["scope"]["period"]["key"], "last_30_days")
		self.assertEqual(view["query"]["scope"]["period"]["from"], "")
		self.assertIn(view["id"], {value["id"] for value in preferences.named_views()})
		preferences.save_named_view("改名 " + self.token, view_id=view["id"], revision=view["revision"])
		with self.assertRaises(frappe.TimestampMismatchError):
			preferences.delete_named_view(view["id"], view["revision"])

	def test_date_sort_uses_native_posting_time_before_identity_on_the_same_day(self):
		late = self.submit(self.create(self.movement(quantity=1, posting_time="12:00:00.123456")))
		early = self.submit(self.create(self.movement(quantity=1, posting_time="08:00:00.654321")))
		query = self.query("movements", "records", sortBy="date", sort="asc")
		rows = report_page(query)["rows"]
		self.assertEqual([row["document"] for row in rows], [early.name, late.name])
		self.assertTrue(rows[0]["time"].endswith("654321"))
