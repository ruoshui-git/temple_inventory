"""Permission-checked API for the volunteer-facing inventory application."""

import json
from collections import defaultdict
from datetime import date

import frappe
from erpnext.stock.utils import scan_barcode
from frappe import _

MOVEMENT_TYPES = {
	"Receive": "Material Receipt",
	"Issue": "Material Issue",
	"Transfer": "Material Transfer",
	"Loan": "Material Transfer",
	"Return": "Material Transfer",
	"Damage": "Material Transfer",
	"Loss": "Material Issue",
}

SYSTEM_WAREHOUSE_NAMES = {
	"root_warehouse": "寺院仓库",
	"pending_warehouse": "无具体位置",
	"leased_warehouse": "借出",
	"default_lease_program_warehouse": "无具体项目",
	"damaged_warehouse": "损坏",
}
TEMPLE_NAMES = ("第1寺院", "第2寺院")
SECOND_TEMPLE_ROOMS = ("A02", "A04", "A14", "B01b", "C01", "C02", "C03", "D01", "D02", "D03")


def _loads(value, default=None):
	return json.loads(value) if isinstance(value, str) else (value if value is not None else default)


def _require_stock():
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


def _warehouse_map():
	rows = frappe.get_list(
		"Warehouse",
		filters={"company": _settings().company},
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
	all_warehouses = _warehouse_map()
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


def _ensure_warehouse(label, company, parent=None, is_group=0, warehouse_type=None):
	name = _warehouse_by_label(label, company, parent)
	if name:
		doc = frappe.get_doc("Warehouse", name)
		changed = False
		if int(doc.is_group or 0) != int(is_group):
			doc.is_group = is_group
			changed = True
		if warehouse_type is not None and doc.warehouse_type != warehouse_type:
			doc.warehouse_type = warehouse_type
			changed = True
		if changed:
			doc.save(ignore_permissions=True)
		return name
	doc = frappe.get_doc({
		"doctype": "Warehouse", "warehouse_name": label, "company": company,
		"parent_warehouse": parent, "is_group": is_group, "warehouse_type": warehouse_type,
	}).insert(ignore_permissions=True)
	return doc.name


def _company_or_throw(company=None):
	company = company or frappe.db.get_single_value("Temple Inventory Settings", "company")
	if not company:
		company = frappe.db.get_value("Company", {}, "name")
	if not company or not frappe.db.exists("Company", company):
		frappe.throw(_("Create an ERPNext Company before initializing inventory"))
	return company


def _set_system_roles(settings, names):
	if not frappe.db.exists("Custom Field", "Warehouse-ti_system_role"):
		return
	for name, role in names.items():
		frappe.db.set_value("Warehouse", name, "ti_system_role", role, update_modified=False)


def ensure_system_structure(company=None):
	"""Repair only mandatory system warehouses; preserve optional rooms and permissions."""
	company = _company_or_throw(company)
	settings = _settings()
	root = _ensure_warehouse("寺院仓库", company, is_group=1)
	pending = _ensure_warehouse("无具体位置", company, root)
	leased = _ensure_warehouse("借出", company, root, is_group=1)
	default = _ensure_warehouse("无具体项目", company, leased)
	damaged = _ensure_warehouse("损坏", company, root)
	settings.company = company
	settings.root_warehouse = root
	settings.pending_warehouse = pending
	settings.leased_warehouse = leased
	settings.default_lease_program_warehouse = default
	settings.damaged_warehouse = damaged
	settings.save(ignore_permissions=True)
	_set_system_roles(
		settings,
		{
			root: "寺院仓库",
			pending: "无具体位置",
			leased: "借出",
			default: "无具体项目",
			damaged: "损坏",
		},
	)
	return {"root": root, "company": company, "rooms": []}


def ensure_seed_structure(company=None):
	"""Create the starter template exactly once during explicit first-time setup."""
	company = _company_or_throw(company)
	settings = _settings()
	if getattr(settings, "initial_seed_completed", 0):
		return ensure_system_structure(company)
	root = _ensure_warehouse("寺院仓库", company, is_group=1)
	_ensure_warehouse("第1寺院", company, root, is_group=1)
	second = _ensure_warehouse("第2寺院", company, root, is_group=1)
	for label in SECOND_TEMPLE_ROOMS:
		_ensure_warehouse(label, company, second, warehouse_type="Room")

	pending = _ensure_warehouse("无具体位置", company, root)
	leased = _ensure_warehouse("借出", company, root, is_group=1)
	default = _ensure_warehouse("无具体项目", company, leased)
	damaged = _ensure_warehouse("损坏", company, root)
	settings.company = company
	settings.root_warehouse = root
	settings.pending_warehouse = pending
	settings.leased_warehouse = leased
	settings.default_lease_program_warehouse = default
	settings.damaged_warehouse = damaged
	settings.set("allowed_warehouses", [])
	for label in SECOND_TEMPLE_ROOMS:
		settings.append("allowed_warehouses", {"warehouse": _warehouse_by_label(label, company, second)})
	settings.set("initial_seed_completed", 1)
	settings.save(ignore_permissions=True)
	_set_system_roles(
		settings,
		{
			root: "寺院仓库",
			pending: "无具体位置",
			leased: "借出",
			default: "无具体项目",
			damaged: "损坏",
		},
	)
	return {"root": root, "company": company, "rooms": list(SECOND_TEMPLE_ROOMS)}


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
		"ti_source_type": payload.get("source_type"),
		"ti_donor_source": payload.get("donor_source"),
		"ti_purpose": payload.get("purpose"),
		"ti_activity": payload.get("activity"),
		"ti_recipient": payload.get("recipient"),
		"ti_responsible_person": payload.get("responsible_person") or frappe.session.user,
		"ti_loan_reference": payload.get("loan_reference"),
		"ti_signature": payload.get("signature"),
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
		elif movement in {"Issue", "Loss"}:
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
			if movement in {"Issue", "Loss"}
			else ("s_warehouse", "t_warehouse")
		)
		for field in fields:
			warehouse, record = row.get(field), visible.get(row.get(field))
			if not warehouse or not record:
				frappe.throw(_("Choose a warehouse inside the temple inventory structure for every item"))
			if record.is_group:
				frappe.throw(_("{0} is a warehouse group and cannot contain stock").format(warehouse))


