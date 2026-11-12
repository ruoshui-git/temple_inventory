"""Source manifest checks for the repeatable, read-only schema audit."""

import unittest

import frappe

from temple_inventory import schema_audit


class SchemaAuditTests(unittest.TestCase):
	def test_source_manifest_matches_app_owned_fixture_and_doctype_json(self):
		manifest = schema_audit._source_manifest()
		self.assertEqual(len(manifest["custom_fields"]), 35)
		self.assertIn(("Stock Reconciliation", "ti_time_mode"), manifest["custom_fields"])
		self.assertFalse(
			set(manifest["custom_fields"])
			& {
				("Stock Reconciliation", field)
				for field in (
					"ti_count_scope",
					"ti_count_items",
					"ti_count_warehouses",
					"ti_baseline_timestamp",
					"ti_baseline_fingerprint",
				)
			}
		)
		self.assertEqual(
			manifest["doctypes"],
			sorted(
				[
					"Inventory Activity",
					"Inventory Activity Type",
					"Inventory Count Review",
					"Inventory Export Request",
					"Inventory Import",
					"Inventory Push Subscription",
					"Temple Inventory Allowed Warehouse",
					"Temple Inventory Settings",
				]
			),
		)
		self.assertEqual(manifest["hooks"]["fixtures"], ["Custom Field"])
		self.assertFalse(manifest["hooks"]["contains_retired_names"])
		self.assertTrue(manifest["setup"]["seeds_activity_types"])
		self.assertFalse(manifest["setup"]["contains_retired_names"])
		self.assertIn("ti_read_generation", manifest["settings_fields"])

	def test_inventory_import_and_item_reference_schema_is_pinned(self):
		manifest = schema_audit._source_manifest()
		self.assertIn(("Item", "ti_import_ref"), manifest["custom_fields"])
		self.assertIn("Inventory Import", manifest["doctypes"])
		path = (
			schema_audit.APP_ROOT
			/ "temple_inventory"
			/ "doctype"
			/ "inventory_import"
			/ "inventory_import.json"
		)
		import json

		fields = {field["fieldname"] for field in json.loads(path.read_text())["fields"]}
		self.assertEqual(
			fields,
			{
				"import_type",
				"status",
				"attempt",
				"source_file",
				"file_sha256",
				"posting_date",
				"posting_time",
				"new_count",
				"update_count",
				"unchanged_count",
				"rejected_count",
				"preview_json",
				"plan_hash",
				"skip_rejected",
				"result_json",
				"error",
				"created_documents",
			},
		)

	def test_read_path_custom_fields_have_query_indexes(self):
		import json

		fields = json.loads((schema_audit.APP_ROOT / "fixtures" / "custom_field.json").read_text())
		indexed = {(field["dt"], field["fieldname"]) for field in fields if field.get("search_index")}
		self.assertTrue(
			{
				("Stock Entry", "ti_movement_kind"),
				("Stock Entry Detail", "ti_original_loan"),
				("Stock Entry Detail", "ti_original_loan_line"),
			}.issubset(indexed)
		)

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
