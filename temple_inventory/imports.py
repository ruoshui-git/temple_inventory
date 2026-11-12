"""Small native Item import flow: parse, plan, commit and report over shared import records."""

# ruff: noqa: RUF001

import hashlib
import io
import json
import re
import zipfile
from collections import Counter
from contextvars import ContextVar

import frappe
import openpyxl
import xlsxwriter
from frappe.utils import cint

from temple_inventory import catalog, read_cache
from temple_inventory.item_code import allocate_item_code
from temple_inventory.native_access import require_app, retry_native_job, retry_native_request

DOCTYPE = "Inventory Import"
service_write = ContextVar("inventory_import_service_write", default=False)
HEADERS = [
	"物品编号",
	"导入参考号",
	"物品名称*",
	"类别",
	"库存单位*",
	"说明",
	"条码",
	"追踪方式",
	"记录效期",
	"编号规则",
]
FIELD_MAP = dict(
	zip(
		HEADERS,
		(
			"item_code",
			"ti_import_ref",
			"item_name",
			"item_group",
			"stock_uom",
			"description",
			"barcode",
			"tracking",
			"has_expiry_date",
			"serial_no_series",
		),
		strict=True,
	)
)
MAX_FILE = 5 * 1024 * 1024
MAX_ROWS = 5000
MAX_UNPACKED = 100 * 1024 * 1024


def _require_manager():
	require_app()
	if not frappe.has_permission(DOCTYPE, "create"):
		frappe.throw("无权使用物品导入", frappe.PermissionError)


def _require_write():
	_require_manager()
	if not frappe.has_permission(DOCTYPE, "write"):
		frappe.throw("无权修改导入请求", frappe.PermissionError)


def _require_opening_create():
	_require_manager()
	frappe.has_permission("Stock Reconciliation", "create", throw=True)


def _require_import_doc(doc):
	if doc.import_type == "Opening Stock":
		_require_opening_create()


def _save(doc):
	token = service_write.set(True)
	try:
		doc.save(ignore_permissions=True)
	finally:
		service_write.reset(token)


def _get(name, lock=False):
	doc = frappe.get_doc(DOCTYPE, name, for_update=lock)
	doc.check_permission("read")
	return doc


def _opening_request_document(name):
	key = hashlib.sha256(name.encode()).hexdigest()
	return frappe.db.get_value("Stock Reconciliation", {"ti_request_key": key}, "name")


def _safe_text(value):
	return "" if value is None else str(value).strip()


def _serial_values(value):
	if isinstance(value, (list, tuple)):
		return [str(entry).strip() for entry in value if str(entry).strip()]
	return [entry.strip() for entry in re.split(r"[,，;；\n\r]+", str(value or "")) if entry.strip()]


def _workbook(raw, filename):
	if not filename.lower().endswith(".xlsx") or filename.lower().endswith(".xlsm"):
		frappe.throw("请上传 .xlsx 文件")
	if len(raw) > MAX_FILE:
		frappe.throw("文件不能超过 5 MB")
	try:
		with zipfile.ZipFile(io.BytesIO(raw)) as archive:
			if sum(entry.file_size for entry in archive.infolist()) > MAX_UNPACKED:
				frappe.throw("工作簿解压后不能超过 100 MB")
			if any("vbaproject" in entry.filename.lower() for entry in archive.infolist()):
				frappe.throw("不支持包含宏的工作簿")
			if "[Content_Types].xml" in archive.namelist() and b"macroEnabled" in archive.read(
				"[Content_Types].xml"
			):
				frappe.throw("不支持包含宏的工作簿")
		wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=False)
	except frappe.ValidationError:
		raise
	except Exception:
		frappe.throw("无法读取工作簿，请检查文件格式")
	if "物品导入" not in wb.sheetnames:
		frappe.throw("工作簿缺少“物品导入”工作表")
	ws = wb["物品导入"]
	headers = [_safe_text(cell.value) for cell in next(ws.iter_rows(min_row=1, max_row=1), [])]
	if headers != HEADERS:
		frappe.throw("“物品导入”工作表的列标题不正确，请使用最新模板")
	rows = []
	for idx, cells in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
		values = [_safe_text(cells[i] if i < len(cells) else None) for i in range(len(HEADERS))]
		if not any(values):
			continue
		rows.append({"row": idx, **{field: values[i] for i, field in enumerate(FIELD_MAP.values())}})
		if len(rows) > MAX_ROWS:
			frappe.throw("最多导入 5,000 行物品")
	return rows


OPENING_HEADERS = ["物品编号*", "位置*", "数量*", "估值单价", "批次编号", "生产日期", "到期日期", "序列号"]


def _opening_workbook(raw, filename):
	if not filename.lower().endswith(".xlsx") or filename.lower().endswith(".xlsm"):
		frappe.throw("请上传 .xlsx 文件")
	if len(raw) > MAX_FILE:
		frappe.throw("文件不能超过 5 MB")
	try:
		wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=False)
	except Exception:
		frappe.throw("无法读取工作簿，请检查文件格式")
	if "期初库存" not in wb.sheetnames:
		frappe.throw("工作簿缺少“期初库存”工作表")
	ws = wb["期初库存"]
	headers = [_safe_text(cell.value) for cell in next(ws.iter_rows(min_row=1, max_row=1), [])]
	if headers != OPENING_HEADERS:
		frappe.throw("“期初库存”工作表的列标题不正确，请使用最新模板")
	keys = (
		"item_code",
		"location",
		"qty",
		"valuation_rate",
		"batch_no",
		"manufacturing_date",
		"expiry_date",
		"serial_no",
	)
	rows = []
	for index, cells in enumerate(ws.iter_rows(min_row=2, values_only=True), 2):
		values = [cells[i] if i < len(cells) else None for i in range(len(OPENING_HEADERS))]
		if not any(_safe_text(value) for value in values):
			continue
		rows.append({"row": index, **dict(zip(keys, values, strict=True))})
		if len(rows) > MAX_ROWS:
			frappe.throw("最多导入 5,000 行期初库存")
	return rows


def _opening_context_date(posting_date, posting_time):
	from frappe.utils import get_datetime, getdate, now_datetime

	if not posting_date or not posting_time:
		frappe.throw("请填写期初日期和时间")
	try:
		day = getdate(posting_date)
		datetime_value = get_datetime(f"{day} {posting_time}")
	except Exception:
		frappe.throw("请填写有效的期初日期和时间")
	if datetime_value > now_datetime():
		frappe.throw("期初日期和时间不能晚于当前时间")
	settings = frappe.get_single("Temple Inventory Settings")
	from erpnext.accounts.utils import get_fiscal_year

	try:
		get_fiscal_year(day, company=settings.company)
	except Exception:
		frappe.clear_last_message()
		frappe.throw("期初日期不属于有效财年")
	return str(day), str(posting_time)


def _opening_locations():
	from temple_inventory.native_stock import warehouse_scopes

	_settings, visible, physical, _leased, _damaged = warehouse_scopes()
	rows = _opening_present_locations(visible)
	allowed = [row for row in rows if row.get("name") in physical]
	return allowed


def _opening_present_locations(visible):
	from temple_inventory.native_topology import present_locations

	# User Permissions may return an authorized leaf without its group ancestors.
	# Include only its missing ancestors for canonical path construction; the final
	# location set is still intersected with warehouse_scopes() physical leaves.
	topology = dict(visible)
	for row in tuple(visible.values()):
		parent_name = row.get("parent_warehouse")
		while parent_name and parent_name not in topology:
			parent = frappe.db.get_value(
				"Warehouse",
				parent_name,
				[
					"name",
					"warehouse_name",
					"parent_warehouse",
					"warehouse_type",
					"ti_label",
					"ti_short_label",
					"ti_direct_storage",
					"company",
					"is_group",
					"disabled",
					"lft",
					"rgt",
				],
				as_dict=True,
			)
			if not parent:
				break
			topology[parent.name] = parent
			parent_name = parent.parent_warehouse
	return present_locations(topology)


def _opening_template_rows():
	locations = _opening_locations()
	return [[row.get("label", ""), row.get("path", "")] for row in locations]