@frappe.whitelist()
def _sync_system_roles(settings):
	if not settings.company or not frappe.db.exists("Custom Field", "Warehouse-ti_system_role"):
		return
	changed = False
	for field, label in SYSTEM_WAREHOUSE_NAMES.items():
		names = frappe.get_all("Warehouse", filters={"company": settings.company, "ti_system_role": label}, pluck="name", limit_page_length=2)
		if len(names) == 1 and settings.get(field) != names[0]:
			settings.set(field, names[0])
			changed = True
	if changed:
		settings.save(ignore_permissions=True)


@frappe.whitelist()
def readiness():
	if frappe.session.user == "Guest":
		return {"ready": False, "can_repair": False, "issues": [{"code": "login", "message": "请先登录"}]}
	settings = _settings()
	_sync_system_roles(settings)
	issues = []
	company_valid = bool(settings.company and frappe.db.exists("Company", settings.company))
	if not company_valid:
		issues.append({"code": "company", "message": "请先在 ERPNext 创建并选择公司"})
	if company_valid and not getattr(settings, "initial_seed_completed", 0):
		issues.append({"code": "setup", "message": "请在库存设置中建立初始仓库结构"})
	visible = _visible_warehouses(settings) if company_valid else {}
	if company_valid and getattr(settings, "initial_seed_completed", 0):
		for field, label in SYSTEM_WAREHOUSE_NAMES.items():
			name = settings.get(field)
			if not name or name not in visible:
				issues.append({"code": field, "message": f"缺少系统仓库：{label}"})
	if company_valid:
		if not frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item"):
			issues.append({"code": "batch", "message": "尚未启用批次功能"})
		physical = _physical_warehouses(settings)
		allowed = _allowed_warehouses(settings)
		if not physical or not set(physical).intersection(allowed):
			issues.append({"code": "allowed_warehouses", "message": "尚未配置可操作的实体仓库"})
	if not frappe.has_permission("Stock Entry", "read"):
		issues.append({"code": "permission", "message": "当前用户没有库存读取权限"})
	can_repair = (
		"System Manager" in frappe.get_roles()
		and company_valid
		and bool(getattr(settings, "initial_seed_completed", 0))
	)
	return {
		"ready": not issues,
		"can_repair": can_repair,
		"setup_required": company_valid and not getattr(settings, "initial_seed_completed", 0),
		"issues": issues,
	}


