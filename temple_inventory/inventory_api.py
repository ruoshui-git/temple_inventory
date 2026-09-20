"""Permission-checked API for the volunteer-facing inventory application."""

import json
from collections import defaultdict
from datetime import date

import frappe
from erpnext.stock.doctype.batch.batch import get_batch_qty
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.utils import flt, getdate, nowdate

MOVEMENT_TYPES = {
	"Receive": "Material Receipt",
	"Issue": "Material Issue",
	"Transfer": "Material Transfer",
	"Loan": "Material Transfer",
	"Return": "Material Transfer",
	"Damage": "Material Transfer",
	"Loss": "Material Issue",
	"Repair": "Material Transfer",
	"Disposal": "Material Issue",
}

SYSTEM_WAREHOUSE_NAMES = {
	"root_warehouse": "寺院仓库",
	"pending_warehouse": "未定位",
	"leased_warehouse": "借出",
	"default_lease_program_warehouse": "借出",
	"damaged_warehouse": "损坏待处理",
	"virtual_root_warehouse": "虚拟库房",
	"physical_root_warehouse": "实体库房",
	"loan_warehouse": "借出",
	"unlocated_warehouse": "未定位",
}
DEFAULT_LOCATION_NAME = "未分类库位"
TEMPLE_NAMES = ("第1寺院", "第2寺院")
SECOND_TEMPLE_ROOMS = ("A02", "A04", "A14", "B01b", "C01", "C02", "C03", "D01", "D02", "D03")


def _loads(value, default=None):
	return json.loads(value) if isinstance(value, str) else (value if value is not None else default)


def _selection_values(value):
	"""Normalize scalar/JSON/list filter input without treating punctuation as a delimiter."""
	if value in (None, "", []):
		return []
	if isinstance(value, str):
		try:
			values = json.loads(value)
		except json.JSONDecodeError:
			values = value
	else:
		values = value
	if isinstance(values, (tuple, set)):
		values = list(values)
	if not isinstance(values, list):
		values = [values]
	return [str(item).strip() for item in values if str(item).strip()]


def _erpnext_installed():
	return "erpnext" in frappe.get_installed_apps()


def _require_erpnext():
	if not _erpnext_installed():
		frappe.throw(_("ERPNext must be installed before using Temple Inventory"))


def _require_stock():
	_require_erpnext()
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in"), frappe.AuthenticationError)
	frappe.has_permission("Stock Entry", "read", throw=True)
	company = frappe.db.get_single_value("Temple Inventory Settings", "company")
	if company:
		frappe.get_doc("Company", company).check_permission("read")


def _require_manager():
	_require_stock()
	if "System Manager" not in frappe.get_roles():
		frappe.throw(_("System Manager permission is required"), frappe.PermissionError)


def _settings():
	return frappe.get_single("Temple Inventory Settings")


def _warehouse_map(company=None):
	company = company or _settings().company
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
			"lft",
			"rgt",
		],
		order_by="lft",
		limit_page_length=0,
	)
	return {row.name: row for row in rows}


def _visible_warehouses(settings=None):
	settings = settings or _settings()
	all_warehouses = _warehouse_map(settings.company)
	if not settings.root_warehouse:
		return {}
	root = frappe.db.get_value("Warehouse", settings.root_warehouse, ["lft", "rgt"], as_dict=True)
	if not root:
		return {}
	return {name: row for name, row in all_warehouses.items() if row.lft >= root.lft and row.rgt <= root.rgt}


def _allowed_warehouses(settings=None):
	settings = settings or _settings()
	visible = _visible_warehouses(settings)
	return {
		row.warehouse: visible[row.warehouse]
		for row in settings.get("allowed_warehouses", [])
		if row.warehouse in visible and not visible[row.warehouse].is_group
	}


def _system_warehouse_names(settings=None):
	settings = settings or _settings()
	return {name for field in SYSTEM_WAREHOUSE_NAMES if (name := settings.get(field))}


def _physical_warehouses(settings=None):
	settings = settings or _settings()
	visible = _visible_warehouses(settings)
	system = _system_warehouse_names(settings)
	leased = visible.get(settings.leased_warehouse)
	virtual = visible.get(settings.virtual_root_warehouse)
	return {
		name: row
		for name, row in visible.items()
		if not row.is_group
		and name not in system
		and row.warehouse_type not in ("虚拟", "Virtual")
		and not (virtual and row.lft >= virtual.lft and row.rgt <= virtual.rgt)
		and not (leased and row.lft >= leased.lft and row.rgt <= leased.rgt)
	}


def _physical_tree(settings=None):
	settings = settings or _settings()
	visible = _visible_warehouses(settings)
	physical = _physical_warehouses(settings)
	keep = set(physical)
	physical_root = settings.get("physical_root_warehouse")
	for name in physical:
		parent = visible[name].parent_warehouse
		while parent and parent in visible:
			keep.add(parent)
			if parent == physical_root or parent in _system_warehouse_names(settings):
				break
			parent = visible[parent].parent_warehouse
	# Roots and virtual/system branches are boundaries, never browse options.
	keep -= _system_warehouse_names(settings)
	keep.discard(settings.get("root_warehouse"))
	keep.discard(settings.get("physical_root_warehouse"))
	# The physical root is a boundary, not a browseable operational warehouse.
	return {name: row for name, row in visible.items() if name in keep and name != physical_root}


def _warehouse_by_label(label, company, parent=None):
	filters = {"warehouse_name": label, "company": company}
	if parent:
		filters["parent_warehouse"] = parent
	return frappe.db.get_value("Warehouse", filters, "name")


def _company_or_throw(company=None):
	_require_erpnext()
	company = company or _settings().company
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("Create and select an ERPNext Company before initializing inventory"))
	return company


def _set_system_roles(settings, names):
	if not frappe.db.exists("Custom Field", "Warehouse-ti_system_role"):
		return
	for name, role in names.items():
		frappe.db.set_value("Warehouse", name, "ti_system_role", role, update_modified=False)


def _find_role_warehouse(rows, role):
	matches = [name for name, row in rows.items() if row.get("ti_system_role") == role]
	return matches[0] if len(matches) == 1 else None


def _find_label_warehouse(rows, label, parent=None):
	matches = [
		name
		for name, row in rows.items()
		if row.warehouse_name == label and (parent is None or row.parent_warehouse == parent)
	]
	return matches[0] if len(matches) == 1 else None


