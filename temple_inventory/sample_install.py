"""Foreground installer for the Temple Inventory development sample dataset."""

# ruff: noqa: RUF001 — Chinese sample setup messages are intentional.

import sys
import traceback
from datetime import timedelta
from pathlib import Path

import frappe
from frappe.utils import cint, getdate, nowdate

VERSION = "2026.10.native-costume-sample-group-v5"

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

	settings = frappe.get_single("Temple Inventory Settings")
	from temple_inventory.native_samples import remove_initializer_general_leaf

	remove_initializer_general_leaf(settings)

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

	from temple_inventory.sample_media import ASSETS, _digest, catalog, costume_catalog

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
	for row in catalog()["items"] + costume_catalog():
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


def verify_development_sample(*, require_images=True):
	"""Verify native identities, permissions, balance invariants and private media."""
	assert_development_site()
	from temple_inventory import native_samples, sample_media
	from temple_inventory.native_api import _request_key

	settings = _settings()
	if settings.sample_data_status != "Installed" or settings.sample_data_version != VERSION:
		frappe.throw("原生开发样例尚未完整安装")
	if frappe.db.exists(
		"Warehouse",
		{"parent_warehouse": settings.physical_root_warehouse, "warehouse_name": "通用库房"},
	):
		raise AssertionError("Initializer-owned physical-root 通用库房 must be removed")
	if not frappe.db.exists("Warehouse", {"warehouse_name": "T1/通用库房", "company": settings.company}):
		raise AssertionError("T1 通用库房 must remain under its T1 branch")
	if not frappe.db.exists(
		"Warehouse", {"warehouse_name": "样例库房", "parent_warehouse": settings.physical_root_warehouse}
	):
		raise AssertionError("The sample warehouse group must be a physical-root sibling of T1 and T2")
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
	general_codes = [native_samples.ITEM_PREFIX + row["key"] for row in sample_media.catalog()["items"]]
	extra_codes = [native_samples.ITEM_PREFIX + row[0] for row in native_samples.EXTRA_ITEMS]
	costumes = sample_media.costume_catalog()
	barcode_to_parent = {
		row.barcode: row.parent
		for row in frappe.get_all(
			"Item Barcode",
			filters={"barcode": ["in", [row["source_code"] for row in costumes]]},
			fields=["barcode", "parent"],
		)
	}
	costume_codes = [barcode_to_parent.get(row["source_code"]) for row in costumes]
	if any(not code or not code.startswith("ITM-") for code in costume_codes):
		raise AssertionError("Every real costume source code must resolve to an allocated Item identity")
	codes = [*general_codes, *extra_codes, *costume_codes]
	if len(costume_codes) != 96 or len(set(costume_codes)) != 96:
		raise AssertionError("Costume import must allocate 96 separate Item identities")
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
	for source, code in zip(costumes, costume_codes, strict=True):
		item = frappe.get_doc("Item", code)
		expected_name = source["item_name"] + (
			"" if source["stock_uom"] == "Nos" else f"({source['stock_uom']})"
		)
		if (
			item.item_name != expected_name
			or item.stock_uom != "Nos"
			or item.item_group != source["item_group"]
			or frappe.db.get_value("Item Barcode", {"parent": code, "barcode": source["source_code"]}, "name")
			is None
		):
			raise AssertionError(
				f"Costume source identity or preserved fields are missing for {source['source_code']}: "
				f"name={item.item_name!r}/{expected_name!r}, unit={item.stock_uom!r}, "
				f"group={item.item_group!r}/{source['item_group']!r}, "
				f"barcode={frappe.db.get_value('Item Barcode', {'parent': code, 'barcode': source['source_code']}, 'name')!r}"
			)
		warehouse = frappe.db.get_value(
			"Warehouse", {"company": settings.company, "warehouse_name": source["room"] + " / 无货位"}, "name"
		)
		if native_samples.get_stock_balance(code, warehouse) != source["quantity"]:
			raise AssertionError(f"Costume opening quantity differs from source for {source['source_code']}")
		attachments = frappe.db.count("File", {"attached_to_doctype": "Item", "attached_to_name": code})
		if require_images and attachments != len(source["images"]):
			raise AssertionError(f"Costume image attachments are incomplete for {source['source_code']}")
	rooms = {
		key: frappe.db.get_value("Warehouse", {"company": settings.company, "warehouse_name": label}, "name")
		for key, label in (
			("SAMPLE_A02", "A02 样例 / 无货位"),
			("SAMPLE_A02-RACK", "A02 样例 / 货架一 / 上层"),
		)
	}
	rooms.update({"LEASE": settings.leased_warehouse, "DAMAGED": settings.damaged_warehouse})
	loans = [
		frappe.get_doc(
			"Stock Entry",
			{"ti_request_key": _request_key("Stock Entry", native_samples.REQUEST_PREFIX + key)},
		)
		for key in ("loan-first", "loan-second", "loan-untouched", "loan-fully-settled")
	]
	native_samples.assert_balances(rooms, loans)
	reconciliation = frappe.get_doc(
		"Stock Reconciliation",
		{"ti_request_key": _request_key("Stock Reconciliation", native_samples.REQUEST_PREFIX + "count")},
	)
	count_warehouses = frappe.parse_json(reconciliation.ti_count_warehouses or "[]")
	if set(count_warehouses) != {rooms["SAMPLE_A02"], rooms["SAMPLE_A02-RACK"]}:
		raise AssertionError("Native sample count does not retain both selected warehouses")
	count_rows = frappe.parse_json(reconciliation.ti_count_review or "[]")
	if {row.get("review_state") for row in count_rows} != {"Reviewed", "Unreviewed"}:
		raise AssertionError("Native sample count must preserve reviewed and unreviewed rows")
	if not any(row.get("difference") == -1 for row in count_rows) or not any(
		row.get("difference") == 1 for row in count_rows
	):
		raise AssertionError("Native sample count must include positive and negative adjustments")
	if not any(row.get("review_state") == "Reviewed" and row.get("difference") == 0 for row in count_rows):
		raise AssertionError("Native sample count must include a reviewed matching row")
	from temple_inventory import browse

	dashboard_inventory = browse.dashboard_card("inventory")
	page = browse.inventory_page()
	if dashboard_inventory["item_count"] != page["matched_count"]:
		raise AssertionError("Dashboard and browse inventory item counts differ")
	if dashboard_inventory["totals"] != page["summary"]:
		raise AssertionError("Dashboard and browse inventory totals differ")
	expiry = browse.dashboard_card("expiry")
	if len(expiry["buckets"]) != 6:
		raise AssertionError("Dashboard expiry buckets are incomplete")
	expiry_rows = []
	expiry_start = 0
	while True:
		expiry_page = browse.expiry_page({"dataset": "expiry"}, start=expiry_start, page_length=100)
		expiry_rows.extend(expiry_page["rows"])
		if expiry_page["next_start"] is None:
			break
		expiry_start = expiry_page["next_start"]
	expected_buckets = {
		key: set()
		for key in (
			"expired_1_30",
			"expired_31_90",
			"expired_91_plus",
			"upcoming_0_30",
			"upcoming_31_90",
			"upcoming_91_plus",
		)
	}
	for row in expiry_rows:
		days = row["remaining_days"]
		if days is None or row["available"] <= 0:
			continue
		key = (
			"expired_1_30"
			if -30 <= days < 0
			else "expired_31_90"
			if -90 <= days < -30
			else "expired_91_plus"
			if days < -90
			else "upcoming_0_30"
			if days <= 30
			else "upcoming_31_90"
			if days <= 90
			else "upcoming_91_plus"
		)
		expected_buckets[key].add((row["item_code"], row["batch_no"]))
	if {row["id"]: row["count"] for row in expiry["buckets"]} != {
		key: len(values) for key, values in expected_buckets.items()
	}:
		raise AssertionError("Dashboard expiry buckets differ from the complete expiry browse")
	media = sample_media.inventory()
	if media["public_files"]:
		raise AssertionError("Obsolete public sample media remains")
	return {
		"site": frappe.local.site,
		"version": VERSION,
		"items": len(codes),
		"media": media,
		"balances_verified": True,
		"dashboard_inventory_verified": True,
		"dashboard_expiry_verified": True,
		"count_review_verified": True,
		"count_review_rows": len(count_rows),
		"costume_source_rows": len(costumes),
		"costume_images": sum(len(row["images"]) for row in costumes),
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
