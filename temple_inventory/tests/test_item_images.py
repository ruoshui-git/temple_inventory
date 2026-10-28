"""Primary image derivative generation and private delivery checks."""

import unittest
from io import BytesIO
from unittest.mock import patch

import frappe
from PIL import Image

from temple_inventory import catalog, item_images, native_files
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class ItemImageTests(NativeDocumentTests):
	def _source_file(self, color):
		buffer = BytesIO()
		Image.new("RGB", (320, 200), color).save(buffer, "PNG")
		return frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"primary-{self.token}-{color}.png",
				"content": buffer.getvalue(),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "image",
			}
		).insert()

	def _set_image(self, color):
		file = self._source_file(color)
		item = frappe.get_doc("Item", self.item)
		item.image = file.file_url
		item.save()
		return file, item

	def _variants(self):
		return frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": item_images.VARIANT_FIELD,
			},
			fields=["name", "file_name", "file_url", "is_private"],
			order_by="file_name asc",
		)

	def test_item_image_derivatives_are_webp_private_and_hidden_from_attachments(self):
		original, _item = self._set_image("red")
		variants = self._variants()
		self.assertEqual(
			[row.file_name for row in variants],
			[
				f"{self.item}-160-{item_images.image_version(original.file_url)}.webp",
				f"{self.item}-640-{item_images.image_version(original.file_url)}.webp",
			],
		)
		self.assertTrue(all(row.is_private for row in variants))
		self.assertEqual(
			{Image.open(BytesIO(frappe.get_doc("File", row.name).get_content())).size for row in variants},
			{(160, 100), (320, 200)},
		)
		self.assertEqual({file.name for file in native_files.attachments("Item", self.item)}, {original.name})
		self.assertFalse(
			any(
				file["name"] in {row.name for row in variants}
				for file in native_files.attachments("Item", self.item)
			)
		)
		self.assertEqual(len(item_images._variant_files(frappe.get_doc("Item", self.item))), 2)

	def test_app_primary_image_action_preserves_original_bytes_and_creates_derivatives(self):
		original = self._source_file("purple")
		item = frappe.get_doc("Item", self.item)
		selected = catalog.set_item_image(self.item, str(item.modified), original.name)
		self.assertEqual(selected["image"], original.file_url)
		self.assertEqual(
			frappe.get_doc("File", original.name).get_content(encodings=[]),
			original.get_content(encodings=[]),
		)
		self.assertEqual(len(self._variants()), 2)

	def test_replacing_or_removing_primary_image_deletes_stale_derivatives(self):
		_first, _item = self._set_image("red")
		first_names = {row.name for row in self._variants()}
		second, item = self._set_image("blue")
		second_names = {row.name for row in self._variants()}
		self.assertTrue(first_names.isdisjoint(second_names))
		self.assertEqual(len(second_names), 2)
		self.assertTrue(
			all(item_images.image_version(second.file_url) in row.file_name for row in self._variants())
		)
		native_files.remove_attachment("Item", self.item, second.name)
		self.assertEqual(self._variants(), [])
		item.reload()
		self.assertFalse(item.image)

	def test_thumbnail_uses_version_and_falls_back_to_authorized_original(self):
		original, _item = self._set_image("green")
		version = item_images.image_version(original.file_url)
		response = item_images.thumbnail(self.item, 160, version)
		self.assertEqual(response.mimetype, "image/webp")
		self.assertEqual(response.headers["Cache-Control"], "private,max-age=31536000,immutable")
		response.direct_passthrough = False
		self.assertTrue(response.get_data())
		for row in self._variants():
			frappe.get_doc("File", row.name).delete()
		response = item_images.thumbnail(self.item, 160, version)
		self.assertEqual(response.mimetype, "image/png")
		response.direct_passthrough = False
		self.assertEqual(response.get_data(), original.get_content(encodings=[]))
		with self.assertRaises(frappe.DoesNotExistError):
			item_images.thumbnail(self.item, 160, "stale-version")

	def test_derivative_failure_does_not_block_item_save(self):
		file = self._source_file("yellow")
		item = frappe.get_doc("Item", self.item)
		item.image = file.file_url
		with patch("temple_inventory.item_images._webp", side_effect=ValueError("bad image")):
			item.save()
		self.assertEqual(frappe.db.get_value("Item", self.item, "image"), file.file_url)
		self.assertEqual(self._variants(), [])


if __name__ == "__main__":
	unittest.main()