@frappe.whitelist(methods=["POST"])
def repair_readiness(company=None):
	_require_manager()
	settings = _settings()
	if not getattr(settings, "initial_seed_completed", 0):
		frappe.throw(_("Run initial inventory setup before repairing the warehouse structure"))
	result = ensure_system_structure(company)
	stock = frappe.get_single("Stock Settings")
	if not stock.enable_serial_and_batch_no_for_item:
		stock.enable_serial_and_batch_no_for_item = 1
		stock.save(ignore_permissions=True)
	return {"structure": result, "readiness": readiness()}


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
		"readiness": readiness(),
		"unfinished_count": unfinished_count,
		"capabilities": {dt: frappe.has_permission(dt, "create") for dt in ("Item", "UOM", "Batch", "Inventory Activity", "Warehouse")},
		"warehouse_tree": list(visible.values()),
		"physical_warehouses": list(physical.values()),
		"physical_tree": list(_physical_tree(settings).values()),
		"setup_required": not getattr(settings, "initial_seed_completed", 0),
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
def search_items(search=None, start=0, page_length=30, category=None):
	_require_stock()
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
	return _page(rows, page_length, start)


@frappe.whitelist()
def search_warehouses(search=None, start=0, page_length=30):
	_require_stock()
	rows = list(_allowed_warehouses().values())
	if search:
		rows = [r for r in rows if search.lower() in r.warehouse_name.lower()]
	return _page(rows, page_length, start)


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
def lease_programs():
	_require_stock()
	settings = _settings()
	if not settings.leased_warehouse:
		return []
	return [
		row
		for row in _allowed_warehouses(settings).values()
		if row.parent_warehouse == settings.leased_warehouse
	]


@frappe.whitelist()
def save_lease_program(name, warehouse=None):
	_require_stock()
	settings, name = _settings(), (name or "").strip()
	if not settings.leased_warehouse or not name:
		frappe.throw(_("Set up leased programs and provide a program name first"))
	if warehouse:
		doc = frappe.get_doc("Warehouse", warehouse)
		if doc.parent_warehouse != settings.leased_warehouse:
			frappe.throw(_("Only direct lease programs can be changed here"))
		doc.warehouse_name = name
		doc.save()
	else:
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"warehouse_name": name,
				"company": settings.company,
				"parent_warehouse": settings.leased_warehouse,
				"is_group": 0,
			}
		)
		doc.insert()
	return {"name": doc.name, "warehouse_name": doc.warehouse_name}


@frappe.whitelist()
def save_movement(data, submit=False):
	from temple_inventory.workspace_api import confirm_workspace, create_workspace, save_workspace

	payload = _loads(data, {})
	if payload.get("workspace"):
		result = save_workspace(payload["workspace"], payload["revision"], payload)
	else:
		result = create_workspace(
			payload.get("request_id") or frappe.generate_hash(length=32),
			payload.get("movement_kind"),
			payload,
		)
	if frappe.utils.cint(submit):
		result = confirm_workspace(result["name"], result["revision"])
	return {
		"name": result.get("stock_entry") or result["name"],
		"workspace": result["name"],
		"revision": result["revision"],
		"docstatus": result["docstatus"],
	}


@frappe.whitelist()
def outstanding_loans():
	_require_stock()
	loans = frappe.get_list(
		"Stock Entry",
		filters={"docstatus": 1, "ti_movement_kind": "Loan"},
		fields=["name", "posting_date", "ti_recipient", "ti_purpose", "ti_responsible_person"],
		order_by="posting_date desc",
	)
	outcomes = frappe.get_list(
		"Stock Entry",
		filters={"docstatus": 1, "ti_loan_reference": ("is", "set")},
		fields=["name", "ti_loan_reference"],
	)
	outcome_ids = {row.name: row.ti_loan_reference for row in outcomes}
	rows = frappe.get_all(
		"Stock Entry Detail",
		filters={"parent": ("in", list(outcome_ids) or [""])},
		fields=["parent", "item_code", "qty"],
	)
	resolved = defaultdict(lambda: defaultdict(float))
	for row in rows:
		resolved[outcome_ids[row.parent]][row.item_code] += row.qty
	result = []
	for loan in loans:
		loan_rows = frappe.get_all(
			"Stock Entry Detail", filters={"parent": loan.name}, fields=["item_code", "qty", "uom"]
		)
		remaining = [
			{"item_code": row.item_code, "qty": row.qty - resolved[loan.name][row.item_code], "uom": row.uom}
			for row in loan_rows
		]
		remaining = [row for row in remaining if row["qty"] > 0]
		if remaining:
			result.append({**loan, "items": remaining})
	return result


@frappe.whitelist()
def setup(company=None, root_warehouse_name=None):
	_require_manager()
	settings = _settings()
	if getattr(settings, "initial_seed_completed", 0):
		return ensure_system_structure(company)
	return ensure_seed_structure(company)


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
	if warehouse_type not in ("Room", "Location", ""):
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
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def enable_batches():
	_require_manager()
	doc = frappe.get_single("Stock Settings")
	doc.enable_serial_and_batch_no_for_item = 1
	doc.save()
	return {"enabled": True}
