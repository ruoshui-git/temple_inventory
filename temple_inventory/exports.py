"""Request-owned background exports with bounded writers and download reauthorization."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import csv
import hashlib
import json
import shutil
import tempfile
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import quote

import frappe
import xlsxwriter
from frappe.utils import now_datetime

from temple_inventory.native_access import check_document_scope, check_version, require_app
from temple_inventory.projections import TABLE_LABELS, Projection
from temple_inventory.report_query import validate_query

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
	return {
		"name": doc.name,
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
def request_export(query, export_format="xlsx", tables=None, include_related=False):
	require_app()
	if export_format not in ("xlsx", "csv"):
		frappe.throw("请选择 XLSX 或 CSV 格式")
	validated = validate_query(query)
	selected = frappe.parse_json(tables)
	if (
		not isinstance(selected, list)
		or not selected
		or any(not isinstance(value, str) for value in selected)
	):
		frappe.throw("请选择需要导出的数据表")
	if export_format == "csv" and len(selected) != 1:
		frappe.throw("CSV 只能导出一张明确选择的数据表")
	if type(include_related) is not bool:
		frappe.throw("请选择是否包含关联资料")
	# Validate scope and table names before creating a durable job request.
	with Projection(validated) as projection:
		projection.build(related=include_related)
		if any(table not in projection.column_names for table in selected):
			frappe.throw("请选择有效的数据表")
	doc = frappe.get_doc(
		{
			"doctype": EXPORT_DOCTYPE,
			"query_json": json.dumps(validated, ensure_ascii=False),
			"export_format": export_format,
			"tables_json": json.dumps(list(dict.fromkeys(selected))),
			"include_related": include_related,
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
	return _status(doc)


@frappe.whitelist()
def export_status(name):
	require_app()
	return _status(_get(name))


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


def _write(projection, doc, path):
	tables = json.loads(doc.tables_json)
	if any(table not in projection.column_names for table in tables):
		frappe.throw("数据表已变更，请重新选择导出范围")
	count = 0
	if doc.export_format == "csv":
		table = tables[0]
		columns = projection.column_names[table]
		with open(path, "w", encoding="utf-8-sig", newline="") as output:
			writer = csv.writer(output)
			writer.writerow(columns)
			for row in projection.rows(table):
				writer.writerow([_csv_value(row.get(field)) for field in columns])
				count += 1
	else:
		with xlsxwriter.Workbook(
			str(path), {"constant_memory": True, "strings_to_formulas": False, "strings_to_urls": False}
		) as workbook:
			info = workbook.add_worksheet("导出范围")
			info.write_row(0, 0, ["生成时间", projection.context.snapshot])
			info.write_row(1, 0, ["请求账户", doc.owner])
			info.write_row(2, 0, ["查询", json.dumps(projection.query, ensure_ascii=False)])
			for table in tables:
				columns = projection.column_names[table]
				worksheet = None
				row_index = 1
				part = 0

				def new_sheet():
					nonlocal worksheet, row_index, part
					part += 1
					label = TABLE_LABELS.get(table, table)
					worksheet = workbook.add_worksheet(f"{label[:24]}{'' if part == 1 else '-' + str(part)}")
					worksheet.write_row(0, 0, columns)
					worksheet.freeze_panes(1, 0)
					row_index = 1

				new_sheet()
				for row in projection.rows(table):
					if row_index >= 1048576:
						new_sheet()
					worksheet.write_row(row_index, 0, [row.get(field) for field in columns])
					row_index += 1
					count += 1
	return count


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
			with Projection(json.loads(request.query_json)) as projection:
				projection.build(related=bool(request.include_related))
				request.progress = 60
				_save(request)
				frappe.db.commit()
				path = Path(output_dir) / f"inventory.{request.export_format}"
				manifest_path = Path(output_dir) / "access.jsonl"
				row_count = _write(projection, request, path)
				_manifest(projection, manifest_path)
				# Recheck the user's authorization after the potentially long write.
				# Role/User Permission changes invalidate Redis but cannot invalidate
				# this worker's local permission memoization. Start a fresh owner
				# context before checking the manifest; keep the caller restoration.
				frappe.set_user(request.owner)
				_check_manifest_path(manifest_path)
				request.output_file = _private_file(path, request, path.name)
				request.access_manifest = _private_file(manifest_path, request, "access.jsonl")
				request.generated_at = projection.context.snapshot
				request.row_count = row_count
				request.status, request.progress = "Completed", 100
				_save(request)
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