def _ensure_warehouse(label, company, parent=None, is_group=0, warehouse_type=None, role=None, rows=None):
	rows = rows if rows is not None else _warehouse_map(company)
	name = _find_role_warehouse(rows, role) if role else None
	name = name or _find_label_warehouse(rows, label, parent)
	name = name or _find_label_warehouse(rows, label)
	if name:
		doc = frappe.get_doc("Warehouse", name)
		changed = False
		if frappe.db.exists("Custom Field", "Warehouse-ti_system_role"):
			valid_roles = set((frappe.db.get_value("Custom Field", "Warehouse-ti_system_role", "options") or "").splitlines())
			if doc.get("ti_system_role") and doc.ti_system_role not in valid_roles:
				doc.ti_system_role = None
				changed = True
		for field, value in (
			("parent_warehouse", parent),
			("is_group", is_group),
			("warehouse_type", warehouse_type),
		):
			if value is not None and getattr(doc, field) != value:
				setattr(doc, field, value)
				changed = True
		if changed:
			doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": label,
				"company": company,
				"parent_warehouse": parent,
				"is_group": is_group,
				"warehouse_type": warehouse_type,
			}
		).insert(ignore_permissions=True)
	rows[doc.name] = frappe._dict(
		name=doc.name,
		warehouse_name=doc.warehouse_name,
		parent_warehouse=doc.parent_warehouse,
		warehouse_type=doc.warehouse_type,
		company=company,
		is_group=doc.is_group,
		lft=doc.lft,
		rgt=doc.rgt,
	)
	if role and frappe.db.exists("Custom Field", "Warehouse-ti_system_role"):
		frappe.db.set_value("Warehouse", doc.name, "ti_system_role", role, update_modified=False)
		rows[doc.name]["ti_system_role"] = role
	return doc.name


def _resolve_system_warehouses(company, settings=None):
	settings = settings or _settings()
	rows = _warehouse_map(company)
	for row in rows.values(): row["ti_system_role"] = frappe.db.get_value("Warehouse", row.name, "ti_system_role")
	def find(field, label, parent=None):
		configured=settings.get(field)
		return configured if configured in rows else (_find_role_warehouse(rows,label) or _find_label_warehouse(rows,label,parent))
	names={}
	names["root_warehouse"] = find("root_warehouse", "寺院仓库")
	names["virtual_root_warehouse"] = find("virtual_root_warehouse", "虚拟库房", names["root_warehouse"])
	names["physical_root_warehouse"] = find("physical_root_warehouse", "实体库房", names["root_warehouse"])
	names["loan_warehouse"] = find("loan_warehouse", "借出", names["virtual_root_warehouse"])
	names["leased_warehouse"] = names["loan_warehouse"] or find("leased_warehouse", "借出", names["root_warehouse"])
	names["damaged_warehouse"] = find("damaged_warehouse", "损坏待处理", names["virtual_root_warehouse"]) or find("damaged_warehouse", "损坏", names["root_warehouse"])
	names["unlocated_warehouse"] = find("unlocated_warehouse", "未定位", names["virtual_root_warehouse"]) or find("pending_warehouse", "未定位", names["root_warehouse"])
	names["pending_warehouse"] = names["unlocated_warehouse"]
	names["default_lease_program_warehouse"] = names["loan_warehouse"]
	return names, rows


def _physical_leaves(rows, names):
	root, leased = rows.get(names.get("root_warehouse")), rows.get(names.get("leased_warehouse"))
	if not root:
		return {}
	system = {name for name in names.values() if name} - {names.get("unlocated_warehouse") or names.get("pending_warehouse")}
	return {
		name: row
		for name, row in rows.items()
		if not row.is_group
		and name not in system
		and row.lft >= root.lft
		and row.rgt <= root.rgt
		and not (leased and row.lft >= leased.lft and row.rgt <= leased.rgt)
	}


def _save_system_links(settings, company, names):
	settings.company = company
	for field, name in names.items():
		settings.set(field, name)
	settings.save(ignore_permissions=True)
	_set_system_roles(settings, {name: SYSTEM_WAREHOUSE_NAMES[field] for field, name in names.items() if name})


def _allow_warehouses(settings, warehouses):
	existing = {row.warehouse for row in settings.get("allowed_warehouses", []) if row.warehouse}
	for warehouse in warehouses:
		if warehouse and warehouse not in existing:
			settings.append("allowed_warehouses", {"warehouse": warehouse})
			existing.add(warehouse)
	settings.save(ignore_permissions=True)


def _ensure_warehouse_types():
	for name in ("地点", "房间", "库位", "虚拟"):
		if not frappe.db.exists("Warehouse Type", name):
			frappe.get_doc({"doctype": "Warehouse Type", "name": name}).insert(ignore_permissions=True)


def _create_structure(company, include_examples=False):
	"""Create the canonical warehouse tree; safe to run repeatedly on a clean site."""
	_ensure_warehouse_types()
	settings = _settings()
	rows = _warehouse_map(company)
	root = _ensure_warehouse("寺院仓库", company, is_group=1, rows=rows)
	virtual = _ensure_warehouse("虚拟库房", company, root, is_group=1, warehouse_type="虚拟", rows=rows)
	loan = _ensure_warehouse("借出", company, virtual, warehouse_type="虚拟", rows=rows)
	damaged = _ensure_warehouse("损坏待处理", company, virtual, warehouse_type="虚拟", rows=rows)
	unlocated = _ensure_warehouse("未定位", company, virtual, warehouse_type="虚拟", rows=rows)
	physical = _ensure_warehouse("实体库房", company, root, is_group=1, warehouse_type="地点", rows=rows)
	names = {"root_warehouse":root, "virtual_root_warehouse":virtual, "physical_root_warehouse":physical,
		"leased_warehouse":loan, "default_lease_program_warehouse":loan, "loan_warehouse":loan,
		"damaged_warehouse":damaged, "unlocated_warehouse":unlocated, "pending_warehouse":unlocated}
	_save_system_links(settings, company, names)
	allowed=[]
	if include_examples:
		for site in TEMPLE_NAMES:
			site_name = _ensure_warehouse(site, company, physical, is_group=1, warehouse_type="地点", rows=rows)
			if site == "第2寺院":
				for room in SECOND_TEMPLE_ROOMS:
					room_name = _ensure_warehouse(room, company, site_name, is_group=1, warehouse_type="房间", rows=rows)
					allowed.append(_ensure_warehouse(f"{room} / 未指定", company, room_name, warehouse_type="库位", rows=rows))
			else:
				allowed.append(_ensure_warehouse(f"{site} / 未指定", company, site_name, warehouse_type="库位", rows=rows))
	else:
		default_site = _ensure_warehouse("第1寺院", company, physical, is_group=1, warehouse_type="地点", rows=rows)
		allowed.append(_ensure_warehouse("第1寺院 / 未指定", company, default_site, warehouse_type="库位", rows=rows))
		allowed.append(_ensure_warehouse(DEFAULT_LOCATION_NAME, company, default_site, warehouse_type="库位", rows=rows))
	_allow_warehouses(settings, allowed)
	return {"company":company, "root":root, "rooms":list(SECOND_TEMPLE_ROOMS) if include_examples else []}


