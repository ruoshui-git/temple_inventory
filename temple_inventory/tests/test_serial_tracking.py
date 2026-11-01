"""ERPNext 16.50 serial behavior found by the tests below (stock settings restored by rollback):

1. Receipt with explicit serial text creates Active Serial No rows in the target warehouse and an inward bundle; no error.
2. Receipt without text auto-generates two TSER serials when a series exists; without one submit raises ValidationError: "Serial and Batch Bundle not set for item {item} in warehouse {warehouse}. If you want auto pick serial bundle, then kindly set Serial No Series in Item {item}".
3. Reusing a serial for its original item raises ValidationError: "Serial No <strong>{serial}</strong> is already present in the warehouse <strong>{warehouse}</strong>."; using it for another item raises ValidationError: "Serial Nos <strong>{serial}</strong> does not belong to Item <strong>{item}</strong>".
4. Transfer keeps serial Active and moves its warehouse; Issue sets status Consumed and clears warehouse; wrong source raises ValidationError: "You cannot outward following Serial No as either they are Delivered, Inactive or located in a different warehouse.<hr>{serial}".
5. Quantity-only outward auto-picks the earliest received serials (FIFO under current settings); selected serials become Consumed; no error when a series is configured.
6. Cancelling transfer restores Active/source warehouse; cancelling receipt leaves the serial Inactive and stock zero; no error.
7. Reconciliation to a serial subset sets stock to the subset and marks omitted serial Delivered (warehouse cleared); no error.
8. Zero reconciliation with use_serial_batch_fields=1 fails on insert with ValidationError: "['Row #1: Please enter Serial No']"; with fields off it still fails on insert: "Row # 1: Please add Serial and Batch Bundle for Item <strong>{item}</strong>".
9. Reconciliation listing a serial in another warehouse raises ValidationError: "Serial No <strong>{serial}</strong> is already present in the warehouse <strong>{warehouse}</strong>."; its warehouse is unchanged.
10. Stock balance, Bin, and summed non-cancelled Stock Ledger quantities agree after receipt, transfer, and issue; no error.
11. ERPNext accepts an Item with both has_serial_no=1 and has_batch_no=1; no error.

Loans (native settlement behavior): a submitted loan line owns its serial set;
settlements can consume only that line's currently outstanding serials, and
cancelling a settlement restores those serials to the outstanding set.
"""

from datetime import timedelta
from unittest.mock import patch

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import get_datetime, now_datetime, nowdate

