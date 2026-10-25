"""Native supporting records, full-dataset search and dashboard integration."""

import base64
import copy
import unittest
from unittest.mock import patch
from uuid import uuid4

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from frappe.utils import add_days, now_datetime, nowdate
from frappe.utils.nestedset import NestedSetChildExistsError

from temple_inventory import browse, catalog, conversions, counts, native_api, native_files, projections
from temple_inventory.report_query import validate_query
from temple_inventory.report_sources import ReportContext
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogTests(NativeDocumentTests):
	def test_item_image_requires_an_authorized_private_file_attached_to_that_item(self):
		other = catalog.save_item(
			{"item_code": f"TI-IMAGE-OWNER-{self.token}", "item_name": "Other owner", "stock_uom": "Nos"}
		)
		foreign = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"foreign-{self.token}.png",
				"content": b"private-original",
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": other["item_code"],
			}
		).insert()
		item = frappe.get_doc("Item", self.item)
		self.assertNotEqual(foreign.attached_to_name, item.name)
		self.assertNotIn(foreign.name, {file.name for file in native_files.attachments("Item", item.name)})
		item.image = foreign.file_url
		self.assertEqual(catalog.item_metadata(item)["image"], "")
		self.assertEqual(catalog.item_display_summaries([self.item])[self.item]["image"], "")
		public = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"public-{self.token}.png",
				"content": b"public-original",
				"is_private": 0,
			}
		).insert()
		item.reload()
		item.image = public.file_url
		self.assertEqual(catalog.item_metadata(item)["image"], "")

	def test_display_summaries_show_only_an_authorized_private_cover_of_that_item(self):
		def attach(name, item_code):
			return frappe.get_doc(
				{
					"doctype": "File",
					"file_name": f"{name}-{self.token}.png",
					"content": f"{name}-{self.token}".encode(),
					"is_private": 1,
					"attached_to_doctype": "Item",
					"attached_to_name": item_code,
				}
			).insert()

		def cover(url):
			frappe.db.set_value("Item", self.item, "image", url, update_modified=False)
			return catalog.item_display_summaries([self.item])[self.item]["image"]

		other = catalog.save_item(
			{"item_code": f"TI-COVER-OWNER-{self.token}", "item_name": "Other owner", "stock_uom": "Nos"}
		)
		own = attach("own-cover", self.item)
		self.assertEqual(cover(own.file_url), own.file_url)
		self.assertEqual(cover(attach("foreign-cover", other["item_code"]).file_url), "")
		# Inventory attachments are forced private on save; a File made public
		# outside that path must still never become a cover.
		public = attach("public-cover", self.item)
		frappe.db.set_value("File", public.name, "is_private", 0, update_modified=False)
		self.assertEqual(cover(public.file_url), "")
		with patch("frappe.core.doctype.file.file.File.has_permission", return_value=False):
			self.assertEqual(cover(own.file_url), "")
		with patch("temple_inventory.catalog.can_read", return_value=False):
			self.assertEqual(cover(own.file_url), "")

	def test_primary_image_reuses_one_private_file_across_frontend_and_desk_saves(self):
		file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"native-primary-{self.token}.png",
				"content": base64.b64decode(
					"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
				),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()
		item = frappe.get_doc("Item", self.item)
		selected = catalog.set_item_image(self.item, str(item.modified), file.name)
		self.assertEqual(selected["image"], file.file_url)
		self.assertEqual([row.name for row in selected["attachments"]], [file.name])
		self.assertEqual(frappe.get_doc("File", file.name).attached_to_field, "image")
		item.reload()
		item.description = "Desk metadata edit preserves the selected original"
		item.save()
		updated = catalog.save_item({"item_name": "Updated primary test"}, self.item, str(item.modified))
		self.assertEqual([row.name for row in updated["attachments"]], [file.name])
		self.assertEqual(updated["image"], file.file_url)
		native_files.remove_attachment("Item", self.item, file.name)
		self.assertFalse(frappe.db.get_value("Item", self.item, "image"))
		self.assertEqual(native_files.attachments("Item", self.item), [])

	def test_duplicate_preserves_recorded_factor_without_item_write_and_does_not_authorize_other_creations(
		self,
	):
		unit = catalog.create_uom("Copy Package " + self.token, True)["name"]
		item = frappe.get_doc("Item", self.item)
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 5}])
		data = self.movement(quantity=2)
		data["items"][0].update({"uom": unit, "conversion_factor": 5})
		original = self.submit(self.create(data))
		item.reload()
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 8}])
		permission = frappe.has_permission
		request_id = str(uuid4())
		with patch(
			"frappe.has_permission",
			side_effect=lambda dt, ptype="read", *args, **kwargs: (
				False if dt == "Item" and ptype == "write" else permission(dt, ptype, *args, **kwargs)
			),
		):
			copied = native_api.duplicate_document("Stock Entry", original.name, original.version, request_id)
			self.assertNotEqual(copied.name, original.name)
			self.assertEqual(copied.docstatus, 0)
			self.assertFalse(copied.amended_from)
			self.assertFalse(copied.ti_confirmation_version)
			self.assertNotEqual(copied["items"][0].name, original["items"][0].name)
			self.assertEqual(copied["items"][0].conversion_factor, 5)
			self.assertEqual(copied["items"][0].qty, 2)
			self.assertEqual(
				native_api.duplicate_document(
					"Stock Entry", original.name, original.version, request_id
				).name,
				copied.name,
			)
			with self.assertRaises(frappe.TimestampMismatchError):
				native_api.duplicate_document("Stock Entry", original.name, "stale", str(uuid4()))
			with self.assertRaises(frappe.PermissionError):
				self.create(data)
			copied = native_api.save_document("Stock Entry", copied.name, copied.version, {"remarks": "copy"})
			self.assertEqual(self.submit(copied)["items"][0].conversion_factor, 5)
		self.assertEqual(frappe.get_doc("Item", self.item).uoms[-1].conversion_factor, 8)

	def test_multi_batch_amendment_keeps_recorded_unit_factor_and_checks_batch_access(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		unit = catalog.create_uom("Batch Package " + self.token, True)["name"]
		item.reload()
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 5}])
		batches = []
		for suffix in ("A", "B"):
			batch = catalog.create_batch(self.item, "TI-AMEND-MULTI-" + self.token + suffix)
			batches.append(batch["name"])
			data = self.movement(quantity=10)
			data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		bundle = frappe.get_doc(
			{
				"doctype": "Serial and Batch Bundle",
				"voucher_type": "Stock Entry",
				"company": self.company,
				"item_code": self.item,
				"warehouse": self.a,
				"type_of_transaction": "Outward",
				"posting_datetime": frappe.utils.now_datetime(),
				"entries": [{"batch_no": batches[0], "qty": -2}, {"batch_no": batches[1], "qty": -3}],
			}
		).insert()
		data = self.movement("Transfer", 1, self.a, self.b)
		data["items"][0].update(
			{
				"uom": unit,
				"conversion_factor": 5,
				"serial_and_batch_bundle": bundle.name,
				"use_serial_batch_fields": 0,
			}
		)
		completed = self.submit(self.create(data))
		copied = native_api.duplicate_document("Stock Entry", completed.name, completed.version, str(uuid4()))
		copied_bundle = frappe.get_doc("Serial and Batch Bundle", copied["items"][0].serial_and_batch_bundle)
		self.assertNotEqual(copied_bundle.name, completed["items"][0].serial_and_batch_bundle)
		self.assertEqual(
			{row.batch_no: abs(row.qty) for row in copied_bundle.entries}, {batches[0]: 2, batches[1]: 3}
		)
		native_api.delete_document("Stock Entry", copied.name, copied.version)
		batch_class = type(frappe.get_doc("Batch", batches[0]))
		with patch.object(
			batch_class, "check_permission", side_effect=frappe.PermissionError("Batch denied")
		):
			with self.assertRaises(frappe.PermissionError):
				native_api.load_document("Stock Entry", completed.name)
		item.reload()
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 8}])
		cancelled = native_api.cancel_document("Stock Entry", completed.name, completed.version)
		permission = frappe.has_permission
		with patch(
			"frappe.has_permission",
			side_effect=lambda dt, ptype="read", *args, **kwargs: (
				False if dt == "Item" and ptype == "write" else permission(dt, ptype, *args, **kwargs)
			),
		):
			amended = native_api.amend_document(
				"Stock Entry", cancelled.name, cancelled.version, str(uuid4())
			)
			self.assertEqual(amended["items"][0].qty, 1)
			self.assertEqual(amended["items"][0].uom, unit)
			self.assertEqual(amended["items"][0].conversion_factor, 5)
			new_bundle = frappe.get_doc(
				"Serial and Batch Bundle", amended["items"][0].serial_and_batch_bundle
			)
			self.assertEqual(
				{row.batch_no: abs(row.qty) for row in new_bundle.entries}, {batches[0]: 2, batches[1]: 3}
			)
			self.submit(amended)
		self.assertEqual(get_batch_qty(batch_no=batches[0], warehouse=self.b, for_stock_levels=True), 2)
		self.assertEqual(get_batch_qty(batch_no=batches[1], warehouse=self.b, for_stock_levels=True), 3)

	def test_batch_amendment_creates_a_new_native_bundle_and_preserves_original_provenance(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, "TI-AMEND-" + self.token)
		data = self.movement(quantity=4)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		completed = self.submit(self.create(data))
		original_bundle = completed["items"][0].serial_and_batch_bundle
		cancelled = native_api.cancel_document("Stock Entry", completed.name, completed.version)
		amended = native_api.amend_document("Stock Entry", cancelled.name, cancelled.version, str(uuid4()))
		self.assertNotEqual(amended["items"][0].serial_and_batch_bundle, original_bundle)
		self.assertEqual(
			frappe.db.get_value("Serial and Batch Bundle", original_bundle, "voucher_no"), completed.name
		)
		posted = self.submit(amended)
		self.assertEqual(posted["items"][0].transfer_qty, 4)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 4)

	def test_item_creation_preserves_chosen_uom_and_multiple_barcodes(self):
		code = "TI-CATALOG-" + self.token
		created = catalog.save_item(
			{
				"item_code": code,
				"item_name": "测试新物品",
				"item_group": "All Item Groups",
				"stock_uom": "Nos",
				"barcodes": f"CODE-A-{self.token}\nCODE-B-{self.token}",
			}
		)
		self.assertEqual(created["stock_uom"], "Nos")
		self.assertEqual(len(created["barcodes"]), 2)
		self.assertEqual(catalog.scan_code("CODE-B-" + self.token)["matches"][0]["item_code"], code)
		updated = catalog.save_item({"description": "完整说明"}, code, created["version"])
		self.assertEqual(updated["description"], "完整说明")
		with self.assertRaises(frappe.TimestampMismatchError):
			catalog.save_item({"item_name": "stale"}, code, created["version"])
		with self.assertRaises(frappe.ValidationError):
			catalog.save_item({"stock_uom": "Kg"}, code, updated["version"])
		with self.assertRaises(frappe.DuplicateEntryError):
			catalog.save_item(
				{
					"item_code": code,
					"item_name": "Collision",
					"item_group": "All Item Groups",
					"stock_uom": "Nos",
				}
			)
		with self.assertRaises(frappe.ValidationError):
			catalog.save_item(
				{
					"item_code": code + "-2",
					"item_name": "No unit",
					"item_group": "All Item Groups",
					"stock_uom": "",
				}
			)

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

	def test_timestamped_item_stock_uses_the_balance_before_a_later_receipt(self):
		from temple_inventory.native_balances import stock_balance

		self.receipt(5)
		timestamp = add_days(nowdate(), -1) + " 23:59:59"
		self.assertEqual(stock_balance(self.item, self.a, timestamp), 0)
		result = catalog.operation_item(self.item, timestamp)
		self.assertFalse(any(row["warehouse"] == self.a for row in result["stock"]))

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

	def test_reference_creation_preserves_parent_and_whole_number_setting(self):
		parent = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": "Parent " + self.token,
				"parent_item_group": catalog.item_group_root(),
				"is_group": 1,
			}
		).insert()
		child = catalog.create_category("Child " + self.token, parent.name)
		self.assertEqual(child["parent"], parent.name)
		root_child = catalog.create_category("Root child " + self.token)
		self.assertEqual(root_child["parent"], "")
		unit = catalog.create_uom("Unit " + self.token, True)
		self.assertTrue(unit["must_be_whole_number"])
		with self.assertRaises(frappe.DuplicateEntryError):
			catalog.create_uom(unit["name"], False)

	def test_item_category_can_be_blank_on_create_and_clear_to_the_native_root(self):
		root = catalog.item_group_root()
		code = "TI-UNCATEGORIZED-" + self.token
		created = catalog.save_item(
			{"item_code": code, "item_name": "Uncategorized test", "stock_uom": "Nos"}
		)
		self.assertEqual(frappe.db.get_value("Item", code, "item_group"), root)
		self.assertEqual(created["item_group"], "")
		category = catalog.create_category("Assigned " + self.token)
		catalog.save_item(
			{"item_name": "Uncategorized test", "item_group": category["name"]}, code, created["version"]
		)
		item = frappe.get_doc("Item", code)
		cleared = catalog.save_item({"item_group": ""}, code, str(item.modified))
		self.assertEqual(frappe.db.get_value("Item", code, "item_group"), root)
		self.assertEqual(cleared["item_group"], "")

	def test_category_rename_preserves_links_and_delete_uses_native_guards(self):
		category = catalog.create_category("Rename " + self.token)
		item = frappe.get_doc("Item", self.item)
		item.item_group = category["name"]
		item.save()
		renamed = catalog.save_category(
			category["name"], category["version"], {"label": category["label"] + " updated"}
		)
		self.assertNotEqual(renamed["name"], category["name"])
		self.assertEqual(frappe.db.get_value("Item", self.item, "item_group"), renamed["name"])
		with self.assertRaises(frappe.LinkExistsError):
			catalog.delete_category(renamed["name"], renamed["version"])

		with self.assertRaises(frappe.TimestampMismatchError):
			catalog.save_category(renamed["name"], category["version"], {"label": "stale"})
		with self.assertRaises(frappe.PermissionError):
			catalog.delete_category(catalog.item_group_root(), "")
		frappe.db.set_value("Item", self.item, "item_group", catalog.item_group_root())
		deletable = catalog.create_category("Delete " + self.token)
		self.assertTrue(catalog.delete_category(deletable["name"], deletable["version"])["deleted"])

	def test_category_metadata_edits_without_renaming_and_hierarchy_guards(self):
		parent = catalog.create_category("Move parent " + self.token, is_group=True)
		category = catalog.create_category("Move child " + self.token)
		moved = catalog.save_category(
			category["name"],
			category["version"],
			{"label": category["label"], "parent": parent["name"], "is_group": True},
		)
		self.assertEqual(moved["name"], category["name"])
		self.assertEqual(moved["parent"], parent["name"])
		self.assertTrue(moved["is_group"])
		leaf = catalog.save_category(
			moved["name"], moved["version"], {"label": moved["label"], "is_group": False}
		)
		self.assertFalse(leaf["is_group"])
		with self.assertRaises(frappe.ValidationError):
			catalog.save_category(
				leaf["name"], leaf["version"], {"label": leaf["label"], "parent": leaf["name"]}
			)

		branch = catalog.create_category("Cycle branch " + self.token, is_group=True)
		child = catalog.create_category("Cycle child " + self.token, branch["name"], is_group=True)
		branch = catalog.category_metadata(frappe.get_doc("Item Group", branch["name"]))
		with self.assertRaises(frappe.ValidationError):
			catalog.save_category(
				branch["name"], branch["version"], {"label": branch["label"], "parent": child["name"]}
			)
		with self.assertRaises(frappe.ValidationError):
			catalog.save_category(
				branch["name"], branch["version"], {"label": branch["label"], "is_group": False}
			)
		latest_branch = catalog.category_metadata(frappe.get_doc("Item Group", branch["name"]))
		with self.assertRaises(NestedSetChildExistsError):
			catalog.delete_category(latest_branch["name"], latest_branch["version"])

		permission = frappe.permissions.has_permission
		with patch(
			"frappe.permissions.has_permission",
			side_effect=lambda doctype, ptype="read", *args, **kwargs: (
				False
				if doctype == "Item Group" and ptype in ("create", "write", "delete")
				else permission(doctype, ptype, *args, **kwargs)
			),
		):
			with self.assertRaises(frappe.PermissionError):
				catalog.create_category("Denied " + self.token)
			with self.assertRaises(frappe.PermissionError):
				catalog.save_category(leaf["name"], leaf["version"], {"label": leaf["label"] + " edited"})
			with self.assertRaises(frappe.PermissionError):
				catalog.delete_category(leaf["name"], leaf["version"])

	def test_uncategorized_scope_is_direct_root_or_selected_category_expansion(self):
		root = catalog.item_group_root()
		parent = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": "Scoped group " + self.token,
				"parent_item_group": root,
				"is_group": 1,
			}
		).insert()
		child = catalog.create_category("Scoped child " + self.token, parent.name)
		root_item = frappe.new_doc("Item")
		root_item.update(
			{
				"item_code": "TI-ROOT-" + self.token,
				"item_name": "Root assignment " + self.token,
				"stock_uom": "Nos",
				"item_group": root,
				"is_stock_item": 1,
			}
		)
		root_item.insert()
		child_item = frappe.new_doc("Item")
		child_item.update(
			{
				"item_code": "TI-CATEGORY-" + self.token,
				"item_name": "Category assignment " + self.token,
				"stock_uom": "Nos",
				"item_group": child["name"],
				"is_stock_item": 1,
			}
		)
		child_item.insert()
		other = catalog.create_category("Unselected " + self.token)
		frappe.db.set_value("Item", self.item, "item_group", other["name"])
		context = ReportContext(
			validate_query(
				{
					"dataset": "inventory",
					"scope": {"categories": [parent.name], "uncategorized": True},
				}
			)
		)
		self.assertTrue(context.matches_item(root_item.name))
		self.assertTrue(context.matches_item(child_item.name))
		self.assertFalse(context.matches_item(self.item))
		self.assertEqual(catalog.item_metadata(root_item)["item_group"], "")
		selected = catalog.search_items(categories=[parent.name])
		combined = catalog.search_items(categories=[parent.name], uncategorized=True)
		unrestricted = catalog.search_items()
		selected_codes = {row["item_code"] for row in selected["results"]}
		combined_codes = {row["item_code"] for row in combined["results"]}
		unrestricted_codes = {row["item_code"] for row in unrestricted["results"]}
		self.assertIn(child_item.name, selected_codes)
		self.assertNotIn(root_item.name, selected_codes)
		self.assertIn(root_item.name, combined_codes)
		self.assertIn(child_item.name, combined_codes)
		self.assertNotIn(self.item, combined_codes)
		self.assertIn(root_item.name, unrestricted_codes)
		with self.assertRaises(frappe.ValidationError):
			validate_query({"dataset": "inventory", "scope": {"uncategorized": 1}})

	def test_expired_receipt_and_batch_count_use_native_bundles(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no, item.has_expiry_date = 1, 1
		item.save()
		batch = catalog.create_batch(
			self.item, "TI-BATCH-" + self.token, add_days(nowdate(), -100), add_days(nowdate(), -10)
		)
		data = self.movement(quantity=4)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		draft = self.create(data)
		completed = self.submit(draft)
		self.assertEqual(completed.docstatus, 1)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 4)
		data = self.count_data(3, "Reviewed")
		self.assertEqual(data["ti_count_review"][0]["batch_no"], batch["name"])
		doc = counts.save_count(str(uuid4()), data)
		native_api.submit_document("Stock Reconciliation", doc.name, doc.version)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 3)

	def test_dashboard_uses_native_stock_scoped_distinct_items_and_six_expiry_buckets(self):
		self.receipt(10)
		self.submit(self.create(self.movement("Transfer", 3, self.a, self.b)))
		scope = {"warehouses": [self.root]}
		inventory = browse.dashboard_card("inventory", scope)
		self.assertEqual(sum(row["stock_qty"] for row in inventory["totals"]), 10)
		distribution = browse.dashboard_card("distribution", scope)
		self.assertEqual(distribution["item_count"], 1)
		self.assertEqual(sum(row["item_count"] for row in distribution["rows"]), 2)
		self.assertEqual(len(browse.dashboard_card("expiry", scope)["buckets"]), 6)
		self.assertEqual(browse.dashboard_card("movement", scope)["matched_count"], 2)
		self.assertIn(self.a, browse.bootstrap()["physical_leaves"])
		bootstrap = browse.bootstrap()
		self.assertIn(self.loan_leaf, {row["name"] for row in bootstrap["warehouses"]})
		permission = frappe.has_permission
		with patch(
			"frappe.has_permission",
			side_effect=lambda doctype, ptype="read", *args, **kwargs: (
				False
				if doctype == "Stock Entry" and ptype == "submit"
				else permission(doctype, ptype, *args, **kwargs)
			),
		):
			bootstrap = browse.bootstrap()
			self.assertTrue(bootstrap["operations"]["Receive"])
			self.assertTrue(bootstrap["operations"]["Return"])
			self.assertNotIn("stock_entry_submit", bootstrap["operation_requirements"]["Return"])

	def test_inventory_browser_pages_complete_totals_and_sorts_available_quantity(self):
		# Stock browse uses the same sanitized Item metadata as selectors and details.
		frappe.db.set_value("Item", self.item, "item_group", catalog.item_group_root())
		self.receipt(10)
		self.submit(self.create(self.movement("Loan", 9, self.a, self.loan_leaf, ti_borrower="Borrower")))
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "TI-BROWSE-" + self.token,
				"item_name": "Second Item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		data = self.movement(quantity=3)
		data["items"][0]["item_code"] = other.name
		self.submit(self.create(data))
		query = {
			"dataset": "inventory",
			"sortBy": "available",
			"sort": "asc",
			"scope": {"warehouses": [self.root]},
		}
		result = browse.inventory_page(query, page_length=1)
		self.assertEqual(result["matched_count"], 2)
		self.assertEqual(result["rows"][0]["code"], self.item)
		self.assertEqual(result["rows"][0]["category"], "")
		self.assertEqual(result["rows"][0]["available"], 1)
		self.assertEqual(result["rows"][0]["loaned"], 9)
		self.assertEqual(sum(row["available"] for row in result["summary"]), 4)
		self.assertEqual(result["next_start"], 1)
		self.assertEqual(browse.inventory_page(query, start=1, page_length=1)["rows"][0]["code"], other.name)
		restricted = browse.inventory_page({**query, "restrictItems": True, "itemCodes": []})
		self.assertEqual(restricted["matched_count"], 0)
		self.assertEqual(restricted["rows"], [])

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

	def test_multi_batch_native_loan_keeps_original_line_and_per_batch_outcomes(self):
		from temple_inventory.projections import report_page

		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batches = []
		for suffix, quantity in (("A", 3), ("B", 7)):
			batch = catalog.create_batch(self.item, f"TI-MULTI-{self.token}-{suffix}")
			batches.append(batch["name"])
			data = self.movement(quantity=quantity)
			data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		bundle = frappe.get_doc(
			{
				"doctype": "Serial and Batch Bundle",
				"voucher_type": "Stock Entry",
				"company": self.company,
				"item_code": self.item,
				"warehouse": self.a,
				"type_of_transaction": "Outward",
				"posting_datetime": frappe.utils.now_datetime(),
				"entries": [{"batch_no": batches[0], "qty": -2}, {"batch_no": batches[1], "qty": -3}],
			}
		).insert()
		data = self.movement("Loan", 5, self.a, self.loan_leaf, ti_borrower="Batch Borrower")
		data["items"][0].update({"serial_and_batch_bundle": bundle.name, "use_serial_batch_fields": 0})
		loan = self.submit(self.create(data))
		original_line = loan["items"][0].name
		# Another loan makes extra A stock physically available, but does not let
		# the first original line settle more A than its own allocated amount.
		second = self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="Batch Borrower")
		second["items"][0].update({"batch_no": batches[0], "use_serial_batch_fields": 1})
		self.submit(self.create(second))
		data = self.movement("Return", 3, self.loan_leaf, self.b, ti_borrower="Batch Borrower")
		data["posting_date"] = add_days(nowdate(), 1)
		data["items"][0].update(
			{
				"batch_no": batches[0],
				"use_serial_batch_fields": 1,
				"ti_original_loan": loan.name,
				"ti_original_loan_line": original_line,
				"ti_settlement_outcome": "Returned",
			}
		)
		with self.assertRaises(frappe.ValidationError):
			self.create(data)
		data["items"][0]["qty"] = 2
		second_line = dict(data["items"][0], batch_no=batches[1], qty=1)
		data["items"].append(second_line)
		self.submit(self.create(data))
		detail = native_api.loan_detail(loan.name)
		allocations = {row["batch_no"]: row for row in detail["items"][0]["allocations"]}
		self.assertEqual(allocations[batches[0]]["outstanding_qty"], 0)
		self.assertEqual(allocations[batches[1]]["outstanding_qty"], 2)
		query = {"dataset": "loans", "view": "outcomes", "loan": loan.name}
		rows = report_page(query)["rows"]
		self.assertEqual({row["original_loan_line"] for row in rows}, {original_line})
		self.assertEqual(
			{row["batch_no"]: row["outstanding"] for row in rows}, {batches[0]: 0, batches[1]: 2}
		)
		batch_history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"loan": loan.name,
				"scope": {"item": self.item},
				"batchNo": batches[1],
			},
			item_code=self.item,
			batch_no=batches[1],
		)
		self.assertTrue(batch_history["history_complete"])
		item_history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"loan": loan.name,
				"scope": {"item": self.item},
			},
			item_code=self.item,
		)
		self.assertTrue(item_history["history_complete"])
		item_query = {
			"dataset": "loans",
			"view": "items",
			"loan": loan.name,
			"scope": {"period": {"key": "custom", "from": nowdate(), "to": nowdate()}},
			"relatedPeriod": {"key": "custom", "from": "1900-01-01", "to": "1900-01-02"},
			"itemLocationKeys": [f'["{self.item}","{self.a}"]'],
		}
		item_page = browse.operation_page(item_query)
		self.assertEqual(item_page["matched_count"], 1)
		self.assertEqual(item_page["rows"][0]["stock_qty"], 2)
		self.assertEqual(item_page["rows"][0]["document_count"], 1)
		history = browse.operation_contributions(item_query, item_code=self.item, history_sort="asc")
		self.assertEqual(history["matched_count"], 2)
		self.assertTrue(history["history_complete"])
		self.assertEqual([row["quantity"] for row in history["rows"]], [3.0, -1.0])
		self.assertEqual([row["stock_uom"] for row in history["rows"]], ["Nos", "Nos"])
		self.assertEqual(history["rows"][0]["signed"], True)
		self.assertEqual([row["kind"] for row in history["rows"]], ["Loan", "Return"])
		all_item_history = browse.operation_contributions(
			item_query, item_code=self.item, history_scope="all", history_sort="asc"
		)
		self.assertEqual([row["quantity"] for row in all_item_history["rows"]], [5.0, -3.0])
		all_query = {**item_query, "includeZero": True}
		all_history = browse.operation_contributions(
			all_query, item_code=self.item, history_scope="all", history_sort="asc"
		)
		self.assertEqual([row["quantity"] for row in all_history["rows"]], [5.0, -3.0])

		settled_item = frappe.copy_doc(frappe.get_doc("Item", self.item))
		settled_item.item_code = self.item + "-SETTLED"
		settled_item.item_name = "Settled " + self.item
		settled_item.has_batch_no = settled_item.has_expiry_date = 0
		settled_item.insert()
		receipt = self.movement(quantity=2)
		receipt["items"][0]["item_code"] = settled_item.name
		self.submit(self.create(receipt))
		settled_loan_data = self.movement("Loan", 2, self.a, self.loan_leaf, ti_borrower="Settled Borrower")
		settled_loan_data["items"][0]["item_code"] = settled_item.name
		settled_loan = self.submit(self.create(settled_loan_data))
		settled_return = self.movement("Return", 2, self.loan_leaf, self.b, ti_borrower="Settled Borrower")
		settled_return["items"][0].update(
			{
				"item_code": settled_item.name,
				"ti_original_loan": settled_loan.name,
				"ti_original_loan_line": settled_loan["items"][0].name,
				"ti_settlement_outcome": "Returned",
			}
		)
		self.submit(self.create(settled_return))
		settled_query = {"dataset": "loans", "view": "items", "scope": {"item": settled_item.name}}
		self.assertEqual(browse.operation_page(settled_query)["matched_count"], 0)
		settled_page = browse.operation_page({**settled_query, "includeZero": True})
		self.assertEqual(settled_page["matched_count"], 1)
		self.assertEqual(settled_page["rows"][0]["stock_qty"], 0)
		canonical = projections.report_page(
			{
				**settled_query,
				"statuses": [0, 2],
				"loanOutcome": "lost",
				"loanStatus": "settled",
				"outstandingOnly": True,
			}
		)
		self.assertEqual(canonical["query"]["statuses"], [1])
		self.assertEqual(canonical["query"]["loanOutcome"], "all")
		self.assertEqual(canonical["query"]["loanStatus"], "all")
		self.assertFalse(canonical["query"]["outstandingOnly"])
		self.assertEqual(canonical["table"], "loan_items")
		self.assertIn("outstanding", canonical["columns"])
		self.assertIn("item_name", canonical["columns"])
		self.assertNotIn("loan_item_page", {table["id"] for table in canonical["tables"]})
		self.assertNotIn("linked_settlements", {table["id"] for table in canonical["tables"]})
		self.assertEqual(projections.report_page(settled_query)["table"], "loan_items")
		included_projection = projections.report_page({**settled_query, "includeZero": True})
		self.assertEqual(included_projection["matched_count"], settled_page["matched_count"])
		self.assertEqual(included_projection["rows"][0]["stock_qty"], settled_page["rows"][0]["stock_qty"])
		for grouping, expected in (("activity", ""), ("month", nowdate()[:7])):
			grouped = projections.report_page(
				{**settled_query, "view": "outcomes", "includeZero": True, "groupBy": [grouping]}
			)
			self.assertEqual(grouped["table"], "grouped")
			self.assertEqual(grouped["matched_count"], 1)
			self.assertEqual(grouped["rows"][0][grouping], expected)

	def test_item_history_uses_only_effective_damage_and_loss_events_after_cancellation(self):
		receipt = self.movement(quantity=4)
		receipt.update({"posting_time": "08:00:00", "ti_time_mode": "Manual"})
		self.submit(self.create(receipt))
		loan_data = self.movement("Loan", 4, self.a, self.loan_leaf, ti_borrower="History")
		loan_data.update({"posting_time": "09:00:00", "ti_time_mode": "Manual"})
		loan = self.submit(self.create(loan_data))
		damage_data = self.movement(
			"Damage", 1, self.loan_leaf, self.damaged, ti_borrower="History", posting_time="12:00:00"
		)
		damage_data["ti_time_mode"] = "Manual"
		damage_data["items"][0].update(
			{
				"ti_original_loan": loan.name,
				"ti_original_loan_line": loan["items"][0].name,
				"ti_settlement_outcome": "Damaged",
			}
		)
		damage = self.submit(self.create(damage_data))
		loss_data = self.movement(
			"Loss", 1, self.loan_leaf, None, ti_borrower="History", posting_time="10:00:00"
		)
		loss_data["ti_time_mode"] = "Manual"
		loss_data["items"][0].update(
			{
				"ti_original_loan": loan.name,
				"ti_original_loan_line": loan["items"][0].name,
				"ti_settlement_outcome": "Lost",
			}
		)
		loss = self.submit(self.create(loss_data))
		query = {"dataset": "loans", "view": "items", "loan": loan.name}
		history = browse.operation_contributions(
			query, item_code=self.item, history_scope="all", history_sort="asc"
		)
		self.assertTrue(history["history_complete"])
		self.assertEqual([row["kind"] for row in history["rows"]], ["Loan", "Loss", "Damage"])
		self.assertEqual([row["quantity"] for row in history["rows"]], [4.0, -1.0, -1.0])
		frappe.get_doc("Stock Entry", loss.name).cancel()
		updated = browse.operation_contributions(
			query, item_code=self.item, history_scope="all", history_sort="asc"
		)
		self.assertTrue(updated["history_complete"])
		self.assertEqual([row["kind"] for row in updated["rows"]], ["Loan", "Damage"])
		self.assertEqual([row["quantity"] for row in updated["rows"]], [4.0, -1.0])
		movement_history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1, 2],
				"scope": {"item": self.item},
			},
			item_code=self.item,
		)
		balance_effects = {row["document"]: row["loan_balance_effect"] for row in movement_history["rows"]}
		self.assertEqual(balance_effects[loan.name], 4.0)
		self.assertEqual(balance_effects[damage.name], -1.0)
		self.assertEqual(balance_effects[loss.name], 0.0)
		available_data = self.movement(quantity=1)
		available_data.update({"posting_time": "11:00:00", "ti_time_mode": "Manual"})
		self.submit(self.create(available_data))
		later_data = self.movement("Loan", 1, self.a, self.loan_leaf, ti_borrower="History")
		later_data.update({"posting_time": "12:00:00", "ti_time_mode": "Manual"})
		later = self.submit(self.create(later_data))
		item_history_query = {"dataset": "loans", "view": "records", "statuses": [1]}
		item_history = browse.loan_item_history(item_history_query, self.item)
		self.assertEqual(
			[row["document"] for row in item_history["rows"][:2]],
			[later.name, loan.name],
		)
		self.assertEqual(
			browse.loan_item_history(
				{**item_history_query, "restrictItems": True, "itemCodes": []}, self.item
			)["rows"],
			[],
		)
		self.assertEqual(frappe.get_doc("Stock Entry", damage.name).docstatus, 1)
		original_parent = ReportContext.parent

		def hide_damage(context, doctype, name):
			if doctype == "Stock Entry" and name == damage.name:
				return None
			return original_parent(context, doctype, name)

		with patch.object(ReportContext, "parent", hide_damage):
			incomplete = browse.operation_contributions(query, item_code=self.item, history_scope="all")
			incomplete_movement_history = browse.movement_history(
				{
					"dataset": "movements",
					"view": "lines",
					"statuses": [1, 2],
					"loan": loan.name,
					"scope": {"item": self.item},
				},
				item_code=self.item,
			)
		self.assertFalse(incomplete["history_complete"])
		self.assertFalse(incomplete_movement_history["history_complete"])

	def test_restrictive_picker_scope_clock_and_retry_safe_batch_preparation(self):
		self.receipt(3)
		self.assertEqual(catalog.search_items(self.item, item_codes=[])["matched_count"], 0)
		self.assertEqual(catalog.search_items(self.item, item_codes=[self.item])["matched_count"], 1)
		self.assertEqual(catalog.scan_code(self.a)["warehouse"]["name"], self.a)
		self.assertFalse(catalog.scan_code(self.a)["unknown"])
		self.assertEqual(catalog.scan_code(self.room_a)["warehouse"]["name"], self.a)
		self.assertEqual(catalog.operation_item(self.item)["stock"][0]["available"], 3)
		past = "2000-01-01 00:00:00"
		search_result = catalog.search_items(self.item, timestamp=past)
		item_result = catalog.operation_item(self.item, timestamp=past)
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
		first = catalog.receipt_batch(batch_item.name, batch_id, expiry_date=add_days(nowdate(), 30))
		self.assertEqual(
			catalog.receipt_batch(batch_item.name, batch_id, expiry_date=add_days(nowdate(), 30))["name"],
			first["name"],
		)
		with self.assertRaises(frappe.ValidationError):
			catalog.receipt_batch(batch_item.name, batch_id, expiry_date=add_days(nowdate(), 60))

	def test_native_operation_groups_and_contributions_page_after_complete_filtering(self):
		other = frappe.copy_doc(frappe.get_doc("Item", self.item))
		other.item_code = self.item + "-OTHER"
		other.insert()
		data = self.movement(quantity=1)
		data["items"] = [dict(data["items"][0]) for _ in range(205)]
		data["items"].append(dict(data["items"][0], item_code=other.name, qty=7))
		entry = self.submit(self.create(data))
		query = {
			"dataset": "movements",
			"scope": {"item": self.item},
			"record": entry.name,
			"sortBy": "item_name",
			"sort": "desc",
		}
		page = browse.operation_page(query, page_length=1)
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["rows"][0]["stock_qty"], 205)
		self.assertEqual(page["rows"][0]["totals"][0]["stock_qty"], 205)
		self.assertEqual(page["summary"]["document_count"], 1)
		self.assertEqual(page["summary"]["item_count"], 1)
		detail = browse.operation_contributions(query, item_code=self.item)
		self.assertEqual(detail["matched_count"], 1)
		self.assertEqual(len(detail["rows"]), 1)
		self.assertEqual(detail["rows"][0]["quantity"], 205.0)
		self.assertEqual(detail["rows"][0]["stock_uom"], "Nos")
		self.assertEqual(detail["rows"][0]["doctype"], "Stock Entry")
		self.assertIn("available_effect", detail["rows"][0])
		self.assertIn("docstatus", detail["rows"][0])
		self.assertEqual(browse.operation_contributions(query, item_code=self.item, start=200)["rows"], [])
		record_page = browse.operation_page(query, records=True)
		record = record_page["rows"][0]
		self.assertNotIn("allocation_count", record)
		self.assertEqual(record["whole"]["item_count"], 2)
		self.assertEqual(record["whole"]["quantities"], [{"uom": "Nos", "qty": 212}])
		self.assertNotIn("matching_totals", record)
		self.assertEqual(record["whole"]["available_effects"], [{"uom": "Nos", "qty": 212}])
		self.assertEqual(record_page["totals"][0]["stock_qty"], 212)
		self.assertEqual(record_page["totals"][0]["available_effect"], 212)
		second_entry = self.submit(self.create(self.movement("Receive", 3, None, self.a)))
		all_items = {"dataset": "movements", "view": "lines", "scope": {"item": self.item}}
		first = browse.operation_contributions(all_items, item_code=self.item, page_length=1)
		second_page = browse.operation_contributions(all_items, item_code=self.item, start=1, page_length=1)
		self.assertEqual(first["matched_count"], 2)
		self.assertNotEqual(first["rows"][0]["document"], second_page["rows"][0]["document"])
		self.assertIn(second_entry.name, {first["rows"][0]["document"], second_page["rows"][0]["document"]})
		self.assertEqual(page["analysis"]["month"]["matched_count"], 1)
		self.assertEqual(page["analysis"]["month"]["rows"][0]["stock_qty"], 205)
		self.assertEqual(
			browse.operation_page({**query, "restrictItems": True, "itemCodes": []})["matched_count"], 0
		)

	def test_more_summary_counts_a_native_draft_once_across_stock_units(self):
		before = browse.more_summary()["draft_count"]
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "TI-MORE-" + self.token,
				"item_name": "Other unit",
				"stock_uom": "Kg",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		data = self.movement(quantity=2)
		data["items"].append(
			{
				"item_code": other.name,
				"qty": 3,
				"uom": "Kg",
				"conversion_factor": 1,
				"t_warehouse": self.a,
				"basic_rate": 10,
			}
		)
		draft = self.create(data)
		self.assertEqual(browse.more_summary()["draft_count"], before + 1)
		page = browse.native_drafts({"dataset": "movements", "record": draft.name}, page_length=1)
		self.assertEqual(page["matched_count"], 1)
		self.assertIsNone(page["next_start"])
		row = page["rows"][0]
		self.assertEqual(row["whole"]["line_count"], 2)
		self.assertEqual(row["whole"]["version"], draft.version)
		self.assertEqual(row["whole"]["quantities"], [{"uom": "Kg", "qty": 3}, {"uom": "Nos", "qty": 2}])
		self.assertTrue(row["whole"]["editable"])
		self.assertNotIn("can_delete", row["whole"])
		native_api.delete_document("Stock Entry", draft.name, draft.version)
		self.assertEqual(browse.more_summary()["draft_count"], before)
		self.assertEqual(
			browse.native_drafts({"dataset": "movements", "record": draft.name})["matched_count"], 0
		)

	def test_native_draft_filters_match_one_allocation_and_counts_keep_native_identity(self):
		self.receipt(10)
		self.submit(self.create(self.movement("Transfer", 4, self.a, self.b)))
		data = self.movement("Transfer", 2, self.a, self.b)
		data["items"].append({**data["items"][0], "s_warehouse": self.b, "t_warehouse": self.a})
		draft = self.create(data)
		query = {
			"dataset": "movements",
			"record": draft.name,
			"scope": {"sources": [self.a], "destinations": [self.a]},
		}
		self.assertEqual(browse.native_drafts(query)["matched_count"], 0)
		query["scope"]["destinations"] = [self.b]
		row = browse.native_drafts(query)["rows"][0]
		self.assertEqual(row["allocation_count"], 1)
		self.assertEqual(row["whole"]["line_count"], 2)
		count = counts.save_count(str(uuid4()), self.count_data(5, "Reviewed"))
		page = browse.counts_page({"dataset": "counts", "record": count.name, "statuses": [0]})
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["rows"][0]["doctype"], "Stock Reconciliation")
		self.assertEqual(page["rows"][0]["whole"]["version"], count.version)
		self.assertEqual(browse.counts_page({"dataset": "counts", "record": count.name})["matched_count"], 0)

	def test_movement_history_narrows_available_effect_to_explicit_warehouse(self):
		self.receipt(10)
		transfer = self.submit(self.create(self.movement("Transfer", 3, self.a, self.b)))
		base = {
			"dataset": "movements",
			"view": "lines",
			"statuses": [1],
			"scope": {"item": self.item, "warehouses": [self.root]},
		}
		whole_group = browse.movement_history(base, item_code=self.item)
		narrow_location = browse.movement_history(base, item_code=self.item, warehouse=self.a)
		group_transfer = next(row for row in whole_group["rows"] if row["document"] == transfer.name)
		narrow_transfer = next(row for row in narrow_location["rows"] if row["document"] == transfer.name)
		self.assertAlmostEqual(group_transfer["available_effect"], 0)
		self.assertAlmostEqual(narrow_transfer["available_effect"], -3)

		# Two reconciliations move the available-stock basis between leaves while
		# keeping the inherited group total unchanged.
		def reconcile(warehouse, delta):
			posting = now_datetime()
			baseline = counts.count_baseline([warehouse], str(posting), "Selected", [self.item])
			rows = copy.deepcopy(baseline["rows"])
			for row in rows:
				row.update(
					{
						"actual_qty": float(row["baseline_qty"]) + delta,
						"review_state": "Reviewed",
						"reason": "调整效果测试",
					}
				)
			data = {
				"company": self.company,
				"posting_date": str(posting.date()),
				"posting_time": str(posting.time()),
				"ti_count_warehouses": [warehouse],
				"ti_count_scope": "Selected",
				"ti_count_items": [self.item],
				"ti_baseline_timestamp": baseline["timestamp"],
				"ti_baseline_fingerprint": baseline["fingerprint"],
				"ti_count_review": rows,
			}
			draft = counts.save_count(str(uuid4()), data)
			native_api.submit_document("Stock Reconciliation", draft.name, draft.version)

		# A has 7 after transfer, B has 3; adjustment lines swap those balances.
		reconcile(self.a, -3)
		reconcile(self.b, 3)
		reconciliations_group = browse.movement_history(base, item_code=self.item)
		reconciliations_a = browse.movement_history(base, item_code=self.item, warehouse=self.a)
		reconcile_group_effect = sum(
			row["available_effect"] for row in reconciliations_group["rows"] if row["kind"] == "Reconcile"
		)
		reconcile_a_effect = sum(
			row["available_effect"] for row in reconciliations_a["rows"] if row["kind"] == "Reconcile"
		)
		self.assertAlmostEqual(reconcile_group_effect, 0)
		self.assertAlmostEqual(reconcile_a_effect, -3)
		unrelated = browse.movement_history(
			{**base, "scope": {"item": self.item, "warehouses": [self.b]}},
			item_code=self.item,
			warehouse=self.a,
		)
		self.assertEqual(unrelated["rows"], [])

	def test_history_endpoints_sort_complete_matching_results_before_paging(self):
		self.receipt(10)
		issue = self.movement("Issue", 3, self.a, None)
		self.submit(self.create(issue))
		movement_query = {
			"dataset": "movements",
			"view": "lines",
			"statuses": [1],
			"scope": {"item": self.item},
			"sortBy": "stock_qty",
			"sort": "asc",
		}
		movement_first = browse.movement_history(
			movement_query, item_code=self.item, start=0, page_length=1, sort_by="stock_qty", sort="asc"
		)
		movement_second = browse.movement_history(
			movement_query, item_code=self.item, start=1, page_length=1, sort_by="stock_qty", sort="asc"
		)
		self.assertEqual(movement_first["matched_count"], movement_second["matched_count"])
		self.assertLessEqual(movement_first["rows"][0]["quantity"], movement_second["rows"][0]["quantity"])
		self.assertEqual(
			movement_first["rows"][0]["id"],
			browse.movement_history(
				movement_query, item_code=self.item, page_length=1, sort_by="stock_qty", sort="asc"
			)["rows"][0]["id"],
		)

		for quantity in (1, 4):
			self.submit(
				self.create(
					self.movement(
						"Loan", quantity, self.a, self.loan_leaf, ti_borrower="History Sort Borrower"
					)
				)
			)
		loan_query = {
			"dataset": "loans",
			"view": "outcomes",
			"statuses": [1],
			"scope": {"item": self.item},
			"sortBy": "borrowed",
			"sort": "asc",
		}
		loan_first = browse.loan_item_history(
			loan_query, self.item, start=0, page_length=1, sort_by="borrowed", sort="asc"
		)
		loan_second = browse.loan_item_history(
			loan_query, self.item, start=1, page_length=1, sort_by="borrowed", sort="asc"
		)
		self.assertGreaterEqual(loan_second["rows"][0]["borrowed"], loan_first["rows"][0]["borrowed"])
		self.assertEqual(
			loan_first["rows"][0]["id"],
			browse.loan_item_history(loan_query, self.item, page_length=1, sort_by="borrowed", sort="asc")[
				"rows"
			][0]["id"],
		)

	def test_record_exports_expand_partial_item_matches_to_whole_movement_and_loan_documents(self):
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-REPORT-UNIT-{self.token}",
				"item_name": "Report unit test item",
				"item_group": "All Item Groups",
				"stock_uom": "Kg",
				"is_stock_item": 1,
			}
		).insert()
		receipt_data = self.movement("Receive", 10)
		receipt_data["items"].append(
			{**receipt_data["items"][0], "item_code": other.name, "qty": 10, "transfer_qty": 10, "uom": "Kg"}
		)
		self.submit(self.create(receipt_data))
		movement_data = self.movement("Transfer", 5, self.a, self.b)
		movement_data["items"].append(
			{**movement_data["items"][0], "item_code": other.name, "qty": 2, "transfer_qty": 2, "uom": "Kg"}
		)
		movement = self.submit(self.create(movement_data))
		history = browse.movement_history(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item},
			},
			item_code=self.item,
			start=0,
			page_length=1,
		)
		self.assertEqual(history["matched_count"], 2)
		self.assertEqual(len(history["rows"]), 1)
		self.assertEqual(history["next_start"], 1)
		self.assertEqual(history["rows"][0]["item_code"], self.item)
		self.assertEqual(history["rows"][0]["source_warehouse"], self.a)
		self.assertEqual(history["rows"][0]["destination_warehouse"], self.b)
		self.assertAlmostEqual(history["rows"][0]["quantity"], 5)
		self.assertAlmostEqual(history["rows"][0]["available_effect"], 0)
		group_scoped = browse.movement_history(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item, "warehouses": [self.root]},
			},
			item_code=self.item,
			warehouse=self.a,
		)
		self.assertIn(movement.name, {row["document"] for row in group_scoped["rows"]})
		unrelated_warehouse = browse.movement_history(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item, "warehouses": [self.b]},
			},
			item_code=self.item,
			warehouse=self.a,
		)
		self.assertEqual(unrelated_warehouse["rows"], [])
		conflicting_item = browse.movement_history(
			{"dataset": "movements", "view": "records", "scope": {"item": "OTHER-ITEM"}},
			item_code=self.item,
		)
		self.assertEqual(conflicting_item["rows"], [])
		empty_restriction = browse.movement_history(
			{"dataset": "movements", "view": "records", "restrictItems": True, "itemCodes": []},
			item_code=self.item,
		)
		self.assertEqual(empty_restriction["rows"], [])
		conflicting_batch = browse.movement_history(
			{"dataset": "movements", "view": "records", "batchNo": "OTHER-BATCH"},
			item_code=self.item,
			batch_no="TI-BATCH-REQUEST",
		)
		self.assertEqual(conflicting_batch["rows"], [])
		movement_page = browse.report_page(
			{
				"dataset": "movements",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item},
			}
		)
		movement_rows = [row for row in movement_page["rows"] if row["document"] == movement.name]
		self.assertEqual({row["stock_uom"]: row["stock_qty"] for row in movement_rows}, {"Nos": 5, "Kg": 2})
		self.assertEqual(sum(row["available_effect"] for row in movement_rows), 0)

		loan_data = self.movement(
			"Loan", 5, self.a, self.loan_leaf, ti_borrower="报告测试借用方", ti_activity=self.activity.name
		)
		loan_data["items"].append(
			{**loan_data["items"][0], "item_code": other.name, "qty": 3, "transfer_qty": 3, "uom": "Kg"}
		)
		loan = self.submit(self.create(loan_data))
		loan_page = browse.report_page(
			{
				"dataset": "loans",
				"view": "records",
				"statuses": [1],
				"scope": {"item": self.item},
			}
		)
		loan_rows = [row for row in loan_page["rows"] if row["document"] == loan.name]
		self.assertEqual({row["stock_uom"]: row["borrowed"] for row in loan_rows}, {"Nos": 5, "Kg": 3})
		self.assertEqual({row["stock_uom"]: row["outstanding"] for row in loan_rows}, {"Nos": 5, "Kg": 3})

	def test_available_effects_use_selected_loaned_and_damaged_leaves_consistently(self):
		self.receipt(10)
		damage = self.submit(self.create(self.movement("Damage", 2, self.a, self.damaged)))
		loan = self.loan(3)
		transfer = self.submit(self.create(self.movement("Transfer", 2, self.a, self.b)))
		for doc, default_effect, scoped_effect, warehouse in (
			(damage, -2, 2, self.damaged),
			(loan, -3, 3, self.loan_leaf),
			(transfer, 0, -2, self.a),
		):
			base = {"dataset": "movements", "view": "records", "statuses": [1], "record": doc.name}
			default = browse.operation_page(base, records=True)["rows"][0]["whole"]["available_effects"]
			scoped = browse.operation_page({**base, "scope": {"warehouses": [warehouse]}}, records=True)[
				"rows"
			][0]["whole"]["available_effects"]
			self.assertEqual(default, [{"uom": "Nos", "qty": default_effect}])
			self.assertEqual(scoped, [{"uom": "Nos", "qty": scoped_effect}])

		line_query = {
			"dataset": "movements",
			"view": "lines",
			"statuses": [1],
			"scope": {"warehouses": [self.damaged]},
		}
		line = browse.report_page(line_query)["rows"]
		damage_line = next(row for row in line if row["document"] == damage.name)
		self.assertEqual(damage_line["available_effect"], 2)

	def test_expiry_only_batch_keeps_blank_manufacturing_date_and_can_be_received(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(
			self.item,
			f"TI-EXPIRY-ONLY-{self.token}",
			expiry_date=add_days(nowdate(), 30),
		)
		self.assertEqual(batch["manufacturing_date"], "")
		data = self.movement(quantity=1)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		expired = catalog.create_batch(
			self.item,
			f"TI-EXPIRED-ONLY-{self.token}",
			expiry_date=add_days(nowdate(), -1),
		)
		self.assertEqual(expired["manufacturing_date"], "")
		self.assertEqual(expired["expiry_date"], add_days(nowdate(), -1))
		expired_receipt = self.movement(quantity=1)
		expired_receipt["items"][0].update({"batch_no": expired["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(expired_receipt))
		with self.assertRaises(frappe.ValidationError):
			catalog.create_batch(
				self.item,
				f"TI-REVERSED-DATES-{self.token}",
				manufacturing_date=add_days(nowdate(), -1),
				expiry_date=add_days(nowdate(), -2),
			)

	def test_expiry_browser_has_distinct_batch_facets_native_search_and_inclusive_dates(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batches = []
		for index, days in enumerate((-10, 0, 10, None)):
			batch = catalog.create_batch(
				self.item,
				f"TI-EXPIRY-{self.token}-{index}",
				manufacturing_date=add_days(nowdate(), -100),
				expiry_date=add_days(nowdate(), days) if days is not None else None,
			)
			batches.append(batch["name"])
			data = self.movement(quantity=4)
			data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		data = self.movement("Transfer", 2, self.a, self.b)
		data["items"][0].update({"batch_no": batches[1], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		batch_detail = catalog.batch_details(batches[1])
		batch_metadata = catalog.batch_metadata(batches[1])
		self.assertEqual(batch_metadata["name"], batch_detail["name"])
		self.assertNotIn("locations", batch_metadata)
		self.assertNotIn("history", batch_metadata)
		self.assertEqual(batch_detail["item_code"], self.item)
		self.assertTrue(batch_detail["can_edit"])
		self.assertEqual({row["batch_no"] for row in batch_detail["locations"]["rows"]}, {batches[1]})
		location_page = catalog.batch_locations(batches[1], start=0, page_length=1)
		self.assertGreaterEqual(location_page["matched_count"], 1)
		sorted_locations = catalog.batch_locations(
			batches[1], start=0, page_length=100, sort_by="available", sort="asc"
		)
		self.assertEqual(
			[float(row["available"]) for row in sorted_locations["rows"]],
			sorted(float(row["available"]) for row in sorted_locations["rows"]),
		)
		self.assertEqual(batch_detail["history"]["matched_count"], 2)
		before_batch_qty = {
			warehouse: get_batch_qty(batch_no=batches[1], warehouse=warehouse, for_stock_levels=True)
			for warehouse in (self.a, self.b)
		}
		old_version = batch_detail["version"]
		with self.assertRaises(frappe.ValidationError):
			catalog.save_batch(
				batches[1],
				old_version,
				{
					"manufacturing_date": add_days(nowdate(), -1),
					"expiry_date": add_days(nowdate(), -2),
					"description": "Invalid",
				},
			)
		batch_class = type(frappe.get_doc("Batch", batches[1]))
		check_permission = batch_class.check_permission
		with patch.object(
			batch_class,
			"check_permission",
			side_effect=lambda permission="read", *args, **kwargs: (
				(_ for _ in ()).throw(frappe.PermissionError("Batch write denied"))
				if permission == "write"
				else check_permission(permission, *args, **kwargs)
			),
		):
			with self.assertRaises(frappe.PermissionError):
				catalog.save_batch(
					batches[1],
					old_version,
					{"manufacturing_date": "", "expiry_date": "", "description": "Denied"},
				)
		item_class = type(frappe.get_doc("Item", self.item))
		item_check_permission = item_class.check_permission
		with patch.object(
			item_class,
			"check_permission",
			side_effect=lambda permission="read", *args, **kwargs: (
				(_ for _ in ()).throw(frappe.PermissionError("Item read denied"))
				if permission == "read"
				else item_check_permission(permission, *args, **kwargs)
			),
		):
			with self.assertRaises(frappe.PermissionError):
				catalog.batch_details(batches[1])
		saved_batch = catalog.save_batch(
			batches[1],
			old_version,
			{
				"manufacturing_date": batch_detail["manufacturing_date"],
				"expiry_date": batch_detail["expiry_date"],
				"description": "Reviewed lot",
			},
		)
		self.assertEqual(saved_batch["description"], "Reviewed lot")
		self.assertEqual(
			{
				warehouse: get_batch_qty(batch_no=batches[1], warehouse=warehouse, for_stock_levels=True)
				for warehouse in (self.a, self.b)
			},
			before_batch_qty,
		)
		with self.assertRaises(frappe.TimestampMismatchError):
			catalog.save_batch(
				batches[1], old_version, {"manufacturing_date": "", "expiry_date": "", "description": "Stale"}
			)
		query = {"dataset": "expiry", "scope": {"item": self.item}, "sortBy": "expiry_date"}
		page = browse.expiry_page(query, page_length=1)
		self.assertEqual(page["matched_count"], 5)
		self.assertEqual(page["batch_count"], 4)
		self.assertEqual(page["item_count"], 1)
		self.assertEqual(page["next_start"], 1)
		self.assertEqual(page["facets"], {"all": 4, "expired": 1, "unexpired": 2, "undated": 1})
		self.assertEqual(sum(row["available"] for row in page["totals"]), 16)
		self.assertEqual(page["analysis"]["warehouse"]["matched_count"], 2)
		self.assertEqual(browse.expiry_page({**query, "expiryWindow": "unexpired"})["batch_count"], 2)
		self.assertEqual(browse.expiry_page({**query, "expiryWindow": "undated"})["batch_count"], 1)
		search = browse.expiry_page({**query, "search": batches[1]})
		self.assertEqual(search["matched_count"], 2)
		self.assertEqual(search["facets"], {"all": 1, "expired": 0, "unexpired": 1, "undated": 0})
		exact_batch = browse.expiry_page({**query, "batchNo": batches[1]})
		self.assertEqual(exact_batch["matched_count"], 2)
		self.assertEqual({row["batch_no"] for row in exact_batch["rows"]}, {batches[1]})
		self.assertEqual(browse.expiry_page({**query, "batchNo": batches[1] + "-other"})["matched_count"], 0)
		exact = browse.expiry_page(
			{**query, "restrictAllocations": True, "allocationKeys": [search["rows"][0]["id"]]}
		)
		self.assertEqual(exact["matched_count"], 1)
		self.assertEqual(exact["rows"][0]["batch_no"], batches[1])
		window = {
			**query,
			"expiryWindow": "expired",
			"scope": {
				"item": self.item,
				"period": {"key": "custom", "from": nowdate(), "to": add_days(nowdate(), 1)},
			},
		}
		self.assertEqual(browse.expiry_page(window)["matched_count"], 0)
		self.assertEqual(browse.expiry_page(window)["facets"]["unexpired"], 1)
		self.assertEqual(
			browse.expiry_page({**query, "restrictAllocations": True, "allocationKeys": []})["matched_count"],
			0,
		)

	def test_selective_batch_count_can_review_historical_zero_without_losing_its_identity(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, "TI-ZERO-" + self.token)
		data = self.movement(quantity=2)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		data = self.movement("Issue", 2, self.a)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		data = self.count_data(1, "Reviewed")
		query = {"dataset": "expiry", "scope": {"item": self.item}}
		self.assertEqual(browse.expiry_page(query)["batch_count"], 0)
		zero = browse.expiry_page({**query, "includeZero": True})
		self.assertEqual(zero["batch_count"], 1)
		self.assertEqual(zero["rows"][0]["batch_no"], batch["name"])
		self.assertEqual(zero["rows"][0]["stock_qty"], 0)
		self.assertEqual(data["ti_count_review"][0]["batch_no"], batch["name"])
		self.assertEqual(data["ti_count_review"][0]["baseline_qty"], 0)
		draft = counts.save_count(str(uuid4()), data)
		completed = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		self.assertEqual(completed["items"][0].valuation_rate, 10)
		self.assertEqual(get_batch_qty(batch_no=batch["name"], warehouse=self.a, for_stock_levels=True), 1)


def run():
	names = [name for name in CatalogTests.__dict__ if name.startswith("test_")]
	result = unittest.TextTestRunner(verbosity=2).run(
		unittest.TestSuite(CatalogTests(name) for name in sorted(names))
	)
	if not result.wasSuccessful():
		raise AssertionError(
			f"Catalog integration failed: {len(result.failures)} failures, {len(result.errors)} errors"
		)
	return {"tests": result.testsRun, "failures": 0, "errors": 0}
