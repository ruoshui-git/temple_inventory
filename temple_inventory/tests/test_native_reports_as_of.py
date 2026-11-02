"""Historical (as-of) stock balances on the inventory browse and export contracts."""

import json
from types import SimpleNamespace

import frappe
from frappe.utils import get_datetime, nowdate

from temple_inventory import catalog
from temple_inventory.exports import _as_of_text, _export_info, _filename
from temple_inventory.projections import Projection, report_page
from temple_inventory.report_query import normalize_as_of, validate_query
from temple_inventory.tests.helpers import NativeReportTestCase
from temple_inventory.tests.test_serial_tracking import SerialTrackingTests


class NativeReportsAsOfTests(NativeReportTestCase):
	def dated(self, data, posting_date):
		return {**data, "posting_date": posting_date}

	def post(self, data):
		return self.submit(self.create(data))

	def locations(self, as_of, view="locations", item=None, **changes):
		scope = {"item": item or self.item, "warehouses": [self.root]}
		query = self.query("inventory", view, asOf=as_of, scope=scope, **changes)
		return {(row["warehouse"], row["batch_no"]): row for row in report_page(query)["rows"]}

	def test_as_of_reads_ledger_balances_at_the_boundary_for_plain_items(self):
		self.post(self.dated(self.movement(quantity=10), "2026-10-01"))
		self.post(self.dated(self.movement("Transfer", 4, self.a, self.b), "2026-10-06"))
		before = self.locations("2026-10-05")
		self.assertEqual(before[(self.a, "")]["stock_qty"], 10)
		self.assertNotIn((self.b, ""), before)
		after = self.locations("2026-10-06")
		self.assertEqual(after[(self.a, "")]["stock_qty"], 6)
		self.assertEqual(after[(self.b, "")]["stock_qty"], 4)
		self.assertEqual(self.locations("2026-10-06 00:00:00")[(self.a, "")]["stock_qty"], 10)

	def test_as_of_includes_a_pair_whose_stock_has_since_left_and_ignores_bin_state(self):
		self.post(self.dated(self.movement(quantity=10), "2026-10-01"))
		self.post(self.dated(self.movement("Transfer", 10, self.a, self.b), "2026-10-08"))
		self.assertEqual(self.locations("2026-10-04")[(self.a, "")]["stock_qty"], 10)
		self.assertNotIn((self.a, ""), self.locations(""))
		self.assertEqual(self.locations("2026-10-09")[(self.b, "")]["stock_qty"], 10)

	def test_as_of_batch_items_return_each_batch_balance_at_the_boundary(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no = 1
		item.save()
		first = catalog.create_batch(self.item, "TI-ASOF-A-" + self.token)["name"]
		second = catalog.create_batch(self.item, "TI-ASOF-B-" + self.token)["name"]
		for batch, quantity, date in ((first, 5, "2026-10-01"), (second, 3, "2026-10-03")):
			data = self.dated(self.movement(quantity=quantity), date)
			data["items"][0].update({"batch_no": batch, "use_serial_batch_fields": 1})
			self.post(data)
		rows = self.locations("2026-10-02")
		self.assertEqual(rows[(self.a, first)]["stock_qty"], 5)
		self.assertNotIn((self.a, second), rows)
		rows = self.locations("2026-10-03")
		self.assertEqual(rows[(self.a, first)]["stock_qty"], 5)
		self.assertEqual(rows[(self.a, second)]["stock_qty"], 3)

	def test_as_of_serial_items_list_only_serials_present_at_the_boundary(self):
		item = SerialTrackingTests.serial_item(self)
		first = [f"SR-ASOF-{self.token}-A", f"SR-ASOF-{self.token}-B"]
		later = [f"SR-ASOF-{self.token}-C"]
		for serials, date in ((first, "2026-10-02"), (later, "2026-10-06")):
			data = {
				"company": self.company,
				"posting_date": date,
				"posting_time": "09:00:00",
				"ti_time_mode": "Manual",
				"ti_movement_kind": "Receive",
				"items": [
					{
						"item_code": item.name,
						"qty": len(serials),
						"uom": "Nos",
						"conversion_factor": 1,
						"t_warehouse": self.a,
						"basic_rate": 10,
						"serial_no": "\n".join(serials),
						"use_serial_batch_fields": 1,
					}
				],
			}
			self.post(data)
		rows = self.locations("2026-10-04", item=item.name)
		self.assertEqual(rows[(self.a, "")]["serial_nos"], "、".join(sorted(first)))
		self.assertEqual(rows[(self.a, "")]["stock_qty"], 2)
		rows = self.locations("2026-10-06", item=item.name)
		self.assertEqual(rows[(self.a, "")]["serial_nos"], "、".join(sorted(first + later)))
		self.assertEqual(rows[(self.a, "")]["stock_qty"], 3)

	def test_as_of_moves_loaned_stock_into_the_loaned_kind_on_its_posting_day(self):
		self.post(self.dated(self.movement(quantity=10), "2026-10-01"))
		self.post(
			self.dated(
				self.movement(
					"Loan",
					5,
					self.a,
					self.loan_leaf,
					ti_borrower="历史借用方",
					ti_activity=self.activity.name,
				),
				"2026-10-05",
			)
		)
		before = self.locations("2026-10-04")
		self.assertNotIn((self.loan_leaf, ""), before)
		self.assertEqual(before[(self.a, "")]["available"], 10)
		after = self.locations("2026-10-05")
		self.assertEqual(after[(self.a, "")]["available"], 5)
		self.assertEqual(after[(self.loan_leaf, "")]["loaned"], 5)
		self.assertEqual(after[(self.loan_leaf, "")]["available"], 0)

	def test_as_of_rejects_future_moments_and_unsupported_scopes(self):
		tomorrow = str(frappe.utils.add_days(nowdate(), 1))
		with self.assertRaises(frappe.ValidationError):
			validate_query({"dataset": "inventory", "view": "locations", "asOf": tomorrow})
		with self.assertRaises(frappe.ValidationError):
			validate_query({"dataset": "inventory", "view": "locations", "asOf": f"{tomorrow} 00:00:00"})
		for changes in (
			{"dataset": "movements", "view": "lines"},
			{"dataset": "expiry", "view": "batches"},
			{"dataset": "inventory", "view": "historical"},
		):
			with self.assertRaises(frappe.ValidationError, msg=str(changes)):
				validate_query({**changes, "asOf": "2026-10-01"})
		with self.assertRaises(frappe.ValidationError):
			validate_query({"dataset": "inventory", "view": "locations", "asOf": "2026-02-30"})

	def test_as_of_normalizes_dates_to_end_of_day_and_today_to_now(self):
		self.assertEqual(normalize_as_of("2026-10-31"), "2026-10-31 23:59:59")
		self.assertEqual(normalize_as_of("2026-10-31 18:00:00"), "2026-10-31 18:00:00")
		self.assertEqual(normalize_as_of(str(nowdate())), "")
		self.assertEqual(validate_query({"dataset": "inventory", "asOf": ""})["asOf"], "")
		self.assertEqual(
			validate_query({"dataset": "inventory", "view": "locations", "asOf": "2026-10-31"})["asOf"],
			"2026-10-31 23:59:59",
		)
		self.assertEqual(validate_query({"dataset": "inventory"})["asOf"], "")

	def test_as_of_projection_keeps_generated_at_now_and_exposes_the_boundary(self):
		self.post(self.dated(self.movement(quantity=10), "2026-10-01"))
		query = self.query("inventory", "locations", asOf="2026-10-04")
		with Projection(query, load_item_attachments=False, load_item_children=False) as projection:
			self.assertEqual(get_datetime(projection.context.balance_at), get_datetime("2026-10-04 23:59:59"))
			# generated-at stays the calculation time, so cache freshness is unchanged.
			self.assertEqual(projection.context.snapshot[:10], str(nowdate()))
		current = self.query("inventory", "locations")
		with Projection(current, load_item_attachments=False, load_item_children=False) as projection:
			self.assertIsNone(projection.context.balance_at)

	def test_as_of_export_names_the_boundary_and_keeps_generated_at(self):
		self.post(self.dated(self.movement(quantity=10), "2026-10-01"))
		query = self.query("inventory", "locations", asOf="2026-10-04")
		with Projection(query, load_item_attachments=False, load_item_children=False) as projection:
			doc = SimpleNamespace(
				tables_json=json.dumps(["locations"]),
				summary_json=json.dumps({"title": "库存列表", "filters": ["截至：2026-10-04"]}),  # noqa: RUF001
				owner="Administrator",
				grouped=False,
			)
			info = dict(_export_info(projection, doc, 1))
			self.assertEqual(info["截至"], "2026-10-04")
			self.assertEqual(info["生成时间"], projection.context.snapshot)
			self.assertIn("截至2026-10-04", _filename("库存列表", "locations", query, "xlsx"))
		current = self.query("inventory", "locations")
		with Projection(current, load_item_attachments=False, load_item_children=False) as projection:
			info = dict(_export_info(projection, doc, 1))
			self.assertEqual(info["截至"], "现在")
		self.assertEqual(_as_of_text("2026-10-04 18:00:00"), "2026-10-04 18:00:00")
		self.assertEqual(_as_of_text("2026-10-04 23:59:59"), "2026-10-04")
