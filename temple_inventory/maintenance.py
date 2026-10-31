# ruff: noqa: RUF001 — Chinese page text is intentional.
"""Serve a Chinese, environment-branded page while the site is in maintenance mode."""

from html import escape

import frappe
from frappe.website.page_renderers.base_renderer import BaseRenderer
from werkzeug.wrappers import Response

from temple_inventory.environment import descriptor

RETRY_SECONDS = 30

PAGE = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="{color}">
<meta http-equiv="refresh" content="{retry}">
<title>系统正在更新 · {title}</title>
<link rel="icon" href="{favicon}">
<style>
:root {{
	color-scheme: light dark;
	--canvas: #f4f6f3;
	--card: #ffffff;
	--ink: #24332d;
	--muted: #5e6b63;
	--accent: {color};
}}
@media (prefers-color-scheme: dark) {{
	:root {{ --canvas: #151b18; --card: #1f2723; --ink: #e8eee9; --muted: #a7b3ab; }}
}}
* {{ box-sizing: border-box; }}
body {{
	margin: 0;
	min-height: 100vh;
	display: grid;
	place-items: center;
	padding: 16px;
	background: var(--canvas);
	color: var(--ink);
	font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB",
		"Microsoft YaHei", "Noto Sans SC", sans-serif;
}}
main {{
	width: 100%;
	max-width: 440px;
	padding: 32px 24px;
	border-radius: 18px;
	background: var(--card);
	border-top: 6px solid var(--accent);
	box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
	text-align: center;
}}
img {{ width: 64px; height: 64px; border-radius: 14px; }}
.app {{ margin: 12px 0 24px; color: var(--muted); font-size: 15px; }}
h1 {{ margin: 0 0 12px; font-size: 24px; }}
p {{ margin: 0; line-height: 1.6; }}
.en {{ margin-top: 16px; color: var(--muted); font-size: 13px; }}
button {{
	margin-top: 24px;
	min-height: 40px;
	padding: 0 24px;
	border: 0;
	border-radius: 12px;
	background: var(--accent);
	color: #fff;
	font: inherit;
	font-weight: 600;
	cursor: pointer;
}}
</style>
</head>
<body>
<main>
<img src="{logo}" alt="">
<div class="app">{title}</div>
<h1>系统正在更新</h1>
<p>请稍候片刻，页面会自动刷新。</p>
<p class="en" lang="en">The system is being updated. Please refresh again after a few moments.</p>
<button type="button" onclick="location.reload()">刷新</button>
</main>
</body>
</html>
"""


class MaintenancePage(BaseRenderer):
	"""Replace Frappe's English "Updating" message raised by `maintenance_mode`."""

	def can_render(self):
		return (
			self.path == "message"
			and self.http_status_code == 503
			and bool(frappe.local.conf.get("maintenance_mode"))
		)

	def render(self):
		settings = descriptor()
		icons = settings["icons"]
		html = PAGE.format(
			title=escape(settings["title"]),
			color=escape(settings["theme_color"]),
			logo=escape(icons["192"]),
			favicon=escape(icons["favicon"]),
			retry=RETRY_SECONDS,
		)
		response = Response(html, status=503, mimetype="text/html")
		response.headers["Retry-After"] = str(RETRY_SECONDS)
		response.headers["Cache-Control"] = "no-store"
		return response
