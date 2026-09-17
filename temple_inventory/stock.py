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
	if not doc.get("ti_signature"):
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
