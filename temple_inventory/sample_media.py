"""Exact-site inventory of known sample originals and their native thumbnails.

The reset wrapper writes the inventory before dropping the database. Cleanup uses
only those paths and verifies their bytes again; unrelated/shared files survive.
These functions are deliberately not whitelisted.
"""

import csv
import hashlib
import json
import os
from pathlib import Path, PurePosixPath

import frappe

CATALOG = Path(__file__).parent / "setup" / "native_sample_catalog.json"
ASSETS = Path(__file__).parent / "setup" / "sample_assets"
COSTUME_SOURCE = Path(__file__).parent / "setup" / "costumes-data" / "costumes_source_normalized.csv"
COSTUME_IMAGES = Path(__file__).parent / "setup" / "sample_assets" / "manifest.json"
MANIFEST = "temple-inventory-reset-media.json"
DIRECTORIES = ("public/files", "private/files", "public/private/files")
ATTACHMENT_CONTENT = "Native Temple Inventory development sample receipt.\n原生单据私有附件示例。\n".encode()


def catalog():
	return json.loads(CATALOG.read_text())


def generated_images():
	"""Return the generated product image manifest grouped by base product key."""
	manifest = json.loads(COSTUME_IMAGES.read_text())
	return {
		row["key"]: {
			"output": row["output"],
			"primary": bool(row["primary"]),
			"sha256": row["sha256"],
		}
		for row in manifest["images"]
		if row["dataset"] == "generated"
	}


def costume_catalog():
	"""Build the real costume import directly from source rows and image manifest."""
	with COSTUME_SOURCE.open(encoding="utf-8-sig", newline="") as stream:
		source_rows = list(csv.DictReader(stream))
	asset_manifest = json.loads(COSTUME_IMAGES.read_text())
	images_by_code = {}
	for image in asset_manifest["images"]:
		if image["dataset"] == "costumes":
			images_by_code.setdefault(image["key"], []).append(
				{
					"output": image["output"],
					"primary": bool(image["primary"]),
					"sha256": image["sha256"],
				}
			)
	group_names = {
		"A-服装": "演出服装",
		"B-鞋袜": "演出鞋袜",
		"C-头饰": "演出头饰",
		"D-道具": "演出道具",
	}
	rows = []
	for row in source_rows:
		code = row["item_code"].strip()
		if not code or code not in images_by_code:
			raise ValueError(f"Costume source or image mapping is incomplete for {code!r}")
		description = [
			f"来源分类：{row['notion_type']}",  # noqa: RUF001
			f"建议类别：{row['suggested_item_group']}",  # noqa: RUF001
			f"说明：{row['details']}" if row["details"] else "",  # noqa: RUF001
			f"演出类型：{row['dance_type']}" if row["dance_type"] else "",  # noqa: RUF001
			f"使用节目：{row['used_programs']}" if row["used_programs"] else "",  # noqa: RUF001
			f"备注：{row['notes']}" if row["notes"] else "",  # noqa: RUF001
			f"原始位置：{row['warehouse_site']} / {row['warehouse_room']}",  # noqa: RUF001
		]
		rows.append(
			{
				"key": f"C-{code}",
				"source_code": code,
				"item_name": row["item_name"].strip(),
				"item_group": group_names[row["notion_type"]],
				"stock_uom": row["uom"].strip(),
				"room": row["warehouse_room"].strip(),
				"quantity": float(row["quantity"]),
				"has_batch_no": False,
				"has_expiry_date": False,
				"rate": 10,
				"description": "\n".join(value for value in description if value),
				"images": images_by_code[code],
				"legacy_names": [row["item_name"].strip()],
			}
		)
	if len(rows) != 96 or sum(len(row["images"]) for row in rows) != 114:
		raise ValueError("Costume source must contain 96 Items and 114 optimized images")
	return rows


def _digest(path):
	result = hashlib.sha256()
	with path.open("rb") as stream:
		for block in iter(lambda: stream.read(1024 * 1024), b""):
			result.update(block)
	return result.hexdigest()


def _relative_urls(url):
	if not isinstance(url, str) or "?" in url or "#" in url or "\\" in url:
		return []
	parts = PurePosixPath(url).parts
	if ".." in parts or "." in parts:
		return []
	if url.startswith("/private/files/"):
		return [url.lstrip("/"), "public/" + url.lstrip("/")]
	if url.startswith("/files/"):
		return ["public/" + url.lstrip("/")]
	return []


def _safe_path(site_path, relative):
	parts = PurePosixPath(relative).parts
	if not parts or ".." in parts or "." in parts or "\\" in relative:
		raise ValueError("Invalid sample media path")
	if not any(relative.startswith(directory + "/") for directory in DIRECTORIES):
		raise ValueError("Sample media is outside the site's file directories")
	path = site_path.joinpath(*parts)
	for parent in (path, *path.parents):
		if parent == site_path:
			break
		if parent.is_symlink():
			raise ValueError("Sample media must not follow symlinks")
	if not path.resolve().is_relative_to(site_path.resolve()):
		raise ValueError("Sample media escaped its site")
	return path


def _thumbnail_paths(relative):
	path = PurePosixPath(relative)
	return [str(path.with_name(path.stem + "_small" + path.suffix))]


