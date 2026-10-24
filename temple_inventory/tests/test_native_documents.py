"""Native document integration: bench execute temple_inventory.tests.test_native_documents.run.

Each case uses a savepoint and rolls back stock, settings, users and metadata.
"""

import copy
import unittest
from unittest.mock import patch
from uuid import uuid4

import frappe
from erpnext.stock.utils import get_stock_balance
from frappe.utils import now_datetime, nowdate

from temple_inventory import (
	activities,
	conversions,
	counts,
	native_api,
	native_files,
	preferences,
	session,
)


class NativeDocumentTests(unittest.TestCase):
	def test_remembered_creation_locations_are_filtered_against_current_leaves(self):
		with (
			patch.object(preferences, "require_app"),
			patch(
				"temple_inventory.native_stock.warehouse_scopes",
				return_value=(None, {}, {"leaf-a"}, set(), set()),
			),
			patch.object(
				preferences,
				"_creation_locations",
				return_value={"Receive": "leaf-a", "Transfer": "retired", "Issue": "leaf-a"},
			),
		):
			self.assertEqual(preferences.creation_locations(), {"Receive": "leaf-a"})

	def test_borrower_suggestions_are_distinct_and_read_permission_filtered(self):
		rows = [
			frappe._dict(name="LOAN-1", ti_borrower="Readable"),
			frappe._dict(name="LOAN-2", ti_borrower="Readable"),
			frappe._dict(name="LOAN-3", ti_borrower="Restricted"),
		]
		with (
			patch.object(native_api, "require_app"),
			patch.object(frappe, "get_list", return_value=rows),
			patch.object(frappe, "has_permission", side_effect=lambda _dt, _perm, doc=None: doc != "LOAN-3"),
		):
			self.assertEqual(native_api.borrower_suggestions(), ["Readable"])

	def test_outstanding_loans_are_grouped_and_paged_by_borrower(self):
		borrower = f"分页借用方-{self.token}"
		first = self.loan(5, borrower)
		second = self.loan(3, borrower)
		groups = native_api.outstanding_loan_groups(search=borrower, page_length=1)
		self.assertEqual(groups["rows"][0]["borrower"], borrower)
		self.assertEqual(groups["rows"][0]["loan_count"], 2)
		self.assertEqual(groups["rows"][0]["item_count"], 2)
		self.assertIsNone(groups["next"])
		page = native_api.outstanding_loans(borrower=first.ti_borrower, page_length=1)
		self.assertEqual(len(page["rows"]), 1)
		self.assertIsNotNone(page["next"])
		self.assertEqual(page["rows"][0]["name"], second.name)
		activity_groups = native_api.outstanding_loan_groups(search=self.activity.title)
		self.assertEqual(activity_groups["rows"][0]["borrower"], borrower)
		activity_loans = native_api.outstanding_loans(
			search=self.activity.title, borrower=borrower, page_length=10
		)
		self.assertEqual(len(activity_loans["rows"]), 2)

	def test_frontend_account_binding_rejects_old_window_data_and_uploads_after_account_change(self):
		previous = getattr(frappe.local, "request", None)
		try:
			frappe.local.request = frappe._dict(headers={"X-Inventory-Account": "another-account"})
			with self.assertRaises(frappe.AuthenticationError):
				self.create(self.movement())
			with self.assertRaises(frappe.AuthenticationError):
				native_files.validate_file_write(frappe._dict())
			with patch("frappe.sessions.get_csrf_token", return_value="test-session-csrf"):
				self.assertEqual(session.info()["user"], "Administrator")
		finally:
			if previous is None:
				del frappe.local.request
			else:
				frappe.local.request = previous

	def test_session_boundary_rejects_guests_and_non_manager_accounts(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.AuthenticationError):
			session.info()
		frappe.set_user("Administrator")
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-session-stock-user-{self.token}@example.test",
				"first_name": "Session Stock User",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": "Stock User"}],
			}
		).insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			session.info()
		frappe.set_user("Administrator")
		# bench execute has no HTTP session object. The native CSRF generator
		# belongs to the HTTP session; this case exercises account authorization.
		with patch("frappe.sessions.get_csrf_token", return_value="test-session-csrf"):
			self.assertEqual(session.info()["user"], "Administrator")

	def setUp(self):
		frappe.set_user("Administrator")
		frappe.db.savepoint("ti_native_test")
		self.token = frappe.generate_hash(length=10)
		self.company = frappe.db.get_single_value("Temple Inventory Settings", "company")
		self.company = self.company or frappe.get_all("Company", pluck="name")[0]
		for name in ("Area", "Room", "Shelf", "System"):
			if not frappe.db.exists("Warehouse Type", name):
				frappe.get_doc({"doctype": "Warehouse Type", "name": name}).insert()

		def warehouse(label, parent=None, group=0, semantic_type="System", direct=0):
			return (
				frappe.get_doc(
					{
						"doctype": "Warehouse",
						"warehouse_name": f"Native Test {label} {self.token}",
						"ti_label": f"Native Test {label} {self.token}",
						"company": self.company,
						"parent_warehouse": parent,
						"is_group": group,
						"warehouse_type": semantic_type,
						"ti_direct_storage": direct,
					}
				)
				.insert()
				.name
			)

		self.root = warehouse("Root", group=1)
		self.physical = warehouse("Physical", self.root, 1)
		self.system_root = warehouse("System Locations", self.root, 1)
		self.room_a = warehouse("A Room", self.physical, 1, "Room")
		self.room_b = warehouse("B Room", self.physical, 1, "Room")
		self.a = warehouse("A Direct", self.room_a, semantic_type="", direct=1)
		self.b = warehouse("B Direct", self.room_b, semantic_type="", direct=1)
		self.loan_leaf = warehouse("Lease Leaf", self.system_root)
		self.damaged = warehouse("Damaged", self.system_root)
		settings = frappe.get_single("Temple Inventory Settings")
		settings.company = self.company
		settings.root_warehouse = self.root
		settings.physical_root_warehouse = self.physical
		settings.system_root_warehouse = self.system_root
		settings.leased_warehouse = self.loan_leaf
		settings.damaged_warehouse = self.damaged
		settings.set("allowed_warehouses", [{"warehouse": self.a}, {"warehouse": self.b}])
		settings.save()
		self.item = (
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": f"TI-NATIVE-{self.token}",
					"item_name": "Native test item",
					"stock_uom": "Nos",
					"item_group": "All Item Groups",
					"is_stock_item": 1,
				}
			)
			.insert()
			.name
		)
		activities.seed_activity_types()
		self.activity = activities.save_activity(
			{"title": f"Native Activity {self.token}", "activity_type": "TI-TYPE-OTHER"}
		)

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback(save_point="ti_native_test")
		frappe.clear_document_cache("Temple Inventory Settings", "Temple Inventory Settings")
		frappe.local.message_log = []

	def movement(self, kind="Receive", quantity=10, source=None, target=None, **header):
		line = {
			"item_code": self.item,
			"qty": quantity,
			"uom": "Nos",
			"conversion_factor": 1,
			"s_warehouse": source,
			"t_warehouse": target or (self.a if kind == "Receive" else None),
			"basic_rate": 10,
		}
		return {
			"company": self.company,
			"posting_date": nowdate(),
			"ti_movement_kind": kind,
			"items": [line],
			**header,
		}

	def create(self, data, request_id=None):
		return native_api.create_document("Stock Entry", request_id or str(uuid4()), data)

	def submit(self, doc):
		return native_api.submit_document("Stock Entry", doc.name, doc.version)

	def receipt(self, quantity=10):
		return self.submit(self.create(self.movement(quantity=quantity)))

	def loan(self, quantity=5, borrower="测试借用方"):
		self.receipt(quantity)
		return self.submit(
			self.create(
				self.movement(
					"Loan",
					quantity,
					self.a,
					self.loan_leaf,
					ti_borrower=borrower,
					ti_activity=self.activity.name,
				)
			)
		)

	def settlement(self, loan, quantity=2, outcome="Returned", kind="Return"):
		data = self.movement(
			kind,
			quantity,
			self.loan_leaf,
			self.b if outcome == "Returned" else self.damaged,
			ti_borrower=loan.ti_borrower,
			ti_activity=loan.ti_activity,
		)
		if kind == "Loss":
			data["items"][0]["t_warehouse"] = None
		data["items"][0].update(
			{
				"ti_original_loan": loan.name,
				"ti_original_loan_line": loan["items"][0].name,
				"ti_settlement_outcome": outcome,
			}
		)
		return self.create(data)

	def test_retry_creation_and_confirmation_affect_stock_once(self):
		request_id = str(uuid4())
		data = self.movement()
		draft = self.create(data, request_id)
		self.assertEqual(self.create(data, request_id).name, draft.name)
		self.assertEqual(get_stock_balance(self.item, self.a), 0)
		completed = self.submit(draft)
		self.assertEqual(self.submit(draft).name, completed.name)
		self.assertEqual(get_stock_balance(self.item, self.a), 10)
		self.assertFalse(completed.editable)

	def test_desk_and_frontend_preserve_native_header_and_row_fields(self):
		draft = self.create(self.movement())
		desk = frappe.get_doc("Stock Entry", draft.name)
		desk.remarks = "Desk notes"
		desk.items[0].description = "Desk row extension"
		desk.save()
		with self.assertRaises(frappe.TimestampMismatchError):
			native_api.save_document("Stock Entry", draft.name, draft.version, {"ti_source_text": "stale"})
		loaded = native_api.load_document("Stock Entry", draft.name)
		row_id = loaded["items"][0].name
		updated = native_api.save_document(
			"Stock Entry",
			draft.name,
			loaded.version,
			{"ti_source_text": "Frontend source", "items": [{"name": row_id, "qty": 12}]},
		)
		self.assertEqual(updated.remarks, "Desk notes")
		self.assertEqual(updated["items"][0].description, "Desk row extension")
		self.assertEqual(updated["items"][0].name, row_id)
		self.assertEqual(frappe.get_doc("Stock Entry", draft.name).ti_source_text, "Frontend source")

	def test_stale_delete_submit_and_cancel_are_rejected(self):
		draft = self.create(self.movement())
		updated = native_api.save_document(
			"Stock Entry", draft.name, draft.version, {"ti_source_text": "new"}
		)
		for method in (native_api.delete_document, native_api.submit_document):
			with self.assertRaises(frappe.TimestampMismatchError):
				method("Stock Entry", draft.name, draft.version)
		completed = self.submit(updated)
		with self.assertRaises(frappe.TimestampMismatchError):
			native_api.cancel_document("Stock Entry", draft.name, updated.version)
		self.assertEqual(frappe.db.get_value("Stock Entry", completed.name, "docstatus"), 1)

	def test_native_row_identity_cannot_be_reused_or_forged(self):
		draft = self.create(self.movement())
		row = dict(draft["items"][0])
		for rows in ([row, row], [{**row, "name": "another-document-row"}]):
			with self.assertRaises(frappe.TimestampMismatchError):
				native_api.save_document("Stock Entry", draft.name, draft.version, {"items": rows})

	def test_group_warehouse_and_purpose_mismatch_are_rejected_in_desk(self):
		data = self.movement(target=self.physical)
		with self.assertRaises(frappe.PermissionError):
			self.create(data)
		draft = self.create(self.movement())
		desk = frappe.get_doc("Stock Entry", draft.name)
		desk.ti_movement_kind = "Loan"
		with self.assertRaises(frappe.ValidationError):
			desk.save()

	def test_native_untyped_transfers_cannot_claim_loan_settlements(self):
		loan = self.loan(5)
		self.receipt(10)
		data = self.movement("Transfer", 7, self.a, self.b)
		data.update(
			{
				"doctype": "Stock Entry",
				"purpose": "Material Transfer",
				"stock_entry_type": "Material Transfer",
			}
		)
		data["ti_movement_kind"] = ""
		metadata = {
			"ti_original_loan": loan.name,
			"ti_original_loan_line": loan["items"][0].name,
			"ti_settlement_outcome": "Returned",
		}
		# Desk/API insertion must reject even before native draft creation.
		for kind in (None, "Transfer", "Unsupported"):
			bad = copy.deepcopy(data)
			bad["ti_movement_kind"] = kind
			bad["items"][0].update(metadata)
			with self.assertRaises(frappe.ValidationError):
				frappe.get_doc(bad).insert()
		# Ordinary ERPNext documents remain usable with no app metadata.
		draft = frappe.get_doc(data).insert()
		for action in ("save", "submit"):
			current = frappe.get_doc("Stock Entry", draft.name)
			current.items[0].update(metadata)
			with self.assertRaises(frappe.ValidationError):
				getattr(current, action)()
		ordinary = frappe.get_doc("Stock Entry", draft.name).submit()
		self.assertEqual(get_stock_balance(self.item, self.loan_leaf), 5)
		# A pre-existing malformed row cannot falsify the projection either.
		frappe.db.set_value("Stock Entry Detail", ordinary.items[0].name, metadata)
		self.assertEqual(native_api.loan_detail(loan.name)["items"][0].outstanding_qty, 5)

	def test_native_settlement_requires_complete_metadata_and_correct_provenance(self):
		loan = self.loan(5)
		valid = frappe.get_doc("Stock Entry", self.settlement(loan).name)
		for field in ("ti_original_loan", "ti_original_loan_line", "ti_settlement_outcome"):
			bad = frappe.copy_doc(valid)
			bad.items[0].set(field, None)
			with self.assertRaises(frappe.ValidationError):
				bad.insert()
		for changes in (
			{"s_warehouse": self.a},
			{"ti_original_loan_line": "unrelated-child"},
			{"ti_origin_warehouse": self.b},
			{"qty": 6},
			{"ti_settlement_outcome": "Lost"},
		):
			bad = frappe.copy_doc(valid)
			bad.items[0].update(changes)
			with self.assertRaises((frappe.ValidationError, frappe.PermissionError)):
				bad.insert()
		# Save and submit revalidate native drafts, including cleared kinds.
		valid.ti_movement_kind = None
		for action in ("save", "submit"):
			with self.assertRaises(frappe.ValidationError):
				getattr(valid, action)()

	def test_exact_loan_line_and_partial_outcomes_are_derived_from_native_entries(self):
		loan = self.loan(10)
		self.submit(self.settlement(loan, 2))
		self.submit(self.settlement(loan, 3, "Damaged"))
		self.submit(self.settlement(loan, 1, "Lost", "Loss"))
		detail = native_api.loan_detail(loan.name)
		self.assertTrue(detail["balance_at"])
		self.assertEqual(detail["activity_title"], self.activity.title)
		line = detail["items"][0]
		self.assertEqual(line.outcomes, {"Returned": 2, "Damaged": 3, "Lost": 1})
		self.assertEqual(line.outstanding_qty, 4)
		self.assertEqual(line.allocations[0]["borrowed_qty"], 10)
		self.assertEqual(line.allocations[0]["outstanding_qty"], 4)
		self.assertEqual(get_stock_balance(self.item, self.loan_leaf), 4)
		with self.assertRaises(frappe.ValidationError):
			self.settlement(loan, 5)

	def test_settlement_draft_rechecks_current_balance_before_submission(self):
		loan = self.loan(5)
		first = self.settlement(loan, 4)
		second = self.settlement(loan, 4)
		self.submit(first)
		with self.assertRaises(frappe.ValidationError):
			self.submit(second)

	def test_cancel_settlement_restores_balance_and_blocks_loan_cancel(self):
		loan = self.loan()
		settlement = self.submit(self.settlement(loan))
		with self.assertRaises(frappe.LinkExistsError):
			native_api.cancel_document("Stock Entry", loan.name, loan.version)
		native_api.cancel_document("Stock Entry", settlement.name, settlement.version)
		self.assertEqual(native_api.loan_detail(loan.name)["items"][0].outstanding_qty, 5)
		cancelled = native_api.cancel_document("Stock Entry", loan.name, loan.version)
		amended = native_api.amend_document("Stock Entry", loan.name, cancelled.version, str(uuid4()))
		self.assertEqual(amended.amended_from, loan.name)

	def test_activity_rename_keeps_identity_and_archived_links_remain_valid(self):
		draft = self.create(self.movement(ti_activity=self.activity.name))
		changed = activities.save_activity(
			{"title": "Renamed " + self.token, "status": "Archived"},
			self.activity.name,
			self.activity.modified,
		)
		self.assertEqual(changed.name, self.activity.name)
		self.submit(draft)
		with self.assertRaises(frappe.ValidationError):
			self.create(self.movement(ti_activity=self.activity.name))
		with self.assertRaises(frappe.LinkExistsError):
			activities.delete_activity(changed.name, changed.modified)

	def test_cancelled_activity_reference_still_blocks_deletion(self):
		entry = self.submit(self.create(self.movement(ti_activity=self.activity.name)))
		native_api.cancel_document("Stock Entry", entry.name, entry.version)
		with self.assertRaises(frappe.LinkExistsError):
			activities.delete_activity(self.activity.name, self.activity.modified)

	def test_disabled_type_rejects_assignment_and_keeps_existing_activity_readable(self):
		type_doc = frappe.get_doc("Inventory Activity Type", self.activity.activity_type)
		type_doc.enabled = 0
		type_doc.save()
		activities.save_activity(
			{"notes": "第一段\n\n<b>原样显示</b>"}, self.activity.name, self.activity.modified
		)
		with self.assertRaises(frappe.ValidationError):
			activities.save_activity({"title": "New " + self.token, "activity_type": type_doc.name})
		with self.assertRaises(frappe.LinkExistsError):
			type_doc.delete()

	def test_recorded_line_factors_survive_reusable_item_conversion_changes(self):
		unit = frappe.get_doc({"doctype": "UOM", "uom_name": "Pack " + self.token}).insert().name
		item = frappe.get_doc("Item", self.item)
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 6}])
		data = self.movement(quantity=2)
		data["items"][0].update({"uom": unit, "conversion_factor": 5})
		draft = self.create(data)
		item.reload()
		conversions.save_item_conversions(self.item, item.modified, [{"uom": unit, "conversion_factor": 8}])
		completed = self.submit(draft)
		self.assertEqual(completed["items"][0].conversion_factor, 5)
		self.assertEqual(completed["items"][0].transfer_qty, 10)
		permission = frappe.has_permission
		with patch(
			"frappe.has_permission",
			side_effect=lambda doctype, ptype="read", *args, **kwargs: (
				False
				if doctype == "Item" and ptype == "write"
				else permission(doctype, ptype, *args, **kwargs)
			),
		):
			cancelled = native_api.cancel_document("Stock Entry", completed.name, completed.version)
			amended = native_api.amend_document(
				"Stock Entry", cancelled.name, cancelled.version, str(uuid4())
			)
			self.assertEqual(amended["items"][0].conversion_factor, 5)
			self.assertEqual(amended["items"][0].transfer_qty, 10)
			self.assertEqual(amended.amended_from, cancelled.name)
			changed = {"items": [{**amended["items"][0], "conversion_factor": 7}]}
			with self.assertRaises(frappe.PermissionError):
				native_api.save_document("Stock Entry", amended.name, amended.version, changed)

	def test_conversion_save_requires_version_and_duplicate_units_are_rejected(self):
		item = frappe.get_doc("Item", self.item)
		conversions.save_item_conversions(self.item, item.modified, [{"uom": "Nos", "conversion_factor": 1}])
		with self.assertRaises(frappe.TimestampMismatchError):
			conversions.save_item_conversions(self.item, item.modified, [])
		item.reload()
		with self.assertRaises(frappe.ValidationError):
			conversions.save_item_conversions(
				self.item,
				item.modified,
				[
					{"uom": "Nos", "conversion_factor": 1},
					{"uom": "Nos", "conversion_factor": 2},
				],
			)

	def test_nonfinite_and_unknown_conversion_factors_do_not_default_to_one(self):
		for value in (None, 0, -1, "NaN", "Infinity"):
			data = self.movement()
			data["items"][0]["conversion_factor"] = value
			with self.assertRaises(frappe.ValidationError):
				self.create(data)

	def test_guest_and_nonmanager_cannot_use_native_frontend_api(self):
		frappe.set_user("Guest")
		with self.assertRaises(frappe.AuthenticationError):
			native_api.create_document("Stock Entry", str(uuid4()), self.movement())
		frappe.set_user("Administrator")
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-native-{self.token}@example.test",
				"first_name": "Stock user",
				"send_welcome_email": 0,
				"roles": [{"role": "Stock User"}],
			}
		).insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			native_api.create_document("Stock Entry", str(uuid4()), self.movement())

	def count_data(self, actual=None, state="Unreviewed", warehouses=None):
		posting = now_datetime()
		warehouses = warehouses or [self.a]
		baseline = counts.count_baseline(warehouses, str(posting), "Selected", [self.item])
		rows = copy.deepcopy(baseline["rows"])
		for row in rows:
			row.update({"actual_qty": actual, "review_state": state, "reason": "实点差异"})
		return {
			"company": self.company,
			"posting_date": str(posting.date()),
			"posting_time": str(posting.time()),
			"ti_count_warehouses": warehouses,
			"ti_count_scope": "Selected",
			"ti_count_items": [self.item],
			"ti_notes": "盘点说明可持久保存",
			"ti_baseline_timestamp": baseline["timestamp"],
			"ti_baseline_fingerprint": baseline["fingerprint"],
			"ti_count_review": rows,
		}

	def test_matching_count_creates_no_native_document(self):
		self.receipt(10)
		before = frappe.db.count("Stock Reconciliation")
		result = counts.save_count(str(uuid4()), self.count_data(10, "Reviewed"))
		self.assertTrue(result["no_adjustment"])
		self.assertEqual(frappe.db.count("Stock Reconciliation"), before)

	def test_document_display_names_use_current_readable_item_metadata(self):
		entry = self.receipt(10)
		old_name = entry.get("items")[0].item_name
		current_name = f"Renamed Item {self.token}"
		frappe.db.set_value("Item", self.item, "item_name", current_name, update_modified=False)
		serialized_entry = native_api.serialize(frappe.get_doc("Stock Entry", entry.name))
		self.assertEqual(serialized_entry["items"][0]["item_name"], old_name)
		self.assertEqual(serialized_entry["items"][0]["ti_display_item_name"], current_name)

		count = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		serialized_count = native_api.serialize(frappe.get_doc("Stock Reconciliation", count.name))
		self.assertEqual(serialized_count["items"][0]["ti_display_item_name"], current_name)
		self.assertEqual(serialized_count["ti_count_review"][0]["ti_display_item_name"], current_name)

	def test_blank_count_is_unreviewed_and_zero_is_a_deliberate_review(self):
		self.receipt(10)
		with self.assertRaises(frappe.ValidationError):
			counts.save_count(str(uuid4()), self.count_data())
		doc = counts.save_count(str(uuid4()), self.count_data(0, "Reviewed"))
		self.assertEqual(doc["items"][0].qty, 0)
		self.assertEqual(doc.ti_count_review[0].review_state, "Reviewed")
		self.assertEqual(doc.ti_count_review[0].difference, -10)

	def test_same_item_across_locations_posts_one_reconciliation_and_persists_notes(self):
		self.receipt(10)
		self.submit(self.create(self.movement(quantity=5, target=self.b)))
		data = self.count_data(0, "Reviewed", [self.a, self.b])
		data["ti_count_review"][0]["actual_qty"] = 8
		doc = counts.save_count(str(uuid4()), data)
		self.assertEqual(frappe.parse_json(doc.ti_count_warehouses), [self.a, self.b])
		self.assertEqual(doc.ti_notes, "盘点说明可持久保存")
		self.assertEqual(len(doc.get("items")), 2)
		self.assertEqual({row.warehouse: row.qty for row in doc.get("items")}, {self.a: 8, self.b: 0})
		self.assertEqual({row.warehouse for row in doc.ti_count_review}, {self.a, self.b})
		self.assertEqual(len({row.item_code for row in doc.ti_count_review}), 1)

	def test_new_donated_item_uses_native_zero_valuation_without_inventing_a_rate(self):
		data = self.movement(quantity=2)
		del data["items"][0]["basic_rate"]
		completed = self.submit(self.create(data))
		self.assertEqual(completed["items"][0].basic_rate, 0)
		self.assertEqual(get_stock_balance(self.item, self.a), 2)

	def test_count_posts_real_difference_and_keeps_native_valuation(self):
		self.receipt(10)
		doc = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		self.assertEqual(doc["items"][0].valuation_rate, 10)
		native_line, review_line = doc["items"][0].name, doc.ti_count_review[0].name
		data = self.count_data(7, "Reviewed")
		doc = counts.save_count(str(uuid4()), data, doc.name, doc.version)
		self.assertEqual(doc["items"][0].name, native_line)
		self.assertEqual(doc.ti_count_review[0].name, review_line)
		# Restore the original intended actual quantity using the current version.
		doc = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"), doc.name, doc.version)
		completed = native_api.submit_document("Stock Reconciliation", doc.name, doc.version)
		self.assertEqual(completed.docstatus, 1)
		self.assertEqual(get_stock_balance(self.item, self.a), 8)
		self.assertEqual(get_stock_balance(self.item, self.a, with_valuation_rate=True)[1], 10)

	def test_stale_count_baseline_requires_refresh_and_explicit_review(self):
		self.receipt(10)
		data = self.count_data(8, "Reviewed")
		# Deliberately back-date another native movement into the selected baseline.
		self.receipt(2)
		data["ti_baseline_fingerprint"] = "stale"
		with self.assertRaises(frappe.TimestampMismatchError):
			counts.save_count(str(uuid4()), data)
		refreshed = counts.count_baseline(
			[self.a], str(now_datetime()), "Selected", [self.item], data["ti_count_review"]
		)
		self.assertEqual(refreshed["rows"][0]["actual_qty"], 8)
		self.assertEqual(refreshed["rows"][0]["review_state"], "Unreviewed")
		self.assertTrue(refreshed["rows"][0]["needs_review"])

	def test_desk_edit_invalidates_inconsistent_custom_review_metadata(self):
		self.receipt(10)
		created = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		desk = frappe.get_doc("Stock Reconciliation", created.name)
		desk.items[0].qty = 7
		desk.save()
		self.assertFalse(desk.ti_count_review)
		self.assertFalse(desk.ti_baseline_fingerprint)

	def test_display_preferences_validate_complete_values_and_defaults(self):
		from frappe.cache_manager import clear_defaults_cache

		self.addCleanup(clear_defaults_cache, "Administrator")
		self.assertEqual(
			preferences.save_display_preferences("blue", "compact", 175),
			{
				"theme": "blue",
				"density": "compact",
				"textScale": 175,
			},
		)
		self.assertEqual(preferences.display_preferences()["textScale"], 175)
		for values in [
			("pink", "compact", 100),
			("jade", "huge", 100),
			("jade", "balanced", 110),
			("jade", "balanced", True),
		]:
			with self.assertRaises(frappe.ValidationError):
				preferences.save_display_preferences(*values)

	def test_attachments_use_private_originals_and_lock_previous_parent_on_relink(self):
		entry = self.create(self.movement())
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"native-test-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 0,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": entry.name,
			}
		).insert()
		self.assertEqual(file_doc.is_private, 1)
		self.assertTrue(file_doc.file_url.startswith("/private/files/"))
		self.assertEqual(file_doc.make_thumbnail(), file_doc.file_url)
		self.assertEqual(len(native_files.attachments("Stock Entry", entry.name)), 1)
		# File byte cleanup is registered separately from the database rollback.
		from pathlib import Path

		self.addCleanup(lambda: Path(file_doc.get_full_path()).unlink(missing_ok=True))
		completed = self.submit(entry)
		file_doc.attached_to_doctype = "Item"
		file_doc.attached_to_name = self.item
		with self.assertRaises(frappe.PermissionError):
			file_doc.save()
		with self.assertRaises(frappe.PermissionError):
			native_files.remove_attachment("Stock Entry", completed.name, file_doc.name)

	def test_item_delete_removes_attachments_after_parent_row_is_gone(self):
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"item-delete-{self.token}.txt",
				"content": self.token.encode(),
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
			}
		).insert()
		from pathlib import Path

		self.addCleanup(lambda: Path(file_doc.get_full_path()).unlink(missing_ok=True))
		frappe.delete_doc("Item", self.item, ignore_permissions=True, force=True)
		self.assertFalse(frappe.db.exists("File", file_doc.name))
		self.assertFalse(frappe.db.exists("Item", self.item))

	def test_file_owner_does_not_bypass_parent_access_or_anonymous_download_denial(self):
		entry = self.create(self.movement())
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"private-test-{self.token}.txt",
				"content": (self.token + "-private").encode(),
				"is_private": 1,
				"attached_to_doctype": "Stock Entry",
				"attached_to_name": entry.name,
			}
		).insert()
		from pathlib import Path

		self.addCleanup(lambda: Path(file_doc.get_full_path()).unlink(missing_ok=True))
		frappe.set_user("Guest")
		self.assertFalse(file_doc.is_downloadable())
		self.assertFalse(frappe.has_permission("File", "read", doc=file_doc))

	def test_matching_review_of_saved_count_still_requires_current_native_version(self):
		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(9, "Reviewed"))
		data = self.count_data(10, "Reviewed")
		with self.assertRaises(frappe.TimestampMismatchError):
			counts.save_count(str(uuid4()), data, draft.name, "2000-01-01 00:00:00")
		result = counts.save_count(str(uuid4()), data, draft.name, draft.version)
		self.assertTrue(result["no_adjustment"])
		self.assertEqual(frappe.get_doc("Stock Reconciliation", draft.name).items[0].qty, 9)

	def test_current_time_mode_uses_server_clock_at_save_and_confirmation(self):
		from unittest.mock import patch

		from frappe.utils import get_datetime

		data = self.movement(ti_time_mode="Current", posting_date="2020-01-01", posting_time="01:02:03")
		data["items"][0]["ti_allocation_note"] = "原生分配备注"
		clock = get_datetime(nowdate() + " 08:00:01")
		with patch("frappe.utils.now_datetime", return_value=clock):
			draft = self.create(data)
		self.assertEqual(str(draft.posting_date), nowdate())
		self.assertEqual(str(draft.posting_time).zfill(8), "08:00:01")
		later = get_datetime(nowdate() + " 08:00:25")
		with patch("frappe.utils.now_datetime", return_value=later):
			completed = self.submit(draft)
		self.assertEqual(str(completed.posting_time).zfill(8), "08:00:25")
		self.assertEqual(completed["items"][0].ti_allocation_note, "原生分配备注")
		self.assertEqual(self.submit(draft).name, completed.name)

	def test_app_availability_does_not_depend_on_core_negative_stock_preference(self):
		from unittest.mock import patch

		native_getter = frappe.db.get_single_value

		def local_setting(doctype, field, *args, **kwargs):
			if (doctype, field) == ("Stock Settings", "allow_negative_stock"):
				return 1
			return native_getter(doctype, field, *args, **kwargs)

		# Only this process sees the alternate preference. No site setting is written.
		with patch.object(frappe.db, "get_single_value", side_effect=local_setting):
			self.receipt(5)
			data = self.movement("Issue", 3, self.a)
			data["items"].append(dict(data["items"][0]))
			with self.assertRaises(frappe.ValidationError):
				self.create(data)
			draft = self.create(self.movement("Issue", 4, self.a))
			self.submit(self.create(self.movement("Issue", 2, self.a)))
			with self.assertRaises(frappe.ValidationError):
				self.submit(draft)


def run():
	result = unittest.TextTestRunner(verbosity=2).run(
		unittest.defaultTestLoader.loadTestsFromTestCase(NativeDocumentTests)
	)
	if not result.wasSuccessful():
		raise AssertionError(
			f"Native integration failed: {len(result.failures)} failures, {len(result.errors)} errors"
		)
	return {"tests": result.testsRun, "failures": 0, "errors": 0}
