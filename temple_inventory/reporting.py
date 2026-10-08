"""Permission-scoped, in-memory exports for the volunteer inventory UI."""

from collections import defaultdict
from datetime import datetime
from io import BytesIO

import frappe
import xlsxwriter
from frappe import _
from frappe.desk.utils import provide_binary_file
from frappe.utils import add_days, cint, flt, getdate, nowdate
from frappe.utils.csvutils import UnicodeWriter

from temple_inventory.inventory_api import (
	_allowed_warehouses,
	_bin_balances,
	_current_batch_balances,
	_expiring_batch_group_names,
	_loads,
	_physical_tree,
	_require_stock,
	_selected_leaf_warehouses,
	_selection_values,
	_settings,
	_user_facing_warehouse_presentation,
	_visible_warehouses,
)
from temple_inventory.workspace_api import (
	MOVEMENT_LEDGER_KINDS,
	MOVEMENT_OVERVIEW_KINDS,
	_ledger_activity_titles,
	_ledger_item_rows,
	_movement_history_records,
	_movement_overview_rows,
	_movement_period,
)

REPORT_TYPES = {"movement", "movement_records", "current_stock", "warehouse_stock", "expiry"}
EXPORT_FORMATS = {"xlsx", "csv"}
MOVEMENT_LABELS = {
	"Receive": "入库",
	"Issue": "出库",
	"Transfer": "转移",
	"Loan": "借出",
	"Return": "归还",
	"Damage": "标记损坏",
	"Loss": "记录遗失",
	"Repair": "修复归库",
	"Disposal": "正式报废",
	"Reconcile": "库存调整",
}

MOVEMENT_SUMMARY_COLUMNS = (
	("movement_kind_label", "动作"),
	("stock_uom", "单位"),
	("total_qty", "总数量"),
	("item_count", "不同物品数"),
	("category_count", "不同类别数"),
	("record_count", "记录数"),
)
MOVEMENT_ITEM_COLUMNS = (
	("movement_kind_label", "动作"),
	("item_code", "物品编码"),
	("item_name", "物品名称"),
	("item_group", "类别"),
	("total_qty", "合计数量"),
	("stock_uom", "单位"),
	("record_count", "相关记录数"),
	("last_posting_date", "最近变动日期"),
)
MOVEMENT_DETAIL_COLUMNS = (
	("posting_date", "日期"),
	("movement_kind_label", "动作"),
	("entry", "记录编号"),
	("item_code", "物品编码"),
	("item_name", "物品名称"),
	("item_group", "类别"),
	("qty", "交易数量"),
	("uom", "交易单位"),
	("stock_qty", "数量"),
	("stock_uom", "单位"),
	("source_warehouse", "来源位置"),
	("destination_warehouse", "去向位置"),
	("source_text", "来源"),
	("purpose_text", "用途"),
	("activity_title", "活动"),
	("recorder_name", "记录人"),
	("handler_name", "经手人"),
	("reviewer_name", "鉴证人"),
	("notes", "备注"),
)
MOVEMENT_RECORD_COLUMNS = (
	("posting_date", "日期"),
	("record_name", "记录编号"),
	("movement_kind_label", "类型"),
	("docstatus_label", "状态"),
	("line_count", "物品行数"),
	("quantities", "数量"),
	("source_warehouse", "来源位置"),
	("destination_warehouse", "去向位置"),
	("activity_title", "活动"),
	("notes", "备注"),
)
CURRENT_SUMMARY_COLUMNS = (
	("item_code", "物品编码"),
	("item_name", "物品名称"),
	("item_group", "类别"),
	("available_qty", "可用总量"),
	("stock_uom", "单位"),
	("batch_count", "批次数"),
	("next_expiry_date", "最近到期日期"),
)
CURRENT_DETAIL_COLUMNS = (
	("item_code", "物品编码"),
	("item_name", "物品名称"),
	("item_group", "类别"),
	("item_available_qty", "物品可用总量"),
	("stock_uom", "单位"),
	("batch_no", "批次"),
	("batch_qty", "批次数量"),
	("expiry_date", "到期日期"),
	("locations", "位置"),
)
WAREHOUSE_COLUMNS = (
	("warehouse_label", "位置"),
	("item_code", "物品编码"),
	("item_name", "物品名称"),
	("item_group", "类别"),
	("batch_no", "批次"),
	("expiry_date", "到期日期"),
	("qty", "数量"),
	("stock_uom", "单位"),
)
EXPIRY_COLUMNS = (
	("batch_no", "批次"),
	("item_code", "物品编码"),
	("item_name", "物品名称"),
	("item_group", "类别"),
	("expiry_date", "到期日期"),
	("days_to_expiry", "剩余/逾期天数"),
	("warehouse_label", "位置"),
	("qty", "当前位置数量"),
	("stock_uom", "单位"),
)


