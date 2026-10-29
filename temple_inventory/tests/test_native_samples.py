"""Native sample installation under rollback and bounded media cleanup scenarios."""

import hashlib
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import getdate, nowdate
from PIL import Image

from temple_inventory import configuration, native_files, native_samples, sample_install, sample_media
from temple_inventory.native_api import _request_key
from temple_inventory.native_balances import batch_balances
from temple_inventory.native_stock import MOVEMENT_PURPOSES
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class SampleMediaTests(unittest.TestCase):
	def test_sample_operations_require_development_site_or_explicit_sample_opt_in(self):
		# The public sample site runs without developer_mode; its opt-in is the override.
		conf = frappe._dict()
		with (
			patch.object(frappe.local, "site", "inventory.example.org"),
			patch.object(frappe.local, "conf", conf),
		):
			with self.assertRaises(frappe.ValidationError):
				sample_install.assert_development_site(allow_non_developer=1)
			conf.temple_inventory_sample_site = 1
			self.assertEqual(sample_install.assert_development_site()["site"], "inventory.example.org")
		with (
			patch.object(frappe.local, "site", "development.localhost"),
			patch.object(frappe.local, "conf", frappe._dict()),
			self.assertRaises(frappe.ValidationError),
		):
			sample_install.assert_development_site()

	def test_inventory_finds_orphans_and_private_thumbnail_bug_but_preserves_shared_files(self):
		with tempfile.TemporaryDirectory() as folder:
			root = Path(folder)
			content = b"known sample image"
			for relative in (
				"private/files/sample.webp",
				"public/files/orphan.webp",
				"public/private/files/sample_small.webp",
				"public/files/shared.webp",
				"public/files/shared_small.webp",
				"public/files/unrelated.webp",
			):
				path = root / relative
				path.parent.mkdir(parents=True, exist_ok=True)
				path.write_bytes(content if "small" not in relative else b"native thumbnail")
			(root / "public/files/unrelated.webp").write_bytes(b"unrelated original")
			files = [
				{
					"attached_to_doctype": "Item",
					"attached_to_name": "sample",
					"file_url": "/private/files/sample.webp",
				},
				{
					"attached_to_doctype": "Item",
					"attached_to_name": "sample",
					"file_url": "/files/shared.webp",
				},
				{
					"attached_to_doctype": "User",
					"attached_to_name": "other",
					"file_url": "/files/shared.webp",
				},
				{
					"attached_to_doctype": "Item",
					"attached_to_name": "sample",
					"file_url": "/files/unrelated.webp",
				},
			]
			result = sample_media.build_inventory(
				root, files, {"sample"}, [], {hashlib.sha256(content).hexdigest()}
			)
			self.assertEqual(
				{row["path"] for row in result["files"]},
				{
					"private/files/sample.webp",
					"public/files/orphan.webp",
					"public/private/files/sample_small.webp",
				},
			)
			self.assertTrue((root / "public/files/orphan.webp").exists(), "Inventory must remain read-only")

	def test_media_paths_reject_traversal_and_symlinks(self):
		with tempfile.TemporaryDirectory() as folder:
			root = Path(folder)
			(root / "public/files").mkdir(parents=True)
			(root / "outside").write_bytes(b"unrelated")
			(root / "public/files/link.webp").symlink_to(root / "outside")
			for path in (
				"../outside",
				"public/files/../../outside",
				"public/files/link.webp",
				"/private/files/x",
			):
				with self.assertRaises(ValueError):
					sample_media._safe_path(root, path)
			self.assertEqual(sample_media._relative_urls("/files/../outside"), [])

	def test_cleanup_verifies_all_hashes_before_removing_anything(self):
		import json

		with tempfile.TemporaryDirectory() as folder:
			root = Path(folder)
			(root / "private/files").mkdir(parents=True)
			rows = []
			for name in ("one", "two"):
				path = root / "private/files" / name
				path.write_bytes(name.encode())
				rows.append({"path": f"private/files/{name}", "sha256": sample_media._digest(path)})
			(root / "private" / sample_media.MANIFEST).write_text(
				json.dumps(
					{
						"version": 1,
						"site": frappe.local.site,
						"files": rows,
						"protected_paths": [],
					}
				)
			)
			(root / "private/files/two").write_bytes(b"new unrelated contents")
			with (
				patch("temple_inventory.sample_install.assert_development_site"),
				patch("frappe.get_site_path", return_value=str(root)),
				self.assertRaises(ValueError),
			):
				sample_media.cleanup()
			self.assertTrue((root / "private/files/one").exists())
			(root / "private/files/two").write_bytes(b"two")
			(root / "private/files/unrelated").write_bytes(b"preserve")
			with (
				patch("temple_inventory.sample_install.assert_development_site"),
				patch("frappe.get_site_path", return_value=str(root)),
			):
				self.assertEqual(sample_media.cleanup()["removed"], 2)
			self.assertEqual((root / "private/files/unrelated").read_bytes(), b"preserve")


