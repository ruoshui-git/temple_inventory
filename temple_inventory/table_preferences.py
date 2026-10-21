"""Per-user table presentation preferences."""

import json
import re

import frappe

from temple_inventory.native_access import require_app

TABLES_KEY = "temple_inventory_table_columns_v1"
PRESENTATION_KEY = "temple_inventory_browse_presentation_v1"
TABLE_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,119}$")
PREFERENCE_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,119}$")
MAX_TABLES = 100
MAX_COLUMNS = 100
MAX_COLUMN_ID_LENGTH = 100


def _all_preferences():
	try:
		value = json.loads(frappe.defaults.get_user_default(TABLES_KEY) or "{}")
	except TypeError, ValueError:
		value = {}
	return value if isinstance(value, dict) else {}


def _locked_preferences(key):
	"""Read a user's persisted JSON while the User row serializes preference writes."""
	rows = frappe.db.sql(
		"""select defvalue from `tabDefaultValue`
			where parent = %s and defkey = %s for update""",
		(frappe.session.user, key),
		as_dict=True,
	)
	try:
		value = json.loads(rows[0].defvalue or "{}") if rows else {}
	except TypeError, ValueError:
		value = {}
	return value if isinstance(value, dict) else {}


def _all_presentation_preferences():
	try:
		value = json.loads(frappe.defaults.get_user_default(PRESENTATION_KEY) or "{}")
	except TypeError, ValueError:
		value = {}
	return value if isinstance(value, dict) else {}


def _table_id(value):
	value = (value or "").strip()
	if not TABLE_ID.fullmatch(value):
		frappe.throw("表格标识无效")
	return value


def _preference_id(value):
	value = (value or "").strip()
	if not PREFERENCE_ID.fullmatch(value):
		frappe.throw("偏好标识无效")
	return value


def _json_preference(value):
	try:
		encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
	except TypeError, ValueError:
		frappe.throw("偏好值必须是有效的 JSON")
	if len(encoded) > 4096:
		frappe.throw("偏好值超过允许大小")
	return value


def _preference(value):
	if not isinstance(value, dict):
		frappe.throw("列设置格式无效")
	order = value.get("order")
	hidden = value.get("hidden")
	if not isinstance(order, list) or not isinstance(hidden, list):
		frappe.throw("列设置格式无效")
	if len(order) > MAX_COLUMNS or len(hidden) > MAX_COLUMNS:
		frappe.throw("列设置超过允许数量")
	if any(
		not isinstance(item, str) or not item or len(item) > MAX_COLUMN_ID_LENGTH for item in order + hidden
	):
		frappe.throw("列标识无效")
	return {"order": list(dict.fromkeys(order)), "hidden": list(dict.fromkeys(hidden))}


@frappe.whitelist()
def get_column_preferences(table_id):
	require_app()
	table_id = _table_id(table_id)
	return _all_preferences().get(table_id)


@frappe.whitelist(methods=["POST"])
def save_column_preferences(table_id, preference):
	require_app()
	table_id = _table_id(table_id)
	if isinstance(preference, str):
		try:
			preference = json.loads(preference)
		except TypeError, ValueError:
			frappe.throw("列设置格式无效")
	value = _preference(preference)
	frappe.get_doc("User", frappe.session.user, for_update=True)
	preferences = _locked_preferences(TABLES_KEY)
	if table_id not in preferences and len(preferences) >= MAX_TABLES:
		frappe.throw("已达到可保存的表格数量上限")
	preferences[table_id] = value
	frappe.defaults.set_user_default(TABLES_KEY, json.dumps(preferences, ensure_ascii=False))
	return value


@frappe.whitelist()
def get_presentation_preference(preference_id):
	require_app()
	preference_id = _preference_id(preference_id)
	return _all_presentation_preferences().get(preference_id)


@frappe.whitelist(methods=["POST"])
def save_presentation_preference(preference_id, value):
	require_app()
	preference_id = _preference_id(preference_id)
	if isinstance(value, str):
		try:
			value = json.loads(value)
		except TypeError, ValueError:
			frappe.throw("偏好值必须是有效的 JSON")
	value = _json_preference(value)
	frappe.get_doc("User", frappe.session.user, for_update=True)
	preferences = _locked_preferences(PRESENTATION_KEY)
	if preference_id not in preferences and len(preferences) >= MAX_TABLES:
		frappe.throw("已达到可保存的偏好数量上限")
	preferences[preference_id] = value
	frappe.defaults.set_user_default(
		PRESENTATION_KEY, json.dumps(preferences, ensure_ascii=False, allow_nan=False)
	)
	return value
