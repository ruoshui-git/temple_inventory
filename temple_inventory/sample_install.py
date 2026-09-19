"""Foreground installer for the Temple Inventory development sample dataset."""

import sys
import traceback
from datetime import timedelta
from pathlib import Path

import frappe
from frappe.utils import cint, getdate, nowdate

VERSION = "2026.09.final"


def _settings():
	return frappe.get_single("Temple Inventory Settings")


def _progress(message):
	print(f"[temple-sample] {message}", flush=True)


def _remove_new_files(existing_files):
	for row in frappe.get_all("File", fields=["name", "file_url"], filters={"attached_to_doctype": "Item"}):
		if row.name in existing_files or not row.file_url or not row.file_url.startswith("/files/"):
			continue
		path = Path(frappe.get_site_path("public", row.file_url.lstrip("/")))
		try:
			if path.is_file():
				path.unlink()
		except OSError:
			pass


def assert_development_site():
	"""Reject destructive sample operations outside a developer-mode site."""
	if not cint(frappe.conf.get("developer_mode")):
		frappe.throw("此命令仅允许在 developer_mode=1 的开发站点执行")
	installed = set(frappe.get_installed_apps())
	missing = {"frappe", "erpnext", "temple_inventory"} - installed
	if missing:
		frappe.throw(f"站点缺少必需应用：{', '.join(sorted(missing))}")
	return {"site": frappe.local.site, "installed_apps": sorted(installed)}


def install_sample_data(company=None):
	"""Install the catalog and representative transactions on a clean site."""
	if "System Manager" not in frappe.get_roles():
		frappe.throw("System Manager permission is required")

	from temple_inventory.inventory_api import _create_structure

	settings = _settings()
	company = company or settings.company
	if not company:
		frappe.throw("请先选择 Company")
	root = settings.root_warehouse
	if root:
		exists = frappe.db.sql(
			"""select 1 from `tabStock Ledger Entry` where warehouse in
			(select name from `tabWarehouse` where lft >= (select lft from tabWarehouse where name=%s)
			and rgt <= (select rgt from tabWarehouse where name=%s)) limit 1""",
			(root, root),
		)
		business = any(
			frappe.db.exists(dt, {})
			for dt in ("Inventory Workspace", "Inventory Loan", "Inventory Return", "Inventory Loss")
		)
		if exists or business:
			frappe.throw("样例安装仅允许在没有库存流水和业务记录的站点执行")

	existing_files = set(frappe.get_all("File", pluck="name"))
	settings.db_set("sample_data_status", "Installing", update_modified=False)
	frappe.db.commit()
	try:
		_progress("仓库：开始建立 canonical hierarchy")
		_create_structure(company, True)
		_progress("仓库：完成")

		from temple_inventory.setup.sample_inventory_data import import_sample_data

		_progress("通用目录与批次：开始")
		_progress("期初库存：开始")
		_progress("样例图片：开始")
		general_result = import_sample_data(company=company, create_stock=1, attach_images=1)
		_progress("样例图片：完成")
		_progress("期初库存：完成")
		_progress("通用目录与批次：完成")

		from temple_inventory.setup.import_costumes import run as import_costumes

		setup_root = Path(__file__).resolve().parent / "setup"
		_progress("服装目录、期初库存和图片：开始")
		costume_result = import_costumes(
			source_csv=str(setup_root / "costumes-data" / "costumes_source_normalized.csv"),
			company=company,
			asset_manifest_json=str(setup_root / "sample_assets" / "manifest.json"),
			asset_root=str(setup_root / "sample_assets"),
			create_opening_stock=1,
			submit_opening_stock=1,
		)
		_progress("服装目录、期初库存和图片：完成")

		from temple_inventory.sample_transactions import install_representative_transactions

		_progress("样例库存事务：开始")
		transaction_result = install_representative_transactions(company)
		_progress("样例库存事务：完成")

		settings.db_set("sample_data_version", VERSION, update_modified=False)
		settings.db_set("sample_data_status", "Installed", update_modified=False)
		settings.db_set("sample_data_error", "", update_modified=False)
		frappe.db.commit()
		return {
			"status": "Installed",
			"version": VERSION,
			"general": general_result,
			"costumes": costume_result,
			"transactions": transaction_result,
		}
	except Exception as exc:
		_remove_new_files(existing_files)
		frappe.db.rollback()
		settings = _settings()
		settings.db_set("sample_data_status", "Failed", update_modified=False)
		settings.db_set("sample_data_error", str(exc)[:2000], update_modified=False)
		frappe.db.commit()
		print("[temple-sample] 样例安装失败：", file=sys.stderr, flush=True)
		traceback.print_exc()
		raise


def prepare_development_sample_site(
	company="Org",
	abbr="O",
	country="United States",
	currency="USD",
	chart_of_accounts="Standard",
	fiscal_year_start=None,
	fiscal_year_end=None,
):
	"""Configure a freshly reinstalled developer site and install all sample data.

	This is intentionally not whitelisted. Invoke it only through ``bench execute``
	after the reset-development-samples wrapper has reinstalled the site.
	"""
	assert_development_site()
	if frappe.db.exists("Company", {}):
		frappe.throw("开发样例初始化要求一个刚重装且没有 Company 的站点")

	from erpnext.setup.setup_wizard.setup_wizard import setup_complete

	start = getdate(fiscal_year_start or f"{getdate(nowdate()).year}-01-01")
	end = getdate(fiscal_year_end or (start.replace(year=start.year + 1) - timedelta(days=1)))
	args = frappe._dict(
		{
			"company_name": company,
			"company_abbr": abbr,
			"country": country,
			"currency": currency,
			"chart_of_accounts": chart_of_accounts,
			"domain": None,
			"fy_start_date": str(start),
			"fy_end_date": str(end),
		}
	)

	frappe.set_user("Administrator")
	_progress("ERPNext Company、会计科目与默认设置：开始")
	setup_complete(args)
	stock_settings = frappe.get_single("Stock Settings")
	if not stock_settings.enable_serial_and_batch_no_for_item:
		stock_settings.enable_serial_and_batch_no_for_item = 1
		stock_settings.save(ignore_permissions=True)
	frappe.db.commit()
	_progress("ERPNext Company、会计科目与默认设置：完成")

	result = install_sample_data(company=company)
	_progress(f"最终验证：完成（{result['transactions']['transactions']} 个样例事务）")
	return result
