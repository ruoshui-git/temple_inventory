"""Run with bench execute temple_inventory.tests.test_workspace.run.

Every test uses a database savepoint and rolls back all test records/settings.
No production stock or existing documents are changed.
"""

import copy
import json
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from openpyxl import load_workbook
from frappe.utils import add_days, getdate, nowdate

from temple_inventory import inventory_api as inventory_service
from temple_inventory import reporting
from temple_inventory import workspace_api as api
from temple_inventory.inventory_api import (
	DEFAULT_LOCATION_NAME,
	MOVEMENT_TYPES,
	bootstrap,
	create_uom,
	expiring_batches,
	initialization_status,
	initialize_warehouses,
	inventory,
	repair_settings,
	save_allowed_warehouses,
)

class WorkspaceTests(unittest.TestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.db.savepoint("ti_test")
		self.token = frappe.generate_hash(length=10)
		self.company = (
			frappe.db.get_single_value("Temple Inventory Settings", "company")
			or frappe.get_all("Company", pluck="name")[0]
		)
		for warehouse_type in ("Room", "Location"):
			if not frappe.db.exists("Warehouse Type", warehouse_type):
				frappe.get_doc({"doctype": "Warehouse Type", "name": warehouse_type}).insert()

		def warehouse(label, parent=None, group=0, typ=None):
			return (
				frappe.get_doc(
					{
						"doctype": "Warehouse",
						"warehouse_name": f"TI Test {label} {self.token}",
						"company": self.company,
						"parent_warehouse": parent,
						"is_group": group,
						"warehouse_type": typ,
					}
				)
				.insert()
				.name
			)

		self.root = warehouse("Root", group=1)
		self.room = warehouse("Room", self.root, 1, "Room")
		self.a = warehouse("A", self.room, typ="Location")
		self.b = warehouse("B", self.root, typ="Room")
		self.loan = warehouse("Loan", self.root, typ="Location")
		settings = frappe.get_single("Temple Inventory Settings")
		settings.company = self.company
		settings.root_warehouse = self.root
		settings.physical_root_warehouse = self.root
		settings.loan_warehouse = self.loan
		settings.leased_warehouse = self.loan
		settings.default_lease_program_warehouse = self.loan
		settings.set("allowed_warehouses", [{"warehouse": self.a}, {"warehouse": self.b}])
		settings.save()
		self.item = (
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": "TI-TEST-" + self.token,
					"item_name": "Test item",
					"item_group": "All Item Groups",
					"stock_uom": "Nos",
					"is_stock_item": 1,
				}
			)
			.insert()
			.name
		)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback(save_point="ti_test")
		frappe.clear_document_cache("Temple Inventory Settings", "Temple Inventory Settings")
		frappe.local.message_log = []

	def test_filter_selection_expands_groups_and_deduplicates_children(self):
		warehouses = {
			"root": SimpleNamespace(name="root", lft=1, rgt=10, is_group=1),
			"room": SimpleNamespace(name="room", lft=2, rgt=7, is_group=1),
			"leaf_a": SimpleNamespace(name="leaf_a", lft=3, rgt=4, is_group=0),
			"leaf_b": SimpleNamespace(name="leaf_b", lft=5, rgt=6, is_group=0),
			"other": SimpleNamespace(name="other", lft=8, rgt=9, is_group=0),
		}
		self.assertEqual(
			inventory_service._selected_leaf_warehouses(["room", "leaf_a"], warehouses), {"leaf_a", "leaf_b"}
		)
		self.assertEqual(inventory_service._selected_leaf_warehouses([], warehouses), {"leaf_a", "leaf_b", "other"})
		with self.assertRaises(frappe.PermissionError):
			inventory_service._selected_leaf_warehouses(["missing"], warehouses)

	def test_filter_array_parser_does_not_split_punctuation(self):
		self.assertEqual(
			inventory_service._selection_values('["Room / A, east", "Room / B"]'), ["Room / A, east", "Room / B"]
		)
		self.assertEqual(inventory_service._selection_values("Room / A, east"), ["Room / A, east"])

	def test_sample_opening_rows_merge_non_batch_duplicates_and_split_batches(self):
		from temple_inventory.setup.sample_inventory_data import _opening_reconciliation_documents

		documents = _opening_reconciliation_documents([
			{"item_code": "PLAIN", "warehouse": "sample-a", "qty": 6, "valuation_rate": 2},
			{"item_code": "PLAIN", "warehouse": "sample-a", "qty": 3, "valuation_rate": 2},
			{"item_code": "BATCHED", "warehouse": "sample-b", "batch_no": "B-1", "qty": 4, "valuation_rate": 5},
			{"item_code": "BATCHED", "warehouse": "sample-b", "batch_no": "B-2", "qty": 7, "valuation_rate": 5},
		])
		self.assertEqual(len(documents), 2)
		for rows in documents:
			pairs = [(row["item_code"], row["warehouse"]) for row in rows]
			self.assertEqual(len(pairs), len(set(pairs)))
		plain = next(row for rows in documents for row in rows if row["item_code"] == "PLAIN")
		self.assertEqual(plain["qty"], 9)

	def test_history_aggregate_reports_roles_categories_and_signed_changes(self):
		row = {
			"movement_kind": "Transfer",
			"items": [
				{"item_code": "ITEM-1", "item_group": "食品", "qty": 3, "uom": "Nos", "from_warehouse": "A", "to_warehouse": "B"},
				{"item_code": "ITEM-1", "item_group": "食品", "qty": 2, "uom": "Nos", "from_warehouse": "A", "to_warehouse": "B"},
			],
			"_item_code": "ITEM-1",
		}
		api._history_aggregate(row)
		self.assertEqual(row["line_count"], 2)
		self.assertEqual(row["location_count"], 2)
		self.assertEqual(row["locations"], [{"warehouse": "A", "roles": ["source"]}, {"warehouse": "B", "roles": ["destination"]}])
		self.assertEqual(row["categories"], [{"item_group": "食品", "line_count": 2}])
		self.assertEqual(row["item_changes"], [{"warehouse": "A", "delta": -5.0, "uom": "Nos"}, {"warehouse": "B", "delta": 5.0, "uom": "Nos"}])

	def test_history_aggregate_uses_reconciliation_difference_fallback(self):
		row = {
			"movement_kind": "盘点调整",
			"document_type": "Stock Reconciliation",
			"items": [{"item_code": "ITEM-1", "qty": 4, "current_qty": 7, "uom": "Nos", "warehouse": "A"}],
			"_item_code": "ITEM-1",
		}
		api._history_aggregate(row)
		self.assertEqual(row["increase_line_count"], 0)
		self.assertEqual(row["decrease_line_count"], 1)
		self.assertEqual(row["item_changes"], [{"warehouse": "A", "delta": -3.0, "uom": "Nos"}])

	def test_history_aggregate_ignores_missing_warehouse_before_sorting(self):
		row = {
			"movement_kind": "Transfer",
			"items": [
				{
					"item_code": "ITEM-1",
					"qty": 2,
					"uom": "Nos",
					"from_warehouse": None,
					"to_warehouse": "B",
				}
			],
			"_item_code": "ITEM-1",
		}
		api._history_aggregate(row)
		self.assertEqual(
			row["item_changes"],
			[{"warehouse": "B", "delta": 2.0, "uom": "Nos"}],
		)

	def test_item_code_suggestion_does_not_advance_series_and_skips_occupied_code(self):
		before = frappe.db.sql("select current from `tabSeries` where name=%s", "ITM-")
		first = inventory_service.suggest_item_code()["item_code"]
		created = inventory_service.create_item(
			{
				"item_code": first,
				"item_name": f"Suggested item {self.token}",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
			}
		)
		second = inventory_service.suggest_item_code()["item_code"]
		after = frappe.db.sql("select current from `tabSeries` where name=%s", "ITM-")
		self.assertEqual(created["item_code"], first)
		self.assertNotEqual(second, first)
		self.assertEqual(after, before)

	def test_create_item_accepts_trimmed_custom_code_and_preserves_selected_uom(self):
		uom = create_uom(f"TI UOM {self.token}")["name"]
		code = f"EXCEL-{self.token}"
		result = inventory_service.create_item(
			{
				"item_code": f"  {code}  ",
				"item_name": f"Imported item {self.token}",
				"stock_uom": uom,
				"item_group": "All Item Groups",
			}
		)
		doc = frappe.get_doc("Item", result["item_code"])
		self.assertEqual(result["item_code"], code)
		self.assertEqual(doc.stock_uom, uom)

	def test_create_item_reports_existing_custom_code_consistently(self):
		invalid = inventory_service.check_item_code("BAD<CODE")
		self.assertFalse(invalid["available"])
		self.assertEqual(invalid["reason"], "invalid")
		with self.assertRaisesRegex(frappe.DuplicateEntryError, "此物品编号已存在"):
			inventory_service.create_item(
				{
					"item_code": self.item,
					"item_name": "Duplicate item",
					"stock_uom": "Nos",
					"item_group": "All Item Groups",
				}
			)

	def test_create_item_normalizes_a_concurrent_duplicate_collision(self):
		def duplicate_insert():
			raise frappe.DuplicateEntryError

		with (
			patch.object(inventory_service, "_require_item_creation"),
			patch.object(inventory_service.frappe.db, "exists", side_effect=[False, True]),
			patch.object(
				inventory_service.frappe,
				"get_doc",
				return_value=SimpleNamespace(insert=duplicate_insert),
			),
		):
			with self.assertRaisesRegex(frappe.DuplicateEntryError, "此物品编号已存在"):
				inventory_service.create_item(
					{
						"item_code": f"RACE-{self.token}",
						"item_name": "Concurrent item",
						"stock_uom": "Nos",
						"item_group": "All Item Groups",
					}
				)

	def test_create_item_without_a_code_keeps_automatic_allocation(self):
		allocated = f"AUTO-{self.token}"
		with patch.object(inventory_service, "allocate_item_code", return_value=allocated) as allocator:
			result = inventory_service.create_item(
				{
					"item_name": f"Legacy caller item {self.token}",
					"stock_uom": "Nos",
					"item_group": "All Item Groups",
				}
			)
		self.assertEqual(result["item_code"], allocated)
		allocator.assert_called_once_with()

	def test_loans_accepts_rpc_string_paging_after_active_parent_selection(self):
		parents = [
			frappe._dict(name="loan-3", borrower="甲", activity="活动", posting_datetime="2026-01-03"),
			frappe._dict(name="loan-2", borrower="乙", activity="活动", posting_datetime="2026-01-02"),
			frappe._dict(name="loan-1", borrower="丙", activity="活动", posting_datetime="2026-01-01"),
		]
		def rows(names):
			return [frappe._dict(loan=name, loan_item=f"{name}-item", item_code=self.item, loaned=1, returned=0, damaged=0, lost=0, outstanding=1, borrower=name, activity="活动", loan_date="2026-01-01", uom="Nos") for name in names]
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_active_loan_parent_query", return_value=("1=1", {})), patch.object(inventory_service, "_all_loan_rows", side_effect=rows), patch.object(inventory_service.frappe.db, "sql", side_effect=[[frappe._dict(total=3)], [parents[1]]]), patch.object(inventory_service.frappe, "get_list", return_value=[frappe._dict(name=self.item, item_name="Test item", image=None)]):
			result = inventory_service.loans(search="Test", start="1", page_length="1")
		self.assertEqual(result["start"], 1)
		self.assertEqual(result["page_length"], 1)
		self.assertEqual(result["total"], 3)
		self.assertEqual([row["name"] for row in result["results"]], ["loan-2"])

	def test_physical_tree_keeps_an_empty_group_for_management(self):
		settings = SimpleNamespace(root_warehouse="root", physical_root_warehouse="physical", leased_warehouse="loan")
		rows = {
			"root": SimpleNamespace(name="root", parent_warehouse=None, lft=1, rgt=12, is_group=1, warehouse_type=None),
			"physical": SimpleNamespace(name="physical", parent_warehouse="root", lft=2, rgt=11, is_group=1, warehouse_type="地点"),
			"room": SimpleNamespace(name="room", parent_warehouse="physical", lft=3, rgt=6, is_group=1, warehouse_type="房间"),
			"loan": SimpleNamespace(name="loan", parent_warehouse="physical", lft=7, rgt=8, is_group=1, warehouse_type="虚拟"),
			"orphan": SimpleNamespace(name="orphan", parent_warehouse=None, lft=9, rgt=10, is_group=1, warehouse_type="地点"),
		}
		with patch.object(inventory_service, "_visible_warehouses", return_value=rows), patch.object(inventory_service, "_system_warehouse_names", return_value={"loan"}):
			self.assertEqual(set(inventory_service._physical_tree(settings)), {"room"})

	def test_warehouse_group_creation_can_use_the_physical_root_as_its_parent(self):
		settings = SimpleNamespace(physical_root_warehouse="physical")
		rows = {
			"physical": SimpleNamespace(name="physical", lft=1, rgt=6, is_group=1, warehouse_type="地点"),
			"site": SimpleNamespace(name="site", lft=2, rgt=5, is_group=1, warehouse_type="地点"),
		}
		with patch.object(inventory_service, "_visible_warehouses", return_value=rows), patch.object(inventory_service, "_system_warehouse_names", return_value=set()), patch.object(inventory_service.frappe, "has_permission", return_value=True):
			self.assertEqual(inventory_service._physical_parent(settings, "physical", allow_physical_root=True).name, "physical")
			with self.assertRaises(frappe.PermissionError):
				inventory_service._physical_parent(settings, "physical")

	def test_warehouse_management_status_handles_stale_roots_without_a_tree(self):
		settings = SimpleNamespace(company=self.company, root_warehouse="missing", physical_root_warehouse="also missing")
		with patch.object(inventory_service, "_allowed_warehouses", return_value={}):
			status = inventory_service._warehouse_management_status(settings, {}, {})
		self.assertEqual(status[0]["code"], "stale_root")
		self.assertEqual(status[0]["action"]["type"], "repair")
		self.assertEqual(status[0]["action"]["operation"], "repair_root")

	def create(self, kind="Receive", **data):
		return api.create_workspace(
			frappe.generate_hash(length=16),
			kind,
			{
				"source_text": "Donation",
				"recorder_name": "测试记录人",
				"handler_name": "测试经手人",
				"reviewer_name": "测试鉴证人",
				"items": [
					{
						"id": "line-1",
						"item_code": self.item,
						"qty": 4,
						"uom": "Nos",
						"warehouse": self.a,
						"from_warehouse": self.a,
						"to_warehouse": self.b,
					}
				],
				**data,
			},
		)

	def with_people(self, d):
		p = copy.deepcopy(d["data"])
		p["recorder_name"] = p.get("recorder_name") or "测试记录人"
		p["handler_name"] = p.get("handler_name") or "测试经手人"
		p["reviewer_name"] = p.get("reviewer_name") or "测试鉴证人"
		return api.save_workspace(d["name"], d["revision"], p)

	def confirmed(self):
		d = self.with_people(self.create())
		self.assertFalse(d["sync_error"], d["sync_error"])
		return api.confirm_workspace(d["name"], d["revision"])

	def test_initialization_required_and_example_structures(self):
		settings = frappe.get_single("Temple Inventory Settings")
		settings.company = self.company
		settings.root_warehouse = None
		settings.pending_warehouse = None
		settings.leased_warehouse = None
		settings.default_lease_program_warehouse = None
		settings.damaged_warehouse = None
		settings.set("allowed_warehouses", [])
		settings.save()
		result = initialize_warehouses(self.company, 0)
		self.assertEqual(result["rooms"], [])
		status = initialization_status()
		self.assertFalse(status["blockers"])
		self.assertIn(DEFAULT_LOCATION_NAME, [row.warehouse_name for row in status["physical_warehouses"]])
		self.assertTrue(status["allowed_warehouses"])
		initialize_warehouses(self.company, 1)
		second = frappe.db.get_value("Warehouse", {"company": self.company, "warehouse_name": "第2寺院"}, "name")
		self.assertTrue(second)
		for label in ("A02", "A04", "D03"):
			self.assertTrue(
				frappe.db.exists(
					"Warehouse", {"company": self.company, "warehouse_name": label, "parent_warehouse": second}
				)
			)

	def _mock_inventory_context(self):
		warehouses = {
			"root": SimpleNamespace(name="root", warehouse_name="Root", parent_warehouse=None, lft=1, rgt=20, is_group=1),
			"room": SimpleNamespace(name="room", warehouse_name="Room", parent_warehouse="root", lft=2, rgt=9, is_group=1),
			"leaf_a": SimpleNamespace(name="leaf_a", warehouse_name="Room / A", parent_warehouse="room", lft=3, rgt=4, is_group=0),
			"leaf_b": SimpleNamespace(name="leaf_b", warehouse_name="Room / B", parent_warehouse="room", lft=5, rgt=6, is_group=0),
			"pending": SimpleNamespace(name="pending", warehouse_name="未定位", parent_warehouse="root", lft=10, rgt=11, is_group=0),
			"lease": SimpleNamespace(name="lease", warehouse_name="借出", parent_warehouse="root", lft=12, rgt=15, is_group=1),
			"damaged": SimpleNamespace(name="损坏", warehouse_name="损坏", parent_warehouse="root", lft=16, rgt=17, is_group=0),
		}
		settings = SimpleNamespace(
			company=self.company, pending_warehouse="pending", unlocated_warehouse="pending",
			damaged_warehouse="damaged", leased_warehouse="lease", photo_required=1,
		)
		return warehouses, settings

	def test_inventory_filters_reasons_and_leaf_selection(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="待处理物品", item_group="Group A", stock_uom="Nos", image=None, description=None)
		bins = [
			SimpleNamespace(item_code="ITEM-1", warehouse="leaf_a", actual_qty=3),
			SimpleNamespace(item_code="ITEM-1", warehouse="pending", actual_qty=2),
		]
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(inventory_service.frappe, "get_list", return_value=[item]), patch.object(inventory_service.frappe, "get_all", return_value=bins):
			rows = inventory()["results"]
			leaf_rows = inventory(warehouse="leaf_b")["results"]
		self.assertEqual(rows[0]["warehouse_stock"], {"leaf_a": 3, "pending": 2})
		# Operational Pending is physical damaged/unlocated stock only; catalog
		# completeness no longer produces a pending reason.
		self.assertEqual({reason["code"] for reason in rows[0]["attention_reasons"]}, {"unlocated"})
		self.assertEqual(leaf_rows, [])

	def test_inventory_adds_scoped_batch_count_and_nearest_expiry(self):
		warehouses, settings = self._mock_inventory_context()
		expired = str(add_days(nowdate(), -2))
		future = str(add_days(nowdate(), 10))
		items = [
			SimpleNamespace(
				name="ITEM-BATCH",
				item_code="ITEM-BATCH",
				item_name="批次物品",
				item_group="Group A",
				stock_uom="Nos",
				image=None,
				description=None,
				has_batch_no=1,
			),
			SimpleNamespace(
				name="ITEM-EMPTY",
				item_code="ITEM-EMPTY",
				item_name="空批次物品",
				item_group="Group A",
				stock_uom="Nos",
				image=None,
				description=None,
				has_batch_no=1,
			),
		]
		batches = [
			SimpleNamespace(name="B-EXPIRED", item="ITEM-BATCH", expiry_date=expired, disabled=0),
			SimpleNamespace(name="B-FUTURE", item="ITEM-BATCH", expiry_date=future, disabled=0),
			SimpleNamespace(name="B-UNDATED", item="ITEM-BATCH", expiry_date=None, disabled=0),
			SimpleNamespace(name="B-ZERO", item="ITEM-BATCH", expiry_date=future, disabled=0),
			SimpleNamespace(name="B-DISABLED", item="ITEM-BATCH", expiry_date=expired, disabled=1),
		]
		bins = [
			SimpleNamespace(item_code="ITEM-BATCH", warehouse="leaf_a", actual_qty=5),
			SimpleNamespace(item_code="ITEM-BATCH", warehouse="leaf_b", actual_qty=2),
		]

		def get_list(doctype, *args, **kwargs):
			if doctype == "Item":
				return items
			if doctype == "Batch":
				self.assertEqual(kwargs["filters"]["disabled"], 0)
				return [row for row in batches if not row.disabled]
			if doctype == "Item Group":
				return []
			raise AssertionError(doctype)

		def get_all(doctype, *args, **kwargs):
			if doctype == "Bin":
				return bins
			if doctype in ("Item Group", "Item Barcode"):
				return []
			raise AssertionError(doctype)

		def batch_qty(batch_no, warehouse, item_code, **kwargs):
			return {
				("B-EXPIRED", "leaf_a"): 1,
				("B-FUTURE", "leaf_a"): 2,
				("B-FUTURE", "leaf_b"): 2,
				("B-UNDATED", "leaf_a"): 2,
				("B-DISABLED", "leaf_a"): 9,
			}.get((batch_no, warehouse), 0)

		with patch.object(inventory_service, "_require_stock"), patch.object(
			inventory_service, "_settings", return_value=settings
		), patch.object(
			inventory_service, "_visible_warehouses", return_value=warehouses
		), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(
			inventory_service, "_physical_tree", return_value={}
		), patch.object(
			inventory_service.frappe, "get_list", side_effect=get_list
		), patch.object(
			inventory_service.frappe, "get_all", side_effect=get_all
		), patch.object(inventory_service, "get_batch_qty", side_effect=batch_qty):
			page = inventory(mode="catalog")
			leaf_page = inventory(mode="catalog", warehouse="leaf_b")

		rows = {row["item_code"]: row for row in page["results"]}
		self.assertEqual(page["as_of"], str(getdate(nowdate())))
		self.assertEqual(rows["ITEM-BATCH"]["batch_count"], 3)
		self.assertEqual(rows["ITEM-BATCH"]["nearest_expiry_date"], expired)
		self.assertEqual(rows["ITEM-BATCH"]["nearest_expiry_days"], -2)
		self.assertEqual(
			rows["ITEM-BATCH"]["batches"],
			[
				{"batch_no": "B-EXPIRED", "qty": 1.0, "expiry_date": expired},
				{"batch_no": "B-FUTURE", "qty": 4.0, "expiry_date": future},
				{"batch_no": "B-UNDATED", "qty": 2.0, "expiry_date": None},
			],
		)
		self.assertEqual(rows["ITEM-EMPTY"]["batch_count"], 0)
		self.assertEqual(rows["ITEM-EMPTY"]["batches"], [])
		self.assertIsNone(rows["ITEM-EMPTY"]["nearest_expiry_date"])
		self.assertIsNone(rows["ITEM-EMPTY"]["nearest_expiry_days"])
		leaf_row = next(row for row in leaf_page["results"] if row["item_code"] == "ITEM-BATCH")
		self.assertEqual(leaf_row["batch_count"], 1)
		self.assertEqual(
			leaf_row["batches"],
			[{"batch_no": "B-FUTURE", "qty": 2.0, "expiry_date": future}],
		)
		self.assertEqual(leaf_row["nearest_expiry_date"], future)
		self.assertEqual(leaf_row["nearest_expiry_days"], 10)

	def test_inventory_rejects_nonzero_group_stock(self):
		warehouses, settings = self._mock_inventory_context()
		bad = SimpleNamespace(warehouse="room", actual_qty=1)
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service.frappe, "get_all", return_value=[bad]):
			with self.assertRaises(frappe.ValidationError):
				inventory()

	def test_inventory_paginates_complete_search_results_without_a_hundred_row_cap(self):
		warehouses, settings = self._mock_inventory_context()
		items = [
			SimpleNamespace(
				name=f"ITEM-{index}", item_code=f"ITEM-{index}", item_name=f"物品 {index}",
				item_group="Group A", stock_uom="Nos", image=None, description="说明"
			)
			for index in range(105)
		]
		bins = [SimpleNamespace(item_code=item.name, warehouse="leaf_a", actual_qty=1) for item in items]
		with patch.object(inventory_service, "_require_stock"), patch.object(
			inventory_service, "_settings", return_value=settings
		), patch.object(
			inventory_service, "_visible_warehouses", return_value=warehouses
		), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(
			inventory_service.frappe, "get_list", return_value=items
		), patch.object(inventory_service.frappe, "get_all", return_value=bins):
			page = inventory(search="物品", start=100, page_length=5)
		self.assertEqual(page["total"], 105)
		self.assertEqual(len(page["results"]), 5)
		self.assertEqual(page["quantity_totals"]["total_stock"], [{"uom": "Nos", "qty": 105.0}])

	def test_inventory_catalog_uses_database_paging_on_real_site(self):
		page = inventory(mode="catalog", search=self.item, start=0, page_length=1)
		self.assertEqual(page["total"], 1)
		self.assertEqual([row["item_code"] for row in page["results"]], [self.item])
		self.assertIn("facets", page)

	def test_inventory_database_page_translates_damaged_attention_reason(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(
			name="ITEM-DAMAGED",
			item_code="ITEM-DAMAGED",
			item_name="损坏物品",
			item_group="Group A",
			stock_uom="Nos",
			image=None,
			description=None,
			has_batch_no=0,
		)
		summary = SimpleNamespace(
			stock_uom="Nos",
			available_stock=0,
			total_stock=2,
			on_loan_qty=0,
			damaged_qty=2,
			pending_qty=0,
		)
		sql_results = [
			[item],
			[SimpleNamespace(total=1)],
			[summary],
			[item],
			[item],
			[SimpleNamespace(total=1)],
			[],
			[item],
			[SimpleNamespace(item_group="Group A", total=1)],
			[],
		]
		with patch.object(
			inventory_service, "_inventory_item_candidate_query", return_value=("select 1", [])
		), patch.object(
			inventory_service, "_inventory_expiry_scope", return_value=({}, {item.name})
		), patch.object(
			inventory_service, "_bin_balances", return_value=[
				SimpleNamespace(item_code=item.name, warehouse="damaged", actual_qty=2)
			]
		), patch.object(
			inventory_service, "_inventory_batch_summaries", return_value={}
		), patch.object(
			inventory_service, "_physical_tree", return_value={}
		), patch.object(
			inventory_service.frappe.db, "sql", side_effect=sql_results
		), patch.object(
			inventory_service.frappe, "get_list", return_value=[]
		):
			page = inventory_service._inventory_database_page(
				settings,
				warehouses,
				{"leaf_a", "damaged"},
				None,
				None,
				1,
				"current",
				0,
				25,
				None,
				None,
				None,
				None,
				{"window": "", "include_undated": True},
				30,
				None,
				None,
			)

		reasons = page["results"][0]["attention_reasons"]
		self.assertEqual([reason["code"] for reason in reasons], ["damaged"])
		self.assertIn("损坏", reasons[0]["label"])

	def test_inventory_fallback_sort_columns_and_validation(self):
		warehouses, settings = self._mock_inventory_context()
		warehouses["lease_leaf"] = SimpleNamespace(
			name="lease_leaf", warehouse_name="Loan / A", parent_warehouse="lease", lft=13, rgt=14, is_group=0
		)
		items = [
			SimpleNamespace(name="ITEM-A", item_code="ITEM-A", item_name="Same", item_group="Group A", stock_uom="Nos", image=None, description=None),
			SimpleNamespace(name="ITEM-B", item_code="ITEM-B", item_name="Same", item_group="Group A", stock_uom="Nos", image=None, description=None),
			SimpleNamespace(name="ITEM-C", item_code="ITEM-C", item_name="Zed", item_group="Group A", stock_uom="Nos", image=None, description=None),
		]
		bins = [
			SimpleNamespace(item_code="ITEM-A", warehouse="leaf_a", actual_qty=5),
			SimpleNamespace(item_code="ITEM-A", warehouse="damaged", actual_qty=2),
			SimpleNamespace(item_code="ITEM-B", warehouse="leaf_a", actual_qty=2),
			SimpleNamespace(item_code="ITEM-B", warehouse="lease_leaf", actual_qty=4),
			SimpleNamespace(item_code="ITEM-C", warehouse="pending", actual_qty=3),
		]
		def get_all(doctype, *args, **kwargs):
			if doctype == "Bin":
				return bins
			if doctype in ("Item Group", "Item Barcode"):
				return []
			raise AssertionError(doctype)
		with patch.object(inventory_service, "_require_stock"), patch.object(
			inventory_service, "_settings", return_value=settings
		), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(
			inventory_service, "_raise_on_group_stock"
		), patch.object(inventory_service, "_physical_tree", return_value={}), patch.object(
			inventory_service.frappe, "get_list", return_value=items
		), patch.object(inventory_service.frappe, "get_all", side_effect=get_all):
			for column in ("item_name", "item_code", "available_stock", "total_stock", "on_loan_qty", "damaged_qty"):
				ascending = inventory(sort_by=column, sort_order="asc")["results"]
				descending = inventory(sort_by=column, sort_order="desc")["results"]
				def values(rows):
					return [
						str(row[column]).lower() if column in {"item_name", "item_code"} else row[column]
						for row in rows
					]
				self.assertEqual(values(ascending), sorted(values(ascending)))
				self.assertEqual(values(descending), sorted(values(descending), reverse=True))
			self.assertEqual(
				[row["item_code"] for row in inventory(sort_by="item_name", sort_order="desc")["results"][-2:]],
				["ITEM-A", "ITEM-B"],
			)
			self.assertEqual(
				inventory(sort_by="total_stock", sort_order="desc", page_length=1)["results"][0]["item_code"],
				"ITEM-A",
			)
			with self.assertRaises(frappe.ValidationError):
				inventory(sort_by="unknown", sort_order="asc")
			with self.assertRaises(frappe.ValidationError):
				inventory(sort_by="item_name", sort_order="sideways")

	def test_expiry_aggregates_filters_sorts_and_paginates(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="批次物品", item_group="Group A", stock_uom="Nos")
		batches = [
			SimpleNamespace(name="B-OLD", item="ITEM-1", expiry_date="2099-01-01"),
			SimpleNamespace(name="B-NEW", item="ITEM-1", expiry_date="2099-02-01"),
			SimpleNamespace(name="B-ZERO", item="ITEM-1", expiry_date="2099-03-01"),
		]
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item":
				return [item]
			if doctype == "Batch":
				return batches
			if doctype == "Item Group":
				return [SimpleNamespace(name="Group A", lft=1, rgt=2)]
			raise AssertionError(doctype)
		def batch_qty(batch_no, warehouse, item_code, **kwargs):
			return {("B-OLD", "leaf_a"): 2, ("B-OLD", "leaf_b"): 1, ("B-NEW", "leaf_a"): 4}.get((batch_no, warehouse), 0)
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(inventory_service.frappe, "get_all", side_effect=get_all), patch.object(inventory_service, "get_batch_qty", side_effect=batch_qty):
			page = expiring_batches(item_group="Group A", sort="desc", start=0, page_length=1)
			second_page = expiring_batches(item_group="Group A", sort="desc", start=1, page_length=1)
		self.assertEqual(page["total"], 2)
		self.assertEqual(page["results"][0]["batch_no"], "B-NEW")
		self.assertEqual(page["results"][0]["total_qty"], 4)
		self.assertEqual(second_page["results"][0]["batch_no"], "B-OLD")
		self.assertEqual(len(second_page["results"][0]["locations"]), 2)
		self.assertEqual(page["quantity_totals"]["total_qty"], [{"uom": "Nos", "qty": 7.0}])
		self.assertEqual(second_page["quantity_totals"], page["quantity_totals"])

	def test_expiry_new_sort_columns_and_validation(self):
		warehouses, settings = self._mock_inventory_context()
		items = [
			SimpleNamespace(name="ITEM-A", item_code="ITEM-A", item_name="Zulu", item_group="Group A", stock_uom="Nos"),
			SimpleNamespace(name="ITEM-B", item_code="ITEM-B", item_name="alpha", item_group="Group A", stock_uom="Nos"),
		]
		batches = [
			SimpleNamespace(name="B-A", item="ITEM-A", expiry_date="2099-01-01"),
			SimpleNamespace(name="B-B", item="ITEM-B", expiry_date="2099-02-01"),
		]
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item":
				return items
			if doctype == "Batch":
				return batches
			if doctype == "Item Group":
				return []
			raise AssertionError(doctype)
		def batch_qty(batch_no, warehouse, item_code, **kwargs):
			return {("B-A", "leaf_a"): 1, ("B-B", "leaf_a"): 5}.get((batch_no, warehouse), 0)
		with patch.object(inventory_service, "_require_stock"), patch.object(
			inventory_service, "_settings", return_value=settings
		), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(
			inventory_service, "_raise_on_group_stock"
		), patch.object(inventory_service, "_physical_tree", return_value={}), patch.object(
			inventory_service.frappe, "get_all", side_effect=get_all
		), patch.object(inventory_service, "get_batch_qty", side_effect=batch_qty):
			self.assertEqual(
				expiring_batches(sort_by="item_name", sort_order="asc")["results"][0]["batch_no"], "B-B"
			)
			self.assertEqual(
				expiring_batches(sort_by="total_qty", sort_order="desc", page_length=1)["results"][0]["batch_no"],
				"B-B",
			)
			with self.assertRaises(frappe.ValidationError):
				expiring_batches(sort_by="unknown", sort_order="asc")
			with self.assertRaises(frappe.ValidationError):
				expiring_batches(sort_by="expiry_date", sort_order="sideways")

	def test_expiry_applies_search_date_and_warehouse_filters(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="过滤物品", item_group="Group A", stock_uom="Nos")
		batch = SimpleNamespace(name="B-FILTER", item="ITEM-1", expiry_date="2099-01-01")
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item":
				return [item]
			if doctype == "Batch":
				return [batch]
			raise AssertionError(doctype)
		def batch_qty(batch_no, warehouse, item_code, **kwargs):
			return 3 if warehouse == "leaf_a" else 0
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(inventory_service.frappe, "get_all", side_effect=get_all), patch.object(inventory_service, "get_batch_qty", side_effect=batch_qty):
			self.assertEqual(expiring_batches(search="no-match")["total"], 0)
			self.assertEqual(expiring_batches(expiry_from="2100-01-01")["total"], 0)
			self.assertEqual(expiring_batches(warehouse="leaf_b")["total"], 0)

	def test_expiry_reports_overdue_days(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="过期物品", item_group="Group A", stock_uom="Nos")
		batch = SimpleNamespace(name="B-EXPIRED", item="ITEM-1", expiry_date="2000-01-01")
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item":
				return [item]
			if doctype == "Batch":
				return [batch]
			raise AssertionError(doctype)
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(inventory_service.frappe, "get_all", side_effect=get_all), patch.object(inventory_service, "get_batch_qty", return_value=2):
			result = expiring_batches()
		self.assertLess(result["results"][0]["days_to_expiry"], 0)

	def test_expiry_summary_ignores_selected_window_and_counts_distinct_batches(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="汇总物品", item_group="Group A", stock_uom="Nos")
		batches = [
			SimpleNamespace(name="B-EXPIRED", item="ITEM-1", expiry_date=str(add_days(nowdate(), -2))),
			SimpleNamespace(name="B-7", item="ITEM-1", expiry_date=str(add_days(nowdate(), 2))),
			SimpleNamespace(name="B-8-30", item="ITEM-1", expiry_date=str(add_days(nowdate(), 10))),
			SimpleNamespace(name="B-LATER", item="ITEM-1", expiry_date=str(add_days(nowdate(), 31))),
			SimpleNamespace(name="B-ZERO", item="ITEM-1", expiry_date=str(add_days(nowdate(), 3))),
		]
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item":
				return [item]
			if doctype == "Batch":
				return batches
			raise AssertionError(doctype)
		def batch_qty(batch_no, warehouse, item_code, **kwargs):
			return 0 if batch_no == "B-ZERO" else 1
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(inventory_service.frappe, "get_all", side_effect=get_all), patch.object(inventory_service, "get_batch_qty", side_effect=batch_qty):
			result = expiring_batches(expiry_window="remaining_within", expiry_days=2)
		self.assertEqual(result["total"], 1)
		self.assertEqual(result["expiry_summary"]["expired"], 1)
		self.assertEqual(result["expiry_summary"]["expiring_soon"], 2)
		self.assertEqual(result["expiry_summary"]["within_7_days"], 1)
		self.assertEqual(result["expiry_summary"]["days_8_to_30"], 1)
		self.assertEqual(result["expiry_summary"]["average_remaining_days"], 6)

	def test_all_movement_kinds_carry_canonical_audit_fields(self):
		with patch.object(api, "_try_sync"):
			metadata = api.create_workspace(frappe.generate_hash(length=16), "Receive", {"recorded_by": "Guest", "responsible_person": "Guest", "recorder_name": "记录甲", "handler_name": "经手乙", "reviewer_name": "鉴证丙", "items": []})
			self.assertEqual(metadata["data"]["recorded_by"], frappe.session.user)
			self.assertEqual(metadata["data"]["responsible_person"], frappe.session.user)
			self.assertEqual(metadata["data"]["recorder_name"], "记录甲")
			for kind in MOVEMENT_TYPES:
				draft = api.create_workspace(
					frappe.generate_hash(length=16),
					kind,
					{"recorder_name": "记录甲", "handler_name": "经手乙", "reviewer_name": "鉴证丙", "items": []},
				)
				self.assertEqual(draft["data"]["recorder_name"], "记录甲")
				self.assertEqual(draft["data"]["handler_name"], "经手乙")
				self.assertEqual(draft["data"]["reviewer_name"], "鉴证丙")
				self.assertEqual(draft["data"]["recorded_by"], frappe.session.user)

	def test_expiry_requires_stock_permission(self):
		with patch.object(inventory_service, "_require_stock", side_effect=frappe.PermissionError):
			with self.assertRaises(frappe.PermissionError):
				expiring_batches()

	def test_repair_settings_enables_batch_and_allowlist(self):
		initialize_warehouses(self.company, 0)
		settings = frappe.get_single("Temple Inventory Settings")
		settings.set("allowed_warehouses", [])
		settings.save()
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 0)
		self.assertTrue(initialization_status()["warnings"])
		repair_settings()
		self.assertTrue(frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item"))
		self.assertTrue(frappe.get_single("Temple Inventory Settings").allowed_warehouses)

	def test_initialization_reports_missing_erpnext(self):
		with patch.object(frappe, "get_installed_apps", return_value=["frappe", "temple_inventory"]):
			status = initialization_status()
		self.assertTrue(status["setup_required"])
		self.assertEqual(status["blockers"][0]["code"], "erpnext")

	def test_initialization_reports_missing_or_ambiguous_company(self):
		with patch.object(frappe, "get_all", return_value=[]):
			status = initialization_status()
		self.assertEqual(status["blockers"][0]["code"], "company")
		with patch.object(frappe, "get_all", return_value=["One", "Two"]):
			status = initialization_status()
		self.assertEqual(status["blockers"][0]["code"], "company_selection")

	def test_incomplete_retry_and_revision(self):
		token = frappe.generate_hash(length=16)
		d = api.create_workspace(token, "Receive", {"notes": "Incomplete"})
		self.assertFalse(d["stock_entry"])
		self.assertTrue(d["sync_error"])
		self.assertEqual(d["name"], api.create_workspace(token, "Receive")["name"])
		d2 = api.save_workspace(d["name"], d["revision"], {"notes": "Still incomplete"})
		self.assertEqual(api.load_workspace(d["name"])["data"]["notes"], "Still incomplete")
		with self.assertRaises(frappe.TimestampMismatchError):
			api.save_workspace(d["name"], d["revision"], {"notes": "Stale"})
		self.assertEqual(d2["revision"], d["revision"] + 1)

	def test_delete_draft_removes_workspace_and_unsubmitted_entry(self):
		empty = api.create_workspace(frappe.generate_hash(length=16), "Receive", {"notes": "Empty draft"})
		self.assertTrue(api.delete_draft(empty["name"])["deleted"])
		self.assertFalse(frappe.db.exists("Inventory Workspace", empty["name"]))

		draft = self.create()
		entry = draft["stock_entry"]
		self.assertTrue(entry)
		self.assertTrue(api.delete_draft(draft["name"])["deleted"])
		self.assertFalse(frappe.db.exists("Inventory Workspace", draft["name"]))
		self.assertFalse(frappe.db.exists("Stock Entry", entry))

	def test_multi_room_draft_and_idempotent_submit(self):
		d = self.create(
			items=[
				{"id": "a", "item_code": self.item, "qty": 2, "uom": "Nos", "warehouse": self.a},
				{"id": "b", "item_code": self.item, "qty": 3, "uom": "Nos", "warehouse": self.b},
			]
		)
		self.assertFalse(d["sync_error"], d["sync_error"])
		self.assertFalse(frappe.db.exists("Stock Ledger Entry", {"voucher_no": d["stock_entry"]}))
		result = api.confirm_workspace(d["name"], d["revision"])
		self.assertEqual(result["docstatus"], 1)
		again = api.confirm_workspace(d["name"], result["revision"])
		self.assertEqual(result["stock_entry"], again["stock_entry"])
		self.assertEqual(frappe.db.count("Stock Ledger Entry", {"voucher_no": result["stock_entry"]}), 2)
		with self.assertRaises(frappe.ValidationError):
			api.save_workspace(d["name"], result["revision"], result["data"])

	def test_reconciliation_reuses_inserted_draft_on_retry(self):
		settings = frappe.get_single("Temple Inventory Settings")
		settings.physical_root_warehouse = self.root
		settings.save()
		frappe.db.set_value("Item", self.item, "valuation_rate", 1)
		payload = {
			"warehouse": self.a,
			"mode": "selective",
			"posting_date": nowdate(),
			"posting_time": "12:00:00",
			"recorder_name": "盘点记录人",
			"handler_name": "盘点经手人",
			"reviewer_name": "盘点鉴证人",
			"items": [{"item_code": self.item, "counted_qty": 1}],
		}
		draft = api.create_reconciliation(
			frappe.generate_hash(length=16), json.dumps(payload, ensure_ascii=False)
		)
		meta = frappe.get_meta("Stock Reconciliation")
		existing_data = {
			"doctype": "Stock Reconciliation",
			"company": self.company,
			"purpose": "Stock Reconciliation",
			"posting_date": payload["posting_date"],
			"posting_time": payload["posting_time"],
			"items": [{"item_code": self.item, "warehouse": self.a, "qty": 1, "stock_uom": "Nos", "valuation_rate": 1}],
		}
		temporary_account = frappe.db.get_value(
			"Account",
			{"company": self.company, "account_type": "Temporary", "is_group": 0, "disabled": 0},
			"name",
		)
		if temporary_account:
			existing_data["expense_account"] = temporary_account
		if meta.has_field("ti_workspace"):
			existing_data["ti_workspace"] = draft["name"]
		existing = frappe.get_doc(existing_data).insert(
			set_name=api._reconciliation_document_name(draft["name"]) if not meta.has_field("ti_workspace") else None
		)
		if meta.has_field("ti_workspace"):
			self.assertEqual(frappe.db.get_value("Stock Reconciliation", {"ti_workspace": draft["name"]}, "name"), existing.name)
		result = api.confirm_reconciliation(draft["name"], draft["revision"])
		linked_names = frappe.get_all("Stock Reconciliation", filters={"ti_workspace": draft["name"]}, pluck="name") if meta.has_field("ti_workspace") else []
		self.assertEqual(result["stock_reconciliation"], existing.name, linked_names)
		self.assertEqual(frappe.db.count("Stock Reconciliation", {"name": existing.name}), 1)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", existing.name, "docstatus"), 1)

	def test_people_fields_are_optional_and_do_not_control_submission(self):
		d = self.create(recorder_name="", handler_name="", reviewer_name="")
		result = api.confirm_workspace(d["name"], d["revision"])
		self.assertEqual(result["docstatus"], 1)
		self.assertEqual(result["data"]["recorded_by"], frappe.session.user)
		for field in ("recorder_name", "handler_name", "reviewer_name"):
			self.assertFalse(result["data"].get(field))

	def test_workspace_stock_entry_remains_protected_from_direct_edit(self):
		d = self.create()
		p = copy.deepcopy(d["data"])
		p["notes"] = "Changed before submission"
		d = api.save_workspace(d["name"], d["revision"], p)
		doc = frappe.get_doc("Stock Entry", d["stock_entry"])
		doc.remarks = "Bypass"
		with self.assertRaises(frappe.PermissionError):
			doc.save()

	def test_duplicate_issue_rows_aggregate_stock(self):
		self.confirmed()
		d = self.create(
			"Issue",
			items=[
				{"id": str(i), "item_code": self.item, "qty": 3, "warehouse": self.a, "uom": "Nos"}
				for i in range(2)
			],
		)
		self.assertIn("Insufficient stock", d["sync_error"])
		self.assertFalse(d["stock_entry"])

	def test_transfer_and_loan_return_mappings(self):
		self.confirmed()
		transfer = self.create(
			"Transfer",
			items=[{"id": "transfer", "item_code": self.item, "qty": 1, "uom": "Nos", "from_warehouse": self.a, "to_warehouse": self.b}],
		)
		self.assertFalse(transfer["sync_error"], transfer["sync_error"])
		row = frappe.get_doc("Stock Entry", transfer["stock_entry"]).items[0]
		self.assertEqual(row.s_warehouse, self.a)
		self.assertEqual(row.t_warehouse, self.b)

		loan = self.create("Loan", borrower="Test borrower", items=[{"id": "loan", "item_code": self.item, "qty": 1, "uom": "Nos", "from_warehouse": self.a}])
		loan = self.with_people(loan)
		loan = api.confirm_workspace(loan["name"], loan["revision"])
		loan_item = frappe.get_all("Inventory Loan Item", filters={"parent": loan["data"]["loan_record"]}, pluck="name")[0]
		loan_entry = frappe.get_doc("Stock Entry", loan["stock_entry"])
		self.assertTrue(loan_entry.items[0].t_warehouse)
		picker = inventory_service.loan_items()
		picked_line = next(row for row in picker["results"] if row["loan_item"] == loan_item)
		self.assertEqual(picked_line["outstanding"], 1)

		returned = self.create("Return", items=[{"id": "return", "item_code": self.item, "qty": 1, "uom": "Nos", "loan_item": loan_item, "outcome": "Returned", "to_warehouse": self.a}])
		returned = self.with_people(returned)
		returned = api.confirm_workspace(returned["name"], returned["revision"])
		return_entry = frappe.get_doc("Stock Entry", returned["stock_entry"])
		self.assertEqual(return_entry.items[0].s_warehouse, loan_entry.items[0].t_warehouse)
		self.assertEqual(return_entry.items[0].t_warehouse, self.a)

	def test_zero_valuation_without_source_or_rate(self):
		for source_text in ("Purchase", ""):
			d = self.create(source_text=source_text)
			self.assertFalse(d["sync_error"], d["sync_error"])
			row = frappe.get_doc("Stock Entry", d["stock_entry"]).items[0]
			self.assertEqual(row.allow_zero_valuation_rate, 1)

	def test_zero_donation_and_existing_valuation(self):
		d = self.create()
		self.assertFalse(d["sync_error"], d["sync_error"])
		self.assertEqual(
			frappe.get_doc("Stock Entry", d["stock_entry"]).items[0].allow_zero_valuation_rate, 1
		)
		frappe.db.set_value("Item", self.item, "valuation_rate", 12)
		d = self.create()
		self.assertFalse(d["sync_error"], d["sync_error"])
		row = frappe.get_doc("Stock Entry", d["stock_entry"]).items[0]
		self.assertEqual(row.basic_rate, 12)
		self.assertFalse(row.allow_zero_valuation_rate)

	def test_batch_receipt_and_wrong_item(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.has_expiry_date = 1
		item.save()
		d = self.create(
			items=[
				{
					"id": "batch",
					"item_code": self.item,
					"qty": 2,
					"warehouse": self.a,
					"uom": "Nos",
					"new_batch": True,
					"expiry_date": "2035-01-01",
				}
			]
		)
		self.assertFalse(d["sync_error"], d["sync_error"])
		self.assertTrue(d["data"]["items"][0]["batch_no"])
		d = self.with_people(d)
		d = api.confirm_workspace(d["name"], d["revision"])
		self.assertEqual(d["docstatus"], 1)
		self.assertEqual(api.batches(self.item, self.a)[0]["qty"], 2)

	def test_expired_donation_batch_can_be_received(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.has_expiry_date = 1
		item.save()
		d = self.create(
			items=[
				{
					"id": "expired-donation",
					"item_code": self.item,
					"qty": 1,
					"warehouse": self.a,
					"uom": "Nos",
					"new_batch": True,
					"manufacturing_date": "1999-01-01",
					"expiry_date": "2000-01-01",
				}
			]
		)
		self.assertFalse(d["sync_error"], d["sync_error"])
		with_people = self.with_people(d)
		result = api.confirm_workspace(with_people["name"], with_people["revision"])
		self.assertEqual(result["docstatus"], 1)
		batch = frappe.get_doc("Batch", result["data"]["items"][0]["batch_no"])
		self.assertEqual(str(batch.expiry_date), "2000-01-01")
		existing = self.create(
			items=[
				{
					"id": "existing-expired-donation",
					"item_code": self.item,
					"qty": 1,
					"warehouse": self.a,
					"uom": "Nos",
					"batch_no": batch.name,
				}
			]
		)
		self.assertFalse(existing["sync_error"], existing["sync_error"])
		existing = self.with_people(existing)
		self.assertEqual(
			api.confirm_workspace(existing["name"], existing["revision"])["docstatus"], 1
		)

	def test_direct_desk_entry_is_not_claimed_by_open_entry(self):
		entry = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"company": self.company,
				"stock_entry_type": "Material Receipt",
				"purpose": "Material Receipt",
				"ti_movement_kind": "Receive",
				"items": [
					{
						"item_code": self.item,
						"qty": 1,
						"t_warehouse": self.a,
						"allow_zero_valuation_rate": 1,
					}
				],
			}
		).insert()
		opened = api.open_entry(entry.name)
		self.assertTrue(opened["direct_entry"])
		self.assertFalse(frappe.db.exists("Inventory Workspace", {"stock_entry": entry.name}))
		entry.reload()
		entry.remarks = "仍由 ERPNext 直接编辑"
		entry.save()
		entry.submit()
		self.assertEqual(entry.docstatus, 1)

	def test_desk_created_location_is_added_to_allowed_warehouses(self):
		location = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"TI Desk Location {self.token}",
				"company": self.company,
				"parent_warehouse": self.room,
				"is_group": 0,
				"warehouse_type": "Location",
			}
		).insert()
		inventory_service.sync_desk_warehouse_allowlist(location)
		settings = frappe.get_single("Temple Inventory Settings")
		self.assertIn(location.name, {row.warehouse for row in settings.allowed_warehouses})
		settings.set("allowed_warehouses", [
			{"warehouse": row.warehouse}
			for row in settings.allowed_warehouses
			if row.warehouse != location.name
		])
		settings.save()
		from temple_inventory.patches.v3_allow_existing_physical_locations import execute

		execute()
		settings.reload()
		self.assertIn(location.name, {row.warehouse for row in settings.allowed_warehouses})
		settings.set("allowed_warehouses", [
			{"warehouse": row.warehouse}
			for row in settings.allowed_warehouses
			if row.warehouse != location.name
		])
		settings.save()
		location.warehouse_name += " Renamed"
		location.save()
		settings.reload()
		self.assertNotIn(location.name, {row.warehouse for row in settings.allowed_warehouses})

	def test_desk_created_untyped_physical_leaf_is_added_to_allowed_warehouses(self):
		location = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"TI Desk Untyped {self.token}",
				"company": self.company,
				"parent_warehouse": self.room,
				"is_group": 0,
			}
		).insert()
		inventory_service.sync_desk_warehouse_allowlist(location)
		settings = frappe.get_single("Temple Inventory Settings")
		self.assertIn(location.name, {row.warehouse for row in settings.allowed_warehouses})

	def test_desk_leaf_outside_physical_root_is_ignored(self):
		outside_group = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"TI Outside Group {self.token}",
				"company": self.company,
				"is_group": 1,
			}
		).insert()
		location = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"TI Outside Location {self.token}",
				"company": self.company,
				"parent_warehouse": outside_group.name,
				"is_group": 0,
			}
		).insert()
		inventory_service.sync_desk_warehouse_allowlist(location)
		settings = frappe.get_single("Temple Inventory Settings")
		self.assertNotIn(location.name, {row.warehouse for row in settings.allowed_warehouses})
		self.assertNotIn(location.name, inventory_service._physical_tree(settings))

	def test_ordinary_desk_leaf_cannot_keep_a_fallback_role(self):
		location = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"TI Ordinary Location {self.token}",
				"company": self.company,
				"parent_warehouse": self.room,
				"is_group": 0,
				"warehouse_type": "Location",
				"ti_fallback_role": "room_default",
			}
		).insert()
		inventory_service.sync_desk_warehouse_allowlist(location)
		self.assertFalse(frappe.db.get_value("Warehouse", location.name, "ti_fallback_role"))

	def test_warehouse_metadata_repair_is_physical_tree_scoped(self):
		outside_group = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": f"TI Outside Metadata {self.token}",
				"company": self.company,
				"is_group": 1,
				"ti_fallback_role": "room_default",
			}
		).insert()
		frappe.db.set_value("Warehouse", self.room, "ti_fallback_role", "room_default", update_modified=False)

		issues = inventory_service._warehouse_metadata_issues()

		self.assertEqual([row["warehouse"] for row in issues], [self.room])
		remaining = inventory_service.repair_warehouse_metadata(self.room)
		self.assertEqual(remaining, [])
		self.assertFalse(frappe.db.get_value("Warehouse", self.room, "ti_fallback_role"))
		self.assertNotIn(outside_group.name, inventory_service._physical_tree())
		self.assertIn(
			self.room,
			{row["name"] for row in inventory_service._user_facing_warehouse_presentation()},
		)

	def test_history_filters_and_leaf_rejection(self):
		d = self.create(source_text="A Donor")
		sql_page = api.history({"source_text": "A Donor", "movement_kind": "Receive"}, page_length=1)
		self.assertEqual(sql_page["total"], 1)
		self.assertEqual(sql_page["results"][0]["name"], d["name"])
		search_page = api.history({"search": "A Donor"}, page_length=1)
		self.assertEqual(search_page["total"], 1)
		self.assertEqual(search_page["results"][0]["name"], d["name"])
		result = api.history({"source_text": "A Donor", "room": self.room, "movement_kind": "Receive"})
		self.assertEqual(result["total"], 1)
		page = api.history(page_length=1)
		self.assertGreaterEqual(page["total"], 1)
		self.assertEqual(len(page["results"]), 1)
		self.assertGreaterEqual(page["facets"]["movement_kind"].get("Receive", 0), 1)
		d = self.create(
			items=[{"id": "bad", "item_code": self.item, "qty": 2, "warehouse": self.room, "uom": "Nos"}]
		)
		self.assertIn("leaf warehouse", d["sync_error"])

	def test_history_sort_columns_pagination_and_validation(self):
		source = f"Sort Source {self.token}"
		first = self.create(
			source_text=f"{source} B", posting_date="2098-01-02", posting_time_mode="manual"
		)
		second = self.create(
			source_text=f"{source} A",
			posting_date="2098-01-01",
			posting_time_mode="manual",
			items=[
				{"id": "line-a", "item_code": self.item, "qty": 1, "uom": "Nos", "from_warehouse": self.a, "to_warehouse": self.b},
				{"id": "line-b", "item_code": self.item, "qty": 2, "uom": "Nos", "from_warehouse": self.a, "to_warehouse": self.b},
			],
		)
		self.assertNotEqual(first["name"], second["name"])
		stored = frappe.get_all(
			"Inventory Workspace",
			filters={"name": ("in", [first["name"], second["name"]])},
			fields=["name", "posting_date", "source_text"],
		)
		self.assertEqual(len(stored), 2, stored)
		filters = {}
		for column in (
			"title",
			"posting_date",
			"line_count",
			"location_count",
			"category_count",
			"increase_line_count",
			"decrease_line_count",
		):
			ascending = api.history(filters, sort_by=column, sort_order="asc", page_length=100)["results"]
			descending = api.history(filters, sort_by=column, sort_order="desc", page_length=100)["results"]
			def values(rows):
				return [str(row[column]).lower() if column == "title" else row[column] for row in rows]
			self.assertEqual(values(ascending), sorted(values(ascending)))
			self.assertEqual(values(descending), sorted(values(descending), reverse=True))
		self.assertTrue({first["name"], second["name"]}.issubset({row["name"] for row in ascending}))
		page = api.history(filters, sort_by="posting_date", sort_order="desc", page_length=1)
		self.assertGreaterEqual(page["total"], 2)
		self.assertEqual(page["results"][0]["name"], first["name"])
		with self.assertRaises(frappe.ValidationError):
			api.history(filters, sort_by="unknown", sort_order="asc")
		with self.assertRaises(frappe.ValidationError):
			api.history(filters, sort_by="title", sort_order="sideways")

	def test_movement_period_resolution(self):
		with patch.object(api, "nowdate", return_value="2026-09-28"):
			self.assertEqual(
				api._movement_period({}, default=True),
				{"key": "last_30_days", "date_from": "2026-08-30", "date_to": "2026-09-28"},
			)
			self.assertEqual(
				api._movement_period({"period_key": "this_week"}),
				{"key": "this_week", "date_from": "2026-09-28", "date_to": "2026-09-28"},
			)
			self.assertEqual(
				api._movement_period({"period_key": "this_year"}),
				{"key": "this_year", "date_from": "2026-01-01", "date_to": "2026-09-28"},
			)
			self.assertEqual(
				api._movement_period({"period_key": "last_90_days"}),
				{"key": "last_90_days", "date_from": "2026-07-01", "date_to": "2026-09-28"},
			)
		with self.assertRaises(frappe.ValidationError):
			api._movement_period(
				{"period_key": "custom", "date_from": "2026-09-29", "date_to": "2026-09-28"}
			)

	def test_movement_filter_options_searches_codes_and_titles(self):
		options = api.movement_filter_options(search=self.item, page_length=1)
		self.assertEqual(options["items"][0]["name"], self.item)
		self.assertIn("item_name", options["items"][0])
		self.assertIn("title", options.get("activities", [{}])[0] if options.get("activities") else {"title": ""})

	def test_movement_ledger_normalizes_signed_lines_and_zero_reconciliation(self):
		rows = [{"name": "R1", "movement_kind": "Receive", "document_type": "Stock Entry", "docstatus": 1, "items": [{"id": "L1", "item_code": "ITM-1", "qty": 2, "uom": "Nos", "stock_qty": 2, "stock_uom": "Nos", "warehouse": "A01"}]}]
		lines = api._ledger_item_rows(rows)
		self.assertEqual(lines[0]["stock_qty"], 2)
		self.assertEqual(lines[0]["destination_warehouse"], "A01")
		zero = [{"name": "R2", "movement_kind": "盘点调整", "document_type": "Stock Reconciliation", "items": [{"item_code": "ITM-1", "qty": 4, "current_qty": 4, "uom": "Nos", "stock_uom": "Nos", "warehouse": "A01"}]}]
		self.assertEqual(api._ledger_item_rows(zero), [])

	def test_movement_item_metadata_overwrites_stale_values_and_hides_unreadable_items(self):
		rows = [
			{
				"_all_items": [
					{
						"item_code": "ITEM-A",
						"item_name": "旧名称",
						"item_group": "旧类别",
						"stock_uom": "旧单位",
						"image": "/private/old.png",
					},
					{
						"item_code": "ITEM-HIDDEN",
						"item_name": "不应泄露",
						"item_group": "隐藏类别",
						"stock_uom": "Nos",
						"image": "/private/hidden.png",
					},
				]
			}
		]
		with patch.object(
			frappe,
			"get_list",
			return_value=[
				frappe._dict(
					name="ITEM-A",
					item_name="权威名称",
					item_group="权威类别",
					stock_uom="包",
					image="/files/current.png",
				)
			],
		):
			api._history_hydrate_item_metadata(rows)
		self.assertEqual(rows[0]["_all_items"][0]["item_name"], "权威名称")
		self.assertEqual(rows[0]["_all_items"][0]["item_group"], "权威类别")
		self.assertEqual(rows[0]["_all_items"][0]["stock_uom"], "包")
		self.assertEqual(rows[0]["_all_items"][0]["image"], "/files/current.png")
		self.assertEqual(rows[0]["_all_items"][1]["item_name"], "ITEM-HIDDEN")
		self.assertEqual(rows[0]["_all_items"][1]["item_group"], "")
		self.assertEqual(rows[0]["_all_items"][1]["image"], "")

	def test_movement_ledger_endpoints_count_lines_records_and_preserve_flows(self):
		records = [
			{
				"name": "REC-COMPLETE",
				"movement_kind": "Receive",
				"document_type": "Stock Entry",
				"docstatus": 1,
				"posting_date": "2026-09-28",
				"posting_time": "10:00:00",
				"activity": "ACT-1",
				"notes": "workspace note",
				"detail_route": "/entry/REC-COMPLETE",
				"items": [
					{"id": "L1", "item_code": "ITEM-A", "item_name": "A", "item_group": "食品", "qty": 2, "uom": "盒", "stock_qty": 4, "stock_uom": "Nos", "to_warehouse": "WH-A"},
					{"id": "L2", "item_code": "ITEM-B", "item_name": "B", "item_group": "食品", "qty": 1, "uom": "包", "stock_qty": 3, "stock_uom": "Nos", "to_warehouse": "WH-B"},
				],
			},
			{
				"name": "REC-DRAFT",
				"movement_kind": "Issue",
				"document_type": "Stock Entry",
				"docstatus": 0,
				"posting_date": "2026-09-27",
				"posting_time": "09:00:00",
				"items": [{"id": "L3", "item_code": "ITEM-A", "qty": 1, "uom": "Nos", "stock_qty": 1, "stock_uom": "Nos", "from_warehouse": "WH-A"}],
			},
			{
				"name": "REC-ZERO",
				"movement_kind": "盘点调整",
				"document_type": "Stock Reconciliation",
				"docstatus": 1,
				"items": [{"id": "L4", "item_code": "ITEM-A", "qty": 5, "current_qty": 5, "stock_uom": "Nos", "warehouse": "WH-A"}],
			},
		]
		def scoped_records(filters, docstatuses=None):
			allowed = set(docstatuses if docstatuses is not None else [0, 1, 2])
			return [row for row in records if row.get("docstatus") in allowed]
		def hydrate_activity(items):
			for item in items:
				if item.get("activity"):
					item["activity_title"] = "法会活动"
		with patch.object(api, "_movement_history_records", side_effect=scoped_records), patch.object(api, "_ledger_activity_titles", side_effect=hydrate_activity):
			items = api.movement_items({"period_key": "this_month"}, page_length=1)
			self.assertEqual(items["total"], 2)
			self.assertEqual(items["all_total"], 2)
			self.assertEqual(items["facets"]["movement_kind"]["Receive"], 2)
			self.assertEqual(items["results"][0]["detail_route"], "/entry/REC-COMPLETE")
			self.assertEqual(items["results"][0]["notes"], "workspace note")
			receive = api.movement_items({"movement_kinds": ["Receive"]}, page_length=100)
			self.assertEqual(receive["total"], 2)
			record_page = api.movement_records({"period_key": "this_month"}, page_length=100)
			self.assertEqual(record_page["total"], 2)
			self.assertEqual(record_page["facets"]["movement_kind"]["Receive"], 1)
			self.assertEqual(record_page["facets"]["source_warehouses"], {"WH-A": 1})
			self.assertEqual(record_page["facets"]["destination_warehouses"], {"WH-A": 1, "WH-B": 1})
			self.assertEqual(record_page["results"][0]["notes"], "workspace note")
			self.assertEqual(record_page["results"][0]["activity"], "ACT-1")
			self.assertEqual(record_page["results"][0]["activity_title"], "法会活动")
			drafts = api.movement_records({}, page_length=100, docstatuses=[0])
			self.assertEqual(drafts["total"], 1)
			self.assertEqual(drafts["facets"]["docstatus"], {0: 1})
		with self.assertRaises(frappe.ValidationError):
			api.movement_records({}, docstatuses=[3])

	def test_movement_overview_summarizes_submitted_entries(self):
		confirmed = self.confirmed()
		page = api.movement_overview(
			{"period_key": "custom", "date_from": nowdate(), "date_to": nowdate()}
		)
		self.assertEqual(page["resolved_period"]["key"], "custom")
		self.assertIn(self.item, {row["item_code"] for row in page["results"]})
		receive = next(row for row in page["action_summaries"] if row["movement_kind"] == "Receive")
		self.assertGreaterEqual(receive["item_count"], 1)
		self.assertGreaterEqual(receive["record_count"], 1)
		self.assertIn({"uom": "Nos", "qty": 4.0}, receive["quantities"])
		self.assertEqual(len(page["action_summaries"]), len(api.MOVEMENT_OVERVIEW_KINDS))
		filtered = api.movement_overview(
			{
				"period_key": "custom",
				"date_from": nowdate(),
				"date_to": nowdate(),
				"movement_kinds": ["Issue"],
			}
		)
		self.assertFalse(filtered["results"])
		self.assertEqual(filtered["action_summaries"], page["action_summaries"])
		self.assertEqual(frappe.db.get_value("Stock Entry", confirmed["stock_entry"], "docstatus"), 1)
		with self.assertRaises(frappe.ValidationError):
			api.movement_overview({"movement_kinds": ["Unknown"]})

	def test_report_exports_use_complete_permission_scoped_data(self):
		self.confirmed()
		period, movement_sheets = reporting._movement_sheets(
			{
				"period_key": "custom",
				"date_from": nowdate(),
				"date_to": nowdate(),
				"movement_kinds": ["Receive"],
			}
		)
		self.assertEqual(period["key"], "custom")
		self.assertEqual([sheet[0] for sheet in movement_sheets], ["动作汇总", "物品汇总", "记录明细"])
		details = movement_sheets[-1][2]
		row = next(row for row in details if row["item_code"] == self.item)
		self.assertEqual(row["movement_kind_label"], "入库")
		self.assertEqual(row["stock_qty"], 4)
		self.assertEqual(row["recorder_name"], "测试记录人")
		stock_rows = reporting._stock_rows({"warehouses": [self.room]})
		stock = next(row for row in stock_rows if row["item_code"] == self.item)
		self.assertEqual(stock["qty"], 4)
		self.assertNotIn(self.company, stock["warehouse_label"])
		current_sheets = reporting._current_stock_sheets({"warehouses": [self.room]})
		self.assertEqual(current_sheets[0][2][0]["available_qty"], 4)
		self.assertTrue(reporting._xlsx_bytes(current_sheets).startswith(b"PK"))
		csv = reporting._csv_bytes(current_sheets[-1][1], current_sheets[-1][2])
		self.assertTrue(csv.startswith(b"\xef\xbb\xbf"))
		injection_csv = reporting._csv_bytes((("value", "值"),), [{"value": "=2+2"}])
		self.assertIn(b"'=2+2", injection_csv)
		workbook = load_workbook(BytesIO(reporting._xlsx_bytes(movement_sheets)))
		self.assertTrue(workbook["记录明细"]["A2"].is_date)

	def test_movement_record_export_hydrates_activity_and_all_location_semantics(self):
		records = [
			{
				"name": "REC-LOAN",
				"movement_kind": "Loan",
				"document_type": "Stock Entry",
				"docstatus": 2,
				"activity": "ACT-1",
				"items": [
					{"item_code": "A", "qty": 1, "uom": "Nos", "stock_qty": 1, "stock_uom": "Nos", "from_warehouse": "WH-A", "to_warehouse": "Leased"},
					{"item_code": "B", "qty": 2, "uom": "Nos", "stock_qty": 2, "stock_uom": "Nos", "from_warehouse": "WH-B", "to_warehouse": "Leased"},
				],
			},
			{
				"name": "REC-RETURN",
				"movement_kind": "Return",
				"document_type": "Stock Entry",
				"docstatus": 1,
				"activity": "ACT-1",
				"items": [{"item_code": "A", "qty": 1, "uom": "Nos", "stock_qty": 1, "stock_uom": "Nos", "from_warehouse": "Leased", "to_warehouse": "WH-A"}],
			},
		]
		seen_statuses = []
		def scoped(filters, docstatuses=None):
			seen_statuses.append(docstatuses)
			return [row for row in records if row["docstatus"] in set(docstatuses or [])]
		def hydrate(items):
			for item in items:
				item["activity_title"] = "法会活动"
		labels = [
			{"name": "WH-A", "breadcrumb": "甲库"},
			{"name": "WH-B", "breadcrumb": "乙库"},
		]
		with patch.object(reporting, "_movement_history_records", side_effect=scoped), patch.object(reporting, "_ledger_activity_titles", side_effect=hydrate), patch.object(reporting, "_user_facing_warehouse_presentation", return_value=labels):
			period, sheets = reporting._movement_record_sheets({"period_key": "this_month", "docstatuses": [2]})
		self.assertEqual(seen_statuses, [[2]])
		self.assertEqual(period["key"], "this_month")
		row = sheets[0][2][0]
		self.assertEqual(row["docstatus_label"], "已取消")
		self.assertEqual(row["activity_title"], "法会活动")
		self.assertEqual(row["destination_warehouse"], "借出")
		self.assertEqual(row["source_warehouse"], "甲库、乙库")

	def test_report_expiry_ranges_and_validation(self):
		with patch.object(reporting, "nowdate", return_value="2026-09-28"):
			self.assertEqual(
				reporting._expiry_bounds({"expiry_window": "remaining_within", "expiry_days": "30"}),
				(getdate("2026-09-28"), getdate("2026-10-28")),
			)
			self.assertEqual(
				reporting._expiry_bounds({"expiry_from": "2026-10-01", "expiry_to": "2026-10-31"}),
				(getdate("2026-10-01"), getdate("2026-10-31")),
			)
			self.assertEqual(
				reporting._expiry_bounds({"expiry_window": "overdue_beyond", "expiry_days": "30"}),
				(None, getdate("2026-08-28")),
			)
			self.assertEqual(
				reporting._expiry_bounds({"expiry_window": "remaining_beyond", "expiry_days": "30"}),
				(getdate("2026-10-29"), None),
			)
			self.assertEqual(
				reporting._expiry_bounds({"expiry_window": "custom", "expiry_from_days": "-2", "expiry_to_days": "4"}),
				(getdate("2026-09-26"), getdate("2026-10-02")),
			)
		with self.assertRaises(frappe.ValidationError):
			reporting._expiry_bounds({"expiry_window": "remaining_within", "expiry_days": "0"})
		with self.assertRaises(frappe.ValidationError):
			reporting._expiry_bounds({"expiry_from": "2026-11-01", "expiry_to": "2026-10-01"})
		with self.assertRaises(frappe.ValidationError):
			reporting._expiry_bounds({"expiry_window": "custom", "expiry_from_days": "2", "expiry_to_days": "-2"})

	def test_expiry_windows_are_inclusive_non_overlapping_and_count_distinct_entities(self):
		rows = [
			{"item": "A", "expiry_date": "2026-08-28"},
			{"item": "B", "expiry_date": "2026-08-29"},
			{"item": "B", "expiry_date": "2026-09-27"},
			{"item": "C", "expiry_date": "2026-09-28"},
			{"item": "D", "expiry_date": "2026-10-28"},
			{"item": "E", "expiry_date": "2026-10-29"},
			{"item": "F", "expiry_date": None},
		]
		with patch.object(inventory_service, "nowdate", return_value="2026-09-28"):
			counts = inventory_service._expiry_bucket_counts(rows, "item", 30, -1, 0)
		self.assertEqual(counts, {
			"all": 6,
			"overdue_within": 1,
			"overdue_beyond": 1,
			"remaining_within": 2,
			"remaining_beyond": 1,
			"none": 1,
			"custom": 2,
		})

	def test_guest_denied_and_bootstrap_read_only(self):
		with patch.object(
			frappe.model.document.Document, "save", side_effect=AssertionError("Read mutated settings")
		):
			bootstrap()
		frappe.set_user("Guest")
		with self.assertRaises(frappe.AuthenticationError):
			api.history()

	def test_stock_user_permissions_and_warehouse_restriction(self):
		visible = self.create()
		hidden = self.create(
			items=[{"id": "hidden", "item_code": self.item, "qty": 1, "warehouse": self.b, "uom": "Nos"}]
		)
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-{self.token}@example.invalid",
				"first_name": "Inventory Test",
				"enabled": 1,
				"send_welcome_email": 0,
				"roles": [{"role": "Stock User"}, {"role": "Item Manager"}],
			}
		).insert()
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user.name,
				"allow": "Warehouse",
				"for_value": self.a,
				"apply_to_all_doctypes": 1,
			}
		).insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			save_allowed_warehouses([self.a])
		self.assertTrue(api.load_workspace(visible["name"]))
		with self.assertRaises(frappe.PermissionError):
			api.load_workspace(hidden["name"])
		names = frappe.get_list("Inventory Workspace", pluck="name")
		self.assertIn(visible["name"], names)
		self.assertNotIn(hidden["name"], names)
		history_page = api.history(page_length=100)
		history_names = {row["name"] for row in history_page["results"]}
		self.assertIn(visible["name"], history_names)
		self.assertNotIn(hidden["name"], history_names)
		draft = api.create_workspace(frappe.generate_hash(length=16), "Receive", {"notes": "Volunteer draft"})
		self.assertEqual(draft["docstatus"], 0)
		unit = create_uom("Unit " + self.token, True)
		self.assertTrue(unit["name"])

	def test_non_stock_user_denied(self):
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"no-stock-{self.token}@example.invalid",
				"first_name": "No Stock",
				"enabled": 1,
				"send_welcome_email": 0,
				"roles": [{"role": "Website Manager"}],
			}
		).insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			bootstrap()

	def test_uom_conversion_and_whole_number(self):
		unit = create_uom("Box " + self.token, True)
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", {"uom": unit["name"], "conversion_factor": 5})
		item.save()
		d = self.create(
			items=[{"id": "box", "item_code": self.item, "qty": 2, "uom": unit["name"], "warehouse": self.a}]
		)
		self.assertFalse(d["sync_error"], d["sync_error"])
		self.assertEqual(frappe.get_doc("Stock Entry", d["stock_entry"]).items[0].transfer_qty, 10)
		p = copy.deepcopy(d["data"])
		p["items"][0]["qty"] = 1.5
		d = api.save_workspace(d["name"], d["revision"], p)
		self.assertIn("whole number", d["sync_error"])
		self.assertEqual(api.load_workspace(d["name"])["data"]["items"][0]["qty"], 1.5)

	def test_private_attachment_and_completed_immutability(self):
		d = self.create()
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": "note.txt",
				"content": "test",
				"is_private": 0,
				"attached_to_doctype": "Inventory Workspace",
				"attached_to_name": d["name"],
			}
		).insert()
		self.assertTrue(file.is_private)
		attachment = next(row for row in api.load_workspace(d["name"])["attachments"] if row["name"] == file.name)
		self.assertIn("file_type", attachment)
		self.assertIn("file_size", attachment)
		d = self.with_people(d)
		api.confirm_workspace(d["name"], d["revision"])
		with self.assertRaises(frappe.ValidationError):
			api.remove_attachment(d["name"], file.name)

	def test_item_detail_uses_file_type_for_attachments(self):
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": "item-note.txt",
				"content": "test",
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()

		detail = api.item_detail(self.item)

		attachment = next(row for row in detail["attachments"] if row["name"] == file.name)
		self.assertIn("file_type", attachment)


def run():
	suite = unittest.defaultTestLoader.loadTestsFromTestCase(WorkspaceTests)
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	frappe.db.rollback()
	if not result.wasSuccessful():
		raise RuntimeError("Workspace tests failed")
	return {"tests": result.testsRun, "passed": True}
