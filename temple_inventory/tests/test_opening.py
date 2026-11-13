"""Opening Stock is a native Stock Reconciliation with opening-only write rules."""

from unittest.mock import patch
from uuid import uuid4

import frappe

from temple_inventory import native_api
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class OpeningStockTests(NativeDocumentTests):
	def test_future_opening_keeps_the_existing_validation_message(self):
		from datetime import timedelta

		future = frappe.utils.now_datetime() + timedelta(minutes=5)
		data = self.opening_values()
		data.update(posting_date=future.date(), posting_time=future.strftime("%H:%M:%S"))
		with self.assertRaisesRegex(frappe.ValidationError, "期初日期和时间不能晚于当前时间。"):
			native_api.create_document("Stock Reconciliation", str(uuid4()), data)

	def _user(self, role):
		email = f"ti-opening-{self.token}-{role.lower().replace(' ', '-')}@example.test"
		return (
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": "Opening Test",
					"user_type": "System User",
					"send_welcome_email": 0,
					"roles": [{"role": role}],
				}
			)
			.insert(ignore_permissions=True)
			.name
		)

	def opening_values(self, **line):
		now = frappe.utils.now_datetime()
		return {
			"company": self.company,
			"purpose": "Opening Stock",
			"posting_date": now.date(),
			"posting_time": now.time().strftime("%H:%M:%S"),
			"items": [
				{
					"item_code": self.item,
					"warehouse": self.a,
					"qty": 3,
					"valuation_rate": 10,
					**line,
				}
			],
		}

	def test_create_save_submit_and_expense_account_is_server_selected(self):
		account = frappe.db.get_value(
			"Account",
			{"company": self.company, "account_type": "Temporary", "is_group": 0},
			"name",
		)
		self.assertTrue(account, "test company needs an ERPNext Temporary account")
		created = native_api.create_document(
			"Stock Reconciliation", str(uuid4()), self.opening_values(expense_account="forged")
		)
		self.assertEqual(created["kind"], "Opening")
		self.assertTrue(created["editable"])
		doc = frappe.get_doc("Stock Reconciliation", created["identity"]["name"])
		self.assertEqual(doc.expense_account, account)
		self.assertEqual(doc.items[0].valuation_rate, 10)
		save_values = self.opening_values(valuation_rate=11)
		save_values["items"][0]["name"] = doc.items[0].name
		saved = native_api.save_document("Stock Reconciliation", doc.name, created["version"], save_values)
		submitted = native_api.submit_document("Stock Reconciliation", doc.name, saved["version"])
		self.assertEqual(submitted["docstatus"], 1)
		self.assertTrue(submitted["actions"]["cancel"])
		with self.assertRaises(frappe.ValidationError):
			native_api.create_document("Stock Reconciliation", str(uuid4()), self.opening_values())
		gl_entries = frappe.get_all(
			"GL Entry",
			filters={"voucher_type": "Stock Reconciliation", "voucher_no": doc.name, "is_cancelled": 0},
			fields=["account", "debit", "credit"],
		)
		if gl_entries:
			self.assertAlmostEqual(
				sum(row.debit for row in gl_entries), sum(row.credit for row in gl_entries)
			)
			self.assertIn(account, {row.account for row in gl_entries})

	def test_submit_keeps_the_declared_posting_time(self):
		values = self.opening_values()
		values["posting_time"] = "00:00:01"
		draft = native_api.create_document("Stock Reconciliation", str(uuid4()), values)
		self.assertEqual(draft["ti_time_mode"], "Historical")
		submitted = native_api.submit_document("Stock Reconciliation", draft["name"], draft["version"])
		self.assertEqual(submitted["docstatus"], 1)
		self.assertEqual(str(submitted["posting_date"]), str(values["posting_date"]))
		self.assertTrue(str(submitted["posting_time"]).startswith("0:00:01"), submitted["posting_time"])

	def test_opening_fields_are_not_added_to_ordinary_count_allowlist(self):
		doc = frappe.new_doc("Stock Reconciliation")
		doc.company = self.company
		doc.purpose = "Stock Reconciliation"
		row = doc.append("items", {"item_code": self.item, "warehouse": self.a, "qty": 1})
		native_api._apply_lines(
			doc,
			[
				{
					"name": row.name,
					"item_code": self.item,
					"warehouse": self.a,
					"qty": 1,
					"valuation_rate": 99,
					"serial_no": "forged",
					"allow_zero_valuation_rate": 1,
				}
			],
		)
		self.assertFalse(row.get("valuation_rate"))
		self.assertFalse(row.get("serial_no"))
		self.assertFalse(row.get("allow_zero_valuation_rate"))

	def test_opening_validation_preserves_a_desk_selected_difference_account(self):
		from temple_inventory.opening import validate_opening

		account = frappe.db.get_value(
			"Account", {"company": self.company, "account_type": "Temporary", "is_group": 0}, "name"
		)
		doc = frappe.new_doc("Stock Reconciliation")
		doc.company = self.company
		doc.purpose = "Opening Stock"
		doc.expense_account = account
		doc.append("items", {"item_code": self.item, "warehouse": self.a, "qty": 1, "valuation_rate": 10})
		with patch(
			"erpnext.stock.doctype.stock_reconciliation.stock_reconciliation.get_difference_account"
		) as get_account:
			validate_opening(doc)
		get_account.assert_not_called()
		profit_and_loss = frappe.db.get_value(
			"Account",
			{"company": self.company, "report_type": "Profit and Loss", "is_group": 0},
			"name",
		)
		self.assertTrue(profit_and_loss, "test company needs a P&L account")
		doc.expense_account = profit_and_loss
		from erpnext.stock.doctype.stock_reconciliation.stock_reconciliation import (
			OpeningEntryAccountError,
		)

		with (
			patch("erpnext.is_perpetual_inventory_enabled", return_value=True),
			self.assertRaises(OpeningEntryAccountError),
		):
			doc.validate_expense_account()

	def test_ordinary_reconciliation_api_cannot_set_valuation_rate(self):
		created = native_api.create_document(
			"Stock Reconciliation",
			str(uuid4()),
			{
				"company": self.company,
				"items": [{"item_code": self.item, "warehouse": self.a, "qty": 1, "valuation_rate": 999}],
			},
		)
		row = frappe.get_doc("Stock Reconciliation", created["identity"]["name"]).items[0]
		self.assertNotEqual(row.valuation_rate, 999)

	def test_save_count_discards_client_purpose(self):
		from temple_inventory import counts

		data = {
			"company": self.company,
			"posting_date": frappe.utils.nowdate(),
			"posting_time": frappe.utils.nowtime(),
			"purpose": "Opening Stock",
			"ti_count_review": [],
		}
		difference = {
			"item_code": self.item,
			"warehouse": self.a,
			"batch_no": "",
			"qty": 2,
			"serials": [],
		}
		with (
			patch("temple_inventory.counts._lock_count_locations"),
			patch("temple_inventory.counts._baseline", return_value={"rows": []}),
			patch("temple_inventory.counts._differences", return_value=[difference]),
			patch(
				"temple_inventory.native_api.create_document", return_value={"kind": "Reconcile"}
			) as create,
		):
			result = counts.save_count(str(uuid4()), data)
		self.assertEqual(result["kind"], "Reconcile")
		self.assertNotIn("purpose", create.call_args.args[2])

	def test_opening_submit_rejects_loan_and_damaged_locations(self):
		for warehouse in (self.loan_leaf, self.damaged):
			with (
				self.subTest(warehouse=warehouse),
				self.assertRaisesRegex(frappe.ValidationError, "实体末级位置"),
			):
				doc = frappe.new_doc("Stock Reconciliation")
				doc.company = self.company
				doc.purpose = "Opening Stock"
				doc.append("items", {"item_code": self.item, "warehouse": warehouse, "qty": 1})
				from temple_inventory.opening import validate_opening

				validate_opening(doc)

	def test_missing_temporary_account_has_a_clear_setup_message(self):
		from temple_inventory.opening import set_difference_account

		doc = frappe.new_doc("Stock Reconciliation")
		doc.company = self.company
		with (
			patch(
				"erpnext.stock.doctype.stock_reconciliation.stock_reconciliation.get_difference_account",
				return_value=None,
			),
			self.assertRaisesRegex(frappe.ValidationError, "ERPNext.*Temporary.*科目"),
		):
			set_difference_account(doc)

	def test_queued_submit_persists_confirmation_and_posting_values_before_native_submit(self):
		doc = frappe._dict(
			doctype="Stock Reconciliation",
			name="SR-OPEN-QUEUE-TEST",
			docstatus=0,
			purpose="Opening Stock",
			items=[{} for _ in range(101)],
			posting_date="2026-11-07",
			posting_time="10:00:00",
			set_posting_time=1,
			modified="version-1",
			flags=frappe._dict(),
		)
		doc.check_permission = lambda _permission: None
		with (
			patch("temple_inventory.native_api._enqueue_queued_action") as enqueue_action,
			patch.object(frappe, "get_doc", return_value=doc),
			patch("temple_inventory.native_api.check_document_scope"),
			patch("temple_inventory.native_api.check_version"),
			patch("temple_inventory.native_api.serialize", return_value={"queued": True}),
			patch.object(frappe.db, "set_value") as set_value,
		):
			result = native_api.submit_document("Stock Reconciliation", doc.name, "version-1")
		self.assertTrue(result["queued"])
		# The app queues its own retrying job; the values must be persisted before it runs.
		enqueue_action.assert_called_once_with(doc, "submit", frappe.session.user)
		set_value.assert_called_once_with(
			"Stock Reconciliation",
			doc.name,
			{
				"ti_confirmation_version": "version-1",
				"posting_date": doc.posting_date,
				"posting_time": doc.posting_time,
				"set_posting_time": 1,
			},
			update_modified=False,
		)

	def test_serialization_returns_queue_state_and_plain_text_queue_error(self):
		doc = frappe._dict(
			doctype="Stock Reconciliation",
			name="SR-OPEN-QUEUE-ERROR",
			purpose="Opening Stock",
			docstatus=0,
			modified="version-1",
			items=[{} for _ in range(101)],
			ti_count_review=[],
		)
		doc.as_dict = lambda: {
			"doctype": doc.doctype,
			"name": doc.name,
			"purpose": doc.purpose,
			"docstatus": doc.docstatus,
			"items": list(doc.get("items")),
			"ti_count_review": [],
		}
		doc.check_permission = lambda _permission: None
		doc.has_permission = lambda _permission: True
		doc.is_locked = True
		with (
			patch("temple_inventory.native_api.check_document_scope"),
			patch("temple_inventory.catalog.item_display_summaries", return_value={}),
			patch.object(frappe, "has_permission", return_value=True),
			patch.object(
				frappe,
				"get_all",
				return_value=[
					frappe._dict(
						content=f"{frappe._('Action Failed')}<br><br><p>Worker failed: &lt;safe&gt;</p>"
					)
				],
			) as get_all,
		):
			result = native_api.serialize(doc)
		self.assertTrue(result["queued"])
		self.assertNotIn("<", result["queue_error"])
		self.assertIn("Worker failed", result["queue_error"])
		comment_queries = [entry for entry in get_all.call_args_list if entry.args[0] == "Comment"]
		self.assertEqual(len(comment_queries), 1)
		self.assertEqual(comment_queries[0].kwargs["filters"]["reference_doctype"], "Stock Reconciliation")

	def test_serialization_does_not_surface_ordinary_comments_or_query_other_doctypes(self):
		for doctype, row_count, expected_queries in (
			("Stock Reconciliation", 101, 1),
			("Stock Entry", 101, 0),
			("Stock Reconciliation", 100, 0),
		):
			doc = frappe._dict(
				doctype=doctype,
				name="NATIVE-QUEUE-COMMENT-TEST",
				purpose="Opening Stock" if doctype == "Stock Reconciliation" else "Material Receipt",
				docstatus=0,
				modified="version-1",
				items=[{} for _ in range(row_count)],
				ti_count_review=[],
			)
			doc.as_dict = lambda: {"items": list(doc.get("items")), "ti_count_review": []}
			doc.check_permission = lambda _permission: None
			doc.has_permission = lambda _permission: True
			with (
				patch("temple_inventory.native_api.check_document_scope"),
				patch("temple_inventory.catalog.item_display_summaries", return_value={}),
				patch.object(frappe, "has_permission", return_value=True),
				patch.object(frappe, "get_all", return_value=[frappe._dict(content="Desk note")]) as get_all,
			):
				result = native_api.serialize(doc)
			self.assertEqual(result["queue_error"], "")
			comment_queries = [entry for entry in get_all.call_args_list if entry.args[0] == "Comment"]
			self.assertEqual(len(comment_queries), expected_queries)

	def test_operator_and_viewer_cannot_create_or_write_opening_reconciliations(self):
		opening = native_api.create_document("Stock Reconciliation", str(uuid4()), self.opening_values())
		name = opening["identity"]["name"]
		for role in ("Inventory Operator", "Inventory Viewer"):
			frappe.set_user(self._user(role))
			with self.subTest(role=role), self.assertRaises(frappe.PermissionError):
				native_api.create_document("Stock Reconciliation", str(uuid4()), self.opening_values())
			with self.subTest(role=role), self.assertRaises(frappe.PermissionError):
				frappe.get_doc("Stock Reconciliation", name).check_permission("write")
		frappe.set_user("Administrator")

	def test_active_ledger_at_any_time_blocks_but_cancelled_ledger_and_other_location_do_not(self):
		self.receipt(2)
		historical = self.opening_values()
		historical["posting_date"] = frappe.utils.add_days(frappe.utils.nowdate(), -1)
		historical["posting_time"] = "00:00:00"
		with self.assertRaisesRegex(frappe.ValidationError, "库存流水"):
			native_api.create_document("Stock Reconciliation", str(uuid4()), historical)
		other = self.opening_values()
		other["items"][0]["warehouse"] = self.b
		created = native_api.create_document("Stock Reconciliation", str(uuid4()), other)
		self.assertTrue(created["editable"])
		fresh_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-CANCEL-{self.token}",
				"item_name": "Opening cancelled ledger test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		movement_values = self.movement(quantity=1)
		movement_values["items"][0]["item_code"] = fresh_item.name
		movement_values["items"][0]["t_warehouse"] = self.b
		movement = self.submit(self.create(movement_values))
		native_api.cancel_document("Stock Entry", movement.name, movement.version)
		cancelled_pair = self.opening_values(item_code=fresh_item.name)
		cancelled_pair["items"][0]["warehouse"] = self.b
		self.assertTrue(
			native_api.create_document("Stock Reconciliation", str(uuid4()), cancelled_pair)["editable"]
		)

	def test_draft_pair_is_allowed_on_save_and_conflicts_at_submit(self):
		first = native_api.create_document("Stock Reconciliation", str(uuid4()), self.opening_values())
		second = native_api.create_document("Stock Reconciliation", str(uuid4()), self.opening_values())
		with self.assertRaisesRegex(frappe.ValidationError, "期初库存占用"):
			native_api.submit_document("Stock Reconciliation", first["name"], first["version"])
		native_api.delete_document("Stock Reconciliation", second["name"], second["version"])
		submitted = native_api.submit_document("Stock Reconciliation", first["name"], first["version"])
		self.assertEqual(submitted["docstatus"], 1)

	def test_opening_create_and_submit_through_desk_validation(self):
		doc = frappe.new_doc("Stock Reconciliation")
		doc.company = self.company
		doc.purpose = "Opening Stock"
		doc.posting_date = frappe.utils.nowdate()
		doc.posting_time = frappe.utils.now_datetime().time().strftime("%H:%M:%S")
		doc.append("items", {"item_code": self.item, "warehouse": self.a, "qty": 2, "valuation_rate": 4})
		doc.insert()
		self.assertEqual(doc.purpose, "Opening Stock")
		self.assertEqual(
			doc.expense_account,
			frappe.db.get_value(
				"Account", {"company": self.company, "account_type": "Temporary", "is_group": 0}, "name"
			),
		)
		doc.submit()
		self.assertEqual(doc.docstatus, 1)

	def test_batch_and_serial_allocations_survive_cancel_then_amend(self):
		from temple_inventory.catalog import create_batch

		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		batch_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-BATCH-{self.token}",
				"item_name": "Opening batch test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_batch_no": 1,
			}
		).insert()
		batch = create_batch(batch_item.name, f"OPEN-BATCH-{self.token}")
		batch_values = self.opening_values(
			item_code=batch_item.name, batch_no=batch["name"], use_serial_batch_fields=1
		)
		batch_draft = native_api.create_document("Stock Reconciliation", str(uuid4()), batch_values)
		batch_submitted = native_api.submit_document(
			"Stock Reconciliation", batch_draft["name"], batch_draft["version"]
		)
		batch_cancelled = native_api.cancel_document(
			"Stock Reconciliation", batch_draft["name"], batch_submitted["version"]
		)
		batch_amended = native_api.amend_document(
			"Stock Reconciliation", batch_draft["name"], batch_cancelled["version"], str(uuid4())
		)
		self.assertEqual(
			frappe.get_doc("Stock Reconciliation", batch_amended["name"]).items[0].batch_no, batch["name"]
		)

		serial = f"OPEN-SERIAL-{self.token}"
		serial_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-SERIAL-{self.token}",
				"item_name": "Opening serial test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_serial_no": 1,
				"serial_no_series": f"{self.token}-.####",
			}
		).insert()
		serial_values = self.opening_values(
			item_code=serial_item.name, serial_no=serial, qty=1, use_serial_batch_fields=1
		)
		serial_draft = native_api.create_document("Stock Reconciliation", str(uuid4()), serial_values)
		serial_submitted = native_api.submit_document(
			"Stock Reconciliation", serial_draft["name"], serial_draft["version"]
		)
		self.assertTrue(frappe.db.exists("Serial No", {"serial_no": serial, "item_code": serial_item.name}))
		serial_cancelled = native_api.cancel_document(
			"Stock Reconciliation", serial_draft["name"], serial_submitted["version"]
		)
		serial_amended = native_api.amend_document(
			"Stock Reconciliation", serial_draft["name"], serial_cancelled["version"], str(uuid4())
		)
		self.assertEqual(
			frappe.get_doc("Stock Reconciliation", serial_amended["name"]).items[0].serial_no, serial
		)

	def test_blank_unvalued_donation_uses_native_zero_rate_allowance_and_invalid_values_fail(self):
		with patch("erpnext.stock.utils.get_stock_balance", return_value=(0, 12)):
			explicit_zero = native_api.create_document(
				"Stock Reconciliation", str(uuid4()), self.opening_values(valuation_rate=0)
			)
		self.assertEqual(
			frappe.get_doc("Stock Reconciliation", explicit_zero["name"]).items[0].valuation_rate,
			12,
		)
		unvalued = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-ZERO-{self.token}",
				"item_name": "Opening donated test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"valuation_rate": 0,
			}
		).insert()
		draft = native_api.create_document(
			"Stock Reconciliation",
			str(uuid4()),
			self.opening_values(item_code=unvalued.name, valuation_rate=None),
		)
		doc = frappe.get_doc("Stock Reconciliation", draft["name"])
		self.assertEqual(doc.items[0].allow_zero_valuation_rate, 1)
		save_values = self.opening_values(item_code=unvalued.name, valuation_rate=0)
		save_values["items"][0]["name"] = doc.items[0].name
		saved = native_api.save_document(
			"Stock Reconciliation",
			doc.name,
			draft["version"],
			save_values,
		)
		self.assertEqual(
			frappe.get_doc("Stock Reconciliation", doc.name).items[0].allow_zero_valuation_rate, 1
		)
		submitted = native_api.submit_document("Stock Reconciliation", doc.name, saved["version"])
		self.assertEqual(submitted["items"][0]["allow_zero_valuation_rate"], 1)
		for invalid in ({"qty": 0}, {"qty": -1}, {"valuation_rate": -1}):
			with self.subTest(invalid=invalid), self.assertRaises(frappe.ValidationError):
				native_api.create_document(
					"Stock Reconciliation", str(uuid4()), self.opening_values(**invalid)
				)

	def test_tracked_items_require_native_batch_or_serial_details(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		batch_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-TRACK-B-{self.token}",
				"item_name": "Opening tracked batch test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_batch_no": 1,
			}
		).insert()
		serial_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-TRACK-S-{self.token}",
				"item_name": "Opening tracked serial test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_serial_no": 1,
				"serial_no_series": f"{self.token}-.####",
			}
		).insert()
		for item, message in ((batch_item, "必须指定已存在的批次"), (serial_item, "必须录入序列号")):
			with self.subTest(item=item.name), self.assertRaisesRegex(frappe.ValidationError, message):
				native_api.create_document(
					"Stock Reconciliation", str(uuid4()), self.opening_values(item_code=item.name)
				)

	def test_ensure_batch_is_idempotent_and_rejects_conflicts(self):
		from temple_inventory import opening

		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch_id = f"OPEN-ENSURE-{self.token}"
		created = opening.ensure_batch(item.name, batch_id, "2026-01-01", "2026-12-31")
		self.assertEqual(opening.ensure_batch(item.name, batch_id)["name"], created["name"])
		with self.assertRaisesRegex(frappe.ValidationError, "日期"):
			opening.ensure_batch(item.name, batch_id, expiry_date="2027-12-31")
		other_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-OTHER-BATCH-{self.token}",
				"item_name": "Opening other batch item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_batch_no": 1,
			}
		).insert()
		with self.assertRaisesRegex(frappe.ValidationError, "属于物品"):
			opening.ensure_batch(other_item.name, batch_id)
		frappe.db.set_value("Batch", batch_id, "disabled", 1)
		with self.assertRaisesRegex(frappe.ValidationError, "已停用"):
			opening.ensure_batch(item.name, batch_id)

	def test_serial_conflicts_name_owner_and_presenter_location_but_duplicates_are_refused(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		serial_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPEN-SERIAL-CONFLICT-{self.token}",
				"item_name": "Opening serial conflict test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_serial_no": 1,
				"serial_no_series": f"{self.token}-CONFLICT-.####",
			}
		).insert()
		serial = f"TI-OPEN-USED-{self.token}"
		original_get_all = frappe.get_all
		with (
			patch(
				"temple_inventory.opening.frappe.get_all",
				side_effect=lambda doctype, **kwargs: (
					[frappe._dict(name=serial, item_code=serial_item.name, warehouse=self.a)]
					if doctype == "Serial No"
					else original_get_all(doctype, **kwargs)
				),
			),
			self.assertRaisesRegex(frappe.ValidationError, "序列号.*物品.*位置"),
		):
			native_api.create_document(
				"Stock Reconciliation",
				str(uuid4()),
				self.opening_values(item_code=serial_item.name, serial_no=serial, qty=1),
			)
		with (
			patch(
				"temple_inventory.opening.frappe.get_all",
				side_effect=lambda doctype, **kwargs: (
					[frappe._dict(name=serial, item_code=self.item, warehouse=None)]
					if doctype == "Serial No"
					else original_get_all(doctype, **kwargs)
				),
			),
			self.assertRaisesRegex(frappe.ValidationError, "序列号.*物品.*位置"),
		):
			native_api.create_document(
				"Stock Reconciliation",
				str(uuid4()),
				self.opening_values(item_code=serial_item.name, serial_no=serial, qty=1),
			)
		duplicate_values = self.opening_values(
			item_code=serial_item.name, serial_no=f"{serial}-DUP\n{serial}-DUP", qty=2
		)
		with self.assertRaisesRegex(frappe.ValidationError, "序列号.*位置"):
			native_api.create_document("Stock Reconciliation", str(uuid4()), duplicate_values)
