"""Native app roles and the complete, per-role DocPerm matrix."""

import frappe
from frappe.permissions import add_permission, update_permission_property

VIEWER = "Inventory Viewer"
OPERATOR = "Inventory Operator"
MANAGER = "Inventory Manager"
ADMINISTRATOR = "Inventory Administrator"
ROLES = (VIEWER, OPERATOR, MANAGER, ADMINISTRATOR)
ROLE_LABELS = {VIEWER: "只读", OPERATOR: "录入员", MANAGER: "负责人", ADMINISTRATOR: "管理员"}
ROLE_PROFILES = {
	VIEWER: "物资只读",
	OPERATOR: "物资录入员",
	MANAGER: "物资负责人",
	ADMINISTRATOR: "物资管理员",
}
PERMISSIONS = ("read", "write", "create", "submit", "cancel", "amend", "delete", "print", "export", "report")
OWN_DOCTYPES = {"Inventory Activity", "Inventory Activity Type", "Temple Inventory Settings"}

# Each row is complete for that role; named sets keep the declarative matrix compact.
READ = {"read", "print", "export", "report"}
EDIT = READ | {"create", "write"}
ENTRY_OPERATOR = EDIT | {"submit"}
ENTRY_MANAGER = ENTRY_OPERATOR | {"cancel", "amend", "delete"}
ITEM_ADMIN = EDIT | {"delete"}
BUNDLE_OPERATOR = READ | {"create", "write", "submit"}
BUNDLE_MANAGER = BUNDLE_OPERATOR | {"cancel", "delete"}
REFERENCE_MANAGER = EDIT | {"delete"}
WAREHOUSE_ADMIN = READ | {"create", "write", "delete"}
SETTINGS_ADMIN = READ | {"write"}

MATRIX = {
	"Stock Entry": {
		VIEWER: READ,
		OPERATOR: ENTRY_OPERATOR,
		MANAGER: ENTRY_MANAGER,
		ADMINISTRATOR: ENTRY_MANAGER,
	},
	"Stock Reconciliation": {
		VIEWER: READ,
		OPERATOR: READ,
		MANAGER: ENTRY_MANAGER,
		ADMINISTRATOR: ENTRY_MANAGER,
	},
	"Item": {VIEWER: READ, OPERATOR: EDIT, MANAGER: EDIT, ADMINISTRATOR: ITEM_ADMIN},
	"Batch": {VIEWER: READ, OPERATOR: EDIT, MANAGER: EDIT, ADMINISTRATOR: ITEM_ADMIN},
	"Serial No": {VIEWER: READ, OPERATOR: EDIT, MANAGER: EDIT, ADMINISTRATOR: ITEM_ADMIN},
	"Bin": {role: READ for role in ROLES},
	"Serial and Batch Bundle": {
		VIEWER: READ,
		OPERATOR: BUNDLE_OPERATOR,
		MANAGER: BUNDLE_MANAGER,
		ADMINISTRATOR: BUNDLE_MANAGER,
	},
	"Inventory Activity": {VIEWER: READ, OPERATOR: EDIT, MANAGER: EDIT, ADMINISTRATOR: ITEM_ADMIN},
	"Item Group": {},
	"UOM": {},
	"UOM Category": {},
	"Inventory Activity Type": {},
	"Warehouse": {},
	"Company": {},
	"Stock Entry Type": {},
	"Warehouse Type": {},
	"Temple Inventory Settings": {},
}
for _doctype in ("Item Group", "UOM", "UOM Category", "Inventory Activity Type"):
	MATRIX[_doctype] = {
		VIEWER: READ,
		OPERATOR: READ,
		MANAGER: REFERENCE_MANAGER,
		ADMINISTRATOR: REFERENCE_MANAGER,
	}
for _doctype in ("Company", "Stock Entry Type", "Warehouse Type"):
	MATRIX[_doctype] = {role: READ for role in ROLES}
MATRIX["Warehouse"] = {VIEWER: READ, OPERATOR: READ, MANAGER: READ, ADMINISTRATOR: WAREHOUSE_ADMIN}
MATRIX["Temple Inventory Settings"] = {
	VIEWER: READ,
	OPERATOR: READ,
	MANAGER: READ,
	ADMINISTRATOR: SETTINGS_ADMIN,
}


def _ensure_role(role):
	if not frappe.db.exists("Role", role):
		frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
			ignore_permissions=True
		)
	elif not frappe.db.get_value("Role", role, "desk_access"):
		frappe.db.set_value("Role", role, "desk_access", 1, update_modified=False)


def _ensure_profile(role, profile):
	roles = [role]
	if role == ADMINISTRATOR:
		roles.append("System Manager")
	if not frappe.db.exists("Role Profile", profile):
		# Role Profile.on_update queues a bulk user rewrite. Seed the static preset
		# with db_insert, which skips hooks without hand-written SQL.
		profile_doc = frappe.new_doc("Role Profile")
		profile_doc.role_profile = profile
		profile_doc.db_insert()
	existing = set(
		frappe.db.get_all(
			"Has Role",
			filters={"parent": profile, "parenttype": "Role Profile", "parentfield": "roles"},
			pluck="role",
		)
	)
	for item in roles:
		if item not in existing:
			role_doc = frappe.new_doc("Has Role")
			role_doc.parent = profile
			role_doc.parenttype = "Role Profile"
			role_doc.parentfield = "roles"
			role_doc.role = item
			role_doc.db_insert()


def ensure_roles():
	for role in ROLES:
		_ensure_role(role)
		_ensure_profile(role, ROLE_PROFILES[role])
	for doctype, role_permissions in MATRIX.items():
		if doctype in OWN_DOCTYPES:
			continue
		for role, wanted in role_permissions.items():
			rows = frappe.get_all(
				"Custom DocPerm",
				filters={
					"parent": doctype,
					"role": role,
					"permlevel": 0,
					"if_owner": 0,
				},
				pluck="name",
				limit=1,
			)
			if not rows:
				add_permission(doctype, role, ptype="read")
			for ptype in wanted:
				update_permission_property(doctype, role, 0, ptype, 1, validate=False)
	frappe.clear_cache()


def after_install():
	ensure_roles()