def _validated_filters(filters):
	value = _loads(filters, {})
	if not isinstance(value, dict):
		frappe.throw(_("Invalid report filters"))
	return value


def _warehouse_scope(filters, require_one=False):
	settings = _settings()
	physical = _physical_tree(settings)
	requested = _selection_values(filters.get("warehouses") or filters.get("warehouse"))
	if require_one and len(requested) != 1:
		frappe.throw(_("Choose one warehouse for this report"))
	if any(value not in physical for value in requested):
		frappe.throw(_("请选择寺院库存范围内的位置"), frappe.PermissionError)
	selected = _selected_leaf_warehouses(requested, physical) if requested else {
		name for name, row in physical.items() if not row.is_group
	}
	allowed = set(_allowed_warehouses(settings))
	if requested and any(not physical[value].is_group and value not in allowed for value in requested):
		frappe.throw(_("您没有读取所选库存位置的权限"), frappe.PermissionError)
	selected &= allowed
	selected = {name for name in selected if frappe.has_permission("Warehouse", "read", name)}
	if require_one and not selected:
		frappe.throw(_("所选仓库没有可读取的库存位置"), frappe.PermissionError)
	labels = {
		row["name"]: row["breadcrumb"]
		for row in _user_facing_warehouse_presentation(settings, physical)
	}
	return settings, physical, selected, labels


def _item_group_scope(values):
	selected = _selection_values(values)
	if not selected:
		return set()
	groups = _expiring_batch_group_names(selected)
	if not groups:
		frappe.throw(_("Invalid item group"), frappe.PermissionError)
	return groups


def _stock_rows(filters, require_one_warehouse=False):
	"""Return positive physical stock at item, batch, and leaf-warehouse grain."""
	_require_stock()
	_settings_row, _physical, warehouses, labels = _warehouse_scope(filters, require_one_warehouse)
	if not warehouses:
		return []
	bins = [row for row in _bin_balances(warehouses) if flt(row.actual_qty) > 1e-9]
	item_codes = sorted({row.item_code for row in bins})
	if not item_codes:
		return []
	items = frappe.get_list(
		"Item",
		filters={"name": ("in", item_codes), "disabled": 0, "is_stock_item": 1},
		fields=["name", "item_code", "item_name", "item_group", "stock_uom", "has_batch_no"],
		limit_page_length=0,
	)
	groups = _item_group_scope(filters.get("item_groups") or filters.get("item_group"))
	if groups:
		items = [row for row in items if row.item_group in groups]
	by_code = {row.name: row for row in items}
	bins = [row for row in bins if row.item_code in by_code]
	batch_items = sorted(name for name, row in by_code.items() if cint(row.has_batch_no))
	batches = frappe.get_list(
		"Batch",
		filters={"item": ("in", batch_items or [""])},
		fields=["name", "item", "expiry_date"],
		limit_page_length=0,
	) if batch_items else []
	batch_balances = _current_batch_balances(
		[row.name for row in batches],
		batch_items,
		warehouses,
	)
	batches_by_item = defaultdict(list)
	for batch in batches:
		batches_by_item[batch.item].append(batch)
	bin_by_key = {(row.item_code, row.warehouse): flt(row.actual_qty) for row in bins}
	rows = []
	for item_code, item in by_code.items():
		if cint(item.has_batch_no):
			reported = defaultdict(float)
			for batch in batches_by_item[item_code]:
				for warehouse in warehouses:
					qty = flt(batch_balances.get((batch.name, warehouse)))
					if qty <= 1e-9:
						continue
					reported[warehouse] += qty
					rows.append(_stock_row(item, warehouse, labels, qty, batch.name, batch.expiry_date))
			for warehouse in warehouses:
				unassigned = bin_by_key.get((item_code, warehouse), 0) - reported[warehouse]
				if unassigned > 1e-9:
					rows.append(_stock_row(item, warehouse, labels, unassigned))
		else:
			for warehouse in warehouses:
				qty = bin_by_key.get((item_code, warehouse), 0)
				if qty > 1e-9:
					rows.append(_stock_row(item, warehouse, labels, qty))
	search = str(filters.get("search") or "").strip().lower()
	if search:
		barcode_items = set(
			frappe.get_all("Item Barcode", filters={"barcode": ("like", f"%{search}%")}, pluck="parent")
		)
		rows = [
			row
			for row in rows
			if search in f"{row['item_code']} {row['item_name']} {row['item_group']} {row['batch_no']}".lower()
			or row["item_code"] in barcode_items
		]
	return sorted(
		rows,
		key=lambda row: (
			str(row["item_name"]).lower(),
			row["item_code"],
			row["batch_no"],
			row["expiry_date"],
			row["warehouse_label"],
		),
	)


