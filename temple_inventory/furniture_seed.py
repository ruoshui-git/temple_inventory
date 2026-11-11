"""Guarded, repeatable seed for the reviewed 2026-11-09 furniture count."""

# ruff: noqa: RUF001 — Chinese source descriptions are intentional.

import csv
import hashlib
import io
import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path

import frappe
from erpnext.stock.utils import get_stock_balance

from temple_inventory import catalog, warehouses
from temple_inventory.item_code import allocate_item_code, suggest_item_code
from temple_inventory.opening import set_difference_account

SOURCE_FILES = (
	"00_manifest.json",
	"01_warehouses.json",
	"02_items.json",
	"03_opening_stock.json",
	"04_source_entries.json",
	"05_display_notes.json",
)
ROOMS = {
	"A01": ("阅览室", "A01"),
	"A06": ("放映室", "A06"),
	"C-Hall": ("餐厅/大厅", "C-Hall"),
}
ROOM_TOTALS = {"C-Hall": 70, "A01": 148, "A06": 57}
CATEGORY_TOTALS = {"桌子": 78, "长凳": 60, "椅/凳": 128, "沙发": 9}
EXPECTED = {
	"items": 30,
	"source_entries": 48,
	"photos": 44,
	"photo_records": 45,
	"rows": 38,
	"units": 275,
	"room_totals": ROOM_TOTALS,
	"category_totals": CATEGORY_TOTALS,
	"stage_entries": 5,
	"stage_units": 12,
	"specific_stock": {"T01": {"C-Hall": 18, "A01": 25}, "C15": {"A06": 2}, "C16": {"A06": 1}},
	"t02_distribution": {"59": 1, "61.5": 1, "63": 3, "64": 6},
}
DISPLAY_NOTE_ROOMS = {"A01", "A06", "C-Hall"}


def _guard():
	"""Allow only development.localhost or explicitly configured staging."""
	from temple_inventory.environment import descriptor

	environment = descriptor().get("environment")
	site = frappe.local.site
	if environment == "production" or site == "kufang.org":
		if (
			site == "kufang.org"
			and environment == "production"
			and frappe.conf.get("temple_inventory_allow_furniture_seed")
		):
			return
		frappe.throw(
			"家具 seed 禁止在 production 或 kufang.org 站点运行；"
			"仅 kufang.org production 可通过配置 temple_inventory_allow_furniture_seed 临时允许"
		)
	if site == "development.localhost":
		return
	if site == "staging.kufang.online" and frappe.conf.get("temple_inventory_environment") == "staging":
		return
	frappe.throw(f"家具 seed 不允许在此站点运行：{site}（environment={environment}）")


def _load_package(package):
	path = Path(package).expanduser().resolve()
	if path.is_dir():
		root = path

		def read(name):
			return (root / name).read_bytes()

		digest = hashlib.sha256(b"".join(read(name) for name in SOURCE_FILES)).hexdigest()
		data = {name.removesuffix(".json"): json.loads(read(name)) for name in SOURCE_FILES}
		photo_bytes = {
			photo["packaged_image_path"]: (root / photo["packaged_image_path"]).read_bytes()
			for item in data["02_items"]
			for photo in item["photos"]
		}
	else:
		with zipfile.ZipFile(path) as archive:
			prefix = "staging_seed_20261109/"

			def read(name):
				return archive.read(prefix + name)

			data = {name.removesuffix(".json"): json.loads(read(name)) for name in SOURCE_FILES}
			photo_bytes = {
				photo["packaged_image_path"]: archive.read(prefix + photo["packaged_image_path"])
				for item in data["02_items"]
				for photo in item["photos"]
			}

		digest = hashlib.sha256(path.read_bytes()).hexdigest()
	data["_photo"] = lambda name: photo_bytes[name]
	data["_digest"] = digest
	return data


def _description(item, note, codes):
	text = f"参考尺寸（英寸）：{item.get('dimensions_reference_inches') or '未提供'}"
	if note:
		text += "\n\n" + re.sub(
			r"\{([^{}]+)\}", lambda match: codes.get(match.group(1), match.group(0)), note
		)
	return text


