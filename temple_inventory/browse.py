"""Routed browse/bootstrap/dashboard services over the shared native projections."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

from collections import defaultdict

import frappe
from frappe.utils import now_datetime

from temple_inventory import native_topology
from temple_inventory.activities import activity_types
from temple_inventory.configuration import status as configuration_status
from temple_inventory.native_access import require_app
from temple_inventory.native_stock import MOVEMENT_PURPOSES, warehouse_scopes
from temple_inventory.projections import Projection, report_page
from temple_inventory.report_query import validate_query
from temple_inventory.report_sources import paged


@frappe.whitelist()
def bootstrap():
	require_app()
	settings, visible, physical, leased, damaged = warehouse_scopes()
	can_create = bool(frappe.has_permission("Stock Entry", "create"))
	can_submit = bool(frappe.has_permission("Stock Entry", "submit"))
	item_read = bool(frappe.has_permission("Item", "read"))
	scopes = {
		"Receive": (set(), physical),
		"Issue": (physical, set()),
		"Transfer": (physical, physical),
		"Loan": (physical, leased),
		"Return": (leased, physical | damaged),
		"Damage": (physical | leased, damaged),
		"Loss": (physical | leased, set()),
		"Repair": (damaged, physical),
		"Disposal": (damaged, set()),
	}
	requirements = {}
	operations = {}
	for kind, (sources, destinations) in scopes.items():
		requirements[kind] = {
			"company": settings.company,
			"stock_entry_create": can_create,
			"stock_entry_submit": can_submit,
			"item_read": item_read,
			"source_warehouses": sorted(sources),
			"destination_warehouses": sorted(destinations),
			"leased_warehouses": sorted(leased) if kind in ("Loan", "Return", "Damage", "Loss") else [],
		}
		operations[kind] = bool(
			can_create
			and item_read
			and (sources or kind == "Receive")
			and (destinations or kind in ("Issue", "Loss", "Disposal"))
			and (kind != "Transfer" or len(physical) >= 2)
		)
	operations["Reconcile"] = bool(
		frappe.has_permission("Stock Reconciliation", "create") and item_read and physical
	)
	return {
		"user": frappe.session.user,
		"site": frappe.local.site,
		"site_date": frappe.utils.nowdate(),
		"site_time": str(now_datetime()),
		"timezone": frappe.get_system_settings("time_zone"),
		"initialization": configuration_status(),
		"settings": {
			field: settings.get(field)
			for field in (
				"company",
				"root_warehouse",
				"physical_root_warehouse",
				"leased_warehouse",
				"default_lease_program_warehouse",
				"damaged_warehouse",
				"photo_required",
			)
		},
		"warehouses": native_topology._warehouse_presentation(visible),
		"physical_leaves": sorted(physical),
		"leased_leaves": sorted(leased),
		"damaged_leaves": sorted(damaged),
		"categories": list(
			paged(
				"Item Group",
				fields=["name", "item_group_name", "parent_item_group", "is_group", "lft", "rgt"],
				order_by="lft asc, name asc",
			)
		),
		"uoms": list(paged("UOM", fields=["name", "uom_name", "must_be_whole_number"])),
		"activity_types": activity_types(),
		"capabilities": {
			doctype: {
				permission: bool(frappe.has_permission(doctype, permission))
				for permission in ("read", "create", "write", "delete", "submit", "cancel", "amend")
			}
			for doctype in (
				"Item",
				"UOM",
				"Item Group",
				"Warehouse",
				"Batch",
				"Stock Entry",
				"Stock Reconciliation",
				"Inventory Activity",
				"File",
			)
		},
		"operations": operations,
		"operation_requirements": requirements,
	}


@frappe.whitelist()
def native_drafts(query=None, start=0, page_length=30):
	require_app()
	query = validate_query(
		query
		or {"dataset": "movements", "view": "records", "sortBy": "date", "sort": "desc", "statuses": [0]}
	)
	if query["dataset"] != "movements":
		frappe.throw("草稿列表需要货物流动数据集")
	query.update({"dataset": "movements", "view": "records", "grouping": "none", "statuses": [0]})
	return _native_record_page(query, start, page_length)


@frappe.whitelist()
def counts_page(query=None, start=0, page_length=30):
	require_app()
	query = validate_query(query or {"dataset": "counts", "sortBy": "date", "sort": "desc"})
	if query["dataset"] != "counts":
		frappe.throw("盘点列表需要盘点数据集")
	query.update({"view": "records", "grouping": "none"})
	return _native_record_page(query, start, page_length)


def _native_record_page(query, start, page_length):
	from frappe.utils import cint

	if query["sortBy"] == "quantity":
		frappe.throw("记录包含不同单位，请按日期、更新时间、名称或编号排序")
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with Projection(query) as projection:
		projection.build()
		projection.group(
			"lines",
			"native_records",
			(
				"doctype",
				"document",
				"document_id",
				"date",
				"time",
				"modified",
				"docstatus",
				"kind",
				"activity",
				"activity_title",
				"borrower",
			),
			(),
		)
		rows = list(projection.rows("native_records", offset=start, limit=size))
		for row in rows:
			row["whole"] = _whole_operation(projection.context, row["doctype"], row["document"])
			row["matching_totals"] = _matching_operation_totals(projection, "lines", row)
		count = projection.count("native_records")
		return {
			"rows": rows,
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
			"query": projection.query,
			"snapshot": projection.context.snapshot,
		}


@frappe.whitelist()
def more_summary():
	require_app()
	with Projection({"dataset": "movements", "view": "records", "statuses": [0]}) as projection:
		projection.build()
		count = projection.db.execute(
			"select count(distinct json_extract(payload, '$.document_id')) from rows where table_id='records'"
		).fetchone()[0]
		return {"draft_count": count, "snapshot": projection.context.snapshot}


def _expiry_projection(query):
	query = validate_query(query)
	if query["dataset"] != "expiry":
		frappe.throw("效期列表需要效期数据集")
	query.update({"view": "batches", "grouping": "none"})
	return Projection(query)


def _expiry_analysis(projection, dimension, start=0, size=30):
	if dimension not in ("category", "warehouse"):
		frappe.throw("请选择有效的效期分析分组")
	table = "expiry_" + dimension
	projection.group(
		"batches", table, (dimension, "stock_uom"), ("available", "loaned", "damaged", "stock_qty")
	)
	count = projection.count(table)
	return {
		"rows": list(projection.rows(table, offset=start, limit=size)),
		"matched_count": count,
		"next_start": start + size if start + size < count else None,
	}


@frappe.whitelist()
def expiry_page(query, start=0, page_length=30):
	from frappe.utils import cint

	require_app()
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with _expiry_projection(query) as projection:
		projection.build()
		count = projection.count("batches")
		item_count, batch_count = projection.db.execute(
			"select count(distinct json_extract(payload, '$.item_code')), "
			"count(distinct json_array(json_extract(payload, '$.item_code'), json_extract(payload, '$.batch_no'))) "
			"from rows where table_id='batches'"
		).fetchone()
		result = {
			"rows": list(projection.rows("batches", offset=start, limit=size)),
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
			"item_count": item_count,
			"batch_count": batch_count,
			"totals": projection.summary(),
			"snapshot": projection.context.snapshot,
			"query": projection.query,
			"analysis": {
				dimension: _expiry_analysis(projection, dimension) for dimension in ("category", "warehouse")
			},
		}
		facet_query = {**projection.query, "expiryWindow": "period"}
	# Facets cover the complete applicable scope, excluding only their own choice.
	with _expiry_projection(facet_query) as projection:
		projection.build()
		today = frappe.utils.nowdate()
		identity = "json_array(json_extract(payload, '$.item_code'), json_extract(payload, '$.batch_no'))"
		expiry = "json_extract(payload, '$.expiry_date')"
		result["facets"] = {}
		for key, condition, params in (
			("all", "1=1", ()),
			("expired", f"{expiry} <> '' and {expiry} < ?", (today,)),
			("unexpired", f"{expiry} >= ?", (today,)),
			("undated", f"{expiry} = ''", ()),
		):
			result["facets"][key] = projection.db.execute(
				f"select count(distinct {identity}) from rows where table_id='batches' and {condition}",
				params,
			).fetchone()[0]
	return result


@frappe.whitelist()
def expiry_analysis(query, dimension, start=0, page_length=30):
	from frappe.utils import cint

	require_app()
	with _expiry_projection(query) as projection:
		projection.build()
		return _expiry_analysis(
			projection, dimension, max(0, cint(start)), min(100, max(1, cint(page_length)))
		)


@frappe.whitelist()
def dashboard_card(card, scope=None, movement_period=None, distribution="location"):
	require_app()
	scope = frappe.parse_json(scope) or {}
	if card not in ("inventory", "distribution", "expiry", "movement", "loans", "reminders"):
		frappe.throw("不支持的总览区块")
	query = {"dataset": "inventory", "scope": {**scope, "period": {"key": "all", "from": "", "to": ""}}}
	if card == "movement":
		query.update({"dataset": "movements", "view": "records", "sortBy": "date", "sort": "desc"})
		query["scope"]["period"] = frappe.parse_json(movement_period) or {
			"key": "this_month",
			"from": "",
			"to": "",
		}
		return _document_card(query)
	if card == "loans":
		query.update(
			{
				"dataset": "loans",
				"view": "records",
				"loanStatus": "outstanding",
				"sortBy": "date",
				"sort": "desc",
			}
		)
		return _document_card(query)
	if card in ("expiry", "reminders"):
		query.update({"dataset": "expiry"})
	with Projection(query) as projection:
		projection.build()
		if card == "inventory":
			return {
				"totals": projection.summary(),
				"item_count": projection.count("summary"),
				"snapshot": projection.context.snapshot,
				"query": projection.query,
			}
		if card == "distribution":
			if distribution not in ("location", "category"):
				frappe.throw("请选择有效的分布方式")
			groups, items = defaultdict(set), set()
			for row in projection.rows("locations"):
				if row["available"] <= 0:
					continue
				key = row["warehouse"] if distribution == "location" else row["category"]
				groups[key].add(row["item_code"])
				items.add(row["item_code"])
			return {
				"rows": [
					{
						"id": key,
						"label": projection.context.label(key) if distribution == "location" else key,
						"item_count": len(values),
					}
					for key, values in sorted(groups.items())
				],
				"item_count": len(items),
				"snapshot": projection.context.snapshot,
				"query": projection.query,
			}
		buckets = {
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
		previews = {"expired": {}, "upcoming": {}}
		for row in projection.rows("batches"):
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
			buckets[key].add((row["item_code"], row["batch_no"]))
			preview = previews["expired" if days < 0 else "upcoming"]
			identity = (row["item_code"], row["batch_no"])
			if identity in preview:
				preview[identity]["available"] += row["available"]
				preview[identity]["warehouse"] += "、" + row["warehouse"]
			else:
				preview[identity] = dict(row)
			ordered = sorted(preview, key=lambda identity: (preview[identity]["expiry_date"], *identity))
			for identity in ordered[5:]:
				del preview[identity]

		result = {
			"expiry_rows": {
				key: sorted(
					values.values(), key=lambda row: (row["expiry_date"], row["item_code"], row["batch_no"])
				)
				for key, values in previews.items()
			},
			"buckets": [{"id": key, "count": len(values)} for key, values in buckets.items()],
			"snapshot": projection.context.snapshot,
			"query": projection.query,
		}
		if card == "reminders":
			result["expired_count"] = sum(
				len(values) for key, values in buckets.items() if key.startswith("expired_")
			)
			pending = report_page(
				{"dataset": "inventory", "view": "summary", "scope": scope, "damageOnly": True}, page_length=1
			)
			result["damaged_item_count"] = pending["matched_count"]
		return result


def _document_card(query):
	"""One preview row per native record, with complete unit-separated totals."""
	with Projection(query) as projection:
		projection.build()
		projection.group("records", "card_units", ("stock_uom", "kind"), ("stock_qty", "outstanding"))
		rows = []
		for row in projection.rows("records"):
			identity = (row["doctype"], row["document"])
			current = next(
				(value for value in rows if (value["doctype"], value["document"]) == identity), None
			)
			if current is None and len(rows) < 5:
				current = {**row, "quantities": []}
				rows.append(current)
			if current is not None:
				current["quantities"].append(
					{"qty": row.get("outstanding", row["stock_qty"]), "uom": row["stock_uom"]}
				)
		for line in projection.rows("lines" if query["dataset"] == "movements" else "outcomes"):
			current = next(
				(
					row
					for row in rows
					if row["doctype"] == line["doctype"] and row["document"] == line["document"]
				),
				None,
			)
			if current is not None:
				names = current.setdefault("item_names", [])
				if line["item_name"] not in names:
					names.append(line["item_name"])
		for row in rows:
			row["item_names"] = "、".join(row.get("item_names", []))
		kind_counts = dict(
			projection.db.execute(
				"select json_extract(payload, '$.kind'), count(distinct json_extract(payload, '$.document_id')) from rows where table_id='records' group by json_extract(payload, '$.kind')"
			).fetchall()
		)

		count = projection.db.execute(
			"select count(distinct json_extract(payload, '$.document_id')) from rows where table_id='records'"
		).fetchone()[0]
		return {
			"rows": rows,
			"totals": list(projection.rows("card_units")),
			"kind_counts": kind_counts,
			"snapshot": projection.context.snapshot,
			"query": projection.query,
			"matched_count": count,
		}


@frappe.whitelist()
def inventory_page(query=None, start=0, page_length=30):
	from frappe.utils import cint

	from temple_inventory.catalog import item_metadata

	require_app()
	query = validate_query(query or {"dataset": "inventory"})
	if query["dataset"] != "inventory" or query["view"] not in ("summary", "locations"):
		frappe.throw("库存列表需要当前库存视图")
	query["view"], query["grouping"] = "summary", "none"
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with Projection(query) as projection:
		projection.build()
		# The inventory browser labels this choice as available quantity. Reports
		# retain their own total-stock quantity ordering.
		if query["sortBy"] == "quantity":
			projection.db.execute(
				"update rows set quantity=json_extract(payload, '$.available') where table_id='summary'"
			)
		page = list(projection.rows("summary", offset=start, limit=size))
		codes = {row["item_code"] for row in page}
		locations = {code: {} for code in codes}
		for row in projection.rows("locations"):
			code, warehouse = row["item_code"], row["warehouse"]
			if code not in codes or not warehouse:
				continue
			location = locations[code].setdefault(
				warehouse,
				{
					"location": warehouse,
					"label": row.get("warehouse_label") or warehouse,
					"available": 0,
					"loaned": 0,
					"damaged": 0,
					"batches": [],
				},
			)
			for field in ("available", "loaned", "damaged"):
				location[field] += row[field]
			if row["batch_no"]:
				location["batches"].append(
					{
						"id": row["batch_no"],
						"available": row["available"],
						"loaned": row["loaned"],
						"damaged": row["damaged"],
						"expiry": row.get("expiry_date") or "",
						"manufacturingDate": row.get("manufacturing_date") or "",
					}
				)
		results = []
		for row in page:
			item = projection.context.item(row["item_code"])
			metadata = item_metadata(item)
			results.append(
				{
					"code": item.name,
					"name": item.item_name,
					"category": item.item_group,
					"uom": item.stock_uom,
					"image": metadata["image"],
					"description": item.description or "",
					"version": str(item.modified),
					"tracksBatch": bool(item.has_batch_no),
					"tracksExpiry": bool(item.has_expiry_date),
					"barcode": "\n".join(value.barcode for value in item.barcodes),
					"alternateUnits": [
						{"uom": value.uom, "factor": float(value.conversion_factor)}
						for value in item.uoms
						if value.uom != item.stock_uom
					],
					"locations": list(locations[item.name].values()),
					"available": row["available"],
					"loaned": row["loaned"],
					"damaged": row["damaged"],
				}
			)
		projection.group(
			"locations",
			"category_analysis",
			("category", "stock_uom"),
			("available", "loaned", "damaged", "stock_qty"),
		)
		projection.group(
			"locations",
			"location_analysis",
			("warehouse", "stock_uom"),
			("available", "loaned", "damaged", "stock_qty"),
		)
		count = projection.count("summary")
		return {
			"rows": results,
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
			"summary": projection.summary(),
			"snapshot": projection.context.snapshot,
			"query": query,
			"analysis": {
				"category": list(projection.rows("category_analysis")),
				"location": list(projection.rows("location_analysis")),
			},
		}


OPERATION_OUTCOMES = ("outstanding", "returned", "damaged", "lost")


def _operation_source(projection, *, records):
	"""Keep lazy contribution rows and complete browse groups in transient SQLite."""
	query = projection.query
	source = "lines" if query["dataset"] == "movements" else "outcomes"
	if query["dataset"] == "loans" and not records:
		for row in projection.rows(source):
			for outcome in OPERATION_OUTCOMES:
				if query["loanOutcome"] not in ("all", outcome) or not row[outcome] > 0:
					continue
				projection.put(
					"browse_contributions",
					{
						**row,
						"id": frappe.as_json([row["id"], outcome]),
						"outcome_key": outcome,
						"stock_qty": row[outcome],
					},
				)
		projection.column_names.setdefault(
			"browse_contributions", [*projection.column_names[source], "outcome_key"]
		)
		source = "browse_contributions"
	return source


def _operation_projection(query, records):
	query = validate_query(query)
	if query["dataset"] not in ("movements", "loans"):
		frappe.throw("请选择货物流动或借用数据")
	if records and query["sortBy"] == "quantity":
		frappe.throw("记录视图请按日期、名称或编号排序，混合单位不合计排序")
	return Projection(query)


def _whole_operation(context, doctype, name):
	from temple_inventory.native_stock import loan_balances

	doc = context.parent(doctype, name)
	if not doc:
		frappe.throw("原生记录不存在或无权访问", frappe.PermissionError)
	quantities, branches, items, originals = defaultdict(float), set(), set(), set()
	for row in doc.items:
		item = context.item(row.item_code)
		if not item:
			frappe.throw("原生记录包含无权访问的物品", frappe.PermissionError)
		items.add(item.name)
		quantity = (
			float(row.get("transfer_qty") or 0)
			if doctype == "Stock Entry"
			else float(row.qty) - (float(row.current_qty or 0) if doc.purpose != "Opening Stock" else 0)
		)
		quantities[item.stock_uom] += quantity
		branches.add((row.get("s_warehouse") or row.get("warehouse") or "", row.get("t_warehouse") or ""))
		if row.get("ti_original_loan"):
			originals.add(row.ti_original_loan)
	result = {
		"version": str(doc.modified),
		"editable": bool(
			doc.docstatus == 0
			and doc.has_permission("write")
			and (
				(doc.doctype == "Stock Entry" and doc.purpose in MOVEMENT_PURPOSES.values())
				or (doc.doctype == "Stock Reconciliation" and doc.purpose == "Stock Reconciliation")
			)
		),
		"can_delete": bool(
			doc.docstatus == 0
			and doc.has_permission("delete")
			and (
				(doc.doctype == "Stock Entry" and doc.purpose in MOVEMENT_PURPOSES.values())
				or (doc.doctype == "Stock Reconciliation" and doc.purpose == "Stock Reconciliation")
			)
		),
		"quantities": [{"uom": unit, "qty": quantity} for unit, quantity in sorted(quantities.items())],
		"item_count": len(items),
		"line_count": len(doc.items),
		"branches": [
			{"source": source, "destination": destination} for source, destination in sorted(branches)
		],
		"original_loans": sorted(originals),
	}
	if doc.get("ti_movement_kind") == "Loan":
		balances = loan_balances(doc.name)
		outstanding = defaultdict(float)
		for row in doc.items:
			outstanding[row.stock_uom] += (
				float(row.transfer_qty) - float(sum(balances[row.name].values())) if doc.docstatus == 1 else 0
			)
		result["outstanding"] = [
			{"uom": unit, "qty": quantity} for unit, quantity in sorted(outstanding.items())
		]
		result["loan_status"] = (
			"Draft"
			if doc.docstatus == 0
			else "Cancelled"
			if doc.docstatus == 2
			else "Open"
			if any(outstanding.values())
			else "Settled"
		)
	return result


OPERATION_ANALYSIS = {
	"category": "category",
	"location": "source_warehouse",
	"activity": "activity_title",
	"borrower": "borrower",
	"month": "month",
}


def _operation_analysis_group(projection, source, dimension):
	if dimension not in OPERATION_ANALYSIS:
		frappe.throw("请选择有效的分析分组")
	if "browse_analysis_source" not in projection.column_names:
		projection.add(
			"browse_analysis_source",
			({**row, "month": str(row["date"])[:7]} for row in projection.rows(source)),
		)
	table = "browse_analysis_" + dimension
	projection.group(
		"browse_analysis_source",
		table,
		(OPERATION_ANALYSIS[dimension], "kind", "outcome_key", "stock_uom", "docstatus"),
		("stock_qty",),
	)
	return table


def _operation_analysis_page(projection, source, dimension, start=0, size=30):
	table = _operation_analysis_group(projection, source, dimension)
	count = projection.count(table)
	return {
		"rows": list(projection.rows(table, offset=start, limit=size)),
		"matched_count": count,
		"next_start": start + size if start + size < count else None,
	}


def _matching_operation_totals(projection, source, row):
	metrics = (
		("stock_qty",)
		if projection.query["dataset"] == "movements"
		else ("baseline_qty", "actual_qty", "difference", "stock_qty")
		if projection.query["dataset"] == "counts"
		else ("borrowed", "returned", "damaged", "lost", "outstanding", "stock_qty")
	)
	columns = [
		"json_extract(payload, '$.stock_uom')",
		*(f"sum(json_extract(payload, '$.{field}'))" for field in metrics),
	]
	cursor = projection.db.execute(
		"select "
		+ ", ".join(columns)
		+ " from rows where table_id=? and json_extract(payload, '$.doctype')=? and json_extract(payload, '$.document')=? group by json_extract(payload, '$.stock_uom')",
		(source, row["doctype"], row["document"]),
	)
	return [dict(zip(("stock_uom", *metrics), values, strict=True)) for values in cursor]


@frappe.whitelist()
def operation_page(query, records=False, start=0, page_length=20):
	from frappe.utils import cint

	from temple_inventory.catalog import item_metadata
	from temple_inventory.projections import ITEM_COLUMNS

	require_app()
	records = bool(cint(records))
	start, size = max(0, cint(start)), min(50, max(1, cint(page_length)))
	with _operation_projection(query, records) as projection:
		projection.build()
		source = _operation_source(projection, records=records)
		fields = (
			(
				"doctype",
				"document",
				"document_id",
				"date",
				"time",
				"modified",
				"docstatus",
				"kind",
				"activity",
				"activity_title",
				"borrower",
			)
			if records
			else tuple(ITEM_COLUMNS) + (("outcome_key",) if projection.query["dataset"] == "loans" else ())
		)
		projection.group(
			source,
			"browse_groups",
			fields,
			() if records else ("stock_qty",),
			maximums=() if records else ("date", "posting_timestamp", "modified"),
		)
		rows = list(projection.rows("browse_groups", offset=start, limit=size))
		for row in rows:
			row["id"] = frappe.as_json(
				["record", row["doctype"], row["document"]]
				if records
				else ["item", row["item_code"], row.get("outcome_key")]
			)
			if records:
				row["whole"] = _whole_operation(projection.context, row["doctype"], row["document"])
				row["matching_totals"] = _matching_operation_totals(projection, source, row)
			else:
				row["item"] = item_metadata(projection.context.item(row["item_code"]))
				conditions, params = "json_extract(payload, '$.item_code') = ?", [row["item_code"]]
				if projection.query["dataset"] == "loans":
					conditions += " and json_extract(payload, '$.outcome_key') = ?"
					params.append(row["outcome_key"])
				cursor = projection.db.execute(
					"select payload from rows where table_id=? and " + conditions, (source, *params)
				)
				# A single Item's totals are small; contribution allocations stay paginated.
				totals = defaultdict(float)
				for (payload,) in cursor:
					value = frappe.parse_json(payload)
					totals[
						(
							value.get("kind") or value.get("outcome_key"),
							value["stock_uom"],
							value["docstatus"],
						)
					] += value["stock_qty"]
				row["totals"] = [
					{"kind": kind, "stock_uom": unit, "docstatus": status, "stock_qty": quantity}
					for (kind, unit, status), quantity in totals.items()
				]
		from temple_inventory.projections import LOAN_SUMS

		projection.group(
			source,
			"browse_totals",
			("kind", "outcome_key", "stock_uom", "docstatus"),
			LOAN_SUMS if records and projection.query["dataset"] == "loans" else ("stock_qty",),
		)
		analysis = {
			dimension: _operation_analysis_page(projection, source, dimension)
			for dimension in OPERATION_ANALYSIS
		}
		projection.group(source, "browse_complete", (), ())
		complete = next(
			projection.rows("browse_complete"), {"item_count": 0, "document_count": 0, "allocation_count": 0}
		)
		category_count = projection.db.execute(
			"select count(distinct json_extract(payload, '$.category')) from rows where table_id=?", (source,)
		).fetchone()[0]
		count = projection.count("browse_groups")
		return {
			"rows": rows,
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
			"query": projection.query,
			"snapshot": projection.context.snapshot,
			"summary": {**complete, "category_count": category_count},
			"totals": list(projection.rows("browse_totals")),
			"analysis": analysis,
		}


@frappe.whitelist()
def operation_contributions(
	query, records=False, item_code=None, outcome=None, doctype=None, name=None, start=0, page_length=30
):
	from frappe.utils import cint

	require_app()
	records = bool(cint(records))
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with _operation_projection(query, records) as projection:
		projection.build()
		source = _operation_source(projection, records=records)
		conditions, params = [], [source]
		if records:
			if doctype not in ("Stock Entry", "Stock Reconciliation") or not name:
				frappe.throw("请选择确切的原生记录")
			conditions += ["json_extract(payload, '$.doctype')=?", "json_extract(payload, '$.document')=?"]
			params += [doctype, name]
		else:
			if not item_code:
				frappe.throw("请选择确切的物品")
			conditions.append("json_extract(payload, '$.item_code')=?")
			params.append(item_code)
			if projection.query["dataset"] == "loans":
				if outcome not in OPERATION_OUTCOMES:
					frappe.throw("请选择借用结算结果")
				conditions.append("json_extract(payload, '$.outcome_key')=?")
				params.append(outcome)
		where = "table_id=? and " + " and ".join(conditions)
		count = projection.db.execute("select count(*) from rows where " + where, params).fetchone()[0]
		cursor = projection.db.execute(
			"select payload from rows where " + where + " order by date desc, identity asc limit ? offset ?",
			(*params, size, start),
		)
		return {
			"rows": [frappe.parse_json(payload) for (payload,) in cursor],
			"columns": projection.column_names[source],
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
		}


@frappe.whitelist()
def operation_analysis(query, records=False, dimension="category", start=0, page_length=30):
	from frappe.utils import cint

	require_app()
	records = bool(cint(records))
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with _operation_projection(query, records) as projection:
		projection.build()
		source = _operation_source(projection, records=records)
		return _operation_analysis_page(projection, source, dimension, start, size)
