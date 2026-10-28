"""Native Warehouse location model, Desk derivation and guarded hierarchy changes."""

import frappe

from temple_inventory import catalog, native_topology, warehouses
from temple_inventory.tests.test_native_documents import NativeDocumentTests
from temple_inventory.warehouse_names import DIRECT_STORAGE_SUFFIX


class NativeWarehouseTests(NativeDocumentTests):
	def test_warehouse_name_and_presenter_characterization(self):
		"""Pin warehouse names and presenter output for generated and mutated trees."""
		from unittest.mock import patch

		area = self._create("Area", "Snapshot area " + self.token, self.physical, "SA")
		room = self._create("Room", "Snapshot room " + self.token, area)
		direct = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		shelf = self._create("Shelf", "Snapshot shelf " + self.token, room)
		warehouses.subdivide_shelf(shelf, str(frappe.db.get_value("Warehouse", shelf, "modified")))
		leaf = frappe.db.get_value("Warehouse", {"parent_warehouse": shelf, "ti_direct_storage": 1}, "name")
		second = self._create("Area", "Snapshot second " + self.token, self.physical)

		def snapshot():
			rows = native_topology._visible_warehouses()
			presented = {
				row["name"]: {
					key: row[key] for key in ("label", "local_label", "full_label", "path", "search_text")
				}
				for row in native_topology.present_locations(rows)
			}
			return {name: (row.warehouse_name, presented[name]) for name, row in rows.items()}

		baseline = snapshot()
		self.assertEqual(baseline[area][0], "SA")
		self.assertEqual(baseline[room][0], f"SA / Snapshot room {self.token}")
		self.assertEqual(baseline[direct][0], f"SA / Snapshot room {self.token}{DIRECT_STORAGE_SUFFIX}")
		self.assertEqual(baseline[shelf][0], f"SA / Snapshot room {self.token} / Snapshot shelf {self.token}")
		self.assertEqual(
			baseline[leaf][0],
			f"SA / Snapshot room {self.token} / Snapshot shelf {self.token}{DIRECT_STORAGE_SUFFIX}",
		)
		self.assertEqual(baseline[room][1]["path"], f"SA / Snapshot room {self.token}")
		self.assertEqual(baseline[room][1]["local_label"], f"Snapshot room {self.token}")
		self.assertEqual(baseline[room][1]["label"], f"Snapshot room {self.token}")
		self.assertEqual(baseline[room][1]["full_label"], f"Snapshot room {self.token}")
		self.assertIn(f"Snapshot area {self.token}", baseline[room][1]["search_text"])
		self.assertEqual(baseline[self.system_root][1]["path"], "")
		self.assertEqual(baseline[self.loan_leaf][1]["full_label"], f"Native Test Lease Leaf {self.token}")
		self.assertEqual(baseline[self.damaged][1]["full_label"], f"Native Test Damaged {self.token}")
		for field in ("label", "local_label", "full_label", "path"):
			self.assertEqual(baseline[direct][1][field], baseline[room][1][field])
		self.assertIn(DIRECT_STORAGE_SUFFIX, baseline[direct][1]["search_text"])
		self.assertEqual(
			baseline[shelf][1]["path"],
			f"SA / Snapshot room {self.token} / Snapshot shelf {self.token}",
		)
		self.assertEqual(
			baseline[shelf][1]["label"], f"Snapshot room {self.token} / Snapshot shelf {self.token}"
		)
		self.assertEqual(baseline[shelf][1]["local_label"], f"Snapshot shelf {self.token}")
		self.assertEqual(baseline[shelf][1]["full_label"], f"Snapshot shelf {self.token}")
		self.assertEqual(
			baseline[leaf][1]["label"], f"Snapshot room {self.token} / Snapshot shelf {self.token}"
		)
		self.assertEqual(baseline[leaf][1]["path"], baseline[shelf][1]["path"])
		self.assertEqual(baseline[leaf][1]["local_label"], f"Snapshot shelf {self.token}")
		self.assertEqual(baseline[leaf][1]["full_label"], f"Snapshot shelf {self.token}")
		self.assertIn("SA", baseline[leaf][1]["search_text"])

		# Pin mutation rules too: renames cascade, and moving replaces the ancestor prefix.
		current = frappe.get_doc("Warehouse", room)
		warehouses.rename_location(room, "Renamed room " + self.token, "SR", str(current.modified))
		self.assertEqual(
			frappe.db.get_value("Warehouse", direct, "warehouse_name"),
			f"SA / SR{DIRECT_STORAGE_SUFFIX}",
		)
		current = frappe.get_doc("Warehouse", room)
		warehouses.move_location(room, second, str(current.modified))
		self.assertEqual(
			frappe.db.get_value("Warehouse", room, "warehouse_name"),
			f"Snapshot second {self.token} / SR",
		)
		self.assertEqual(
			frappe.db.get_value("Warehouse", direct, "warehouse_name"),
			f"Snapshot second {self.token} / SR{DIRECT_STORAGE_SUFFIX}",
		)
		self.assertEqual(
			frappe.db.get_value("Warehouse", shelf, "warehouse_name"),
			f"Snapshot second {self.token} / SR / Snapshot shelf {self.token}",
		)
		self.assertEqual(
			frappe.db.get_value("Warehouse", leaf, "warehouse_name"),
			f"Snapshot second {self.token} / SR / Snapshot shelf {self.token}{DIRECT_STORAGE_SUFFIX}",
		)
		with patch("frappe.has_permission", return_value=True):
			after = snapshot()
		self.assertEqual(after[room][1]["local_label"], f"Renamed room {self.token}")
		self.assertEqual(after[room][1]["path"], f"Snapshot second {self.token} / SR")

	def test_system_location_group_is_presented_with_leaf_labels_without_group_path(self):
		rows = native_topology._visible_warehouses()
		presented = {row["name"]: row for row in native_topology.present_locations(rows)}
		self.assertIn(self.system_root, presented)
		self.assertEqual(presented[self.loan_leaf]["local_label"], "Native Test Lease Leaf " + self.token)
		self.assertNotIn("System Locations", presented[self.loan_leaf]["path"])
		self.assertNotIn("System Locations", presented[self.damaged]["path"])

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
			frappe.db.get_value("Warehouse", room, "warehouse_name") + DIRECT_STORAGE_SUFFIX,
		)

	def test_manager_disabling_room_also_disables_its_direct_storage_leaf(self):
		room = self._create("Room", "Disable room " + self.token, self.physical)
		leaf = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		current = frappe.get_doc("Warehouse", room)
		warehouses.set_disabled(room, True, str(current.modified))
		self.assertTrue(frappe.db.get_value("Warehouse", room, "disabled"))
		self.assertTrue(frappe.db.get_value("Warehouse", leaf, "disabled"))
		current = frappe.get_doc("Warehouse", room)
		warehouses.set_disabled(room, False, str(current.modified))
		self.assertFalse(frappe.db.get_value("Warehouse", room, "disabled"))
		self.assertFalse(frappe.db.get_value("Warehouse", leaf, "disabled"))

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
						+ DIRECT_STORAGE_SUFFIX,
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

	def test_location_search_text_includes_ancestor_local_and_short_labels(self):
		short_label = "T2 " + self.token
		area = self._create("Area", "第2寺院 " + self.token, self.physical, short_label)
		room = self._create("Room", "Search room " + self.token, area)
		leaf = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		presented = {
			row["name"]: row
			for row in native_topology.present_locations(native_topology._visible_warehouses())
		}
		search_text = presented[leaf]["search_text"]
		self.assertIn("第2寺院 " + self.token, search_text)
		self.assertIn(short_label, search_text)
