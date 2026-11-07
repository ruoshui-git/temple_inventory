"""Native role matrix and admission regression coverage."""

import ast
import re
from pathlib import Path
from unittest.mock import patch

import frappe

from temple_inventory import deployment
from temple_inventory.patches import install_native_roles
from temple_inventory.roles import (
	ADMINISTRATOR,
	MANAGER,
	MATRIX,
	OPERATOR,
	ROLE_PROFILES,
	ROLES,
	VIEWER,
	ensure_roles,
)
from temple_inventory.tests.test_native_documents import NativeDocumentTests

APP_ROOT = Path(__file__).resolve().parents[1]


class PermissionTests(NativeDocumentTests):
	def _user(self, role, suffix=None):
		email = f"ti-permission-{suffix or self.token}-{role.split()[-1].lower()}@example.test"
		if frappe.db.exists("User", email):
			frappe.delete_doc("User", email, force=True, ignore_permissions=True)
		return (
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": "Permission Test",
					"user_type": "System User",
					"send_welcome_email": 0,
					"roles": [{"role": role}],
				}
			)
			.insert(ignore_permissions=True)
			.name
		)

	def test_matrix_is_complete_for_each_native_role(self):
		ensure_roles()
		for role in ROLES:
			user = self._user(role)
			frappe.set_user(user)
			for doctype, rows in MATRIX.items():
				wanted = rows[role]
				for permission in (
					"read",
					"create",
					"write",
					"submit",
					"cancel",
					"amend",
					"delete",
					"print",
					"export",
					"report",
				):
					self.assertEqual(
						bool(frappe.has_permission(doctype, permission)),
						permission in wanted,
						f"{role} {permission} {doctype}",
					)
		frappe.set_user("Administrator")
		for doctype, role in (
			("Stock Entry", "Stock User"),
			("Stock Entry", "Stock Manager"),
			("Item", "Item Manager"),
		):
			self.assertTrue(frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role}), role)

	def test_ensure_roles_is_idempotent_and_does_not_run_on_migrate(self):
		from temple_inventory.roles import _ensure_profile

		ensure_roles()
		fresh_profile = "TI DB Insert Profile " + self.token
		_ensure_profile(VIEWER, fresh_profile)
		self.assertTrue(frappe.db.exists("Role Profile", fresh_profile))
		self.assertEqual(
			frappe.get_all(
				"Has Role",
				filters={"parent": fresh_profile, "parenttype": "Role Profile", "parentfield": "roles"},
				pluck="role",
			),
			[VIEWER],
		)
		before = sorted(
			tuple(row.values())
			for row in frappe.get_all(
				"Custom DocPerm",
				filters={"role": ["in", list(ROLES)]},
				fields=[
					"parent",
					"role",
					"permlevel",
					"if_owner",
					"read",
					"write",
					"create",
					"submit",
					"cancel",
					"amend",
					"delete",
					"print",
					"export",
					"report",
				],
				limit_page_length=0,
			)
		)
		ensure_roles()
		after = sorted(
			tuple(row.values())
			for row in frappe.get_all(
				"Custom DocPerm",
				filters={"role": ["in", list(ROLES)]},
				fields=[
					"parent",
					"role",
					"permlevel",
					"if_owner",
					"read",
					"write",
					"create",
					"submit",
					"cancel",
					"amend",
					"delete",
					"print",
					"export",
					"report",
				],
				limit_page_length=0,
			)
		)
		self.assertEqual(before, after)
		removed = frappe.db.get_value(
			"Custom DocPerm", {"parent": "Stock Entry", "role": VIEWER, "read": 1}, "name"
		)
		frappe.delete_doc("Custom DocPerm", removed, force=True, ignore_permissions=True)
		icon_values = {
			"label": "物资管理",
			"icon_type": "App",
			"link_type": "External",
			"link": "/inventory",
			"app": "temple_inventory",
			"logo_url": "/assets/temple_inventory/logo.png",
			"hidden": 0,
			"standard": 1,
		}
		icon = frappe._dict(**icon_values)
		icon.get = lambda field: icon_values.get(field)
		website = frappe._dict(favicon="/assets/temple_inventory/logo.png")
		website.save = lambda **kwargs: None
		with (
			patch.object(deployment, "after_install") as migrated_install,
			patch("temple_inventory.uom_labels.seed_labels"),
			patch.object(frappe.db, "get_single_value", return_value="物资管理"),
			patch.object(frappe.db, "exists", return_value="物资管理"),
			patch.object(frappe, "get_doc", return_value=icon),
			patch.object(frappe, "get_all", return_value=[]),
			patch.object(frappe, "get_single", return_value=website),
			patch.object(frappe, "clear_cache"),
		):
			deployment.after_migrate()
			migrated_install.assert_called_once()
		self.assertFalse(frappe.db.exists("Custom DocPerm", removed))

	def test_install_patch_assigns_admin_and_preserves_other_users(self):
		ensure_roles()
		manager = self._user("System Manager", "patch-manager")
		profile_user = self._user("System Manager", "patch-profile")
		other = self._user(VIEWER, "patch-other")
		profile = frappe.get_doc(
			{
				"doctype": "Role Profile",
				"role_profile": "TI Permission Profile " + self.token,
				"roles": [{"role": "System Manager"}],
			}
		).insert(ignore_permissions=True)
		profile_doc = frappe.get_doc("User", profile_user)
		profile_doc.role_profile_name = profile.name
		profile_doc.save(ignore_permissions=True)
		before_other = set(frappe.permissions.get_roles(other, with_standard=False))
		install_native_roles.execute()
		self.assertIn(ADMINISTRATOR, frappe.get_roles(manager))
		profiles = frappe.get_all("User Role Profile", filters={"parent": profile_user}, pluck="role_profile")
		self.assertIn(ROLE_PROFILES[ADMINISTRATOR], profiles)
		self.assertIn(ADMINISTRATOR, frappe.get_roles(profile_user))
		self.assertEqual(before_other, set(frappe.permissions.get_roles(other, with_standard=False)))

	def test_roleless_system_manager_and_stock_user_are_denied(self):
		user = self._user("System Manager", "no-inventory-role")
		frappe.set_user(user)
		with self.assertRaisesRegex(frappe.PermissionError, "当前账户尚未分配物资管理角色"):
			from temple_inventory.native_access import require_frontend_account

			require_frontend_account()
		user_doc = frappe.get_doc("User", user)
		user_doc.set("roles", [{"role": "Stock User"}])
		user_doc.save(ignore_permissions=True)
		with self.assertRaisesRegex(frappe.PermissionError, "当前账户尚未分配物资管理角色"):
			require_frontend_account()
		frappe.set_user("Administrator")

	def test_movement_pages_skip_reconciliations_without_doctype_read(self):
		from temple_inventory import browse, counts

		self.receipt(1)
		count = counts.save_count(self.token + self.token, self.count_data(2, "Reviewed"))
		viewer = self._user(VIEWER)
		permission = frappe.db.get_value(
			"Custom DocPerm", {"parent": "Stock Reconciliation", "role": VIEWER, "read": 1}, "name"
		)
		self.assertTrue(permission)
		frappe.db.set_value("Custom DocPerm", permission, "read", 0, update_modified=False)
		frappe.clear_cache(doctype="Stock Reconciliation")
		frappe.set_user(viewer)
		frappe.local.user_perms = None
		frappe.local.role_permissions = {}
		self.assertFalse(frappe.has_permission("Stock Reconciliation", "read"))
		query = {"dataset": "movements", "view": "records", "statuses": [0]}
		self.assertEqual(browse._readable_native_doctypes(), ("Stock Entry",))
		page = browse.native_drafts(query=query)
		self.assertTrue(all(row["doctype"] == "Stock Entry" for row in page["rows"]))
		self.assertEqual(browse.native_draft_count()["matched_count"], page["matched_count"])
		operation_page = browse.operation_page(query, records=True)
		self.assertTrue(all(row["doctype"] == "Stock Entry" for row in operation_page["rows"]))
		analysis = browse.operation_analysis(query, records=True)
		self.assertNotIn("Stock Reconciliation", frappe.as_json(analysis))
		with self.assertRaises(frappe.PermissionError):
			browse.counts_page({"dataset": "counts", "statuses": [0]})
		self.assertTrue(frappe.db.exists("Stock Reconciliation", count["name"]))
		frappe.set_user("Administrator")

	def test_viewer_reads_but_cannot_mutate_native_or_catalog_docs(self):
		from temple_inventory import activities, catalog, counts, native_api, units

		entry = self.create(self.movement())
		viewer = self._user(VIEWER)
		frappe.set_user(viewer)
		loaded = native_api.load_document("Stock Entry", entry["name"])
		self.assertFalse(loaded["actions"]["edit"])
		self.assertFalse(loaded["actions"]["submit"])
		for write in (
			lambda: native_api.create_document("Stock Entry", self.token + self.token, self.movement()),
			lambda: catalog.delete_item(self.item, frappe.db.get_value("Item", self.item, "modified")),
			lambda: activities.delete_activity(self.activity.name, self.activity.modified),
			lambda: activities.save_activity_type(label="Viewer denied " + self.token),
			lambda: catalog.create_category("Viewer denied " + self.token),
			lambda: units.create_category("Viewer denied " + self.token),
			lambda: counts.save_count(self.token, {}),
		):
			with self.assertRaises(frappe.PermissionError):
				write()
		frappe.set_user("Administrator")

	def test_bootstrap_operations_follow_create_permission(self):
		from temple_inventory import browse

		for role, entries, counts in ((VIEWER, False, False), (OPERATOR, True, False), (MANAGER, True, True)):
			frappe.set_user(self._user(role, f"bootstrap-{role.split()[-1]}"))
			try:
				operations = browse.bootstrap()["operations"]
			finally:
				frappe.set_user("Administrator")
			self.assertEqual(operations["Receive"], entries, role)
			self.assertEqual(operations["Reconcile"], counts, role)

	def test_seed_accounts_never_touch_the_builtin_administrator(self):
		from temple_inventory.native_samples import SEED_ACCOUNTS

		builtin = frappe.db.get_value("User", "Administrator", "email")
		self.assertNotIn(builtin, [email for _name, email, _role in SEED_ACCOUNTS])

	def test_seed_accounts_cover_every_role_and_the_no_access_case(self):
		from temple_inventory.native_samples import SEED_ACCOUNTS

		seeded = {role for _name, _email, role in SEED_ACCOUNTS}
		self.assertLessEqual(set(ROLES), seeded)
		self.assertTrue(seeded - set(ROLES), "a seed account must hold no inventory role")

	def test_viewer_exports_and_retries_their_own_failed_export(self):
		from temple_inventory import exports

		viewer = self._user(VIEWER)
		frappe.set_user(viewer)
		try:
			with patch("temple_inventory.exports._enqueue") as enqueue:
				export = exports.request_export(
					{"dataset": "inventory", "view": "summary"}, "summary", export_format="csv"
				)
				enqueue.assert_called_once()
			self.assertEqual(exports.export_status(export["name"])["status"], "Queued")
			frappe.db.set_value("Inventory Export Request", export["name"], "status", "Failed")
			version = frappe.db.get_value("Inventory Export Request", export["name"], "modified")
			with patch("temple_inventory.exports._enqueue") as enqueue:
				self.assertEqual(exports.retry_export(export["name"], version)["status"], "Queued")
				enqueue.assert_called_once()
			other = self._user(OPERATOR, "export-other")
			frappe.set_user(other)
			with self.assertRaises(frappe.PermissionError):
				exports.export_status(export["name"])
		finally:
			frappe.set_user("Administrator")

	def test_every_write_endpoint_denies_viewer(self):
		from temple_inventory import (
			activities,
			catalog,
			configuration,
			conversions,
			counts,
			imports,
			native_api,
			native_files,
			opening,
			units,
			warehouses,
		)

		batch_item = frappe.get_doc("Item", self.item)
		batch_item.has_batch_no = 1
		batch_item.save()
		batch = catalog.create_batch(self.item, f"TI-PERM-BATCH-{self.token}")
		category = catalog.create_category(f"Permission category {self.token}")
		batch_movement = self.movement()
		batch_movement["items"][0]["batch_no"] = batch["name"]
		draft = self.create(batch_movement)
		submitted = self.submit(self.create(batch_movement))
		amend_source = self.submit(self.create(batch_movement))
		cancelled = native_api.cancel_document("Stock Entry", amend_source.name, amend_source.version)
		activity_type = frappe.db.get_value("Inventory Activity Type", {"name": "TI-TYPE-OTHER"}, "name")
		types = frappe.get_all("Inventory Activity Type", pluck="name", order_by="name asc")
		warehouses.create_location("Shelf", f"Permission shelf {self.token}", self.room_a)
		shelf = frappe.db.get_value("Warehouse", {"ti_label": f"Permission shelf {self.token}"}, "name")
		settings = frappe.get_single("Temple Inventory Settings")
		item_version = frappe.db.get_value("Item", self.item, "modified")
		batch_version = frappe.db.get_value("Batch", batch["name"], "modified")
		category_version = frappe.db.get_value("Item Group", category["name"], "modified")
		shelf_version = frappe.db.get_value("Warehouse", shelf, "modified")
		room_version = frappe.db.get_value("Warehouse", self.room_a, "modified")
		activity_version = frappe.db.get_value("Inventory Activity", self.activity["name"], "modified")
		entry_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"permission-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": draft.name,
			}
		).insert()
		item_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"permission-item-{self.token}.png",
				"content": b"PNG",
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()
		from pathlib import Path

		self.addCleanup(lambda: Path(entry_file.get_full_path()).unlink(missing_ok=True))
		self.addCleanup(lambda: Path(item_file.get_full_path()).unlink(missing_ok=True))
		viewer = self._user(VIEWER)
		request_id = f"ti-permission-{self.token}-request"
		calls = {
			"imports.item_template": lambda: imports.item_template(),
			"imports.upload": lambda: imports.upload(),
			"imports.preview": lambda: imports.preview("nope"),
			"imports.commit": lambda: imports.commit("nope", "bad"),
			"imports.status": lambda: imports.status("nope"),
			"imports.report": lambda: imports.report("nope"),
			"imports.retry": lambda: imports.retry("nope"),
			"imports.item_catalog": lambda: imports.item_catalog(),
			"opening.ensure_batch": lambda: opening.ensure_batch(self.item, f"Viewer batch {self.token}"),
			"opening.generate_serials": lambda: opening.generate_serials(self.item, 1),
			"activities.delete_activity": lambda: activities.delete_activity(
				self.activity["name"], activity_version
			),
			"activities.delete_activity_type": lambda: activities.delete_activity_type(activity_type),
			"activities.reorder_activity_types": lambda: activities.reorder_activity_types(types),
			"activities.save_activity": lambda: activities.save_activity(
				{"title": self.activity["title"], "activity_type": activity_type},
				self.activity["name"],
				activity_version,
			),
			"activities.save_activity_type": lambda: activities.save_activity_type(
				activity_type, f"Viewer type {self.token}"
			),
			"catalog.create_category": lambda: catalog.create_category(f"Viewer category {self.token}"),
			"catalog.delete_category": lambda: catalog.delete_category(category["name"], category_version),
			"catalog.delete_item": lambda: catalog.delete_item(self.item, item_version),
			"catalog.receipt_batches": lambda: catalog.receipt_batches(
				[{"item_code": self.item, "local_id": self.token, "batch_id": ""}]
			),
			"catalog.save_batch": lambda: catalog.save_batch(batch["name"], batch_version, {}),
			"catalog.save_category": lambda: catalog.save_category(
				category["name"], category_version, {"label": category["label"]}
			),
			"catalog.save_item": lambda: catalog.save_item(
				{"item_name": "Viewer edit"}, self.item, item_version
			),
			"catalog.set_item_disabled": lambda: catalog.set_item_disabled(self.item, True, item_version),
			"catalog.set_item_image": lambda: catalog.set_item_image(self.item, item_version, item_file.name),
			"configuration.initialize": lambda: configuration.initialize(
				self.company, str(settings.modified)
			),
			"configuration.repair_pointer": lambda: configuration.repair_pointer(
				"physical_root_warehouse", self.physical, str(settings.modified), "invalid", True
			),
			"conversions.save_item_conversions": lambda: conversions.save_item_conversions(
				self.item, item_version, []
			),
			"counts.save_count": lambda: counts.save_count(request_id, {}),
			"native_api.amend_document": lambda: native_api.amend_document(
				"Stock Entry", cancelled.name, cancelled.version, request_id + "-amend"
			),
			"native_api.cancel_document": lambda: native_api.cancel_document(
				"Stock Entry", submitted.name, submitted.version
			),
			"native_api.create_document": lambda: native_api.create_document(
				"Stock Entry", request_id + "-create", batch_movement
			),
			"native_api.delete_document": lambda: native_api.delete_document(
				"Stock Entry", draft.name, draft.version
			),
			"native_api.duplicate_document": lambda: native_api.duplicate_document(
				"Stock Entry", submitted.name, submitted.version, request_id + "-duplicate"
			),
			"native_api.save_document": lambda: native_api.save_document(
				"Stock Entry", draft.name, draft.version, batch_movement
			),
			"native_api.submit_document": lambda: native_api.submit_document(
				"Stock Entry", draft.name, draft.version
			),
			"native_files.remove_attachment": lambda: native_files.remove_attachment(
				"Stock Entry", draft.name, entry_file.name
			),
			"units.create_category": lambda: units.create_category(f"Viewer UOM {self.token}"),
			"units.delete_unit": lambda: units.delete_unit("Nos"),
			"units.save_unit": lambda: units.save_unit("Nos", "Nos", "Viewer", enabled=True),
			"warehouses.create_location": lambda: warehouses.create_location(
				"Shelf", f"Viewer shelf {self.token}", self.room_a
			),
			"warehouses.delete_location": lambda: warehouses.delete_location(shelf, shelf_version),
			"warehouses.move_location": lambda: warehouses.move_location(shelf, self.room_b, shelf_version),
			"warehouses.rename_location": lambda: warehouses.rename_location(
				shelf, "Viewer rename", version=shelf_version
			),
			"warehouses.repair_direct_storage": lambda: warehouses.repair_direct_storage(
				self.room_a, room_version
			),
			"warehouses.set_disabled": lambda: warehouses.set_disabled(shelf, True, shelf_version),
			"warehouses.subdivide_shelf": lambda: warehouses.subdivide_shelf(shelf, shelf_version),
		}
		policies = _endpoint_policies()
		self.assertEqual(set(calls), {endpoint for endpoint, policy in policies.items() if policy == "WRITE"})
		frappe.set_user(viewer)
		try:
			for endpoint, policy in policies.items():
				if policy != "WRITE":
					continue
				with self.subTest(endpoint=endpoint), self.assertRaises(frappe.PermissionError):
					calls[endpoint]()
		finally:
			frappe.set_user("Administrator")

	def test_operator_is_refused_by_every_item_import_endpoint(self):
		from temple_inventory import imports

		operator = self._user(OPERATOR, "import-operator")
		frappe.set_user(operator)
		try:
			for endpoint, call in (
				("template", lambda: imports.item_template()),
				("upload", lambda: imports.upload()),
				("preview", lambda: imports.preview("missing")),
				("commit", lambda: imports.commit("missing", "x")),
				("status", lambda: imports.status("missing")),
				("report", lambda: imports.report("missing")),
				("retry", lambda: imports.retry("missing")),
				("catalog", lambda: imports.item_catalog()),
			):
				with self.subTest(endpoint=endpoint), self.assertRaises(frappe.PermissionError):
					call()
		finally:
			frappe.set_user("Administrator")

	def test_operator_creates_saves_submits_and_cannot_delete_cancel_amend_or_count(self):
		from temple_inventory import catalog, counts, native_api

		cancelled = self.submit(self.create(self.movement()))
		cancelled = native_api.cancel_document("Stock Entry", cancelled["name"], cancelled["version"])
		batch_item = frappe.get_doc("Item", self.item)
		batch_item.has_batch_no = 1
		batch_item.save()
		batch = catalog.create_batch(self.item, f"TI-ROLE-BATCH-{self.token}")
		serial_code = f"TI-ROLE-SERIAL-{self.token}"
		serial_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": serial_code,
				"item_name": serial_code,
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_serial_no": 1,
				"serial_no_series": serial_code + "-.####",
			}
		).insert()
		operator = self._user(OPERATOR)
		frappe.set_user(operator)
		data = self.movement()
		data["items"][0]["batch_no"] = batch["name"]
		draft = self.create(data)
		saved = native_api.save_document("Stock Entry", draft["name"], draft["version"], data)
		submitted = native_api.submit_document("Stock Entry", saved["name"], saved["version"])
		serial_data = self.movement(quantity=1)
		serial_data["items"][0].update(
			{
				"item_code": serial_item.name,
				"serial_no": f"TI-ROLE-SN-{self.token}-0001",
				"use_serial_batch_fields": 1,
			}
		)
		serial_draft = self.create(serial_data)
		serial_saved = native_api.save_document(
			"Stock Entry", serial_draft["name"], serial_draft["version"], serial_data
		)
		native_api.submit_document("Stock Entry", serial_saved["name"], serial_saved["version"])
		with self.assertRaises(frappe.PermissionError):
			native_api.cancel_document("Stock Entry", submitted["name"], submitted["version"])
		with self.assertRaises(frappe.PermissionError):
			native_api.delete_document("Stock Entry", submitted["name"], submitted["version"])
		with self.assertRaises(frappe.PermissionError):
			native_api.amend_document("Stock Entry", cancelled["name"], cancelled["version"], self.token)
		with self.assertRaises(frappe.PermissionError):
			counts.save_count(self.token, {})
		# Desk's Document.submit applies the same submit/cancel DocPerms as the API.
		desk_draft = frappe.get_doc("Stock Entry", self.create(data)["name"])
		desk_draft.submit()
		with self.assertRaises(frappe.PermissionError):
			desk_draft.cancel()
		frappe.set_user("Administrator")

	def test_attachment_rules_apply_to_api_and_direct_file_deletion(self):
		from pathlib import Path

		from temple_inventory import native_api, native_files

		operator = self._user(OPERATOR, "attachments")
		manager = self._user("Inventory Manager", "attachments")
		frappe.set_user(operator)
		draft = self.create(self.movement())
		draft_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"operator-draft-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": draft.name,
			}
		).insert()
		self.addCleanup(lambda: Path(draft_file.get_full_path()).unlink(missing_ok=True))
		self.assertTrue(native_files.remove_attachment("Stock Entry", draft.name, draft_file.name)["deleted"])
		item_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"operator-item-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()
		self.addCleanup(lambda: Path(item_file.get_full_path()).unlink(missing_ok=True))
		self.assertTrue(native_files.remove_attachment("Item", self.item, item_file.name)["deleted"])

		submitted = self.submit(self.create(self.movement()))
		api_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"operator-submitted-api-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": submitted.name,
			}
		).insert()
		self.addCleanup(lambda: Path(api_file.get_full_path()).unlink(missing_ok=True))
		with self.assertRaises(frappe.PermissionError):
			native_files.remove_attachment("Stock Entry", submitted.name, api_file.name)
		direct_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"operator-submitted-direct-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": submitted.name,
			}
		).insert()
		self.addCleanup(lambda: Path(direct_file.get_full_path()).unlink(missing_ok=True))
		with self.assertRaises(frappe.PermissionError):
			frappe.delete_doc("File", direct_file.name)

		frappe.set_user(manager)
		manager_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"manager-submitted-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": submitted.name,
			}
		).insert()
		self.addCleanup(lambda: Path(manager_file.get_full_path()).unlink(missing_ok=True))
		self.assertTrue(
			native_files.remove_attachment("Stock Entry", submitted.name, manager_file.name)["deleted"]
		)
		manager_direct = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"manager-submitted-direct-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": submitted.name,
			}
		).insert()
		self.addCleanup(lambda: Path(manager_direct.get_full_path()).unlink(missing_ok=True))
		manager_direct.delete()

		cancelled_file = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"manager-cancelled-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": submitted.name,
			}
		).insert()
		self.addCleanup(lambda: Path(cancelled_file.get_full_path()).unlink(missing_ok=True))
		cancelled = native_api.cancel_document("Stock Entry", submitted.name, submitted.version)
		with self.assertRaises(frappe.PermissionError):
			native_files.remove_attachment("Stock Entry", cancelled.name, cancelled_file.name)
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.PermissionError):
			frappe.delete_doc("File", cancelled_file.name)

		todo = frappe.get_doc({"doctype": "ToDo", "description": f"unrelated {self.token}"}).insert()
		unrelated = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"unrelated-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "ToDo",
				"attached_to_name": todo.name,
			}
		).insert()
		self.addCleanup(lambda: Path(unrelated.get_full_path()).unlink(missing_ok=True))
		frappe.delete_doc("File", unrelated.name)
		self.assertFalse(frappe.db.exists("File", unrelated.name))

	def test_manager_counts_and_reference_writes_but_admin_alone_manages_warehouses_and_item_delete(self):
		from temple_inventory import catalog, counts, native_api, units, warehouses

		self.receipt(1)
		manager = self._user("Inventory Manager")
		frappe.set_user(manager)
		category = catalog.create_category("Manager category " + self.token)
		self.assertTrue(category["name"])
		unit_category = units.create_category("Manager unit category " + self.token)
		self.assertTrue(unit_category["name"])
		with self.assertRaises(frappe.PermissionError):
			warehouses.create_location("Area", "Manager denied " + self.token, self.physical)
		with self.assertRaises(frappe.PermissionError):
			catalog.delete_item(self.item, frappe.db.get_value("Item", self.item, "modified"))
		draft = self.create(self.movement())
		deleted = native_api.delete_document("Stock Entry", draft["name"], draft["version"])
		self.assertTrue(deleted["deleted"])
		count_data = self.count_data(2, "Reviewed")
		count = counts.save_count(self.token + self.token, count_data)
		self.assertTrue(count["name"])
		completed = native_api.submit_document("Stock Reconciliation", count["name"], count["version"])
		self.assertEqual(completed["docstatus"], 1)
		admin = self._user(ADMINISTRATOR)
		frappe.set_user(admin)
		created = warehouses.create_location("Area", "Admin area " + self.token, self.physical)
		self.assertTrue(created)
		frappe.set_user("Administrator")

	def test_whitelisted_endpoints_have_explicit_policy_classification(self):
		policies = _endpoint_policies()
		found = set()
		for path in APP_ROOT.rglob("*.py"):
			if "tests" in path.parts or "patches" in path.parts:
				continue
			source = re.sub(
				r"except ([\w.]+), ([\w.]+)(, [\w.]+)*:",
				lambda match: (
					"except (" + match.group(1) + ", " + match.group(2) + (match.group(3) or "") + "):"
				),
				path.read_text(),
			)
			module = ast.parse(source)
			for node in module.body:
				if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
					continue
				if any(_is_whitelist(decorator) for decorator in node.decorator_list):
					found.add(
						f"{path.relative_to(APP_ROOT).with_suffix('').as_posix().replace('/', '.')}.{node.name}"
					)
		self.assertEqual(
			found,
			set(policies),
			f"Unclassified={sorted(found - set(policies))}; stale={sorted(set(policies) - found)}",
		)
		for endpoint, policy in policies.items():
			self.assertIn(policy, {"READ", "WRITE", "SELF"}, endpoint)


