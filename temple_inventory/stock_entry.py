"""Narrow Stock Entry policy extensions for app-owned inventory movements."""

import frappe
from frappe.utils import getdate


class InventoryStockEntryMixin:
	def validate_serialized_batch(self):
		"""Permit truthful receipt of expired donated batches.

		The shared native hooks validate structured Receive movements from either
		editor, including Item/Batch access, identity, disabled state and dates.
		All other purposes retain ERPNext's ordinary expiry validation.
		"""
		if self.get("ti_movement_kind") != "Receive" or self.purpose != "Material Receipt":
			return super().validate_serialized_batch()

		expired_receipts = []
		for row in self.get("items"):
			if not row.batch_no or row.s_warehouse or not row.t_warehouse:
				continue
			expiry_date = frappe.get_cached_value("Batch", row.batch_no, "expiry_date")
			if expiry_date and getdate(expiry_date) < getdate(self.posting_date):
				expired_receipts.append((row, row.batch_no))
				row.batch_no = None
		try:
			return super().validate_serialized_batch()
		finally:
			for row, batch_no in expired_receipts:
				row.batch_no = batch_no
