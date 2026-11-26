"""Warehouse path conversion and document-name synchronization regressions."""

from unittest.mock import patch

import frappe

from temple_inventory import warehouse_names, warehouse_rename, warehouses
from temple_inventory.patches import compact_warehouse_names
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class WarehouseRenameTests(NativeDocumentTests):
	def test_compact_separator_round_trips_without_colliding_between_sites(self):
		parent = frappe._dict(
			name="functional-area", warehouse_name="T2/F", ti_label="功能区域", ti_short_label="F"
		)
		self.assertEqual(
			warehouse_names.native_name("Room", "A01", parent, "physical-root"),
			"T2/F/A01",
		)
		self.assertEqual(
			warehouse_names.derive_local_label("T2/F/A01", parent, label="", short_label="", direct=False),
			("A01", ""),
		)
		self.assertEqual(
			warehouse_names.native_name(
				"FY", "FY", frappe._dict(name="t1-out", warehouse_name="T1/OUT"), "root"
			),
			"T1/OUT/FY",
		)
		second_yard = warehouse_names.native_name(
			"FY", "FY", frappe._dict(name="t2-out", warehouse_name="T2/OUT"), "root"
		)
		self.assertEqual(second_yard, "T2/OUT/FY")
		self.assertNotEqual("T1/OUT/FY", second_yard)

	def test_compact_path_patch_is_idempotent_and_does_not_enqueue_rename(self):
		room = self.room_a
		leaf = self.a
		root_name = frappe.db.get_value("Warehouse", self.physical, "warehouse_name")
		frappe.db.set_value("Warehouse", room, "warehouse_name", f"{root_name} / Old Room")
		frappe.db.set_value(
			"Warehouse",
			leaf,
			"warehouse_name",
			f"{root_name} / Old Room{warehouse_names.DIRECT_STORAGE_SUFFIX}",
		)
		with patch("temple_inventory.warehouse_rename._enqueue") as enqueue:
			compact_warehouse_names.execute()
			first = frappe.db.get_value("Warehouse", room, "warehouse_name")
			compact_warehouse_names.execute()
			self.assertEqual(frappe.db.get_value("Warehouse", room, "warehouse_name"), first)
			enqueue.assert_not_called()
		self.assertEqual(first, f"Native Test A Room {self.topology_token}")
		self.assertEqual(
			frappe.db.get_value("Warehouse", leaf, "warehouse_name"),
			first + warehouse_names.DIRECT_STORAGE_SUFFIX,
		)
		self.assertNotIn(room, {row["name"] for row in warehouse_names.development_name_check()["diffs"]})
		self.assertNotIn(leaf, {row["name"] for row in warehouse_names.development_name_check()["diffs"]})

	def test_plan_includes_direct_leaves_counts_links_and_omits_protected(self):
		old = f"legacy-room-{self.token}"
		frappe.rename_doc("Warehouse", self.room_a, old, force=True, show_alert=False, rebuild_search=False)
		result = warehouse_rename.plan()
		entry = next(row for row in result["planned"] if row["old"] == old)
		self.assertTrue(entry["new"].endswith(" - " + frappe.db.get_value("Company", self.company, "abbr")))
		self.assertGreaterEqual(entry["linked_records"], 1)
		self.assertIn(self.a, [row["old"] for row in result["planned"]])
		self.assertNotIn(self.physical, [row["old"] for row in result["planned"]])
		self.assertNotIn(self.system_root, [row["old"] for row in result["planned"]])

	def test_plan_reports_target_conflict_without_partial_renames(self):
		row = frappe._dict(name="old-room", warehouse_name="T1/OUT/FY", lft=3)
		settings = frappe._dict(
			company=self.company,
			physical_root_warehouse="physical-root",
			root_warehouse="root",
			system_root_warehouse="system",
			leased_warehouse="loan",
			damaged_warehouse="damaged",
		)
		with (
			patch.object(warehouse_rename, "_physical_rows", return_value=(settings, [row])),
			patch.object(warehouse_rename, "_protected", return_value=set()),
			patch.object(frappe.db, "get_value", return_value="O"),
			patch.object(frappe, "get_all", return_value=["T1/OUT/FY - O"]),
			patch.object(warehouse_rename, "_linked_counts", return_value={"old-room": 0}),
		):
			result = warehouse_rename.plan()
		self.assertFalse(result["can_run"])
		self.assertEqual(result["conflicts"][0]["reason"], "target_exists")
		self.assertEqual(result["planned"][0]["old"], "old-room")
		with (
			patch.object(warehouse_rename, "plan", return_value=result),
			patch.object(frappe, "rename_doc") as rename,
		):
			self.assertEqual(warehouse_rename.run(), result)
			rename.assert_not_called()

	def test_plan_reports_duplicate_and_invalid_or_overlong_targets(self):
		settings = frappe._dict(company=self.company, physical_root_warehouse="physical-root")
		rows = [
			frappe._dict(name="first", warehouse_name="same", lft=1),
			frappe._dict(name="second", warehouse_name="same", lft=2),
			frappe._dict(name="long", warehouse_name="x" * 140, lft=3),
		]

		def validate_target(_doctype, name):
			if name.startswith("same"):
				raise ValueError("invalid")

		with (
			patch.object(warehouse_rename, "_physical_rows", return_value=(settings, rows)),
			patch.object(warehouse_rename, "_protected", return_value=set()),
			patch.object(frappe.db, "get_value", return_value="O"),
			patch.object(frappe, "get_all", return_value=[]),
			patch.object(
				warehouse_rename,
				"_linked_counts",
				return_value={"first": 0, "second": 0, "long": 0},
			),
			patch.object(warehouse_rename, "validate_name", side_effect=validate_target),
		):
			result = warehouse_rename.plan()
		reasons = {conflict["reason"] for conflict in result["conflicts"]}
		self.assertIn("duplicate_target", reasons)
		self.assertIn("invalid_target", reasons)
		self.assertIn("target_too_long", reasons)

	def test_stocked_room_and_leaf_rename_resume_and_preserve_native_rows(self):
		from temple_inventory import browse, read_cache

		self.receipt(3)
		query = {"dataset": "inventory", "itemCodes": [self.item], "restrictItems": True}
		browse_before = browse.inventory_page(query, page_length=100, refresh=True)
		item_before = next(row for row in browse_before["rows"] if row["code"] == self.item)
		old_room = f"legacy-room-{self.token}"
		old_leaf = f"legacy-leaf-{self.token}"
		frappe.rename_doc(
			"Warehouse", self.room_a, old_room, force=True, show_alert=False, rebuild_search=False
		)
		frappe.rename_doc("Warehouse", self.a, old_leaf, force=True, show_alert=False, rebuild_search=False)
		permission = frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": "Administrator",
				"allow": "Warehouse",
				"for_value": old_leaf,
			}
		).insert(ignore_permissions=True)
		bin_before = frappe.get_all(
			"Bin",
			filters={"warehouse": old_leaf, "item_code": self.item},
			fields=["warehouse", "item_code", "actual_qty", "stock_value", "valuation_rate"],
		)
		sle_before = frappe.get_all(
			"Stock Ledger Entry",
			filters={"warehouse": old_leaf, "item_code": self.item},
			fields=["item_code", "qty_after_transaction", "actual_qty", "valuation_rate", "voucher_no"],
			order_by="posting_date, posting_time, creation, name",
		)
		voucher = sle_before[0].voucher_no
		stock_entry_rows_before = frappe.get_all(
			"Stock Entry Detail",
			filters={"parent": voucher, "item_code": self.item},
			fields=["name", "item_code", "s_warehouse", "t_warehouse", "qty"],
		)
		settings_before = frappe.get_single("Temple Inventory Settings")
		allowed_before = [row.warehouse for row in settings_before.allowed_warehouses]
		allowed_targets = {
			row.name: row.warehouse_name + " - " + frappe.db.get_value("Company", self.company, "abbr")
			for row in frappe.get_all("Warehouse", fields=["name", "warehouse_name"], limit_page_length=0)
		}
		warehouse = frappe.get_doc("Warehouse", old_room)
		room_target = warehouse.warehouse_name + " - " + frappe.db.get_value("Company", self.company, "abbr")
		leaf_native = frappe.db.get_value("Warehouse", old_leaf, "warehouse_name")
		leaf_target = leaf_native + " - " + frappe.db.get_value("Company", self.company, "abbr")
		planned_names = {row["old"]: row["new"] for row in warehouse_rename.plan()["planned"]}
		left, right, parent = warehouse.lft, warehouse.rgt, warehouse.parent_warehouse
		real_rename = frappe.rename_doc
		calls = 0

		def fail_after_first(*args, **kwargs):
			nonlocal calls
			calls += 1
			if calls == 2:
				raise RuntimeError("simulated interruption")
			return real_rename(*args, **kwargs)

		def commit_effect():
			# The runner stubs commit; model its durable publish callback explicitly.
			read_cache.invalidate_now()
			frappe.local.temple_inventory_memos = None
			frappe.local.inventory_cache_revision_touched = set()
			frappe.local.inventory_cache_revision_datasets = set()
			frappe.local.inventory_cache_dirty_scheduled = False

		with (
			patch.object(frappe, "rename_doc", side_effect=fail_after_first),
			patch.object(frappe.db, "commit", side_effect=commit_effect),
			patch.object(frappe.db, "rollback"),
			patch.object(frappe, "publish_realtime"),
		):
			with self.assertRaisesRegex(RuntimeError, "simulated interruption"):
				warehouse_rename.run()
			resumed = warehouse_rename.run()
			second = warehouse_rename.run()
		self.assertEqual(resumed["pending"], 0)
		self.assertGreaterEqual(len(resumed["renamed"]), 1)
		self.assertEqual(second["renamed"], [])
		self.assertTrue(frappe.db.exists("Warehouse", room_target))
		self.assertTrue(frappe.db.exists("Warehouse", leaf_target))
		self.assertEqual(frappe.db.get_value("Warehouse", room_target, "parent_warehouse"), parent)
		self.assertEqual(
			(
				frappe.db.get_value("Warehouse", room_target, "lft"),
				frappe.db.get_value("Warehouse", room_target, "rgt"),
			),
			(left, right),
		)
		bin_after = frappe.get_all(
			"Bin",
			filters={"warehouse": leaf_target, "item_code": self.item},
			fields=["warehouse", "item_code", "actual_qty", "stock_value", "valuation_rate"],
		)
		sle_after = frappe.get_all(
			"Stock Ledger Entry",
			filters={"warehouse": leaf_target, "item_code": self.item},
			fields=["item_code", "qty_after_transaction", "actual_qty", "valuation_rate", "voucher_no"],
			order_by="posting_date, posting_time, creation, name",
		)
		stock_entry_rows_after = frappe.get_all(
			"Stock Entry Detail",
			filters={"parent": voucher, "item_code": self.item},
			fields=["name", "item_code", "s_warehouse", "t_warehouse", "qty"],
		)
		self.assertEqual([dict(row, warehouse=old_leaf) for row in bin_after], bin_before)
		self.assertEqual(sle_after, sle_before)
		self.assertEqual(
			[
				{
					**dict(row),
					"s_warehouse": old_leaf if row.s_warehouse == leaf_target else row.s_warehouse,
					"t_warehouse": old_leaf if row.t_warehouse == leaf_target else row.t_warehouse,
				}
				for row in stock_entry_rows_after
			],
			[dict(row) for row in stock_entry_rows_before],
		)
		allowed_after = [
			row.warehouse for row in frappe.get_single("Temple Inventory Settings").allowed_warehouses
		]
		self.assertEqual(
			allowed_after,
			[planned_names.get(name, allowed_targets.get(name, name)) for name in allowed_before],
		)
		self.assertEqual(frappe.db.get_value("User Permission", permission.name, "for_value"), leaf_target)
		browse_after = browse.inventory_page(query, page_length=100, refresh=True)
		item_after = next(row for row in browse_after["rows"] if row["code"] == self.item)
		self.assertEqual(item_after["stock_qty"], item_before["stock_qty"])

	def test_explicit_rename_endpoints_require_admin_role(self):
		from temple_inventory.roles import MANAGER, OPERATOR, VIEWER

		for role in (VIEWER, OPERATOR, MANAGER):
			user = (
				frappe.get_doc(
					{
						"doctype": "User",
						"email": f"warehouse-rename-{role.split()[-1].lower()}-{self.token}@example.test",
						"first_name": "Warehouse Rename",
						"user_type": "System User",
						"send_welcome_email": 0,
						"roles": [{"role": role}],
					}
				)
				.insert(ignore_permissions=True)
				.name
			)
			frappe.set_user(user)
			with self.assertRaises(frappe.PermissionError):
				warehouse_rename.sync_document_names(dry_run=1)
			with self.assertRaises(frappe.PermissionError):
				warehouse_rename.sync_status()
		frappe.set_user("Administrator")
		self.assertIn("planned", warehouse_rename.sync_document_names(dry_run=1))
		self.assertIn("pending", warehouse_rename.sync_status())
		with (
			patch("frappe.utils.background_jobs.is_job_enqueued", return_value=False),
			patch.object(frappe, "enqueue") as enqueue,
		):
			queued = warehouse_rename.sync_document_names(dry_run=0)
		self.assertTrue(queued["queued"])
		enqueue.assert_called_once()

	def test_relabel_queues_sync_after_commit_only_once_explicit_run_finished(self):
		callbacks = []
		current = frappe.get_doc("Warehouse", self.room_a)
		version = str(current.modified)
		with patch.object(
			type(frappe.db.after_commit),
			"add",
			autospec=True,
			side_effect=lambda _manager, callback: callbacks.append(callback),
		):
			warehouses.rename_location(self.room_a, "Relabeled room " + self.token, "RL", version)
		enqueue_callbacks = [callback for callback in callbacks if callback.__name__ == "enqueue_sync"]
		self.assertEqual(len(enqueue_callbacks), 1)
		with patch("temple_inventory.warehouse_rename._enqueue") as enqueue:
			frappe.db.set_global(warehouse_rename.AUTO_SYNC_KEY, 0)
			enqueue_callbacks[0]()
			enqueue.assert_not_called()
			frappe.db.set_global(warehouse_rename.AUTO_SYNC_KEY, 1)
			enqueue_callbacks[0]()
			enqueue.assert_called_once_with()

	def test_relabel_during_a_running_sync_requests_another_pass(self):
		frappe.cache.delete_value(warehouse_rename.RERUN_KEY)
		with (
			patch("frappe.utils.background_jobs.is_job_enqueued", return_value=True),
			patch.object(frappe, "enqueue") as enqueue,
		):
			self.assertFalse(warehouse_rename._enqueue())
		enqueue.assert_not_called()
		self.assertTrue(frappe.cache.get_value(warehouse_rename.RERUN_KEY))
		plans = iter(
			[
				{"planned": [], "conflicts": [], "pending": 0},
				{"planned": [], "conflicts": [], "pending": 0},
				{"planned": [], "conflicts": [], "pending": 0},
				{"planned": [], "conflicts": [], "pending": 0},
			]
		)
		calls = []

		def next_plan():
			calls.append(1)
			if len(calls) == 2:
				# A relabel commits while the job is between passes.
				frappe.cache.set_value(warehouse_rename.RERUN_KEY, 1)
			return next(plans)

		with (
			patch.object(warehouse_rename, "plan", side_effect=next_plan),
			patch.object(frappe.db, "commit"),
		):
			warehouse_rename.run()
		self.assertEqual(len(calls), 4)
		self.assertFalse(frappe.cache.get_value(warehouse_rename.RERUN_KEY))
