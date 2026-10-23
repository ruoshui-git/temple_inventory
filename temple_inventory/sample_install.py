"""Foreground installer for the Temple Inventory development sample dataset."""

# ruff: noqa: RUF001 — Chinese sample setup messages are intentional.

import sys
import traceback
from datetime import timedelta
from pathlib import Path

import frappe
from frappe.utils import cint, getdate, nowdate

VERSION = "2026.10.native-location-model-v8"

DEFAULT_SAMPLE_ITEM_GROUPS = ("Consumable", "Products", "Raw Material", "Services", "Sub Assemblies")
DEFAULT_SAMPLE_WAREHOUSES = (
	"All Warehouses",
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

	defaults = set()
	for row in frappe.get_all(
		"Warehouse",
		filters={"company": company, "warehouse_name": ["in", DEFAULT_SAMPLE_WAREHOUSES]},
		fields=["name", "warehouse_name", "lft", "rgt"],
	):
		defaults.add(row.name)
		if row.warehouse_name == "All Warehouses":
			defaults.update(
				frappe.get_all(
					"Warehouse",
					filters={"company": company, "lft": [">=", row.lft], "rgt": ["<=", row.rgt]},
					pluck="name",
				)
			)
	if not defaults:
		return
	for doctype in ("Company", "Stock Settings"):
		if not frappe.db.exists("DocType", doctype):
			continue
		for field in frappe.get_meta(doctype).fields:
			if field.fieldtype != "Link" or field.options != "Warehouse":
				continue
			docname = company if doctype == "Company" else doctype
			if frappe.db.get_value(doctype, docname, field.fieldname) in defaults:
				frappe.db.set_value(doctype, docname, field.fieldname, None, update_modified=False)
	for name in sorted(
		defaults, key=lambda value: frappe.db.get_value("Warehouse", value, "lft") or 0, reverse=True
	):
		if frappe.db.exists("Stock Ledger Entry", {"warehouse": name}) or frappe.db.exists(
			"Bin", {"warehouse": name, "actual_qty": ["!=", 0]}
		):
			frappe.throw(f"无法删除默认仓库 {name}：已有库存")
		frappe.delete_doc("Warehouse", name, ignore_permissions=True, force=True)


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


def install_sample_data(company=None, data="full"):
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
		result = install(company, data=data, generate_volume=data == "full")
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


def verify_development_sample(*, require_images=True, data="full"):
	"""Verify native identities, permissions, balance invariants and private media."""
	assert_development_site()
	from temple_inventory import native_samples, sample_media
	from temple_inventory.native_api import _request_key

	settings = _settings()
	if settings.sample_data_status != "Installed" or settings.sample_data_version != VERSION:
		frappe.throw("原生开发样例尚未完整安装")
	for legacy in DEFAULT_SAMPLE_WAREHOUSES:
		if frappe.db.exists("Warehouse", {"company": settings.company, "warehouse_name": legacy}):
			raise AssertionError(f"ERPNext initialized Warehouse remains: {legacy}")
	root = settings.physical_root_warehouse
	root_doc = frappe.get_doc("Warehouse", settings.root_warehouse)
	root_children = frappe.get_all(
		"Warehouse",
		filters={"parent_warehouse": settings.root_warehouse},
		pluck="ti_label",
		order_by="lft asc",
	)
	if root_doc.ti_label != "寺院仓库" or root_children != ["实体库房", "系统位置"]:
		raise AssertionError(f"Configured System roots differ from plan: {root_children!r}")
	if (
		frappe.db.get_value("Warehouse", settings.leased_warehouse, "parent_warehouse")
		!= settings.system_root_warehouse
	):
		raise AssertionError("借出 must be below 系统位置")
	if (
		frappe.db.get_value("Warehouse", settings.damaged_warehouse, "parent_warehouse")
		!= settings.system_root_warehouse
	):
		raise AssertionError("损坏待处理 must be below 系统位置")
	physical_rows = frappe.get_all(
		"Warehouse",
		filters={
			"company": settings.company,
			"lft": [">=", frappe.db.get_value("Warehouse", root, "lft")],
			"rgt": ["<=", frappe.db.get_value("Warehouse", root, "rgt")],
		},
		fields=[
			"name",
			"warehouse_name",
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
			"is_group",
			"warehouse_type",
			"parent_warehouse",
		],
		order_by="lft asc",
	)
	actual_tree = [
		(
			row.ti_label,
			row.ti_short_label or "",
			bool(row.ti_direct_storage),
			bool(row.is_group),
			row.warehouse_type,
			frappe.db.get_value("Warehouse", row.parent_warehouse, "ti_label"),
		)
		for row in physical_rows
		if row.name != root
	]
	required_locations = {
		("第1寺院", "T1"),
		("106", ""),
		("201", ""),
		("第2寺院", "T2"),
		("货架1", "S1"),
		("货架2", "S2"),
		("临时存放", "TMP"),
	}
	if not required_locations.issubset({(row[0], row[1]) for row in actual_tree}):
		raise AssertionError(f"Native sample location tree differs from plan: {actual_tree!r}")
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
	known_names = {name for row in sample_media.catalog()["items"] for name in row["legacy_names"]}
	known_names.update(row[1] for row in native_samples.EXTRA_ITEMS)
	general_codes = frappe.get_all("Item", filters={"item_name": ["in", sorted(known_names)]}, pluck="name")
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
	codes = [*general_codes, *costume_codes]
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
		room = frappe.db.get_value("Warehouse", {"parent_warehouse": root, "ti_label": "第2寺院"}, "name")
		room = frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_label": "A02"}, "name")
		warehouse = frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name"
		)
		if native_samples.get_stock_balance(code, warehouse) != source["quantity"]:
			raise AssertionError(f"Costume opening quantity differs from source for {source['source_code']}")
		attachments = frappe.db.count("File", {"attached_to_doctype": "Item", "attached_to_name": code})
		if require_images and attachments != len(source["images"]):
			raise AssertionError(f"Costume image attachments are incomplete for {source['source_code']}")
	if data == "real":
		return {
			"items": len(costume_codes),
			"costume_items": len(costume_codes),
			"costume_stock_verified": True,
			"warehouse_tree": [dict(row) for row in physical_rows],
			"real_data_only": True,
		}
	if frappe.db.count("Item") < 600:
		raise AssertionError("Full seed must contain the real catalog and at least 436 generated Items")
	if frappe.db.count("Stock Entry", {"docstatus": 1}) < 1500:
		raise AssertionError("Full seed must contain at least 1,500 submitted native movements")
	if frappe.db.sql("select name from `tabStock Entry` where coalesce(ti_movement_kind, '')='' limit 1"):
		raise AssertionError("Every sample Stock Entry must have a native movement kind")
	if (
		frappe.db.count("Stock Reconciliation", {"docstatus": 1}) < 18
		or frappe.db.count("Stock Reconciliation", {"docstatus": 0}) < 2
	):
		raise AssertionError("Full seed must contain 18 submitted counts and two count drafts")
	if frappe.db.count("Stock Entry", {"docstatus": 2}) < 10:
		raise AssertionError("Full seed must contain ten cancelled typed movements")
	if len(frappe.db.sql("select name from `tabStock Entry` where amended_from is not null limit 4")) < 4:
		raise AssertionError("Full seed must contain four native amendments")
	if frappe.db.count("User", {"user_type": "System User", "enabled": 1}) < 6:
		raise AssertionError("Full seed must contain five acting test users")
	t2 = frappe.db.get_value("Warehouse", {"parent_warehouse": root, "ti_label": "第2寺院"}, "name")
	room_a = frappe.db.get_value("Warehouse", {"parent_warehouse": t2, "ti_label": "A02"}, "name")
	shelf = frappe.db.get_value("Warehouse", {"parent_warehouse": room_a, "ti_label": "货架1"}, "name")
	rooms = {
		"DEMO_A": frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room_a, "ti_direct_storage": 1}, "name"
		),
		"DEMO_SHELF": shelf,
		"LEASE": settings.leased_warehouse,
		"DAMAGED": settings.damaged_warehouse,
	}
	loans = [
		frappe.get_doc(
			"Stock Entry",
			{"ti_request_key": _request_key("Stock Entry", native_samples.REQUEST_PREFIX + key)},
		)
		for key in ("loan-first", "loan-second", "loan-untouched", "loan-fully-settled")
	]
	workflow_item = frappe.db.get_value("Item", {"item_name": "活动周转箱"}, "name")
	native_samples.assert_balances(rooms, loans, {"N-WORKFLOW": {"item_code": workflow_item}})
	reconciliation = frappe.get_doc(
		"Stock Reconciliation",
		{"ti_request_key": _request_key("Stock Reconciliation", native_samples.REQUEST_PREFIX + "count")},
	)
	count_warehouses = frappe.parse_json(reconciliation.ti_count_warehouses or "[]")
	if set(count_warehouses) != {rooms["DEMO_A"], rooms["DEMO_SHELF"]}:
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
	warehouse_tree = frappe.get_all(
		"Warehouse",
		filters={
			"company": settings.company,
			"lft": [">=", frappe.db.get_value("Warehouse", settings.root_warehouse, "lft")],
			"rgt": ["<=", frappe.db.get_value("Warehouse", settings.root_warehouse, "rgt")],
		},
		fields=[
			"name",
			"warehouse_name",
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
			"is_group",
			"warehouse_type",
			"parent_warehouse",
		],
		order_by="lft asc",
	)
	warehouse_names = set(frappe.get_all("Warehouse", filters={"company": settings.company}, pluck="name"))
	for doctype, docname in (("Company", settings.company), ("Stock Settings", "Stock Settings")):
		for field in frappe.get_meta(doctype).fields:
			if field.fieldtype == "Link" and field.options == "Warehouse":
				if frappe.db.get_value(doctype, docname, field.fieldname) in warehouse_names:
					raise AssertionError(f"{doctype}.{field.fieldname} still points at a Warehouse")
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
		"warehouse_tree": [dict(row) for row in warehouse_tree],
	}


def development_seed_counts():
	"""Summarize the installed development dataset for reset validation output."""
	assert_development_site()
	return {
		"items": frappe.db.count("Item"),
		"stock_entries": frappe.db.sql(
			"""select coalesce(ti_movement_kind, '') as kind, docstatus, count(*) as count
			from `tabStock Entry` group by ti_movement_kind, docstatus
			order by kind, docstatus""",
			as_dict=True,
		),
		"reconciliations": frappe.db.sql(
			"select docstatus, count(*) as count from `tabStock Reconciliation` group by docstatus order by docstatus",
			as_dict=True,
		),
		"warehouses": frappe.db.count("Warehouse"),
		"uoms_used": frappe.db.sql(
			"""select stock_uom as uom, count(*) as item_count from `tabItem` where is_stock_item=1
			group by stock_uom order by stock_uom""",
			as_dict=True,
		),
		"users": frappe.db.get_all(
			"User",
			filters={"user_type": "System User", "enabled": 1},
			fields=["name", "first_name", "email"],
			order_by="name asc",
		),
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
	data="full",
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

	result = install_sample_data(company=company, data=data)
	_progress(f"最终验证：完成（{result['transactions']} 个样例事务）")
	return result
