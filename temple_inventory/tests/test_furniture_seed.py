"""Regression coverage for empty baseline and the guarded furniture seed."""

import hashlib
import io
import unittest
from unittest.mock import patch

import frappe
from PIL import Image

from temple_inventory import furniture_seed, native_samples, warehouse_names, warehouses
from temple_inventory.tests.test_native_documents import NativeDocumentTests


def _jpeg(color):
	buffer = io.BytesIO()
	Image.new("RGB", (8, 8), color).save(buffer, format="JPEG")
	return buffer.getvalue()


def _synthetic_package():
	photos = {}
	items = []
	entries = []
	stock = []
	for candidate, room, qty, color in (
		("T01", "A01", 2, "red"),
		("T01", "C-Hall", 1, "blue"),
		("C15", "A06", 2, "green"),
		("C16", "A06", 1, "yellow"),
	):
		seed = f"TEST-{candidate}"
		if not any(item["seed_key"] == seed for item in items):
			photo_bytes = _jpeg(color)
			photo_id = f"PHOTO-{candidate}"
			path = f"media/{photo_id}.jpg"
			photos[path] = photo_bytes
			items.append(
				{
					"seed_key": seed,
					"candidate_code": candidate,
					"item_name": f"Synthetic {candidate}",
					"item_group": "家具与大型用品",
					"category": "桌子" if candidate == "T01" else "椅/凳",
					"stock_uom_label": "张" if candidate == "T01" else "组",
					"opening_quantity": 3 if candidate == "T01" else qty,
					"dimensions_reference_inches": "48",
					"merge_decision": "synthetic merge",
					"suggested_description": "synthetic description",
					"photos": [
						{
							"capture_photo_id": photo_id,
							"packaged_image_path": path,
							"packaged_sha256": hashlib.sha256(photo_bytes).hexdigest(),
							"reference_only": candidate == "C16",
						}
					],
				}
			)
		row = {
			"capture_entry_id": f"ENTRY-{candidate}-{room}",
			"capture_collection_name": f"test {room}",
			"sequence_label": "#0001",
			"item_seed_key": seed,
			"item_candidate_code": candidate,
			"warehouse_short_name": room,
			"raw_title": f"Synthetic {candidate}",
			"raw_quantity": qty,
			"raw_unit": "",
			"raw_dimensions": "48",
			"raw_notes": "synthetic note",
			"area_hint": room,
			"arrangement_note": "synthetic arrangement",
			"photo_paths": [],
		}
		entries.append(row)
		stock.append(
			{
				"item_candidate_code": candidate,
				"item_seed_key": seed,
				"warehouse_short_name": room,
				"quantity": qty,
				"source_capture_entry_ids": [row["capture_entry_id"]],
			}
		)
	return {
		"00_manifest": {"schema_version": 1, "source_date": "2026-11-09"},
		"01_warehouses": [
			{"key": "A01", "description": "Test A01"},
			{"key": "A06", "description": "Test A06"},
			{"key": "C-Hall", "description": "Test hall"},
		],
		"02_items": items,
		"03_opening_stock": stock,
		"04_source_entries": entries,
		"_photo": photos.__getitem__,
		"_digest": "synthetic-digest",
	}, photos


def _expectations():
	return {
		"items": 3,
		"source_entries": 4,
		"photos": 3,
		"rows": 4,
		"units": 6,
		"room_totals": {"A01": 2, "A06": 3, "C-Hall": 1},
		"category_totals": {"桌子": 3, "椅/凳": 3},
		"stage_entries": 0,
		"stage_units": 0,
		"specific_stock": {"T01": {"A01": 2, "C-Hall": 1}, "C15": {"A06": 2}, "C16": {"A06": 1}},
		"t02_distribution": {},
	}


