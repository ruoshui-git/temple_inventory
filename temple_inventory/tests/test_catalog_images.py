"""Native supporting records, full-dataset search and dashboard integration."""

import base64
from unittest.mock import patch

import frappe

from temple_inventory import (
	catalog,
	native_files,
)
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogImagesTests(NativeDocumentTests):
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

	def test_display_summaries_trust_listed_items_only_for_their_own_call(self):
		parent_checks = []
		original_parent = native_files._parent

		def counted_parent(doctype, name, **kwargs):
			parent_checks.append((doctype, name))
			return original_parent(doctype, name, **kwargs)

		own = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"trusted-cover-{self.token}.png",
				"content": f"trusted-cover-{self.token}".encode(),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()
		frappe.db.set_value("Item", self.item, "image", own.file_url, update_modified=False)
		with patch("temple_inventory.native_files._parent", side_effect=counted_parent):
			self.assertEqual(catalog.item_display_summaries([self.item])[self.item]["image"], own.file_url)
			self.assertEqual(parent_checks, [])
			self.assertIsNone(getattr(frappe.local, "ti_readable_parents", None))
			native_files.can_read(own)
			self.assertEqual(parent_checks, [("Item", self.item)])
		with self.assertRaises(ValueError):
			with native_files.readable_parents("Stock Entry", []):
				pass

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