@frappe.whitelist()
def opening_template():
	_require_opening_create()
	locations = _opening_locations()
	instructions = [
		[
			"物品编号*",
			"必填",
			"填写已存在的库存物品编号；未知编号会被拒绝，不会创建物品。物品目录下载提供可用编号。",
		],
		["位置*", "必填", "从位置清单选择；可填写清单中的标准位置、路径或原生仓库名。"],
		["数量*", "必填", "必须大于零；序列号物品每个库存单位填写一个序列号。"],
		["估值单价", "选填", "留空时使用现有库存估值、采购价或物品估值；都没有时按零估值。"],
		["批次编号", "按物品要求", "批次物品填写；新批次会在提交时创建。"],
		["生产日期 / 到期日期", "按物品要求", "批次生产日期不能晚于入账日期，到期日期不能早于生产日期。"],
		["序列号", "按物品要求", "每行一个序列号，可用换行或逗号分隔；数量必须与序列号个数一致。"],
		["导入方式", "说明", "一次导入只创建一张期初库存单据；请在上传步骤填写期初日期和时间。"],
	]
	location_rows = [[row.get("label", ""), row.get("path", "")] for row in locations]
	_xlsx_response(
		"template",
		[
			("期初库存", OPENING_HEADERS, []),
			("填写说明", ["列名", "要求", "说明"], instructions),
			(
				"示例",
				OPENING_HEADERS,
				[
					[
						"示例物品编号",
						locations[0].get("label", "") if locations else "",
						"1",
						"",
						"",
						"",
						"",
						"",
					]
				],
			),
			("位置清单", ["位置", "路径"], location_rows),
		],
		"期初库存导入模板.xlsx",
	)


@frappe.whitelist()
def opening_catalog():
	_require_opening_create()
	rows = frappe.get_list(
		"Item", filters={"is_stock_item": 1, "disabled": 0}, fields=["name", "item_name"], limit_page_length=0
	)
	_xlsx_response(
		"catalog",
		[("物品目录", ["物品编号", "物品名称"], [[row.name, row.item_name] for row in rows])],
		"物品目录.xlsx",
	)


