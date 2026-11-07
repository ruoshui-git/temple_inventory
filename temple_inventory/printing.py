"""Shared PDF rendering helpers for Temple Inventory Print Formats."""
# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import os
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

import frappe

from temple_inventory.native_access import require_app

PDF_MARGIN_MM = 6
PDF_POINT_PER_MM = 72 / 25.4
PDF_PAGE_DIMENSIONS_PT = {"portrait": (612.0, 792.0), "landscape": (792.0, 612.0)}
PDF_PAGE_WIDTH_PT = {
	orientation: dimensions[0] - 2 * PDF_MARGIN_MM * PDF_POINT_PER_MM - allowance
	for orientation, dimensions, allowance in (
		("portrait", PDF_PAGE_DIMENSIONS_PT["portrait"], 30.0),
		("landscape", PDF_PAGE_DIMENSIONS_PT["landscape"], 35.0),
	)
}
PDF_CELL_EXTRA_PT = 8.5
PDF_TEXT_MARGIN = 1.06
PDF_COUNT_SHEET_EM = (5.0, 8.0)


def _text_em(text):
	width = 0.0
	for char in str(text):
		if unicodedata.east_asian_width(char) in ("W", "F"):
			width += 1.0
		elif char.isupper() or char.isdigit():
			width += 0.62
		else:
			width += 0.5
	return width


def _pdf_layout(
	columns,
	rows,
	*,
	subtotal_span=0,
	count_sheet=False,
	wrappable=(),
	base_font=None,
	allow_landscape=True,
	orientation="auto",
):
	"""Size fixed-width export and slip columns while retaining a wrapping main column."""
	header = [_text_em(column["label"]) * 1.08 for column in columns]
	values = [[] for _ in columns]
	sequence = 0
	for row in rows:
		style = row.get("style", "row")
		if style.startswith("group-"):
			continue
		if style == "row":
			sequence = row.get("sequence") or sequence
		for index, value in enumerate(row.get("values", [])):
			if (style == "subtotal" and index < subtotal_span) or style == "total":
				continue
			if value != "":
				values[index].append(_text_em(value))
	widest = [max([header[index], *found]) for index, found in enumerate(values)]
	typical = [
		max(header[index], sorted(found)[int(len(found) * 0.9)] if found else 0.0)
		for index, found in enumerate(values)
	]
	main = next((index for index, column in enumerate(columns) if column.get("is_main")), None)
	seq_em = max(1.2, _text_em(sequence) * 0.85)
	extra_em = list(PDF_COUNT_SHEET_EM) if count_sheet else []
	if orientation not in ("auto", "portrait", "landscape"):
		frappe.throw("请选择有效的页面方向", frappe.ValidationError)
	if base_font is None:
		fonts = (11.0, 10.0, 9.5, 9.0, 8.5) if count_sheet else (9.5, 8.5, 8.0, 7.5)
		attempts = [("portrait", fonts[0]), *(("landscape", font) for font in fonts)]
	else:
		fonts = (base_font, base_font - 1, base_font - 1.5)
		orientations = ("portrait", "landscape") if allow_landscape else ("portrait",)
		attempts = [(orientation, font) for orientation in orientations for font in fonts]
	if orientation != "auto":
		attempts = [(orientation, font) for font in fonts]

	def total_width(widths, font, main_em):
		fixed = sum(width for index, width in enumerate(widths) if index != main)
		ems = (fixed + seq_em) * PDF_TEXT_MARGIN + sum(extra_em) + (main_em if main is not None else 0)
		return ems * font + PDF_CELL_EXTRA_PT * (len(widths) + 1 + len(extra_em))

	def first_fit(widths, main_em):
		return next(
			(
				(orientation, font)
				for orientation, font in attempts
				if total_width(widths, font, main_em) <= PDF_PAGE_WIDTH_PT[orientation]
			),
			None,
		)

	main_em = min(widest[main], 10.0) if main is not None else 0.0
	widths = list(widest)
	fit = first_fit(widths, main_em)
	if not fit:
		widths = [
			widest[index] if columns[index].get("align") == "number" else typical[index]
			for index in range(len(columns))
		]
		fit = first_fit(widths, main_em)
	if not fit:
		fallback_orientation, font = attempts[-1]
		main_em = min(main_em, 8.0)
		capable = [
			index
			for index in range(len(columns))
			if index != main and columns[index].get("align") != "number"
		]
		capable.sort(key=lambda index: (index not in wrappable, -widths[index]))
		for index in capable:
			if total_width(widths, font, main_em) <= PDF_PAGE_WIDTH_PT[fallback_orientation]:
				break
			widths[index] = min(widths[index], max(header[index], 6.0 if index in wrappable else 7.0))
		fit = (fallback_orientation, font)
	orientation, font = fit
	if main is not None:
		# The main column keeps one line where possible: wrappable text gives up width down to its
		# 90th-percentile value, so only its longest cells wrap.
		room = PDF_PAGE_WIDTH_PT[orientation] / font
		for index in sorted(set(wrappable) - {main}, key=lambda index: typical[index] - widths[index]):
			shortfall = widest[main] * PDF_TEXT_MARGIN - (room - total_width(widths, font, 0) / font)
			if shortfall <= 0:
				break
			floor = max(header[index], typical[index])
			widths[index] = min(widths[index], max(floor, widths[index] - shortfall / PDF_TEXT_MARGIN))
	for index, column in enumerate(columns):
		column["wrap"] = index != main and widest[index] > widths[index] + 0.01
		column["width_pt"] = (
			None if index == main else round(widths[index] * font * PDF_TEXT_MARGIN + PDF_CELL_EXTRA_PT, 1)
		)
	return {
		"orientation": orientation,
		"font_pt": font,
		"head_font_pt": font + 0.5,
		"seq_width_pt": round(seq_em * font * PDF_TEXT_MARGIN + PDF_CELL_EXTRA_PT, 1),
		"extra_widths_pt": [round(em * font + PDF_CELL_EXTRA_PT, 1) for em in extra_em],
	}


