"""Bounded native queries and permission-scoped allocation projections."""

import copy
import json
import tempfile
from collections import defaultdict

import frappe
from frappe.permissions import get_role_permissions
from frappe.utils import get_datetime, get_time, getdate, now_datetime, nowdate

from temple_inventory.native_balances import (
	batch_balances,
	batch_rows_at,
	entry_bundle,
	ledger_rows_at,
	reconciliation_allocations,
	serial_balances_by_location,
	stock_balance,
)
from temple_inventory.native_stock import (
	MOVEMENT_LABELS,
	MOVEMENT_PURPOSES,
	batch_quantities,
	loan_balances,
	warehouse_scopes,
)
from temple_inventory.report_query import as_of_moment, in_period, resolved_period
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
		self._serial_by_bundle_entry = {}
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
		# Full precision: the snapshot is the "as of" bound for balance queries.
		self.snapshot = str(snapshot or now_datetime())
		# Historical stock boundary; None reads the current Bin and serial state.
		self.balance_at = as_of_moment(query)
		self.settings, self.warehouses, self.physical, self.leased, self.damaged = warehouse_scopes()
		from temple_inventory.native_topology import present_locations

		presented = present_locations(
			self.warehouses, physical_root=self.settings.physical_root_warehouse, settings=self.settings
		)
		self.location_labels = {row["name"]: row["label"] for row in presented}
		self.location_paths = {row["name"]: row["path"] for row in presented}
		self.native_location_names = {row["name"]: row["native_name"] for row in presented}
		if not get_role_permissions("Temple Inventory Settings").get("read"):
			frappe.throw("当前账户无权读取库存配置", frappe.PermissionError)
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
			item = getattr(self, "_preloaded_items", {}).get(code) or frappe.get_cached_doc("Item", code)
			item.check_permission("read")
		except frappe.PermissionError, frappe.DoesNotExistError:
			return None
		return item

	def activity(self, name):
		if not name:
			return None
		preloaded = getattr(self, "_preloaded_activities", {}).get(name)
		if preloaded:
			return preloaded
		try:
			activity = frappe.get_doc("Inventory Activity", name)
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
		if doctype == "Stock Reconciliation" and not frappe.has_permission(doctype, "read"):
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
						_PreloadedRow(
							{
								**child,
								"doctype": meta.get_field(field).options,
								"_parent_docstatus": row.docstatus,
							}
						)
						for child in children[field].get(row.name, [])
					]
				doc.__islocal = 0
				self._preloaded_parents[(doctype, row.name)] = doc

	def preload_item_attachments(self, item_codes):
		"""Batch-check attached private Files while preserving File read/privacy checks."""
		if not self.load_item_attachments:
			return
		from temple_inventory.native_files import can_read, readable_parents

		if self._permitted_item_images is None:
			self._permitted_item_images = defaultdict(set)
		self._loaded_attachment_item_codes = getattr(self, "_loaded_attachment_item_codes", set())
		codes = set(item_codes) - self._loaded_attachment_item_codes
		if not codes:
			return
		# Items from a read-permission-filtered get_list need no per-File reload of their parent.
		readable = frappe.get_list("Item", filters={"name": ["in", sorted(codes)]}, pluck="name")
		permission_fields = ("owner", "is_private", "attached_to_doctype", "attached_to_field")
		attachment_fields = (
			"name",
			"attached_to_name",
			"file_name",
			"file_url",
			"file_size",
			"file_type",
			"creation",
		)
		with readable_parents("Item", readable):
			for row in frappe.get_list(
				"File",
				filters={
					"attached_to_doctype": "Item",
					"attached_to_name": ["in", sorted(codes) or [""]],
					"is_private": 1,
				},
				fields=[*attachment_fields, *permission_fields],
				order_by="creation asc, name asc",
				limit_page_length=0,
			):
				file_doc = frappe.get_doc({"doctype": "File", **row})
				if file_doc.has_permission("read") and can_read(file_doc):
					self._permitted_item_images[row.attached_to_name].add(row.file_url)
					self._permitted_item_attachments[row.attached_to_name].append(
						{field: row[field] for field in attachment_fields}
					)
		self._loaded_attachment_item_codes.update(codes)

	def preload_primary_item_images(self, item_codes):
		"""Permission-check only each selected Item's primary private image."""
		from temple_inventory.native_files import FILE_PERMISSION_FIELDS, can_read, readable_parents

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
		# `images` came from a read-permission-filtered get_list of these Items.
		with readable_parents("Item", images):
			for row in frappe.get_list(
				"File",
				filters={
					"attached_to_doctype": "Item",
					"attached_to_name": ["in", sorted(images)],
					"file_url": ["in", sorted(set(images.values()))],
					"is_private": 1,
				},
				fields=list(FILE_PERMISSION_FIELDS),
				limit_page_length=0,
			):
				if row.file_url != images.get(row.attached_to_name):
					continue
				file_doc = frappe.get_doc({"doctype": "File", **row})
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
						by_parent[child.parent].append({**dict(child), "doctype": definition.options})
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
					entries[row.parent].append(_PreloadedRow({**dict(row), "doctype": child_doctype}))
					if row.get("serial_no"):
						self._serial_by_bundle_entry[row.name] = row.serial_no
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

	def bundle_serials(self, name, batch_no=None):
		bundle = self.bundle(name)
		if not bundle:
			return ""
		return "、".join(
			sorted(
				{
					entry.serial_no
					for entry in bundle.entries or []
					if entry.get("serial_no")
					and (batch_no is None or (entry.get("batch_no") or "") == batch_no)
				}
			)
		)

	def entry_serial(self, name):
		return self._serial_by_bundle_entry.get(name, "")

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
			"category_label": self.category_label(item.item_group),
			"stock_uom": item.stock_uom,
			"stock_uom_label": uom_label(item.stock_uom),
			"image": image,
			"batch_tracked": bool(item.has_batch_no),
			"expiry_tracked": bool(item.has_expiry_date),
			"disabled": bool(item.disabled),
		}

	def category_label(self, item_group):
		if not item_group or item_group == self.category_root:
			return "无分类"
		cache = self.__dict__.setdefault("_category_labels", {})
		if item_group not in cache:
			cache[item_group] = frappe.db.get_value("Item Group", item_group, "item_group_name") or item_group
		return cache[item_group]

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
		if tracking == "serial" and not item.has_serial_no:
			return False
		if tracking == "expiry" and not item.has_expiry_date:
			return False
		if tracking == "batch_only" and (not item.has_batch_no or item.has_expiry_date):
			return False
		if tracking == "none" and (item.has_batch_no or item.has_expiry_date or item.has_serial_no):
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

	def matches_search(self, values, *, related=False, item_code=None, serial_values=()):
		term = self.query["relatedSearch" if related else "search"].strip().casefold()
		if not term or any(term in str(value or "").casefold() for value in values):
			return True
		if term in {str(value or "").casefold() for value in serial_values}:
			return True
		# A scanned or typed barcode finds its Item on every item-based page.
		return bool(item_code) and item_code in self.barcode_matches(related)

	def search_values_for_line(self, row):
		"""Return user-facing searchable values for this report row's active view."""
		query = self.query
		item_values = [
			row.get("item_code"),
			row.get("item_name"),
			row.get("category_label") or row.get("category"),
		]
		location_values = [
			row.get("source_warehouse_label"),
			row.get("source_warehouse_path"),
			row.get("destination_warehouse_label"),
			row.get("destination_warehouse_path"),
			row.get("warehouse_label"),
			row.get("warehouse_path"),
		]
		batch_values = [row.get("batch_no")]
		kind_labels = {**MOVEMENT_LABELS, "Reconcile": "盘点调整", "Opening": "期初库存"}
		status_labels = {0: "草稿", 1: "已提交", 2: "已取消", "0": "草稿", "1": "已提交", "2": "已取消"}
		outcome_labels = {
			"Returned": "完好归还",
			"Damaged": "损坏归还",
			"Lost": "遗失",
			"outstanding": "未归还",
		}
		loan_status_labels = {"Draft": "草稿", "Cancelled": "已取消", "Open": "未结清", "Settled": "已结清"}
		common = [
			row.get("document"),
			kind_labels.get(row.get("kind")),
			status_labels.get(row.get("docstatus")),
			row.get("activity_title"),
			row.get("borrower"),
			row.get("recorder"),
			row.get("handler"),
			row.get("reviewer"),
			row.get("time"),
			row.get("date"),
		]
		view = query.get("view")
		if query.get("dataset") in ("movements", "loans") and view == "records":
			return [*common, *location_values]
		if query.get("dataset") == "counts":
			if view == "records":
				return [
					*common,
					{"Reviewed": "已核对", "Unreviewed": "未核对"}.get(row.get("review_state")),
				]
			return [*item_values, *location_values, *batch_values, *common, row.get("reason")]
		if query.get("dataset") in ("movements", "loans"):
			return [
				*item_values,
				*location_values,
				*batch_values,
				*common,
				row.get("original_loan"),
				outcome_labels.get(row.get("outcome")),
				loan_status_labels.get(row.get("loan_status")),
				row.get("stock_uom_label") or row.get("stock_uom"),
			]
		return [*item_values, *location_values, *batch_values, *common]

	def barcode_matches(self, related=False):
		"""Items with a barcode containing the search term, read once per request."""
		key = "relatedSearch" if related else "search"
		cache = self.__dict__.setdefault("_barcode_matches", {})
		if key not in cache:
			term = self.query[key].strip()
			escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
			cache[key] = set(
				frappe.get_all(
					"Item Barcode",
					filters={"parenttype": "Item", "barcode": ["like", f"%{escaped}%"]},
					pluck="parent",
				)
			)
		return cache[key]

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
		return not apply_search or self.matches_search(
			self.search_values_for_line(row),
			item_code=row.get("item_code"),
			serial_values=(row.get("serial_nos") or "").split("、"),
		)