def _stock_row(item, warehouse, labels, qty, batch_no="", expiry_date=None):
	return {
		"item_code": item.item_code,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"stock_uom": item.stock_uom,
		"warehouse": warehouse,
		"warehouse_label": labels.get(warehouse, warehouse),
		"batch_no": batch_no or "",
		"expiry_date": str(expiry_date or ""),
		"qty": flt(qty),
	}


def _movement_sheets(filters):
	period, rows = _movement_overview_rows(filters)
	requested = _selection_values(filters.get("movement_kinds")) or ["Receive", "Issue", "Transfer"]
	if any(kind not in MOVEMENT_OVERVIEW_KINDS for kind in requested):
		frappe.throw(_("Invalid movement kind"))
	rows = [row for row in rows if row["movement_kind"] in requested]
	settings = _settings()
	warehouse_labels = {
		row["name"]: row["breadcrumb"]
		for row in _user_facing_warehouse_presentation(settings, _physical_tree(settings))
	}
	warehouse_labels.update(
		{
			name: row.warehouse_name
			for name, row in _visible_warehouses(settings).items()
			if name not in warehouse_labels
		}
	)
	activity_names = {row.get("activity") for row in rows if row.get("activity")}
	activities = {
		row.name: row.title
		for row in frappe.get_list(
			"Inventory Activity",
			filters={"name": ("in", sorted(activity_names) or [""])},
			fields=["name", "title"],
			limit_page_length=0,
		)
	} if activity_names else {}
	details = []
	for row in rows:
		details.append(
			{
				**row,
				"movement_kind_label": MOVEMENT_LABELS[row["movement_kind"]],
				"source_warehouse": warehouse_labels.get(row.get("s_warehouse"), ""),
				"destination_warehouse": warehouse_labels.get(row.get("t_warehouse"), ""),
				"activity_title": activities.get(row.get("activity"), row.get("activity") or ""),
			}
		)
	by_action_uom = defaultdict(lambda: {"qty": 0.0, "items": set(), "categories": set(), "records": set()})
	by_action = defaultdict(lambda: {"items": set(), "categories": set(), "records": set()})
	by_item = defaultdict(lambda: {"qty": 0.0, "records": set(), "last": ""})
	for row in details:
		action_key = (row["movement_kind"], row["stock_uom"])
		action = by_action_uom[action_key]
		action["qty"] += row["stock_qty"]
		action["items"].add(row["item_code"])
		action["categories"].add(row["item_group"])
		action["records"].add(row["entry"])
		action_totals = by_action[row["movement_kind"]]
		action_totals["items"].add(row["item_code"])
		action_totals["categories"].add(row["item_group"])
		action_totals["records"].add(row["entry"])
		item_key = (row["movement_kind"], row["item_code"], row["stock_uom"])
		item = by_item[item_key]
		item["qty"] += row["stock_qty"]
		item["records"].add(row["entry"])
		item["last"] = max(item["last"], row["posting_date"])
	summaries = [
		{
			"movement_kind_label": MOVEMENT_LABELS[kind],
			"stock_uom": uom,
			"total_qty": flt(values["qty"]),
			"item_count": len(by_action[kind]["items"]),
			"category_count": len(by_action[kind]["categories"]),
			"record_count": len(by_action[kind]["records"]),
		}
		for (kind, uom), values in by_action_uom.items()
	]
	item_meta = {row["item_code"]: row for row in details}
	item_rows = [
		{
			"movement_kind_label": MOVEMENT_LABELS[kind],
			"item_code": item_code,
			"item_name": item_meta[item_code]["item_name"],
			"item_group": item_meta[item_code]["item_group"],
			"total_qty": flt(values["qty"]),
			"stock_uom": uom,
			"record_count": len(values["records"]),
			"last_posting_date": values["last"],
		}
		for (kind, item_code, uom), values in by_item.items()
	]
	summaries.sort(key=lambda row: (list(MOVEMENT_LABELS.values()).index(row["movement_kind_label"]), row["stock_uom"]))
	item_rows.sort(key=lambda row: (row["movement_kind_label"], str(row["item_name"]).lower(), row["item_code"]))
	sort_by = str(filters.get("sort_by") or "").strip()
	sort_order = str(filters.get("sort_order") or "desc").strip().lower()
	if sort_by in {"item_name", "record_count", "last_posting_date"} and sort_order in {"asc", "desc"}:
		item_rows.sort(
			key=lambda row: (
				flt(row[sort_by])
				if sort_by == "record_count"
				else str(row[sort_by]).lower()
			),
			reverse=sort_order == "desc",
		)
	details.sort(key=lambda row: (row["posting_date"], row["entry"], row["line_name"]), reverse=True)
	return period, [
		("动作汇总", MOVEMENT_SUMMARY_COLUMNS, summaries),
		("物品汇总", MOVEMENT_ITEM_COLUMNS, item_rows),
		("记录明细", MOVEMENT_DETAIL_COLUMNS, details),
	]