@frappe.whitelist()
def initialization_status():
	if frappe.session.user == "Guest":
		return {
			"ready": False,
			"setup_required": True,
			"blockers": [{"code": "login", "message": "请先登录"}],
			"warnings": [],
			"can_initialize": False,
			"can_repair": False,
		}
	manager = "System Manager" in frappe.get_roles()
	if not _erpnext_installed():
		return {
			"ready": False,
			"setup_required": True,
			"blockers": [{"code": "erpnext", "message": "需要先安装 ERPNext"}],
			"warnings": [],
			"can_initialize": False,
			"can_repair": False,
			"is_manager": manager,
			"companies": [],
		}
	settings = _settings()
	companies = frappe.get_all("Company", pluck="name", limit_page_length=0)
	selected = settings.company if settings.company in companies else None
	if not selected and len(companies) == 1:
		selected = companies[0]
	blockers, warnings = [], []
	if not companies:
		blockers.append({"code": "company", "message": "请先在 ERPNext 创建公司"})
	elif not selected:
		blockers.append({"code": "company_selection", "message": "请选择要用于物资管理的公司"})
	names, rows, physical, allowed = {}, {}, {}, set()
	if selected:
		names, rows = _resolve_system_warehouses(selected, settings)
		missing = [field for field, name in names.items() if not name]
		physical = _physical_leaves(rows, names)
		if missing:
			blockers.append({"code": "warehouses", "message": "缺少必需仓库结构", "missing": missing})
		if not physical:
			blockers.append({"code": "physical_warehouse", "message": "缺少可存放库存的位置"})
		allowed = {row.warehouse for row in settings.get("allowed_warehouses", []) if row.warehouse in physical}
		if not missing and any(settings.get(field) != name for field, name in names.items()):
			warnings.append({"code": "warehouse_links", "message": "系统仓库关联需要修复"})
		if physical and not allowed:
			warnings.append({"code": "allowed_warehouses", "message": "尚未配置可操作的库存位置"})
		if not frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item"):
			warnings.append({"code": "batch", "message": "尚未启用批次功能"})
	if selected and not frappe.has_permission("Stock Entry", "read"):
		warnings.append(
			{"code": "permission", "message": "当前用户没有库存读取权限，无法进行库存操作"}
		)
	return {
		"ready": not blockers,
		"setup_required": bool(blockers),
		"blockers": blockers,
		"warnings": warnings,
		"is_manager": manager,
		"can_initialize": manager and bool(selected),
		"can_repair": manager and bool(selected) and not blockers,
		"companies": companies if manager else [],
		"selected_company": selected,
		"warehouse_names": names,
		"physical_warehouses": list(physical.values()),
		"allowed_warehouses": list(allowed),
	}


@frappe.whitelist(methods=["POST"])
def initialize_warehouses(company, include_examples=0):
	_require_manager()
	company = _company_or_throw(company)
	return _create_structure(company, frappe.utils.cint(include_examples))


@frappe.whitelist(methods=["POST"])
def repair_settings():
	_require_manager()
	status = initialization_status()
	if status["blockers"]:
		frappe.throw(_("Complete warehouse initialization before repairing settings"))
	settings = _settings()
	names, rows = _resolve_system_warehouses(status["selected_company"], settings)
	_save_system_links(settings, status["selected_company"], names)
	physical = _physical_leaves(rows, names)
	if not {row.warehouse for row in settings.get("allowed_warehouses", []) if row.warehouse in physical}:
		_allow_warehouses(settings, physical)
	stock = frappe.get_single("Stock Settings")
	if not stock.enable_serial_and_batch_no_for_item:
		# Update only the setting we own. Saving the whole singleton can validate
		# unrelated stale links (for example a removed ERPNext default warehouse).
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
	return {"status": initialization_status()}

def _page(rows, page_length=30, start=0):
	start, page_length = int(start or 0), min(max(int(page_length or 30), 1), 100)
	return {
		"results": rows[start : start + page_length],
		"total": len(rows),
		"start": start,
		"page_length": page_length,
	}


def _descendants(warehouse, warehouse_map):
	node = warehouse_map.get(warehouse)
	if not node:
		return set()
	return {
		name
		for name, row in warehouse_map.items()
		if row.lft >= node.lft and row.rgt <= node.rgt and not row.is_group
	}


def _selected_leaf_warehouses(selection, warehouse_map, empty_means_all=True):
	"""Validate visible warehouse nodes and return their de-duplicated leaf union."""
	values = _selection_values(selection)
	if not values and empty_means_all:
		return {name for name, row in warehouse_map.items() if not row.is_group}
	if any(value not in warehouse_map for value in values):
		frappe.throw(_("请选择寺院库存范围内的位置"), frappe.PermissionError)
	leaves = set()
	for value in values:
		node = warehouse_map[value]
		if node.is_group:
			leaves.update(_descendants(value, warehouse_map))
		else:
			leaves.add(value)
	return leaves


def _item_code():
	frappe.db.sql("select field from `tabSingles` where doctype=%s for update", "Temple Inventory Settings")
	settings = _settings()
	while True:
		code = f"{settings.code_prefix}{int(settings.next_number):0{int(settings.code_digits)}d}"
		settings.next_number = int(settings.next_number) + 1
		settings.db_set("next_number", settings.next_number, update_modified=False)
		if not frappe.db.exists("Item", code):
			return code


def _entry_fields(payload):
	return {
		"ti_movement_kind": payload["movement_kind"],
		"ti_source_text": payload.get("source_text"),
		"ti_purpose_text": payload.get("purpose_text"),
		"ti_activity": payload.get("activity"),
		"ti_borrower": payload.get("borrower"),
		"ti_responsible_person": frappe.session.user,
		"ti_recorder_signature": payload.get("recorder_signature"),
		"ti_handler_name": payload.get("handler_name"),
		"ti_handler_signature": payload.get("handler_signature"),
		"ti_borrower_is_handler_or_witness": payload.get("borrower_is_handler_or_witness"),
		"ti_reviewer_signature": payload.get("reviewer_signature"),
		"ti_reviewer_name": payload.get("reviewer_name"),
		"ti_no_independent_reviewer": payload.get("no_independent_reviewer"),
		"ti_workspace": payload.get("workspace"),
		"ti_loan": payload.get("loan_record"),
		"ti_return": payload.get("return_record"),
		"ti_loss": payload.get("loss_record"),
		"remarks": payload.get("notes"),
	}


def _entry_items(payload):
	movement, items = payload["movement_kind"], []
	for row in payload.get("items", []):
		item = {
			"item_code": row["item_code"],
			"qty": row["qty"],
			"uom": row.get("uom"),
			"conversion_factor": row.get("conversion_factor", 1),
		}
		if movement == "Receive":
			item["t_warehouse"] = row.get("warehouse") or payload.get("to_warehouse")
		elif movement in {"Issue", "Loss", "Disposal"}:
			item["s_warehouse"] = row.get("warehouse") or payload.get("from_warehouse")
		else:
			item["s_warehouse"] = row.get("from_warehouse") or payload.get("from_warehouse")
			item["t_warehouse"] = row.get("to_warehouse") or payload.get("to_warehouse")
		if row.get("batch_no"):
			item["batch_no"] = row["batch_no"]
		items.append(item)
	return items


def _validate_movement_warehouses(payload, settings):
	visible = _allowed_warehouses(settings)
	movement = payload["movement_kind"]
	for row in _entry_items(payload):
		fields = (
			("t_warehouse",)
			if movement == "Receive"
			else ("s_warehouse",)
			if movement in {"Issue", "Loss", "Disposal"}
			else ("s_warehouse", "t_warehouse")
		)
		for field in fields:
			warehouse, record = row.get(field), visible.get(row.get(field))
			if not warehouse or not record:
				frappe.throw(_("Choose a warehouse inside the temple inventory structure for every item"))
			if record.is_group:
				frappe.throw(_("{0} is a warehouse group and cannot contain stock").format(warehouse))



