"""Report/export contracts exercised against real native stock and permissions."""

import copy
import csv
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.utils import nowdate
from openpyxl import load_workbook

from temple_inventory import activities, catalog, counts, exports, native_api, preferences
from temple_inventory.projections import Projection, report_page
from temple_inventory.report_query import DEFINITIONS, validate_query
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class NativeReportTests(NativeDocumentTests):
	def test_refinement_display_labels_preserve_native_identity_and_export_audit_values(self):
		frappe.db.set_value("Warehouse", self.a, "warehouse_name", "供灯-用品")
		doc = self.submit(self.create(self.movement(quantity=2)))
		query = self.query("movements", "lines", record=doc.name, statuses=[1])
		with Projection(query) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			row = next(projection.rows("lines"))
			self.assertEqual(row["docstatus"], 1)
			self.assertEqual(row["docstatus_label"], "已提交")
			self.assertEqual(row["destination_warehouse"], self.a)
			self.assertEqual(row["destination_warehouse_label"], "供灯-用品")
			self.assertEqual(projection.context.label("inaccessible-warehouse"), "")
			path = Path(directory) / "labels.csv"
			exports._write(projection, frappe._dict(tables_json='["lines"]', export_format="csv"), path)
			with path.open(encoding="utf-8-sig", newline="") as stream:
				values = next(csv.DictReader(stream))
			self.assertEqual(values["状态"], "已提交")
			self.assertEqual(values["状态值（ERPNext）"], "1")  # noqa: RUF001
			self.assertEqual(values["目标位置"], "供灯-用品")
			self.assertEqual(values["目标位置（ERPNext 名称）"], self.a)  # noqa: RUF001

	def test_repeated_allocations_authorize_item_images_once_per_report_context(self):
		from temple_inventory.native_files import attachments

		data = self.movement(quantity=1)
		data["items"] *= 12
		created = self.create(data)
		query = self.query("movements", "lines", record=created["name"], statuses=[0])
		with patch("temple_inventory.native_files.attachments", wraps=attachments) as image_reads:
			page = report_page(query)
		self.assertEqual(page["matched_count"], 12)
		self.assertEqual(image_reads.call_args_list, [unittest.mock.call("Item", self.item)])
		# The cache must not outlive the request/context or retain another account's
		# authorization. A second projection performs its own native File check.
		with patch("temple_inventory.native_files.attachments", wraps=attachments) as image_reads:
			self.assertEqual(report_page(query)["matched_count"], 12)
		self.assertEqual(image_reads.call_count, 1)

	def test_desk_multi_batch_count_retains_per_batch_baseline_zero_actual_and_cancelled_provenance(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batches = []
		for suffix in ("A", "B"):
			batch = catalog.create_batch(self.item, "TI-COUNT-MULTI-" + self.token + suffix)["name"]
			batches.append(batch)
			data = self.movement(quantity=5)
			data["items"][0].update({"batch_no": batch, "use_serial_batch_fields": 1})
			self.submit(self.create(data))
		posting = frappe.utils.now_datetime()
		bundle = frappe.get_doc(
			{
				"doctype": "Serial and Batch Bundle",
				"voucher_type": "Stock Reconciliation",
				"company": self.company,
				"item_code": self.item,
				"warehouse": self.a,
				"type_of_transaction": "Inward",
				"posting_datetime": posting,
				"entries": [{"batch_no": batches[0], "qty": 3}],
			}
		).insert()
		doc = frappe.get_doc(
			{
				"doctype": "Stock Reconciliation",
				"company": self.company,
				"purpose": "Stock Reconciliation",
				"posting_date": posting.date(),
				"posting_time": posting.time(),
				"set_posting_time": 1,
				"items": [
					{
						"item_code": self.item,
						"warehouse": self.a,
						"qty": 3,
						"serial_and_batch_bundle": bundle.name,
						"use_serial_batch_fields": 0,
						"reconcile_all_serial_batch": 1,
					}
				],
			}
		).insert()
		doc.submit()
		loaded = native_api.load_document("Stock Reconciliation", doc.name)
		self.assertEqual(
			{
				row["batch_no"]: (row["baseline_qty"], row["actual_qty"])
				for row in loaded["items"][0].recorded_count_allocations
			},
			{batches[0]: (5, 3), batches[1]: (5, 0)},
		)
		query = self.query("counts", "lines", record=doc.name, statuses=[1])
		before = report_page(query)
		self.assertEqual(before["matched_count"], 2)
		self.assertEqual(
			{
				row["batch_no"]: (row["baseline_qty"], row["actual_qty"], row["difference"])
				for row in before["rows"]
			},
			{batches[0]: (5, 3, -2), batches[1]: (5, 0, -5)},
		)
		movements = report_page(self.query("movements", "lines", record=doc.name, statuses=[1]))
		self.assertEqual(
			{row["batch_no"]: row["stock_qty"] for row in movements["rows"]}, {batches[0]: -2, batches[1]: -5}
		)
		cancelled = native_api.cancel_document("Stock Reconciliation", doc.name, str(doc.modified))
		self.assertEqual(
			cancelled["items"][0].recorded_count_allocations, loaded["items"][0].recorded_count_allocations
		)
		query["statuses"] = [2]
		after = report_page(query)
		fields = (
			"id",
			"line_name",
			"batch_no",
			"baseline_qty",
			"actual_qty",
			"difference",
			"bundle_line",
			"current_bundle_line",
		)
		self.assertEqual(
			[{key: row.get(key) for key in fields} for row in after["rows"]],
			[{key: row.get(key) for key in fields} for row in before["rows"]],
		)
		self.assertTrue(all(row["docstatus"] == 2 for row in after["rows"]))
		batch_class = type(frappe.get_doc("Batch", batches[1]))
		check = batch_class.check_permission

		def permission(batch_doc, *args, **kwargs):
			if batch_doc.name == batches[1]:
				raise frappe.PermissionError("Baseline Batch denied")
			return check(batch_doc, *args, **kwargs)

		with patch.object(batch_class, "check_permission", permission):
			with self.assertRaises(frappe.PermissionError):
				native_api.load_document("Stock Reconciliation", cancelled.name)
			self.assertEqual(report_page(query)["matched_count"], 0)

	def test_cancelled_batch_records_retain_native_allocation_ids_and_batch_permissions(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, "TI-CANCEL-" + self.token)
		data = self.movement(quantity=4)
		data["items"][0].update({"batch_no": batch["name"], "use_serial_batch_fields": 1})
		completed = self.submit(self.create(data))
		query = self.query("movements", "lines", record=completed.name, statuses=[1])
		before = report_page(query)
		self.assertEqual(before["rows"][0]["batch_no"], batch["name"])
		cancelled = native_api.cancel_document("Stock Entry", completed.name, completed.version)
		query["statuses"] = [2]
		after = report_page(query)
		self.assertEqual(after["matched_count"], 1)
		self.assertEqual(after["rows"][0]["batch_no"], batch["name"])
		self.assertEqual(after["rows"][0]["bundle_line"], before["rows"][0]["bundle_line"])
		self.assertEqual(after["rows"][0]["stock_qty"], 4)
		self.assertEqual(cancelled["items"][0].recorded_bundle, completed["items"][0].recorded_bundle)
		self.assertEqual(
			cancelled["items"][0].recorded_batch_allocations, completed["items"][0].recorded_batch_allocations
		)
		batch_class = type(frappe.get_doc("Batch", batch["name"]))
		with patch.object(
			batch_class, "check_permission", side_effect=frappe.PermissionError("Batch denied")
		):
			with self.assertRaises(frappe.PermissionError):
				native_api.load_document("Stock Entry", cancelled.name)
			self.assertEqual(report_page(query)["matched_count"], 0)

	def query(self, dataset="inventory", view=None, **changes):
		value = {"dataset": dataset, "scope": {"item": self.item, "warehouses": [self.root]}}
		if view:
			value["view"] = view
		if view == "historical":
			value["scope"]["period"] = {"key": "this_month", "from": "", "to": ""}
		return validate_query({**value, **changes})

	def test_six_datasets_and_all_views_have_complete_native_page_contracts(self):
		self.receipt()
		for dataset, definition in DEFINITIONS.items():
			for view in definition["views"]:
				query = self.query(dataset, view)
				if view == "historical":
					query["scope"]["period"] = {"key": "this_month", "from": "", "to": ""}
				result = report_page(query, page_length=1)
				self.assertIn("matched_count", result)
				self.assertIn("snapshot", result)
				self.assertTrue(result["columns"])
				self.assertNotIn("id", result["columns"])
				for table in result["tables"]:
					self.assertNotIn("id", report_page(query, table=table["id"])["columns"])
				self.assertEqual(result["query"]["dataset"], dataset)
				grouped = report_page({**query, "grouping": definition["groups"][0]})
				self.assertEqual(grouped["table"], "grouped")
				self.assertNotIn("id", grouped["columns"])
				if grouped["rows"] and definition["groups"][0] == "item":
					self.assertIn("item_name", grouped["columns"])
					self.assertTrue(grouped["rows"][0]["item_name"])

	def test_saved_record_scope_requires_exact_doctype_name_and_status(self):
		self.receipt(10)
		for doctype, dataset in (("Stock Entry", "movements"), ("Stock Reconciliation", "counts")):
			draft = (
				self.create(self.movement())
				if doctype == "Stock Entry"
				else counts.save_count(str(uuid4()), self.count_data(9, "Reviewed"))
			)
			for status in (0, 1, 2):
				if status == 1:
					draft = native_api.submit_document(doctype, draft.name, draft.version)
				elif status == 2:
					draft = native_api.cancel_document(doctype, draft.name, draft.version)
				query = self.query(
					dataset, "records", record=draft.name, recordDoctype=doctype, statuses=[status]
				)
				result = report_page(query)
				self.assertGreater(result["matched_count"], 0)
				self.assertEqual({row["document"] for row in result["rows"]}, {draft.name})
				other = "Stock Reconciliation" if doctype == "Stock Entry" else "Stock Entry"
				self.assertEqual(report_page({**query, "recordDoctype": other})["matched_count"], 0)
				with Projection(query) as projection:
					projection.build(related=True)
					self.assertEqual({row["document"] for row in projection.rows("lines")}, {draft.name})
					self.assertIn("line_name", projection.column_names["lines"])
					self.assertIn("document_id", projection.column_names["lines"])
					self.assertIn("id", projection.column_names["lines"])

	def test_saved_opening_export_uses_native_movement_quantities_and_excludes_counts(self):
		doc = frappe.get_doc(
			{
				"doctype": "Stock Reconciliation",
				"company": self.company,
				"purpose": "Opening Stock",
				"expense_account": frappe.db.get_value(
					"Account", {"company": self.company, "account_name": "Temporary Opening"}, "name"
				),
				"posting_date": nowdate(),
				"items": [{"item_code": self.item, "warehouse": self.a, "qty": 7, "valuation_rate": 10}],
			}
		).insert()
		for status in (0, 1, 2):
			if status == 1:
				doc.submit()
			elif status == 2:
				doc.cancel()
			loaded = native_api.load_document(doc.doctype, doc.name)
			self.assertEqual(loaded.purpose, "Opening Stock")
			query = self.query(
				"movements", "records", record=doc.name, recordDoctype=doc.doctype, statuses=[status]
			)
			page = report_page(query, page_length=5)
			self.assertEqual(page["matched_count"], 1)
			self.assertEqual(page["rows"][0]["document"], doc.name)
			self.assertEqual(page["rows"][0]["kind"], "Opening")
			with Projection(query) as projection:
				projection.build(related=True)
				lines = list(projection.rows("lines"))
				self.assertEqual(len(lines), 1)
				self.assertEqual(lines[0]["stock_qty"], 7)
				self.assertEqual(lines[0]["actual_qty"], 7)
				self.assertEqual(lines[0]["doctype"], doc.doctype)
				self.assertEqual(lines[0]["line_name"], doc.items[0].name)
			self.assertEqual(report_page({**query, "dataset": "counts"})["matched_count"], 0)
			self.assertEqual(report_page({**query, "recordDoctype": "Stock Entry"})["matched_count"], 0)

	def test_empty_restrictive_item_and_allocation_selections_never_widen_scope(self):
		self.receipt()
		for dataset in DEFINITIONS:
			for flag, values in (("restrictItems", "itemCodes"), ("restrictAllocations", "allocationKeys")):
				result = report_page(self.query(dataset, **{flag: True, values: []}))
				self.assertEqual(result["matched_count"], 0, (dataset, flag))
		self.assertEqual(
			report_page(self.query(scope={"warehouses": ["missing-warehouse"]}, includeZero=True))[
				"matched_count"
			],
			0,
		)

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

	def test_grouped_projection_retains_exact_allocation_detail_and_original_loan_lines(self):
		loan = self.loan(5)
		self.submit(self.settlement(loan, 2))
		result = report_page(self.query("loans", "outcomes", grouping="item"))
		self.assertEqual(result["rows"][0]["outstanding"], 3)
		self.assertIn("outcomes", {table["id"] for table in result["tables"]})
		settlements = report_page(self.query("loans", "settlements"))
		self.assertEqual(settlements["rows"][0]["original_loan_line"], loan["items"][0].name)

	def test_activity_indirect_settlement_relation_follows_exact_original_line(self):
		loan = self.loan()
		settlement = self.settlement(loan)
		# A compatible native Desk settlement may retain the original link without
		# repeating its activity. The native model permits this only when blank.
		desk = frappe.get_doc("Stock Entry", settlement.name)
		desk.ti_activity = None
		desk.save()
		desk.submit()
		query = self.query("activities", "records")
		query["scope"]["activity"] = self.activity.name
		result = report_page(query)
		linked = [row for row in result["rows"] if row["document"] == settlement.name]
		self.assertEqual(len(linked), 1)
		self.assertEqual(linked[0]["relationship"], "original_loan")
		metadata = report_page({**query, "view": "metadata"})["rows"][0]
		self.assertEqual(metadata["count_Loan"], 1)
		self.assertEqual(metadata["count_Return"], 0)
		overview = activities.load_activity(self.activity.name)
		self.assertEqual(overview["summary"]["count_Loan"], 1)
		self.assertEqual(overview["summary"]["count_Return"], 0)
		self.assertEqual(overview["outstanding_line_count"], 1)
		self.assertEqual(overview["loan_totals"][0]["outstanding"], 3)
		self.assertEqual(overview["movement_totals"][0]["kind"], "Loan")
		self.assertTrue(overview["can_write"])

	def test_counts_report_contains_only_actual_native_reconciliations(self):
		self.receipt(10)
		counts.save_count(str(uuid4()), self.count_data(10, "Reviewed"))
		self.assertEqual(report_page(self.query("counts"))["matched_count"], 0)
		doc = counts.save_count(str(uuid4()), self.count_data(9, "Reviewed"))
		native_api.submit_document("Stock Reconciliation", doc.name, doc.version)
		rows = report_page(self.query("counts", "lines"))["rows"]
		self.assertEqual(rows[0]["difference"], -1)
		self.assertEqual(rows[0]["review_state"], "Reviewed")

	def test_named_views_preserve_relative_dates_and_account_isolation(self):
		from frappe.cache_manager import clear_defaults_cache

		self.addCleanup(clear_defaults_cache, "Administrator")
		query = self.query("movements")
		query["scope"]["period"]["key"] = "last_30_days"
		view = preferences.save_named_view("常用 " + self.token, query)
		self.assertEqual(view["query"]["scope"]["period"]["key"], "last_30_days")
		self.assertEqual(view["query"]["scope"]["period"]["from"], "")
		self.assertIn(view["id"], {value["id"] for value in preferences.named_views()})
		preferences.save_named_view("改名 " + self.token, view_id=view["id"], revision=view["revision"])
		with self.assertRaises(frappe.TimestampMismatchError):
			preferences.delete_named_view(view["id"], view["revision"])

	def test_xlsx_and_csv_keep_identical_selected_numeric_table_scope(self):
		self.receipt(12)
		query = self.query("movements", "lines")
		with tempfile.TemporaryDirectory() as directory, Projection(query) as projection:
			projection.build(related=True)
			request = frappe._dict(tables_json='["lines"]', owner="Administrator", export_format="csv")
			csv_path = Path(directory) / "report.csv"
			csv_count = exports._write(projection, request, csv_path)
			with csv_path.open(encoding="utf-8-sig") as source:
				csv_rows = list(csv.DictReader(source))
			request.export_format = "xlsx"
			xlsx_path = Path(directory) / "report.xlsx"
			xlsx_count = exports._write(projection, request, xlsx_path)
			workbook = load_workbook(xlsx_path, read_only=True, data_only=True)
			rows = list(workbook["分配明细"].values)
			workbook.close()
			self.assertEqual(csv_count, xlsx_count)
			self.assertEqual(len(csv_rows), len(rows) - 1)
			self.assertEqual(float(csv_rows[0]["stock_qty"]), 12)
			self.assertEqual(rows[1][rows[0].index("stock_qty")], 12)
			self.assertEqual(projection.count("conversions"), 1)
			self.assertEqual(projection.count("items"), 1)

	def test_large_native_draft_export_preserves_all_1005_allocations_and_stable_order(self):
		data = self.movement(quantity=1)
		data["items"] = [copy.deepcopy(data["items"][0]) for _ in range(1005)]
		doc = self.create(data)
		query = self.query("movements", "lines", record=doc.name, statuses=[0], sortBy="name", sort="asc")
		preview = report_page(query, page_length=1)
		self.assertEqual(preview["matched_count"], 1005)
		self.assertEqual(len(preview["rows"]), 1)
		with tempfile.TemporaryDirectory() as directory, Projection(query) as projection:
			projection.build()
			request = frappe._dict(tables_json='["lines"]', owner="Administrator", export_format="csv")
			csv_path = Path(directory) / "large.csv"
			self.assertEqual(exports._write(projection, request, csv_path), 1005)
			with csv_path.open(encoding="utf-8-sig") as source:
				csv_rows = list(csv.DictReader(source))
			request.export_format = "xlsx"
			xlsx_path = Path(directory) / "large.xlsx"
			self.assertEqual(exports._write(projection, request, xlsx_path), 1005)
			workbook = load_workbook(xlsx_path, read_only=True, data_only=True)
			rows = iter(workbook["分配明细"].values)
			columns = next(rows)
			ids = [row[columns.index("id")] for row in rows]
			workbook.close()
			self.assertEqual(ids, [row["id"] for row in csv_rows])
			self.assertEqual(len(set(ids)), 1005)
			self.assertEqual({row["line_name"] for row in csv_rows}, {row.name for row in doc["items"]})
			self.assertEqual(sum(float(row["stock_qty"]) for row in csv_rows), 1005)

	def test_export_request_is_owned_queued_and_failed_retry_retains_scope(self):
		self.receipt()
		query = self.query()
		with patch("temple_inventory.exports._enqueue") as enqueue:
			result = exports.request_export(query, "xlsx", ["summary", "locations"])
			self.assertEqual(result["status"], "Queued")
			enqueue.assert_called_once()
			doc = frappe.get_doc("Inventory Export Request", result["name"])
			self.assertEqual(doc.owner, "Administrator")
			doc.status = "Failed"
			exports._save(doc)
			retried = exports.retry_export(doc.name, str(doc.modified))
			self.assertEqual(retried["attempt"], 2)
			self.assertEqual(json.loads(doc.query_json), query)
		with self.assertRaises(frappe.ValidationError):
			exports.request_export(query, "csv", ["summary", "locations"])

	def test_export_private_download_rechecks_current_warehouse_and_request_owner(self):
		from frappe.cache_manager import clear_defaults_cache

		self.receipt()
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-export-{self.token}@example.test",
				"first_name": "Export manager",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": "System Manager"}, {"role": "Stock Manager"}, {"role": "Stock User"}],
			}
		).insert()
		self.addCleanup(clear_defaults_cache, user.name)
		frappe.set_user(user.name)
		query = self.query()
		with patch("temple_inventory.exports._enqueue"):
			result = exports.request_export(query, "csv", ["summary"])
		request = frappe.get_doc("Inventory Export Request", result["name"])
		request.status = "Running"
		exports._save(request)
		with tempfile.TemporaryDirectory() as directory, Projection(query) as projection:
			projection.build()
			output = Path(directory) / "export.csv"
			manifest = Path(directory) / "access.jsonl"
			exports._write(projection, request, output)
			exports._manifest(projection, manifest)
			request.output_file = exports._private_file(output, request, "export.csv")
			request.access_manifest = exports._private_file(manifest, request, "access.jsonl")
		for field in ("output_file", "access_manifest"):
			file = frappe.get_doc("File", request.get(field))
			self.addCleanup(Path(file.get_full_path()).unlink, missing_ok=True)
		request.status = "Completed"
		exports._save(request)
		exports.validate_download(request)
		output_file = frappe.get_doc("File", request.output_file)
		self.assertTrue(output_file.is_downloadable())
		self.assertFalse(frappe.get_doc("File", request.access_manifest).is_downloadable())
		frappe.set_user("Administrator")
		with self.assertRaises(frappe.PermissionError):
			exports.export_status(request.name)
		frappe.get_doc(
			{"doctype": "User Permission", "user": user.name, "allow": "Warehouse", "for_value": self.b}
		).insert()
		frappe.clear_cache(user=user.name)
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			exports.validate_download(request)
		self.assertFalse(output_file.is_downloadable())

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
			request = exports.request_export(self.query(), "csv", ["summary"])
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

	def test_worker_discards_cached_permissions_when_owner_role_is_revoked_during_generation(self):
		from frappe.cache_manager import clear_defaults_cache

		self.receipt()
		user = frappe.get_doc(
			{
				"doctype": "User",
				"email": f"ti-role-worker-{self.token}@example.test",
				"first_name": "Role worker owner",
				"send_welcome_email": 0,
				"user_type": "System User",
				"roles": [{"role": "System Manager"}, {"role": "Stock Manager"}, {"role": "Stock User"}],
			}
		).insert()
		self.addCleanup(clear_defaults_cache, user.name)
		frappe.set_user(user.name)
		with patch("temple_inventory.exports._enqueue"):
			request = exports.request_export(self.query(), "csv", ["summary"])
		frappe.set_user("Administrator")
		write = exports._write

		def revoke_after_write(projection, doc, path):
			self.assertIn("System Manager", frappe.get_roles())
			count = write(projection, doc, path)
			local_cache = copy.deepcopy(frappe.local.cache)
			role_permissions = copy.deepcopy(frappe.local.role_permissions)
			# Native role edit invalidates shared Redis caches. Retain the running
			# worker's old local memoization, as a change in another request would.
			frappe.set_user("Administrator")
			changed = frappe.get_doc("User", user.name)
			changed.set("roles", [{"role": "Stock Manager"}, {"role": "Stock User"}])
			changed.save()
			frappe.set_user(user.name)
			frappe.local.cache = local_cache
			frappe.local.role_permissions = role_permissions
			self.assertIn("System Manager", frappe.get_roles())
			return count

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

	def test_loan_record_status_uses_complete_original_before_allocation_filters(self):
		self.receipt(10)
		data = self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="Whole Loan")
		data["items"].append(dict(data["items"][0], qty=4))
		loan = self.submit(self.create(data))
		self.submit(self.settlement(loan, 3))
		line = loan["items"][0].name
		query = self.query(
			"loans", "outcomes", loan=loan.name, restrictAllocations=True, allocationKeys=[line]
		)
		open_rows = report_page({**query, "loanStatus": "open"})["rows"]
		self.assertEqual(len(open_rows), 1)
		self.assertEqual(open_rows[0]["outstanding"], 0)
		self.assertEqual(open_rows[0]["loan_status"], "Open")
		self.assertEqual(report_page({**query, "loanStatus": "settled"})["matched_count"], 0)
		complete = report_page(self.query("loans", "outcomes", loan=loan.name, loanStatus="open"))
		self.assertEqual(complete["matched_count"], 2)
		self.assertEqual(sum(row["outstanding"] for row in complete["rows"]), 4)

	def test_draft_and_cancelled_loan_records_have_no_current_outstanding_balance(self):
		self.receipt(5)
		draft = self.create(self.movement("Loan", 3, self.a, self.loan_leaf, ti_borrower="Loan Lifecycle"))
		rows = report_page(self.query("loans", "outcomes", loan=draft.name, statuses=[0]))["rows"]
		self.assertEqual(rows[0]["borrowed"], 3)
		self.assertEqual(rows[0]["outstanding"], 0)
		completed = self.submit(draft)
		native_api.cancel_document("Stock Entry", completed.name, completed.version)
		self.assertEqual(native_api.loan_detail(completed.name)["items"][0]["outstanding_qty"], 0)
		query = self.query("loans", "outcomes", loan=completed.name, statuses=[2])
		self.assertEqual(report_page(query)["rows"][0]["outstanding"], 0)
		self.assertEqual(report_page({**query, "loanStatus": "settled"})["matched_count"], 0)

	def test_date_sort_uses_native_posting_time_before_identity_on_the_same_day(self):
		late = self.submit(self.create(self.movement(quantity=1, posting_time="12:00:00.123456")))
		early = self.submit(self.create(self.movement(quantity=1, posting_time="08:00:00.654321")))
		query = self.query("movements", "records", sortBy="date", sort="asc")
		rows = report_page(query)["rows"]
		self.assertEqual([row["document"] for row in rows], [early.name, late.name])
		self.assertTrue(rows[0]["time"].endswith("654321"))

	def test_adjustment_exclusion_is_canonical_in_browse_and_export_queries(self):
		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		completed = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		query = self.query("movements", "lines", record=completed.name)
		self.assertEqual(report_page(query)["matched_count"], 1)
		self.assertEqual(report_page({**query, "includeAdjustments": False})["matched_count"], 0)
		with self.assertRaises(frappe.ValidationError):
			validate_query({**query, "includeAdjustments": "false"})


def run():
	# Inherited native cases run once in the native runner, not again here.
	names = [name for name in NativeReportTests.__dict__ if name.startswith("test_")]
	result = unittest.TextTestRunner(verbosity=2).run(
		unittest.TestSuite(NativeReportTests(name) for name in sorted(names))
	)
	if not result.wasSuccessful():
		raise AssertionError(
			f"Native reports failed: {len(result.failures)} failures, {len(result.errors)} errors"
		)
	return {"tests": result.testsRun, "failures": 0, "errors": 0}
