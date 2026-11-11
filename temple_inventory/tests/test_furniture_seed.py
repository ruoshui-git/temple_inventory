"""Regression coverage for empty baseline and the guarded furniture seed."""

# ruff: noqa: RUF001 — Chinese source and presentation strings are intentional.

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
			"capture_collection_name": "餐厅 / 舞台" if room == "C-Hall" else f"test {room}",
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
		"05_display_notes": {
			"items": {
				"TEST-T01": "与 {C16} 搭配使用。",
				"TEST-C15": "",
				"TEST-C16": "可与其他座椅组合。",
			},
			"rooms": {"A01": "A01 room note", "A06": "A06 room note", "C-Hall": "Hall room note"},
		},
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
		"stage_entries": 1,
		"stage_units": 1,
		"specific_stock": {"T01": {"A01": 2, "C-Hall": 1}, "C15": {"A06": 2}, "C16": {"A06": 1}},
		"t02_distribution": {},
	}


class FurnitureSeedUnitTests(unittest.TestCase):
	def test_guard_requires_explicit_production_allow_key_and_refuses_other_sites(self):
		previous_site = getattr(frappe.local, "site", "development.localhost")
		try:
			for site, environment in (
				("development.localhost", "production"),
				("kufang.org", "development"),
				("other.localhost", "production"),
				("other.localhost", "development"),
			):
				frappe.local.site = site
				with (
					patch(
						"temple_inventory.environment.descriptor",
						return_value={"environment": environment},
					),
					patch.object(frappe, "conf", {"temple_inventory_allow_furniture_seed": 1}),
					self.assertRaises(frappe.ValidationError),
				):
					furniture_seed._guard()
			for config in ({}, {"temple_inventory_allow_furniture_seed": 0}):
				frappe.local.site = "kufang.org"
				with (
					patch(
						"temple_inventory.environment.descriptor", return_value={"environment": "production"}
					),
					patch.object(frappe, "conf", config),
					self.assertRaisesRegex(frappe.ValidationError, "temple_inventory_allow_furniture_seed"),
				):
					furniture_seed._guard()
			frappe.local.site = "kufang.org"
			with (
				patch("temple_inventory.environment.descriptor", return_value={"environment": "production"}),
				patch.object(frappe, "conf", {"temple_inventory_allow_furniture_seed": 1}),
			):
				self.assertIsNone(furniture_seed._guard())
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
		for section, mutate, message in (
			("items", lambda notes: notes.pop("TEST-T01"), "seed_key"),
			("items", lambda notes: notes.update({"EXTRA": ""}), "seed_key"),
			("rooms", lambda notes: notes.pop("A01"), "room"),
			("rooms", lambda notes: notes.update({"A14": "extra"}), "room"),
		):
			bad_notes = {**data["05_display_notes"], section: dict(data["05_display_notes"][section])}
			mutate(bad_notes[section])
			with self.subTest(section=section, error=message), self.assertRaisesRegex(ValueError, message):
				furniture_seed._validate({**data, "05_display_notes": bad_notes}, _expectations())
		bad_notes = {
			**data["05_display_notes"],
			"items": {**data["05_display_notes"]["items"], "TEST-T01": "{UNKNOWN}"},
		}
		with self.assertRaisesRegex(ValueError, "未知 candidate_code"):
			furniture_seed._validate({**data, "05_display_notes": bad_notes}, _expectations())
		self.assertTrue(photos)

	def test_description_is_stable_user_facing_text_and_resolves_forward_code(self):
		item = {"dimensions_reference_inches": "48 × 24"}
		codes = {"S04": "ITM-000042"}
		self.assertEqual(furniture_seed._description(item, "", codes), "参考尺寸（英寸）：48 × 24")
		self.assertEqual(
			furniture_seed._description(item, "搭配 {S04} 使用。", codes),
			"参考尺寸（英寸）：48 × 24\n\n搭配 ITM-000042 使用。",
		)
		self.assertEqual(furniture_seed._description({}, "", codes), "参考尺寸（英寸）：未提供")

	def test_existing_item_diff_checks_full_resolved_description(self):
		source = {"item_name": "Chair", "stock_uom_label": "把"}
		description = "参考尺寸（英寸）：未提供\n\n搭配 ITM-000042 使用。"
		item = {
			"item_name": "Chair(把)",
			"item_group": "家具与大型用品",
			"description": description,
			"stock_uom": "Nos",
			"is_stock_item": 1,
		}
		self.assertEqual(furniture_seed._item_state_diff(item, source, "家具与大型用品", description), {})
		item["description"] = "参考尺寸（英寸）：未提供\n\n搭配 {S04} 使用。"
		diff = furniture_seed._item_state_diff(item, source, "家具与大型用品", description)
		self.assertEqual(diff["description"], {"expected": description, "actual": item["description"]})

	def test_count_sheet_formats_stage_split_stage_only_and_stowed_rows(self):
		data, _photos = _synthetic_package()
		codes = {"TEST-T01": "ITM-000001", "TEST-C15": "ITM-000002", "TEST-C16": "ITM-000003"}
		csv_text = furniture_seed._count_sheet(data, "C-Hall", [data["03_opening_stock"][1]], codes).decode(
			"utf-8-sig"
		)
		self.assertEqual(csv_text.splitlines()[0], "物品编码,物品名称,数量,单位,摆放")
		self.assertIn("ITM-000001,Synthetic T01(张),1,张,舞台 1", csv_text)
		data["03_opening_stock"][1]["quantity"] = 5
		data["04_source_entries"][1]["raw_quantity"] = 2
		data["04_source_entries"].append(
			{
				**data["04_source_entries"][1],
				"capture_entry_id": "MAIN",
				"capture_collection_name": "餐厅",
				"raw_quantity": 3,
			}
		)
		split = furniture_seed._count_sheet(data, "C-Hall", [data["03_opening_stock"][1]], codes).decode(
			"utf-8-sig"
		)
		self.assertIn("ITM-000001,Synthetic T01(张),5,张,主餐厅 3，舞台 2", split)
		stowed = furniture_seed._count_sheet(data, "A01", [data["03_opening_stock"][0]], codes).decode(
			"utf-8-sig"
		)
		self.assertIn("ITM-000001,Synthetic T01(张),2,张,2 张收在角落待用", stowed)

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
			if item["seed_key"] == "TEST-T01":
				expected_description = f"参考尺寸（英寸）：48\n\n与 {item_codes['TEST-C16']} 搭配使用。"
			elif item["seed_key"] == "TEST-C16":
				expected_description = "参考尺寸（英寸）：48\n\n可与其他座椅组合。"
			else:
				expected_description = "参考尺寸（英寸）：48"
			self.assertEqual(doc.description, expected_description)
			for forbidden in ("#0", "Capture", "T01", "C15", "C16", "A01", "A06", "C-Hall"):
				self.assertNotIn(forbidden, doc.description)
			self.assertEqual(doc.ti_import_ref, item["seed_key"])
			self.assertTrue(doc.image)
			self.assertTrue(
				frappe.db.exists("File", {"attached_to_doctype": "Item", "attached_to_name": code})
			)
			file_names = frappe.get_all(
				"File",
				filters={"attached_to_doctype": "Item", "attached_to_name": code},
				pluck="file_name",
			)
			wanted_name = f"{code}-参考图.jpg" if item["seed_key"] == "TEST-C16" else f"{code}-1.jpg"
			self.assertIn(wanted_name, file_names)
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
			self.assertEqual(reconciliation.ti_notes, package[0]["05_display_notes"]["rooms"][room])
			self.assertEqual(reconciliation.docstatus, 1)
			attachments = frappe.get_all(
				"File",
				filters={
					"attached_to_doctype": "Stock Reconciliation",
					"attached_to_name": reconciliation.name,
				},
				pluck="file_name",
			)
			self.assertIn(f"盘点清单-{room}.csv", attachments)
			attached_csv = frappe.get_doc(
				"File",
				{
					"attached_to_doctype": "Stock Reconciliation",
					"attached_to_name": reconciliation.name,
					"file_name": f"盘点清单-{room}.csv",
				},
			)
			csv_text = attached_csv.get_content(encodings=[]).decode("utf-8-sig")
			self.assertEqual(csv_text.splitlines()[0], "物品编码,物品名称,数量,单位,摆放")
			self.assertNotIn("capture_", csv_text)
			self.assertNotIn("Capture", csv_text)
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