class FurnitureSeedUnitTests(unittest.TestCase):
	def test_guard_refuses_production_kufang_org_and_other_sites(self):
		previous_site = getattr(frappe.local, "site", "development.localhost")
		try:
			for site, environment in (
				("development.localhost", "production"),
				("kufang.org", "development"),
				("other.localhost", "development"),
			):
				frappe.local.site = site
				with (
					patch(
						"temple_inventory.environment.descriptor",
						return_value={"environment": environment},
					),
					self.assertRaises(frappe.ValidationError),
				):
					furniture_seed._guard()
		finally:
			frappe.local.site = previous_site

	def test_staging_requires_both_site_and_environment(self):
		previous_site = getattr(frappe.local, "site", "development.localhost")
		frappe.local.site = "staging.kufang.online"
		try:
			with (
				patch("temple_inventory.environment.descriptor", return_value={"environment": "staging"}),
				patch.object(frappe, "conf", {"temple_inventory_environment": "staging"}),
			):
				self.assertIsNone(furniture_seed._guard())
		finally:
			frappe.local.site = previous_site

	def test_validation_accepts_explicit_small_package_and_rejects_bad_inputs(self):
		data, photos = _synthetic_package()
		self.assertEqual(furniture_seed._validate(data, _expectations())["units"], 6)
		bad = {**data, "_photo": lambda _name: b"wrong"}
		with self.assertRaisesRegex(ValueError, "SHA-256"):
			furniture_seed._validate(bad, _expectations())
		bad = {
			**data,
			"03_opening_stock": [*data["03_opening_stock"], {**data["03_opening_stock"][0], "quantity": 99}],
		}
		with self.assertRaisesRegex(ValueError, "行数"):
			furniture_seed._validate(bad, _expectations())
		bad = {
			**data,
			"03_opening_stock": [
				{**data["03_opening_stock"][0], "warehouse_short_name": "A14"},
				*data["03_opening_stock"][1:],
			],
		}
		with self.assertRaisesRegex(ValueError, "未知仓库|A14"):
			furniture_seed._validate(bad, _expectations())
		duplicate = [dict(row) for row in data["02_items"]]
		duplicate[1]["seed_key"] = duplicate[0]["seed_key"]
		bad = {**data, "02_items": duplicate}
		with self.assertRaisesRegex(ValueError, "seed_key"):
			furniture_seed._validate(bad, _expectations())
		self.assertTrue(photos)

	def test_description_formats_c_hall_stage_splits_only_when_informative(self):
		def line_for(main, stage):
			entries = []
			if main:
				entries.append(
					{
						"warehouse_short_name": "C-Hall",
						"raw_quantity": main,
						"capture_collection_name": "餐厅",
						"sequence_label": "#0001",
						"raw_title": "主餐厅桌椅",
					}
				)
			if stage:
				entries.append(
					{
						"warehouse_short_name": "C-Hall",
						"raw_quantity": stage,
						"capture_collection_name": "餐厅 / 舞台",
						"sequence_label": "#0002",
						"raw_title": "舞台桌椅",
					}
				)
			text = furniture_seed._description(
				{
					"candidate_code": "T99",
					"stock_uom_label": "张",
					"suggested_description": "含重复的参考尺寸与合并说明",
					"dimensions_reference_inches": "48",
					"merge_decision": "按相同规格合并",
					"_stock": [{"warehouse_short_name": "C-Hall", "quantity": main + stage}],
				},
				entries,
			)
			self.assertNotIn("含重复的参考尺寸与合并说明", text)
			self.assertEqual(text.count("参考尺寸（英寸）"), 1)  # noqa: RUF001
			self.assertEqual(text.count("合并说明"), 1)
			return next(
				line
				for line in text.splitlines()
				if line.startswith("C-Hall：")  # noqa: RUF001
			)

		self.assertEqual(line_for(18, 0), "C-Hall：18 张")  # noqa: RUF001
		self.assertEqual(
			line_for(0, 4),
			"C-Hall：4 张（均在舞台；舞台为厅内存放位置）",  # noqa: RUF001
		)
		self.assertEqual(
			line_for(8, 12),
			"C-Hall：20 张（主餐厅 8，舞台 12；舞台为厅内存放位置）",  # noqa: RUF001
		)

	def test_apply_failure_explicitly_rolls_back_before_reraising(self):
		data, _ = _synthetic_package()
		with (
			patch.object(furniture_seed, "_guard"),
			patch.object(furniture_seed, "_load_package", return_value=data),
			patch.object(furniture_seed, "_validate", return_value={}),
			patch.object(furniture_seed, "_ensure_expected_state", return_value=({}, {})),
			patch.object(furniture_seed, "_apply", side_effect=RuntimeError("seed failed")),
			patch.object(frappe.db, "rollback") as rollback,
			self.assertRaisesRegex(RuntimeError, "seed failed"),
		):
			furniture_seed.run("synthetic", apply=1)
		rollback.assert_called_once_with()


