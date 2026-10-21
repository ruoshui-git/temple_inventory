"""Foreground installer for the Temple Inventory development sample dataset."""

# ruff: noqa: RUF001 — Chinese sample setup messages are intentional.

import sys
import traceback
from datetime import timedelta
from pathlib import Path

import frappe
from frappe.utils import cint, getdate, nowdate

VERSION = "2026.10.native-documents-v1"

DEFAULT_SAMPLE_ITEM_GROUPS = ("Consumable", "Products", "Raw Material", "Services", "Sub Assemblies")
DEFAULT_SAMPLE_WAREHOUSES = (
	"Finished Goods",
	"Goods In Transit",
	"Stores",
	"Work In Progress",
)


def _settings():
	return frappe.get_single("Temple Inventory Settings")


def _remove_default_sample_records(company):
	"""Remove unused ERPNext defaults before creating the sample hierarchy."""
	for group_name in DEFAULT_SAMPLE_ITEM_GROUPS:
		if not frappe.db.exists("Item Group", group_name):
			continue
		if frappe.db.exists("Item", {"item_group": group_name}):
			frappe.throw(f"无法删除默认 Item Group {group_name}：仍有 Item 使用它")
		frappe.delete_doc("Item Group", group_name, ignore_permissions=True, force=True)

	root_name = frappe.db.get_value("Warehouse", {"warehouse_name": "All Warehouses", "company": company})
	if not root_name:
		return

	children = frappe.get_all(
		"Warehouse",
		filters={"parent_warehouse": root_name, "warehouse_name": ["in", DEFAULT_SAMPLE_WAREHOUSES]},
		pluck="name",
	)
	for warehouse_name in children:
		if frappe.db.exists("Stock Ledger Entry", {"warehouse": warehouse_name}):
			frappe.throw(f"无法删除默认仓库 {warehouse_name}：已有库存流水")
		frappe.delete_doc("Warehouse", warehouse_name, ignore_permissions=True, force=True)

	if frappe.db.exists("Stock Ledger Entry", {"warehouse": root_name}):
		frappe.throw(f"无法删除默认根仓库 {root_name}：已有库存流水")
	if not frappe.get_all("Warehouse", filters={"parent_warehouse": root_name}, limit_page_length=1):
		frappe.delete_doc("Warehouse", root_name, ignore_permissions=True, force=True)


def _progress(message):
	print(f"[temple-sample] {message}", flush=True)


def assert_development_site(allow_non_developer=0):
	"""Reject destructive sample operations unless explicitly overridden."""
	if frappe.local.site != "development.localhost":
		frappe.throw("Sample operations only accept development.localhost")
	if not cint(frappe.conf.get("developer_mode")) and not cint(allow_non_developer):
		frappe.throw("此命令仅允许在 developer_mode=1 的开发站点执行")
	installed = set(frappe.get_installed_apps())
	missing = {"frappe", "erpnext", "temple_inventory"} - installed
	if missing:
		frappe.throw(f"站点缺少必需应用：{', '.join(sorted(missing))}")
	return {"site": frappe.local.site, "installed_apps": sorted(installed)}


def assert_native_reset_ready(allow_non_developer=0):
	"""Fail before reinstall if app source would recreate retired business schema."""
	import json

	from temple_inventory.sample_media import ASSETS, _digest, catalog

	result = assert_development_site(allow_non_developer=allow_non_developer)
	root = Path(__file__).parent
	retired = (
		"inventory_workspace",
		"inventory_loan",
		"inventory_loan_item",
		"inventory_return",
		"inventory_return_item",
		"inventory_loss",
		"inventory_loss_item",
	)
	if any((root / "temple_inventory" / "doctype" / name).exists() for name in retired):
		frappe.throw("Native reset is not ready: retired business DocType source remains")
	fields = json.loads((root / "fixtures" / "custom_field.json").read_text())
	if any(
		row["fieldname"]
		in {
			"ti_workspace",
			"ti_loan",
			"ti_return",
			"ti_loss",
			"ti_responsible_person",
			"ti_count_warehouse",
		}
		for row in fields
	):
		frappe.throw("Native reset is not ready: retired custom-field fixtures remain")
	for row in catalog()["items"]:
		for image in row["images"]:
			path = ASSETS / image["output"]
			if not path.resolve().is_relative_to(ASSETS.resolve()) or _digest(path) != image["sha256"]:
				frappe.throw("Native sample image assets are missing or changed")
	return {**result, "native_reset_ready": True}


def _administrator_auth_path():
	path = Path(frappe.get_site_path("private", "temple-inventory-reset-auth.json"))
	if path.is_symlink() or path.parent.is_symlink():
		raise ValueError("Administrator authentication backup must not follow symlinks")
	return path


