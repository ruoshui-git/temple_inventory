"""Run with bench execute temple_inventory.tests.test_workspace.run.

Every test uses a database savepoint and rolls back all test records/settings.
No production stock or existing documents are changed.
"""

import copy
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from frappe.utils import nowdate

from temple_inventory import inventory_api as inventory_service
from temple_inventory import workspace_api as api
from temple_inventory.inventory_api import (
	DEFAULT_LOCATION_NAME,
	MOVEMENT_TYPES,
	bootstrap,
	create_uom,
	initialization_status,
	initialize_warehouses,
	inventory,
	expiring_batches,
	repair_settings,
	save_allowed_warehouses,
)

SIGNATURE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH2kAAAAASUVORK5CYII="


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

	def create(self, kind="Receive", **data):
		return api.create_workspace(
			frappe.generate_hash(length=16),
			kind,
			{
				"source_text": "Donation", "no_independent_reviewer": 1, "handler_name": "测试经手人", "borrower_is_handler_or_witness": 1,
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

	def signed(self, d):
		p = copy.deepcopy(d["data"])
		p["recorder_signature"] = SIGNATURE
		p["handler_name"] = p.get("handler_name") or "测试经手人"
		p["handler_signature"] = SIGNATURE
		return api.save_workspace(d["name"], d["revision"], p)

	def confirmed(self):
		d = self.signed(self.create())
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
			rows = inventory(item_group="Group A")["results"]
			leaf_rows = inventory(warehouse="leaf_b", item_group="Group A")["results"]
		self.assertEqual(rows[0]["warehouse_stock"], {"leaf_a": 3, "pending": 2})
		self.assertEqual({reason["code"] for reason in rows[0]["attention_reasons"]}, {"unlocated", "missing_description", "missing_photo"})
		self.assertEqual(leaf_rows, [])

	def test_inventory_rejects_nonzero_group_stock(self):
		warehouses, settings = self._mock_inventory_context()
		bad = SimpleNamespace(warehouse="room", actual_qty=1)
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service.frappe, "get_all", return_value=[bad]):
			with self.assertRaises(frappe.ValidationError):
				inventory()

	def test_expiry_aggregates_filters_sorts_and_paginates(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="批次物品", item_group="Group A", stock_uom="Nos")
		batches = [
			SimpleNamespace(name="B-OLD", item="ITEM-1", expiry_date="2099-01-01"),
			SimpleNamespace(name="B-NEW", item="ITEM-1", expiry_date="2099-02-01"),
			SimpleNamespace(name="B-ZERO", item="ITEM-1", expiry_date="2099-03-01"),
		]
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item": return [item]
			if doctype == "Batch": return batches
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

	def test_expiry_applies_search_date_and_warehouse_filters(self):
		warehouses, settings = self._mock_inventory_context()
		item = SimpleNamespace(name="ITEM-1", item_code="ITEM-1", item_name="过滤物品", item_group="Group A", stock_uom="Nos")
		batch = SimpleNamespace(name="B-FILTER", item="ITEM-1", expiry_date="2099-01-01")
		def get_all(doctype, *args, **kwargs):
			if doctype == "Item": return [item]
			if doctype == "Batch": return [batch]
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
			if doctype == "Item": return [item]
			if doctype == "Batch": return [batch]
			raise AssertionError(doctype)
		with patch.object(inventory_service, "_require_stock"), patch.object(inventory_service, "_settings", return_value=settings), patch.object(inventory_service, "_visible_warehouses", return_value=warehouses), patch.object(inventory_service, "_raise_on_group_stock"), patch.object(inventory_service.frappe, "get_all", side_effect=get_all), patch.object(inventory_service, "get_batch_qty", return_value=2):
			result = expiring_batches()
		self.assertLess(result["results"][0]["days_to_expiry"], 0)

	def test_all_movement_kinds_carry_canonical_audit_fields(self):
		with patch.object(api, "_try_sync"):
			metadata = api.create_workspace(frappe.generate_hash(length=16), "Receive", {"recorded_by": "Guest", "responsible_person": "Guest", "handler_name": "测试经手人", "handler_signature": SIGNATURE, "items": []})
			self.assertEqual(metadata["data"]["recorded_by"], frappe.session.user)
			self.assertEqual(metadata["data"]["responsible_person"], frappe.session.user)
			for kind in MOVEMENT_TYPES:
				draft = api.create_workspace(
					frappe.generate_hash(length=16),
					kind,
					{"handler_name": "测试经手人", "handler_signature": SIGNATURE, "borrower_is_handler_or_witness": 1, "items": []},
				)
				self.assertEqual(draft["data"]["handler_name"], "测试经手人")
				self.assertEqual(draft["data"]["handler_signature"], SIGNATURE)
				self.assertEqual(draft["data"]["borrower_is_handler_or_witness"], 1)

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
		with self.assertRaises(frappe.ValidationError):
			api.confirm_workspace(d["name"], d["revision"])
		signed = self.signed(d)
		self.assertEqual(d["stock_entry"], signed["stock_entry"])
		result = api.confirm_workspace(d["name"], signed["revision"])
		self.assertEqual(result["docstatus"], 1)
		again = api.confirm_workspace(d["name"], signed["revision"])
		self.assertEqual(result["stock_entry"], again["stock_entry"])
		self.assertEqual(frappe.db.count("Stock Ledger Entry", {"voucher_no": result["stock_entry"]}), 2)
		with self.assertRaises(frappe.ValidationError):
			api.save_workspace(d["name"], result["revision"], result["data"])

	def test_signature_invalidated_and_direct_edit_blocked(self):
		d = self.signed(self.create())
		p = copy.deepcopy(d["data"])
		p["notes"] = "Changed after signing"
		d = api.save_workspace(d["name"], d["revision"], p)
		self.assertFalse(d["data"]["recorder_signature"])
		self.assertFalse(d["data"]["handler_signature"])
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
		loan = self.signed(loan)
		loan = api.confirm_workspace(loan["name"], loan["revision"])
		loan_item = frappe.get_all("Inventory Loan Item", filters={"parent": loan["data"]["loan_record"]}, pluck="name")[0]
		loan_entry = frappe.get_doc("Stock Entry", loan["stock_entry"])
		self.assertTrue(loan_entry.items[0].t_warehouse)

		returned = self.create("Return", items=[{"id": "return", "item_code": self.item, "qty": 1, "uom": "Nos", "loan_item": loan_item, "outcome": "Returned", "to_warehouse": self.a}])
		returned = self.signed(returned)
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
		d = self.signed(d)
		d = api.confirm_workspace(d["name"], d["revision"])
		self.assertEqual(d["docstatus"], 1)
		self.assertEqual(api.batches(self.item, self.a)[0]["qty"], 2)

	def test_history_filters_and_leaf_rejection(self):
		d = self.create(source_text="A Donor")
		result = api.history({"source_text": "A Donor", "room": self.room, "movement_kind": "Receive"})
		self.assertEqual(result["total"], 1)
		d = self.create(
			items=[{"id": "bad", "item_code": self.item, "qty": 2, "warehouse": self.room, "uom": "Nos"}]
		)
		self.assertIn("leaf warehouse", d["sync_error"])

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
		d = self.signed(d)
		api.confirm_workspace(d["name"], d["revision"])
		with self.assertRaises(frappe.ValidationError):
			api.remove_attachment(d["name"], file.name)


def run():
	suite = unittest.defaultTestLoader.loadTestsFromTestCase(WorkspaceTests)
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	frappe.db.rollback()
	if not result.wasSuccessful():
		raise RuntimeError("Workspace tests failed")
	return {"tests": result.testsRun, "passed": True}
