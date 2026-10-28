"""Native supporting records, full-dataset search and dashboard integration."""

from unittest.mock import patch

import frappe
from frappe.utils.nestedset import NestedSetChildExistsError

from temple_inventory import (
	browse,
	catalog,
)
from temple_inventory.report_query import validate_query
from temple_inventory.report_sources import ReportContext
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class CatalogLifecycleTests(NativeDocumentTests):
	def test_item_tracking_toggles_use_submitted_transaction_guards(self):
		item = catalog.save_item(
			{"item_code": f"TI-TRACK-{self.token}", "item_name": "Tracking", "stock_uom": "Nos"}
		)
		current = frappe.get_doc("Item", item["item_code"])
		updated = catalog.save_item(
			{"has_batch_no": 1}, item_code=item["item_code"], version=str(current.modified)
		)
		self.assertTrue(updated["has_batch_no"])
		self.assertTrue(updated["tracking_changeable"])
		self.receipt(1)
		current = frappe.get_doc("Item", self.item)
		status = catalog.item_lifecycle(self.item)
		self.assertFalse(status["tracking_changeable"])
		self.assertIn("新建物品", status["tracking_change_reason"])
		with self.assertRaises(frappe.ValidationError):
			catalog.save_item({"has_batch_no": 1}, item_code=self.item, version=str(current.modified))

	def test_item_disable_requires_zero_stock_and_delete_uses_link_checks(self):
		self.receipt(1)
		current = frappe.get_doc("Item", self.item)
		with self.assertRaises(frappe.ValidationError):
			catalog.set_item_disabled(self.item, True, str(current.modified))
		with self.assertRaises(frappe.LinkExistsError):
			catalog.delete_item(self.item, str(current.modified))
		item = catalog.save_item(
			{"item_code": f"TI-DELETE-{self.token}", "item_name": "Unlinked", "stock_uom": "Nos"}
		)
		current = frappe.get_doc("Item", item["item_code"])
		disabled = catalog.set_item_disabled(item["item_code"], True, str(current.modified))
		self.assertTrue(disabled["disabled"])
		self.assertTrue(catalog.item_detail(item["item_code"])["disabled"])
		current = frappe.get_doc("Item", item["item_code"])
		self.assertTrue(catalog.item_lifecycle(item["item_code"])["can_delete"])
		self.assertTrue(catalog.delete_item(item["item_code"], str(current.modified))["deleted"])

	def test_reference_creation_preserves_parent_and_whole_number_setting(self):
		parent = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": "Parent " + self.token,
				"parent_item_group": catalog.item_group_root(),
				"is_group": 1,
			}
		).insert()
		child = catalog.create_category("Child " + self.token, parent.name)
		self.assertEqual(child["parent"], parent.name)
		root_child = catalog.create_category("Root child " + self.token)
		self.assertEqual(root_child["parent"], "")
		unit = catalog.create_uom("Unit " + self.token, True)
		self.assertTrue(unit["must_be_whole_number"])
		with self.assertRaises(frappe.DuplicateEntryError):
			catalog.create_uom(unit["name"], False)

	def test_item_category_can_be_blank_on_create_and_clear_to_the_native_root(self):
		root = catalog.item_group_root()
		code = "TI-UNCATEGORIZED-" + self.token
		created = catalog.save_item(
			{"item_code": code, "item_name": "Uncategorized test", "stock_uom": "Nos"}
		)
		self.assertEqual(frappe.db.get_value("Item", code, "item_group"), root)
		self.assertEqual(created["item_group"], "")
		category = catalog.create_category("Assigned " + self.token)
		catalog.save_item(
			{"item_name": "Uncategorized test", "item_group": category["name"]}, code, created["version"]
		)
		item = frappe.get_doc("Item", code)
		cleared = catalog.save_item({"item_group": ""}, code, str(item.modified))
		self.assertEqual(frappe.db.get_value("Item", code, "item_group"), root)
		self.assertEqual(cleared["item_group"], "")

	def test_category_rename_preserves_links_and_delete_uses_native_guards(self):
		category = catalog.create_category("Rename " + self.token)
		item = frappe.get_doc("Item", self.item)
		item.item_group = category["name"]
		item.save()
		renamed = catalog.save_category(
			category["name"], category["version"], {"label": category["label"] + " updated"}
		)
		self.assertNotEqual(renamed["name"], category["name"])
		self.assertEqual(frappe.db.get_value("Item", self.item, "item_group"), renamed["name"])
		with self.assertRaises(frappe.LinkExistsError):
			catalog.delete_category(renamed["name"], renamed["version"])

		with self.assertRaises(frappe.TimestampMismatchError):
			catalog.save_category(renamed["name"], category["version"], {"label": "stale"})
		with self.assertRaises(frappe.PermissionError):
			catalog.delete_category(catalog.item_group_root(), "")
		frappe.db.set_value("Item", self.item, "item_group", catalog.item_group_root())
		deletable = catalog.create_category("Delete " + self.token)
		self.assertTrue(catalog.delete_category(deletable["name"], deletable["version"])["deleted"])

	def test_category_metadata_edits_without_renaming_and_hierarchy_guards(self):
		parent = catalog.create_category("Move parent " + self.token, is_group=True)
		category = catalog.create_category("Move child " + self.token)
		moved = catalog.save_category(
			category["name"],
			category["version"],
			{"label": category["label"], "parent": parent["name"], "is_group": True},
		)
		self.assertEqual(moved["name"], category["name"])
		self.assertEqual(moved["parent"], parent["name"])
		self.assertTrue(moved["is_group"])
		leaf = catalog.save_category(
			moved["name"], moved["version"], {"label": moved["label"], "is_group": False}
		)
		self.assertFalse(leaf["is_group"])
		with self.assertRaises(frappe.ValidationError):
			catalog.save_category(
				leaf["name"], leaf["version"], {"label": leaf["label"], "parent": leaf["name"]}
			)

		branch = catalog.create_category("Cycle branch " + self.token, is_group=True)
		child = catalog.create_category("Cycle child " + self.token, branch["name"], is_group=True)
		branch = catalog.category_metadata(frappe.get_doc("Item Group", branch["name"]))
		with self.assertRaises(frappe.ValidationError):
			catalog.save_category(
				branch["name"], branch["version"], {"label": branch["label"], "parent": child["name"]}
			)
		with self.assertRaises(frappe.ValidationError):
			catalog.save_category(
				branch["name"], branch["version"], {"label": branch["label"], "is_group": False}
			)
		latest_branch = catalog.category_metadata(frappe.get_doc("Item Group", branch["name"]))
		with self.assertRaises(NestedSetChildExistsError):
			catalog.delete_category(latest_branch["name"], latest_branch["version"])

		permission = frappe.permissions.has_permission
		with patch(
			"frappe.permissions.has_permission",
			side_effect=lambda doctype, ptype="read", *args, **kwargs: (
				False
				if doctype == "Item Group" and ptype in ("create", "write", "delete")
				else permission(doctype, ptype, *args, **kwargs)
			),
		):
			with self.assertRaises(frappe.PermissionError):
				catalog.create_category("Denied " + self.token)
			with self.assertRaises(frappe.PermissionError):
				catalog.save_category(leaf["name"], leaf["version"], {"label": leaf["label"] + " edited"})
			with self.assertRaises(frappe.PermissionError):
				catalog.delete_category(leaf["name"], leaf["version"])

	def test_uncategorized_scope_is_direct_root_or_selected_category_expansion(self):
		root = catalog.item_group_root()
		parent = frappe.get_doc(
			{
				"doctype": "Item Group",
				"item_group_name": "Scoped group " + self.token,
				"parent_item_group": root,
				"is_group": 1,
			}
		).insert()
		child = catalog.create_category("Scoped child " + self.token, parent.name)
		root_item = frappe.new_doc("Item")
		root_item.update(
			{
				"item_code": "TI-ROOT-" + self.token,
				"item_name": "Root assignment " + self.token,
				"stock_uom": "Nos",
				"item_group": root,
				"is_stock_item": 1,
			}
		)
		root_item.insert()
		child_item = frappe.new_doc("Item")
		child_item.update(
			{
				"item_code": "TI-CATEGORY-" + self.token,
				"item_name": "Category assignment " + self.token,
				"stock_uom": "Nos",
				"item_group": child["name"],
				"is_stock_item": 1,
			}
		)
		child_item.insert()
		other = catalog.create_category("Unselected " + self.token)
		frappe.db.set_value("Item", self.item, "item_group", other["name"])
		context = ReportContext(
			validate_query(
				{
					"dataset": "inventory",
					"scope": {"categories": [parent.name], "uncategorized": True},
				}
			)
		)
		self.assertTrue(context.matches_item(root_item.name))
		self.assertTrue(context.matches_item(child_item.name))
		self.assertFalse(context.matches_item(self.item))
		self.assertEqual(catalog.item_metadata(root_item)["item_group"], "")
		selected = catalog.search_items(categories=[parent.name])
		combined = catalog.search_items(categories=[parent.name], uncategorized=True)
		unrestricted = catalog.search_items()
		selected_codes = {row["item_code"] for row in selected["results"]}
		combined_codes = {row["item_code"] for row in combined["results"]}
		unrestricted_codes = {row["item_code"] for row in unrestricted["results"]}
		self.assertIn(child_item.name, selected_codes)
		self.assertNotIn(root_item.name, selected_codes)
		self.assertIn(root_item.name, combined_codes)
		self.assertIn(child_item.name, combined_codes)
		self.assertNotIn(self.item, combined_codes)
		self.assertIn(root_item.name, unrestricted_codes)
		with self.assertRaises(frappe.ValidationError):
			validate_query({"dataset": "inventory", "scope": {"uncategorized": 1}})

	def test_native_operation_groups_and_contributions_page_after_complete_filtering(self):
		other = frappe.copy_doc(frappe.get_doc("Item", self.item))
		other.item_code = self.item + "-OTHER"
		other.insert()
		data = self.movement(quantity=1)
		data["items"] = [dict(data["items"][0]) for _ in range(205)]
		data["items"].append(dict(data["items"][0], item_code=other.name, qty=7))
		entry = self.submit(self.create(data))
		query = {
			"dataset": "movements",
			"scope": {"item": self.item},
			"record": entry.name,
			"sortBy": "item_name",
			"sort": "desc",
		}
		page = browse.operation_page(query, page_length=1)
		self.assertEqual(page["matched_count"], 1)
		self.assertEqual(page["rows"][0]["stock_qty"], 205)
		self.assertEqual(page["rows"][0]["totals"][0]["stock_qty"], 205)
		self.assertEqual(page["summary"]["document_count"], 1)
		self.assertEqual(page["summary"]["item_count"], 1)
		detail = browse.operation_contributions(query, item_code=self.item)
		self.assertEqual(detail["matched_count"], 1)
		self.assertEqual(len(detail["rows"]), 1)
		self.assertEqual(detail["rows"][0]["quantity"], 205.0)
		self.assertEqual(detail["rows"][0]["stock_uom"], "Nos")
		self.assertEqual(detail["rows"][0]["doctype"], "Stock Entry")
		self.assertIn("available_effect", detail["rows"][0])
		self.assertIn("docstatus", detail["rows"][0])
		self.assertEqual(browse.operation_contributions(query, item_code=self.item, start=200)["rows"], [])
		record_page = browse.operation_page(query, records=True)
		record = record_page["rows"][0]
		self.assertNotIn("allocation_count", record)
		self.assertEqual(record["whole"]["item_count"], 2)
		self.assertEqual(record["whole"]["quantities"], [{"uom": "Nos", "qty": 212}])
		self.assertNotIn("matching_totals", record)
		self.assertEqual(record["whole"]["available_effects"], [{"uom": "Nos", "qty": 212}])
		self.assertEqual(record_page["totals"][0]["stock_qty"], 212)
		self.assertEqual(record_page["totals"][0]["available_effect"], 212)
		second_entry = self.submit(self.create(self.movement("Receive", 3, None, self.a)))
		all_items = {"dataset": "movements", "view": "lines", "scope": {"item": self.item}}
		first = browse.operation_contributions(all_items, item_code=self.item, page_length=1)
		second_page = browse.operation_contributions(all_items, item_code=self.item, start=1, page_length=1)
		self.assertEqual(first["matched_count"], 2)
		self.assertNotEqual(first["rows"][0]["document"], second_page["rows"][0]["document"])
		self.assertIn(second_entry.name, {first["rows"][0]["document"], second_page["rows"][0]["document"]})
		self.assertEqual(page["analysis"]["month"]["matched_count"], 1)
		self.assertEqual(page["analysis"]["month"]["rows"][0]["stock_qty"], 205)
		self.assertEqual(
			browse.operation_page({**query, "restrictItems": True, "itemCodes": []})["matched_count"], 0
		)
