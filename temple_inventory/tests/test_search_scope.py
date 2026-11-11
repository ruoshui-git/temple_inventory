"""Browse search only considers values presented by the active view."""

import frappe

from temple_inventory import catalog, native_api
from temple_inventory.projections import report_page
from temple_inventory.report_query import validate_query
from temple_inventory.tests.helpers import NativeReportTestCase


class SearchScopeTests(NativeReportTestCase):
	def item_doc(self):
		return frappe.get_doc("Item", self.item)

	def create_item(self, code, *, description=""):
		return frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": code,
				"item_name": code,
				"description": description,
				"stock_uom": "Nos",
				"item_group": "All Item Groups",
				"is_stock_item": 1,
			}
		).insert()

	def receipt_for(self, code):
		data = self.movement()
		data["items"][0]["item_code"] = code
		self.submit(self.create(data))

	def frappe_warehouse_name(self):
		return frappe.db.get_value("Warehouse", self.a, "warehouse_name")

	def warehouse_label(self):
		from temple_inventory.report_sources import ReportContext

		context = ReportContext(
			validate_query({"dataset": "inventory", "scope": {"warehouses": [self.root]}})
		)
		return context.label(self.a)

	def _search(self, dataset, view, term):
		return report_page(
			validate_query(
				{
					"dataset": dataset,
					"view": view,
					"search": term,
					"statuses": [1],
					"scope": {"warehouses": [self.root]},
				}
			),
			refresh=True,
		)["rows"]

	def test_item_description_and_other_item_description_are_not_searchable(self):
		needle = f"description-{self.token}"
		item = self.item_doc()
		item.description = needle
		item.item_name = f"name-{self.token}"
		item.save()
		self.receipt()
		other = self.create_item(f"other-{self.token}", description=self.item)
		self.receipt_for(other.name)

		self.assertNotIn(
			self.item, {row["item_code"] for row in self._search("inventory", "summary", needle)}
		)
		self.assertIn(
			self.item,
			{row["item_code"] for row in self._search("inventory", "summary", f"name-{self.token}")},
		)
		matched = {row["item_code"] for row in self._search("inventory", "summary", self.item)}
		self.assertEqual(matched, {self.item})

	def test_internal_warehouse_name_and_company_suffix_do_not_match_stock_or_movements(self):
		self.receipt()
		warehouse_name = self.frappe_warehouse_name()
		for hidden in ("直接存放", "- O", warehouse_name):
			for dataset, view in (("inventory", "summary"), ("movements", "lines")):
				self.assertEqual(self._search(dataset, view, hidden), [], (dataset, view, hidden))

	def test_item_fields_label_batch_and_exact_serial_remain_searchable(self):
		from temple_inventory.tests.test_serial_tracking import SerialTrackingTests

		item = self.item_doc()
		item.has_batch_no = 1
		item.save()
		batch = catalog.create_batch(self.item, f"batch-{self.token}")["name"]
		data = self.movement()
		data["items"][0].update({"batch_no": batch, "use_serial_batch_fields": 1})
		self.submit(self.create(data))
		checks = (
			(self.item, self.item),
			(item.item_name, self.item),
			("无分类", self.item),
			(self.warehouse_label(), self.item),
			(batch, self.item),
		)
		for term, code in checks:
			self.assertIn(code, {row["item_code"] for row in self._search("inventory", "locations", term)})
			self.assertIn(code, {row["item_code"] for row in self._search("movements", "lines", term)})

		serials = [f"serial-{self.token}"]
		serial_item = SerialTrackingTests.serial_item(self)
		created = SerialTrackingTests.native_serial_entry(
			self, serial_item, "Receive", 1, target=self.a, serials=serials
		)
		doc = frappe.get_doc("Stock Entry", created["name"])
		native_api.submit_document("Stock Entry", doc.name, str(doc.modified))
		self.assertTrue(self._search("inventory", "locations", serials[0]))
		self.assertTrue(self._search("movements", "lines", serials[0]))

	def test_search_does_not_join_item_name_and_code(self):
		item = self.item_doc()
		item.item_name = f"ends-{self.token}X"
		item.save()
		self.receipt()
		term = f"X{self.item[:4]}"
		self.assertNotIn(self.item, {row["item_code"] for row in self._search("inventory", "summary", term)})

	def test_record_search_uses_document_and_people_but_not_internal_line_id(self):
		document = self.create(self.movement(ti_handler_name=f"person-{self.token}"))
		line_name = document["items"][0]["name"]
		self.submit(document)
		by_number = self._search("movements", "records", document["name"])
		by_person = self._search("movements", "records", f"person-{self.token}")
		self.assertIn(document["name"], {row["document"] for row in by_number})
		self.assertIn(document["name"], {row["document"] for row in by_person})
		self.assertNotIn(
			line_name, {row["document"] for row in self._search("movements", "records", line_name)}
		)
