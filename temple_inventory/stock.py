"""Submission validation that also protects Desk/API use."""

import frappe
from frappe import _


def validate_stock_entry_submission(doc, method=None):
	if not doc.get("ti_movement_kind"):
		return
	if doc.ti_responsible_person and not frappe.db.get_value("User", doc.ti_responsible_person, "enabled"):
		frappe.throw(_("Responsible person must be an enabled user"))
	missing = []
	if not doc.get("ti_responsible_person"):
		missing.append(_("Responsible Person"))
	if not doc.get("ti_recorder_signature"):
		missing.append(_("Signature"))
	if missing:
		frappe.throw(
			_("{0} is required before submitting this inventory movement.").format(", ".join(missing))
		)


def protect_workspace_entry(doc, method=None):
	if doc.is_new() or doc.flags.workspace_service or not frappe.db.exists("DocType", "Inventory Workspace"):
		return
	if frappe.db.exists("Inventory Workspace", {"stock_entry": doc.name}) and doc.docstatus != 2:
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