def _validate(data, expected=None):
	"""Validate source contents and all count invariants without database writes."""
	expected = expected or EXPECTED
	manifest = data["00_manifest"]
	warehouses_data = data["01_warehouses"]
	items = data["02_items"]
	stock = data["03_opening_stock"]
	entries = data["04_source_entries"]
	if manifest.get("schema_version") != 1 or manifest.get("source_date") != "2026-11-09":
		raise ValueError("不支持的家具 seed schema 或 source_date")
	if len(items) != expected["items"] or len(entries) != expected["source_entries"]:
		raise ValueError(f"Item/source entry 数量错误：{len(items)}/{len(entries)}")
	if len(stock) != expected["rows"]:
		raise ValueError(f"Opening Stock 行数错误：{len(stock)}，预期 {expected['rows']}")
	seed_keys = [item.get("seed_key") for item in items]
	candidates = [item.get("candidate_code") for item in items]
	if not all(seed_keys) or len(set(seed_keys)) != len(seed_keys):
		raise ValueError("seed_key 缺失或重复")
	if not all(candidates) or len(set(candidates)) != len(candidates):
		raise ValueError("candidate_code 缺失或重复")
	by_seed = {item["seed_key"]: item for item in items}
	display_notes = data.get("05_display_notes", {})
	item_notes = display_notes.get("items") if isinstance(display_notes, dict) else None
	room_notes = display_notes.get("rooms") if isinstance(display_notes, dict) else None
	if not isinstance(item_notes, dict):
		raise ValueError("05_display_notes.json 的 items 必须是对象")
	if set(item_notes) != set(seed_keys):
		missing = sorted(set(seed_keys) - set(item_notes))
		extra = sorted(set(item_notes) - set(seed_keys))
		raise ValueError(f"05_display_notes.json seed_key 不匹配：缺少 {missing}，多余 {extra}")
	if any(not isinstance(note, str) for note in item_notes.values()):
		raise ValueError("05_display_notes.json 的 Item 说明必须是字符串")
	room_keys = set(room_notes) if isinstance(room_notes, dict) else set()
	if not isinstance(room_notes, dict) or room_keys != DISPLAY_NOTE_ROOMS:
		missing = sorted(DISPLAY_NOTE_ROOMS - room_keys)
		extra = sorted(room_keys - DISPLAY_NOTE_ROOMS)
		raise ValueError(f"05_display_notes.json room 不匹配：缺少 {missing}，多余 {extra}")
	if any(not isinstance(note, str) or not note.strip() for note in room_notes.values()):
		raise ValueError("05_display_notes.json 的 room 文本必须是非空字符串")
	known_candidates = set(candidates)
	for note in item_notes.values():
		unknown = sorted(set(re.findall(r"\{([^{}]+)\}", note)) - known_candidates)
		if unknown:
			raise ValueError(f"05_display_notes.json 包含未知 candidate_code 占位符：{unknown}")
	if any(row.get("item_seed_key") not in by_seed for row in stock):
		raise ValueError("存在找不到对应 Item 的期初库存行")
	pairs = [(row["item_seed_key"], row["warehouse_short_name"]) for row in stock]
	if len(pairs) != len(set(pairs)):
		raise ValueError("Opening Stock 存在重复 Item × Warehouse 行")
	if any(row["warehouse_short_name"] not in ROOMS for row in stock + entries):
		raise ValueError("数据包含未知仓库（可能包含 A14）")
	if any("A14" in str(row) for row in entries + stock + warehouses_data):
		raise ValueError("数据包含已排除的 A14")
	if any(item.get("stock_uom_label") not in {"张", "条", "把", "组"} for item in items):
		raise ValueError("存在不支持的 stock_uom_label")
	if any(item.get("stock_uom") not in (None, "", "Nos") for item in items):
		raise ValueError("家具库存 UOM 必须统一为 Nos")
	photo_count = 0
	for item in items:
		if not item.get("photos"):
			raise ValueError(f"{item['seed_key']} 缺少照片")
		for photo in item["photos"]:
			photo_count += 1
			content = data["_photo"](photo["packaged_image_path"])
			if hashlib.sha256(content).hexdigest() != photo.get("packaged_sha256"):
				raise ValueError(f"照片 SHA-256 不匹配：{photo['capture_photo_id']}")
	unique_photo_count = len({photo["capture_photo_id"] for item in items for photo in item["photos"]})
	if unique_photo_count != expected["photos"] or photo_count != expected.get(
		"photo_records", expected["photos"]
	):
		raise ValueError(
			f"照片数量错误：{unique_photo_count} 个唯一照片 / {photo_count} 个 Item 照片记录，"
			f"预期 {expected['photos']} / {expected.get('photo_records', expected['photos'])}"
		)
	entry_ids = [row.get("capture_entry_id") for row in entries]
	if len(entry_ids) != len(set(entry_ids)) or any(not value for value in entry_ids):
		raise ValueError("Capture entry id 缺失或重复")
	entry_seed_keys = {row["item_seed_key"] for row in entries}
	if entry_seed_keys - set(seed_keys):
		raise ValueError("来源记录引用了未定义的 seed_key")
	room_totals = defaultdict(int)
	item_totals = defaultdict(int)
	for row in stock:
		qty = int(row.get("quantity") or 0)
		if qty <= 0:
			raise ValueError("期初库存数量必须为正整数")
		room_totals[row["warehouse_short_name"]] += qty
		item_totals[row["item_seed_key"]] += qty
	for item in items:
		if item_totals[item["seed_key"]] != int(item.get("opening_quantity") or 0):
			raise ValueError(f"{item['seed_key']} 分仓数量与 opening_quantity 不符")
	if dict(room_totals) != expected["room_totals"]:
		raise ValueError(f"仓库数量错误：{dict(room_totals)}，预期 {expected['room_totals']}")
	total = sum(room_totals.values())
	if total != expected["units"]:
		raise ValueError(f"库存总量错误：{total}，预期 {expected['units']}")
	categories = defaultdict(int)
	for item in items:
		categories[item["category"]] += int(item["opening_quantity"])
	if dict(categories) != expected["category_totals"]:
		raise ValueError(f"品类数量错误：{dict(categories)}，预期 {expected['category_totals']}")
	stage_entries = [row for row in entries if row["capture_collection_name"] == "餐厅 / 舞台"]
	stage_units = sum(int(row["raw_quantity"]) for row in stage_entries)
	if len(stage_entries) != expected.get("stage_entries", 5) or stage_units != expected.get(
		"stage_units", 12
	):
		raise ValueError(f"舞台来源错误：{len(stage_entries)} 条 / {stage_units} 件")
	by_candidate = {item["candidate_code"]: item for item in items}
	for candidate, values in expected.get("specific_stock", EXPECTED["specific_stock"]).items():
		if candidate not in by_candidate:
			raise ValueError(f"验证要求存在候选 Item {candidate}")
		for room, quantity in values.items():
			actual = sum(
				int(row["quantity"])
				for row in stock
				if row["item_seed_key"] == by_candidate[candidate]["seed_key"]
				and row["warehouse_short_name"] == room
			)
			if actual != quantity:
				raise ValueError(f"{candidate} {room} 数量错误：{actual}，预期 {quantity}")
	if "T02" in by_candidate:
		t02 = [row for row in entries if row["item_candidate_code"] == "T02"]
		distribution = defaultdict(int)
		for row in t02:
			value = str(row.get("raw_dimensions") or row.get("raw_title") or "")
			for size in ("59", "61.5", "63", "64"):
				if size in value:
					distribution[size] += int(row["raw_quantity"])
		if dict(distribution) != expected.get("t02_distribution", EXPECTED["t02_distribution"]):
			raise ValueError(f"T02 尺寸分布错误：{dict(distribution)}")
	return {
		"items": len(items),
		"source_entries": len(entries),
		"photos": unique_photo_count,
		"photo_records": photo_count,
		"stock_rows": len(stock),
		"units": total,
		"room_totals": dict(room_totals),
		"category_totals": dict(categories),
		"stage_entries": len(stage_entries),
		"stage_units": stage_units,
	}


