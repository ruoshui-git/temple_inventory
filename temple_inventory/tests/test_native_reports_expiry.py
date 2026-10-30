"""Report/export contracts exercised against real native stock and permissions."""

from io import BytesIO
from unittest.mock import patch
from uuid import uuid4

import frappe
from PIL import Image

from temple_inventory import browse, catalog, counts, native_api
from temple_inventory.projections import report_page
from temple_inventory.tests.helpers import NativeReportTestCase


class NativeReportsExpiryTests(NativeReportTestCase):
	def test_dashboard_expiry_images_do_not_poison_unfiltered_expiry_page_cache(self):
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.has_expiry_date = 1
		item.save()
		batch = catalog.create_batch(
			self.item,
			"TI-IMAGE-EXPIRY-" + self.token,
			expiry_date=frappe.utils.add_days(frappe.utils.nowdate(), 14),
		)
		data = self.movement(quantity=5)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		buffer = BytesIO()
		Image.new("RGB", (8, 8), "blue").save(buffer, "PNG")
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"expiry-{self.token}.png",
				"content": buffer.getvalue(),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "image",
			}
		).insert()
		item = frappe.get_doc("Item", self.item)
		item.image = file.file_url
		item.save()
		query = self.query("expiry", "batches")

		dashboard = browse._dashboard_card("expiry", query["scope"], None, "location")
		self.assertEqual(dashboard["expiry_rows"]["upcoming"][0]["image"], file.file_url)
		page = browse._expiry_page(query, 0, 30)
		self.assertEqual(page["rows"][0]["image"], file.file_url)

	def test_count_adjustment_history_uses_counted_location_as_source_only(self):
		self.receipt(10)
		count = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		native_api.submit_document("Stock Reconciliation", count.name, count.version)
		page = browse.movement_history(
			self.query("movements", "lines", statuses=[1], record=count.name),
			item_code=self.item,
		)
		self.assertEqual(page["matched_count"], 1)
		row = page["rows"][0]
		self.assertEqual(row["kind"], "Reconcile")
		self.assertEqual(row["source_warehouse"], self.a)
		self.assertEqual(row["destination_warehouse"], "")

	def test_desk_multi_batch_count_retains_per_batch_baseline_zero_actual_and_cancelled_provenance(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batches = []
		for suffix in ("A", "B"):
			batch = catalog.create_batch(self.item, "TI-COUNT-MULTI-" + self.token + suffix)["name"]
			batches.append(batch)
			data = self.movement(quantity=5)
			data["items"][0].update({"batch_no": batch, "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		posting = frappe.utils.now_datetime()
		bundle = frappe.get_doc(
			{
				"doctype": "Serial and Batch Bundle",
				"voucher_type": "Stock Reconciliation",
				"company": self.company,
				"item_code": self.item,
				"warehouse": self.a,
				"type_of_transaction": "Inward",
				"posting_datetime": posting,
				"entries": [{"batch_no": batches[0], "qty": 3}],
			}
		).insert()
		doc = frappe.get_doc(
			{
				"doctype": "Stock Reconciliation",
				"company": self.company,
				"purpose": "Stock Reconciliation",
				"posting_date": posting.date(),
				"posting_time": posting.time(),
				"set_posting_time": 1,
				"items": [
					{
						"item_code": self.item,
						"warehouse": self.a,
						"qty": 3,
						"serial_and_batch_bundle": bundle.name,
						"use_serial_batch_fields": 0,
						"reconcile_all_serial_batch": 1,
					}
				],
			}
		).insert()
		doc.submit()
		loaded = native_api.load_document("Stock Reconciliation", doc.name)
		self.assertEqual(
			{
				row["batch_no"]: (row["baseline_qty"], row["actual_qty"])
				for row in loaded["items"][0].recorded_count_allocations
			},
			{batches[0]: (5, 3), batches[1]: (5, 0)},
		)
		query = self.query("counts", "lines", record=doc.name, statuses=[1])
		before = report_page(query)
		self.assertEqual(before["matched_count"], 2)
		self.assertEqual(
			{
				row["batch_no"]: (row["baseline_qty"], row["actual_qty"], row["difference"])
				for row in before["rows"]
			},
			{batches[0]: (5, 3, -2), batches[1]: (5, 0, -5)},
		)
		movements = report_page(self.query("movements", "lines", record=doc.name, statuses=[1]))
		self.assertEqual(
			{row["batch_no"]: row["stock_qty"] for row in movements["rows"]}, {batches[0]: -2, batches[1]: -5}
		)
		cancelled = native_api.cancel_document("Stock Reconciliation", doc.name, str(doc.modified))
		self.assertEqual(
			cancelled["items"][0].recorded_count_allocations, loaded["items"][0].recorded_count_allocations
		)
		query["statuses"] = [2]
		after = report_page(query)
		fields = (
			"id",
			"line_name",
			"batch_no",
			"baseline_qty",
			"actual_qty",
			"difference",
			"bundle_line",
			"current_bundle_line",
		)
		self.assertEqual(
			[{key: row.get(key) for key in fields} for row in after["rows"]],
			[{key: row.get(key) for key in fields} for row in before["rows"]],
		)
		self.assertTrue(all(row["docstatus"] == 2 for row in after["rows"]))
		batch_class = type(frappe.get_doc("Batch", batches[1]))
		check = batch_class.check_permission

		def permission(batch_doc, *args, **kwargs):
			if batch_doc.name == batches[1]:
				raise frappe.PermissionError("Baseline Batch denied")
			return check(batch_doc, *args, **kwargs)

		with patch.object(batch_class, "check_permission", permission):
			with self.assertRaises(frappe.PermissionError):
				native_api.load_document("Stock Reconciliation", cancelled.name)
			self.assertEqual(report_page(query)["matched_count"], 0)

	def test_cancelled_batch_records_retain_native_allocation_ids_and_batch_permissions(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, "TI-CANCEL-" + self.token)
		data = self.movement(quantity=4)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		completed = self.submit(self.create(data))
		query = self.query("movements", "lines", record=completed.name, statuses=[1])
		before = report_page(query)
		self.assertEqual(before["rows"][0]["batch_no"], batch["name"])
		cancelled = native_api.cancel_document("Stock Entry", completed.name, completed.version)
		query["statuses"] = [2]
		after = report_page(query)
		self.assertEqual(after["matched_count"], 1)
		self.assertEqual(after["rows"][0]["batch_no"], batch["name"])
		self.assertEqual(after["rows"][0]["bundle_line"], before["rows"][0]["bundle_line"])
		self.assertEqual(after["rows"][0]["stock_qty"], 4)
		self.assertEqual(cancelled["items"][0].recorded_bundle, completed["items"][0].recorded_bundle)
		self.assertEqual(
			cancelled["items"][0].recorded_batch_allocations, completed["items"][0].recorded_batch_allocations
		)
		batch_class = type(frappe.get_doc("Batch", batch["name"]))
		with patch.object(
			batch_class, "check_permission", side_effect=frappe.PermissionError("Batch denied")
		):
			with self.assertRaises(frappe.PermissionError):
				native_api.load_document("Stock Entry", cancelled.name)
			self.assertEqual(report_page(query)["matched_count"], 0)
