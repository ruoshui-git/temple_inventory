"""Build and present canonical Warehouse names, labels, and paths."""

import frappe
from frappe.utils import cint

DIRECT_STORAGE_SUFFIX = " · 直接存放"


def local_label(row):
	"""Return the preferred local display label for a Warehouse row."""
	return str(row.get("ti_short_label") or row.get("ti_label") or row.get("warehouse_name") or row.name)


def native_name(label, short_label, parent, physical_root, *, direct=False):
	"""Build the stored Warehouse name from its local name and physical parent."""
	if direct:
		return f"{parent.warehouse_name}{DIRECT_STORAGE_SUFFIX}"
	segment = str(short_label or label).strip()
	prefix = "" if parent.name == physical_root else parent.warehouse_name
	return f"{prefix} / {segment}" if prefix else segment


def derive_local_label(warehouse_name, parent, *, direct=False, label="", short_label=""):
	"""Parse a stored native path into its local label and preserved short label."""
	if label:
		return label, short_label
	value = str(warehouse_name or "").strip()
	if parent:
		parent_name = parent.warehouse_name or ""
		if direct and value == f"{parent_name}{DIRECT_STORAGE_SUFFIX}":
			return (
				parent.ti_label or parent.ti_short_label or parent_name,
				short_label or parent.ti_short_label,
			)
		prefix = f"{parent_name} / " if parent_name else ""
		if prefix and value.startswith(prefix):
			value = value[len(prefix) :]
	if value.endswith(DIRECT_STORAGE_SUFFIX):
		value = value.removesuffix(DIRECT_STORAGE_SUFFIX).strip()
	return value, short_label


def build_paths(rows, *, excluded_roots=(), direct_owners=None):
	"""Build presenter path segments, omitting special roots and aliasing direct leaves."""
	direct_owners = direct_owners or {}
	paths = {}
	for name, row in rows.items():
		parts, seen, cursor = [], set(), row
		while cursor and cursor.name not in seen:
			seen.add(cursor.name)
			if cursor.name not in excluded_roots and not cint(cursor.get("ti_direct_storage")):
				parts.insert(0, local_label(cursor))
			cursor = rows.get(cursor.parent_warehouse)
		if name in direct_owners:
			owner_name = direct_owners[name]
			owner = rows.get(owner_name)
			parts = paths.get(owner.name, [local_label(owner)] if owner else [])
		paths[name] = parts
	return paths


def full_label(row, rows, owner_name=""):
	"""Return the full local label shown for a normal or direct-storage row."""
	if owner_name and owner_name in rows:
		owner = rows[owner_name]
		return str(owner.get("ti_label") or owner.warehouse_name)
	return str(row.get("ti_label") or row.get("warehouse_name") or row.name)


def development_name_check():
	"""Compare development physical Warehouse paths with a fresh, read-only build."""
	settings = frappe.get_single("Temple Inventory Settings")
	root = frappe.db.get_value(
		"Warehouse", settings.physical_root_warehouse, ["lft", "rgt", "company"], as_dict=True
	)
	if not root:
		return {"checked": 0, "diffs": []}
	rows = frappe.get_all(
		"Warehouse",
		filters={"company": root.company, "lft": [">", root.lft], "rgt": ["<", root.rgt]},
		fields=[
			"name",
			"warehouse_name",
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
			"parent_warehouse",
		],
		order_by="lft asc, name asc",
	)
	by_name = {row.name: row for row in rows}
	by_name[settings.physical_root_warehouse] = frappe.db.get_value(
		"Warehouse", settings.physical_root_warehouse, ["name", "warehouse_name"], as_dict=True
	)
	rebuilt = {settings.physical_root_warehouse: by_name[settings.physical_root_warehouse].warehouse_name}
	diffs = []
	for row in rows:
		parent = by_name.get(row.parent_warehouse)
		if not parent:
			continue
		parent = frappe._dict(parent)
		parent.warehouse_name = rebuilt.get(parent.name, parent.warehouse_name)
		expected = native_name(
			row.ti_label,
			row.ti_short_label,
			parent,
			settings.physical_root_warehouse,
			direct=bool(cint(row.ti_direct_storage)),
		)
		rebuilt[row.name] = expected
		if row.warehouse_name != expected:
			diffs.append({"name": row.name, "stored": row.warehouse_name, "expected": expected})
	return {"checked": len(rows), "diffs": diffs}
