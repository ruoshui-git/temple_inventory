"""Transient disk-backed report tables. ERPNext remains the stock source of truth.

The temporary SQLite file is a bounded-memory sort/group/export workspace, deleted
at the end of every request/job. It is never a persistent inventory data store.
"""

import json
import sqlite3
import tempfile
from contextlib import AbstractContextManager

import frappe
from frappe.utils import cint

from temple_inventory.native_access import require_app
from temple_inventory.report_query import SORTABLE_COLUMNS, sortable_field, validate_query
from temple_inventory.report_sources import (
	ReportContext,
	activity_rows,
	available_stock_effect,
	count_rows,
	document_fields,
	document_kind,
	historical_rows,
	linked_settlement_rows,
	loan_rows,
	movement_rows,
	settlement_rows,
	stock_rows,
)
from temple_inventory.uom_labels import uom_label

INTERNAL_TABLES = {"loan_item_page", "linked_settlements", "group_source"}

TABLE_LABELS = {
	"summary": "汇总",
	"records": "单据记录",
	"lines": "库存明细",
	"balances": "历史数量余额",
	"ledger": "原生库存流水",
	"locations": "库位 / 批次明细",
	"batches": "批次明细",
	"outcomes": "借用结余",
	"loan_items": "借用物品",
	"settlements": "结算明细",
	"metadata": "活动资料",
	"items": "物品资料",
	"barcodes": "条码",
	"conversions": "物品常用换算",
	"warehouses": "位置层级",
	"files": "私有附件引用",
	"group_roots": "一级分组",
	"grouped": "分组汇总",
}
STOCK_SUMS = ("available", "loaned", "damaged", "stock_qty")
LOAN_SUMS = ("borrowed", "returned", "damaged", "lost", "outstanding", "stock_qty")
HISTORY_SUMS = ("opening", "incoming", "outgoing", "adjustment", "closing", "stock_qty")
COUNT_SUMS = ("baseline_qty", "actual_qty", "difference", "stock_qty")


def group_field_name(query, key):
	if key == "status":
		if query["dataset"] == "loans" and query["view"] == "records":
			return "loan_status"
		if query["dataset"] == "activities" and query["view"] == "metadata":
			return "status"
		return "docstatus"
	return {
		"item": "item_code",
		"category": "category",
		"location": "warehouse",
		"kind": "kind",
		"activityType": "activity_type",
		"activity": "activity",
		"borrower": "borrower",
		"outcome": "outcome",
		"source": "source_warehouse",
		"destination": "destination_warehouse",
		"month": "month",
	}[key]


def group_label(row, query, depth=None):
	index = -1 if depth is None else depth - 1
	field = group_field_name(query, query["groupBy"][index])
	value = row.get(field)
	if field == "item_code":
		return row.get("item_name") or value or ""
	if field == "activity":
		return row.get("activity_title") or value or ""
	if field == "warehouse":
		return row.get("warehouse_label") or value or ""
	if field in ("source_warehouse", "destination_warehouse"):
		return row.get(f"{field}_label") or value or ""
	if field == "activity_type":
		return row.get("activity_type_label") or value or ""
	if field == "docstatus":
		return {0: "草稿", 1: "已提交", 2: "已取消"}.get(value, "状态未知")
	return str(value or "未指定")


ITEM_COLUMNS = ["item_code", "item_name", "category", "stock_uom"]
DOCUMENT_COLUMNS = [
	"doctype",
	"document",
	"document_id",
	"line_name",
	"date",
	"time",
	"docstatus",
	"kind",
	"activity",
	"activity_title",
	"activity_type",
	"borrower",
	"source",
	"purpose",
	"recorded_by",
	"recorder",
	"handler",
	"reviewer",
	"notes",
	"amended_from",
]
LOCATION_COLUMNS = ["warehouse", "source_warehouse", "destination_warehouse", "batch_no"]
LINE_COLUMNS = [
	"id",
	*DOCUMENT_COLUMNS,
	*ITEM_COLUMNS,
	*LOCATION_COLUMNS,
	"entered_qty",
	"entered_uom",
	"conversion_factor",
	"stock_qty",
	"available_effect",
	"original_loan",
	"original_loan_line",
	"origin_warehouse",
	"outcome",
]
FIXED_COLUMNS = {
	"lines": LINE_COLUMNS,
	"records": [
		"id",
		"doctype",
		"document",
		"date",
		"time",
		"docstatus",
		"kind",
		"activity",
		"activity_title",
		"borrower",
		"stock_uom",
		"stock_qty",
		"item_count",
		"allocation_count",
		"item_codes",
	],
	"locations": [
		"id",
		*ITEM_COLUMNS,
		"warehouse",
		"warehouse_label",
		"batch_no",
		"available",
		"loaned",
		"damaged",
		"stock_qty",
		"snapshot",
	],
	"batches": [
		"id",
		*ITEM_COLUMNS,
		"warehouse",
		"batch_no",
		"manufacturing_date",
		"expiry_date",
		"remaining_days",
		"stock_qty",
	],
	"balances": [
		"id",
		*ITEM_COLUMNS,
		"warehouse",
		"opening",
		"incoming",
		"outgoing",
		"adjustment",
		"closing",
		"period_from",
		"period_to",
	],
	"ledger": [
		"id",
		*ITEM_COLUMNS,
		"warehouse",
		"ledger_entry",
		"doctype",
		"document",
		"line_name",
		"date",
		"time",
		"batch_no",
		"stock_qty",
		"incoming",
		"outgoing",
		"adjustment",
		"native_running_qty",
	],
	"outcomes": [
		"id",
		*DOCUMENT_COLUMNS,
		*ITEM_COLUMNS,
		*LOCATION_COLUMNS,
		"original_loan",
		"original_loan_line",
		*LOAN_SUMS,
	],
	"settlements": [*LINE_COLUMNS, "loan_date", "original_activity", "original_activity_title"],
	"metadata": [
		"id",
		"activity",
		"title",
		"activity_type",
		"activity_type_label",
		"status",
		"start_date",
		"end_date",
		"description",
		"notes",
		"modified",
		"document_count",
		"has_outstanding",
	],
	"items": ["id", *ITEM_COLUMNS, "description", "batch_tracked", "has_expiry_date", "disabled", "modified"],
	"barcodes": ["id", "item_code", "barcode", "barcode_type"],
	"conversions": ["id", "item_code", "uom", "conversion_factor", "stock_uom"],
	"warehouses": ["id", "warehouse", "label", "parent", "warehouse_type", "is_group", "company"],
	"files": ["id", "file_name", "parent_doctype", "parent"],
}