@frappe.whitelist()
def _raise_on_group_stock(warehouses):
	group_names = [name for name, row in warehouses.items() if row.is_group]
	if not group_names:
		return
	bad = frappe.get_all(
		"Bin",
		filters={"warehouse": ("in", group_names), "actual_qty": ("!=", 0)},
		fields=["warehouse", "actual_qty"],
		limit_page_length=1,
	)
	if bad:
		frappe.throw(_("检测到库存位于分组仓库（{0}）。请由管理员将库存修复到叶子库位后再查看库存。").format(bad[0].warehouse))


@frappe.whitelist()
def bootstrap():
	_require_stock()
	settings = _settings()
	# Browse filters need the complete structured hierarchy.  Leaf-only results
	# make parent selection impossible and tempt clients to infer ancestry from
	# display names.
	groups = frappe.get_list(
		"Item Group",
		fields=["name", "item_group_name", "parent_item_group", "is_group", "lft", "rgt"],
		order_by="lft",
		limit_page_length=0,
	)
	batch_enabled = frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item")
	visible = _visible_warehouses(settings)
	physical = _physical_warehouses(settings)
	physical_leaves = [name for name, row in _physical_tree(settings).items() if not row.is_group and name in _allowed_warehouses(settings) and frappe.has_permission("Warehouse", "read", name)]
	unfinished_count = frappe.db.sql(
		"""select count(*) from `tabInventory Workspace` iw
		left join `tabStock Entry` se on se.name = iw.stock_entry
		where iw.company=%s and (iw.stock_entry is null or se.docstatus=0)""",
		settings.company,
	)[0][0]
	pending_rows = frappe.get_all(
		"Bin",
		filters={"warehouse": ("in", [settings.damaged_warehouse, settings.pending_warehouse]), "actual_qty": (">", 0)},
		fields=["warehouse", "item_code"],
		limit_page_length=0,
	)
	pending_total = inventory(needs_attention=1, mode="current", start=0, page_length=1)["total"]
	damaged_count = len({row.item_code for row in pending_rows if row.warehouse == settings.damaged_warehouse})
	unlocated_count = len({row.item_code for row in pending_rows if row.warehouse == settings.pending_warehouse})
	return {
		"user": frappe.session.user,
		"is_manager": "System Manager" in frappe.get_roles(),
		"initialization": initialization_status(),
		"unfinished_count": unfinished_count,
		"damaged_pending_count": damaged_count,
		"unlocated_pending_count": unlocated_count,
		"pending_count": pending_total,
		"capabilities": {dt: frappe.has_permission(dt, "create") for dt in ("Item", "UOM", "Batch", "Inventory Activity", "Warehouse")},
		"can_read_reconciliations": frappe.has_permission("Stock Reconciliation", "read"),
		"can_create_stock_entry": frappe.has_permission("Stock Entry", "create"),
		"can_reconcile_stock": bool(physical_leaves and frappe.has_permission("Stock Reconciliation", "create") and frappe.has_permission("Stock Reconciliation", "submit")),
		"reconciliation_warehouses": physical_leaves,
		"can_edit_item": frappe.has_permission("Item", "write"),
		"warehouse_tree": list(visible.values()),
		"physical_warehouses": list(physical.values()),
		"physical_tree": list(_physical_tree(settings).values()),
		"companies": (
			frappe.get_all("Company", pluck="name", limit_page_length=0)
			if "System Manager" in frappe.get_roles()
			else []
		),
		"batch": {"enabled": bool(batch_enabled), "error": None if batch_enabled else "请在库存设置中启用批次功能", "settings_url": "/app/stock-settings"},
		"settings": {key: settings.get(key) for key in set(SYSTEM_WAREHOUSE_NAMES) | {"company", "photo_required"}},
		"warehouses": list(_allowed_warehouses(settings).values()),
		"item_groups": groups,
		"uoms": frappe.get_list("UOM", fields=["name", "uom_name"], order_by="uom_name", limit_page_length=100),
	}


@frappe.whitelist()
def warehouse_summaries():
	"""Aggregated physical-tree summaries; never add incompatible UOMs."""
	_require_stock()
	settings = _settings()
	visible = _visible_warehouses(settings)
	physical = _physical_tree(settings)
	leaves = {name: row for name, row in physical.items() if not row.is_group}
	items = {row.name: row for row in frappe.get_all("Item", fields=["name", "stock_uom", "item_group"], limit_page_length=0)}
	by_leaf = defaultdict(lambda: {"items": set(), "uoms": defaultdict(float), "groups": set()})
	for row in frappe.get_all("Bin", filters={"warehouse": ("in", list(leaves) or [""]), "actual_qty": (">", 0)}, fields=["warehouse", "item_code", "actual_qty"], limit_page_length=0):
		item = items.get(row.item_code)
		if not item:
			continue
		by_leaf[row.warehouse]["items"].add(row.item_code)
		by_leaf[row.warehouse]["uoms"][item.stock_uom] += flt(row.actual_qty)
		by_leaf[row.warehouse]["groups"].add(item.item_group)
	result = []
	for name, node in physical.items():
		included = [leaf for leaf, row in leaves.items() if leaf == name or (node.is_group and row.lft > node.lft and row.rgt < node.rgt)]
		product_ids, quantities, groups = set(), defaultdict(float), set()
		for leaf in included:
			product_ids.update(by_leaf[leaf]["items"])
			groups.update(by_leaf[leaf]["groups"])
			for uom, qty in by_leaf[leaf]["uoms"].items():
				quantities[uom] += qty
		result.append({"warehouse": name, "distinct_products": len(product_ids), "quantities": [{"uom": uom, "qty": qty} for uom, qty in sorted(quantities.items())], "item_groups": sorted(groups)[:4], "additional_groups": max(0, len(groups) - 4)})
	return result


