"""Install native inventory roles and migrate enabled System Managers."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import frappe

from temple_inventory.roles import ADMINISTRATOR, ROLE_PROFILES, ensure_roles


def execute():
	ensure_roles()
	users = frappe.get_all(
		"User",
		filters={"enabled": 1, "user_type": "System User"},
		pluck="name",
	)
	for user in users:
		if user == "Administrator":
			continue
		assigned_roles = set(
			frappe.db.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, pluck="role")
		)
		profile_name = frappe.db.get_value("User", user, "role_profile_name")
		if profile_name:
			assigned_roles.update(
				frappe.db.get_all(
					"Has Role",
					filters={"parent": profile_name, "parenttype": "Role Profile"},
					pluck="role",
				)
			)
		if "System Manager" not in assigned_roles:
			continue
		doc = frappe.get_doc("User", user)
		profiles = {row.role_profile for row in doc.role_profiles}
		if doc.role_profile_name:
			profiles.add(doc.role_profile_name)
		if profiles:
			if ROLE_PROFILES[ADMINISTRATOR] not in profiles:
				doc.append("role_profiles", {"role_profile": ROLE_PROFILES[ADMINISTRATOR]})
		else:
			if not any(row.role == ADMINISTRATOR for row in doc.roles):
				doc.append("roles", {"role": ADMINISTRATOR})
		doc.save(ignore_permissions=True)
		if ADMINISTRATOR not in frappe.get_roles(user):
			frappe.throw(f"未能为系统管理员分配物资管理员角色：{user}")
