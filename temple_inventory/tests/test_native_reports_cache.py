"""Report/export contracts exercised against real native stock and permissions."""

import copy
import sqlite3
import tempfile
from unittest.mock import Mock, patch

import frappe

from temple_inventory import exports
from temple_inventory.projections import Projection, group_page, report_page
from temple_inventory.tests.helpers import FakeCache, NativeReportTestCase


class NativeReportsCacheTests(NativeReportTestCase):
	def test_entry_bundle_cache_reuses_permission_checked_bundle_within_projection(self):
		from temple_inventory.native_balances import entry_bundle

		bundle = frappe._dict(item_code=self.item, entries=[])
		bundle.check_permission = Mock()
		cache = {}
		row = frappe._dict(serial_and_batch_bundle="BUNDLE-TEST", item_code=self.item)
		with patch.object(frappe, "get_doc", return_value=bundle) as get_doc:
			self.assertIs(entry_bundle(row, bundle_cache=cache), bundle)
			self.assertIs(entry_bundle(row, bundle_cache=cache), bundle)
		self.assertEqual(get_doc.call_count, 1)
		bundle.check_permission.assert_called_once_with("read")
		with self.assertRaises(frappe.ValidationError):
			entry_bundle({**row, "item_code": "OTHER-ITEM"}, bundle_cache=cache)

	def test_bundle_cache_never_exposes_rows_with_hidden_item_or_warehouse(self):
		document = self.submit(self.create(self.movement()))
		query = self.query("movements", "records", record=document.name, statuses=[1])
		item_class = type(frappe.get_doc("Item", self.item))
		item_check = item_class.check_permission

		def hide_item(item, *args, **kwargs):
			if item.name == self.item:
				raise frappe.PermissionError("Item hidden")
			return item_check(item, *args, **kwargs)

		with patch.object(item_class, "check_permission", hide_item):
			self.assertEqual(report_page(query)["matched_count"], 0)

		warehouse_class = type(frappe.get_doc("Warehouse", self.a))
		warehouse_check = warehouse_class.check_permission

		def hide_warehouse(warehouse, *args, **kwargs):
			if warehouse.name == self.a:
				raise frappe.PermissionError("Warehouse hidden")
			return warehouse_check(warehouse, *args, **kwargs)

		with patch.object(warehouse_class, "check_permission", hide_warehouse):
			self.assertEqual(report_page(query)["matched_count"], 0)

	def test_read_cache_round_trips_base_sqlite_projection_into_private_database(self):
		from types import SimpleNamespace

		from frappe.utils import now_datetime

		from temple_inventory import read_cache
		from temple_inventory.report_query import resolved_period

		cache = FakeCache()
		quarter = resolved_period({"key": "this_quarter", "from": "", "to": ""})
		base_identity = SimpleNamespace(
			query={
				"dataset": "inventory",
				"view": "summary",
				"groupBy": ["category"],
				"sortBy": "available",
				"sort": "asc",
				"statuses": [1, 0],
				"itemCodes": ["B", "A"],
				"search": " Tea ",
				"scope": {
					"warehouses": ["Z", "A"],
					"period": {"key": "this_quarter", "from": "", "to": ""},
				},
			},
		)
		reordered_identity = SimpleNamespace(
			query={
				"dataset": "inventory",
				"view": "summary",
				"groupBy": ["item"],
				"sortBy": "item_name",
				"sort": "desc",
				"statuses": [0, 1],
				"itemCodes": ["A", "B"],
				"search": "tea",
				"scope": {
					"warehouses": ["A", "Z"],
					"period": {
						"key": "custom",
						"from": quarter["date_from"],
						"to": quarter["date_to"],
					},
				},
			},
		)
		identity_args = ("generation", "permission", "configuration")
		self.assertEqual(
			read_cache._projection_identity(base_identity, *identity_args),
			read_cache._projection_identity(reordered_identity, *identity_args),
		)
		related_identity = SimpleNamespace(query=base_identity.query, related=True)
		self.assertNotEqual(
			read_cache._projection_identity(base_identity, *identity_args),
			read_cache._projection_identity(related_identity, *identity_args),
		)
		lightweight_dashboard_identity = SimpleNamespace(
			query=base_identity.query,
			complete_records=False,
		)
		self.assertNotEqual(
			read_cache._projection_identity(base_identity, *identity_args),
			read_cache._projection_identity(lightweight_dashboard_identity, *identity_args),
		)
		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch.object(read_cache, "_redis", return_value=cache),
			patch.object(read_cache, "data_generation", return_value="4"),
			patch.object(read_cache, "_permission_signature", return_value="account-grants"),
			patch.object(read_cache, "_configuration_signature", return_value="settings"),
		):
			stamp = str(now_datetime())
			with tempfile.TemporaryDirectory() as base:
				first = SimpleNamespace(
					query={"dataset": "inventory", "view": "summary", "groupBy": ["category"]},
					cache_bypass=False,
					cache_context={
						"generation": "4",
						"permission": "account-grants",
						"configuration": "settings",
						"user": frappe.session.user,
					},
					temp=SimpleNamespace(name=base),
					context=SimpleNamespace(snapshot=stamp),
					column_names={"summary": ["id", "available"]},
					main_table="summary",
					summary_table="summary",
					sums=("available",),
				)
				first.db = sqlite3.connect(f"{base}/projection.sqlite")
				first.db.execute("create table rows (table_id text, identity text, payload text)")
				first.db.execute("insert into rows values ('summary', 'A', '{\"available\":3}')")
				read_cache.store_projection(first)
				first.db.close()

				second_dir = tempfile.TemporaryDirectory()
				second_path = f"{second_dir.name}/projection.sqlite"
				second = SimpleNamespace(
					query={"dataset": "inventory", "view": "summary", "groupBy": ["item"]},
					cache_bypass=False,
					cache_context=first.cache_context,
					temp=second_dir,
					context=SimpleNamespace(snapshot=str(now_datetime())),
					db=sqlite3.connect(second_path),
				)
				second.db.execute("create table rows (table_id text, identity text, payload text)")
				self.assertTrue(read_cache.restore_projection(second))
				self.assertEqual(second.main_table, "summary")
				self.assertEqual(set(second.column_names), {"summary"})
				self.assertEqual(second.sums, ("available",))
				self.assertEqual(second.db.execute("select identity from rows").fetchone()[0], "A")
				self.assertEqual(second.db.execute("pragma database_list").fetchone()[2], second_path)
				second.db.close()
				second_dir.cleanup()

				# Related inventory summaries cache their two base tables and five
				# authorized reference tables as a distinct complete snapshot.
				related_dir = tempfile.TemporaryDirectory()
				related_path = f"{related_dir.name}/projection.sqlite"
				related = SimpleNamespace(
					query=first.query,
					related=True,
					cache_bypass=False,
					cache_context=first.cache_context,
					temp=related_dir,
					context=SimpleNamespace(snapshot=stamp),
					column_names={
						name: ["id"]
						for name in (
							"summary",
							"locations",
							"items",
							"barcodes",
							"conversions",
							"warehouses",
							"files",
						)
					},
					main_table="summary",
					summary_table="summary",
					sums=("available",),
					db=sqlite3.connect(related_path),
				)
				related.db.execute("create table rows (table_id text, identity text, payload text)")
				read_cache.store_projection(related)
				related.db.close()
				restored_related = SimpleNamespace(
					query=first.query,
					related=True,
					cache_bypass=False,
					cache_context=first.cache_context,
					temp=related_dir,
					context=SimpleNamespace(snapshot=str(now_datetime())),
					db=sqlite3.connect(f"{related_dir.name}/restore.sqlite"),
				)
				restored_related.db.execute("create table rows (table_id text, identity text, payload text)")
				self.assertTrue(read_cache.restore_projection(restored_related))
				self.assertEqual(set(restored_related.column_names), set(related.column_names))
				restored_related.db.close()
				related_dir.cleanup()

				# Reject snapshots after either the shared source generation or the
				# current account's grants have changed, even when the key still exists.
				for changed in (
					{"data_generation": "5"},
					{"_permission_signature": "revoked-grant"},
				):
					rejected_dir = tempfile.TemporaryDirectory()
					rejected_path = f"{rejected_dir.name}/projection.sqlite"
					rejected = SimpleNamespace(
						query={"dataset": "inventory", "view": "summary", "groupBy": ["item"]},
						cache_bypass=False,
						cache_context=first.cache_context,
						temp=rejected_dir,
						context=SimpleNamespace(snapshot=str(now_datetime())),
						db=sqlite3.connect(rejected_path),
					)
					rejected.db.execute("create table rows (table_id text, identity text, payload text)")
					with (
						patch.object(read_cache, "_request_cacheable", return_value=True),
						patch.multiple(
							read_cache,
							**changed,
						),
					):
						self.assertFalse(read_cache.restore_projection(rejected))
					rejected.db.close()
					rejected_dir.cleanup()

				cache.values.clear()
				with patch.object(read_cache, "MAX_ENTRY_BYTES", 1):
					first.db = sqlite3.connect(f"{base}/projection.sqlite")
					read_cache.store_projection(first)
					first.db.close()
				self.assertEqual(cache.values, {})

				# A disconnected Redis must turn reuse/store into a cache miss, not a
				# projection error.
				import redis

				with patch.object(read_cache, "_redis", side_effect=redis.exceptions.ConnectionError):
					self.assertFalse(read_cache.restore_projection(second))
					first.db = sqlite3.connect(f"{base}/projection.sqlite")
					read_cache.store_projection(first)
					first.db.close()

	def test_read_cache_snapshot_age_uses_calculation_start_and_expires_at_ttl(self):
		from datetime import timedelta

		from temple_inventory import read_cache

		now = frappe.utils.now_datetime()
		with patch.object(read_cache, "now_datetime", return_value=now):
			self.assertTrue(read_cache._fresh(str(now - timedelta(seconds=read_cache.CACHE_TTL - 1))))
			self.assertFalse(read_cache._fresh(str(now - timedelta(seconds=read_cache.CACHE_TTL))))
			self.assertFalse(read_cache._fresh(str(now + timedelta(seconds=1))))

	def test_read_cache_invalidates_native_bundle_source_documents(self):
		from temple_inventory import read_cache

		self.assertIn("Serial and Batch Bundle", read_cache.READ_DOCTYPES)
		self.assertIn("Serial and Batch Entry", read_cache.READ_DOCTYPES)

	def test_durable_cache_revision_update_rolls_back_with_its_source_transaction(self):
		from temple_inventory import read_cache

		def get_revision():
			return frappe.db.sql(
				"select value from tabSingles where doctype=%s and field='ti_read_generation'",
				("Temple Inventory Settings",),
				as_dict=True,
			)

		before_rows = get_revision()
		before = int(before_rows[0].value) if before_rows else 0
		frappe.db.savepoint("ti_cache_revision")
		read_cache._bump_durable_revision()
		after = int(get_revision()[0].value)
		self.assertEqual(after, before + 1)
		frappe.db.rollback(save_point="ti_cache_revision")
		after_rollback_rows = get_revision()
		after_rollback = int(after_rollback_rows[0].value) if after_rollback_rows else 0
		self.assertEqual(after_rollback, before)

	def test_read_cache_redis_outage_falls_back_to_fresh_projection(self):
		import redis

		from temple_inventory import read_cache

		self.receipt(2)
		frappe.local.inventory_cache_request_generation = "live-generation"
		frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch.object(read_cache, "_redis", side_effect=redis.exceptions.ConnectionError),
		):
			result = report_page(self.query("inventory", "summary"), refresh=False)
		self.assertGreater(result["matched_count"], 0)

	def test_explicit_refresh_and_test_or_write_contexts_bypass_shared_cache(self):
		import redis

		from temple_inventory import read_cache

		self.receipt(2)
		query = self.query("inventory", "summary")
		frappe.local.inventory_cache_request_generation = "live-generation"
		frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
		self.assertFalse(read_cache._request_cacheable())
		with patch.object(read_cache, "_redis", side_effect=redis.exceptions.ConnectionError):
			result = report_page(query, refresh=True)
		self.assertGreater(result["matched_count"], 0)
		self.assertGreater(frappe.db.transaction_writes, 0)
		with Projection(query, refresh=True) as fresh:
			self.assertNotEqual(fresh.calculation_started, "2000-01-01 00:00:00")

	def test_user_role_edit_and_global_clear_cache_advance_durable_revision(self):
		from temple_inventory import read_cache

		after_commit = frappe.db.after_commit
		after_rollback = frappe.db.after_rollback
		prior_commit_callbacks = list(after_commit._functions)
		prior_rollback_callbacks = list(after_rollback._functions)
		old_scheduled = getattr(frappe.local, "inventory_cache_dirty_scheduled", False)
		old_touched = getattr(frappe.local, "inventory_cache_revision_touched", False)
		with (
			patch.object(read_cache, "_bump_durable_revision") as bump,
			patch.object(read_cache, "invalidate_now") as invalidate,
		):
			frappe.local.inventory_cache_dirty_scheduled = False
			frappe.local.inventory_cache_revision_touched = False
			before = frappe._dict(roles=[frappe._dict(role="Stock User")])
			user = frappe._dict(
				doctype="User",
				roles=[frappe._dict(role="System Manager")],
				get_doc_before_save=lambda: before,
				has_value_changed=lambda _field: False,
			)
			read_cache.invalidate_after_commit(user, "on_update")
			self.assertEqual(bump.call_count, 1)
			rollback_callback = list(after_rollback._functions)[-1]
			rollback_callback()
			self.assertEqual(invalidate.call_count, 0)

			frappe.local.inventory_cache_dirty_scheduled = False
			frappe.local.inventory_cache_revision_touched = False
			read_cache.invalidate_after_clear_cache()
			self.assertEqual(bump.call_count, 2)
			commit_callback = list(after_commit._functions)[-1]
			commit_callback()
			self.assertEqual(invalidate.call_count, 1)
		after_commit._functions.clear()
		after_commit._functions.extend(prior_commit_callbacks)
		after_rollback._functions.clear()
		after_rollback._functions.extend(prior_rollback_callbacks)
		frappe.local.inventory_cache_dirty_scheduled = old_scheduled
		frappe.local.inventory_cache_revision_touched = old_touched

	def test_read_cache_invalidation_publishes_after_commit_and_ignores_rollback(self):
		from temple_inventory import read_cache

		after_commit = frappe.db.after_commit
		after_rollback = frappe.db.after_rollback
		prior_commit_callbacks = list(after_commit._functions)
		prior_rollback_callbacks = list(after_rollback._functions)
		old_scheduled = getattr(frappe.local, "inventory_cache_dirty_scheduled", False)
		old_touched = getattr(frappe.local, "inventory_cache_revision_touched", False)
		with (
			patch.object(read_cache, "invalidate_now") as invalidate,
		):
			try:
				after_commit._functions.clear()
				after_rollback._functions.clear()
				frappe.local.inventory_cache_dirty_scheduled = False
				frappe.local.inventory_cache_revision_touched = False
				read_cache.invalidate_after_commit()
				self.assertEqual(invalidate.call_count, 0)
				rollback_callback = after_rollback._functions[-1]
				rollback_callback()
				self.assertEqual(invalidate.call_count, 0)
				read_cache.invalidate_after_commit()
				after_commit._functions[-1]()
				self.assertEqual(invalidate.call_count, 1)
				callback_count = len(after_commit._functions)
				read_cache.invalidate_after_commit(
					frappe._dict(
						doctype="User",
						get_doc_before_save=lambda: None,
						has_value_changed=lambda _field: False,
					),
					"on_update",
				)
				self.assertEqual(len(after_commit._functions), callback_count)
			finally:
				after_commit._functions.clear()
				after_commit._functions.extend(prior_commit_callbacks)
				after_rollback._functions.clear()
				after_rollback._functions.extend(prior_rollback_callbacks)
				frappe.local.inventory_cache_dirty_scheduled = old_scheduled
				frappe.local.inventory_cache_revision_touched = old_touched

	def test_read_cache_boundary_only_commits_clean_read_request(self):
		from temple_inventory import read_cache

		old_form_dict = getattr(frappe.local, "form_dict", None)
		frappe.local.form_dict = frappe._dict(cmd="temple_inventory.projections.report_page")
		with (
			patch.object(frappe.db, "transaction_writes", 0),
			patch.object(frappe.db, "before_commit", frappe._dict(_functions=[])),
			patch.object(frappe.db, "after_commit", frappe._dict(_functions=[])),
			patch.object(frappe.db, "before_rollback", frappe._dict(_functions=[])),
			patch.object(frappe.db, "after_rollback", frappe._dict(_functions=[])),
		):
			with (
				patch.object(frappe.db, "commit") as commit,
				patch.object(read_cache, "data_generation", return_value="17"),
			):
				frappe.db.transaction_writes = 1
				read_cache.begin_read_request()
				self.assertEqual(commit.call_count, 0)
				self.assertIsNone(frappe.local.inventory_cache_request_generation)
				frappe.db.transaction_writes = 0
				read_cache.begin_read_request()
				commit.assert_called_once_with()
				self.assertEqual(frappe.local.inventory_cache_request_generation, "17")
		frappe.local.form_dict = old_form_dict

	def test_browse_http_contract_reuses_redis_base_projection_across_groups(self):
		from temple_inventory import read_cache
		from temple_inventory.projections import stock_rows

		# This request intentionally exercises the real Redis path while the test's
		# database transaction contains uncommitted fixtures. Evict its snapshot
		# after teardown so a later live request cannot observe rolled-back rows.
		self.addCleanup(read_cache.invalidate_now)
		old_generation = getattr(frappe.local, "inventory_cache_request_generation", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(lambda: setattr(frappe.local, "inventory_cache_request_generation", old_generation))
		self.addCleanup(lambda: setattr(frappe.local, "inventory_cache_request_started", old_started))
		with patch.object(
			frappe.db, "commit", side_effect=AssertionError("cacheable projection committed test data")
		):
			self.receipt(3)
			query = self.query("inventory", "summary")
			query["scope"]["warehouses"] = [self.a, self.b]
			frappe.local.inventory_cache_request_generation = read_cache.data_generation()
			frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
			with (
				patch.object(read_cache, "_request_cacheable", return_value=True),
				patch("temple_inventory.projections.stock_rows", wraps=stock_rows) as source_reads,
			):
				first = report_page(query, page_length=1)
				second = report_page({**query, "groupBy": ["item"]}, page_length=1)
				third = report_page(
					{
						**query,
						"scope": {**query["scope"], "warehouses": [self.b, self.a]},
						"sortBy": "available",
						"sort": "desc",
					},
					start=1,
					page_length=1,
				)

			class LockTimeout:
				def acquire(self, blocking=True):
					return False

				def release(self):
					raise AssertionError("a lock that was not acquired must not be released")

			with patch.object(
				read_cache, "_redis", return_value=FakeCache(delegate=frappe.cache, lock=LockTimeout())
			):
				waiter = report_page(query, start=1, page_length=1)
		self.assertGreater(first["matched_count"], 0)
		self.assertEqual(second["matched_count"], first["matched_count"])
		self.assertEqual(third["matched_count"], first["matched_count"])
		self.assertEqual(waiter["matched_count"], first["matched_count"])
		self.assertEqual(source_reads.call_count, 1)

	def test_redis_failure_after_cached_restore_rebuilds_from_fresh_source(self):
		from temple_inventory import read_cache
		from temple_inventory.projections import stock_rows

		self.addCleanup(read_cache.invalidate_now)
		old_request = getattr(frappe.local, "request", None)
		old_generation = getattr(frappe.local, "inventory_cache_request_generation", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_generation", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		if old_request is None:
			self.addCleanup(lambda: setattr(frappe.local, "request", None))
		else:
			self.addCleanup(setattr, frappe.local, "request", old_request)
		self.receipt(3)
		frappe.local.request = frappe._dict(headers={"X-Inventory-Account": frappe.session.user})
		frappe.local.inventory_cache_request_generation = read_cache.data_generation()
		frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
		query = self.query("inventory", "summary")
		query["scope"]["warehouses"] = [self.a]
		with patch.object(read_cache, "_request_cacheable", return_value=True):
			first = report_page(query)
			self.assertGreater(first["matched_count"], 0)
			with (
				patch.object(read_cache, "cache_context_current", return_value=None),
				patch.object(read_cache, "restart_owned_read_snapshot", return_value=True) as restart,
				patch("temple_inventory.projections.stock_rows", wraps=stock_rows) as source_reads,
			):
				second = report_page(query)
		self.assertEqual(second["matched_count"], first["matched_count"])
		restart.assert_called_once_with()
		source_reads.assert_called_once()

	def test_expired_cached_projection_after_grouping_rebuilds_before_serving(self):
		from temple_inventory import read_cache
		from temple_inventory.projections import stock_rows

		self.addCleanup(read_cache.invalidate_now)
		old_request = getattr(frappe.local, "request", None)
		old_generation = getattr(frappe.local, "inventory_cache_request_generation", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_generation", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		if old_request is None:
			self.addCleanup(lambda: setattr(frappe.local, "request", None))
		else:
			self.addCleanup(setattr, frappe.local, "request", old_request)
		self.receipt(3)
		frappe.local.request = frappe._dict(headers={"X-Inventory-Account": frappe.session.user})
		frappe.local.inventory_cache_request_generation = read_cache.data_generation()
		frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
		query = self.query("inventory", "summary")
		query["groupBy"] = ["category"]
		query["scope"]["warehouses"] = [self.a]
		with patch.object(read_cache, "_request_cacheable", return_value=True):
			first = group_page(query, parent_path=[])
			self.assertGreater(first["matched_count"], 0)
			original_stock_rows = stock_rows

			def fresh_rows(context):
				for row in original_stock_rows(context):
					row["category"] = "fresh-source-marker"
					yield row

			restore_results = []
			original_restore = read_cache.restore_projection

			def tracked_restore(projection):
				result = original_restore(projection)
				restore_results.append(result)
				return result

			with (
				patch.object(read_cache, "_fresh", side_effect=[True, False]),
				patch.object(read_cache, "restore_projection", side_effect=tracked_restore),
				patch.object(read_cache, "restart_owned_read_snapshot", return_value=True) as restart,
				patch("temple_inventory.projections.stock_rows", side_effect=fresh_rows) as source_reads,
			):
				second = group_page(query, parent_path=[])

		self.assertEqual(restore_results, [True, False])
		restart.assert_called_once_with()
		self.assertEqual(source_reads.call_count, 1)
		self.assertTrue(any("fresh-source-marker" in (row.get("group_path") or []) for row in second["rows"]))

	def test_uncached_snapshot_restart_rejects_pending_writes(self):
		from temple_inventory import read_cache

		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch.object(frappe.db, "transaction_writes", 1),
		):
			self.assertFalse(read_cache.restart_owned_read_snapshot())

	def test_inflight_projection_discards_build_after_generation_change(self):
		from temple_inventory import read_cache
		from temple_inventory.projections import stock_rows

		self.addCleanup(read_cache.invalidate_now)
		old_generation = getattr(frappe.local, "inventory_cache_request_generation", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_generation", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		frappe.local.inventory_cache_request_generation = read_cache.data_generation()
		frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
		original = stock_rows

		def concurrent_generation_change(context):
			rows = original(context)
			read_cache.invalidate_now()
			return rows

		query = self.query("inventory", "summary")
		query["scope"]["warehouses"] = [self.a]
		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch("temple_inventory.projections.stock_rows", side_effect=concurrent_generation_change),
			self.assertRaises(frappe.ValidationError),
		):
			report_page(query)

	def test_worker_discards_cached_permissions_when_owner_role_is_revoked_during_generation(self):
		from frappe.cache_manager import clear_defaults_cache

		self.receipt()
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-role-worker-{self.token}@example.test",
				"first_name": "Role worker owner",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": "System Manager"}, {"role": "Stock Manager"}, {"role": "Stock User"}],
			}
		).insert()
		self.addCleanup(clear_defaults_cache, user.name)
		frappe.set_user(user.name)
		with patch("temple_inventory.exports._enqueue"):
			request = exports.request_export(self.query(), "summary", export_format="csv")
		frappe.set_user("Administrator")
		write = exports._write

		def revoke_after_write(projection, doc, path):
			self.assertIn("System Manager", frappe.get_roles())
			count = write(projection, doc, path)
			local_cache = copy.deepcopy(frappe.local.cache)
			role_permissions = copy.deepcopy(frappe.local.role_permissions)
			# Native role edit invalidates shared Redis caches. Retain the running
			# worker's old local memoization, as a change in another request would.
			frappe.set_user("Administrator")
			changed = frappe.get_doc("User", user.name)
			changed.set("roles", [{"role": "Stock Manager"}, {"role": "Stock User"}])
			changed.save()
			frappe.set_user(user.name)
			frappe.local.cache = local_cache
			frappe.local.role_permissions = role_permissions
			self.assertIn("System Manager", frappe.get_roles())
			return count

		with (
			patch("frappe.db.commit"),
			patch("frappe.db.rollback"),
			patch("temple_inventory.exports._write", side_effect=revoke_after_write) as writer,
			patch("temple_inventory.exports._private_file") as private_file,
		):
			exports.generate_export(request["name"])
		self.assertEqual(frappe.session.user, "Administrator")
		writer.assert_called_once()
		private_file.assert_not_called()
		failed = frappe.get_doc("Inventory Export Request", request["name"])
		self.assertEqual(failed.status, "Failed")
		self.assertFalse(failed.output_file)
		self.assertFalse(failed.access_manifest)
