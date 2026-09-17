import frappe
from frappe.model.document import Document


class InventoryWorkspace(Document):
	def validate(self):
		# All mutations go through the revision-checked service, including Desk.
		if not self.flags.workspace_service:
			frappe.throw("Use the inventory workspace to edit this record", frappe.PermissionError)

	def on_trash(self):
		frappe.throw("Inventory workspaces are retained for audit", frappe.PermissionError)
