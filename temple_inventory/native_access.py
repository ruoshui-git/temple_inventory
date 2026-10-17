"""Shared authorization and optimistic locking for native inventory documents."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

from contextvars import ContextVar
from functools import wraps

import frappe
from frappe.utils import get_datetime

NATIVE_DOCTYPES = {"Stock Entry", "Stock Reconciliation"}
_request_write_depth = ContextVar("inventory_request_write_depth", default=0)


def retry_native_request(function):
	"""Restart a whole HTTP write after a native transaction/snapshot deadlock.

	MariaDB snapshot isolation can reject a locking read after another request
	commits, even though the account/document locks correctly serialize the writes.
	Only the outer HTTP operation owns this retry. Internal calls and savepoint
	tests must never roll back their caller's transaction. No stock is committed here.
	"""

	@wraps(function)
	def wrapped(*args, **kwargs):
		request = getattr(frappe.local, "request", None)
		if not request or request.method != "POST" or _request_write_depth.get():
			return function(*args, **kwargs)
		token = _request_write_depth.set(1)
		try:
			for attempt in range(3):
				try:
					return function(*args, **kwargs)
				except frappe.QueryDeadlockError:
					if attempt == 2:
						raise
					frappe.db.rollback()
		finally:
			_request_write_depth.reset(token)

	return wrapped


def check_request_account():
	request = getattr(frappe.local, "request", None)
	expected = request.headers.get("X-Inventory-Account") if request else None
	if expected and expected != frappe.session.user:
		frappe.throw("登录账户已变化，请重新验证后继续；当前输入仍保留", frappe.AuthenticationError)


def require_app():
	require_frontend_account()
	if not erpnext_installed():
		frappe.throw("需要先安装 ERPNext")
	frappe.has_permission("Stock Entry", "read", throw=True)
	company = frappe.db.get_single_value("Temple Inventory Settings", "company")
	if company:
		frappe.get_doc("Company", company).check_permission("read")


def erpnext_installed():
	return "erpnext" in frappe.get_installed_apps()


def require_frontend_account(check_account=True):
	if frappe.session.user == "Guest":
		frappe.throw("请先完成登录", frappe.AuthenticationError)
	if "System Manager" not in frappe.get_roles():
		frappe.throw("当前账户无权使用物资管理", frappe.PermissionError)
	if check_account:
		check_request_account()


def check_version(doc, version):
	try:
		matches = bool(version) and get_datetime(version) == get_datetime(doc.modified)
	except ValueError, TypeError, OverflowError:
		matches = False
	if not matches:
		frappe.throw("记录已被更改，请保留当前输入并重新载入", frappe.TimestampMismatchError)


def load_locked(doctype, name, version, permission="write"):
	if doctype not in NATIVE_DOCTYPES | {"Item", "Inventory Activity"}:
		frappe.throw("不支持的记录类型")
	doc = frappe.get_doc(doctype, name, for_update=True)
	doc.check_permission(permission)
	check_version(doc, version)
	return doc


def check_company(doc):
	from temple_inventory.native_topology import _settings

	if not doc.company or doc.company != _settings().company:
		frappe.throw("记录不属于当前库存公司", frappe.PermissionError)
	frappe.get_doc("Company", doc.company).check_permission("read")


def check_item(item_code, *, lock=False):
	item = frappe.get_doc("Item", item_code, for_update=lock)
	item.check_permission("read")
	return item


def check_document_scope(doc):
	"""A document detail never leaks a hidden allocation through another visible row."""
	from temple_inventory.native_balances import entry_bundle
	from temple_inventory.native_topology import _visible_warehouses

	check_company(doc)
	visible = _visible_warehouses()
	for row in [*(doc.get("items") or []), *(doc.get("ti_count_review") or [])]:
		check_item(row.item_code)
		if row.get("batch_no"):
			frappe.get_doc("Batch", row.batch_no).check_permission("read")
		entry_bundle(row)
		if doc.doctype == "Stock Reconciliation":
			entry_bundle(row, "current_serial_and_batch_bundle")
		for field in ("warehouse", "s_warehouse", "t_warehouse"):
			warehouse = row.get(field)
			if warehouse:
				if warehouse not in visible:
					frappe.throw("记录包含无权查看的位置", frappe.PermissionError)
				frappe.get_doc("Warehouse", warehouse).check_permission("read")
