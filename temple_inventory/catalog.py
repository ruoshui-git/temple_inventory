"""Permission-filtered native Item/UOM/Batch services for shared catalog editors."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe
from frappe.utils import cint, getdate

from temple_inventory.item_code import suggest_item_code as next_item_code
from temple_inventory.native_access import check_item, load_locked, require_app
from temple_inventory.native_files import attachments
from temple_inventory.projections import report_page
from temple_inventory.report_query import validate_query
from temple_inventory.report_sources import ReportContext, paged, stock_rows

ITEM_FIELDS = ("item_name", "item_group", "description")
IMMUTABLE_FIELDS = ("item_code", "stock_uom", "has_batch_no", "has_expiry_date")


def _image(item):
	files = attachments("Item", item.name)
	primary = [file for file in files if item.image and file.file_url == item.image]
	# Item.image is the identity of the cover, but must not bypass File's native
	# attachment ownership, privacy, and read checks.
	return (primary[0].file_url if primary else ""), files, primary


def item_group_root():
	"""Resolve ERPNext's native Item Group root from its nested-set metadata."""
	name = frappe.db.get_value("Item Group", {"lft": 1}, "name")
	if not name:
		frappe.throw("未找到物品类别根节点")
	return name


def item_metadata(item):
	image, files, images = _image(item)
	return {
		"name": item.name,
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": "" if item.item_group == item_group_root() else item.item_group,
		"stock_uom": item.stock_uom,
		"description": item.description or "",
		"image": image,
		"version": str(item.modified),
		"has_batch_no": bool(item.has_batch_no),
		"has_expiry_date": bool(item.has_expiry_date),
		"barcodes": [
			{"name": row.name, "barcode": row.barcode, "barcode_type": row.barcode_type or ""}
			for row in item.barcodes
		],
		"uoms": [
			{
				"name": row.name,
				"uom": row.uom,
				"conversion_factor": float(row.conversion_factor),
				"must_be_whole_number": bool(frappe.get_cached_value("UOM", row.uom, "must_be_whole_number")),
			}
			for row in item.uoms
		],
		"can_edit": item.has_permission("write"),
		"attachments": files,
		"images": images,
	}


@frappe.whitelist()
def suggest_item_code():
	require_app()
	frappe.has_permission("Item", "create", throw=True)
	return {"item_code": next_item_code()}


@frappe.whitelist()
def item_detail(item_code):
	require_app()
	item = check_item(item_code)
	query = {"dataset": "inventory", "view": "locations", "scope": {"item": item.name}, "includeZero": True}
	return {
		**item_metadata(item),
		"inventory": report_page(query),
		"movements": report_page(
			{"dataset": "movements", "view": "lines", "statuses": [1], "scope": {"item": item.name}},
			page_length=10,
		),
		"loans": report_page(
			{"dataset": "loans", "view": "outcomes", "statuses": [1], "scope": {"item": item.name}},
			page_length=10,
		),
	}


@frappe.whitelist()
def item_summaries(item_codes):
	"""Return one permission-filtered metadata query for editor rows."""
	require_app()
	if isinstance(item_codes, str):
		item_codes = frappe.parse_json(item_codes)
	if not isinstance(item_codes, list) or len(item_codes) > 10000:
		frappe.throw("物品范围无效")
	if any(not isinstance(code, str) for code in item_codes):
		frappe.throw("物品范围无效")
	rows = frappe.get_list(
		"Item",
		filters={"name": ["in", sorted(set(item_codes)) or [""]]},
		fields=["name", "item_name"],
		limit_page_length=0,
	)
	result = []
	for row in rows:
		item = frappe.get_doc("Item", row.name)
		image, _files, _primary = _image(item)
		result.append({"name": row.name, "item_name": row.item_name, "image": image})
	return result


@frappe.whitelist()
def item_display_summaries(item_codes):
	"""Batch native line display metadata while honoring each linked File's access."""
	require_app()
	if isinstance(item_codes, str):
		item_codes = frappe.parse_json(item_codes)
	if not isinstance(item_codes, list) or len(item_codes) > 10000:
		frappe.throw("物品范围无效")
	if any(not isinstance(code, str) for code in item_codes):
		frappe.throw("物品范围无效")
	items = frappe.get_list(
		"Item",
		filters={"name": ["in", sorted(set(item_codes)) or [""]]},
		fields=["name", "item_name", "image", "has_batch_no", "has_expiry_date"],
		limit_page_length=0,
	)
	by_name = {row.name: row for row in items}
	result = {}
	for name, row in by_name.items():
		item = frappe.get_doc("Item", name)
		image, _files, _primary = _image(item)
		result[name] = {
			"item_name": row.item_name,
			"image": image,
			"has_batch_no": bool(row.has_batch_no),
			"has_expiry_date": bool(row.has_expiry_date),
		}
	return result