class FurnitureSeedIntegrationTests(NativeDocumentTests):
	def _run_seed(self, package):
		data, _photos = package
		with (
			patch.object(furniture_seed, "ROOM_TOTALS", _expectations()["room_totals"]),
			patch.object(
				furniture_seed,
				"_create_area",
				side_effect=lambda label, parent, _short=None: (
					warehouses._insert_location(
						"Area", label, parent, f"TEST-{self.token}" if _short else ""
					),
					furniture_seed._existing_location(parent, label),
				)[1],
			),
			patch.object(furniture_seed, "_validate", return_value={"synthetic": True}),
		):
			return furniture_seed._apply(data, {}, {})

	def _package(self):
		return _synthetic_package()

	def test_create_and_rerun_preserves_native_objects_and_media(self):
		package = self._package()
		first = self._run_seed(package)
		item_codes = {key: row["item_code"] for key, row in first["items"].items()}
		self.assertEqual(len(item_codes), 3)
		for item in package[0]["02_items"]:
			code = item_codes[item["seed_key"]]
			doc = frappe.get_doc("Item", code)
			self.assertEqual(doc.stock_uom, "Nos")
			self.assertTrue(doc.item_name.endswith("(张)" if item["candidate_code"] == "T01" else "(组)"))
			self.assertEqual(doc.ti_import_ref, item["seed_key"])
			self.assertTrue(doc.image)
			self.assertTrue(
				frappe.db.exists("File", {"attached_to_doctype": "Item", "attached_to_name": code})
			)
		for room, label, short in (
			("A01", "阅览室", "A01"),
			("A06", "放映室", "A06"),
			("C-Hall", "餐厅/大厅", "C-Hall"),
		):
			room_name = frappe.db.get_value(
				"Warehouse",
				{"ti_label": label, "ti_short_label": short, "warehouse_type": "Room"},
				"name",
			)
			self.assertTrue(room_name)
			self.assertTrue(
				frappe.db.get_value(
					"Warehouse", {"parent_warehouse": room_name, "ti_direct_storage": 1}, "name"
				)
			)
			reconciliation = frappe.get_doc("Stock Reconciliation", first["reconciliations"][room])
			self.assertEqual(reconciliation.ti_time_mode, "Historical")
			self.assertEqual(reconciliation.ti_notes and reconciliation.docstatus, 1)
			attachments = frappe.get_all(
				"File",
				filters={
					"attached_to_doctype": "Stock Reconciliation",
					"attached_to_name": reconciliation.name,
				},
				pluck="file_name",
			)
			self.assertTrue(any(name.startswith(f"家具盘点来源-{room}") for name in attachments), attachments)
		seeded_names = {
			name
			for row in first["warehouse_details"].values()
			for name in (row["name"], row.get("direct_leaf"))
			if name
		}
		name_check = warehouse_names.development_name_check()
		self.assertFalse(
			[name for name in name_check["diffs"] if name["name"] in seeded_names],
			name_check["diffs"],
		)
		before = {
			doctype: frappe.db.count(doctype)
			for doctype in ("Item", "File", "Stock Ledger Entry", "Stock Reconciliation")
		}
		second = self._run_seed(package)
		second_codes = {key: row["item_code"] for key, row in second["items"].items()}
		after = {doctype: frappe.db.count(doctype) for doctype in before}
		self.assertEqual(before, after)
		self.assertEqual(item_codes, second_codes)
		self.assertEqual(first["reconciliations"], second["reconciliations"])
		self.assertTrue(all(row["primary"] for row in second["photo_coverage"].values()))

	def test_seed_stops_when_existing_balance_differs(self):
		data, _photos = self._package()
		self._run_seed((data, _photos))
		with (
			patch.object(furniture_seed, "ROOM_TOTALS", _expectations()["room_totals"]),
			patch.object(furniture_seed, "get_stock_balance", return_value=999),
			self.assertRaises(frappe.ValidationError),
		):
			furniture_seed._ensure_expected_state(data)

	def test_empty_install_mode_returns_without_building_samples(self):
		with (
			patch.object(native_samples, "_fiscal_years"),
			patch.object(native_samples, "sample_catalog", return_value={"items": []}),
			patch.object(native_samples, "costume_catalog", return_value=[]),
		):
			result = native_samples._install(self.company, data="empty")
		self.assertTrue(result["empty_baseline"])
		self.assertEqual(result["items"], 0)