def _movement_ledger_sheets(filters):
	"""Export every matching posted movement line, independent of UI paging."""
	filters = {"period_key": "this_month", **filters}
	period = _movement_period(filters, default=True)
	requested = _selection_values(filters.get("movement_kinds")) or list(MOVEMENT_LEDGER_KINDS)
	if any(kind not in MOVEMENT_LEDGER_KINDS for kind in requested):
		frappe.throw(_("Invalid movement kind"))
	records = _movement_history_records({**filters, "movement_kinds": requested}, docstatuses=[1])
	rows = _ledger_item_rows(records)
	_ledger_activity_titles(rows)
	settings = _settings()
	warehouse_labels = {
		row["name"]: row["breadcrumb"]
		for row in _user_facing_warehouse_presentation(settings, _physical_tree(settings))
	}
	for row in rows:
		row["movement_kind_label"] = MOVEMENT_LABELS[row["movement_kind"]]
		row["source_warehouse"] = warehouse_labels.get(row.get("source_warehouse"), "")
		row["destination_warehouse"] = warehouse_labels.get(row.get("destination_warehouse"), "")
		if row["movement_kind"] == "Loan":
			row["destination_warehouse"] = "借出"
		elif row["movement_kind"] == "Return":
			row["source_warehouse"] = "借出"
		row["activity_title"] = row.get("activity_title") or row.get("activity") or ""
	rows.sort(key=lambda row: (row.get("posting_date", ""), row.get("posting_time", ""), row.get("record_name", "")), reverse=True)
	return period, [("记录明细", MOVEMENT_DETAIL_COLUMNS, rows)]


