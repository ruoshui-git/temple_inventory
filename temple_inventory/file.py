"""Check transaction attachments before File writes or removes physical files."""

import frappe


class InventoryFileMixin:
	def _check_inventory_attachment(self, deleting=False):
		from temple_inventory.native_files import validate_file_write

		validate_file_write(self, deleting)

	def before_insert(self):
		self._check_inventory_attachment()
		super().before_insert()

	def validate(self):
		self._check_inventory_attachment()
		super().validate()

	def on_trash(self):
		self._check_inventory_attachment(deleting=True)
		super().on_trash()

	def is_downloadable(self):
		from temple_inventory.native_files import _can_read_any

		allowed = _can_read_any(self)
		return allowed if allowed is not None else super().is_downloadable()

	def make_thumbnail(self, *args, **kwargs):
		from temple_inventory.native_files import PARENTS

		if self.attached_to_doctype in PARENTS:
			# Core writes thumbnails beneath public/files. Use the authorized original.
			self.check_permission("read")
			if not self.is_downloadable():
				frappe.throw("您没有读取此附件的权限", frappe.PermissionError)
			return self.file_url
		return super().make_thumbnail(*args, **kwargs)
