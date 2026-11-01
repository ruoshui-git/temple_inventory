"""Shared PDF rendering helpers for Temple Inventory Print Formats."""
# ruff: noqa: RUF001 — Chinese UI punctuation is intentional.

import os
from functools import lru_cache
from pathlib import Path

import frappe


@lru_cache(maxsize=1)
def _load_print_css():
	css_path = Path(__file__).parent / "templates" / "print" / "ti_print.css"
	return css_path.read_text(encoding="utf-8")


def ti_print_css():
	"""Return the shared print stylesheet for inline inclusion in Print Formats."""
	return _load_print_css()


def render_pdf(doctype, name, print_format, doc=None):
	"""Render a Print Format with Frappe's Chrome engine and return the PDF bytes."""
	chromium_path = frappe.get_common_site_config().get("chromium_path") or ""
	path = Path(chromium_path)
	if not chromium_path or not path.is_file() or not os.access(path, os.X_OK):
		frappe.throw(
			"PDF 打印需要 Chromium。请在 common_site_config.json 中设置 chromium_path",
			exc=frappe.ValidationError,
		)
	with path.open("rb") as binary:
		is_script = binary.read(2) == b"#!"
	if is_script:
		# Frappe terminates the process it started; a wrapper script dies alone and leaves
		# the real browser running, so every PDF would leak one Chromium.
		frappe.throw(
			"chromium_path 指向启动脚本，会遗留浏览器进程。请改为 Chromium 可执行文件"
			"（如 /usr/lib/chromium/chromium-headless-shell）",
			exc=frappe.ValidationError,
		)

	return frappe.get_print(
		doctype,
		name,
		print_format=print_format,
		doc=doc,
		as_pdf=True,
		pdf_generator="chrome",
		no_letterhead=1,
	)
