"""Versioned, permission-scoped native Warehouse location editing."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe
from frappe.utils import cint

from temple_inventory.configuration import POINTERS
from temple_inventory.native_access import check_version, require_app
from temple_inventory.native_topology import (
	_physical_tree,
	_settings,
	_system_warehouse_names,
	_visible_warehouses,
	present_locations,
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


@frappe.whitelist()
def tree():
	settings, visible, physical = _context()
	protected = _protected(settings)
	rows = present_locations(visible, physical_root=settings.physical_root_warehouse, settings=settings)
	for row in rows:
		row["protected"] = row["name"] in protected
		row["can_edit"] = bool(row["can_edit"] and row["name"] in physical and row["name"] not in protected)
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


def _native_name(label, short_label, parent, physical_root, *, direct=False):
	if direct:
		value = f"{parent.warehouse_name} · 直接存放"
	else:
		segment = str(short_label or label).strip()
		prefix = "" if parent.name == physical_root else parent.warehouse_name
		value = f"{prefix} / {segment}" if prefix else segment
	if len(value) > 140:
		frappe.throw("生成的仓库路径超过 140 字，请缩短名称或简称")
	return value


def _cascade_warehouse_names(doc, method=None):
	previous = doc.get_doc_before_save()
	if doc.is_new() or not previous or doc.warehouse_name == previous.warehouse_name:
		return
	physical_root = _settings().physical_root_warehouse
	children = frappe.get_all(
		"Warehouse",
		filters={"company": doc.company},
		fields=[
			"name",
			"parent_warehouse",
			"warehouse_name",
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
			"lft",
		],
		order_by="lft asc",
	)
	warehouse_names = {doc.name: doc.warehouse_name}
	for child in children:
		if child.parent_warehouse not in warehouse_names:
			continue
		parent = frappe._dict(
			name=child.parent_warehouse,
			warehouse_name=warehouse_names.get(child.parent_warehouse, ""),
		)
		value = _native_name(
			child.ti_label,
			child.ti_short_label,
			parent,
			physical_root,
			direct=bool(cint(child.ti_direct_storage)),
		)
		warehouse_names[child.name] = value
		frappe.db.set_value("Warehouse", child.name, "warehouse_name", value, update_modified=False)


def _derive_label(doc):
	if doc.get("ti_label"):
		return
	value = str(doc.get("warehouse_name") or "").strip()
	if doc.get("parent_warehouse"):
		parent = frappe.db.get_value(
			"Warehouse", doc.parent_warehouse, ["warehouse_name", "ti_label", "ti_short_label"], as_dict=True
		)
		parent_name = parent.warehouse_name if parent else ""
		if cint(doc.get("ti_direct_storage")) and parent and value == f"{parent_name} · 直接存放":
			doc.ti_label = parent.ti_label or parent.ti_short_label or parent_name
			if not doc.ti_short_label and parent.ti_short_label:
				doc.ti_short_label = parent.ti_short_label
			return
		prefix = f"{parent_name} / " if parent_name else ""
		if prefix and value.startswith(prefix):
			value = value[len(prefix) :]
	if value.endswith(" · 直接存放"):
		value = value.removesuffix(" · 直接存放").strip()
	doc.ti_label = value


def validate_native_warehouse(doc, method=None):
	"""Keep Desk edits structurally safe and derive native path names."""
	if not frappe.db.exists("DocType", "Temple Inventory Settings"):
		return
	settings = _settings()
	if doc.company == settings.company and settings.physical_root_warehouse:
		if (
			doc.parent_warehouse
			and frappe.db.get_value("Warehouse", doc.parent_warehouse, "company") != doc.company
		):
			frappe.throw("仓库上级必须属于同一公司")
		_derive_label(doc)
		if doc.warehouse_type in ("Area", "Room") and not cint(doc.is_group):
			frappe.throw("区域和房间必须是分组仓库")
		if doc.ti_label:
			parent = frappe.db.get_value(
				"Warehouse", doc.parent_warehouse, ["name", "warehouse_name"], as_dict=True
			)
			if parent:
				doc.warehouse_name = _native_name(
					doc.ti_label,
					doc.ti_short_label,
					parent,
					settings.physical_root_warehouse,
					direct=bool(cint(doc.ti_direct_storage)),
				)
				if frappe.db.exists(
					"Warehouse",
					{
						"company": doc.company,
						"warehouse_name": doc.warehouse_name,
						"name": ["!=", doc.name or ""],
					},
				):
					frappe.throw("生成的仓库路径已存在，请调整名称或简称", frappe.DuplicateEntryError)
	if cint(doc.ti_direct_storage):
		if doc.warehouse_type:
			frappe.throw("直接存放叶子不设置仓库类型")
		parent = frappe.db.get_value(
			"Warehouse",
			doc.parent_warehouse,
			["name", "warehouse_type", "is_group"],
			as_dict=True,
			for_update=True,
		)
		if not parent or not cint(parent.is_group):
			frappe.throw("直接存放位置必须是容器分组下的叶子库位")
		if doc.is_group:
			frappe.throw("直接存放位置必须是叶子库位")
		if parent.warehouse_type not in ("Room", "Shelf"):
			frappe.throw("直接存放位置只能位于房间或细分货位下")
		direct_filters = {"parent_warehouse": doc.parent_warehouse, "ti_direct_storage": 1}
		if not doc.is_new():
			direct_filters["name"] = ["!=", doc.name]
		if frappe.db.exists("Warehouse", direct_filters):
			frappe.throw("同一容器只能有一个直接存放位置")
	previous = doc.get_doc_before_save()
	if not previous:
		return
	if doc.name in _protected(settings) and any(
		doc.get(field) != previous.get(field)
		for field in (
			"warehouse_name",
			"parent_warehouse",
			"warehouse_type",
			"is_group",
			"disabled",
			"company",
			"ti_label",
			"ti_short_label",
			"ti_direct_storage",
		)
	):
		frappe.throw("系统仓库受保护；请通过库存配置中明确核对的指针修复处理", frappe.PermissionError)
	if doc.company != previous.company:
		frappe.throw("库存范围内的仓库不能更改公司")
	if not settings.root_warehouse or previous.company != settings.company:
		return
	root = frappe.db.get_value("Warehouse", settings.root_warehouse, ["lft", "rgt"], as_dict=True)
	if not root or not (root.lft <= previous.lft and previous.rgt <= root.rgt):
		return
	hierarchy_changed = doc.parent_warehouse != previous.parent_warehouse or bool(doc.is_group) != bool(
		previous.is_group
	)
	disabling = bool(doc.disabled) and not previous.disabled
	if not hierarchy_changed and not disabling:
		return
	descendants = frappe.get_all(
		"Warehouse",
		filters={"company": previous.company, "lft": [">=", previous.lft], "rgt": ["<=", previous.rgt]},
		pluck="name",
	)
	if hierarchy_changed:
		if doc.parent_warehouse in descendants:
			frappe.throw("不能将仓库移动到自身或其下级")
		visible = _visible_warehouses(settings)
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


def _check_parent(parent, kind, physical, settings):
	if parent not in physical:
		frappe.throw("请选择有权限的实体范围内上级", frappe.PermissionError)
	parent_doc = frappe.get_doc("Warehouse", parent, for_update=True)
	parent_doc.check_permission("read")
	if parent_doc.disabled or not parent_doc.is_group:
		frappe.throw("请选择启用中的分组仓库作为上级")
	type_ = parent_doc.warehouse_type
	valid = (
		(kind == "Area" and parent == settings.physical_root_warehouse)
		or (kind == "Area" and type_ == "Area")
		or (kind == "Room" and (parent == settings.physical_root_warehouse or type_ == "Area"))
		or (kind == "Shelf" and type_ in ("Room", "Shelf"))
	)
	if not valid:
		frappe.throw("所选上级不能包含此类位置")
	return parent_doc


def _insert_location(kind, label, parent, short_label=None):
	settings, _, physical = _context()
	if kind not in ("Area", "Room", "Shelf"):
		frappe.throw("请选择区域、房间或货位")
	label, short_label = str(label or "").strip(), str(short_label or "").strip()
	if not label or len(label) > 140 or len(short_label) > 60:
		frappe.throw("请填写名称（不超过 140 字）；简称最多 60 字")
	parent_doc = _check_parent(parent, kind, physical, settings)
	if not frappe.has_permission("Warehouse", "create"):
		frappe.throw("无权创建仓库", frappe.PermissionError)

	def insert_node(node_parent, node_kind, group, direct=False):
		doc = frappe.get_doc(
			{
				"doctype": "Warehouse",
				"company": settings.company,
				"parent_warehouse": node_parent.name,
				"warehouse_type": node_kind,
				"is_group": int(group),
				"ti_label": label,
				"ti_short_label": short_label,
				"ti_direct_storage": int(direct),
				"warehouse_name": _native_name(
					label, short_label, node_parent, settings.physical_root_warehouse, direct=direct
				),
			}
		)
		doc.check_permission("create")
		doc.insert()
		return doc

	if kind == "Room":
		owner = insert_node(parent_doc, kind, True)
		insert_node(owner, "", False, direct=True)
		return tree()
	insert_node(parent_doc, kind, kind == "Area")
	return tree()


@frappe.whitelist(methods=["POST"])
def create_location(kind, label, parent, short_label=None):
	return _insert_location(kind, label, parent, short_label)


def _lock_location(name, version, *, allow_system=False):
	settings, _, physical = _context()
	if name not in physical or (not allow_system and name in _protected(settings)):
		frappe.throw("系统仓库受保护，或此位置不在可编辑的实体范围", frappe.PermissionError)
	doc = frappe.get_doc("Warehouse", name, for_update=True)
	doc.check_permission("write")
	check_version(doc, version)
	return settings, physical, doc


@frappe.whitelist(methods=["POST"])
def rename_location(name, label, short_label=None, version=None):
	_, _, doc = _lock_location(name, version)
	label, short_label = str(label or "").strip(), str(short_label or "").strip()
	if not label or len(label) > 140 or len(short_label) > 60:
		frappe.throw("请填写名称（不超过 140 字）；简称最多 60 字")
	doc.ti_label, doc.ti_short_label = label, short_label
	doc.save()
	return tree()


@frappe.whitelist(methods=["POST"])
def move_location(name, parent, version):
	settings, physical, doc = _lock_location(name, version)
	if doc.ti_direct_storage or doc.name == settings.physical_root_warehouse:
		frappe.throw("此位置不能直接移动")
	kind = doc.warehouse_type if doc.warehouse_type in ("Area", "Room", "Shelf") else "Shelf"
	parent_doc = _check_parent(parent, kind, physical, settings)
	if parent_doc.name == doc.name:
		frappe.throw("不能将位置移动到自身")
	descendants = frappe.get_all(
		"Warehouse",
		filters={"company": doc.company, "lft": [">=", doc.lft], "rgt": ["<=", doc.rgt]},
		pluck="name",
	)
	if parent in descendants:
		frappe.throw("不能将位置移动到自身或其下级")
	if any(child not in physical for child in descendants) or _referenced(descendants):
		frappe.throw("此位置或下级已有引用，不能移动")
	doc.parent_warehouse = parent
	doc.save()
	return tree()


@frappe.whitelist(methods=["POST"])
def subdivide_shelf(name, version):
	settings, _, doc = _lock_location(name, version)
	if doc.warehouse_type != "Shelf" or doc.is_group or doc.ti_direct_storage:
		frappe.throw("只有未细分的货位可以细分")
	if frappe.get_all("Warehouse", filters={"parent_warehouse": name}, limit_page_length=1) or _referenced(
		[name]
	):
		frappe.throw("已有库存或原生记录引用此货位，不能细分")
	doc.is_group = 1
	doc.save()
	leaf = frappe.get_doc(
		{
			"doctype": "Warehouse",
			"company": settings.company,
			"parent_warehouse": doc.name,
			"warehouse_type": "",
			"is_group": 0,
			"ti_label": doc.ti_label,
			"ti_short_label": doc.ti_short_label,
			"ti_direct_storage": 1,
			"warehouse_name": _native_name(
				doc.ti_label, doc.ti_short_label, doc, settings.physical_root_warehouse, direct=True
			),
		}
	)
	leaf.check_permission("create")
	leaf.insert()
	return tree()


@frappe.whitelist(methods=["POST"])
def set_disabled(name, disabled, version):
	if type(disabled) is not bool:
		frappe.throw("请选择有效的启停状态")
	_, _, doc = _lock_location(name, version)
	doc.disabled = int(disabled)
	doc.save()
	return tree()


@frappe.whitelist(methods=["POST"])
def repair_direct_storage(name, version):
	settings, _, doc = _lock_location(name, version)
	if not doc.is_group or doc.warehouse_type not in ("Room", "Shelf"):
		frappe.throw("只有房间或已细分货位可以补建直接存放位置")
	if frappe.db.exists("Warehouse", {"parent_warehouse": name, "ti_direct_storage": 1}):
		frappe.throw("直接存放位置已存在")
	leaf = frappe.get_doc(
		{
			"doctype": "Warehouse",
			"company": settings.company,
			"parent_warehouse": doc.name,
			"warehouse_type": "",
			"is_group": 0,
			"ti_label": doc.ti_label,
			"ti_short_label": doc.ti_short_label,
			"ti_direct_storage": 1,
			"warehouse_name": _native_name(
				doc.ti_label, doc.ti_short_label, doc, settings.physical_root_warehouse, direct=True
			),
		}
	)
	leaf.check_permission("create")
	leaf.insert()
	return tree()
