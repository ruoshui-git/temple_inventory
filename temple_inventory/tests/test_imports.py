"""Native Item import planning, dry-run and transaction regressions."""

import io
import zipfile
from unittest.mock import patch

import frappe
import openpyxl
import xlsxwriter

from temple_inventory import imports, read_cache
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class ItemImportTests(NativeDocumentTests):
	def workbook(self, rows):
		output = io.BytesIO()
		book = xlsxwriter.Workbook(output, {"in_memory": True})
		sheet = book.add_worksheet("物品导入")
		for col, header in enumerate(imports.HEADERS):
			sheet.write_string(0, col, header)
		for i, row in enumerate(rows, 1):
			for col, value in enumerate(row):
				sheet.write_string(i, col, value)
		book.close()
		return output.getvalue()

	def test_template_is_readable_and_import_sheet_has_headers_only(self):
		output = io.BytesIO()
		with patch.object(frappe, "response", frappe._dict()):
			imports.item_template()
			output.write(frappe.response.filecontent)
		book = openpyxl.load_workbook(io.BytesIO(output.getvalue()), read_only=True)
		self.assertEqual(book.sheetnames, ["物品导入", "填写说明", "示例"])
		self.assertEqual([cell.value for cell in next(book["物品导入"].iter_rows())], imports.HEADERS)
		self.assertEqual(book["物品导入"].max_row, 1)

	def test_dry_plan_fingerprint_and_duplicate_rows(self):
		rows = imports._workbook(
			self.workbook([["", "", "新物品", "", "Nos", "", "", "不追踪", "否", ""]]), "items.xlsx"
		)
		plan, digest = imports._plan(rows)
		self.assertEqual(plan[0]["action"], "NEW")
		self.assertEqual(len(digest), 64)
		duplicates = imports._workbook(
			self.workbook(
				[
					["", "", "重复物品", "", "Nos", "", "", "不追踪", "否", ""],
					["", "", "重复物品", "", "Nos", "", "", "不追踪", "否", ""],
				]
			),
			"items.xlsx",
		)
		plan, _ = imports._plan(duplicates)
		self.assertTrue(all(row["action"] == "REJECTED" for row in plan))
		self.assertIn("第 2 行", plan[1]["errors"][0])

	def row(self, **values):
		return {
			"row": 2,
			"item_code": "",
			"ti_import_ref": "",
			"item_name": "",
			"item_group": "",
			"stock_uom": "",
			"description": "",
			"barcode": "",
			"tracking": "",
			"has_expiry_date": "",
			"serial_no_series": "",
			**values,
		}

	def test_existing_item_is_updated_or_unchanged_and_invalid_values_are_rejected(self):
		item = frappe.get_doc("Item", self.item)
		unchanged = imports._plan(
			[
				self.row(
					item_code=item.name,
					item_name=item.item_name,
					stock_uom=item.stock_uom,
					tracking="不追踪",
					has_expiry_date="否",
				)
			]
		)[0][0]
		self.assertEqual(unchanged["action"], "UNCHANGED", unchanged["errors"])
		update = imports._plan(
			[
				self.row(
					item_code=item.name,
					item_name="Updated import name",
					stock_uom=item.stock_uom,
				)
			]
		)[0][0]
		self.assertEqual(update["action"], "UPDATE")
		self.assertEqual(update["before"]["item_name"], item.item_name)
		self.assertEqual(update["after"]["item_name"], "Updated import name")
		unknown_category = imports._plan(
			[self.row(item_name="Unknown category", stock_uom="Nos", item_group="不存在的类别")]
		)[0][0]
		self.assertEqual(unknown_category["action"], "REJECTED")
		other_uom = next(
			row.name
			for row in frappe.get_list("UOM", fields=["name"], limit_page_length=0)
			if row.name != item.stock_uom
		)
		immutable = imports._plan(
			[self.row(item_code=item.name, item_name=item.item_name, stock_uom=other_uom)]
		)[0][0]
		self.assertEqual(immutable["action"], "REJECTED")
		self.assertTrue(any("编号与库存单位不能在此更改" in error for error in immutable["errors"]))

	def test_preview_does_not_write_items_series_or_files_and_does_not_guess_code(self):
		series = frappe.db.sql("select current from tabSeries where name='ITM'", pluck=True)
		before = {
			"items": frappe.db.count("Item"),
			"files": frappe.db.count("File"),
			"series": series[0] if series else None,
		}
		planned, _ = imports._plan([self.row(item_name="Dry run item", stock_uom="Nos")])
		series_after = frappe.db.sql("select current from tabSeries where name='ITM'", pluck=True)
		after = {
			"items": frappe.db.count("Item"),
			"files": frappe.db.count("File"),
			"series": series_after[0] if series_after else None,
		}
		self.assertEqual(before, after)
		self.assertEqual(planned[0]["action"], "NEW")
		self.assertEqual(planned[0]["target"], "")
		self.assertNotIn("item_code", planned[0])

	def test_barcode_clash_and_submitted_tracking_change_are_rejected(self):
		other = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-IMPORT-BARCODE-{self.token}",
				"item_name": "Barcode owner",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		other.append("barcodes", {"barcode": f"BC-{self.token}"})
		other.save()
		clash = imports._plan(
			[self.row(item_name="Barcode clash", stock_uom="Nos", barcode=f"BC-{self.token}")]
		)[0][0]
		self.assertEqual(clash["action"], "REJECTED")
		self.assertTrue(any("已被其它物品使用" in error for error in clash["errors"]))
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		self.receipt()
		item = frappe.get_doc("Item", self.item)
		tracking = imports._plan(
			[
				self.row(
					item_code=item.name, item_name=item.item_name, stock_uom=item.stock_uom, tracking="批次"
				)
			]
		)[0][0]
		self.assertEqual(tracking["action"], "REJECTED")
		self.assertTrue(any("已有已提交库存单据" in error for error in tracking["errors"]))

	def test_upload_dry_run_writes_only_its_private_source_file(self):
		from types import SimpleNamespace

		raw = self.workbook([["", "upload-dry", "Upload dry run", "", "Nos", "", "", "不追踪", "否", ""]])
		before_items = frappe.db.count("Item")
		before_files = frappe.db.count("File")
		series = frappe.db.sql("select current from tabSeries where name='ITM'", pluck=True)
		uploaded = SimpleNamespace(filename="upload.xlsx", stream=io.BytesIO(raw))
		with patch.object(frappe, "request", SimpleNamespace(files={"file": uploaded})):
			result = imports.upload()
		self.assertEqual(result["counts"]["new"], 1)
		self.assertEqual(frappe.db.count("Item"), before_items)
		self.assertEqual(frappe.db.count("File"), before_files + 1)
		series_after = frappe.db.sql("select current from tabSeries where name='ITM'", pluck=True)
		self.assertEqual(series_after[0] if series_after else None, series[0] if series else None)
		file_name = frappe.db.get_value("Inventory Import", result["name"], "source_file")
		file_doc = frappe.get_doc("File", file_name)
		self.addCleanup(lambda: __import__("pathlib").Path(file_doc.get_full_path()).unlink(missing_ok=True))

	def test_reference_retry_is_unchanged_and_item_duplicate_does_not_copy_unique_ref(self):
		item = frappe.get_doc("Item", self.item)
		item.ti_import_ref = f"retry-{self.token}"
		item.save()
		planned, _ = imports._plan(
			[
				self.row(
					ti_import_ref=item.ti_import_ref,
					item_name=item.item_name,
					stock_uom=item.stock_uom,
					tracking="不追踪",
					has_expiry_date="否",
				)
			]
		)
		self.assertEqual(planned[0]["action"], "UNCHANGED", planned[0]["errors"])
		duplicate = frappe.copy_doc(item, ignore_no_copy=False)
		duplicate.item_code = f"TI-DUP-{self.token}"
		duplicate.insert()
		self.assertFalse(duplicate.ti_import_ref)

	def test_blank_reference_keeps_existing_reference_on_code_update(self):
		item = frappe.get_doc("Item", self.item)
		item.ti_import_ref = f"preserve-{self.token}"
		item.save()
		doc, _ = self.create_request(
			[[item.name, "", item.item_name, "", item.stock_uom, "", "", "不追踪", "否", ""]]
		)
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		frappe.db.savepoint("ti_import_reference")
		with patch.object(frappe.db, "commit", return_value=None):
			imports.run_import(doc.name, frappe.session.user)
		self.assertEqual(frappe.db.get_value("Item", item.name, "ti_import_ref"), f"preserve-{self.token}")

	def test_formula_looking_report_values_are_written_as_text(self):
		with patch.object(frappe, "response", frappe._dict()):
			imports._xlsx_response("test", [("结果", ["值"], [["=1+1"]])], "result.xlsx")
			content = frappe.response.filecontent
		book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=False)
		cell = book["结果"]["A2"]
		self.assertEqual(cell.value, "=1+1")
		self.assertEqual(cell.data_type, "s")

	def test_file_size_macro_and_zip_size_guards(self):
		with self.assertRaises(frappe.ValidationError):
			imports._workbook(b"x" * (imports.MAX_FILE + 1), "large.xlsx")
		valid = self.workbook([["", "R", "Macro", "", "Nos", "", "", "不追踪", "否", ""]])
		buffer = io.BytesIO()
		with zipfile.ZipFile(io.BytesIO(valid)) as source, zipfile.ZipFile(buffer, "w") as target:
			for entry in source.infolist():
				target.writestr(entry, source.read(entry.filename))
			target.writestr("xl/vbaProject.bin", b"macro")
		with self.assertRaises(frappe.ValidationError):
			imports._workbook(buffer.getvalue(), "macro.xlsx")
		fake_archive = type(
			"Archive",
			(),
			{
				"__enter__": lambda self: self,
				"__exit__": lambda self, *_: None,
				"infolist": lambda self: [type("Entry", (), {"file_size": imports.MAX_UNPACKED + 1})()],
			},
		)()
		with patch("temple_inventory.imports.zipfile.ZipFile", return_value=fake_archive):
			with self.assertRaises(frappe.ValidationError):
				imports._workbook(b"x", "bomb.xlsx")

	def test_data_row_limit_is_enforced(self):
		output = io.BytesIO()
		book = xlsxwriter.Workbook(output, {"in_memory": True})
		sheet = book.add_worksheet("物品导入")
		for col, header in enumerate(imports.HEADERS):
			sheet.write_string(0, col, header)
		for row in range(1, imports.MAX_ROWS + 2):
			sheet.write_string(row, 2, f"Limit row {row}")
			sheet.write_string(row, 4, "Nos")
		book.close()
		with self.assertRaises(frappe.ValidationError):
			imports._workbook(output.getvalue(), "limit.xlsx")

	def create_request(self, rows):
		raw = self.workbook(rows)
		parsed = imports._workbook(raw, "import.xlsx")
		planned, digest = imports._plan(parsed)
		file_doc = frappe.get_doc(
			{"doctype": "File", "file_name": "import.xlsx", "content": raw, "is_private": 1}
		).insert()
		self.addCleanup(lambda: __import__("pathlib").Path(file_doc.get_full_path()).unlink(missing_ok=True))
		doc = frappe.get_doc(
			{
				"doctype": "Inventory Import",
				"import_type": "Item",
				"status": "Previewed",
				"source_file": file_doc.name,
				"file_sha256": __import__("hashlib").sha256(raw).hexdigest(),
				"preview_json": __import__("json").dumps(planned, ensure_ascii=False),
				"plan_hash": digest,
				"new_count": sum(row["action"] == "NEW" for row in planned),
				"update_count": sum(row["action"] == "UPDATE" for row in planned),
				"unchanged_count": sum(row["action"] == "UNCHANGED" for row in planned),
				"rejected_count": sum(row["action"] == "REJECTED" for row in planned),
			}
		)
		imports._save(doc)
		frappe.db.set_value(
			"File", file_doc.name, {"attached_to_doctype": "Inventory Import", "attached_to_name": doc.name}
		)
		return doc, parsed

	def test_update_only_adds_barcodes_and_a_known_barcode_is_unchanged(self):
		item = frappe.get_doc("Item", self.item)
		item.set("barcodes", [{"barcode": f"{self.token}A"}, {"barcode": f"{self.token}B"}])
		item.save()
		row = [self.item, "", item.item_name, "", "", "", f"{self.token}A", "", "", ""]
		rows = imports._workbook(self.workbook([row]), "b.xlsx")
		planned = imports._plan(rows)[0][0]
		self.assertEqual(planned["action"], "UNCHANGED", planned)
		row[6] = f"{self.token}C"
		doc, _ = self.create_request([row])
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		frappe.db.savepoint("ti_import_barcode")
		with patch.object(frappe.db, "commit", return_value=None):
			imports.run_import(doc.name, frappe.session.user)
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "status"), "Completed")
		barcodes = {row.barcode for row in frappe.get_doc("Item", self.item).barcodes}
		self.assertEqual(barcodes, {f"{self.token}{suffix}" for suffix in "ABC"})

	def test_plan_rejects_what_commit_would_refuse(self):
		code = f"{self.token}D"
		base = ["", "", "Clash", "", "Nos", "", "", "", "", ""]
		rows = imports._workbook(
			self.workbook(
				[
					[*base[:1], "ref-a", "Same barcode A", *base[3:6], code, *base[7:]],
					[*base[:1], "ref-b", "Same barcode B", *base[3:6], code, *base[7:]],
					[*base[:1], "ref-c", "No tracking, expiry", *base[3:7], "不追踪", "是", ""],
					[*base[:1], "ref-d", "Expiry implies batch", *base[3:7], "", "是", ""],
					[*base[:1], "ref-e", "Serial, expiry", *base[3:7], "序列号", "是", ""],
				]
			),
			"p.xlsx",
		)
		planned = imports._plan(rows)[0]
		self.assertEqual([row["action"] for row in planned[:3]], ["REJECTED"] * 3)
		self.assertEqual(planned[3]["action"], "NEW")
		self.assertEqual(planned[3]["values"]["tracking"], "批次")
		self.assertEqual(planned[4]["action"], "REJECTED")

	def test_reference_owned_by_another_item_is_rejected(self):
		other = frappe.get_doc("Item", self.item)
		frappe.db.set_value("Item", other.name, "ti_import_ref", f"{self.token}-owned")
		code = frappe.get_all("Item", filters={"name": ["!=", other.name]}, pluck="name", limit=1)[0]
		rows = imports._workbook(
			self.workbook([[code, f"{self.token}-owned", "", "", "", "", "", "", "", ""]]), "r.xlsx"
		)
		self.assertEqual(imports._plan(rows)[0][0]["action"], "REJECTED")

	def test_item_changed_after_the_plan_stops_as_a_conflict(self):
		item = frappe.get_doc("Item", self.item)
		doc, _ = self.create_request([[self.item, "", f"{item.item_name} v2", "", "", "", "", "", "", ""]])
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		frappe.db.savepoint("ti_import_late_change")
		original_plan = imports._plan

		def plan_then_edit(rows):
			result = original_plan(rows)
			frappe.db.set_value("Item", self.item, "modified", frappe.utils.now_datetime())
			return result

		with (
			patch.object(frappe.db, "commit", return_value=None),
			patch.object(frappe.db, "rollback", return_value=None),
			patch.dict(imports.IMPORT_TYPES["Item"], {"plan": plan_then_edit}),
		):
			imports.run_import(doc.name, frappe.session.user)
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "status"), "Conflict")

	def test_rejection_during_preview_leaves_no_message_for_the_response(self):
		item = frappe.get_doc("Item", self.item)
		other_unit = "Box" if item.stock_uom != "Box" else "Nos"
		rows = imports._workbook(
			self.workbook([[self.item, "", "", "", other_unit, "", "", "", "", ""]]), "m.xlsx"
		)
		frappe.local.message_log = []
		self.assertEqual(imports._plan(rows)[0][0]["action"], "REJECTED")
		self.assertEqual(frappe.local.message_log, [])

	def test_double_commit_queues_once(self):
		doc, _ = self.create_request(
			[["", "double", "Double commit item", "", "Nos", "", "", "不追踪", "否", ""]]
		)
		with patch("temple_inventory.imports._enqueue") as enqueue:
			first = imports.commit(doc.name, doc.plan_hash)
			second = imports.commit(doc.name, doc.plan_hash)
		self.assertEqual(first["status"], "Queued")
		self.assertEqual(second["status"], "Queued")
		enqueue.assert_called_once()

	def test_stale_running_import_can_be_replanned_with_a_new_attempt(self):
		doc, _ = self.create_request(
			[["", "stale-run", "Stale running item", "", "Nos", "", "", "不追踪", "否", ""]]
		)
		frappe.db.set_value("Inventory Import", doc.name, {"status": "Running", "attempt": 2})
		frappe.cache.delete_value(f"ti-import-progress:{doc.name}")
		with patch("frappe.utils.background_jobs.is_job_enqueued", return_value=False):
			result = imports.status(doc.name)
		self.assertEqual(result["status"], "Failed")
		self.assertTrue(result["can_retry"])
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "status"), "Running")
		with patch("frappe.utils.background_jobs.is_job_enqueued", return_value=False):
			retried = imports.retry(doc.name)
		self.assertEqual(retried["status"], "Previewed")
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "attempt"), 3)

	def test_rejected_rows_require_explicit_skip_before_commit(self):
		doc, _ = self.create_request(
			[["", "rejected-gate", "Rejected gate", "", "missing-uom", "", "", "", "", ""]]
		)
		with self.assertRaisesRegex(frappe.ValidationError, "明确选择跳过"):
			imports.commit(doc.name, doc.plan_hash)
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "status"), "Previewed")
		with patch("temple_inventory.imports._enqueue") as enqueue:
			result = imports.commit(doc.name, doc.plan_hash, skip_rejected=1)
		self.assertEqual(result["status"], "Queued")
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "skip_rejected"), 1)
		enqueue.assert_called_once()

	def test_job_returns_allocated_codes_and_same_file_replans_unchanged(self):
		doc, rows = self.create_request(
			[["", "job-ref", "Job created item", "", "Nos", "", "", "不追踪", "否", ""]]
		)
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		frappe.db.savepoint("ti_import_success")
		with patch.object(frappe.db, "commit", return_value=None):
			imports.run_import(doc.name, frappe.session.user)
		result = frappe.get_doc("Inventory Import", doc.name)
		created = __import__("json").loads(result.result_json)
		self.assertEqual(result.status, "Completed")
		self.assertRegex(created[0]["item_code"], r"^ITM-")
		self.assertEqual(imports._plan(rows)[0][0]["action"], "UNCHANGED")
		self.assertTrue(frappe.db.exists("Item", created[0]["item_code"]))

	def test_code_series_commits_before_item_writes_and_cache_bump_is_deferred(self):
		doc, _ = self.create_request(
			[
				["", "short-tx-a", "Short transaction A", "", "Nos", "", "", "不追踪", "否", ""],
				["", "short-tx-b", "Short transaction B", "", "Nos", "", "", "不追踪", "否", ""],
			]
		)
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		frappe.db.savepoint("ti_import_short_transaction")
		events = []
		original_save = frappe.model.document.Document.save
		original_allocate = imports.allocate_item_code
		original_bump = read_cache._bump_durable_revision

		def save(document, *args, **kwargs):
			if document.doctype == "Item":
				events.append(("item", frappe.local.inventory_cache_revision_touched))
			return original_save(document, *args, **kwargs)

		def allocate():
			events.append(("allocate", None))
			return original_allocate()

		def bump():
			events.append(("bump", frappe.local.inventory_cache_revision_touched))
			return original_bump()

		def commit():
			# A real commit runs read_cache's publish callback, which clears this flag.
			events.append(("commit", None))
			frappe.local.inventory_cache_revision_touched = False

		with (
			patch.object(frappe.db, "commit", side_effect=commit),
			patch.object(frappe.model.document.Document, "save", new=save),
			patch.object(imports, "allocate_item_code", side_effect=allocate),
			patch.object(read_cache, "_bump_durable_revision", side_effect=bump),
		):
			imports.run_import(doc.name, frappe.session.user)

		allocation_positions = [i for i, event in enumerate(events) if event[0] == "allocate"]
		item_positions = [i for i, event in enumerate(events) if event[0] == "item"]
		commit_positions = [i for i, event in enumerate(events) if event[0] == "commit"]
		bump_position = next(i for i, event in enumerate(events) if event[0] == "bump")
		self.assertEqual(len(item_positions), 2)
		self.assertLess(max(allocation_positions), min(item_positions))
		self.assertTrue(any(max(allocation_positions) < i < min(item_positions) for i in commit_positions))
		self.assertFalse(any(item_positions[0] < i < item_positions[-1] for i in commit_positions))
		self.assertLess(item_positions[-1], bump_position)
		self.assertLess(bump_position, max(commit_positions))
		self.assertTrue(all(events[i][1] for i in item_positions))
		self.assertTrue(events[bump_position][1])

	def test_job_plan_conflict_writes_no_item(self):
		item = frappe.get_doc("Item", self.item)
		doc, _ = self.create_request(
			[[item.name, "", item.item_name, "", item.stock_uom, "", "", "不追踪", "否", ""]]
		)
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		item.description = "changed after preview"
		item.save()
		count = frappe.db.count("Item")
		frappe.db.savepoint("ti_import_conflict")
		with patch.object(frappe.db, "commit", return_value=None):
			imports.run_import(doc.name, frappe.session.user)
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "status"), "Conflict")
		self.assertEqual(frappe.db.count("Item"), count)

	def test_mid_job_failure_rolls_back_every_item(self):
		doc, _ = self.create_request(
			[
				["", "fail-one", "First atomic row", "", "Nos", "", "", "不追踪", "否", ""],
				["", "fail-two", "Second atomic row", "", "Nos", "", "", "不追踪", "否", ""],
			]
		)
		frappe.db.set_value("Inventory Import", doc.name, "status", "Queued")
		count = frappe.db.count("Item")
		frappe.db.savepoint("ti_import_failure")
		real_rollback = frappe.db.rollback
		original_save = frappe.model.document.Document.save
		saved_items = 0

		def fail_second_item(document, *args, **kwargs):
			nonlocal saved_items
			if document.doctype == "Item":
				saved_items += 1
				if saved_items == 2:
					raise frappe.ValidationError("第二行测试失败")
			return original_save(document, *args, **kwargs)

		def rollback_to_job_savepoint():
			return real_rollback(save_point="ti_import_failure")

		with (
			patch.object(frappe.db, "commit", return_value=None),
			patch.object(frappe.db, "rollback", side_effect=rollback_to_job_savepoint),
			patch.object(frappe.model.document.Document, "save", new=fail_second_item),
		):
			imports.run_import(doc.name, frappe.session.user)
		self.assertEqual(frappe.db.get_value("Inventory Import", doc.name, "status"), "Failed")
		self.assertIn("第 3 行", frappe.db.get_value("Inventory Import", doc.name, "error"))
		self.assertEqual(frappe.db.count("Item"), count)

	def test_item_catalog_export_round_trips_as_unchanged(self):
		item = frappe.get_doc("Item", self.item)
		item.ti_import_ref = f"catalog-{self.token}"
		item.save()
		with patch.object(frappe, "response", frappe._dict()):
			imports.item_catalog()
			content = frappe.response.filecontent
		book = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
		self.assertEqual(book.sheetnames, ["物品导入"])
		rows = imports._workbook(content, "catalog.xlsx")
		self.assertIn(item.name, {row["item_code"] for row in rows})
		plan, _ = imports._plan(rows)
		self.assertTrue(
			all(row["action"] == "UNCHANGED" for row in plan),
			[
				(
					row["row"],
					row["target"],
					row["action"],
					row["errors"],
					row["values"].get("stock_uom"),
					row["values"].get("item_group"),
				)
				for row in plan
				if row["action"] != "UNCHANGED"
			][:10],
		)

	def test_xlsx_guard_rejects_non_xlsx_and_wrong_sheet(self):
		with self.assertRaises(frappe.ValidationError):
			imports._workbook(b"not xlsx", "file.xlsm")
		output = io.BytesIO()
		book = xlsxwriter.Workbook(output, {"in_memory": True})
		book.add_worksheet("Wrong")
		book.close()
		with self.assertRaises(frappe.ValidationError):
			imports._workbook(output.getvalue(), "wrong.xlsx")
