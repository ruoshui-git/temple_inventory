"""Inventory notifications, preferences, inbox and daily expiry digest."""

import json
from decimal import Decimal

import frappe
from frappe.utils import nowdate

from temple_inventory.native_access import require_app
from temple_inventory.native_stock import MOVEMENT_LABELS, MOVEMENT_PURPOSES
from temple_inventory.uom_labels import uom_label

TYPES = ("库存流动", "流动撤销", "盘点调整", "导出完成", "效期提醒")
KEY = "temple_inventory_notifications_v1"
EVENTS = ("movement_submitted", "movement_cancelled", "count_adjustment", "export_result", "expiry_digest")
KINDS = tuple(MOVEMENT_PURPOSES)
ITEM_NAME_LIMIT = 24
DEFAULTS = {
	"enabled": True,
	**{event: event != "expiry_digest" for event in EVENTS},
	"movement_kinds": dict.fromkeys(KINDS, True),
}


def _prefs(user=None):
	user = user or frappe.session.user
	try:
		value = json.loads(frappe.defaults.get_user_default(KEY, user=user) or "null")
	except (TypeError, ValueError):
		value = None
	if not isinstance(value, dict):
		return json.loads(json.dumps(DEFAULTS))
	result = json.loads(json.dumps(DEFAULTS))
	for key in ("enabled", *EVENTS):
		if type(value.get(key)) is bool:
			result[key] = value[key]
	if isinstance(value.get("movement_kinds"), dict):
		for kind in KINDS:
			if type(value["movement_kinds"].get(kind)) is bool:
				result["movement_kinds"][kind] = value["movement_kinds"][kind]
	return result


@frappe.whitelist()
def get_preferences():
	require_app()
	return _prefs()


@frappe.whitelist(methods=["POST"])
def save_preferences(preferences):
	require_app()
	value = frappe.parse_json(preferences)
	if not isinstance(value, dict) or set(value) - {"enabled", *EVENTS, "movement_kinds"}:
		frappe.throw("通知设置无效")
	if any(type(value.get(key)) is not bool for key in ("enabled", *EVENTS)):
		frappe.throw("通知设置无效")
	kinds = value.get("movement_kinds")
	if (
		not isinstance(kinds, dict)
		or set(kinds) - set(KINDS)
		or any(type(v) is not bool for v in kinds.values())
	):
		frappe.throw("通知设置无效")
	result = _prefs()
	result.update({key: value[key] for key in ("enabled", *EVENTS)})
	result["movement_kinds"].update(kinds)
	frappe.get_doc("User", frappe.session.user, for_update=True)
	frappe.defaults.set_user_default(KEY, json.dumps(result), user=frappe.session.user)
	return result


def _user_allowed(user, event, kind=None):
	user_row = frappe.db.get_value("User", user, ["enabled", "user_type"], as_dict=True)
	if not user_row or not user_row.enabled or user_row.user_type != "System User":
		return False
	roles = set(frappe.get_roles(user))
	prefs = _prefs(user)
	if "System Manager" not in roles or not prefs["enabled"] or not prefs[event]:
		return False
	if kind and not prefs["movement_kinds"].get(kind, False):
		return False
	settings = frappe.db.get_value("Notification Settings", user, "enabled")
	return settings is None or bool(settings)


def _subject(doc, event, amended=None):
	actor = frappe.db.get_value("User", frappe.session.user, "full_name") or frappe.session.user
	if doc.doctype == "Stock Entry":
		kind = doc.get("ti_movement_kind")
		label = MOVEMENT_LABELS.get(kind, "流动")
		if event == "movement_cancelled":
			verb = "修改了" if (doc.get("amended_from") if amended is None else amended) else "撤销了"
			return f"{actor} {verb}{label} {doc.name}"
		location = _primary_location(doc, kind)
		location_text = f" · {location}" if location else ""
		return f"{actor} {label} {_item_summary(doc.get('items') or [])}{location_text}"
	differences = sum(
		1
		for row in doc.get("items") or []
		if row.get("current_qty") is not None
		and row.get("qty") is not None
		and Decimal(str(row.get("current_qty"))) != Decimal(str(row.get("qty")))
	)
	return f"{actor} 提交盘点调整 · {differences} 处差异"


def _item_summary(lines):
	"""Match the frontend summary: the first Item name, then `等 N 种物品` for several Items."""
	names = {}
	for row in lines:
		code = row.get("item_code")
		if code and code not in names:
			names[code] = str(row.get("item_name") or code).strip()
	if not names:
		return "0 种物品"
	first = next(iter(names.values()))
	if len(first) > ITEM_NAME_LIMIT:
		first = f"{first[: ITEM_NAME_LIMIT - 1]}…"
	return first if len(names) == 1 else f"{first} 等 {len(names)} 种物品"


