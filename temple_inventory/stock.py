"""Protect workspace-owned Stock Entries across Desk and API use."""

import frappe
from frappe import _


def workspace_for_stock_entry(doc):
	"""Return the authoritative workspace owner, if this entry has one."""
	if doc.is_new() or not doc.name or not frappe.db.exists("DocType", "Inventory Workspace"):
		return None
	return frappe.db.get_value("Inventory Workspace", {"stock_entry": doc.name}, "name")


def protect_workspace_entry(doc, method=None):
	if doc.is_new() or doc.flags.workspace_service or not frappe.db.exists("DocType", "Inventory Workspace"):
		return
	if workspace_for_stock_entry(doc) and doc.docstatus != 2:
		frappe.throw(
			_("Edit and confirm this transaction in the inventory workspace"), frappe.PermissionError
		)


def propagate_stock_entry_cancellation(doc, method=None):
    """ERPNext Stock Entry is the authoritative cancellation entry point."""
    if not doc.get("ti_movement_kind"): return
    links = [("Inventory Loan", "ti_loan"), ("Inventory Return", "ti_return"), ("Inventory Loss", "ti_loss")]
    for doctype, field in links:
        name = doc.get(field)
        if not name: continue
        if doctype == "Inventory Loan":
            active = frappe.db.sql("""select 1 from `tabInventory Return Item` ri join `tabInventory Return` r on r.name=ri.parent where r.docstatus=1 and ri.loan_item in (select name from `tabInventory Loan Item` where parent=%s) limit 1""", name)
            active += frappe.db.sql("""select 1 from `tabInventory Loss Item` li join `tabInventory Loss` l on l.name=li.parent where l.docstatus=1 and li.original_loan_item in (select name from `tabInventory Loan Item` where parent=%s) limit 1""", name)
            if active: frappe.throw("已存在归还或遗失记录，不能取消借出")
        linked = frappe.get_doc(doctype, name)
        if linked.docstatus == 1:
            linked.flags.from_stock_entry = True
            linked.cancel()