@frappe.whitelist()
def inventory(search=None, warehouse=None, item_group=None, needs_attention=False, mode="current", start=0, page_length=25, warehouses=None, item_groups=None):
	_require_stock()
	settings = _settings()
	warehouse_map = _visible_warehouses(settings)
	_raise_on_group_stock(warehouse_map)
	selected = _selected_leaf_warehouses(warehouses if warehouses is not None else warehouse, warehouse_map)
	bins = frappe.get_all(
		"Bin",
		filters={"warehouse": ("in", list(selected) or [""])},
		fields=["item_code", "warehouse", "actual_qty"],
	)
	balances = defaultdict(lambda: defaultdict(float))
	for row in bins:
		if row.warehouse in selected:
			balances[row.item_code][row.warehouse] += row.actual_qty
	base_filters = {"disabled": 0, "is_stock_item": 1}
	filters = dict(base_filters)
	groups = _selection_values(item_groups if item_groups is not None else item_group)
	all_items = frappe.get_list(
		"Item",
		filters=base_filters,
		fields=["name", "item_code", "item_name", "item_group", "stock_uom", "image", "description", "has_batch_no"],
		limit_page_length=0,
	)
	if groups:
		group_rows = frappe.get_all("Item Group", filters={"name": ("in", groups)}, fields=["name", "lft", "rgt"])
		all_groups = frappe.get_all("Item Group", fields=["name", "lft", "rgt"], limit_page_length=0)
		groups = [row.name for row in all_groups if any(row.lft >= parent.lft and row.rgt <= parent.rgt for parent in group_rows)]
		filters["item_group"] = ("in", groups or [""])
	items = all_items
	if groups:
		items = [item for item in items if item.item_group in groups]
	if search:
		term = str(search).lower()
		items = [r for r in items if term in f"{r.item_code} {r.item_name} {r.item_group}".lower()]
	reserved = _descendants(settings.leased_warehouse, warehouse_map) | {
		settings.damaged_warehouse,
		settings.pending_warehouse,
	}
	result = []
	for item in items:
		stock = balances.get(item.name, {})
		total, pending, damaged = sum(stock.values()), stock.get(settings.pending_warehouse, 0), stock.get(settings.damaged_warehouse, 0)
		if not total and mode != "catalog" and not needs_attention:
			continue
		# Operational pending is physical stock only.  Catalog completeness is
		# valuable, but never creates a pending row or badge.
		if needs_attention and not (pending or damaged):
			continue
		attention_reasons = ([] if not pending else [{"code": "unlocated", "label": _("未定位 {0}").format(pending)}])
		if damaged:
			attention_reasons.append({"code": "damaged", "label": _("损坏 {0}").format(damaged)})
		result.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"item_group": item.item_group,
				"stock_uom": item.stock_uom,
				"image": item.image,
				"description": item.description,
				"has_batch_no": item.has_batch_no,
				"total_stock": total,
				"available_stock": sum(qty for key, qty in stock.items() if key not in reserved),
				"on_loan_qty": sum(
					qty
					for key, qty in stock.items()
					if key in _descendants(settings.leased_warehouse, warehouse_map)
				),
				"damaged_qty": damaged,
				"pending_qty": pending,
				"warehouse_stock": dict(stock),
				"needs_attention": bool(pending or damaged),
				"attention_reasons": attention_reasons,
			}
		)
	result.sort(key=lambda row: (str(row["item_name"]).lower(), row["item_code"]))
	# Facets count distinct result rows, not quantity. Parent warehouse counts are
	# deduplicated unions of permitted descendant leaves.
	warehouse_matches = defaultdict(set)
	group_matches = defaultdict(set)
	all_leaves = _selected_leaf_warehouses(None, warehouse_map)
	facet_bins = frappe.get_all(
		"Bin",
		filters={"warehouse": ("in", list(all_leaves) or [""])},
		fields=["item_code", "warehouse", "actual_qty"],
	)
	facet_balances = defaultdict(lambda: defaultdict(float))
	for row in facet_bins:
		facet_balances[row.item_code][row.warehouse] += row.actual_qty
	def included(item, stock):
		total = sum(stock.values())
		pending_qty = stock.get(settings.pending_warehouse, 0)
		damaged_qty = stock.get(settings.damaged_warehouse, 0)
		return not (needs_attention and not (pending_qty or damaged_qty)) and not (not needs_attention and mode != "catalog" and not total)
	for item in items:
		stock = facet_balances.get(item.name, {})
		if included(item, stock):
			for name, qty in stock.items():
				if flt(qty) > 0:
					warehouse_matches[name].add(item.item_code)
	for item in all_items:
		if search and str(search).lower() not in f"{item.item_code} {item.item_name} {item.item_group}".lower():
			continue
		stock = balances.get(item.name, {})
		if included(item, stock):
			group_matches[item.item_group].add(item.item_code)
	physical_nodes = _physical_tree(settings)
	for name, node in physical_nodes.items():
		if node.is_group:
			leaves = [leaf for leaf, leaf_row in physical_nodes.items() if not leaf_row.is_group and leaf_row.lft >= node.lft and leaf_row.rgt <= node.rgt]
			warehouse_matches[name] = set().union(*(warehouse_matches.get(leaf, set()) for leaf in leaves)) if leaves else set()
	facet_counts = {"warehouses": {name: len(values) for name, values in warehouse_matches.items()}, "item_groups": {}}
	all_groups = frappe.get_all("Item Group", fields=["name", "lft", "rgt"], limit_page_length=0)
	for group in all_groups:
		group_name = getattr(group, "name", None)
		if not group_name:
			continue
		members = [key for key in group_matches if any(getattr(row, "name", None) == key and row.lft >= group.lft and row.rgt <= group.rgt for row in all_groups)]
		facet_counts["item_groups"][group_name] = len(set().union(*(group_matches.get(key, set()) for key in members))) if members else 0
	# overall_total retains fixed permissions and mode but deliberately removes
	# removable text/category/location filters.
	has_removable_filters = bool(search or _selection_values(warehouses if warehouses is not None else warehouse) or _selection_values(item_groups if item_groups is not None else item_group))
	overall = len(result)
	if has_removable_filters:
		# Reapply only fixed permission/mode predicates locally. This avoids a
		# recursive endpoint call while keeping overall_total independent of the
		# removable search/category/location facets.
		all_items = frappe.get_list(
			"Item",
			filters=base_filters,
			fields=["name"],
			limit_page_length=0,
		)
		all_leaves = _selected_leaf_warehouses(None, warehouse_map)
		all_bins = frappe.get_all(
			"Bin",
			filters={"warehouse": ("in", list(all_leaves) or [""])},
			fields=["item_code", "warehouse", "actual_qty"],
		)
		all_balances = defaultdict(lambda: defaultdict(float))
		for row in all_bins:
			all_balances[row.item_code][row.warehouse] += row.actual_qty
		if mode == "catalog":
			overall = len(all_items)
		else:
			overall = 0
			for item in all_items:
				stock = all_balances.get(item.name, {})
				total = sum(stock.values())
				pending_qty = stock.get(settings.pending_warehouse, 0)
				damaged_qty = stock.get(settings.damaged_warehouse, 0)
				if needs_attention and not (pending_qty or damaged_qty):
					continue
				if not needs_attention and not total:
					continue
				overall += 1
	page = _page(result, page_length, start)
	page["overall_total"] = overall
	page["facets"] = facet_counts
	return page


@frappe.whitelist()
def pending(search=None, start=0, page_length=25):
	"""The Pending browser uses the exact inventory attention predicate and grouping."""
	return inventory(search=search, needs_attention=1, mode="current", start=start, page_length=page_length)


@frappe.whitelist()
def scan(value, context=None):
	_require_stock()
	from erpnext.stock.utils import scan_barcode

	result = scan_barcode(value, _loads(context, {}))
	if not result:
		return {"unknown": True, "barcode": value}
	if result.get("item_code"):
		frappe.get_doc("Item", result["item_code"]).check_permission("read")
	warehouse = result.get("warehouse")
	if warehouse and warehouse not in _visible_warehouses():
		frappe.throw(_("This warehouse is outside the temple inventory structure"))
	return result


