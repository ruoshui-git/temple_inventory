"""Routed browse/bootstrap/dashboard services over the shared native projections."""

from collections import defaultdict

import frappe
from frappe.utils import get_datetime, now_datetime

from temple_inventory import native_topology
from temple_inventory.activities import activity_types
from temple_inventory.configuration import status as configuration_status
from temple_inventory.native_access import require_app
from temple_inventory.native_stock import MOVEMENT_PURPOSES, warehouse_scopes
from temple_inventory.projections import Projection, report_page
from temple_inventory.report_query import validate_query
from temple_inventory.report_sources import (
	available_scope_leaves,
	batch_allocations,
	document_fields,
	paged,
)

DASHBOARD_EXPIRY_PREVIEW_LIMIT = 5


@frappe.whitelist()
def bootstrap():
	require_app()
	from temple_inventory.catalog import item_group_root

	category_root = item_group_root()
	settings, visible, physical, leased, damaged = warehouse_scopes()
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
			"source_warehouses": sorted(sources),
			"destination_warehouses": sorted(destinations),
			"leased_warehouses": sorted(leased) if kind in ("Loan", "Return", "Damage", "Loss") else [],
		}
		operations[kind] = bool(
			(sources or kind == "Receive")
			and (destinations or kind in ("Issue", "Loss", "Disposal"))
			and (kind != "Transfer" or len(physical) >= 2)
		)
	operations["Reconcile"] = bool(physical)
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
				"system_root_warehouse",
				"leased_warehouse",
				"damaged_warehouse",
				"photo_required",
			)
		},
		"warehouses": native_topology.present_locations(
			visible, physical_root=settings.physical_root_warehouse, settings=settings
		),
		"physical_leaves": sorted(physical),
		"leased_leaves": sorted(leased),
		"damaged_leaves": sorted(damaged),
		"category_root": category_root,
		"categories": list(
			paged(
				"Item Group",
				filters={"name": ["!=", category_root]},
				fields=["name", "item_group_name", "parent_item_group", "is_group", "lft", "rgt", "modified"],
				order_by="lft asc, name asc",
			)
		),
		"uoms": list(paged("UOM", fields=["name", "uom_name", "must_be_whole_number"])),
		"activity_types": activity_types(),
		"operations": operations,
		"operation_requirements": requirements,
	}


@frappe.whitelist()
def native_drafts(query=None, start=0, page_length=30, refresh=False):
	require_app()
	if type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	query = validate_query(
		query
		or {"dataset": "movements", "view": "records", "sortBy": "date", "sort": "desc", "statuses": [0]}
	)
	if query["dataset"] != "movements":
		frappe.throw("草稿列表需要货物流动数据集")
	query.update({"dataset": "movements", "view": "records", "statuses": [0]})
	return _native_record_page(query, start, page_length, refresh=refresh)


@frappe.whitelist()
def counts_page(query=None, start=0, page_length=30, refresh=False):
	require_app()
	if type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	query = validate_query(
		query
		or {
			"dataset": "counts",
			"sortBy": "date",
			"sort": "desc",
			"statuses": [0, 1, 2],
		}
	)
	if query["dataset"] != "counts":
		frappe.throw("盘点列表需要盘点数据集")
	query.update({"view": "records"})
	return _native_record_page(query, start, page_length, refresh=refresh)


def _native_record_page(query, start, page_length, refresh=False):
	from frappe.utils import cint

	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with Projection(query, refresh=refresh) as projection:
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
	with Projection({"dataset": "movements", "view": "records", "statuses": [0]}, refresh=True) as projection:
		projection.build()
		count = projection.db.execute(
			"select count(distinct json_extract(payload, '$.document_id')) from rows where table_id='records'"
		).fetchone()[0]
		return {"draft_count": count, "snapshot": projection.context.snapshot}


def _expiry_projection(query, *, refresh=False):
	query = validate_query(query)
	if query["dataset"] != "expiry":
		frappe.throw("效期列表需要效期数据集")
	query.update({"view": "batches"})
	return Projection(query, refresh=refresh)


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
def expiry_page(query, start=0, page_length=30, refresh=False):
	require_app()
	if type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	validated = validate_query(query)
	if validated["dataset"] != "expiry":
		frappe.throw("效期列表需要效期数据集")
	validated["view"] = "batches"
	from frappe.utils import cint

	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	return _expiry_page(validated, start, size, refresh)


