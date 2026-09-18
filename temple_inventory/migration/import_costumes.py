# -*- coding: utf-8 -*-
"""
演出用品 Notion -> ERPNext 导入脚本

用途
----
把 costumes_source_normalized.csv + image_manifest.csv 导入 ERPNext：
1. 创建/确认中文 Item Group：
   寺院物资
   └── 演出用品
       ├── 演出服装
       ├── 演出鞋袜
       ├── 演出头饰
       └── 演出道具

2. 创建 Item 自定义字段：
   - 旧物品编号        custom_legacy_item_code
   - 演出类型          custom_performance_type
   - 使用过的节目      custom_programs_used
   - 物品备注          custom_item_notes

3. 新 Item Code 使用全局编号：
   ITM-000001, ITM-000002, ...

4. 原 Notion 单位不创建为 ERPNext UOM，而是追加到物品名称：
   绿色古风裙裤(男) + 套 -> 绿色古风裙裤(男)（套）
   ERPNext Stock UOM 统一使用自定义单位“数量”，并允许小数。

5. 原 Notion 编号 A01/B01/C01/D01... 保存到“旧物品编号”。

6. 上传 image_manifest.csv 中的全部图片；
   is_primary=1 的图片设为 Item 主图，其余作为附件。

7. 可选：建立一张开仓 Stock Reconciliation，把数量放到
   第2寺院 -> A04。
   默认只创建草稿，不自动提交，方便人工检查。

推荐放置位置
------------
apps/temple_inventory/temple_inventory/migration/import_costumes.py

Bench 调用示例
-------------
bench --site <你的站点> execute \
  temple_inventory.migration.import_costumes.run \
  --kwargs '{
    "source_csv": "/path/costumes_source_normalized.csv",
    "image_manifest_csv": "/path/image_manifest.csv",
    "image_dir": "/path/extracted_notions_images",
    "create_opening_stock": 1,
    "submit_opening_stock": 0
  }'

可先 dry-run：
bench --site <你的站点> execute \
  temple_inventory.migration.import_costumes.run \
  --kwargs '{
    "source_csv": "/path/costumes_source_normalized.csv",
    "image_manifest_csv": "/path/image_manifest.csv",
    "image_dir": "/path/extracted_notions_images",
    "dry_run": 1
  }'
"""

from __future__ import annotations

import csv
import os
import re
from collections import defaultdict
from decimal import Decimal, InvalidOperation
from typing import Dict, Iterable, List, Optional, Tuple

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.model.naming import make_autoname
from frappe.utils import cint, flt, nowdate
from frappe.utils.file_manager import save_file


# ---------------------------------------------------------------------------
# 固定配置
# ---------------------------------------------------------------------------

ITEM_CODE_SERIES = "ITM-.######"
DEFAULT_STOCK_UOM = "数量"

ROOT_ITEM_GROUP = "寺院物资"
PERFORMANCE_PARENT_GROUP = "演出用品"

TYPE_TO_ITEM_GROUP = {
    "A-服装": "演出服装",
    "B-鞋袜": "演出鞋袜",
    "C-头饰": "演出头饰",
    "D-道具": "演出道具",
}

SITE_WAREHOUSE_LABEL = "第2寺院"
ROOM_WAREHOUSE_LABEL = "A04"

CUSTOM_FIELDS = {
    "Item": [
        {
            "fieldname": "custom_temple_inventory_section",
            "label": "寺院物资信息",
            "fieldtype": "Section Break",
            "insert_after": "description",
        },
        {
            "fieldname": "custom_legacy_item_code",
            "label": "旧物品编号",
            "fieldtype": "Data",
            "insert_after": "custom_temple_inventory_section",
            "in_list_view": 0,
            "in_standard_filter": 1,
            "search_index": 1,
            "description": "旧系统/Notion 使用的编号，例如 A01、B03。",
        },
        {
            "fieldname": "custom_performance_type",
            "label": "演出类型",
            "fieldtype": "Data",
            "insert_after": "custom_legacy_item_code",
            "in_standard_filter": 1,
            "description": "例如：古典舞、民舞、现代服饰。仅作分类与参考。",
        },
        {
            "fieldname": "custom_programs_used",
            "label": "使用过的节目",
            "fieldtype": "Long Text",
            "insert_after": "custom_performance_type",
            "description": "当前仅作历史参考文本；以后如有需要可改为结构化节目关联。",
        },
        {
            "fieldname": "custom_item_notes",
            "label": "物品备注",
            "fieldtype": "Long Text",
            "insert_after": "custom_programs_used",
            "description": "可保存尺码构成、缺件、状态等不参与库存数量计算的信息。",
        },
    ]
}


