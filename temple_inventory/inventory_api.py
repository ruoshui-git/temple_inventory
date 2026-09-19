"""Permission-checked API for the volunteer-facing inventory application."""

import json
from collections import defaultdict
from datetime import date

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe import _
from frappe.utils import flt

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
	system = _system_warehouse_names(settings) - {settings.get("unlocated_warehouse") or settings.get("pending_warehouse")}
	leased = visible.get(settings.leased_warehouse)
	return {
		name: row
		for name, row in visible.items()
		if not row.is_group
		and name not in system
		and not (leased and row.lft >= leased.lft and row.rgt <= leased.rgt)
	}


def _physical_tree(settings=None):
	settings = settings or _settings()
	visible = _visible_warehouses(settings)
	physical = _physical_warehouses(settings)
	keep = set(physical)
	for name, row in visible.items():
		if row.warehouse_name in TEMPLE_NAMES:
			keep.add(name)
		parent = row.parent_warehouse
		while parent and parent in visible:
			if parent in keep:
				break
			if visible[parent].warehouse_name in TEMPLE_NAMES:
				keep.add(parent)
			break
			parent = visible[parent].parent_warehouse
	return {name: row for name, row in visible.items() if name in keep}


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
		stock.enable_serial_and_batch_no_for_item = 1
		stock.save(ignore_permissions=True)
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
		"ti_responsible_person": payload.get("responsible_person") or frappe.session.user,
		"ti_recorder_signature": payload.get("recorder_signature"),
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
def bootstrap():
	_require_stock()
	settings = _settings()
	groups = frappe.get_list(
		"Item Group", filters={"is_group": 0}, fields=["name", "item_group_name"], limit_page_length=0
	)
	batch_enabled = frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item")
	visible = _visible_warehouses(settings)
	physical = _physical_warehouses(settings)
	unfinished_count = frappe.db.sql(
		"""select count(*) from `tabInventory Workspace` iw
		left join `tabStock Entry` se on se.name = iw.stock_entry
		where iw.company=%s and (iw.stock_entry is null or se.docstatus=0)""",
		settings.company,
	)[0][0]
	return {
		"user": frappe.session.user,
		"is_manager": "System Manager" in frappe.get_roles(),
		"initialization": initialization_status(),
		"unfinished_count": unfinished_count,
		"capabilities": {dt: frappe.has_permission(dt, "create") for dt in ("Item", "UOM", "Batch", "Inventory Activity", "Warehouse")},
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
def inventory(search=None, warehouse=None, needs_attention=False):
	_require_stock()
	settings = _settings()
	warehouse_map = _visible_warehouses(settings)
	selected = (
		_descendants(warehouse, warehouse_map)
		if warehouse
		else set(name for name, row in warehouse_map.items() if not row.is_group)
	)
	bins = frappe.get_all(
		"Bin",
		filters={"warehouse": ("in", list(selected) or [""])},
		fields=["item_code", "warehouse", "actual_qty"],
	)
	balances = defaultdict(lambda: defaultdict(float))
	for row in bins:
		if row.warehouse in selected:
			balances[row.item_code][row.warehouse] += row.actual_qty
	filters = {"disabled": 0, "is_stock_item": 1}
	items = frappe.get_list(
		"Item",
		filters=filters,
		fields=["name", "item_code", "item_name", "item_group", "stock_uom", "image", "description"],
		limit_page_length=0,
	)
	if search:
		matching = {r.item_code for r in search_items(search, page_length=100)["results"]}
		items = [r for r in items if r.item_code in matching]
	reserved = _descendants(settings.leased_warehouse, warehouse_map) | {
		settings.damaged_warehouse,
		settings.pending_warehouse,
	}
	result = []
	for item in items:
		stock = balances.get(item.name, {})
		total, pending = sum(stock.values()), stock.get(settings.pending_warehouse, 0)
		missing = not item.description or (settings.photo_required and not item.image)
		if not total and not needs_attention:
			continue
		if needs_attention and not (pending or missing):
			continue
		result.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"item_group": item.item_group,
				"stock_uom": item.stock_uom,
				"image": item.image,
				"description": item.description,
				"total_stock": total,
				"available_stock": sum(qty for key, qty in stock.items() if key not in reserved),
				"on_loan_qty": sum(
					qty
					for key, qty in stock.items()
					if key in _descendants(settings.leased_warehouse, warehouse_map)
				),
				"damaged_qty": stock.get(settings.damaged_warehouse, 0),
				"pending_qty": pending,
				"warehouse_stock": dict(stock),
				"needs_attention": bool(pending or missing),
			}
		)
	return result


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


@frappe.whitelist()
def outstanding_loan_items():
	_require_stock()
	rows=[]
	for loan in frappe.get_all("Inventory Loan", filters={"docstatus":1}, fields=["name","posting_datetime","borrower","activity"]):
		for item in frappe.get_all("Inventory Loan Item", filters={"parent":loan.name,"parenttype":"Inventory Loan"}, fields=["name","item_code","qty","uom","batch_no","original_warehouse","activity"]):
			returned = frappe.db.sql("""select coalesce(sum(ri.qty),0) from `tabInventory Return Item` ri join `tabInventory Return` r on r.name=ri.parent where r.docstatus=1 and ri.loan_item=%s and ri.outcome='Returned'""", item.name)[0][0]
			damaged = frappe.db.sql("""select coalesce(sum(ri.qty),0) from `tabInventory Return Item` ri join `tabInventory Return` r on r.name=ri.parent where r.docstatus=1 and ri.loan_item=%s and ri.outcome='Damaged'""", item.name)[0][0]
			lost = frappe.db.sql("""select coalesce(sum(li.qty),0) from `tabInventory Loss Item` li join `tabInventory Loss` l on l.name=li.parent where l.docstatus=1 and li.original_loan_item=%s""", item.name)[0][0]
			outstanding=flt(item.qty)-flt(returned)-flt(damaged)-flt(lost)
			if outstanding>0:
				rows.append({"loan":loan.name,"loan_item":item.name,"item_code":item.item_code,"batch_no":item.batch_no,"uom":item.uom,"activity":item.activity or loan.activity,"borrower":loan.borrower,"original_warehouse":item.original_warehouse,"loan_date":loan.posting_datetime,"loaned":item.qty,"returned":returned,"damaged":damaged,"lost":lost,"outstanding":outstanding})
	return rows




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
	if warehouse_type not in ("地点", "房间", "库位", "虚拟", "Room", "Location", ""):
		frappe.throw(_("Choose Room or Location"))
	if warehouse:
		if warehouse not in visible:
			frappe.throw(_("Warehouse access denied"), frappe.PermissionError)
		doc = frappe.get_doc("Warehouse", warehouse)
		doc.warehouse_type = warehouse_type
		doc.save()
	else:
		if parent_warehouse not in visible or not visible[parent_warehouse].is_group:
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
