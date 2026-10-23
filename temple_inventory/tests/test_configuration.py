"""Native initialization and explicit configuration repairs; every test rolls back."""

import unittest
from unittest.mock import patch

import frappe

from temple_inventory import configuration, warehouses
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class ConfigurationTests(NativeDocumentTests):
	def test_existing_native_configuration_is_ready_and_cannot_be_reinitialized(self):
		status = configuration.status()
		self.assertTrue(status["ready"])
		self.assertFalse(status["can_initialize"])
		with self.assertRaises(frappe.ValidationError):
			configuration.initialize(self.company, status["version"])
		self.assertEqual(frappe.db.get_single_value("Temple Inventory Settings", "root_warehouse"), self.root)

	def test_inaccessible_existing_warehouse_is_never_recreated_as_missing(self):
		get_list = frappe.get_list
		with patch(
			"frappe.get_list",
			side_effect=lambda doctype, *args, **kwargs: (
				[row for row in get_list(doctype, *args, **kwargs) if row.name != self.root]
				if doctype == "Warehouse"
				else get_list(doctype, *args, **kwargs)
			),
		):
			status = configuration.status()
			self.assertFalse(status["ready"])
			self.assertFalse(status["can_initialize"])
			self.assertIn("root_warehouse:inaccessible", {row["code"] for row in status["blockers"]})

	def test_pointer_repair_requires_review_confirmation_and_preserves_tree_stock_and_native_records(self):
		entry = self.receipt(5)
		before = {
			row.name: (row.parent_warehouse, row.is_group, row.warehouse_type)
			for row in configuration._rows(self.company)
		}
		balance = frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": self.a}, "actual_qty")
		preview = configuration.repair_preview("root_warehouse", self.physical)
		arguments = {
			"field": "root_warehouse",
			"warehouse": self.physical,
			"version": preview["version"],
			"fingerprint": preview["fingerprint"],
		}
		with self.assertRaises(frappe.ValidationError):
			configuration.repair_pointer(**arguments)
		with self.assertRaises(frappe.TimestampMismatchError):
			configuration.repair_pointer(**{**arguments, "fingerprint": "stale"}, confirmed=True)
		result = configuration.repair_pointer(**arguments, confirmed=True)
		self.assertFalse(result["ready"])
		self.assertEqual(
			frappe.db.get_single_value("Temple Inventory Settings", "root_warehouse"), self.physical
		)
		self.assertEqual(
			before,
			{
				row.name: (row.parent_warehouse, row.is_group, row.warehouse_type)
				for row in configuration._rows(self.company)
			},
		)
		self.assertEqual(
			frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": self.a}, "actual_qty"), balance
		)
		self.assertEqual(frappe.db.get_value("Stock Entry", entry.name, "docstatus"), 1)

	def test_changed_native_warehouse_invalidates_review_and_wrong_company_or_leaf_cannot_be_root(self):
		candidate_tree = warehouses.create_location("Area", "Repair candidate " + self.token, self.physical)
		candidate = next(
			row for row in candidate_tree["rows"] if row["local_label"] == "Repair candidate " + self.token
		)
		preview = configuration.repair_preview("root_warehouse", candidate["name"])
		doc = frappe.get_doc("Warehouse", candidate["name"])
		doc.ti_label += " Changed"
		doc.save()
		with self.assertRaises(frappe.TimestampMismatchError):
			configuration.repair_pointer(
				"root_warehouse", candidate["name"], preview["version"], preview["fingerprint"], True
			)
		with self.assertRaises(frappe.ValidationError):
			configuration.repair_preview("root_warehouse", self.a)
		with self.assertRaises(frappe.ValidationError):
			configuration.repair_preview("unknown_pointer", self.root)

	def test_first_initialization_has_a_single_leased_leaf_real_rooms_and_no_stock(self):
		settings = frappe.get_doc("Temple Inventory Settings")
		for field in configuration.POINTERS:
			settings.set(field, None)
		settings.save()
		get_doc = frappe.get_doc

		def unique_native_names(*args, **kwargs):
			if args and isinstance(args[0], dict) and args[0].get("doctype") == "Warehouse":
				args = (
					{**args[0], "warehouse_name": args[0]["warehouse_name"] + " " + self.token},
					*args[1:],
				)
			return get_doc(*args, **kwargs)

		# Isolate canonical labels from the development site's existing setup;
		# native Warehouse creation, permissions, hooks and tree remain real.
		with patch("frappe.get_doc", side_effect=unique_native_names):
			status = configuration.status()
			self.assertTrue(status["can_initialize"])
			result = configuration.initialize(self.company, status["version"])
		self.assertTrue(result["ready"])
		settings.reload()
		leased = frappe.get_doc("Warehouse", settings.leased_warehouse)
		self.assertFalse(leased.is_group)
		self.assertTrue(leased.warehouse_name.endswith("借出 " + self.token))
		self.assertEqual(leased.parent_warehouse, settings.root_warehouse)
		physical = frappe.get_doc("Warehouse", settings.physical_root_warehouse)
		children = frappe.get_all(
			"Warehouse",
			filters={"parent_warehouse": physical.name},
			fields=["name", "warehouse_type", "is_group"],
		)
		self.assertEqual(children, [])
		self.assertTrue(result["needs_first_room"])
		self.assertTrue(result["ready"])
		self.assertFalse(
			frappe.db.exists(
				"Bin",
				{"warehouse": ["in", [leased.name, settings.damaged_warehouse]]},
			)
		)

	def test_one_pointer_can_be_repaired_while_another_native_reference_is_still_missing(self):
		for field in ("root_warehouse", "physical_root_warehouse"):
			frappe.db.set_single_value("Temple Inventory Settings", field, "Missing " + self.token)
		preview = configuration.repair_preview("root_warehouse", self.root)
		result = configuration.repair_pointer(
			"root_warehouse", self.root, preview["version"], preview["fingerprint"], True
		)
		self.assertTrue(result["setup_required"])
		self.assertEqual(frappe.db.get_single_value("Temple Inventory Settings", "root_warehouse"), self.root)
		self.assertEqual(
			frappe.db.get_single_value("Temple Inventory Settings", "physical_root_warehouse"),
			"Missing " + self.token,
		)


def run():
	suite = unittest.defaultTestLoader.loadTestsFromTestCase(ConfigurationTests)
	# Inherited tests have their own suite and are not duplicated here.
	suite = unittest.TestSuite(test for test in suite if test._testMethodName in ConfigurationTests.__dict__)
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	if not result.wasSuccessful():
		raise AssertionError("Configuration integration tests failed")
	return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}