def _query_boolean(value, label):
	if type(value) is bool:
		return value
	if isinstance(value, str) and value.lower() in ("0", "1", "false", "true"):
		return value.lower() in ("1", "true")
	frappe.throw(f"{label}筛选值无效")


def _picker_flatten_items(items, purpose, only_stock):
	quantity_key = "damaged" if purpose == "damaged" else "available"
	flat = []
	for item in items:
		by_warehouse = {}
		for stock in item.get("stock") or []:
			if (purpose == "count" and (not only_stock or stock.get("available", 0) > 0)) or (
				purpose != "count" and stock.get(quantity_key, 0) > 0
			):
				warehouse = stock.get("warehouse", "")
				entry = by_warehouse.get(warehouse)
				if entry is None:
					entry = {**stock, "batch_choices": []}
					for field in ("batch_no", "expiry_date", "manufacturing_date"):
						entry.pop(field, None)
					entry[quantity_key] = 0
					by_warehouse[warehouse] = entry
				entry[quantity_key] = float(entry.get(quantity_key, 0) or 0) + float(
					stock.get(quantity_key, 0) or 0
				)
				if stock.get("batch_no"):
					entry["batch_choices"].append(
						{"batch_no": stock["batch_no"], "qty": stock.get(quantity_key, 0)}
					)
		for stock in by_warehouse.values():
			flat.append(
				{
					**item,
					"stock": [stock],
					"warehouse": stock.get("warehouse", ""),
					"warehouse_label": stock.get("warehouse_label", ""),
					"picker_quantity": stock.get("damaged", 0)
					if purpose == "damaged"
					else stock.get("available", 0),
				}
			)
		if purpose == "count" and not only_stock and not by_warehouse:
			flat.append(
				{
					**item,
					"stock": [],
					"warehouse": "",
					"warehouse_label": "",
					"picker_quantity": 0,
					"batch_choices": [],
				}
			)
	return flat


@frappe.whitelist()
def operation_item(item_code, timestamp=None):
	"""Complete permission-filtered locations for one selected editor Item."""
	require_app()
	item = check_item(item_code)
	context = ReportContext(validate_query({"dataset": "inventory", "scope": {"item": item.name}}))
	if timestamp:
		context.set_snapshot(timestamp)
	return {**item_metadata(item), "stock": list(stock_rows(context)), "snapshot": context.snapshot}


@frappe.whitelist()
def search_items(
	search="",
	start=0,
	page_length=30,
	warehouses=None,
	categories=None,
	uncategorized=False,
	in_stock_only=False,
	item_codes=None,
	timestamp=None,
):
	require_app()
	start, page_length = max(0, cint(start)), min(100, max(1, cint(page_length)))
	if categories is None:
		categories = []
	elif isinstance(categories, str):
		categories = frappe.parse_json(categories)
	if not isinstance(categories, list):
		frappe.throw("物品类别筛选范围无效")
	if warehouses is None:
		warehouses = []
	elif isinstance(warehouses, str):
		warehouses = frappe.parse_json(warehouses)
	if not isinstance(warehouses, list):
		frappe.throw("仓库筛选范围无效")
	uncategorized = _query_boolean(uncategorized, "无分类")
	filters = {"disabled": 0, "is_stock_item": 1}
	if item_codes is not None:
		selected = frappe.parse_json(item_codes)
		if not isinstance(selected, list) or any(not isinstance(code, str) for code in selected):
			frappe.throw("物品选择范围无效")
		filters["name"] = ["in", selected or [""]]
	query = validate_query(
		{
			"dataset": "inventory",
			"view": "locations",
			"scope": {
				"warehouses": warehouses,
				"categories": categories,
				"uncategorized": uncategorized,
			},
		}
	)
	context = ReportContext(query)
	if timestamp:
		context.set_snapshot(timestamp)
	if categories or uncategorized:
		groups = set(context.categories or set())
		if uncategorized:
			groups.add(context.category_root)
		filters["item_group"] = ["in", sorted(groups) or [""]]
	if cint(in_stock_only):
		positive = {row["item_code"] for row in stock_rows(context) if row["available"] > 0}
		if item_codes is not None:
			positive &= set(selected)
		filters["name"] = ["in", sorted(positive) or [""]]
	or_filters = None
	if search:
		term = f"%{str(search).strip()}%"
		or_filters = [
			["Item", "item_code", "like", term],
			["Item", "item_name", "like", term],
			["Item", "description", "like", term],
			["Item", "item_group", "like", term],
			["Item Barcode", "barcode", "like", term],
		]
	from frappe.query_builder.functions import Count

	permitted_items = frappe.qb.get_query(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=["name"],
		distinct=True,
		ignore_permissions=False,
	)
	count = (
		frappe.qb.from_(permitted_items.as_("permitted_catalog"))
		.select(Count("*").as_("total"))
		.run(as_dict=True)
	)
	rows = frappe.get_list(
		"Item",
		filters=filters,
		or_filters=or_filters,
		fields=["name"],
		distinct=True,
		order_by="item_name asc, name asc",
		start=start,
		limit_page_length=page_length,
	)
	results = []
	for row in rows:
		item = context.item(row.name)
		if item:
			metadata = item_metadata(item)
			stock_query = {**query, "scope": {**query["scope"], "item": item.name}, "includeZero": False}
			stock_context = ReportContext(validate_query(stock_query))
			if timestamp:
				stock_context.set_snapshot(context.snapshot)
			metadata["stock"] = list(stock_rows(stock_context))
			metadata["snapshot"] = stock_context.snapshot
			results.append(metadata)
	total = int(count[0].total if count else 0)
	return {
		"results": results,
		"matched_count": total,
		"next_start": start + page_length if start + page_length < total else None,
	}


