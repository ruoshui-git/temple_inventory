"""Bounded native queries and permission-scoped allocation projections."""

import copy
import json
import tempfile
from collections import defaultdict

import frappe
from frappe.utils import get_datetime, getdate, now_datetime, nowdate

from temple_inventory.native_balances import (
	batch_balances,
	entry_bundle,
	reconciliation_allocations,
	stock_balance,
)
from temple_inventory.native_stock import MOVEMENT_PURPOSES, batch_quantities, loan_balances, warehouse_scopes
from temple_inventory.report_query import in_period, resolved_period
from temple_inventory.uom_labels import uom_label


class _PreloadedRow(dict):
	"""Light child row for read projections without Frappe Document overhead."""

	def __getattr__(self, field):
		try:
			return self[field]
		except KeyError as error:
			raise AttributeError(field) from error


def paged(
	doctype, *, filters=None, fields=None, order_by="name asc", page_size=200, or_filters=None, group_by=None
):
	start = 0
	while True:
		rows = frappe.get_list(
			doctype,
			filters=filters or {},
			fields=fields or ["name"],
			or_filters=or_filters,
			order_by=order_by,
			start=start,
			limit_page_length=page_size,
			group_by=group_by,
		)
		yield from rows
		if len(rows) < page_size:
			return
		start += len(rows)


