"""Focused notification preference and access boundary tests."""

import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from temple_inventory import notifications, push
from temple_inventory.native_stock import MOVEMENT_LABELS, MOVEMENT_PURPOSES
from temple_inventory.patches import fix_expiry_notification_links, set_site_timezone
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class NotificationTests(NativeDocumentTests):
	def test_generated_notification_link_patterns_match_inventory_routes(self):
		source = (Path(__file__).resolve().parents[1] / "notifications.py").read_text()
		for pattern in (
			"/inventory/{'counts' if doctype == 'Stock Reconciliation' else 'movements'}/{name}",
			"/api/method/temple_inventory.exports.download_export?name=",
			"/inventory/reports",
			"/inventory/stock/expiry",
		):
			self.assertIn(pattern, source)

	def test_timezone_patch_only_fills_an_empty_timezone(self):
		with (
			patch.object(frappe.db, "get_single_value", return_value=""),
			patch.object(frappe.db, "set_single_value") as set_value,
		):
			set_site_timezone.execute()
		set_value.assert_called_once_with("System Settings", "time_zone", "America/New_York")
		with (
			patch.object(frappe.db, "get_single_value", return_value="Europe/Paris"),
			patch.object(frappe.db, "set_single_value") as set_value,
		):
			set_site_timezone.execute()
		set_value.assert_not_called()

	def test_expiry_notification_link_patch_rewrites_legacy_rows(self):
		with patch.object(frappe.db, "sql") as sql:
			fix_expiry_notification_links.execute()
		sql.assert_called_once_with(
			"""update `tabNotification Log` set link=%s where link=%s""",
			("/inventory/stock/expiry", "/inventory/expiry"),
		)

	def test_expiry_digest_defaults_off_and_other_events_on(self):
		with patch.object(frappe.defaults, "get_user_default", return_value=None):
			preferences = notifications._prefs()
		self.assertFalse(preferences["expiry_digest"])
		self.assertTrue(preferences["movement_submitted"])
		self.assertTrue(all(preferences["movement_kinds"].values()))
		self.assertEqual(set(notifications.KINDS), set(MOVEMENT_PURPOSES))
		source = (Path(__file__).resolve().parents[2] / "frontend/src/lib/kindIcons.ts").read_text()
		frontend = dict(re.findall(r'\s*([A-Za-z]+):\s*\{ icon: "[^"]+", label: "([^"]+)" \}', source))
		self.assertEqual({kind: frontend[kind] for kind in MOVEMENT_LABELS}, MOVEMENT_LABELS)

	def test_push_subscription_permission_is_owner_only(self):
		doc = frappe._dict(user="owner@example.com")
		self.assertTrue(push.subscription_permission(doc, "read", user="owner@example.com"))
		self.assertTrue(push.subscription_permission(doc, "delete", user="owner@example.com"))
		self.assertFalse(push.subscription_permission(doc, "read", user="other@example.com"))
		self.assertFalse(push.subscription_permission(doc, "write", user="owner@example.com"))

	def test_recipient_filter_requires_app_role_master_event_and_notification_settings(self):
		account = frappe._dict(enabled=1, user_type="System User")
		prefs = dict(notifications.DEFAULTS)
		with (
			patch.object(frappe.db, "get_value", side_effect=[account, 1]),
			patch.object(frappe, "get_roles", return_value=["System Manager"]),
			patch.object(notifications, "_prefs", return_value=prefs),
		):
			self.assertTrue(
				notifications._user_allowed("manager@example.com", "movement_submitted", "Receive")
			)
		prefs["movement_kinds"]["Receive"] = False
		with (
			patch.object(frappe.db, "get_value", side_effect=[account, 1]),
			patch.object(frappe, "get_roles", return_value=["System Manager"]),
			patch.object(notifications, "_prefs", return_value=prefs),
		):
			self.assertFalse(
				notifications._user_allowed("manager@example.com", "movement_submitted", "Receive")
			)

	def test_document_events_enqueue_after_commit_without_delivering_inline(self):
		doc = frappe._dict(
			doctype="Stock Entry", name="MAT-STE-test", ti_movement_kind="Receive", amended_from=None
		)
		with patch.object(frappe, "enqueue") as enqueue:
			notifications.enqueue_document_event(doc, "on_submit")
		self.assertEqual(enqueue.call_args.kwargs["notification_event"], "movement_submitted")
		self.assertTrue(enqueue.call_args.kwargs["enqueue_after_commit"])

	def test_export_result_watched_is_created_read_and_contains_row_count(self):
		request = frappe._dict(name="EXP-test", status="Completed", tables_json='["items"]', row_count=17)
		with patch.object(notifications, "_create") as create:
			notifications.export_result(request, watched=True)
		kwargs = create.call_args.args
		self.assertEqual(kwargs[1], "导出完成")
		self.assertIn("17 行", kwargs[2])
		self.assertEqual(create.call_args.kwargs["read"], 1)

	def test_push_payload_uses_notification_fields_and_bad_endpoint_is_pruned(self):
		log = frappe._dict(
			name="NL-test",
			type="库存流动",
			subject="陈明 出库 3 种物品",
			link="/inventory/movements/STE-test",
			for_user="manager@example.com",
		)
		subscription = frappe._dict(
			name="SUB-test", endpoint="https://push.example.test", p256dh="key", auth="auth"
		)
		with (
			patch.object(frappe, "get_doc", side_effect=[log, subscription]),
			patch.object(frappe, "get_all", return_value=["SUB-test"]),
			patch.object(frappe.db, "count", return_value=3) as count,
			patch.object(notifications, "_prefs", return_value={"enabled": True}),
			patch.object(push, "_send") as send,
		):
			push.send_notification("NL-test")
		payload = send.call_args.args[1]
		self.assertEqual(
			payload,
			{
				"title": "物资管理 · 库存流动",
				"body": log.subject,
				"url": log.link,
				"tag": "ti-NL-test",
				"badge_count": 3,
			},
		)
		count.assert_called_once_with(
			"Notification Log",
			{"for_user": log.for_user, "type": ["in", list(notifications.TYPES)], "read": 0},
		)

		from pywebpush import WebPushException

		response = SimpleNamespace(status_code=410)
		with (
			patch.object(
				push,
				"_settings",
				return_value=frappe._dict(
					name="Temple Inventory Settings", ti_vapid_subject="mailto:test@example.com"
				),
			),
			patch("temple_inventory.push.get_decrypted_password", return_value="private"),
			patch("pywebpush.webpush", side_effect=WebPushException("gone", response=response)),
			patch.object(frappe, "delete_doc") as delete_doc,
			patch.object(frappe.db, "set_value") as set_value,
		):
			push._send(subscription, payload)
		delete_doc.assert_called_once_with(push.DOCTYPE, "SUB-test", ignore_permissions=True)
		set_value.assert_not_called()

	def test_webpush_real_encryption_accepts_stored_base64url_private_key(self):
		from pywebpush import webpush

		private = ec.generate_private_key(ec.SECP256R1())
		private_raw = private.private_numbers().private_value.to_bytes(32, "big")
		public_raw = private.public_key().public_bytes(
			serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
		)
		auth_key = b"0123456789abcdef"
		subscription = frappe._dict(
			name="SUB-encryption",
			endpoint="https://push.example.test/send",
			p256dh=push._b64(public_raw),
			auth=push._b64(auth_key),
		)
		stored_private = push._b64(private_raw)
		response = frappe._dict(status_code=201, headers={}, text="")
		with (
			patch.object(
				push,
				"_settings",
				return_value=frappe._dict(
					name="Temple Inventory Settings", ti_vapid_subject="mailto:test@example.com"
				),
			),
			patch.object(push, "get_decrypted_password", return_value=stored_private),
			patch("pywebpush.requests.post", return_value=response) as post,
			patch.object(frappe.db, "set_value"),
		):
			push._send(
				subscription,
				{"title": "物资管理", "body": "测试", "url": "/inventory", "tag": "test", "badge_count": 1},
			)
		self.assertTrue(post.called)
		self.assertIn("aes128gcm", post.call_args.kwargs["headers"]["Content-Encoding"])
		self.assertNotIn("测试", post.call_args.kwargs["data"].decode(errors="ignore"))

	def test_subjects_use_presenter_locations_amendment_wording_and_difference_rows(self):
		actor_name = "陈明"
		lines = [
			frappe._dict(s_warehouse="SRC", t_warehouse="DST", item_code="ITEM-1", item_name="肥皂盒"),
			frappe._dict(s_warehouse="SRC", t_warehouse="DST", item_code="ITEM-1", item_name="肥皂盒"),
		]
		movement = frappe._dict(
			doctype="Stock Entry",
			name="STE-test",
			ti_movement_kind="Transfer",
			items=lines,
			amended_from="STE-original",
		)
		with patch.object(frappe.db, "get_value", return_value=actor_name):
			with patch.object(notifications, "_primary_location", return_value="A01 → B02"):
				self.assertEqual(
					notifications._subject(movement, "movement_cancelled"), "陈明 修改了调拨 STE-test"
				)
				self.assertEqual(
					notifications._subject(movement, "movement_submitted"), "陈明 调拨 肥皂盒 · A01 → B02"
				)
				lines.append(
					frappe._dict(
						s_warehouse="SRC",
						t_warehouse="DST",
						item_code="ITEM-2",
						item_name="一次性口罩 10个(1包) JIAYI Disposable mask",
					)
				)
				self.assertEqual(
					notifications._subject(movement, "movement_submitted"),
					"陈明 调拨 肥皂盒 等 2 种物品 · A01 → B02",
				)
				lines.reverse()
				self.assertEqual(
					notifications._subject(movement, "movement_submitted"),
					"陈明 调拨 一次性口罩 10个(1包) JIAYI Dis… 等 2 种物品 · A01 → B02",
				)
		movement.amended_from = None
		with patch.object(frappe.db, "get_value", return_value=actor_name):
			self.assertEqual(
				notifications._subject(movement, "movement_cancelled"), "陈明 撤销了调拨 STE-test"
			)
		count = frappe._dict(
			doctype="Stock Reconciliation",
			items=[
				frappe._dict(current_qty=2, qty=3),
				frappe._dict(current_qty=5, qty=5),
				frappe._dict(current_qty=0, qty=1),
			],
		)
		with patch.object(frappe.db, "get_value", return_value=actor_name):
			self.assertEqual(
				notifications._subject(count, "count_adjustment"), "陈明 提交盘点调整 · 2 处差异"
			)

	def test_primary_location_uses_presenter_label_not_warehouse_name(self):
		doc = frappe._dict(items=[frappe._dict(s_warehouse="SRC", t_warehouse="DST")])
		visible = {"SRC": frappe._dict(), "DST": frappe._dict()}
		settings = frappe._dict(physical_root_warehouse="ROOT")
		with (
			patch(
				"temple_inventory.native_stock.warehouse_scopes",
				return_value=(settings, visible, set(), set(), set()),
			),
			patch(
				"temple_inventory.native_topology.present_locations",
				return_value=[{"name": "SRC", "label": "A01"}, {"name": "DST", "label": "B02"}],
			),
		):
			self.assertEqual(notifications._primary_location(doc, "Transfer"), "A01 → B02")

	def test_read_notifications_do_not_push_and_badge_count_is_app_scoped(self):
		log = frappe._dict(
			name="NL-read",
			type="导出完成",
			subject="导出完成",
			link="/inventory",
			for_user="manager@example.com",
			read=1,
		)
		with patch.object(frappe, "get_doc", return_value=log), patch.object(frappe, "enqueue") as enqueue:
			push.send_notification("NL-read")
		enqueue.assert_not_called()

	def test_inbox_export_unavailable_comes_from_request_output_file(self):
		row = frappe._dict(
			name="NL-export",
			type="导出完成",
			document_type="Inventory Export Request",
			document_name="EXP-test",
		)
		with (
			patch.object(notifications, "require_app"),
			patch.object(frappe, "get_all", return_value=[row]) as get_all,
			patch.object(frappe.db, "get_value", return_value="FILE-test"),
			patch.object(frappe.db, "exists", return_value=True),
			patch.object(frappe.db, "count", return_value=0),
		):
			result = notifications.inbox()
		self.assertFalse(result["items"][0].unavailable)
		self.assertEqual(get_all.call_args.kwargs["filters"]["for_user"], frappe.session.user)
		with (
			patch.object(notifications, "require_app"),
			patch.object(frappe, "get_all", return_value=[row]),
			patch.object(frappe.db, "get_value", return_value=None),
			patch.object(frappe.db, "exists", return_value=False),
			patch.object(frappe.db, "count", return_value=0),
		):
			result = notifications.inbox()
		self.assertTrue(result["items"][0].unavailable)

	def test_inbox_type_filter_is_app_scoped_and_validated(self):
		row = frappe._dict(name="NL-expiry", type="效期提醒", document_type="", document_name="")
		with (
			patch.object(notifications, "require_app"),
			patch.object(notifications, "unread_count", return_value=1),
			patch.object(frappe, "get_all", return_value=[row]) as get_all,
			patch.object(frappe.db, "exists", return_value=False),
		):
			result = notifications.inbox(notification_type="效期提醒")
		self.assertEqual(result["items"][0].type, "效期提醒")
		self.assertEqual(get_all.call_args.kwargs["filters"]["type"], "效期提醒")
		with patch.object(notifications, "require_app"), self.assertRaises(frappe.ValidationError):
			notifications.inbox(notification_type="其他应用通知")

	def test_inbox_type_choices_only_include_enabled_app_notification_types(self):
		with (
			patch.object(notifications, "require_app"),
			patch.object(frappe, "get_all", return_value=[frappe._dict(type_name="库存流动")]),
		):
			self.assertEqual(notifications.inbox_types(), [{"value": "库存流动", "label": "库存流动"}])

	def test_export_sheet_names_are_valid_for_every_table(self):
		import io

		import xlsxwriter

		from temple_inventory import exports
		from temple_inventory.projections import TABLE_LABELS

		workbook = xlsxwriter.Workbook(io.BytesIO(), {"in_memory": True})
		for table in TABLE_LABELS:
			for part in (1, 2):
				workbook.add_worksheet(exports._sheet_name(table, part))
		workbook.close()

	def test_document_event_job_kwargs_survive_frappe_enqueue(self):
		# frappe.enqueue consumes its own parameters (e.g. `event`); every kwarg the
		# job needs must reach it unchanged.
		import inspect

		from frappe.utils.background_jobs import enqueue

		reserved = set(inspect.signature(enqueue).parameters) - {"kwargs"}
		job = set(inspect.signature(notifications.deliver_document_event).parameters)
		self.assertFalse(job & reserved)

	def test_full_job_queue_never_blocks_a_stock_submission(self):
		def overloaded(*args, **kwargs):
			raise frappe.QueueOverloaded("Too many queued background jobs")

		with (
			patch.object(frappe, "enqueue", side_effect=overloaded),
			patch.object(frappe, "log_error") as log,
		):
			doc = self.receipt(2)
		self.assertEqual(frappe.db.get_value("Stock Entry", doc.name, "docstatus"), 1)
		log.assert_called()

	def test_seeding_flag_suppresses_notification_jobs(self):
		frappe.flags.ti_suppress_notifications = True
		try:
			with patch.object(frappe, "enqueue") as enqueue:
				self.receipt(1)
		finally:
			frappe.flags.ti_suppress_notifications = False
		enqueue.assert_not_called()

	def test_fresh_install_registers_notification_types(self):
		hooks = frappe.get_hooks("after_install", app_name="temple_inventory")
		self.assertIn("temple_inventory.deployment.after_install", hooks)
		for type_name in notifications.TYPES:
			self.assertTrue(frappe.db.exists("Notification Type", type_name))

	def test_export_notification_failure_never_changes_export_outcome(self):
		request = SimpleNamespace(name="missing", status="Failed", owner="Administrator")
		with (
			patch.object(notifications, "_export_result", side_effect=frappe.ValidationError("boom")),
			patch.object(frappe, "log_error") as log,
		):
			notifications.export_result(request)
		log.assert_called()
