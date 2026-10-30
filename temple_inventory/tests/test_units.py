"""Native UOM management regression coverage."""

import frappe

from temple_inventory import units
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class UnitTests(NativeDocumentTests):
	def test_units_list_create_label_edit_and_disable(self):
		name = f"TI-TEST-Unit-{self.token}"
		created = units.save_unit(uom_name=name, label="测试单位", must_be_whole_number=True, enabled=True)
		self.assertEqual(created["label"], "测试单位")
		self.assertTrue(created["must_be_whole_number"])
		self.assertIn(name, {row["name"] for row in units.list_units()})
		updated = units.save_unit(name=name, label="测试显示", must_be_whole_number=False, enabled=False)
		self.assertEqual(updated["label"], "测试显示")
		self.assertFalse(updated["enabled"])
		self.assertFalse(updated["must_be_whole_number"])

	def test_disabling_uom_in_use_is_blocked_with_counts(self):
		name = f"TI-TEST-Unit-{self.token}"
		units.save_unit(uom_name=name)
		frappe.db.set_value("Item", self.item, "stock_uom", name)
		with self.assertRaises(frappe.ValidationError) as error:
			units.save_unit(name=name, enabled=False)
		self.assertIn("库存单位物品 1 项", str(error.exception))
		self.assertTrue(frappe.db.get_value("UOM", name, "enabled"))

	def test_disabling_uom_used_by_item_conversion_is_blocked(self):
		name = f"TI-TEST-Conversion-Unit-{self.token}"
		units.save_unit(uom_name=name)
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", {"uom": name, "conversion_factor": 2})
		item.save()
		with self.assertRaises(frappe.ValidationError) as error:
			units.save_unit(name=name, enabled=False)
		self.assertIn("物品单位换算 1 项", str(error.exception))

	def test_disabled_units_remain_in_ranked_reference(self):
		name = f"TI-TEST-Disabled-{self.token}"
		units.save_unit(uom_name=name, label="已停用显示")
		units.save_unit(name=name, label="已停用显示", enabled=False)
		from temple_inventory.uom_labels import ranked_uoms

		row = next(row for row in ranked_uoms() if row["name"] == name)
		self.assertEqual(row["label"], "已停用显示")
		self.assertFalse(row["enabled"])

	def test_unit_category_can_be_created_and_assigned(self):
		category = f"TI-TEST-Category-{self.token}"
		units.create_category(category)
		name = f"TI-TEST-Unit-{self.token}"
		row = units.save_unit(uom_name=name, category=category)
		self.assertEqual(row["category"], category)
		self.assertEqual(units.save_unit(name=name, enabled=False)["category"], category)
		self.assertIn(category, {entry.name for entry in units.list_categories()})

	def test_unit_label_clash_uses_uom_validation(self):
		name = f"TI-TEST-Unit-{self.token}"
		other = f"TI-TEST-Other-{self.token}"
		units.save_unit(uom_name=name, label="冲突标签")
		with self.assertRaises(frappe.ValidationError) as error:
			units.save_unit(uom_name=other, label=" 冲突标签 ")
		self.assertIn(name, str(error.exception))

	def test_unit_delete_blocked_when_referenced_and_allowed_when_unused(self):
		used = f"TI-TEST-Used-{self.token}"
		unused = f"TI-TEST-Unused-{self.token}"
		units.save_unit(uom_name=used)
		units.save_unit(uom_name=unused)
		frappe.db.set_value("Item", self.item, "stock_uom", used)
		row = next(row for row in units.list_units() if row["name"] == used)
		self.assertFalse(row["deletable"])
		self.assertGreater(row["item_count"], 0)
		with self.assertRaises(frappe.ValidationError) as error:
			units.delete_unit(used)
		self.assertIn("不能删除", str(error.exception))
		self.assertTrue(units.delete_unit(unused)["deleted"])

	def test_unit_name_is_immutable(self):
		name = f"TI-TEST-Unit-{self.token}"
		units.save_unit(uom_name=name)
		with self.assertRaises(frappe.ValidationError):
			units.save_unit(name=name, uom_name=f"{name}-RENAMED")
