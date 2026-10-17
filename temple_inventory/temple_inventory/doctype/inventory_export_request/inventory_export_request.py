import frappe
from frappe.model.document import Document


class InventoryExportRequest(Document):
	def validate(self):
		from temple_inventory.exports import service_write

		if not service_write.get():
			frappe.throw("请通过物资管理的导出操作管理此请求", frappe.PermissionError)