def _movement_record_sheets(filters):
	filters = {"period_key": "this_month", **filters}
	period = _movement_period(filters, default=True)
	requested = _selection_values(filters.get("movement_kinds")) or list(MOVEMENT_LEDGER_KINDS)
	if any(kind not in MOVEMENT_LEDGER_KINDS for kind in requested):
		frappe.throw(_("Invalid movement kind"))
	statuses = [cint(value) for value in _selection_values(filters.get("docstatuses"))] if filters.get("docstatuses") is not None else [0, 1]
	if any(status not in (0, 1, 2) for status in statuses):
		frappe.throw(_("Invalid document status"))
	records = _movement_history_records({**filters, "movement_kinds": requested}, docstatuses=statuses)
	rows = []
	settings = _settings()
	warehouse_labels = {row["name"]: row["breadcrumb"] for row in _user_facing_warehouse_presentation(settings, _physical_tree(settings))}
	all_record_items = _ledger_item_rows(records)
	_ledger_activity_titles(all_record_items)
	activity_titles = {
		item.get("record_name"): item.get("activity_title")
		for item in all_record_items
		if item.get("record_name")
	}
	for record in records:
		kind = "Reconcile" if record.get("movement_kind") in ("盘点调整", "Reconcile") else record.get("movement_kind")
		items = _ledger_item_rows([record])
		if kind == "Reconcile" and not items:
			continue
		quantities = defaultdict(float)
		for item in items:
			quantities[item["stock_uom"]] += abs(flt(item["stock_qty"]))
		sources = list(dict.fromkeys(item.get("source_warehouse") for item in items if item.get("source_warehouse")))
		destinations = list(dict.fromkeys(item.get("destination_warehouse") for item in items if item.get("destination_warehouse")))
		source = "、".join(warehouse_labels.get(value, "") for value in sources if warehouse_labels.get(value, ""))
		destination = "、".join(warehouse_labels.get(value, "") for value in destinations if warehouse_labels.get(value, ""))
		if kind == "Loan": destination = "借出"
		if kind == "Return": source = "借出"
		rows.append({
			"posting_date": record.get("posting_date", ""),
			"record_name": record.get("name", ""),
			"movement_kind_label": MOVEMENT_LABELS[kind],
			"docstatus_label": {0: "草稿", 2: "已取消"}.get(cint(record.get("docstatus")), ""),
			"line_count": len(items),
			"quantities": " · ".join(f"{flt(qty):g} {uom}" for uom, qty in sorted(quantities.items()) if uom),
			"source_warehouse": source,
			"destination_warehouse": destination,
			"activity_title": next(
				(item.get("activity_title") for item in items if item.get("activity_title")),
				activity_titles.get(record.get("name"), record.get("activity", "")),
			),
			"notes": record.get("notes", "") or record.get("title", ""),
		})
	return period, [("记录明细", MOVEMENT_RECORD_COLUMNS, rows)]


def _current_stock_sheets(filters):
	rows = _stock_rows(filters)
	window = str(filters.get("expiry_window") or "").strip().lower()
	if window and window != "all":
		start, end = _expiry_bounds(filters)
		matching_items = set()
		for row in rows:
			if window == "none":
				if not row["expiry_date"]:
					matching_items.add(row["item_code"])
				continue
			if not row["expiry_date"]:
				continue
			expiry = getdate(row["expiry_date"])
			if (not start or expiry >= start) and (not end or expiry <= end):
				matching_items.add(row["item_code"])
		rows = [row for row in rows if row["item_code"] in matching_items]
	by_item = defaultdict(lambda: {"qty": 0.0, "batches": set(), "expiries": []})
	by_batch = defaultdict(lambda: {"qty": 0.0, "locations": []})
	meta = {}
	for row in rows:
		meta[row["item_code"]] = row
		item = by_item[row["item_code"]]
		item["qty"] += row["qty"]
		if row["batch_no"]:
			item["batches"].add(row["batch_no"])
		if row["expiry_date"]:
			item["expiries"].append(row["expiry_date"])
		batch = by_batch[(row["item_code"], row["batch_no"], row["expiry_date"])]
		batch["qty"] += row["qty"]
		batch["locations"].append(row["warehouse_label"])
	summary = [
		{
			"item_code": code,
			"item_name": meta[code]["item_name"],
			"item_group": meta[code]["item_group"],
			"available_qty": flt(values["qty"]),
			"stock_uom": meta[code]["stock_uom"],
			"batch_count": len(values["batches"]),
			"next_expiry_date": min(values["expiries"]) if values["expiries"] else "",
		}
		for code, values in by_item.items()
	]
	detail = [
		{
			"item_code": code,
			"item_name": meta[code]["item_name"],
			"item_group": meta[code]["item_group"],
			"item_available_qty": flt(by_item[code]["qty"]),
			"stock_uom": meta[code]["stock_uom"],
			"batch_no": batch_no,
			"batch_qty": flt(values["qty"]),
			"expiry_date": expiry_date,
			"locations": "；".join(sorted(set(values["locations"]))),
		}
		for (code, batch_no, expiry_date), values in by_batch.items()
	]
	summary.sort(key=lambda row: (str(row["item_name"]).lower(), row["item_code"]))
	detail.sort(key=lambda row: (str(row["item_name"]).lower(), row["item_code"], row["expiry_date"], row["batch_no"]))
	sort_by = str(filters.get("sort_by") or "").strip()
	sort_order = str(filters.get("sort_order") or "asc").strip().lower()
	summary_key = {
		"item_name": "item_name",
		"available_stock": "available_qty",
		"total_stock": "available_qty",
	}.get(sort_by)
	if summary_key and sort_order in {"asc", "desc"}:
		summary.sort(
			key=lambda row: (
				flt(row[summary_key])
				if summary_key == "available_qty"
				else str(row[summary_key]).lower()
			),
			reverse=sort_order == "desc",
		)
	return [
		("物品汇总", CURRENT_SUMMARY_COLUMNS, summary),
		("批次明细", CURRENT_DETAIL_COLUMNS, detail),
	]


