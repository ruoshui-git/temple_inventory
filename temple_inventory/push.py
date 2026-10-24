"""Web Push subscription lifecycle and Notification Log delivery."""

import json
from urllib.parse import urlparse

import frappe
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
		settings.ti_vapid_subject = (
			f"mailto:notifications@{frappe.utils.get_url().split('//')[-1].split('/')[0]}"
		)
		settings.save(ignore_permissions=True)
	return settings


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
	docname = frappe.db.get_value(DOCTYPE, {"endpoint": endpoint}, "name")
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
		fields=["name", "user_agent_label", "created", "last_success", "last_error"],
		order_by="created desc",
	)


def _send(subscription, payload):
	from pywebpush import WebPushException, webpush

	settings = _settings()
	try:
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
		)
		frappe.db.set_value(
			DOCTYPE, subscription.name, {"last_success": frappe.utils.now_datetime(), "last_error": ""}
		)
	except WebPushException as error:
		status = getattr(getattr(error, "response", None), "status_code", None)
		if status in (404, 410):
			frappe.delete_doc(DOCTYPE, subscription.name, ignore_permissions=True)
		else:
			frappe.db.set_value(DOCTYPE, subscription.name, "last_error", str(error)[:500])


@frappe.whitelist(methods=["POST"])
def send_test():
	require_app()
	settings = _settings()
	for row in frappe.get_all(DOCTYPE, filters={"user": frappe.session.user}, pluck="name"):
		_send(
			frappe.get_doc(DOCTYPE, row),
			{
				"title": "物资管理",
				"body": "通知测试成功",
				"url": "/inventory",
				"tag": "ti-test",
				"badge_count": 0,
			},
		)
	return {"sent": True, "public_key": settings.ti_vapid_public_key}


def notification_after_insert(doc, method=None):
	if doc.type not in ("库存流动", "流动撤销", "盘点调整", "导出完成", "效期提醒"):
		return
	from temple_inventory.notifications import enqueue

	enqueue("temple_inventory.push.send_notification", name=doc.name)


def send_notification(name):
	doc = frappe.get_doc("Notification Log", name)
	from temple_inventory.notifications import TYPES, _prefs

	if doc.read or not _prefs(doc.for_user)["enabled"]:
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
