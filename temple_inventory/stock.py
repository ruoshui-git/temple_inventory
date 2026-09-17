"""Submission validation that also protects Desk/API use."""

import frappe
from frappe import _


def validate_stock_entry_submission(doc, method=None):
    if not doc.get("ti_movement_kind"):
        return
    missing = []
    if not doc.get("ti_responsible_person"):
        missing.append(_("Responsible Person"))
    if not doc.get("ti_signature"):
        missing.append(_("Signature"))
    if missing:
        frappe.throw(_("{0} is required before submitting this inventory movement.").format(", ".join(missing)))
