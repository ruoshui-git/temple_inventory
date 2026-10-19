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
from temple_inventory.report_query import validate_query
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

INTERNAL_TABLES = {"loan_item_page", "linked_settlements"}

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
}
STOCK_SUMS = ("available", "loaned", "damaged", "stock_qty")
LOAN_SUMS = ("borrowed", "returned", "damaged", "lost", "outstanding", "stock_qty")
HISTORY_SUMS = ("opening", "incoming", "outgoing", "adjustment", "closing", "stock_qty")
COUNT_SUMS = ("baseline_qty", "actual_qty", "difference", "stock_qty")


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
	return [field for field in DISPLAY_COLUMNS.get(table, columns) if field != "id" and field in columns]


class Projection(AbstractContextManager):
	def __init__(self, query):
		self.query = validate_query(query)
		self.context = ReportContext(self.query)
		self.temp = tempfile.TemporaryDirectory(prefix="ti-report-")
		self.db = sqlite3.connect(f"{self.temp.name}/projection.sqlite")
		self.db.execute("pragma cache_size = -4096")
		self.db.execute("""create table rows (
			table_id text, identity text, date text, modified text, name text,
			quantity real, payload text, primary key(table_id, identity)
		)""")
		self.main_table = ""
		self.column_names = {}

	def __exit__(self, *args):
		self.db.close()
		self.temp.cleanup()

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
		field = {
			"identity": "identity",
			"date": "date",
			"modified": "modified",
			"quantity": "quantity",
			"name": "name",
			"batch": "batch",
		}[self.query["sortBy"]]
		direction = self.query["sort"]
		if field == "batch":
			cursor = self.db.execute(
				"select payload from rows where table_id=? order by json_extract(payload, '$.batch_no') "
				f"{direction}, identity {direction} limit ? offset ?",
				(table, limit if limit is not None else -1, offset),
			)
			for (payload,) in cursor:
				yield json.loads(payload)
			return
		cursor = self.db.execute(
			f"select payload from rows where table_id=? order by {field} {direction}, identity {direction} limit ? offset ?",
			(table, limit if limit is not None else -1, offset),
		)
		for (payload,) in cursor:
			yield json.loads(payload)

	def count(self, table):
		return self.db.execute("select count(*) from rows where table_id=?", (table,)).fetchone()[0]

	def group(self, source, target, fields, sums, *, maximums=()):
		self.column_names.setdefault(
			target, ["id", *fields, *sums, *maximums, "item_count", "document_count", "allocation_count"]
		)
		# Fields are internal constants, never client-supplied SQL identifiers.
		expressions = [f"json_extract(payload, '$.{field}')" for field in fields]
		columns = [
			*expressions,
			*(f"sum(coalesce(json_extract(payload, '$.{field}'), 0))" for field in sums),
			*(f"max(json_extract(payload, '$.{field}'))" for field in maximums),
		]
		columns.extend(
			[
				"count(distinct json_extract(payload, '$.item_code'))",
				"count(distinct json_extract(payload, '$.document_id'))",
				"count(*)",
			]
		)
		grouping = " group by " + ", ".join(expressions) if expressions else ""
		cursor = self.db.execute(
			"select " + ", ".join(columns) + " from rows where table_id=?" + grouping, (source,)
		)
		for values in cursor:
			if not values[-1]:
				continue
			row = dict(
				zip(
					[*fields, *sums, *maximums, "item_count", "document_count", "allocation_count"],
					values,
					strict=True,
				)
			)
			row["id"] = json.dumps([target, *values[: len(fields)]], ensure_ascii=False)
			self.put(target, row)

	def build(self, *, related=False):
		query, context = self.query, self.context
		dataset, view = query["dataset"], query["view"]
		if dataset == "inventory" and view == "historical":
			self.column_names.update({key: list(FIXED_COLUMNS[key]) for key in ("balances", "ledger")})
			for table, row in historical_rows(context):
				self.put(table, row)
			self.main_table, sums = "balances", HISTORY_SUMS
		elif dataset in ("inventory", "expiry"):
			self.add("locations" if dataset == "inventory" else "batches", stock_rows(context))
			self.main_table = "locations" if dataset == "inventory" else "batches"
			sums = STOCK_SUMS
			if dataset == "inventory":
				self.group("locations", "summary", ("item_code", "item_name", "category", "stock_uom"), sums)
				self.main_table = view
		elif dataset == "movements":
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
			self.main_table, sums = view, ("stock_qty",)
		elif dataset == "loans":
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
		elif dataset == "activities":
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
		else:
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
		if query["grouping"] != "none":
			field = {
				"item": "item_code",
				"category": "category",
				"location": "warehouse",
				"kind": "kind",
				"activity": "activity",
				"borrower": "borrower",
				"month": "month",
			}[query["grouping"]]
			source = "loan_item_page" if dataset == "loans" and view == "items" else self.main_table
			if source in ("records", "summary"):
				source = (
					"lines"
					if dataset in ("movements", "counts")
					else "locations"
					if dataset == "inventory"
					else "outcomes"
					if dataset == "loans"
					else source
				)
			# Month/location grouping keeps separate allocation/branch detail tables.
			self.column_names["group_source"] = []
			for row in self.rows(source):
				row["month"] = str(row.get("date") or "")[:7]
				if field == "warehouse" and not row.get("warehouse"):
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
			labels = {
				"item_code": ("item_name",),
				"activity": ("activity_title", "title"),
				"warehouse": ("warehouse_label",),
			}.get(field, ())
			self.group(
				"group_source",
				"grouped",
				(field, "stock_uom", "docstatus", "kind", "outcome"),
				sums,
				maximums=tuple(label for label in labels if label in self.column_names[source]),
			)
			self.db.execute("delete from rows where table_id='group_source'")
			del self.column_names["group_source"]
			self.main_table = "grouped"
			TABLE_LABELS.setdefault("grouped", "分组汇总")
		if related:
			self.add_related_tables()
		self.db.commit()
		return self

	def complete_native_records(self, dataset):
		"""Expand selected document records to whole native quantities after line matching."""
		from temple_inventory.native_balances import reconciliation_allocations
		from temple_inventory.native_stock import batch_quantities, loan_balances

		selected = {}
		for row in self.rows("records"):
			selected[(row["doctype"], row["document"])] = row
		self.db.execute("delete from rows where table_id='records'")
		for doctype, name in selected:
			doc = self.context.parent(doctype, name)
			if not doc:
				continue
			base = document_fields(self.context, doc)
			groups = {}
			item_codes = set()
			balances = loan_balances(name, by_batch=True) if dataset == "loans" else None
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
						for allocation in reconciliation_allocations(line):
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
				self.put(
					"records",
					{
						**base,
						"id": f"{doctype}:{name}:{uom}",
						"stock_uom": uom,
						**{key: value for key, value in values.items() if key not in ("item_codes",)},
						"item_count": len(values["item_codes"]),
					},
				)

	def summary(self):
		table = self.main_table
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
								"label": value.warehouse_name,
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
def report_page(query, start=0, page_length=30, table=None, include_related=False):
	require_app()
	start, page_length = max(0, cint(start)), min(200, max(1, cint(page_length)))
	with Projection(query) as projection:
		if type(include_related) is not bool:
			frappe.throw("请选择是否包含关联资料")
		projection.build(related=include_related)
		selected = table or projection.main_table
		if selected not in projection.column_names:
			frappe.throw("请选择有效的数据表")
		count = projection.count(selected)
		return {
			"query": projection.query,
			"scope": projection.context.scope,
			"period": projection.context.period,
			"snapshot": projection.context.snapshot,
			"table": selected,
			"columns": display_columns(selected, projection.column_names[selected]),
			"rows": list(projection.rows(selected, offset=start, limit=page_length)),
			"matched_count": count,
			"next_start": start + page_length if start + page_length < count else None,
			"summary": projection.summary(),
			"tables": [
				{"id": key, "label": TABLE_LABELS.get(key, key), "count": projection.count(key)}
				for key in projection.column_names
				if key not in INTERNAL_TABLES
			],
		}
