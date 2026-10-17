"""Frontend account handshake; native Desk retains its own authentication flow."""

import frappe

from temple_inventory.native_access import require_frontend_account
from temple_inventory.preferences import display_preferences


@frappe.whitelist(allow_guest=True, methods=["GET", "POST"])
def info():
	require_frontend_account(check_account=False)
	return {
		"user": frappe.session.user,
		"csrf_token": frappe.sessions.get_csrf_token(),
		"ui_preferences": display_preferences(),
	}