class ReportContext:
	def __init__(
		self,
		query,
		snapshot=None,
		*,
		snapshot_is_now=None,
		load_item_attachments=True,
		load_item_children=True,
	):
		# Bind caches per request; no decorator retains contexts across accounts.
		from functools import lru_cache

		self.item = lru_cache(maxsize=2048)(self.item)
		self._item_fields = lru_cache(maxsize=2048)(self._item_fields)
		self.load_item_attachments = load_item_attachments
		self.load_item_children = load_item_children
		self._permitted_item_images = None if load_item_attachments else defaultdict(set)
		self._loaded_primary_image_codes = set()
		self._permitted_item_attachments = defaultdict(list)
		self._bundle_cache = {}
		self._preloaded_bundles = {}
		self._preloaded_batches = {}
		self.activity = lru_cache(maxsize=512)(self.activity)
		self.parent = lru_cache(maxsize=4096)(self.parent)
		self.batch = lru_cache(maxsize=512)(self.batch)
		self._warehouse_doc = lru_cache(maxsize=512)(lambda name: frappe.get_doc("Warehouse", name))
		self._checked_warehouse_permissions = set()
		self.label = lru_cache(maxsize=512)(self.label)
		self._loan_balances = lru_cache(maxsize=2048)(
			lambda name, by_batch=False: loan_balances(name, by_batch=by_batch)
		)
		self.query = query
		self.scope = query["scope"]
		self.period = resolved_period(self.scope["period"])
		self.related_period = resolved_period(query["relatedPeriod"])
		self.snapshot_is_now = snapshot is None if snapshot_is_now is None else snapshot_is_now
		self.snapshot = str(snapshot or now_datetime())
		self.settings, self.warehouses, self.physical, self.leased, self.damaged = warehouse_scopes()
		from temple_inventory.native_topology import present_locations

		presented = present_locations(
			self.warehouses, physical_root=self.settings.physical_root_warehouse, settings=self.settings
		)
		self.location_labels = {row["name"]: row["label"] for row in presented}
		self.location_paths = {row["name"]: row["path"] for row in presented}
		self.native_location_names = {row["name"]: row["native_name"] for row in presented}
		self.settings.check_permission("read")
		self.company = self.settings.company
		if not self.company:
			frappe.throw("请先配置库存公司")
		self._company_doc = frappe.get_doc("Company", self.company)
		self._company_doc.check_permission("read")
		self._checked_company_permissions = {self.company}
		self.selected = self.expand_warehouses(self.scope["warehouses"])
		self.sources = self.expand_warehouses(self.scope["sources"])
		self.destinations = self.expand_warehouses(self.scope["destinations"])
		self.categories = self.expand_categories(self.scope["categories"])
		from temple_inventory.catalog import item_group_root

		self.category_root = item_group_root()
		self.category_filter_active = bool(self.scope["categories"] or self.scope["uncategorized"])

	def expand_warehouses(self, selection):
		if not selection:
			return {name for name, row in self.warehouses.items() if not row.is_group}
		result = set()
		for name in selection:
			parent = self.warehouses.get(name)
			if parent:
				result.update(
					key
					for key, row in self.warehouses.items()
					if not row.is_group and parent.lft <= row.lft and row.rgt <= parent.rgt
				)
		return result

	def expand_categories(self, selection):
		if not selection:
			return None
		result = set()
		for name in selection:
			if not frappe.has_permission("Item Group", "read", doc=name):
				continue
			parent = frappe.db.get_value("Item Group", name, ["lft", "rgt"], as_dict=True)
			if parent:
				result.update(
					row.name
					for row in paged(
						"Item Group", filters={"lft": [">=", parent.lft], "rgt": ["<=", parent.rgt]}
					)
				)
		return result

	def item(self, code):
		try:
			item = getattr(self, "_preloaded_items", {}).get(code) or frappe.get_doc("Item", code)
			item.check_permission("read")
		except frappe.PermissionError, frappe.DoesNotExistError:
			return None
		return item

	def activity(self, name):
		if not name:
			return None
		try:
			activity = getattr(self, "_preloaded_activities", {}).get(name) or frappe.get_doc(
				"Inventory Activity", name
			)
			activity.check_permission("read")
		except frappe.PermissionError, frappe.DoesNotExistError:
			return None
		return activity

	def parent(self, doctype, name):
		try:
			doc = (
				self._preloaded_parents.get((doctype, name)) if hasattr(self, "_preloaded_parents") else None
			)
			doc = doc or frappe.get_doc(doctype, name)
			doc.check_permission("read")
			if doc.company != self.company:
				return None
			if doctype in ("Stock Entry", "Stock Reconciliation"):
				self.check_document_scope(doc)
		except frappe.PermissionError, frappe.DoesNotExistError:
			return None
		return doc

	def batch(self, name):
		batch = self._preloaded_batches.get(name) or frappe.get_doc("Batch", name)
		batch.check_permission("read")
		return batch

	def check_document_scope(self, doc):
		"""Use the shared scope contract with request-local permission caches."""
		from temple_inventory.native_access import check_document_scope

		check_document_scope(
			doc,
			visible_warehouses=set(self.warehouses),
			item_checker=self.item,
			batch_checker=self.batch,
			company_checker=self.check_document_company,
			warehouse_checker=self.check_warehouse_permission,
			bundle_cache=self._bundle_cache,
			bundle_loader=self.bundle,
		)

	def check_document_company(self, doc):
		if doc.company != self.company:
			frappe.throw("记录不属于当前库存公司", frappe.PermissionError)
		if doc.company not in self._checked_company_permissions:
			self._company_doc.check_permission("read")
			self._checked_company_permissions.add(doc.company)

	def check_warehouse_permission(self, warehouse):
		if warehouse not in self._checked_warehouse_permissions:
			self._warehouse_doc(warehouse).check_permission("read")
			self._checked_warehouse_permissions.add(warehouse)

	def preload_parents(self, doctype, names):
		"""Batch-load native headers and child rows after permission-filtered listing."""
		if not names:
			return
		if not hasattr(self, "_preloaded_parents"):
			self._preloaded_parents = {}
		names = sorted(
			set(names)
			- {name for parent_doctype, name in self._preloaded_parents if parent_doctype == doctype}
		)
		if not names:
			return
		meta = frappe.get_meta(doctype)
		child_fields = [
			field
			for field in ("items", "ti_count_review")
			if meta.get_field(field) and meta.get_field(field).options
		]
		for start in range(0, len(names), 500):
			batch_names = names[start : start + 500]
			parents = frappe.get_all(
				doctype,
				filters={"name": ["in", batch_names]},
				fields=["*"],
				limit_page_length=0,
			)
			children = {}
			for field in child_fields:
				child_doctype = meta.get_field(field).options
				rows = frappe.get_all(
					child_doctype,
					filters={"parent": ["in", batch_names], "parenttype": doctype, "parentfield": field},
					fields=["*"],
					order_by="parent asc, idx asc",
					limit_page_length=0,
				)
				by_parent = defaultdict(list)
				for row in rows:
					by_parent[row.parent].append(dict(row))
				children[field] = by_parent
			for row in parents:
				payload = {**dict(row), "doctype": doctype}
				doc = frappe.get_doc(payload)
				for field in child_fields:
					doc.__dict__[field] = [
						_PreloadedRow({**child, "_parent_docstatus": row.docstatus})
						for child in children[field].get(row.name, [])
					]
				doc.__islocal = 0
				self._preloaded_parents[(doctype, row.name)] = doc

	def preload_item_attachments(self, item_codes):
		"""Batch-check attached private Files while preserving File read/privacy checks."""
		if not self.load_item_attachments:
			return
		from temple_inventory.native_files import can_read

		if self._permitted_item_images is None:
			self._permitted_item_images = defaultdict(set)
		self._loaded_attachment_item_codes = getattr(self, "_loaded_attachment_item_codes", set())
		codes = set(item_codes) - self._loaded_attachment_item_codes
		if not codes:
			return
		for row in frappe.get_list(
			"File",
			filters={
				"attached_to_doctype": "Item",
				"attached_to_name": ["in", sorted(codes) or [""]],
				"is_private": 1,
			},
			fields=[
				"name",
				"attached_to_name",
				"file_name",
				"file_url",
				"file_size",
				"file_type",
				"creation",
			],
			order_by="creation asc, name asc",
			limit_page_length=0,
		):
			file_doc = frappe.get_doc("File", row.name)
			if file_doc.has_permission("read") and can_read(file_doc):
				self._permitted_item_images[row.attached_to_name].add(row.file_url)
				self._permitted_item_attachments[row.attached_to_name].append(dict(row))
		self._loaded_attachment_item_codes.update(codes)

	def preload_primary_item_images(self, item_codes):
		"""Permission-check only each selected Item's primary private image."""
		from temple_inventory.native_files import can_read

		if self._permitted_item_images is None:
			self._permitted_item_images = defaultdict(set)
		codes = set(item_codes) - self._loaded_primary_image_codes
		if not codes:
			return
		self._loaded_primary_image_codes.update(codes)
		images = {
			row.name: row.image
			for row in frappe.get_list(
				"Item", filters={"name": ["in", sorted(codes)]}, fields=["name", "image"]
			)
			if row.image
		}
		if not images:
			return
		for row in frappe.get_list(
			"File",
			filters={
				"attached_to_doctype": "Item",
				"attached_to_name": ["in", sorted(images)],
				"file_url": ["in", sorted(set(images.values()))],
				"is_private": 1,
			},
			fields=["name", "attached_to_name", "file_url"],
			limit_page_length=0,
		):
			if row.file_url != images.get(row.attached_to_name):
				continue
			file_doc = frappe.get_doc("File", row.name)
			if file_doc.has_permission("read") and can_read(file_doc):
				self._permitted_item_images[row.attached_to_name].add(row.file_url)

	def preload_items(self, item_codes):
		"""Load permission-visible Item fields in one query; checks still run per Item."""
		self._preloaded_items = getattr(self, "_preloaded_items", {})
		codes = sorted(set(item_codes) - self._preloaded_items.keys())
		for start in range(0, len(codes), 500):
			batch_codes = codes[start : start + 500]
			rows = frappe.get_list("Item", filters={"name": ["in", batch_codes]}, fields=["*"])
			child_tables = {}
			if self.load_item_children:
				meta = frappe.get_meta("Item")
				for field in ("barcodes", "uoms"):
					definition = meta.get_field(field)
					if not definition or not definition.options:
						continue
					child_rows = frappe.get_all(
						definition.options,
						filters={"parent": ["in", batch_codes], "parenttype": "Item", "parentfield": field},
						fields=["*"],
						order_by="parent asc, idx asc",
						limit_page_length=0,
					)
					by_parent = defaultdict(list)
					for child in child_rows:
						by_parent[child.parent].append(dict(child))
					child_tables[field] = by_parent
			for row in rows:
				payload = dict(row)
				payload["doctype"] = "Item"
				item = frappe.get_doc(payload)
				for field, grouped in child_tables.items():
					item.__dict__[field] = [_PreloadedRow(child) for child in grouped.get(row.name, [])]
				item.__islocal = 0
				self._preloaded_items[item.name] = item

	def preload_activities(self, names):
		self._preloaded_activities = getattr(self, "_preloaded_activities", {})
		pending = sorted(set(names) - self._preloaded_activities.keys())
		for start in range(0, len(pending), 500):
			rows = frappe.get_list(
				"Inventory Activity", filters={"name": ["in", pending[start : start + 500]]}, fields=["*"]
			)
			for row in rows:
				activity = frappe.new_doc("Inventory Activity")
				activity.update(dict(row))
				activity.__islocal = 0
				self._preloaded_activities[activity.name] = activity

	def preload_bundles(self, rows):
		"""Bulk-load permission-filtered native bundles and entry rows for a build."""
		names = {
			row.get(field)
			for row in rows
			for field in ("serial_and_batch_bundle", "current_serial_and_batch_bundle")
			if row.get(field)
		}
		pending = sorted(names - self._preloaded_bundles.keys())
		if not pending:
			return
		meta = frappe.get_meta("Serial and Batch Bundle")
		field = meta.get_field("entries")
		child_doctype = field.options if field else None
		for start in range(0, len(pending), 500):
			batch_names = pending[start : start + 500]
			bundles = frappe.get_list(
				"Serial and Batch Bundle",
				filters={"name": ["in", batch_names]},
				fields=["*"],
				limit_page_length=0,
			)
			entries = defaultdict(list)
			if child_doctype:
				for row in frappe.get_all(
					child_doctype,
					filters={
						"parent": ["in", batch_names],
						"parenttype": "Serial and Batch Bundle",
						"parentfield": "entries",
					},
					fields=["*"],
					order_by="parent asc, idx asc",
					limit_page_length=0,
				):
					entries[row.parent].append(_PreloadedRow(dict(row)))
			for row in bundles:
				payload = {**dict(row), "doctype": "Serial and Batch Bundle"}
				doc = frappe.get_doc(payload)
				if child_doctype:
					doc.__dict__["entries"] = entries.get(row.name, [])
				self._preloaded_bundles[row.name] = doc
		self.preload_batches(
			row.get("batch_no") for bundle in self._preloaded_bundles.values() for row in bundle.entries or []
		)

	def preload_batches(self, names):
		pending = sorted({name for name in names if name} - self._preloaded_batches.keys())
		for start in range(0, len(pending), 500):
			rows = frappe.get_list(
				"Batch",
				filters={"name": ["in", pending[start : start + 500]]},
				fields=["*"],
				limit_page_length=0,
			)
			for row in rows:
				payload = {**dict(row), "doctype": "Batch"}
				self._preloaded_batches[row.name] = frappe.get_doc(payload)

	def bundle(self, name):
		return self._preloaded_bundles.get(name)

	def item_fields(self, item):
		return self._item_fields(item.name)

	def loan_balances(self, name, *, by_batch=False):
		return self._loan_balances(name, by_batch)

	def set_snapshot(self, snapshot):
		self.snapshot = str(get_datetime(snapshot))
		self.snapshot_is_now = False

	def _item_fields(self, code):
		item = self.item(code)
		if not self.load_item_attachments:
			images = self._permitted_item_images.get(item.name, set())
		elif self._permitted_item_images is None:
			from temple_inventory.native_files import attachments

			images = {file.file_url for file in attachments("Item", item.name)}
		else:
			images = self._permitted_item_images.get(item.name, set())
		image = item.image if item.image in images else ""
		return {
			"item_code": item.name,
			"item_name": item.item_name,
			"category": "" if item.item_group == self.category_root else item.item_group,
			"category_label": "无分类" if item.item_group == self.category_root else item.item_group,
			"stock_uom": item.stock_uom,
			"stock_uom_label": uom_label(item.stock_uom),
			"image": image,
			"batch_tracked": bool(item.has_batch_no),
			"expiry_tracked": bool(item.has_expiry_date),
			"disabled": bool(item.disabled),
		}

	def label(self, warehouse):
		return self.location_labels.get(warehouse, "")

	def location_fields(self, warehouse, prefix=""):
		"""Return local and ERPNext names only for Warehouses in this request's visible scope."""
		visible = warehouse in self.warehouses
		return {
			f"{prefix}warehouse_path": self.location_paths.get(warehouse, "") if visible else "",
			f"{prefix}warehouse_native_name": self.native_location_names.get(warehouse, "")
			if visible
			else "",
		}

	def matches_item(self, code, warehouse=None):
		query = self.query
		if query["restrictItems"] and code not in query["itemCodes"]:
			return False
		if self.scope["item"] and code != self.scope["item"]:
			return False
		item = self.item(code)
		if not item:
			return False
		tracking = self.scope.get("tracking", "all")
		if tracking == "batch" and not item.has_batch_no:
			return False
		if tracking == "expiry" and not item.has_expiry_date:
			return False
		if tracking == "batch_only" and (not item.has_batch_no or item.has_expiry_date):
			return False
		if tracking == "none" and (item.has_batch_no or item.has_expiry_date):
			return False
		status = query.get("itemStatus", "enabled")
		if status == "enabled" and item.disabled:
			return False
		if status == "disabled" and not item.disabled:
			return False
		if self.category_filter_active and not (
			(self.categories is not None and item.item_group in self.categories)
			or (self.scope["uncategorized"] and item.item_group == self.category_root)
		):
			return False
		if warehouse and query["itemLocationKeys"]:
			# JSON keys avoid ambiguity when native names contain slashes.
			import json

			if (
				json.dumps([code, warehouse], ensure_ascii=False, separators=(",", ":"))
				not in query["itemLocationKeys"]
				and f"{code}/{warehouse}" not in query["itemLocationKeys"]
			):
				return False
		return True

	def matches_search(self, values, *, related=False):
		term = self.query["relatedSearch" if related else "search"].strip().casefold()
		return not term or term in " ".join(str(value or "") for value in values).casefold()

	def matches_line(self, row, *, apply_activity=True, apply_search=True):
		query = self.query
		if query.get("batchNoExact") and (row.get("batch_no") or "") != query["batchNo"]:
			return False
		if not query.get("batchNoExact") and query.get("batchNo") and row.get("batch_no") != query["batchNo"]:
			return False
		if not self.matches_item(row["item_code"]):
			return False
		source, target = row.get("source_warehouse"), row.get("destination_warehouse")
		locations = [value for value in (source, target, row.get("warehouse")) if value]
		if not any(
			location in self.selected and self.matches_item(row["item_code"], location)
			for location in locations
		):
			return False
		if self.scope["sources"] and source not in self.sources:
			return False
		if self.scope["destinations"] and target not in self.destinations:
			return False
		if self.scope["kinds"] and row.get("kind") not in self.scope["kinds"]:
			return False
		if apply_activity and self.scope["activity"] and row.get("activity") != self.scope["activity"]:
			return False
		if (
			query["restrictAllocations"]
			and row["id"] not in query["allocationKeys"]
			and row.get("line_name") not in query["allocationKeys"]
		):
			return False
		if query["recordDoctype"] and row.get("doctype") != query["recordDoctype"]:
			return False
		if query["record"] and query["record"] not in (row.get("document"), row.get("document_id")):
			return False
		if query["loan"] and query["loan"] not in (row.get("original_loan"), row.get("document")):
			return False
		borrower = query.get("borrower", "").strip().casefold()
		if borrower and borrower not in str(row.get("borrower") or "").casefold():
			return False
		person = query.get("person", {})
		person_name = str(person.get("name") or "").strip().casefold()
		if person_name:
			fields = {
				"recorder": row.get("recorder"),
				"handler": row.get("handler"),
				"reviewer": row.get("reviewer"),
			}
			role = person.get("role", "any")
			values = fields.values() if role == "any" else (fields.get(role),)
			if not any(person_name in str(value or "").casefold() for value in values):
				return False
		if query["damageOnly"] and not (
			row.get("kind") in ("Damage", "Repair", "Disposal")
			or row.get("outcome") == "Damaged"
			or any(location in self.damaged for location in locations)
		):
			return False
		return not apply_search or self.matches_search(row.values())