# Screen tables prioritize readable context and quantities. Export writers continue
# to use column_names, including native audit fields and stable allocation IDs.
DISPLAY_COLUMNS = {
	"items": [
		"item_code",
		"item_name",
		"category",
		"stock_uom",
		"description",
		"batch_tracked",
		"has_expiry_date",
		"disabled",
		"modified",
	],
	"barcodes": ["item_code", "barcode", "barcode_type"],
	"conversions": ["item_code", "uom", "conversion_factor", "stock_uom"],
	"warehouses": ["warehouse", "label", "parent", "warehouse_type", "is_group", "company"],
	"files": ["file_name", "parent_doctype", "parent"],
	"group_source": [
		"document",
		"date",
		"time",
		"kind",
		"docstatus",
		"loan_status",
		"doctype",
		"item_name",
		"item_code",
		"category",
		"stock_uom",
		"warehouse_label",
		"warehouse",
		"batch_no",
		"expiry_date",
		"remaining_days",
		"borrower",
		"activity_title",
		"source_warehouse",
		"destination_warehouse",
		"available",
		"loaned",
		"borrowed",
		"returned",
		"damaged",
		"lost",
		"outstanding",
		"opening",
		"incoming",
		"outgoing",
		"adjustment",
		"closing",
		"baseline_qty",
		"actual_qty",
		"difference",
		"stock_qty",
	],
	"loan_items": [
		"item_name",
		"outstanding",
		"stock_uom",
		"item_code",
		"category",
		"document_count",
		"borrowed",
		"returned",
		"damaged",
		"lost",
	],
	"summary": [
		"item_name",
		"available",
		"loaned",
		"damaged",
		"stock_qty",
		"available_effect",
		"stock_uom",
		"kind",
		"docstatus",
		"category",
		"item_code",
		"document_count",
		"allocation_count",
	],
	"records": [
		"document",
		"date",
		"time",
		"kind",
		"docstatus",
		"borrower",
		"borrowed",
		"returned",
		"damaged",
		"lost",
		"outstanding",
		"baseline_qty",
		"actual_qty",
		"difference",
		"stock_qty",
		"stock_uom",
		"activity_title",
		"loan_status",
		"count_scope",
		"doctype",
		"item_count",
		"allocation_count",
	],
	"locations": [
		"item_name",
		"warehouse_label",
		"batch_no",
		"available",
		"loaned",
		"damaged",
		"stock_qty",
		"stock_uom",
		"item_code",
		"warehouse",
	],
	"batches": [
		"item_name",
		"batch_no",
		"expiry_date",
		"remaining_days",
		"stock_qty",
		"stock_uom",
		"warehouse",
		"item_code",
		"manufacturing_date",
	],
	"balances": [
		"item_name",
		"warehouse",
		"opening",
		"incoming",
		"outgoing",
		"adjustment",
		"closing",
		"stock_uom",
		"item_code",
		"period_from",
		"period_to",
	],
	"ledger": [
		"date",
		"time",
		"item_name",
		"warehouse",
		"incoming",
		"outgoing",
		"adjustment",
		"native_running_qty",
		"stock_uom",
		"document",
		"doctype",
		"line_name",
		"batch_no",
		"item_code",
		"ledger_entry",
	],
	"lines": [
		"item_name",
		"entered_qty",
		"entered_uom",
		"conversion_factor",
		"stock_qty",
		"available_effect",
		"stock_uom",
		"baseline_qty",
		"actual_qty",
		"difference",
		"review_state",
		"document",
		"date",
		"time",
		"kind",
		"docstatus",
		"warehouse",
		"source_warehouse",
		"destination_warehouse",
		"batch_no",
		"activity_title",
		"borrower",
		"outcome",
		"original_loan",
		"original_loan_line",
		"doctype",
		"line_name",
		"item_code",
		"reason",
	],
	"outcomes": [
		"item_name",
		"borrower",
		"borrowed",
		"returned",
		"damaged",
		"lost",
		"outstanding",
		"stock_uom",
		"document",
		"date",
		"docstatus",
		"loan_status",
		"activity_title",
		"original_loan",
		"original_loan_line",
		"batch_no",
		"source_warehouse",
		"destination_warehouse",
		"item_code",
	],
	"settlements": [
		"item_name",
		"outcome",
		"stock_qty",
		"stock_uom",
		"document",
		"date",
		"docstatus",
		"original_loan",
		"original_loan_line",
		"borrower",
		"source_warehouse",
		"destination_warehouse",
		"batch_no",
		"item_code",
		"doctype",
		"line_name",
	],
	"metadata": [
		"title",
		"activity_type_label",
		"status",
		"start_date",
		"end_date",
		"document_count",
		"has_outstanding",
		"activity",
		"description",
		"modified",
	],
	"grouped": [
		"item_name",
		"activity_title",
		"title",
		"warehouse_label",
		"item_code",
		"category",
		"warehouse",
		"activity",
		"borrower",
		"month",
		"kind",
		"docstatus",
		"outcome",
		"available",
		"loaned",
		"borrowed",
		"returned",
		"damaged",
		"lost",
		"outstanding",
		"opening",
		"incoming",
		"outgoing",
		"adjustment",
		"closing",
		"baseline_qty",
		"actual_qty",
		"difference",
		"stock_qty",
		"stock_uom",
		"item_count",
		"document_count",
		"allocation_count",
	],
}