@frappe.whitelist()
def picker_rows(
	search="",
	start=0,
	page_length=30,
	warehouses=None,
	categories=None,
	uncategorized=False,
	item_codes=None,
	timestamp=None,
	purpose="outbound",
	only_stock=False,
	receiving_warehouse=None,
):
	"""Return permission-filtered picker rows flattened by item and warehouse."""
	require_app()
	if purpose not in ("outbound", "damaged", "inbound", "count"):
		frappe.throw("物品选择用途无效")
	start, page_length = max(0, cint(start)), min(100, max(1, cint(page_length)))
	if purpose == "inbound":
		warehouses = []
	if isinstance(warehouses, str):
		warehouses = frappe.parse_json(warehouses)
	if not isinstance(warehouses or [], list):
		frappe.throw("仓库筛选范围无效")
	if purpose == "damaged" and not warehouses:
		warehouses = [frappe.get_single("Temple Inventory Settings").damaged_warehouse]
	if isinstance(categories, str):
		categories = frappe.parse_json(categories)
	query = validate_query(
		{
			"dataset": "inventory",
			"view": "locations",
			"scope": {
				"warehouses": warehouses or [],
				"categories": categories or [],
				"uncategorized": uncategorized,
			},
		}
	)
	target_context = ReportContext(query)
	if receiving_warehouse:
		receiving_context = ReportContext(
			validate_query({"dataset": "inventory", "scope": {"warehouses": [receiving_warehouse]}})
		)
		target_warehouses = sorted(receiving_context.selected)
	else:
		target_warehouses = []
	if purpose == "inbound":
		page = search_items(
			search=search,
			start=start,
			page_length=page_length,
			warehouses=target_warehouses[:1] if cint(only_stock) else [],
			categories=categories,
			uncategorized=uncategorized,
			in_stock_only=bool(cint(only_stock)),
			item_codes=item_codes,
			timestamp=timestamp,
		)
		warehouse = target_warehouses[0] if target_warehouses else ""
		results = []
		for item in page["results"]:
			target_stocks = [row for row in item.get("stock") or [] if row.get("warehouse") == warehouse]
			picker_quantity = sum(float(row.get("available", 0) or 0) for row in target_stocks)
			results.append(
				{
					**item,
					"stock": target_stocks,
					"warehouse": warehouse,
					"warehouse_label": target_context.label(warehouse) if warehouse else "",
					"picker_quantity": picker_quantity,
					"batch_choices": [
						{"batch_no": row["batch_no"], "qty": row.get("available", 0)}
						for row in target_stocks
						if row.get("batch_no")
					],
				}
			)
		return {"results": results, "matched_count": page["matched_count"], "next_start": page["next_start"]}
	if not timestamp:
		item_filters = {"disabled": 0, "is_stock_item": 1}
		if item_codes is not None:
			selected_codes = frappe.parse_json(item_codes) if isinstance(item_codes, str) else item_codes
			if not isinstance(selected_codes, list) or any(
				not isinstance(code, str) for code in selected_codes
			):
				frappe.throw("物品选择范围无效")
			item_filters["name"] = ["in", sorted(set(selected_codes)) or [""]]
		if categories or uncategorized:
			groups = set(target_context.categories or set())
			if _query_boolean(uncategorized, "无分类"):
				groups.add(target_context.category_root)
			item_filters["item_group"] = ["in", sorted(groups) or [""]]
		or_filters = None
		if search:
			term = f"%{str(search).strip()}%"
			or_filters = [
				["Item", "item_code", "like", term],
				["Item", "item_name", "like", term],
				["Item", "description", "like", term],
				["Item", "item_group", "like", term],
				["Item Barcode", "barcode", "like", term],
			]
		items = frappe.get_list(
			"Item",
			filters=item_filters,
			or_filters=or_filters,
			fields=["name", "item_name"],
			order_by="item_name asc, name asc",
			limit_page_length=0,
		)
		item_names = [row.name for row in items]
		bins = frappe.get_all(
			"Bin",
			filters={
				"item_code": ["in", item_names or [""]],
				"warehouse": ["in", sorted(target_context.selected) or [""]],
				"actual_qty": [">", 0],
			},
			fields=["item_code", "warehouse"],
			limit_page_length=0,
		)
		eligible = set()
		for row in bins:
			if purpose == "damaged":
				if row.warehouse in target_context.damaged:
					eligible.add((row.item_code, row.warehouse))
			elif row.warehouse not in target_context.leased and row.warehouse not in target_context.damaged:
				eligible.add((row.item_code, row.warehouse))
		if purpose == "count" and not cint(only_stock):
			with_stock = {item_code for item_code, _warehouse in eligible}
			eligible.update((row.name, "") for row in items if row.name not in with_stock)
		labels = {row.name: row.item_name for row in items}
		eligible = sorted(
			eligible,
			key=lambda pair: (
				str(labels.get(pair[0], "")).casefold(),
				pair[0],
				target_context.label(pair[1]).casefold() if pair[1] else "",
				pair[1],
			),
		)
		page_pairs = eligible[start : start + page_length]
		page_codes = sorted({item_code for item_code, _warehouse in page_pairs})
		page = search_items(
			search=search,
			page_length=len(page_codes) or 1,
			warehouses=warehouses,
			categories=categories,
			uncategorized=uncategorized,
			in_stock_only=False,
			item_codes=page_codes,
		)
		flattened = _picker_flatten_items(page["results"], purpose, bool(cint(only_stock)))
		rows_by_pair = {(row["item_code"], row.get("warehouse", "")): row for row in flattened}
		results = [rows_by_pair[pair] for pair in page_pairs if pair in rows_by_pair]
		return {
			"results": results,
			"matched_count": len(eligible),
			"next_start": start + page_length if start + page_length < len(eligible) else None,
		}
	flat = []
	item_start = 0
	while True:
		page = search_items(
			search=search,
			start=item_start,
			page_length=100,
			warehouses=[] if purpose == "inbound" else warehouses,
			categories=categories,
			uncategorized=uncategorized,
			in_stock_only=False,
			item_codes=item_codes,
			timestamp=timestamp,
		)
		for item in page["results"]:
			stocks = item.get("stock") or []
			quantity_key = "damaged" if purpose == "damaged" else "available"
			if purpose == "inbound":
				warehouse = target_warehouses[0] if target_warehouses else ""
				target_stocks = [row for row in stocks if row.get("warehouse") == warehouse]
				picker_quantity = sum(float(row.get("available", 0) or 0) for row in target_stocks)
				if cint(only_stock) and picker_quantity <= 0:
					continue
				flat.append(
					{
						**item,
						"stock": target_stocks,
						"warehouse": warehouse,
						"warehouse_label": target_context.label(warehouse) if warehouse else "",
						"picker_quantity": picker_quantity,
						"batch_choices": [
							{"batch_no": row["batch_no"], "qty": row.get("available", 0)}
							for row in target_stocks
							if row.get("batch_no")
						],
					}
				)
				continue
			by_warehouse = {}
			for stock in stocks:
				if (purpose == "count" and (not cint(only_stock) or stock.get("available", 0) > 0)) or (
					purpose != "count" and stock.get(quantity_key, 0) > 0
				):
					warehouse = stock.get("warehouse", "")
					entry = by_warehouse.get(warehouse)
					if entry is None:
						entry = {**stock, "batch_choices": []}
						entry.pop("batch_no", None)
						entry.pop("expiry_date", None)
						entry.pop("manufacturing_date", None)
						entry[quantity_key] = 0
						by_warehouse[warehouse] = entry
					entry[quantity_key] = float(entry.get(quantity_key, 0) or 0) + float(
						stock.get(quantity_key, 0) or 0
					)
					if stock.get("batch_no"):
						entry["batch_choices"].append(
							{"batch_no": stock["batch_no"], "qty": stock.get(quantity_key, 0)}
						)
			locations = list(by_warehouse.values())
			if locations:
				for stock in locations:
					flat.append(
						{
							**item,
							"stock": [stock],
							"warehouse": stock.get("warehouse", ""),
							"warehouse_label": stock.get("warehouse_label", ""),
							"picker_quantity": stock.get("damaged", 0)
							if purpose == "damaged"
							else stock.get("available", 0),
						}
					)
			elif purpose == "count" and not cint(only_stock):
				flat.append(
					{
						**item,
						"stock": [],
						"warehouse": "",
						"warehouse_label": "",
						"picker_quantity": 0,
						"batch_choices": [],
					}
				)
		if page["next_start"] is None:
			break
		item_start = page["next_start"]
	flat.sort(
		key=lambda row: (
			str(row["item_name"]).casefold(),
			str(row["item_code"]),
			str(row.get("warehouse_label", "")).casefold(),
			row.get("warehouse", ""),
		)
	)
	return {
		"results": flat[start : start + page_length],
		"matched_count": len(flat),
		"next_start": start + page_length if start + page_length < len(flat) else None,
	}


