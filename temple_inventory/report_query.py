"""Canonical report scope shared by browse, analysis, named views and export jobs."""

import copy

import frappe

from temple_inventory.periods import PERIOD_KEYS, resolve_period

DEFINITIONS = {
	"inventory": {
		"views": ("summary", "locations", "historical"),
		"groups": ("item", "category", "location", "month"),
	},
	"expiry": {"views": ("batches",), "groups": ("item", "category", "location")},
	"movements": {
		"views": ("summary", "records", "lines"),
		"groups": (
			"item",
			"category",
			"location",
			"source",
			"destination",
			"kind",
			"status",
			"activity",
			"month",
		),
	},
	"loans": {
		"views": ("records", "items", "outcomes", "settlements"),
		"groups": ("item", "category", "activity", "borrower", "status", "outcome", "month"),
	},
	"activities": {
		"views": ("metadata", "records", "loans"),
		"groups": ("activity", "activityType", "kind", "status", "month", "item", "borrower", "outcome"),
	},
	"counts": {"views": ("records", "lines"), "groups": ("item", "location", "kind", "status", "month")},
}
SORTABLE_COLUMNS = {
	("inventory", "summary"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"available",
		"loaned",
		"damaged",
		"stock_qty",
	),
	("inventory", "locations"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"warehouse_label",
		"batch_no",
		"available",
		"loaned",
		"damaged",
		"stock_qty",
	),
	("inventory", "historical"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"warehouse",
		"period_from",
		"period_to",
		"opening",
		"incoming",
		"outgoing",
		"adjustment",
		"closing",
	),
	("expiry", "batches"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"warehouse",
		"batch_no",
		"expiry_date",
		"remaining_days",
		"stock_qty",
	),
	("movements", "summary"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"kind",
		"docstatus",
		"stock_qty",
		"available_effect",
	),
	("movements", "records"): (
		"identity",
		"document",
		"doctype",
		"kind",
		"docstatus",
		"date",
		"time",
		"modified",
		"item_count",
		"stock_uom",
	),
	("movements", "lines"): (
		"identity",
		"document",
		"doctype",
		"item_name",
		"item_code",
		"category",
		"kind",
		"docstatus",
		"date",
		"time",
		"source_warehouse",
		"destination_warehouse",
		"stock_uom",
		"activity",
		"borrower",
		"stock_qty",
		"available_effect",
	),
	("loans", "records"): (
		"identity",
		"document",
		"doctype",
		"borrower",
		"activity_title",
		"loan_status",
		"date",
		"time",
		"modified",
		"stock_uom",
		"outstanding",
	),
	("loans", "items"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"outstanding",
		"borrowed",
		"returned",
		"damaged",
		"lost",
	),
	("loans", "outcomes"): (
		"identity",
		"document",
		"doctype",
		"item_name",
		"item_code",
		"category",
		"kind",
		"docstatus",
		"date",
		"time",
		"source_warehouse",
		"destination_warehouse",
		"stock_uom",
		"borrower",
		"activity_title",
		"outcome",
		"outstanding",
		"borrowed",
	),
	("loans", "settlements"): (
		"identity",
		"document",
		"doctype",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"borrower",
		"activity_title",
		"outcome",
		"date",
		"stock_qty",
	),
	("activities", "metadata"): (
		"identity",
		"title",
		"activity_type_label",
		"status",
		"start_date",
		"end_date",
		"modified",
		"document_count",
	),
	("activities", "records"): (
		"identity",
		"document",
		"doctype",
		"kind",
		"docstatus",
		"date",
		"time",
		"modified",
		"activity_title",
	),
	("activities", "loans"): (
		"identity",
		"document",
		"doctype",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"borrower",
		"activity_title",
		"outcome",
		"date",
		"outstanding",
	),
	("counts", "records"): (
		"identity",
		"document",
		"doctype",
		"kind",
		"docstatus",
		"date",
		"time",
		"modified",
		"item_count",
		"stock_uom",
		"difference",
	),
	("counts", "lines"): (
		"identity",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"warehouse",
		"kind",
		"date",
		"baseline_qty",
		"actual_qty",
		"difference",
	),
}