@lru_cache(maxsize=1)
def _load_print_css():
	css_path = Path(__file__).parent / "templates" / "print" / "ti_print.css"
	return css_path.read_text(encoding="utf-8")


def ti_print_css():
	"""Return the shared print stylesheet for inline inclusion in Print Formats."""
	return _load_print_css().replace("{{ PDF_MARGIN_MM }}", str(PDF_MARGIN_MM))


def render_pdf(doctype, name, print_format, doc=None):
	"""Render a Print Format with Frappe's Chrome engine and return the PDF bytes."""
	chromium_path = frappe.get_common_site_config().get("chromium_path") or ""
	path = Path(chromium_path)
	if not chromium_path or not path.is_file() or not os.access(path, os.X_OK):
		frappe.throw(
			"PDF 打印需要 Chromium。请在 common_site_config.json 中设置 chromium_path",
			exc=frappe.ValidationError,
		)
	with path.open("rb") as binary:
		is_script = binary.read(2) == b"#!"
	if is_script:
		# Frappe terminates the process it started; a wrapper script dies alone and leaves
		# the real browser running, so every PDF would leak one Chromium.
		frappe.throw(
			"chromium_path 指向启动脚本，会遗留浏览器进程。请改为 Chromium 可执行文件"
			"（如 /usr/lib/chromium/chromium-headless-shell）",
			exc=frappe.ValidationError,
		)

	return frappe.get_print(
		doctype,
		name,
		print_format=print_format,
		doc=doc,
		as_pdf=True,
		pdf_generator="chrome",
		no_letterhead=1,
	)


def _quantity(value):
	try:
		return f"{float(value or 0):.3f}".rstrip("0").rstrip(".")
	except TypeError, ValueError:
		return str(value or "")


def _person_name(value, role):
	if not value:
		return ""
	from temple_inventory.people import recorded_names

	return next(
		(row["label"] for row in recorded_names(search=value, role=role) if row["value"] == value), ""
	)


