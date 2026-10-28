"""Runtime environment branding contracts."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from temple_inventory import environment
from temple_inventory.manifest import ManifestPage


class EnvironmentTests(unittest.TestCase):
	def test_resolver_defaults_unknown_and_developer_mode(self):
		with patch("frappe.conf", {}):
			self.assertEqual(environment.descriptor()["environment"], "production")
			self.assertEqual(environment.descriptor("invalid")["environment"], "production")
		with patch("frappe.conf", {"developer_mode": 1}):
			self.assertEqual(environment.descriptor()["environment"], "development")
		with patch("frappe.conf", {"temple_inventory_environment": "", "developer_mode": 1}):
			self.assertEqual(environment.descriptor()["environment"], "production")

	def test_each_supported_environment_has_expected_branding(self):
		for key, label, color in (
			("production", "", "#28684e"),
			("sample", "演示", "#8a4b08"),
			("staging", "预发布", "#593d8c"),
			("development", "开发", "#245b9e"),
		):
			with self.subTest(environment=key):
				value = environment.descriptor(key)
				self.assertEqual(value["label"], label)
				self.assertEqual(value["theme_color"], color)
				self.assertLessEqual(len(value["short_name"]), 6)

	def test_manifest_renderer_is_guest_readable_and_returns_manifest_content_type(self):
		page = object.__new__(ManifestPage)
		page.path = ManifestPage.path_name
		self.assertTrue(page.can_render())
		# The renderer never consults the session, so guests get the same response.
		with patch("temple_inventory.manifest.manifest", return_value=environment.manifest()):
			response = page.render()
		self.assertEqual(response.mimetype, "application/manifest+json")
		self.assertEqual(response.headers["Cache-Control"], "no-cache")
		self.assertEqual(json.loads(response.get_data(as_text=True))["id"], "/")

	def test_manifest_preserves_install_identity_and_uses_environment_names_and_icons(self):
		labels = {
			"production": "物资管理",
			"sample": "物资管理·演示",
			"staging": "物资管理·预发布",
			"development": "物资管理·开发",
		}
		for key, title in labels.items():
			with self.subTest(environment=key), patch("frappe.conf", {"temple_inventory_environment": key}):
				value = environment.manifest()
				self.assertEqual(value["name"], title)
				self.assertEqual(value["id"], "/")
				self.assertEqual(value["start_url"], "/")
				self.assertEqual(value["scope"], "/")
				self.assertEqual(value["display"], "standalone")
				self.assertEqual(value["lang"], "zh-CN")
				self.assertEqual(len(value["icons"]), 3)
			if key == "sample":
				self.assertEqual(value["short_name"], "物资·演示")
				self.assertIn("sample-icon-192.png", value["icons"][0]["src"])

	def test_inventory_boot_contains_environment_and_head_context(self):
		context = SimpleNamespace()
		local = SimpleNamespace(site="sample.localhost", lang="zh-CN")
		with (
			patch("frappe.session", SimpleNamespace(user="Administrator")),
			patch("temple_inventory.native_access.require_app"),
			patch("temple_inventory.www.inventory.frappe.local", local),
			patch("temple_inventory.www.inventory.frappe.sessions.get_csrf_token", return_value="token"),
			patch("frappe.conf", {"temple_inventory_environment": "sample"}),
		):
			from temple_inventory.www.inventory import get_context

			get_context(context)
		self.assertEqual(context.boot["environment"]["label"], "演示")
		self.assertEqual(context.app_title, "物资管理·演示")
		self.assertEqual(context.manifest_url, "/temple-inventory.webmanifest")

	def test_website_context_adds_suffix_only_outside_production(self):
		context = SimpleNamespace(app_name="物资管理")
		with patch("frappe.conf", {"temple_inventory_environment": "staging"}):
			environment.update_website_context(context)
		self.assertEqual(context.app_name, "物资管理·预发布")
		context.app_name = "物资管理"
		with patch("frappe.conf", {"temple_inventory_environment": "production"}):
			environment.update_website_context(context)
		self.assertEqual(context.app_name, "物资管理")
