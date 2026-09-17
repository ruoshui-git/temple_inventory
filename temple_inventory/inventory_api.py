"""Permission-checked API for the volunteer-facing inventory application."""

import json
from collections import defaultdict
from datetime import date

import frappe
from frappe import _
from erpnext.stock.utils import scan_barcode

MOVEMENT_TYPES = {
    "Receive": "Material Receipt", "Issue": "Material Issue", "Transfer": "Material Transfer",
    "Loan": "Material Transfer", "Return": "Material Transfer", "Damage": "Material Transfer", "Loss": "Material Issue",
}


def _loads(value, default=None):
    return json.loads(value) if isinstance(value, str) else (value if value is not None else default)


def _require_stock():
    if not (frappe.has_permission("Stock Entry", "create") or frappe.has_role("System Manager")):
        frappe.throw(_("Stock Entry permission is required"), frappe.PermissionError)


def _settings():
    settings = frappe.get_single("Temple Inventory Settings")
    if not settings.company:
        settings.company = frappe.db.get_single_value("Global Defaults", "default_company")
        settings.save(ignore_permissions=True)
    return settings


def _warehouse_map():
    rows = frappe.get_all("Warehouse", fields=["name", "warehouse_name", "parent_warehouse", "is_group", "lft", "rgt"], order_by="lft")
    return {row.name: row for row in rows}


def _visible_warehouses(settings=None):
    settings = settings or _settings()
    all_warehouses = _warehouse_map()
    if not settings.root_warehouse:
        return all_warehouses
    root = all_warehouses.get(settings.root_warehouse)
    if not root:
        frappe.throw(_("The configured temple root warehouse no longer exists"))
    return {name: row for name, row in all_warehouses.items() if row.lft >= root.lft and row.rgt <= root.rgt}


def _descendants(warehouse, warehouse_map):
    node = warehouse_map.get(warehouse)
    if not node:
        return set()
    return {name for name, row in warehouse_map.items() if row.lft >= node.lft and row.rgt <= node.rgt and not row.is_group}


def _item_code():
    settings = _settings()
    frappe.db.sql("select next_number, code_prefix, code_digits from `tabTemple Inventory Settings` where name=%s for update", settings.name)
    while True:
        code = f"{settings.code_prefix}{int(settings.next_number):0{int(settings.code_digits)}d}"
        settings.next_number = int(settings.next_number) + 1
        settings.db_set("next_number", settings.next_number, update_modified=False)
        if not frappe.db.exists("Item", code):
            return code


def _entry_fields(payload):
    return {"ti_movement_kind": payload["movement_kind"], "ti_source_type": payload.get("source_type"),
        "ti_donor_source": payload.get("donor_source"), "ti_purpose": payload.get("purpose"),
        "ti_activity": payload.get("activity"), "ti_recipient": payload.get("recipient"),
        "ti_responsible_person": payload.get("responsible_person") or frappe.session.user,
        "ti_loan_reference": payload.get("loan_reference"), "ti_signature": payload.get("signature"), "remarks": payload.get("notes")}


def _entry_items(payload):
    movement, items = payload["movement_kind"], []
    for row in payload.get("items", []):
        item = {"item_code": row["item_code"], "qty": row["qty"], "uom": row.get("uom")}
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
    visible = _visible_warehouses(settings)
    movement = payload["movement_kind"]
    for row in _entry_items(payload):
        fields = ("t_warehouse",) if movement == "Receive" else ("s_warehouse",) if movement in {"Issue", "Loss"} else ("s_warehouse", "t_warehouse")
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
    groups = frappe.get_all("Item Group", filters={"is_group": 0}, fields=["name", "item_group_name"])
    return {"user": frappe.session.user,
        "settings": {key: settings.get(key) for key in ("company", "root_warehouse", "pending_warehouse", "leased_warehouse", "default_lease_program_warehouse", "damaged_warehouse", "photo_required")},
        "warehouses": list(_visible_warehouses(settings).values()), "item_groups": groups}


