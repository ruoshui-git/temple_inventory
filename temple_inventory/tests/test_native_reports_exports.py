"""Report/export contracts exercised against real native stock and permissions."""

import copy
import csv
import json
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.utils import nowdate
from openpyxl import load_workbook

from temple_inventory import counts, exports, native_api
from temple_inventory.projections import Projection, report_page
from temple_inventory.report_query import validate_query
from temple_inventory.tests.helpers import NativeReportTestCase


class NativeReportsExportsTests(NativeReportTestCase):
	def test_refinement_display_labels_preserve_native_identity_and_export_audit_values(self):
		room = frappe.get_doc("Warehouse", self.room_a)
		room.ti_label = "供灯-用品"
		room.save()
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
			rows = list(workbook["库存明细"].values)
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
		query = self.query(
			"movements", "lines", record=doc.name, statuses=[0], sortBy="item_name", sort="asc"
		)
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
			rows = iter(workbook["库存明细"].values)
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

	def test_adjustment_exclusion_is_canonical_in_browse_and_export_queries(self):
		self.receipt(10)
		draft = counts.save_count(str(uuid4()), self.count_data(8, "Reviewed"))
		completed = native_api.submit_document("Stock Reconciliation", draft.name, draft.version)
		query = self.query("movements", "lines", record=completed.name)
		self.assertEqual(report_page(query)["matched_count"], 1)
		self.assertEqual(report_page({**query, "includeAdjustments": False})["matched_count"], 0)
		with self.assertRaises(frappe.ValidationError):
			validate_query({**query, "includeAdjustments": "false"})
