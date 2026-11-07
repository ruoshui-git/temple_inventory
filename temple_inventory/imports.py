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
from temple_inventory.native_access import require_app

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


def _safe_text(value):
	return "" if value is None else str(value).strip()


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
	return {
		"name": doc.name,
		"status": doc.status,
		"counts": _summary(rows),
		"rows": rows,
		"plan_hash": doc.plan_hash,
		"error": doc.error or "",
	}


def _xlsx_response(name, sheets, filename):
	output = io.BytesIO()
	workbook = xlsxwriter.Workbook(output, {"in_memory": True})
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
	uploaded = frappe.request.files.get("file") if getattr(frappe, "request", None) else None
	if not uploaded:
		frappe.throw("请选择 .xlsx 文件")
	raw = uploaded.stream.read(MAX_FILE + 1)
	if len(raw) > MAX_FILE:
		frappe.throw("文件不能超过 5 MB")
	rows = IMPORT_TYPES[import_type]["parse"](raw, uploaded.filename or "")
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
def preview(name):
	_require_write()
	doc = _get(name, lock=True)
	if doc.status not in ("Previewed", "Conflict", "Failed"):
		return _response(doc)
	was_conflict = doc.status == "Conflict"
	rows = IMPORT_TYPES[doc.import_type]["parse"](
		_read_source(doc), frappe.get_value("File", doc.source_file, "file_name")
	)
	planned, digest = IMPORT_TYPES[doc.import_type]["plan"](rows)
	doc.preview_json, doc.plan_hash = json.dumps(planned, ensure_ascii=False), digest
	_set_counts(doc, planned)
	doc.status, doc.error = "Previewed", ""
	if was_conflict:
		doc.attempt = cint(doc.attempt or 1) + 1
	_save(doc)
	return _response(doc)


@frappe.whitelist(methods=["POST"])
def commit(name, plan_hash, skip_rejected=0):
	_require_write()
	doc = _get(name, lock=True)
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
	"""A Running import whose worker died: no recent heartbeat and no job left."""
	if doc.status != "Running":
		return False
	from datetime import UTC, datetime

	from frappe.utils.background_jobs import is_job_enqueued

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
	result = _response(doc)
	result["progress"] = _progress(doc)
	if _interrupted(doc):
		result.update(status="Failed", error="后台任务已中断，可重新预览后重试")
	result["can_retry"] = result["status"] in ("Failed", "Conflict")
	return result


@frappe.whitelist(methods=["POST"])
def retry(name):
	_require_write()
	doc = _get(name, lock=True)
	if doc.status not in ("Failed", "Conflict") and not _interrupted(doc):
		return _response(doc)
	rows = IMPORT_TYPES[doc.import_type]["parse"](
		_read_source(doc), frappe.get_value("File", doc.source_file, "file_name")
	)
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
	if kind not in ("all", "rejected"):
		frappe.throw("请选择有效的报告范围")
	rows = json.loads(doc.result_json or doc.preview_json or "[]")
	if kind == "rejected":
		rows = [row for row in rows if row.get("action") == "REJECTED" or row.get("error")]
	headers = ["源行", "最终操作", "物品编号", "物品名称", "错误"]
	_xlsx_response(
		doc.name,
		[
			(
				"导入结果",
				headers,
				[
					[
						row.get("row", ""),
						row.get("final_action", row.get("action", "")),
						row.get("item_code", row.get("target", "")),
						row.get("values", {}).get("item_name", ""),
						row.get("error", "; ".join(row.get("errors", []))),
					]
					for row in rows
				],
			)
		],
		f"物品导入结果-{doc.name}.xlsx",
	)


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


def run_import(import_name, owner):
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
		rows = _workbook(raw, frappe.get_value("File", doc.source_file, "file_name"))
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


# Phase 4 adds its own definition here and reuses the source, status and report machinery.
ITEM_IMPORT_TYPE = {
	"name": "Item",
	"columns": HEADERS,
	"parse": _workbook,
	"plan": _plan,
	"commit": "temple_inventory.imports.run_import",
	"report_columns": ["源行", "最终操作", "物品编号", "错误"],
}
IMPORT_TYPES = {"Item": ITEM_IMPORT_TYPE}
