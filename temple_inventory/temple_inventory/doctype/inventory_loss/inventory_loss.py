import frappe
from frappe.model.document import Document

class InventoryLoss(Document):
    def before_insert(self):
        if not self.flags.get("workspace_service"):
            frappe.throw("请通过库存工作台创建遗失记录", frappe.PermissionError)

    def before_save(self):
        if not self.is_new() and not (self.flags.get("workspace_service") or self.flags.get("from_stock_entry")):
            frappe.throw("请通过库存工作台或关联 Stock Entry 修改此记录", frappe.PermissionError)

    def validate(self):
        if not self.items: frappe.throw("遗失至少需要一项")
        if not self.recorded_by: self.recorded_by=frappe.session.user
        if not self.no_independent_reviewer and (not self.reviewer_name or not self.reviewer_signature): frappe.throw("请填写鉴证人和签名，或选择无独立鉴证人")
        for row in self.items:
            if row.qty <= 0 or not row.source_warehouse: frappe.throw("遗失数量和来源仓库为必填")
            if row.original_loan_item:
                if row.source_warehouse != frappe.db.get_value("Temple Inventory Settings", None, "loan_warehouse") and frappe.db.get_value("Warehouse", row.source_warehouse, "warehouse_name") != "借出": frappe.throw("借出遗失必须从借出库")
    def on_update_after_submit(self):
        if not self.flags.get("from_stock_entry"):
            frappe.throw("请通过关联 Stock Entry 修改遗失记录", frappe.PermissionError)

    def on_cancel(self):
        if not self.flags.get("from_stock_entry"): frappe.throw("请从关联 Stock Entry 取消遗失")