@frappe.whitelist()
def inventory(search=None, warehouse=None, needs_attention=False):
    _require_stock()
    settings = _settings()
    warehouse_map = _visible_warehouses(settings)
    selected = _descendants(warehouse, warehouse_map) if warehouse else set(name for name, row in warehouse_map.items() if not row.is_group)
    bins = frappe.get_all("Bin", fields=["item_code", "warehouse", "actual_qty"])
    balances = defaultdict(lambda: defaultdict(float))
    for row in bins:
        if row.warehouse in selected:
            balances[row.item_code][row.warehouse] += row.actual_qty
    filters = {"disabled": 0, "is_stock_item": 1}
    if search:
        filters["name"] = ("like", f"%{search}%")
    items = frappe.get_all("Item", filters=filters, fields=["name", "item_code", "item_name", "item_group", "stock_uom", "image", "description"])
    reserved = {settings.leased_warehouse, settings.damaged_warehouse, settings.pending_warehouse}
    result = []
    for item in items:
        stock = balances.get(item.name, {})
        total, pending = sum(stock.values()), stock.get(settings.pending_warehouse, 0)
        missing = not item.description or (settings.photo_required and not item.image)
        if not total and not needs_attention:
            continue
        if needs_attention and not (pending or missing):
            continue
        result.append({"item_code": item.item_code, "item_name": item.item_name, "item_group": item.item_group, "stock_uom": item.stock_uom, "image": item.image, "description": item.description, "total_stock": total,
            "available_stock": sum(qty for key, qty in stock.items() if key not in reserved), "on_loan_qty": sum(qty for key, qty in stock.items() if key in _descendants(settings.leased_warehouse, warehouse_map)),
            "damaged_qty": stock.get(settings.damaged_warehouse, 0), "pending_qty": pending, "warehouse_stock": dict(stock), "needs_attention": bool(pending or missing)})
    return result


@frappe.whitelist()
def scan(value, context=None):
    _require_stock()
    result = scan_barcode(value, _loads(context, {}))
    if not result:
        frappe.throw(_("No item or warehouse found for this code"))
    warehouse = result.get("warehouse")
    if warehouse and warehouse not in _visible_warehouses():
        frappe.throw(_("This warehouse is outside the temple inventory structure"))
    return result


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
    group = frappe.get_doc({"doctype": "Item Group", "item_group_name": name, "parent_item_group": "All Item Groups", "is_group": 0})
    group.insert(ignore_permissions=True)
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
    item = frappe.get_doc({"doctype": "Item", "item_code": item_code, "item_name": payload["item_name"], "item_group": payload["item_group"], "stock_uom": payload["stock_uom"], "description": payload.get("description"), "image": payload.get("image"), "is_stock_item": 1})
    item.insert()
    return {"item_code": item.name}


@frappe.whitelist()
def set_item_image(item_code, image):
    _require_stock()
    item = frappe.get_doc("Item", item_code)
    item.image = image
    item.save(ignore_permissions=True)
    return {"item_code": item.name, "image": item.image}


@frappe.whitelist()
def lease_programs():
    _require_stock()
    settings = _settings()
    if not settings.leased_warehouse:
        return []
    return frappe.get_all("Warehouse", filters={"parent_warehouse": settings.leased_warehouse, "is_group": 0}, fields=["name", "warehouse_name"], order_by="warehouse_name")


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
        doc.save(ignore_permissions=True)
    else:
        doc = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": name, "company": settings.company, "parent_warehouse": settings.leased_warehouse, "is_group": 0})
        doc.insert(ignore_permissions=True)
    return {"name": doc.name, "warehouse_name": doc.warehouse_name}