def _include_zero_items(context):
	query = context.query
	return query["includeZero"] or (
		query["dataset"] == "inventory" and query["stockState"] in ("no_available", "no_stock", "all")
	)


def _serial_warehouses(context):
	authorized_leaves = (
		set(getattr(context, "physical", ()))
		| set(getattr(context, "leased", ()))
		| set(getattr(context, "damaged", ()))
	)
	if not authorized_leaves:
		authorized_leaves = set(context.selected)
	return sorted(context.selected & authorized_leaves)


def as_of_balances(context, item_codes=None):
	"""Set-based stock at context.balance_at: one ledger read per table, never per pair."""
	warehouses = sorted(context.selected)
	wanted = None if item_codes is None else set(item_codes)
	ledger = {}
	for row in ledger_rows_at(warehouses, context.balance_at):
		if wanted is None or row.item_code in wanted:
			ledger[(row.item_code, row.warehouse)] = float(row.qty or 0)
	batches = defaultdict(lambda: defaultdict(float))
	for row in batch_rows_at(warehouses, context.balance_at):
		if wanted is None or row.item_code in wanted:
			batches[(row.item_code, row.warehouse)][row.batch_no] += float(row.qty or 0)
	serials = defaultdict(list)
	serial_warehouses = _serial_warehouses(context)
	if serial_warehouses:
		for entry in serial_balances_by_location(serial_warehouses, context.balance_at):
			if entry["qty"] > 0 and (wanted is None or entry["item_code"] in wanted):
				serials[(entry["item_code"], entry["warehouse"])].append(entry["serial_no"])
	return {
		"ledger": ledger,
		"batches": {key: sorted(quantities.items()) for key, quantities in batches.items()},
		"serials": {key: sorted(names) for key, names in serials.items()},
	}