def stock_pairs(context, item_codes=None):
	"""Page native Bin identities without retaining the whole catalog in memory."""
	filters = {"warehouse": ["in", sorted(context.selected) or [""]]}
	if item_codes is not None:
		filters["item_code"] = ["in", sorted(set(item_codes)) or [""]]
	for value in paged("Bin", filters=filters, fields=["item_code", "warehouse", "actual_qty"]):
		yield value.item_code, value.warehouse, float(value.actual_qty or 0)
	include_zero_items = context.query["includeZero"] or (
		context.query["dataset"] == "inventory"
		and context.query["stockState"] in ("no_available", "no_stock", "all")
	)
	if include_zero_items:
		item_filters = {"is_stock_item": 1}
		if item_codes is not None:
			item_filters["name"] = ["in", sorted(set(item_codes)) or [""]]
		for item in paged("Item", filters=item_filters, fields=["name"]):
			if not frappe.db.exists("Bin", {**filters, "item_code": item.name}):
				yield item.name, "", 0.0


def stock_rows(context, *, item_codes=None):
	query = context.query
	if not context.selected:
		return
	pairs = list(stock_pairs(context, item_codes=item_codes))
	codes = {code for code, _warehouse, _quantity in pairs}
	context.preload_items(codes)
	if context.load_item_attachments:
		context.preload_item_attachments(codes)
	rows_by_item = defaultdict(list)
	for code, warehouse, bin_quantity in pairs:
		if not context.matches_item(code, warehouse):
			continue
		item = context.item(code)
		if (
			context.scope["activity"]
			or context.scope["kinds"]
			or context.scope["sources"]
			or context.scope["destinations"]
			or query["record"]
			or query["recordDoctype"]
			or query["loan"]
		):
			# Current stock has no transaction allocation ownership. A contextual
			# movement restriction must never silently become unrestricted stock.
			continue
		if item.has_batch_no and warehouse:
			include_zero = query["includeZero"] or (
				query["dataset"] == "inventory" and query["stockState"] in ("no_available", "no_stock", "all")
			)
			balances = batch_balances(code, warehouse, context.snapshot, include_zero=include_zero)
			quantities = [(row.get("batch_no"), row.get("qty", 0)) for row in balances]
		else:
			quantity = (
				bin_quantity
				if warehouse and getattr(context, "snapshot_is_now", False)
				else stock_balance(code, warehouse, context.snapshot)
				if warehouse
				else 0
			)
			quantities = [(None, quantity)]
		include_zero = query["includeZero"] or (
			query["dataset"] == "inventory" and query["stockState"] in ("no_available", "no_stock", "all")
		)
		if not quantities and include_zero:
			quantities = [(None, 0)]
		for batch_name, quantity in quantities:
			if query.get("batchNoExact") and (batch_name or "") != query["batchNo"]:
				continue
			if not query.get("batchNoExact") and query.get("batchNo") and batch_name != query["batchNo"]:
				continue
			allocation_id = json.dumps(
				[code, warehouse, batch_name or ""], ensure_ascii=False, separators=(",", ":")
			)
			if (
				query["restrictAllocations"]
				and allocation_id not in query["allocationKeys"]
				and f"{code}/{warehouse}/{batch_name or ''}" not in query["allocationKeys"]
			):
				continue
			if not quantity and not include_zero:
				continue
			batch = None
			if batch_name:
				batch = context.batch(batch_name)
			expiry = str(batch.expiry_date or "") if batch else ""
			if not context.matches_search(
				[code, item.item_name, item.description, item.item_group, warehouse, batch_name, expiry]
			):
				continue
			if query["dataset"] == "expiry":
				if not item.has_batch_no or not batch_name:
					continue
				if not expiry and (not query["includeUndated"] or context.scope["period"]["key"] != "all"):
					continue
				if expiry and not in_period(expiry, context.period):
					continue
				window = query["expiryWindow"]
				if window == "undated" and expiry:
					continue
				if window in ("expired", "unexpired") and (
					not expiry or (expiry < nowdate()) != (window == "expired")
				):
					continue
				if window.startswith("next_") and (
					not expiry or not 0 <= (getdate(expiry) - getdate(nowdate())).days <= int(window[5:])
				):
					continue
			kind = (
				"loaned"
				if warehouse in context.leased
				else "damaged"
				if warehouse in context.damaged
				else "available"
			)
			if query["damageOnly"] and kind != "damaged":
				continue
			rows_by_item[code].append(
				{
					"id": allocation_id,
					**context.item_fields(item),
					"warehouse": warehouse,
					"warehouse_label": context.label(warehouse),
					**context.location_fields(warehouse),
					"batch_no": batch_name or "",
					"manufacturing_date": str(batch.manufacturing_date or "") if batch else "",
					"expiry_date": expiry,
					"remaining_days": (getdate(expiry) - getdate(nowdate())).days if expiry else None,
					"available": float(quantity) if kind == "available" else 0,
					"loaned": float(quantity) if kind == "loaned" else 0,
					"damaged": float(quantity) if kind == "damaged" else 0,
					"stock_qty": float(quantity),
					"snapshot": context.snapshot,
				}
			)
	if query["dataset"] != "inventory":
		for rows in rows_by_item.values():
			yield from rows
		return
	stock_state = query["stockState"]
	for _code, rows in rows_by_item.items():
		available = sum(row["available"] for row in rows)
		total = sum(row["stock_qty"] for row in rows)
		keep = {
			"in_stock": any(row["stock_qty"] != 0 for row in rows),
			"available": available > 0,
			"no_available": available <= 0,
			"no_stock": total == 0,
			"all": True,
		}[stock_state]
		if keep:
			yield from rows