@frappe.whitelist()
def search_items(
	search=None,
	start=0,
	page_length=30,
	category=None,
	warehouse=None,
	in_stock_only=False,
	posting_date=None,
	posting_time=None,
):
	_require_stock()
	settings = _settings()
	filters = {"disabled": 0, "is_stock_item": 1}
	if category:
		filters["item_group"] = category
	rows = frappe.get_list(
		"Item",
		filters=filters,
		fields=["name", "item_code", "item_name", "item_group", "stock_uom", "image", "has_batch_no"],
		order_by="item_name",
		limit_page_length=0,
	)
	if search:
		term = search.lower()
		barcode_items = set(
			frappe.get_all("Item Barcode", filters={"barcode": ("like", f"%{search}%")}, pluck="parent")
		)
		rows = [
			r
			for r in rows
			if term in f"{r.item_code} {r.item_name} {r.item_group}".lower() or r.name in barcode_items
		]
	if frappe.utils.cint(in_stock_only):
		allowed = _allowed_warehouses(settings)
		if warehouse and warehouse not in allowed:
			frappe.throw(_("Choose an allowed physical warehouse"), frappe.PermissionError)
		warehouses = [warehouse] if warehouse else list(allowed)
		bins = frappe.get_all(
			"Bin",
			filters={"item_code": ("in", [row.name for row in rows]), "warehouse": ("in", warehouses or [""])},
			fields=["item_code", "warehouse", "actual_qty"],
			limit_page_length=0,
		)
		stock = defaultdict(dict)
		for bin_row in bins:
			qty = flt(bin_row.actual_qty)
			if posting_date and posting_time:
				qty = flt(get_stock_balance(bin_row.item_code, bin_row.warehouse, posting_date, posting_time))
			if qty > 1e-8:
				stock[bin_row.item_code][bin_row.warehouse] = qty
		rows = [
			{
				**row,
				"warehouse_stock": stock.get(row.name, {}),
				"available_qty": sum(stock.get(row.name, {}).values()),
			}
			for row in rows
			if stock.get(row.name)
		]
	return _page(rows, page_length, start)


@frappe.whitelist()
def search_warehouses(search=None, start=0, page_length=30):
	_require_stock()
	rows = list(_allowed_warehouses().values())
	if search:
		rows = [r for r in rows if search.lower() in r.warehouse_name.lower()]
	return _page(rows, page_length, start)


@frappe.whitelist()
def resolve_room_leaf(room):
    """Resolve a Room group to its canonical <Room> / 未指定 leaf."""
    _require_stock()
    room = (room or "").strip()
    if not room:
        frappe.throw(_("Room is required"))
    visible = _visible_warehouses()
    doc = visible.get(room) or next(
        (row for row in visible.values() if row.warehouse_name == room),
        None,
    )
    if not doc:
        frappe.throw(_("Room is outside the temple inventory structure"), frappe.PermissionError)
    if not doc.is_group:
        if doc.name in _allowed_warehouses():
            return {"room": doc.name, "warehouse": doc.name}
        frappe.throw(_("Choose a warehouse inside the temple inventory structure"), frappe.PermissionError)
    preferred = next(
        (
            row for row in visible.values()
            if row.parent_warehouse == doc.name
            and not row.is_group
            and row.warehouse_name == f"{doc.warehouse_name} / 未指定"
        ),
        None,
    )
    leaf = preferred or next(
        (row for row in visible.values() if row.parent_warehouse == doc.name and not row.is_group),
        None,
    )
    if not leaf:
        frappe.throw(_("Room has no default leaf warehouse"))
    if leaf.name not in _allowed_warehouses():
        frappe.throw(_("Room default leaf is not allowed"), frappe.PermissionError)
    return {"room": doc.name, "warehouse": leaf.name}


@frappe.whitelist()
def search_uoms(search=None, start=0, page_length=30):
	_require_stock()
	rows = frappe.get_list("UOM", fields=["name", "uom_name"], order_by="uom_name")
	if search:
		rows = [r for r in rows if search.lower() in r.uom_name.lower()]
	return _page(rows, page_length, start)


@frappe.whitelist()
def create_uom(uom_name, must_be_whole_number=False):
	_require_stock()
	uom_name = (uom_name or "").strip()
	if not uom_name:
		frappe.throw(_("Unit name is required"))
	if frappe.db.exists("UOM", uom_name):
		return {"name": uom_name, "uom_name": uom_name}
	doc = frappe.get_doc(
		{
			"doctype": "UOM",
			"uom_name": uom_name,
			"must_be_whole_number": frappe.utils.cint(must_be_whole_number),
		}
	)
	doc.insert()
	return {"name": doc.name, "uom_name": doc.uom_name}


@frappe.whitelist()
def save_allowed_warehouses(warehouses):
	_require_manager()
	settings, visible = _settings(), _visible_warehouses()
	values = _loads(warehouses, [])
	names = [row.get("warehouse") if isinstance(row, dict) else row for row in values]
	if not names:
		frappe.throw(_("Choose at least one transaction warehouse"))
	for name in names:
		if name not in visible or visible[name].is_group:
			frappe.throw(_("Allowed warehouses must be stock-holding warehouses under the temple root"))
	settings.set("allowed_warehouses", [])
	for name in names:
		settings.append("allowed_warehouses", {"warehouse": name})
	settings.save()
	return list(_allowed_warehouses(settings).values())


@frappe.whitelist()
def create_warehouse(name):
	_require_manager()
	settings, name = _settings(), (name or "").strip()
	if not settings.root_warehouse or not name:
		frappe.throw(_("Configure the temple root and provide a warehouse name"))
	doc = frappe.get_doc(
		{
			"doctype": "Warehouse",
			"warehouse_name": name,
			"company": settings.company,
			"parent_warehouse": settings.root_warehouse,
			"is_group": 0,
		}
	)
	doc.insert()
	return {"name": doc.name, "warehouse_name": doc.warehouse_name}


@frappe.whitelist()
def next_item_code():
	_require_stock()
	settings = _settings()
	return f"{settings.code_prefix}{int(settings.next_number):0{int(settings.code_digits)}d}"


@frappe.whitelist()
def create_item_group(name):
	_require_stock()
	name = (name or "").strip()
	if not name:
		frappe.throw(_("Category name is required"))
	if frappe.db.exists("Item Group", name):
		return {"name": name, "item_group_name": name}
	group = frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": name,
			"parent_item_group": "All Item Groups",
			"is_group": 0,
		}
	)
	group.insert()
	return {"name": group.name, "item_group_name": group.item_group_name}


@frappe.whitelist()
def create_item(data):
	_require_stock()
	payload = _loads(data, {})
	if not payload.get("item_name") or not payload.get("stock_uom") or not payload.get("item_group"):
		frappe.throw(_("Name, unit, and category are required"))
	item_code = payload.get("item_code") or _item_code()
	if frappe.db.exists("Item", item_code):
		frappe.throw(_("Item Code already exists"))
	if payload.get("has_batch_no") and not frappe.db.get_single_value(
		"Stock Settings", "enable_serial_and_batch_no_for_item"
	):
		frappe.throw(_("Enable Serial / Batch No for Item in Stock Settings first"))
	barcode = (payload.get("barcode") or "").strip()
	if barcode and frappe.db.exists("Item Barcode", {"barcode": barcode}):
		frappe.throw(_("Barcode already belongs to another item"))
	item = frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": item_code,
			"item_name": payload["item_name"],
			"item_group": payload["item_group"],
			"stock_uom": payload["stock_uom"],
			"description": payload.get("description"),
			"image": payload.get("image"),
			"is_stock_item": 1,
			"has_batch_no": bool(payload.get("has_batch_no")),
			"has_expiry_date": bool(payload.get("has_expiry_date", payload.get("has_batch_no"))),
			"barcodes": [{"barcode": barcode}] if barcode else [],
			"uoms": payload.get("uoms") or [],
		}
	)
	item.insert()
	return {"item_code": item.name}


