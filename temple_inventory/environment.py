"""Resolve per-site environment branding for the inventory frontend."""

import frappe


def _icons(prefix=""):
	base = "/assets/temple_inventory/frontend/pwa-icons/"
	return {
		"192": f"{base}{prefix}icon-192.png",
		"512": f"{base}{prefix}icon-512.png",
		"maskable": f"{base}{prefix}icon-512-maskable.png",
		"apple": f"{base}{prefix}apple-touch-icon-180.png",
		"favicon": f"{base}{prefix}favicon-32.png" if prefix else "/assets/temple_inventory/logo.png",
	}


PRODUCTION = {
	"environment": "production",
	"label": "",
	"title": "物资管理",
	"short_name": "物资管理",
	"theme_color": "#28684e",
	"description": "物资管理",
	"icons": _icons(),
}

ENVIRONMENTS = {
	"production": PRODUCTION,
	"sample": {
		**PRODUCTION,
		"environment": "sample",
		"label": "演示",
		"title": "物资管理·演示",
		"short_name": "物资·演示",
		"theme_color": "#8a4b08",
		"description": "物资管理·演示环境",
		"icons": _icons("sample-"),
	},
	"staging": {
		**PRODUCTION,
		"environment": "staging",
		"label": "预发布",
		"title": "物资管理·预发布",
		"short_name": "物资·预发布",
		"theme_color": "#593d8c",
		"description": "物资管理·预发布环境",
		"icons": _icons("staging-"),
	},
	"development": {
		**PRODUCTION,
		"environment": "development",
		"label": "开发",
		"title": "物资管理·开发",
		"short_name": "物资·开发",
		"theme_color": "#245b9e",
		"description": "物资管理·开发环境",
		"icons": _icons("development-"),
	},
}


def descriptor(environment=None, developer_mode=None):
	"""Return a fresh environment descriptor, defaulting safely to production."""
	if environment is None:
		config = frappe.conf
		if "temple_inventory_environment" in config:
			environment = config["temple_inventory_environment"]
	if developer_mode is None:
		developer_mode = frappe.conf.get("developer_mode")
	if environment is None:
		environment = "development" if developer_mode else "production"
	settings = ENVIRONMENTS.get(environment) if isinstance(environment, str) else None
	settings = settings or PRODUCTION
	return dict(settings) | {"icons": dict(settings["icons"])}


def manifest():
	"""Return the installable PWA manifest for this site's runtime environment."""
	settings = descriptor()
	icons = settings["icons"]
	return {
		"id": "/",
		"name": settings["title"],
		"short_name": settings["short_name"],
		"description": settings["description"],
		"lang": "zh-CN",
		"start_url": "/",
		"scope": "/",
		"display": "standalone",
		"background_color": "#f4f6f3",
		"theme_color": settings["theme_color"],
		"icons": [
			{"src": icons["192"], "sizes": "192x192", "type": "image/png"},
			{"src": icons["512"], "sizes": "512x512", "type": "image/png"},
			{
				"src": icons["maskable"],
				"sizes": "512x512",
				"type": "image/png",
				"purpose": "maskable",
			},
		],
	}


def update_website_context(context):
	"""Add the runtime environment suffix to public website and login branding."""
	settings = descriptor()
	if settings["label"]:
		context.app_name = settings["title"]
