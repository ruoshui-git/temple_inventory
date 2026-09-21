"""Mark only legacy fallback leaves whose parent and label are unambiguous."""

import frappe


def execute():
	if not frappe.db.exists("Custom Field", "Warehouse-ti_fallback_role"):
		return
	rows = frappe.db.sql(
		"""select child.name, child.warehouse_name, parent.warehouse_name as parent_name,
			parent.warehouse_type, child.parent_warehouse
		from `tabWarehouse` child join `tabWarehouse` parent on parent.name=child.parent_warehouse
		where child.is_group=0 and child.warehouse_name like %s
			and child.ti_fallback_role is null""",
		("% / 未指定",), as_dict=True,
	)
	for row in rows:
		# The generated form is exact and the parent has a physical semantic type.
		if row.warehouse_name != f"{row.parent_name} / 未指定":
			continue
		role = "room_default" if str(row.warehouse_type or "").lower() in {"room", "房间"} else None
		if role:
			frappe.db.set_value("Warehouse", row.name, "ti_fallback_role", role, update_modified=False)