def _expiry_page(query, start=0, page_length=30, refresh=False):
	from frappe.utils import cint

	require_app()
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with _expiry_projection(query, refresh=refresh) as projection:
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
	with _expiry_projection(facet_query, refresh=refresh) as projection:
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
def dashboard_card(card, scope=None, movement_period=None, distribution="location", refresh=False):
	require_app()
	scope = frappe.parse_json(scope) or {}
	if card not in ("inventory", "distribution", "expiry", "movement", "loans", "reminders"):
		frappe.throw("不支持的总览区块")
	if type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	return _dashboard_card(card, scope, movement_period, distribution, refresh)


def _dashboard_card(card, scope, movement_period, distribution, refresh=False):
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
		return _document_card(query, refresh=refresh)
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
		return _document_card(query, refresh=refresh)
	if card in ("expiry", "reminders"):
		query.update({"dataset": "expiry"})
	with Projection(query, refresh=refresh) as projection:
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
			groups, items, stocked_locations, group_labels = defaultdict(set), set(), set(), {}
			for row in projection.rows("locations"):
				if row["available"] <= 0:
					continue
				stocked_locations.add(row["warehouse"])
				key = row["warehouse"] if distribution == "location" else row["category"]
				groups[key].add(row["item_code"])
				if distribution == "category":
					group_labels[key] = row.get("category_label") or key or "无分类"
				items.add(row["item_code"])
			rows = [
				{
					"id": key,
					"label": (projection.context.label(key) or key)
					if distribution == "location"
					else group_labels.get(key, key or "无分类"),
					"item_count": len(values),
				}
				for key, values in groups.items()
			]
			rows.sort(key=lambda row: (-row["item_count"], row["label"], row["id"]))
			empty_labels = []
			if distribution == "location":
				from temple_inventory.native_topology import present_locations

				labels = {
					row["name"]: row["label"]
					for row in present_locations(
						projection.context.warehouses,
						physical_root=projection.context.settings.physical_root_warehouse,
						settings=projection.context.settings,
					)
				}
				empty_labels = sorted(
					[
						labels[name]
						for name in available_scope_leaves(projection.context)
						if name in projection.context.physical
						and name not in stocked_locations
						and name in labels
					],
					key=str.casefold,
				)
			return {
				"rows": rows,
				"empty_count": len(empty_labels),
				"empty_labels": empty_labels,
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
			for identity in ordered[DASHBOARD_EXPIRY_PREVIEW_LIMIT:]:
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
			"expiry_preview_limit": DASHBOARD_EXPIRY_PREVIEW_LIMIT,
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


def _document_card(query, refresh=False):
	"""One preview row per native record, with complete unit-separated totals."""
	with Projection(query, refresh=refresh) as projection:
		projection.build()
		projection.group(
			"records",
			"card_units",
			("stock_uom", "kind"),
			("stock_qty", "outstanding", "available_effect"),
		)
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
					{
						"qty": row.get("outstanding", row["stock_qty"]),
						"uom": row["stock_uom"],
						"effect": row.get("available_effect", 0),
					}
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
def inventory_page(query=None, start=0, page_length=30, refresh=False):
	require_app()
	if type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	validated = validate_query(query or {"dataset": "inventory"})
	validated["view"] = "summary"
	from frappe.utils import cint

	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	return _inventory_page(validated, start, size, refresh)


def _inventory_page(query=None, start=0, page_length=30, refresh=False):
	from frappe.utils import cint

	from temple_inventory.catalog import item_metadata

	require_app()
	query = validate_query(query or {"dataset": "inventory"})
	if query["dataset"] != "inventory" or query["view"] not in ("summary", "locations"):
		frappe.throw("库存列表需要当前库存视图")
	query["view"] = "summary"
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with Projection(query, refresh=refresh, load_item_attachments=False) as projection:
		projection.build()
		page = list(projection.rows("summary", offset=start, limit=size))
		codes = {row["item_code"] for row in page}
		projection.context.preload_primary_item_images(codes)
		projection.context._item_fields.cache_clear()
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
			metadata = item_metadata(item, include_attachments=False, context=projection.context)
			results.append(
				{
					"code": item.name,
					"name": item.item_name,
					"category": metadata["item_group"],
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
			if query["view"] == "items":
				if not query["includeZero"] and row["outstanding"] <= 0:
					continue
				projection.put(
					"browse_contributions",
					{**row, "id": frappe.as_json([row["id"], "outstanding"]), "outcome_key": "outstanding"},
				)
				continue
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
	return Projection(query, load_item_attachments=False)


def _whole_operation(context, doctype, name):
	from temple_inventory.native_balances import reconciliation_allocations
	from temple_inventory.report_sources import available_stock_effect, document_kind

	doc = context.parent(doctype, name)
	if not doc:
		frappe.throw("原生记录不存在或无权访问", frappe.PermissionError)
	quantities = defaultdict(float)
	available_effects = defaultdict(float)
	branches, items, originals = set(), set(), set()
	kind = document_kind(doc)
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
		if doctype == "Stock Entry":
			available_effects[item.stock_uom] += available_stock_effect(
				context,
				docstatus=doc.docstatus,
				kind=kind,
				quantity=float(row.get("transfer_qty") or 0),
				source_warehouse=row.get("s_warehouse") or "",
				destination_warehouse=row.get("t_warehouse") or "",
			)
		else:
			for allocation in reconciliation_allocations(row):
				quantity = allocation["actual_qty"] if kind == "Opening" else allocation["difference"]
				available_effects[item.stock_uom] += available_stock_effect(
					context,
					docstatus=doc.docstatus,
					kind=kind,
					quantity=quantity,
					warehouse=row.get("warehouse") or "",
				)
		branches.add((row.get("s_warehouse") or row.get("warehouse") or "", row.get("t_warehouse") or ""))
		if row.get("ti_original_loan"):
			originals.add(row.ti_original_loan)
	result = {
		"kind": kind,
		"version": str(doc.modified),
		"editable": bool(
			doc.docstatus == 0
			and (
				(doc.doctype == "Stock Entry" and doc.purpose in MOVEMENT_PURPOSES.values())
				or (doc.doctype == "Stock Reconciliation" and doc.purpose == "Stock Reconciliation")
			)
		),
		"quantities": [{"uom": unit, "qty": quantity} for unit, quantity in sorted(quantities.items())],
		"available_effects": [
			{"uom": unit, "qty": quantity} for unit, quantity in sorted(available_effects.items())
		],
		"item_count": len(items),
		"line_count": len(doc.items),
		"branches": [
			{"source": source, "destination": destination} for source, destination in sorted(branches)
		],
		"original_loans": sorted(originals),
	}
	if doc.get("ti_movement_kind") == "Loan":
		balances = context.loan_balances(doc.name)
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
		# Copy in SQLite: a Python round-trip re-serializes every source row.
		projection.db.execute(
			"insert or replace into rows select 'browse_analysis_source', identity, date, modified, name, "
			"quantity, json_set(payload, '$.month', substr(cast(json_extract(payload, '$.date') as text), 1, 7)) "
			"from rows where table_id=?",
			(source,),
		)
		projection.column_names["browse_analysis_source"] = [
			*projection.column_names.get(source, ()),
			*(() if "month" in projection.column_names.get(source, ()) else ("month",)),
		]
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


def _operation_page_totals(projection, source, rows):
	"""Total each page Item's allocations by kind (or loan outcome), unit and status in one scan."""
	loans = projection.query["dataset"] == "loans"
	by_outcome = loans and projection.query["view"] != "items"
	codes = sorted({row["item_code"] for row in rows})
	totals = {}
	cursor = projection.db.execute(
		"select payload from rows where table_id=? and json_extract(payload, '$.item_code') in ("
		+ ", ".join("?" * len(codes))
		+ ") order by identity",
		(source, *codes),
	)
	for (payload,) in cursor:
		value = frappe.parse_json(payload)
		item_totals = totals.setdefault(
			(value["item_code"], value.get("outcome_key") if by_outcome else None), {}
		)
		key = (
			value.get("outcome_key") if loans else value.get("kind"),
			value["stock_uom"],
			value["docstatus"],
		)
		quantity = item_totals.setdefault(key, {"stock_qty": 0, "available_effect": 0})
		quantity["stock_qty"] += value["stock_qty"]
		quantity["available_effect"] += value.get("available_effect", 0)
	return {
		identity: [
			{
				("outcome_key" if loans else "kind"): kind,
				"stock_uom": unit,
				"docstatus": status,
				**quantity,
			}
			for (kind, unit, status), quantity in item_totals.items()
		]
		for identity, item_totals in totals.items()
	}


def _whole_operation_totals(projection, source):
	"""Summarize each matching native document once using all its native allocations."""
	documents, totals = {}, defaultdict(lambda: {"borrowed": 0, "outstanding": 0, "available_effect": 0})
	for row in projection.rows(source):
		identity = (row["doctype"], row["document"])
		documents.setdefault(identity, row)
	for doctype in ("Stock Entry", "Stock Reconciliation"):
		projection.context.preload_parents(
			doctype, [name for parent_doctype, name in documents if parent_doctype == doctype]
		)
	for (doctype, name), row in documents.items():
		whole = _whole_operation(projection.context, doctype, name)
		for quantity in whole["quantities"]:
			key = (whole["kind"], row["docstatus"], quantity["uom"])
			totals[key]["borrowed"] += quantity["qty"]
		for quantity in whole.get("outstanding", []):
			key = (whole["kind"], row["docstatus"], quantity["uom"])
			totals[key]["outstanding"] += quantity["qty"]
		for quantity in whole["available_effects"]:
			key = (whole["kind"], row["docstatus"], quantity["uom"])
			totals[key]["available_effect"] += quantity["qty"]
	return [
		{
			"kind": kind,
			"outcome_key": "outstanding",
			"docstatus": status,
			"stock_uom": uom,
			"stock_qty": values["borrowed"],
			"available_effect": values.get("available_effect", 0),
			"borrowed": values["borrowed"],
			"outstanding": values["outstanding"],
		}
		for (kind, status, uom), values in totals.items()
	]


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
			else tuple(ITEM_COLUMNS)
			+ (
				("outcome_key",)
				if projection.query["dataset"] == "loans" and projection.query["view"] != "items"
				else ()
			)
		)
		projection.group(
			source,
			"browse_groups",
			fields,
			() if records else ("stock_qty",),
			maximums=() if records else ("date", "posting_timestamp", "modified"),
		)
		rows = list(projection.rows("browse_groups", offset=start, limit=size))
		if records and rows:
			for doctype in ("Stock Entry", "Stock Reconciliation"):
				projection.context.preload_parents(
					doctype, [row["document"] for row in rows if row["doctype"] == doctype]
				)
		if not records and rows:
			projection.context.load_item_attachments = True
			projection.context.preload_item_attachments(row["item_code"] for row in rows)
			projection.context._item_fields.cache_clear()
			page_totals = _operation_page_totals(projection, source, rows)
		if records and rows:
			whole_by_row = {
				(row["doctype"], row["document"]): _whole_operation(
					projection.context, row["doctype"], row["document"]
				)
				for row in rows
			}
			original_names = {
				name for whole in whole_by_row.values() for name in whole.get("original_loans", [])
			}
			projection.context.preload_parents("Stock Entry", original_names)
			original_details = {}
			for name in sorted(original_names):
				loan = projection.context.parent("Stock Entry", name)
				if loan:
					original_details[name] = {
						"name": loan.name,
						"borrower": loan.get("ti_borrower") or "",
						"date": str(loan.posting_date),
					}
		for row in rows:
			row["id"] = frappe.as_json(
				["record", row["doctype"], row["document"]]
				if records
				else ["item", row["item_code"], row.get("outcome_key")]
			)
			if records:
				whole = whole_by_row[(row["doctype"], row["document"])]
				whole["original_loan_details"] = [
					original_details[name]
					for name in whole.get("original_loans", [])
					if name in original_details
				]
				row["whole"] = whole
				row.pop("allocation_count", None)
			else:
				row["item"] = item_metadata(
					projection.context.item(row["item_code"]),
					context=projection.context,
				)
				row["totals"] = page_totals.get((row["item_code"], row.get("outcome_key")), [])
		from temple_inventory.projections import LOAN_SUMS

		projection.group(
			source,
			"browse_totals",
			("kind", "outcome_key", "stock_uom", "docstatus"),
			LOAN_SUMS
			if records and projection.query["dataset"] == "loans"
			else ("stock_qty",)
			if projection.query["dataset"] == "loans"
			else ("stock_qty", "available_effect"),
		)
		analysis = {
			dimension: _operation_analysis_page(projection, source, dimension)
			for dimension in OPERATION_ANALYSIS
		}
		projection.group(source, "browse_complete", (), ())
		complete = next(
			projection.rows("browse_complete"), {"item_count": 0, "document_count": 0, "allocation_count": 0}
		)
		if records:
			complete.pop("allocation_count", None)
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
			"totals": (
				_whole_operation_totals(projection, source)
				if records
				else list(projection.rows("browse_totals"))
			),
			"analysis": analysis,
		}


@frappe.whitelist()
def operation_contributions(
	query,
	records=False,
	item_code=None,
	outcome=None,
	history_scope="outstanding",
	doctype=None,
	name=None,
	history_sort_by=None,
	history_sort=None,
	start=0,
	page_length=30,
):
	from frappe.utils import cint

	require_app()
	records = bool(cint(records))
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	if not records:
		validated = validate_query(query)
		if validated["dataset"] == "movements":
			return movement_history(validated, item_code=item_code, start=start, page_length=size)
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
			if item_code:
				conditions.append("json_extract(payload, '$.item_code')=?")
				params.append(item_code)
			if projection.query["dataset"] == "loans":
				if projection.query["view"] != "items" and not item_code:
					frappe.throw("请选择确切的物品")
				if projection.query["view"] != "items" and outcome not in OPERATION_OUTCOMES:
					frappe.throw("请选择借用结算结果")
				if projection.query["view"] != "items":
					conditions.append("json_extract(payload, '$.outcome_key')=?")
					params.append(outcome)
				if projection.query["view"] == "items":
					if history_scope not in ("outstanding", "all"):
						frappe.throw("请选择有效的借用明细范围")
					allocations = []
					allocation_where = " and ".join(conditions) or "1=1"
					for (payload,) in projection.db.execute(
						"select payload from rows where table_id='outcomes' and " + allocation_where,
						params[1:],
					):
						allocation = frappe.parse_json(payload)
						if allocation["docstatus"] != 1:
							continue
						if history_scope == "outstanding" and allocation["outstanding"] <= 0:
							continue
						allocations.append(allocation)
					selected = {
						(
							row["original_loan"],
							row["original_loan_line"],
							row["batch_no"],
							row["item_code"],
						)
						for row in allocations
					}
					expected_events = {
						(
							row["original_loan"],
							row["original_loan_line"],
							row["batch_no"],
							row["item_code"],
						): float(row["borrowed"]) - float(row["outstanding"])
						for row in allocations
					}
					observed_events = defaultdict(float)
					groups = {}

					def add_history(row, quantity, outstanding=0):
						key = (
							row["doctype"],
							row["document"],
							row["date"],
							row.get("time", ""),
							row["kind"],
							row.get("source_warehouse", ""),
							row.get("destination_warehouse", ""),
							row["stock_uom"],
							row.get("item_code", ""),
						)
						group = groups.setdefault(
							key,
							{
								"quantity": 0.0,
								"outstanding": 0.0,
								"item_name": row.get("item_name", ""),
								"original_loans": set(),
							},
						)
						group["quantity"] += quantity
						group["outstanding"] += outstanding
						if row.get("original_loan"):
							group["original_loans"].add(row["original_loan"])

					for allocation in allocations:
						add_history(
							allocation,
							float(allocation["borrowed"]),
							float(allocation["outstanding"]),
						)
					for (payload,) in projection.db.execute(
						"select payload from rows where table_id='linked_settlements'"
					):
						event = frappe.parse_json(payload)
						link = (
							event.get("original_loan"),
							event.get("original_loan_line"),
							event.get("batch_no", ""),
							event.get("item_code"),
						)
						if link in selected:
							add_history(event, -abs(float(event.get("stock_qty") or 0)))
							observed_events[link] += abs(float(event.get("stock_qty") or 0))
					history_complete = all(
						abs(observed_events[key] - expected) < 0.000001
						for key, expected in expected_events.items()
					)
					history_sort_by = history_sort_by or "date"
					history_sort = history_sort or "desc"
					allowed_history_sorts = {
						"identity",
						"document",
						"doctype",
						"item_name",
						"item_code",
						"kind",
						"docstatus",
						"date",
						"time",
						"source_warehouse",
						"destination_warehouse",
						"stock_uom",
						"borrower",
						"borrowed",
						"outstanding",
						"quantity",
					}
					if history_sort_by not in allowed_history_sorts or history_sort not in (
						"asc",
						"desc",
					):
						frappe.throw("请选择有效的历史排序", frappe.ValidationError)
					ordered = sorted(
						groups.items(),
						key=lambda pair: (
							get_datetime(f"{pair[0][2]} {pair[0][3]}"),
							pair[0][0],
							pair[0][1],
							pair[0][5],
							pair[0][6],
							pair[0][7],
							pair[0][8],
						),
					)

					def history_sort_value(pair):
						key, values = pair
						return {
							"identity": ":".join(str(value or "") for value in key),
							"document": key[1],
							"doctype": key[0],
							"item_name": values.get("item_name", ""),
							"item_code": key[8],
							"kind": key[4],
							"docstatus": 1,
							"date": get_datetime(f"{key[2]} {key[3]}"),
							"time": key[3],
							"source_warehouse": key[5],
							"destination_warehouse": key[6],
							"stock_uom": key[7],
							"borrower": allocations[0].get("borrower", ""),
							"borrowed": values["quantity"],
							"outstanding": values["outstanding"],
							"quantity": values["quantity"],
						}[history_sort_by]

					ordered.sort(
						key=history_sort_value,
						reverse=history_sort == "desc",
					)
					count = len(ordered)
					page = ordered[start : start + size]
					columns = [
						"document",
						"date_time",
						"kind",
						"source_warehouse",
						"destination_warehouse",
						"quantity",
					]
					return {
						"rows": [
							{
								"id": ":".join(str(value or "") for value in key),
								"doctype": key[0],
								"document": key[1],
								"docstatus": next(
									(
										row.get("docstatus", 1)
										for row in allocations
										if row["document"] == key[1]
									),
									1,
								),
								"item_code": key[8],
								"item_name": values.get("item_name") or key[8],
								"date_time": " ".join(str(value or "") for value in key[2:4]).strip(),
								"kind": key[4],
								"source_warehouse": key[5],
								"destination_warehouse": key[6],
								"quantity": values["quantity"],
								"outstanding": (values["outstanding"] if key[4] == "Loan" else None),
								"loan_status": (
									("Open" if values["outstanding"] > 0 else "Settled")
									if key[4] == "Loan"
									else None
								),
								"original_loans": sorted(values["original_loans"]),
								"stock_uom": key[7],
								"signed": True,
								"can_settle": values["outstanding"] > 0,
							}
							for key, values in page
						],
						"columns": columns,
						"matched_count": count,
						"history_complete": history_complete,
						"next_start": start + size if start + size < count else None,
					}
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


def _effective_loan_settlement(context, row, cache):
	"""Match the native loan balance rules before exposing signed balance history."""
	key = (row.get("doctype"), row.get("document"), row.get("line_name"))
	if key in cache:
		return cache[key]
	valid = {
		"Return": ("Material Transfer", {"Returned", "Damaged"}),
		"Damage": ("Material Transfer", {"Damaged"}),
		"Loss": ("Material Issue", {"Lost"}),
	}
	settlement = valid.get(row.get("kind"))
	if not settlement or int(row.get("docstatus") or 0) != 1 or row.get("outcome") not in settlement[1]:
		cache[key] = False
		return False
	document = context.parent(row["doctype"], row["document"])
	loan = context.parent("Stock Entry", row.get("original_loan"))
	if not document or not loan:
		cache[key] = None
		return None
	if (
		document.get("purpose") != settlement[0]
		or loan.docstatus != 1
		or loan.get("ti_movement_kind") != "Loan"
		or loan.company != document.company
	):
		cache[key] = False
		return False
	original = next((line for line in loan.items if line.name == row.get("original_loan_line")), None)
	if (
		not original
		or original.item_code != row.get("item_code")
		or original.t_warehouse != row.get("source_warehouse")
		or row.get("batch_no") not in {batch for batch, _quantity, _allocation in batch_allocations(original)}
	):
		cache[key] = False
		return False
	cache[key] = True
	return True


@frappe.whitelist()
def movement_history(
	query, item_code=None, warehouse=None, batch_no=None, start=0, page_length=30, sort_by=None, sort=None
):
	"""Return movement rows grouped to the requested Item/warehouse/batch identity."""
	from frappe.utils import cint

	require_app()
	query = frappe.parse_json(query) if isinstance(query, str) else query
	query = dict(query or {})
	query.update({"dataset": "movements", "view": "lines", "groupBy": []})
	query["sortBy"] = sort_by or "date"
	query["sort"] = sort or "desc"
	query = validate_query(query or {})
	# A detail request may narrow an inherited query, but never widen it.
	if item_code and (
		(query["scope"].get("item") and query["scope"]["item"] != item_code)
		or (query.get("restrictItems") and item_code not in query.get("itemCodes", []))
	):
		return {"rows": [], "matched_count": 0, "next_start": None, "history_complete": True}
	if batch_no and query.get("batchNo") and query["batchNo"] != batch_no:
		return {"rows": [], "matched_count": 0, "next_start": None, "history_complete": True}
	query.setdefault("scope", {})
	if batch_no:
		query["batchNo"] = batch_no
	if item_code:
		query["scope"]["item"] = item_code
		if not query.get("restrictItems"):
			query["restrictItems"], query["itemCodes"] = True, [item_code]
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with _operation_projection(query, records=False) as projection:
		if item_code and not projection.context.item(item_code):
			frappe.throw("物品不存在或无权访问", frappe.PermissionError)
		if warehouse and warehouse not in projection.context.warehouses:
			frappe.throw("库位不存在或无权访问", frappe.PermissionError)
		warehouse_leaves = (
			projection.context.expand_warehouses([warehouse]) & projection.context.selected
			if warehouse
			else set()
		)
		if warehouse and not warehouse_leaves:
			return {"rows": [], "matched_count": 0, "next_start": None, "history_complete": True}
		if warehouse:
			# The detail surface's selected warehouse is the stock-effect basis too.
			# Narrow only the inherited warehouse scope; all other report restrictions remain.
			projection.context.selected = warehouse_leaves
			projection.context.scope["warehouses"] = sorted(warehouse_leaves)
		projection.build()
		groups = {}
		loan_link_cache = {}
		history_complete = True
		observed_outcomes = defaultdict(float)
		for row in projection.rows("lines"):
			if item_code and row["item_code"] != item_code:
				continue
			if batch_no and row.get("batch_no") != batch_no:
				continue
			kind = row["kind"]
			source = row.get("source_warehouse") or ""
			destination = row.get("destination_warehouse") or ""
			if kind == "Reconcile":
				# A count adjustment describes where stock was counted, not a
				# transfer between a warehouse and the outside world.
				source, destination = row.get("warehouse") or "", ""
			elif kind == "Opening":
				location = row.get("warehouse") or ""
				if float(row.get("stock_qty") or 0) >= 0:
					source, destination = "", location
				else:
					source, destination = location, ""
			if warehouse and not warehouse_leaves.intersection(
				{source, destination, row.get("warehouse") or ""}
			):
				continue
			key = (
				row["doctype"],
				row["document"],
				row["item_code"],
				row["date"],
				row.get("time", ""),
				kind,
				source,
				destination,
				row["stock_uom"],
				int(row["docstatus"]),
			)
			group = groups.setdefault(
				key, {"quantity": 0.0, "available_effect": 0.0, "loan_balance_effect": 0.0}
			)
			group["borrower"] = row.get("borrower") or ""
			group["item_name"] = row.get("item_name") or row["item_code"]
			group["image"] = row.get("image") or ""
			quantity = float(row.get("stock_qty") or 0)
			group["quantity"] += quantity
			group["available_effect"] += float(row.get("available_effect") or 0)
			if kind == "Loan" and int(row["docstatus"]) == 1:
				group["loan_balance_effect"] += abs(quantity)
			elif row.get("original_loan") and kind in ("Return", "Damage", "Loss"):
				linked = _effective_loan_settlement(projection.context, row, loan_link_cache)
				if linked is None:
					history_complete = False
				elif linked:
					group["loan_balance_effect"] -= abs(quantity)
					observed_outcomes[row.get("outcome") or ""] += abs(quantity)
		if query.get("loan"):
			loan = projection.context.parent("Stock Entry", query["loan"])
			if not loan:
				history_complete = False
			else:
				expected_outcomes = defaultdict(float)
				balances = projection.context.loan_balances(loan.name, by_batch=True)
				selected_kinds = projection.context.scope["kinds"]
				projection.context.scope["kinds"] = []
				try:
					for line in loan.items:
						item = projection.context.item(line.item_code)
						if not item:
							continue
						for batch, _quantity, _allocation in batch_allocations(line):
							selected = {
								**document_fields(projection.context, loan),
								**projection.context.item_fields(item),
								"line_name": line.name,
								"id": f"Stock Entry:{loan.name}:{line.name}:{batch}",
								"source_warehouse": line.s_warehouse or "",
								"destination_warehouse": line.t_warehouse or "",
								"warehouse": "",
								"batch_no": batch,
								"kind": "Loan",
							}
							if projection.context.matches_line(selected):
								for outcome, quantity in balances[(line.name, batch)].items():
									expected_outcomes[outcome] += float(quantity)
				finally:
					projection.context.scope["kinds"] = selected_kinds
				if any(
					abs(expected_outcomes[outcome] - observed_outcomes[outcome]) > 0.000001
					for outcome in ("Returned", "Damaged", "Lost")
				):
					history_complete = False
		field = query["sortBy"]
		allowed = {
			"identity",
			"document",
			"doctype",
			"item_name",
			"item_code",
			"kind",
			"docstatus",
			"date",
			"time",
			"source_warehouse",
			"destination_warehouse",
			"stock_uom",
			"stock_qty",
			"available_effect",
			"borrower",
		}
		if field not in allowed:
			frappe.throw("请选择有效的排序", frappe.ValidationError)

		def history_sort_value(pair):
			key, values = pair
			return {
				"identity": ":".join(str(value or "") for value in key),
				"document": key[1],
				"doctype": key[0],
				"item_name": values.get("item_name", ""),
				"item_code": key[2],
				"kind": key[5],
				"docstatus": key[9],
				"date": get_datetime(f"{key[3]} {key[4]}"),
				"time": key[4],
				"source_warehouse": key[6],
				"destination_warehouse": key[7],
				"stock_uom": key[8],
				"stock_qty": values["quantity"],
				"available_effect": values["available_effect"],
				"borrower": values.get("borrower", ""),
			}[field]

		ordered = sorted(groups.items(), key=lambda pair: ":".join(str(value or "") for value in pair[0]))
		ordered.sort(key=history_sort_value, reverse=query["sort"] == "desc")
		count = len(ordered)
		rows = []
		for key, values in ordered[start : start + size]:
			rows.append(
				{
					"id": ":".join(str(value or "") for value in key),
					"doctype": key[0],
					"document": key[1],
					"item_code": key[2],
					"date_time": " ".join(str(value or "") for value in key[3:5]).strip(),
					"kind": key[5],
					"source_warehouse": key[6],
					"destination_warehouse": key[7],
					"stock_uom": key[8],
					"docstatus": key[9],
					"quantity": values["quantity"],
					"available_effect": values["available_effect"],
					"loan_balance_effect": values["loan_balance_effect"],
					"borrower": values.get("borrower", ""),
					"item_name": values.get("item_name", ""),
					"image": values.get("image", ""),
				}
			)
		return {
			"rows": rows,
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
			"history_complete": history_complete,
		}


@frappe.whitelist()
def loan_item_history(query, item_code, start=0, page_length=30, sort_by=None, sort=None):
	"""Return original submitted loan allocations scoped to one Item, grouped before paging."""
	from frappe.utils import cint

	require_app()
	query = frappe.parse_json(query) if isinstance(query, str) else query
	query = dict(query or {})
	query.update({"dataset": "loans", "view": "outcomes", "groupBy": []})
	query["sortBy"] = sort_by or "date"
	query["sort"] = sort or "desc"
	query = validate_query(query or {})
	if (query["scope"].get("item") and query["scope"]["item"] != item_code) or (
		query.get("restrictItems") and item_code not in query.get("itemCodes", [])
	):
		return {"rows": [], "matched_count": 0, "next_start": None}
	query.update({"statuses": [1]})
	query.setdefault("scope", {})["item"] = item_code
	if not query.get("restrictItems"):
		query["restrictItems"], query["itemCodes"] = True, [item_code]
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	with _operation_projection(query, records=False) as projection:
		projection.build()
		if not projection.context.item(item_code):
			frappe.throw("物品不存在或无权访问", frappe.PermissionError)
		groups = {}
		for row in projection.rows("outcomes"):
			key = (
				row["doctype"],
				row["document"],
				row["date"],
				row.get("time", ""),
				row["borrower"],
				row["source_warehouse"],
				row["destination_warehouse"],
				row["stock_uom"],
				row["docstatus"],
			)
			group = groups.setdefault(key, {"borrowed": 0.0, "outstanding": 0.0})
			group["borrowed"] += float(row["borrowed"])
			group["outstanding"] += float(row["outstanding"])
			group["item_code"] = row["item_code"]
			group["item_name"] = row["item_name"]
			group["image"] = row.get("image") or ""
		field = query["sortBy"]
		allowed = {
			"identity",
			"document",
			"doctype",
			"item_name",
			"item_code",
			"kind",
			"docstatus",
			"date",
			"time",
			"source_warehouse",
			"destination_warehouse",
			"stock_uom",
			"borrower",
			"borrowed",
			"outstanding",
		}
		if field not in allowed:
			frappe.throw("请选择有效的排序", frappe.ValidationError)

		def history_sort_value(pair):
			key, values = pair
			return {
				"identity": ":".join(str(value or "") for value in key),
				"document": key[1],
				"doctype": key[0],
				"item_name": values["item_name"],
				"item_code": values["item_code"],
				"kind": "Loan",
				"docstatus": key[8],
				"date": get_datetime(f"{key[2]} {key[3]}"),
				"time": key[3],
				"source_warehouse": key[5],
				"destination_warehouse": key[6],
				"stock_uom": key[7],
				"borrower": key[4],
				"borrowed": values["borrowed"],
				"outstanding": values["outstanding"],
			}[field]

		ordered = sorted(groups.items(), key=lambda pair: ":".join(str(value or "") for value in pair[0]))
		ordered.sort(key=history_sort_value, reverse=query["sort"] == "desc")
		count = len(ordered)
		rows = [
			{
				"id": ":".join(str(value or "") for value in key),
				"doctype": key[0],
				"document": key[1],
				"item_code": values["item_code"],
				"item_name": values["item_name"],
				"image": values.get("image", ""),
				"date_time": " ".join(str(value or "") for value in key[2:4]).strip(),
				"kind": "Loan",
				"borrower": key[4],
				"source_warehouse": key[5],
				"destination_warehouse": key[6],
				"stock_uom": key[7],
				"docstatus": key[8],
				"borrowed": values["borrowed"],
				"outstanding": values["outstanding"],
			}
			for key, values in ordered[start : start + size]
		]
		return {
			"rows": rows,
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
