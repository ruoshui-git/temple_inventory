"""Rollback-only native integration runner.

Run with bench --site development.localhost execute
temple_inventory.tests.test_native_inventory.run. No reset or sample install occurs.
"""

import unittest
from unittest.mock import patch

import frappe

from temple_inventory.tests.test_catalog import CatalogTests
from temple_inventory.tests.test_configuration import ConfigurationTests
from temple_inventory.tests.test_native_documents import NativeDocumentTests
from temple_inventory.tests.test_native_reports import NativeReportTests
from temple_inventory.tests.test_native_samples import NativeSampleTests, SampleMediaTests
from temple_inventory.tests.test_native_warehouses import NativeWarehouseTests
from temple_inventory.tests.test_schema_audit import SchemaAuditTests
from temple_inventory.tests.test_table_preferences import TablePreferenceTests


def _rollback_audit_snapshot():
	settings = frappe.db.sql(
		"select field, value from tabSingles where doctype='Temple Inventory Settings' order by field",
		as_dict=True,
	)
	counts = {
		doctype: frappe.db.count(doctype)
		for doctype in ("Warehouse", "Item", "Stock Entry")
	}
	return {"settings": [dict(row) for row in settings], "counts": counts}


def run(test_name=None):
	selected_names = {test_name} if isinstance(test_name, str) else set(test_name or ())
	suite = unittest.TestSuite()
	for case in (
		NativeDocumentTests,
		CatalogTests,
		NativeReportTests,
		ConfigurationTests,
		NativeWarehouseTests,
		SampleMediaTests,
		NativeSampleTests,
		TablePreferenceTests,
		SchemaAuditTests,
	):
		# Feature suites inherit the shared savepoint setup and helpers. Run their
		# own scenarios once; the base document cases already run above.
		suite.addTests(
			test
			for test in unittest.defaultTestLoader.loadTestsFromTestCase(case)
			if test._testMethodName in case.__dict__
			and (not selected_names or test._testMethodName in selected_names)
		)
	if not suite.countTestCases():
		raise ValueError(f"No native inventory scenario matches test_name: {sorted(selected_names)}")
	previous_in_test = getattr(frappe.flags, "in_test", False)
	frappe.flags.in_test = True
	audit_before = _rollback_audit_snapshot()
	result = None
	try:
		# This command runs inside `bench execute`, which commits on successful
		# return. Keep every fixture in one owned transaction and reject any
		# inner commit so the command's outer commit has nothing to persist.
		with patch.object(frappe.db, "commit", side_effect=AssertionError("native inventory tests may not commit")):
			result = unittest.TextTestRunner(verbosity=2).run(suite)
		if not result.wasSuccessful():
			raise AssertionError("Native inventory integration tests failed")
	finally:
		frappe.db.rollback()
		frappe.flags.in_test = previous_in_test
	audit_after = _rollback_audit_snapshot()
	if audit_after != audit_before:
		raise AssertionError(f"Rollback-only native tests changed persistent data: {audit_before!r} -> {audit_after!r}")
	return {
		"tests": result.testsRun,
		"failures": len(result.failures),
		"errors": len(result.errors),
		"rollback_audit": {"before": audit_before, "after": audit_after},
	}