def display_columns(table, columns):
	if table in ("grouped", "group_roots"):
		metrics = (*STOCK_SUMS, *LOAN_SUMS, *HISTORY_SUMS, *COUNT_SUMS)
		return list(
			dict.fromkeys(
				field
				for field in (
					"group_label",
					"stock_uom",
					*metrics,
					"quantity_breakdown",
					"row_count",
					"count_label",
					"item_count",
					"document_count",
					"allocation_count",
				)
				if field in columns
			)
		)
	return [field for field in DISPLAY_COLUMNS.get(table, columns) if field != "id" and field in columns]


def _add_authorized_item_images(context, rows):
	for row in rows:
		if not row.get("group_label"):
			continue
		item_code = row.get("item_code")
		item = context.item(item_code) if item_code else None
		row["image"] = (item.image or "") if item else ""
	return rows


def _add_authorized_page_images(context, rows):
	"""Check only page item covers after the reusable base projection is built."""
	codes = {row.get("item_code") for row in rows if row.get("image") is not None and row.get("item_code")}
	context.preload_primary_item_images(codes)
	context._item_fields.cache_clear()
	for row in rows:
		if "image" not in row:
			continue
		code = row.get("item_code")
		item = context.item(code) if code else None
		row["image"] = context.item_fields(item)["image"] if item else ""
	return rows


def group_count_grain(query):
	if query["dataset"] in ("inventory", "expiry"):
		return "stock_row"
	if query["dataset"] == "activities" and query["view"] == "metadata":
		return "activity"
	if query["dataset"] == "activities":
		return "allocation"
	if query["view"] == "records":
		return "native_document"
	return "allocation"


def group_count_metadata(query, row):
	grain = group_count_grain(query)
	return {
		"count_grain": grain,
		"count_label": {
			"stock_row": "库存行",
			"activity": "活动",
			"native_document": "原生单据",
			"allocation": "分配行",
		}[grain],
		"display_count": int(row.get("row_count") or 0),
	}


