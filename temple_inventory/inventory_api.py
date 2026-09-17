"""Permission-checked API for the volunteer-facing inventory application."""

import json
from collections import defaultdict
from datetime import date

import frappe
from frappe import _
from erpnext.stock.utils import scan_barcode

MOVEMENT_TYPES = {
    "Receive": "Material Receipt",
    "Issue": "Material Issue",
    "Transfer": "Material Transfer",
    "Loan": "Material Transfer",
    "Return": "Material Transfer",
    "Damage": "Material Transfer",
    "Loss": "Material Issue",
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
    warehouses = frappe.get_all(
        "Warehouse", fields=["name", "warehouse_name", "parent_warehouse", "is_group", "lft", "rgt"], order_by="lft"
    )
    return {warehouse.name: warehouse for warehouse in warehouses}


def _descendants(warehouse, warehouse_map):
    node = warehouse_map.get(warehouse)
    if not node:
        return set()
    return {name for name, row in warehouse_map.items() if row.lft >= node.lft and row.rgt <= node.rgt and not row.is_group}


def _item_code():
    """Allocate a never-reused code while holding the settings row lock."""
    settings = _settings()
    frappe.db.sql(
        "select next_number, code_prefix, code_digits from `tabTemple Inventory Settings` where name=%s for update",
        settings.name,
    )
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
    movement = payload["movement_kind"]
    items = []
    for row in payload.get("items", []):
        item = {"item_code": row["item_code"], "qty": row["qty"], "uom": row.get("uom")}
        if movement == "Receive":
            item["t_warehouse"] = row.get("warehouse") or payload.get("to_warehouse")
        elif movement in {"Issue", "Loss"}:
            item["s_warehouse"] = row.get("warehouse") or payload.get("from_warehouse")
        else:
            item["s_warehouse"] = row.get("from_warehouse")
            item["t_warehouse"] = row.get("to_warehouse")
        if row.get("batch_no"):
            item["batch_no"] = row["batch_no"]
        items.append(item)
    return items


@frappe.whitelist()
def bootstrap():
    _require_stock()
    settings = _settings()
    warehouses = frappe.get_all(
        "Warehouse", fields=["name", "warehouse_name", "parent_warehouse", "is_group"], order_by="lft"
    )
    groups = frappe.get_all("Item Group", filters={"is_group": 0}, fields=["name", "item_group_name"])
    return {
        "user": frappe.session.user,
        "settings": {key: settings.get(key) for key in ("company", "pending_warehouse", "leased_warehouse", "damaged_warehouse", "photo_required")},
        "warehouses": warehouses,
        "item_groups": groups,
    }


@frappe.whitelist()
def inventory(search=None, warehouse=None, needs_attention=False):
    _require_stock()
    settings = _settings()
    warehouse_map = _warehouse_map()
    selected = _descendants(warehouse, warehouse_map) if warehouse else None
    bins = frappe.get_all("Bin", fields=["item_code", "warehouse", "actual_qty"])
    balances = defaultdict(lambda: defaultdict(float))
    for row in bins:
        if selected is None or row.warehouse in selected:
            balances[row.item_code][row.warehouse] += row.actual_qty
    item_filters = {"disabled": 0, "is_stock_item": 1}
    if search:
        item_filters["name"] = ("like", f"%{search}%")
    items = frappe.get_all("Item", filters=item_filters, fields=["name", "item_code", "item_name", "item_group", "stock_uom", "image", "description"])
    reserved = {settings.leased_warehouse, settings.damaged_warehouse, settings.pending_warehouse}
    result = []
    for item in items:
        stock = balances.get(item.name, {})
        total = sum(stock.values())
        if not total and not needs_attention:
            continue
        pending = stock.get(settings.pending_warehouse, 0)
        missing = not item.description or (settings.photo_required and not item.image)
        if needs_attention and not (pending or missing):
            continue
        result.append({
            "item_code": item.item_code, "item_name": item.item_name, "item_group": item.item_group,
            "stock_uom": item.stock_uom, "image": item.image, "description": item.description,
            "total_stock": total, "available_stock": sum(qty for key, qty in stock.items() if key not in reserved),
            "on_loan_qty": stock.get(settings.leased_warehouse, 0), "damaged_qty": stock.get(settings.damaged_warehouse, 0),
            "pending_qty": pending, "warehouse_stock": dict(stock), "needs_attention": bool(pending or missing),
        })
    return result


@frappe.whitelist()
def item_detail(item_code):
    _require_stock()
    item = frappe.get_doc("Item", item_code)
    rows = inventory(search=item_code)
    history = frappe.get_all(
        "Stock Ledger Entry", filters={"item_code": item_code, "is_cancelled": 0},
        fields=["posting_date", "posting_time", "warehouse", "actual_qty", "voucher_type", "voucher_no"],
        order_by="posting_date desc, posting_time desc", limit_page_length=30,
    )
    return {"item": item.as_dict(no_nulls=True), "balance": next((row for row in rows if row["item_code"] == item_code), {}), "history": history}


@frappe.whitelist()
def scan(value, context=None):
    _require_stock()
    result = scan_barcode(value, _loads(context, {}))
    if not result:
        frappe.throw(_("No item or warehouse found for this code"))
    return result


@frappe.whitelist()
def create_item(data):
    _require_stock()
    payload = _loads(data, {})
    if not payload.get("item_name") or not payload.get("stock_uom") or not payload.get("item_group"):
        frappe.throw(_("Name, unit, and category are required"))
    item_code = payload.get("item_code") or _item_code()
    if frappe.db.exists("Item", item_code):
        frappe.throw(_("Item Code already exists"))
    item = frappe.get_doc({
        "doctype": "Item", "item_code": item_code, "item_name": payload["item_name"],
        "item_group": payload["item_group"], "stock_uom": payload["stock_uom"], "description": payload.get("description"),
        "image": payload.get("image"), "is_stock_item": 1,
    })
    item.insert()
    return {"item_code": item.name}


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
        payload["to_warehouse"] = settings.leased_warehouse
    elif movement == "Damage":
        payload["to_warehouse"] = settings.damaged_warehouse
    doc = frappe.get_doc({
        "doctype": "Stock Entry", "stock_entry_type": MOVEMENT_TYPES[movement], "company": settings.company,
        "posting_date": payload.get("posting_date") or date.today(), "items": _entry_items(payload), **_entry_fields(payload),
    })
    doc.insert()
    if submit:
        doc.submit()
    return {"name": doc.name, "docstatus": doc.docstatus}


@frappe.whitelist()
def outstanding_loans():
    _require_stock()
    loans = frappe.get_all(
        "Stock Entry", filters={"docstatus": 1, "ti_movement_kind": "Loan"},
        fields=["name", "posting_date", "ti_recipient", "ti_purpose", "ti_responsible_person"], order_by="posting_date desc",
    )
    returns = frappe.get_all("Stock Entry", filters={"docstatus": 1, "ti_loan_reference": ("is", "set")}, fields=["ti_loan_reference"])
    returned = defaultdict(int)
    for row in returns:
        returned[row.ti_loan_reference] += 1
    return [{**loan, "has_return_activity": bool(returned[loan.name])} for loan in loans]


@frappe.whitelist()
def setup(company, root_warehouse_name):
    if not frappe.has_role("System Manager"):
        frappe.throw(_("System Manager permission is required"), frappe.PermissionError)
    settings = _settings()
    settings.company = company
    root = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": root_warehouse_name, "company": company, "is_group": 1})
    root.insert(ignore_if_duplicate=True)
    root_name = frappe.db.get_value("Warehouse", {"warehouse_name": root_warehouse_name, "company": company}, "name")
    for label, field in (("待确认位置", "pending_warehouse"), ("Leased", "leased_warehouse"), ("Damaged", "damaged_warehouse")):
        name = frappe.db.get_value("Warehouse", {"warehouse_name": label, "company": company}, "name")
        if not name:
            name = frappe.get_doc({"doctype": "Warehouse", "warehouse_name": label, "company": company, "parent_warehouse": root_name}).insert().name
        settings.set(field, name)
    settings.save()
    return {"root_warehouse": root_name}
