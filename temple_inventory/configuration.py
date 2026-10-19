"""Explicit native setup and configuration-reference repair, without stock movement."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import hashlib

import frappe

from temple_inventory.native_access import erpnext_installed, require_frontend_account

POINTERS = {
	"root_warehouse": ("寺院仓库根目录", True),
	"physical_root_warehouse": ("实体仓库根目录", True),
	"leased_warehouse": ("借出库位", False),
	"damaged_warehouse": ("损坏库位", False),
}


def _settings(*, write=False, lock=False):
	require_frontend_account()
	if not erpnext_installed():
		frappe.throw("需要先安装 ERPNext")
	if lock:
		# The native singleton may have no stored values yet. Lock its existing
		# DocType row too, so first-time setup is serialized across accounts.
		frappe.db.sql("select name from `tabDocType` where name=%s for update", "Temple Inventory Settings")
		frappe.db.sql(
			"select field from `tabSingles` where doctype=%s for update", "Temple Inventory Settings"
		)
	settings = frappe.get_doc("Temple Inventory Settings")
	settings.check_permission("write" if write else "read")
	return settings


def _digest(value):
	return hashlib.sha256(frappe.as_json(value).encode()).hexdigest()


def _version(settings):
	return _digest({key: settings.get(key) for key in ("modified", "company", *POINTERS)})


def _check_version(settings, version):
	if not version or _version(settings) != version:
		frappe.throw("配置已更改，请重新检查后核对", frappe.TimestampMismatchError)


def _company(company):
	if not company:
		frappe.throw("请选择公司")
	doc = frappe.get_doc("Company", company)
	doc.check_permission("read")
	return doc.name


def _rows(company):
	return frappe.get_list(
		"Warehouse",
		filters={"company": company},
		fields=[
			"name",
			"warehouse_name",
			"parent_warehouse",
			"warehouse_type",
			"is_group",
			"lft",
			"rgt",
			"modified",
			"disabled",
		],
		order_by="lft",
		limit_page_length=0,
	)


def _inside(row, root):
	return bool(row and root and row.lft > root.lft and row.rgt < root.rgt)


@frappe.whitelist()
def status():
	settings = _settings()
	companies = frappe.get_list("Company", pluck="name", limit_page_length=0)
	company = settings.company or (companies[0] if len(companies) == 1 else "")
	if company:
		_company(company)
	rows = _rows(company) if company else []
	visible = {row.name: row for row in rows}
	blockers, pointers, configured = [], [], {}
	if not company:
		blockers.append({"code": "company", "message": "请选择公司；如尚无公司，请先在 ERPNext 创建"})
	for field, (label, group) in POINTERS.items():
		name = settings.get(field) or ""
		row = visible.get(name)
		issue = ""
		if not name or not frappe.db.exists("Warehouse", name):
			issue = "missing"
		elif not row:
			# A different Company is also outside this setup's authority.
			issue = "inaccessible"
		elif row.disabled:
			issue = "disabled"
		elif bool(row.is_group) != group:
			issue = "group" if group else "leaf"
		else:
			configured[field] = row
		if issue:
			blockers.append(
				{
					"code": field + ":" + issue,
					"message": f"{label}："
					+ {
						"missing": "尚未配置或原仓库已不存在",
						"inaccessible": "已配置仓库不属于当前可读公司范围，请核对授权",
						"group": "必须是分组仓库",
						"leaf": "必须是实际存放库存的叶子库位",
						"disabled": "已配置仓库被停用，请核对后重新启用或修复引用",
					}[issue],
				}
			)
		pointers.append({"field": field, "label": label, "current": name, "issue": issue})
	root = configured.get("root_warehouse")
	for field in ("physical_root_warehouse", "leased_warehouse", "damaged_warehouse"):
		if field in configured and root and not _inside(configured[field], root):
			blockers.append(
				{"code": field + ":outside", "message": POINTERS[field][0] + "不在寺院仓库根目录下"}
			)
	physical, leased = configured.get("physical_root_warehouse"), configured.get("leased_warehouse")
	if (
		physical
		and leased
		and (physical.name == leased.name or _inside(physical, leased) or _inside(leased, physical))
	):
		blockers.append({"code": "overlap", "message": "实体仓库与借出库位必须分开"})
	if leased and root and leased.parent_warehouse != root.name:
		blockers.append({"code": "lease_leaf", "message": "借出库位必须位于寺院仓库根目录下"})
	damaged = configured.get("damaged_warehouse")
	if damaged and physical and _inside(damaged, physical):
		blockers.append({"code": "damaged_physical", "message": "损坏库位不能位于实体仓库分组内"})
	leaves = [row for row in rows if not row.is_group and not row.disabled and _inside(row, physical)]
	if physical and not leaves:
		blockers.append({"code": "physical_leaf", "message": "实体仓库内还没有启用且可读取的叶子库位"})
	if not frappe.has_permission("Stock Entry", "read"):
		blockers.append({"code": "stock_permission", "message": "当前账户缺少库存记录读取权限"})
	return {
		"version": _version(settings),
		"ready": not blockers,
		"setup_required": bool(blockers),
		"is_manager": True,
		"companies": companies,
		"selected_company": company,
		"can_initialize": bool(
			companies
			and not any(settings.get(field) for field in POINTERS)
			and frappe.has_permission("Warehouse", "create")
			and settings.has_permission("write")
		),
		"blockers": blockers,
		"warnings": [],
		"pointers": pointers,
		"candidates": [
			{
				"value": row.name,
				"label": row.warehouse_name,
				"group": bool(row.is_group),
				"parent": row.parent_warehouse,
				"type": row.warehouse_type or "",
				"version": str(row.modified),
			}
			for row in rows
		],
	}


@frappe.whitelist(methods=["POST"])
def initialize(company, version):
	settings = _settings(write=True, lock=True)
	_check_version(settings, version)
	company = _company(company)
	if settings.company and settings.company != company:
		frappe.throw("已配置的公司不能通过初始化替换")
	if any(settings.get(field) for field in POINTERS):
		frappe.throw("已有仓库引用，请逐项核对与修复；不能重新初始化")
	for name in ("Room", "Location"):
		if not frappe.db.exists("Warehouse Type", name):
			frappe.get_doc({"doctype": "Warehouse Type", "name": name}).insert()

	def create(label, parent=None, group=False, kind="Location"):
		return (
			frappe.get_doc(
				{
					"doctype": "Warehouse",
					"warehouse_name": label,
					"company": company,
					"parent_warehouse": parent,
					"is_group": int(group),
					"warehouse_type": kind,
				}
			)
			.insert()
			.name
		)

	root = create("寺院仓库", group=True)
	physical = create("实体库房", root, True)
	leaf = create("通用库房", physical, kind="Room")
	lease_leaf = create("借出", root)
	damaged = create("损坏待处理", root)
	settings.update(
		{
			"company": company,
			"root_warehouse": root,
			"physical_root_warehouse": physical,
			"leased_warehouse": lease_leaf,
			"damaged_warehouse": damaged,
		}
	)
	settings.set("allowed_warehouses", [{"warehouse": name} for name in (leaf, lease_leaf, damaged)])
	settings.save()
	return status()


@frappe.whitelist()
def repair_preview(field, warehouse):
	settings = _settings()
	if field not in POINTERS:
		frappe.throw("请选择有效的配置引用")
	company = _company(settings.company)
	doc = frappe.get_doc("Warehouse", warehouse)
	doc.check_permission("read")
	if doc.company != company or bool(doc.is_group) != POINTERS[field][1] or doc.disabled:
		frappe.throw("替代仓库的公司、分组或启用状态不符合配置要求")
	rows = _rows(company)
	children = [row for row in rows if row.name == doc.name or _inside(row, doc)]
	value = {
		"field": field,
		"label": POINTERS[field][0],
		"current": settings.get(field) or "",
		"replacement": doc.name,
		"version": _version(settings),
		"warehouse_version": str(doc.modified),
		"visible_nodes": len(children),
		"visible_leaves": sum(not row.is_group for row in children),
		"affected_references": [
			{"field": key, "warehouse": settings.get(key) or ""} for key in POINTERS if key != field
		],
		"impact": "仅修改此配置引用。现有仓库的上级、类型、库存数量及所有原生单据保持原样；新范围可能使部分库存暂不可操作，请继续核对其它配置。",
	}
	value["fingerprint"] = _digest({**value, "tree": [dict(row) for row in children]})
	return value


@frappe.whitelist(methods=["POST"])
def repair_pointer(field, warehouse, version, fingerprint, confirmed=False):
	settings = _settings(write=True, lock=True)
	_check_version(settings, version)
	if confirmed is not True:
		frappe.throw("请查看当前引用、替代节点与影响后明确确认")
	frappe.get_doc("Warehouse", warehouse, for_update=True).check_permission("read")
	preview = repair_preview(field, warehouse)
	if fingerprint != preview["fingerprint"]:
		frappe.throw("配置或仓库结构已更改，请重新查看修复影响", frappe.TimestampMismatchError)
	settings.set(field, warehouse)
	# Other pointers may already be broken. Validate and write this reviewed
	# native reference only, so repairing one never rewrites unrelated settings
	# or fails merely because the next pointer still needs its own review.
	settings.db_set(field, warehouse)
	return status()
