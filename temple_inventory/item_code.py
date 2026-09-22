"""The single allocator for Item identifiers owned by Temple Inventory."""

import re

import frappe
from frappe import _
from frappe.model.naming import make_autoname

ITEM_CODE_PATTERN = re.compile(r"^ITM-(\d{6})$")
ITEM_CODE_SERIES = "ITM-.######"
MAX_ITEM_NUMBER = 999999


def allocate_item_code():
	"""Allocate a unique six-digit ITM code using Frappe's locked series row."""
	for _attempt in range(MAX_ITEM_NUMBER + 1):
		code = make_autoname(ITEM_CODE_SERIES)
		match = ITEM_CODE_PATTERN.fullmatch(code or "")
		if not match:
			if str(code or "").startswith("ITM-"):
				frappe.throw(_("Item code capacity ITM-999999 has been exhausted"))
			frappe.throw(_("The Item code allocator returned an invalid code"))
		if int(match.group(1)) > MAX_ITEM_NUMBER:
			frappe.throw(_("Item code capacity ITM-999999 has been exhausted"))
		if not frappe.db.exists("Item", code):
			return code
	frappe.throw(_("Item code capacity ITM-999999 has been exhausted"))