def _format_item_name(item):
	return f"{item['item_name']}({item['stock_uom_label']})"


def _item_state_diff(item, source, group, description):
	"""Compare every seed-owned Item field, including its fully resolved description."""
	expected_fields = {
		"item_name": _format_item_name(source),
		"item_group": group,
		"description": description,
		"stock_uom": "Nos",
		"is_stock_item": 1,
	}
	return {
		key: {"expected": value, "actual": item.get(key)}
		for key, value in expected_fields.items()
		if item.get(key) != value
	}


def _preview_codes(sources, item_codes):
	"""Resolve missing Item codes without advancing the allocator's series."""
	missing = [source for source in sources if not item_codes.get(source["seed_key"])]
	if not missing:
		return dict(item_codes)
	first = suggest_item_code()
	number = int(first.removeprefix("ITM-"))
	for source in missing:
		while number <= 999999:
			code = f"ITM-{number:06d}"
			number += 1
			if not frappe.db.exists("Item", code):
				item_codes[source["seed_key"]] = code
				break
		else:
			frappe.throw("Item code capacity ITM-999999 has been exhausted")
	return dict(item_codes)


def _existing_location(parent, label):
	return frappe.db.get_value("Warehouse", {"parent_warehouse": parent, "ti_label": label}, "name")


