"""Web Push subscription lifecycle and Notification Log delivery."""

import hashlib
import ipaddress
import json
import re
from urllib.parse import urlparse

import frappe
from frappe.rate_limiter import rate_limit
from frappe.utils.password import get_decrypted_password

from temple_inventory.native_access import require_app

DOCTYPE = "Inventory Push Subscription"


def subscription_permission(doc, ptype=None, user=None, **kwargs):
	return bool(user and user != "Guest" and doc.user == user and ptype in ("read", "delete"))


def subscription_query(user=None):
	user = user or frappe.session.user
	return f"`tab{DOCTYPE}`.user = {frappe.db.escape(user)}"


def _settings():
	settings = frappe.get_single("Temple Inventory Settings")
	changed = False
	if not settings.ti_vapid_public_key or not get_decrypted_password(
		"Temple Inventory Settings", settings.name, "ti_vapid_private_key", raise_exception=False
	):
		from cryptography.hazmat.primitives import serialization
		from cryptography.hazmat.primitives.asymmetric import ec

		private = ec.generate_private_key(ec.SECP256R1())
		private_bytes = private.private_numbers().private_value.to_bytes(32, "big")
		public_bytes = private.public_key().public_bytes(
			serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
		)
		settings.ti_vapid_private_key = _b64(private_bytes)
		settings.ti_vapid_public_key = _b64(public_bytes)
		changed = True
	if not _valid_vapid_subject(settings.ti_vapid_subject):
		settings.ti_vapid_subject = _default_vapid_subject()
		changed = True
	if changed:
		settings.save(ignore_permissions=True)
	return settings


def _valid_vapid_subject(subject):
	if not isinstance(subject, str):
		return False
	if subject.startswith("mailto:"):
		match = re.fullmatch(r"mailto:[^@\s]+@([^@\s]+)", subject)
		return bool(match and _valid_email_domain(match.group(1)))
	parsed = urlparse(subject)
	return parsed.scheme == "https" and bool(parsed.hostname)


def _valid_email_domain(host):
	try:
		ipaddress.ip_address(host)
		return False
	except ValueError:
		labels = host.rstrip(".").split(".")
		return len(labels) >= 2 and all(
			re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", part) for part in labels
		)


def _default_vapid_subject():
	parsed = urlparse(frappe.utils.get_url())
	host = parsed.hostname or ""
	if _valid_email_domain(host):
		return f"mailto:notifications@{host}"
	fallback_host = f"[{host}]" if ":" in host else host
	return f"https://{fallback_host or 'localhost'}{f':{parsed.port}' if parsed.port else ''}"


def _b64(value):
	import base64

	return base64.urlsafe_b64encode(value).decode().rstrip("=")


@frappe.whitelist()
def public_key():
	require_app()
	return _settings().ti_vapid_public_key


@frappe.whitelist(methods=["POST"])
def subscribe(endpoint, p256dh, auth, user_agent=""):
	require_app()
	parsed = urlparse(endpoint)
	if parsed.scheme != "https" or not parsed.hostname or len(endpoint) > 2048:
		frappe.throw("推送地址无效")
	endpoint_hash = hashlib.sha256(endpoint.encode()).hexdigest()
	docname = frappe.db.get_value(DOCTYPE, {"endpoint_hash": endpoint_hash}, "name")
	doc = frappe.get_doc(DOCTYPE, docname) if docname else frappe.new_doc(DOCTYPE)
	doc.user, doc.endpoint, doc.p256dh, doc.auth, doc.user_agent_label = (
		frappe.session.user,
		endpoint,
		p256dh,
		auth,
		(user_agent or "")[:140],
	)
	if not doc.created:
		doc.created = frappe.utils.now_datetime()
	doc.save(ignore_permissions=True) if docname else doc.insert(ignore_permissions=True)
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def unsubscribe(name):
	require_app()
	doc = frappe.get_doc(DOCTYPE, name)
	if doc.user != frappe.session.user:
		frappe.throw("无权删除此设备", frappe.PermissionError)
	doc.delete(ignore_permissions=True)
	return {"deleted": True}


