"""Shared PDF rendering helpers for Temple Inventory Print Formats."""

import os
import shutil
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
	config = frappe.get_common_site_config()
	chromium_path = config.get("chromium_path")
	if chromium_path:
		chromium_exists = Path(chromium_path).is_file() and os.access(chromium_path, os.X_OK)
	else:
		chromium_exists = bool(shutil.which("chromium-headless-shell") or shutil.which("chromium"))
	if not chromium_exists:
		frappe.throw(
			"PDF 打印需要 Chromium。请在 common_site_config.json 中设置 chromium_path",
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