def _existing_room(parent, label):
	return frappe.db.get_value(
		"Warehouse", {"parent_warehouse": parent, "ti_label": label, "warehouse_type": "Room"}, "name"
	)


def _ensure_expected_state(data, *, apply=False):
	"""Build plan and fail on any pre-existing data drift before writes begin."""
	settings = frappe.get_single("Temple Inventory Settings")
	if not settings.company or not settings.physical_root_warehouse:
		frappe.throw("请先安装 empty baseline 并配置实体库房根节点")
	root = frappe.db.get_value("Item Group", {"lft": 1}, "name")
	if not root:
		frappe.throw("未找到 All Item Groups")
	group = frappe.db.get_value("Item Group", "家具与大型用品", "name")
	if group and (
		frappe.db.get_value("Item Group", group, "parent_item_group") != root
		or not frappe.db.get_value("Item Group", group, "is_group")
	):
		frappe.throw("现有 Item Group 家具与大型用品与预期父级/分组状态不符")
	plan = {"warehouses": [], "item_group": [], "items": [], "files": [], "reconciliations": []}
	area = _existing_location(settings.physical_root_warehouse, "第2寺院")
	plan["warehouses"].append(
		{"action": "unchanged" if area else "create", "label": "第2寺院", "short_label": "T2"}
	)
	if area and frappe.db.get_value("Warehouse", area, "ti_short_label") != "T2":
		frappe.throw("现有第2寺院 Warehouse 简称不为 T2")
	functional = _existing_location(area, "功能区域") if area else None
	storage = _existing_location(area, "专用库房") if area else None
	for label, existing in (("功能区域", functional), ("专用库房", storage)):
		plan["warehouses"].append({"action": "unchanged" if existing else "create", "label": label})
	for code, (label, short) in ROOMS.items():
		room = _existing_room(functional, label) if functional else None
		if room and frappe.db.get_value("Warehouse", room, "warehouse_type") != "Room":
			frappe.throw(f"現有 {code} 不是 Room 类型")
		if room and frappe.db.get_value("Warehouse", room, "ti_short_label") != short:
			frappe.throw(f"现有 {code} Warehouse 简称不符合 seed：{short}")
		leaf = (
			frappe.db.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
			if room
			else None
		)
		plan["warehouses"].append(
			{"action": "unchanged" if room and leaf else "create", "label": code, "direct_leaf": bool(leaf)}
		)
	if group:
		plan["item_group"].append({"action": "unchanged", "name": group})
	else:
		plan["item_group"].append({"action": "create", "name": "家具与大型用品", "parent": root})
	stock_by_seed = defaultdict(list)
	for row in data["03_opening_stock"]:
		stock_by_seed[row["item_seed_key"]].append(row)
	item_codes = {}
	for source in data["02_items"]:
		code = frappe.db.get_value("Item", {"ti_import_ref": source["seed_key"]}, "name")
		if not code:
			candidate_name = frappe.db.get_value("Item", {"item_name": _format_item_name(source)}, "name")
			if (
				candidate_name
				and frappe.db.get_value("Item", candidate_name, "ti_import_ref") != source["seed_key"]
			):
				frappe.throw(f"Item {candidate_name} 名称相同但 seed key 不匹配")
		item_codes[source["seed_key"]] = code or ""
	existing_seed_keys = {key for key, code in item_codes.items() if code}
	item_codes = _preview_codes(data["02_items"], item_codes)
	candidate_codes = {item["candidate_code"]: item_codes[item["seed_key"]] for item in data["02_items"]}
	for source in data["02_items"]:
		code = frappe.db.get_value("Item", {"ti_import_ref": source["seed_key"]}, "name")
		description = _description(
			source, data["05_display_notes"]["items"][source["seed_key"]], candidate_codes
		)
		if code:
			item = frappe.get_doc("Item", code)
			diff = _item_state_diff(item, source, group or "家具与大型用品", description)
			if diff:
				frappe.throw(f"Seed Item {source['seed_key']} 有主数据差异：{frappe.as_json(diff)}")
			item_codes[source["seed_key"]] = code
			plan["items"].append(
				{
					"action": "unchanged",
					"seed_key": source["seed_key"],
					"item_code": code,
					"item_name": item.item_name,
				}
			)
		else:
			plan["items"].append(
				{
					"action": "create",
					"seed_key": source["seed_key"],
					"item_code": code,
					"item_name": _format_item_name(source),
					"description": description,
					"description_pending_codes": False,
				}
			)
	for source in data["02_items"]:
		code = item_codes[source["seed_key"]]
		for photo in source["photos"]:
			content_hash = photo["packaged_sha256"]
			file_row = None
			if code:
				for row in frappe.get_all(
					"File",
					filters={"attached_to_doctype": "Item", "attached_to_name": code},
					fields=["name", "file_name", "file_url"],
					limit_page_length=0,
				):
					try:
						if (
							hashlib.sha256(
								frappe.get_doc("File", row.name).get_content(encodings=[])
							).hexdigest()
							== content_hash
						):
							file_row = row
							break
					except Exception:
						continue
			plan["files"].append(
				{
					"action": "unchanged" if file_row else "create",
					"seed_key": source["seed_key"],
					"primary": source["photos"].index(photo) == 0,
					"reference_only": bool(photo.get("reference_only")),
				}
			)
	for room, rows in (
		(room, [row for row in data["03_opening_stock"] if row["warehouse_short_name"] == room])
		for room in ROOMS
	):
		key = hashlib.sha256(f"furniture-20261109:{room}".encode()).hexdigest()
		name = frappe.db.get_value("Stock Reconciliation", {"ti_request_key": key}, "name")
		if name:
			doc = frappe.get_doc("Stock Reconciliation", name)
			room_name = _existing_room(functional, ROOMS[room][0]) if functional else None
			leaf = (
				frappe.db.get_value(
					"Warehouse", {"parent_warehouse": room_name, "ti_direct_storage": 1}, "name"
				)
				if room_name
				else None
			)
			actual = sorted(
				(row.item_code, row.warehouse, int(row.qty), float(row.valuation_rate or 0))
				for row in doc.items
			)
			expected = sorted(
				(
					item_codes.get(row["item_seed_key"]) or "",
					leaf,
					int(row["quantity"]),
					0.0,
				)
				for row in rows
			)
			if doc.docstatus != 1 or actual != expected:
				frappe.throw(
					f"Seed reconciliation {name} 与 package 存在差异：expected={expected!r}, actual={actual!r}"
				)
			plan["reconciliations"].append({"action": "unchanged", "room": room, "name": name})
		else:
			plan["reconciliations"].append({"action": "create", "room": room, "request_key": key})
	existing_rooms = {
		room
		for room in ROOMS
		if frappe.db.exists(
			"Stock Reconciliation",
			{"ti_request_key": hashlib.sha256(f"furniture-20261109:{room}".encode()).hexdigest()},
		)
	}
	# Existing item balances are checked before any create action can mutate the site.
	for source in data["02_items"]:
		code = item_codes[source["seed_key"]]
		if source["seed_key"] not in existing_seed_keys:
			continue
		wanted = {
			row["warehouse_short_name"]: int(row["quantity"])
			for row in data["03_opening_stock"]
			if row["item_seed_key"] == source["seed_key"]
		}
		seed_leaves = set()
		for room in ROOMS:
			room_name = _existing_room(functional, ROOMS[room][0]) if functional else None
			leaf = (
				frappe.db.get_value(
					"Warehouse", {"parent_warehouse": room_name, "ti_direct_storage": 1}, "name"
				)
				if room_name
				else None
			)
			if leaf:
				seed_leaves.add(leaf)
			actual = float(get_stock_balance(code, leaf) or 0) if leaf else 0.0
			expected_qty = float(wanted.get(room, 0)) if room in existing_rooms else 0.0
			if actual != expected_qty:
				frappe.throw(
					f"Seed Item {source['seed_key']} / {room} 余额差异：expected={expected_qty}, actual={actual}"
				)
		for bin_row in frappe.get_all(
			"Bin",
			filters={"item_code": code, "actual_qty": ["!=", 0]},
			fields=["warehouse", "actual_qty"],
			limit_page_length=0,
		):
			if bin_row.warehouse not in seed_leaves:
				frappe.throw(
					f"Seed Item {source['seed_key']} 在非 seed 仓库有库存："
					f"{bin_row.warehouse}={bin_row.actual_qty}"
				)
	return plan, item_codes