def ti_record(doc):
	"""Permission-scoped, presenter-labelled slip data for standard and custom formats."""
	cache = getattr(frappe.local, "ti_record_print_cache", None)
	if cache is None:
		cache = frappe.local.ti_record_print_cache = {}
	cache_key = (frappe.session.user, doc.doctype, doc.name, str(doc.modified or ""))
	if cache_key in cache:
		return cache[cache_key]
	from frappe.utils import get_datetime

	from temple_inventory import native_api
	from temple_inventory.catalog import item_group_root
	from temple_inventory.native_stock import MOVEMENT_LABELS
	from temple_inventory.native_topology import present_locations
	from temple_inventory.uom_labels import uom_label

	data = native_api.serialize(doc)
	category_root = item_group_root()
	settings = frappe.get_single("Temple Inventory Settings")
	warehouses = frappe.get_list(
		"Warehouse",
		filters={"company": settings.company},
		fields=[
			"name",
			"warehouse_name",
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
			"parent_warehouse",
			"is_group",
		],
		limit_page_length=0,
	)
	labels = {row["name"]: row["label"] for row in present_locations(warehouses, settings=settings)}
	parents = {row["name"]: row.get("parent_warehouse") for row in warehouses}

	def top_location(name):
		current = name
		while current and parents.get(current) and parents[current] != settings.physical_root_warehouse:
			current = parents[current]
		return labels.get(current or name, labels.get(name, name))

	kind = data.get("kind") or ("Reconcile" if doc.doctype == "Stock Reconciliation" else "")
	kind_label = "盘点" if doc.doctype == "Stock Reconciliation" else MOVEMENT_LABELS.get(kind, kind)
	kind_label = {"借出": "借用", "修复归库": "修复"}.get(kind_label, kind_label)
	status = {0: "草稿", 1: "已提交", 2: "已取消"}.get(int(doc.docstatus), "")
	from_names = sorted({row.get("s_warehouse") for row in doc.get("items", []) if row.get("s_warehouse")})
	to_names = sorted({row.get("t_warehouse") for row in doc.get("items", []) if row.get("t_warehouse")})
	if doc.doctype == "Stock Reconciliation":
		location_names = sorted(
			{row.get("warehouse") for row in doc.get("items", []) if row.get("warehouse")}
		)
		scope = "、".join(dict.fromkeys(top_location(name) for name in location_names))
		from_label, to_label = "", ""
	else:
		from_label = "、".join(dict.fromkeys(top_location(name) for name in from_names))
		to_label = "、".join(dict.fromkeys(top_location(name) for name in to_names))
		scope = (
			f"{from_label} → {to_label}"
			if kind == "Transfer"
			else (to_label if kind == "Receive" else from_label)
		)
	activity_title = ""
	activity = doc.get("ti_activity")
	if activity and frappe.get_list(
		"Inventory Activity", filters={"name": activity}, fields=["name"], limit=1
	):
		activity_title = frappe.db.get_value("Inventory Activity", activity, "title") or ""
	serialized_items = data.get("items", [])
	item_details = {
		row.name: row
		for row in frappe.get_list(
			"Item",
			filters={
				"name": [
					"in",
					sorted({row.get("item_code") for row in serialized_items if row.get("item_code")})
					or [""],
				]
			},
			fields=["name", "item_name", "item_group"],
			limit_page_length=0,
		)
	}
	count_review = {
		row.get("item_code", "")
		+ "\0"
		+ str(row.get("warehouse", ""))
		+ "\0"
		+ str(row.get("batch_no") or ""): row
		for row in data.get("ti_count_review", [])
	}
	lines = []
	for _source, row in zip(doc.get("items", []), serialized_items, strict=True):
		item = item_details.get(row.get("item_code"))
		name = row.get("ti_display_item_name") or (item.item_name if item else "") or row.get("item_code", "")
		unit = row.get("stock_uom") or row.get("uom") or ""
		allocations = row.get("recorded_batch_allocations") or []
		batch_values = list(
			dict.fromkeys(
				allocation.get("batch_no") for allocation in allocations if allocation.get("batch_no")
			)
		)
		batch = "、".join(batch_values) or row.get("batch_no") or ""
		expiry = "、".join(
			dict.fromkeys(
				allocation.get("expiry_date") for allocation in allocations if allocation.get("expiry_date")
			)
		)
		count_allocations = row.get("recorded_count_allocations") or []
		serial_no = row.get("serial_no") or ""
		review = count_review.get(
			row.get("item_code", "") + "\0" + str(row.get("warehouse", "")) + "\0" + str(batch), {}
		)
		qty = row.get("transfer_qty") or row.get("qty") or 0
		line_from = top_location(row.get("s_warehouse")) if row.get("s_warehouse") else ""
		line_to = top_location(row.get("t_warehouse")) if row.get("t_warehouse") else ""
		line_location = f"{line_from} → {line_to}" if line_from and line_to else line_to or line_from
		book = review.get("baseline_qty")
		actual = review.get("actual_qty")
		if book is None:
			book = sum(float(allocation.get("baseline_qty") or 0) for allocation in count_allocations)
		if actual is None:
			actual = sum(float(allocation.get("actual_qty") or 0) for allocation in count_allocations)
		difference = review.get("difference")
		if difference is None:
			difference = sum(float(allocation.get("difference") or 0) for allocation in count_allocations)
		difference_text = _quantity(difference)
		if float(difference or 0) > 0:
			difference_text = "+" + difference_text
		lines.append(
			{
				"item_name": name,
				"item_code": row.get("item_code", ""),
				"category": "" if not item or item.item_group == category_root else item.item_group,
				"batch": batch,
				"expiry": expiry,
				"serials": serial_no,
				"quantity": _quantity(qty),
				"unit": uom_label(unit),
				"warehouse": labels.get(row.get("warehouse"), row.get("warehouse", "")),
				"location": line_location,
				"book": _quantity(book if count_allocations or review else row.get("current_qty", 0)),
				"actual": _quantity(actual if count_allocations or review else row.get("qty", 0)),
				"difference": difference_text,
			}
		)
	columns = [
		{
			"key": key,
			"label": label,
			"align": "number" if key == "quantity" else "text",
			"is_main": key == "item_name",
		}
		for key, label in (
			*((("category", "类别"),) if any(line["category"] for line in lines) else ()),
			("item_name", "物品名称"),
			("item_code", "物品编号"),
			("quantity", "数量"),
			("unit", "单位"),
		)
	]
	if doc.doctype == "Stock Entry" and len({line["location"] for line in lines}) > 1:
		columns.append({"key": "location", "label": "库位", "align": "text"})
	if any(line["batch"] for line in lines):
		columns.append({"key": "batch", "label": "批次", "align": "text"})
	if any(line["expiry"] for line in lines):
		columns.append({"key": "expiry", "label": "有效期", "align": "text"})
	if any(line["serials"] for line in lines):
		columns.append({"key": "serials", "label": "序列号", "align": "text"})
	if doc.doctype == "Stock Reconciliation":
		keys = [("item_name", "物品名称"), ("item_code", "物品编号")]
		if len({line["warehouse"] for line in lines}) > 1:
			keys.append(("warehouse", "库位"))
		if any(line["batch"] for line in lines):
			keys.append(("batch", "批次"))
		keys += [("book", "账面"), ("actual", "实盘"), ("difference", "差异"), ("unit", "单位")]
		columns = [
			{
				"key": key,
				"label": label,
				"align": "number" if key in ("book", "actual", "difference") else "text",
				"is_main": key == "item_name",
			}
			for key, label in keys
		]
	layout = _pdf_layout(
		columns,
		[
			{"style": "row", "sequence": index, "values": [line.get(col["key"], "") for col in columns]}
			for index, line in enumerate(lines, 1)
		],
		subtotal_span=0,
		count_sheet=False,
		# Slips keep large type: text columns wrap before the font gets smaller.
		wrappable={
			index
			for index, column in enumerate(columns)
			if column["key"] in ("category", "location", "warehouse", "batch", "serials")
		},
		base_font=12,
		allow_landscape=False,
	)
	totals = {}
	for line in lines:
		if line["unit"]:
			totals[line["unit"]] = float(totals.get(line["unit"], 0)) + float(line["quantity"] or 0)
	count_totals = {}
	for line in lines:
		if line["unit"]:
			total = count_totals.setdefault(line["unit"], {"book": 0.0, "actual": 0.0, "difference": 0.0})
			for field in ("book", "actual", "difference"):
				total[field] += float(line[field] or 0)
	totals = {unit: _quantity(total) for unit, total in totals.items()}
	count_totals = {
		unit: {field: _quantity(quantity) for field, quantity in total.items()}
		for unit, total in count_totals.items()
	}
	title_location = scope or ""
	if doc.doctype == "Stock Reconciliation":
		signature_labels = ("盘点人", "复核人")
		signature_names = (
			_person_name(doc.get("ti_recorder_name"), "recorder"),
			_person_name(doc.get("ti_reviewer_name"), "reviewer"),
		)
	elif kind == "Receive":
		signature_labels = ("接收人", "经手人", "鉴证人")
		signature_names = (
			_person_name(doc.get("ti_recorder_name"), "recorder"),
			_person_name(doc.get("ti_handler_name"), "handler"),
			_person_name(doc.get("ti_reviewer_name"), "reviewer"),
		)
	elif kind in ("Issue", "Transfer", "Repair", "Disposal"):
		signature_labels = ("领用人", "经手人", "复核人")
		signature_names = (
			_person_name(doc.get("ti_recorder_name"), "recorder"),
			_person_name(doc.get("ti_handler_name"), "handler"),
			_person_name(doc.get("ti_reviewer_name"), "reviewer"),
		)
	elif kind == "Loan":
		signature_labels = ("借用人", "经手人")
		signature_names = (doc.get("ti_borrower") or "", _person_name(doc.get("ti_handler_name"), "handler"))
	elif kind in ("Return", "Damage", "Loss"):
		signature_labels = ("归还人", "经手人")
		signature_names = (doc.get("ti_borrower") or "", _person_name(doc.get("ti_handler_name"), "handler"))
	else:
		signature_labels = ("记录人", "经手人", "复核人")
		signature_names = (
			_person_name(doc.get("ti_recorder_name"), "recorder"),
			_person_name(doc.get("ti_handler_name"), "handler"),
			_person_name(doc.get("ti_reviewer_name"), "reviewer"),
		)
	result = {
		"doctype": doc.doctype,
		"kind": kind,
		"kind_label": kind_label,
		"status": status,
		"name": doc.name,
		"date": str(doc.get("posting_date") or ""),
		"time": get_datetime(f"{doc.get('posting_date')} {doc.get('posting_time')}").strftime("%H:%M:%S"),
		"scope": scope,
		"from": from_label,
		"to": to_label,
		"borrower": doc.get("ti_borrower") or "",
		"activity_title": activity_title,
		"source": doc.get("ti_source_text") or "",
		"purpose": doc.get("ti_purpose_text") or "",
		"recorder": doc.get("ti_recorder_name") or "",
		"handler": doc.get("ti_handler_name") or "",
		"reviewer": doc.get("ti_reviewer_name") or "",
		"notes": doc.get("ti_notes") or doc.get("remarks") or "",
		"lines": lines,
		"columns": columns,
		"line_count": len(lines),
		"totals": totals,
		"count_totals": count_totals,
		"signature_labels": signature_labels,
		"signature_names": signature_names,
		"title_location": title_location,
		**layout,
		"watermark": "草稿" if doc.docstatus == 0 else ("已取消" if doc.docstatus == 2 else ""),
		"units": sorted({line["unit"] for line in lines}),
	}
	if len(cache) >= 8:
		cache.clear()
	cache[cache_key] = result
	return result


