"""Golden endpoint payloads for browse and native report projection refactors."""

import json
import os
import re
from pathlib import Path
from uuid import uuid4

import frappe
from frappe.utils import add_days, getdate, nowdate

from temple_inventory import browse, catalog, counts, native_api
from temple_inventory.projections import group_page, report_page
from temple_inventory.report_query import DEFINITIONS, group_sequences_for_view, validate_query
from temple_inventory.tests.test_native_documents import NativeDocumentTests

GOLDEN_PATH = Path(__file__).with_name("fixtures") / "browse_golden.json"


class BrowseGoldenTests(NativeDocumentTests):
	def test_browse_and_projection_payloads_match_golden(self):
		frappe.db.set_single_value("Stock Settings", "enable_serial_and_batch_no_for_item", 1)
		item = frappe.get_doc("Item", self.item)
		item.has_batch_no, item.has_expiry_date = 1, 1
		item.save()
		batch = catalog.create_batch(
			self.item, "TI-GOLDEN-" + self.token, add_days(nowdate(), -20), add_days(nowdate(), 90)
		)["name"]

		def batched(kind="Receive", quantity=10, source=None, target=None, **header):
			data = self.movement(kind, quantity, source, target, **header)
			data["items"][0].update({"batch_no": batch, "use_serial_batch_fields": 1})
			return data

		receipt = batched(quantity=12)
		fixture_names = [self.submit(self.create(receipt)).name]
		fixture_names.append(self.submit(self.create(batched("Issue", 1, self.a))).name)
		fixture_names.append(self.submit(self.create(batched("Transfer", 2, self.a, self.b))).name)
		loan = self.submit(
			self.create(
				batched(
					"Loan",
					4,
					self.a,
					self.loan_leaf,
					ti_borrower="Golden borrower",
					ti_activity=self.activity.name,
				)
			)
		)
		fixture_names.append(loan.name)
		for outcome, kind, destination in (
			("Returned", "Return", self.b),
			("Damaged", "Damage", self.damaged),
			("Lost", "Loss", None),
		):
			settlement = batched(
				kind,
				1,
				self.loan_leaf,
				destination,
				ti_borrower=loan.ti_borrower,
				ti_activity=loan.ti_activity,
			)
			settlement["items"][0].update(
				{
					"ti_original_loan": loan.name,
					"ti_original_loan_line": loan["items"][0].name,
					"ti_settlement_outcome": outcome,
				}
			)
			fixture_names.append(self.submit(self.create(settlement)).name)
		count_doc = counts.save_count(str(uuid4()), self.count_data(10, "Reviewed"))
		native_api.submit_document("Stock Reconciliation", count_doc.name, count_doc.version)
		fixture_names.extend(
			(count_doc.name, self.create(batched("Receive", 3, ti_source_text="Golden draft")).name)
		)
		for name in tuple(fixture_names):
			doctype = "Stock Reconciliation" if name == count_doc.name else "Stock Entry"
			doc = frappe.get_doc(doctype, name)
			fixture_names.extend(row.name for row in doc.get("items") or [])
			fixture_names.extend(row.name for row in doc.get("ti_count_review") or [])

		query = validate_query(
			{
				"dataset": "movements",
				"view": "records",
				"sortBy": "date",
				"sort": "desc",
				"statuses": [0, 1],
				"groupBy": ["kind", "status"],
				"scope": {
					"item": self.item,
					"warehouses": [self.root],
					"tracking": "batch",
					"period": {"key": "all", "from": "", "to": ""},
				},
				"search": "Golden",
				"person": {"name": "Administrator", "role": "any"},
				"batchNo": batch,
				"loanOutcome": "all",
				"itemStatus": "enabled",
			}
		)
		loan_query = validate_query(
			{
				**query,
				"dataset": "loans",
				"view": "records",
				"groupBy": ["borrower"],
				"scope": {**query["scope"], "tracking": "all"},
				"borrower": "Golden borrower",
			}
		)
		loan_items_query = validate_query(
			{**loan_query, "view": "items", "groupBy": ["item"], "sortBy": "item_name"}
		)
		payloads = {
			"operation_page_movements_items": browse.operation_page(query, records=False),
			"operation_page_movements_records": browse.operation_page(query, records=True),
			"operation_page_loans_items": browse.operation_page(loan_items_query, records=False),
			"operation_page_loans_records": browse.operation_page(loan_query, records=True),
			"movement_history": browse.movement_history(query, item_code=self.item, batch_no=batch),
			"loan_item_history": browse.loan_item_history(loan_query, self.item),
			"operation_analysis": browse.operation_analysis(query, records=True),
			"operation_contributions": browse.operation_contributions(
				loan_query, item_code=self.item, outcome="outstanding"
			),
			"inventory_page": browse.inventory_page({"dataset": "inventory", "scope": query["scope"]}),
			"expiry_page": browse.expiry_page({"dataset": "expiry", "scope": query["scope"]}),
			"native_drafts": browse.native_drafts({"dataset": "movements", "scope": query["scope"]}),
			"counts_page": browse.counts_page({"dataset": "counts", "scope": query["scope"]}),
			"dashboard_card_inventory": browse.dashboard_card("inventory", query["scope"], refresh=True),
			"dashboard_card_distribution": browse.dashboard_card(
				"distribution", query["scope"], refresh=True
			),
			"dashboard_card_expiry": browse.dashboard_card("expiry", query["scope"], refresh=True),
			"dashboard_card_movement": browse.dashboard_card(
				"movement", query["scope"], {"key": "all", "from": "", "to": ""}, refresh=True
			),
			"dashboard_card_loans": browse.dashboard_card("loans", query["scope"], refresh=True),
			"dashboard_card_reminders": browse.dashboard_card("reminders", query["scope"], refresh=True),
		}
		for dataset, definition in DEFINITIONS.items():
			for view in definition["views"]:
				report_scope = dict(query["scope"])
				if view == "historical":
					today = str(nowdate())
					report_scope["period"] = {"key": "custom", "from": today, "to": today}
				report_query = validate_query({"dataset": dataset, "view": view, "scope": report_scope})
				key = f"report_page:{dataset}:{view}"
				payloads[key] = report_page(report_query, refresh=True)
				group_by = next(
					(fields[0] for fields in group_sequences_for_view(dataset, view) if fields), None
				)
				if group_by:
					group_query = validate_query({**report_query, "groupBy": [group_by]})
					payloads[f"group_page:{dataset}:{view}"] = group_page(group_query, refresh=True)

		payloads = _normalize(
			payloads,
			self.token,
			fixture_names,
			batch,
			self.item,
			self.root,
			self.physical,
			self.system_root,
			self.room_a,
			self.room_b,
			self.a,
			self.b,
			self.loan_leaf,
			self.damaged,
			self.activity.name,
		)
		if os.environ.get("TI_UPDATE_BROWSE_GOLDEN") == "1":
			GOLDEN_PATH.parent.mkdir(exist_ok=True)
			GOLDEN_PATH.write_text(json.dumps(payloads, ensure_ascii=False, indent=2) + "\n")
		self.assertTrue(
			GOLDEN_PATH.exists(), "Generate the initial golden on the pre-refactor implementation"
		)
		expected = json.loads(GOLDEN_PATH.read_text())
		self.assertEqual(payloads.keys(), expected.keys())
		for endpoint, actual in payloads.items():
			with self.subTest(endpoint=endpoint):
				if actual != expected[endpoint]:
					self.fail(f"first golden difference: {_first_difference(actual, expected[endpoint])}")