# ---------------------------------------------------------------------------
# 通用工具
# ---------------------------------------------------------------------------

def _clean(value) -> str:
    """CSV 单元格 -> 干净字符串；None/NaN 风格内容统一为空。"""
    if value is None:
        return ""
    value = str(value).strip()
    if value.lower() in {"nan", "none", "null"}:
        return ""
    return value


def _read_csv(path: str) -> List[dict]:
    if not path or not os.path.exists(path):
        frappe.throw(f"找不到 CSV：{path}")
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        return [dict(row) for row in csv.DictReader(f)]


def _to_qty(value) -> float:
    text = _clean(value)
    if not text:
        return 0.0
    try:
        return float(Decimal(text))
    except (InvalidOperation, ValueError):
        frappe.throw(f"无法解析数量：{value}")


def _ensure_required_columns(rows: List[dict], required: Iterable[str], filename: str):
    if not rows:
        frappe.throw(f"{filename} 没有数据。")
    missing = [x for x in required if x not in rows[0]]
    if missing:
        frappe.throw(f"{filename} 缺少字段：{', '.join(missing)}")


def _ensure_item_group(name: str, parent: str, is_group: int) -> str:
    if frappe.db.exists("Item Group", name):
        doc = frappe.get_doc("Item Group", name)
        changed = False
        if parent and doc.parent_item_group != parent:
            # 不自动搬动已有分类，以免误改生产数据。
            frappe.throw(
                f"Item Group “{name}” 已存在，但父组是 “{doc.parent_item_group}”，"
                f"预期为 “{parent}”。请先人工确认。"
            )
        if cint(doc.is_group) != cint(is_group):
            frappe.throw(
                f"Item Group “{name}” 已存在，但 is_group={doc.is_group}，"
                f"预期为 {is_group}。请先人工确认。"
            )
        return name

    doc = frappe.get_doc(
        {
            "doctype": "Item Group",
            "item_group_name": name,
            "parent_item_group": parent,
            "is_group": is_group,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name


def _ensure_item_groups():
    # ERPNext 默认根通常为 All Item Groups。
    root_parent = "All Item Groups"
    if not frappe.db.exists("Item Group", root_parent):
        frappe.throw(
            "找不到 ERPNext 默认根 Item Group “All Item Groups”。"
            "请检查站点的 Item Group 根节点名称。"
        )

    _ensure_item_group(ROOT_ITEM_GROUP, root_parent, 1)
    _ensure_item_group(PERFORMANCE_PARENT_GROUP, ROOT_ITEM_GROUP, 1)

    for leaf in TYPE_TO_ITEM_GROUP.values():
        _ensure_item_group(leaf, PERFORMANCE_PARENT_GROUP, 0)


def _ensure_custom_fields():
    # update=True：脚本重复运行时保持字段定义同步。
    create_custom_fields(CUSTOM_FIELDS, update=True)


def _ensure_standard_stock_uom(stock_uom: str = DEFAULT_STOCK_UOM):
    """
    所有演出用品统一使用自定义库存单位“数量”。

    原 Notion 的“套/件/盒/双……”只保留在物品名称中。
    “数量”允许小数，用于支持例如 9.5 双这类真实库存情况。
    """
    if frappe.db.exists("UOM", stock_uom):
        doc = frappe.get_doc("UOM", stock_uom)
        if cint(doc.must_be_whole_number):
            doc.must_be_whole_number = 0
            doc.save(ignore_permissions=True)
        return

    frappe.get_doc(
        {
            "doctype": "UOM",
            "uom_name": stock_uom,
            "must_be_whole_number": 0,
        }
    ).insert(ignore_permissions=True)


def _append_source_uom_to_name(item_name: str, source_uom: str) -> str:
    """
    将 Notion 单位作为中文全角括号后缀保留在 Item Name 中。

    例：
      绿色古风裙裤(男), 套 -> 绿色古风裙裤(男)（套）

    重复运行时，如果名称已经以同样的后缀结尾，则不重复追加。
    """
    item_name = _clean(item_name)
    source_uom = _clean(source_uom)
    if not source_uom:
        return item_name

    suffix = f"（{source_uom}）"
    if item_name.endswith(suffix):
        return item_name
    return f"{item_name}{suffix}"


def _resolve_warehouse_by_label(label: str, parent_name: Optional[str] = None) -> str:
    """
    使用 warehouse_name 查找实际 Warehouse.name。
    ERPNext 的 name 可能带公司缩写，例如 “A04 - ABC”，
    所以不要假定 document name 就等于 A04。
    """
    filters = {"warehouse_name": label}
    if parent_name:
        filters["parent_warehouse"] = parent_name

    matches = frappe.get_all(
        "Warehouse",
        filters=filters,
        fields=["name", "warehouse_name", "parent_warehouse", "is_group"],
        limit_page_length=20,
    )

    if len(matches) == 1:
        return matches[0]["name"]

    if not matches:
        extra = f"，父仓库={parent_name}" if parent_name else ""
        frappe.throw(f"找不到仓库 warehouse_name={label}{extra}")

    frappe.throw(
        f"warehouse_name={label} 匹配到多个仓库："
        + "、".join(x["name"] for x in matches)
        + "。请先消除歧义。"
    )


def _resolve_a04_warehouse() -> str:
    site = _resolve_warehouse_by_label(SITE_WAREHOUSE_LABEL)
    room = _resolve_warehouse_by_label(ROOM_WAREHOUSE_LABEL, parent_name=site)

    room_doc = frappe.get_doc("Warehouse", room)
    if cint(room_doc.is_group):
        frappe.throw(f"{room} 是 Group Warehouse，不能直接存放库存。")

    return room


def _find_existing_item_by_legacy_code(legacy_code: str) -> Optional[str]:
    if not legacy_code:
        return None
    return frappe.db.get_value(
        "Item",
        {"custom_legacy_item_code": legacy_code},
        "name",
    )


def _new_item_code() -> str:
    """
    使用 Frappe naming series 生成并保留全局 ITM 编号。
    make_autoname 会使用 Series 表，因此不会仅靠扫描现有 Item 猜下一个编号。
    """
    return make_autoname(ITEM_CODE_SERIES)


# ---------------------------------------------------------------------------
# Item 导入
# ---------------------------------------------------------------------------

def _build_description(row: dict) -> str:
    # “详细说明”仍使用 ERPNext 标准 Description；
    # 演出类型 / 节目 / 备注都有单独字段，不再塞进 Description。
    return _clean(row.get("details"))


def _upsert_item(row: dict, update_existing_items: bool) -> Tuple[str, bool]:
    legacy_code = _clean(row.get("item_code"))
    base_item_name = _clean(row.get("item_name"))
    notion_type = _clean(row.get("notion_type"))
    source_uom = _clean(row.get("uom"))
    item_name = _append_source_uom_to_name(base_item_name, source_uom)

    if not legacy_code:
        frappe.throw(f"发现没有旧编号的行：{row}")
    if not base_item_name:
        frappe.throw(f"{legacy_code} 没有物品名称。")
    if notion_type not in TYPE_TO_ITEM_GROUP:
        frappe.throw(f"{legacy_code} 的 notion_type 无法识别：{notion_type}")
    existing_name = _find_existing_item_by_legacy_code(legacy_code)

    values = {
        "item_name": item_name,
        "item_group": TYPE_TO_ITEM_GROUP[notion_type],
        "stock_uom": DEFAULT_STOCK_UOM,
        "is_stock_item": 1,
        "description": _build_description(row),
        "custom_legacy_item_code": legacy_code,
        "custom_performance_type": _clean(row.get("dance_type")),
        "custom_programs_used": _clean(row.get("used_programs")),
        "custom_item_notes": _clean(row.get("notes")),
    }

    if existing_name:
        if not update_existing_items:
            return existing_name, False

        doc = frappe.get_doc("Item", existing_name)
        for fieldname, value in values.items():
            doc.set(fieldname, value)
        doc.save(ignore_permissions=True)
        return doc.name, False

    item_code = _new_item_code()

    doc = frappe.get_doc(
        {
            "doctype": "Item",
            "item_code": item_code,
            **values,
        }
    )
    doc.insert(ignore_permissions=True)
    return doc.name, True


# ---------------------------------------------------------------------------
# 图片
# ---------------------------------------------------------------------------

def _build_file_index(image_dir: str) -> Dict[str, List[str]]:
    if not image_dir or not os.path.isdir(image_dir):
        frappe.throw(f"找不到图片目录：{image_dir}")

    index: Dict[str, List[str]] = defaultdict(list)
    for root, _, files in os.walk(image_dir):
        for fname in files:
            index[fname].append(os.path.join(root, fname))
    return index


def _find_image_path(index: Dict[str, List[str]], filename: str) -> str:
    matches = index.get(filename, [])
    if not matches:
        frappe.throw(f"图片目录中找不到：{filename}")
    if len(matches) > 1:
        frappe.throw(
            f"图片文件名重复，无法确定使用哪一个：{filename}\n"
            + "\n".join(matches)
        )
    return matches[0]


def _get_or_upload_file(item_code: str, image_path: str):
    filename = os.path.basename(image_path)

    existing = frappe.get_all(
        "File",
        filters={
            "attached_to_doctype": "Item",
            "attached_to_name": item_code,
            "file_name": filename,
        },
        fields=["name", "file_url"],
        limit_page_length=1,
    )
    if existing:
        return frappe.get_doc("File", existing[0]["name"])

    with open(image_path, "rb") as f:
        content = f.read()

    return save_file(
        filename,
        content,
        "Item",
        item_code,
        decode=False,
        is_private=0,
    )


def _upload_images(
    manifest_rows: List[dict],
    legacy_to_item: Dict[str, str],
    image_dir: str,
):
    index = _build_file_index(image_dir)

    # 先按旧编号分组，保证所有附件都处理。
    by_legacy: Dict[str, List[dict]] = defaultdict(list)
    for row in manifest_rows:
        by_legacy[_clean(row.get("item_code"))].append(row)

    for legacy_code, rows in by_legacy.items():
        item_code = legacy_to_item.get(legacy_code)
        if not item_code:
            frappe.throw(f"image_manifest 中的 {legacy_code} 没有对应 Item。")

        primary_url = None

        for row in rows:
            filename = _clean(row.get("image_filename"))
            if not filename:
                continue

            path = _find_image_path(index, filename)
            file_doc = _get_or_upload_file(item_code, path)

            if cint(row.get("is_primary")):
                primary_url = file_doc.file_url

        if primary_url:
            item = frappe.get_doc("Item", item_code)
            if item.image != primary_url:
                item.image = primary_url
                item.save(ignore_permissions=True)


# ---------------------------------------------------------------------------
# 开仓库存
# ---------------------------------------------------------------------------

def _get_default_company() -> str:
    company = (
        frappe.defaults.get_user_default("Company")
        or frappe.db.get_single_value("Global Defaults", "default_company")
    )
    if not company:
        frappe.throw(
            "无法确定默认 Company。请给 run() 传 company='你的公司名'。"
        )
    return company


def _create_opening_stock_reconciliation(
    source_rows: List[dict],
    legacy_to_item: Dict[str, str],
    company: Optional[str],
    default_valuation_rate: float,
    submit_opening_stock: bool,
) -> Optional[str]:
    warehouse = _resolve_a04_warehouse()
    company = company or _get_default_company()

    items = []
    for row in source_rows:
        qty = _to_qty(row.get("quantity"))
        if qty == 0:
            continue

        legacy_code = _clean(row.get("item_code"))
        item_code = legacy_to_item[legacy_code]

        items.append(
            {
                "item_code": item_code,
                "warehouse": warehouse,
                "qty": qty,
                "valuation_rate": flt(default_valuation_rate),
                "allow_zero_valuation_rate": 1,
            }
        )

    if not items:
        return None

    temporary_opening_account = frappe.db.get_value(
        "Account",
        {
            "company": company,
            "account_name": "Temporary Opening",
            "is_group": 0,
        },
        "name",
    )

    if not temporary_opening_account:
        frappe.throw(
            f"找不到公司 {company} 的 Temporary Opening 账户。"
        )

    doc = frappe.get_doc(
        {
            "doctype": "Stock Reconciliation",
            "company": company,
            "purpose": "Opening Stock",
            "expense_account": temporary_opening_account,
            "posting_date": nowdate(),
            "items": items,
            "remarks": (
                "Notion 演出用品初始库存导入；"
                f"全部初始数量位于 {SITE_WAREHOUSE_LABEL} / {ROOM_WAREHOUSE_LABEL}。"
            ),
        }
    )
    doc.insert(ignore_permissions=True)

    if submit_opening_stock:
        doc.submit()

    return doc.name


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

@frappe.whitelist()
def run(
    source_csv: str,
    image_manifest_csv: Optional[str] = None,
    image_dir: Optional[str] = None,
    create_opening_stock: int = 0,
    submit_opening_stock: int = 0,
    default_valuation_rate: float = 0,
    company: Optional[str] = None,
    update_existing_items: int = 1,
    dry_run: int = 0,
):
    """
    主导入函数。

    参数
    ----
    source_csv:
        costumes_source_normalized.csv

    image_manifest_csv:
        image_manifest.csv；不传则跳过图片。

    image_dir:
        已解压的 Notion 图片所在目录。脚本会递归查找文件名。

    create_opening_stock:
        1 = 建立 Stock Reconciliation 草稿。
        0 = 不建立。

    submit_opening_stock:
        1 = 创建后自动提交 Stock Reconciliation。
        强烈建议第一次保持 0，人工确认后再提交。

    default_valuation_rate:
        初始估值。默认 0。
        如果你们以后决定对捐赠物资做估值，可在这里传其他值。

    update_existing_items:
        1 = 如果“旧物品编号”已存在则更新 Item。
        0 = 保留现有 Item 不修改。

    dry_run:
        1 = 只验证 CSV / 分类 / UOM / warehouse / 图片文件，
            不写数据库。
    """

    source_rows = _read_csv(source_csv)
    _ensure_required_columns(
        source_rows,
        [
            "item_code",
            "item_name",
            "notion_type",
            "details",
            "dance_type",
            "used_programs",
            "quantity",
            "uom",
            "notes",
        ],
        "source_csv",
    )

    manifest_rows = []
    if image_manifest_csv:
        manifest_rows = _read_csv(image_manifest_csv)
        _ensure_required_columns(
            manifest_rows,
            ["item_code", "image_filename", "is_primary"],
            "image_manifest_csv",
        )

    # CSV 级别验证
    source_legacy_codes = [_clean(r["item_code"]) for r in source_rows]
    if len(source_legacy_codes) != len(set(source_legacy_codes)):
        frappe.throw("source_csv 中旧物品编号有重复。")

    bad_types = sorted(
        {
            _clean(r.get("notion_type"))
            for r in source_rows
            if _clean(r.get("notion_type")) not in TYPE_TO_ITEM_GROUP
        }
    )
    if bad_types:
        frappe.throw("存在未配置的 notion_type：" + "、".join(bad_types))

    # dry-run 也检查 warehouse / 图片目录是否完整。
    if create_opening_stock or dry_run:
        _resolve_a04_warehouse()

    if manifest_rows and image_dir:
        index = _build_file_index(image_dir)
        missing_images = []
        duplicate_images = []
        for row in manifest_rows:
            filename = _clean(row.get("image_filename"))
            matches = index.get(filename, [])
            if len(matches) == 0:
                missing_images.append(filename)
            elif len(matches) > 1:
                duplicate_images.append(filename)

        if missing_images:
            frappe.throw(
                "以下图片在 image_dir 中找不到："
                + "、".join(sorted(set(missing_images)))
            )
        if duplicate_images:
            frappe.throw(
                "以下图片文件名在 image_dir 中重复："
                + "、".join(sorted(set(duplicate_images)))
            )

    if dry_run:
        source_uoms = sorted(
            {_clean(r.get("uom")) for r in source_rows if _clean(r.get("uom"))}
        )
        standard_uom_exists = bool(frappe.db.exists("UOM", DEFAULT_STOCK_UOM))
        standard_uom_allows_fraction = (
            not cint(frappe.db.get_value("UOM", DEFAULT_STOCK_UOM, "must_be_whole_number"))
            if standard_uom_exists
            else None
        )

        result = {
            "status": "dry-run-ok",
            "source_rows": len(source_rows),
            "manifest_rows": len(manifest_rows),
            "item_groups": TYPE_TO_ITEM_GROUP,
            "warehouse": f"{SITE_WAREHOUSE_LABEL} / {ROOM_WAREHOUSE_LABEL}",
            "stock_uom": DEFAULT_STOCK_UOM,
            "stock_uom_exists": standard_uom_exists,
            "stock_uom_allows_fraction": standard_uom_allows_fraction,
            "source_uoms_preserved_in_item_name": source_uoms,
            "note": (
                "正式导入时，如“数量”UOM不存在会自动创建；"
                "如已存在但设置为必须整数，会自动改为允许小数。"
            ),
        }
        frappe.msgprint(frappe.as_json(result, indent=2))
        return result

    # 正式写入
    _ensure_item_groups()
    _ensure_custom_fields()
    _ensure_standard_stock_uom(DEFAULT_STOCK_UOM)

    legacy_to_item: Dict[str, str] = {}
    created = 0
    updated_or_existing = 0

    for row in source_rows:
        item_code, was_created = _upsert_item(
            row, bool(cint(update_existing_items))
        )
        legacy_code = _clean(row.get("item_code"))
        legacy_to_item[legacy_code] = item_code

        if was_created:
            created += 1
        else:
            updated_or_existing += 1

    if manifest_rows:
        if not image_dir:
            frappe.throw("传入了 image_manifest_csv，但没有传 image_dir。")
        _upload_images(manifest_rows, legacy_to_item, image_dir)

    stock_reconciliation = None
    if cint(create_opening_stock):
        stock_reconciliation = _create_opening_stock_reconciliation(
            source_rows=source_rows,
            legacy_to_item=legacy_to_item,
            company=company,
            default_valuation_rate=default_valuation_rate,
            submit_opening_stock=bool(cint(submit_opening_stock)),
        )

    frappe.db.commit()

    result = {
        "status": "ok",
        "source_rows": len(source_rows),
        "created_items": created,
        "updated_or_existing_items": updated_or_existing,
        "uploaded_manifest_rows": len(manifest_rows),
        "stock_reconciliation": stock_reconciliation,
        "stock_reconciliation_submitted": bool(cint(submit_opening_stock))
        if stock_reconciliation
        else False,
        "legacy_to_item": legacy_to_item,
    }

    frappe.msgprint(
        "演出用品导入完成："
        f"新建 {created}，已有/更新 {updated_or_existing}，"
        f"图片记录 {len(manifest_rows)}。"
    )
    return result