def _barcodes(item, values):
	if isinstance(values, str):
		values = values.splitlines()
	if not isinstance(values, list):
		frappe.throw("请每行填写一个条码")
	existing = {row.barcode: row for row in item.barcodes}
	result, seen = [], set()
	for value in values:
		barcode = str(value.get("barcode", "") if isinstance(value, dict) else value).strip()
		if not barcode or barcode in seen:
			continue
		seen.add(barcode)
		# Native child uniqueness remains the concurrent-write constraint.
		other = frappe.db.get_value("Item Barcode", {"barcode": barcode}, "parent")
		if other and other != item.name:
			frappe.throw("条码已被其它物品使用")
		result.append(existing.get(barcode) or item.append("barcodes", {"barcode": barcode}))
	item.set("barcodes", result)


@frappe.whitelist(methods=["POST"])
def save_item(data, item_code=None, version=None):
	require_app()
	data = frappe.parse_json(data)
	if not isinstance(data, dict):
		frappe.throw("物品内容无效")
	if item_code:
		item = load_locked("Item", item_code, version)
		for field in IMMUTABLE_FIELDS:
			changed = (
				bool(cint(data.get(field))) != bool(item.get(field))
				if field.startswith("has_")
				else str(data.get(field)) != str(item.get(field))
			)
			if field in data and changed:
				frappe.throw("现有物品的编号、库存单位与追踪方式不能在此更改")
	else:
		item = frappe.new_doc("Item")
		item.check_permission("create")
		item.item_code = str(data.get("item_code") or "").strip()
		item.stock_uom = data.get("stock_uom")
		item.has_batch_no = cint(data.get("has_batch_no"))
		item.has_expiry_date = cint(data.get("has_expiry_date"))
		item.is_stock_item = 1
		if not item.item_code or not item.stock_uom:
			frappe.throw("请填写物品编号并选择计量单位")
		if frappe.db.exists("Item", item.item_code):
			frappe.throw("此物品编号已存在，请保留输入并使用新建议编号", frappe.DuplicateEntryError)
		frappe.get_doc("UOM", item.stock_uom).check_permission("read")
		if item.has_expiry_date and not item.has_batch_no:
			frappe.throw("效期管理需要启用批次管理")
		if item.has_batch_no and not frappe.db.get_single_value(
			"Stock Settings", "enable_serial_and_batch_no_for_item"
		):
			frappe.throw("请先在库存设置中启用批次功能")
	for field in ITEM_FIELDS:
		if field in data:
			item.set(field, data[field])
	if not (item.item_name or "").strip():
		frappe.throw("请填写物品名称")
	if not item.item_group:
		item.item_group = item_group_root()
	frappe.get_doc("Item Group", item.item_group).check_permission("read")
	if "barcodes" in data:
		_barcodes(item, data["barcodes"])
	item.save()
	return item_metadata(item)


