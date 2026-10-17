"""Permission-filtered native Warehouse topology and Desk leaf discovery."""

import frappe
from frappe.utils import cint

SYSTEM_POINTERS = (
	"root_warehouse",
	"physical_root_warehouse",
	"leased_warehouse",
	"default_lease_program_warehouse",
	"damaged_warehouse",
)


def _settings():
	return frappe.get_single("Temple Inventory Settings")


def _warehouse_map(company):
	if not company:
		return {}
	rows = frappe.get_list(
		"Warehouse",
		filters={"company": company},
		fields=[
			"name",
			"warehouse_name",
			"parent_warehouse",
			"warehouse_type",
			"company",
			"is_group",
			"disabled",
			"lft",
			"rgt",
		],
		order_by="lft asc, name asc",
		limit_page_length=0,
	)
	return {row.name: row for row in rows}


def _visible_warehouses(settings=None):
	settings = settings or _settings()
	if not settings.root_warehouse:
		return {}
	root = frappe.db.get_value("Warehouse", settings.root_warehouse, ["lft", "rgt"], as_dict=True)
	if not root:
		return {}
	return {
		name: row
		for name, row in _warehouse_map(settings.company).items()
		if row.lft >= root.lft and row.rgt <= root.rgt
	}


def _system_warehouse_names(settings=None):
	settings = settings or _settings()
	return {settings.get(field) for field in SYSTEM_POINTERS if settings.get(field)}


def _physical_tree(settings=None):
	settings = settings or _settings()
	visible = _visible_warehouses(settings)
	root = visible.get(settings.physical_root_warehouse)
	if not root or not root.is_group:
		return {}
	protected = _system_warehouse_names(settings)
	return {
		name: row
		for name, row in visible.items()
		if name not in protected and root.lft < row.lft and row.rgt < root.rgt
	}


def _enabled_branch(row, visible):
	seen = set()
	while row and row.name not in seen:
		if row.disabled:
			return False
		seen.add(row.name)
		row = visible.get(row.parent_warehouse)
	return True


def _allowed_warehouses(settings=None):
	settings = settings or _settings()
	visible = _visible_warehouses(settings)
	return {
		row.warehouse: visible[row.warehouse]
		for row in settings.get("allowed_warehouses", [])
		if row.warehouse in visible
		and not visible[row.warehouse].is_group
		and _enabled_branch(visible[row.warehouse], visible)
	}


def _warehouse_presentation(rows):
	result = []
	for name, row in rows.items():
		ancestors, seen = [], {name}
		parent = rows.get(row.parent_warehouse)
		while parent and parent.name not in seen:
			ancestors.append(parent.warehouse_name)
			seen.add(parent.name)
			parent = rows.get(parent.parent_warehouse)
		result.append(
			{
				**dict(row),
				"local_label": row.warehouse_name,
				"breadcrumb": " / ".join([*reversed(ancestors), row.warehouse_name]),
			}
		)
	return result


def _allow_warehouses(settings, warehouses):
	settings.reload()
	existing = {row.warehouse for row in settings.get("allowed_warehouses", [])}
	for warehouse in warehouses:
		if warehouse and warehouse not in existing:
			settings.append("allowed_warehouses", {"warehouse": warehouse})
			existing.add(warehouse)
	settings.save(ignore_permissions=True)


def _remove_allowed_warehouse(settings, warehouse):
	settings.reload()
	remaining = [
		row.warehouse for row in settings.get("allowed_warehouses", []) if row.warehouse != warehouse
	]
	if len(remaining) != len(settings.get("allowed_warehouses", [])):
		settings.set("allowed_warehouses", [{"warehouse": name} for name in remaining])
		settings.save(ignore_permissions=True)


def _warehouse_is_below(name, ancestor):
	seen = set()
	while name and name not in seen:
		if name == ancestor:
			return True
		seen.add(name)
		name = frappe.db.get_value("Warehouse", name, "parent_warehouse")
	return False


def sync_desk_warehouse_allowlist(doc, method=None):
	"""Discover new eligible leaves; preserve deliberate removals from the allowlist."""
	if not frappe.db.exists("DocType", "Temple Inventory Settings"):
		return
	settings = _settings()
	before = doc.get_doc_before_save() if not doc.is_new() else None

	def eligible(row):
		return bool(
			row
			and settings.company
			and row.company == settings.company
			and settings.physical_root_warehouse
			and not cint(row.is_group)
			and not cint(row.disabled)
			and str(row.warehouse_type or "").lower() in {"", "room", "location"}
			and _warehouse_is_below(row.parent_warehouse, settings.physical_root_warehouse)
		)

	was_eligible = eligible(before)
	if not eligible(doc):
		if was_eligible:
			_remove_allowed_warehouse(settings, doc.name)
	elif not was_eligible:
		_allow_warehouses(settings, [doc.name])