from temple_inventory import catalog, counts, native_api
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class SerialTrackingTests(NativeDocumentTests):
	def serial_item(self, *, series=None, batch=False):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-SERIAL-{self.token}-{frappe.generate_hash(length=4)}",
				"item_name": "Native serial test item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_serial_no": 1,
				"has_batch_no": int(batch),
				"serial_no_series": series,
			}
		).insert()
		return item

	def serial_entry(self, item, purpose, qty, *, source=None, target=None, serials=None):
		row = {
			"item_code": item.name,
			"qty": qty,
			"uom": "Nos",
			"conversion_factor": 1,
			"s_warehouse": source,
			"t_warehouse": target,
			"basic_rate": 10,
			"use_serial_batch_fields": 1,
		}
		if serials is not None:
			row["serial_no"] = "\n".join(serials)
		return frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"company": self.company,
				"posting_date": nowdate(),
				"posting_time": now_datetime().time(),
				"set_posting_time": 1,
				"purpose": purpose,
				"stock_entry_type": purpose,
				"ti_movement_kind": "",
				"items": [row],
			}
		)

	def reconcile(self, item, warehouse, qty, serials, *, use_fields=1):
		return frappe.get_doc(
			{
				"doctype": "Stock Reconciliation",
				"company": self.company,
				"purpose": "Stock Reconciliation",
				"posting_date": nowdate(),
				"posting_time": now_datetime().time(),
				"set_posting_time": 1,
				"items": [
					{
						"item_code": item.name,
						"warehouse": warehouse,
						"qty": qty,
						"valuation_rate": 10,
						"serial_no": "\n".join(serials),
						"use_serial_batch_fields": use_fields,
					}
				],
			}
		)

	def native_serial_entry(
		self,
		item,
		kind,
		quantity,
		*,
		source="",
		target="",
		serials=None,
		uom="Nos",
		posting_time=None,
	):
		data = {
			"company": self.company,
			"posting_date": nowdate(),
			"posting_time": posting_time or now_datetime().time().strftime("%H:%M:%S"),
			"ti_time_mode": "Manual",
			"ti_movement_kind": kind,
			"ti_borrower": "序列号测试借用方" if kind == "Loan" else "",
			"items": [
				{
					"item_code": item.name,
					"qty": quantity,
					"uom": uom,
					"conversion_factor": 1,
					"s_warehouse": source or None,
					"t_warehouse": target or None,
					"basic_rate": 10,
					"serial_no": "\n".join(serials or []),
					"use_serial_batch_fields": 1,
				}
			],
		}
		return native_api.create_document(
			"Stock Entry", f"serial-native:{self.token}:{frappe.generate_hash(length=6)}", data
		)

	def test_receipt_with_explicit_serials_creates_active_serials_and_inward_bundle(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-A", f"TSN-{self.token}-B"]
		doc = self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert()
		doc.submit()
		self.assertEqual(get_stock_balance(item.name, self.a), 2)
		self.assertEqual(
			frappe.db.get_value("Stock Entry Detail", doc.items[0].name, "use_serial_batch_fields"), 1
		)
		self.assertTrue(doc.items[0].serial_and_batch_bundle)
		for serial in serials:
			self.assertEqual(
				frappe.db.get_value("Serial No", serial, ["status", "warehouse", "item_code"]),
				("Active", self.a, item.name),
			)

	def test_receipt_without_serial_text_generates_from_series_or_errors_without_series(self):
		item = self.serial_item(series="TSER-.####")
		doc = self.serial_entry(item, "Material Receipt", 2, target=self.a).insert()
		doc.submit()
		generated = frappe.get_all("Serial No", filters={"item_code": item.name}, pluck="name")
		self.assertEqual(len(generated), 2)
		self.assertTrue(all(name.startswith("TSER-") for name in generated))
		self.assertEqual(get_stock_balance(item.name, self.a), 2)
		without_series = self.serial_item()
		bad = self.serial_entry(without_series, "Material Receipt", 1, target=self.a).insert()
		with self.assertRaises(frappe.ValidationError) as error:
			bad.submit()
		self.assertIn("If you want auto pick serial bundle", str(error.exception))

	def test_existing_serial_is_rejected_globally_for_same_and_other_item(self):
		first = self.serial_item()
		second = self.serial_item()
		serial = f"TSN-{self.token}-DUP"
		self.serial_entry(first, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		for index, item in enumerate((first, second)):
			bad = self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert()
			with self.assertRaises(frappe.ValidationError) as error:
				bad.submit()
			if index == 0:
				self.assertIn(f"Serial No <strong>{serial}</strong> is already present", str(error.exception))
			else:
				self.assertEqual(
					str(error.exception),
					f"Serial Nos <strong>{serial}</strong> does not belong to Item "
					f"<strong>{second.name}</strong>",
				)

	def test_transfer_and_issue_update_serial_state_and_wrong_source_errors(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-MOVE"
		self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		transfer = self.serial_entry(
			item, "Material Transfer", 1, source=self.a, target=self.b, serials=[serial]
		).insert()
		transfer.submit()
		self.assertEqual(get_stock_balance(item.name, self.a), 0)
		self.assertEqual(get_stock_balance(item.name, self.b), 1)
		self.assertEqual(
			frappe.db.get_value("Serial No", serial, ["status", "warehouse"]), ("Active", self.b)
		)
		bad = self.serial_entry(item, "Material Issue", 1, source=self.a, serials=[serial]).insert()
		with self.assertRaises(frappe.ValidationError) as error:
			bad.submit()
		self.assertEqual(
			str(error.exception),
			f"You cannot outward following Serial No as either they are Delivered, Inactive or located in a "
			f"different warehouse.<hr>{serial}",
		)
		issue = self.serial_entry(item, "Material Issue", 1, source=self.b, serials=[serial]).insert()
		issue.submit()
		self.assertEqual(get_stock_balance(item.name, self.b), 0)
		self.assertEqual(frappe.db.get_value("Serial No", serial, "status"), "Consumed")

	def test_outward_without_serial_text_automatically_selects_available_serial(self):
		item = self.serial_item(series="TSER-.####")
		serials = [f"TSN-{self.token}-FIFO-{i}" for i in range(1, 4)]
		self.serial_entry(item, "Material Receipt", 3, target=self.a, serials=serials).insert().submit()
		doc = self.serial_entry(item, "Material Issue", 2, source=self.a).insert()
		doc.submit()
		serial_states = {name: frappe.db.get_value("Serial No", name, "status") for name in serials}
		picked = [name for name in serials if serial_states[name] == "Consumed"]
		self.assertEqual(len(picked), 2)
		self.assertEqual(picked, serials[:2])
		self.assertEqual(get_stock_balance(item.name, self.a), 1)

	def test_cancelling_receipt_and_transfer_restores_serial_state(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-CANCEL"
		receipt = self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert()
		receipt.submit()
		transfer = self.serial_entry(
			item, "Material Transfer", 1, source=self.a, target=self.b, serials=[serial]
		).insert()
		transfer.submit()
		transfer.cancel()
		self.assertEqual(
			frappe.db.get_value("Serial No", serial, ["status", "warehouse"]), ("Active", self.a)
		)
		receipt.cancel()
		self.assertEqual(get_stock_balance(item.name, self.a), 0)
		self.assertEqual(frappe.db.get_value("Serial No", serial, "status"), "Inactive")

	def test_reconciliation_to_subset_records_quantity_and_missing_serial_state(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-{i}" for i in range(1, 4)]
		self.serial_entry(item, "Material Receipt", 3, target=self.a, serials=serials).insert().submit()
		doc = self.reconcile(item, self.a, 2, serials[:2]).insert()
		doc.submit()
		self.assertEqual(get_stock_balance(item.name, self.a), 2)
		self.assertEqual(
			frappe.db.get_value("Serial No", serials[0], ["status", "warehouse"]), ("Active", self.a)
		)
		self.assertEqual(
			frappe.db.get_value("Serial No", serials[1], ["status", "warehouse"]), ("Active", self.a)
		)
		self.assertEqual(frappe.db.get_value("Serial No", serials[2], "status"), "Delivered")

	def test_zero_reconciliation_requires_serial_text_when_fields_enabled_and_auto_builds_when_disabled(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-ZERO-{i}" for i in range(1, 3)]
		self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert().submit()
		with self.assertRaises(frappe.ValidationError) as error:
			self.reconcile(item, self.a, 0, [], use_fields=1).insert()
		self.assertIn("Please enter Serial No", str(error.exception))
		with self.assertRaises(frappe.ValidationError) as auto_error:
			self.reconcile(item, self.a, 0, [], use_fields=0).insert()
		self.assertIn("Please add Serial and Batch Bundle", str(auto_error.exception))
		self.assertEqual(get_stock_balance(item.name, self.a), 2)

	def test_reconcile_all_serial_batch_captures_book_bundle_for_zero_count(self):
		"""ERPNext's native zero-count path captures the current bundle with this flag."""
		item = self.serial_item()
		serials = [f"TSN-{self.token}-ZERO-NATIVE-{index}" for index in range(2)]
		self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert().submit()
		doc = self.reconcile(item, self.a, 0, [], use_fields=0)
		doc.items[0].reconcile_all_serial_batch = 1
		doc.insert()
		doc.submit()
		self.assertEqual(get_stock_balance(item.name, self.a), 0)
		self.assertTrue(doc.items[0].current_serial_and_batch_bundle)
		self.assertEqual(
			{serial: frappe.db.get_value("Serial No", serial, "status") for serial in serials},
			{serial: "Delivered" for serial in serials},
		)

	def test_reconciliation_serial_in_another_warehouse_is_rejected_or_moved(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-OTHER-WH"
		self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		doc = self.reconcile(item, self.b, 1, [serial]).insert()
		with self.assertRaises(frappe.ValidationError) as error:
			doc.submit()
		self.assertEqual(
			str(error.exception),
			f"Serial No <strong>{serial}</strong> is already present in the warehouse "
			f"<strong>{self.a}</strong>.",
		)
		self.assertEqual(frappe.db.get_value("Serial No", serial, "warehouse"), self.a)

	def test_stock_ledger_bin_and_stock_balance_agree_after_receipt_transfer_and_issue(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-LEDGER-{i}" for i in range(1, 3)]

		def assert_stock(warehouse, expected):
			self.assertEqual(get_stock_balance(item.name, warehouse), expected)
			self.assertEqual(
				frappe.db.get_value("Bin", {"item_code": item.name, "warehouse": warehouse}, "actual_qty")
				or 0,
				expected,
			)

		receipt = self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert()
		receipt.submit()
		assert_stock(self.a, 2)
		transfer = self.serial_entry(
			item, "Material Transfer", 1, source=self.a, target=self.b, serials=[serials[0]]
		).insert()
		transfer.submit()
		assert_stock(self.a, 1)
		assert_stock(self.b, 1)
		issue = self.serial_entry(item, "Material Issue", 1, source=self.b, serials=[serials[0]]).insert()
		issue.submit()
		assert_stock(self.a, 1)
		assert_stock(self.b, 0)
		ledger = frappe.db.get_all(
			"Stock Ledger Entry",
			filters={"item_code": item.name, "is_cancelled": 0},
			fields=["warehouse", "actual_qty"],
		)
		quantities = {self.a: 0, self.b: 0}
		for entry in ledger:
			quantities[entry.warehouse] += entry.actual_qty
		self.assertEqual(quantities, {self.a: 1, self.b: 0})

	def test_erpnext_allows_item_to_have_both_serial_and_batch_tracking(self):
		item = self.serial_item(batch=True)
		self.assertEqual((item.has_serial_no, item.has_batch_no), (1, 1))

	def test_native_receive_accepts_typed_serials_and_auto_generates_from_series(self):
		item = self.serial_item(series=f"{self.token}-.####")
		serials = [f"TSN-{self.token}-NATIVE-A", f"TSN-{self.token}-NATIVE-B"]
		draft = self.native_serial_entry(item, "Receive", 2, target=self.a, serials=serials)
		saved = frappe.get_doc("Stock Entry", draft["name"])
		self.assertEqual(saved.items[0].serial_no, "\n".join(serials))
		result = native_api.submit_document("Stock Entry", saved.name, str(saved.modified))
		self.assertEqual(get_stock_balance(item.name, self.a), 2)
		self.assertEqual(result["items"][0]["serials"], serials)
		generated = self.native_serial_entry(item, "Receive", 1, target=self.b)
		generated_doc = frappe.get_doc("Stock Entry", generated["name"])
		native_api.submit_document("Stock Entry", generated_doc.name, str(generated_doc.modified))
		self.assertEqual(
			frappe.db.count("Serial No", {"item_code": item.name, "warehouse": self.b, "status": "Active"}),
			1,
		)

	def test_native_receive_existing_serial_names_owner_item(self):
		owner = self.serial_item()
		other = self.serial_item()
		serial = f"TSN-{self.token}-OWNER"
		self.serial_entry(owner, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		with self.assertRaises(frappe.ValidationError) as error:
			self.native_serial_entry(other, "Receive", 1, target=self.b, serials=[serial])
		self.assertIn(f"序列号 {serial} 已属于物品 {owner.item_name}", str(error.exception))

	def test_native_issue_transfer_and_loan_use_selected_active_serials(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-KIND-{i}" for i in range(1, 4)]
		receipt = self.native_serial_entry(
			item,
			"Receive",
			3,
			target=self.a,
			serials=serials,
			posting_time=(now_datetime() - timedelta(minutes=1)).time().strftime("%H:%M:%S"),
		)
		receipt_doc = frappe.get_doc("Stock Entry", receipt["name"])
		native_api.submit_document("Stock Entry", receipt_doc.name, str(receipt_doc.modified))
		transfer = self.native_serial_entry(
			item, "Transfer", 1, source=self.a, target=self.b, serials=[serials[0]]
		)
		transfer_doc = frappe.get_doc("Stock Entry", transfer["name"])
		native_api.submit_document("Stock Entry", transfer_doc.name, str(transfer_doc.modified))
		loan = self.native_serial_entry(
			item, "Loan", 1, source=self.a, target=self.loan_leaf, serials=[serials[1]]
		)
		loan_doc = frappe.get_doc("Stock Entry", loan["name"])
		native_api.submit_document("Stock Entry", loan_doc.name, str(loan_doc.modified))
		issue = self.native_serial_entry(item, "Issue", 1, source=self.a, serials=[serials[2]])
		issue_doc = frappe.get_doc("Stock Entry", issue["name"])
		native_api.submit_document("Stock Entry", issue_doc.name, str(issue_doc.modified))
		self.assertEqual(frappe.db.get_value("Serial No", serials[0], "warehouse"), self.b)
		self.assertEqual(frappe.db.get_value("Serial No", serials[1], "warehouse"), self.loan_leaf)
		self.assertEqual(frappe.db.get_value("Serial No", serials[2], "status"), "Consumed")

	def test_native_outward_rejects_wrong_source_wrong_count_and_non_stock_unit(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-SOURCE"
		self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		with self.assertRaisesRegex(frappe.ValidationError, "不在所选来源库位"):
			self.native_serial_entry(item, "Issue", 1, source=self.b, serials=[serial])
		with self.assertRaisesRegex(frappe.ValidationError, "数量必须等于序列号数量"):
			self.native_serial_entry(item, "Issue", 2, source=self.a, serials=[serial])
		with self.assertRaisesRegex(frappe.ValidationError, "只能使用库存单位"):
			self.native_serial_entry(item, "Issue", 1, source=self.a, serials=[serial], uom="Box")
		duplicate = f"TSN-{self.token}-INTRA-DUPLICATE"
		with self.assertRaisesRegex(frappe.ValidationError, "在本单据中重复"):
			self.native_serial_entry(item, "Receive", 2, target=self.b, serials=[duplicate, duplicate])

	def test_available_serials_scopes_item_and_authorized_warehouse_and_scan_resolves_serial(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-SCAN"
		self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		result = catalog.available_serials(item.name, self.a)
		self.assertIn(serial, [row["name"] for row in result["serials"]])
		with (
			patch(
				"temple_inventory.native_stock.warehouse_scopes",
				return_value=(None, {self.a: frappe._dict(name=self.a, is_group=0)}, {self.a}, set(), set()),
			),
			self.assertRaises(frappe.PermissionError),
		):
			catalog.available_serials(item.name, self.b)
		scan = catalog.scan_code(serial)
		self.assertEqual(scan["matches"][0]["item_code"], item.name)
		self.assertEqual(scan["serial"], serial)
		self.assertIn(serial, scan["batches"])

	def test_duplicate_copies_drop_receipt_serials_and_keep_outward_serials(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-COPY"
		receipt = self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert()
		receipt.submit()
		copied_receipt = native_api.duplicate_document(
			"Stock Entry", receipt.name, str(receipt.modified), f"serial-copy-receive:{self.token}"
		)
		self.assertFalse(frappe.get_doc("Stock Entry", copied_receipt["name"]).items[0].serial_no)
		issue = self.serial_entry(item, "Material Issue", 1, source=self.a, serials=[serial]).insert()
		copied_issue = native_api.duplicate_document(
			"Stock Entry", issue.name, str(issue.modified), f"serial-copy-issue:{self.token}"
		)
		self.assertEqual(frappe.get_doc("Stock Entry", copied_issue["name"]).items[0].serial_no, serial)

	# Serial count coverage
	def _serial_count_rows(self, item, timestamp=None):
		from temple_inventory.counts import _baseline

		result = _baseline(timestamp or (now_datetime() + timedelta(minutes=1)))
		return [row for row in result["rows"] if row["item_code"] == item.name]

	def test_count_baseline_lists_book_serials_and_respects_authorized_leaves(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-BASE-{index}" for index in range(2)]
		receipt = self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials)
		receipt.insert().submit()
		hidden_serial = f"TSN-{self.token}-COUNT-HIDDEN"
		self.serial_entry(
			item, "Material Receipt", 1, target=self.b, serials=[hidden_serial]
		).insert().submit()
		from temple_inventory.native_stock import warehouse_scopes

		scopes = warehouse_scopes()
		with patch(
			"temple_inventory.counts.warehouse_scopes",
			return_value=(scopes[0], scopes[1], {self.a}, scopes[3], scopes[4]),
		):
			rows = self._serial_count_rows(item)
			from temple_inventory.counts import _baseline

			previous_scope = _baseline(
				now_datetime() + timedelta(minutes=1),
				previous_rows=[
					{"item_code": item.name, "warehouse": self.b, "batch_no": None, "baseline_qty": 1}
				],
			)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["warehouse"], self.a)
		self.assertEqual(rows[0]["baseline_serials"], sorted(serials))
		self.assertEqual(rows[0]["baseline_qty"], 2)
		self.assertFalse(any(row["warehouse"] == self.b for row in previous_scope["rows"]))
		before_receipt = get_datetime(f"{receipt.posting_date} {receipt.posting_time}") - timedelta(seconds=1)
		self.assertEqual(self._serial_count_rows(item, before_receipt), [])

	def test_count_all_present_is_matching_and_subset_reconciliation_delivers_omitted_serial(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-SET-{index}" for index in range(3)]
		self.serial_entry(item, "Material Receipt", 3, target=self.a, serials=serials).insert().submit()
		baseline = self._serial_count_rows(item)[0]
		baseline_rows = [baseline]
		all_present = {
			**baseline,
			"review_state": "Reviewed",
			"actual_qty": 3,
			"actual_serials": serials,
		}
		self.assertEqual(counts._differences([all_present], baseline_rows), [])
		timestamp = now_datetime() + timedelta(minutes=1)
		current_baseline = counts._baseline(timestamp)
		matching_reviews = []
		for row in current_baseline["rows"]:
			review = {
				**row,
				"actual_qty": None,
				"actual_serials": None if row.get("is_serial") else [],
				"review_state": "Unreviewed",
				"reason": "",
			}
			if row["item_code"] == item.name and row["warehouse"] == self.a:
				review.update(
					{
						"actual_qty": len(serials),
						"actual_serials": serials,
						"review_state": "Reviewed",
					}
				)
			matching_reviews.append(review)
		matching = counts.save_count(
			f"serial-count-matching:{self.token}",
			{
				"company": self.company,
				"posting_date": timestamp.date(),
				"posting_time": timestamp.time(),
				"ti_count_review": matching_reviews,
			},
		)
		self.assertTrue(matching["no_adjustment"])
		self.assertFalse(matching.get("name"))
		subset = {**all_present, "actual_qty": 2, "actual_serials": serials[:2]}
		differences = counts._differences([subset], baseline_rows)
		self.assertEqual(differences[0]["serials"], serials[:2])
		doc = self.reconcile(item, self.a, 2, serials[:2]).insert()
		doc.submit()
		self.assertEqual(get_stock_balance(item.name, self.a), 2)
		self.assertEqual(frappe.db.get_value("Serial No", serials[2], "status"), "Delivered")
		from temple_inventory.native_balances import reconciliation_serial_allocations

		allocation = reconciliation_serial_allocations(doc.items[0])
		self.assertEqual(allocation["baseline_serials"], sorted(serials))
		self.assertEqual(allocation["actual_serials"], sorted(serials[:2]))
		self.assertEqual(allocation["missing_serials"], [serials[2]])

	def test_count_zero_present_uses_native_reconcile_all_path(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-ZERO-{index}" for index in range(2)]
		self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert().submit()
		baseline = self._serial_count_rows(item)[0]
		zero = {**baseline, "review_state": "Reviewed", "actual_qty": 0, "actual_serials": []}
		differences = counts._differences([zero], [baseline])
		self.assertEqual(differences[0]["serials"], [])
		doc = self.reconcile(item, self.a, 0, [], use_fields=0)
		doc.items[0].reconcile_all_serial_batch = 1
		doc.insert()
		doc.submit()
		self.assertEqual(get_stock_balance(item.name, self.a), 0)
		self.assertTrue(
			all(frappe.db.get_value("Serial No", serial, "status") == "Delivered" for serial in serials)
		)

	def test_count_save_and_confirm_writes_serial_subset_to_native_reconciliation(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-SAVE-{index}" for index in range(3)]
		self.serial_entry(item, "Material Receipt", 3, target=self.a, serials=serials).insert().submit()
		timestamp = now_datetime() + timedelta(minutes=1)
		baseline = counts._baseline(timestamp)
		reviews = []
		for row in baseline["rows"]:
			review = {
				**row,
				"actual_qty": None,
				"actual_serials": None if row.get("is_serial") else [],
				"review_state": "Unreviewed",
				"reason": "",
			}
			if row["item_code"] == item.name and row["warehouse"] == self.a:
				review.update(
					{
						"actual_qty": 2,
						"actual_serials": serials[:2],
						"review_state": "Reviewed",
					}
				)
			reviews.append(review)
		saved = counts.save_count(
			f"serial-count-save:{self.token}",
			{
				"company": self.company,
				"posting_date": timestamp.date(),
				"posting_time": timestamp.time(),
				"ti_count_review": reviews,
			},
		)
		doc = frappe.get_doc("Stock Reconciliation", saved["name"])
		self.assertEqual(doc.items[0].serial_no, "\n".join(serials[:2]))
		native_api.submit_document("Stock Reconciliation", doc.name, str(doc.modified))
		self.assertEqual(get_stock_balance(item.name, self.a), 2)
		self.assertEqual(frappe.db.get_value("Serial No", serials[2], "status"), "Delivered")
		details = counts.count_serial_details(doc.name)
		count_detail = next(row for row in details if row["item_code"] == item.name)
		self.assertEqual(count_detail["baseline_serials"], sorted(serials))
		self.assertEqual(count_detail["actual_serials"], sorted(serials[:2]))
		self.assertEqual(count_detail["missing_serials"], [serials[2]])

	def test_count_save_and_confirm_to_zero_uses_reconcile_all_serial_batch(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-SAVE-ZERO-{index}" for index in range(2)]
		self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert().submit()
		timestamp = now_datetime() + timedelta(minutes=1)
		baseline = counts._baseline(timestamp)
		reviews = []
		for row in baseline["rows"]:
			review = {
				**row,
				"actual_qty": None,
				"actual_serials": None if row.get("is_serial") else [],
				"review_state": "Unreviewed",
				"reason": "",
			}
			if row["item_code"] == item.name and row["warehouse"] == self.a:
				review.update({"actual_qty": 0, "actual_serials": [], "review_state": "Reviewed"})
			reviews.append(review)
		saved = counts.save_count(
			f"serial-count-zero:{self.token}",
			{
				"company": self.company,
				"posting_date": timestamp.date(),
				"posting_time": timestamp.time(),
				"ti_count_review": reviews,
			},
		)
		doc = frappe.get_doc("Stock Reconciliation", saved["name"])
		self.assertEqual(doc.items[0].qty, 0)
		self.assertTrue(doc.items[0].reconcile_all_serial_batch)
		native_api.submit_document("Stock Reconciliation", doc.name, str(doc.modified))
		self.assertEqual(get_stock_balance(item.name, self.a), 0)
		self.assertTrue(
			all(frappe.db.get_value("Serial No", serial, "status") == "Delivered" for serial in serials)
		)

	def test_count_found_serial_from_another_leaf_is_blocked_with_presenter_label(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-COUNT-OTHER"
		self.serial_entry(item, "Material Receipt", 1, target=self.b, serials=[serial]).insert().submit()
		with self.assertRaises(frappe.ValidationError) as error:
			counts._validate_count_serials(item.name, self.a, [serial])
		self.assertIn(f"序列号 {serial} 记录在", str(error.exception))
		self.assertIn("请先调拨", str(error.exception))

	def test_count_found_unknown_or_wrong_item_serial_is_rejected(self):
		item = self.serial_item()
		other = self.serial_item()
		serial = f"TSN-{self.token}-COUNT-OWNER"
		self.serial_entry(other, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		with self.assertRaisesRegex(frappe.ValidationError, "不存在"):
			counts._validate_count_serials(item.name, self.a, [f"UNKNOWN-{self.token}"])
		with self.assertRaisesRegex(frappe.ValidationError, "属于其他物品"):
			counts._validate_count_serials(item.name, self.a, [serial])

	def test_unreviewed_serial_count_row_is_not_an_adjustment(self):
		item = self.serial_item()
		serial = f"TSN-{self.token}-COUNT-UNREVIEWED"
		self.serial_entry(item, "Material Receipt", 1, target=self.a, serials=[serial]).insert().submit()
		baseline = self._serial_count_rows(item)[0]
		unreviewed = {**baseline, "review_state": "Unreviewed", "actual_qty": None, "actual_serials": None}
		with self.assertRaisesRegex(frappe.ValidationError, "至少核对一条"):
			counts._differences([unreviewed], [baseline])

	def test_count_book_serial_set_change_is_flagged_even_when_quantity_is_unchanged(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-COUNT-STALE-{index}" for index in range(2)]
		self.serial_entry(item, "Material Receipt", 2, target=self.a, serials=serials).insert().submit()
		baseline = self._serial_count_rows(item)[0]
		changed_book = {**baseline, "baseline_serials": [serials[0], f"OTHER-{self.token}"]}
		review = {
			**baseline,
			"review_state": "Reviewed",
			"actual_qty": 1,
			"actual_serials": [serials[0]],
		}
		with self.assertRaisesRegex(frappe.TimestampMismatchError, "账面序列号已变化"):
			counts._differences([review], [changed_book])

	# Loans: serial ownership and settlement lifecycle regressions.
	def _native_serial_settlement(self, item, kind, loan_name, loan_line, serial, outcome):
		result = native_api.create_document(
			"Stock Entry",
			f"serial-loan-settlement:{self.token}:{frappe.generate_hash(length=6)}",
			{
				"company": self.company,
				"posting_date": nowdate(),
				"posting_time": now_datetime().time().strftime("%H:%M:%S"),
				"ti_time_mode": "Manual",
				"ti_movement_kind": kind,
				"items": [
					{
						"item_code": item.name,
						"qty": 1,
						"uom": "Nos",
						"conversion_factor": 1,
						"s_warehouse": self.loan_leaf,
						"t_warehouse": self.damaged if outcome == "Damaged" else self.a,
						"serial_no": serial,
						"use_serial_batch_fields": 1,
						"ti_original_loan": loan_name,
						"ti_original_loan_line": loan_line,
						"ti_settlement_outcome": outcome,
					}
				],
			},
		)
		return frappe.get_doc("Stock Entry", result["name"])

	def test_serial_loan_detail_partial_return_cancel_and_damage_settlement(self):
		item = self.serial_item()
		serials = [f"TSN-{self.token}-LOAN-{index}" for index in (1, 2)]
		for serial in serials:
			receipt = self.native_serial_entry(
				item,
				"Receive",
				1,
				target=self.a,
				serials=[serial],
				posting_time=(now_datetime() - timedelta(minutes=1)).time().strftime("%H:%M:%S"),
			)
			receipt_doc = frappe.get_doc("Stock Entry", receipt["name"])
			native_api.submit_document("Stock Entry", receipt_doc.name, str(receipt_doc.modified))
		loan = self.native_serial_entry(
			item, "Loan", 2, source=self.a, target=self.loan_leaf, serials=serials
		)
		loan_doc = frappe.get_doc("Stock Entry", loan["name"])
		native_api.submit_document("Stock Entry", loan_doc.name, str(loan_doc.modified))
		loan_doc = frappe.get_doc("Stock Entry", loan_doc.name)
		line = loan_doc.items[0]
		detail = native_api.loan_detail(loan_doc.name)
		self.assertEqual(detail["items"][0]["lent_serials"], serials)
		self.assertEqual(detail["items"][0]["outstanding_serials"], serials)

		returned = self._native_serial_settlement(
			item, "Return", loan_doc.name, line.name, serials[0], "Returned"
		)
		native_api.submit_document("Stock Entry", returned.name, str(returned.modified))
		detail = native_api.loan_detail(loan_doc.name)
		self.assertEqual(detail["items"][0]["outstanding_serials"], [serials[1]])
		self.assertEqual(detail["items"][0]["settled_serials"]["Returned"], [serials[0]])
		with self.assertRaisesRegex(frappe.ValidationError, f"序列号 {serials[0]} 不在原借出"):
			self._native_serial_settlement(item, "Return", loan_doc.name, line.name, serials[0], "Returned")

		other_serial = f"TSN-{self.token}-NOT-LENT"
		other_receipt = self.native_serial_entry(
			item,
			"Receive",
			1,
			target=self.a,
			serials=[other_serial],
			posting_time=(now_datetime() - timedelta(minutes=1)).time().strftime("%H:%M:%S"),
		)
		other_receipt_doc = frappe.get_doc("Stock Entry", other_receipt["name"])
		native_api.submit_document("Stock Entry", other_receipt_doc.name, str(other_receipt_doc.modified))
		other_loan = self.native_serial_entry(
			item, "Loan", 1, source=self.a, target=self.loan_leaf, serials=[other_serial]
		)
		other_loan_doc = frappe.get_doc("Stock Entry", other_loan["name"])
		native_api.submit_document("Stock Entry", other_loan_doc.name, str(other_loan_doc.modified))
		with self.assertRaisesRegex(frappe.ValidationError, f"序列号 {other_serial} 不在原借出"):
			self._native_serial_settlement(item, "Return", loan_doc.name, line.name, other_serial, "Returned")

		returned = frappe.get_doc("Stock Entry", returned.name)
		native_api.cancel_document("Stock Entry", returned.name, str(returned.modified))
		self.assertEqual(native_api.loan_detail(loan_doc.name)["items"][0]["outstanding_serials"], serials)
		damaged = self._native_serial_settlement(
			item, "Damage", loan_doc.name, line.name, serials[0], "Damaged"
		)
		native_api.submit_document("Stock Entry", damaged.name, str(damaged.modified))
		self.assertEqual(frappe.db.get_value("Serial No", serials[0], "warehouse"), self.damaged)
		detail = native_api.loan_detail(loan_doc.name)
		self.assertEqual(detail["items"][0]["outstanding_serials"], [serials[1]])
		self.assertEqual(detail["items"][0]["settled_serials"]["Damaged"], [serials[0]])