class NativeSampleAttachmentTests(NativeDocumentTests):
	def test_seed_primary_image_adds_hidden_derivatives_and_preserves_the_original(self):
		root = Path(frappe.get_site_path("private", "files")).resolve()
		before = set(root.iterdir())
		buffer = BytesIO()
		Image.new("RGB", (32, 24), "red").save(buffer, "PNG")
		content = buffer.getvalue()
		file = native_samples._attach_file(
			f"seed-image-{self.token}.png", content, "Item", self.item, "image"
		)
		self.assertEqual(set(root.iterdir()) - before, {Path(file.get_full_path()).resolve()})
		self.assertEqual(Path(file.get_full_path()).read_bytes(), content)
		self.assertTrue(file.is_private)
		self.assertEqual(file.attached_to_field, "image")
		item = frappe.get_doc("Item", self.item)
		native_samples._save_primary_image(item, file)
		variants = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "ti_image_variant",
			},
			fields=["name", "file_name", "is_private"],
		)
		self.assertEqual(len(variants), 2)
		self.assertTrue(all(row.is_private for row in variants))
		self.assertEqual(
			{size for size in (160, 640) if any(f"-{size}-" in row.file_name for row in variants)},
			{160, 640},
		)
		self.assertEqual({entry.name for entry in native_files.attachments("Item", self.item)}, {file.name})
		paths = {Path(file.get_full_path()).resolve()}
		paths.update(Path(frappe.get_doc("File", row.name).get_full_path()).resolve() for row in variants)
		self.assertEqual(set(root.iterdir()) - before, paths)
		self.assertEqual(
			frappe.db.count("File", {"attached_to_doctype": "Item", "attached_to_name": self.item}), 3
		)
		entry = self.create(self.movement())
		receipt = native_samples._attach_file(
			f"seed-receipt-{self.token}.txt",
			b"native receipt " + self.token.encode(),
			"Stock Entry",
			entry.name,
		)
		self.assertTrue(receipt.is_private)
		paths.add(Path(receipt.get_full_path()).resolve())
		self.assertEqual(
			set(root.iterdir()) - before,
			paths,
		)


