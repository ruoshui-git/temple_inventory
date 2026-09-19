"""Best-effort merge of development sample data into an existing site.

This module is intentionally not whitelisted.  Run it from ``bench console``
on a disposable development site::

    from temple_inventory.setup.merge_sample_data import run
    report = run(company="Org")
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict

import frappe
from frappe.utils import flt
from frappe.utils.file_manager import save_file

from temple_inventory import inventory_api
from temple_inventory.setup import import_costumes, sample_inventory_data


def _normalize(value):
    return re.sub(r"\s+", " ", str(value or "").strip())


def _print(stage, message="start"):
    print(f"[temple-inventory merge] {stage}: {message}", flush=True)


def _item_index():
    index = defaultdict(list)
    for row in frappe.get_all("Item", fields=["name", "item_name"], limit_page_length=0):
        index[_normalize(row.item_name)].append(row.name)
    return index


def _find_item(index, item_name):
    matches = index.get(_normalize(item_name), [])
    if len(matches) > 1:
        return None, {"status": "ambiguous", "item_name": item_name, "matches": matches}
    return (matches[0] if matches else None), None


def _new_general_item(sample_key, name, category, batched, rate, note, counter):
    code, counter = sample_inventory_data._allocate_next_item_code(counter)
    doc = frappe.get_doc({
        "doctype": "Item", "item_code": code, "item_name": name,
        "item_group": category, "stock_uom": "Nos", "is_stock_item": 1,
        "has_batch_no": 1 if batched else 0, "description": note or name,
    })
    if doc.meta.has_field("valuation_rate"):
        doc.valuation_rate = rate
    doc.insert(ignore_permissions=True)
    return doc.name, counter


def _merge_general_items(report):
    sample_inventory_data._ensure_item_groups()
    index = _item_index()
    mapping, counter = {}, None
    for key, name, category, _room, batched, rate, _source, note in sample_inventory_data.ITEMS:
        code, issue = _find_item(index, name)
        if issue:
            report["ambiguous"].append(issue)
            continue
        savepoint = f"merge_item_{key.replace('-', '_')}"
        frappe.db.savepoint(savepoint)
        try:
            if code:
                existing = frappe.get_doc("Item", code)
                if bool(existing.has_batch_no) != bool(batched):
                    report["errors"].append({"sample_key": key, "item_code": code, "item_name": name, "error": "existing batch configuration is incompatible"})
                    continue
                mapping[key] = code
                report["reused"].append({"sample_key": key, "item_code": code, "item_name": name})
            else:
                if counter is None:
                    counter = sample_inventory_data._detect_next_item_counter()
                code, counter = _new_general_item(key, name, category, batched, rate, note, counter)
                mapping[key] = code
                index[_normalize(name)].append(code)
                report["created"].append({"sample_key": key, "item_code": code, "item_name": name})
        except Exception as exc:
            report["errors"].append({"sample_key": key, "item_name": name, "error": str(exc)})
            frappe.db.rollback(save_point=savepoint)
    return mapping


def _merge_costume_items(report):
    mapping, index = {}, _item_index()
    try:
        source = os.path.join(os.path.dirname(import_costumes.__file__), "costumes-data", "costumes_source_normalized.csv")
        rows = import_costumes._read_csv(source)
    except Exception as exc:
        report["errors"].append({"stage": "costume_catalog", "error": str(exc)})
        return mapping
    for row in rows:
        legacy = import_costumes._clean(row.get("item_code"))
        name = import_costumes._append_source_uom_to_name(
            import_costumes._clean(row.get("item_name")), import_costumes._clean(row.get("uom"))
        )
        code, issue = _find_item(index, name)
        if issue:
            issue["legacy_code"] = legacy
            report["ambiguous"].append(issue)
            continue
        savepoint = f"merge_costume_{legacy.replace('-', '_')}"
        frappe.db.savepoint(savepoint)
        try:
            if not code:
                code = import_costumes._find_existing_item_by_legacy_code(legacy)
            if not code:
                code, created = import_costumes._upsert_item(row, update_existing_items=False)
                if created:
                    report["created"].append({"legacy_code": legacy, "item_code": code, "item_name": name})
            else:
                report["reused"].append({"legacy_code": legacy, "item_code": code, "item_name": name})
            mapping[legacy] = code
            index[_normalize(name)].append(code)
        except Exception as exc:
            report["errors"].append({"legacy_code": legacy, "item_name": name, "error": str(exc)})
            frappe.db.rollback(save_point=savepoint)
    return mapping


def _merge_batches(mapping, report):
    for key, specs in sample_inventory_data.BATCH_SPECS.items():
        item_code = mapping.get(key)
        if not item_code:
            report["skipped"].append({"sample_key": key, "reason": "item missing or ambiguous"})
            continue
        for batch_no, manufacturing, expiry, _qty in specs:
            savepoint = f"merge_batch_{batch_no.replace('-', '_')}"
            frappe.db.savepoint(savepoint)
            try:
                existing = frappe.db.exists("Batch", batch_no)
                if existing:
                    owner = frappe.db.get_value("Batch", batch_no, "item")
                    if owner != item_code:
                        report["errors"].append({"batch": batch_no, "error": f"belongs to {owner}, expected {item_code}"})
                    else:
                        report["reused"].append({"batch": batch_no, "item_code": item_code})
                    continue
                frappe.get_doc({"doctype": "Batch", "batch_id": batch_no, "item": item_code,
                                "manufacturing_date": manufacturing, "expiry_date": expiry}).insert(ignore_permissions=True)
                report["created"].append({"batch": batch_no, "item_code": item_code})
            except Exception as exc:
                report["errors"].append({"batch": batch_no, "error": str(exc)})
                frappe.db.rollback(save_point=savepoint)


def _attach_image(item_code, path, report):
    filename = os.path.basename(path)
    existing = frappe.get_all("File", filters={"attached_to_doctype": "Item", "attached_to_name": item_code,
                                                "file_name": filename}, fields=["name"], limit_page_length=1)
    if existing:
        return "reused"
    with open(path, "rb") as handle:
        save_file(filename, handle.read(), "Item", item_code, decode=False, is_private=0)
    return "created"


def _merge_images(general_mapping, costume_mapping, report):
    manifest = sample_inventory_data.SAMPLE_IMAGE_MANIFEST
    if os.path.exists(manifest):
        try:
            payload = frappe.parse_json(frappe.read_file(manifest))
            rows = payload.get("images", payload) if isinstance(payload, dict) else payload
        except Exception as exc:
            report["errors"].append({"source": "general", "error": str(exc)})
            rows = []
        for row in rows:
            key = row.get("sample_key") or row.get("key")
            code = general_mapping.get(key) or costume_mapping.get(key)
            if not code:
                continue
            relative = row.get("filename") or row.get("output")
            path = os.path.join(sample_inventory_data.SAMPLE_IMAGE_DIR.parent, relative) if relative and relative.startswith("images/") else os.path.join(sample_inventory_data.SAMPLE_IMAGE_DIR, relative or "")
            try:
                outcome = _attach_image(code, path, report)
                item = frappe.get_doc("Item", code)
                if not item.image:
                    item.image = frappe.db.get_value("File", {"attached_to_name": code, "file_name": os.path.basename(path)}, "file_url")
                    item.save(ignore_permissions=True)
                report[outcome].append({"item_code": code, "filename": os.path.basename(path)})
            except Exception as exc:
                report["errors"].append({"item_code": code, "filename": os.path.basename(path), "error": str(exc)})
    return report


def _warehouse_stage(company, report):
    result = inventory_api._create_structure(company, include_examples=True)
    report["created_or_reused"] = result
    return result


def _reconcile(company, general_mapping, costume_mapping, report):
    """Submit only rows whose current balance is exactly zero/absent."""
    grouped = defaultdict(list)
    for key, _name, room, qty, rate, batch, expiry, _source, _expired, _note in sample_inventory_data.OPENING_STOCK:
        code = general_mapping.get(key)
        if not code:
            report["skipped"].append({"sample_key": key, "reason": "item missing or ambiguous"})
            continue
        try:
            warehouse = sample_inventory_data._get_warehouse(room, company)
            balance = sample_inventory_data._stock_already_exists(code, warehouse, batch or None)
            if balance:
                report["skipped"].append({"item_code": code, "warehouse": warehouse, "batch": batch, "reason": "non-zero balance preserved"})
                continue
            posting = sample_inventory_data._posting_date_for_row(batch or None, expiry)
            row = {"item_code": code, "warehouse": warehouse, "qty": flt(qty), "valuation_rate": flt(rate)}
            if batch:
                row.update({"use_serial_batch_fields": 1, "batch_no": batch})
            grouped[posting].append(row)
        except Exception as exc:
            report["errors"].append({"sample_key": key, "error": str(exc)})
    # Costume opening quantities use the canonical A04 leaf and the same
    # zero-only policy.  Existing positive and negative balances are untouched.
    if costume_mapping:
        try:
            source = os.path.join(os.path.dirname(import_costumes.__file__), "costumes-data", "costumes_source_normalized.csv")
            warehouse = import_costumes._resolve_a04_warehouse()
            for row in import_costumes._read_csv(source):
                legacy = import_costumes._clean(row.get("item_code"))
                code = costume_mapping.get(legacy)
                qty = import_costumes._to_qty(row.get("quantity"))
                if not code or not qty:
                    continue
                if sample_inventory_data._stock_already_exists(code, warehouse):
                    report["skipped"].append({"item_code": code, "warehouse": warehouse, "reason": "non-zero balance preserved"})
                    continue
                grouped[sample_inventory_data.AS_OF_DATE].append({"item_code": code, "warehouse": warehouse, "qty": qty, "valuation_rate": 0, "allow_zero_valuation_rate": 1})
        except Exception as exc:
            report["errors"].append({"source": "costume_opening_stock", "error": str(exc)})
    account = sample_inventory_data._get_temporary_opening_account(company) if grouped else None
    for posting, rows in grouped.items():
        try:
            doc = frappe.get_doc({"doctype": "Stock Reconciliation", "company": company, "purpose": "Opening Stock",
                                  "posting_date": posting, "posting_time": "23:59:59", "expense_account": account,
                                  "remarks": "Temple Inventory sample merge"})
            for row in rows:
                doc.append("items", row)
            doc.insert(ignore_permissions=True)
            doc.submit()
            report["created"].append({"name": doc.name, "posting_date": posting, "row_count": len(rows)})
            frappe.db.commit()
        except Exception as exc:
            report["errors"].append({"posting_date": posting, "row_count": len(rows), "error": str(exc)})
            frappe.db.rollback()


def _transactions(company, report):
    try:
        from temple_inventory.sample_transactions import install_representative_transactions
        result = install_representative_transactions(company)
        report.update(result)
        report["status"] = "reused_or_created"
    except Exception as exc:
        report["errors"].append({"error": str(exc)})
        frappe.db.rollback()


def _resolve_company(company):
    if company:
        if not frappe.db.exists("Company", company):
            frappe.throw(f"Company does not exist: {company}")
        return company
    configured = frappe.db.get_single_value("Temple Inventory Settings", "company")
    if configured:
        return configured
    companies = frappe.get_all("Company", pluck="name")
    if len(companies) != 1:
        frappe.throw("Specify company when the site has zero or multiple companies")
    return companies[0]


def run(company=None):
    """Merge samples into an existing development site and return a JSON-ready report."""
    if not frappe.conf.developer_mode:
        frappe.throw("merge_sample_data is development-only (developer_mode is required)")
    missing = [app for app in ("frappe", "erpnext", "temple_inventory") if app not in frappe.get_installed_apps()]
    if missing:
        frappe.throw("Missing required apps: " + ", ".join(missing))
    company = _resolve_company(company)
    previous_user = frappe.session.user
    frappe.set_user("Administrator")
    result = {"company": company, "status": "completed", "warehouses": {},
              "items": {"created": [], "reused": [], "ambiguous": [], "errors": []},
              "batches": {"created": [], "reused": [], "skipped": [], "errors": []},
              "images": {"created": [], "reused": [], "errors": []},
              "reconciliations": {"created": [], "skipped": [], "errors": []},
              "transactions": {"errors": []}}
    try:
        for stage, fn in (("warehouses", lambda: _warehouse_stage(company, result["warehouses"])),
                          ("general_catalog", lambda: _merge_general_items(result["items"])),
                          ("costume_catalog", lambda: _merge_costume_items(result["items"])),
                          ("batches", lambda: _merge_batches(result.get("general_mapping", {}), result["batches"])),
                          ("images", lambda: _merge_images(result.get("general_mapping", {}), result.get("costume_mapping", {}), result["images"])),
                          ("stock_reconciliation", lambda: _reconcile(company, result.get("general_mapping", {}), result.get("costume_mapping", {}), result["reconciliations"])),
                          ("transactions", lambda: _transactions(company, result["transactions"]))):
            _print(stage)
            if stage == "general_catalog":
                result["general_mapping"] = fn()
            elif stage == "costume_catalog":
                result["costume_mapping"] = fn()
            elif stage == "batches":
                fn()
            else:
                fn()
            frappe.db.commit()
            _print(stage, "complete")
        if any(section.get("errors") for section in result.values() if isinstance(section, dict)):
            result["status"] = "completed_with_errors"
    finally:
        frappe.set_user(previous_user)
    result.pop("general_mapping", None)
    result.pop("costume_mapping", None)
    print(json.dumps(result, ensure_ascii=False, default=str, indent=2), flush=True)
    return result