def stock_pairs(context, item_codes=None, as_of=None):
	"""Page native Bin identities without retaining the whole catalog in memory."""
	if as_of is not None:
		for (code, warehouse), quantity in as_of["ledger"].items():
			yield code, warehouse, quantity
		if _include_zero_items(context):
			seen = {code for code, _warehouse in as_of["ledger"]}
			item_filters = {"is_stock_item": 1}
			if item_codes is not None:
				item_filters["name"] = ["in", sorted(set(item_codes)) or [""]]
			for item in paged("Item", filters=item_filters, fields=["name"]):
				if item.name not in seen:
					yield item.name, "", 0.0
		return
	filters = {"warehouse": ["in", sorted(context.selected) or [""]]}
	if item_codes is not None:
		filters["item_code"] = ["in", sorted(set(item_codes)) or [""]]
	for value in paged("Bin", filters=filters, fields=["item_code", "warehouse", "actual_qty"]):
		yield value.item_code, value.warehouse, float(value.actual_qty or 0)
	if _include_zero_items(context):
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
	as_of = as_of_balances(context, item_codes=item_codes) if context.balance_at else None
	pairs = list(stock_pairs(context, item_codes=item_codes, as_of=as_of))
	codes = {code for code, _warehouse, _quantity in pairs}
	context.preload_items(codes)
	if context.load_item_attachments:
		context.preload_item_attachments(codes)
	serials_by_location = defaultdict(list)
	if as_of is not None:
		serials_by_location.update(as_of["serials"])
	else:
		serial_filters = {
			"status": "Active",
			"warehouse": ["in", _serial_warehouses(context) or [""]],
		}
		if codes:
			serial_filters["item_code"] = ["in", sorted(codes)]
		for serial in frappe.get_list(
			"Serial No",
			filters=serial_filters,
			fields=["name", "item_code", "warehouse"],
			order_by="item_code asc, warehouse asc, name asc",
			limit_page_length=0,
		):
			serials_by_location[(serial.item_code, serial.warehouse)].append(serial.name)
	include_zero = _include_zero_items(context)
	# Expiry status in an as-of view is judged on that day, not today.
	reference_date = getdate(context.balance_at) if context.balance_at else getdate(nowdate())
	rows_by_item = defaultdict(list)
	for code, warehouse, pair_quantity in pairs:
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
			if as_of is not None:
				quantities = [
					(batch_name, quantity)
					for batch_name, quantity in as_of["batches"].get((code, warehouse), ())
					if quantity or include_zero
				]
			else:
				balances = batch_balances(code, warehouse, context.snapshot, include_zero=include_zero)
				quantities = [(row.get("batch_no"), row.get("qty", 0)) for row in balances]
		else:
			# As-of pairs already carry their ledger balance at balance_at.
			quantity = (
				pair_quantity
				if warehouse and (as_of is not None or getattr(context, "snapshot_is_now", False))
				else stock_balance(code, warehouse, context.snapshot)
				if warehouse
				else 0
			)
			quantities = [(None, quantity)]
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
				[
					code,
					item.item_name,
					context.item_fields(item).get("category_label"),
					context.label(warehouse),
					context.location_fields(warehouse).get("warehouse_path"),
					batch_name,
					expiry,
				],
				item_code=code,
				serial_values=serials_by_location[(code, warehouse)],
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
					"serial_nos": "、".join(serials_by_location[(code, warehouse)])
					if getattr(item, "has_serial_no", False)
					else "",
					"manufacturing_date": str(batch.manufacturing_date or "") if batch else "",
					"expiry_date": expiry,
					"remaining_days": (getdate(expiry) - reference_date).days if expiry else None,
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
	flow_quantities = defaultdict(float)
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
		difference = (
			float(row.qty) - (float(row.current_qty or 0) if doc.purpose != "Opening Stock" else 0)
			if doctype == "Stock Reconciliation"
			else 0
		)
		quantity = float(row.get("transfer_qty") or 0) if doctype == "Stock Entry" else difference
		quantities[item.stock_uom] += quantity
		flow_quantities[item.stock_uom] += abs(quantity)
		if doctype == "Stock Reconciliation":
			if difference > 0:
				gains[item.stock_uom] += difference
			elif difference < 0:
				losses[item.stock_uom] += difference
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
				quantity=difference,
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
				or (
					doctype == "Stock Reconciliation"
					and doc.purpose in ("Stock Reconciliation", "Opening Stock")
				)
			)
		),
		"quantities": [{"uom": unit, "qty": quantity} for unit, quantity in sorted(quantities.items())],
		"flow_quantities": [
			{"uom": unit, "qty": quantity} for unit, quantity in sorted(flow_quantities.items())
		],
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
	return result


