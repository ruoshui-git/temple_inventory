"""Activity type management regression coverage."""

import frappe

from temple_inventory.tests.test_native_documents import NativeDocumentTests


class ActivityTypeTests(NativeDocumentTests):
	def test_activity_type_list_create_duplicate_and_trim(self):
		from temple_inventory import activities

		created = activities.save_activity_type(label="  临时类型 " + self.token)
		self.assertEqual(created["label"], "临时类型 " + self.token)
		with self.assertRaises(frappe.ValidationError):
			activities.save_activity_type(label="   ")
		with self.assertRaises(frappe.ValidationError):
			activities.save_activity_type(label=created["label"].swapcase())
		listed = {row["name"]: row for row in activities.list_activity_types()}
		self.assertGreaterEqual(listed[self.activity.activity_type]["activity_count"], 1)
		self.assertFalse(listed[self.activity.activity_type]["deletable"])
		self.assertTrue(listed[created["name"]]["deletable"])

	def test_activity_type_disable_preserves_existing_and_blocks_new(self):
		from temple_inventory import activities

		type_name = self.activity.activity_type
		activities.save_activity_type(type_name, "其它", False)
		activities.save_activity({"notes": "仍可保存"}, self.activity.name, self.activity.modified)
		with self.assertRaises(frappe.ValidationError):
			activities.save_activity({"title": "新活动 " + self.token, "activity_type": type_name})
		self.assertNotIn(self.activity.name, {row["name"] for row in activities.search_activities()["rows"]})

	def test_activity_type_delete_and_reorder(self):
		from temple_inventory import activities

		unused = activities.save_activity_type(label="可删 " + self.token)
		activities.delete_activity_type(unused["name"])
		with self.assertRaises(frappe.LinkExistsError):
			activities.delete_activity_type(self.activity.activity_type)
		names = [row["name"] for row in activities.list_activity_types()]
		with self.assertRaises(frappe.ValidationError):
			activities.reorder_activity_types(names[:-1])
		ordered = activities.reorder_activity_types(list(reversed(names)))
		self.assertEqual([row["name"] for row in ordered], list(reversed(names)))