def _is_whitelist(node):
	return (
		isinstance(node, ast.Call)
		and isinstance(node.func, ast.Attribute)
		and isinstance(node.func.value, ast.Name)
		and node.func.value.id == "frappe"
		and node.func.attr == "whitelist"
	)


def _endpoint_policies():
	"""Explicit API policy inventory; additions require review."""
	return {
		"imports.commit": "WRITE",
		"imports.item_catalog": "WRITE",
		"imports.item_template": "WRITE",
		"imports.preview": "WRITE",
		"imports.report": "WRITE",
		"imports.retry": "WRITE",
		"imports.status": "WRITE",
		"imports.upload": "WRITE",
		"activities.activity_label": "READ",
		"activities.delete_activity": "WRITE",
		"activities.delete_activity_type": "WRITE",
		"activities.list_activity_types": "READ",
		"activities.load_activity": "READ",
		"activities.reorder_activity_types": "WRITE",
		"activities.save_activity": "WRITE",
		"activities.save_activity_type": "WRITE",
		"activities.search_activities": "READ",
		"browse.bootstrap": "READ",
		"browse.counts_page": "READ",
		"browse.dashboard_card": "READ",
		"browse.expiry_analysis": "READ",
		"browse.expiry_page": "READ",
		"browse.inventory_page": "READ",
		"browse.loan_item_history": "READ",
		"browse.more_summary": "READ",
		"browse.movement_history": "READ",
		"browse.native_draft_count": "READ",
		"browse.native_drafts": "READ",
		"browse.operation_analysis": "READ",
		"browse.operation_contributions": "READ",
		"browse.operation_page": "READ",
		"catalog.available_serials": "READ",
		"opening.batch_options": "READ",
		"catalog.batch_details": "READ",
		"catalog.batch_history": "READ",
		"catalog.batch_locations": "READ",
		"catalog.batch_metadata_many": "READ",
		"catalog.category_tree": "READ",
		"catalog.create_category": "WRITE",
		"catalog.delete_category": "WRITE",
		"catalog.delete_item": "WRITE",
		"catalog.item_detail": "READ",
		"catalog.item_display_summaries": "READ",
		"catalog.item_lifecycle": "READ",
		"catalog.item_serials": "READ",
		"catalog.item_summaries": "READ",
		"catalog.operation_items": "READ",
		"catalog.picker_rows": "READ",
		"catalog.receipt_batches": "WRITE",
		"catalog.save_batch": "WRITE",
		"catalog.save_category": "WRITE",
		"catalog.save_item": "WRITE",
		"catalog.scan_code": "READ",
		"catalog.search_items": "READ",
		"catalog.set_item_disabled": "WRITE",
		"catalog.set_item_image": "WRITE",
		"catalog.suggest_item_code": "READ",
		"configuration.initialize": "WRITE",
		"configuration.repair_pointer": "WRITE",
		"configuration.repair_preview": "READ",
		"configuration.status": "READ",
		"conversions.save_item_conversions": "WRITE",
		"counts.count_baseline": "READ",
		"counts.count_serial_details": "READ",
		"counts.save_count": "WRITE",
		"counts.validate_count_serial": "READ",
		"exports.download_export": "READ",
		"exports.export_print_formats": "READ",
		"exports.export_status": "READ",
		"exports.mark_watched": "SELF",
		"exports.request_export": "SELF",
		"exports.retry_export": "SELF",
		"item_images.original": "READ",
		"item_images.thumbnail": "READ",
		"loans.outstanding_lines": "READ",
		"native_api.amend_document": "WRITE",
		"native_api.cancel_document": "WRITE",
		"opening.ensure_batch": "WRITE",
		"opening.generate_serials": "WRITE",
		"native_api.create_document": "WRITE",
		"native_api.delete_document": "WRITE",
		"native_api.duplicate_document": "WRITE",
		"native_api.editor_clock": "SELF",
		"native_api.load_document": "READ",
		"native_api.loan_detail": "READ",
		"native_api.outstanding_loan_groups": "READ",
		"native_api.outstanding_loans": "READ",
		"native_api.save_document": "WRITE",
		"native_api.submit_document": "WRITE",
		"native_files.attachments": "READ",
		"native_files.remove_attachment": "WRITE",
		"notifications.get_preferences": "SELF",
		"notifications.inbox": "READ",
		"notifications.inbox_types": "READ",
		"notifications.mark_all_read": "SELF",
		"notifications.mark_read": "SELF",
		"notifications.save_preferences": "SELF",
		"notifications.unread_count": "READ",
		"people.borrowers": "READ",
		"people.recorded_names": "READ",
		"preferences.creation_locations": "READ",
		"preferences.delete_named_view": "SELF",
		"preferences.dismiss_push_prompt": "SELF",
		"preferences.named_views": "READ",
		"preferences.push_prompt_dismissed": "READ",
		"preferences.save_creation_location": "SELF",
		"preferences.save_display_preferences": "SELF",
		"preferences.save_named_view": "SELF",
		"printing.print_record_html": "READ",
		"printing.print_record_pdf": "READ",
		"projections.group_page": "READ",
		"projections.report_page": "READ",
		"push.my_devices": "SELF",
		"push.public_key": "READ",
		"push.send_test": "SELF",
		"push.subscribe": "SELF",
		"push.unsubscribe": "SELF",
		"session.info": "READ",
		"table_preferences.get_column_preferences": "READ",
		"table_preferences.get_presentation_preference": "READ",
		"table_preferences.save_column_preferences": "SELF",
		"table_preferences.save_presentation_preference": "SELF",
		"units.create_category": "WRITE",
		"units.delete_unit": "WRITE",
		"units.list_categories": "READ",
		"units.list_units": "READ",
		"units.save_unit": "WRITE",
		"warehouses.create_location": "WRITE",
		"warehouses.delete_location": "WRITE",
		"warehouses.move_location": "WRITE",
		"warehouses.rename_location": "WRITE",
		"warehouses.repair_direct_storage": "WRITE",
		"warehouses.set_disabled": "WRITE",
		"warehouses.stock_summary": "READ",
		"warehouses.subdivide_shelf": "WRITE",
		"warehouses.tree": "READ",
	}
