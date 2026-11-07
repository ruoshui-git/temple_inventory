"""Opening Stock import regressions using the native Inventory Import flow."""

import io
from unittest.mock import patch

import frappe
import openpyxl
import xlsxwriter

from temple_inventory import imports
from temple_inventory.native_stock import warehouse_scopes
from temple_inventory.native_topology import present_locations
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class OpeningStockImportTests(NativeDocumentTests):
	def setUp(self):
		super().setUp()
		import erpnext

		if erpnext.is_perpetual_inventory_enabled(self.company):
			account = frappe.db.get_value(
				"Account", {"company": self.company, "account_type": "Stock", "is_group": 0}, "name"
			)
			if account:
				for warehouse in (self.a, self.b):
					frappe.db.sql("update `tabWarehouse` set account=%s where name=%s", (account, warehouse))
				frappe.flags.warehouse_account_map = {}

	def workbook(self, rows):
		output = io.BytesIO()
		book = xlsxwriter.Workbook(output, {"in_memory": True})
		sheet = book.add_worksheet("期初库存")
		for column, header in enumerate(imports.OPENING_HEADERS):
			sheet.write_string(0, column, header)
		for index, row in enumerate(rows, 1):
			for column, value in enumerate(row):
				if isinstance(value, (int, float)):
					sheet.write_number(index, column, value)
				else:
					sheet.write_string(index, column, str(value or ""))
		book.close()
		return output.getvalue()

	def test_template_headers_location_sheet_and_dropdown_are_generated(self):
		response = frappe._dict()
		with patch.object(frappe, "response", response):
			imports.opening_template()
		book = openpyxl.load_workbook(io.BytesIO(response.filecontent), read_only=False, data_only=False)
		self.assertEqual(book.sheetnames, ["期初库存", "填写说明", "示例", "位置清单"])
		self.assertEqual([cell.value for cell in book["期初库存"][1]], imports.OPENING_HEADERS)
		self.assertEqual(book["期初库存"].max_row, 1)
		self.assertTrue(book["位置清单"].max_row >= 2)
		self.assertTrue(book["期初库存"].data_validations.dataValidation)
		self.assertIn(
			"物品目录下载",
			" ".join(str(row[2]) for row in book["填写说明"].iter_rows(min_row=2, values_only=True)),
		)

	def test_plan_resolves_authorized_location_and_writes_nothing(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		rows = imports._opening_workbook(
			self.workbook([[self.item, location["label"], 3, 2.5, "", "", "", ""]]),
			"opening.xlsx",
		)
		doctypes = ("Stock Ledger Entry", "GL Entry", "Bin", "Batch", "Serial No", "Stock Reconciliation")
		before = {doctype: frappe.db.count(doctype) for doctype in doctypes}
		planned, digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "08:00:00")
		after = {doctype: frappe.db.count(doctype) for doctype in doctypes}
		self.assertEqual(before, after)
		self.assertEqual(len(digest), 64)
		self.assertEqual(planned[0]["action"], "NEW")
		self.assertEqual(planned[0]["item_code"], self.item)
		self.assertEqual(planned[0]["location_label"], location["label"])
		self.assertEqual(planned[0]["line_value"], 7.5)

	def test_unknown_item_is_rejected_and_never_created(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		missing = f"UNKNOWN-{self.token}"
		rows = imports._opening_workbook(
			self.workbook([[missing, location["label"], 1, 1, "", "", "", ""]]),
			"opening.xlsx",
		)
		planned, _digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "08:00:00")
		self.assertEqual(planned[0]["action"], "REJECTED")
		self.assertFalse(frappe.db.exists("Item", missing))
		self.assertTrue(any("找不到此物品编号" in error for error in planned[0]["errors"]))

	def test_matching_submitted_opening_is_unchanged_without_an_update_action(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		doc = frappe.new_doc("Stock Reconciliation")
		doc.company = self.company
		doc.purpose = "Opening Stock"
		doc.posting_date = frappe.utils.nowdate()
		doc.posting_time = "00:00:01"
		doc.set_posting_time = 1
		doc.ti_time_mode = "Historical"
		doc.append(
			"items",
			{"item_code": self.item, "warehouse": self.a, "qty": 3, "valuation_rate": 2.5},
		)
		doc.insert()
		doc._submit()
		rows = imports._opening_workbook(
			self.workbook([[self.item, location["label"], 3, 2.5, "", "", "", ""]]),
			"opening.xlsx",
		)
		planned, _digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertEqual(planned[0]["action"], "UNCHANGED")
		self.assertEqual(planned[0]["existing_document"], doc.name)

	def test_quantity_rate_duplicate_tracking_and_location_rejections(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		locations = {row["name"]: row for row in present_locations(visible)}
		rows = imports._opening_workbook(
			self.workbook(
				[
					[self.item, locations[self.a]["label"], 0, 1, "", "", "", ""],
					[self.item, locations[self.b]["label"], 1, -1, "", "", "", ""],
					[self.item, locations[self.a]["label"], 1, 1, "", "", "", ""],
					[self.item, locations[self.a]["label"], 2, 1, "", "", "", ""],
					[self.item, locations[self.physical]["label"], 1, 1, "", "", "", ""],
				]
			),
			"opening.xlsx",
		)
		planned, _digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertTrue(any("数量必须大于零" in error for error in planned[0]["errors"]))
		self.assertTrue(any("估值单价" in error for error in planned[1]["errors"]))
		self.assertTrue(any("重复物品、位置和批次" in error for error in planned[3]["errors"]))
		self.assertTrue(any("分组位置" in error for error in planned[4]["errors"]))

		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.has_expiry_date = 1
		item.save()
		batch_rows = imports._opening_workbook(
			self.workbook([[self.item, locations[self.a]["label"], 1, 1, "", "", "", ""]]),
			"opening.xlsx",
		)
		batch_plan, _digest = imports._opening_plan(batch_rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertTrue(any("批次编号" in error for error in batch_plan[0]["errors"]))
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 0
		item.has_expiry_date = 0
		item.save()

	def test_disabled_nonstock_serial_and_expiry_eligibility(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		item = frappe.get_doc("Item", self.item)
		item.disabled = 1
		item.save()
		rows = imports._opening_workbook(
			self.workbook([[self.item, location["label"], 1, 1, "", "", "", ""]]),
			"opening.xlsx",
		)
		plan, _digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertTrue(any("已停用" in error for error in plan[0]["errors"]))
		item = frappe.get_doc("Item", self.item)
		item.disabled = 0
		item.is_stock_item = 0
		item.save()
		plan, _digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertTrue(any("不是库存物品" in error for error in plan[0]["errors"]))
		item = frappe.get_doc("Item", self.item)
		item.is_stock_item = 1
		item.has_batch_no = 1
		item.has_expiry_date = 1
		item.save()
		batch_rows = imports._opening_workbook(
			self.workbook([[self.item, location["label"], 1, 1, f"B-{self.token}", "", "", ""]]),
			"opening.xlsx",
		)
		plan, _digest = imports._opening_plan(batch_rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertTrue(any("必须填写到期日期" in error for error in plan[0]["errors"]))
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 0
		item.has_expiry_date = 0
		item.has_serial_no = 1
		item.save()
		serial_rows = imports._opening_workbook(
			self.workbook([[self.item, location["label"], 2, 1, "", "", "", "SERIAL-1"]]),
			"opening.xlsx",
		)
		plan, _digest = imports._opening_plan(serial_rows, str(frappe.utils.nowdate()), "00:00:01")
		self.assertTrue(any("序列号数量必须与整数库存数量一致" in error for error in plan[0]["errors"]))
		item = frappe.get_doc("Item", self.item)
		item.has_serial_no = 0
		item.save()

	def test_formula_looking_report_values_are_written_as_text(self):
		response = frappe._dict()
		with patch.object(frappe, "response", response):
			imports._xlsx_response("formula", [("结果", ["用户文本"], [["=1+1"]])], "report.xlsx")
		book = openpyxl.load_workbook(io.BytesIO(response.filecontent), data_only=False)
		cell = book["结果"]["A2"]
		self.assertEqual(cell.value, "=1+1")
		self.assertEqual(cell.data_type, "s")

	def _queued_import(self, item_code, location, qty=3):
		return self._queued_import_rows([[item_code, location, qty, 2.5, "", "", "", ""]])

	def _queued_import_rows(self, workbook_rows):
		raw = self.workbook(workbook_rows)
		rows = imports._opening_workbook(raw, "opening.xlsx")
		posting_date = str(frappe.utils.nowdate())
		posting_time = "00:00:01"
		planned, digest = imports._opening_plan(rows, posting_date, posting_time)
		file_doc = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": "opening.xlsx",
				"content": raw,
				"is_private": 1,
			}
		).insert()
		doc = frappe.get_doc(
			{
				"doctype": "Inventory Import",
				"import_type": "Opening Stock",
				"status": "Queued",
				"source_file": file_doc.name,
				"file_sha256": imports.hashlib.sha256(raw).hexdigest(),
				"posting_date": posting_date,
				"posting_time": posting_time,
				"preview_json": frappe.as_json(planned),
				"plan_hash": digest,
			}
		)
		imports._set_counts(doc, planned)
		imports._save(doc)
		return doc, planned

	def test_worker_submits_one_historical_document_and_retry_is_idempotent(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		request, planned = self._queued_import(self.item, location["label"])
		self.assertEqual(planned[0]["action"], "NEW", planned[0]["errors"])

		def simulated_commit():
			# read_cache's after_commit hook clears this in the real worker.
			frappe.local.inventory_cache_revision_touched = False

		with (
			patch.object(frappe.db, "commit", side_effect=simulated_commit),
			patch.object(frappe.db, "rollback"),
		):
			imports.run_opening_import(request.name, "Administrator")
			imports.run_opening_import(request.name, "Administrator")
		result = frappe.get_doc("Inventory Import", request.name)
		self.assertEqual(result.status, "Completed", result.error)
		self.assertEqual(len(frappe.parse_json(result.created_documents)), 1)
		native = frappe.get_doc("Stock Reconciliation", frappe.parse_json(result.created_documents)[0])
		self.assertEqual(native.docstatus, 1)
		self.assertEqual(native.purpose, "Opening Stock")
		self.assertEqual(str(native.posting_date), str(result.posting_date))
		self.assertEqual(frappe.utils.get_time(native.posting_time).strftime("%H:%M:%S"), "00:00:01")
		self.assertEqual(native.ti_time_mode, "Historical")
		self.assertEqual(float(native.items[0].qty), planned[0]["qty"])
		ledger_rows = frappe.get_all(
			"Stock Ledger Entry",
			filters={"voucher_no": native.name},
			fields=["item_code", "warehouse", "actual_qty", "qty_after_transaction"],
		)
		self.assertAlmostEqual(
			sum(
				row.qty_after_transaction
				for row in ledger_rows
				if row.item_code == self.item and row.warehouse == self.a
			),
			planned[0]["qty"],
			msg=repr(ledger_rows),
		)
		gl_rows = frappe.get_all(
			"GL Entry",
			filters={"voucher_type": "Stock Reconciliation", "voucher_no": native.name, "is_cancelled": 0},
			fields=["account", "debit", "credit"],
		)
		self.assertTrue(gl_rows)
		self.assertAlmostEqual(sum(row.debit for row in gl_rows), sum(row.credit for row in gl_rows))
		self.assertIn(native.expense_account, {row.account for row in gl_rows})
		self.assertEqual(frappe.db.get_value("Account", native.expense_account, "account_type"), "Temporary")
		self.assertEqual(
			frappe.db.count(
				"Stock Reconciliation",
				{"ti_request_key": imports.hashlib.sha256(request.name.encode()).hexdigest()},
			),
			1,
		)
		reupload, reupload_plan = self._queued_import(self.item, location["label"])
		self.assertEqual(reupload_plan[0]["action"], "UNCHANGED")
		with patch.object(frappe.db, "commit", side_effect=simulated_commit):
			imports.run_opening_import(reupload.name, "Administrator")
		self.assertEqual(frappe.db.get_value("Inventory Import", reupload.name, "status"), "Completed")
		self.assertEqual(
			frappe.parse_json(frappe.db.get_value("Inventory Import", reupload.name, "created_documents")),
			[native.name],
		)
		self.assertEqual(
			frappe.db.count(
				"Stock Reconciliation",
				{"ti_request_key": imports.hashlib.sha256(request.name.encode()).hexdigest()},
			),
			1,
		)
		self.assertEqual(
			frappe.db.count(
				"Stock Reconciliation",
				{"ti_request_key": imports.hashlib.sha256(reupload.name.encode()).hexdigest()},
			),
			0,
		)

	def test_submit_failure_keeps_draft_and_retry_finishes_that_draft(self):
		from erpnext.stock.doctype.stock_reconciliation.stock_reconciliation import StockReconciliation

		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		request, _planned = self._queued_import(self.item, location["label"])

		def simulated_commit():
			frappe.local.inventory_cache_revision_touched = False

		with (
			patch.object(frappe.db, "commit", side_effect=simulated_commit),
			patch.object(frappe.db, "rollback"),
			patch.object(
				StockReconciliation, "_submit", side_effect=frappe.ValidationError("test submit failure")
			),
		):
			imports.run_opening_import(request.name, "Administrator")
		failed = frappe.get_doc("Inventory Import", request.name)
		self.assertEqual(failed.status, "Failed")
		self.assertIn("草稿", failed.error)
		request_key = imports.hashlib.sha256(request.name.encode()).hexdigest()
		draft_name = frappe.db.get_value(
			"Stock Reconciliation", {"ti_request_key": request_key, "docstatus": 0}, "name"
		)
		self.assertTrue(draft_name)
		with patch.object(frappe.db, "commit", side_effect=simulated_commit):
			imports.run_opening_import(request.name, "Administrator")
		self.assertEqual(frappe.db.get_value("Inventory Import", request.name, "status"), "Completed")
		self.assertEqual(frappe.db.get_value("Stock Reconciliation", draft_name, "docstatus"), 1)

	def test_stock_movement_after_preview_conflicts_before_creating_opening(self):
		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		location = next(row for row in present_locations(visible) if row["name"] == self.a)
		request, planned = self._queued_import(self.item, location["label"])
		self.assertEqual(planned[0]["action"], "NEW")
		movement = self.submit(self.create(self.movement("Receive", quantity=1, target=self.a)))
		self.assertEqual(movement["docstatus"], 1)
		before = frappe.db.count("Stock Reconciliation")

		def simulated_commit():
			frappe.local.inventory_cache_revision_touched = False

		with patch.object(frappe.db, "commit", side_effect=simulated_commit):
			imports.run_opening_import(request.name, "Administrator")
		self.assertEqual(frappe.db.get_value("Inventory Import", request.name, "status"), "Conflict")
		self.assertEqual(frappe.db.count("Stock Reconciliation"), before)

	def test_worker_submits_over_one_hundred_lines_across_warehouses_in_one_document(self):
		from erpnext.stock.doctype.stock_reconciliation.stock_reconciliation import StockReconciliation

		_settings, visible, _physical, _leased, _damaged = warehouse_scopes()
		locations = {row["name"]: row for row in present_locations(visible)}
		rows = []
		for index in range(101):
			item_code = f"TI-OPENING-BULK-{self.token}-{index:03d}"
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": item_code,
					"item_name": f"Opening bulk test {index}",
					"stock_uom": "Nos",
					"item_group": "All Item Groups",
					"is_stock_item": 1,
				}
			).insert()
			warehouse = self.a if index % 2 == 0 else self.b
			rows.append([item_code, locations[warehouse]["label"], 1, 1, "", "", "", ""])
		request, planned = self._queued_import_rows(rows)
		self.assertTrue(all(row["action"] == "NEW" for row in planned))

		def simulated_commit():
			frappe.local.inventory_cache_revision_touched = False

		with (
			patch.object(frappe.db, "commit", side_effect=simulated_commit),
			patch.object(StockReconciliation, "submit", side_effect=AssertionError("must submit in worker")),
		):
			imports.run_opening_import(request.name, "Administrator")
		result = frappe.get_doc("Inventory Import", request.name)
		self.assertEqual(result.status, "Completed", result.error)
		created = frappe.parse_json(result.created_documents)
		self.assertEqual(len(created), 1)
		native = frappe.get_doc("Stock Reconciliation", created[0])
		self.assertEqual(native.docstatus, 1)
		self.assertEqual(len(native.items), 101)
		self.assertEqual({row.warehouse for row in native.items}, {self.a, self.b})

	def test_import_creates_batch_and_serial_allocations_in_one_document(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		batch_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPENING-BATCH-{self.token}",
				"item_name": "Opening import batch test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_batch_no": 1,
				"has_expiry_date": 1,
			}
		).insert()
		serial_item = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-OPENING-SERIAL-{self.token}",
				"item_name": "Opening import serial test",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
				"has_serial_no": 1,
				"serial_no_series": f"{self.token}-.####",
			}
		).insert()
		batch_no = f"OPENING-BATCH-{self.token}"
		batch_expiry = frappe.utils.add_days(frappe.utils.nowdate(), 30)
		locations = {row["name"]: row for row in present_locations(warehouse_scopes()[1])}
		request, planned = self._queued_import_rows(
			[
				[
					batch_item.name,
					locations[self.a]["label"],
					2,
					3,
					batch_no,
					str(frappe.utils.nowdate()),
					str(batch_expiry),
					"",
				],
				[
					serial_item.name,
					locations[self.b]["label"],
					2,
					4,
					"",
					"",
					"",
					"OPEN-SERIAL-1,OPEN-SERIAL-2",
				],
			]
		)
		self.assertTrue(all(row["action"] == "NEW" for row in planned))

		def simulated_commit():
			frappe.local.inventory_cache_revision_touched = False

		with patch.object(frappe.db, "commit", side_effect=simulated_commit):
			imports.run_opening_import(request.name, "Administrator")
		result = frappe.get_doc("Inventory Import", request.name)
		self.assertEqual(result.status, "Completed", result.error)
		self.assertEqual(len(frappe.parse_json(result.created_documents)), 1)
		native = frappe.get_doc("Stock Reconciliation", frappe.parse_json(result.created_documents)[0])
		self.assertEqual(native.docstatus, 1)
		self.assertEqual(len(native.items), 2)
		self.assertTrue(frappe.db.exists("Batch", {"name": batch_no, "item": batch_item.name}))
		self.assertTrue(
			frappe.db.exists("Serial No", {"name": "OPEN-SERIAL-1", "item_code": serial_item.name})
		)
		self.assertTrue(
			frappe.db.exists("Serial No", {"name": "OPEN-SERIAL-2", "item_code": serial_item.name})
		)
		self.assertEqual({row.batch_no for row in native.items if row.batch_no}, {batch_no})
		self.assertEqual({row.warehouse for row in native.items}, {self.a, self.b})

	def test_import_rejects_a_location_outside_the_users_warehouse_permissions(self):
		manager_email = f"ti-opening-scope-{self.token}@example.test"
		manager = frappe.get_doc(
			{
				"doctype": "User",
				"email": manager_email,
				"first_name": "Opening Scope Test",
				"user_type": "System User",
				"send_welcome_email": 0,
				"roles": [{"role": "Inventory Manager"}],
			}
		).insert(ignore_permissions=True)
		frappe.get_doc(
			{
				"doctype": "User Permission",
				"user": manager.name,
				"allow": "Warehouse",
				"for_value": self.a,
			}
		).insert(ignore_permissions=True)
		locations = {row["name"]: row for row in present_locations(warehouse_scopes()[1])}
		raw = self.workbook([[self.item, locations[self.b]["label"], 1, 1, "", "", "", ""]])
		rows = imports._opening_workbook(raw, "opening.xlsx")
		frappe.set_user(manager.name)
		try:
			planned, _digest = imports._opening_plan(rows, str(frappe.utils.nowdate()), "00:00:01")
		finally:
			frappe.set_user("Administrator")
		self.assertEqual(planned[0]["action"], "REJECTED")
		self.assertTrue(planned[0]["errors"])

	def test_viewer_and_operator_are_refused_by_opening_import_endpoints(self):
		endpoints = (
			lambda: imports.opening_template(),
			lambda: imports.opening_catalog(),
			lambda: imports.upload("Opening Stock"),
			lambda: imports.preview("missing"),
			lambda: imports.commit("missing", "hash"),
			lambda: imports.status("missing"),
			lambda: imports.retry("missing"),
			lambda: imports.report("missing"),
		)
		for role in ("Inventory Viewer", "Inventory Operator"):
			email = f"ti-opening-import-{self.token}-{role.split()[-1].lower()}@example.test"
			if frappe.db.exists("User", email):
				frappe.delete_doc("User", email, force=True, ignore_permissions=True)
			user = (
				frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": "Opening Import Test",
						"user_type": "System User",
						"send_welcome_email": 0,
						"roles": [{"role": role}],
					}
				)
				.insert(ignore_permissions=True)
				.name
			)
			frappe.set_user(user)
			for endpoint in endpoints:
				with self.subTest(role=role, endpoint=endpoint), self.assertRaises(frappe.PermissionError):
					endpoint()
		frappe.set_user("Administrator")