def _create_area(label, parent, short_label=None):
	warehouses._insert_location("Area", label, parent, short_label)
	return _existing_location(parent, label)


def _count_sheet(data, room, rows, item_codes):
	items = {item["seed_key"]: item for item in data["02_items"]}
	entries = [entry for entry in data["04_source_entries"] if entry["warehouse_short_name"] == room]
	output = io.StringIO()
	writer = csv.writer(output)
	writer.writerow(("物品编码", "物品名称", "数量", "单位", "摆放"))
	for row in rows:
		item = items[row["item_seed_key"]]
		item_entries = [entry for entry in entries if entry["item_seed_key"] == item["seed_key"]]
		placement = ""
		if room == "C-Hall":
			stage = sum(
				int(entry["raw_quantity"])
				for entry in item_entries
				if entry.get("capture_collection_name") == "餐厅 / 舞台"
			)
			if stage:
				main = int(row["quantity"]) - stage
				placement = f"主餐厅 {main}，舞台 {stage}" if main else f"舞台 {stage}"
		elif room == "A01":
			arranged = [entry for entry in item_entries if entry.get("arrangement_note")]
			if arranged:
				quantity = sum(int(entry["raw_quantity"]) for entry in arranged)
				placement = f"{quantity} {item['stock_uom_label']}收在角落待用"
		writer.writerow(
			(
				item_codes[item["seed_key"]],
				_format_item_name(item),
				row["quantity"],
				item["stock_uom_label"],
				placement,
			)
		)
	return output.getvalue().encode("utf-8-sig")


