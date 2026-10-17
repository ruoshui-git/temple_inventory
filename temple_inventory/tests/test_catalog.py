"""Native supporting records, full-dataset search and dashboard integration."""

import base64
import unittest
from unittest.mock import patch
from uuid import uuid4

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from frappe.utils import add_days, nowdate

from temple_inventory import browse, catalog, conversions, counts, native_api, native_files
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogTests(NativeDocumentTests):
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
		result = catalog.search_items(self.item, in_stock_only=True, warehouse=self.a)
		self.assertEqual(result["matched_count"], 1)
		self.assertEqual(result["results"][0]["stock"][0]["available"], 3)

	def test_reference_creation_preserves_parent_and_whole_number_setting(self):
		parent = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": "Parent " + self.token,
				"parent_item_group": "All Item Groups",
				"is_group": 1,
			}
		).insert()
		child = catalog.create_category("Child " + self.token, parent.name)
		self.assertEqual(child["parent"], parent.name)
		unit = catalog.create_uom("Unit " + self.token, True)
		self.assertTrue(unit["must_be_whole_number"])
		with self.assertRaises(frappe.DuplicateEntryError):
			catalog.create_uom(unit["name"], False)

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
			self.assertFalse(bootstrap["operation_requirements"]["Return"]["stock_entry_submit"])

	def test_inventory_browser_pages_complete_totals_and_sorts_available_quantity(self):
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
			"sortBy": "quantity",
			"sort": "asc",
			"scope": {"warehouses": [self.root]},
		}
		result = browse.inventory_page(query, page_length=1)
		self.assertEqual(result["matched_count"], 2)
		self.assertEqual(result["rows"][0]["code"], self.item)
		self.assertEqual(result["rows"][0]["available"], 1)
		self.assertEqual(result["rows"][0]["loaned"], 9)
		self.assertEqual(sum(row["available"] for row in result["summary"]), 4)
		self.assertEqual(result["next_start"], 1)
		self.assertEqual(browse.inventory_page(query, start=1, page_length=1)["rows"][0]["code"], other.name)
		restricted = browse.inventory_page({**query, "restrictItems": True, "itemCodes": []})
		self.assertEqual(restricted["matched_count"], 0)
		self.assertEqual(restricted["rows"], [])

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

	def test_restrictive_picker_scope_clock_and_retry_safe_batch_preparation(self):
		self.receipt(3)
		self.assertEqual(catalog.search_items(self.item, item_codes=[])["matched_count"], 0)
		self.assertEqual(catalog.search_items(self.item, item_codes=[self.item])["matched_count"], 1)
		self.assertEqual(catalog.scan_code(self.a)["warehouse"]["name"], self.a)
		self.assertFalse(catalog.scan_code(self.a)["unknown"])
		self.assertEqual(catalog.operation_item(self.item)["stock"][0]["available"], 3)
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
			"sortBy": "date",
			"sort": "desc",
		}
		page = browse.operation_page(query, page_length=1)
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["rows"][0]["stock_qty"], 205)
		self.assertEqual(page["rows"][0]["totals"][0]["stock_qty"], 205)
		self.assertEqual(page["summary"]["document_count"], 1)
		self.assertEqual(page["summary"]["item_count"], 1)
		detail = browse.operation_contributions(query, item_code=self.item)
		self.assertEqual(detail["matched_count"], 205)
		self.assertEqual(len(detail["rows"]), 30)
		self.assertEqual(
			len(browse.operation_contributions(query, item_code=self.item, start=200)["rows"]), 5
		)
		record = browse.operation_page(query, records=True)["rows"][0]
		self.assertEqual(record["allocation_count"], 205)
		self.assertEqual(record["whole"]["item_count"], 2)
		self.assertEqual(record["whole"]["quantities"], [{"uom": "Nos", "qty": 212}])
		self.assertNotIn("stock_qty", record)
		self.assertEqual(record["matching_totals"], [{"stock_uom": "Nos", "stock_qty": 205}])
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
		self.assertTrue(row["whole"]["can_delete"])
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
		self.assertEqual(row["matching_totals"][0]["stock_qty"], 2)
		count = counts.save_count(str(uuid4()), self.count_data(5, "Reviewed"))
		page = browse.counts_page({"dataset": "counts", "record": count.name, "statuses": [0]})
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["rows"][0]["doctype"], "Stock Reconciliation")
		self.assertEqual(page["rows"][0]["whole"]["version"], count.version)
		self.assertEqual(browse.counts_page({"dataset": "counts", "record": count.name})["matched_count"], 0)

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
		query = {"dataset": "expiry", "scope": {"item": self.item}, "sortBy": "date"}
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