class SampleGeneratorUnitTests(unittest.TestCase):
	def test_realistic_catalog_preserves_name_batch_unit_and_category_rhythms(self):
		rows = native_samples.generated_product_rows()
		self.assertEqual(len(rows), 436)
		self.assertEqual(len({row["item_name"] for row in rows}), 436)
		self.assertEqual({row["stock_uom"] for row in rows}, set(native_samples.GENERATED_UNITS))
		self.assertEqual(
			[row["uncategorized"] for row in rows], [(index + 1) % 17 == 0 for index in range(436)]
		)
		self.assertEqual(
			[row["batch_tracked"] for row in rows], [(index + 1) % 20 == 0 for index in range(436)]
		)
		self.assertEqual(
			[row["has_alternate_uom"] for row in rows], [(index + 1) % 8 == 0 for index in range(436)]
		)
		for row in rows:
			if row["has_alternate_uom"]:
				alternate_uom, factor = native_samples.generated_alternate_conversion(row)
				self.assertNotEqual(alternate_uom, row["stock_uom"])
				self.assertGreater(factor, 0)
		self.assertEqual(
			native_samples.generated_alternate_conversion(
				next(row for row in rows if row["base_name"] == "酱油")
			),
			("Box", 12),
		)
		self.assertEqual(
			native_samples.generated_alternate_conversion(
				next(row for row in rows if row["base_name"] == "垃圾袋")
			),
			("包", 10),
		)
		long_rows = [
			rows[index]
			for index in range(6, 436, 7)
			if not (
				len(rows[index]["item_name"]) >= 18
				and rows[index]["base_name"] in rows[index]["item_name"]
				and rows[index]["spec"] in rows[index]["item_name"]
			)
		]
		self.assertFalse(long_rows, long_rows)
		self.assertEqual(set(native_samples.GENERATED_PRODUCT_SPECS), {row["base_name"] for row in rows})
		self.assertTrue(
			all(4 <= len(specs) <= 8 for specs in native_samples.GENERATED_PRODUCT_SPECS.values())
		)
		self.assertEqual(len({row["base_key"] for row in rows}), 60)

	def test_real_seed_stocks_costumes_in_nos_without_creating_units(self):
		# Source units such as 个 or 套 are UOM labels, so creating them as UOMs clashes.
		with (
			patch.object(native_samples.frappe.db, "exists", return_value=True),
			patch.object(native_samples.catalog, "create_uom") as create_uom,
			patch.object(native_samples.activities, "seed_activity_types"),
		):
			native_samples._references(sample_media.catalog(), include_generated=False)
		create_uom.assert_not_called()
		self.assertFalse(any("stock_uom" in row for row in sample_media.costume_catalog()))

	def test_balance_tracker_rejects_negative_location_or_batch_balance(self):
		balances = {}
		native_samples._balance_change(balances, "item", "leaf-a", 3, "lot-1")
		native_samples._balance_change(balances, "item", "leaf-a", -2, "lot-1")
		self.assertEqual(str(balances[("item", "leaf-a", "lot-1")]), "1")
		with self.assertRaises(ValueError):
			native_samples._balance_change(balances, "item", "leaf-a", -2, "lot-1")