def _opening_plan(rows, posting_date, posting_time, *, exclude_name=""):
	from decimal import Decimal

	from temple_inventory.native_stock import number, validate_precision, warehouse_scopes
	from temple_inventory.opening import opening_pair_blockers, set_difference_account

	settings, visible, physical, leased, damaged = warehouse_scopes()
	locations = _opening_present_locations(visible)
	topology = {row["name"]: frappe._dict(row) for row in locations}
	physical_locations = [row for row in locations if row.get("name") in physical]
	disabled_branches = set()
	for name in visible:
		current = visible[name]
		seen = set()
		while current and current.name not in seen:
			if current.disabled:
				disabled_branches.add(name)
				break
			seen.add(current.name)
			current = topology.get(current.parent_warehouse)
	aliases = {}
	for location in locations:
		for label in (
			location.get("label"),
			location.get("path"),
			location.get("name"),
			location.get("native_name"),
		):
			if label:
				aliases.setdefault(_normalize(label), []).append(location)
	# Area and Room aliases route to their hidden direct storage leaf when one exists.
	for location in locations:
		if location.get("kind") in ("room", "shelf") and location.get("is_group"):
			direct = next(
				(candidate for candidate in physical_locations if candidate.get("owner") == location["name"]),
				None,
			)
			if direct:
				for label in (
					location.get("label"),
					location.get("path"),
					location.get("name"),
					location.get("native_name"),
				):
					if label:
						key = _normalize(label)
						aliases[key] = [
							candidate
							for candidate in aliases.get(key, [])
							if candidate.get("name") != location["name"]
						]
						aliases.setdefault(key, []).append(direct)
	items = frappe.get_all(
		"Item",
		fields=[
			"name",
			"item_name",
			"disabled",
			"is_stock_item",
			"stock_uom",
			"valuation_rate",
			"has_batch_no",
			"has_serial_no",
			"has_expiry_date",
		],
		filters={"name": ["in", sorted({str(row.get("item_code") or "").strip() for row in rows}) or [""]]},
		limit_page_length=0,
	)
	item_by_code = {item.name: item for item in items}
	uoms = frappe.get_all(
		"UOM",
		filters={"name": ["in", sorted({item.stock_uom for item in items}) or [""]]},
		fields=["name", "must_be_whole_number"],
		limit_page_length=0,
	)
	whole_number_uoms = {uom.name: bool(uom.must_be_whole_number) for uom in uoms}
	quantity_precision = frappe.get_precision("Stock Reconciliation Item", "qty")
	batch_names = sorted({str(row.get("batch_no") or "").strip() for row in rows if row.get("batch_no")})
	batches = frappe.get_all(
		"Batch",
		filters={"name": ["in", batch_names or [""]]},
		fields=["name", "item", "disabled", "manufacturing_date", "expiry_date"],
		limit_page_length=0,
	)
	batch_by_name = {batch.name: batch for batch in batches}
	all_serials = sorted({serial for row in rows for serial in _serial_values(row.get("serial_no"))})
	serial_docs = frappe.get_all(
		"Serial No",
		filters={"name": ["in", all_serials or [""]]},
		fields=["name", "item_code", "warehouse", "status"],
		limit_page_length=0,
	)
	serial_by_name = {serial.name: serial for serial in serial_docs}
	resolved_by_row = {}
	for row in rows:
		matches = aliases.get(_normalize(row.get("location")), [])
		unique = {item["name"]: item for item in matches}
		resolved_by_row[row["row"]] = list(unique.values())
	pairs = []
	for row in rows:
		item = str(row.get("item_code") or "").strip()
		matches = resolved_by_row[row["row"]]
		if item and item in item_by_code and len(matches) == 1:
			pairs.append((item, matches[0]["name"]))
	blockers = opening_pair_blockers(pairs, exclude_name=exclude_name, include_drafts=True)
	stock_rates = {}
	if pairs:
		for balance in frappe.db.sql(
			"""select item_code, warehouse, valuation_rate from (
			select item_code, warehouse, valuation_rate,
			row_number() over (partition by item_code, warehouse order by posting_datetime desc, creation desc, name desc) as rn
			from `tabStock Ledger Entry` where is_cancelled = 0 and docstatus = 1
			and posting_datetime <= %(posting)s and (item_code, warehouse) in %(pairs)s
			) latest where rn = 1""",
			{"posting": f"{posting_date} {posting_time}", "pairs": tuple(pairs)},
			as_dict=True,
		):
			stock_rates[(balance.item_code, balance.warehouse)] = balance.valuation_rate or 0
	currency = frappe.get_cached_value("Company", settings.company, "default_currency")
	item_prices = frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", sorted(item_by_code) or [""]], "buying": 1, "currency": currency},
		fields=["item_code", "price_list_rate"],
		order_by="modified desc",
		limit_page_length=0,
	)
	price_by_item = {}
	for price in item_prices:
		price_by_item.setdefault(price.item_code, price.price_list_rate or 0)
	opening_parent_rows = frappe.db.sql(
		"""select distinct ri.parent from `tabStock Reconciliation Item` ri
		inner join `tabStock Reconciliation` sr on sr.name = ri.parent
		where sr.docstatus = 1 and sr.purpose = 'Opening Stock' and (ri.item_code, ri.warehouse) in %(pairs)s""",
		{"pairs": tuple(pairs) or (("", ""),)},
		as_dict=True,
	)
	opening_names = sorted({row.parent for row in opening_parent_rows})
	existing_openings = frappe.get_all(
		"Stock Reconciliation Item",
		filters={
			"parent": ["in", opening_names or [""]],
			"item_code": ["in", sorted({pair[0] for pair in pairs}) or [""]],
		},
		fields=["parent", "item_code", "warehouse", "qty", "valuation_rate", "batch_no", "serial_no"],
		limit_page_length=0,
	)
	opening_by_pair = {}
	for candidate in existing_openings:
		opening_by_pair.setdefault((candidate.item_code, candidate.warehouse), []).append(candidate)
	settings_company = settings.company
	try:
		probe = frappe.new_doc("Stock Reconciliation")
		probe.company = settings_company
		probe.purpose = "Opening Stock"
		set_difference_account(probe)
		temporary_account_error = ""
	except frappe.ValidationError as exc:
		frappe.clear_last_message()
		temporary_account_error = str(exc)
	perpetual_error = ""
	warehouse_accounts = {}
	try:
		import erpnext

		if erpnext.is_perpetual_inventory_enabled(settings_company):
			from erpnext.stock import get_warehouse_account_map

			warehouse_accounts = get_warehouse_account_map(settings_company)
			if not frappe.get_cached_value("Company", settings_company, "cost_center"):
				perpetual_error = "启用永续盘存时，公司必须设置默认成本中心"
			elif (
				probe.expense_account
				and frappe.db.get_value("Account", probe.expense_account, "report_type") == "Profit and Loss"
			):
				perpetual_error = "期初库存差额科目必须是资产或负债科目"
	except Exception as exc:
		frappe.clear_last_message()
		perpetual_error = f"永续盘存配置不完整：{exc}"
	try:
		from erpnext.accounts.doctype.accounting_period.accounting_period import (
			validate_accounting_period_on_doc_save,
		)

		period_probe = frappe.new_doc("Stock Reconciliation")
		period_probe.company = settings_company
		period_probe.posting_date = posting_date
		validate_accounting_period_on_doc_save(period_probe)
		period_error = ""
	except frappe.ValidationError as exc:
		frappe.clear_last_message()
		period_error = str(exc)
	planned = []
	seen_pair_batch = {}
	seen_serials = {}
	for row in rows:
		line = dict(row)
		errors, warnings = [], []
		code = str(row.get("item_code") or "").strip()
		item = item_by_code.get(code)
		location_matches = resolved_by_row[row["row"]]
		location = location_matches[0] if len(location_matches) == 1 else None
		if not code:
			errors.append("请填写物品编号")
		elif not item:
			errors.append("找不到此物品编号；物品不会由期初库存导入创建")
		elif item.disabled:
			errors.append("物品已停用")
		elif not item.is_stock_item:
			errors.append("此物品不是库存物品")
		if not location:
			errors.append("位置不存在或名称不唯一")
		elif location.get("is_group"):
			errors.append("不能选择分组位置，请选择实体末级位置")
		elif location.get("disabled") or location.get("name") in disabled_branches:
			errors.append("位置或其上级已停用")
		elif location.get("name") in leased:
			errors.append("借出位置不能录入期初库存")
		elif location.get("name") in damaged:
			errors.append("损坏位置不能录入期初库存")
		elif location.get("name") not in physical:
			errors.append("位置不是此账户有权限的实体末级位置")
		elif not location.get("storable"):
			errors.append("位置必须是启用的实体末级位置")
		qty_text = _safe_text(row.get("qty"))
		try:
			qty = number(qty_text, "期初库存数量", allow_zero=True)
			if qty <= 0:
				errors.append("期初库存数量必须大于零")
			else:
				validate_precision(qty, quantity_precision, "期初库存数量")
		except frappe.ValidationError as exc:
			qty = Decimal(0)
			errors.append(str(exc))
		rate_text = _safe_text(row.get("valuation_rate"))
		try:
			rate = (
				number(rate_text, "估值单价", allow_zero=True)
				if rate_text
				else Decimal(
					str(stock_rates.get((item.name, location["name"]), 0) if item and location else 0)
				)
			)
			if not rate_text and not rate:
				rate = Decimal(str(price_by_item.get(item.name, 0) if item else 0))
			if not rate_text and not rate:
				rate = Decimal(str((item.valuation_rate or 0) if item else 0))
			rate = number(rate, "估值单价", allow_zero=True)
		except frappe.ValidationError as exc:
			rate = Decimal(0)
			errors.append(str(exc))
		batch_no = _safe_text(row.get("batch_no"))
		serials = _serial_values(row.get("serial_no"))
		if item:
			if item.has_batch_no and item.has_serial_no:
				errors.append("物品不能同时按批次和序列号追踪")
			if item.has_batch_no and not batch_no:
				errors.append("追踪批次的物品必须填写批次编号")
			if not item.has_batch_no and batch_no:
				errors.append("此物品未启用批次管理")
			if item.has_serial_no and not serials:
				errors.append("追踪序列号的物品必须填写序列号")
			if not item.has_serial_no and serials:
				errors.append("此物品未启用序列号管理")
			if item.has_serial_no and (qty % 1 or len(serials) != qty):
				errors.append("序列号数量必须与整数库存数量一致")
			if not item.has_serial_no and not whole_number_uoms.get(item.stock_uom) and qty % 1:
				errors.append("此物品的库存单位只能使用整数数量")
			if item.has_expiry_date and batch_no and not _safe_text(row.get("expiry_date")):
				errors.append("物品记录效期，批次必须填写到期日期")
		batch = batch_by_name.get(batch_no)
		manufacturing_date = _safe_text(row.get("manufacturing_date"))
		expiry_date = _safe_text(row.get("expiry_date"))
		if manufacturing_date and expiry_date and manufacturing_date[:10] > expiry_date[:10]:
			errors.append("到期日期不能早于生产日期")
		if manufacturing_date and manufacturing_date[:10] > str(posting_date)[:10]:
			errors.append("生产日期不能晚于入账日期")
		if batch and item and batch.item != item.name:
			errors.append(f"批次 {batch_no} 属于其它物品")
		if batch and batch.disabled:
			errors.append(f"批次 {batch_no} 已停用")
		if batch:
			for field, key in (("manufacturing_date", "manufacturing_date"), ("expiry_date", "expiry_date")):
				requested = _safe_text(row.get(key))
				if requested and str(batch.get(field) or "") != requested[:10]:
					errors.append(f"批次 {batch_no} 的日期与输入不一致")
		if item and location:
			key = (item.name, location["name"], batch_no)
			if key in seen_pair_batch:
				errors.append(f"与第 {seen_pair_batch[key]} 行重复物品、位置和批次")
			else:
				seen_pair_batch[key] = row["row"]
		for serial in serials:
			if serial in seen_serials:
				errors.append(f"序列号 {serial} 在第 {seen_serials[serial]} 行重复")
			else:
				seen_serials[serial] = row["row"]
			serial_doc = serial_by_name.get(serial)
			if serial_doc and (serial_doc.warehouse or (item and serial_doc.item_code != item.name)):
				errors.append(f"序列号 {serial} 已在库存或属于其它物品")
		if temporary_account_error:
			errors.append(temporary_account_error)
		if period_error:
			errors.append(period_error)
		if perpetual_error:
			errors.append(perpetual_error)
		if item and location and warehouse_accounts and not warehouse_accounts.get(location["name"]):
			errors.append("永续盘存配置不完整：此位置未配置库存科目")
		if not rate_text and not rate:
			warnings.append("估值单价留空；若无现有估值，将按零估值记录")
		if batch_no and not batch:
			warnings.append("提交时创建批次")
			if not frappe.has_permission("Batch", "create"):
				errors.append("当前账户无权创建批次")
		blocker = blockers.get((item.name, location["name"])) if item and location else None
		unchanged = False
		old_rows = opening_by_pair.get((item.name, location["name"]), []) if item and location else []
		identical = False
		old = next(
			(
				candidate
				for candidate in old_rows
				if Decimal(str(candidate.qty or 0)) == qty
				and Decimal(str(candidate.valuation_rate or 0)) == rate
				and (candidate.batch_no or "") == batch_no
				and set(_serial_values(candidate.serial_no)) == set(serials)
			),
			None,
		)
		identical = old is not None
		line_existing_document = old.parent if identical else ""
		if blocker and identical and not errors:
			unchanged = True
		elif blocker and blocker.block_type == "draft":
			errors.append(f"该物品和位置已被草稿期初库存占用（{blocker.blocker}）")
		elif blocker:
			errors.append(f"该物品和位置已有库存流水或期初库存（{blocker.blocker}）")
		line.update(
			item_name=item.item_name if item else "",
			resolved_item=code if item else "",
			location_label=location.get("label", "") if location else "",
			warehouse=location.get("name", "") if location else "",
			qty=float(qty),
			valuation_rate=float(rate),
			line_value=float(qty * rate),
			batch_no=batch_no,
			serials=serials,
		)
		planned.append(
			{
				"row": row["row"],
				"action": "REJECTED" if errors else "UNCHANGED" if unchanged else "NEW",
				"item_code": code,
				"item_name": item.item_name if item else "",
				"stock_uom": item.stock_uom if item else "",
				"location_label": location.get("label", "") if location else "",
				"warehouse": location.get("name", "") if location else "",
				"existing_document": line_existing_document,
				"qty": float(qty),
				"valuation_rate": float(rate),
				"line_value": float(qty * rate),
				"batch_no": batch_no,
				"serials": serials,
				"errors": errors,
				"warnings": warnings,
				"values": {
					"item_code": code,
					"location": _safe_text(row.get("location")),
					"qty": str(qty),
					"valuation_rate": str(rate),
					"batch_no": batch_no,
					"manufacturing_date": _safe_text(row.get("manufacturing_date")),
					"expiry_date": _safe_text(row.get("expiry_date")),
					"serial_no": "\n".join(serials),
				},
			}
		)
	# Match an already submitted opening exactly; otherwise blockers above remain rejections.
	payload = [
		{
			key: row.get(key)
			for key in (
				"row",
				"action",
				"item_code",
				"item_name",
				"stock_uom",
				"warehouse",
				"location_label",
				"qty",
				"valuation_rate",
				"line_value",
				"batch_no",
				"serials",
				"errors",
				"values",
			)
		}
		for row in planned
	]
	return planned, hashlib.sha256(
		json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
	).hexdigest()


