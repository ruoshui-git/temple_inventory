"""Activity reference locks are shared by Desk hooks and native API writes."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe
from frappe.utils import getdate

from temple_inventory.native_access import check_version, require_app

ACTIVITY_FIELDS = ("title", "activity_type", "status", "start_date", "end_date", "description", "notes")
TYPE_SEEDS = (
	("donation", "捐赠"),
	("purchase", "购买"),
	("distribution", "分发"),
	("performance", "节目"),
	("use", "投入使用"),
	("other", "其它"),
)


def lock_reference(doctype, name):
	return frappe.get_doc(doctype, name, for_update=True)


def lock_document_references(doc, method=None):
	"""Serialize every native Link assignment with reference deletion, including Desk.

	This covers additional Link fields created in Desk as well as app-owned fields.
	It does not impose the frontend's audience restriction on ordinary Desk users.
	"""
	references = set()
	for record in [doc, *doc.get_all_children()]:
		for field in record.meta.get_link_fields():
			if field.options in ("Inventory Activity", "Inventory Activity Type"):
				name = record.get(field.fieldname)
				if name:
					references.add((field.options, name))
	for doctype, name in sorted(references):
		lock_reference(doctype, name)


def validate_assignment(doc, method=None):
	name = doc.get("ti_activity")
	if not name:
		return
	# The lock serializes this link with reference deletion for every writer.
	activity = lock_reference("Inventory Activity", name)
	if doc.doctype == "Stock Entry" and any(row.get("ti_original_loan") for row in doc.get("items", [])):
		# A settlement's activity is derived from its original loans, not chosen now;
		# archived or unreadable activities must not block returning the stock.
		return
	activity.check_permission("read")
	previous = doc.get_doc_before_save()
	unchanged = previous and previous.get("ti_activity") == name
	if activity.status != "Active" and not unchanged:
		frappe.throw("活动已归档，请选择其它活动")


def validate_activity(doc):
	doc.title = (doc.title or "").strip()
	if not doc.title:
		frappe.throw("请填写活动名称")
	if doc.status not in ("Active", "Archived"):
		frappe.throw("请选择有效的活动状态")
	if doc.start_date and doc.end_date and getdate(doc.end_date) < getdate(doc.start_date):
		frappe.throw("结束日期不能早于开始日期")
	type_doc = lock_reference("Inventory Activity Type", doc.activity_type)
	type_doc.check_permission("read")
	previous = doc.get_doc_before_save()
	if not type_doc.enabled and (not previous or previous.activity_type != doc.activity_type):
		frappe.throw("活动类型已停用，请选择其它类型")


def guard_reference_deletion(doctype, name):
	"""Include cancelled, hidden and draft references without disclosing their identity.

	Writers lock this same parent before assigning a link. A locking read sees
	committed references after any preceding assignment transaction finishes.
	"""
	lock_reference(doctype, name)
	fields = frappe.get_all(
		"DocField", filters={"fieldtype": "Link", "options": doctype}, fields=["parent", "fieldname"]
	)
	fields += [
		frappe._dict(parent=row.dt, fieldname=row.fieldname)
		for row in frappe.get_all(
			"Custom Field", filters={"fieldtype": "Link", "options": doctype}, fields=["dt", "fieldname"]
		)
	]
	for field in fields:
		if not frappe.db.table_exists(field.parent):
			continue
		table = frappe.qb.DocType(field.parent)
		rows = (
			frappe.qb.from_(table)
			.select(table.name)
			.where(table[field.fieldname] == name)
			.limit(1)
			.for_update()
			.run()
		)
		if rows:
			frappe.throw("已有记录引用此项，不能删除；可将其归档或停用", frappe.LinkExistsError)


def seed_activity_types():
	for order, (key, label) in enumerate(TYPE_SEEDS, 1):
		name = f"TI-TYPE-{key.upper()}"
		if not frappe.db.exists("Inventory Activity Type", name):
			frappe.get_doc(
				{
					"doctype": "Inventory Activity Type",
					"name": name,
					"label": label,
					"enabled": 1,
					"display_order": order,
				}
			).insert(ignore_permissions=True, set_name=name)


def activity_types():
	require_app()
	return frappe.get_list(
		"Inventory Activity Type",
		fields=["name", "label", "enabled", "display_order"],
		order_by="display_order asc, name asc",
		limit_page_length=0,
	)


@frappe.whitelist()
def search_activities(search="", start=0, limit=30):
	"""Return assignable activity options without building activity report projections."""
	require_app()
	search = str(search or "").strip()
	start = max(0, int(start or 0))
	limit = min(100, max(1, int(limit or 30)))
	types = frappe.get_list(
		"Inventory Activity Type",
		filters={"enabled": 1},
		fields=["name", "label"],
		limit_page_length=0,
	)
	type_labels = {row.name: row.label for row in types}
	if not type_labels:
		return {"rows": [], "total": 0, "next": None}
	filters = {"status": "Active", "activity_type": ["in", list(type_labels)]}
	or_filters = None
	if search:
		pattern = f"%{search}%"
		or_filters = [
			["Inventory Activity", field, "like", pattern]
			for field in ("title", "name", "description", "notes", "activity_type")
		]
		or_filters.extend(
			[
				["Inventory Activity", "activity_type", "=", name]
				for name, label in type_labels.items()
				if search.casefold() in label.casefold()
			]
		)
	rows = frappe.get_list(
		"Inventory Activity",
		filters=filters,
		or_filters=or_filters,
		fields=["name", "title", "activity_type", "start_date", "end_date", "modified"],
		order_by="modified desc, name asc",
		limit_start=start,
		limit_page_length=limit + 1,
	)
	more = len(rows) > limit
	rows = rows[:limit]
	return {
		"rows": [
			{
				"name": row.name,
				"title": row.title,
				"type_label": type_labels[row.activity_type],
				"start_date": row.start_date,
				"end_date": row.end_date,
			}
			for row in rows
		],
		"total": start + len(rows) + int(more),
		"next": start + limit if more else None,
	}


@frappe.whitelist()
def activity_label(name):
	require_app()
	doc = frappe.get_doc("Inventory Activity", name)
	doc.check_permission("read")
	return {"name": doc.name, "title": doc.title, "archived": doc.status != "Active"}


@frappe.whitelist(methods=["POST"])
def save_activity(data, name=None, version=None):
	require_app()
	data = frappe.parse_json(data)
	if name:
		doc = lock_reference("Inventory Activity", name)
		doc.check_permission("write")
		check_version(doc, version)
	else:
		doc = frappe.new_doc("Inventory Activity")
		doc.check_permission("create")
	for field in ACTIVITY_FIELDS:
		if field in data:
			doc.set(field, data[field])
	doc.save()
	return doc.as_dict()


@frappe.whitelist()
def load_activity(name):
	from temple_inventory.projections import Projection

	require_app()
	doc = frappe.get_doc("Inventory Activity", name)
	doc.check_permission("read")
	with Projection({"dataset": "activities", "scope": {"activity": name}}) as projection:
		projection.build()
		summary = next(projection.rows("metadata"), {})
		# Lifetime submitted totals are separate from the user's related record
		# filters. A settlement counts for each activity of its original loan lines.
		for row in projection.rows("records"):
			if row["relationship"] in ("direct", "original_loan") and row["docstatus"] == 1:
				projection.put("linked", row)
		if "linked" in projection.column_names:
			projection.group("linked", "movement_totals", ("kind", "stock_uom"), ("stock_qty",))
			movement_totals = list(projection.rows("movement_totals"))
		else:
			movement_totals = []
		projection.group(
			"outcomes",
			"loan_totals",
			("stock_uom",),
			("borrowed", "returned", "damaged", "lost", "outstanding"),
		)
		loan_totals = list(projection.rows("loan_totals"))
		outstanding_line_count = len(
			{row["original_loan_line"] for row in projection.rows("outcomes") if row["outstanding"] > 0}
		)
	return {
		**doc.as_dict(),
		"summary": summary,
		"movement_totals": movement_totals,
		"loan_totals": loan_totals,
		"outstanding_line_count": outstanding_line_count,
	}


@frappe.whitelist(methods=["POST"])
def delete_activity(name, version):
	require_app()
	doc = lock_reference("Inventory Activity", name)
	doc.check_permission("delete")
	check_version(doc, version)
	doc.delete()
	return {"deleted": True}