class Projection(AbstractContextManager):
	def __init__(self, query, *, refresh=False, load_item_attachments=True, load_item_children=True):
		from frappe.utils import now_datetime

		self.query = validate_query(query)
		self.cache_bypass = refresh
		self.hydrate_page_images = load_item_attachments and self.query["dataset"] in ("movements", "loans")
		self.load_item_attachments = load_item_attachments and not self.hydrate_page_images
		self.load_item_children = load_item_children
		from temple_inventory.read_cache import capture_cache_context

		self.cache_context = None if refresh else capture_cache_context()
		self.calculation_started = (
			getattr(frappe.local, "inventory_cache_request_started", None) if self.cache_context else None
		) or str(now_datetime())
		self.context = ReportContext(
			self.query,
			snapshot=self.calculation_started,
			snapshot_is_now=True,
			load_item_attachments=self.load_item_attachments,
			load_item_children=self.load_item_children,
		)
		self.temp = tempfile.TemporaryDirectory(prefix="ti-report-")
		self.db = sqlite3.connect(f"{self.temp.name}/projection.sqlite")
		self.db.execute("pragma cache_size = -8192")
		self.db.execute("pragma journal_mode = memory")
		self.db.execute("pragma synchronous = off")
		self.db.execute("""create table rows (
			table_id text, identity text, date text, modified text, name text,
			quantity real, payload text, primary key(table_id, identity)
		)""")
		self.main_table = ""
		self.summary_table = ""
		self.sums = ()
		self.column_names = {}
		self.cache_lock = None
		self.cache_race_retries = 0

	def __enter__(self):
		from temple_inventory.read_cache import acquire_projection_lock

		self.cache_lock = acquire_projection_lock(self)
		return self

	def __exit__(self, *args):
		from temple_inventory.read_cache import release_projection_lock

		release_projection_lock(self.cache_lock)
		self.db.close()
		self.temp.cleanup()

	def _rebuild_uncached_after_cache_failure(self, *, related=False):
		from frappe.utils import now_datetime

		from temple_inventory.read_cache import restart_owned_read_snapshot

		if not restart_owned_read_snapshot():
			frappe.throw("缓存验证失败，当前读取事务无法安全重试，请刷新后重试")  # noqa: RUF001
		# Authorization may have changed while Redis was unavailable. Recheck on
		# the newly established snapshot before rebuilding any protected rows.
		require_app()
		self.cache_context = None
		self.cache_bypass = True
		self.calculation_started = str(now_datetime())
		self.context = ReportContext(
			self.query,
			snapshot=self.calculation_started,
			snapshot_is_now=True,
			load_item_attachments=self.load_item_attachments,
			load_item_children=self.load_item_children,
		)
		self.db.close()
		self.temp.cleanup()
		self.temp = tempfile.TemporaryDirectory(prefix="ti-report-")
		self.db = sqlite3.connect(f"{self.temp.name}/projection.sqlite")
		self.db.execute("pragma cache_size = -8192")
		self.db.execute("pragma journal_mode = memory")
		self.db.execute("pragma synchronous = off")
		self.db.execute(
			"""create table rows (
				table_id text, identity text, date text, modified text, name text,
				quantity real, payload text, primary key(table_id, identity)
			)"""
		)
		self.main_table = ""
		self.summary_table = ""
		self.sums = ()
		self.column_names = {}
		return self.build(related=related)

	def put(self, table, row):
		# Display fields accompany exact native identity, including paginated references.
		row = dict(row)
		for field in ("warehouse", "source_warehouse", "destination_warehouse", "origin_warehouse"):
			if row.get(field):
				row[f"{field}_label"] = self.context.label(row[field]) or "位置暂不可用"
		if "docstatus" in row:
			row["docstatus_label"] = {0: "草稿", 1: "已提交", 2: "已取消"}.get(row["docstatus"], "状态未知")
		identity = str(row["id"])
		posting = row.get("posting_timestamp") or row.get("date") or row.get("expiry_date") or ""
		if posting and row.get("time") and not row.get("posting_timestamp"):
			posting = str(frappe.utils.get_datetime(f"{posting} {row['time']}"))
		self.column_names.setdefault(table, list(FIXED_COLUMNS.get(table, [])))
		for field in row:
			if field not in self.column_names[table]:
				self.column_names[table].append(field)
		self.db.execute(
			"insert or replace into rows values (?, ?, ?, ?, ?, ?, ?)",
			(
				table,
				identity,
				str(posting),
				str(row.get("modified") or ""),
				str(row.get("item_name") or row.get("title") or identity),
				float(row.get("stock_qty") or 0),
				frappe.as_json(row, indent=None),
			),
		)

	def add(self, table, rows):
		self.column_names.setdefault(table, list(FIXED_COLUMNS.get(table, [])))
		for row in rows:
			self.put(table, row)

	def rows(self, table, *, offset=0, limit=None):
		if table not in self.column_names:
			frappe.throw("请选择有效的数据表")
		field = sortable_field(self.query["dataset"], self.query["view"], self.query["sortBy"])
		if (
			table in ("grouped", "group_roots")
			and field != "identity"
			and field not in self.column_names[table]
		):
			field = "group_label" if "group_label" in self.column_names[table] else "identity"
		direction = self.query["sort"]
		sort_expression = (
			"identity"
			if field == "identity"
			else "date"
			if field == "date"
			else f"json_extract(payload, '$.{field}')"
		)
		cursor = self.db.execute(
			f"select payload from rows where table_id=? order by {sort_expression} {direction}, identity {direction} limit ? offset ?",
			(table, limit if limit is not None else -1, offset),
		)
		for (payload,) in cursor:
			row = json.loads(payload)
			for field in ("stock_uom", "entered_uom", "uom"):
				if row.get(field):
					row[f"{field}_label"] = uom_label(row[field])
			yield row

	def count(self, table):
		return self.db.execute("select count(*) from rows where table_id=?", (table,)).fetchone()[0]

	def matching_page(self, table, fields, values, unit, offset, limit):
		"""Count and sort a scoped child slice in SQLite before materializing it."""
		sort_field = sortable_field(self.query["dataset"], self.query["view"], self.query["sortBy"])
		if (
			table in ("grouped", "group_roots")
			and sort_field != "identity"
			and sort_field not in self.column_names.get(table, ())
		):
			sort_field = "group_label" if "group_label" in self.column_names.get(table, ()) else "identity"
		if sort_field != "identity" and sort_field not in self.column_names.get(table, ()):
			frappe.throw("所选分组不支持此排序字段")
		where = ["table_id=?"]
		params = [table]
		for field, value in zip(fields, values, strict=True):
			where.append(f"coalesce(cast(json_extract(payload, '$.{field}') as text), '')=?")
			params.append(value)
		if unit is not None:
			where.append("coalesce(cast(json_extract(payload, '$.stock_uom') as text), '')=?")
			params.append(unit)
		predicate = " and ".join(where)
		count = self.db.execute(f"select count(*) from rows where {predicate}", params).fetchone()[0]
		field = sort_field
		sort_expression = (
			"identity"
			if field == "identity"
			else "date"
			if field == "date"
			else f"json_extract(payload, '$.{field}')"
		)
		cursor = self.db.execute(
			f"select payload from rows where {predicate} order by {sort_expression} {self.query['sort']}, identity {self.query['sort']} limit ? offset ?",
			(*params, limit, offset),
		)
		return [json.loads(payload) for (payload,) in cursor], count

	def group(self, source, target, fields, sums, *, maximums=()):
		self.column_names.setdefault(
			target,
			[
				"id",
				*fields,
				*sums,
				*maximums,
				"item_count",
				"document_count",
				"row_count",
				"allocation_count",
			],
		)
		# Fields are internal constants, never client-supplied SQL identifiers.
		expressions = [f"json_extract(payload, '$.{field}')" for field in fields]
		columns = [
			*expressions,
			*(f"sum(coalesce(json_extract(payload, '$.{field}'), 0))" for field in sums),
			*(f"max(json_extract(payload, '$.{field}'))" for field in maximums),
		]
		is_allocation_source = source in ("lines", "outcomes", "settlements", "browse_contributions") or (
			source == "group_source"
			and (
				(
					self.query["dataset"] in ("movements", "counts", "loans")
					and self.query["view"] != "records"
				)
				or (self.query["dataset"] == "activities" and self.query["view"] == "loans")
			)
		)
		allocation_count = (
			"sum(coalesce(json_extract(payload, '$.allocation_count'), 0))"
			if "allocation_count" in self.column_names.get(source, ())
			else "count(*)"
			if is_allocation_source
			else "0"
		)
		columns.extend(
			[
				"count(distinct json_extract(payload, '$.item_code'))",
				"count(distinct json_extract(payload, '$.document_id'))",
				"count(*)",
				allocation_count,
			]
		)
		grouping = " group by " + ", ".join(expressions) if expressions else ""
		# Per-group details are aggregated once and joined by each group's text key;
		# querying them per group rescans the whole source table for every group.
		keys = [f"coalesce(cast(json_extract(payload, '$.{field}') as text), '')" for field in fields]
		member_keys = [key.replace("payload", "record_rows.payload") for key in keys]
		item_counts = (
			{
				tuple(values[:-1]): values[-1]
				for values in self.db.execute(
					"select "
					+ ", ".join([*member_keys, "count(distinct members.value)"])
					+ " from rows record_rows, json_each(record_rows.payload, '$.item_codes') members"
					" where record_rows.table_id=?"
					+ (" group by " + ", ".join(member_keys) if member_keys else ""),
					(source,),
				)
			}
			if "item_codes" in self.column_names.get(source, ())
			else None
		)
		breakdowns = None
		if source == "group_source" and self.query["dataset"] == "movements":
			breakdowns = {}
			for values in self.db.execute(
				"select "
				+ ", ".join(
					[
						*keys,
						"json_extract(payload, '$.kind')",
						"json_extract(payload, '$.docstatus')",
						"sum(coalesce(json_extract(payload, '$.stock_qty'), 0))",
						"sum(coalesce(json_extract(payload, '$.available_effect'), 0))",
						"count(distinct json_extract(payload, '$.document_id'))",
						"count(*)",
					]
				)
				+ " from rows where table_id=? group by "
				+ ", ".join(
					[*keys, "json_extract(payload, '$.kind')", "json_extract(payload, '$.docstatus')"]
				)
				+ " order by json_extract(payload, '$.kind'), json_extract(payload, '$.docstatus')",
				(source,),
			):
				part = values[len(keys) :]
				breakdowns.setdefault(tuple(values[: len(keys)]), []).append(
					{
						"kind": part[0],
						"docstatus": part[1],
						"stock_qty": part[2],
						"available_effect": part[3],
						"document_count": part[4],
						"allocation_count": part[5],
					}
				)
		cursor = self.db.execute(
			"select " + ", ".join([*columns, *keys]) + " from rows where table_id=?" + grouping, (source,)
		)
		for values in cursor:
			key = tuple(values[len(columns) :])
			values = values[: len(columns)]
			if not values[-2]:
				continue
			row = dict(
				zip(
					[
						*fields,
						*sums,
						*maximums,
						"item_count",
						"document_count",
						"row_count",
						"allocation_count",
					],
					values,
					strict=True,
				)
			)
			if item_counts is not None:
				row["item_count"] = item_counts.get(key, 0)
			if breakdowns is not None:
				row["quantity_breakdown"] = breakdowns.get(key, [])
				# A total across different movement kinds/statuses has no meaningful native quantity.
				if len(row["quantity_breakdown"]) > 1:
					row["stock_qty"] = None
			row["id"] = json.dumps([target, *values[: len(fields)]], ensure_ascii=False)
			self.put(target, row)

	def build(self, *, related=False):
		query, context = self.query, self.context
		dataset, view = query["dataset"], query["view"]
		from temple_inventory.read_cache import restore_projection, store_projection

		self.related = related
		restored = restore_projection(self)
		if not restored and dataset == "inventory" and view == "historical":
			self.column_names.update({key: list(FIXED_COLUMNS[key]) for key in ("balances", "ledger")})
			for table, row in historical_rows(context):
				self.put(table, row)
			self.main_table, sums = "balances", HISTORY_SUMS
		elif not restored and dataset in ("inventory", "expiry"):
			self.add("locations" if dataset == "inventory" else "batches", stock_rows(context))
			self.main_table = "locations" if dataset == "inventory" else "batches"
			sums = STOCK_SUMS
			if dataset == "inventory":
				self.group("locations", "summary", ("item_code", "item_name", "category", "stock_uom"), sums)
				self.main_table = view
		elif not restored and dataset == "movements":
			self.add("lines", movement_rows(context))
			self.group(
				"lines",
				"records",
				(
					"doctype",
					"document",
					"document_id",
					"date",
					"time",
					"docstatus",
					"kind",
					"activity",
					"activity_title",
					"borrower",
					"stock_uom",
				),
				("stock_qty", "available_effect"),
			)
			if view == "records":
				self.complete_native_records("movements")
			self.group(
				"lines",
				"summary",
				("item_code", "item_name", "category", "docstatus", "kind", "stock_uom"),
				("stock_qty", "available_effect"),
			)
			self.main_table, sums = view, ("stock_qty", "available_effect")
		elif not restored and dataset == "loans":
			self.add("outcomes", loan_rows(context))
			if view == "items":
				self.add("linked_settlements", linked_settlement_rows(context))
				self.add(
					"loan_item_page",
					(row for row in self.rows("outcomes") if query["includeZero"] or row["outstanding"] > 0),
				)
			self.group(
				"loan_item_page" if view == "items" else "outcomes",
				"loan_items",
				("item_code", "stock_uom"),
				LOAN_SUMS,
				maximums=("item_name", "category", "date", "posting_timestamp"),
			)
			self.group(
				"outcomes",
				"records",
				(
					"doctype",
					"document",
					"document_id",
					"date",
					"time",
					"docstatus",
					"activity",
					"activity_title",
					"borrower",
					"loan_status",
					"stock_uom",
				),
				LOAN_SUMS,
			)
			if view == "records":
				self.complete_native_records("loans")
			self.add("settlements", settlement_rows(context))
			self.main_table, sums = (
				("loan_items" if view == "items" else view),
				LOAN_SUMS if view in ("items", "outcomes", "records") else ("stock_qty",),
			)
		elif not restored and dataset == "activities":
			self.add("metadata", activity_rows(context))
			self.add("records", activity_rows(context, metadata=False))
			# Select exact original loan lines from the independently scoped native loan projection.
			self.add(
				"outcomes",
				(
					row
					for row in loan_rows(context)
					if self.db.execute(
						"select 1 from rows where table_id = 'metadata' and identity = ? limit 1",
						(row["activity"],),
					).fetchone()
				),
			)
			self.main_table, sums = (
				("outcomes" if view == "loans" else view),
				LOAN_SUMS if view == "loans" else ("stock_qty",),
			)
		elif not restored:
			self.add("lines", count_rows(context))
			self.group(
				"lines",
				"records",
				(
					"doctype",
					"document",
					"document_id",
					"date",
					"time",
					"docstatus",
					"stock_uom",
					"count_scope",
				),
				COUNT_SUMS,
			)
			self.main_table, sums = view, COUNT_SUMS
		if not restored:
			self.summary_table = self.main_table
			self.sums = tuple(sums)
			if related:
				self.add_related_tables()
			store_projection(self)
		else:
			sums = self.sums
		if query["groupBy"]:
			group_fields = [group_field_name(query, key) for key in query["groupBy"]]
			source = "loan_item_page" if dataset == "loans" and view == "items" else self.main_table
			if source == "summary":
				source = (
					"lines"
					if dataset in ("movements", "counts")
					else "outcomes"
					if dataset == "loans"
					else "locations"
					if dataset == "inventory"
					else source
				)
			# Month/location grouping keeps separate allocation/branch detail tables.
			self.column_names["group_source"] = []
			for row in self.rows(source):
				row["month"] = str(row.get("date") or "")[:7]
				if "warehouse" in group_fields and not row.get("warehouse"):
					for direction in ("source_warehouse", "destination_warehouse"):
						warehouse = row.get(direction)
						if warehouse and warehouse in context.selected:
							self.put(
								"group_source",
								{
									**row,
									"id": f"{row['id']}:{direction}",
									"warehouse": warehouse,
									"branch": direction,
								},
							)
				else:
					self.put("group_source", row)
			self.group(
				"group_source",
				"grouped",
				(*group_fields, "stock_uom"),
				sums,
				maximums=tuple(
					label
					for group_field in group_fields
					for label in {
						"item_code": ("item_name",),
						"activity": ("activity_title", "title"),
						"activity_type": ("activity_type_label",),
						"warehouse": ("warehouse_label",),
						"source_warehouse": ("source_warehouse_label",),
						"destination_warehouse": ("destination_warehouse_label",),
					}.get(group_field, ())
					if label in self.column_names[source]
				),
			)
			if len(group_fields) == 2:
				self.group(
					"group_source",
					"group_roots",
					(group_fields[0], "stock_uom"),
					sums,
					maximums=tuple(
						label
						for label in {
							"item_code": ("item_name",),
							"activity": ("activity_title", "title"),
							"activity_type": ("activity_type_label",),
							"warehouse": ("warehouse_label",),
							"source_warehouse": ("source_warehouse_label",),
							"destination_warehouse": ("destination_warehouse_label",),
						}.get(group_fields[0], ())
						if label in self.column_names["group_source"]
					),
				)
				for row in list(self.rows("group_roots")):
					old_identity = str(row["id"])
					path = [str(row.get(group_fields[0]) or "")]
					row["group_path"] = path
					row["group_depth"] = 1
					row["parent_group_id"] = None
					row["has_children"] = True
					row["row_grain"] = "group"
					row["group_label"] = group_label(row, query, 1)
					row.update(group_count_metadata(query, row))
					row["id"] = json.dumps(["group", *path, row.get("stock_uom") or ""], ensure_ascii=False)
					self.db.execute(
						"delete from rows where table_id='group_roots' and identity=?", (old_identity,)
					)
					self.put("group_roots", row)
			self.group_source_table = "group_source"
			for row in list(self.rows("grouped")):
				old_identity = str(row["id"])
				path = [str(row.get(field) or "") for field in group_fields]
				group_id = ["group", *path, row.get("stock_uom") or ""]
				row["group_path"] = path
				row["group_depth"] = len(path)
				row["parent_group_id"] = (
					json.dumps(["group", *path[:-1], row.get("stock_uom") or ""], ensure_ascii=False)
					if len(path) > 1
					else None
				)
				row["has_children"] = True
				row["row_grain"] = "group"
				row["group_label"] = group_label(row, query)
				row.update(group_count_metadata(query, row))
				row["id"] = json.dumps(group_id, ensure_ascii=False)
				self.db.execute("delete from rows where table_id='grouped' and identity=?", (old_identity,))
				self.put("grouped", row)
			self.main_table = "group_roots" if len(group_fields) == 2 else "grouped"
			TABLE_LABELS.setdefault("grouped", "分组汇总")
		self.db.commit()
		if self.cache_context:
			from temple_inventory.read_cache import _fresh, cache_context_current

			cache_status = cache_context_current(self.cache_context)
			if cache_status is False:
				frappe.throw("数据正在更新，请刷新后重试")  # noqa: RUF001
			if cache_status is None and restored:
				return self._rebuild_uncached_after_cache_failure(related=related)
			if restored and not _fresh(self.context.snapshot):
				return self._rebuild_uncached_after_cache_failure(related=related)
		return self

	def complete_native_records(self, dataset):
		"""Expand selected document records to whole native quantities after line matching."""
		if dataset == "movements" and self._complete_unfiltered_movement_records():
			return
		from temple_inventory.native_balances import reconciliation_allocations
		from temple_inventory.native_stock import batch_quantities

		selected = {}
		for row in self.rows("records"):
			selected[(row["doctype"], row["document"])] = row
		self.db.execute("delete from rows where table_id='records'")
		documents = [(doctype, name, self.context.parent(doctype, name)) for doctype, name in selected]
		for doctype, name, doc in documents:
			if not doc:
				continue
			base = document_fields(self.context, doc)
			groups = {}
			item_codes = set()
			balances = self.context.loan_balances(name, by_batch=True) if dataset == "loans" else None
			for line in doc.items:
				item = self.context.item(line.item_code)
				if not item:
					frappe.throw("原生记录包含无权访问的物品", frappe.PermissionError)
				item_codes.add(item.name)
				if dataset == "movements":
					if doctype == "Stock Entry":
						quantity = float(line.get("transfer_qty") or 0)
						effect = available_stock_effect(
							self.context,
							docstatus=doc.docstatus,
							kind=base["kind"],
							quantity=quantity,
							source_warehouse=line.get("s_warehouse") or "",
							destination_warehouse=line.get("t_warehouse") or "",
						)
						parts = [(quantity, effect)]
					else:
						parts = []
						for allocation in reconciliation_allocations(
							line,
							batch_checker=self.context.batch,
							bundle_cache=self.context._bundle_cache,
							bundle_loader=self.context.bundle,
						):
							quantity = (
								allocation["actual_qty"]
								if base["kind"] == "Opening"
								else allocation["difference"]
							)
							parts.append(
								(
									quantity,
									available_stock_effect(
										self.context,
										docstatus=doc.docstatus,
										kind=base["kind"],
										quantity=quantity,
										warehouse=line.get("warehouse") or "",
									),
								)
							)
					for quantity, effect in parts:
						group = groups.setdefault(
							item.stock_uom,
							{
								"stock_qty": 0,
								"available_effect": 0,
								"item_codes": set(),
								"allocation_count": 0,
							},
						)
						group["stock_qty"] += quantity
						group["available_effect"] += effect
						group["item_codes"].add(item.name)
						group["allocation_count"] += 1
				else:
					for batch, borrowed in batch_quantities(line).items():
						outcomes = balances[(line.name, batch)]
						group = groups.setdefault(
							item.stock_uom,
							{
								"stock_qty": 0,
								"borrowed": 0,
								"returned": 0,
								"damaged": 0,
								"lost": 0,
								"outstanding": 0,
								"item_codes": set(),
								"allocation_count": 0,
							},
						)
						group["borrowed"] += borrowed
						group["returned"] += outcomes["Returned"]
						group["damaged"] += outcomes["Damaged"]
						group["lost"] += outcomes["Lost"]
						outstanding = borrowed - sum(outcomes.values()) if doc.docstatus == 1 else 0
						group["outstanding"] += outstanding
						group["stock_qty"] += outstanding
						group["item_codes"].add(item.name)
						group["allocation_count"] += 1
			for uom, values in groups.items():
				item_codes = sorted(values["item_codes"])
				self.put(
					"records",
					{
						**base,
						"id": f"{doctype}:{name}:{uom}",
						"stock_uom": uom,
						**{key: value for key, value in values.items() if key not in ("item_codes",)},
						"item_count": len(item_codes),
						"item_codes": item_codes,
					},
				)

	def _complete_unfiltered_movement_records(self):
		"""Reuse already-authorized allocation aggregates when the line scope is whole."""
		query = self.query
		scope = query["scope"]
		if any(
			(
				scope.get("item"),
				scope.get("categories"),
				scope.get("uncategorized"),
				scope.get("warehouses"),
				scope.get("sources"),
				scope.get("destinations"),
				scope.get("kinds"),
				scope.get("tracking", "all") != "all",
				scope.get("activity"),
				query.get("search"),
				query.get("batchNo"),
				query.get("record"),
				query.get("recordDoctype"),
				query.get("loan"),
				query.get("damageOnly"),
				query.get("borrower"),
				query.get("itemStatus", "enabled") != "enabled",
				query.get("person", {}).get("name"),
				query.get("loanOutcome", "all") != "all",
				query.get("restrictItems"),
				query.get("restrictAllocations"),
				query.get("itemLocationKeys"),
				query.get("allocationKeys"),
				not query.get("includeAdjustments", True),
			)
		):
			return False
		rows = list(self.rows("records"))
		documents = {
			(doctype, name): self.context._preloaded_parents.get((doctype, name))
			for doctype, name in {(row["doctype"], row["document"]) for row in rows}
		}
		if any(doc is None for doc in documents.values()):
			return False
		self.db.execute("delete from rows where table_id='records'")
		for row in rows:
			doctype, name = row["doctype"], row["document"]
			doc = documents[(doctype, name)]
			row.pop("document_count", None)
			row.pop("row_count", None)
			row.update(document_fields(self.context, doc))
			row["id"] = f"{doctype}:{name}:{row['stock_uom']}"
			row["item_codes"] = sorted({line.item_code for line in doc.items if line.item_code})
			self.put("records", row)
		return True

	def summary(self):
		table = self.summary_table or self.main_table
		self.group(
			table,
			"totals",
			("stock_uom", "docstatus", "kind", "outcome"),
			tuple(
				field
				for field in (
					"stock_qty",
					"available",
					"loaned",
					"damaged",
					"borrowed",
					"returned",
					"lost",
					"outstanding",
					"opening",
					"incoming",
					"outgoing",
					"adjustment",
					"closing",
					"baseline_qty",
					"actual_qty",
					"difference",
					"available_effect",
				)
				if field in self.column_names[table]
			),
		)
		rows = list(self.rows("totals"))
		self.db.execute("delete from rows where table_id='totals'")
		del self.column_names["totals"]
		return rows

	def add_related_tables(self):
		from temple_inventory.native_files import attachments

		for table in ("items", "barcodes", "conversions", "warehouses", "files"):
			self.column_names[table] = list(FIXED_COLUMNS.get(table, []))
		tables = list(self.column_names)
		for table in tables:
			if table in ("items", "barcodes", "conversions", "warehouses", "files"):
				continue
			for row in self.rows(table):
				code = row.get("item_code")
				if code:
					item = self.context.item(code)
					if item:
						self.put(
							"items",
							{
								"id": item.name,
								**self.context.item_fields(item),
								"description": item.description or "",
								"has_expiry_date": bool(item.has_expiry_date),
								"disabled": bool(item.disabled),
								"modified": str(item.modified),
							},
						)
						for barcode in item.barcodes:
							self.put(
								"barcodes",
								{
									"id": barcode.name,
									"item_code": item.name,
									"barcode": barcode.barcode,
									"barcode_type": barcode.barcode_type or "",
								},
							)
						for conversion in item.uoms:
							self.put(
								"conversions",
								{
									"id": conversion.name,
									"item_code": item.name,
									"uom": conversion.uom,
									"conversion_factor": float(conversion.conversion_factor),
									"stock_uom": item.stock_uom,
								},
							)
						for file in attachments("Item", code):
							self.put(
								"files",
								{
									"id": file.name,
									"file_name": file.file_name,
									"parent_doctype": "Item",
									"parent": code,
								},
							)
				for field in ("warehouse", "source_warehouse", "destination_warehouse", "origin_warehouse"):
					warehouse = row.get(field)
					seen = set()
					while warehouse in self.context.warehouses and warehouse not in seen:
						seen.add(warehouse)
						value = self.context.warehouses[warehouse]
						self.put(
							"warehouses",
							{
								"id": value.name,
								"warehouse": value.name,
								"label": self.context.label(value.name),
								"parent": value.parent_warehouse or "",
								"warehouse_type": value.warehouse_type or "",
								"is_group": bool(value.is_group),
								"company": value.company,
							},
						)
						warehouse = value.parent_warehouse
				if row.get("doctype") in ("Stock Entry", "Stock Reconciliation") and row.get("document"):
					for file in attachments(row["doctype"], row["document"]):
						self.put(
							"files",
							{
								"id": file.name,
								"file_name": file.file_name,
								"parent_doctype": row["doctype"],
								"parent": row["document"],
							},
						)


