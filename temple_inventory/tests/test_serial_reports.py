"""Serial numbers in browse, report and export data regression coverage."""

from unittest.mock import patch

import frappe

from temple_inventory import catalog, native_api
from temple_inventory.projections import report_page
from temple_inventory.report_query import validate_query
from temple_inventory.tests.test_native_documents import NativeDocumentTests
from temple_inventory.tests.test_serial_tracking import SerialTrackingTests


class SerialReportTests(NativeDocumentTests):
	def _serial_receipt(self, serials, target=None):
		item = SerialTrackingTests.serial_item(self)
		created = SerialTrackingTests.native_serial_entry(
			self, item, "Receive", len(serials), target=target or self.a, serials=serials
		)
		doc = frappe.get_doc("Stock Entry", created["name"])
		native_api.submit_document("Stock Entry", doc.name, str(doc.modified))
		return item

	def test_tracking_serial_filter_only_returns_serial_items_and_none_excludes_them(self):
		from temple_inventory.report_sources import ReportContext

		item = self._serial_receipt([f"SR-{self.token}-A"])
		batch = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": f"TI-UNTRACKED-{self.token}",
				"item_name": "Untracked test item",
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()
		for tracking, expected in (("serial", item.name), ("none", batch.name)):
			query = validate_query(
				{"dataset": "inventory", "view": "locations", "scope": {"tracking": tracking}}
			)
			context = ReportContext(query, load_item_attachments=False)
			self.assertTrue(context.matches_item(expected, self.a))
			self.assertFalse(context.matches_item(batch.name if tracking == "serial" else item.name, self.a))

	def test_bundle_serials_appear_on_movement_and_location_rows_and_search(self):
		serials = [f"SR-{self.token}-B", f"SR-{self.token}-A"]
		item = self._serial_receipt(serials)
		movement = report_page(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"search": serials[0].lower(),
				"scope": {"warehouses": [self.root], "tracking": "serial"},
			}
		)
		self.assertEqual(len(movement["rows"]), 1)
		self.assertEqual(movement["rows"][0]["serial_nos"], serials[0])
		partial_movement = report_page(
			{
				"dataset": "movements",
				"view": "lines",
				"statuses": [1],
				"search": serials[0][:-1],
				"scope": {"warehouses": [self.root], "tracking": "serial"},
			}
		)
		self.assertEqual(partial_movement["rows"], [])
		stock = report_page(
			{
				"dataset": "inventory",
				"view": "locations",
				"search": serials[0],
				"scope": {"warehouses": [self.root], "tracking": "serial"},
			}
		)
		rows = [row for row in stock["rows"] if row["item_code"] == item.name]
		self.assertEqual(rows[0]["serial_nos"], "、".join(sorted(serials)))
		partial_stock = report_page(
			{
				"dataset": "inventory",
				"view": "locations",
				"search": serials[0][:-1],
				"scope": {"warehouses": [self.root], "tracking": "serial"},
			}
		)
		self.assertFalse(any(row["item_code"] == item.name for row in partial_stock["rows"]))

	def test_serial_scan_returns_its_authorized_presenter_location(self):
		serial = f"SR-{self.token}-SCAN"
		item = self._serial_receipt([serial])
		result = catalog.scan_code(serial)
		self.assertEqual(result["serial"], serial)
		self.assertEqual(result["matches"][0]["item_code"], item.name)
		self.assertEqual(result["serial_location"]["name"], self.a)
		from temple_inventory.native_stock import warehouse_scopes
		from temple_inventory.native_topology import present_locations

		settings, visible, *_ = warehouse_scopes()
		labels = {row["name"]: row["label"] for row in present_locations(visible, settings=settings)}
		self.assertEqual(result["serial_location"]["label"], labels[self.a])

	def test_count_line_serials_are_derived_from_the_count_bundles(self):
		serials = [f"SR-{self.token}-COUNT-{index}" for index in range(2)]
		item = self._serial_receipt(serials)
		doc = SerialTrackingTests.reconcile(self, item, self.a, 1, serials[:1])
		doc.insert()
		doc.submit()
		page = report_page(
			{
				"dataset": "counts",
				"view": "lines",
				"statuses": [1],
				"scope": {"warehouses": [self.root], "tracking": "serial"},
			}
		)
		rows = [row for row in page["rows"] if row["item_code"] == item.name]
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["serial_nos"], "、".join(sorted(serials)))

	def test_loan_outcome_rows_carry_bundle_serials(self):
		serial = f"SR-{self.token}-LOAN"
		item = self._serial_receipt([serial])
		created = SerialTrackingTests.native_serial_entry(
			self, item, "Loan", 1, source=self.a, target=self.loan_leaf, serials=[serial]
		)
		loan = frappe.get_doc("Stock Entry", created["name"])
		native_api.submit_document("Stock Entry", loan.name, str(loan.modified))
		page = report_page(
			{
				"dataset": "loans",
				"view": "outcomes",
				"statuses": [1],
				"scope": {"warehouses": [self.root], "tracking": "serial"},
			}
		)
		rows = [row for row in page["rows"] if row["document"] == loan.name]
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["serial_nos"], serial)
		from temple_inventory.report_sources import ReportContext

		report_context = ReportContext(
			validate_query({"dataset": "movements", "view": "lines"}),
			load_item_attachments=False,
			load_item_children=False,
		)
		self.assertEqual(loan.company, report_context.company)
		self.assertIn(self.a, report_context.warehouses)
		self.assertIn(self.loan_leaf, report_context.warehouses)
		self.assertIsNotNone(report_context.item(item.name))
		loaned = catalog.item_serials(item.name, status="Loaned")
		self.assertEqual(loaned["rows"][0]["status"], "借出")
		self.assertEqual(
			loaned["rows"][0]["location"], frappe.get_value("Warehouse", self.loan_leaf, "ti_label")
		)
		movement = loaned["rows"][0]["last_movement"]
		self.assertIsNotNone(
			movement,
			frappe.get_all(
				"Serial and Batch Entry",
				filters={"serial_no": serial},
				fields=["name", "parent", "serial_no", "modified"],
				order_by="modified desc",
			)
			+ frappe.get_all(
				"Serial and Batch Bundle",
				filters={
					"name": [
						"in",
						frappe.get_all(
							"Serial and Batch Entry", filters={"serial_no": serial}, pluck="parent"
						),
					]
				},
				fields=["name", "voucher_type", "voucher_no"],
			),
		)
		self.assertEqual(movement["name"], loan.name)
		damage = SerialTrackingTests._native_serial_settlement(
			self, item, "Damage", loan.name, loan.items[0].name, serial, "Damaged"
		)
		native_api.submit_document("Stock Entry", damage.name, str(damage.modified))
		damaged = catalog.item_serials(item.name, status="Damaged")
		self.assertEqual(damaged["rows"][0]["status"], "损坏")
		self.assertEqual(damaged["rows"][0]["last_movement"]["name"], damage.name)

	def test_item_serials_pages_authorized_native_serials_with_presented_status(self):
		serials = [f"SR-{self.token}-PAGE-{index}" for index in range(3)]
		item = self._serial_receipt(serials)
		first = catalog.item_serials(item.name, start=0, limit=2)
		second = catalog.item_serials(item.name, start=first["next"], limit=2)
		self.assertEqual([row["serial"] for row in first["rows"]], sorted(serials)[:2])
		self.assertEqual(first["next"], 2)
		self.assertIsNone(second["next"])
		self.assertEqual([row["serial"] for row in second["rows"]], sorted(serials)[2:])
		self.assertTrue(all(row["status"] == "在库" for row in first["rows"] + second["rows"]))

	def test_item_serials_excludes_unavailable_leaf_serials(self):
		from temple_inventory.native_stock import warehouse_scopes

		item = self._serial_receipt([f"SR-{self.token}-HIDDEN"], target=self.b)
		scopes = warehouse_scopes()
		with (
			patch(
				"temple_inventory.native_stock.warehouse_scopes",
				return_value=(scopes[0], scopes[1], {self.a}, scopes[3], scopes[4]),
			),
			patch(
				"temple_inventory.report_sources.warehouse_scopes",
				return_value=(scopes[0], scopes[1], {self.a}, scopes[3], scopes[4]),
			),
		):
			result = catalog.item_serials(item.name)
			stock = report_page(
				{
					"dataset": "inventory",
					"view": "locations",
					"scope": {"item": item.name, "warehouses": [self.root], "tracking": "serial"},
				}
			)
		self.assertEqual(result["rows"], [])
		self.assertFalse(any(row["serial_nos"] for row in stock["rows"]))

	def test_consumed_serial_is_presented_as_checked_out(self):
		serial = f"SR-{self.token}-CONSUMED"
		item = self._serial_receipt([serial])
		created = SerialTrackingTests.native_serial_entry(
			self, item, "Issue", 1, source=self.a, serials=[serial]
		)
		issue = frappe.get_doc("Stock Entry", created["name"])
		native_api.submit_document("Stock Entry", issue.name, str(issue.modified))
		result = catalog.item_serials(item.name, status="Consumed")
		self.assertEqual(result["rows"][0]["status"], "已出库")
		self.assertEqual(result["rows"][0]["location"], "")
		shipped = catalog.item_serials(item.name, status="Inactive")
		self.assertEqual([row["serial"] for row in shipped["rows"]], [serial])

	def test_export_contract_exposes_serial_number_as_optional_line_field(self):
		from temple_inventory.export_columns import allowed_columns, label

		self.assertIn("serial_nos", allowed_columns("movements", "history"))
		self.assertIn("serial_nos", allowed_columns("counts", "lines"))
		self.assertEqual(label("movements", "serial_nos", "history"), "序列号")