@frappe.whitelist(methods=["POST"])
def set_item_image(item_code, version, file_name):
	require_app()
	item = load_locked("Item", item_code, version)
	file = frappe.get_doc("File", file_name, for_update=True)
	file.check_permission("read")
	if not file.is_private or (file.attached_to_doctype, file.attached_to_name) != ("Item", item.name):
		frappe.throw("请先将图片作为私有附件上传到此物品", frappe.PermissionError)
	if file.file_type not in ("JPG", "JPEG", "PNG", "GIF", "WEBP", "AVIF", "SVG"):
		frappe.throw("请选择图片文件")
	# Core's Attach Image hook matches this exact field link. Without it, every
	# Item save can register another File and reprocess the same private original.
	if file.attached_to_field != "image":
		file.attached_to_field = "image"
		file.save()
	item.image = file.file_url
	item.save()
	return item_metadata(item)


def category_metadata(doc):
	root = item_group_root()
	return {
		"name": doc.name,
		"label": doc.item_group_name,
		"parent": "" if doc.name == root or doc.parent_item_group == root else doc.parent_item_group,
		"is_group": bool(doc.is_group),
		"version": str(doc.modified),
		"is_root": doc.name == root,
		"lft": int(doc.lft or 0),
		"rgt": int(doc.rgt or 0),
	}