@frappe.whitelist()
def save_movement(data, submit=False):
    _require_stock()
    payload = _loads(data, {})
    movement = payload.get("movement_kind")
    if movement not in MOVEMENT_TYPES:
        frappe.throw(_("Choose a valid inventory movement"))
    if not payload.get("items"):
        frappe.throw(_("Add at least one item"))
    settings = _settings()
    if movement == "Loan":
        payload["to_warehouse"] = payload.get("lease_program_warehouse") or settings.default_lease_program_warehouse
    elif movement == "Damage":
        payload["to_warehouse"] = settings.damaged_warehouse
    _validate_movement_warehouses(payload, settings)
    doc = frappe.get_doc({"doctype": "Stock Entry", "stock_entry_type": MOVEMENT_TYPES[movement], "company": settings.company,
        "posting_date": payload.get("posting_date") or date.today(), "items": _entry_items(payload), **_entry_fields(payload)})
    doc.insert()
    if submit:
        doc.submit()
    return {"name": doc.name, "docstatus": doc.docstatus}


@frappe.whitelist()
def outstanding_loans():
    _require_stock()
    loans = frappe.get_all("Stock Entry", filters={"docstatus": 1, "ti_movement_kind": "Loan"}, fields=["name", "posting_date", "ti_recipient", "ti_purpose", "ti_responsible_person"], order_by="posting_date desc")
    outcomes = frappe.get_all("Stock Entry", filters={"docstatus": 1, "ti_loan_reference": ("is", "set")}, fields=["name", "ti_loan_reference"])
    outcome_ids = {row.name: row.ti_loan_reference for row in outcomes}
    rows = frappe.get_all("Stock Entry Detail", filters={"parent": ("in", list(outcome_ids) or [""])}, fields=["parent", "item_code", "qty"])
    resolved = defaultdict(lambda: defaultdict(float))
    for row in rows:
        resolved[outcome_ids[row.parent]][row.item_code] += row.qty
    result = []
    for loan in loans:
        loan_rows = frappe.get_all("Stock Entry Detail", filters={"parent": loan.name}, fields=["item_code", "qty", "uom"])
        remaining = [{"item_code": row.item_code, "qty": row.qty - resolved[loan.name][row.item_code], "uom": row.uom} for row in loan_rows]
        remaining = [row for row in remaining if row["qty"] > 0]
        if remaining:
            result.append({**loan, "items": remaining})
    return result


@frappe.whitelist()
def setup(company, root_warehouse_name):
    _require_stock()
    if not company or not root_warehouse_name:
        frappe.throw(_("Company and temple root warehouse are required"))
    settings = _settings()
    settings.company = company
    root = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": root_warehouse_name, "company": company, "is_group": 1})
    root.insert(ignore_if_duplicate=True, ignore_permissions=True)
    root_name = frappe.db.get_value("Warehouse", {"warehouse_name": root_warehouse_name, "company": company}, "name")
    settings.root_warehouse = root_name
    for label, field, group in (("待确认位置", "pending_warehouse", 0), ("Leased", "leased_warehouse", 1), ("Damaged", "damaged_warehouse", 0)):
        name = frappe.db.get_value("Warehouse", {"warehouse_name": label, "company": company}, "name")
        if not name:
            name = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": label, "company": company, "parent_warehouse": root_name, "is_group": group}).insert(ignore_permissions=True).name
        elif frappe.db.get_value("Warehouse", name, "parent_warehouse") != root_name:
            frappe.throw(_("A warehouse named {0} already exists outside this temple root").format(label))
        elif group and not frappe.db.get_value("Warehouse", name, "is_group"):
            if frappe.db.get_value("Bin", {"warehouse": name, "actual_qty": ("!=", 0)}):
                frappe.throw(_("Existing Leased warehouse contains stock. Move it first, then run setup again."))
            doc = frappe.get_doc("Warehouse", name)
            doc.is_group = 1
            doc.save(ignore_permissions=True)
        settings.set(field, name)
    default = frappe.db.get_value("Warehouse", {"warehouse_name": "General Lease", "company": company, "parent_warehouse": settings.leased_warehouse}, "name")
    if not default:
        default = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": "General Lease", "company": company, "parent_warehouse": settings.leased_warehouse, "is_group": 0}).insert(ignore_permissions=True).name
    settings.default_lease_program_warehouse = default
    settings.save(ignore_permissions=True)
    return {"root_warehouse": root_name, "leased_warehouse": settings.leased_warehouse, "default_lease_program_warehouse": default}
