"""Private WebP derivatives for Item primary images."""

from __future__ import annotations

import mimetypes
from io import BytesIO

import frappe
from PIL import Image, ImageOps
from werkzeug.utils import send_file

VARIANT_FIELD = "ti_image_variant"
VARIANT_SIZES = (160, 640)
QUALITY = 80


def image_version(image_url):
	"""Return a short, stable cache key for an Item image URL."""
	value = 2166136261
	for byte in (image_url or "").encode("utf-8"):
		value = ((value ^ byte) * 16777619) & 0xFFFFFFFF
	return f"{value:08x}"


def _file_for_image(item):
	from temple_inventory.native_files import PARENTS

	if not item.image:
		return None
	file_name = frappe.db.get_value(
		"File",
		{
			"attached_to_doctype": "Item",
			"attached_to_name": item.name,
			"attached_to_field": "image",
			"file_url": item.image,
			"is_private": 1,
		},
		"name",
	)
	if not file_name:
		return None
	file = frappe.get_doc("File", file_name)
	if file.attached_to_doctype not in PARENTS or not file.is_private:
		return None
	return file


def _webp(content, size):
	with Image.open(BytesIO(content)) as source:
		image = ImageOps.exif_transpose(source)
		if image.mode not in ("RGB", "RGBA"):
			image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
		image.thumbnail((size, size), Image.Resampling.LANCZOS)
		buffer = BytesIO()
		image.save(buffer, "WEBP", quality=QUALITY, method=5, exif=b"")
		return buffer.getvalue()


def _variant_files(item):
	return frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": "Item",
			"attached_to_name": item.name,
			"attached_to_field": VARIANT_FIELD,
		},
		fields=["name", "file_name"],
		limit_page_length=0,
	)


def sync_item_image(item, method=None):
	"""Replace derivatives after an Item image change; image saving must succeed independently."""
	try:
		version = image_version(item.image)
		variants = _variant_files(item)
		expected = {f"{item.name}-{size}-{version}.webp" for size in VARIANT_SIZES}
		if item.image and {value.file_name for value in variants} == expected:
			return
		for value in variants:
			frappe.get_doc("File", value.name).delete()
		if not item.image:
			return
		original = _file_for_image(item)
		if not original:
			frappe.logger("temple_inventory.item_images").warning(
				"Cannot derive Item image: private primary File missing for %s", item.name
			)
			return
		content = original.get_content(encodings=[])
		for size in VARIANT_SIZES:
			filename = f"{item.name}-{size}-{version}.webp"
			frappe.get_doc(
				{
					"doctype": "File",
					"file_name": filename,
					"content": _webp(content, size),
					"is_private": 1,
					"attached_to_doctype": "Item",
					"attached_to_name": item.name,
					"attached_to_field": VARIANT_FIELD,
				}
			).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title=f"Item image derivative failed: {item.name}")


def _authorized_original(item):
	from temple_inventory.native_files import can_read

	original = _file_for_image(item)
	if not original:
		return None
	original.check_permission("read")
	if not can_read(original):
		frappe.throw("您没有读取此图片的权限", frappe.PermissionError)
	return original


@frappe.whitelist()
def thumbnail(item, size, v):
	"""Serve one authorized Item derivative, falling back to its authorized original."""
	from temple_inventory.native_access import check_item, require_app
	from temple_inventory.native_files import is_private_original

	require_app()
	if str(size) not in {str(value) for value in VARIANT_SIZES}:
		frappe.throw("图片尺寸无效")
	doc = check_item(item)
	if image_version(doc.image) != str(v):
		frappe.throw("图片版本已更改", frappe.DoesNotExistError)
	original = _authorized_original(doc)
	if not original:
		frappe.throw("物品主图不存在", frappe.DoesNotExistError)
	filename = f"{doc.name}-{size}-{v}.webp"
	variant_name = frappe.db.get_value(
		"File",
		{
			"attached_to_doctype": "Item",
			"attached_to_name": doc.name,
			"attached_to_field": VARIANT_FIELD,
			"file_name": filename,
			"is_private": 1,
		},
		"name",
	)
	selected = frappe.get_doc("File", variant_name) if variant_name else original
	if not is_private_original(selected):
		frappe.throw("物品主图必须是私有文件", frappe.PermissionError)
	content_type = (
		"image/webp"
		if variant_name
		else (mimetypes.guess_type(selected.file_name)[0] or "application/octet-stream")
	)
	request = getattr(frappe.local, "request", None)
	response = send_file(
		selected.get_full_path(),
		environ=request.environ if request else {},
		mimetype=content_type,
		as_attachment=False,
		conditional=bool(request),
		max_age=31536000,
	)
	response.headers["Cache-Control"] = "private,max-age=31536000,immutable"
	response.headers["Vary"] = "Cookie"
	return response