def _create_reconciliation(room, room_leaf, rows, item_codes, room_note, data):
	doc = frappe.new_doc("Stock Reconciliation")
	doc.company = frappe.get_single("Temple Inventory Settings").company
	doc.purpose = "Opening Stock"
	doc.posting_date = "2026-11-09"
	doc.posting_time = "21:00:00"
	doc.set_posting_time = 1
	doc.ti_time_mode = "Historical"
	doc.ti_request_key = hashlib.sha256(f"furniture-20261109:{room}".encode()).hexdigest()
	doc.ti_request_user = "Administrator"
	doc.ti_notes = room_note
	set_difference_account(doc)
	for row in rows:
		doc.append(
			"items",
			{
				"item_code": item_codes[row["item_seed_key"]],
				"warehouse": room_leaf,
				"qty": int(row["quantity"]),
				"valuation_rate": 0,
				"use_serial_batch_fields": 1,
			},
		)
	doc.insert(ignore_permissions=True)
	doc.submit()
	from temple_inventory.native_samples import _attach_file

	_attach_file(
		f"盘点清单-{room}.csv", _count_sheet(data, room, rows, item_codes), "Stock Reconciliation", doc.name
	)
	return doc


def _apply(data, plan, item_codes):
	settings = frappe.get_single("Temple Inventory Settings")
	area = _existing_location(settings.physical_root_warehouse, "第2寺院") or _create_area(
		"第2寺院", settings.physical_root_warehouse, "T2"
	)
	functional = _existing_location(area, "功能区域") or _create_area("功能区域", area)
	storage = _existing_location(area, "专用库房") or _create_area("专用库房", area)
	warehouse_names = {"第2寺院": area, "功能区域": functional, "专用库房": storage}
	room_leaves = {}
	for code, (label, short) in ROOMS.items():
		room = _existing_room(functional, label)
		if not room:
			warehouses._insert_location("Room", label, functional, short)
			room = _existing_room(functional, label)
		room_leaves[code] = frappe.db.get_value(
			"Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name"
		)
		if not room_leaves[code]:
			frappe.throw(f"{code} 缺少直接存放叶子仓库")
		warehouse_names[code] = room
	root = catalog.item_group_root()
	group = (
		frappe.db.get_value("Item Group", "家具与大型用品", "name")
		or catalog.create_category("家具与大型用品", root, is_group=True)["name"]
	)
	stock_by_seed = defaultdict(list)
	for row in data["03_opening_stock"]:
		stock_by_seed[row["item_seed_key"]].append(row)
	items_report = {}
	for source in data["02_items"]:
		seed_key = source["seed_key"]
		code = frappe.db.get_value("Item", {"ti_import_ref": seed_key}, "name")
		item_codes[seed_key] = code or allocate_item_code()
	candidate_codes = {item["candidate_code"]: item_codes[item["seed_key"]] for item in data["02_items"]}
	for source in data["02_items"]:
		seed_key = source["seed_key"]
		code = item_codes[seed_key]
		description = _description(source, data["05_display_notes"]["items"][seed_key], candidate_codes)
		if not frappe.db.exists("Item", code):
			catalog.save_item(
				{
					"item_code": code,
					"item_name": _format_item_name(source),
					"item_group": group,
					"description": description,
					"stock_uom": "Nos",
					"has_batch_no": 0,
					"has_expiry_date": 0,
					"has_serial_no": 0,
				},
			)
			item_doc = frappe.get_doc("Item", code)
			item_doc.ti_import_ref = seed_key
			item_doc.save(ignore_permissions=True)
		item_doc = frappe.get_doc("Item", code)
		reference_count = sum(bool(photo.get("reference_only")) for photo in source["photos"])
		photo_indexes = {"regular": 0, "reference": 0}
		for index, photo in enumerate(source["photos"]):
			kind = "reference" if photo.get("reference_only") else "regular"
			photo_indexes[kind] += 1
			content = data["_photo"](photo["packaged_image_path"])
			found = None
			for file_row in frappe.get_all(
				"File",
				filters={"attached_to_doctype": "Item", "attached_to_name": code},
				fields=["name"],
				limit_page_length=0,
			):
				file_doc = frappe.get_doc("File", file_row.name)
				if hashlib.sha256(file_doc.get_content(encodings=[])).hexdigest() == photo["packaged_sha256"]:
					found = file_doc
					break
			if not found:
				from temple_inventory.native_samples import _attach_file

				filename = (
					f"{code}-参考图{f'-{photo_indexes[kind]}' if reference_count > 1 else ''}.jpg"
					if photo.get("reference_only")
					else f"{code}-{photo_indexes[kind]}.jpg"
				)
				found = _attach_file(filename, content, "Item", code, "image" if index == 0 else None)
			if index == 0 and item_doc.image != found.file_url:
				from temple_inventory.native_samples import _save_primary_image

				found.attached_to_field = "image"
				found.save(ignore_permissions=True)
				_save_primary_image(item_doc, found)
		items_report[seed_key] = {"item_code": code, "item_name": item_doc.item_name}
	for item in data["02_items"]:
		for row in stock_by_seed[item["seed_key"]]:
			actual = get_stock_balance(item_codes[item["seed_key"]], room_leaves[row["warehouse_short_name"]])
			if actual != 0 and actual != float(row["quantity"]):
				frappe.throw(
					f"库存余额冲突：{item_codes[item['seed_key']]} / {row['warehouse_short_name']} = {actual}"
				)
	reconciliation_names = {}
	for room in ROOMS:
		key = hashlib.sha256(f"furniture-20261109:{room}".encode()).hexdigest()
		existing = frappe.db.get_value("Stock Reconciliation", {"ti_request_key": key}, "name")
		if existing:
			reconciliation_names[room] = existing
			continue
		rows = [row for row in data["03_opening_stock"] if row["warehouse_short_name"] == room]
		doc = _create_reconciliation(
			room,
			room_leaves[room],
			rows,
			item_codes,
			data["05_display_notes"]["rooms"][room],
			data,
		)
		reconciliation_names[room] = doc.name
	photo_coverage = {}
	for source in data["02_items"]:
		code = item_codes[source["seed_key"]]
		files = frappe.get_all(
			"File",
			filters={"attached_to_doctype": "Item", "attached_to_name": code},
			fields=["file_name", "attached_to_field"],
			limit_page_length=0,
		)
		photo_coverage[source["seed_key"]] = {
			"primary": bool(frappe.db.get_value("Item", code, "image")),
			"attachments": len([row for row in files if row.attached_to_field != "ti_image_variant"]),
			"reference_only": sum(bool(photo.get("reference_only")) for photo in source["photos"]),
		}
	seed_codes = sorted(item_codes.values())
	file_rows = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Item", "attached_to_name": ["in", seed_codes]},
		fields=["name", "attached_to_field"],
		limit_page_length=0,
	)
	request_keys = [hashlib.sha256(f"furniture-20261109:{room}".encode()).hexdigest() for room in ROOMS]
	warehouse_details = {}
	for label, name in warehouse_names.items():
		row = frappe.db.get_value(
			"Warehouse",
			name,
			["name", "warehouse_name", "ti_label", "ti_short_label", "parent_warehouse", "is_group"],
			as_dict=True,
		)
		warehouse_details[label] = dict(row)
		if label in ROOMS:
			warehouse_details[label]["direct_leaf"] = room_leaves[label]
	return {
		"package_digest": data["_digest"],
		"items": items_report,
		"warehouses": warehouse_names,
		"warehouse_details": warehouse_details,
		"reconciliations": reconciliation_names,
		"photo_coverage": photo_coverage,
		"assertions": _validate(data),
		"counts": {
			"items": len(items_report),
			"warehouses": len(warehouse_names),
			"reconciliations": len(reconciliation_names),
			"files": sum(len(row["photos"]) for row in data["02_items"]),
			"created": sum(entry["action"] == "create" for rows in plan.values() for entry in rows),
			"unchanged": sum(entry["action"] == "unchanged" for rows in plan.values() for entry in rows),
			"item_file_attachments": len(
				[row for row in file_rows if row.attached_to_field != "ti_image_variant"]
			),
			"image_derivatives": len(
				[row for row in file_rows if row.attached_to_field == "ti_image_variant"]
			),
			"submitted_stock_reconciliations": frappe.db.count(
				"Stock Reconciliation", {"ti_request_key": ["in", request_keys], "docstatus": 1}
			),
			"stock_ledger_entries": frappe.db.count("Stock Ledger Entry", {"item_code": ["in", seed_codes]}),
			"positive_bins": frappe.db.count(
				"Bin", {"item_code": ["in", seed_codes], "actual_qty": [">", 0]}
			),
		},
	}


def run(package, apply=0):
	"""Print and return the furniture seed plan; apply only when explicitly requested."""
	_guard()
	previous_user = frappe.session.user
	frappe.set_user("Administrator")
	try:
		data = _load_package(package)
		assertions = _validate(data)
		plan, item_codes = _ensure_expected_state(data)
		if not apply:
			report = {
				"package_digest": data["_digest"],
				"mode": "dry-run",
				"assertions": assertions,
				"plan": plan,
			}
		else:
			report = {"mode": "apply", **_apply(data, plan, item_codes)}
			frappe.db.commit()
		return report
	except Exception:
		if apply:
			frappe.db.rollback()
		raise
	finally:
		frappe.set_user(previous_user)