@frappe.whitelist()
def category_tree():
	require_app()
	root = item_group_root()
	return [
		{
			"name": row.name,
			"label": row.item_group_name,
			"parent": "" if row.parent_item_group == root else row.parent_item_group,
			"is_group": bool(row.is_group),
			"version": str(row.modified),
			"lft": int(row.lft or 0),
			"rgt": int(row.rgt or 0),
		}
		for row in paged(
			"Item Group",
			filters={"name": ["!=", root]},
			fields=["name", "item_group_name", "parent_item_group", "is_group", "lft", "rgt", "modified"],
			order_by="lft asc, name asc",
		)
	]


@frappe.whitelist(methods=["POST"])
def create_category(label, parent=None, is_group=False):
	require_app()
	frappe.has_permission("Item Group", "create", throw=True)
	parent = str(parent or "").strip() or item_group_root()
	parent_doc = frappe.get_doc("Item Group", parent)
	parent_doc.check_permission("read")
	if not parent_doc.is_group:
		frappe.throw("父类别必须为分组类别")
	label = str(label or "").strip()
	if not label:
		frappe.throw("请填写类别名称")
	if frappe.db.exists("Item Group", label):
		frappe.throw("类别名称已存在", frappe.DuplicateEntryError)
	doc = frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": label,
			"parent_item_group": parent_doc.name,
			"is_group": cint(is_group),
		}
	)
	doc.insert()
	return category_metadata(doc)


@frappe.whitelist(methods=["POST"])
def save_category(name, version, data):
	"""Version-check and save native Item Group metadata, using Frappe rename semantics."""
	require_app()
	data = frappe.parse_json(data)
	if not isinstance(data, dict) or set(data) - {"label", "parent", "is_group"}:
		frappe.throw("类别资料无效")
	root = item_group_root()
	if name == root:
		frappe.throw("不能修改物品类别根节点", frappe.PermissionError)
	doc = frappe.get_doc("Item Group", name, for_update=True)
	doc.check_permission("write")
	if str(doc.modified) != str(version):
		frappe.throw("类别已在其他位置更改，请重新载入", frappe.TimestampMismatchError)
	label = str(data.get("label", doc.item_group_name) or "").strip()
	if not label:
		frappe.throw("请填写类别名称")
	parent_name = str(data.get("parent", doc.parent_item_group) or "").strip() or root
	parent = frappe.get_doc("Item Group", parent_name)
	parent.check_permission("read")
	if not parent.is_group:
		frappe.throw("父类别必须为分组类别")
	if parent.name == doc.name or (parent.lft is not None and doc.lft < parent.lft < doc.rgt):
		frappe.throw("不能将类别移动到自身或下级类别中")
	group = cint(data.get("is_group", doc.is_group))
	if not group and frappe.db.exists("Item Group", {"parent_item_group": doc.name}):
		frappe.throw("此类别含有下级类别，不能改为末级类别")
	# Item Group uses the label as its native document name.  Metadata edits
	# (moving a group or changing its child capability) must not pass an
	# unchanged name through Frappe's rename path.
	if label != doc.name:
		if frappe.db.exists("Item Group", label):
			frappe.throw("类别名称已存在", frappe.DuplicateEntryError)
		doc = frappe.get_doc(
			"Item Group", frappe.rename_doc("Item Group", doc.name, label, merge=False), for_update=True
		)
	doc.item_group_name = label
	doc.parent_item_group = parent_name
	doc.is_group = group
	doc.save()
	return category_metadata(doc)


@frappe.whitelist(methods=["POST"])
def delete_category(name, version):
	require_app()
	if name == item_group_root():
		frappe.throw("不能删除物品类别根节点", frappe.PermissionError)
	doc = frappe.get_doc("Item Group", name, for_update=True)
	doc.check_permission("delete")
	if str(doc.modified) != str(version):
		frappe.throw("类别已在其他位置更改，请重新载入", frappe.TimestampMismatchError)
	frappe.delete_doc("Item Group", name)
	return {"name": name, "deleted": True}


@frappe.whitelist(methods=["POST"])
def create_uom(label, must_be_whole_number=False):
	require_app()
	frappe.has_permission("UOM", "create", throw=True)
	label = str(label or "").strip()
	if not label:
		frappe.throw("请填写计量单位名称")
	if frappe.db.exists("UOM", label):
		frappe.throw("计量单位已存在", frappe.DuplicateEntryError)
	doc = frappe.get_doc(
		{"doctype": "UOM", "uom_name": label, "must_be_whole_number": cint(must_be_whole_number)}
	).insert()
	return {"name": doc.name, "must_be_whole_number": bool(doc.must_be_whole_number)}