@frappe.whitelist()
def set_item_image(item_code, image):
	_require_stock()
	item = frappe.get_doc("Item", item_code)
	item.check_permission("write")
	if not frappe.db.exists(
		"File", {"file_url": image, "attached_to_doctype": "Item", "attached_to_name": item_code}
	):
		frappe.throw(_("Upload the image to this item first"))
	item.image = image
	item.save()
	return {"item_code": item.name, "image": item.image}


@frappe.whitelist(methods=["POST"])
def update_item(item_code, data):
	"""Guarded master-data edit; stock identity/tracking fields stay immutable here."""
	_require_stock()
	item = frappe.get_doc("Item", item_code)
	item.check_permission("write")
	payload = _loads(data, {})
	for field in ("item_name", "item_group", "description", "image"):
		if field in payload:
			setattr(item, field, payload[field])
	if "item_group" in payload and payload["item_group"]:
		frappe.get_doc("Item Group", payload["item_group"]).check_permission("read")
	if "barcodes" in payload:
		values = []
		seen = set()
		for value in payload["barcodes"] or []:
			barcode = str(value).strip()
			if barcode and barcode not in seen:
				other = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
				if other and other != item.name:
					frappe.throw(_("Barcode already belongs to another item"))
				seen.add(barcode)
				values.append({"barcode": barcode})
		item.set("barcodes", values)
	item.save()
	return {"item_code": item.name, "item_name": item.item_name, "item_group": item.item_group, "description": item.description, "image": item.image, "barcodes": [row.barcode for row in item.barcodes]}


@frappe.whitelist()
def outstanding_loan_items():
	_require_stock()
	return [row for row in _all_loan_rows() if flt(row["outstanding"]) > 0]


def _all_loan_rows(loan_names=None):
	query = """
		select l.name as loan, li.name as loan_item, li.item_code, li.batch_no, li.uom,
			li.activity as item_activity, l.activity, l.borrower, li.original_warehouse,
			l.posting_datetime as loan_date, l.posting_datetime, li.qty as loaned,
			coalesce(rt.returned, 0) as returned, coalesce(rt.damaged, 0) as damaged,
			coalesce(ls.lost, 0) as lost
		from `tabInventory Loan` l
		join `tabInventory Loan Item` li on li.parent=l.name and li.parenttype='Inventory Loan'
		left join (
			select ri.loan_item,
				sum(case when ri.outcome='Returned' then ri.qty else 0 end) as returned,
				sum(case when ri.outcome='Damaged' then ri.qty else 0 end) as damaged
			from `tabInventory Return Item` ri join `tabInventory Return` r on r.name=ri.parent and r.docstatus=1
			group by ri.loan_item
		) rt on rt.loan_item=li.name
		left join (
			select li.original_loan_item, sum(li.qty) as lost
			from `tabInventory Loss Item` li join `tabInventory Loss` l on l.name=li.parent and l.docstatus=1
			group by li.original_loan_item
		) ls on ls.original_loan_item=li.name
		where l.docstatus=1
	"""
	params = {}
	if loan_names is not None:
		if not loan_names:
			return []
		query += " and l.name in %(loan_names)s"
		params["loan_names"] = tuple(loan_names)
	rows = frappe.db.sql(query, params, as_dict=True)
	for row in rows:
		row["activity"] = row.pop("item_activity") or row.get("activity")
		row["outstanding"] = flt(row["loaned"]) - flt(row["returned"]) - flt(row["damaged"]) - flt(row["lost"])
	return rows


@frappe.whitelist()
def loan_items(search=None, start=0, page_length=25):
	"""Backward-compatible, server-paged chooser contract for return/loss."""
	rows = outstanding_loan_items()
	if search:
		term = str(search).lower()
		rows = [row for row in rows if term in " ".join(str(row.get(field) or "") for field in ("loan", "item_code", "borrower", "activity")).lower()]
	rows.sort(key=lambda row: (str(row.get("loan_date") or ""), row["loan_item"]), reverse=True)
	return {**_page(rows, page_length, start), "overall_total": len(rows)}


def _outstanding_loan_rows():
	"""Return permitted submitted loan lines with submitted outcomes only."""
	return outstanding_loan_items()


@frappe.whitelist()
def loans(search=None, start=0, page_length=25):
	"""Page active loans by parent transaction, never by a flat item line."""
	_require_stock()
	filters = {"docstatus": 1}
	or_filters = None
	if search:
		term = f"%{str(search).strip()}%"
		or_filters = [{"name": ["like", term]}, {"borrower": ["like", term]}, {"activity": ["like", term]}]
		item_codes = frappe.get_all(
			"Item",
			or_filters=[{"name": ["like", term]}, {"item_name": ["like", term]}],
			pluck="name",
			limit_page_length=200,
		)
		if item_codes:
			loan_parents = frappe.get_all("Inventory Loan Item", filters={"item_code": ("in", item_codes)}, pluck="parent", limit_page_length=500)
			or_filters.append({"name": ("in", loan_parents or [""])})
	parents = frappe.get_list(
		"Inventory Loan",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "borrower", "activity", "posting_datetime"],
		order_by="posting_datetime desc, name desc",
		start=max(cint(start or 0), 0),
		limit_page_length=min(max(cint(page_length or 25), 1), 100),
	)
	parent_names = [row.name for row in parents]
	grouped = {}
	for row in _all_loan_rows(parent_names):
		if flt(row["loaned"]) - flt(row["returned"]) - flt(row["damaged"]) - flt(row["lost"]) <= 0:
			continue
		loan = grouped.setdefault(row["loan"], {
			"name": row["loan"], "borrower": row["borrower"], "activity": row["activity"],
			"loan_date": row["loan_date"], "items": [], "outstanding_lines": 0,
		})
		loan["items"].append(dict(row))
		loan["outstanding_lines"] += 1
	rows = [next((dict(parent) for parent in parents if parent.name == name), {"name": name}) for name in grouped]
	for loan in rows:
		loan.update(grouped[loan["name"]])
	item_codes = {item["item_code"] for loan in rows for item in loan["items"]}
	item_map = {row.name: row for row in frappe.get_all("Item", filters={"name": ("in", list(item_codes) or [""])}, fields=["name", "item_name", "image"], limit_page_length=min(max(len(item_codes), 1), 1000))}
	for loan in rows:
		for item in loan["items"]:
			meta = item_map.get(item["item_code"]) or {}
			item["item_name"] = meta.get("item_name", item["item_code"])
			item["image"] = meta.get("image")
	rows.sort(key=lambda row: (str(row.get("loan_date") or ""), row["name"]), reverse=True)
	return {"results": rows, "total": frappe.db.count("Inventory Loan", filters=filters, distinct=True) if not search else len(rows), "start": int(start or 0), "page_length": min(max(int(page_length or 25), 1), 100), "overall_total": frappe.db.count("Inventory Loan", filters=filters, distinct=True) if not search else len(rows)}