def _normalize(value):
	return " ".join(_safe_text(value).split()).casefold()


def _fingerprint(row):
	payload = "\x1f".join(
		_normalize(row.get(field)) for field in ("item_name", "item_group", "stock_uom", "description")
	)
	return hashlib.sha256(payload.encode()).hexdigest()


def _barcodes(value):
	"""One cell may hold several barcodes, so a catalog export round-trips."""
	return [code for code in re.split(r"[；;,，\s]+", _safe_text(value)) if code]


def _truth(value):
	if value in ("", None):
		return None
	if str(value).strip() in ("是", "1", "true", "True", "是（启用）"):
		return 1
	if str(value).strip() in ("否", "0", "false", "False"):
		return 0
	return -1


def _lookup():
	root = catalog.item_group_root()
	groups = frappe.get_list(
		"Item Group", fields=["name", "item_group_name", "parent_item_group", "is_group"], limit_page_length=0
	)
	categories = {}
	category_labels = {group.name: "" if group.name == root else group.item_group_name for group in groups}
	group_by_name = {group.name: group for group in groups}
	for group in groups:
		if group.name == root:
			continue
		for label in {group.item_group_name, group.name}:
			if label:
				matches = categories.setdefault(_normalize(label), [])
				if group.name not in matches:
					matches.append(group.name)
	uoms = frappe.get_list(
		"UOM", fields=["name", "uom_name", "ti_label", "enabled", "must_be_whole_number"], limit_page_length=0
	)
	unit_map = {}
	unit_by_name = {uom.name: uom for uom in uoms}
	unit_labels = {uom.name: uom.get("ti_label") or uom.name for uom in uoms}
	for uom in uoms:
		for label in {uom.get("ti_label"), uom.name}:
			if label:
				matches = unit_map.setdefault(_normalize(label), [])
				if all(match.name != uom.name for match in matches):
					matches.append(uom)
	items = frappe.get_list(
		"Item",
		fields=[
			"name",
			"item_name",
			"item_group",
			"stock_uom",
			"description",
			"ti_import_ref",
			"modified",
			"disabled",
			"image",
			"has_batch_no",
			"has_serial_no",
			"has_expiry_date",
			"serial_no_series",
		],
		limit_page_length=0,
	)
	by_code = {item.name: item for item in items}
	items_by_normalized_name = {}
	for item in items:
		items_by_normalized_name.setdefault(_normalize(item.item_name), []).append(item.name)
	by_ref = {item.ti_import_ref: item for item in items if item.ti_import_ref}
	barcode_rows = frappe.get_all("Item Barcode", fields=["barcode", "parent"], limit_page_length=0)
	barcodes_by_item = {}
	for entry in barcode_rows:
		barcodes_by_item.setdefault(entry.parent, set()).add(entry.barcode)
	barcode_owner = {row.barcode: row.parent for row in barcode_rows}
	return (
		root,
		categories,
		category_labels,
		group_by_name,
		unit_map,
		unit_by_name,
		unit_labels,
		by_code,
		by_ref,
		barcode_owner,
		barcodes_by_item,
		items_by_normalized_name,
	)


def _plan(rows):
	(
		root,
		categories,
		category_labels,
		group_by_name,
		unit_map,
		unit_by_name,
		unit_labels,
		by_code,
		by_ref,
		barcode_owner,
		barcodes_by_item,
		items_by_normalized_name,
	) = _lookup()
	keys = []
	for row in rows:
		code, ref = row.get("item_code", ""), row.get("ti_import_ref", "")
		keys.append(("code", code) if code else (("ref", ref) if ref else ("fingerprint", _fingerprint(row))))
	key_counts = Counter(keys)
	first = {}
	barcode_rows = {}
	for row in rows:
		for barcode in _barcodes(row.get("barcode")):
			barcode_rows.setdefault(barcode, []).append(row["row"])
	planned = []
	for row in rows:
		line = dict(row)
		errors, warnings = [], []
		code, ref = line.get("item_code", ""), line.get("ti_import_ref", "")
		fingerprint = _fingerprint(line) if not ref else ""
		identity_ref = ref or fingerprint
		duplicate_key = ("code", code) if code else (("ref", ref) if ref else ("fingerprint", fingerprint))
		first.setdefault(duplicate_key, line["row"])
		if key_counts[duplicate_key] > 1:
			errors.append(f"与第 {first[duplicate_key]} 行重复")
		target = by_code.get(code) if code else by_ref.get(identity_ref)
		if code and not target:
			errors.append("找不到此物品编号")
		if code and ref and ref in by_ref and by_ref[ref].name != code:
			errors.append("导入参考号已用于其它物品")
		if not code and not target:
			line["_new"] = True
		if line.get("item_name") == "" and not target:
			errors.append("请填写物品名称")
		if line.get("stock_uom"):
			matches = (
				[unit_by_name[line["stock_uom"]]]
				if line["stock_uom"] in unit_by_name
				else unit_map.get(_normalize(line["stock_uom"]), [])
			)
			if len(matches) != 1:
				errors.append("库存单位不存在或名称不唯一")
			elif not matches[0].enabled:
				errors.append("库存单位已停用")
			else:
				line["stock_uom"] = matches[0].name
		elif not target:
			errors.append("请填写库存单位")
		if line.get("item_group"):
			matches = (
				[line["item_group"]]
				if line["item_group"] in group_by_name
				else categories.get(_normalize(line["item_group"]), [])
			)
			if len(matches) != 1:
				errors.append("类别不存在、为根类别或名称不唯一")
			elif group_by_name[matches[0]].is_group and not (target and target.item_group == matches[0]):
				errors.append("类别不存在、为根类别或名称不唯一")
			else:
				line["item_group"] = matches[0]
		elif not target:
			line["item_group"] = root
		tracking = line.get("tracking", "")
		if tracking and tracking not in ("不追踪", "批次", "序列号"):
			errors.append("追踪方式无效")
		expiry = _truth(line.get("has_expiry_date"))
		if expiry == -1:
			errors.append("记录效期请填写是或否")
		if expiry == 1 and tracking == "不追踪":
			errors.append("记录效期需要批次追踪")
		if expiry == 1 and not tracking and not (target and target.has_serial_no):
			# The Item editor turns batch tracking on with expiry; the plan must show it.
			tracking = line["tracking"] = "批次"
		if (
			tracking == "序列号"
			and line.get("stock_uom")
			and not next(
				(
					unit_by_name[line["stock_uom"]].must_be_whole_number
					for _ in [0]
					if line["stock_uom"] in unit_by_name
				),
				0,
			)
		):
			errors.append("序列号物品的库存单位必须是整数单位")
		line["has_expiry_date"] = expiry
		serial_enabled = tracking == "序列号" or (not tracking and bool(target and target.has_serial_no))
		batch_enabled = tracking == "批次" or (not tracking and bool(target and target.has_batch_no))
		if serial_enabled and (batch_enabled or expiry == 1):
			errors.append("序列号与批次追踪不能同时启用")
		for barcode in _barcodes(line.get("barcode")):
			if barcode_owner.get(barcode) not in (None, target.name if target else None):
				errors.append(f"条码 {barcode} 已被其它物品使用")
			if len(barcode_rows[barcode]) > 1:
				errors.append(f"条码 {barcode} 在第 {barcode_rows[barcode][0]} 行也出现")
		if line.get("item_name") and any(
			item_name != (target.name if target else "")
			for item_name in items_by_normalized_name.get(_normalize(line["item_name"]), [])
		):
			warnings.append("另有物品使用相同名称；名称不用于匹配")
		if target:
			try:
				catalog.validate_immutable_item_fields(
					target, {key: value for key, value in line.items() if value not in ("", None)}
				)
			except frappe.ValidationError as exc:
				frappe.clear_last_message()
				errors.append(str(exc))
		if (
			target
			and tracking
			and tracking
			!= ("序列号" if target.has_serial_no else "批次" if target.has_batch_no else "不追踪")
		):
			status = catalog.tracking_change_status(frappe.get_doc("Item", target.name))
			if not status["allowed"]:
				errors.append(status["reason"])
		before = {}
		after = {}
		if target:
			for key in ("item_name", "item_group", "stock_uom", "description"):
				if key == "item_group":
					before[key] = category_labels.get(target.item_group, "")
				elif key == "stock_uom":
					before[key] = unit_labels.get(target.stock_uom, target.stock_uom)
				else:
					before[key] = target.get(key) or ""
				value = line.get(key)
				if key == "item_group" and value:
					value = category_labels.get(value, value)
				elif key == "stock_uom" and value:
					value = unit_labels.get(value, value)
				after[key] = before[key] if line.get(key) in ("", None) else value
			for key in ("tracking", "has_expiry_date", "serial_no_series"):
				before[key] = {
					"tracking": "序列号"
					if target.has_serial_no
					else "批次"
					if target.has_batch_no
					else "不追踪",
					"has_expiry_date": bool(target.has_expiry_date),
					"serial_no_series": target.serial_no_series or "",
				}[key]
				after[key] = before[key] if line.get(key) in ("", None) else line.get(key)
			for key in list(after):
				if line.get(key) in ("", None):
					after[key] = before[key]
			# Import only adds barcodes: a barcode missing from the file is never removed.
			current_barcodes = barcodes_by_item.get(target.name, set())
			before["barcode"] = "；".join(sorted(current_barcodes))
			after["barcode"] = "；".join(sorted(current_barcodes | set(_barcodes(line.get("barcode")))))
		unchanged = target and not errors and all(before.get(k) == after.get(k) for k in after)
		action = "REJECTED" if errors else "UNCHANGED" if unchanged else "UPDATE" if target else "NEW"
		planned.append(
			{
				"row": line["row"],
				"action": action,
				"target": target.name if target else "",
				"modified": str(target.modified) if target else "",
				"errors": errors,
				"warnings": warnings,
				"before": before,
				"after": after,
				"values": {k: v for k, v in line.items() if not k.startswith("_")},
				"identity_ref": identity_ref,
			}
		)
	payload = [{key: row[key] for key in ("action", "target", "modified", "values")} for row in planned]
	return planned, hashlib.sha256(
		json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
	).hexdigest()