@frappe.whitelist(methods=["POST"])
def create_batch(item_code, batch_id, manufacturing_date=None, expiry_date=None):
	require_app()
	item = check_item(item_code)
	frappe.has_permission("Batch", "create", throw=True)
	if not item.has_batch_no:
		frappe.throw("此物品未启用批次管理")
	if manufacturing_date and expiry_date and getdate(expiry_date) < getdate(manufacturing_date):
		frappe.throw("到期日期不能早于生产日期")
	doc = frappe.get_doc(
		{
			"doctype": "Batch",
			"item": item.name,
			"batch_id": batch_id,
			"manufacturing_date": manufacturing_date,
			"expiry_date": expiry_date,
		}
	)
	# Batch defaults otherwise replace an intentionally blank manufacturing date.
	doc.dont_update_if_missing = ["manufacturing_date"]
	# Frappe resolves the DocField's "Today" default while constructing the
	# document, before _set_defaults consults dont_update_if_missing.
	if not manufacturing_date:
		doc.manufacturing_date = None
	doc.insert()
	return {
		"name": doc.name,
		"item_code": item.name,
		"manufacturing_date": str(doc.manufacturing_date or ""),
		"expiry_date": str(doc.expiry_date or ""),
	}


@frappe.whitelist()
def scan_code(value):
	require_app()
	value = str(value or "").strip()
	if not value:
		frappe.throw("请输入条码")
	# Detect all matching Items before deciding ambiguity. A hidden match is a
	# permission failure, never permission to create a duplicate unknown Item.
	codes = set(frappe.get_all("Item Barcode", filters={"barcode": value}, pluck="parent"))
	if frappe.db.exists("Item", value):
		codes.add(value)
	batches = frappe.get_all("Batch", filters={"name": value}, fields=["name", "item"])
	for batch in batches:
		frappe.get_doc("Batch", batch.name).check_permission("read")
		codes.add(batch.item)
	for code in codes:
		check_item(code)
	matches = [item_metadata(check_item(code)) for code in sorted(codes)]
	warehouse = None
	if frappe.db.exists("Warehouse", value):
		from temple_inventory.native_topology import _visible_warehouses, present_locations

		doc = frappe.get_doc("Warehouse", value)
		doc.check_permission("read")
		visible = _visible_warehouses()
		if value not in visible:
			frappe.throw("无权访问此库存位置", frappe.PermissionError)
		if doc.is_group:
			direct = frappe.db.get_value(
				"Warehouse", {"parent_warehouse": doc.name, "ti_direct_storage": 1}, "name"
			)
			if direct:
				if direct not in visible:
					frappe.throw("无权访问此库存位置", frappe.PermissionError)
				doc = frappe.get_doc("Warehouse", direct)
				doc.check_permission("read")
		labels = {
			row["name"]: row["label"]
			for row in present_locations(visible, settings=frappe.get_single("Temple Inventory Settings"))
		}
		warehouse = {
			"name": doc.name,
			"label": labels.get(doc.name, doc.warehouse_name),
			"is_group": bool(doc.is_group),
		}
	return {
		"unknown": not matches and not warehouse,
		"barcode": value,
		"matches": matches,
		"batches": [batch.name for batch in batches],
		"warehouse": warehouse,
	}


@frappe.whitelist(methods=["POST"])
def receipt_batch(item_code, batch_id, manufacturing_date=None, expiry_date=None):
	"""Retry-safe explicit receipt batch creation; never rewrite an existing batch."""
	require_app()
	item = check_item(item_code, lock=True)
	batch_id = str(batch_id or "").strip()
	if not batch_id or len(batch_id) > 140:
		frappe.throw("请提供有效批次编号")
	if frappe.db.exists("Batch", batch_id):
		batch = frappe.get_doc("Batch", batch_id)
		batch.check_permission("read")
		if batch.item != item.name or batch.disabled:
			frappe.throw("此批次属于其它物品或已停用")
		for field, value in (("manufacturing_date", manufacturing_date), ("expiry_date", expiry_date)):
			if value and str(batch.get(field) or "") != str(getdate(value)):
				frappe.throw("现有批次日期不同，请核对或使用新的批次编号")
		return {
			"name": batch.name,
			"manufacturing_date": str(batch.manufacturing_date or ""),
			"expiry_date": str(batch.expiry_date or ""),
		}
	return create_batch(item.name, batch_id, manufacturing_date, expiry_date)