def _primary_location(doc, kind):
	from temple_inventory.native_stock import warehouse_scopes
	from temple_inventory.native_topology import present_locations

	settings, visible, *_ = warehouse_scopes()
	labels = {
		row["name"]: row["label"]
		for row in present_locations(
			visible, physical_root=settings.physical_root_warehouse, settings=settings
		)
	}
	lines = doc.get("items") or []
	if kind == "Receive":
		names = {row.get("t_warehouse") for row in lines if row.get("t_warehouse")}
	elif kind in ("Issue", "Loss", "Damage", "Disposal"):
		names = {row.get("s_warehouse") for row in lines if row.get("s_warehouse")}
	else:
		sources = {row.get("s_warehouse") for row in lines if row.get("s_warehouse")}
		destinations = {row.get("t_warehouse") for row in lines if row.get("t_warehouse")}
		if kind == "Transfer" and len(sources) == len(destinations) == 1:
			source = labels.get(next(iter(sources)), "")
			destination = labels.get(next(iter(destinations)), "")
			return f"{source} → {destination}" if source and destination else ""
		names = sources | destinations
	known = {name for name in names if name in labels}
	if len(known) == 1:
		return labels[next(iter(known))]
	if len(known) > 1:
		return f"{len(known)} 个位置"
	return ""


def _create(user, type_name, subject, doctype, name, url, structured=None, read=0, from_user=None):
	def with_unit_labels(value):
		if isinstance(value, list):
			return [with_unit_labels(item) for item in value]
		if not isinstance(value, dict):
			return value
		result = {key: with_unit_labels(item) for key, item in value.items()}
		for field in ("stock_uom", "entered_uom", "uom"):
			if result.get(field):
				result[f"{field}_label"] = uom_label(result[field])
		return result

	filters = {
		"for_user": user,
		"type": type_name,
		"document_type": doctype,
		"document_name": name,
		"subject": subject,
	}
	existing = frappe.db.get_value("Notification Log", filters, "name")
	if existing:
		if read:
			frappe.db.set_value("Notification Log", existing, "read", 1)
		return existing
	return (
		frappe.get_doc(
			{
				"doctype": "Notification Log",
				"app": "temple_inventory",
				"for_user": user,
				"from_user": from_user or frappe.session.user,
				"type": type_name,
				"title": subject,
				"subject": subject,
				"document_type": doctype or None,
				"document_name": name or None,
				"link": url,
				"email_content": json.dumps(with_unit_labels(structured or {}), ensure_ascii=False),
				"read": read,
			}
		)
		.insert(ignore_permissions=True)
		.name
	)


def enqueue(method, **kwargs):
	"""Queue notification work without ever failing the stock document that triggered it."""
	if frappe.flags.ti_suppress_notifications:
		return
	try:
		frappe.enqueue(method, enqueue_after_commit=True, **kwargs)
	except Exception:
		frappe.log_error(title="Inventory notification not queued", message=frappe.get_traceback())


def enqueue_document_event(doc, method=None):
	if doc.doctype == "Stock Entry" and not doc.get("ti_movement_kind"):
		return
	event = (
		"movement_cancelled"
		if method == "on_cancel" or doc.get("amended_from")
		else "count_adjustment"
		if doc.doctype == "Stock Reconciliation"
		else "movement_submitted"
	)
	enqueue(
		"temple_inventory.notifications.deliver_document_event",
		doctype=doc.doctype,
		name=doc.name,
		# `event` is a reserved frappe.enqueue parameter and would never reach the job.
		notification_event=event,
		amended=bool(method != "on_cancel" and doc.get("amended_from")),
		actor=frappe.session.user,
	)


def deliver_document_event(doctype, name, notification_event, actor, amended=False):
	event = notification_event
	doc = frappe.get_doc(doctype, name)
	original = frappe.session.user
	try:
		frappe.set_user(actor)
		subject = _subject(doc, event, amended=amended)
		kind = doc.get("ti_movement_kind")
		type_name = (
			"盘点调整"
			if event == "count_adjustment"
			else "流动撤销"
			if event == "movement_cancelled"
			else "库存流动"
		)
		url = f"/inventory/{'counts' if doctype == 'Stock Reconciliation' else 'movements'}/{name}"
		for user in frappe.get_all("User", filters={"enabled": 1, "user_type": "System User"}, pluck="name"):
			if user == actor or not _user_allowed(
				user, event, kind if event == "movement_submitted" else None
			):
				continue
			frappe.set_user(user)
			try:
				if frappe.has_permission(doc, "read", user=user):
					_create(
						user,
						type_name,
						subject,
						doctype,
						name,
						url,
						{
							"kind": kind,
							"item_count": len(
								{
									row.get("item_code")
									for row in doc.get("items") or []
									if row.get("item_code")
								}
							),
							"primary_location": _primary_location(doc, kind),
						},
						from_user=actor,
					)
			except (frappe.PermissionError, frappe.DoesNotExistError):
				pass
	finally:
		frappe.set_user(original)


def _app_types():
	return list(TYPES)