def build_inventory(site_path, files, sample_items, item_images, known_hashes, sample_parents=()):
	"""Read-only filesystem pass, with explicit parent and shared-path exclusions."""
	site_path = Path(site_path).absolute()
	protected, candidates = set(), {}

	def known_original(url):
		return any(
			(path := _safe_path(site_path, relative)).is_file() and _digest(path) in known_hashes
			for relative in _relative_urls(url)
		)

	for row in files:
		parent = row.get("attached_to_doctype"), row.get("attached_to_name")
		is_sample = (parent[0] == "Item" and parent[1] in sample_items) or parent in sample_parents
		# A user may have added unrelated files to a seeded Item since installation.
		# The parent identifies scope; original bytes establish seed provenance.
		is_sample = is_sample and known_original(row.get("file_url"))
		for field in ("file_url", "thumbnail_url"):
			for relative in _relative_urls(row.get(field)):
				if is_sample:
					candidates[relative] = "sample File parent"
				else:
					protected.add(relative)
	for row in item_images:
		for relative in _relative_urls(row.get("image")):
			if row["name"] in sample_items and known_original(row.get("image")):
				candidates[relative] = "sample Item image"
			else:
				protected.add(relative)
	for relative in list(protected):
		protected.update(_thumbnail_paths(relative))
		if relative.startswith("private/files/"):
			protected.update(_thumbnail_paths("public/" + relative))
	# A read-only hash scan finds orphan copies left by earlier resets. Names alone
	# never authorize deleting an original. Do not descend into symlink directories.
	for directory in DIRECTORIES:
		root = _safe_path(site_path, directory + "/.inventory-boundary").parent
		if not root.exists():
			continue
		for current, directories, filenames in os.walk(root, followlinks=False):
			directories[:] = [name for name in directories if not (Path(current) / name).is_symlink()]
			for name in filenames:
				path = Path(current) / name
				if path.is_symlink() or not path.is_file():
					continue
				if _digest(path) in known_hashes:
					candidates[str(path.relative_to(site_path))] = "known sample content"
	for relative in list(candidates):
		for thumbnail in _thumbnail_paths(relative):
			candidates.setdefault(thumbnail, "native sample thumbnail")
		if relative.startswith("private/files/"):
			for thumbnail in _thumbnail_paths("public/" + relative):
				candidates.setdefault(thumbnail, "native public thumbnail of private sample")
	rows = []
	for relative, reason in sorted(candidates.items()):
		if relative in protected:
			continue
		path = _safe_path(site_path, relative)
		if path.is_file():
			rows.append(
				{"path": relative, "sha256": _digest(path), "bytes": path.stat().st_size, "reason": reason}
			)
	return {
		"version": 1,
		"site": frappe.local.site,
		"files": rows,
		"protected_paths": sorted(protected),
	}


def _sample_items(data):
	all_items = frappe.get_all("Item", fields=["name", "item_name", "item_group", "image"])
	known = {(name, row["item_group"]) for row in data["items"] for name in row["legacy_names"]}
	items = {row.name for row in all_items if (row.item_name, row.item_group) in known}
	costumes = costume_catalog()
	known_costumes = {(row["item_name"], row["item_group"]) for row in costumes}
	items.update(row.name for row in all_items if (row.item_name, row.item_group) in known_costumes)
	barcodes = [row["source_code"] for row in costumes]
	items.update(
		frappe.get_all(
			"Item Barcode",
			filters={"barcode": ["in", barcodes]},
			pluck="parent",
		)
	)
	return items, all_items


def inventory(write_manifest=False):
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	data = catalog()
	known_hashes = {image["sha256"] for row in data["items"] for image in row["images"]}
	known_hashes.update(image["sha256"] for image in generated_images().values())
	known_hashes.update(image["sha256"] for row in costume_catalog() for image in row["images"])
	known_hashes.add(hashlib.sha256(ATTACHMENT_CONTENT).hexdigest())
	items, item_images = _sample_items(data)
	files = frappe.get_all(
		"File", fields=["name", "file_url", "thumbnail_url", "attached_to_doctype", "attached_to_name"]
	)
	from temple_inventory.native_api import _request_key
	from temple_inventory.native_samples import REQUEST_PREFIX

	key = _request_key("Stock Entry", REQUEST_PREFIX + "workflow-opening")
	parents = {
		("Stock Entry", name)
		for name in frappe.get_all("Stock Entry", filters={"ti_request_key": key}, pluck="name")
	}
	result = build_inventory(Path(frappe.get_site_path()), files, items, item_images, known_hashes, parents)
	if write_manifest:
		path = Path(frappe.get_site_path("private", MANIFEST))
		if path.is_symlink() or path.parent.is_symlink():
			raise ValueError("Media inventory must not be a symlink")
		path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
		path.chmod(0o600)
	return {
		"site": result["site"],
		"sample_items": len(items),
		"files": len(result["files"]),
		"bytes": sum(row["bytes"] for row in result["files"]),
		"public_files": sum(row["path"].startswith("public/") for row in result["files"]),
		"protected_paths": len(result["protected_paths"]),
		"manifest_written": bool(write_manifest),
	}


def cleanup():
	from temple_inventory.sample_install import assert_development_site

	assert_development_site()
	site_path = Path(frappe.get_site_path()).absolute()
	manifest = site_path / "private" / MANIFEST
	if manifest.is_symlink() or manifest.parent.is_symlink():
		raise ValueError("Media inventory must not be a symlink")
	data = json.loads(manifest.read_text())
	if data.get("version") != 1 or data.get("site") != frappe.local.site:
		raise ValueError("Media inventory belongs to a different site or format")
	protected = set(data["protected_paths"])
	paths = []
	for row in data["files"]:
		if row["path"] in protected:
			raise ValueError("Shared sample media must be preserved")
		path = _safe_path(site_path, row["path"])
		if path.exists():
			if not path.is_file() or _digest(path) != row["sha256"]:
				raise ValueError("Sample media changed after inventory; cleanup stopped")
			paths.append(path)
	# Verify the entire inventory before unlinking anything.
	for path in paths:
		path.unlink()
	return {"site": frappe.local.site, "removed": len(paths), "protected_paths": len(protected)}
