"""Apply JSON line restrictions to both app endpoints and standard Frappe APIs."""

import json

import frappe


def _scope(user):
	from temple_inventory.inventory_api import _settings, _visible_warehouses

	if user != frappe.session.user:
		return None
	return (
		_settings().company,
		set(_visible_warehouses()),
		set(frappe.get_list("Item", pluck="name", limit_page_length=0)),
	)


def _permitted(doc, scope):
	if not scope or doc.company != scope[0]:
		return False
	state = doc.state_json or {}
	if isinstance(state, str):
		state = json.loads(state)
	for row in state.get("items", []):
		if row.get("item_code") and row["item_code"] not in scope[2]:
			return False
		if any(
			row.get(k) and row[k] not in scope[1] for k in ("warehouse", "from_warehouse", "to_warehouse")
		):
			return False
	return True


def has_permission(doc, user=None, permission_type=None, **kwargs):
	if not _permitted(doc, _scope(user or frappe.session.user)):
		return False
	# Controllers can only deny; True continues normal role/User Permission checks.
	return True


def query_conditions(user=None):
	scope = _scope(user or frappe.session.user)
	if not scope:
		return "1=0"
	rows = frappe.get_all("Inventory Workspace", fields=["name", "company", "state_json"])
	names = [frappe.db.escape(row.name) for row in rows if _permitted(row, scope)]
	return "`tabInventory Workspace`.name in (" + ",".join(names) + ")" if names else "1=0"
