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


def _clear_request_memos():
	frappe.local.temple_inventory_memos = None


def request_memo(name):
	"""Return this transaction's memo for `name`, or None while it has uncommitted writes.

	Scope and topology reads repeat many times per request. A memo is only safe while
	the transaction has written nothing; commit and rollback start a new snapshot, so
	both drop every memo.
	"""
	if getattr(frappe.db, "transaction_writes", 0):
		return None
	store = getattr(frappe.local, "temple_inventory_memos", None)
	if store is None:
		store = frappe.local.temple_inventory_memos = {}
		frappe.db.after_commit.add(_clear_request_memos)
		frappe.db.after_rollback.add(_clear_request_memos)
	return store.setdefault(name, {})


def _settings():
	"""Temple Inventory Settings for reading; callers that change it load their own copy."""
	memo = request_memo("settings")
	user = frappe.session.user
	if memo is not None:
		if user not in memo:
			memo[user] = frappe.get_single("Temple Inventory Settings")
		return memo[user]
	# Mid-write, building the Single is the costly part: reuse the copy built for the
	# same stored rows, which are read every call so writes and savepoint rollbacks show.
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
	cache = request_memo("warehouse_maps")
	key = (frappe.session.user, company)
	if cache is not None and key in cache:
		return cache[key]
	rows = frappe.get_list(
		"Warehouse",
		filters={"company": company},
		fields=[
			"name",
			"owner",
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
	result = {row.name: row for row in rows}
	if cache is not None:
		cache[key] = result
	return result


def _visible_warehouses(settings=None):
	settings = settings or _settings()
	user = frappe.session.user
	key = (user, settings.company, settings.root_warehouse)
	memo = request_memo("visible_warehouses")
	if memo is not None and key in memo:
		return memo[key]
	if not settings.root_warehouse:
		return {}
	root = frappe.db.get_value("Warehouse", settings.root_warehouse, ["lft", "rgt"], as_dict=True)
	if not root:
		return {}
	result = {
		name: row
		for name, row in _warehouse_map(settings.company).items()
		if row.lft >= root.lft and row.rgt <= root.rgt
	}
	if memo is not None:
		memo[key] = result
	return result


def _system_warehouse_names(settings=None):
	settings = settings or _settings()
	return {settings.get(field) for field in SYSTEM_POINTERS if settings.get(field)}


def _physical_tree(settings=None):
	settings = settings or _settings()
	user = frappe.session.user
	key = (user, settings.company, settings.root_warehouse, settings.physical_root_warehouse)
	memo = request_memo("physical_trees")
	if memo is not None and key in memo:
		return memo[key]
	visible = _visible_warehouses(settings)
	root = visible.get(settings.physical_root_warehouse)
	if not root or not root.is_group:
		return {}
	protected = _system_warehouse_names(settings)
	result = {
		name: row
		for name, row in visible.items()
		if name not in protected and root.lft < row.lft and row.rgt < root.rgt
	}
	if memo is not None:
		memo[key] = result
	return result


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
	user = frappe.session.user
	key = (user, settings.company, settings.root_warehouse, settings.physical_root_warehouse)
	memo = request_memo("allowed_warehouses")
	if memo is not None and key in memo:
		return memo[key]
	visible = _visible_warehouses(settings)
	result = {
		row.warehouse: visible[row.warehouse]
		for row in settings.get("allowed_warehouses", [])
		if row.warehouse in visible
		and not cint(visible[row.warehouse].is_group)
		and _enabled_branch(visible[row.warehouse], visible)
	}
	if memo is not None:
		memo[key] = result
	return result


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
	key = (frappe.session.user, name)
	memo = request_memo("warehouse_edit_permissions")
	if memo is not None and key in memo:
		return memo[key]
	try:
		allowed = bool(frappe.has_permission("Warehouse", "write", doc=name))
	except frappe.DoesNotExistError, frappe.PermissionError:
		allowed = False
	if memo is not None:
		memo[key] = allowed
	return allowed


def _editable_warehouses(rows, systems):
	"""Resolve write shares once for already-readable Warehouse rows."""
	names = set(rows) - set(systems)
	if not names:
		return set()
	user = frappe.session.user
	if user == "Administrator":
		return names
	from frappe.permissions import get_role_permissions, get_user_permissions

	role_write = bool(get_role_permissions("Warehouse", user=user).get("write"))
	owner_write = bool(get_role_permissions("Warehouse", user=user, is_owner=True).get("write"))
	if not any("owner" not in rows[name] for name in names):
		user_permissions = get_user_permissions(user)
		if role_write and not user_permissions:
			return names
		if not role_write and not owner_write:
			return set(
				frappe.share.get_shared(
					"Warehouse",
					user,
					rights=["write"],
					filters=[["share_name", "in", sorted(names)]],
				)
			)
		if not user_permissions and owner_write:
			return {name for name in names if rows[name].get("owner") == user}
	return {name for name in names if _can_edit(name, systems)}


def present_locations(rows, *, physical_root=None, settings=None):
	"""Return the one canonical, user-facing representation of Warehouse rows."""
	settings = settings or _settings()
	physical_root = physical_root or settings.physical_root_warehouse
	if isinstance(rows, dict):
		rows = {name: frappe._dict(row) for name, row in rows.items()}
	else:
		rows = {row.get("name"): frappe._dict(row) for row in rows if row.get("name")}
	row_key = tuple(
		sorted(
			(
				name,
				row.get("owner"),
				row.get("parent_warehouse"),
				row.get("warehouse_name"),
				row.get("warehouse_type"),
				row.get("ti_label"),
				row.get("ti_short_label"),
				row.get("ti_direct_storage"),
				row.get("is_group"),
				row.get("disabled"),
				row.get("lft"),
				row.get("rgt"),
				row.get("modified"),
			)
			for name, row in rows.items()
		)
	)
	settings_key = tuple(settings.get(field) for field in SYSTEM_POINTERS)
	key = (
		frappe.session.user,
		physical_root,
		settings.company,
		settings.root_warehouse,
		settings_key,
		row_key,
	)
	memo = request_memo("present_locations")
	if memo is not None and key in memo:
		return [dict(item) for item in memo[key]]
	systems = _system_warehouse_names(settings)
	editable = _editable_warehouses(rows, systems)
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
				"can_edit": name in editable,
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
	if memo is not None:
		memo[key] = [dict(item) for item in items]
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