def _record_format(doctype):
	meta = frappe.get_meta(doctype)
	default = meta.default_print_format
	if default:
		row = frappe.db.get_value("Print Format", default, ["name", "doc_type", "disabled"], as_dict=True)
		if row and row.doc_type == doctype and not row.disabled:
			return row.name
	return "物资单据" if doctype == "Stock Entry" else "盘点单"


@frappe.whitelist(methods=["GET"])
def print_record_pdf(doctype, name):
	"""Render an authorized native movement or count as an inline PDF slip."""
	require_app()
	if doctype not in ("Stock Entry", "Stock Reconciliation"):
		frappe.throw("不支持打印此记录类型", frappe.ValidationError)
	doc = frappe.get_doc(doctype, name)
	ti_record(doc)  # serialize performs read and complete warehouse scope checks.
	previous_print_permission = getattr(frappe.flags, "ignore_print_permissions", False)
	# Native app access and hidden-row scope checks authorize this slip; Frappe's print toggle
	# would otherwise block the required draft/cancelled watermarked copies.
	frappe.flags.ignore_print_permissions = True
	try:
		pdf = render_pdf(doctype, name, _record_format(doctype), doc)
	finally:
		frappe.flags.ignore_print_permissions = previous_print_permission
	frappe.local.response.filename = f"{name}.pdf"
	frappe.local.response.filecontent = pdf
	frappe.local.response.type = "pdf"
	frappe.local.response.display_content_as = "inline"
	return pdf