def group_sequences_for_view(dataset, view):
	"""List ordered group field sequences accepted by one report grain."""
	fields = {
		("inventory", "summary"): ("category", "item"),
		("inventory", "locations"): ("category", "item", "location"),
		("inventory", "historical"): ("category", "item", "location", "month"),
		("expiry", "batches"): ("category", "item", "location"),
		("movements", "summary"): ("item", "category"),
		("movements", "records"): ("kind", "status", "activity", "month"),
		("movements", "lines"): (
			"item",
			"category",
			"source",
			"destination",
			"kind",
			"activity",
			"month",
		),
		("loans", "records"): ("borrower", "activity", "status", "month"),
		("loans", "items"): ("item", "category"),
		("loans", "outcomes"): ("item", "borrower", "activity", "outcome", "month"),
		("loans", "settlements"): ("item", "borrower", "activity", "outcome", "month"),
		("activities", "metadata"): ("activityType", "status"),
		("activities", "records"): ("kind", "status", "month"),
		("activities", "loans"): ("item", "borrower", "activity", "outcome", "month"),
		("counts", "records"): ("kind", "status", "month"),
		("counts", "lines"): ("item", "location", "month"),
	}.get((dataset, view), ())
	if (dataset, view) in (("movements", "summary"), ("loans", "items")):
		return [[], ["item"], ["category", "item"]]
	return [
		[],
		*[[field] for field in fields],
		*[[first, second] for first in fields for second in fields if first != second],
	]


def sortable_field(dataset, view, field):
	columns = SORTABLE_COLUMNS[(dataset, view)]
	return field if field in columns else None


PERIOD_DEFAULT = {"key": "all", "from": "", "to": ""}
SCOPE_DEFAULT = {
	"period": PERIOD_DEFAULT,
	"warehouses": [],
	"categories": [],
	"uncategorized": False,
	"item": "",
	"activity": "",
	"sources": [],
	"destinations": [],
	"kinds": [],
	"tracking": "all",
}
QUERY_DEFAULT = {
	"search": "",
	"batchNo": "",
	"batchNoExact": False,
	"groupBy": [],
	"sort": "asc",
	"sortBy": "identity",
	"statuses": [1],
	"includeZero": False,
	"loanScope": "outstanding",
	"includeUndated": True,
	"activityStatus": "all",
	"typeId": "",
	"record": "",
	"recordDoctype": "",
	"loan": "",
	"itemCodes": [],
	"restrictItems": False,
	"itemLocationKeys": [],
	"relatedPeriod": PERIOD_DEFAULT,
	"relatedSearch": "",
	"loanStatus": "all",
	"loanOutcome": "all",
	"expiryWindow": "period",
	"countReviewed": "all",
	"allocationKeys": [],
	"restrictAllocations": False,
	"damageOnly": False,
	"activityKind": "",
	"relatedPresence": "all",
	"outstandingOnly": False,
	"borrower": "",
	"itemStatus": "enabled",
	"person": {"name": "", "role": "any"},
}


def _period(value):
	if not isinstance(value, dict) or value.get("key") not in PERIOD_KEYS:
		frappe.throw("请选择有效的日期范围")
	result = {field: str(value.get(field) or "") for field in ("key", "from", "to")}
	resolve_period({"period_key": result["key"], "date_from": result["from"], "date_to": result["to"]})
	return result


def _strings(values):
	if not isinstance(values, list) or len(values) > 10000:
		frappe.throw("筛选范围无效")
	if any(not isinstance(value, str) or len(value) > 2000 for value in values):
		frappe.throw("筛选范围无效")
	return list(dict.fromkeys(values))


