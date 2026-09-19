import frappe
from frappe.model.document import Document

class InventoryReturn(Document):
    def before_insert(self):
        if not self.flags.get("workspace_service"):
            frappe.throw("请通过库存工作台创建归还记录", frappe.PermissionError)

    def before_save(self):
        if not self.is_new() and not (self.flags.get("workspace_service") or self.flags.get("from_stock_entry")):
            frappe.throw("请通过库存工作台或关联 Stock Entry 修改此记录", frappe.PermissionError)

    def validate(self):
        if not self.items: frappe.throw("归还至少需要一项")
        if not self.recorded_by: self.recorded_by=frappe.session.user
        if not self.no_independent_reviewer and (not self.reviewer_name or not self.reviewer_signature): frappe.throw("请填写鉴证人和签名，或选择无独立鉴证人")
        for row in self.items:
            if row.qty <= 0 or not row.loan_item: frappe.throw("归还必须引用借出明细")
            if row.outcome == "Damaged" and not frappe.db.get_value("Warehouse", row.target_warehouse, "warehouse_name") == "损坏待处理": frappe.throw("损坏归还必须进入损坏待处理")
    def on_update_after_submit(self):
        if not self.flags.get("from_stock_entry"):
            frappe.throw("请通过关联 Stock Entry 修改归还记录", frappe.PermissionError)

    def on_cancel(self):
        if not self.flags.get("from_stock_entry"): frappe.throw("请从关联 Stock Entry 取消归还")