@frappe.whitelist()
def batch_details(name):
	require_app()
	batch = frappe.get_doc("Batch", name)
	batch.check_permission("read")
	check_item(batch.item)
	from temple_inventory.projections import report_page

	stock_query = {
		"dataset": "inventory",
		"view": "locations",
		"batchNo": batch.name,
		"scope": {"item": batch.item},
		"restrictItems": True,
		"itemCodes": [batch.item],
		"includeZero": True,
		"statuses": [1],
	}
	history_query = {
		"dataset": "movements",
		"view": "lines",
		"batchNo": batch.name,
		"scope": {"item": batch.item},
		"restrictItems": True,
		"itemCodes": [batch.item],
		"statuses": [1],
		"sortBy": "date",
		"sort": "desc",
	}
	locations = report_page(stock_query, page_length=100)
	from temple_inventory.browse import movement_history

	history = movement_history(history_query, batch_no=batch.name, page_length=20)
	return {
		"name": batch.name,
		"item_code": batch.item,
		"item": item_metadata(frappe.get_doc("Item", batch.item)),
		"expiry_date": str(batch.expiry_date or ""),
		"manufacturing_date": str(batch.manufacturing_date or ""),
		"description": batch.get("description") or "",
		"disabled": bool(batch.disabled),
		"version": str(batch.modified),
		"can_edit": bool(batch.has_permission("write") and frappe.has_permission("Batch", "write")),
		"locations": locations,
		"history": history,
	}


@frappe.whitelist()
def batch_metadata(name):
	"""Return only the metadata needed while inspecting a native Batch reference."""
	require_app()
	batch = frappe.get_doc("Batch", name)
	batch.check_permission("read")
	check_item(batch.item)
	return {
		"name": batch.name,
		"item_code": batch.item,
		"item": item_metadata(frappe.get_doc("Item", batch.item)),
		"expiry_date": str(batch.expiry_date or ""),
		"manufacturing_date": str(batch.manufacturing_date or ""),
		"description": batch.get("description") or "",
		"disabled": bool(batch.disabled),
		"version": str(batch.modified),
		"can_edit": bool(batch.has_permission("write") and frappe.has_permission("Batch", "write")),
	}


@frappe.whitelist()
def batch_locations(name, start=0, page_length=100, sort_by="identity", sort="asc"):
	from frappe.utils import cint

	require_app()
	batch = frappe.get_doc("Batch", name)
	batch.check_permission("read")
	check_item(batch.item)
	return report_page(
		{
			"dataset": "inventory",
			"view": "locations",
			"batchNo": batch.name,
			"scope": {"item": batch.item},
			"restrictItems": True,
			"itemCodes": [batch.item],
			"includeZero": True,
			"statuses": [1],
			"sortBy": sort_by,
			"sort": sort,
		},
		start=max(0, cint(start)),
		page_length=min(100, max(1, cint(page_length))),
	)


@frappe.whitelist()
def batch_history(name, start=0, page_length=20):
	from frappe.utils import cint

	require_app()
	batch = frappe.get_doc("Batch", name)
	batch.check_permission("read")
	check_item(batch.item)
	from temple_inventory.browse import movement_history

	return movement_history(
		{
			"dataset": "movements",
			"view": "lines",
			"batchNo": batch.name,
			"scope": {"item": batch.item},
			"restrictItems": True,
			"itemCodes": [batch.item],
			"statuses": [1],
			"sortBy": "date",
			"sort": "desc",
		},
		batch_no=batch.name,
		start=max(0, cint(start)),
		page_length=min(100, max(1, cint(page_length))),
	)


@frappe.whitelist()
def save_batch(name, version, data):
	"""Edit batch metadata while preserving its ERPNext identity and stock state."""
	from frappe.utils import getdate

	require_app()
	data = frappe.parse_json(data)
	if not isinstance(data, dict) or set(data) - {"manufacturing_date", "expiry_date", "description"}:
		frappe.throw("批次资料无效")
	batch = load_locked("Batch", name, version)
	check_item(batch.item)
	manufacturing_date = data.get("manufacturing_date") or None
	expiry_date = data.get("expiry_date") or None
	try:
		manufacturing_date = getdate(manufacturing_date) if manufacturing_date else None
		expiry_date = getdate(expiry_date) if expiry_date else None
	except TypeError, ValueError:
		frappe.throw("请填写有效的批次日期")
	if manufacturing_date and expiry_date and expiry_date < manufacturing_date:
		frappe.throw("到期日期不能早于生产日期")
	description = data.get("description", "")
	if not isinstance(description, str) or len(description) > 2000:
		frappe.throw("批次说明过长或无效")
	batch.manufacturing_date = manufacturing_date
	batch.expiry_date = expiry_date
	batch.description = description.strip()
	batch.save()
	return batch_details(batch.name)