class NativeSampleTests(NativeDocumentTests):
	def test_native_seed_covers_catalog_all_movements_loans_and_real_count_without_legacy_records(self):
		company = frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": "Native Sample " + self.token,
				"abbr": self.token[:5],
				"default_currency": "USD",
				"country": "United States",
				"chart_of_accounts": "Standard",
			}
		).insert()
		settings = frappe.get_single("Temple Inventory Settings")
		settings.company = company.name
		for field in configuration.POINTERS:
			settings.set(field, None)
		settings.set("allowed_warehouses", [])
		settings.save()
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		sample_install._remove_default_sample_records(company.name)
		costumes = sample_media.costume_catalog()
		test_costumes = [
			{**row, "source_code": f"TEST-{self.token}-{row['source_code']}"} for row in costumes
		]
		with (
			patch.object(native_samples, "REQUEST_PREFIX", "temple-native-test:" + self.token + ":"),
			patch.object(native_samples, "SAMPLE_ACTIVITY_TITLE", "Native Seed " + self.token),
			patch.object(
				native_samples,
				"SAMPLE_MEAL_ACTIVITY_TITLE",
				"Native Meal Seed " + self.token,
			),
			patch.object(
				native_samples,
				"SAMPLE_HISTORY_ACTIVITY_TITLE",
				"Native History Seed " + self.token,
			),
			patch.object(native_samples, "costume_catalog", return_value=test_costumes),
			patch.object(sample_media, "costume_catalog", return_value=test_costumes),
		):
			result = native_samples.install(company.name, attach_images=False, attach_files=False)
			affinity = result["rooms"].get("AFFINITY", {})
			physical = set(result["rooms"].get("PHYSICAL_LEAVES", []))
			self.assertTrue(affinity)
			self.assertTrue(all(set(pool) <= physical for pool in affinity.values()))
			for warehouse in set(name for pool in affinity.values() for name in pool):
				leaf = frappe.db.get_value(
					"Warehouse", warehouse, ["is_group", "disabled", "warehouse_type"], as_dict=True
				)
				self.assertFalse(leaf.is_group)
				self.assertFalse(leaf.disabled)
				self.assertNotIn(leaf.warehouse_type, {"Loan", "Damaged"})
			for row in sample_media.catalog()["items"]:
				code = result["item_codes"][row["key"]]
				placements = result["rooms"]["OPENING_PLACEMENTS"][code]
				self.assertGreaterEqual(len(placements), 1)
				self.assertLessEqual(len(placements), 3)
				self.assertTrue(set(placements) <= physical)
			self.assertEqual(result["items"], 164)
			self.assertEqual(result["images"], 0)
			costumes = test_costumes
			barcode_to_parent = {
				row.barcode: row.parent
				for row in frappe.get_all(
					"Item Barcode",
					filters={"barcode": ["in", [row["source_code"] for row in costumes]]},
					fields=["barcode", "parent"],
				)
			}
			self.assertEqual(len(barcode_to_parent), 96)
			for source in costumes:
				code = barcode_to_parent[source["source_code"]]
				self.assertRegex(code, r"^ITM-\d{6}$")
				item = frappe.get_doc("Item", code)
				self.assertEqual(item.item_name, f"{source['item_name']}({source['source_unit']})")
				self.assertEqual(item.stock_uom, "Nos")
				self.assertIn(source["source_code"], {row.barcode for row in item.barcodes})
				warehouse = result["rooms"]["A02"]
				self.assertEqual(get_stock_balance(code, warehouse), source["quantity"])
			self.assertEqual(
				result["costume_item_codes"],
				{source["source_code"]: barcode_to_parent[source["source_code"]] for source in costumes},
			)
			self.assertTrue(configuration.status()["ready"])
			entries = [frappe.get_doc("Stock Entry", name) for name in result["stock_entries"]]
			self.assertEqual(
				{doc.ti_movement_kind for doc in entries if doc.docstatus == 1}, set(MOVEMENT_PURPOSES)
			)
			self.assertTrue(
				any(doc.docstatus == 2 and doc.ti_movement_kind in MOVEMENT_PURPOSES for doc in entries)
			)
			self.assertFalse(any(not doc.ti_movement_kind for doc in entries))
			self.assertGreaterEqual(sum(doc.docstatus == 0 for doc in entries), 2)
			amendments = [doc for doc in entries if doc.docstatus == 0 and doc.amended_from]
			self.assertTrue(amendments)
			self.assertNotEqual(amendments[0].owner, "Administrator")
			count = frappe.get_doc("Stock Reconciliation", result["reconciliation"])
			self.assertEqual(count.docstatus, 1)
			self.assertEqual(len(count.ti_count_review), 4)
			self.assertEqual({row.review_state for row in count.ti_count_review}, {"Reviewed", "Unreviewed"})
			self.assertIn(-1, {row.difference for row in count.ti_count_review})
			self.assertIn(1, {row.difference for row in count.ti_count_review})
			self.assertTrue(
				any(row.review_state == "Reviewed" and row.difference == 0 for row in count.ti_count_review)
			)
			self.assertEqual({row.qty for row in count.items}, {68, 7})
			self.assertEqual(count.items[0].valuation_rate, 10)
			mixed_count = frappe.get_doc("Stock Reconciliation", result["mixed_count"])
			mixed_rows = mixed_count.ti_count_review
			self.assertGreaterEqual(len({row.item_code for row in mixed_rows}), 40)
			self.assertTrue(any(row.difference > 0 for row in mixed_rows))
			self.assertTrue(any(row.difference < 0 for row in mixed_rows))
			self.assertTrue(any(row.difference == 0 for row in mixed_rows))
			self.assertGreaterEqual(len({row.warehouse for row in mixed_rows}), 3)
			differences = [row.difference for row in mixed_rows if row.review_state == "Reviewed"]
			self.assertGreaterEqual(max(differences), 7)
			self.assertLessEqual(min(differences), -3)
			net_by_unit = {}
			for row in mixed_rows:
				if row.review_state == "Reviewed":
					net_by_unit[row.stock_uom] = net_by_unit.get(row.stock_uom, 0) + row.difference
			self.assertTrue(any(net_by_unit.values()))
			opening_count = frappe.get_doc("Stock Reconciliation", result["opening_reconciliation"])
			self.assertEqual(opening_count.purpose, "Opening Stock")
			self.assertEqual(opening_count.docstatus, 1)
			self.assertEqual(len(opening_count.items), 3)
			self.assertEqual(len(result["loans"]), 4)
			self.assertEqual(len(result["activity"]), 3)
			bundle_request_keys = {
				_request_key("Stock Entry", native_samples.REQUEST_PREFIX + key)
				for key in ("bundle-receipt", "bundle-issue")
			}
			bundle_lines = [
				line
				for doc in entries
				if doc.ti_request_key in bundle_request_keys
				for line in doc.items
				if line.serial_and_batch_bundle
			]
			self.assertEqual(len(bundle_lines), 2)
			for line in bundle_lines:
				bundle = frappe.get_doc("Serial and Batch Bundle", line.serial_and_batch_bundle)
				self.assertEqual(
					{row.batch_no: abs(row.qty) for row in bundle.entries},
					{
						native_samples._batch_id(result["item_codes"]["G-000001"], "Event Bundle A"): 2,
						native_samples._batch_id(result["item_codes"]["G-000001"], "Event Bundle B"): 3,
					},
				)
			from temple_inventory import browse

			history_query = {
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"scope": {"item": result["item_codes"]["N-WORKFLOW"]},
			}
			first_history_page = browse.movement_history(
				history_query,
				item_code=result["item_codes"]["N-WORKFLOW"],
				page_length=30,
			)
			self.assertGreater(first_history_page["matched_count"], 30)
			self.assertEqual(first_history_page["next_start"], 30)
			second_history_page = browse.movement_history(
				history_query,
				item_code=result["item_codes"]["N-WORKFLOW"],
				start=first_history_page["next_start"],
				page_length=30,
			)
			self.assertTrue(second_history_page["rows"])
			before = getdate(nowdate())
			catalog_data = sample_media.catalog()
			batch_ids = [
				native_samples._batch_id(result["item_codes"][key], batch["key"])
				for key, batches in catalog_data["batches"].items()
				for batch in batches
			]
			batch_rows = frappe.get_all(
				"Batch",
				filters={"batch_id": ["in", batch_ids]},
				fields=["item", "batch_id", "manufacturing_date", "expiry_date"],
			)
			for key, source_batches in catalog_data["batches"].items():
				code = result["item_codes"][key]
				actual_batches = [row for row in batch_rows if row.item == code]
				self.assertEqual(len(actual_batches), len(source_batches))
				self.assertGreaterEqual(len({row.manufacturing_date for row in actual_batches}), 2)
				mixed_adjustment = sum(
					row.difference
					for row in mixed_rows
					if row.item_code == code and row.review_state == "Reviewed"
				)
				remaining = (
					sum(row["quantity"] for row in source_batches)
					- (6 if key == "G-000001" else 0)
					+ mixed_adjustment
				)
				warehouses = {
					warehouse
					for placement_key, placements in result["rooms"]["BATCH_PLACEMENTS"].items()
					if placement_key.startswith(f"{code}::")
					for warehouse in placements
				}
				self.assertEqual(
					sum(get_stock_balance(code, warehouse) for warehouse in warehouses), remaining
				)
			offsets = {(getdate(row["expiry_date"]) - before).days for row in batch_rows if row.expiry_date}
			self.assertTrue({-1, -30, -31, -90, -91, 0, 30, 31, 90, 91}.issubset(offsets))
			depleted = frappe.get_all(
				"Batch",
				filters={
					"batch_id": native_samples._batch_id(result["item_codes"]["G-000001"], "BAT-000001")
				},
				pluck="name",
			)
			self.assertEqual(len(depleted), 1)
			depleted_balances = batch_balances(
				result["item_codes"]["G-000001"],
				result["rooms"]["BATCH_PLACEMENTS"][
					f"{result['item_codes']['G-000001']}::"
					f"{native_samples._batch_id(result['item_codes']['G-000001'], 'BAT-000001')}"
				][0],
				str(before),
				include_zero=True,
			)
			self.assertTrue(
				any(row["batch_no"] == depleted[0] and row["qty"] == 0 for row in depleted_balances)
			)
			self.assertEqual(
				get_stock_balance(result["item_codes"]["G-000001"], result["rooms"]["DEMO_B"]),
				0,
			)
			settings.reload()
			settings.sample_data_status = "Installed"
			settings.sample_data_version = sample_install.VERSION
			settings.save(ignore_permissions=True)
			verified = sample_install.verify_development_sample(require_images=False, data="real")
			self.assertEqual(verified["costume_items"], 96)
			self.assertTrue(verified["costume_stock_verified"])
