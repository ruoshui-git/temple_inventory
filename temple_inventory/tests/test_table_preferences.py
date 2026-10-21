"""Rollback-only coverage for per-user table presentation preferences."""

import json
from unittest.mock import patch

import frappe

from temple_inventory import table_preferences
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class TablePreferenceTests(NativeDocumentTests):
	def test_table_preferences_merge_by_table_and_are_scoped_to_current_user(self):
		first_id = f"tests.{self.token}.first"
		second_id = f"tests.{self.token}.second"
		first = {"order": ["item", "quantity"], "hidden": ["quantity"]}
		second = {"order": ["date", "status"], "hidden": []}

		self.assertEqual(table_preferences.save_column_preferences(first_id, first), first)
		self.assertEqual(table_preferences.save_column_preferences(second_id, second), second)
		self.assertEqual(table_preferences.get_column_preferences(first_id), first)
		self.assertEqual(table_preferences.get_column_preferences(second_id), second)

		all_preferences = table_preferences._all_preferences()
		self.assertEqual(all_preferences[first_id], first)
		self.assertEqual(all_preferences[second_id], second)
		self.assertIsNone(table_preferences.get_column_preferences(f"tests.{self.token}.missing"))

	def test_table_preferences_reject_invalid_ids_and_column_values(self):
		with self.assertRaises(frappe.ValidationError):
			table_preferences.get_column_preferences("../private")
		with self.assertRaises(frappe.ValidationError):
			table_preferences.save_column_preferences(
				f"tests.{self.token}.invalid", {"order": [""], "hidden": []}
			)

	def test_table_preference_merge_reads_locked_database_value_not_stale_defaults_cache(self):
		first_id = f"tests.{self.token}.stale_first"
		second_id = f"tests.{self.token}.stale_second"
		third_id = f"tests.{self.token}.stale_third"
		first = {"order": ["item"], "hidden": []}
		second = {"order": ["date"], "hidden": []}
		third = {"order": ["status"], "hidden": []}
		table_preferences.save_column_preferences(first_id, first)
		frappe.defaults.set_user_default(
			table_preferences.TABLES_KEY,
			json.dumps({first_id: first, second_id: second}, ensure_ascii=False),
		)
		with patch.object(frappe.defaults, "get_user_default", return_value=json.dumps({first_id: first})):
			table_preferences.save_column_preferences(third_id, third)
		persisted = table_preferences._locked_preferences(table_preferences.TABLES_KEY)
		self.assertEqual(persisted, {first_id: first, second_id: second, third_id: third})

	def test_presentation_preferences_store_json_values_by_stable_id(self):
		preference_id = f"tests.{self.token}.filter_rail"
		self.assertIsNone(table_preferences.get_presentation_preference(preference_id))
		self.assertTrue(table_preferences.save_presentation_preference(preference_id, True))
		self.assertIs(table_preferences.get_presentation_preference(preference_id), True)
		value = {"visible": False, "version": 1}
		self.assertEqual(table_preferences.save_presentation_preference(preference_id, value), value)
		self.assertEqual(table_preferences.get_presentation_preference(preference_id), value)
		with self.assertRaises(frappe.ValidationError):
			table_preferences.save_presentation_preference(f"../{self.token}", False)