def _normalize(value, token, document_names, batch, item, root, *warehouses):
	# Fixture dates are relative to the run date; keep the offset so the golden holds on any day.
	today = getdate(nowdate())

	def relative_date(match):
		offset = (getdate(match.group(0)) - today).days
		return f"<today{offset:+d}>" if offset else "<today>"

	generated = {}
	for index, name in enumerate((item, root, *warehouses, batch), start=1):
		generated[name] = f"<fixture-{index}>"
	for index, name in enumerate(document_names, start=1):
		generated[name] = f"<document-{index}>"

	def visit(item_value, key=""):
		if isinstance(item_value, dict):
			return {name: visit(child, name) for name, child in item_value.items()}
		if isinstance(item_value, list):
			return [visit(child, key) for child in item_value]
		if isinstance(item_value, str):
			if key == "id":
				return "<generated-id>"
			if key == "name" and re.fullmatch(r"[a-z0-9]{10}", item_value):
				return "<generated-name>"
			if key.endswith("_line") or key in ("line_name", "bundle_line"):
				return "<generated-line-id>"
			if key in (
				"snapshot",
				"modified",
				"posting_timestamp",
				"version",
				"timestamp",
				"remaining_days",
			) or ("timestamp" in key or key.endswith("_time")):
				return "<volatile>"
			if key == "date_time" and re.fullmatch(
				r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?", item_value
			):
				return "<date> <time>"
			# Native times are unpadded before 10:00 ("4:09:19").
			if re.fullmatch(r"\d{1,2}:\d{2}:\d{2}(\.\d+)?", item_value) and key == "time":
				return "<time>"
			for source, replacement in generated.items():
				item_value = item_value.replace(source, replacement)
			item_value = re.sub(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?", "<timestamp>", item_value)
			item_value = re.sub(r"\d{1,2}:\d{2}:\d{2}(?:\.\d+)?", "<time>", item_value)
			item_value = re.sub(r"\d{4}-\d{2}-\d{2}", relative_date, item_value)
			return item_value.replace(token, "<fixture-token>")
		return item_value

	return visit(value)


def _first_difference(actual, expected, path=()):
	if type(actual) is not type(expected):
		return path, actual, expected
	if isinstance(actual, dict):
		for key in actual.keys() | expected.keys():
			if key not in actual or key not in expected:
				return (*path, key), actual.get(key), expected.get(key)
			difference = _first_difference(actual[key], expected[key], (*path, key))
			if difference:
				return difference
	elif isinstance(actual, list):
		if len(actual) != len(expected):
			return (*path, "length"), len(actual), len(expected)
		for index, (left, right) in enumerate(zip(actual, expected, strict=True)):
			difference = _first_difference(left, right, (*path, index))
			if difference:
				return difference
	elif actual != expected:
		return path, actual, expected
	return None
