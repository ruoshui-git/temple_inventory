"""Request-owned background exports with bounded writers and download reauthorization."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import csv
import json
import re
import shutil
import tempfile
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import quote

import frappe
import xlsxwriter

from temple_inventory.export_columns import DEFAULT_COLUMNS, LABELS, allowed_columns, default_columns, label
from temple_inventory.native_access import check_document_scope, check_version, require_app
from temple_inventory.native_stock import MOVEMENT_LABELS
from temple_inventory.projections import (
	COUNT_SUMS,
	HISTORY_SUMS,
	INTERNAL_TABLES,
	LOAN_SUMS,
	STOCK_SUMS,
	TABLE_LABELS,
	Projection,
)
from temple_inventory.report_query import validate_query
from temple_inventory.uom_labels import uom_label

EXPORT_DOCTYPE = "Inventory Export Request"
service_write = ContextVar("inventory_export_service_write", default=False)


def request_permission(doc, ptype=None, user=None, **kwargs):
	user = user or frappe.session.user
	if user == "Guest" or doc.owner != user:
		return False
	return "System Manager" in frappe.get_roles(user)


def request_query(user=None):
	user = user or frappe.session.user
	return "`tabInventory Export Request`.owner = " + frappe.db.escape(user)


def _get(name, *, lock=False):
	doc = frappe.get_doc(EXPORT_DOCTYPE, name, for_update=lock)
	doc.check_permission("read")
	if doc.owner != frappe.session.user:
		frappe.throw("无权访问此导出请求", frappe.PermissionError)
	return doc


def _save(doc):
	token = service_write.set(True)
	try:
		doc.save()
	finally:
		service_write.reset(token)


def _status(doc):
	tables = _json_value(getattr(doc, "tables_json", None), [])
	return {
		"name": doc.name,
		"table": tables[0] if tables else "",
		"columns": _json_value(getattr(doc, "columns_json", None), []),
		"file_label": getattr(doc, "file_label", "") or "",
		"status": doc.status,
		"progress": doc.progress,
		"error": doc.error or "",
		"version": str(doc.modified),
		"attempt": doc.attempt,
		"generated_at": str(doc.generated_at or ""),
		"row_count": doc.row_count,
		"download_url": f"/api/method/temple_inventory.exports.download_export?name={quote(doc.name, safe='')}"
		if doc.status == "Completed"
		else None,
	}


def _enqueue(doc):
	frappe.enqueue(
		"temple_inventory.exports.generate_export",
		request_name=doc.name,
		queue="long",
		timeout=3600,
		enqueue_after_commit=True,
		job_id=f"ti-export:{doc.name}:{doc.attempt}",
	)


@frappe.whitelist(methods=["POST"])
def request_export(query, table=None, columns=None, export_format="xlsx", summary=None):
	require_app()
	if export_format not in ("xlsx", "csv"):
		frappe.throw("请选择 XLSX 或 CSV 格式")
	validated = validate_query(query)
	if table is not None and not isinstance(table, str):
		frappe.throw("请选择有效的数据表")
	columns = frappe.parse_json(columns) if isinstance(columns, str) else columns
	if columns is not None and (
		not isinstance(columns, list) or any(not isinstance(c, str) for c in columns)
	):
		frappe.throw("请选择有效的导出列")
	summary = frappe.parse_json(summary) if isinstance(summary, str) else (summary or {})
	if not isinstance(summary, dict):
		frappe.throw("导出说明格式无效")
	if "title" in summary and not isinstance(summary["title"], str):
		frappe.throw("导出页面名称无效")
	title = _clean_text(summary.get("title", ""), 60)
	filters = summary.get("filters", [])
	if not isinstance(filters, list) or len(filters) > 20 or any(not isinstance(x, str) for x in filters):
		frappe.throw("导出筛选说明无效")
	summary = {"title": title, "filters": [_clean_text(x, 200) for x in filters]}
	# Validate scope and table names before creating a durable job request.
	with Projection(validated, refresh=True) as projection:
		projection.build()
		# Grouping is presentation only: without an explicit table, export the line rows.
		table = table or projection.line_table or projection.main_table
		if table not in projection.column_names or table in INTERNAL_TABLES or table not in DEFAULT_COLUMNS:
			frappe.throw("请选择有效的数据表")
		allowed = set(projection.column_names[table]) & allowed_columns(validated["dataset"], table)
		allowed.update(
			{"expiry_state", "quantities"}
			| ({"expiry_date", "remaining_days"} if table == "locations" else set())
			| ({"source", "destination"} if table == "records" else set())
		)
		selected = columns or [
			field for field in default_columns(validated["dataset"], table) if field in allowed
		]
		if not selected or any(field not in allowed or field not in LABELS for field in selected):
			frappe.throw("请选择有效的导出列")
	doc = frappe.get_doc(
		{
			"doctype": EXPORT_DOCTYPE,
			"query_json": json.dumps(validated, ensure_ascii=False),
			"export_format": export_format,
			"tables_json": json.dumps([table]),
			"columns_json": json.dumps(selected),
			"summary_json": json.dumps(summary, ensure_ascii=False),
			"file_label": _filename(
				summary.get("title") or TABLE_LABELS.get(table, table), table, validated, export_format
			),
			"status": "Queued",
			"attempt": 1,
		}
	)
	token = service_write.set(True)
	try:
		doc.insert()
	finally:
		service_write.reset(token)
	_enqueue(doc)
	return {**_status(doc), "table": table, "columns": selected, "file_label": doc.file_label}


@frappe.whitelist()
def export_status(name):
	require_app()
	return _status(_get(name))


@frappe.whitelist(methods=["POST"])
def mark_watched(name):
	require_app()
	doc = _get(name)
	frappe.cache.set_value(f"ti-export-watched:{doc.name}", 1, expires_in_sec=86400)
	if doc.status in ("Completed", "Failed"):
		from temple_inventory.notifications import export_result

		export_result(doc, watched=True)
	return {"watched": True}


@frappe.whitelist(methods=["POST"])
def retry_export(name, version):
	require_app()
	doc = _get(name, lock=True)
	check_version(doc, version)
	if doc.status != "Failed":
		frappe.throw("只能重试失败的导出")
	doc.status, doc.error, doc.progress = "Queued", "", 0
	doc.attempt += 1
	_save(doc)
	_enqueue(doc)
	return _status(doc)


def _private_file(path, doc, filename):
	"""Register an already streamed private file through the normal File lifecycle."""
	unique_name = f"ti-export-{doc.name}-{frappe.generate_hash(length=12)}-{filename}"
	target = Path(frappe.get_site_path("private", "files", unique_name))
	target.parent.mkdir(parents=True, exist_ok=True)
	shutil.copyfile(path, target)
	file_doc = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": filename,
			"file_url": f"/private/files/{unique_name}",
			"is_private": 1,
			"attached_to_doctype": EXPORT_DOCTYPE,
			"attached_to_name": doc.name,
			"file_size": target.stat().st_size,
		}
	)
	# Core's supported attachment-copy path skips re-reading the entire blob, but
	# still validates native parent, permissions, privacy, path and file existence.
	file_doc.flags.copy_from_existing_file = True
	frappe.db.after_rollback.add(lambda: target.unlink(missing_ok=True))
	try:
		file_doc.insert()
	except Exception:
		target.unlink(missing_ok=True)
		raise
	return file_doc.name


def _manifest(projection, path):
	projection.db.execute("create table access (doctype text, name text, primary key(doctype, name))")
	for table in projection.column_names:
		for row in projection.rows(table):
			references = []
			if row.get("doctype") and row.get("document"):
				references.append((row["doctype"], row["document"]))
			for field, doctype in (
				("item_code", "Item"),
				("activity", "Inventory Activity"),
				("activity_type", "Inventory Activity Type"),
				("batch_no", "Batch"),
				("original_loan", "Stock Entry"),
				("warehouse", "Warehouse"),
				("source_warehouse", "Warehouse"),
				("destination_warehouse", "Warehouse"),
				("origin_warehouse", "Warehouse"),
				("serial_and_batch_bundle", "Serial and Batch Bundle"),
			):
				if row.get(field):
					references.append((doctype, row[field]))
			if table == "files":
				references.append(("File", row["id"]))
			for reference in references:
				projection.db.execute("insert or ignore into access values (?, ?)", reference)
	with open(path, "w", encoding="utf-8") as output:
		for doctype, name in projection.db.execute("select doctype, name from access order by doctype, name"):
			output.write(json.dumps([doctype, name], ensure_ascii=False) + "\n")


def _clean_text(value, limit):
	return re.sub(r"[\x00-\x1f\x7f]", "", str(value or ""))[:limit]


def _filename(title, table, query, export_format):
	from temple_inventory.report_query import resolved_period

	period = resolved_period(query.get("scope", {}).get("period", {}))
	period_label = f"{period['date_from']}至{period['date_to']}" if period.get("date_from") else "全部时间"
	stamp = frappe.utils.now_datetime().strftime("%Y%m%d-%H%M")
	base = f"{title or TABLE_LABELS.get(table, table)}-{period_label}-{stamp}"
	base = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', "·", base).strip(" .")
	return f"{base}.{export_format}"


def _sheet_name(table, part):
	# Excel rejects []:*?/\ in sheet names; keep the label readable.
	label = re.sub(r"[\[\]:*?/\\]", "·", TABLE_LABELS.get(table, table))
	return f"{label[:24]}{'' if part == 1 else '-' + str(part)}"


def _write(projection, doc, path):
	tables = json.loads(doc.tables_json)
	if len(tables) != 1 or tables[0] not in projection.column_names:
		frappe.throw("数据表已变更，请重新选择导出范围")
	table = tables[0]
	dataset = projection.query["dataset"]
	columns = _json_value(getattr(doc, "columns_json", None), default_columns(dataset, table))
	rows = _export_rows(projection, table)
	count = 0
	if doc.export_format == "csv":
		with open(path, "w", encoding="utf-8-sig", newline="") as output:
			writer = csv.writer(output)
			writer.writerow([label(dataset, field) for field in columns])
			count = _write_rows(writer, rows, columns, table, projection)
		return count
	with xlsxwriter.Workbook(
		str(path), {"constant_memory": True, "strings_to_formulas": False, "strings_to_urls": False}
	) as workbook:
		header = workbook.add_format({"bold": True, "bg_color": "#E9EDF2"})
		summary = _json_value(getattr(doc, "summary_json", None), {})
		filters = summary.get("filters", [])
		period = projection.context.period
		group_names = {
			"item": "物品",
			"category": "类别",
			"location": "库位",
			"kind": "类型",
			"activityType": "活动类型",
			"activity": "活动",
			"borrower": "借用方",
			"outcome": "结算结果",
			"source": "来源位置",
			"destination": "去向位置",
			"month": "月份",
			"status": "状态",
		}
		worksheet = None
		row_index = 1
		part = 0

		def new_sheet():
			nonlocal worksheet, row_index, part
			part += 1
			worksheet = workbook.add_worksheet(_sheet_name(table, part))
			worksheet.write_row(0, 0, [label(dataset, field) for field in columns], header)
			worksheet.freeze_panes(1, 0)
			for index, field in enumerate(columns):
				worksheet.set_column(index, index, min(32, max(12, len(label(dataset, field)) * 2 + 2)))
			row_index = 1
			return worksheet, row_index

		count = _write_rows(_XlsxRows(new_sheet), rows, columns, table, projection)
		info = workbook.add_worksheet("导出说明")
		info_rows = [
			("页面", summary.get("title") or TABLE_LABELS.get(table, table)),
			*(("筛选", value) for value in filters),
			(
				"分组",
				"、".join(group_names.get(key, key) for key in projection.query.get("groupBy", [])) or "无",
			),
			("排序", _sort_label(projection.query)),
			(
				"期间",
				f"{period['date_from']}至{period['date_to']}" if period.get("date_from") else "全部时间",
			),
			("生成时间", projection.context.snapshot),
			("请求账户", doc.owner),
			("行数", count),
			("表格", TABLE_LABELS.get(table, table)),
		]
		for index, values in enumerate(info_rows):
			info.write_row(index, 0, values)
		info.set_column(0, 0, 16)
		info.set_column(1, 1, 60)
	return count


class _XlsxRows:
	def __init__(self, new_sheet):
		self.new_sheet = new_sheet
		self.worksheet, self.row_index = new_sheet()

	def writerow(self, values):
		if self.row_index >= 1048576:
			self.worksheet, self.row_index = self.new_sheet()
		self.worksheet.write_row(self.row_index, 0, values)
		self.row_index += 1


def _export_rows(projection, table):
	if table == "records":
		from temple_inventory.report_sources import whole_operation

		operation_cache = {}
		sum_fields = _sum_fields(table, projection.query)

		def rows():
			# Records arrive one row per document and unit; a non-date sort need not keep
			# a document's units adjacent, so collect in first-seen order.
			groups = {}
			for row in projection.rows(table):
				key = (row.get("doctype"), row.get("document"))
				group = groups.setdefault(key, {**row, "_units": {}})
				unit = row.get("stock_uom") or ""
				unit_values = group["_units"].setdefault(unit, {})
				for field in sum_fields:
					if isinstance(row.get(field), (int, float)):
						unit_values[field] = float(unit_values.get(field, 0)) + float(row[field])
			for group in groups.values():
				yield _export_record_row(projection, whole_operation, operation_cache, group)

		return rows()
	return projection.rows(table)


def _export_record_row(projection, whole_operation, operation_cache, row):
	key = (row.get("doctype"), row.get("document"))
	units = row["_units"]
	single_unit = next(iter(units.values())) if len(units) == 1 else {}
	quantity_fields = _sum_fields("records", projection.query)
	aggregates = {field: single_unit.get(field) if len(units) == 1 else None for field in quantity_fields}
	quantities = (
		"；".join(f"{values.get('stock_qty', 0):g} {uom_label(unit)}" for unit, values in units.items())
		if len(units) > 1
		else ""
	)
	if key[0] not in ("Stock Entry", "Stock Reconciliation") or not key[1]:
		return {
			**row,
			**aggregates,
			"stock_qty": single_unit.get("stock_qty") if len(units) == 1 else None,
			"stock_uom": next(iter(units)) if len(units) == 1 else "",
			"quantities": quantities,
			"source": "",
			"destination": "",
		}
	if key not in operation_cache:
		operation_cache[key] = whole_operation(projection.context, *key)
	operation = operation_cache[key]
	sources, destinations = set(), set()
	for branch in operation["branches"]:
		sources.add(projection.context.label(branch["source"]) if branch["source"] else "外部")
		destinations.add(projection.context.label(branch["destination"]) if branch["destination"] else "外部")
	return {
		**row,
		**aggregates,
		"stock_qty": single_unit.get("stock_qty") if len(units) == 1 else None,
		"stock_uom": next(iter(units)) if len(units) == 1 else "",
		"quantities": quantities,
		"source": "；".join(sorted(value for value in sources if value)),
		"destination": "；".join(sorted(value for value in destinations if value)),
	}


def _sort_label(query):
	field = query.get("sortBy") or "identity"
	name = "默认" if field == "identity" else LABELS.get(field, field)
	return f"{name} · {'升序' if query.get('sort') == 'asc' else '降序'}"


def _json_value(value, default):
	if not value:
		return default
	return frappe.parse_json(value) if isinstance(value, str) else value


def _write_rows(writer, rows, columns, table, projection):
	totals = {}
	count = 0
	for row in rows:
		values = [_display_cell(row, field, projection) for field in columns]
		writer.writerow([_csv_value(value) for value in values])
		count += 1
		unit = str(row.get("stock_uom") or "")
		fields = [field for field in _sum_fields(table, projection.query) if field in columns]
		if table == "records" and "stock_qty" in fields:
			for unit, unit_values in row.get("_units", {}).items():
				_totals_add(
					totals, unit, {field: unit_values[field] for field in fields if field in unit_values}
				)
		elif fields:
			_totals_add(
				totals,
				unit,
				{field: row[field] for field in fields if isinstance(row.get(field), (int, float))},
			)
	for unit, sums in totals.items():
		line = [""] * len(columns)
		line[0] = (
			f"合计（{uom_label(unit)}） · {sums['_count']} 行" if unit else f"合计 · {sums['_count']} 行"
		)
		for index, field in enumerate(columns):
			if field in sums:
				line[index] = sums[field]
		writer.writerow(line)
	return count


def _totals_add(totals, unit, fields):
	values = totals.setdefault(str(unit or ""), {"_count": 0})
	values["_count"] += 1
	for field, value in fields.items():
		values[field] = values.get(field, 0) + value


def _sum_fields(table, query):
	dataset = query["dataset"]
	if table in ("locations", "batches"):
		return STOCK_SUMS if table == "locations" else ("stock_qty",)
	if table == "summary":
		return (
			STOCK_SUMS
			if dataset == "inventory"
			else ("stock_qty", "available_effect")
			if dataset == "movements"
			else COUNT_SUMS
		)
	if table in ("records", "lines"):
		return (
			("stock_qty", "available_effect")
			if dataset == "movements"
			else LOAN_SUMS
			if dataset == "loans"
			else COUNT_SUMS
		)
	if table in ("outcomes", "loan_items"):
		return LOAN_SUMS
	if table in ("balances", "ledger"):
		return HISTORY_SUMS
	if table == "history":
		return ("stock_qty", "available_effect")
	if table == "loan_history":
		return ("borrowed", "outstanding")
	if table == "settlements":
		return ("stock_qty",)
	return ()


def _display_cell(row, field, projection=None):
	if field.endswith("_warehouse") or field == "warehouse":
		label_field = f"{field}_label"
		if row.get(label_field):
			return row[label_field]
		value = row.get(field)
		if value == "" and field in ("source_warehouse", "destination_warehouse", "origin_warehouse"):
			return "外部"
		return (projection.context.label(value) if projection and value else "") or value
	if field in ("stock_uom", "entered_uom", "uom"):
		return uom_label(row.get(field))
	if field == "kind":
		return MOVEMENT_LABELS.get(
			row.get(field),
			{"Reconcile": "盘点调整", "Opening": "期初库存"}.get(row.get(field), row.get(field)),
		)
	if field == "docstatus":
		return {0: "草稿", 1: "已提交", 2: "已取消"}.get(row.get(field), row.get(field))
	if field == "category":
		return row.get("category_label") or row.get(field)
	if field in ("source", "destination"):
		return row.get(f"{field}_label") or row.get(field)
	if field == "expiry_state":
		if not row.get("expiry_date"):
			return "无效期"
		return "已过期" if str(row["expiry_date"]) < frappe.utils.nowdate() else "未过期"
	value = row.get(field)
	if isinstance(value, list):
		return "；".join(str(part) for part in value)
	if isinstance(value, bool):
		return "是" if value else "否"
	return value


def _csv_value(value):
	# Keep numeric cells numeric and prevent spreadsheet formula interpretation
	# of free-text fields without changing their scope or allocation identity.
	if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
		return "'" + value
	return value


def generate_export(request_name):
	original_user = frappe.session.user
	request = frappe.get_doc(EXPORT_DOCTYPE, request_name)
	try:
		frappe.set_user(request.owner)
		require_app()
		if not frappe.db.get_value("User", request.owner, "enabled"):
			frappe.throw("请求账户已停用", frappe.PermissionError)
		request = _get(request_name, lock=True)
		if request.status != "Queued":
			return
		request.status, request.progress, request.error = "Running", 1, ""
		_save(request)
		frappe.db.commit()
		with tempfile.TemporaryDirectory(prefix="ti-export-") as output_dir:
			with Projection(json.loads(request.query_json), refresh=True) as projection:
				projection.build()
				request.progress = 60
				_save(request)
				frappe.db.commit()
				path = Path(output_dir) / (request.file_label or f"inventory.{request.export_format}")
				manifest_path = Path(output_dir) / "access.jsonl"
				row_count = _write(projection, request, path)
				_manifest(projection, manifest_path)
				# Recheck the user's authorization after the potentially long write.
				# Role/User Permission changes invalidate Redis but cannot invalidate
				# this worker's local permission memoization. Start a fresh owner
				# context before checking the manifest; keep the caller restoration.
				frappe.set_user(request.owner)
				_check_manifest_path(manifest_path)
				request.output_file = _private_file(path, request, request.file_label or path.name)
				request.access_manifest = _private_file(manifest_path, request, "access.jsonl")
				request.generated_at = projection.context.snapshot
				request.row_count = row_count
				request.status, request.progress = "Completed", 100
				_save(request)
				from temple_inventory.notifications import export_result

				export_result(
					request, watched=bool(frappe.cache.get_value(f"ti-export-watched:{request.name}"))
				)
				frappe.db.commit()
	except Exception as error:
		frappe.db.rollback()
		# Only this user's request can be updated; failure does not expose raw HTML
		# or permission-protected document names through a worker traceback.
		request = frappe.get_doc(EXPORT_DOCTYPE, request_name)
		if request.owner != frappe.session.user:
			raise
		request.status, request.error = (
			"Failed",
			"导出失败，请重新登录并检查权限后重试"
			if isinstance(error, (frappe.PermissionError, frappe.AuthenticationError))
			else "导出生成失败，请重试",
		)
		request.progress = 0
		# A revoked role must still leave a truthful failed state for this owner.
		token = service_write.set(True)
		try:
			request.save(ignore_permissions=True)
		finally:
			service_write.reset(token)
		from temple_inventory.notifications import export_result

		export_result(request, watched=bool(frappe.cache.get_value(f"ti-export-watched:{request.name}")))
		frappe.log_error(title="Inventory export failed", message=frappe.get_traceback())
		frappe.db.commit()
	finally:
		frappe.set_user(original_user)


def _check_manifest_path(path):
	from temple_inventory.native_topology import _settings, _visible_warehouses

	require_app()
	if not frappe.db.get_value("User", frappe.session.user, "enabled"):
		frappe.throw("请求账户已停用", frappe.PermissionError)
	visible = _visible_warehouses()
	frappe.get_doc("Company", _settings().company).check_permission("read")
	with open(path, encoding="utf-8") as source:
		for line in source:
			doctype, name = json.loads(line)
			doc = frappe.get_doc(doctype, name)
			doc.check_permission("read")
			if doctype in ("Stock Entry", "Stock Reconciliation"):
				check_document_scope(doc)
			elif doctype == "Warehouse" and name not in visible:
				frappe.throw("导出包含当前无权查看的位置", frappe.PermissionError)


def validate_download(doc):
	require_app()
	if (
		doc.owner != frappe.session.user
		or doc.status != "Completed"
		or not doc.output_file
		or not doc.access_manifest
	):
		frappe.throw("此导出尚不可下载", frappe.PermissionError)
	manifest = frappe.get_doc("File", doc.access_manifest)
	if not manifest.is_private or (manifest.attached_to_doctype, manifest.attached_to_name) != (
		EXPORT_DOCTYPE,
		doc.name,
	):
		frappe.throw("导出权限资料不可用", frappe.PermissionError)
	_check_manifest_path(manifest.get_full_path())


def export_file_permission(doc, ptype=None, user=None):
	if doc.attached_to_doctype != EXPORT_DOCTYPE:
		return None
	if ptype not in ("read", "select"):
		return None
	try:
		request = _get(doc.attached_to_name)
		validate_download(request)
		return doc.name == request.output_file and bool(doc.is_private)
	except frappe.PermissionError, frappe.AuthenticationError, frappe.DoesNotExistError:
		return False


@frappe.whitelist()
def download_export(name):
	require_app()
	doc = _get(name)
	validate_download(doc)
	file = frappe.get_doc("File", doc.output_file)
	if not file.is_private or (file.attached_to_doctype, file.attached_to_name) != (EXPORT_DOCTYPE, name):
		frappe.throw("导出文件不可用", frappe.PermissionError)
	# Send through Frappe's native private-file route; that route repeats File
	# authorization and the manifest check. No public copy or raw binary API cache.
	frappe.local.response["type"] = "redirect"
	frappe.local.response["location"] = file.file_url
