"""Shared inclusive date-period resolution for inventory browse APIs."""

from calendar import monthrange

import frappe
from frappe import _
from frappe.utils import add_days, getdate, nowdate

PERIOD_KEYS = {
	"all",
	"today",
	"last_7_days",
	"last_30_days",
	"last_90_days",
	"last_365_days",
	"this_week",
	"this_month",
	"this_year",
	"this_quarter",
	"last_quarter",
	"custom",
}


def resolve_period(filters, default=False, today_provider=nowdate):
	"""Resolve an inclusive period using the server date and optional date bounds."""
	key = str(filters.get("period_key") or ("all" if default else "")).strip()
	if not key:
		return None
	if key not in PERIOD_KEYS:
		key = "all" if default else ""
	if not key:
		return None
	if key == "all":
		return {"key": "all", "date_from": "", "date_to": ""}
	today = getdate(today_provider())
	if key == "custom":
		date_from = str(filters.get("date_from") or "")
		date_to = str(filters.get("date_to") or "")
		try:
			start, end = getdate(date_from), getdate(date_to)
		except Exception:
			frappe.throw(_("Invalid custom date range"))
		if not date_from or not date_to or str(start) != date_from or str(end) != date_to:
			frappe.throw(_("Invalid custom date range"))
		if start > end:
			frappe.throw(_("Start date cannot be after end date"))
	elif key in ("this_quarter", "last_quarter"):
		quarter = (today.month - 1) // 3
		start_month = quarter * 3 + 1
		if key == "last_quarter":
			start_month -= 3
			if start_month < 1:
				start_month += 12
				year = today.year - 1
			else:
				year = today.year
		else:
			year = today.year
		start = today.replace(year=year, month=start_month, day=1)
		end_month = start_month + 2
		end = (
			today
			if key == "this_quarter"
			else today.replace(year=year, month=end_month, day=monthrange(year, end_month)[1])
		)
	else:
		end = today
		if key == "today":
			start = today
		elif key == "last_7_days":
			start = getdate(add_days(today, -6))
		elif key == "last_30_days":
			start = getdate(add_days(today, -29))
		elif key == "last_90_days":
			start = getdate(add_days(today, -89))
		elif key == "last_365_days":
			start = getdate(add_days(today, -364))
		elif key == "this_week":
			start = getdate(add_days(today, -today.weekday()))
		elif key == "this_month":
			start = today.replace(day=1)
		else:
			start = today.replace(month=1, day=1)
	return {"key": key, "date_from": str(start), "date_to": str(end)}