def preserve_administrator_auth():
	"""Keep the existing native password hash across this exact-site reinstall."""
	import json
	import os

	assert_development_site()
	path = _administrator_auth_path()
	if path.exists():
		frappe.throw("A prior Administrator authentication backup exists; restore it before resetting")
	rows = frappe.db.sql(
		"""select password from `__Auth` where doctype='User' and name='Administrator'
		and fieldname='password' and encrypted=0"""
	)
	if len(rows) != 1 or not rows[0][0]:
		frappe.throw("Existing Administrator password hash is unavailable; reset stopped")
	with open(path, "x", opener=lambda name, flags: os.open(name, flags, 0o600)) as stream:
		json.dump({"site": frappe.local.site, "password_hash": rows[0][0]}, stream)
	return {"administrator_password_preserved": True}


def restore_administrator_auth():
	"""Restore the existing hash, commit it, then remove the transient secret file."""
	import json

	from frappe.utils.password import Auth, passlibctx

	assert_development_site()
	path = _administrator_auth_path()
	if path.stat().st_mode & 0o077:
		raise ValueError("Administrator authentication backup permissions are too broad")
	data = json.loads(path.read_text())
	if data.get("site") != frappe.local.site or not passlibctx.identify(data.get("password_hash", "")):
		raise ValueError("Administrator authentication backup is invalid")
	query = frappe.qb.into(Auth).columns(
		Auth.doctype, Auth.name, Auth.fieldname, Auth.password, Auth.encrypted
	)
	query.insert("User", "Administrator", "password", data["password_hash"], 0).on_duplicate_key_update(
		Auth.password, data["password_hash"]
	).on_duplicate_key_update(Auth.encrypted, 0).run()
	frappe.db.commit()
	path.unlink()
	return {"administrator_password_restored": True}


def _assert_leaf_stock(settings):
	"""Refuse to complete installation when ERPNext has stock in group warehouses."""
	bad = frappe.db.sql(
		"""select b.warehouse, sum(b.actual_qty) as actual_qty
		from `tabBin` b join `tabWarehouse` w on w.name=b.warehouse
		where w.company=%s and w.lft >= (select lft from `tabWarehouse` where name=%s)
		and w.rgt <= (select rgt from `tabWarehouse` where name=%s)
		and w.is_group=1 and abs(b.actual_qty) > 0.00000001
		group by b.warehouse""",
		(settings.company, settings.root_warehouse, settings.root_warehouse),
		as_dict=True,
	)
	if bad:
		details = ", ".join(f"{row.warehouse}={row.actual_qty}" for row in bad)
		frappe.throw(f"样例安装未完成：检测到分组仓库仍有非零库存（{details}）。请先修复到叶子库位。")


def _complete_setup_wizard():
	"""Mark the freshly configured developer site as ready for Desk."""
	from frappe.desk.page.setup_wizard.setup_wizard import (
		disable_future_access,
		enable_setup_wizard_complete,
	)

	for app_name in ("frappe", "erpnext"):
		enable_setup_wizard_complete(app_name)
	disable_future_access()


def install_sample_data(company=None):
	"""Install real native samples on the exact authorized development site."""
	assert_development_site()
	if "System Manager" not in frappe.get_roles():
		frappe.throw("System Manager permission is required")
	from temple_inventory.native_samples import install

	settings = _settings()
	company = company or settings.company
	if not company:
		frappe.throw("请先选择 Company")
	settings.db_set("sample_data_status", "Installing", update_modified=False)
	frappe.db.commit()
	try:
		_progress("原生仓库、目录、私有图片、库存单据与盘点：开始")
		result = install(company)
		settings.reload()
		_assert_leaf_stock(settings)
		settings.db_set("sample_data_version", VERSION, update_modified=False)
		settings.db_set("sample_data_status", "Installed", update_modified=False)
		settings.db_set("sample_data_error", "", update_modified=False)
		frappe.db.commit()
		_progress("原生样例及叶子库位库存验证：完成")
		return {"status": "Installed", "version": VERSION, **result}
	except Exception as exc:
		# Native File's rollback callbacks remove files created by this transaction.
		# Never unlink broad directories or shared files from a hand-written fallback.
		frappe.db.rollback()
		settings = _settings()
		settings.db_set("sample_data_status", "Failed", update_modified=False)
		settings.db_set("sample_data_error", str(exc)[:2000], update_modified=False)
		frappe.db.commit()
		print("[temple-sample] 样例安装失败：", file=sys.stderr, flush=True)
		traceback.print_exc()
		raise


