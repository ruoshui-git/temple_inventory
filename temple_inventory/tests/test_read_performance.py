"""Query-count guards for read paths with large per-row costs."""

import unittest
from collections import Counter
from unittest.mock import patch

import frappe

from temple_inventory import browse, catalog, native_api, native_stock
from temple_inventory.projections import report_page
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class ReadPerformanceTests(unittest.TestCase):
	movement = NativeDocumentTests.movement
	create = NativeDocumentTests.create
	submit = NativeDocumentTests.submit
	receipt = NativeDocumentTests.receipt
	loan = NativeDocumentTests.loan

	MEMO_STATE = (
		"temple_inventory_memos",
		"inventory_permission_signatures",
		"inventory_configuration_signature",
	)

	def setUp(self):
		NativeDocumentTests.setUp(self)

	def tearDown(self):
		NativeDocumentTests.tearDown(self)

	def _operator(self, name):
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"read-perf-{name}-{self.token}@example.test",
				"first_name": "Read Performance",
				"user_type": "System User",
				"enabled": 1,
				"send_welcome_email": 0,
				"roles": [{"role": "Inventory Operator"}],
			}
		).insert(ignore_permissions=True)
		frappe.clear_cache(user=user.name)
		return user.name

	def _reset_read_state(self):
		for name in self.MEMO_STATE:
			setattr(frappe.local, name, {})
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}

	def test_read_path_query_counts_stay_bounded_for_operator(self):
		user = self._operator("bounded")
		queries = (
			("inventory", lambda: browse.inventory_page({"dataset": "inventory", "view": "locations"}), 96),
			("expiry", lambda: browse.expiry_page({"dataset": "expiry", "view": "batches"}), 206),
			("item_summaries", lambda: catalog.item_summaries([self.item]), 45),
			(
				"count_records",
				lambda: report_page(
					{"dataset": "counts", "view": "records", "statuses": [0, 1, 2]}, page_length=1
				),
				87,
			),
		)
		for name, endpoint, ceiling in queries:
			frappe.set_user(user)
			endpoint()  # Warm Frappe's DocType metadata cache before counting endpoint work.
			with (
				self.subTest(endpoint=name),
				patch.object(frappe.db, "transaction_writes", 0),
				patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql,
			):
				self._reset_read_state()
				frappe.set_user(user)
				endpoint()
				statements = Counter(str(call.args[0]).splitlines()[0][:120] for call in sql.call_args_list)
				self.assertLessEqual(sql.call_count, ceiling, f"{name}: {statements.most_common(3)}")

	def test_warehouse_scope_memo_is_reset_for_next_user_request(self):
		users = {"a": self._operator("scope-a"), "b": self._operator("scope-b")}
		for name, leaf in (("a", self.a), ("b", self.b)):
			for warehouse in (self.root, self.physical, leaf):
				frappe.get_doc(
					{
						"doctype": "User Permission",
						"user": users[name],
						"allow": "Warehouse",
						"for_value": warehouse,
						"hide_descendants": 1,
					}
				).insert(ignore_permissions=True)
		with patch.object(frappe.db, "transaction_writes", 0):
			frappe.set_user(users["a"])
			self._reset_read_state()
			self.assertEqual(native_stock.warehouse_scopes()[2], {self.a})

			frappe.set_user(users["b"])
			self._reset_read_state()
			self.assertEqual(native_stock.warehouse_scopes()[2], {self.b})

	def test_native_document_and_loan_reads_have_bounded_queries(self):
		borrower = f"Read Performance {self.token}"
		loan = self.loan(5, borrower)
		cases = (
			("load_document", lambda: native_api.load_document("Stock Entry", loan.name), 70),
			("loan_detail", lambda: native_api.loan_detail(loan.name), 80),
			(
				"outstanding_loans",
				lambda: native_api.outstanding_loans(borrower=borrower, page_length=10),
				90,
			),
			(
				"outstanding_loan_groups",
				lambda: native_api.outstanding_loan_groups(search=borrower),
				90,
			),
		)
		for name, endpoint, ceiling in cases:
			endpoint()
			with (
				self.subTest(endpoint=name),
				patch.object(frappe.db, "transaction_writes", 0),
				patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql,
			):
				self._reset_read_state()
				frappe.set_user("Administrator")
				endpoint()
				self.assertLessEqual(sql.call_count, ceiling, f"{name}: {sql.call_count}")