@frappe.whitelist(methods=["GET"])
def print_record_html(doctype, name):
	"""Return a standalone, browser-printable HTML slip for an authorized native record."""
	require_app()
	if doctype not in ("Stock Entry", "Stock Reconciliation"):
		frappe.throw("不支持打印此记录类型", frappe.ValidationError)
	doc = frappe.get_doc(doctype, name)
	ti_record(doc)
	previous_print_permission = getattr(frappe.flags, "ignore_print_permissions", False)
	frappe.flags.ignore_print_permissions = True
	try:
		html = frappe.get_print(
			doctype,
			name,
			print_format=_record_format(doctype),
			doc=doc,
			as_pdf=False,
			no_letterhead=1,
		)
	except frappe.PermissionError, frappe.ValidationError:
		raise
	except Exception:
		frappe.log_error(title=f"HTML print failed: {doctype} {name}")
		frappe.throw("打印失败，请稍后重试", frappe.ValidationError)
	finally:
		frappe.flags.ignore_print_permissions = previous_print_permission
	# Printview may add Desk asset tags around the format. The format's print CSS is
	# inline, so remove external dependencies before sending it to an iframe.
	html = re.sub(r"<link\b[^>]*>", "", html, flags=re.IGNORECASE)
	html = re.sub(r"<script\b[^>]*>.*?</script\s*>", "", html, flags=re.IGNORECASE | re.DOTALL)
	if not re.search(r"<html\b", html, flags=re.IGNORECASE):
		html = f'<!doctype html><html><head><meta charset="utf-8"></head><body>{html}</body></html>'
	frappe.local.response.type = "json"
	return {"html": html, "title": doc.name}


