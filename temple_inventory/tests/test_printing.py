"""PDF printing (Print Formats, exports and record slips) regression coverage."""

import io
import os
import re
import shutil
import subprocess
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from bs4 import BeautifulSoup
from frappe.utils import nowdate
from pypdf import PdfReader

from temple_inventory.printing import render_pdf, ti_print_css
from temple_inventory.tests.test_native_documents import NativeDocumentTests


class PrintingTests(NativeDocumentTests):
	def test_print_css_helper_and_template_escape_untrusted_item_names(self):
		from frappe.utils.jinja import get_jenv

		self.assertIn(".ti-table", ti_print_css())
		env = get_jenv()
		self.assertIn("ti_print_css", env.globals)
		template = env.from_string("{{ item_name | e }}")
		rendered = template.render(item_name='<img src=x onerror="alert(1)">')
		self.assertEqual(rendered, "&lt;img src=x onerror=&#34;alert(1)&#34;&gt;")

	def test_render_pdf_reports_missing_chromium_clearly(self):
		with (
			patch(
				"temple_inventory.printing.frappe.get_common_site_config",
				return_value={"chromium_path": "/missing/chromium"},
			),
			self.assertRaisesRegex(frappe.ValidationError, "PDF 打印需要 Chromium"),
		):
			render_pdf("Stock Entry", "missing", "missing")

	def test_chrome_slip_letter_page_repeat_escape_and_footer(self):
		format_name, document = self._spike_document(31)
		pdf = render_pdf("Stock Entry", document.name, format_name, document)
		self.assertTrue(pdf.startswith(b"%PDF"))
		self._save_pdf("slip", pdf)

		reader = PdfReader(io.BytesIO(pdf))
		self.assertLessEqual(len(reader.pages), 2)
		for page in reader.pages:
			box = page.mediabox
			self.assertAlmostEqual(float(box.width), 612, delta=1)
			self.assertAlmostEqual(float(box.height), 792, delta=1)
			text = page.extract_text() or ""
			self.assertIn("礼堂折叠椅", "".join(text.split()))
			self.assertIn("#", text)
			self.assertIn(document.name, text)
			self.assertRegex(text, r"第\s*\d+\s*/\s*\d+\s*(?:页|⻚)")
		self._render_pngs("slip", document)

	def test_chrome_list_density_landscape_and_300_rows(self):
		format_name, document = self._spike_document(300, landscape=True)
		started = time.perf_counter()
		pdf = render_pdf("Stock Entry", document.name, format_name, document)
		elapsed = time.perf_counter() - started
		print(f"PDF list density, 300 rows: {elapsed:.2f}s")
		self.assertTrue(pdf.startswith(b"%PDF"))
		self._save_pdf("list-300", pdf)
		reader = PdfReader(io.BytesIO(pdf))
		self.assertGreaterEqual(len(reader.pages), 2)
		self.assertAlmostEqual(float(reader.pages[0].mediabox.width), 792, delta=1)
		self.assertAlmostEqual(float(reader.pages[0].mediabox.height), 612, delta=1)
		for page in reader.pages:
			text = page.extract_text() or ""
			self.assertIn(document.name, text)
			self.assertIn("#", text)
			self.assertIn("礼堂折叠椅", "".join(text.split()))
			self.assertRegex(text, r"第\s*\d+\s*/\s*\d+\s*(?:页|⻚)")
		self._render_pngs("list-300", document, landscape=True)

	@unittest.skipUnless(os.getenv("TI_PDF_5000"), "set TI_PDF_5000=1 for the 5,000-row timing spike")
	def test_chrome_5000_row_timing_spike(self):
		format_name, document = self._spike_document(5000, landscape=True)
		started = time.perf_counter()
		pdf = render_pdf("Stock Entry", document.name, format_name, document)
		elapsed = time.perf_counter() - started
		print(f"PDF list density, 5,000 rows: {elapsed:.2f}s")
		self.assertTrue(pdf.startswith(b"%PDF"))
		self._save_pdf("list-5000", pdf)

	def _spike_document(self, row_count, landscape=False):
		token = frappe.generate_hash(length=8)
		frappe.db.set_single_value("Print Settings", "allow_print_for_draft", 1)
		format_name = f"TI Print Spike {token}"
		frappe.db.set_value("Item", self.item, "item_name", "礼堂折叠椅", update_modified=False)
		frappe.clear_document_cache("Item", self.item)
		format_doc = frappe.get_doc(
			{
				"doctype": "Print Format",
				"name": format_name,
				"doc_type": "Stock Entry",
				"custom_format": 1,
				"print_format_type": "Jinja",
				"pdf_generator": "chrome",
				"html": self._spike_html(landscape),
			}
		).insert(ignore_permissions=True)
		rows = []
		for index in range(row_count):
			rows.append(
				{
					"item_code": self.item,
					"item_name": f"礼堂折叠椅 第{index + 1}号",
					"qty": 1,
					"transfer_qty": 1,
					"uom": "Nos",
					"conversion_factor": 1,
					"basic_rate": 10,
					"amount": 10,
					"t_warehouse": self.a,
				}
			)
		document = frappe.get_doc(
			{
				"doctype": "Stock Entry",
				"company": self.company,
				"stock_entry_type": "Material Receipt",
				"posting_date": nowdate(),
				"items": rows,
			}
		).insert(ignore_permissions=True)
		format_doc.reload()
		return format_doc.name, document

	def _spike_html(self, landscape):
		orientation_class = "ti-landscape" if landscape else "ti-portrait"
		density_class = "ti-list" if landscape else ""
		orientation_rule = ".print-format { page-width: 279.4mm; page-height: 215.9mm; }" if landscape else ""
		if landscape:
			column_count = 8
			column_headers = """<th>#</th><th>物品名称</th><th>数量</th><th>单位</th>
<th>物品编码</th><th>单价</th><th>金额</th><th>仓库</th>"""
			row_cells = """<td class="ti-seq">{{ loop.index }}</td>
<td class="ti-main">{{ row.item_name | e }}</td><td class="ti-num">{{ row.qty | e }}</td>
<td class="ti-center">{{ row.uom | e }}</td><td>{{ row.item_code | e }}</td>
<td>{{ row.basic_rate | e }}</td><td>{{ row.amount | e }}</td>
<td>{{ row.t_warehouse | e }}</td>"""
		else:
			column_count = 4
			column_headers = "<th>#</th><th>物品名称</th><th>数量</th><th>单位</th>"
			row_cells = """<td class="ti-seq">{{ loop.index }}</td>
<td class="ti-main">{{ row.item_name | e }}</td><td class="ti-num">{{ row.qty | e }}</td>
<td class="ti-center">{{ row.uom | e }}</td>"""
		return f"""<!doctype html>
<html><head><meta charset="utf-8"><style>{{{{ ti_print_css() }}}}</style>
<style>{orientation_rule}</style></head>
<body><div class="ti-print ti-sheet {orientation_class}">
<table class="ti-table {density_class}" style="font-size:12pt">
<thead>
<tr class="ti-title-row"><th colspan="{column_count}"><span class="ti-title">物资领用单</span>
<span class="ti-docno">单号 {{{{ doc.name | e }}}}</span></th></tr>
<tr>{column_headers}</tr>
</thead><tbody>
{{% for row in doc.items %}}<tr>
{row_cells}</tr>{{% endfor %}}
</tbody></table>
</div>
</body></html>"""

	def _save_pdf(self, stem, pdf):
		path = Path("/tmp/codex-runs/pdf-base-shots")
		path.mkdir(parents=True, exist_ok=True)
		(path / f"{stem}.pdf").write_bytes(pdf)

	def _render_pngs(self, stem, document, landscape=False):
		path = Path("/tmp/codex-runs/pdf-base-shots")
		pdf_path = path / f"{stem}.pdf"
		if pdftoppm := shutil.which("pdftoppm"):
			subprocess.run(
				[pdftoppm, "-r", "60", "-png", str(pdf_path), str(path / stem)],
				check=True,
				capture_output=True,
			)
			return

		chromium = shutil.which("chromium") or shutil.which("chromium-headless-shell")
		if not chromium:
			print(
				"No PDF rasterizer or Chromium screenshot binary; PDF evidence was saved without PNG renders"
			)
			return
		reader = PdfReader(str(pdf_path))
		window_size = "1056,816" if landscape else "816,1056"
		for page_number, page in enumerate(reader.pages, 1):
			page_text = page.extract_text() or ""
			sequences = [int(value) for value in re.findall(r"(?m)^(\d+)\s+礼堂折叠椅", page_text)]
			if not sequences:
				self.fail(f"Could not identify item rows on {stem} PDF page {page_number}")
			preview_items = [
				SimpleNamespace(**row.as_dict(), ti_sequence=sequence)
				for sequence, row in enumerate(
					document.items[sequences[0] - 1 : sequences[-1]], start=sequences[0]
				)
			]
			preview_doc = SimpleNamespace(
				name=document.name,
				items=preview_items,
			)
			preview_html = self._spike_html(landscape).replace("loop.index", "row.ti_sequence")
			rendered = frappe.get_jenv().from_string(preview_html).render(doc=preview_doc)
			soup = BeautifulSoup(rendered, "html.parser")
			body = soup.body
			wrapper = soup.new_tag("div", attrs={"class": "print-format"})
			for child in list(body.contents):
				wrapper.append(child.extract())
			body.append(wrapper)
			footer = soup.new_tag("div", attrs={"class": "ti-footer"})
			footer.string = f"第 {page_number} / {len(reader.pages)} 页"
			body.append(footer)
			screen_style = soup.new_tag("style")
			screen_style.string = (
				"body { margin:0; background:#fff; } .print-format { min-height:100vh; } "
				".ti-footer { position:fixed; right:10mm; bottom:5mm; width:calc(100% - 20mm); }"
			)
			soup.head.append(screen_style)
			html_path = path / f"{stem}-{page_number}.html"
			html_path.write_text(str(soup), encoding="utf-8")
			png_path = path / f"{stem}-{page_number}.png"
			subprocess.run(
				[
					chromium,
					"--no-sandbox",
					"--disable-gpu",
					"--headless",
					f"--window-size={window_size}",
					f"--screenshot={png_path}",
					f"file://{html_path}",
				],
				check=True,
				capture_output=True,
				timeout=30,
			)
			if not png_path.exists() or png_path.stat().st_size == 0:
				print(f"Chromium did not produce a page {page_number} screenshot for {stem}")
				return
			html_path.unlink(missing_ok=True)
