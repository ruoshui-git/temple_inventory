"""Run with bench execute temple_inventory.tests.test_workspace.run.

Every test uses a database savepoint and rolls back all test records/settings.
No production stock or existing documents are changed.
"""

import copy
import unittest
from unittest.mock import patch

import frappe
from frappe.utils import nowdate

from temple_inventory import workspace_api as api
from temple_inventory.inventory_api import (
	DEFAULT_LOCATION_NAME,
	bootstrap,
	create_uom,
	initialization_status,
	initialize_warehouses,
	inventory,
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
		settings = frappe.get_single("Temple Inventory Settings")
		settings.company = self.company
		settings.root_warehouse = self.root
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
				"source_type": "Donation",
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
		p["signature"] = SIGNATURE
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
		self.assertFalse(d["data"]["signature"])
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
		for kind in ("Transfer", "Loan", "Return"):
			d = self.create(kind, lease_program_warehouse=self.b)
			self.assertFalse(d["sync_error"], d["sync_error"])
			row = frappe.get_doc("Stock Entry", d["stock_entry"]).items[0]
			self.assertEqual(row.s_warehouse, self.a)
			self.assertEqual(row.t_warehouse, self.b)

	def test_zero_valuation_without_source_or_rate(self):
		for source_type in ("Purchase", ""):
			d = self.create(source_type=source_type)
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
		d = self.create(donor_source="A Donor")
		result = api.history({"donor_source": "A Donor", "room": self.room, "movement_kind": "Receive"})
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
