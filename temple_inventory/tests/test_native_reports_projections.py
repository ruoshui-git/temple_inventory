"""Report/export contracts exercised against real native stock and permissions."""

import copy
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.utils import nowdate

from temple_inventory import browse, counts, exports, native_api, warehouses
from temple_inventory.projections import (
	Projection,
	group_count_metadata,
	group_page,
	report_page,
)
from temple_inventory.report_query import validate_query
from temple_inventory.tests.helpers import NativeReportTestCase
from temple_inventory.warehouse_names import DIRECT_STORAGE_SUFFIX


class NativeReportsProjectionsTests(NativeReportTestCase):
	def test_dashboard_distribution_reports_only_authorized_enabled_empty_leaves(self):
		self.submit(self.create(self.movement(target=self.a)))
		room_label = f"Native Test C Room {self.token}"
		warehouses.create_location("Room", room_label, self.physical)
		room = frappe.get_value(
			"Warehouse", {"company": self.company, "ti_label": room_label, "ti_direct_storage": 0}, "name"
		)
		empty_leaf = frappe.get_value("Warehouse", {"parent_warehouse": room, "ti_direct_storage": 1}, "name")
		settings = frappe.get_single("Temple Inventory Settings")
		settings.append("allowed_warehouses", {"warehouse": empty_leaf})
		settings.save()
		warehouse = frappe.get_doc("Warehouse", self.b)
		warehouse.disabled = 1
		warehouse.save()

		result = browse.dashboard_card("distribution", refresh=True)
		self.assertEqual(result["empty_count"], len(result["empty_labels"]))
		self.assertEqual(result["empty_labels"], [room_label])
		self.assertNotIn(f"Native Test B Room {self.token}", result["empty_labels"])
		self.assertNotIn(f"Native Test Lease Leaf {self.token}", result["empty_labels"])
		self.assertNotIn(f"Native Test Damaged {self.token}", result["empty_labels"])

	def test_location_presenter_labels_direct_leaves_and_disambiguates_duplicate_rooms(self):
		from temple_inventory.native_topology import present_locations

		settings = frappe._dict(root_warehouse="ROOT", physical_root_warehouse="PHYSICAL")
		rows = {
			"ROOT": frappe._dict(
				name="ROOT", warehouse_name="寺院仓库", ti_label="寺院仓库", parent_warehouse="", is_group=1
			),
			"PHYSICAL": frappe._dict(
				name="PHYSICAL",
				warehouse_name="实体库房",
				ti_label="实体库房",
				parent_warehouse="ROOT",
				is_group=1,
			),
			"AREA-1": frappe._dict(
				name="AREA-1",
				warehouse_name="T1",
				ti_label="第一寺院",
				ti_short_label="T1",
				parent_warehouse="PHYSICAL",
				warehouse_type="Area",
				is_group=1,
			),
			"AREA-2": frappe._dict(
				name="AREA-2",
				warehouse_name="T2",
				ti_label="第二寺院",
				ti_short_label="T2",
				parent_warehouse="PHYSICAL",
				warehouse_type="Area",
				is_group=1,
			),
			"ROOM-1": frappe._dict(
				name="ROOM-1",
				warehouse_name="T1 / A14",
				ti_label="A14",
				parent_warehouse="AREA-1",
				warehouse_type="Room",
				is_group=1,
			),
			"ROOM-2": frappe._dict(
				name="ROOM-2",
				warehouse_name="T2 / A14",
				ti_label="A14",
				parent_warehouse="AREA-2",
				warehouse_type="Room",
				is_group=1,
			),
			"DIRECT-1": frappe._dict(
				name="DIRECT-1",
				warehouse_name=f"T1 / A14{DIRECT_STORAGE_SUFFIX}",
				ti_label="A14",
				parent_warehouse="ROOM-1",
				warehouse_type="",
				is_group=0,
				ti_direct_storage=1,
			),
			"DIRECT-2": frappe._dict(
				name="DIRECT-2",
				warehouse_name=f"T2 / A14{DIRECT_STORAGE_SUFFIX}",
				ti_label="A14",
				parent_warehouse="ROOM-2",
				warehouse_type="",
				is_group=0,
				ti_direct_storage=1,
			),
		}
		presented = {row["name"]: row for row in present_locations(rows, settings=settings)}
		self.assertEqual(presented["DIRECT-1"]["label"], presented["ROOM-1"]["label"])
		self.assertIn("T1", presented["ROOM-1"]["label"])
		self.assertIn("T2", presented["ROOM-2"]["label"])
		self.assertTrue(presented["DIRECT-1"]["storable"])
		self.assertEqual(presented["ROOM-1"]["path"], "T1 / A14")

	def test_repeated_allocations_authorize_item_images_once_per_report_context(self):
		from temple_inventory.native_files import attachments

		data = self.movement(quantity=1)
		data["items"] *= 12
		created = self.create(data)
		query = self.query("movements", "lines", record=created["name"], statuses=[0])
		with patch("temple_inventory.native_files.attachments", wraps=attachments) as image_reads:
			page = report_page(query)
		self.assertEqual(page["matched_count"], 12)
		self.assertIn("image", page["rows"][0])
		self.assertEqual(image_reads.call_count, 0)
		# ReportContext batches private File reads rather than scanning attachments
		# once per repeated allocation. Its authorization cache is request-local.
		with patch("temple_inventory.native_files.attachments", wraps=attachments) as image_reads:
			self.assertEqual(report_page(query)["matched_count"], 12)
		self.assertEqual(image_reads.call_count, 0)

	def test_group_by_contract_rejects_retired_duplicate_unsupported_and_third_fields(self):
		query = self.query("inventory", "summary")
		self.assertEqual(
			validate_query({**query, "groupBy": ["category", "item"]})["groupBy"],
			["category", "item"],
		)
		self.assertEqual(validate_query({**query, "sortBy": "available"})["sortBy"], "available")
		with self.assertRaises(Exception):
			validate_query({**query, "sortBy": "image"})
		for legacy in ("quantity", "name", "batch"):
			with self.assertRaises(Exception):
				validate_query({**query, "sortBy": legacy})
		with self.assertRaises(Exception):
			validate_query(self.query("movements", "records", sortBy="stock_qty"))
		for dataset, view, fields in (
			(
				"movements",
				"lines",
				("document", "doctype", "borrower", "source_warehouse", "destination_warehouse"),
			),
			(
				"loans",
				"outcomes",
				(
					"document",
					"doctype",
					"kind",
					"docstatus",
					"borrower",
					"source_warehouse",
					"destination_warehouse",
				),
			),
		):
			for field in fields:
				self.assertEqual(validate_query(self.query(dataset, view, sortBy=field))["sortBy"], field)
		for changes in (
			{"grouping": "item"},
			{"groupBy": ["item", "item"]},
			{"groupBy": ["category", "location"]},
			{"groupBy": ["category", "item", "location"]},
		):
			with self.assertRaises(Exception):
				validate_query({**query, **changes})
		self.assertEqual(
			validate_query({**query, "groupBy": ["item", "category"]})["groupBy"],
			["item", "category"],
		)
		for dataset, view, invalid, _valid in (
			("movements", "summary", ["category"], ["category", "item"]),
			("loans", "items", ["item", "category"], ["category", "item"]),
		):
			with self.assertRaises(Exception):
				validate_query(self.query(dataset, view, groupBy=invalid))
		self.assertEqual(
			validate_query(self.query("loans", "items", groupBy=["item"]))["groupBy"],
			["item"],
		)

	def test_movement_groups_keep_kind_status_quantities_and_distinct_item_union(self):
		self.receipt(8)
		issue = self.movement("Issue", 3, self.a, None)
		self.submit(self.create(issue))
		query = self.query("movements", "lines", groupBy=["item"])
		page = report_page(query)
		self.assertEqual(page["matched_count"], 1)
		group = page["rows"][0]
		self.assertEqual(group["item_count"], 1)
		self.assertEqual(group["document_count"], 2)
		self.assertIsNone(group["stock_qty"])
		self.assertEqual(
			{(part["kind"], part["docstatus"]) for part in group["quantity_breakdown"]},
			{("Receive", 1), ("Issue", 1)},
		)
		by_kind = {part["kind"]: part for part in group["quantity_breakdown"]}
		self.assertEqual(by_kind["Receive"]["stock_qty"], 8)
		self.assertEqual(by_kind["Issue"]["stock_qty"], 3)
		self.assertEqual(by_kind["Receive"]["available_effect"], 8)
		self.assertEqual(by_kind["Issue"]["available_effect"], -3)
		self.assertEqual(page["summary"], report_page({**query, "groupBy": []})["summary"])

	def test_group_details_use_constant_queries_for_any_group_count(self):
		def grouped(group_count):
			with Projection(self.query("movements", "lines")) as projection:
				for index in range(group_count * 3):
					group = f"G{index % group_count:03d}"
					projection.put(
						"group_source",
						{
							"id": f"row-{index}",
							"item_code": group,
							"stock_uom": "Nos",
							"kind": ("Receive", "Issue")[index // group_count % 2],
							"docstatus": 1,
							"stock_qty": index + 1,
							"available_effect": index + 1,
							"document_id": f"doc-{index}",
							"item_codes": [group, f"{group}-extra"],
						},
					)
				statements = []
				projection.db.set_trace_callback(statements.append)
				projection.group("group_source", "grouped", ("item_code", "stock_uom"), ("stock_qty",))
				projection.db.set_trace_callback(None)
				rows = {row["item_code"]: row for row in projection.rows("grouped")}
				reads = [sql for sql in statements if sql.lstrip().lower().startswith("select")]
				return rows, len(reads)

		_small, small_reads = grouped(2)
		large, large_reads = grouped(40)
		self.assertEqual(small_reads, large_reads)
		self.assertEqual(len(large), 40)
		for code, row in large.items():
			self.assertEqual(row["item_count"], 2, code)
			parts = {part["kind"]: part for part in row["quantity_breakdown"]}
			self.assertEqual(set(parts), {"Receive", "Issue"}, code)
			self.assertEqual(sum(part["allocation_count"] for part in parts.values()), 3, code)
			self.assertEqual(sum(part["document_count"] for part in parts.values()), 3, code)
		first = large["G000"]["quantity_breakdown"]
		# Rows 0, 40 and 80 belong to G000: 0 and 80 are receipts, 40 is an issue.
		self.assertEqual({part["kind"]: part["stock_qty"] for part in first}, {"Receive": 82, "Issue": 41})

	def test_group_projection_merges_units_and_counts_native_documents_once(self):
		query = self.query("movements", "records", groupBy=["kind"])
		with Projection(query) as projection:
			projection.add(
				"group_source",
				[
					{
						"id": "same-document-nos",
						"item_code": self.item,
						"document_id": "STE-GROUP-1",
						"kind": "Receive",
						"docstatus": 1,
						"stock_uom": "Nos",
						"stock_qty": 12,
						"available_effect": 12,
					},
					{
						"id": "same-document-box",
						"item_code": self.item,
						"document_id": "STE-GROUP-1",
						"kind": "Receive",
						"docstatus": 1,
						"stock_uom": "Box",
						"stock_qty": 3,
						"available_effect": 3,
					},
				],
			)
			projection.group(
				"group_source",
				"grouped",
				("kind",),
				("stock_qty", "available_effect"),
				unit_field="stock_uom",
			)
			rows = list(projection.rows("grouped"))
			self.assertEqual(len(rows), 1)
			row = rows[0]
			self.assertEqual(row["row_count"], 2)
			self.assertEqual(row["document_count"], 1)
			self.assertEqual(group_count_metadata(query, row)["display_count"], 1)
			self.assertEqual(
				{unit["stock_uom"]: unit["available_effect"] for unit in row["unit_totals"]},
				{"Nos": 12, "Box": 3},
			)

	def test_two_level_group_pages_include_full_authorized_groups_then_lazy_children(self):
		self.receipt(4)
		query = self.query("inventory", "summary", groupBy=["category", "item"])
		with self.assertRaises(Exception):
			report_page(query, table="group_source")
		page = report_page(query, page_length=1)
		self.assertEqual(page["table"], "group_roots")
		self.assertEqual(page["rows"][0]["group_path"], [""])
		self.assertEqual(page["rows"][0]["row_count"], 1)
		self.assertEqual(page["rows"][0]["allocation_count"], 0)
		roots = group_page(query, parent_path=[], page_length=1)
		self.assertEqual(roots["row_grain"], "group")
		self.assertEqual(roots["rows"][0]["group_path"], [""])
		children = group_page(
			query,
			parent_path=[""],
			page_length=1,
		)
		self.assertEqual(children["rows"][0]["group_path"], ["", self.item])
		allocations = group_page(
			query,
			parent_path=["", self.item],
			page_length=1,
		)
		self.assertEqual(allocations["row_grain"], "stock")
		self.assertEqual(allocations["matched_count"], 1)

	def test_grouped_report_leaf_columns_are_curated_and_item_groups_include_authorized_images(self):
		self.receipt(4)
		image = "/files/grouped-item-preview.png"
		frappe.db.set_value("Item", self.item, "image", image)
		query = self.query("inventory", "summary", groupBy=["item"])
		page = report_page(query)
		self.assertNotIn("image", page["leaf_columns"])
		self.assertNotIn("batch_tracked", page["leaf_columns"])
		self.assertIn("category", page["leaf_columns"])
		self.assertEqual(page["rows"][0]["image"], image)
		groups = group_page(query, parent_path=[])
		self.assertEqual(groups["rows"][0]["item_code"], self.item)
		self.assertEqual(groups["rows"][0]["image"], image)

	def test_group_page_merges_same_group_path_across_native_units(self):
		self.receipt(5)
		uom_name = "TIUOM-" + self.token
		frappe.get_doc({"doctype": "UOM", "uom_name": uom_name}).insert()
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "TI-UNIT-" + self.token,
				"item_name": "Native test item in alternate unit",
				"stock_uom": uom_name,
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		data = self.movement(quantity=7)
		data["items"][0].update({"item_code": other.name, "uom": uom_name, "conversion_factor": 1})
		self.submit(self.create(data))
		query = self.query("inventory", "summary", groupBy=["category", "item"])
		query["scope"]["item"] = ""
		roots = group_page(query, parent_path=[], page_length=1)
		self.assertEqual(roots["matched_count"], 1)
		self.assertIsNone(roots["next_start"])
		root = roots["rows"][0]
		self.assertEqual(len(root["unit_totals"]), 2)
		children = group_page(query, parent_path=root["group_path"], page_length=10)
		self.assertEqual(children["matched_count"], 2)
		self.assertEqual(len({row["group_label"] for row in children["rows"]}), 2)
		for leaf in children["rows"]:
			allocations = group_page(query, parent_path=leaf["group_path"], page_length=10)
			self.assertEqual(allocations["matched_count"], 1)
			self.assertEqual(allocations["rows"][0]["item_code"], leaf["item_code"])
		item_class = type(frappe.get_doc("Item", other.name))
		check_permission = item_class.check_permission

		def denied_item(item_doc, *args, **kwargs):
			if item_doc.name == other.name:
				raise frappe.PermissionError("Alternate unit Item denied")
			return check_permission(item_doc, *args, **kwargs)

		with patch.object(item_class, "check_permission", denied_item):
			restricted = group_page(query, parent_path=[], page_length=10)
			self.assertEqual(restricted["matched_count"], 1)
			self.assertNotIn(
				uom_name,
				[row["stock_uom"] for row in restricted["rows"][0]["unit_totals"]],
			)

	def test_grouped_native_records_keep_full_document_quantities_after_line_matching(self):
		uom = "TI-RECORD-UOM-" + self.token
		frappe.get_doc({"doctype": "UOM", "uom_name": uom}).insert()
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "TI-RECORD-" + self.token,
				"item_name": "Second native record item",
				"stock_uom": uom,
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		data = self.movement(quantity=5)
		data["items"].append(
			{
				**data["items"][0],
				"item_code": other.name,
				"uom": uom,
				"conversion_factor": 1,
				"qty": 7,
			}
		)
		doc = self.submit(self.create(data))
		record_query = self.query("movements", "records", record=doc.name, statuses=[1])
		record_query["scope"]["item"] = ""
		records = report_page(record_query)
		self.assertEqual(records["matched_count"], 2)
		self.assertEqual(sum(row["allocation_count"] for row in records["rows"]), 2)
		self.assertEqual(sum(row["item_count"] for row in records["rows"]), 2)
		group_query = {**record_query, "groupBy": ["kind"]}
		grouped = report_page(group_query)
		self.assertIsNone(grouped["rows"][0]["stock_qty"])
		self.assertEqual(grouped["rows"][0]["document_count"], 1)
		self.assertEqual(len(grouped["rows"][0]["unit_totals"]), 2)
		child_records = group_page(group_query, parent_path=["Receive"])
		self.assertEqual(child_records["row_grain"], "record")
		self.assertEqual(child_records["matched_count"], 1)
		self.assertEqual(child_records["rows"][0]["item_count"], 2)
		self.assertEqual(len(child_records["rows"][0]["unit_totals"]), 2)
		matching_lines = report_page(self.query("movements", "lines", record=doc.name, statuses=[1]))
		self.assertEqual(matching_lines["matched_count"], 1)
		self.submit(self.create(self.movement(quantity=2)))
		overlapping = report_page(self.query("movements", "records", statuses=[1], groupBy=["kind"]))
		self.assertEqual(overlapping["rows"][0]["document_count"], 2)
		self.assertEqual(overlapping["rows"][0]["item_count"], 2)
		self.assertEqual(len(overlapping["rows"][0]["unit_totals"]), 2)

	def test_item_tracking_and_enabled_status_match_catalog_flags(self):
		from types import SimpleNamespace

		from temple_inventory.report_sources import ReportContext

		context = ReportContext(self.query("inventory", "summary"))
		item = SimpleNamespace(
			name=self.item,
			item_group="All Item Groups",
			has_batch_no=1,
			has_expiry_date=1,
			disabled=0,
			check_permission=lambda *_args, **_kwargs: None,
		)
		context._preloaded_items = {self.item: item}
		self.assertTrue(context.matches_item(self.item))
		context.scope["tracking"] = "batch"
		self.assertTrue(context.matches_item(self.item))
		context.scope["tracking"] = "none"
		self.assertFalse(context.matches_item(self.item))
		context.scope["tracking"] = "batch_only"
		self.assertFalse(context.matches_item(self.item))
		context.scope["tracking"] = "expiry"
		self.assertTrue(context.matches_item(self.item))
		context.query["itemStatus"] = "disabled"
		self.assertFalse(context.matches_item(self.item))

	def test_source_document_event_advances_revision_inside_its_transaction(self):
		from temple_inventory import read_cache

		def get_revision():
			rows = frappe.db.sql(
				"select value from tabSingles where doctype=%s and field='ti_read_generation'",
				("Temple Inventory Settings",),
				as_dict=True,
			)
			return int(rows[0].value) if rows else 0

		before = get_revision()
		frappe.db.savepoint("ti_source_cache_hook")
		after_commit = frappe.db.after_commit
		after_rollback = frappe.db.after_rollback
		commit_callbacks = list(after_commit._functions)
		rollback_callbacks = list(after_rollback._functions)
		old_scheduled = getattr(frappe.local, "inventory_cache_dirty_scheduled", False)
		old_touched = getattr(frappe.local, "inventory_cache_revision_touched", False)
		try:
			frappe.local.inventory_cache_dirty_scheduled = False
			frappe.local.inventory_cache_revision_touched = False
			read_cache.invalidate_after_commit(frappe._dict(doctype="Item"), "on_update")
			self.assertEqual(get_revision(), before + 1)
			self.assertEqual(len(after_commit._functions), len(commit_callbacks) + 1)
			frappe.db.rollback(save_point="ti_source_cache_hook")
			self.assertEqual(get_revision(), before)
		finally:
			after_commit._functions.clear()
			after_commit._functions.extend(commit_callbacks)
			after_rollback._functions.clear()
			after_rollback._functions.extend(rollback_callbacks)
			frappe.local.inventory_cache_dirty_scheduled = old_scheduled
			frappe.local.inventory_cache_revision_touched = old_touched

	def test_permission_signature_tracks_persisted_role_revocation(self):
		from frappe.cache_manager import clear_defaults_cache

		from temple_inventory import read_cache

		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-cache-role-{self.token}@example.test",
				"first_name": "Cache permission owner",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": "System Manager"}, {"role": "Stock User"}],
			}
		).insert()
		self.addCleanup(clear_defaults_cache, user.name)
		before = read_cache._permission_signature(user.name)
		user.set("roles", [{"role": "Stock User"}])
		user.save()
		after = read_cache._permission_signature(user.name)
		self.assertNotEqual(before, after)
		# Simulate a warm Frappe role list from before the revoke. The app gate
		# must still deny the next read using the current database grants.
		from temple_inventory.native_access import require_frontend_account

		previous_user = frappe.session.user
		try:
			frappe.set_user(user.name)
			with patch("frappe.get_roles", return_value=["System Manager", "Stock User"]):
				with self.assertRaises(frappe.PermissionError):
					require_frontend_account()
		finally:
			frappe.set_user(previous_user)

	def test_native_pagination_and_complete_unit_summary_are_independent(self):
		data = self.movement(quantity=1)
		data["items"] = [copy.deepcopy(data["items"][0]) for _ in range(205)]
		entry = self.submit(self.create(data))
		query = self.query("movements", "lines", record=entry.name)
		first = report_page(query, page_length=30)
		self.assertEqual(len(first["rows"]), 30)
		self.assertEqual(first["matched_count"], 205)
		self.assertEqual(first["next_start"], 30)
		self.assertEqual(sum(row["stock_qty"] for row in first["summary"]), 205)
		last = report_page(query, start=200, page_length=30)
		self.assertEqual(len(last["rows"]), 5)
		self.assertIsNone(last["next_start"])
		self.assertFalse({row["id"] for row in first["rows"]} & {row["id"] for row in last["rows"]})

	def test_current_stock_does_not_ignore_transaction_only_context(self):
		entry = self.receipt(5)
		self.assertGreater(report_page(self.query())["matched_count"], 0)
		for scope in (
			{"kinds": ["Receive"]},
			{"sources": [self.a]},
			{"destinations": [self.a]},
			{"activity": self.activity.name},
		):
			query = self.query(scope={"item": self.item, "warehouses": [self.root], **scope})
			self.assertEqual(report_page(query)["matched_count"], 0, scope)
		for restriction in ({"record": entry.name}, {"loan": entry.name}):
			self.assertEqual(report_page(self.query(**restriction))["matched_count"], 0)

	def test_historical_stock_has_both_transfer_branches_and_one_reconciliation_adjustment(self):
		self.receipt(10)
		self.submit(self.create(self.movement("Transfer", 3, self.a, self.b)))
		doc = counts.save_count(str(uuid4()), self.count_data(5, "Reviewed"))
		native_api.submit_document("Stock Reconciliation", doc.name, doc.version)
		query = self.query("inventory", "historical")
		query["scope"]["period"] = {"key": "custom", "from": nowdate(), "to": nowdate()}
		result = report_page(query)
		rows = {row["warehouse"]: row for row in result["rows"]}
		self.assertEqual(rows[self.a]["closing"], 5)
		self.assertEqual(rows[self.b]["closing"], 3)
		self.assertEqual(sum(row["adjustment"] for row in rows.values()), -2)
		for row in rows.values():
			self.assertEqual(
				row["opening"] + row["incoming"] - row["outgoing"] + row["adjustment"], row["closing"]
			)
		ledger = report_page(query, table="ledger")
		self.assertEqual(len([row for row in ledger["rows"] if row["document"] == doc.name]), 1)
		query["scope"]["warehouses"] = [self.a]
		self.assertEqual(report_page(query)["rows"][0]["closing"], 5)

	def test_counts_report_contains_only_actual_native_reconciliations(self):
		self.receipt(10)
		counts.save_count(str(uuid4()), self.count_data(10, "Reviewed"))
		self.assertEqual(report_page(self.query("counts"))["matched_count"], 0)
		doc = counts.save_count(str(uuid4()), self.count_data(9, "Reviewed"))
		native_api.submit_document("Stock Reconciliation", doc.name, doc.version)
		rows = report_page(self.query("counts", "lines"))["rows"]
		self.assertEqual(rows[0]["difference"], -1)
		self.assertEqual(rows[0]["review_state"], "Reviewed")
		self.assertTrue({"baseline_qty", "actual_qty", "difference", "reason", "stock_uom"}.issubset(rows[0]))
		movement = browse.operation_page(
			self.query(
				"movements",
				"records",
				record=doc.name,
				recordDoctype="Stock Reconciliation",
				statuses=[1],
			),
			records=True,
		)["rows"][0]
		self.assertEqual(movement["whole"]["available_effects"], [{"uom": "Nos", "qty": -1}])

	def test_opening_reconciliation_available_effect_uses_opening_quantity(self):
		account = frappe.db.get_value(
			"Account", {"company": self.company, "account_name": "Temporary Opening"}, "name"
		)
		doc = frappe.get_doc(
			{
				"doctype": "Stock Reconciliation",
				"company": self.company,
				"purpose": "Opening Stock",
				"expense_account": account,
				"posting_date": nowdate(),
				"items": [
					{
						"item_code": self.item,
						"warehouse": self.a,
						"qty": 7,
						"valuation_rate": 10,
					}
				],
			}
		).insert()
		doc.submit()
		row = browse.operation_page(
			self.query(
				"movements",
				"records",
				record=doc.name,
				recordDoctype="Stock Reconciliation",
				statuses=[1],
			),
			records=True,
		)["rows"][0]
		self.assertEqual(row["whole"]["quantities"], [{"uom": "Nos", "qty": 7}])
		self.assertEqual(row["whole"]["available_effects"], [{"uom": "Nos", "qty": 7}])
		self.assertIn(self.a, row["whole"]["scope"])
		count_page = browse.counts_page(self.query("counts", "records", statuses=[1]))
		opening_row = next(row for row in count_page["rows"] if row["document"] == doc.name)
		self.assertEqual(opening_row["kind"], "Opening")
		self.assertEqual(opening_row["whole"]["gains"], [{"uom": "Nos", "qty": 7}])
		self.assertEqual(opening_row["whole"]["quantities"], [{"uom": "Nos", "qty": 7}])

	def test_worker_uses_request_owner_and_fails_if_account_is_disabled_during_generation(self):
		from frappe.cache_manager import clear_defaults_cache

		self.receipt()
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-worker-{self.token}@example.test",
				"first_name": "Worker owner",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": "System Manager"}, {"role": "Stock Manager"}, {"role": "Stock User"}],
			}
		).insert()
		self.addCleanup(clear_defaults_cache, user.name)
		frappe.set_user(user.name)
		with patch("temple_inventory.exports._enqueue"):
			request = exports.request_export(self.query(), "summary", export_format="csv")
		frappe.set_user("Administrator")
		write = exports._write

		def revoke_after_write(projection, doc, path):
			self.assertEqual(frappe.session.user, user.name)
			count = write(projection, doc, path)
			frappe.db.set_value("User", user.name, "enabled", 0)
			return count

		# Exercise the real worker/permission/write pipeline in this test's outer
		# savepoint; suppress only its transaction boundaries, never authorization.
		with (
			patch("frappe.db.commit"),
			patch("frappe.db.rollback"),
			patch("temple_inventory.exports._write", side_effect=revoke_after_write) as writer,
			patch("temple_inventory.exports._private_file") as private_file,
		):
			exports.generate_export(request["name"])
		self.assertEqual(frappe.session.user, "Administrator")
		writer.assert_called_once()
		private_file.assert_not_called()
		failed = frappe.get_doc("Inventory Export Request", request["name"])
		self.assertEqual(failed.status, "Failed")
		self.assertFalse(failed.output_file)
		self.assertFalse(failed.access_manifest)
