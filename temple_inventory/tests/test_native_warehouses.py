"""Native Warehouse location model, Desk derivation and guarded hierarchy changes."""

import unittest

import frappe

from temple_inventory import catalog, warehouses
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class NativeWarehouseTests(NativeDocumentTests):
	def _create(self, kind, label, parent, short_label=None):
		warehouses.create_location(kind, label, parent, short_label)
		return frappe.db.get_value(
			"Warehouse",
			{
				"company": self.company,
				"parent_warehouse": parent,
				"ti_label": label,
				"ti_direct_storage": 0,
			},
			"name",
		)

	def test_area_room_shelf_and_direct_storage_model(self):
		area = self._create("Area", "Area " + self.token, self.physical, "A")
		room = self._create("Room", "Room " + self.token, area)
		direct = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		shelf = self._create("Shelf", "Shelf " + self.token, room)
		self.assertTrue(frappe.db.get_value("Warehouse", area, "is_group"))
		self.assertTrue(frappe.db.get_value("Warehouse", room, "is_group"))
		self.assertTrue(direct)
		self.assertFalse(frappe.db.get_value("Warehouse", direct, "is_group"))
		self.assertFalse(frappe.db.get_value("Warehouse", shelf, "is_group"))
		self.assertEqual(
			frappe.db.get_value("Warehouse", direct, "warehouse_name"),
			frappe.db.get_value("Warehouse", room, "warehouse_name") + " · 直接存放",
		)

	def test_desk_insert_rename_and_move_regenerate_native_paths(self):
		first = self._create("Area", "Desk area " + self.token, self.physical, "D")
		room = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"company": self.company,
				"parent_warehouse": first,
				"warehouse_type": "Room",
				"is_group": 1,
				"warehouse_name": frappe.db.get_value("Warehouse", first, "warehouse_name")
				+ " / Desk room "
				+ self.token,
			}
		).insert()
		self.assertEqual(room.ti_label, "Desk room " + self.token)
		self.assertEqual(room.warehouse_name, "D / Desk room " + self.token)
		warehouses.repair_direct_storage(room.name, str(room.modified))
		second = self._create("Area", "Second area " + self.token, self.physical)
		room.ti_label = "Renamed room " + self.token
		room.save()
		leaf = frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room.name, "ti_direct_storage": 1}, "name"
		)
		self.assertIn("Renamed room", frappe.db.get_value("Warehouse", leaf, "warehouse_name"))
		room = frappe.get_doc("Warehouse", room.name)
		room.parent_warehouse = second
		room.save()
		self.assertTrue(
			frappe.db.get_value("Warehouse", room.name, "warehouse_name").startswith(
				"Second area " + self.token + " / Renamed room"
			)
		)

	def test_duplicate_names_disambiguate_and_short_labels_drive_paths(self):
		left = self._create("Area", "Left " + self.token, self.physical)
		right = self._create("Area", "Right " + self.token, self.physical)
		room_left = self._create("Room", "Same " + self.token, left)
		room_right = self._create("Room", "Same " + self.token, right)
		short_room = self._create("Room", "Long room name " + self.token, left, "Concise")
		rows = warehouses.tree()["rows"]
		first = next(row for row in rows if row["name"] == room_left)
		second = next(row for row in rows if row["name"] == room_right)
		self.assertIn("Left", first["label"])
		self.assertIn("Right", second["label"])
		self.assertTrue(frappe.db.get_value("Warehouse", short_room, "warehouse_name").endswith(" / Concise"))

	def test_room_repair_and_subdivide_reference_guards(self):
		room = self._create("Room", "Repair room " + self.token, self.physical)
		leaf = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		direct = frappe.get_doc("Warehouse", leaf)
		direct.is_group = 1
		with self.assertRaises(frappe.ValidationError):
			direct.save()
		frappe.delete_doc("Warehouse", leaf, ignore_permissions=True, force=True)
		current = frappe.get_doc("Warehouse", room)
		warehouses.repair_direct_storage(room, str(current.modified))
		self.assertTrue(frappe.db.exists("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}))
		shelf = self._create("Shelf", "Used shelf " + self.token, room)
		self.submit(self.create(self.movement(quantity=2, target=shelf)))
		current = frappe.get_doc("Warehouse", shelf)
		with self.assertRaises(frappe.ValidationError):
			warehouses.subdivide_shelf(shelf, str(current.modified))

	def test_desk_rejects_duplicate_direct_leaves_groups_and_non_containers(self):
		area = self._create("Area", "Invalid direct area " + self.token, self.physical)
		room = self._create("Room", "Invalid direct room " + self.token, area)
		for parent, is_group in ((room, 0), (room, 1), (area, 0)):
			with self.assertRaises(frappe.ValidationError):
				frappe.get_doc(
					{
						"doctype": "Warehouse",
						"company": self.company,
						"parent_warehouse": parent,
						"warehouse_type": "",
						"is_group": is_group,
						"ti_label": "invalid " + self.token,
						"ti_direct_storage": 1,
						"warehouse_name": frappe.db.get_value("Warehouse", parent, "warehouse_name")
						+ " · 直接存放",
					}
				).insert()

	def test_unreferenced_shelf_subdivides_and_version_is_checked(self):
		room = self._create("Room", "Shelf room " + self.token, self.physical)
		shelf = self._create("Shelf", "Empty shelf " + self.token, room)
		current = frappe.get_doc("Warehouse", shelf)
		warehouses.subdivide_shelf(shelf, str(current.modified))
		self.assertTrue(frappe.db.get_value("Warehouse", shelf, "is_group"))
		direct = frappe.db.get_value("Warehouse", {"parent_warehouse": shelf, "ti_direct_storage": 1}, "name")
		self.assertTrue(direct)
		self.assertEqual(catalog.scan_code(shelf)["warehouse"]["name"], direct)
		with self.assertRaises(frappe.TimestampMismatchError):
			warehouses.subdivide_shelf(shelf, str(current.modified))

	def test_tree_uses_canonical_presenter_and_marks_missing_direct(self):
		room = self._create("Room", "No direct " + self.token, self.physical)
		leaf = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		frappe.delete_doc("Warehouse", leaf, ignore_permissions=True, force=True)
		row = next(value for value in warehouses.tree()["rows"] if value["name"] == room)
		self.assertTrue(row["missing_direct"])
		self.assertFalse(row["storable"])
		self.assertEqual(row["kind"], "room")


def run():
	suite = unittest.defaultTestLoader.loadTestsFromTestCase(NativeWarehouseTests)
	suite = unittest.TestSuite(
		test for test in suite if test._testMethodName in NativeWarehouseTests.__dict__
	)
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	if not result.wasSuccessful():
		raise AssertionError("Native Warehouse integration tests failed")
	return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}