def _expiry_bounds(filters):
	date_from = str(filters.get("expiry_from") or "").strip()
	date_to = str(filters.get("expiry_to") or "").strip()
	window = str(filters.get("expiry_window") or "").strip().lower()
	if date_from or date_to:
		if window:
			frappe.throw(_("Choose either an expiry window or exact dates"))
		try:
			start = getdate(date_from) if date_from else None
			end = getdate(date_to) if date_to else None
		except Exception:
			frappe.throw(_("Invalid expiry date range"))
		if (start and str(start) != date_from) or (end and str(end) != date_to) or (start and end and start > end):
			frappe.throw(_("Invalid expiry date range"))
		return start, end
	if not window or window == "all" or window == "none":
		return None, None
	valid = {"overdue_within", "overdue_beyond", "remaining_within", "remaining_beyond", "custom"}
	if window not in valid:
		frappe.throw(_("Invalid expiry window"))
	today = getdate(nowdate())
	if window == "custom":
		values = (filters.get("expiry_from_days"), filters.get("expiry_to_days"))
		if any(value in (None, "") or not str(value).strip().lstrip("-").isdigit() for value in values):
			frappe.throw(_("Custom expiry bounds must be integers"))
		start_days, end_days = (int(value) for value in values)
		if not -3650 <= start_days <= end_days <= 3650:
			frappe.throw(_("Custom expiry bounds must be between -3650 and 3650 in ascending order"))
		return getdate(add_days(today, start_days)), getdate(add_days(today, end_days))
	days_text = str(filters.get("expiry_days") or "").strip()
	if not days_text.isdigit() or not 1 <= int(days_text) <= 3650:
		frappe.throw(_("Expiry days must be an integer from 1 to 3650"))
	days = int(days_text)
	if window == "overdue_within":
		return getdate(add_days(today, -days)), getdate(add_days(today, -1))
	if window == "overdue_beyond":
		return None, getdate(add_days(today, -(days + 1)))
	if window == "remaining_within":
		return today, getdate(add_days(today, days))
	return getdate(add_days(today, days + 1)), None


def _expiry_sheets(filters):
	start, end = _expiry_bounds(filters)
	window = str(filters.get("expiry_window") or "").strip().lower()
	rows = []
	for row in _stock_rows(filters):
		if not row["batch_no"]:
			continue
		if window == "none":
			if not row["expiry_date"]:
				rows.append({**row, "days_to_expiry": ""})
			continue
		if window != "none" and not row["expiry_date"]:
			if not window or window == "all":
				rows.append({**row, "days_to_expiry": ""})
			continue
		expiry = getdate(row["expiry_date"])
		if start and expiry < start:
			continue
		if end and expiry > end:
			continue
		rows.append({**row, "days_to_expiry": (expiry - getdate(nowdate())).days})
	rows.sort(key=lambda row: (row["expiry_date"], str(row["item_name"]).lower(), row["warehouse_label"]))
	sort_by = str(filters.get("sort_by") or "expiry_date").strip()
	sort_order = str(filters.get("sort_order") or "asc").strip().lower()
	key = {"item_name": "item_name", "expiry_date": "expiry_date", "total_qty": "qty"}.get(sort_by)
	if key and sort_order in {"asc", "desc"}:
		rows.sort(
			key=lambda row: flt(row[key]) if key == "qty" else str(row[key]).lower(),
			reverse=sort_order == "desc",
		)
	return [("效期明细", EXPIRY_COLUMNS, rows)]