def _summary(rows):
	return {
		key.lower(): sum(row["action"] == key for row in rows)
		for key in ("NEW", "UPDATE", "UNCHANGED", "REJECTED")
	}


def _set_counts(doc, rows):
	for key, value in _summary(rows).items():
		setattr(doc, f"{key}_count", value)


def _response(doc):
	rows = json.loads(doc.result_json or doc.preview_json or "[]")
	result = {
		"name": doc.name,
		"status": doc.status,
		"counts": _summary(rows),
		"rows": rows,
		"plan_hash": doc.plan_hash,
		"error": doc.error or "",
	}
	if doc.import_type == "Opening Stock":
		result.update(
			posting_date=str(doc.posting_date or ""),
			posting_time=str(doc.posting_time or ""),
			created_documents=json.loads(doc.created_documents or "[]"),
		)
		from erpnext.stock.doctype.stock_reconciliation.stock_reconciliation import get_difference_account

		result["difference_account"] = (
			get_difference_account("Opening Stock", frappe.get_single("Temple Inventory Settings").company)
			or ""
		)
		result["totals_by_unit"] = {}
		for row in rows:
			if row.get("final_action", row.get("action")) != "NEW":
				continue
			unit = row.get("stock_uom") or row.get("unit") or ""
			if unit:
				from temple_inventory.uom_labels import uom_label

				unit = uom_label(unit)
			if unit:
				result["totals_by_unit"][unit] = result["totals_by_unit"].get(unit, 0) + (row.get("qty") or 0)
		result["total_value"] = sum(
			row.get("line_value") or 0 for row in rows if row.get("final_action", row.get("action")) == "NEW"
		)
	return result


def _xlsx_response(name, sheets, filename):
	output = io.BytesIO()
	workbook = xlsxwriter.Workbook(output, {"in_memory": True})
	locations = next((entry[2] for entry in sheets if entry[0] == "位置清单"), [])
	if locations:
		workbook.define_name("AuthorizedLocations", f"='位置清单'!$A$2:$A${len(locations) + 1}")
	for sheet_name, headers, rows in sheets:
		worksheet = workbook.add_worksheet(sheet_name)
		if sheet_name == "物品导入":
			worksheet.data_validation(
				1, 7, 5000, 7, {"validate": "list", "source": ["不追踪", "批次", "序列号"]}
			)
		for col, value in enumerate(headers):
			worksheet.write_string(0, col, str(value))
		for row_idx, row in enumerate(rows, 1):
			for col, value in enumerate(row):
				worksheet.write_string(row_idx, col, "" if value is None else str(value))
		if sheet_name == "期初库存":
			if locations:
				worksheet.data_validation(
					1, 1, MAX_ROWS, 1, {"validate": "list", "source": "=AuthorizedLocations"}
				)
	workbook.close()
	frappe.response.filename = filename
	frappe.response.filecontent = output.getvalue()
	frappe.response.type = "binary"
	frappe.response.content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@frappe.whitelist()
def item_template():
	_require_manager()
	instructions = [
		[h, "必填" if h in ("物品名称*", "库存单位*") else "选填", desc, allowed]
		for h, desc, allowed in [
			("物品编号", "填写已有物品编号时更新该物品；留空则创建或按参考号匹配。", "已有编号"),
			("导入参考号", "用于再次导入时识别同一物品；留空使用内容指纹。", "任意文本"),
			("物品名称*", "物品名称。", "文本"),
			("类别", "类别显示名称或原生名称；不能填根类别。", "现有类别"),
			("库存单位*", "单位显示标签或原生名称。", "已启用单位"),
			("说明", "物品说明。", "文本"),
			("条码", "物品条码。", "唯一条码"),
			("追踪方式", "选择追踪方式。", "不追踪 / 批次 / 序列号"),
			("记录效期", "是否记录到期日期。", "是 / 否"),
			("编号规则", "序列号编号规则；留空使用默认规则。", "含 # 的规则"),
		]
	]
	_xlsx_response(
		"template",
		[
			("物品导入", HEADERS, []),
			("填写说明", ["列名", "要求", "含义", "允许值"], instructions),
			(
				"示例",
				HEADERS,
				[
					[
						"",
						"DEMO-REF",
						"示例物品",
						"",
						"个",
						"仅供参考，请勿复制到导入表",
						"",
						"不追踪",
						"否",
						"",
					]
				],
			),
		],
		"物品导入模板.xlsx",
	)


@frappe.whitelist(methods=["POST"])
def upload(import_type="Item"):
	_require_manager()
	frappe.has_permission(DOCTYPE, "create", throw=True)
	if import_type not in IMPORT_TYPES:
		frappe.throw("暂不支持此导入类型")
	if import_type == "Opening Stock":
		_require_opening_create()
	uploaded = frappe.request.files.get("file") if getattr(frappe, "request", None) else None
	if not uploaded:
		frappe.throw("请选择 .xlsx 文件")
	posting_date = posting_time = ""
	if import_type == "Opening Stock":
		posting_date, posting_time = _opening_context_date(
			frappe.form_dict.get("posting_date"), frappe.form_dict.get("posting_time")
		)
	raw = uploaded.stream.read(MAX_FILE + 1)
	if len(raw) > MAX_FILE:
		frappe.throw("文件不能超过 5 MB")
	rows = IMPORT_TYPES[import_type]["parse"](raw, uploaded.filename or "")
	if import_type == "Opening Stock":
		planned, plan_hash = IMPORT_TYPES[import_type]["plan"](rows, posting_date, posting_time)
	else:
		planned, plan_hash = IMPORT_TYPES[import_type]["plan"](rows)
	file_doc = frappe.get_doc(
		{"doctype": "File", "file_name": uploaded.filename, "content": raw, "is_private": 1}
	).insert()
	doc = frappe.get_doc(
		{
			"doctype": DOCTYPE,
			"import_type": import_type,
			"status": "Previewed",
			"source_file": file_doc.name,
			"file_sha256": hashlib.sha256(raw).hexdigest(),
			"posting_date": posting_date or None,
			"posting_time": posting_time or None,
			"preview_json": json.dumps(planned, ensure_ascii=False),
			"plan_hash": plan_hash,
		}
	)
	_set_counts(doc, planned)
	_save(doc)
	file_doc = frappe.get_doc("File", file_doc.name)
	file_doc.attached_to_doctype, file_doc.attached_to_name = DOCTYPE, doc.name
	file_doc.save(ignore_permissions=True)
	return _response(doc)


