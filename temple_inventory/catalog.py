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
	images = [
		file
		for file in files
		if str(file.file_type or "").lower() in ("jpg", "jpeg", "png", "gif", "webp", "avif", "svg")
		or str(file.file_name or "")
		.lower()
		.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".svg"))
	]
	images.sort(key=lambda file: file.file_url != item.image)
	return (images[0].file_url if images else ""), files, images


def item_metadata(item):
	image, files, images = _image(item)
	return {
		"name": item.name,
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
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
			{"dataset": "movements", "view": "lines", "scope": {"item": item.name}}, page_length=10
		),
		"loans": report_page(
			{"dataset": "loans", "view": "outcomes", "scope": {"item": item.name}}, page_length=10
		),
	}


@frappe.whitelist()
def operation_item(item_code, timestamp=None):
	"""Complete permission-filtered locations for one selected editor Item."""
	from frappe.utils import get_datetime

	require_app()
	item = check_item(item_code)
	context = ReportContext(validate_query({"dataset": "inventory", "scope": {"item": item.name}}))
	if timestamp:
		context.snapshot = str(get_datetime(timestamp))
	return {**item_metadata(item), "stock": list(stock_rows(context)), "snapshot": context.snapshot}


@frappe.whitelist()
def search_items(
	search="", start=0, page_length=30, warehouse=None, category=None, in_stock_only=False, item_codes=None
):
	require_app()
	start, page_length = max(0, cint(start)), min(100, max(1, cint(page_length)))
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
				"warehouses": [warehouse] if warehouse else [],
				"categories": [category] if category else [],
			},
		}
	)
	context = ReportContext(query)
	if category:
		filters["item_group"] = ["in", sorted(context.categories or set()) or [""]]
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
			metadata["stock"] = list(stock_rows(ReportContext(validate_query(stock_query))))
			results.append(metadata)
	total = int(count[0].total if count else 0)
	return {
		"results": results,
		"matched_count": total,
		"next_start": start + page_length if start + page_length < total else None,
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
	if not (item.item_name or "").strip() or not item.item_group:
		frappe.throw("请填写名称并选择类别")
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


@frappe.whitelist(methods=["POST"])
def create_category(label, parent, is_group=False):
	require_app()
	frappe.has_permission("Item Group", "create", throw=True)
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
	).insert()
	return {
		"name": doc.name,
		"label": doc.item_group_name,
		"parent": doc.parent_item_group,
		"is_group": bool(doc.is_group),
	}


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
	).insert()
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
		from temple_inventory.native_topology import _visible_warehouses

		doc = frappe.get_doc("Warehouse", value)
		doc.check_permission("read")
		if value not in _visible_warehouses():
			frappe.throw("无权访问此库存位置", frappe.PermissionError)
		warehouse = {"name": doc.name, "label": doc.warehouse_name, "is_group": bool(doc.is_group)}
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
	return {
		"name": batch.name,
		"item_code": batch.item,
		"expiry_date": str(batch.expiry_date or ""),
		"manufacturing_date": str(batch.manufacturing_date or ""),
		"disabled": bool(batch.disabled),
	}