@frappe.whitelist()
def my_devices():
	require_app()
	return frappe.get_all(
		DOCTYPE,
		filters={"user": frappe.session.user},
		fields=["name", "endpoint_hash", "user_agent_label", "created", "last_success", "last_error"],
		order_by="created desc",
	)


def _send(subscription, payload):
	from pywebpush import WebPushException, webpush

	try:
		settings = _settings()
		webpush(
			{
				"endpoint": subscription.endpoint,
				"keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
			},
			json.dumps(payload, ensure_ascii=False),
			vapid_private_key=get_decrypted_password(
				"Temple Inventory Settings", settings.name, "ti_vapid_private_key"
			),
			vapid_claims={"sub": settings.ti_vapid_subject},
			ttl=86400,
			headers={"Urgency": "normal"},
		)
		frappe.db.set_value(
			DOCTYPE, subscription.name, {"last_success": frappe.utils.now_datetime(), "last_error": ""}
		)
		return True
	except WebPushException as error:
		status = getattr(getattr(error, "response", None), "status_code", None)
		if status in (404, 410):
			frappe.delete_doc(DOCTYPE, subscription.name, ignore_permissions=True)
			return False
		message = f"推送服务返回 HTTP {status}" if status else "推送服务发送失败"
		frappe.db.set_value(DOCTYPE, subscription.name, "last_error", message)
		return False
	except Exception as error:
		# Exception text can contain the device endpoint, including provider tokens, so it
		# goes to the administrator-only Error Log rather than the user-visible device row.
		frappe.log_error(title="Inventory push send failed")
		message = f"推送发送失败 ({type(error).__name__})"
		frappe.db.set_value(DOCTYPE, subscription.name, "last_error", message[:500])
		return False


@frappe.whitelist(methods=["POST"])
@rate_limit(key="inventory_push_test", limit=10, seconds=60 * 60)
def send_test():
	require_app()
	sent = failed = 0
	results = []
	for row in frappe.get_all(DOCTYPE, filters={"user": frappe.session.user}, pluck="name"):
		subscription = frappe.get_doc(DOCTYPE, row)
		ok = _send(
			subscription,
			{
				"title": "物资管理",
				"body": "通知测试成功",
				"url": "/inventory/notifications",
				"tag": "ti-test",
				"badge_count": 0,
			},
		)
		if ok:
			sent += 1
		else:
			failed += 1
		results.append(
			{
				"name": row,
				"sent": ok,
				"error": "" if ok else frappe.db.get_value(DOCTYPE, row, "last_error") or "设备已失效并移除",
			}
		)
	return {"sent": sent, "failed": failed, "results": results}


def notification_after_insert(doc, method=None):
	if doc.type not in ("库存流动", "流动撤销", "盘点调整", "导出完成", "效期提醒"):
		return
	from temple_inventory.notifications import enqueue

	enqueue("temple_inventory.push.send_notification", name=doc.name)


def send_notification(name):
	doc = frappe.get_doc("Notification Log", name)
	from temple_inventory.notifications import EVENTS, TYPES, _user_allowed

	event = dict(zip(TYPES, EVENTS, strict=True)).get(doc.type)
	if doc.read or not event:
		return
	try:
		structured = json.loads(doc.email_content or "{}")
	except (TypeError, ValueError):
		structured = {}
	kind = structured.get("kind") if event == "movement_submitted" else None
	if not _user_allowed(doc.for_user, event, kind):
		return
	if (
		doc.document_type
		and doc.document_name
		and not frappe.has_permission(doc.document_type, "read", doc=doc.document_name, user=doc.for_user)
	):
		return
	count = frappe.db.count(
		"Notification Log", {"for_user": doc.for_user, "type": ["in", list(TYPES)], "read": 0}
	)
	payload = {
		"title": f"物资管理 · {doc.type}",
		"body": doc.subject,
		"url": doc.link or "/inventory/notifications",
		"tag": f"ti-{doc.name}",
		"badge_count": count,
	}
	for subscription_name in frappe.get_all(DOCTYPE, filters={"user": doc.for_user}, pluck="name"):
		_send(frappe.get_doc(DOCTYPE, subscription_name), payload)
