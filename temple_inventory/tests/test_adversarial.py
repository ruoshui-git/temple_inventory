"""Rollback-only adversarial probes for audited native inventory boundaries."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import copy
import hashlib
import io
import tempfile
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import frappe
import xlsxwriter

from temple_inventory import (
	browse,
	catalog,
	counts,
	imports,
	item_images,
	native_api,
	native_files,
	native_stock,
	people,
	printing,
	projections,
	units,
	warehouses,
)
from temple_inventory.native_access import check_version
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class AdversarialTests(NativeDocumentTests):
	def setUp(self):
		super().setUp()
		frappe.clear_cache(doctype="Temple Inventory Settings")
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}
		frappe.local.inventory_cache_revision_touched = False
		frappe.local.inventory_cache_dirty_scheduled = False

	def _restricted_operator(self, include_system=False, role=None, suffix=""):
		from temple_inventory.roles import OPERATOR, ensure_roles

		ensure_roles()
		role = role or OPERATOR
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"audit-{self.token}{suffix}@example.com",
				"first_name": "AUDIT restricted",
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": role}],
			}
		).insert(ignore_permissions=True)
		for warehouse in (self.root, self.physical, self.room_a, self.a):
			frappe.get_doc(
				{
					"doctype": "User Permission",
					"user": user.name,
					"allow": "Warehouse",
					"for_value": warehouse,
					"hide_descendants": 1,
				}
			).insert(ignore_permissions=True)
		if include_system:
			for warehouse in (self.system_root, self.loan_leaf, self.damaged):
				frappe.get_doc(
					{
						"doctype": "User Permission",
						"user": user.name,
						"allow": "Warehouse",
						"for_value": warehouse,
						"hide_descendants": 1,
					}
				).insert(ignore_permissions=True)
		frappe.clear_cache(user=user.name)
		return user.name

	def test_adv_retry_native_job_retries_only_snapshot_conflicts(self):
		from temple_inventory.native_access import retry_native_job

		calls = []
		with patch.object(frappe.db, "rollback") as rollback:

			def once():
				calls.append(1)
				if len(calls) == 1:
					raise frappe.QueryDeadlockError("snapshot conflict")
				return "ok"

			self.assertEqual(retry_native_job(once), "ok")
		self.assertEqual(len(calls), 2)
		rollback.assert_called_once()
		with patch.object(frappe.db, "rollback") as rollback:
			with self.assertRaises(frappe.QueryDeadlockError):
				retry_native_job(lambda: (_ for _ in ()).throw(frappe.QueryDeadlockError("again")))
		self.assertEqual(rollback.call_count, 3)
		calls.clear()

		def ordinary_error():
			calls.append(1)
			raise ValueError("ordinary")

		with self.assertRaisesRegex(ValueError, "ordinary"):
			retry_native_job(ordinary_error)
		self.assertEqual(len(calls), 1)

	def test_adv_queued_count_submit_retries_conflict_after_enqueue(self):
		from frappe.utils import background_jobs

		from temple_inventory import read_cache

		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		# A prior rollback-only run may have left the filesystem lock for a rolled-back name.
		from frappe.utils.file_lock import delete_lock

		document = frappe.get_doc("Stock Reconciliation", draft.name)
		delete_lock(document.get_signature())
		self.addCleanup(lambda: delete_lock(document.get_signature()))
		with (
			patch.object(native_api, "QUEUED_ROW_THRESHOLD", 0),
			patch.object(background_jobs, "enqueue", return_value=None) as enqueue,
		):
			queued = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		self.assertTrue(queued.queued)
		self.assertEqual(enqueue.call_args.args[0], "temple_inventory.native_api.run_queued_action")
		with self.assertRaises(frappe.DocumentLockedError):
			native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		original = read_cache._bump_durable_revisions
		calls = []

		def conflict_once(datasets):
			calls.append(1)
			if len(calls) == 1:
				raise frappe.QueryDeadlockError("Record has changed since last read")
			return original(datasets)

		frappe.db.savepoint("queued_action_attempt")
		original_rollback = frappe.db.rollback
		with (
			patch.object(read_cache, "_bump_durable_revisions", side_effect=conflict_once),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="queued_action_attempt"),
			),
		):
			native_api.run_queued_action("Stock Reconciliation", draft.name, "submit", frappe.session.user)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", draft.name, "docstatus"), 1)
		self.assertEqual(len(calls), 2)
		self.assertFalse(
			frappe.db.exists(
				"Comment",
				{
					"reference_doctype": "Stock Reconciliation",
					"reference_name": draft.name,
					"content": ["like", "%Action Failed%"],
				},
			)
		)

	def test_adv_item_import_retries_conflict_without_duplicate_items(self):
		from temple_inventory import read_cache

		request = self._queued_item_import()
		original_bump = read_cache._bump_durable_revisions
		original_rollback = frappe.db.rollback
		catalog_conflicts = []
		catalog_retries = []

		def conflict_once(datasets):
			if "catalog" in datasets:
				if not catalog_conflicts:
					catalog_conflicts.append(set(datasets))
					raise frappe.QueryDeadlockError("Record has changed since last read")
				catalog_retries.append(set(datasets))
			return original_bump(datasets)

		frappe.db.savepoint("item_import_attempt")
		with (
			patch.object(frappe.db, "commit", side_effect=lambda: frappe.db.savepoint("item_import_attempt")),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="item_import_attempt"),
			),
			patch.object(read_cache, "_bump_durable_revisions", side_effect=conflict_once),
		):
			imports.run_import(request.name, "Administrator")
		result = frappe.get_doc("Inventory Import", request.name)
		created = frappe.parse_json(result.created_documents or "[]")
		self.assertEqual(result.status, "Completed")
		self.assertEqual(len(catalog_conflicts), 1)
		self.assertTrue(catalog_retries)
		self.assertEqual(len(created), 1)
		self.assertEqual(frappe.db.count("Item", {"name": created[0]}), 1)

	def test_adv_opening_import_retry_reuses_committed_draft(self):
		from temple_inventory import read_cache

		self._configure_opening_account()
		request = self._queued_opening()
		request_key = hashlib.sha256(request.name.encode()).hexdigest()
		planned = frappe.parse_json(request.preview_json)
		self.assertTrue(any(row["action"] == "NEW" for row in planned), planned)
		original_bump = read_cache._bump_durable_revisions
		original_rollback = frappe.db.rollback
		ledger_conflicts = []
		ledger_retries = []

		def conflict_once(datasets):
			if "ledger" in datasets:
				if not ledger_conflicts:
					ledger_conflicts.append(set(datasets))
					raise frappe.QueryDeadlockError("Record has changed since last read")
				ledger_retries.append(set(datasets))
			return original_bump(datasets)

		frappe.db.savepoint("opening_import_attempt")
		with (
			patch.object(
				frappe.db,
				"commit",
				side_effect=lambda: frappe.db.savepoint("opening_import_attempt"),
			),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="opening_import_attempt"),
			),
			patch.object(read_cache, "_bump_durable_revisions", side_effect=conflict_once),
			patch.object(imports, "_opening_plan", return_value=(planned, request.plan_hash)),
		):
			imports.run_opening_import(request.name, "Administrator")
		documents = frappe.get_all(
			"Stock Reconciliation", filters={"ti_request_key": request_key}, fields=["name", "docstatus"]
		)
		self.assertEqual(frappe.get_value("Inventory Import", request.name, "status"), "Completed")
		self.assertEqual(len(ledger_conflicts), 1)
		self.assertTrue(ledger_retries)
		self.assertEqual(len(documents), 1)
		self.assertEqual(documents[0].docstatus, 1)

	def test_adv_queued_count_cancel_retries_conflict(self):
		from frappe.utils import background_jobs

		from temple_inventory import read_cache

		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		submitted = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		with (
			patch.object(native_api, "QUEUED_ROW_THRESHOLD", 0),
			patch.object(background_jobs, "enqueue", return_value=None),
		):
			queued = native_api.cancel_document("Stock Reconciliation", draft.name, submitted.version)
		self.assertTrue(queued.queued)
		original_bump = read_cache._bump_durable_revisions
		original_rollback = frappe.db.rollback
		count_calls = []

		def conflict_once(datasets):
			if "counts" in datasets:
				count_calls.append(1)
				if len(count_calls) == 1:
					raise frappe.QueryDeadlockError("Record has changed since last read")
			return original_bump(datasets)

		frappe.db.savepoint("queued_cancel_attempt")
		with (
			patch.object(read_cache, "_bump_durable_revisions", side_effect=conflict_once),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="queued_cancel_attempt"),
			),
		):
			native_api.run_queued_action("Stock Reconciliation", draft.name, "cancel", frappe.session.user)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", draft.name, "docstatus"), 2)
		self.assertEqual(len(count_calls), 2)

	def test_adv_queued_cancel_exhaustion_keeps_submitted_count(self):
		from frappe.utils import background_jobs

		from temple_inventory import read_cache

		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		submitted = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		with (
			patch.object(native_api, "QUEUED_ROW_THRESHOLD", 0),
			patch.object(background_jobs, "enqueue", return_value=None),
		):
			native_api.cancel_document("Stock Reconciliation", draft.name, submitted.version)
		original_rollback = frappe.db.rollback
		frappe.db.savepoint("queued_cancel_exhaustion")
		with (
			patch.object(
				read_cache,
				"_bump_durable_revisions",
				side_effect=frappe.QueryDeadlockError("Record has changed since last read"),
			),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="queued_cancel_exhaustion"),
			),
		):
			native_api.run_queued_action("Stock Reconciliation", draft.name, "cancel", frappe.session.user)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", draft.name, "docstatus"), 1)
		comments = frappe.get_all(
			"Comment",
			filters={"reference_doctype": "Stock Reconciliation", "reference_name": draft.name},
			fields=["content"],
		)
		self.assertEqual(len(comments), 1)
		self.assertIn("Action Failed", comments[0].content)

	def test_adv_queued_submit_exhaustion_keeps_draft_and_maps_error(self):
		from frappe.utils import background_jobs

		from temple_inventory import read_cache

		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		doc = frappe.get_doc("Stock Reconciliation", draft.name)
		from frappe.utils.file_lock import delete_lock

		delete_lock(doc.get_signature())
		self.addCleanup(lambda: delete_lock(doc.get_signature()))
		with (
			patch.object(native_api, "QUEUED_ROW_THRESHOLD", 0),
			patch.object(background_jobs, "enqueue", return_value=None),
		):
			native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		original_rollback = frappe.db.rollback
		frappe.db.savepoint("queued_submit_exhaustion")
		with (
			patch.object(
				read_cache,
				"_bump_durable_revisions",
				side_effect=frappe.QueryDeadlockError("Record has changed since last read"),
			),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="queued_submit_exhaustion"),
			),
		):
			native_api.run_queued_action("Stock Reconciliation", draft.name, "submit", frappe.session.user)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", draft.name, "docstatus"), 0)
		self.assertFalse(frappe.get_doc("Stock Reconciliation", draft.name).is_locked)
		comments = frappe.get_all(
			"Comment",
			filters={"reference_doctype": "Stock Reconciliation", "reference_name": draft.name},
			fields=["content"],
		)
		self.assertEqual(len(comments), 1)
		self.assertIn("Action Failed", comments[0].content)
		with patch.object(native_api, "QUEUED_ROW_THRESHOLD", 0):
			self.assertIn(
				"冲突", native_api.serialize(frappe.get_doc("Stock Reconciliation", draft.name)).queue_error
			)

	def test_adv_item_import_exhausted_conflicts_marks_failed_without_items(self):
		from temple_inventory import read_cache

		request = self._queued_item_import()
		original_rollback = frappe.db.rollback
		frappe.db.savepoint("item_import_exhaustion")
		with (
			patch.object(
				frappe.db, "commit", side_effect=lambda: frappe.db.savepoint("item_import_exhaustion")
			),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="item_import_exhaustion"),
			),
			patch.object(
				read_cache,
				"_bump_durable_revisions",
				side_effect=frappe.QueryDeadlockError("Record has changed since last read"),
			),
		):
			imports.run_import(request.name, "Administrator")
		result = frappe.get_doc("Inventory Import", request.name)
		self.assertEqual(result.status, "Failed")
		self.assertIn("Record has changed since last read", result.error)
		self.assertEqual(frappe.db.count("Item", {"item_name": f"AUDIT queued {self.token}"}), 0)

	def test_adv_opening_import_exhausted_conflicts_keeps_single_draft(self):
		from temple_inventory import read_cache

		self._configure_opening_account()
		request = self._queued_opening()
		request_key = hashlib.sha256(request.name.encode()).hexdigest()
		planned = frappe.parse_json(request.preview_json)
		self.assertTrue(any(row["action"] == "NEW" for row in planned), planned)
		original_rollback = frappe.db.rollback
		original_bump = read_cache._bump_durable_revisions
		ledger_calls = []
		frappe.db.savepoint("opening_import_exhaustion")

		def fail_ledger_revision(datasets):
			if "ledger" in datasets:
				ledger_calls.append(1)
				if len(ledger_calls) > 1:
					raise frappe.QueryDeadlockError("Record has changed since last read")
			return original_bump(datasets)

		with (
			patch.object(
				frappe.db,
				"commit",
				side_effect=lambda: frappe.db.savepoint("opening_import_exhaustion"),
			),
			patch.object(
				frappe.db,
				"rollback",
				side_effect=lambda: original_rollback(save_point="opening_import_exhaustion"),
			),
			patch.object(
				read_cache,
				"_bump_durable_revisions",
				side_effect=fail_ledger_revision,
			),
			patch.object(imports, "_opening_plan", return_value=(planned, request.plan_hash)),
		):
			imports.run_opening_import(request.name, "Administrator")
		documents = frappe.get_all(
			"Stock Reconciliation", filters={"ti_request_key": request_key}, fields=["name", "docstatus"]
		)
		self.assertEqual(frappe.get_value("Inventory Import", request.name, "status"), "Failed")
		self.assertTrue(ledger_calls)
		self.assertEqual(len(documents), 1, frappe.get_value("Inventory Import", request.name, "error"))
		self.assertEqual(documents[0].docstatus, 0)
		self.assertIn(documents[0].name, frappe.get_value("Inventory Import", request.name, "error"))

	def test_adv_queued_job_rechecks_submit_permission(self):
		from temple_inventory.roles import VIEWER

		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		user = self._restricted_operator(role=VIEWER)
		original_rollback = frappe.db.rollback
		frappe.db.savepoint("queued_permission")
		with patch.object(
			frappe.db,
			"rollback",
			side_effect=lambda: original_rollback(save_point="queued_permission"),
		):
			native_api.run_queued_action("Stock Reconciliation", draft.name, "submit", user)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", draft.name, "docstatus"), 0)

	def test_adv_notification_enqueue_skips_a_busy_queue(self):
		from frappe.utils import background_jobs

		from temple_inventory import notifications

		queue = frappe._dict(count=10000)
		with (
			patch.object(background_jobs, "get_queue", return_value=queue),
			patch.object(background_jobs, "enqueue") as enqueue,
			patch.object(notifications.frappe, "logger") as logger,
		):
			doc = self.receipt(1)
		self.assertEqual(frappe.db.get_value("Stock Entry", doc.name, "docstatus"), 1)
		enqueue.assert_not_called()
		logger.return_value.warning.assert_called()
		frappe.local.inventory_cache_revision_touched = False
		frappe.local.inventory_cache_dirty_scheduled = False

	def _switch_to(self, user):
		frappe.set_user(user)
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}

	def _b_only_data(self):
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"AUDIT-{self.token}",
				"item_name": f"AUDIT B item {self.token}",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		self.receipt(2)
		b_data = self.movement(quantity=7, target=self.b, ti_recorder_name=f"AUDIT B recorder {self.token}")
		b_data["items"][0]["item_code"] = item.name
		b_receipt = self.submit(self.create(b_data))
		loan_data = self.movement(
			"Loan",
			2,
			self.b,
			self.loan_leaf,
			ti_borrower=f"AUDIT B borrower {self.token}",
			ti_activity=self.activity.name,
		)
		loan_data["items"][0]["item_code"] = item.name
		loan = self.submit(self.create(loan_data))
		return item, b_receipt, loan

	def _item_workbook(self, rows):
		output = io.BytesIO()
		book = xlsxwriter.Workbook(output, {"in_memory": True})
		sheet = book.add_worksheet("物品导入")
		for column, header in enumerate(imports.HEADERS):
			sheet.write_string(0, column, header)
		for index, row in enumerate(rows, 1):
			for column, value in enumerate(row):
				if isinstance(value, (int, float)):
					sheet.write_number(index, column, value)
				else:
					sheet.write_string(index, column, str(value or ""))
		book.close()
		return output.getvalue()

	def _queued_item_import(self):
		raw = self._item_workbook(
			[["", f"AUDIT-{self.token}", f"AUDIT queued {self.token}", "", "Nos", "", "", "不追踪", "否", ""]]
		)
		rows = imports._workbook(raw, "queued.xlsx")
		planned, digest = imports._plan(rows)
		file_doc = frappe.get_doc(
			{"doctype": "File", "file_name": "queued.xlsx", "content": raw, "is_private": 1}
		).insert()
		doc = frappe.get_doc(
			{
				"doctype": "Inventory Import",
				"import_type": "Item",
				"status": "Queued",
				"source_file": file_doc.name,
				"file_sha256": hashlib.sha256(raw).hexdigest(),
				"preview_json": frappe.as_json(planned),
				"plan_hash": digest,
			}
		)
		imports._set_counts(doc, planned)
		imports._save(doc)
		return doc

	def _queued_opening(self):
		from temple_inventory.native_stock import warehouse_scopes
		from temple_inventory.native_topology import present_locations

		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		raw = self._opening_workbook([[self.item, location["label"], 3, 2.5, "", "", "", ""]])
		rows = imports._opening_workbook(raw, "opening.xlsx")
		planned, digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "00:00:01")
		file_doc = frappe.get_doc(
			{"doctype": "File", "file_name": "opening.xlsx", "content": raw, "is_private": 1}
		).insert()
		doc = frappe.get_doc(
			{
				"doctype": "Inventory Import",
				"import_type": "Opening Stock",
				"status": "Queued",
				"source_file": file_doc.name,
				"file_sha256": hashlib.sha256(raw).hexdigest(),
				"posting_date": frappe.utils.nowdate(),
				"posting_time": "00:00:01",
				"preview_json": frappe.as_json(planned),
				"plan_hash": digest,
			}
		)
		imports._set_counts(doc, planned)
		imports._save(doc)
		return doc

	def _opening_workbook(self, rows):
		from temple_inventory.tests.test_opening_import import OpeningStockImportTests

		return OpeningStockImportTests.workbook(self, rows)

	def _configure_opening_account(self):
		import erpnext

		if erpnext.is_perpetual_inventory_enabled(self.company):
			account = frappe.db.get_value(
				"Account", {"company": self.company, "account_type": "Stock", "is_group": 0}, "name"
			)
			if account:
				frappe.db.sql("update `tabWarehouse` set account=%s where name=%s", (account, self.a))
				frappe.flags.warehouse_account_map = {}

	def test_adv_number_untrusted_values(self):
		for value in (
			"1e30",
			"1e400",
			"9" * 40,
			"NaN",
			"Infinity",
			"-0",
			"-1",
			" 5 ",
			"\uff15",
			True,
			None,
			[],
			{},
		):
			with self.subTest(value=repr(value)):
				try:
					result = native_stock.number(value, "数量", allow_zero=True)
					expected = value in ("1e30", "1e400", "9" * 40, "-0", " 5 ", "\uff15")
					self.assertTrue(expected, f"accepted {value!r} as {result!r}")
				except frappe.ValidationError:
					pass

	def test_adv_receive_quantity_exact_or_validation(self):
		for quantity in ("1e30", "9999999999999999999999999999", "0.0000000001"):
			with self.subTest(quantity=quantity):
				self._exact_or_validation(
					lambda: self.create(self.movement(quantity=quantity))["items"][0]["qty"],
					quantity,
					"receive",
				)
		factor_data = self.movement()
		factor_data["items"][0]["conversion_factor"] = "1e30"
		with self.assertRaises(frappe.ValidationError):
			self.create(factor_data)
		item = frappe.get_doc("Item", self.item)
		unit = frappe.get_all("UOM", filters={"name": ["!=", item.stock_uom]}, pluck="name", limit=1)[0]
		item.append("uoms", {"uom": unit, "conversion_factor": 1000000})
		item.save()
		result_data = self.movement(quantity=1000000)
		result_data["items"][0].update({"uom": unit, "conversion_factor": 1000000})
		with self.assertRaises(frappe.ValidationError):
			self.create(result_data)

	def test_adv_count_quantity_exact_or_validation(self):
		self.receipt(1)
		for value in ("1e30", "9999999999999999999999999999", "0.0000000001"):
			with self.subTest(value=value):

				def count_value():
					result = counts.save_count(str(uuid4()), self.count_data(value, "Reviewed"))
					return frappe.db.get_value("Stock Reconciliation Item", {"parent": result["name"]}, "qty")

				self._exact_or_validation(count_value, value, "count")

	def test_adv_opening_quantity_exact_or_validation(self):
		for value in ("1e30", "9999999999999999999999999999", "0.0000000001"):
			with self.subTest(value=value):
				self._exact_or_validation(lambda: self._opening_quantity(value), value, "opening")
		with self.subTest(valuation_rate="1e30"):
			self._exact_or_validation(
				lambda: self._opening_valuation("1e30"), "1e30", "opening valuation rate"
			)

	def test_adv_opening_long_valuation_rate_is_accepted(self):
		stored = self._opening_valuation("3.3333333333333335")
		self.assertAlmostEqual(float(stored), 3.333333333, places=8)

	def test_adv_opening_import_preview_validates_quantity_precision(self):
		import erpnext

		from temple_inventory.native_stock import warehouse_scopes
		from temple_inventory.native_topology import present_locations
		from temple_inventory.opening import set_difference_account, validate_opening

		if erpnext.is_perpetual_inventory_enabled(self.company):
			account = frappe.db.get_value(
				"Account", {"company": self.company, "account_type": "Stock", "is_group": 0}, "name"
			)
			if account:
				frappe.db.sql("update `tabWarehouse` set account=%s where name=%s", (account, self.a))
				frappe.flags.warehouse_account_map = {}

		items = []
		stock_uom = frappe.get_all("UOM", filters={"must_be_whole_number": 0}, pluck="name", limit=1)[0]
		for index in range(5):
			item = frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": f"AUDIT-PLAN-{self.token}-{index}",
					"item_name": f"AUDIT planner row {index} {self.token}",
					"stock_uom": stock_uom,
					"item_group": "All Item Groups",
					"is_stock_item": 1,
				}
			).insert()
			items.append(item.name)
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		workbook = self._opening_workbook(
			[
				[items[0], location["label"], "0.0000000001", "1", "", "", "", ""],
				[items[1], location["label"], "1e30", "1", "", "", "", ""],
				[items[2], location["label"], "2.25", "1e30", "", "", "", ""],
				[items[3], location["label"], "2", "bad-rate", "", "", "", ""],
				[items[4], location["label"], "2", "1", "", "", "", ""],
			]
		)
		parsed = imports._opening_workbook(workbook, "precision.xlsx")
		planned, _digest = imports._opening_plan(parsed, frappe.utils.nowdate(), "00:00:01")
		by_item = {row["item_code"]: row for row in planned}
		self.assertEqual(by_item[items[0]]["action"], "REJECTED")
		self.assertTrue(any("小数位数" in error for error in by_item[items[0]]["errors"]))
		self.assertEqual(by_item[items[1]]["action"], "REJECTED")
		self.assertTrue(any("超出允许范围" in error for error in by_item[items[1]]["errors"]))
		self.assertEqual(by_item[items[2]]["action"], "REJECTED")
		self.assertTrue(any("超出允许范围" in error for error in by_item[items[2]]["errors"]))
		self.assertEqual(
			by_item[items[3]]["action"],
			"REJECTED",
			by_item[items[3]]["errors"],
		)
		self.assertTrue(any("估值单价必须是有效数字" in error for error in by_item[items[3]]["errors"]))
		self.assertEqual(
			by_item[items[4]]["action"],
			"NEW",
			by_item[items[4]]["errors"],
		)

		opening = frappe.new_doc("Stock Reconciliation")
		opening.company = self.company
		opening.purpose = "Opening Stock"
		opening.posting_date = frappe.utils.nowdate()
		opening.posting_time = "00:00:01"
		opening.set_posting_time = 1
		set_difference_account(opening)
		opening.append(
			"items",
			{
				"item_code": items[4],
				"warehouse": self.a,
				"qty": by_item[items[4]]["values"]["qty"],
				"valuation_rate": by_item[items[4]]["values"]["valuation_rate"],
			},
		)
		self.assertEqual(
			opening.items[0].precision("qty"),
			frappe.get_precision("Stock Reconciliation Item", "qty"),
		)
		validate_opening(opening)

	def _opening_quantity(self, value):
		return self._opening_document(value, 1)

	def _opening_valuation(self, rate):
		return self._opening_document(1, rate)

	def _opening_document(self, value, rate):
		from temple_inventory.opening import validate_opening

		doc = frappe.new_doc("Stock Reconciliation")
		doc.company = self.company
		doc.purpose = "Opening Stock"
		doc.posting_date = frappe.utils.nowdate()
		doc.posting_time = "00:00:01"
		doc.set_posting_time = 1
		from temple_inventory.opening import set_difference_account

		set_difference_account(doc)
		doc.append(
			"items",
			{"item_code": self.item, "warehouse": self.a, "qty": value, "valuation_rate": rate},
		)
		validate_opening(doc)
		doc.insert()
		field = "valuation_rate" if rate != 1 else "qty"
		return frappe.db.get_value("Stock Reconciliation Item", {"parent": doc.name}, field)

	def _exact_or_validation(self, operation, value, label):
		try:
			stored = operation()
		except frappe.ValidationError:
			return
		except Exception as exc:
			self.fail(f"{label} {value!r} raised raw {type(exc).__name__}: {exc}")
		self.assertEqual(Decimal(str(stored)), Decimal(value), f"{label} silently changed {value!r}")

	def test_adv_fractional_whole_uom_rejected(self):
		item = frappe.get_doc("Item", self.item)
		unit = frappe.get_doc("UOM", "Nos")
		unit.must_be_whole_number = 1
		unit.save()
		self.assertTrue(frappe.get_cached_value("UOM", "Nos", "must_be_whole_number"))
		for kind, data in (
			("Receive", self.movement(quantity="1.5")),
			("Issue", self.movement("Issue", "1.5", self.a)),
		):
			with self.subTest(kind=kind), self.assertRaises(frappe.ValidationError):
				self.create(data)
		self.assertIsNotNone(item)
		self.receipt(1)
		count_data = self.count_data("1.5", "Reviewed")
		with self.assertRaises(frappe.ValidationError):
			counts.save_count(str(uuid4()), count_data)
		with self.assertRaises(frappe.ValidationError):
			self._opening_quantity("1.5")
		unit_name = f"AUDIT-Conversion-{self.token}"
		units.save_unit(uom_name=unit_name)
		self.item_doc = frappe.get_doc("Item", self.item)
		self.item_doc.append("uoms", {"uom": unit_name, "conversion_factor": 0.5})
		self.item_doc.save()
		self.assertTrue(frappe.get_cached_value("UOM", self.item_doc.stock_uom, "must_be_whole_number"))
		conversion = self.movement(quantity=1)
		conversion["items"][0].update({"uom": unit_name, "conversion_factor": 0.5})
		with self.assertRaises(frappe.ValidationError):
			self.create(conversion)

	def test_adv_settlement_overdrawn_and_final_balance(self):
		loan = self.loan(5, "AUDIT settle " + self.token)
		with self.assertRaises(frappe.ValidationError):
			self.submit(self.settlement(loan, 6))
		self.submit(self.settlement(loan, 3))
		with self.assertRaises(frappe.ValidationError):
			self.submit(self.settlement(loan, 3))
		self.submit(self.settlement(loan, 2, "Lost", "Loss"))
		with self.assertRaises(frappe.ValidationError):
			self.submit(self.settlement(loan, 1))

	def test_adv_settlement_requires_valid_origin(self):
		loan = self.loan(5, "AUDIT origin " + self.token)
		other = self.loan(5, "AUDIT other " + self.token)
		different_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"AUDIT-DIFFERENT-{self.token}",
				"item_name": f"AUDIT different item {self.token}",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		bad = frappe.get_doc("Stock Entry", self.settlement(loan).name)
		bad.items[0].item_code = different_item.name
		with self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
			bad.save()
		cancelled = self.loan(2, "AUDIT cancelled origin " + self.token)
		native_api.cancel_document("Stock Entry", cancelled.name, cancelled.version)
		with self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
			self.settlement(cancelled, 1)
		draft = self.create(
			self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="AUDIT draft " + self.token)
		)
		try:
			bad = self.settlement(draft, 1)
		except (frappe.ValidationError, frappe.PermissionError):
			pass
		else:
			with self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
				self.submit(bad)
		bad = frappe.get_doc("Stock Entry", self.settlement(loan).name)
		bad.items[0].ti_original_loan_line = other["items"][0]["name"]
		with self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
			bad.save()

	def test_adv_cancel_loan_restores_settled_balance(self):
		loan = self.loan(5, "AUDIT cancel " + self.token)
		settlement = self.submit(self.settlement(loan, 3))
		with self.assertRaises(frappe.LinkExistsError):
			native_api.cancel_document("Stock Entry", loan.name, loan.version)
		native_api.cancel_document("Stock Entry", settlement.name, settlement.version)
		self.assertEqual(native_api.loan_detail(loan.name)["items"][0].outstanding_qty, 5)
		native_api.cancel_document("Stock Entry", loan.name, loan.version)

	def test_adv_client_cannot_set_server_identity_fields(self):
		draft = self.create(self.movement())
		for field, value in (
			("ti_request_key", "x"),
			("ti_request_user", "audit-forged@example.com"),
			("ti_confirmation_version", "x"),
			("docstatus", 1),
			("owner", "audit-forged@example.com"),
			("amended_from", "x"),
		):
			with self.subTest(create_field=field):
				created = self.create({**self.movement(), field: value})
				self.assertNotEqual(created.get(field), value, f"create accepted {field}={value!r}")
			with self.subTest(save_field=field):
				updated = native_api.save_document("Stock Entry", draft.name, draft.version, {field: value})
				self.assertNotEqual(updated.get(field), value, f"save accepted {field}={value!r}")
			draft = updated

	def test_adv_count_blank_and_zero_and_matching(self):
		self.receipt(2)
		data = self.count_data(2, "Reviewed")
		self.assertTrue(data)
		blank = copy.deepcopy(data)
		blank["ti_count_review"][0]["actual_qty"] = ""
		with self.assertRaises(frappe.ValidationError):
			counts.save_count(str(uuid4()), blank)
		zero = copy.deepcopy(data)
		zero["ti_count_review"][0]["actual_qty"] = 0
		result = counts.save_count(str(uuid4()), zero)
		self.assertTrue(result.get("name"))
		self.assertEqual(
			frappe.db.get_value("Stock Reconciliation Item", {"parent": result["name"]}, "qty"), 0
		)

	def test_adv_count_rejects_tampered_review(self):
		self.receipt(2)
		data = self.count_data(2, "Reviewed")
		for mutate in (lambda row: row.update(actual_qty=-1), lambda row: row.update(baseline_qty=999999)):
			bad = copy.deepcopy(data)
			mutate(bad["ti_count_review"][0])
			with self.assertRaises(frappe.ValidationError):
				counts.save_count(str(uuid4()), bad)
		bad = copy.deepcopy(data)
		bad["ti_count_review"][0]["warehouse"] = self.b
		with self.assertRaises(
			(frappe.ValidationError, frappe.PermissionError, frappe.TimestampMismatchError)
		):
			counts.save_count(str(uuid4()), bad)
		bad = copy.deepcopy(data)
		bad["ti_count_review"].append(copy.deepcopy(bad["ti_count_review"][0]))
		with self.assertRaises(
			(frappe.ValidationError, frappe.PermissionError, frappe.TimestampMismatchError)
		):
			counts.save_count(str(uuid4()), bad)

	def test_adv_counts_matching_draft_reports_no_adjustment(self):
		self.receipt(2)
		data = self.count_data(2, "Reviewed")
		result = counts.save_count(str(uuid4()), data)
		self.assertTrue(result.get("no_adjustment"))
		self.assertFalse(result.get("name"))

	def _queued_count_draft(self):
		self.receipt(2)
		result = counts.save_count(str(uuid4()), self.count_data(1, "Reviewed"))
		return frappe.get_doc("Stock Reconciliation", result["name"])

	def test_adv_queued_count_errors_hide_tracebacks(self):
		cases = (
			(
				"QueryDeadlockError: (1020, \"Record has changed since last read in table 'tabSingles'\")",
				"后台确认与另一项库存操作发生冲突，未作任何更改，请重新确认。",
			),
			(
				'Traceback (most recent call last):\n  File "worker.py", line 42\nRuntimeError: private traceback',
				"后台操作失败，未作任何更改，请重试或联系管理员。",
			),
			("数量超出允许的小数位数", "数量超出允许的小数位数"),
		)
		for content, expected in cases:
			with self.subTest(content=content):
				doc = self._queued_count_draft()
				doc.add_comment("Comment", frappe._("Action Failed") + "<br><br>" + content)
				with patch("temple_inventory.native_api.QUEUED_ROW_THRESHOLD", 0):
					serialized = native_api.serialize(doc)
				self.assertEqual(serialized["queue_error"], expected)
				self.assertNotIn("Traceback", serialized["queue_error"])
				self.assertNotIn("tabSingles", serialized["queue_error"])

	def test_adv_submitted_count_does_not_show_an_earlier_queue_failure(self):
		doc = self._queued_count_draft()
		doc.submit()
		self.assertEqual(doc.docstatus, 1)
		doc.add_comment(
			"Comment",
			frappe._("Action Failed")
			+ "<br><br>QueryTimeoutError: Lock wait timeout exceeded; try restarting transaction",
		)
		with patch("temple_inventory.native_api.QUEUED_ROW_THRESHOLD", 0):
			serialized = native_api.serialize(doc)
		# A draft that failed once and was then confirmed must not keep showing the old failure.
		self.assertEqual(serialized["queue_error"], "")

	def test_adv_count_existing_draft_is_untouched_when_reviews_match(self):
		self.receipt(2)
		data = self.count_data(1, "Reviewed")
		draft = counts.save_count(str(uuid4()), data)
		name = draft["name"]
		old_qty = frappe.db.get_value("Stock Reconciliation Item", {"parent": name}, "qty")
		matching = self.count_data(2, "Reviewed")
		result = counts.save_count(str(uuid4()), matching, name, draft["version"])
		self.assertTrue(result["no_adjustment"])
		self.assertEqual(result["existing_draft"], name)
		self.assertEqual(frappe.db.get_value("Stock Reconciliation Item", {"parent": name}, "qty"), old_qty)
		later = self.movement(quantity=1, posting_date=frappe.utils.nowdate(), posting_time="00:00:02")
		self.submit(self.create(later))
		with self.assertRaises((frappe.ValidationError, frappe.TimestampMismatchError)):
			counts.save_count(str(uuid4()), data, name, draft["version"])

	def test_adv_count_movement_interleavings_respect_count_timestamp(self):
		from datetime import timedelta

		from erpnext.stock.utils import get_stock_balance
		from frappe.utils import get_datetime

		self.receipt(10)

		def count_at(timestamp, actual=8, item=None, warehouse=None):
			baseline = counts.count_baseline(str(timestamp))
			rows = baseline["rows"]
			for row in rows:
				if row["item_code"] == (item or self.item) and row["warehouse"] == (warehouse or self.a):
					row.update(actual_qty=actual, review_state="Reviewed", reason="race verification")
			data = {
				"company": self.company,
				"posting_date": timestamp.date(),
				"posting_time": timestamp.time(),
				"ti_time_mode": "Historical",
				"ti_notes": "count versus movement interleaving",
				"ti_count_review": rows,
			}
			return counts.save_count(str(uuid4()), data)

		stale_time = get_datetime(frappe.utils.now_datetime())
		stale_draft = count_at(stale_time)
		stale_movement = self.movement(quantity=2, posting_date=stale_time.date(), posting_time="00:00:01")
		self.submit(self.create(stale_movement))
		with self.assertRaisesRegex(frappe.ValidationError, "基准已变化的盘点行") as stale_error:
			native_api.submit_document("Stock Reconciliation", stale_draft["name"], stale_draft["version"])
		self.assertIn("Native test item", str(stale_error.exception))
		self.assertIn("Native Test A Room", str(stale_error.exception))
		self.assertEqual(frappe.db.count("Stock Ledger Entry", {"voucher_no": stale_draft["name"]}), 0)

		# Count at site now, after the receipt and the stale movement (baseline 12); the later
		# movement one second after the count stays inside the 60-second future tolerance.
		future_count_time = get_datetime(frappe.utils.now_datetime())
		accepted_draft = count_at(future_count_time)
		later = self.movement(quantity=3, posting_date=future_count_time.date())
		later["posting_date"] = future_count_time.date()
		later["posting_time"] = (future_count_time + timedelta(seconds=1)).strftime("%H:%M:%S")
		completed = native_api.submit_document(
			"Stock Reconciliation", accepted_draft["name"], accepted_draft["version"]
		)
		self.assertEqual(completed.docstatus, 1)
		later_doc = self.submit(self.create(later))
		after_later = future_count_time + timedelta(seconds=2)
		self.assertEqual(
			get_stock_balance(
				self.item,
				self.a,
				posting_date=after_later.date(),
				posting_time=after_later.strftime("%H:%M:%S"),
			),
			11,
		)
		self.assertEqual(
			frappe.db.get_value("Bin", {"item_code": self.item, "warehouse": self.a}, "actual_qty"), 11
		)
		count_ledger = frappe.get_all(
			"Stock Ledger Entry",
			filters={"voucher_no": accepted_draft["name"]},
			fields=["qty_after_transaction"],
		)
		# ERPNext records a reconciliation as the resulting quantity (actual_qty stays 0).
		self.assertEqual(count_ledger, [{"qty_after_transaction": 8}])
		movement_ledger = frappe.get_all(
			"Stock Ledger Entry",
			filters={"voucher_no": later_doc.name},
			fields=["actual_qty", "qty_after_transaction"],
		)
		self.assertEqual(movement_ledger, [{"actual_qty": 3, "qty_after_transaction": 11}])

		other_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OUTSIDE-{self.token}",
				"item_name": "Outside count item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		# 5 differs from the book quantity whether or not the later movement is visible yet
		# (8 or 11), so this count always creates an adjustment.
		outside_draft = count_at(get_datetime(frappe.utils.now_datetime()), actual=5)
		outside = self.movement(quantity=1, posting_date=frappe.utils.nowdate())
		outside["items"][0]["item_code"] = other_item.name
		outside["items"][0]["t_warehouse"] = self.b
		self.submit(self.create(outside))
		outside_count = native_api.submit_document(
			"Stock Reconciliation", outside_draft["name"], outside_draft["version"]
		)
		self.assertEqual(outside_count.docstatus, 1)

	def test_adv_version_requires_exact_timestamp(self):
		doc = self.create(self.movement())
		version = doc.version
		check_version(doc, version)
		for bad in (None, "", "garbage", "2999-01-01 00:00:00", str(version) + "+00:00"):
			with self.subTest(version=bad), self.assertRaises(frappe.TimestampMismatchError):
				check_version(doc, bad)

	def test_adv_opening_import_cancelled_request_key_does_not_complete(self):
		request = self._queued_opening()
		key = hashlib.sha256(request.name.encode()).hexdigest()
		native = frappe.new_doc("Stock Reconciliation")
		native.company = self.company
		native.purpose = "Opening Stock"
		native.posting_date = request.posting_date
		native.posting_time = request.posting_time
		native.set_posting_time = 1
		native.ti_time_mode = "Historical"
		native.ti_request_key = key
		native.ti_request_user = "Administrator"
		from temple_inventory.opening import set_difference_account

		set_difference_account(native)
		native.append("items", {"item_code": self.item, "warehouse": self.a, "qty": 3, "valuation_rate": 2.5})
		native.insert()
		native.submit()
		native.cancel()
		before = frappe.db.count("Stock Ledger Entry", {"voucher_no": native.name})

		def simulated_commit():
			frappe.local.inventory_cache_revision_touched = False

		with (
			patch.object(frappe.db, "commit", side_effect=simulated_commit),
			patch.object(frappe.db, "rollback"),
		):
			imports.run_opening_import(request.name, "Administrator")
		result = frappe.get_doc("Inventory Import", request.name)
		if result.status == "Completed":
			created = frappe.parse_json(result.created_documents or "[]")
			self.assertTrue(created, "Completed import has no created native document")
			posted = frappe.get_doc("Stock Reconciliation", created[0])
			self.assertEqual(
				posted.docstatus,
				1,
				f"Completed import points to {posted.name} with docstatus={posted.docstatus}",
			)
			self.assertGreater(
				frappe.db.count("Stock Ledger Entry", {"voucher_no": posted.name}),
				0,
				"Completed import has no stock ledger entries",
			)
		else:
			self.assertEqual(result.status, "Failed")
			self.assertIn(native.name, result.error)
			self.assertIn("新导入重新上传", result.error)
			self.assertEqual(frappe.db.count("Stock Ledger Entry", {"voucher_no": native.name}), before)

	def test_adv_fresh_queued_import_is_not_interrupted(self):
		doc = self._queued_item_import()
		frappe.db.set_value(
			"Inventory Import", doc.name, "modified", frappe.utils.now_datetime(), update_modified=False
		)
		with patch("frappe.utils.background_jobs.is_job_enqueued", return_value=False):
			result = imports.status(doc.name)
		self.assertEqual(
			result["status"],
			"Queued",
			f"modified={frappe.db.get_value('Inventory Import', doc.name, 'modified')!r}, result={result!r}",
		)
		self.assertFalse(result["can_retry"])

	def test_adv_stale_queued_import_without_job_can_retry(self):
		from datetime import timedelta

		doc = self._queued_item_import()
		frappe.db.set_value(
			"Inventory Import",
			doc.name,
			"modified",
			frappe.utils.now_datetime() - timedelta(minutes=2),
			update_modified=False,
		)
		with patch("frappe.utils.background_jobs.is_job_enqueued", return_value=False):
			result = imports.status(doc.name)
		self.assertEqual(result["status"], "Failed")
		self.assertTrue(result["can_retry"])
		with patch("frappe.utils.background_jobs.is_job_enqueued", return_value=False):
			retried = imports.retry(doc.name)
		self.assertEqual(retried["status"], "Previewed")
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "attempt"), 2)

	def test_adv_old_queued_import_with_live_job_is_not_interrupted(self):
		from datetime import timedelta

		doc = self._queued_item_import()
		frappe.db.set_value(
			"Inventory Import",
			doc.name,
			"modified",
			frappe.utils.now_datetime() - timedelta(minutes=2),
			update_modified=False,
		)
		with patch("frappe.utils.background_jobs.is_job_enqueued", return_value=True) as queued:
			result = imports.status(doc.name)
		self.assertEqual(result["status"], "Queued")
		self.assertFalse(result["can_retry"])
		queued.assert_called_once_with(f"ti-import:{doc.name}:{doc.attempt or 1}")

	def test_adv_import_barcode_cell_types_preserve_normalized_text(self):
		rows = [["", "", "AUDIT barcode", "", "Nos", "", "00123", "不追踪", "否", ""]]
		text_plan, _ = imports._plan(imports._workbook(self._item_workbook(rows), "items.xlsx"))
		self.assertEqual(text_plan[0]["values"]["barcode"], "00123")
		numeric = [["", "", "AUDIT numeric", "", "Nos", "", 123.0, "不追踪", "否", ""]]
		numeric_plan, _ = imports._plan(imports._workbook(self._item_workbook(numeric), "items.xlsx"))
		self.assertEqual(numeric_plan[0]["values"]["barcode"], "123")

	def test_adv_reimport_same_file_is_unchanged(self):
		row = ["", "", "AUDIT duplicate import " + self.token, "", "Nos", "", "", "不追踪", "否", ""]
		raw = self._item_workbook([row])
		file_doc = frappe.get_doc(
			{"doctype": "File", "file_name": "items.xlsx", "content": raw, "is_private": 1}
		).insert()

		def make_request(plan, digest):
			request = frappe.get_doc(
				{
					"doctype": "Inventory Import",
					"import_type": "Item",
					"status": "Queued",
					"source_file": file_doc.name,
					"file_sha256": hashlib.sha256(raw).hexdigest(),
					"preview_json": frappe.as_json(plan),
					"plan_hash": digest,
				}
			)
			imports._set_counts(request, plan)
			imports._save(request)
			return request

		first_plan, first_digest = imports._plan(imports._workbook(raw, "items.xlsx"))
		self.assertEqual(first_plan[0]["action"], "NEW")
		first = make_request(first_plan, first_digest)
		with patch.object(frappe.db, "commit", return_value=None):
			imports.run_import(first.name, "Administrator")
		item_count = frappe.db.count("Item")
		second_plan, second_digest = imports._plan(imports._workbook(raw, "items.xlsx"))
		self.assertEqual(second_plan[0]["action"], "UNCHANGED")
		second = make_request(second_plan, second_digest)
		with patch.object(frappe.db, "commit", return_value=None):
			imports.run_import(second.name, "Administrator")
		self.assertEqual(frappe.db.count("Item"), item_count)

	def test_adv_run_import_twice_finished_attempt_writes_nothing(self):
		row = ["", "", "AUDIT replay " + self.token, "", "Nos", "", "", "不追踪", "否", ""]
		raw = self._item_workbook([row])
		parsed = imports._workbook(raw, "items.xlsx")
		planned, digest = imports._plan(parsed)
		file_doc = frappe.get_doc(
			{"doctype": "File", "file_name": "items.xlsx", "content": raw, "is_private": 1}
		).insert()
		request = frappe.get_doc(
			{
				"doctype": "Inventory Import",
				"import_type": "Item",
				"status": "Queued",
				"source_file": file_doc.name,
				"file_sha256": hashlib.sha256(raw).hexdigest(),
				"preview_json": frappe.as_json(planned),
				"plan_hash": digest,
			}
		)
		imports._set_counts(request, planned)
		imports._save(request)
		for commit_call in range(2):
			with patch.object(frappe.db, "commit", return_value=None):
				imports.run_import(request.name, "Administrator")
			if commit_call == 0:
				count_after = frappe.db.count("Item")
		self.assertEqual(frappe.db.count("Item"), count_after)

	def test_adv_restricted_operator_has_only_area_a_permission(self):
		user = self._restricted_operator()
		self._switch_to(user)
		self.assertTrue(frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.a)))
		self.assertFalse(frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.b)))

	def test_adv_settings_read_is_role_scoped_for_unrestricted_accounts(self):
		self.receipt(2)
		query = {"dataset": "inventory", "scope": {}}
		admin_page = browse.inventory_page(query)
		admin_report = projections.report_page(query)
		from temple_inventory.roles import OPERATOR, ensure_roles

		ensure_roles()

		operator = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"audit-unrestricted-{self.token}@example.com",
				"first_name": "AUDIT unrestricted",
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": OPERATOR}],
			}
		).insert(ignore_permissions=True)
		self._switch_to(operator.name)
		operator_page = browse.inventory_page(query)
		operator_report = projections.report_page(query)
		self.assertEqual(operator_page["rows"], admin_page["rows"])
		self.assertEqual(operator_page["summary"], admin_page["summary"])
		self.assertEqual(operator_page["matched_count"], admin_page["matched_count"])
		self.assertEqual(operator_report["rows"], admin_report["rows"])
		self.assertEqual(operator_report["summary"], admin_report["summary"])
		no_role = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"audit-norole-{self.token}@example.com",
				"first_name": "AUDIT no role",
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [],
			}
		).insert(ignore_permissions=True)
		self._switch_to(no_role.name)
		with self.assertRaises(frappe.PermissionError):
			browse.inventory_page(query)
		self._switch_to(operator.name)
		# Patch the role grant instead of editing DocPerm: clearing the shared Redis metadata
		# cache from a rollback-only test makes the live dev server refuse real accounts.
		with (
			patch("temple_inventory.report_sources.get_role_permissions", return_value={"read": 0}),
			self.assertRaises(frappe.PermissionError),
		):
			projections.report_page(query)

	def test_adv_restricted_manager_can_count_in_area_a(self):
		from temple_inventory.roles import MANAGER

		self.receipt(2)
		user = self._restricted_operator(role=MANAGER)
		self._switch_to(user)
		baseline = counts.count_baseline(str(frappe.utils.now_datetime()))
		self.assertIn(self.a, baseline["warehouses"])
		self.assertNotIn(self.b, baseline["warehouses"])
		self.assertTrue(all(row["warehouse"] == self.a for row in baseline["rows"]))
		result = counts.save_count(str(uuid4()), self.count_data(2, "Reviewed"))
		self.assertTrue(result["no_adjustment"])

	def test_adv_area_loan_and_return_need_only_the_loan_leaf(self):
		self.receipt(3)
		user = self._restricted_operator()
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": user,
				"allow": "Warehouse",
				"for_value": self.loan_leaf,
				"hide_descendants": 1,
			}
		).insert(ignore_permissions=True)
		frappe.clear_cache(user=user)
		self._switch_to(user)
		borrower = f"AUDIT A borrower {self.token}"
		loan = self.submit(
			self.create(
				self.movement(
					"Loan", 1, self.a, self.loan_leaf, ti_borrower=borrower, ti_activity=self.activity.name
				)
			)
		)
		return_data = self.movement(
			"Return", 1, self.loan_leaf, self.a, ti_borrower=borrower, ti_activity=self.activity.name
		)
		return_data["items"][0].update(
			ti_original_loan=loan.name,
			ti_original_loan_line=loan["items"][0]["name"],
			ti_settlement_outcome="Returned",
		)
		returned = self.submit(self.create(return_data))
		self.assertEqual(returned.docstatus, 1)
		self.assertFalse(
			frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.system_root))
		)
		self.assertFalse(
			frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.damaged))
		)

	def test_adv_outstanding_loans_hide_b_only_borrower(self):
		_item, _receipt, loan = self._b_only_data()
		self.assertEqual(loan["items"][0]["s_warehouse"], self.b)
		user = self._restricted_operator()
		self._switch_to(user)
		self.assertFalse(frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.b)))
		groups = native_api.outstanding_loan_groups(search=loan.ti_borrower)
		loans = native_api.outstanding_loans(borrower=loan.ti_borrower)
		self.assertNotIn(loan.ti_borrower, frappe.as_json(groups))
		self.assertNotIn(loan.name, frappe.as_json(loans))

	def test_adv_people_suggestions_hide_b_only_names(self):
		item, _receipt, loan = self._b_only_data()
		user = self._restricted_operator()
		self._switch_to(user)
		self.assertFalse(frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.b)))
		from erpnext.stock.utils import get_stock_balance

		self.assertEqual(loan["items"][0]["s_warehouse"], self.b)
		self.assertEqual(get_stock_balance(item.name, self.a), 0)
		self.assertGreater(get_stock_balance(item.name, self.b), 0)
		self.assertEqual(loan["items"][0]["s_warehouse"], self.b)
		borrowers = frappe.as_json(people.borrowers(search=self.token))
		recorders = frappe.as_json(people.recorded_names(search=self.token))
		leaks = [
			name
			for name, result in (
				(loan.ti_borrower, borrowers),
				(f"AUDIT B recorder {self.token}", recorders),
			)
			if name in result
		]
		self.assertEqual(leaks, [], f"B-only names leaked: {leaks!r}")

	def test_adv_browse_reports_and_summary_are_scoped_without_location(self):
		item, b_receipt, b_loan = self._b_only_data()
		a_receipt = self.submit(
			self.create(self.movement(quantity=3, ti_recorder_name=f"AUDIT A recorder {self.token}"))
		)
		mixed = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"AUDIT-MIXED-{self.token}",
				"item_name": f"AUDIT mixed item {self.token}",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		mixed_a = self.movement(quantity=4, ti_recorder_name=f"AUDIT A mixed {self.token}")
		mixed_a["items"][0]["item_code"] = mixed.name
		self.submit(self.create(mixed_a))
		mixed_b = self.movement(quantity=6, target=self.b)
		mixed_b["items"][0]["item_code"] = mixed.name
		self.submit(self.create(mixed_b))
		tracked = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"AUDIT-TRACKED-{self.token}",
				"item_name": f"AUDIT tracked {self.token}",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_batch_no": 1,
			}
		).insert()
		batch = frappe.get_doc(
			{"doctype": "Batch", "batch_id": f"AUDIT-BATCH-{self.token}", "item": tracked.name}
		).insert()
		tracked_receipt = self.movement(quantity=2)
		tracked_receipt["items"][0].update(item_code=tracked.name, batch_no=batch.name)
		self.submit(self.create(tracked_receipt))
		area_user = self._restricted_operator()
		system_user = self._restricted_operator(include_system=True, suffix="-system")
		inventory_query = {"dataset": "inventory", "scope": {}}
		movement_query = {"dataset": "movements", "view": "records", "statuses": [1]}
		count_query = {"dataset": "counts", "view": "records", "statuses": [1]}
		expiry_query = {"dataset": "expiry", "view": "batches"}

		def scoped_export():
			from temple_inventory import exports

			with patch("temple_inventory.exports._enqueue"):
				result = exports.request_export(inventory_query, "summary", export_format="csv")
			request = frappe.get_doc("Inventory Export Request", result["name"])
			request.status = "Running"
			exports._save(request)
			with (
				tempfile.TemporaryDirectory() as directory,
				projections.Projection(inventory_query) as projection,
			):
				projection.build()
				output = Path(directory) / "export.csv"
				manifest = Path(directory) / "manifest.jsonl"
				exports._write(projection, request, output)
				exports._manifest(projection, manifest)
				return {
					"status": result["status"],
					"rows": output.read_text(),
					"manifest": manifest.read_text(),
				}

		endpoints = {
			"bootstrap": browse.bootstrap,
			"inventory_page": lambda: browse.inventory_page(inventory_query),
			"operation_page": lambda: browse.operation_page(movement_query, records=True),
			"operation_contributions": lambda: browse.operation_contributions(
				movement_query, records=True, doctype="Stock Entry", name=a_receipt.name
			),
			"movement_history": lambda: browse.movement_history(movement_query, item_code=self.item),
			"counts_page": lambda: browse.counts_page(count_query),
			"expiry_page": lambda: browse.expiry_page(expiry_query),
			"expiry_analysis": lambda: browse.expiry_analysis(expiry_query, "warehouse"),
			"dashboard_card": lambda: browse.dashboard_card("inventory"),
			"more_summary": browse.more_summary,
			"native_drafts": browse.native_drafts,
			"report_page": lambda: projections.report_page(inventory_query),
			"group_page": lambda: projections.group_page({"dataset": "inventory", "groupBy": ["item"]}),
			"group_movements": lambda: projections.group_page({"dataset": "movements", "groupBy": ["kind"]}),
			"group_counts": lambda: projections.group_page(
				{"dataset": "counts", "view": "lines", "groupBy": ["item"]}
			),
			"group_loans": lambda: projections.group_page(
				{"dataset": "loans", "view": "records", "groupBy": ["borrower"]}
			),
			"group_expiry": lambda: projections.group_page({"dataset": "expiry", "groupBy": ["item"]}),
			"group_activities": lambda: projections.group_page(
				{"dataset": "activities", "view": "metadata", "groupBy": ["activityType"]}
			),
			"warehouse_tree": warehouses.tree,
			"stock_summary": lambda: warehouses.stock_summary(self.a),
			"item_detail": lambda: catalog.item_detail(mixed.name),
			"item_summaries": lambda: catalog.item_summaries([self.item, mixed.name]),
			"batch_locations": lambda: catalog.batch_locations(batch.name),
			"outstanding_lines": lambda: __import__(
				"temple_inventory.loans", fromlist=["outstanding_lines"]
			).outstanding_lines([item.name]),
			"request_export": scoped_export,
		}
		scoped_results = {}
		for access_set, user in (("area_a", area_user), ("area_a_plus_system", system_user)):
			self._switch_to(user)
			self.assertFalse(
				frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.b))
			)
			if access_set == "area_a_plus_system":
				for warehouse in (self.system_root, self.loan_leaf, self.damaged):
					self.assertTrue(
						frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", warehouse))
					)
			results = {}
			refused = []
			for endpoint, call in endpoints.items():
				try:
					results[endpoint] = call()
				except frappe.PermissionError as error:
					refused.append((endpoint, repr(error)))
			self.assertEqual(refused, [], f"{access_set} endpoint refusals: {refused!r}")
			scoped_results[access_set] = results
			serialized = frappe.as_json(results)
			b_label = frappe.db.get_value("Warehouse", self.b, "ti_label")
			self.assertIn(self.item, serialized, f"Area A item missing for {access_set}")
			self.assertIn(a_receipt.name, serialized, f"Area A receipt missing for {access_set}")
			for hidden in (self.b, b_label, b_receipt.name, b_loan.name):
				self.assertNotIn(hidden, serialized, f"B-only value leaked for {access_set}: {hidden!r}")
			self.assertNotIn("AUDIT B borrower", serialized)
			self.assertNotIn("AUDIT B recorder", serialized)
			if access_set == "area_a":
				for hidden in (item.name, item.item_name):
					self.assertNotIn(hidden, serialized, f"B-only stock leaked for {access_set}: {hidden!r}")
			else:
				b_item_rows = [row for row in results["inventory_page"]["rows"] if row["code"] == item.name]
				self.assertEqual(len(b_item_rows), 1)
				self.assertEqual(b_item_rows[0]["stock_qty"], 2)
			self.assertNotIn(self.b, frappe.as_json(results["bootstrap"]["settings"]))
			self.assertEqual(results["stock_summary"]["rows"][0]["stock_qty"], 11)
			mixed_json = frappe.as_json(results["item_detail"]["inventory"])
			self.assertIn(self.a, mixed_json)
			self.assertNotIn(self.b, mixed_json)
			self.assertIn(mixed.name, frappe.as_json(results["item_summaries"]))
			self.assertEqual(results["request_export"]["status"], "Queued")
			self.assertNotIn(self.b, frappe.as_json(results["request_export"]))
			if access_set == "area_a":
				self.assertNotIn(item.name, frappe.as_json(results["request_export"]))

	def test_adv_people_suggestions_keep_a_names_and_administrator_names(self):
		borrower = f"AUDIT A borrower {self.token}"
		recorder = f"AUDIT A recorder {self.token}"
		self.receipt(3)
		loan = self.movement(
			"Loan", 1, self.a, self.loan_leaf, ti_borrower=borrower, ti_recorder_name=recorder
		)
		self.submit(self.create(loan))
		user = self._restricted_operator(include_system=True)
		self._switch_to(user)
		self.assertIn(borrower, frappe.as_json(people.borrowers(search=self.token)))
		self.assertIn(recorder, frappe.as_json(people.recorded_names(search=self.token)))
		frappe.set_user("Administrator")
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}
		self.assertIn(borrower, frappe.as_json(people.borrowers(search=self.token)))
		self.assertIn(recorder, frappe.as_json(people.recorded_names(search=self.token)))

	def test_adv_b_only_document_operations_are_refused(self):
		_item, receipt, _loan = self._b_only_data()
		user = self._restricted_operator()
		self._switch_to(user)
		self.assertFalse(frappe.has_permission("Warehouse", "read", doc=frappe.get_doc("Warehouse", self.b)))
		self.assertEqual(receipt["items"][0]["t_warehouse"], self.b)
		calls = (
			lambda: native_api.load_document("Stock Entry", receipt.name),
			lambda: native_api.duplicate_document("Stock Entry", receipt.name, receipt.version, str(uuid4())),
			lambda: native_api.amend_document("Stock Entry", receipt.name, receipt.version, str(uuid4())),
			lambda: native_files.attachments("Stock Entry", receipt.name),
			lambda: printing.print_record_html("Stock Entry", receipt.name),
		)
		for call in calls:
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_adv_operator_cannot_move_own_draft_to_b(self):
		self.receipt(2)
		user = self._restricted_operator()
		self._switch_to(user)
		draft = self.create(self.movement("Issue", quantity=1, source=self.a))
		with self.assertRaises(frappe.PermissionError):
			native_api.save_document(
				"Stock Entry",
				draft.name,
				draft.version,
				{"items": [{"name": draft["items"][0]["name"], "s_warehouse": self.b}]},
			)

	def test_adv_request_key_replay_is_account_scoped(self):
		request_id = f"AUDIT-replay-{self.token}"
		admin_doc = self.create(self.movement(), request_id)
		user = self._restricted_operator()
		self._switch_to(user)
		operator_doc = self.create(self.movement(), request_id)
		self.assertNotEqual(operator_doc.name, admin_doc.name)

	def test_adv_svg_original_and_thumbnail_are_not_inline_script_documents(self):
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"AUDIT-{self.token}.svg",
				"content": b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "image",
			}
		).insert()
		from pathlib import Path

		self.addCleanup(Path(file.get_full_path()).unlink, missing_ok=True)
		try:
			catalog.set_item_image(self.item, str(frappe.get_doc("Item", self.item).modified), file.name)
		except frappe.ValidationError:
			return
		version = item_images.image_version(frappe.get_value("Item", self.item, "image"))
		responses = (
			item_images.thumbnail(self.item, 160, version),
			item_images.thumbnail(self.item, 2048, version),
		)
		unsafe = [
			(dict(response.headers), response.mimetype)
			for response in responses
			if "attachment" not in response.headers.get("Content-Disposition", "").lower()
			and "sandbox" not in response.headers.get("Content-Security-Policy", "").lower()
		]
		self.assertEqual(unsafe, [], f"inline-capable SVG responses: {unsafe!r}")
		for response in responses:
			self.assertEqual(response.headers.get("X-Content-Type-Options"), "nosniff")
			self.assertEqual(
				response.headers.get("Content-Security-Policy"),
				"sandbox; default-src 'none'; style-src 'unsafe-inline'",
			)

	def test_adv_print_html_escapes_untrusted_record_content(self):
		image_payload = "<img src=x onerror=alert(1)>"
		borrower_payload = "<svg onload=alert(1)>"
		item_payload = "<iframe src=javascript:alert(1)>"
		item = frappe.get_doc("Item", self.item)
		item.item_name = item_payload
		item.save()
		self.receipt(1)
		data = self.movement(
			"Loan",
			1,
			self.a,
			self.loan_leaf,
			ti_borrower=borrower_payload,
			ti_activity=self.activity.name,
			remarks=image_payload,
		)
		doc = self.submit(self.create(data))
		result = printing.print_record_html("Stock Entry", doc.name)
		for unsafe in (image_payload, borrower_payload, item_payload):
			self.assertNotIn(unsafe, result["html"])
