"""Canonical report scope shared by browse, analysis, named views and export jobs."""

import copy

import frappe

from temple_inventory.periods import PERIOD_KEYS, resolve_period

DEFINITIONS = {
	"inventory": {
		"views": ("summary", "locations", "historical"),
		"groups": ("item", "category", "location"),
	},
	"expiry": {"views": ("batches",), "groups": ("item", "category", "location")},
	"movements": {
		"views": ("summary", "records", "lines"),
		"groups": ("item", "category", "location", "kind", "activity", "month"),
	},
	"loans": {
		"views": ("records", "outcomes", "settlements"),
		"groups": ("item", "activity", "borrower", "month"),
	},
	"activities": {"views": ("metadata", "records", "loans"), "groups": ("activity", "kind")},
	"counts": {"views": ("records", "lines"), "groups": ("item", "location", "month")},
}
PERIOD_DEFAULT = {"key": "all", "from": "", "to": ""}
SCOPE_DEFAULT = {
	"period": PERIOD_DEFAULT,
	"warehouses": [],
	"categories": [],
	"item": "",
	"activity": "",
	"sources": [],
	"destinations": [],
	"kinds": [],
}
QUERY_DEFAULT = {
	"search": "",
	"batchNo": "",
	"grouping": "none",
	"sort": "asc",
	"sortBy": "identity",
	"statuses": [1],
	"includeAdjustments": True,
	"includeZero": False,
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
	dataset = value.get("dataset", "inventory")
	if dataset not in DEFINITIONS:
		frappe.throw("请选择有效的数据集")
	definition = DEFINITIONS[dataset]
	query = {**copy.deepcopy(QUERY_DEFAULT), "dataset": dataset, "view": definition["views"][0]}
	for field, default in QUERY_DEFAULT.items():
		if field not in value:
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
	if query["view"] not in definition["views"] or query["grouping"] not in ("none", *definition["groups"]):
		frappe.throw("此数据集不支持所选视图或分组")
	if query["sort"] not in ("asc", "desc") or query["sortBy"] not in (
		"identity",
		"date",
		"modified",
		"quantity",
		"name",
	):
		frappe.throw("请选择有效的排序")
	for field, allowed in {
		"activityStatus": ("all", "active", "archived"),
		"loanStatus": ("all", "outstanding", "open", "settled"),
		"loanOutcome": ("all", "outstanding", "returned", "damaged", "lost"),
		"countReviewed": ("all", "reviewed", "unreviewed", "difference", "not-found"),
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
		elif isinstance(scope[field], str):
			query["scope"][field] = scope[field]
		else:
			frappe.throw("筛选范围无效")
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