@frappe.whitelist(methods=["POST"])
@retry_native_request
def preview(name):
	_require_write()
	doc = _get(name, lock=True)
	_require_import_doc(doc)
	if doc.status not in ("Previewed", "Conflict", "Failed"):
		return _response(doc)
	was_conflict = doc.status == "Conflict"
	rows = IMPORT_TYPES[doc.import_type]["parse"](
		_read_source(doc), frappe.get_value("File", doc.source_file, "file_name")
	)
	if doc.import_type == "Opening Stock":
		planned, digest = IMPORT_TYPES[doc.import_type]["plan"](
			rows,
			doc.posting_date,
			doc.posting_time,
			exclude_name=_opening_request_document(doc.name) or "",
		)
	else:
		planned, digest = IMPORT_TYPES[doc.import_type]["plan"](rows)
	doc.preview_json, doc.plan_hash = json.dumps(planned, ensure_ascii=False), digest
	_set_counts(doc, planned)
	doc.status, doc.error = "Previewed", ""
	if was_conflict:
		doc.attempt = cint(doc.attempt or 1) + 1
	_save(doc)
	return _response(doc)


@frappe.whitelist(methods=["POST"])
@retry_native_request
def commit(name, plan_hash, skip_rejected=0):
	_require_write()
	doc = _get(name, lock=True)
	_require_import_doc(doc)
	if doc.status != "Previewed":
		return _response(doc)
	if str(plan_hash) != doc.plan_hash:
		frappe.throw("预览已变化，请重新预览", frappe.ValidationError)
	rows = json.loads(doc.preview_json or "[]")
	if any(row["action"] == "REJECTED" for row in rows) and not cint(skip_rejected):
		frappe.throw("请先处理无法导入的行，或明确选择跳过")
	doc.status, doc.skip_rejected = "Queued", cint(skip_rejected)
	_save(doc)
	_enqueue(doc)
	return _response(doc)


def _enqueue(doc):
	frappe.enqueue(
		IMPORT_TYPES[doc.import_type]["commit"],
		import_name=doc.name,
		owner=frappe.session.user,
		queue="long",
		timeout=3600,
		enqueue_after_commit=True,
		job_id=f"ti-import:{doc.name}:{doc.attempt or 1}",
	)


def _read_source(doc):
	file_doc = frappe.get_doc("File", doc.source_file)
	file_doc.check_permission("read")
	raw = file_doc.get_content()
	if hashlib.sha256(raw).hexdigest() != doc.file_sha256:
		frappe.throw("源文件已变化，请重新上传")
	return raw


def _progress(doc):
	return frappe.cache.get_value(f"ti-import-progress:{doc.name}") or {}


def _interrupted(doc):
	"""A stale Queued or Running import whose background job no longer exists."""
	if doc.status not in ("Queued", "Running"):
		return False
	from datetime import UTC, datetime

	from frappe.utils.background_jobs import is_job_enqueued

	if doc.status == "Queued":
		from frappe.utils import now_datetime

		modified = doc.modified
		if isinstance(modified, str):
			try:
				modified = datetime.fromisoformat(modified)
			except ValueError:
				return False
		if modified.tzinfo:
			modified = modified.replace(tzinfo=None)
		if (now_datetime() - modified).total_seconds() <= 60:
			return False
	else:
		progress = _progress(doc)
		heartbeat = progress.get("heartbeat") if isinstance(progress, dict) else None
		if heartbeat:
			try:
				beat = datetime.fromisoformat(heartbeat)
			except ValueError:
				beat = None
			if beat:
				beat = beat if beat.tzinfo else beat.replace(tzinfo=UTC)
				if (datetime.now(UTC) - beat).total_seconds() <= 60:
					return False
	return not is_job_enqueued(f"ti-import:{doc.name}:{doc.attempt or 1}")


@frappe.whitelist()
def status(name):
	"""Polled over GET, so it reports an interrupted job without writing; retry records it."""
	_require_manager()
	doc = _get(name)
	_require_import_doc(doc)
	result = _response(doc)
	result["progress"] = _progress(doc)
	if _interrupted(doc):
		result.update(status="Failed", error="后台任务已中断，可重新预览后重试")
	result["can_retry"] = result["status"] in ("Failed", "Conflict")
	return result


@frappe.whitelist(methods=["POST"])
@retry_native_request
def retry(name):
	_require_write()
	doc = _get(name, lock=True)
	_require_import_doc(doc)
	if doc.status not in ("Failed", "Conflict") and not _interrupted(doc):
		return _response(doc)
	rows = IMPORT_TYPES[doc.import_type]["parse"](
		_read_source(doc), frappe.get_value("File", doc.source_file, "file_name")
	)
	if doc.import_type == "Opening Stock":
		planned, digest = IMPORT_TYPES[doc.import_type]["plan"](
			rows,
			doc.posting_date,
			doc.posting_time,
			exclude_name=_opening_request_document(doc.name) or "",
		)
	else:
		planned, digest = IMPORT_TYPES[doc.import_type]["plan"](rows)
	doc.preview_json, doc.plan_hash = json.dumps(planned, ensure_ascii=False), digest
	_set_counts(doc, planned)
	doc.status, doc.error, doc.attempt = "Previewed", "", cint(doc.attempt or 1) + 1
	frappe.cache.delete_value(f"ti-import-progress:{doc.name}")
	_save(doc)
	return _response(doc)


@frappe.whitelist()
def report(name, kind="all"):
	_require_manager()
	doc = _get(name)
	_require_import_doc(doc)
	if kind not in ("all", "rejected"):
		frappe.throw("请选择有效的报告范围")
	rows = json.loads(doc.result_json or doc.preview_json or "[]")
	if kind == "rejected":
		rows = [row for row in rows if row.get("action") == "REJECTED" or row.get("error")]
	definition = IMPORT_TYPES[doc.import_type]
	headers = definition["report_columns"]
	fields = definition["report_fields"]
	values = []
	for row in rows:
		values.append([_report_value(row, field) for field in fields])
	if doc.import_type == "Opening Stock":
		created = json.loads(doc.created_documents or "[]")
		result = _response(doc)
		return _xlsx_response(
			doc.name,
			[
				(definition["report_sheet"], headers, values),
				(
					definition["summary_sheet"],
					definition["summary_columns"],
					[
						["单据", "；".join(created)],
						["状态", doc.status],
						["按单位数量", json.dumps(result.get("totals_by_unit", {}), ensure_ascii=False)],
						["总估值", result.get("total_value", 0)],
					],
				),
			],
			f"期初库存导入结果-{doc.name}.xlsx",
		)
	_xlsx_response(
		doc.name,
		[(definition["report_sheet"], headers, values)],
		f"物品导入结果-{doc.name}.xlsx",
	)


def _report_value(row, field):
	if field == "final_action":
		return row.get("final_action", row.get("action", ""))
	if field == "error":
		return row.get("error", "; ".join(row.get("errors", [])))
	if field == "item_name":
		return row.get("item_name") or row.get("values", {}).get("item_name", "")
	if field == "target":
		return row.get("item_code", row.get("target", ""))
	if field == "serials":
		return "\n".join(row.get("serials", []))
	return row.get(field, "")


