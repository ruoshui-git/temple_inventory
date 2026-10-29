"""Permission-filtered native Warehouse topology and location presentation."""

import frappe
from frappe.utils import cint

from temple_inventory.warehouse_names import build_paths, full_label, local_label

SYSTEM_POINTERS = (
	"root_warehouse",
	"physical_root_warehouse",
	"system_root_warehouse",
	"leased_warehouse",
	"damaged_warehouse",
)


def _settings():
	"""Temple Inventory Settings for reading; callers that change it load their own copy.

	Scope checks read the settings several times per save. Building the Single is
	the costly part, so reuse the copy built for the same stored rows. The rows are
	read every call, so writes, direct SQL and rolled-back transactions all show.
	"""
	state = (
		tuple(
			frappe.db.sql(
				"select field, value from tabSingles where doctype='Temple Inventory Settings' order by field"
			)
		),
		tuple(
			frappe.db.sql(
				"""select name, idx, warehouse from `tabTemple Inventory Allowed Warehouse`
				where parent='Temple Inventory Settings' and parenttype='Temple Inventory Settings'
				order by idx, name"""
			)
		),
	)
	cached = getattr(frappe.local, "temple_inventory_settings", None)
	if cached and cached[0] == state:
		return cached[1]
	settings = frappe.get_single("Temple Inventory Settings")
	frappe.local.temple_inventory_settings = (state, settings)
	return settings


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
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
			"company",
			"is_group",
			"disabled",
			"lft",
			"rgt",
			"modified",
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
		if cint(row.disabled):
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
		and not cint(visible[row.warehouse].is_group)
		and _enabled_branch(visible[row.warehouse], visible)
	}


def _derived_kind(row, direct_by_parent, rows, systems):
	if row.name in systems or row.warehouse_type == "System":
		return "system"
	if cint(row.is_group):
		if row.warehouse_type in ("Area", "Room", "Shelf"):
			return row.warehouse_type.lower()
		if direct_by_parent.get(row.name):
			parent = rows.get(row.parent_warehouse)
			return "shelf" if parent and parent.warehouse_type in ("Room", "Shelf") else "room"
		return "area"
	return "shelf"


def _can_edit(name, systems):
	if name in systems:
		return False
	try:
		return bool(frappe.has_permission("Warehouse", "write", doc=name))
	except (frappe.DoesNotExistError, frappe.PermissionError):
		return False


def present_locations(rows, *, physical_root=None, settings=None):
	"""Return the one canonical, user-facing representation of Warehouse rows."""
	settings = settings or _settings()
	physical_root = physical_root or settings.physical_root_warehouse
	if isinstance(rows, dict):
		rows = {name: frappe._dict(row) for name, row in rows.items()}
	else:
		rows = {row.get("name"): frappe._dict(row) for row in rows if row.get("name")}
	systems = _system_warehouse_names(settings)
	direct_by_parent = {}
	owners = {}
	for name, row in rows.items():
		if cint(row.get("ti_direct_storage")):
			owners[name] = row.parent_warehouse
			direct_by_parent.setdefault(row.parent_warehouse, []).append(row)
	paths = build_paths(
		rows,
		excluded_roots=(physical_root, settings.root_warehouse, settings.system_root_warehouse),
		direct_owners=owners,
	)

	items = []
	for name, row in rows.items():
		parent = rows.get(row.parent_warehouse)
		is_direct = bool(cint(row.get("ti_direct_storage")))
		owner_name = owners.get(name, "")
		kind = _derived_kind(row, direct_by_parent, rows, systems)
		direct = direct_by_parent.get(name, [])
		missing_direct = kind in {"room", "shelf"} and cint(row.is_group) and not direct
		path = paths[name]
		local = local_label(row)
		if is_direct:
			local = local_label(rows.get(owner_name) or row)
			kind = _derived_kind(rows.get(owner_name) or row, direct_by_parent, rows, systems)
			path = paths.get(owner_name, path)
		full = full_label(row, rows, owner_name if is_direct else "")
		ancestor_terms = []
		ancestor = rows.get(row.parent_warehouse)
		while ancestor:
			ancestor_terms.extend(
				filter(None, (str(ancestor.get("ti_label") or ""), str(ancestor.get("ti_short_label") or "")))
			)
			ancestor = rows.get(ancestor.parent_warehouse)
		search_terms = [
			" / ".join(path),
			full,
			str(row.warehouse_name or ""),
			str(row.get("ti_short_label") or ""),
			str(row.get("ti_label") or ""),
			*ancestor_terms,
		]
		search_text = " ".join(dict.fromkeys(filter(None, search_terms)))
		storable = bool(is_direct or (not cint(row.is_group) and not is_direct) or direct)
		if missing_direct:
			storable = False
		label = local
		if is_direct and owner_name in rows:
			label = local_label(rows[owner_name])
		elif kind == "shelf" and parent and parent.name not in (physical_root, settings.root_warehouse):
			label = f"{local_label(parent)} / {local}"
		items.append(
			{
				"name": name,
				"label": label,
				"local_label": str(row.get("ti_label") or ""),
				"short_label": str(row.get("ti_short_label") or ""),
				"full_label": full,
				"path": " / ".join(path),
				"native_name": str(row.get("warehouse_name") or ""),
				"search_text": search_text,
				"kind": kind,
				"owner": owner_name,
				"direct": is_direct,
				"storable": storable,
				"missing_direct": missing_direct,
				"parent": row.parent_warehouse or "",
				"is_group": bool(cint(row.is_group)),
				"disabled": bool(cint(row.disabled)),
				"lft": row.get("lft"),
				"rgt": row.get("rgt"),
				"version": str(row.get("modified") or ""),
				"protected": name in systems,
				"can_edit": _can_edit(name, systems),
			}
		)
	# Keep names unique with the shortest ancestor suffix needed to distinguish peers.
	by_label = {}
	for item in items:
		if not item["direct"]:
			by_label.setdefault(item["label"], []).append(item)
	for duplicates in by_label.values():
		if len(duplicates) < 2:
			continue
		for item in duplicates:
			parts = item["path"].split(" / ")
			for size in range(2, len(parts) + 1):
				candidate = " / ".join(parts[-size:])
				if sum(other["path"].endswith(candidate) for other in duplicates) == 1:
					item["label"] = candidate
					break
			else:
				item["label"] = item["path"]
	labels = {item["name"]: item["label"] for item in items}
	for item in items:
		if item["direct"] and item["owner"] in labels:
			item["label"] = labels[item["owner"]]
	return items


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
	"""Discover newly created eligible stock leaves and remove ineligible ones."""
	if not frappe.db.exists("DocType", "Temple Inventory Settings"):
		return
	# This hook may save the allowlist, so it must not modify the shared read copy.
	settings = frappe.get_single("Temple Inventory Settings")
	before = doc.get_doc_before_save() if not doc.is_new() else None

	def eligible(row):
		return bool(
			row
			and settings.company
			and row.company == settings.company
			and settings.physical_root_warehouse
			and not cint(row.is_group)
			and not cint(row.disabled)
			and _warehouse_is_below(row.parent_warehouse, settings.physical_root_warehouse)
		)

	was_eligible = eligible(before)
	if not eligible(doc):
		if was_eligible:
			_remove_allowed_warehouse(settings, doc.name)
	elif not was_eligible:
		_allow_warehouses(settings, [doc.name])