@frappe.whitelist()
def loan_detail(name):
	_require_stock()
	loan = frappe.get_doc("Inventory Loan", name)
	loan.check_permission("read")
	rows = [row for row in _all_loan_rows() if row["loan"] == loan.name]
	for row in rows:
		item = frappe.get_doc("Item", row["item_code"])
		item.check_permission("read")
		row.update({"item_name": item.item_name, "image": item.image, "item_group": item.item_group})
	return {
		"name": loan.name, "borrower": loan.borrower, "activity": loan.activity,
		"posting_datetime": loan.posting_datetime, "items": rows,
		"attachments": frappe.get_all("File", filters={"attached_to_doctype": "Inventory Loan", "attached_to_name": loan.name}, fields=["name", "file_name", "file_url", "content_type", "file_size", "is_private"], order_by="creation asc, name asc"),
	}




@frappe.whitelist(methods=["GET", "POST"])
def session_info():
	_require_stock()
	return {"user": frappe.session.user, "csrf_token": frappe.sessions.get_csrf_token()}


@frappe.whitelist(methods=["POST"])
def configure_warehouse(
	warehouse=None, warehouse_name=None, parent_warehouse=None, warehouse_type=None, is_group=0
):
	_require_manager()
	settings = _settings()
	visible = _visible_warehouses(settings)
	physical_root = visible.get(settings.physical_root_warehouse)
	def physical_group(name):
		row = visible.get(name)
		return bool(row and physical_root and row.lft >= physical_root.lft and row.rgt <= physical_root.rgt and row.is_group)
	if warehouse_type not in ("地点", "房间", "库位", "虚拟", "Room", "Location", ""):
		frappe.throw(_("Choose Room or Location"))
	if warehouse:
		if warehouse not in visible or warehouse in _system_warehouse_names(settings):
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
		doc = frappe.get_doc("Warehouse", warehouse)
		if warehouse_name and warehouse_name.strip() and warehouse_name.strip() != doc.warehouse_name:
			doc.warehouse_name = warehouse_name.strip()
		doc.warehouse_type = warehouse_type
		doc.save()
	else:
		if not physical_group(parent_warehouse):
			frappe.throw(_("Choose a parent group under the temple root"))
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": warehouse_name,
				"parent_warehouse": parent_warehouse,
				"company": settings.company,
				"warehouse_type": warehouse_type,
				"is_group": frappe.utils.cint(is_group),
			}
		).insert()
		if warehouse_type == "房间" and frappe.utils.cint(is_group):
			frappe.get_doc({"doctype":"Warehouse","warehouse_name":f"{warehouse_name} / 未指定","parent_warehouse":doc.name,"company":settings.company,"warehouse_type":"库位","is_group":0}).insert()
	return {"name": doc.name}


@frappe.whitelist()
def expiring_batches(search=None, warehouse=None, item_group=None, expiry_from=None, expiry_to=None, sort="asc", start=0, page_length=25, warehouses=None, item_groups=None):
	"""Return positive, visible batch balances aggregated by batch."""
	_require_stock()
	settings = _settings()
	visible_warehouses = _visible_warehouses(settings)
	_raise_on_group_stock(visible_warehouses)
	selected = _selected_leaf_warehouses(warehouses if warehouses is not None else warehouse, visible_warehouses)
	all_selected = _selected_leaf_warehouses(None, visible_warehouses)
	all_groups = frappe.get_all("Item Group", fields=["name", "lft", "rgt"], limit_page_length=0)
	selected_groups = _selection_values(item_groups if item_groups is not None else item_group)
	group_names = set(selected_groups)
	if selected_groups:
		parents = [row for row in all_groups if row.name in selected_groups]
		group_names = {row.name for row in all_groups if any(row.lft >= parent.lft and row.rgt <= parent.rgt for parent in parents)}
	items = {r.name: r for r in frappe.get_all("Item", filters={"disabled": 0}, fields=["name", "item_code", "item_name", "item_group", "stock_uom", "image"], limit_page_length=0)}
	as_of, all_rows = getdate(nowdate()), []
	for batch in frappe.get_all("Batch", filters={"disabled": 0, "expiry_date": ("is", "set")}, fields=["name", "item", "expiry_date"], limit_page_length=0):
		item, expiry = items.get(batch.item), getdate(batch.expiry_date)
		if not item:
			continue
		locations = [{"warehouse": w, "qty": flt(get_batch_qty(batch_no=batch.name, warehouse=w, item_code=item.name))} for w in all_selected]
		locations = [row for row in locations if row["qty"] > 0]
		if locations:
			all_rows.append({"batch_no": batch.name, "item_code": item.item_code, "item_name": item.item_name, "item_group": item.item_group, "image": getattr(item, "image", None), "stock_uom": item.stock_uom, "expiry_date": str(expiry), "days_to_expiry": (expiry-as_of).days, "locations": locations})
	def matches(row, selected_locations, selected_group_names=None):
		if selected_group_names and row["item_group"] not in selected_group_names:
			return False
		if search and search.lower() not in f"{row['batch_no']} {row['item_code']} {row['item_name']}".lower():
			return False
		expiry = getdate(row["expiry_date"])
		if expiry_from and expiry < getdate(expiry_from):
			return False
		if expiry_to and expiry > getdate(expiry_to):
			return False
		return any(location["warehouse"] in selected_locations for location in row["locations"])
	rows = []
	for row in all_rows:
		if not matches(row, selected, group_names if selected_groups else None):
			continue
		copy_row = {**row, "locations": [location for location in row["locations"] if location["warehouse"] in selected], "total_qty": sum(location["qty"] for location in row["locations"] if location["warehouse"] in selected)}
		rows.append(copy_row)
	rows.sort(key=lambda row: (row["expiry_date"], row["item_code"]), reverse=str(sort).lower() == "desc")
	warehouse_facet = defaultdict(set)
	group_facet = defaultdict(set)
	for row in rows:
		group_facet[row["item_group"]].add(row["batch_no"])
		for location in row["locations"]:
			warehouse_facet[location["warehouse"]].add(row["batch_no"])
	physical_nodes = _physical_tree(settings)
	for name, node in physical_nodes.items():
		if node.is_group:
			leaves = [leaf for leaf, leaf_row in physical_nodes.items() if not leaf_row.is_group and leaf_row.lft >= node.lft and leaf_row.rgt <= node.rgt]
			warehouse_facet[name] = set().union(*(warehouse_facet.get(leaf, set()) for leaf in leaves)) if leaves else set()
	facets = {"warehouses": {name: len(values) for name, values in warehouse_facet.items()}, "item_groups": {name: len(values) for name, values in group_facet.items()}}
	overall_total = len(all_rows)
	return {**_page(rows, page_length, start), "overall_total": overall_total, "as_of": str(as_of), "facets": facets}