@frappe.whitelist()
def item_catalog():
	_require_manager()
	rows = frappe.get_list(
		"Item",
		fields=[
			"name",
			"ti_import_ref",
			"item_name",
			"item_group",
			"stock_uom",
			"description",
			"has_batch_no",
			"has_serial_no",
			"has_expiry_date",
			"serial_no_series",
		],
		limit_page_length=0,
	)
	root = catalog.item_group_root()
	groups = {
		row.name: row.item_group_name
		for row in frappe.get_list("Item Group", fields=["name", "item_group_name"], limit_page_length=0)
	}
	units = {
		row.name: row.ti_label or row.name
		for row in frappe.get_list("UOM", fields=["name", "ti_label"], limit_page_length=0)
	}
	barcodes = {}
	for entry in frappe.get_all(
		"Item Barcode",
		filters={"parent": ["in", [row.name for row in rows]]},
		fields=["barcode", "parent"],
		limit_page_length=0,
	):
		barcodes.setdefault(entry.parent, []).append(entry.barcode)
	values = []
	for row in rows:
		track = "序列号" if row.has_serial_no else "批次" if row.has_batch_no else "不追踪"
		values.append(
			[
				row.name,
				row.ti_import_ref or "",
				row.item_name,
				"" if row.item_group == root else groups.get(row.item_group, ""),
				units.get(row.stock_uom, row.stock_uom),
				row.description or "",
				"；".join(sorted(barcodes.get(row.name, []))),
				track,
				"是" if row.has_expiry_date else "否",
				row.serial_no_series or "",
			]
		)
	_xlsx_response("catalog", [("物品导入", HEADERS, values)], "物品目录.xlsx")


def _run_import_attempt(import_name, owner, failure_state):
	"""Replan, allocate names briefly, then write all Item documents atomically."""
	previous_user = frappe.session.user
	current_row = 0
	frappe.set_user(owner)
	frappe.local.inventory_cache_revision_touched = True
	try:
		doc = frappe.get_doc(DOCTYPE, import_name, for_update=True)
		if doc.status not in ("Queued", "Running"):
			return
		require_app()
		frappe.has_permission(DOCTYPE, "create", throw=True)
		frappe.has_permission(DOCTYPE, "write", throw=True)
		doc.status = "Running"
		_save(doc)
		frappe.db.commit()
		raw = _read_source(doc)
		rows = IMPORT_TYPES[doc.import_type]["parse"](
			raw, frappe.get_value("File", doc.source_file, "file_name")
		)
		planned, digest = IMPORT_TYPES[doc.import_type]["plan"](rows)
		if digest != doc.plan_hash:
			doc.status, doc.error = "Conflict", "数据已变化，请重新预览"
			_save(doc)
			frappe.db.commit()
			return
		if any(row["action"] == "REJECTED" for row in planned) and not doc.skip_rejected:
			frappe.throw("请先处理无法导入的行，或明确选择跳过")
		# Allocate codes in a short transaction, before Item writes can lock the global read generation.
		for row in planned:
			if row["action"] == "NEW":
				row["allocated_code"] = allocate_item_code()
		frappe.db.commit()
		# Each commit clears this flag. Keep it set so Item writes do not take the global
		# read-generation lock, which would block every other writer for the whole job.
		frappe.local.inventory_cache_revision_touched = True
		results = []
		for index, row in enumerate(planned, 1):
			current_row = row["row"]
			failure_state["current_row"] = current_row
			frappe.cache.set_value(
				f"ti-import-progress:{doc.name}",
				{
					"percent": int(index * 100 / max(len(planned), 1)),
					"heartbeat": frappe.utils.now_datetime().isoformat(),
				},
				expires_in_sec=3600,
			)
			if row["action"] == "REJECTED":
				results.append({**row, "final_action": "REJECTED", "error": "; ".join(row["errors"])})
				continue
			if row["action"] == "UNCHANGED":
				results.append({**row, "final_action": "UNCHANGED", "item_code": row["target"], "error": ""})
				continue
			values = dict(row["values"])
			code = row.get("allocated_code") or row["target"]
			payload = {
				"item_name": values.get("item_name"),
				"item_group": values.get("item_group"),
				"stock_uom": values.get("stock_uom"),
				"description": values.get("description"),
			}
			if not row["target"]:
				payload["ti_import_ref"] = row["identity_ref"]
			elif values.get("ti_import_ref"):
				payload["ti_import_ref"] = values["ti_import_ref"]
			if values.get("tracking"):
				payload.update(
					{
						"has_batch_no": int(values["tracking"] == "批次"),
						"has_serial_no": int(values["tracking"] == "序列号"),
					}
				)
				if values["tracking"] != "批次":
					payload["has_expiry_date"] = 0
			if values.get("has_expiry_date") is not None and "has_expiry_date" not in payload:
				payload["has_expiry_date"] = values["has_expiry_date"]
			if values.get("serial_no_series"):
				payload["serial_no_series"] = values["serial_no_series"]
			item = frappe.get_doc("Item", code, for_update=True) if row["target"] else frappe.new_doc("Item")
			if row["target"] and str(item.modified) != row["modified"]:
				frappe.throw("数据已变化，请重新预览", frappe.TimestampMismatchError)
			if values.get("barcode"):
				payload["barcodes"] = [
					*(entry.barcode for entry in item.barcodes),
					*_barcodes(values["barcode"]),
				]
			if not row["target"]:
				item.item_code, item.is_stock_item = code, 1
				item.stock_uom = payload.get("stock_uom")
				item.has_batch_no = payload.get("has_batch_no", 0)
				item.has_serial_no = payload.get("has_serial_no", 0)
				item.has_expiry_date = payload.get("has_expiry_date", 0) or 0
			if row["target"]:
				payload = {key: value for key, value in payload.items() if value not in ("", None)}
			if "ti_import_ref" in payload:
				item.ti_import_ref = payload.pop("ti_import_ref")
			catalog.apply_item_fields(item, payload, item_code=row["target"] or None)
			item.save()
			results.append({**row, "final_action": row["action"], "item_code": item.name, "error": ""})
		doc = frappe.get_doc(DOCTYPE, import_name)
		doc.status, doc.error = "Completed", ""
		doc.result_json = json.dumps(results, ensure_ascii=False)
		doc.created_documents = json.dumps(
			[row["item_code"] for row in results if row["final_action"] == "NEW"], ensure_ascii=False
		)
		_save(doc)
		frappe.local.inventory_cache_revision_touched = True
		read_cache._bump_durable_revision()
		frappe.db.commit()
	except frappe.QueryDeadlockError:
		raise
	except Exception as exc:
		frappe.db.rollback()
		doc = frappe.get_doc(DOCTYPE, import_name)
		message = f"第 {current_row} 行：{exc}" if current_row else str(exc)
		conflict = isinstance(exc, frappe.TimestampMismatchError)
		doc.status, doc.error = "Conflict" if conflict else "Failed", str(exc) if conflict else message[:2000]
		_save(doc)
		frappe.db.commit()
	finally:
		frappe.set_user(previous_user)
		frappe.local.inventory_cache_revision_touched = False
		read_cache.invalidate_now()


def run_import(import_name, owner):
	"""Retry item writes without converting a transient snapshot conflict into Failed."""
	failure_state = {}
	try:
		return retry_native_job(lambda: _run_import_attempt(import_name, owner, failure_state))
	except frappe.QueryDeadlockError as exc:
		previous_user = frappe.session.user
		frappe.set_user(owner)
		try:
			frappe.db.rollback()
			doc = frappe.get_doc(DOCTYPE, import_name)
			current_row = failure_state.get("current_row", 0)
			message = f"第 {current_row} 行：{exc}" if current_row else str(exc)
			doc.status, doc.error = "Failed", message[:2000]
			_save(doc)
			frappe.db.commit()
		finally:
			frappe.set_user(previous_user)
			frappe.local.inventory_cache_revision_touched = False
			read_cache.invalidate_now()


