"""Native Warehouse metadata, Desk discovery and guarded hierarchy changes."""

import unittest
from unittest.mock import patch

import frappe

from temple_inventory import warehouses
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class NativeWarehouseTests(NativeDocumentTests):
	def test_desk_saves_enforce_native_hierarchy_rules_without_frontend_audience_gate(self):
		self.receipt(5)
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-warehouse-{self.token}@example.test",
				"first_name": "Native warehouse editor",
				"send_welcome_email": 0,
				"roles": [{"role": "Item Manager"}],
			}
		).insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			warehouses.tree()
		doc = frappe.get_doc("Warehouse", self.a)
		doc.warehouse_name += " Desk metadata"
		doc.warehouse_type = "Location"
		doc.save()
		self.assertEqual(frappe.db.get_value("Warehouse", self.a, "warehouse_type"), "Location")
		with self.assertRaises(frappe.ValidationError):
			doc.is_group = 1
			doc.save()
		doc = frappe.get_doc("Warehouse", self.a)
		with self.assertRaises(frappe.ValidationError):
			doc.disabled = 1
			doc.save()
		protected = frappe.get_doc("Warehouse", self.physical)
		with self.assertRaises(frappe.PermissionError):
			protected.warehouse_name += " changed"
			protected.save()

	def test_desk_empty_groups_respect_children_hidden_scope_and_native_draft_references(self):
		group = warehouses.save_warehouse("Desk Parent " + self.token, self.physical, "Room", True)
		child = warehouses.save_warehouse("Desk Child " + self.token, group["name"])
		second = warehouses.save_warehouse("Desk Second " + self.token, self.physical, "Room", True)
		doc = frappe.get_doc("Warehouse", group["name"])
		with self.assertRaises(frappe.ValidationError):
			doc.is_group = 0
			doc.save()
		doc = frappe.get_doc("Warehouse", group["name"])
		visible = warehouses._visible_warehouses()
		visible.pop(child["name"])
		with patch.object(warehouses, "_visible_warehouses", return_value=visible):
			with self.assertRaises(frappe.PermissionError):
				doc.parent_warehouse = second["name"]
				doc.save()
		self.create(self.movement())
		doc = frappe.get_doc("Warehouse", self.a)
		with self.assertRaises(frappe.ValidationError):
			doc.parent_warehouse = second["name"]
			doc.save()
		self.assertEqual(frappe.db.get_value("Warehouse", self.a, "parent_warehouse"), self.physical)

	def test_new_room_is_a_usable_native_leaf_and_uses_recorded_type(self):
		row = warehouses.save_warehouse("New Room " + self.token, self.physical)
		self.assertFalse(row["is_group"])
		self.assertEqual(row["type"], "Room")
		self.assertTrue(row["can_edit"])
		self.assertIn(
			row["name"],
			{value.warehouse for value in frappe.get_doc("Temple Inventory Settings").allowed_warehouses},
		)
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": "Desk Room " + self.token,
				"company": self.company,
				"parent_warehouse": self.physical,
				"warehouse_type": "Room",
				"is_group": 0,
			}
		).insert()
		self.assertIn(
			doc.name,
			{value.warehouse for value in frappe.get_doc("Temple Inventory Settings").allowed_warehouses},
		)
		row = warehouses.save_warehouse(
			"Updated Room " + self.token, self.physical, "Location", False, row["name"], row["version"]
		)
		self.assertEqual(row["type"], "Location")
		self.assertEqual(
			frappe.db.get_value("Warehouse", row["name"], "warehouse_name"), "Updated Room " + self.token
		)

	def test_existing_stock_allows_metadata_but_rejects_hierarchy_and_disable(self):
		self.receipt(5)
		doc = frappe.get_doc("Warehouse", self.a)
		result = warehouses.save_warehouse(
			doc.warehouse_name + " renamed", self.physical, "Room", False, self.a, str(doc.modified)
		)
		self.assertEqual(
			frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": self.a}, "actual_qty"), 5
		)
		with self.assertRaises(frappe.TimestampMismatchError):
			warehouses.save_warehouse("stale", self.physical, "Room", False, self.a, str(doc.modified))
		with self.assertRaises(frappe.ValidationError):
			warehouses.save_warehouse(result["label"], self.physical, "Room", True, self.a, result["version"])
		with self.assertRaises(frappe.ValidationError):
			warehouses.save_warehouse(
				result["label"], self.physical, "Room", False, self.a, result["version"], True
			)

	def test_system_nodes_cycles_outside_parent_and_native_draft_links_are_guarded(self):
		root = frappe.get_doc("Warehouse", self.physical)
		with self.assertRaises(frappe.PermissionError):
			warehouses.save_warehouse(
				"Protected", self.physical, "Location", True, root.name, str(root.modified)
			)
		with self.assertRaises(frappe.PermissionError):
			warehouses.save_warehouse("Outside", self.root)
		group = warehouses.save_warehouse("Parent " + self.token, self.physical, "Location", True)
		child = warehouses.save_warehouse("Child " + self.token, group["name"], "Location", True)
		with self.assertRaises(frappe.ValidationError):
			warehouses.save_warehouse(
				group["label"], child["name"], "Location", True, group["name"], group["version"]
			)
		draft = self.create(self.movement())
		doc = frappe.get_doc("Warehouse", self.a)
		with self.assertRaises(frappe.ValidationError):
			warehouses.save_warehouse(
				doc.warehouse_name, group["name"], "Room", False, self.a, str(doc.modified)
			)
		self.assertEqual(frappe.db.get_value("Stock Entry", draft.name, "docstatus"), 0)

	def test_empty_leaf_can_become_group_without_changing_stock_and_group_with_children_cannot_be_leaf(self):
		leaf = warehouses.save_warehouse("Empty " + self.token, self.physical)
		group = warehouses.save_warehouse(
			leaf["label"], self.physical, "Room", True, leaf["name"], leaf["version"]
		)
		self.assertTrue(group["is_group"])
		self.assertNotIn(
			group["name"],
			{value.warehouse for value in frappe.get_doc("Temple Inventory Settings").allowed_warehouses},
		)
		warehouses.save_warehouse("Child Leaf " + self.token, group["name"])
		current = frappe.get_doc("Warehouse", group["name"])
		with self.assertRaises(frappe.ValidationError):
			warehouses.save_warehouse(
				group["label"], self.physical, "Room", False, group["name"], str(current.modified)
			)
		rows = warehouses.tree()["rows"]
		self.assertTrue(next(row for row in rows if row["name"] == self.physical)["protected"])
		self.assertFalse(next(row for row in rows if row["name"] == self.a)["is_group"])


def run():
	suite = unittest.defaultTestLoader.loadTestsFromTestCase(NativeWarehouseTests)
	suite = unittest.TestSuite(
		test for test in suite if test._testMethodName in NativeWarehouseTests.__dict__
	)
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	if not result.wasSuccessful():
		raise AssertionError("Native Warehouse integration tests failed")
	return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}
