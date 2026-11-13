from datetime import timedelta

import frappe
from frappe.utils import get_datetime

FUTURE_POSTING_TOLERANCE = timedelta(seconds=60)


def reject_future_posting(doc, message):
	if not doc.get("set_posting_time") or not doc.get("posting_date") or not doc.get("posting_time"):
		return
	posting_datetime = get_datetime(f"{doc.posting_date} {doc.posting_time}")
	if posting_datetime > frappe.utils.now_datetime() + FUTURE_POSTING_TOLERANCE:
		frappe.throw(message, frappe.ValidationError)
