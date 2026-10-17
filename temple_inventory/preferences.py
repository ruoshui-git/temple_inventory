"""Per-account UI preferences in Frappe's native user defaults."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import json

import frappe

from temple_inventory.native_access import require_app

DISPLAY_KEY = "temple_inventory_display_v2"
THEMES = {"jade", "blue", "bronze"}
DENSITIES = {"compact", "balanced", "spacious"}
TEXT_SCALES = {100, 125, 150, 175, 200}
DEFAULTS = {"theme": "jade", "density": "balanced", "textScale": 100}


def _valid(values):
	return (
		isinstance(values, dict)
		and isinstance(values.get("theme"), str)
		and values["theme"] in THEMES
		and isinstance(values.get("density"), str)
		and values["density"] in DENSITIES
		and type(values.get("textScale")) is int
		and values["textScale"] in TEXT_SCALES
	)


def display_preferences():
	try:
		values = json.loads(frappe.defaults.get_user_default(DISPLAY_KEY) or "null")
	except TypeError, ValueError:
		values = None
	return {field: values[field] for field in DEFAULTS} if _valid(values) else dict(DEFAULTS)


@frappe.whitelist(methods=["POST"])
def save_display_preferences(theme, density, textScale):
	require_app()
	# Frappe may decode form scalar strings as well as JSON numbers.
	if isinstance(textScale, str) and textScale.isdecimal():
		textScale = int(textScale)
	values = {"theme": theme, "density": density, "textScale": textScale}
	if not _valid(values):
		frappe.throw("请选择有效的主题、密度和文字大小")
	frappe.get_doc("User", frappe.session.user, for_update=True)
	frappe.defaults.set_user_default(DISPLAY_KEY, json.dumps(values))
	return values


VIEWS_KEY = "temple_inventory_report_views_v1"


def _named_views():
	try:
		value = json.loads(frappe.defaults.get_user_default(VIEWS_KEY) or "{}")
	except TypeError, ValueError:
		value = {}
	return value if isinstance(value, dict) else {}


@frappe.whitelist()
def named_views():
	require_app()
	return list(_named_views().values())


@frappe.whitelist(methods=["POST"])
def save_named_view(title, query=None, view_id=None, revision=None):
	from uuid import uuid4

	from temple_inventory.report_query import validate_query

	require_app()
	frappe.get_doc("User", frappe.session.user, for_update=True)
	views = _named_views()
	title = (title or "").strip()
	if not title or len(title) > 140:
		frappe.throw("视图名称不能为空且不能超过 140 个字")
	if any(value["title"] == title and key != view_id for key, value in views.items()):
		frappe.throw("视图名称已存在")
	if view_id:
		if view_id not in views:
			frappe.throw("视图不存在或无权访问", frappe.DoesNotExistError)
		previous = views[view_id]
		if revision != previous["revision"]:
			frappe.throw("视图已被更改，请重新载入", frappe.TimestampMismatchError)
		validated = validate_query(query) if query is not None else previous["query"]
	else:
		if len(views) >= 100:
			frappe.throw("最多保存 100 个视图，请先删除不再使用的视图")
		view_id = str(uuid4())
		previous = {"revision": 0}
		validated = validate_query(query)
	value = {"id": view_id, "title": title, "query": validated, "revision": previous["revision"] + 1}
	views[view_id] = value
	frappe.defaults.set_user_default(VIEWS_KEY, json.dumps(views, ensure_ascii=False))
	return value


@frappe.whitelist(methods=["POST"])
def delete_named_view(view_id, revision):
	require_app()
	frappe.get_doc("User", frappe.session.user, for_update=True)
	views = _named_views()
	if view_id not in views:
		frappe.throw("视图不存在或无权访问", frappe.DoesNotExistError)
	if revision != views[view_id]["revision"]:
		frappe.throw("视图已被更改，请重新载入", frappe.TimestampMismatchError)
	del views[view_id]
	frappe.defaults.set_user_default(VIEWS_KEY, json.dumps(views, ensure_ascii=False))
	return {"deleted": True}
