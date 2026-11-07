import frappe
from frappe.model.document import Document


class InventoryImport(Document):
	def validate(self):
		from temple_inventory.imports import service_write

		if not service_write.get():
			frappe.throw("请通过物品导入操作管理此请求", frappe.PermissionError)