@frappe.whitelist()
def inbox(page=1, page_size=30, unread_only=False):
	require_app()
	page, page_size = max(1, int(page)), min(100, max(1, int(page_size)))
	filters = {"for_user": frappe.session.user, "type": ["in", _app_types()]}
	if frappe.utils.cint(unread_only):
		filters["read"] = 0
	rows = frappe.get_all(
		"Notification Log",
		filters=filters,
		fields=[
			"name",
			"type",
			"subject",
			"document_type",
			"document_name",
			"link",
			"read",
			"creation",
			"email_content",
		],
		order_by="creation desc",
		start=(page - 1) * page_size,
		page_length=page_size,
	)
	for row in rows:
		if row.type == "导出完成" and row.document_type == "Inventory Export Request":
			output_file = frappe.db.get_value("Inventory Export Request", row.document_name, "output_file")
			row.unavailable = not output_file or not frappe.db.exists("File", output_file)
	return {
		"items": rows,
		"unread_count": unread_count(),
		"has_running_exports": bool(
			frappe.db.exists(
				"Inventory Export Request",
				{"owner": frappe.session.user, "status": ["in", ["Queued", "Running"]]},
			)
		),
	}


@frappe.whitelist()
def unread_count():
	require_app()
	return frappe.db.count(
		"Notification Log", {"for_user": frappe.session.user, "type": ["in", _app_types()], "read": 0}
	)


@frappe.whitelist(methods=["POST"])
def mark_read(names):
	require_app()
	names = frappe.parse_json(names)
	if not isinstance(names, list):
		frappe.throw("通知列表无效")
	frappe.db.set_value(
		"Notification Log",
		{"name": ["in", names], "for_user": frappe.session.user, "type": ["in", _app_types()]},
		"read",
		1,
	)
	return {"updated": True}


@frappe.whitelist(methods=["POST"])
def mark_all_read():
	require_app()
	frappe.db.set_value(
		"Notification Log",
		{"for_user": frappe.session.user, "type": ["in", _app_types()], "read": 0},
		"read",
		1,
	)
	return {"updated": True}


def register_types():
	for type_name in TYPES:
		if frappe.db.exists("Notification Type", type_name):
			frappe.db.set_value("Notification Type", type_name, "enabled", 1, update_modified=False)
		else:
			frappe.get_doc({"doctype": "Notification Type", "type_name": type_name, "enabled": 1}).insert(
				ignore_permissions=True
			)


def export_result(request, watched=False):
	"""Notify the requester; a notification failure never changes the export outcome."""
	try:
		_export_result(request, watched)
	except Exception:
		frappe.log_error(title="Inventory export notification failed", message=frappe.get_traceback())


def _export_result(request, watched):
	from temple_inventory.projections import TABLE_LABELS

	labels = [TABLE_LABELS.get(name, name) for name in json.loads(request.tables_json or "[]")]
	state = "已完成" if request.status == "Completed" else "失败"
	subject = f"导出{state} · {'、'.join(labels[:2])} · {request.row_count or 0} 行"
	url = (
		f"/api/method/temple_inventory.exports.download_export?name={request.name}"
		if request.status == "Completed"
		else "/inventory/reports"
	)
	_create(
		request.owner,
		"导出完成",
		subject,
		"Inventory Export Request",
		request.name,
		url,
		{
			"status": request.status,
			"row_count": request.row_count or 0,
			"dataset": labels,
			"reason": request.error or "",
		},
		read=int(watched),
	)


def daily_expiry_digest():
	# Digest is opt-in. The existing expiry report projection supplies the same
	# batch/location visibility rules; only near-term dated expiry windows qualify.
	from temple_inventory.projections import Projection

	original = frappe.session.user
	for user in frappe.get_all("User", filters={"enabled": 1, "user_type": "System User"}, pluck="name"):
		if not _user_allowed(user, "expiry_digest"):
			continue
		frappe.set_user(user)
		try:
			query = {"dataset": "expiry", "expiryWindow": "period"}
			with Projection(query, refresh=True) as projection:
				projection.build()
				rows = list(projection.rows("batches"))
			seen_key = "temple_inventory_expiry_digest_seen_v1"
			try:
				seen = set(json.loads(frappe.defaults.get_user_default(seen_key, user=user) or "[]"))
			except (TypeError, ValueError):
				seen = set()
			identified = {
				f"{row.get('batch_no')}:{row.get('item_code')}:{row.get('warehouse')}" for row in rows
			}
			new_rows = [
				row
				for row in rows
				if f"{row.get('batch_no')}:{row.get('item_code')}:{row.get('warehouse')}" not in seen
			]
			frappe.defaults.set_user_default(seen_key, json.dumps(sorted(identified)), user=user)
			if not new_rows:
				continue
			_create(
				user,
				"效期提醒",
				f"未来效期提醒 · {len(new_rows)} 批",
				"",
				"",
				"/inventory/stock/expiry",
				{"batches": new_rows[:100], "digest_key": nowdate()},
			)
		finally:
			frappe.set_user(original)
