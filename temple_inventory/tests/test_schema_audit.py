"""Source manifest checks for the repeatable, read-only schema audit."""

import unittest

import frappe

from temple_inventory import schema_audit


class SchemaAuditTests(unittest.TestCase):
	def test_source_manifest_matches_app_owned_fixture_and_doctype_json(self):
		manifest = schema_audit._source_manifest()
		self.assertEqual(len(manifest["custom_fields"]), 33)
		self.assertEqual(
			manifest["doctypes"],
			sorted(
				[
					"Inventory Activity",
					"Inventory Activity Type",
					"Inventory Count Review",
					"Inventory Export Request",
					"Temple Inventory Allowed Warehouse",
					"Temple Inventory Settings",
				]
			),
		)
		self.assertEqual(manifest["hooks"]["fixtures"], ["Custom Field"])
		self.assertFalse(manifest["hooks"]["contains_retired_names"])
		self.assertEqual(manifest["native_count_api_field"], "ti_count_warehouses")
		self.assertTrue(manifest["setup"]["seeds_activity_types"])
		self.assertFalse(manifest["setup"]["contains_retired_names"])
		self.assertIn("ti_read_generation", manifest["settings_fields"])

	def test_singular_count_warehouse_is_retired_not_a_compatibility_fixture(self):
		self.assertIn("ti_count_warehouse", schema_audit.RETIRED_CUSTOM_FIELDS)
		self.assertNotIn(
			("Stock Reconciliation", "ti_count_warehouse"),
			set(schema_audit._source_manifest()["custom_fields"]),
		)

	def test_live_audit_is_read_only_and_reports_app_owned_extras_without_mutating(self):
		before = frappe.db.sql("select count(*) from `tabCustom Field`", as_list=True)[0][0]
		result = schema_audit.audit_app_customizations()
		after = frappe.db.sql("select count(*) from `tabCustom Field`", as_list=True)[0][0]
		self.assertTrue(result["read_only"])
		self.assertEqual(before, after)
		self.assertIn("extra_app_custom_fields_review_only", result["differences"])
		self.assertIn("singular_count_column", result["retired"])