def _run_opening_import_attempt(import_name, owner):
	"""Create one draft in a committed transaction, then submit it in the worker."""
	from temple_inventory.opening import set_difference_account

	previous_user = frappe.session.user
	frappe.set_user(owner)
	frappe.local.inventory_cache_revision_touched = True
	doc = None
	try:
		doc = frappe.get_doc(DOCTYPE, import_name, for_update=True)
		if doc.status not in ("Queued", "Running", "Failed"):
			return
		require_app()
		frappe.has_permission(DOCTYPE, "create", throw=True)
		frappe.has_permission(DOCTYPE, "write", throw=True)
		frappe.has_permission("Stock Reconciliation", "create", throw=True)
		frappe.has_permission("Stock Reconciliation", "submit", throw=True)
		request_key = hashlib.sha256(doc.name.encode()).hexdigest()
		existing_name = frappe.db.get_value(
			"Stock Reconciliation", {"ti_request_key": request_key}, "name", for_update=True
		)
		if existing_name:
			native = frappe.get_doc("Stock Reconciliation", existing_name, for_update=True)
			if native.docstatus == 2:
				frappe.throw(
					f"期初库存单据 {native.name} 已取消，请将文件作为新导入重新上传。",
					frappe.ValidationError,
				)
			if native.docstatus == 1:
				doc.status, doc.error = "Completed", ""
				doc.created_documents = json.dumps([native.name])
				doc.result_json = doc.preview_json
				_save(doc)
				frappe.db.commit()
				return
		raw = _read_source(doc)
		rows = IMPORT_TYPES[doc.import_type]["parse"](
			raw, frappe.get_value("File", doc.source_file, "file_name")
		)
		provisional, _digest = IMPORT_TYPES[doc.import_type]["plan"](
			rows, doc.posting_date, doc.posting_time, exclude_name=existing_name or ""
		)
		warehouses = sorted({row["warehouse"] for row in provisional if row.get("warehouse")})
		if warehouses:
			frappe.db.sql(
				"select name from `tabWarehouse` where name in %(names)s order by name for update",
				{"names": tuple(warehouses)},
			)
		planned, digest = IMPORT_TYPES[doc.import_type]["plan"](
			rows, doc.posting_date, doc.posting_time, exclude_name=existing_name or ""
		)
		if digest != doc.plan_hash:
			doc.status, doc.error = "Conflict", "数据已变化，请重新预览"
			_save(doc)
			frappe.db.commit()
			return
		if any(row["action"] == "REJECTED" for row in planned) and not doc.skip_rejected:
			frappe.throw("请先处理无法导入的行，或明确选择跳过")
		if not any(row["action"] == "NEW" for row in planned):
			results = [
				{**row, "final_action": row["action"], "error": "; ".join(row.get("errors", []))}
				for row in planned
			]
			doc.status, doc.error = "Completed", ""
			doc.result_json = json.dumps(results, ensure_ascii=False)
			doc.created_documents = json.dumps(
				sorted({row.get("existing_document") for row in planned if row.get("existing_document")})
			)
			_save(doc)
			frappe.db.commit()
			return
		doc.status = "Running"
		_save(doc)
		frappe.cache.set_value(
			f"ti-import-progress:{doc.name}",
			{"percent": 10, "heartbeat": frappe.utils.now_datetime().isoformat()},
			expires_in_sec=3600,
		)
		if not existing_name:
			from temple_inventory.catalog import create_batch

			for row in planned:
				if row["action"] == "REJECTED" or not row.get("batch_no"):
					continue
				values = row["values"]
				if not frappe.db.exists("Batch", row["batch_no"]):
					create_batch(
						row["item_code"],
						row["batch_no"],
						values.get("manufacturing_date"),
						values.get("expiry_date"),
					)
			valid_rows = [row for row in planned if row["action"] == "NEW"]
			native = frappe.new_doc("Stock Reconciliation")
			native.company = frappe.get_single("Temple Inventory Settings").company
			native.purpose = "Opening Stock"
			native.posting_date = doc.posting_date
			native.posting_time = doc.posting_time
			native.set_posting_time = 1
			native.ti_time_mode = "Historical"
			native.ti_request_key = request_key
			native.ti_request_user = owner
			set_difference_account(native)
			for row in valid_rows:
				values = row["values"]
				native.append(
					"items",
					{
						"item_code": row["item_code"],
						"warehouse": row["warehouse"],
						"qty": row["qty"],
						"valuation_rate": row["valuation_rate"],
						"batch_no": row.get("batch_no"),
						"serial_no": values.get("serial_no"),
						"use_serial_batch_fields": 1,
					},
				)
			native.insert()
			frappe.db.commit()
			frappe.local.inventory_cache_revision_touched = True
		if native.docstatus == 0:
			if warehouses:
				frappe.db.sql(
					"select name from `tabWarehouse` where name in %(names)s order by name for update",
					{"names": tuple(warehouses)},
				)
			frappe.cache.set_value(
				f"ti-import-progress:{doc.name}",
				{"percent": 90, "heartbeat": frappe.utils.now_datetime().isoformat()},
				expires_in_sec=3600,
			)
			# The background worker already owns this job; doc.submit() would enqueue large documents again.
			native._submit()
		if native.ti_time_mode != "Historical" or not native.set_posting_time:
			frappe.throw("期初库存单据必须使用历史入账时间。", frappe.ValidationError)
		results = []
		for row in planned:
			final = "REJECTED" if row.get("action") == "REJECTED" else row.get("action", "NEW")
			results.append({**row, "final_action": final, "error": "; ".join(row.get("errors", []))})
		doc.status, doc.error = "Completed", ""
		doc.result_json = json.dumps(results, ensure_ascii=False)
		doc.created_documents = json.dumps([native.name], ensure_ascii=False)
		_save(doc)
		frappe.cache.set_value(
			f"ti-import-progress:{doc.name}",
			{"percent": 100, "heartbeat": frappe.utils.now_datetime().isoformat()},
			expires_in_sec=3600,
		)
		frappe.local.inventory_cache_revision_touched = True
		read_cache._bump_durable_revision()
		frappe.db.commit()
	except frappe.QueryDeadlockError:
		raise
	except Exception as exc:
		frappe.db.rollback()
		doc = frappe.get_doc(DOCTYPE, import_name)
		draft_name = frappe.db.get_value(
			"Stock Reconciliation",
			{"ti_request_key": hashlib.sha256(doc.name.encode()).hexdigest(), "docstatus": 0},
			"name",
		)
		message = (
			f"提交失败；期初库存草稿 {draft_name} 已保留，可打开原生单据修正或删除：{exc}"
			if draft_name
			else f"导入失败，未创建期初库存草稿：{exc}"
		)
		doc.status, doc.error = (
			"Failed",
			message[:2000],
		)
		_save(doc)
		frappe.db.commit()
	finally:
		frappe.set_user(previous_user)
		frappe.local.inventory_cache_revision_touched = False
		read_cache.invalidate_now()


def run_opening_import(import_name, owner):
	"""Retry submission of the same request-keyed opening draft after snapshot conflicts."""
	try:
		return retry_native_job(lambda: _run_opening_import_attempt(import_name, owner))
	except frappe.QueryDeadlockError as exc:
		previous_user = frappe.session.user
		frappe.set_user(owner)
		try:
			frappe.db.rollback()
			doc = frappe.get_doc(DOCTYPE, import_name)
			request_key = hashlib.sha256(doc.name.encode()).hexdigest()
			draft_name = frappe.db.get_value(
				"Stock Reconciliation", {"ti_request_key": request_key, "docstatus": 0}, "name"
			)
			message = (
				f"提交失败；期初库存草稿 {draft_name} 已保留，可打开原生单据修正或删除：{exc}"
				if draft_name
				else f"导入失败，未创建期初库存草稿：{exc}"
			)
			doc.status, doc.error = "Failed", message[:2000]
			_save(doc)
			frappe.db.commit()
		finally:
			frappe.set_user(previous_user)
			frappe.local.inventory_cache_revision_touched = False
			read_cache.invalidate_now()


# Phase 4 adds its own definition here and reuses the source, status and report machinery.
ITEM_IMPORT_TYPE = {
	"name": "Item",
	"columns": HEADERS,
	"parse": _workbook,
	"plan": _plan,
	"commit": "temple_inventory.imports.run_import",
	"report_sheet": "导入结果",
	"report_columns": ["源行", "最终操作", "物品编号", "物品名称", "错误"],
	"report_fields": ["row", "final_action", "target", "item_name", "error"],
}
OPENING_IMPORT_TYPE = {
	"name": "Opening Stock",
	"columns": OPENING_HEADERS,
	"parse": _opening_workbook,
	"plan": _opening_plan,
	"commit": "temple_inventory.imports.run_opening_import",
	"report_sheet": "导入结果",
	"summary_sheet": "汇总",
	"summary_columns": ["项目", "结果"],
	"report_columns": [
		"源行",
		"物品编号",
		"物品名称",
		"位置",
		"数量",
		"估值单价",
		"估值金额",
		"批次编号",
		"序列号",
		"最终操作",
		"错误",
	],
	"report_fields": [
		"row",
		"item_code",
		"item_name",
		"location_label",
		"qty",
		"valuation_rate",
		"line_value",
		"batch_no",
		"serials",
		"final_action",
		"error",
	],
}
IMPORT_TYPES = {"Item": ITEM_IMPORT_TYPE, "Opening Stock": OPENING_IMPORT_TYPE}
