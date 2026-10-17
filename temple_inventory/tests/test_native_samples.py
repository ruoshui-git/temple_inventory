"""Native sample installation under rollback and bounded media cleanup scenarios."""

import base64
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import frappe

from temple_inventory import configuration, native_samples, sample_media
from temple_inventory.native_stock import MOVEMENT_PURPOSES
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class SampleMediaTests(unittest.TestCase):
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
						"site": "development.localhost",
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


class NativeSampleTests(NativeDocumentTests):
	def test_seed_attachments_write_one_private_blob_and_preserve_native_image_field_link(self):
		root = Path(frappe.get_site_path("private", "files")).resolve()
		before = set(root.iterdir())
		content = base64.b64decode(
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
		)
		file = native_samples._attach_file(
			f"seed-image-{self.token}.png", content, "Item", self.item, "image"
		)
		self.assertEqual(set(root.iterdir()) - before, {Path(file.get_full_path()).resolve()})
		self.assertEqual(Path(file.get_full_path()).read_bytes(), content)
		self.assertTrue(file.is_private)
		self.assertEqual(file.attached_to_field, "image")
		item = frappe.get_doc("Item", self.item)
		item.image = file.file_url
		item.save()
		self.assertEqual(
			frappe.db.count("File", {"attached_to_doctype": "Item", "attached_to_name": self.item}), 1
		)
		self.assertEqual(set(root.iterdir()) - before, {Path(file.get_full_path()).resolve()})
		entry = self.create(self.movement())
		receipt = native_samples._attach_file(
			f"seed-receipt-{self.token}.txt",
			b"native receipt " + self.token.encode(),
			"Stock Entry",
			entry.name,
		)
		self.assertTrue(receipt.is_private)
		self.assertEqual(
			set(root.iterdir()) - before,
			{Path(file.get_full_path()).resolve(), Path(receipt.get_full_path()).resolve()},
		)

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
		with (
			patch.object(native_samples, "ITEM_PREFIX", "TI-TEST-" + self.token + "-"),
			patch.object(native_samples, "REQUEST_PREFIX", "temple-native-test:" + self.token + ":"),
			patch.object(native_samples, "SAMPLE_ACTIVITY_TITLE", "Native Seed " + self.token),
		):
			result = native_samples.install(company.name, attach_images=False, attach_files=False)
			self.assertEqual(result["items"], 164)
			self.assertEqual(result["images"], 0)
			self.assertTrue(configuration.status()["ready"])
			entries = [frappe.get_doc("Stock Entry", name) for name in result["stock_entries"]]
			self.assertEqual(
				{doc.ti_movement_kind for doc in entries if doc.docstatus == 1}, set(MOVEMENT_PURPOSES)
			)
			self.assertTrue(any(doc.docstatus == 2 and not doc.ti_movement_kind for doc in entries))
			self.assertTrue(any(doc.docstatus == 0 for doc in entries))
			count = frappe.get_doc("Stock Reconciliation", result["reconciliation"])
			self.assertEqual(count.docstatus, 1)
			self.assertEqual(len(count.ti_count_review), 1)
			self.assertEqual(count.ti_count_review[0].difference, -1)
			self.assertEqual(count.items[0].qty, 70)
			self.assertEqual(count.items[0].valuation_rate, 10)


def run():
	suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(SampleMediaTests))
	suite.addTest(
		NativeSampleTests(
			"test_native_seed_covers_catalog_all_movements_loans_and_real_count_without_legacy_records"
		)
	)
	result = unittest.TextTestRunner(verbosity=2).run(suite)
	if not result.wasSuccessful():
		raise AssertionError("Native sample validation failed")
	return {"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}
