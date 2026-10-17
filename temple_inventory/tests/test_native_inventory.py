"""Rollback-only native integration runner.

Run with bench --site development.localhost execute
temple_inventory.tests.test_native_inventory.run. No reset or sample install occurs.
"""

import unittest

from temple_inventory.tests.test_catalog import CatalogTests
from temple_inventory.tests.test_configuration import ConfigurationTests
from temple_inventory.tests.test_native_documents import NativeDocumentTests
from temple_inventory.tests.test_native_reports import NativeReportTests
from temple_inventory.tests.test_native_samples import NativeSampleTests, SampleMediaTests
from temple_inventory.tests.test_native_warehouses import NativeWarehouseTests


def run(test_name=None):
	suite = unittest.TestSuite()
	for case in (
		NativeDocumentTests,
		CatalogTests,
		NativeReportTests,
		ConfigurationTests,
		NativeWarehouseTests,
		SampleMediaTests,
		NativeSampleTests,
	):
		# Feature suites inherit the shared savepoint setup and helpers. Run their
		# own scenarios once; the base document cases already run above.
		suite.addTests(
			test
			for test in unittest.defaultTestLoader.loadTestsFromTestCase(case)
			if test._testMethodName in case.__dict__ and (not test_name or test._testMethodName == test_name)
		)
	if not suite.countTestCases():
		raise ValueError("No native inventory scenario matches test_name")
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	if not result.wasSuccessful():
		raise AssertionError("Native inventory integration tests failed")
	return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}