def verify_development_sample():
	"""Verify native identities, permissions, balance invariants and private media."""
	assert_development_site()
	from temple_inventory import native_samples, sample_media
	from temple_inventory.native_api import _request_key

	settings = _settings()
	if settings.sample_data_status != "Installed" or settings.sample_data_version != VERSION:
		frappe.throw("原生开发样例尚未完整安装")
	for doctype in (
		"Inventory Workspace",
		"Inventory Loan",
		"Inventory Loan Item",
		"Inventory Return",
		"Inventory Return Item",
		"Inventory Loss",
		"Inventory Loss Item",
	):
		if frappe.db.exists("DocType", doctype) or frappe.db.table_exists(doctype):
			raise AssertionError("Retired business schema remains after reset")
	if frappe.db.exists(
		"Custom Field",
		{
			"module": "Temple Inventory",
			"fieldname": [
				"in",
				[
					"ti_workspace",
					"ti_loan",
					"ti_return",
					"ti_loss",
					"ti_responsible_person",
					"ti_system_role",
					"ti_fallback_role",
				],
			],
		},
	):
		raise AssertionError("Retired custom fields remain after reset")
	if frappe.db.exists(
		"Custom Field",
		{
			"module": "Temple Inventory",
			"dt": "Stock Reconciliation",
			"fieldname": "ti_count_warehouse",
		},
	):
		raise AssertionError("Retired singular count warehouse field remains after reset")
	if frappe.db.has_column("Stock Reconciliation", "ti_count_warehouse"):
		raise AssertionError("Retired singular count warehouse column remains after reset")
	_assert_leaf_stock(settings)
	codes = ["TI-SAMPLE-" + row["key"] for row in sample_media.catalog()["items"]]
	codes.extend("TI-SAMPLE-" + row[0] for row in native_samples.EXTRA_ITEMS)
	if frappe.db.count("Item", {"name": ["in", codes]}) != len(codes):
		raise AssertionError("Native sample catalog is incomplete")
	for code in codes:
		item = frappe.get_doc("Item", code)
		item.check_permission("read")
		if item.image and not item.image.startswith("/private/files/"):
			raise AssertionError("Sample primary image is public")
		for row in frappe.get_all(
			"File",
			filters={"attached_to_doctype": "Item", "attached_to_name": code},
			fields=["is_private", "file_url"],
		):
			if not row.is_private or not row.file_url.startswith("/private/files/"):
				raise AssertionError("Sample original image is public")
	rooms = {
		key: frappe.db.get_value("Warehouse", {"company": settings.company, "warehouse_name": label}, "name")
		for key, label in (("A02", "A02 / 无货位"), ("A02-RACK", "A02 / 货架一 / 上层"))
	}
	rooms.update({"LEASE": settings.leased_warehouse, "DAMAGED": settings.damaged_warehouse})
	loans = [
		frappe.get_doc(
			"Stock Entry",
			{"ti_request_key": _request_key("Stock Entry", native_samples.REQUEST_PREFIX + key)},
		)
		for key in ("loan-first", "loan-second")
	]
	native_samples.assert_balances(rooms, loans)
	reconciliation = frappe.get_doc(
		"Stock Reconciliation",
		{"ti_request_key": _request_key("Stock Reconciliation", native_samples.REQUEST_PREFIX + "count")},
	)
	count_warehouses = frappe.parse_json(reconciliation.ti_count_warehouses or "[]")
	if set(count_warehouses) != {rooms["A02"], rooms["A02-RACK"]}:
		raise AssertionError("Native sample count does not retain both selected warehouses")
	count_rows = frappe.parse_json(reconciliation.ti_count_review or "[]")
	if not count_rows or any(row.get("review_state") != "Reviewed" for row in count_rows):
		raise AssertionError("Native sample count review is missing reviewed variance rows")
	if any(
		abs(float(row.get("actual_qty") or 0) - float(row.get("baseline_qty") or 0)) < 0.00000001
		for row in count_rows
	):
		raise AssertionError("Native sample count must retain non-zero reviewed variances")
	media = sample_media.inventory()
	if media["public_files"]:
		raise AssertionError("Obsolete public sample media remains")
	return {
		"site": frappe.local.site,
		"version": VERSION,
		"items": len(codes),
		"media": media,
		"balances_verified": True,
		"count_review_verified": True,
		"count_review_rows": len(count_rows),
		"retired_schema_absent": True,
	}


def prepare_development_sample_site(
	company="Org",
	abbr="O",
	country="United States",
	currency="USD",
	chart_of_accounts="Standard",
	fiscal_year_start=None,
	fiscal_year_end=None,
	allow_non_developer=0,
):
	"""Configure a freshly reinstalled disposable site and install all sample data.

	This is intentionally not whitelisted. Invoke it only through ``bench execute``
	after the reset-development-samples wrapper has reinstalled the site. A
	non-developer site requires an explicit wrapper override and remains destructive.
	"""
	assert_development_site(allow_non_developer=allow_non_developer)
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
	_complete_setup_wizard()
	_remove_default_sample_records(company)
	frappe.db.commit()

	result = install_sample_data(company=company)
	_progress(f"最终验证：完成（{result['transactions']} 个样例事务）")
	return result