def _activity_fields(context, name):
	activity = context.activity(name)
	return {
		"activity": activity.name if activity else "",
		"activity_title": activity.title if activity else "",
		"activity_type": activity.activity_type if activity else "",
	}


def settlement_loan_names(doc):
	return sorted(
		{line.get("ti_original_loan") for line in doc.get("items") or [] if line.get("ti_original_loan")}
	)


def document_attribution(context, doc):
	"""Borrower and activity of a whole native document.

	A settlement takes them from the original loans of its lines. Distinct borrowers
	and activity titles are joined with 、; one activity keeps its id.
	"""
	loan_names = settlement_loan_names(doc)
	if not loan_names:
		return {"borrower": doc.get("ti_borrower") or "", **_activity_fields(context, doc.get("ti_activity"))}
	loans = [loan for loan in (context.parent("Stock Entry", name) for name in loan_names) if loan]
	borrowers = sorted({loan.get("ti_borrower") or "" for loan in loans} - {""})
	activity_names = sorted({loan.get("ti_activity") or "" for loan in loans} - {""})
	if len(activity_names) == 1:
		activity_fields = _activity_fields(context, activity_names[0])
	else:
		titles = [context.activity(name) for name in activity_names]
		activity_fields = {
			"activity": "",
			"activity_title": "、".join(activity.title for activity in titles if activity),
			"activity_type": "",
		}
	return {"borrower": "、".join(borrowers), **activity_fields}


