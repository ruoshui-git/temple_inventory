"""Report/export contracts exercised against real native stock and permissions."""

# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import copy
import csv
import io
import json
import tempfile
import zipfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.utils import nowdate
from openpyxl import load_workbook

from temple_inventory import browse, counts, exports, native_api, native_files
from temple_inventory.projections import Projection, report_page
from temple_inventory.report_query import validate_query
from temple_inventory.tests.helpers import NativeReportTestCase
from temple_inventory.uom_labels import uom_label


class NativeReportsExportsTests(NativeReportTestCase):
	def test_grouped_xlsx_writes_labeled_headers_subtotals_and_outline_levels(self):
		self.receipt(12)
		query = self.query("movements", "lines", groupBy=["item"])
		with patch("temple_inventory.exports._enqueue"):
			result = exports.request_export(
				query,
				"lines",
				columns=["item_name", "stock_qty", "stock_uom"],
				grouped=True,
			)
		request = frappe.get_doc("Inventory Export Request", result["name"])
		self.assertTrue(request.grouped)
		with Projection(query, refresh=True) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			path = Path(directory) / "grouped.xlsx"
			self.assertEqual(exports._write(projection, request, path), 1)
			workbook = load_workbook(path, data_only=True)
			worksheet = workbook["库存明细"]
			self.assertEqual(worksheet.cell(2, 1).value, "Native test item (1)")
			self.assertEqual(worksheet.cell(2, 2).value, 12)
			self.assertEqual(worksheet.cell(2, 3).value, uom_label("Nos"))
			self.assertEqual(worksheet.row_dimensions[2].outline_level, 0)
			self.assertEqual(worksheet.row_dimensions[3].outline_level, 1)
			self.assertFalse(worksheet.row_dimensions[3].hidden)
			self.assertEqual(worksheet.cell(4, 1).value, f"合计（{uom_label('Nos')}） · 1 行")
			self.assertEqual(worksheet.cell(2, 1).fill.fgColor.rgb[-6:], "D9D9D9")
			workbook.close()

	def test_grouped_csv_rejected_empty_grouping_clears_flag_and_file_columns_drop(self):
		query = self.query("movements", "lines")
		with self.assertRaises(frappe.ValidationError):
			exports.request_export(query, "lines", export_format="csv", grouped=True)
		with patch("temple_inventory.exports._enqueue"):
			result = exports.request_export(
				query,
				"lines",
				columns=["image_file", "attachments"],
				grouped=True,
			)
		request = frappe.get_doc("Inventory Export Request", result["name"])
		self.assertFalse(request.grouped)
		self.assertNotIn("image_file", json.loads(request.columns_json))
		self.assertNotIn("attachments", json.loads(request.columns_json))

	def test_zip_export_includes_primary_image_attachments_hyperlink_and_manifest_files(self):
		self.receipt(12)
		primary = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": "primary.webp",
				"content": b"image bytes",
				"is_private": 1,
				"attached_to_doctype": "Item",
				"attached_to_name": self.item,
				"attached_to_field": "image",
			}
		).insert()
		item = frappe.get_doc("Item", self.item)
		item.image = primary.file_url
		item.save()
		for _ in range(2):
			frappe.get_doc(
				{
					"doctype": "File",
					"file_name": "notes.txt",
					"content": b"attachment",
					"is_private": 1,
					"attached_to_doctype": "Item",
					"attached_to_name": self.item,
				}
			).insert()
		record = self.create(self.movement(quantity=3))
		query = self.query("movements", "lines")
		with patch("temple_inventory.exports._enqueue"):
			result = exports.request_export(
				query,
				"summary",
				columns=["item_code", "image_file", "attachments"],
				include_files="all",
			)
		request = frappe.get_doc("Inventory Export Request", result["name"])
		self.assertTrue(request.file_label.endswith(".zip"))
		with Projection(query, refresh=True) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			path = Path(directory) / request.file_label
			exports._write(projection, request, path)
			self.assertEqual(
				projection.export_file_ids,
				{file.name for file in native_files.attachments("Item", self.item)},
			)
			with zipfile.ZipFile(path) as archive:
				names = set(archive.namelist())
				self.assertIn(f"images/{self.item}.webp", names)
				self.assertIn(f"attachments/items/{self.item}/notes.txt", names)
				self.assertIn(f"attachments/items/{self.item}/notes (2).txt", names)
				book = load_workbook(io.BytesIO(archive.read(request.file_label.rsplit(".", 1)[0] + ".xlsx")))
				worksheet = book["汇总"]
				self.assertEqual(worksheet.cell(2, 2).value, f"images/{self.item}.webp")
				self.assertIn(
					self.item,
					worksheet.cell(2, 2).hyperlink.target if worksheet.cell(2, 2).hyperlink else "",
				)
				self.assertEqual(worksheet.cell(2, 3).value, f"attachments/items/{self.item}/")
				book.close()
			frappe.get_doc(
				{
					"doctype": "File",
					"file_name": "record.txt",
					"content": b"record attachment",
					"is_private": 1,
					"attached_to_doctype": "Stock Entry",
					"attached_to_name": record.name,
				}
			).insert()
			record_query = self.query("movements", "lines", record=record.name, statuses=[0])
			with patch("temple_inventory.exports._enqueue"):
				record_request = frappe.get_doc(
					"Inventory Export Request",
					exports.request_export(
						record_query,
						"lines",
						columns=["document", "attachments"],
						include_files="all",
					)["name"],
				)
			record_path = Path(directory) / record_request.file_label
			with Projection(record_query, refresh=True) as record_projection:
				record_projection.build()
				exports._write(record_projection, record_request, record_path)
				with zipfile.ZipFile(record_path) as archive:
					self.assertIn(f"attachments/records/{record.name}/record.txt", archive.namelist())
				with patch(
					"temple_inventory.item_images._authorized_original", side_effect=frappe.PermissionError
				):
					with self.assertRaises(frappe.PermissionError):
						exports._write(record_projection, record_request, record_path)

	def test_history_sort_matches_browse_and_retry_preserves_export_options(self):
		self.receipt(12)
		query = self.query("movements", "lines", groupBy=["item"])
		expected = browse.movement_history(query, sort_by="document", sort="asc")["rows"]
		with patch("temple_inventory.exports._enqueue"):
			result = exports.request_export(
				query,
				"history",
				columns=["document", "attachments"],
				grouped=True,
				include_files="images",
				sort_by="document",
				sort="asc",
			)
		request = frappe.get_doc("Inventory Export Request", result["name"])
		self.assertTrue(request.grouped)
		self.assertEqual(request.include_files, "images")
		self.assertEqual(request.export_sort_by, "document")
		self.assertEqual(request.export_sort, "asc")
		with Projection(query, refresh=True) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			path = Path(directory) / request.file_label
			exports._write(projection, request, path)
			with zipfile.ZipFile(path) as archive:
				workbook = load_workbook(
					io.BytesIO(archive.read(request.file_label.rsplit(".", 1)[0] + ".xlsx")), data_only=True
				)
				worksheet = workbook["流动明细"]
				expected_names = {row["document"] for row in expected}
				data_rows = [row for row in list(worksheet.values)[1:] if row[0] in expected_names]
				values = [row[0] for row in data_rows]
				self.assertEqual(values, [row["document"] for row in expected])
				self.assertTrue(all(not row[1] for row in data_rows))
				workbook.close()
		request.status = "Failed"
		exports._save(request)
		with patch("temple_inventory.exports._enqueue"):
			retried = exports.retry_export(request.name, str(request.modified))
		self.assertEqual(retried["attempt"], 2)
		self.assertTrue(retried["grouped"])
		self.assertEqual(retried["include_files"], "images")
		self.assertEqual(request.export_sort_by, "document")
		self.assertEqual(request.export_sort, "asc")

	def test_export_totals_are_per_unit_and_expiry_states_are_date_accurate(self):
		stream = io.StringIO()
		writer = csv.writer(stream)
		count = exports._write_rows(
			writer,
			[
				{"item_name": "甲", "stock_qty": 2, "stock_uom": "Nos"},
				{"item_name": "乙", "stock_qty": 3, "stock_uom": "Nos"},
				{"item_name": "丙", "stock_qty": 4, "stock_uom": "Box"},
			],
			["item_name", "stock_qty"],
			"batches",
			frappe._dict(query={"dataset": "inventory"}),
		)
		self.assertEqual(count, 3)
		values = list(csv.reader(io.StringIO(stream.getvalue())))
		self.assertEqual([row[1] for row in values[-2:]], ["5", "4"])
		self.assertIn("合计", values[-2][0])
		self.assertEqual(exports._display_cell({"expiry_date": "2000-01-01"}, "expiry_state"), "已过期")
		self.assertEqual(exports._display_cell({"expiry_date": "2999-01-01"}, "expiry_state"), "未过期")
		self.assertEqual(exports._display_cell({}, "expiry_state"), "无效期")

	def test_grouped_movement_export_uses_flat_history_rows_and_readable_cells(self):
		self.receipt(12)
		query = self.query("movements", "summary", groupBy=["item"])
		with Projection(query, refresh=True) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			self.assertEqual(projection.count("history"), browse.movement_history(query)["matched_count"])
			path = Path(directory) / "history.csv"
			count = exports._write(
				projection,
				frappe._dict(
					tables_json='["history"]',
					columns_json=json.dumps(
						["kind", "docstatus", "destination_warehouse", "stock_qty", "stock_uom"]
					),
					export_format="csv",
				),
				path,
			)
			with path.open(encoding="utf-8-sig", newline="") as stream:
				rows = list(csv.reader(stream))
			self.assertEqual(count, 1)
			self.assertEqual(rows[0], ["类型", "状态", "去向位置", "数量", "单位"])
			self.assertEqual(rows[1][0], "入库")
			self.assertEqual(rows[1][1], "已提交")
			self.assertEqual(rows[1][2], projection.context.label(self.a))
			self.assertNotEqual(rows[1][2], self.a)
			self.assertEqual(rows[1][4], "个")
			self.assertTrue(all(not any(isinstance(cell, (list, dict)) for cell in row) for row in rows))

	def test_loan_history_export_lists_only_outstanding_submitted_loans(self):
		partly = self.loan(5, borrower="部分归还")
		self.submit(self.settlement(partly, 2))
		settled = self.loan(3, borrower="全部归还")
		self.submit(self.settlement(settled, 3))
		query = self.query("loans", "items")
		with Projection(query, refresh=True) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			path = Path(directory) / "loans.csv"
			exports._write(
				projection,
				frappe._dict(
					tables_json='["loan_history"]',
					columns_json=json.dumps(
						[
							"document",
							"borrower",
							"activity_title",
							"source_warehouse",
							"outstanding",
							"stock_uom",
						]
					),
					export_format="csv",
				),
				path,
			)
			with path.open(encoding="utf-8-sig", newline="") as stream:
				rows = list(csv.reader(stream))
		self.assertEqual(rows[0], ["借出单号", "借用方", "活动", "原位置", "未归还", "单位"])
		self.assertEqual([row[0] for row in rows[1:-1]], [partly.name])
		self.assertEqual(rows[1][1:4], ["部分归还", self.activity.title, projection.context.label(self.a)])
		self.assertEqual(float(rows[1][4]), 3)
		self.assertTrue(rows[-1][0].startswith("合计"))

	def test_export_api_rejects_internal_tables_and_disallowed_columns_and_saves_summary(self):
		self.receipt(12)
		query = self.query("movements", "summary")
		for table in ("grouped", "items", "files"):
			with self.assertRaises(frappe.ValidationError):
				exports.request_export(query, table)
		with self.assertRaises(frappe.ValidationError):
			exports.request_export(query, "summary", columns=["document_id"])
		with patch("temple_inventory.exports._enqueue"):
			result = exports.request_export(
				query,
				"summary",
				columns=["item_name", "stock_qty"],
				summary={"title": "月度库存", "filters": ["位置：供灯区"]},
			)
		request = frappe.get_doc("Inventory Export Request", result["name"])
		self.assertEqual(result["table"], "summary")
		self.assertEqual(json.loads(request.columns_json), ["item_name", "stock_qty"])
		self.assertEqual(json.loads(request.summary_json), {"title": "月度库存", "filters": ["位置：供灯区"]})
		self.assertTrue(request.file_label.startswith("月度库存-全部时间-"))
		self.assertTrue(request.file_label.endswith(".xlsx"))
		with Projection(query, refresh=True) as projection, tempfile.TemporaryDirectory() as directory:
			projection.build()
			path = Path(directory) / request.file_label
			exports._write(projection, request, path)
			workbook = load_workbook(path, read_only=True, data_only=True)
			self.assertEqual(workbook.sheetnames[0], "汇总")
			self.assertEqual(workbook.sheetnames[1], "导出说明")
			info_rows = list(workbook["导出说明"].values)
			workbook.close()
			self.assertIn(("页面", "月度库存"), info_rows)
			self.assertIn(("筛选", "位置：供灯区"), info_rows)
			self.assertIn(("分组", "无"), info_rows)

	def test_records_export_collapses_units_to_one_native_document_row_with_locations(self):
		doc = self.submit(self.create(self.movement(quantity=2)))
		query = self.query("movements", "records", record=doc.name, statuses=[1])
		with Projection(query, refresh=True) as projection:
			projection.build()
			rows = list(exports._export_rows(projection, "records"))
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["document"], doc.name)
		self.assertTrue(rows[0]["source"])
		self.assertTrue(rows[0]["destination"])
		self.assertNotIn(self.a, rows[0]["source"] + rows[0]["destination"])

	def test_mixed_unit_record_keeps_text_quantities_and_mapped_endpoints(self):
		class Context:
			@staticmethod
			def label(name):
				return {"source-warehouse": "来源库位", "destination-warehouse": "去向库位"}[name]

		projection = frappe._dict(query={"dataset": "movements"}, context=Context())
		row = exports._export_record_row(
			projection,
			lambda *_args: {
				"branches": [{"source": "source-warehouse", "destination": "destination-warehouse"}]
			},
			{},
			{
				"doctype": "Stock Entry",
				"document": "STE-1",
				"_units": {"Nos": {"stock_qty": 12}, "Box": {"stock_qty": 3}},
			},
		)
		self.assertIsNone(row["stock_qty"])
		self.assertEqual(row["stock_uom"], f"12 {uom_label('Nos')}；3 {uom_label('Box')}")
		self.assertEqual(row["quantities"], f"12 {uom_label('Nos')}；3 {uom_label('Box')}")
		self.assertEqual(row["source"], "来源库位")
		self.assertEqual(row["destination"], "去向库位")

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
		self.assertEqual(values["去向位置"], "供灯-用品")
		self.assertNotIn(self.a, values.values())

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
				projection.build()
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
			request = frappe._dict(
				tables_json='["lines"]',
				columns_json='["stock_qty"]',
				owner="Administrator",
				export_format="csv",
			)
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
			self.assertEqual(float(csv_rows[0]["数量"]), 12)
			self.assertEqual(rows[1][rows[0].index("数量")], 12)

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
			request = frappe._dict(
				tables_json='["lines"]',
				columns_json='["line_name", "stock_qty"]',
				owner="Administrator",
				export_format="csv",
			)
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
			ids = [
				row[columns.index("明细编号")]
				for row in rows
				if row[columns.index("明细编号")]
				and not str(row[columns.index("明细编号")]).startswith("合计")
			]
			workbook.close()
			self.assertEqual(
				ids,
				[
					row["明细编号"]
					for row in csv_rows
					if row["明细编号"] and not row["明细编号"].startswith("合计")
				],
			)
			self.assertEqual(len(set(ids)), 1005)
			self.assertEqual(
				{row["明细编号"] for row in csv_rows if not row["明细编号"].startswith("合计")},
				{row.name for row in doc["items"]},
			)
			self.assertEqual(
				sum(float(row["数量"]) for row in csv_rows if not row["明细编号"].startswith("合计")),
				1005,
			)

	def test_export_request_is_owned_queued_and_failed_retry_retains_scope(self):
		self.receipt()
		query = self.query()
		with patch("temple_inventory.exports._enqueue") as enqueue:
			result = exports.request_export(query, "summary", export_format="xlsx")
			self.assertEqual(result["status"], "Queued")
			enqueue.assert_called_once()
			doc = frappe.get_doc("Inventory Export Request", result["name"])
			self.assertEqual(doc.owner, "Administrator")
			doc.status = "Failed"
			exports._save(doc)
			retried = exports.retry_export(doc.name, str(doc.modified))
			self.assertEqual(retried["attempt"], 2)
			self.assertEqual(json.loads(doc.query_json), query)
			self.assertEqual(json.loads(doc.tables_json), ["summary"])
		with self.assertRaises(frappe.ValidationError):
			exports.request_export(query, "summary,locations", export_format="csv")

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
			result = exports.request_export(query, "summary", export_format="csv")
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