@frappe.whitelist()
def report_page(query, start=0, page_length=30, table=None, include_related=False, refresh=False):
	require_app()
	start, page_length = max(0, cint(start)), min(200, max(1, cint(page_length)))
	if type(include_related) is not bool or type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	validated = validate_query(query)
	return _report_page(validated, start, page_length, table, include_related, refresh)


def _report_page(query, start, page_length, table, include_related, refresh=False):
	with Projection(
		query,
		refresh=refresh,
		load_item_children=include_related or query["dataset"] not in ("movements", "loans"),
	) as projection:
		projection.build(related=include_related)
		selected = table or projection.main_table
		if selected not in projection.column_names or selected in INTERNAL_TABLES:
			frappe.throw("请选择有效的数据表")
		count = projection.count(selected)
		rows = list(projection.rows(selected, offset=start, limit=page_length))
		if projection.query["groupBy"]:
			_add_authorized_item_images(projection.context, rows)
		elif projection.hydrate_page_images:
			_add_authorized_page_images(projection.context, rows)
		return {
			"query": projection.query,
			"scope": projection.context.scope,
			"period": projection.context.period,
			"snapshot": projection.context.snapshot,
			"table": selected,
			"sortable_columns": list(
				SORTABLE_COLUMNS[(projection.query["dataset"], projection.query["view"])]
			),
			"columns": display_columns(selected, projection.column_names[selected]),
			"leaf_columns": display_columns(
				projection.group_source_table,
				projection.column_names.get(projection.group_source_table, []),
			)
			if projection.query["groupBy"]
			else [],
			"rows": rows,
			"matched_count": count,
			"next_start": start + page_length if start + page_length < count else None,
			"summary": projection.summary(),
			"tables": [
				{"id": key, "label": TABLE_LABELS.get(key, key), "count": projection.count(key)}
				for key in projection.column_names
				if key not in INTERNAL_TABLES
			],
		}


