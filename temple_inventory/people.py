"""Permission-scoped name suggestions for browse filters."""

import frappe

from temple_inventory.native_access import require_app


def _suggestions(doctype, field, search, filters=None, limit=30):
	search = str(search or "").strip()[:100]
	conditions = dict(filters or {})
	conditions[field] = ["like", f"%{search}%"] if search else ["!=", ""]
	if doctype in ("Stock Entry", "Stock Reconciliation"):
		allowed_names = _documents_with_visible_warehouses(doctype, conditions)
		if allowed_names is not None:
			conditions["name"] = ["in", sorted(allowed_names) or [""]]
	rows = frappe.get_list(
		doctype,
		filters=conditions,
		fields=[field, {"COUNT": "name", "as": "count"}],
		group_by=field,
		order_by="count desc, " + field + " asc",
		limit_page_length=min(50, max(1, int(limit))),
	)
	return [
		{"value": row[field], "label": row[field], "count": int(row.count or 0)} for row in rows if row[field]
	]


def _documents_with_visible_warehouses(doctype, conditions):
	"""Return matching readable documents whose lines use only readable warehouses."""
	settings = frappe.get_single("Temple Inventory Settings")
	warehouse_names = set(
		frappe.get_list(
			"Warehouse",
			filters={"company": settings.company},
			fields=["name"],
			limit_page_length=0,
			pluck="name",
		)
	)
	if len(warehouse_names) == frappe.db.count("Warehouse", {"company": settings.company}):
		return None
	documents = frappe.get_list(
		doctype, filters=conditions, fields=["name"], limit_page_length=0, pluck="name"
	)
	if not documents:
		return set()
	if doctype == "Stock Entry":
		warehouse_check = """(s_warehouse is not null and s_warehouse not in %(warehouses)s)
			or (t_warehouse is not null and t_warehouse not in %(warehouses)s)"""
	else:
		warehouse_check = "warehouse is not null and warehouse not in %(warehouses)s"
	params = {"documents": tuple(documents)}
	if warehouse_names:
		params["warehouses"] = tuple(warehouse_names)
		outside = warehouse_check
	else:
		outside = warehouse_check.replace("s_warehouse not in %(warehouses)s", "s_warehouse is not null")
		outside = outside.replace("t_warehouse not in %(warehouses)s", "t_warehouse is not null")
		outside = outside.replace("warehouse not in %(warehouses)s", "warehouse is not null")
	invalid = frappe.db.sql(
		f"select distinct parent from `tab{'Stock Entry Detail' if doctype == 'Stock Entry' else 'Stock Reconciliation Item'}` "
		f"where parent in %(documents)s and ({outside})",
		params,
		pluck=True,
	)
	return set(documents) - set(invalid)


@frappe.whitelist()
def recorded_names(search="", role="any", limit=30):
	"""Return distinct recorded names visible to the current user."""
	require_app()
	fields = {
		"recorder": "ti_recorder_name",
		"handler": "ti_handler_name",
		"reviewer": "ti_reviewer_name",
	}
	if role not in ("any", *fields):
		frappe.throw("人员角色无效")
	roles = fields if role == "any" else {role: fields[role]}
	result = {}
	for doctype in ("Stock Entry", "Stock Reconciliation"):
		meta = frappe.get_meta(doctype)
		for fieldname in roles.values():
			if meta.has_field(fieldname):
				for row in _suggestions(doctype, fieldname, search, {"docstatus": ["in", [0, 1, 2]]}, limit):
					entry = result.setdefault(
						row["value"], {"value": row["value"], "label": row["label"], "count": 0}
					)
					entry["count"] += row["count"]
	return sorted(result.values(), key=lambda row: (-row["count"], row["value"].casefold()))[
		: min(50, max(1, int(limit)))
	]


@frappe.whitelist()
def borrowers(search="", limit=30):
	"""Return distinct borrower metadata from loan records the user can read."""
	require_app()
	return _suggestions(
		"Stock Entry",
		"ti_borrower",
		search,
		{"ti_movement_kind": "Loan", "docstatus": ["in", [0, 1, 2]]},
		limit,
	)
