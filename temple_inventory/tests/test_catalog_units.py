"""Native supporting records, full-dataset search and dashboard integration."""

import json
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty

from temple_inventory import (
	browse,
	catalog,
	conversions,
	native_api,
	uom_labels,
)
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogUnitsTests(NativeDocumentTests):
	def test_curated_uom_labels_are_unique_and_match_erpnext_builtins(self):
		data_path = Path(frappe.get_app_path("erpnext")) / "setup/setup_wizard/data/uom_data.json"
		with data_path.open(encoding="utf-8") as source:
			builtins = {row["uom_name"] for row in json.load(source)}
		labels = list(uom_labels.DEFAULT_LABELS.values())
		self.assertEqual(len(labels), len({label.casefold() for label in labels}))
		self.assertEqual(set(uom_labels.DEFAULT_LABELS) - builtins, set())

	def test_create_uom_resolves_existing_native_name_or_display_label(self):
		name = f"TI-UOM-RESOLVE-{self.token}"
		frappe.get_doc({"doctype": "UOM", "uom_name": name, "ti_label": "Curated Label"}).insert()
		for requested_name, display_label in ((" curated label ", "Other"), ("New Native", name.lower())):
			result = catalog.create_uom(requested_name, True, display_label)
			self.assertEqual(result, {"name": name, "label": "Curated Label", "must_be_whole_number": False})
		self.assertFalse(frappe.db.exists("UOM", "New Native"))

	def test_uom_bootstrap_includes_disabled_units_and_returns_category(self):
		unit_name = f"TI-Count-{self.token}"
		catalog.create_uom(unit_name, must_be_whole_number=True)
		enabled_name = f"TI-Count-Enabled-{self.token}"
		catalog.create_uom(enabled_name, must_be_whole_number=True)
		frappe.get_doc("UOM", unit_name).db_set("enabled", 0)
		rows = browse.bootstrap()["uoms"]
		names = [row["name"] for row in rows]
		self.assertIn(unit_name, names)
		self.assertFalse(next(row for row in rows if row["name"] == unit_name)["enabled"])
		self.assertIn(enabled_name, names)
		used = set(
			row[0]
			for row in frappe.db.sql(
				"""select stock_uom from `tabItem` union
				select uom from `tabUOM Conversion Detail` where parenttype='Item'"""
			)
		)
		self.assertGreater(
			names.index(enabled_name), max(names.index(name) for name in used if name in names)
		)
		unused_measures = set(uom_labels.COMMON_MEASURES) - used
		if any(name in names for name in unused_measures):
			self.assertLess(
				names.index(enabled_name),
				min(names.index(name) for name in unused_measures if name in names),
			)
		self.assertTrue(all("category" in row for row in rows))
		self.assertTrue(all("label" in row for row in rows))
		self.assertEqual(rows, uom_labels.ranked_uoms())

	def test_uom_labels_seed_blank_only_and_skip_clashes(self):
		name = f"TI-LABEL-{self.token}"
		clashing = f"TI-LABEL-CLASH-{self.token}"
		frappe.get_doc({"doctype": "UOM", "uom_name": name}).insert()
		frappe.get_doc({"doctype": "UOM", "uom_name": clashing, "ti_label": "curated"}).insert()
		with patch.dict(uom_labels.DEFAULT_LABELS, {name: "单位甲", clashing: "单位乙"}):
			uom_labels.seed_labels()
			self.assertEqual(frappe.db.get_value("UOM", name, "ti_label"), "单位甲")
			self.assertEqual(frappe.db.get_value("UOM", clashing, "ti_label"), "curated")
			frappe.get_doc({"doctype": "UOM", "uom_name": "单位乙"}).insert()
			frappe.db.set_value("UOM", clashing, "ti_label", None)
			uom_labels.seed_labels()
			self.assertFalse(frappe.db.get_value("UOM", clashing, "ti_label"))

	def test_uom_name_and_label_clashes_are_case_insensitive_and_skip_disabled(self):
		existing = f"TI-CLASH-{self.token}"
		frappe.get_doc({"doctype": "UOM", "uom_name": existing, "ti_label": "Visible Label"}).insert()
		for values in (
			{"uom_name": "visible label"},
			{"uom_name": f"TI-NEW-{self.token}", "ti_label": existing.lower()},
		):
			with self.assertRaises(frappe.ValidationError) as error:
				frappe.get_doc({"doctype": "UOM", **values}).insert()
			self.assertIn(existing, str(error.exception))
		frappe.db.set_value("UOM", existing, "enabled", 0)
		frappe.get_doc({"doctype": "UOM", "uom_name": "visible label"}).insert()

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
		self.assertTrue(row["item_name"])
		self.assertEqual(row["whole"]["item_name"], row["item_name"])
		self.assertEqual(row["whole"]["version"], draft.version)
		self.assertEqual(row["whole"]["quantities"], [{"uom": "Kg", "qty": 3}, {"uom": "Nos", "qty": 2}])
		self.assertTrue(row["whole"]["editable"])
		self.assertNotIn("can_delete", row["whole"])
		native_api.delete_document("Stock Entry", draft.name, draft.version)
		self.assertEqual(browse.more_summary()["draft_count"], before)
		self.assertEqual(
			browse.native_drafts({"dataset": "movements", "record": draft.name})["matched_count"], 0
		)