def _warehouse_sheets(filters):
	rows = _stock_rows(filters, require_one_warehouse=True)
	return [("仓库库存", WAREHOUSE_COLUMNS, rows)]


def _xlsx_bytes(sheets):
	output = BytesIO()
	workbook = xlsxwriter.Workbook(output, {"in_memory": True})
	header = workbook.add_format({"bold": True, "bg_color": "#F2E7D5", "border": 1})
	date_format = workbook.add_format({"num_format": "yyyy-mm-dd"})
	quantity_format = workbook.add_format({"num_format": "0.######"})
	integer_format = workbook.add_format({"num_format": "0"})
	for name, columns, rows in sheets:
		worksheet = workbook.add_worksheet(name[:31])
		for column_index, (_key, label) in enumerate(columns):
			worksheet.write_string(0, column_index, label, header)
		for row_index, row in enumerate(rows, start=1):
			for column_index, (key, _label) in enumerate(columns):
				value = row.get(key, "")
				if value in (None, ""):
					worksheet.write_blank(row_index, column_index, None)
				elif key.endswith("_date") or key == "posting_date":
					date = getdate(value)
					worksheet.write_datetime(
						row_index,
						column_index,
						datetime(date.year, date.month, date.day),
						date_format,
					)
				elif isinstance(value, (int, float)) and not isinstance(value, bool):
					style = integer_format if isinstance(value, int) else quantity_format
					worksheet.write_number(row_index, column_index, value, style)
				else:
					worksheet.write_string(row_index, column_index, str(value))
		worksheet.freeze_panes(1, 0)
		if columns:
			worksheet.autofilter(0, 0, max(len(rows), 1), len(columns) - 1)
		for index, (key, label) in enumerate(columns):
			width = min(max(len(label) * 2 + 2, 12, *(len(str(row.get(key, ""))) + 2 for row in rows[:200])), 42)
			worksheet.set_column(index, index, width)
	workbook.close()
	return output.getvalue()


def _csv_bytes(columns, rows):
	writer = UnicodeWriter()
	writer.writerow([label for _key, label in columns])
	for row in rows:
		writer.writerow([row.get(key, "") for key, _label in columns])
	return ("\ufeff" + writer.getvalue()).encode("utf-8")


@frappe.whitelist(methods=["POST"])
def export_report(report_type, export_format, filters=None):
	"""Build one report in memory and return it as a binary download."""
	_require_stock()
	report_type = str(report_type or "").strip()
	export_format = str(export_format or "").strip().lower()
	if report_type not in REPORT_TYPES:
		frappe.throw(_("Invalid report type"))
	if export_format not in EXPORT_FORMATS:
		frappe.throw(_("Invalid export format"))
	f = _validated_filters(filters)
	period = None
	if report_type == "movement":
		period, sheets = _movement_ledger_sheets(f)
	elif report_type == "movement_records":
		period, sheets = _movement_record_sheets(f)
	elif report_type == "current_stock":
		sheets = _current_stock_sheets(f)
	elif report_type == "warehouse_stock":
		sheets = _warehouse_sheets(f)
	else:
		sheets = _expiry_sheets(f)
	names = {
		"movement": "货物流动",
		"movement_records": "货物流动记录",
		"current_stock": "当前库存",
		"warehouse_stock": "仓库库存",
		"expiry": "效期风险",
	}
	filename = f"{names[report_type]}_{nowdate()}"
	if period:
		filename = f"{names[report_type]}_{period['date_from']}_{period['date_to']}"
	if export_format == "xlsx":
		provide_binary_file(filename, "xlsx", _xlsx_bytes(sheets))
	else:
		_name, columns, rows = sheets[-1]
		provide_binary_file(filename, "csv", _csv_bytes(columns, rows))
