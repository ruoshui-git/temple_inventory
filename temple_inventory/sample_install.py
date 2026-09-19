"""Idempotent clean-site sample installer for Temple Inventory."""
import frappe
from pathlib import Path
from frappe.utils import now_datetime

VERSION = "2026.09.final"

def _settings(): return frappe.get_single("Temple Inventory Settings")

def _remove_new_files(existing_files):
    for row in frappe.get_all("File", fields=["name", "file_url"], filters={"attached_to_doctype": "Item"}):
        if row.name in existing_files or not row.file_url or not row.file_url.startswith("/files/"):
            continue
        path = Path(frappe.get_site_path("public", row.file_url.lstrip("/")))
        try:
            if path.is_file(): path.unlink()
        except OSError:
            pass


def install_sample_data(company=None):
    if "System Manager" not in frappe.get_roles():
        frappe.throw("System Manager permission is required")
    from temple_inventory.inventory_api import _create_structure
    settings = _settings(); company = company or settings.company
    if not company: frappe.throw("请先选择 Company")
    root = settings.root_warehouse
    if root:
        exists = frappe.db.sql("select 1 from `tabStock Ledger Entry` where warehouse in (select name from `tabWarehouse` where lft >= (select lft from tabWarehouse where name=%s) and rgt <= (select rgt from tabWarehouse where name=%s)) limit 1", (root, root))
        business = any(frappe.db.exists(dt, {}) for dt in ("Inventory Workspace", "Inventory Loan", "Inventory Return", "Inventory Loss"))
        if exists or business: frappe.throw("样例安装仅允许在没有库存流水和业务记录的站点执行")
    existing_files = set(frappe.get_all("File", pluck="name"))
    settings.db_set("sample_data_status", "Installing", update_modified=False)
    frappe.db.commit()
    try:
        _create_structure(company, True)
        from temple_inventory.setup.sample_inventory_data import import_sample_data
        import_sample_data(company=company, create_stock=1, attach_images=1)
        from temple_inventory.setup.import_costumes import run as import_costumes
        setup_root = Path(__file__).resolve().parent / "setup"
        import_costumes(source_csv=str(setup_root / "costumes-data" / "costumes_source_normalized.csv"), company=company, asset_manifest_json=str(setup_root / "sample_assets" / "manifest.json"), asset_root=str(setup_root / "sample_assets"), create_opening_stock=1, submit_opening_stock=1)
        # Representative transactions are created by the dedicated production-service seed.
        from temple_inventory.sample_transactions import install_representative_transactions
        install_representative_transactions(company)
        settings.db_set("sample_data_version", VERSION, update_modified=False)
        settings.db_set("sample_data_status", "Installed", update_modified=False)
        settings.db_set("sample_data_error", "", update_modified=False)
        frappe.db.commit()
        return {"status": "Installed", "version": VERSION}
    except Exception as exc:
        _remove_new_files(existing_files)
        frappe.db.rollback()
        settings = _settings()
        settings.db_set("sample_data_status", "Failed", update_modified=False)
        settings.db_set("sample_data_error", str(exc)[:2000], update_modified=False)
        frappe.db.commit()
        raise

def enqueue_sample_install(company=None):
    if "System Manager" not in frappe.get_roles(): frappe.throw("System Manager permission is required")
    frappe.enqueue("temple_inventory.sample_install.install_sample_data", queue="long", company=company, enqueue_after_commit=True)
    frappe.db.set_single_value("Temple Inventory Settings", "sample_data_status", "Installing")
    frappe.db.commit()
    return {"status":"Installing"}
