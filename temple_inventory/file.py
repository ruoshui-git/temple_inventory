"""Check transaction attachments before File writes or removes physical files."""

import frappe


class InventoryFileMixin:
	def _check_inventory_attachment(self, deleting=False):
		from temple_inventory.workspace_api import validate_attachment

		if not self.is_new():
			old = frappe.db.get_value(
				"File", self.name, ["attached_to_doctype", "attached_to_name"], as_dict=True
			)
			if old and old.attached_to_doctype == "Inventory Workspace":
				validate_attachment(old, "on_trash" if deleting else "validate")
		validate_attachment(self, "on_trash" if deleting else "validate")

	def before_insert(self):
		self._check_inventory_attachment()
		super().before_insert()

	def validate(self):
		self._check_inventory_attachment()
		super().validate()

	def on_trash(self):
		self._check_inventory_attachment(deleting=True)
		super().on_trash()