def document_kind(doc):
	if doc.doctype == "Stock Reconciliation":
		return {"Opening Stock": "Opening", "Stock Reconciliation": "Reconcile"}.get(doc.purpose, doc.purpose)
	return doc.get("ti_movement_kind") or {
		"Material Receipt": "Receive",
		"Material Issue": "Issue",
		"Material Transfer": "Transfer",
	}.get(doc.purpose, doc.purpose)


def whole_operation(context, doctype, name):
	"""Build a permission-checked whole-document summary shared by browse and grouped reports."""
	doc = context.parent(doctype, name)
	if not doc:
		frappe.throw("原生记录不存在或无权访问", frappe.PermissionError)
	quantities = defaultdict(float)
	gains = defaultdict(float)
	losses = defaultdict(float)
	available_effects = defaultdict(float)
	branches, items, originals = set(), set(), set()
	first_item_name = ""
	kind = document_kind(doc)
	for row in doc.items:
		item = context.item(row.item_code)
		if not item:
			frappe.throw("原生记录包含无权访问的物品", frappe.PermissionError)
		items.add(item.name)
		if not first_item_name:
			first_item_name = item.item_name or item.name
		quantity = (
			float(row.get("transfer_qty") or 0)
			if doctype == "Stock Entry"
			else float(row.qty) - (float(row.current_qty or 0) if doc.purpose != "Opening Stock" else 0)
		)
		quantities[item.stock_uom] += quantity
		if doctype == "Stock Reconciliation":
			if quantity > 0:
				gains[item.stock_uom] += quantity
			elif quantity < 0:
				losses[item.stock_uom] += quantity
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
				(doctype == "Stock Entry" and doc.purpose in MOVEMENT_PURPOSES.values())
				or (doctype == "Stock Reconciliation" and doc.purpose == "Stock Reconciliation")
			)
		),
		"quantities": [{"uom": unit, "qty": quantity} for unit, quantity in sorted(quantities.items())],
		"available_effects": [
			{"uom": unit, "qty": quantity} for unit, quantity in sorted(available_effects.items())
		],
		"item_count": len(items),
		"item_name": first_item_name,
		"line_count": len(doc.items),
		"branches": [
			{
				"source": source,
				"destination": destination,
				"source_path": context.location_fields(source)["warehouse_path"],
				"source_native_name": context.location_fields(source)["warehouse_native_name"],
				"destination_path": context.location_fields(destination)["warehouse_path"],
				"destination_native_name": context.location_fields(destination)["warehouse_native_name"],
			}
			for source, destination in sorted(branches)
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
		original_lines = {
			(line.name, line.item_code): line for line in doc.items if line.name and line.item_code
		}
		candidate_names = _settlement_document_names(
			(doc.name, line_name, item_code) for line_name, item_code in original_lines
		)
		settlements = {}
		valid_settlements = {
			"Return": ("Material Transfer", {"Returned", "Damaged"}),
			"Damage": ("Material Transfer", {"Damaged"}),
			"Loss": ("Material Issue", {"Lost"}),
		}
		for row in movement_rows(
			context,
			include_all_dates=True,
			apply_activity=False,
			apply_search=False,
			document_names=candidate_names,
		):
			original = original_lines.get((row.get("original_loan_line"), row.get("item_code")))
			settlement = valid_settlements.get(row.get("kind"))
			parent = context.parent(row["doctype"], row["document"])
			if (
				original
				and settlement
				and parent
				and parent.purpose == settlement[0]
				and row.get("outcome") in settlement[1]
				and row.get("source_warehouse") == original.get("t_warehouse")
			):
				settlements[row["document"]] = row["kind"]
		result["settlement_records"] = [
			{"name": settlement_name, "kind": settlement_kind}
			for settlement_name, settlement_kind in sorted(settlements.items())
		]
	if doctype == "Stock Reconciliation":
		# gains/losses are signed per-unit aggregates; losses stay negative.
		result["gains"] = [{"uom": unit, "qty": quantity} for unit, quantity in sorted(gains.items())]
		result["losses"] = [{"uom": unit, "qty": quantity} for unit, quantity in sorted(losses.items())]
		warehouses = doc.get("ti_count_warehouses") or json.dumps(
			sorted(
				{str(row.get("warehouse")) for row in doc.items if row.get("warehouse") in context.physical}
			),
			ensure_ascii=False,
		)
		result["scope"] = warehouses
	return result


def document_fields(context, doc):
	activity = context.activity(doc.get("ti_activity"))
	return {
		"doctype": doc.doctype,
		"document": doc.name,
		"document_id": f"{doc.doctype}:{doc.name}",
		"docstatus": int(doc.docstatus),
		"kind": document_kind(doc),
		"date": str(doc.posting_date),
		"time": str(doc.posting_time),
		"posting_timestamp": str(get_datetime(f"{doc.posting_date} {doc.posting_time}")),
		"modified": str(doc.modified),
		"activity": activity.name if activity else "",
		"activity_title": activity.title if activity else "",
		"activity_type": activity.activity_type if activity else "",
		"borrower": doc.get("ti_borrower") or "",
		"source": doc.get("ti_source_text") or "",
		"purpose": doc.get("ti_purpose_text") or "",
		"recorded_by": doc.owner,
		"recorder": doc.get("ti_recorder_name") or "",
		"handler": doc.get("ti_handler_name") or "",
		"reviewer": doc.get("ti_reviewer_name") or "",
		"notes": doc.get("ti_notes") or doc.get("remarks") or "",
		"amended_from": doc.get("amended_from") or "",
	}


def batch_allocations(row, context=None):
	bundle = entry_bundle(
		row,
		batch_checker=context.batch if context else None,
		bundle_cache=context._bundle_cache if context else None,
		bundle_loader=context.bundle if context else None,
	)
	if not bundle:
		yield row.get("batch_no") or "", float(row.get("transfer_qty") or row.get("qty") or 0), ""
		return
	for allocation in bundle.entries:
		yield allocation.batch_no or "", abs(float(allocation.qty)), allocation.name


def available_scope_leaves(context):
	"""Default to usable stock leaves; explicit location scopes include every selected leaf."""
	return context.selected if context.scope["warehouses"] else context.physical


def available_stock_effect(
	context,
	*,
	docstatus,
	kind,
	quantity,
	source_warehouse="",
	destination_warehouse="",
	warehouse="",
):
	"""Signed native quantity effect on available stock for one movement allocation."""
	if int(docstatus or 0) != 1:
		return 0.0
	leaves = available_scope_leaves(context)
	if kind in ("Opening", "Reconcile"):
		return float(quantity or 0) if warehouse in leaves else 0.0
	return float(quantity or 0) * (
		int(bool(destination_warehouse) and destination_warehouse in leaves)
		- int(bool(source_warehouse) and source_warehouse in leaves)
	)


def movement_rows(
	context,
	*,
	include_all_dates=False,
	apply_activity=True,
	apply_search=True,
	statuses=None,
	document_names=None,
):
	query = context.query
	for doctype in ("Stock Entry", "Stock Reconciliation"):
		if document_names is not None and doctype != "Stock Entry":
			continue
		filters = {
			"company": context.company,
			"docstatus": ["in", query["statuses"] if statuses is None else statuses],
		}
		if document_names is not None:
			filters["name"] = ["in", sorted(set(document_names)) or [""]]
		if not include_all_dates:
			if context.period["date_from"]:
				filters["posting_date"] = [
					"between",
					[context.period["date_from"], context.period["date_to"]],
				]
		values = list(paged(doctype, filters=filters))
		names = [value.name for value in values]
		context.preload_parents(doctype, names)
		parents = [context._preloaded_parents[(doctype, name)] for name in names]
		lines = [
			line for doc in parents for field in ("items", "ti_count_review") for line in doc.get(field) or []
		]
		context.preload_bundles(lines)
		context.preload_batches(line.get("batch_no") for line in lines)
		context.preload_items(line.item_code for doc in parents for line in doc.get("items") or [])
		context.preload_activities(doc.get("ti_activity") for doc in parents if doc.get("ti_activity"))
		context.preload_item_attachments(
			line.item_code
			for name in names
			for line in context._preloaded_parents[(doctype, name)].get("items") or []
		)
		for value in values:
			doc = context.parent(doctype, value.name)
			if not doc:
				continue
			header = document_fields(context, doc)
			for line in doc.items:
				item = context.item(line.item_code)
				if not item:
					continue
				allocations = (
					reconciliation_allocations(
						line,
						batch_checker=context.batch,
						bundle_cache=context._bundle_cache,
						bundle_loader=context.bundle,
					)
					if doctype == "Stock Reconciliation"
					else (
						{"batch_no": batch, "actual_qty": quantity, "bundle_line": allocation}
						for batch, quantity, allocation in batch_allocations(line, context)
					)
				)
				for allocation in allocations:
					batch = allocation["batch_no"]
					quantity = allocation["actual_qty"]
					bundle_line = allocation["bundle_line"]
					row = {
						**header,
						**context.item_fields(item),
						"line_name": line.name,
						"bundle_line": bundle_line,
						"id": f"{doctype}:{doc.name}:{line.name}:{bundle_line or batch}",
						"source_warehouse": line.get("s_warehouse") or "",
						"destination_warehouse": line.get("t_warehouse") or "",
						"warehouse": line.get("warehouse") or "",
						**context.location_fields(line.get("s_warehouse") or "", "source_"),
						**context.location_fields(line.get("t_warehouse") or "", "destination_"),
						**context.location_fields(line.get("warehouse") or ""),
						"batch_no": batch,
						"entered_qty": float(line.qty or 0),
						"entered_uom": line.get("uom") or item.stock_uom,
						"entered_uom_label": uom_label(line.get("uom") or item.stock_uom),
						"conversion_factor": float(line.get("conversion_factor") or 1),
						"stock_qty": quantity,
						"original_loan": line.get("ti_original_loan") or "",
						"original_loan_line": line.get("ti_original_loan_line") or "",
						"origin_warehouse": line.get("ti_origin_warehouse") or "",
						**context.location_fields(line.get("ti_origin_warehouse") or "", "origin_"),
						"outcome": line.get("ti_settlement_outcome") or "",
						"reason": line.get("ti_allocation_note") or "",
					}
					if bundle_line:
						row["entered_qty"] = quantity / row["conversion_factor"]
					if doctype == "Stock Reconciliation":
						row.update(allocation)
						row["entered_qty"] = quantity
						row["stock_qty"] = row["difference"] if header["kind"] != "Opening" else quantity
					available_effect = available_stock_effect(
						context,
						docstatus=doc.docstatus,
						kind=header["kind"],
						quantity=(row.get("difference") or 0)
						if doctype == "Stock Reconciliation" and header["kind"] != "Opening"
						else quantity,
						source_warehouse=row["source_warehouse"],
						destination_warehouse=row["destination_warehouse"],
						warehouse=row["warehouse"],
					)
					row["available_effect"] = available_effect
					if context.matches_line(row, apply_activity=apply_activity, apply_search=apply_search):
						yield row


def loan_rows(context):
	query = context.query
	values = list(
		paged(
			"Stock Entry",
			filters={
				"company": context.company,
				"ti_movement_kind": "Loan",
				"docstatus": ["in", [1] if query["view"] == "items" else query["statuses"]],
			},
		)
	)
	names = [value.name for value in values]
	context.preload_parents("Stock Entry", names)
	parents = [context._preloaded_parents[("Stock Entry", name)] for name in names]
	lines = [line for doc in parents for line in doc.get("items") or []]
	context.preload_bundles(lines)
	context.preload_batches(line.get("batch_no") for line in lines)
	context.preload_items(line.item_code for doc in parents for line in doc.get("items") or [])
	context.preload_activities(doc.get("ti_activity") for doc in parents if doc.get("ti_activity"))
	context.preload_item_attachments(line.item_code for doc in parents for line in doc.get("items") or [])
	for value in values:
		loan = context.parent("Stock Entry", value.name)
		if not loan or not in_period(loan.posting_date, context.period):
			continue
		balances = context.loan_balances(loan.name, by_batch=True)
		has_outstanding = loan.docstatus == 1 and any(
			quantity > sum(balances[(line.name, batch)].values())
			for line in loan.items
			for batch, quantity in batch_quantities(line).items()
		)
		# Loan lifecycle belongs to the whole original document, before any
		# selected Item, warehouse, batch or allocation filters are applied.
		if query["view"] != "items" and query["loanStatus"] != "all" and loan.docstatus != 1:
			continue
		if (
			query["view"] != "items"
			and query["loanStatus"] in ("outstanding", "open")
			and not has_outstanding
		):
			continue
		if query["view"] != "items" and query["loanStatus"] == "settled" and has_outstanding:
			continue
		if (
			query["view"] == "records"
			and query["loanScope"] == "outstanding"
			and loan.docstatus != 0
			and (loan.docstatus != 1 or not has_outstanding)
		):
			continue
		for line in loan.items:
			item = context.item(line.item_code)
			if not item:
				continue
			for batch, batch_quantity in batch_quantities(line).items():
				outcomes = balances[(line.name, batch)]
				borrowed = float(batch_quantity)
				outstanding = borrowed - float(sum(outcomes.values())) if loan.docstatus == 1 else 0
				row = {
					**document_fields(context, loan),
					**context.item_fields(item),
					"id": f"Stock Entry:{loan.name}:{line.name}:{batch}",
					"line_name": line.name,
					"original_loan": loan.name,
					"original_loan_line": line.name,
					"source_warehouse": line.s_warehouse,
					"destination_warehouse": line.t_warehouse,
					**context.location_fields(line.s_warehouse or "", "source_"),
					**context.location_fields(line.t_warehouse or "", "destination_"),
					"batch_no": batch,
					"entered_qty": borrowed / float(line.conversion_factor),
					"native_line_entered_qty": float(line.qty),
					"entered_uom": line.uom,
					"entered_uom_label": uom_label(line.uom),
					"conversion_factor": float(line.conversion_factor),
					"borrowed": borrowed,
					"returned": float(outcomes["Returned"]),
					"damaged": float(outcomes["Damaged"]),
					"lost": float(outcomes["Lost"]),
					"outstanding": outstanding,
					"stock_qty": outstanding,
					"balance_at": context.snapshot,
					"loan_status": "Draft"
					if loan.docstatus == 0
					else "Cancelled"
					if loan.docstatus == 2
					else "Open"
					if has_outstanding
					else "Settled",
				}
				if query["outstandingOnly"] and outstanding <= 0:
					continue
				if query["loanOutcome"] != "all" and row.get(query["loanOutcome"], 0) <= 0:
					continue
				if context.matches_line(row):
					yield row


def _settlement_document_names(originals):
	"""Find candidate native settlement parents without scanning unrelated movements."""
	originals = set(originals)
	loan_names = sorted({loan for loan, _line, _item in originals if loan})
	if not loan_names:
		return set()
	parents = set()
	for start in range(0, len(loan_names), 500):
		rows = frappe.get_all(
			"Stock Entry Detail",
			filters={"ti_original_loan": ["in", loan_names[start : start + 500]]},
			fields=["parent", "ti_original_loan", "ti_original_loan_line", "item_code"],
			limit_page_length=0,
		)
		parents.update(
			row.parent
			for row in rows
			if (row.ti_original_loan, row.ti_original_loan_line, row.item_code) in originals
		)
	return parents


def settlement_rows(context):
	loans = {(row["original_loan_line"], row.get("batch_no") or ""): row for row in loan_rows(context)}
	document_names = _settlement_document_names(
		(row["original_loan"], row["original_loan_line"], row["item_code"]) for row in loans.values()
	)
	for row in movement_rows(
		context,
		include_all_dates=True,
		apply_activity=False,
		apply_search=False,
		document_names=document_names,
	):
		original = loans.get((row["original_loan_line"], row.get("batch_no") or ""))
		if not original or row["original_loan"] != original["original_loan"]:
			continue
		if not in_period(row["date"], context.related_period) or not context.matches_search(
			row.values(), related=True
		):
			continue
		yield {
			**row,
			"loan_date": original["date"],
			"original_activity": original["activity"],
			"original_activity_title": original["activity_title"],
		}


def linked_settlement_rows(context):
	"""Return submitted events linked to loans selected by the original loan filters."""
	originals = {
		(
			row["original_loan"],
			row["original_loan_line"],
			row.get("batch_no") or "",
			row["item_code"],
		): row
		for row in loan_rows(context)
	}
	if not originals:
		return
	document_names = _settlement_document_names((key[0], key[1], key[3]) for key in originals)
	if not document_names:
		return
	query = copy.deepcopy(context.query)
	query["dataset"], query["view"] = "movements", "lines"
	query["statuses"] = [1]
	query["search"], query["batchNo"], query["record"], query["recordDoctype"], query["loan"] = (
		"",
		"",
		"",
		"",
		"",
	)
	query["restrictItems"], query["restrictAllocations"] = False, False
	query["itemCodes"], query["allocationKeys"] = [], []
	query["itemLocationKeys"] = []
	query["relatedPeriod"] = {"key": "all", "from": "", "to": ""}
	query["relatedSearch"], query["relatedPresence"] = "", "all"
	query["activityKind"], query["activityStatus"] = "", "all"
	query["damageOnly"] = False
	query["scope"] = copy.deepcopy(query["scope"])
	query["scope"].update(
		{
			"period": {"key": "all", "from": "", "to": ""},
			"warehouses": [],
			"categories": [],
			"sources": [],
			"destinations": [],
			"kinds": [],
			"activity": "",
			"item": "",
		}
	)
	history_context = ReportContext(query, load_item_attachments=context.load_item_attachments)
	native_purposes = {}
	for row in movement_rows(
		history_context,
		include_all_dates=True,
		apply_activity=False,
		apply_search=False,
		document_names=document_names,
	):
		key = (
			row["original_loan"],
			row["original_loan_line"],
			row.get("batch_no") or "",
			row["item_code"],
		)
		original = originals.get(key)
		valid_settlements = {
			"Return": ("Material Transfer", {"Returned", "Damaged"}),
			"Damage": ("Material Transfer", {"Damaged"}),
			"Loss": ("Material Issue", {"Lost"}),
		}
		settlement = valid_settlements.get(row.get("kind"))
		document_key = (row["doctype"], row["document"])
		if document_key not in native_purposes:
			parent = history_context.parent(*document_key)
			native_purposes[document_key] = parent.get("purpose") if parent else ""
		if (
			not original
			or not settlement
			or native_purposes[document_key] != settlement[0]
			or row.get("outcome") not in settlement[1]
			or row.get("source_warehouse") != original.get("destination_warehouse")
		):
			continue
		locations = [row.get("source_warehouse"), row.get("destination_warehouse")]
		if not any(location in history_context.selected for location in locations if location):
			continue
		yield {
			**row,
			"loan_date": original["date"],
			"original_activity": original["activity"],
			"original_activity_title": original["activity_title"],
		}


def count_rows(context):
	query = context.query
	for value in paged(
		"Stock Reconciliation", filters={"company": context.company, "docstatus": ["in", query["statuses"]]}
	):
		doc = context.parent("Stock Reconciliation", value.name)
		if (
			not doc
			or doc.purpose not in ("Stock Reconciliation", "Opening Stock")
			or not in_period(doc.posting_date, context.period)
		):
			continue
		custom = bool(doc.get("ti_count_review"))
		for line in doc.ti_count_review if custom else doc.items:
			item = context.item(line.item_code)
			if not item:
				continue
			state = line.review_state if custom else "Native"
			review_filter = query["countReviewed"]
			if (review_filter == "unreviewed" and state != "Unreviewed") or (
				review_filter == "reviewed" and state == "Unreviewed"
			):
				continue
			base = {
				**document_fields(context, doc),
				**context.item_fields(item),
				"id": f"Stock Reconciliation:{doc.name}:{line.name}",
				"line_name": line.name,
				"warehouse": line.warehouse,
				"review_state": state,
				"reason": line.get("reason") or "",
				"count_scope": doc.get("ti_count_scope") or "Native",
				"baseline_timestamp": str(doc.get("ti_baseline_timestamp") or ""),
			}
			if custom:
				baseline = float(line.baseline_qty or 0)
				actual = float(line.actual_qty or 0) if state != "Unreviewed" else None
				allocations = [
					{
						"batch_no": line.batch_no or "",
						"baseline_qty": baseline,
						"actual_qty": actual,
						"difference": actual - baseline if actual is not None else None,
					}
				]
			else:
				allocations = reconciliation_allocations(
					line,
					batch_checker=context.batch,
					bundle_cache=context._bundle_cache,
					bundle_loader=context.bundle,
				)
			for allocation in allocations:
				if doc.purpose == "Opening Stock":
					allocation = {
						**allocation,
						"baseline_qty": 0.0,
						"difference": float(allocation["actual_qty"] or 0),
					}
				row = {**base, **allocation, "stock_qty": allocation["difference"] or 0}
				if allocation["batch_no"]:
					row["id"] += ":" + allocation["batch_no"]
				if review_filter == "difference" and not allocation["difference"]:
					continue
				if context.matches_line(row):
					yield row


def historical_rows(context):
	"""Use native SLE running quantities and signed deltas, including both transfer branches.

	Rows marked is_cancelled by ERPNext are excluded exactly as in get_previous_sle.
	Native reconciliation deltas are adjustments, never counted again as incoming/outgoing.
	"""
	from erpnext.stock.stock_ledger import get_previous_sle

	start, end = context.period["date_from"], context.period["date_to"]
	if not start or not end:
		frappe.throw("历史库存需要明确的起止日期")
	filters = {
		"company": context.company,
		"warehouse": ["in", sorted(context.selected) or [""]],
		"is_cancelled": 0,
		"posting_date": ["<=", end],
	}
	for value in paged(
		"Stock Ledger Entry",
		filters=filters,
		fields=["item_code", "warehouse"],
		group_by="item_code, warehouse",
		order_by="item_code asc, warehouse asc",
	):
		if not context.matches_item(value.item_code, value.warehouse):
			continue
		item = context.item(value.item_code)
		if not context.matches_search(
			[item.name, item.item_name, item.item_group, item.description, value.warehouse]
		):
			continue
		code, warehouse = value.item_code, value.warehouse
		base = {
			**context.item_fields(item),
			"warehouse": warehouse,
			"warehouse_label": context.label(warehouse),
			**context.location_fields(warehouse),
			"period_from": start,
			"period_to": end,
			"snapshot": context.snapshot,
		}
		previous = get_previous_sle(
			frappe._dict(item_code=code, warehouse=warehouse, posting_date=start, posting_time="00:00:00"),
			extra_cond=" and posting_datetime < timestamp(%(posting_date)s, %(posting_time)s)",
		)
		opening = float(previous.get("qty_after_transaction") or 0)
		incoming = outgoing = adjustment = 0.0
		running_quantity = opening
		with tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+", encoding="utf-8") as entries:
			authorized = True
			for ledger in paged(
				"Stock Ledger Entry",
				filters={
					**filters,
					"item_code": code,
					"warehouse": warehouse,
					"posting_date": ["between", [start, end]],
				},
				fields=[
					"name",
					"voucher_type",
					"voucher_no",
					"voucher_detail_no",
					"posting_date",
					"posting_time",
					"posting_datetime",
					"actual_qty",
					"qty_after_transaction",
					"batch_no",
					"serial_and_batch_bundle",
					"creation",
				],
				order_by="posting_datetime asc, creation asc, name asc",
			):
				parent = context.parent(ledger.voucher_type, ledger.voucher_no)
				if not parent:
					# A hidden voucher cannot be exposed through its quantities/identities.
					authorized = False
					break
				is_adjustment = ledger.voucher_type == "Stock Reconciliation"
				# Native quantity-reset reconciliations can record actual_qty=0 while
				# qty_after_transaction changes. Measure that native running-balance
				# transition, including batch bundle reversal/replacement rows.
				quantity = (
					float(ledger.qty_after_transaction) - running_quantity
					if is_adjustment
					else float(ledger.actual_qty)
				)
				running_quantity = float(ledger.qty_after_transaction)
				if is_adjustment:
					adjustment += quantity
				elif quantity > 0:
					incoming += quantity
				else:
					outgoing -= quantity
				entries.write(
					json.dumps(
						{
							**base,
							"id": f"Stock Ledger Entry:{ledger.name}",
							"ledger_entry": ledger.name,
							"doctype": ledger.voucher_type,
							"document": ledger.voucher_no,
							"document_id": f"{ledger.voucher_type}:{ledger.voucher_no}",
							"line_name": ledger.voucher_detail_no,
							"date": str(ledger.posting_date),
							"time": str(ledger.posting_time),
							"docstatus": 1,
							"kind": document_kind(parent)
							if parent.doctype in ("Stock Entry", "Stock Reconciliation")
							else parent.doctype,
							"batch_no": ledger.batch_no or "",
							"serial_and_batch_bundle": ledger.serial_and_batch_bundle or "",
							"stock_qty": quantity,
							"adjustment": quantity if is_adjustment else 0,
							"incoming": quantity if not is_adjustment and quantity > 0 else 0,
							"outgoing": -quantity if not is_adjustment and quantity < 0 else 0,
							"native_running_qty": float(ledger.qty_after_transaction),
						},
						ensure_ascii=False,
					)
					+ "\n"
				)
			if not authorized:
				continue
			closing = opening + incoming - outgoing + adjustment
			if not context.query["includeZero"] and not (
				opening or incoming or outgoing or adjustment or closing
			):
				continue
			yield (
				"balances",
				{
					**base,
					"id": frappe.as_json([code, warehouse]),
					"opening": opening,
					"incoming": incoming,
					"outgoing": outgoing,
					"adjustment": adjustment,
					"closing": closing,
					"stock_qty": closing,
				},
			)
			entries.seek(0)
			for entry in entries:
				yield "ledger", json.loads(entry)


def activity_relations(context, activity_name, *, lifetime=False):
	"""Canonical document + line identities, direct links plus exact original-loan joins."""
	cache = getattr(context, "_activity_relation_cache", None)
	if cache is None:
		all_relations = defaultdict(list)
		lifetime_relations = defaultdict(list)
		for row in movement_rows(
			context,
			include_all_dates=True,
			apply_activity=False,
			apply_search=False,
		):
			direct_activity = row["activity"]
			activity_targets = []
			if direct_activity:
				activity_targets.append((direct_activity, "direct"))
			if row["original_loan"]:
				original = context.parent("Stock Entry", row["original_loan"])
				if original and original.ti_activity:
					if any(
						line.name == row["original_loan_line"] and line.item_code == row["item_code"]
						for line in original.get("items")
					):
						if original.ti_activity and original.ti_activity != direct_activity:
							activity_targets.append((original.ti_activity, "original_loan"))
			for activity_name_for_row, relationship in activity_targets:
				relation = {
					**row,
					"related_activity": activity_name_for_row,
					"relationship": relationship,
				}
				all_relations[activity_name_for_row].append(relation)
				if row["docstatus"] == 1:
					lifetime_relations[activity_name_for_row].append(relation)
		cache = (all_relations, lifetime_relations)
		context._activity_relation_cache = cache
	relations = cache[1 if lifetime else 0].get(activity_name, ())
	if lifetime:
		return iter(relations)
	return (
		row
		for row in relations
		if in_period(row["date"], context.related_period)
		and context.matches_search(row.values(), related=True)
	)


def activity_rows(context, *, metadata=True):
	query = context.query
	filters = {"name": context.scope["activity"]} if context.scope["activity"] else {}
	for value in paged("Inventory Activity", filters=filters, fields=["name"]):
		activity = context.activity(value.name)
		if not activity:
			continue
		if context.scope["activity"] and activity.name != context.scope["activity"]:
			continue
		if query["activityStatus"] != "all" and activity.status.casefold() != query["activityStatus"]:
			continue
		if query["typeId"] and activity.activity_type != query["typeId"]:
			continue
		if context.scope["period"]["key"] != "all":
			period_from, period_to = context.period["date_from"], context.period["date_to"]
			if (activity.end_date and getdate(activity.end_date) < getdate(period_from)) or (
				activity.start_date and getdate(activity.start_date) > getdate(period_to)
			):
				continue
		if not context.matches_search([activity.name, activity.title, activity.description, activity.notes]):
			continue
		has_relations = next(activity_relations(context, activity.name), None) is not None
		related_scope = (
			context.scope["item"]
			or context.scope["categories"]
			or context.scope["uncategorized"]
			or context.scope["sources"]
			or context.scope["destinations"]
			or context.scope["kinds"]
			or query["restrictItems"]
			or query["restrictAllocations"]
			or query["itemLocationKeys"]
			or query["record"]
			or query["recordDoctype"]
			or query["loan"]
		)
		if related_scope and not has_relations:
			continue
		counts = defaultdict(int)
		document_count = 0
		previous_document = None
		outstanding = False
		# Native documents and their allocations are yielded contiguously. Count
		# each direct document once without retaining every lifetime allocation.
		for row in activity_relations(context, activity.name, lifetime=True):
			if row["document_id"] == previous_document:
				continue
			previous_document = row["document_id"]
			if row["relationship"] == "direct":
				counts[row["kind"]] += 1
				document_count += 1
			if row["kind"] == "Loan":
				loan = context.parent("Stock Entry", row["document"])
				balances = context.loan_balances(loan.name)
				outstanding = outstanding or any(
					float(line.transfer_qty) > float(sum(balances[line.name].values())) for line in loan.items
				)
		if query["activityKind"] and not counts.get(query["activityKind"]):
			continue
		if (query["relatedPresence"] in ("yes", "with") and not has_relations) or (
			query["relatedPresence"] in ("no", "without") and has_relations
		):
			continue
		if query["outstandingOnly"] and not outstanding:
			continue
		if metadata:
			type_label = (
				frappe.db.get_value("Inventory Activity Type", activity.activity_type, "label")
				if frappe.has_permission("Inventory Activity Type", "read", doc=activity.activity_type)
				else ""
			)
			yield {
				"id": activity.name,
				"activity": activity.name,
				"title": activity.title,
				"activity_type": activity.activity_type,
				"activity_type_label": type_label,
				"status": activity.status,
				"start_date": str(activity.start_date or ""),
				"end_date": str(activity.end_date or ""),
				"date": str(activity.start_date or ""),
				"description": activity.description or "",
				"notes": activity.notes or "",
				"owner": activity.owner,
				"modified": str(activity.modified),
				"has_outstanding": outstanding,
				"document_count": document_count,
				**{f"count_{kind}": counts[kind] for kind in (*MOVEMENT_PURPOSES, "Opening", "Reconcile")},
			}
		else:
			yield from activity_relations(context, activity.name)