@frappe.whitelist()
def group_page(query, parent_path=None, parent_unit=None, start=0, page_length=30, refresh=False):
	"""Page only one requested group's children from the fully filtered projection."""
	from frappe.utils import cint

	require_app()
	if type(refresh) is not bool:
		frappe.throw("请选择有效的数据范围")
	validated = validate_query(query)
	group_by = validated["groupBy"]
	path = frappe.parse_json(parent_path) if isinstance(parent_path, str) else parent_path or []
	if not group_by or not isinstance(path, list) or len(path) > len(group_by):
		frappe.throw("请选择有效的分组路径")
	if any(not isinstance(value, str) or len(value) > 2000 for value in path):
		frappe.throw("请选择有效的分组路径")
	if parent_unit is not None and (not isinstance(parent_unit, str) or len(parent_unit) > 2000):
		frappe.throw("请选择有效的计量单位")
	start, size = max(0, cint(start)), min(100, max(1, cint(page_length)))
	return _group_page(validated, path, parent_unit, start, size, refresh)


def _group_page(validated, path, parent_unit, start, size, refresh=False):
	group_by = validated["groupBy"]
	with Projection(
		validated,
		refresh=refresh,
		load_item_children=validated["dataset"] not in ("movements", "loans"),
	) as projection:
		projection.build()
		if len(path) < len(group_by):
			table = "group_roots" if not path and len(group_by) == 2 else "grouped"
			fields = [group_field_name(validated, key) for key in group_by[: len(path) + 1]]
			rows, count = projection.matching_page(table, fields[: len(path)], path, parent_unit, start, size)
			rows = [row for row in rows if len(row.get("group_path") or []) == len(path) + 1]
			if group_field_name(validated, group_by[len(path)]) == "item_code":
				_add_authorized_item_images(projection.context, rows)
			return {
				"rows": rows,
				"matched_count": count,
				"next_start": start + size if start + size < count else None,
				"parent_path": path,
				"parent_unit": parent_unit,
				"row_grain": "group",
				"count_grain": group_count_grain(validated),
				"query": projection.query,
				"leaf_columns": display_columns(
					projection.group_source_table,
					projection.column_names.get(projection.group_source_table, []),
				),
			}
		fields = [group_field_name(validated, key) for key in group_by]
		source = projection.group_source_table
		rows, count = projection.matching_page(source, fields, path, parent_unit, start, size)
		if validated["view"] == "records" and validated["dataset"] in ("movements", "loans"):
			from temple_inventory.browse import _whole_operation

			whole_rows = [
				(row, _whole_operation(projection.context, row["doctype"], row["document"])) for row in rows
			]
			original_names = {name for _row, whole in whole_rows for name in whole.get("original_loans", [])}
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
			for row, whole in whole_rows:
				row["row_grain"] = "record"
				row["whole"] = whole
				row["original_loans"] = whole.get("original_loans", [])
				whole["original_loan_details"] = [
					original_details[name]
					for name in whole.get("original_loans", [])
					if name in original_details
				]
				row["can_settle"] = bool(
					validated["dataset"] == "loans"
					and row.get("docstatus") == 1
					and whole.get("loan_status") == "Open"
				)
		return {
			"rows": rows,
			"matched_count": count,
			"next_start": start + size if start + size < count else None,
			"parent_path": path,
			"parent_unit": parent_unit,
			"row_grain": "stock"
			if validated["dataset"] in ("inventory", "expiry")
			else "record"
			if validated["view"] == "records"
			else "allocation",
			"query": projection.query,
			"leaf_columns": display_columns(
				source,
				projection.column_names.get(source, []),
			),
		}