def profile_print():
	"""Profile warm record print endpoints for the three standard dev samples."""
	import json
	import statistics
	import time

	frappe.local.lang = "en"
	frappe.set_user("Administrator")
	records = [
		(
			"newest Stock Entry",
			"Stock Entry",
			frappe.db.get_value("Stock Entry", {"docstatus": 1}, "name", order_by="creation desc, name desc"),
		),
		(
			"newest Stock Reconciliation",
			"Stock Reconciliation",
			frappe.db.get_value(
				"Stock Reconciliation",
				{"docstatus": 1},
				"name",
				order_by="creation desc, name desc",
			),
		),
		(
			"most rows Stock Reconciliation",
			"Stock Reconciliation",
			frappe.db.sql(
				"""select item.parent from `tabStock Reconciliation Item` item
				inner join `tabStock Reconciliation` parent on parent.name = item.parent
				where parent.docstatus = 1 group by item.parent
				order by count(*) desc, item.parent desc limit 1""",
				as_list=True,
			)[0][0],
		),
	]
	results = []
	for label, doctype, name in records:
		doc = frappe.get_doc(doctype, name)
		original_permission = getattr(frappe.flags, "ignore_print_permissions", False)
		frappe.flags.ignore_print_permissions = True
		try:

			def reset_request_cache():
				frappe.local.ti_record_print_cache = {}

			def time_endpoint(endpoint):
				reset_request_cache()
				started = time.perf_counter()
				endpoint(doctype, name)
				return time.perf_counter() - started

			reset_request_cache()
			print_record_html(doctype, name)
			reset_request_cache()
			print_record_pdf(doctype, name)
			html_times = [time_endpoint(print_record_html) for _ in range(5)]
			pdf_times = [time_endpoint(print_record_pdf) for _ in range(5)]
			original_sql = frappe.db.sql
			query_count = [0]

			def count_sql(*args, **kwargs):
				query_count[0] += 1
				return original_sql(*args, **kwargs)

			frappe.db.sql = count_sql
			try:
				reset_request_cache()
				print_record_html(doctype, name)
			finally:
				frappe.db.sql = original_sql
		finally:
			frappe.flags.ignore_print_permissions = original_permission
		results.append(
			{
				"sample": label,
				"doctype": doctype,
				"name": name,
				"rows": len(doc.get("items") or []),
				"html_median_s": round(statistics.median(html_times), 4),
				"pdf_median_s": round(statistics.median(pdf_times), 4),
				"html_queries": query_count[0],
			}
		)
	print(json.dumps(results, ensure_ascii=False, indent=2))
	return results