def line_attribution(context, line):
	"""A settlement line belongs to the borrower and activity of its original loan."""
	loan = context.parent("Stock Entry", line.get("ti_original_loan"))
	if not loan:
		return {"borrower": "", "activity": "", "activity_title": "", "activity_type": ""}
	return {"borrower": loan.get("ti_borrower") or "", **_activity_fields(context, loan.get("ti_activity"))}


def document_fields(context, doc):
	return {
		"doctype": doc.doctype,
		"document": doc.name,
		"document_id": f"{doc.doctype}:{doc.name}",
		"docstatus": int(doc.docstatus),
		"kind": document_kind(doc),
		"date": str(doc.posting_date),
		# Precise, zero-padded values keep sorting exact; displays format to seconds.
		"time": get_time(doc.posting_time).isoformat(),
		"posting_timestamp": str(get_datetime(f"{doc.posting_date} {doc.posting_time}")),
		"modified": str(get_datetime(doc.modified)),
		**document_attribution(context, doc),
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
		if doctype == "Stock Reconciliation" and not frappe.has_permission(doctype, "read"):
			continue
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
		context.preload_parents(
			"Stock Entry", {name for doc in parents for name in settlement_loan_names(doc)}
		)
		context.preload_bundles(lines)
		context.preload_batches(line.get("batch_no") for line in lines)
		context.preload_items(line.item_code for doc in parents for line in doc.get("items") or [])
		context.preload_activities(
			(
				{doc.get("ti_activity") for doc in parents}
				| {
					loan.get("ti_activity")
					for doc in parents
					for name in settlement_loan_names(doc)
					for loan in [context.parent("Stock Entry", name)]
					if loan
				}
			)
			- {None, ""}
		)
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
						**(line_attribution(context, line) if line.get("ti_original_loan") else {}),
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
						"serial_nos": context.entry_serial(bundle_line),
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
					row["flow_qty"] = abs(float(row["stock_qty"] or 0))
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


def loan_rows(context, item_codes=None, activity_names=None):
	query = context.query
	loan_filters = {
		"company": context.company,
		"ti_movement_kind": "Loan",
		"docstatus": ["in", [1] if query["view"] == "items" else query["statuses"]],
	}
	if activity_names is not None:
		loan_filters["ti_activity"] = ["in", sorted(set(activity_names)) or [""]]
	values = list(
		paged(
			"Stock Entry",
			filters=loan_filters,
		)
	)
	names = [value.name for value in values]
	context.preload_parents("Stock Entry", names)
	parents = [context._preloaded_parents[("Stock Entry", name)] for name in names]
	lines = [
		line
		for doc in parents
		for line in doc.get("items") or []
		if item_codes is None or line.item_code in item_codes
	]
	context.preload_bundles(lines)
	context.preload_batches(line.get("batch_no") for line in lines)
	context.preload_items(line.item_code for line in lines)
	context.preload_activities(doc.get("ti_activity") for doc in parents if doc.get("ti_activity"))
	context.preload_item_attachments(line.item_code for line in lines)
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
		if query["loanStatus"] != "all" and loan.docstatus != 1:
			continue
		if query["loanStatus"] == "outstanding" and not has_outstanding:
			continue
		if query["loanStatus"] == "settled" and has_outstanding:
			continue
		for line in loan.items:
			if item_codes is not None and line.item_code not in item_codes:
				continue
			item = context.item(line.item_code)
			if not item:
				continue
			for batch, batch_quantity in batch_quantities(line).items():
				outcomes = balances[(line.name, batch)]
				serial_nos = context.bundle_serials(line.get("serial_and_batch_bundle"), batch)
				borrowed = float(batch_quantity)
				outstanding = borrowed - float(sum(outcomes.values())) if loan.docstatus == 1 else 0
				if query["loanStatus"] == "outstanding" and outstanding <= 0:
					continue
				if query["loanStatus"] == "settled" and outstanding > 0:
					continue
				row = {
					**document_fields(context, loan),
					**context.item_fields(item),
					"id": f"Stock Entry:{loan.name}:{line.name}:{batch}",
					"line_name": line.name,
					"original_loan": loan.name,
					"original_loan_line": line.name,
					"source_warehouse": line.s_warehouse or "",
					"destination_warehouse": line.t_warehouse,
					**context.location_fields(line.s_warehouse or "", "source_"),
					**context.location_fields(line.t_warehouse or "", "destination_"),
					"batch_no": batch,
					"serial_nos": serial_nos,
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
			context.search_values_for_line(row),
			related=True,
			item_code=row.get("item_code"),
			serial_values=(row.get("serial_nos") or "").split("、"),
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
	frappe.has_permission("Stock Reconciliation", "read", throw=True)
	query = context.query
	values = list(
		paged(
			"Stock Reconciliation",
			filters={"company": context.company, "docstatus": ["in", query["statuses"]]},
		)
	)
	context.preload_parents("Stock Reconciliation", [value.name for value in values])
	documents = [context.parent("Stock Reconciliation", value.name) for value in values]
	lines = [
		line
		for doc in documents
		if doc
		for field in ("items", "ti_count_review")
		for line in doc.get(field) or []
	]
	cancelled_names = [doc.name for doc in documents if doc and doc.docstatus == 2]
	if cancelled_names:
		cancelled_bundles = frappe.get_all(
			"Serial and Batch Bundle",
			filters={"voucher_type": "Stock Reconciliation", "voucher_no": ["in", cancelled_names]},
			fields=["name", "voucher_no", "voucher_detail_no", "type_of_transaction"],
			limit_page_length=0,
		)
		bundle_by_line = defaultdict(list)
		for bundle in cancelled_bundles:
			bundle_by_line[(bundle.voucher_no, bundle.voucher_detail_no, bundle.type_of_transaction)].append(
				bundle.name
			)
		for doc in documents:
			if not doc or doc.docstatus != 2:
				continue
			for line in doc.get("items") or []:
				actual_bundles = bundle_by_line[(doc.name, line.name, "Inward")]
				current_bundles = bundle_by_line[(doc.name, line.name, "Outward")]
				line["serial_and_batch_bundle"] = line.get("serial_and_batch_bundle") or (
					actual_bundles[0] if len(actual_bundles) == 1 else None
				)
				line["current_serial_and_batch_bundle"] = line.get("current_serial_and_batch_bundle") or (
					current_bundles[0] if len(current_bundles) == 1 else None
				)
	context.preload_bundles(lines)
	for doc in documents:
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
			}
			if custom:
				native_line = next((native for native in doc.items if native.name == line.name), None)
				if not native_line:
					native_line = next(
						(
							native
							for native in doc.items
							if native.item_code == line.item_code
							and native.warehouse == line.warehouse
							and (native.batch_no or "") == (line.batch_no or "")
						),
						None,
					)
				# Only the line's own native row: another location's row would misstate this one.
				if native_line:
					allocations = reconciliation_allocations(
						native_line,
						batch_checker=context.batch,
						bundle_cache=context._bundle_cache,
						bundle_loader=context.bundle,
					)
				else:
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
				row = {
					**base,
					**allocation,
					"stock_qty": allocation["difference"] or 0,
					"serial_nos": "、".join(
						sorted(
							{
								serial
								for bundle_name in (
									line.get("serial_and_batch_bundle"),
									line.get("current_serial_and_batch_bundle"),
								)
								for serial in context.bundle_serials(
									bundle_name, allocation.get("batch_no") or ""
								).split("、")
								if serial
							}
						)
					),
				}
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
			[
				item.name,
				item.item_name,
				context.item_fields(item).get("category_label"),
				context.label(value.warehouse),
				context.location_fields(value.warehouse).get("warehouse_path"),
			],
			item_code=item.name,
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
			ledger_rows = list(
				paged(
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
				)
			)
			context.preload_bundles(ledger_rows)
			for ledger in ledger_rows:
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
							"time": get_time(ledger.posting_time).isoformat(),
							"docstatus": 1,
							"kind": document_kind(parent)
							if parent.doctype in ("Stock Entry", "Stock Reconciliation")
							else parent.doctype,
							"batch_no": ledger.batch_no or "",
							"serial_nos": context.bundle_serials(
								ledger.serial_and_batch_bundle, ledger.batch_no or ""
							),
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
		activity_names = getattr(context, "_activity_page_names", [])
		document_names = []
		loan_names = []
		direct_names = {"Stock Entry": [], "Stock Reconciliation": []}
		for doctype in ("Stock Entry", "Stock Reconciliation"):
			documents = frappe.get_list(
				doctype,
				filters={"company": context.company, "ti_activity": ["in", activity_names or [""]]},
				fields=["name", "ti_movement_kind"] if doctype == "Stock Entry" else ["name"],
			)
			document_names.extend(row.name for row in documents)
			direct_names[doctype].extend(row.name for row in documents)
			if doctype == "Stock Entry":
				loan_names.extend(row.name for row in documents if row.get("ti_movement_kind") == "Loan")
		if loan_names:
			context.preload_parents("Stock Entry", loan_names)
			loan_allocations = [
				(loan.name, line.name, line.item_code)
				for name in loan_names
				for loan in [context.parent("Stock Entry", name)]
				if loan
				for line in loan.get("items") or []
			]
			document_names.extend(_settlement_document_names(loan_allocations))
		context._activity_direct_counts = defaultdict(lambda: defaultdict(int))
		# Settlements count once per activity they touch, through their original loans.
		context._activity_settlement_counts = defaultdict(lambda: defaultdict(int))
		counted_settlements = set()
		authorized_direct_names = {doctype: set() for doctype in direct_names}
		for row in movement_rows(
			context,
			include_all_dates=True,
			apply_activity=False,
			apply_search=False,
			document_names=document_names,
		):
			if row["document"] in direct_names.get(row["doctype"], ()):
				authorized_direct_names[row["doctype"]].add(row["document"])
			# A line's activity is its original loan's activity for settlements. It is
			# direct only when the document's own activity is that same activity.
			document = context.parent(row["doctype"], row["document"])
			own_activity = (document.get("ti_activity") or "") if document else ""
			activity_targets = []
			if row["activity"]:
				relationship = "direct" if row["activity"] == own_activity else "original_loan"
				activity_targets.append((row["activity"], relationship))
			for activity_name_for_row, relationship in activity_targets:
				relation = {
					**row,
					"related_activity": activity_name_for_row,
					"relationship": relationship,
				}
				all_relations[activity_name_for_row].append(relation)
				if row["docstatus"] == 1:
					lifetime_relations[activity_name_for_row].append(relation)
				if relationship == "original_loan" and row["docstatus"] == 1:
					key = (activity_name_for_row, row["document_id"])
					if key not in counted_settlements:
						counted_settlements.add(key)
						context._activity_settlement_counts[activity_name_for_row][row["kind"]] += 1
		for doctype, expression in (
			(
				"Stock Entry",
				"coalesce(ti_movement_kind, case purpose when 'Material Receipt' then 'Receive' "
				"when 'Material Issue' then 'Issue' when 'Material Transfer' then 'Transfer' else purpose end)",
			),
			(
				"Stock Reconciliation",
				"case when purpose = 'Opening Stock' then 'Opening' else 'Reconcile' end",
			),
		):
			names = authorized_direct_names[doctype]
			if not names:
				continue
			for row in frappe.db.sql(
				f"""select ti_activity as activity, {expression} as kind, count(*) as count
				from `tab{doctype}` where name in %(names)s and docstatus = 1
				group by ti_activity, kind""",
				{"names": tuple(names)},
				as_dict=True,
			):
				context._activity_direct_counts[row.activity][row.kind] += row.count
		cache = (all_relations, lifetime_relations)
		context._activity_relation_cache = cache
	relations = cache[1 if lifetime else 0].get(activity_name, ())
	if lifetime:
		return iter(relations)
	return (
		row
		for row in relations
		if in_period(row["date"], context.related_period)
		and context.matches_search(
			context.search_values_for_line(row),
			related=True,
			item_code=row.get("item_code"),
			serial_values=(row.get("serial_nos") or "").split("、"),
		)
	)


def activity_rows(context, *, metadata=True):
	query = context.query
	filters = {"name": context.scope["activity"]} if context.scope["activity"] else {}
	values = list(paged("Inventory Activity", filters=filters, fields=["name", "activity_type"]))
	context.preload_activities(value.name for value in values)
	context._activity_page_names = [value.name for value in values]
	type_labels = {}
	if metadata:
		types = frappe.get_list("Inventory Activity Type", fields=["name", "label"])
		type_labels = {row.name: row.label for row in types}
	for value in values:
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
		activity_status_label = {"Active": "进行中", "Archived": "已归档", "Completed": "已完成"}.get(
			activity.status
		)
		activity_type_label = type_labels.get(activity.activity_type, "")
		if not context.matches_search(
			[
				activity.title,
				activity_type_label,
				activity_status_label,
				activity.start_date,
				activity.end_date,
				activity.modified,
				activity.description,
				activity.notes,
			]
		):
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
		outstanding = False
		# Native documents and their allocations are yielded contiguously; each
		# document is inspected once without retaining every lifetime allocation.
		previous_document = None
		for row in activity_relations(context, activity.name, lifetime=True):
			if row["document_id"] == previous_document:
				continue
			previous_document = row["document_id"]
			if row["kind"] == "Loan":
				loan = context.parent("Stock Entry", row["document"])
				balances = context.loan_balances(loan.name)
				outstanding = outstanding or any(
					float(line.transfer_qty) > float(sum(balances[line.name].values())) for line in loan.items
				)
		counts = defaultdict(int)
		for source in (context._activity_direct_counts, context._activity_settlement_counts):
			for kind, count in source.get(activity.name, {}).items():
				counts[kind] += count
		document_count = sum(counts.values())
		if query["activityKind"] and not counts.get(query["activityKind"]):
			continue
		if (query["relatedPresence"] in ("yes", "with") and not has_relations) or (
			query["relatedPresence"] in ("no", "without") and has_relations
		):
			continue
		if query["outstandingOnly"] and not outstanding:
			continue
		if metadata:
			type_label = type_labels.get(activity.activity_type, "")
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
