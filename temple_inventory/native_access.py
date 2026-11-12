"""Shared authorization and optimistic locking for native inventory documents."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import random
import time
from contextvars import ContextVar
from functools import wraps

import frappe
from frappe.utils import get_datetime

NATIVE_DOCTYPES = {"Stock Entry", "Stock Reconciliation"}
NO_INVENTORY_ROLE = "当前账户尚未分配物资管理角色，请联系管理员"
_request_write_depth = ContextVar("inventory_request_write_depth", default=0)


def retry_native_job(function, *, attempts=3):
	"""Retry one background transaction after MariaDB rejects its snapshot."""
	for attempt in range(attempts):
		try:
			return function()
		except frappe.QueryDeadlockError:
			frappe.db.rollback()
			if attempt + 1 == attempts:
				raise
			time.sleep(random.uniform(0.05, 0.5))


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


def has_inventory_role(user, user_roles=None):
	"""Check a live role list for any app role."""
	from temple_inventory.roles import ROLES

	if user_roles is None:
		user_roles = frappe.db.get_all(
			"Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role"
		)
	return bool(set(user_roles).intersection(ROLES))


def enabled_inventory_user(user):
	"""Return whether a user is an enabled System User assigned an app role."""
	account = frappe.db.get_value("User", user, ["enabled", "user_type"], as_dict=True)
	if not account or not account.enabled or account.user_type != "System User":
		return False
	return has_inventory_role(user)


def frontend_account_denial():
	"""Return (message, exception) when the session may not use the frontend, else None."""
	if frappe.session.user == "Guest":
		return "请先完成登录", frappe.AuthenticationError
	# Frappe's role list is shared through Redis and may remain warm until
	# after_commit. API reads must reflect a committed role change immediately,
	# including a revoke between cache fill and a subsequent page request.
	user = frappe.session.user
	if user == "Administrator":
		return None
	account = frappe.db.get_value("User", user, ["enabled", "user_type"], as_dict=True)
	if not account or not account.enabled or account.user_type != "System User":
		return "当前账户无权使用物资管理", frappe.PermissionError
	db_roles = set(
		frappe.db.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role")
	)
	cached_roles = set(frappe.get_roles(user)) - set(frappe.permissions.AUTOMATIC_ROLES)
	if db_roles != cached_roles:
		frappe.cache.hdel("roles", user)
	if not has_inventory_role(user, db_roles):
		return NO_INVENTORY_ROLE, frappe.PermissionError
	return None


def require_frontend_account(check_account=True):
	from temple_inventory.native_topology import request_memo

	memo = request_memo("frontend_account_access")
	user = frappe.session.user
	cached = memo is not None and user in memo
	denial = memo[user] if cached else frontend_account_denial()
	if memo is not None and not cached:
		memo[user] = denial
	if denial:
		frappe.throw(*denial)
	if not cached:
		# Discard permission objects that may predate the first live role check.
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}
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
	if doctype not in NATIVE_DOCTYPES | {"Item", "Batch", "Inventory Activity"}:
		frappe.throw("不支持的记录类型")
	doc = frappe.get_doc(doctype, name, for_update=True)
	doc.check_permission(permission)
	check_version(doc, version)
	return doc


def check_company(doc):
	from temple_inventory.native_topology import _settings, request_memo

	if not doc.company or doc.company != _settings().company:
		frappe.throw("记录不属于当前库存公司", frappe.PermissionError)
	memo = request_memo("company_read_permissions")
	key = (frappe.session.user, doc.company)
	if memo is None or key not in memo:
		frappe.get_doc("Company", doc.company).check_permission("read")
		if memo is not None:
			memo[key] = True


def check_item(item_code, *, lock=False):
	item = frappe.get_doc("Item", item_code, for_update=lock)
	item.check_permission("read")
	return item


def check_document_scope(
	doc,
	*,
	visible_warehouses=None,
	item_checker=None,
	batch_checker=None,
	company_checker=None,
	warehouse_checker=None,
	bundle_cache=None,
	bundle_loader=None,
):
	"""A document detail never leaks a hidden allocation through another visible row."""
	from temple_inventory.native_balances import entry_bundle
	from temple_inventory.native_topology import _visible_warehouses

	if company_checker:
		company_checker(doc)
	else:
		check_company(doc)
	visible = visible_warehouses if visible_warehouses is not None else _visible_warehouses()
	rows = [*(doc.get("items") or []), *(doc.get("ti_count_review") or [])]
	item_names = {row.get("item_code") for row in rows if row.get("item_code")}
	batch_names = {row.get("batch_no") for row in rows if row.get("batch_no")}
	warehouse_names = {
		row.get(field)
		for row in rows
		for field in ("warehouse", "s_warehouse", "t_warehouse")
		if row.get(field)
	}

	def readable(doctype, names):
		"""One permission-filtered query per doctype; DocType and User Permissions apply."""
		return set(
			frappe.get_list(
				doctype, filters={"name": ["in", sorted(names)]}, pluck="name", limit_page_length=0
			)
		)

	# Item checkers return None for a hidden Item; Batch and Warehouse checkers raise.
	if item_checker:
		hidden_items = any(item_checker(name) is None for name in item_names)
	else:
		hidden_items = bool(item_names) and readable("Item", item_names) != item_names
	if hidden_items:
		frappe.throw("记录包含无权查看的物品", frappe.PermissionError)
	for name in warehouse_names:
		if name not in visible:
			frappe.throw("记录包含无权查看的位置", frappe.PermissionError)
	for doctype, names, checker in (
		("Warehouse", warehouse_names, warehouse_checker),
		("Batch", batch_names, batch_checker),
	):
		if checker:
			for name in names:
				checker(name)
		elif names and readable(doctype, names) != names:
			frappe.throw(f"记录包含无权查看的{doctype}", frappe.PermissionError)

	for row in rows:
		bundle_row = frappe._dict(row.as_dict() if hasattr(row, "as_dict") else dict(row))
		bundle_row["_parent_docstatus"] = doc.docstatus
		entry_bundle(bundle_row, bundle_cache=bundle_cache, bundle_loader=bundle_loader)
		if doc.doctype == "Stock Reconciliation":
			entry_bundle(
				bundle_row,
				"current_serial_and_batch_bundle",
				bundle_cache=bundle_cache,
				bundle_loader=bundle_loader,
			)


def capabilities():
	"""Native DocPerm capability payload; never infer rights from role labels."""
	checks = {
		"stock_entry": ("Stock Entry", ("read", "create", "write", "submit", "cancel", "amend", "delete")),
		"stock_reconciliation": (
			"Stock Reconciliation",
			("read", "create", "write", "submit", "cancel", "amend", "delete"),
		),
		"item": ("Item", ("create", "write", "delete")),
		"batch": ("Batch", ("create", "write")),
		"activity": ("Inventory Activity", ("create", "write", "delete")),
		"activity_type": ("Inventory Activity Type", ("create", "write", "delete")),
		"item_group": ("Item Group", ("create", "write", "delete")),
		"uom": ("UOM", ("create", "write", "delete")),
		"warehouse": ("Warehouse", ("create", "write", "delete")),
		"settings": ("Temple Inventory Settings", ("write",)),
		"imports": ("Inventory Import", ("create",)),
	}
	return {
		key: {ptype: bool(frappe.has_permission(doctype, ptype)) for ptype in ptypes}
		for key, (doctype, ptypes) in checks.items()
	}


def role_label():
	from temple_inventory.roles import ROLE_LABELS

	if frappe.session.user == "Administrator":
		return ROLE_LABELS["Inventory Administrator"]
	roles = set(
		frappe.db.get_all(
			"Has Role", filters={"parent": frappe.session.user, "parenttype": "User"}, pluck="role"
		)
	)
	for role in reversed(tuple(ROLE_LABELS)):
		if role in roles:
			return ROLE_LABELS[role]
	return ""
