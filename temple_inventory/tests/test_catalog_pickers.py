"""Native supporting records, full-dataset search and dashboard integration."""

import base64
from unittest.mock import patch

import frappe
from frappe.utils import add_days, nowdate

from temple_inventory import (
	browse,
	catalog,
	native_api,
)
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogPickersTests(NativeDocumentTests):
	def test_search_filters_all_candidates_before_paging_and_matches_barcodes(self):
		item = frappe.get_doc("Item", self.item)
		item.append("barcodes", {"barcode": "UNIQUE-BARCODE-" + self.token})
		item.save()
		result = catalog.search_items("UNIQUE-BARCODE-" + self.token, page_length=1)
		self.assertEqual(result["matched_count"], 1)
		self.assertEqual(result["results"][0]["item_code"], self.item)
		self.assertIsNone(result["next_start"])
		self.assertEqual(catalog.search_items(self.item, in_stock_only=True)["matched_count"], 0)
		self.receipt(3)
		other_receipt = self.movement(quantity=4)
		other_receipt["items"][0]["t_warehouse"] = self.b
		self.submit(self.create(other_receipt))
		result = catalog.search_items(self.item, in_stock_only=True, warehouses=[self.a, self.b])
		self.assertEqual(result["matched_count"], 1)
		self.assertEqual(sum(row["available"] for row in result["results"][0]["stock"]), 7)

	def test_inbound_picker_rows_ignore_warehouse_filter(self):
		self.receipt(3)
		page = catalog.picker_rows(
			item_codes=[self.item],
			warehouses=[self.b],
			receiving_warehouse=self.a,
			purpose="inbound",
			page_length=10,
		)
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["results"][0]["warehouse"], self.a)
		self.assertEqual(page["results"][0]["picker_quantity"], 3)

	def test_picker_rows_page_flattened_warehouses_and_include_stockless_receipts(self):
		self.receipt(3)
		other_receipt = self.movement(quantity=4)
		other_receipt["items"][0]["t_warehouse"] = self.b
		self.submit(self.create(other_receipt))
		page = catalog.picker_rows(
			item_codes=[self.item], warehouses=[self.a, self.b], purpose="outbound", page_length=1
		)
		self.assertEqual(page["matched_count"], 2)
		self.assertEqual(len(page["results"]), 1)
		self.assertIsNotNone(page["next_start"])
		full_page = catalog.picker_rows(
			item_codes=[self.item], warehouses=[self.a, self.b], purpose="outbound", page_length=10
		)
		self.assertEqual(
			{row["warehouse"]: row["picker_quantity"] for row in full_page["results"]},
			{self.a: 3, self.b: 4},
		)
		next_page = catalog.picker_rows(
			item_codes=[self.item],
			warehouses=[self.a, self.b],
			purpose="outbound",
			start=page["next_start"],
			page_length=1,
		)
		self.assertNotEqual(page["results"][0]["warehouse"], next_page["results"][0]["warehouse"])
		inbound = catalog.picker_rows(
			item_codes=[self.item],
			warehouses=[self.b],
			receiving_warehouse=self.a,
			purpose="inbound",
			page_length=10,
		)
		self.assertEqual(inbound["matched_count"], 1)
		self.assertEqual(inbound["results"][0]["warehouse"], self.a)
		self.assertEqual(inbound["results"][0]["picker_quantity"], 3)
		stockless_code = f"TI-STOCKLESS-{self.token}"
		catalog.save_item({"item_code": stockless_code, "item_name": "Stockless", "stock_uom": "Nos"})
		stockless = catalog.picker_rows(
			item_codes=[stockless_code],
			warehouses=[self.a, self.b],
			receiving_warehouse=self.a,
			purpose="inbound",
			page_length=10,
		)
		self.assertEqual(stockless["matched_count"], 1)
		self.assertEqual(stockless["results"][0]["warehouse"], self.a)
		self.assertEqual(stockless["results"][0]["picker_quantity"], 0)
		self.assertEqual(
			catalog.picker_rows(
				item_codes=[stockless_code],
				receiving_warehouse=self.a,
				purpose="inbound",
				only_stock=True,
			)["matched_count"],
			0,
		)
		self.assertEqual(
			catalog.picker_rows(item_codes=[stockless_code], purpose="count", only_stock=True)[
				"matched_count"
			],
			0,
		)
		count_rows = catalog.picker_rows(item_codes=[stockless_code], purpose="count", page_length=10)
		self.assertEqual(count_rows["matched_count"], 1)
		self.assertEqual(count_rows["results"][0]["warehouse"], "")
		damaged_rows = catalog.picker_rows(
			item_codes=[self.item], warehouses="[]", purpose="damaged", page_length=10
		)
		self.assertEqual(damaged_rows["matched_count"], 0)
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		batch_item = frappe.copy_doc(frappe.get_doc("Item", self.item))
		batch_item.item_code = self.item + "-PICKER-BATCH"
		batch_item.has_batch_no = 1
		batch_item.insert()
		for suffix, quantity in (("A", 4), ("B", 6)):
			batch = catalog.create_batch(batch_item.name, "TI-PICKER-" + self.token + suffix)
			data = self.movement(quantity=quantity)
			data["items"][0].update(
				{"item_code": batch_item.name, "batch_no": batch["name"], "use_serial_batch_fields": 1}
			)
			self.submit(self.create(data))
		batch_rows = catalog.picker_rows(
			item_codes=[batch_item.name], warehouses=[self.a], purpose="outbound", page_length=10
		)
		self.assertEqual(batch_rows["matched_count"], 1)
		batch_row = batch_rows["results"][0]
		self.assertEqual(batch_row["picker_quantity"], 10)
		self.assertNotIn("batch_no", batch_row["stock"][0])
		self.assertEqual(len(batch_row["stock"][0]["batch_choices"]), 2)
		self.assertEqual(sum(row["qty"] for row in batch_row["stock"][0]["batch_choices"]), 10)

	def test_picker_pagination_matches_unpaged_rows_for_each_purpose(self):
		self.receipt(3)
		second = self.movement(quantity=4)
		second["items"][0]["t_warehouse"] = self.b
		self.submit(self.create(second))
		damage = self.movement("Damage", quantity=2, source=self.a, target=self.damaged)
		self.submit(self.create(damage))
		stockless_code = f"TI-STOCKLESS-{self.token}"
		catalog.save_item({"item_code": stockless_code, "item_name": "Stockless", "stock_uom": "Nos"})
		cases = [
			("outbound", {"warehouses": [self.a, self.b]}),
			("damaged", {"warehouses": [self.damaged]}),
			("inbound", {"receiving_warehouse": self.a}),
			("count", {"warehouses": [self.a, self.b]}),
		]
		for purpose, scope in cases:
			with self.subTest(purpose=purpose):
				codes = [self.item, stockless_code] if purpose in ("inbound", "count") else [self.item]
				timestamp = str(frappe.utils.now_datetime())
				full = catalog.picker_rows(
					item_codes=codes, purpose=purpose, page_length=10, timestamp=timestamp, **scope
				)["results"]
				paged = []
				start = 0
				while True:
					page = catalog.picker_rows(
						item_codes=codes,
						purpose=purpose,
						start=start,
						page_length=1,
						timestamp=timestamp,
						**scope,
					)
					paged.extend(page["results"])
					if page["next_start"] is None:
						break
					start = page["next_start"]
				self.assertEqual(paged, full)

	def test_picker_page_sql_queries_are_bounded_for_each_purpose(self):
		self.receipt(3)
		self.submit(self.create(self.movement("Damage", quantity=1, source=self.a, target=self.damaged)))
		cases = [
			("outbound", {"warehouses": [self.a]}),
			("damaged", {"warehouses": [self.damaged]}),
			("inbound", {"receiving_warehouse": self.a}),
			("count", {"warehouses": [self.a]}),
		]
		for purpose, scope in cases:
			with self.subTest(purpose=purpose), patch.object(frappe.db, "sql", wraps=frappe.db.sql) as sql:
				catalog.picker_rows(item_codes=[self.item], purpose=purpose, page_length=1, **scope)
				self.assertLessEqual(sql.call_count, 120)

	def test_picker_and_stock_browse_return_only_readable_primary_images(self):
		self.receipt(5)
		item = frappe.get_doc("Item", self.item)
		image = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"page-primary-{self.token}.png",
				"content": base64.b64decode(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
				),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()
		item.image = image.file_url
		item.save()

		picker = catalog.picker_rows(purpose="outbound", warehouses=[self.a], page_length=50)
		stock = browse.inventory_page(
			{"dataset": "inventory", "scope": {"warehouses": [self.root]}}, page_length=50
		)
		self.assertEqual(
			next(row for row in picker["results"] if row["item_code"] == self.item)["image"], image.file_url
		)
		self.assertEqual(
			next(row for row in stock["rows"] if row["code"] == self.item)["image"], image.file_url
		)

		foreign_owner = catalog.save_item(
			{
				"item_code": f"TI-IMAGE-FOREIGN-{self.token}",
				"item_name": "Foreign image owner",
				"stock_uom": "Nos",
			}
		)
		foreign = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"foreign-page-primary-{self.token}.png",
				"content": b"private",
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": foreign_owner["item_code"],
			}
		).insert()
		frappe.db.set_value("Item", self.item, "image", foreign.file_url)
		picker = catalog.picker_rows(purpose="outbound", warehouses=[self.a], page_length=50)
		stock = browse.inventory_page(
			{"dataset": "inventory", "scope": {"warehouses": [self.root]}}, page_length=50
		)
		self.assertEqual(next(row for row in picker["results"] if row["item_code"] == self.item)["image"], "")
		self.assertEqual(next(row for row in stock["rows"] if row["code"] == self.item)["image"], "")

	def test_restrictive_picker_scope_clock_and_retry_safe_batch_preparation(self):
		self.receipt(3)
		self.assertEqual(catalog.search_items(self.item, item_codes=[])["matched_count"], 0)
		self.assertEqual(catalog.search_items(self.item, item_codes=[self.item])["matched_count"], 1)
		self.assertEqual(catalog.scan_code(self.a)["warehouse"]["name"], self.a)
		self.assertFalse(catalog.scan_code(self.a)["unknown"])
		self.assertEqual(catalog.scan_code(self.room_a)["warehouse"]["name"], self.a)
		self.assertEqual(catalog.operation_items([self.item])["items"][0]["stock"][0]["available"], 3)
		past = "2000-01-01 00:00:00"
		search_result = catalog.search_items(self.item, timestamp=past)
		item_result = catalog.operation_items([self.item], timestamp=past)["items"][0]
		self.assertEqual(search_result["results"][0]["snapshot"], item_result["snapshot"])
		self.assertEqual(search_result["results"][0]["stock"], [])
		self.assertEqual(item_result["stock"], [])
		self.assertIn(nowdate(), native_api.editor_clock()["timestamp"])
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		batch_item = frappe.copy_doc(frappe.get_doc("Item", self.item))
		batch_item.item_code = self.item + "-BATCH"
		batch_item.has_batch_no, batch_item.has_expiry_date = 1, 1
		batch_item.insert()
		batch_id = "TI-PREP-" + self.token
		row = {
			"item_code": batch_item.name,
			"batch_id": batch_id,
			"local_id": "stable-line",
			"expiry_date": add_days(nowdate(), 30),
		}
		first = catalog.receipt_batches([row])["batches"][0]
		self.assertEqual(
			catalog.receipt_batches([row])["batches"][0]["name"],
			first["name"],
		)
		with self.assertRaises(frappe.ValidationError):
			catalog.receipt_batches([{**row, "expiry_date": add_days(nowdate(), 60)}])
