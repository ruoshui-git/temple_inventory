"""Versioned, permission-scoped native Warehouse metadata and hierarchy editing."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe

from temple_inventory.configuration import POINTERS
from temple_inventory.native_access import check_version, require_app
from temple_inventory.native_topology import (
	_physical_tree,
	_settings,
	_system_warehouse_names,
	_visible_warehouses,
)


def _context():
	require_app()
	settings = _settings()
	visible = _visible_warehouses(settings)
	for field in ("root_warehouse", "physical_root_warehouse"):
		if settings.get(field) not in visible:
			frappe.throw("已配置的仓库根目录不存在或无权读取，请检查配置与授权", frappe.PermissionError)
	physical = _physical_tree(settings)
	physical[settings.physical_root_warehouse] = visible[settings.physical_root_warehouse]
	return settings, visible, physical


def _protected(settings):
	return _system_warehouse_names(settings) | {
		settings.get(field) for field in POINTERS if settings.get(field)
	}


def _metadata(doc, physical, protected):
	return {
		"name": doc.name,
		"label": "无货位" if doc.get("ti_room_default") else doc.warehouse_name,
		"parent": doc.parent_warehouse or "",
		"type": doc.warehouse_type or "",
		"room_default": bool(doc.get("ti_room_default")),
		"is_group": bool(doc.is_group),
		"disabled": bool(doc.disabled),
		"version": str(doc.modified),
		"lft": doc.lft,
		"rgt": doc.rgt,
		"protected": doc.name in protected,
		"can_edit": bool(doc.name in physical and doc.name not in protected and doc.has_permission("write")),
	}


@frappe.whitelist()
def tree():
	settings, visible, physical = _context()
	protected = _protected(settings)
	rows = [_metadata(frappe.get_doc("Warehouse", name), physical, protected) for name in visible]
	return {
		"rows": rows,
		"physical_root": settings.physical_root_warehouse,
		"can_create": bool(frappe.has_permission("Warehouse", "create")),
		"company": settings.company,
	}


def _referenced(names):
	values = ["in", sorted(names)]
	return any(
		frappe.db.get_value(doctype, filters, "name", for_update=True)
		for doctype, filters in (
			("Stock Ledger Entry", {"warehouse": values}),
			("Bin", {"warehouse": values, "actual_qty": ["!=", 0]}),
			("Stock Entry Detail", {"s_warehouse": values}),
			("Stock Entry Detail", {"t_warehouse": values}),
			("Stock Reconciliation Item", {"warehouse": values}),
		)
	)


def _validate_existing(doc, previous, settings, visible):
	fields = (
		"warehouse_name",
		"parent_warehouse",
		"warehouse_type",
		"is_group",
		"disabled",
		"company",
		"ti_room_default",
	)
	if doc.name in _protected(settings) and any(doc.get(field) != previous.get(field) for field in fields):
		frappe.throw("系统仓库受保护；请通过库存配置中明确核对的指针修复处理", frappe.PermissionError)
	if doc.company != previous.company:
		frappe.throw("库存范围内的仓库不能更改公司")
	hierarchy_changed = doc.parent_warehouse != previous.parent_warehouse or bool(doc.is_group) != bool(
		previous.is_group
	)
	disabling = bool(doc.disabled) and not previous.disabled
	if (
		previous.warehouse_type == "Room"
		and doc.warehouse_type != "Room"
		and frappe.db.exists("Warehouse", {"parent_warehouse": doc.name, "ti_room_default": 1})
	):
		frappe.throw("房间下仍有默认存放位置，不能更改仓库类型")
	if not hierarchy_changed and not disabling:
		return
	# Use the persisted tree, including hidden children, before NestedSet updates.
	descendants = frappe.get_all(
		"Warehouse",
		filters={"company": previous.company, "lft": [">=", previous.lft], "rgt": ["<=", previous.rgt]},
		pluck="name",
	)
	if hierarchy_changed:
		if doc.parent_warehouse in descendants:
			frappe.throw("不能将仓库移动到自身或其下级")
		if any(child not in visible for child in descendants):
			frappe.throw("此分组包含无权操作的下级，不能更改层级", frappe.PermissionError)
		for child in sorted(descendants):
			frappe.get_doc("Warehouse", child, for_update=True).check_permission("write")
		if _referenced(descendants):
			frappe.throw("此仓库或下级已有库存或原生单据；请保留现有层级，另建所需节点")
		if not doc.is_group and len(descendants) > 1:
			frappe.throw("仍有下级节点，不能改为叶子库位")
	if disabling and frappe.db.get_value(
		"Bin", {"warehouse": ["in", descendants], "actual_qty": ["!=", 0]}, "name", for_update=True
	):
		frappe.throw("仓库或下级仍有库存，不能停用")


def validate_native_warehouse(doc, method=None):
	"""The configured inventory tree obeys the same rules in Desk and the app.

	Do not apply the frontend's System Manager audience to unrelated native Desk
	workflows. Ordinary Warehouse permissions still govern every touched descendant.
	"""
	if doc.get("ti_room_default"):
		frappe.db.get_value("Warehouse", doc.parent_warehouse, "name", for_update=True)
		parent = frappe.db.get_value(
			"Warehouse", doc.parent_warehouse, ["warehouse_type", "is_group"], as_dict=True
		)
		if not parent or parent.warehouse_type != "Room" or not parent.is_group or doc.is_group:
			frappe.throw("默认存放位置必须是房间分组下的叶子库位")
		if frappe.db.exists(
			"Warehouse",
			{"parent_warehouse": doc.parent_warehouse, "ti_room_default": 1, "name": ["!=", doc.name or ""]},
		):
			frappe.throw("同一房间只能设置一个默认存放位置")
	previous = doc.get_doc_before_save()
	if not previous:
		return
	settings = _settings()
	if not settings.company or not settings.root_warehouse or previous.company != settings.company:
		return
	root = frappe.db.get_value("Warehouse", settings.root_warehouse, ["lft", "rgt"], as_dict=True)
	if not root or not (root.lft <= previous.lft and previous.rgt <= root.rgt):
		return
	frappe.db.get_value("Warehouse", doc.name, "name", for_update=True)
	_validate_existing(doc, previous, settings, _visible_warehouses(settings))


@frappe.whitelist(methods=["POST"])
def save_warehouse(
	label,
	parent,
	warehouse_type="Room",
	is_group=False,
	name=None,
	version=None,
	disabled=False,
	room_default=False,
):
	settings, _visible, physical = _context()
	label = str(label or "").strip()
	if not label or len(label) > 140:
		frappe.throw("请填写不超过 140 字的仓库名称")
	if warehouse_type not in ("Room", "Location"):
		frappe.throw("请选择 Room（房间）或 Location（位置）；类型不由层级决定")
	if type(is_group) is not bool or type(disabled) is not bool or type(room_default) is not bool:
		frappe.throw("请选择有效的分组与启用状态")
	if parent not in physical or not physical[parent].is_group:
		frappe.throw("请选择有权限的实体分组作为上级", frappe.PermissionError)
	parent_doc = frappe.get_doc("Warehouse", parent, for_update=True)
	parent_doc.check_permission("read")
	if parent_doc.disabled:
		frappe.throw("所选上级仓库已停用")
	if room_default and (is_group or parent_doc.warehouse_type != "Room"):
		frappe.throw("默认存放位置必须是房间分组下的叶子库位")
	if name:
		if name not in physical or name in _protected(settings):
			frappe.throw("系统仓库受保护，或此仓库不在可编辑的实体范围", frappe.PermissionError)
		doc = frappe.get_doc("Warehouse", name, for_update=True)
		doc.check_permission("write")
		check_version(doc, version)
	else:
		doc = frappe.get_doc({"doctype": "Warehouse", "company": settings.company})
		doc.check_permission("create")
	if (
		name
		and doc.warehouse_type == "Room"
		and warehouse_type != "Room"
		and frappe.db.exists("Warehouse", {"parent_warehouse": name, "ti_room_default": 1})
	):
		frappe.throw("房间下仍有默认存放位置，不能更改仓库类型")
	if frappe.db.exists(
		"Warehouse",
		{
			"company": settings.company,
			"parent_warehouse": parent,
			"warehouse_name": label,
			"name": ["!=", name or ""],
		},
	):
		frappe.throw("同一上级内已存在此名称", frappe.DuplicateEntryError)
	if room_default and frappe.db.exists(
		"Warehouse",
		{"parent_warehouse": parent, "ti_room_default": 1, "name": ["!=", name or ""]},
	):
		frappe.throw("同一房间只能设置一个默认存放位置")
	native_label = label
	if not name and room_default:
		native_label = f"{parent_doc.warehouse_name} / {label}"
		if frappe.db.exists("Warehouse", {"company": settings.company, "warehouse_name": native_label}):
			native_label = f"{parent_doc.name} / {label}"
			base_label = native_label
			suffix = 2
			while frappe.db.exists(
				"Warehouse", {"company": settings.company, "warehouse_name": native_label}
			):
				native_label = f"{base_label} ({suffix})"
				suffix += 1
	doc.update(
		{
			"warehouse_name": native_label,
			"parent_warehouse": parent,
			"warehouse_type": warehouse_type,
			"is_group": int(is_group),
			"disabled": int(disabled),
			"ti_room_default": int(room_default),
		}
	)
	doc.save()
	return _metadata(doc, {**physical, doc.name: doc}, _protected(settings))
