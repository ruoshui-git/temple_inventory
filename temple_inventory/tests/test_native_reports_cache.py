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
	def test_movement_history_uses_projection_read_cache_lifecycle(self):
		from temple_inventory.read_cache import CACHEABLE_METHODS

		self.assertIn("temple_inventory.browse.movement_history", CACHEABLE_METHODS)

	def test_cached_whole_operation_totals_skip_native_document_reloads(self):
		from types import SimpleNamespace
		from unittest.mock import Mock

		from temple_inventory.browse import _whole_operation_totals

		row = {"id": "00000000", "kind": "Receive", "stock_uom": "Nos", "stock_qty": 2}
		projection = SimpleNamespace(
			column_names={"browse_whole_totals": []}, rows=Mock(return_value=iter([row]))
		)

		self.assertEqual(
			_whole_operation_totals(projection, "lines"),
			[{key: value for key, value in row.items() if key != "id"}],
		)
		projection.rows.assert_called_once_with("browse_whole_totals")

	def test_operation_page_reflects_a_stock_entry_write(self):
		from temple_inventory import browse
		from temple_inventory.report_query import validate_query

		query = validate_query(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [0, 1],
				"scope": {"period": {"key": "all", "from": "", "to": ""}},
			}
		)
		before = browse.operation_page(query, records=True, page_length=1)["matched_count"]
		self.create(self.movement())
		after = browse.operation_page(query, records=True, page_length=1)["matched_count"]
		self.assertEqual(after, before + 1)

	def test_native_draft_count_matches_the_permission_scoped_draft_page(self):
		from temple_inventory import browse

		self.create(self.movement())
		self.assertEqual(
			browse.native_draft_count()["matched_count"],
			browse.native_drafts({"dataset": "movements", "statuses": [0]})["matched_count"],
		)

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
		without_attachments = SimpleNamespace(query=base_identity.query, load_item_attachments=False)
		self.assertNotEqual(
			read_cache._projection_identity(base_identity, *identity_args),
			read_cache._projection_identity(without_attachments, *identity_args),
		)
		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch.object(read_cache, "_redis", return_value=cache),
			patch.object(
				read_cache,
				"_revision_snapshot",
				return_value={
					"datasets": ["access", "catalog", "ledger"],
					"durable": {"access": "0", "catalog": "0", "ledger": "0"},
					"redis": {"access": "4", "catalog": "4", "ledger": "4"},
				},
			),
			patch.object(read_cache, "_permission_signature", return_value="account-grants"),
			patch.object(read_cache, "_configuration_signature", return_value="settings"),
		):
			stamp = str(now_datetime())
			with tempfile.TemporaryDirectory() as base:
				first = SimpleNamespace(
					query={"dataset": "inventory", "view": "summary", "groupBy": ["category"]},
					cache_bypass=False,
					cache_context={
						"generation": {
							"datasets": ["access", "catalog", "ledger"],
							"durable": {"access": "0", "catalog": "0", "ledger": "0"},
							"redis": {"access": "4", "catalog": "4", "ledger": "4"},
						},
						"datasets": ["access", "catalog", "ledger"],
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

				# Reject snapshots after either durable/Redis revisions or the
				# current account's grants have changed, even when the key still exists.
				for changed in ("revision", "permission"):
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
					with patch.object(read_cache, "_request_cacheable", return_value=True):
						if changed == "revision":
							current = first.cache_context["generation"]
							stale = {
								**current,
								"durable": {**current["durable"], "catalog": "1"},
							}
							change = patch.object(read_cache, "_revision_snapshot", return_value=stale)
						else:
							change = patch.object(
								read_cache, "_permission_signature", return_value="revoked-grant"
							)
						with change:
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

		before = read_cache.durable_revisions({"catalog"})["catalog"]
		frappe.db.savepoint("ti_cache_revision")
		read_cache._bump_durable_revisions({"catalog"})
		after = read_cache.durable_revisions({"catalog"})["catalog"]
		self.assertNotEqual(after, before)
		frappe.db.rollback(save_point="ti_cache_revision")
		after_rollback = read_cache.durable_revisions({"catalog"})["catalog"]
		self.assertEqual(after_rollback, before)

	def test_durable_revision_writer_only_allocates_sequence_and_inserts(self):
		from temple_inventory import read_cache

		statements = []
		with (
			patch.object(frappe.db, "get_next_sequence_val", side_effect=[10, 11]) as sequence,
			patch.object(
				frappe.db,
				"sql",
				side_effect=lambda statement, *_args, **_kwargs: statements.append(statement),
			),
		):
			read_cache._bump_durable_revisions({"entries", "ledger"})
		self.assertEqual(sequence.call_count, 2)
		self.assertEqual(len(statements), 2)
		self.assertTrue(all(statement.lstrip().lower().startswith("insert") for statement in statements))
		self.assertFalse(any("for update" in statement.lower() for statement in statements))

	def test_revision_table_readiness_is_cached_per_process_after_creation(self):
		from temple_inventory import read_cache

		site = f"read-revision-test-{self.token}"
		old_site = getattr(frappe.local, "site", None)
		frappe.local.site = site
		read_cache._REVISION_TABLE_READY_SITES.discard(site)
		self.addCleanup(read_cache._REVISION_TABLE_READY_SITES.discard, site)
		self.addCleanup(setattr, frappe.local, "site", old_site)
		with patch.object(frappe.db, "table_exists", side_effect=[False, True]) as table_exists:
			self.assertFalse(read_cache._revision_table_exists())
			self.assertTrue(read_cache._revision_table_exists())
			self.assertTrue(read_cache._revision_table_exists())
		self.assertEqual(table_exists.call_count, 2)

	def test_revision_pruning_preserves_each_dataset_maximum(self):
		from temple_inventory import read_cache

		frappe.db.savepoint("ti_revision_prune")
		read_cache._bump_durable_revisions({"catalog"})
		read_cache._bump_durable_revisions({"catalog"})
		before = read_cache.durable_revisions({"catalog"})["catalog"]
		read_cache.prune_durable_revisions()
		after = read_cache.durable_revisions({"catalog"})["catalog"]
		remaining = frappe.db.sql(
			"select count(*) from `tabInventory Read Revision` where dataset='catalog'",
			as_list=True,
		)[0][0]
		self.assertEqual(after, before)
		self.assertEqual(remaining, 1)
		frappe.db.rollback(save_point="ti_revision_prune")

	def test_cache_dataset_declarations_cover_every_method_and_projection_kind(self):
		from temple_inventory import read_cache

		self.assertEqual(set(read_cache.CACHE_METHOD_DATASETS), read_cache.CACHEABLE_METHODS)
		self.assertEqual(
			set(read_cache.PROJECTION_DATASETS),
			{"inventory", "movements", "loans", "counts", "expiry", "activities"},
		)
		self.assertEqual(set(read_cache.DOCTYPE_DATASETS), set(read_cache.READ_DOCTYPES))
		self.assertEqual(
			read_cache.datasets_for_doctype("Unknown Native DocType"), set(read_cache.ALL_DATASETS)
		)
		self.assertEqual(
			read_cache._projection_datasets({"dataset": "unknown"}), set(read_cache.ALL_DATASETS)
		)

	def test_reads_that_show_counts_depend_on_the_counts_dataset(self):
		# Movements, loans and the drafts list include count adjustments and count
		# drafts; activity detail and dashboard cards aggregate every kind of record.
		from temple_inventory import read_cache

		for kind in ("movements", "loans", "counts"):
			self.assertIn("counts", read_cache.PROJECTION_DATASETS[kind], kind)
		self.assertEqual(set(read_cache.PROJECTION_DATASETS["activities"]), set(read_cache.ALL_DATASETS))
		for method in (
			"temple_inventory.browse.native_drafts",
			"temple_inventory.browse.operation_page",
			"temple_inventory.browse.movement_history",
			"temple_inventory.browse.counts_page",
		):
			self.assertIn("counts", read_cache.CACHE_METHOD_DATASETS[method], method)
		for method in ("temple_inventory.activities.load_activity", "temple_inventory.browse.dashboard_card"):
			self.assertEqual(
				set(read_cache.CACHE_METHOD_DATASETS[method]), set(read_cache.ALL_DATASETS), method
			)

	def test_receipt_and_count_dataset_invalidation_are_scoped(self):
		from temple_inventory import read_cache

		def key(dataset, revisions):
			datasets = read_cache._projection_datasets({"dataset": dataset})
			generation = {
				"datasets": sorted(datasets),
				"durable": {name: revisions.get(name, "0") for name in sorted(datasets)},
				"redis": {name: "0" for name in sorted(datasets)},
			}
			return read_cache._cache_key(
				kind=dataset,
				user="Administrator",
				query={"dataset": dataset},
				args={},
				generation=generation,
				permission="permissions",
				configuration="configuration",
			)

		self.assertEqual(read_cache.datasets_for_doctype("Purchase Receipt"), {"entries", "ledger"})
		self.assertEqual(
			read_cache._projection_datasets({"dataset": "counts"}), {"counts", "catalog", "access"}
		)
		self.assertNotIn("entries", read_cache._projection_datasets({"dataset": "counts"}))
		self.assertNotIn("ledger", read_cache._projection_datasets({"dataset": "counts"}))
		before = {dataset: "0" for dataset in read_cache.DATASETS}
		after_receipt = {**before, "entries": "1", "ledger": "1"}
		self.assertEqual(key("counts", before), key("counts", after_receipt))
		self.assertNotEqual(key("inventory", before), key("inventory", after_receipt))
		self.assertNotEqual(key("movements", before), key("movements", after_receipt))
		after_count = {**before, "counts": "1", "ledger": "1"}
		self.assertNotEqual(key("counts", before), key("counts", after_count))
		self.assertNotEqual(key("inventory", before), key("inventory", after_count))
		self.assertNotEqual(key("counts", before), key("counts", {**before, "catalog": "1"}))
		self.assertNotEqual(key("counts", before), key("counts", {**before, "access": "1"}))
		self.assertEqual(read_cache.datasets_for_doctype("Stock Reconciliation"), {"counts", "ledger"})
		self.assertEqual(read_cache.datasets_for_doctype("Item"), {"catalog"})
		self.assertEqual(read_cache.datasets_for_doctype("User Permission"), {"access"})

	def test_durable_revision_protects_cache_when_redis_generation_does_not_advance(self):
		from temple_inventory import read_cache

		frappe.db.savepoint("ti_cache_redis_failure")
		old_touched = getattr(frappe.local, "inventory_cache_revision_touched", set())
		frappe.local.inventory_cache_revision_touched = set()
		self.addCleanup(setattr, frappe.local, "inventory_cache_revision_touched", old_touched)
		before = read_cache._revision_snapshot({"catalog"})
		with patch.object(read_cache, "data_generation", return_value=before["redis"]):
			read_cache._mark_durable_revisions({"catalog"})
			after = read_cache._revision_snapshot({"catalog"})
		self.assertEqual(after["redis"], before["redis"])
		self.assertNotEqual(after["durable"], before["durable"])
		import redis

		with patch.object(read_cache, "_redis", side_effect=redis.exceptions.ConnectionError):
			self.assertFalse(read_cache.invalidate_now({"catalog"}))
		frappe.db.rollback(save_point="ti_cache_redis_failure")

	def test_projection_context_captured_before_write_cannot_store_after_revision_changes(self):
		from types import SimpleNamespace

		from temple_inventory import read_cache

		old_revisions = {
			"datasets": ["access", "catalog", "ledger"],
			"durable": {"access": "0", "catalog": "0", "ledger": "0"},
			"redis": {"access": "0", "catalog": "0", "ledger": "0"},
		}
		new_revisions = {
			"datasets": ["access", "catalog", "ledger"],
			"durable": {"access": "0", "catalog": "42", "ledger": "0"},
			"redis": {"access": "0", "catalog": "0", "ledger": "0"},
		}
		old_request = getattr(frappe.local, "inventory_cache_request_revisions", None)
		frappe.local.inventory_cache_request_revisions = {
			"datasets": sorted(read_cache.ALL_DATASETS),
			"durable": {dataset: "0" for dataset in read_cache.ALL_DATASETS},
			"redis": {dataset: "0" for dataset in read_cache.ALL_DATASETS},
		}
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_revisions", old_request)
		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch.object(read_cache, "_permission_signature", return_value="permissions"),
			patch.object(read_cache, "_configuration_signature", return_value="configuration"),
			patch.object(read_cache, "_revision_snapshot", return_value=new_revisions),
		):
			context = read_cache.capture_cache_context({"dataset": "inventory"})
			self.assertEqual(context["generation"], old_revisions)
			cache = FakeCache()
			with tempfile.TemporaryDirectory() as directory:
				projection = SimpleNamespace(
					query={"dataset": "inventory", "view": "summary"},
					cache_bypass=False,
					cache_context=context,
					temp=SimpleNamespace(name=directory),
					context=SimpleNamespace(snapshot=str(frappe.utils.now_datetime())),
					column_names={"summary": []},
					main_table="summary",
					summary_table="summary",
					sums=(),
					db=sqlite3.connect(f"{directory}/projection.sqlite"),
				)
				projection.db.execute("create table rows (table_id text, identity text, payload text)")
				projection.db.commit()
				with patch.object(read_cache, "_redis", return_value=cache):
					read_cache.store_projection(projection)
				projection.db.close()
		self.assertEqual(cache.values, {})

	def test_read_cache_redis_outage_falls_back_to_fresh_projection(self):
		import redis

		from temple_inventory import read_cache

		self.receipt(2)
		frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
			read_cache.ALL_DATASETS
		)
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
		frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
			read_cache.ALL_DATASETS
		)
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
		old_touched = getattr(frappe.local, "inventory_cache_revision_touched", set())
		with (
			patch.object(read_cache, "_bump_durable_revisions") as bump,
			patch.object(read_cache, "invalidate_now") as invalidate,
		):
			frappe.local.inventory_cache_dirty_scheduled = False
			frappe.local.inventory_cache_revision_touched = set()
			before = frappe._dict(roles=[frappe._dict(role="Stock User")])
			user = frappe._dict(
				doctype="User",
				roles=[frappe._dict(role="System Manager")],
				get_doc_before_save=lambda: before,
				has_value_changed=lambda _field: False,
			)
			read_cache.invalidate_after_commit(user, "on_update")
			self.assertEqual(bump.call_args.args[0], {"access"})
			rollback_callback = list(after_rollback._functions)[-1]
			rollback_callback()
			self.assertEqual(invalidate.call_count, 0)

			frappe.local.inventory_cache_dirty_scheduled = False
			frappe.local.inventory_cache_revision_touched = set()
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
		old_touched = getattr(frappe.local, "inventory_cache_revision_touched", set())
		with (
			patch.object(read_cache, "invalidate_now") as invalidate,
		):
			try:
				after_commit._functions.clear()
				after_rollback._functions.clear()
				frappe.local.inventory_cache_dirty_scheduled = False
				frappe.local.inventory_cache_revision_touched = set()
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
				patch.object(read_cache, "_revision_snapshot", return_value={"snapshot": "17"}),
			):
				frappe.db.transaction_writes = 1
				read_cache.begin_read_request()
				self.assertEqual(commit.call_count, 0)
				self.assertIsNone(frappe.local.inventory_cache_request_revisions)
				frappe.db.transaction_writes = 0
				read_cache.begin_read_request()
				commit.assert_called_once_with()
				self.assertEqual(frappe.local.inventory_cache_request_revisions, {"snapshot": "17"})
		frappe.local.form_dict = old_form_dict

	def test_browse_http_contract_reuses_redis_base_projection_across_groups(self):
		from temple_inventory import read_cache
		from temple_inventory.projections import stock_rows

		# This request intentionally exercises the real Redis path while the test's
		# database transaction contains uncommitted fixtures. Evict its snapshot
		# after teardown so a later live request cannot observe rolled-back rows.
		self.addCleanup(read_cache.invalidate_now)
		old_generation = getattr(frappe.local, "inventory_cache_request_revisions", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(lambda: setattr(frappe.local, "inventory_cache_request_revisions", old_generation))
		self.addCleanup(lambda: setattr(frappe.local, "inventory_cache_request_started", old_started))
		with patch.object(
			frappe.db, "commit", side_effect=AssertionError("cacheable projection committed test data")
		):
			self.receipt(3)
			query = self.query("inventory", "summary")
			query["scope"]["warehouses"] = [self.a, self.b]
			frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
				read_cache.ALL_DATASETS
			)
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
		old_generation = getattr(frappe.local, "inventory_cache_request_revisions", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_revisions", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		if old_request is None:
			self.addCleanup(lambda: hasattr(frappe.local, "request") and delattr(frappe.local, "request"))
		else:
			self.addCleanup(setattr, frappe.local, "request", old_request)
		self.receipt(3)
		frappe.local.request = frappe._dict(headers={"X-Inventory-Account": frappe.session.user})
		frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
			read_cache.ALL_DATASETS
		)
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

	def test_write_during_build_rebuilds_instead_of_failing(self):
		from temple_inventory import read_cache

		self.addCleanup(read_cache.invalidate_now)
		old_request = getattr(frappe.local, "request", None)
		old_generation = getattr(frappe.local, "inventory_cache_request_revisions", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_revisions", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		if old_request is None:
			self.addCleanup(lambda: hasattr(frappe.local, "request") and delattr(frappe.local, "request"))
		else:
			self.addCleanup(setattr, frappe.local, "request", old_request)
		self.receipt(3)
		frappe.local.request = frappe._dict(headers={"X-Inventory-Account": frappe.session.user})
		frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
			read_cache.ALL_DATASETS
		)
		frappe.local.inventory_cache_request_started = str(frappe.utils.now_datetime())
		query = self.query("inventory", "summary")
		query["scope"]["warehouses"] = [self.a]
		with (
			patch.object(read_cache, "_request_cacheable", return_value=True),
			patch.object(read_cache, "cache_context_current", return_value=False),
			patch.object(read_cache, "restart_owned_read_snapshot", return_value=True) as restart,
		):
			page = report_page(query)
		self.assertGreater(page["matched_count"], 0)
		restart.assert_called_once_with()

	def test_expired_cached_projection_after_grouping_rebuilds_before_serving(self):
		from temple_inventory import read_cache
		from temple_inventory.projections import stock_rows

		self.addCleanup(read_cache.invalidate_now)
		old_request = getattr(frappe.local, "request", None)
		old_generation = getattr(frappe.local, "inventory_cache_request_revisions", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_revisions", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		if old_request is None:
			self.addCleanup(lambda: hasattr(frappe.local, "request") and delattr(frappe.local, "request"))
		else:
			self.addCleanup(setattr, frappe.local, "request", old_request)
		self.receipt(3)
		frappe.local.request = frappe._dict(headers={"X-Inventory-Account": frappe.session.user})
		frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
			read_cache.ALL_DATASETS
		)
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
		old_generation = getattr(frappe.local, "inventory_cache_request_revisions", None)
		old_started = getattr(frappe.local, "inventory_cache_request_started", None)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_revisions", old_generation)
		self.addCleanup(setattr, frappe.local, "inventory_cache_request_started", old_started)
		frappe.local.inventory_cache_request_revisions = read_cache._revision_snapshot(
			read_cache.ALL_DATASETS
		)
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
				"roles": [
					{"role": "Inventory Manager"},
					{"role": "System Manager"},
					{"role": "Stock Manager"},
					{"role": "Stock User"},
				],
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