def validate_query(value):
	value = frappe.parse_json(value)
	if not isinstance(value, dict):
		frappe.throw("导出设置无效")
	if "grouping" in value:
		frappe.throw("分组设置格式已更新，请重新选择分组")  # noqa: RUF001
	dataset = value.get("dataset", "inventory")
	if dataset not in DEFINITIONS:
		frappe.throw("请选择有效的数据集")
	definition = DEFINITIONS[dataset]
	view = definition["views"][0]
	query = {
		**copy.deepcopy(QUERY_DEFAULT),
		"dataset": dataset,
		"view": view,
		"groupBy": [],
	}
	for field, default in QUERY_DEFAULT.items():
		if field not in value:
			continue
		if field == "person":
			continue
		candidate = value[field]
		if isinstance(default, bool):
			if type(candidate) is not bool:
				frappe.throw("筛选值必须为是或否")
		elif isinstance(default, str):
			if not isinstance(candidate, str) or len(candidate) > 2000:
				frappe.throw("筛选文字无效或过长")
		elif isinstance(default, list):
			if field == "statuses":
				if not isinstance(candidate, list) or any(
					type(status) is not int or status not in (0, 1, 2) for status in candidate
				):
					frappe.throw("请选择有效的单据状态")
			else:
				candidate = _strings(candidate)
		else:
			candidate = _period(candidate)
		query[field] = candidate
	query["view"] = value.get("view", query["view"])
	if query["view"] not in definition["views"]:
		frappe.throw("此数据集不支持所选视图或分组")
	group_by = value.get("groupBy", query["groupBy"])
	if (
		not isinstance(group_by, list)
		or len(group_by) > 2
		or any(not isinstance(field, str) or field not in definition["groups"] for field in group_by)
	):
		frappe.throw("此数据集不支持所选视图或分组")
	if len(group_by) != len(set(group_by)):
		frappe.throw("分组字段不能重复")
	view_groups = {
		("inventory", "summary"): ("category", "item"),
		("inventory", "locations"): ("category", "item", "location"),
		("inventory", "historical"): ("category", "item", "location", "month"),
		("expiry", "batches"): ("category", "item", "location"),
		("movements", "summary"): ("item", "category"),
		("movements", "records"): ("kind", "status", "activity", "month"),
		("movements", "lines"): (
			"item",
			"category",
			"source",
			"destination",
			"kind",
			"activity",
			"month",
		),
		("loans", "records"): ("borrower", "activity", "status", "month"),
		("loans", "items"): ("item", "category"),
		("loans", "outcomes"): ("item", "borrower", "activity", "outcome", "month"),
		("loans", "settlements"): ("item", "borrower", "activity", "outcome", "month"),
		("activities", "metadata"): ("activityType", "status"),
		("activities", "records"): ("kind", "status", "month"),
		("activities", "loans"): ("item", "borrower", "activity", "outcome", "month"),
		("counts", "records"): ("kind", "status", "month"),
		("counts", "lines"): ("item", "location", "month"),
	}.get((dataset, query["view"]), definition["groups"])
	if any(field not in view_groups for field in group_by):
		frappe.throw("此数据集不支持所选视图或分组")
	if group_by not in group_sequences_for_view(dataset, query["view"]):
		frappe.throw("此数据集不支持所选视图或分组顺序")
	query["groupBy"] = list(group_by)
	if dataset == "loans" and query["view"] == "items":
		query.update({"statuses": [1], "loanStatus": "all", "outstandingOnly": False})
	if dataset == "activities":
		query["statuses"] = [1]
	if (
		query["sort"] not in ("asc", "desc")
		or query["sortBy"] not in SORTABLE_COLUMNS[(dataset, query["view"])]
	):
		frappe.throw("请选择有效的排序")
	for field, allowed in {
		"activityStatus": ("all", "active", "archived"),
		"loanStatus": ("all", "outstanding", "open", "settled"),
		"loanScope": ("outstanding", "all"),
		"loanOutcome": ("all", "outstanding", "returned", "damaged", "lost"),
		"itemStatus": ("enabled", "disabled", "all"),
		"countReviewed": ("all", "reviewed", "unreviewed", "difference"),
		"relatedPresence": ("all", "yes", "no", "with", "without"),
		"expiryWindow": (
			"period",
			"expired",
			"unexpired",
			"undated",
			"next_7",
			"next_30",
			"next_90",
			"next_365",
		),
	}.items():
		if query[field] not in allowed:
			frappe.throw("请选择有效的筛选值")
	person = value.get("person", {})
	if not isinstance(person, dict) or not isinstance(person.get("name", ""), str):
		frappe.throw("人员筛选无效")
	role = person.get("role", "any")
	if role not in ("any", "recorder", "handler", "reviewer"):
		frappe.throw("人员筛选无效")
	query["person"] = {"name": person.get("name", "")[:2000], "role": role}
	scope = value.get("scope", {})
	if not isinstance(scope, dict):
		frappe.throw("筛选范围无效")
	query["scope"] = copy.deepcopy(SCOPE_DEFAULT)
	for field, default in SCOPE_DEFAULT.items():
		if field not in scope:
			continue
		if isinstance(default, list):
			query["scope"][field] = _strings(scope[field])
		elif isinstance(default, dict):
			query["scope"][field] = _period(scope[field])
		elif isinstance(default, bool) and type(scope[field]) is bool:
			query["scope"][field] = scope[field]
		elif isinstance(scope[field], str):
			query["scope"][field] = scope[field]
		else:
			frappe.throw("筛选范围无效")
	if query["scope"]["tracking"] not in ("all", "batch", "expiry", "none", "batch_only"):
		frappe.throw("请选择有效的物品追踪方式")
	if query["scope"]["tracking"] == "batch_only" and dataset != "expiry":
		frappe.throw("此数据集不支持该物品追踪筛选")
	if dataset == "inventory" and query["view"] == "historical" and query["scope"]["period"]["key"] == "all":
		frappe.throw("历史库存需要有起止日期的范围")
	return query


def resolved_period(period):
	return resolve_period({"period_key": period["key"], "date_from": period["from"], "date_to": period["to"]})


def in_period(value, period):
	date = str(value or "")[:10]
	return (not period["date_from"] or date >= period["date_from"]) and (
		not period["date_to"] or date <= period["date_to"]
	)
