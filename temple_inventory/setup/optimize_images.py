"""Generate and verify the tracked sample-image bundle."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path

from PIL import Image, ImageOps

MAX_EDGE = 1280
QUALITY = 80
GENERATED_MAX_EDGE = 800
# The restored existing bundle is about 22.7 MB; 28 MiB leaves room for generated assets.
MAX_TOTAL_BYTES = 28 * 1024 * 1024


def _sha256(path):
	return hashlib.sha256(path.read_bytes()).hexdigest()


def _convert(source, destination):
	destination.parent.mkdir(parents=True, exist_ok=True)
	with Image.open(source) as image:
		image = ImageOps.exif_transpose(image)
		image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
		if image.mode not in ("RGB", "RGBA"):
			image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
		image.save(destination, "WEBP", quality=QUALITY, method=6, exif=b"")
	with Image.open(destination) as image:
		width, height = image.size
	return {
		"bytes": destination.stat().st_size,
		"sha256": _sha256(destination),
		"width": width,
		"height": height,
	}


def _convert_generated(source, destination):
	"""Validate, center-pad to square and optimize one generated source image."""
	destination.parent.mkdir(parents=True, exist_ok=True)
	with Image.open(source) as image:
		image.verify()
	with Image.open(source) as image:
		image = ImageOps.exif_transpose(image)
		if image.mode not in ("RGB", "RGBA"):
			image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
		image.thumbnail((GENERATED_MAX_EDGE, GENERATED_MAX_EDGE), Image.Resampling.LANCZOS)
		canvas = Image.new(
			image.mode,
			(GENERATED_MAX_EDGE, GENERATED_MAX_EDGE),
			(255, 255, 255, 0) if image.mode == "RGBA" else "white",
		)
		canvas.paste(
			image,
			(
				(GENERATED_MAX_EDGE - image.width) // 2,
				(GENERATED_MAX_EDGE - image.height) // 2,
			),
		)
		canvas.save(destination, "WEBP", quality=QUALITY, method=6, exif=b"")
	with Image.open(destination) as image:
		width, height = image.size
	return {
		"bytes": destination.stat().st_size,
		"sha256": _sha256(destination),
		"width": width,
		"height": height,
	}


def _manifest_sources(root):
	result = []
	manifest = json.loads((root / "sample_assets" / "manifest.json").read_text(encoding="utf-8"))
	for row in manifest["images"]:
		if row["dataset"] == "generated":
			continue
		source = root / "sample_assets" / row["output"]
		result.append((row["dataset"], row["key"], source, row["primary"], row["source"]))
	return result


def build(root, generated_source_dir=None):
	root = Path(root)
	asset_root = root / "sample_assets"
	rows = []
	seen = set()
	for dataset, key, source, primary, source_label in _manifest_sources(root):
		if not source.is_file():
			raise FileNotFoundError(source)
		if dataset == "general":
			name = f"{key}.webp"
		else:
			stem = source.stem.removeprefix(f"{key}-")
			name = f"{key}-{stem}.webp"
		if name in seen:
			raise ValueError(f"duplicate output name: {name}")
		seen.add(name)
		output = asset_root / "images" / dataset / name
		if source.resolve() == output.resolve():
			with Image.open(output) as image:
				meta = {
					"bytes": output.stat().st_size,
					"sha256": _sha256(output),
					"width": image.width,
					"height": image.height,
				}
		else:
			meta = _convert(source, output)
		rows.append(
			{
				"dataset": dataset,
				"key": key,
				"source": source_label,
				"output": str(output.relative_to(asset_root)),
				"primary": primary,
				**meta,
			}
		)
	credits_path = asset_root / "images" / "CREDITS.json"
	credits = json.loads(credits_path.read_text(encoding="utf-8")) if credits_path.exists() else {}
	generated = credits.get("generated", [])
	if generated and generated_source_dir is None:
		generated_source_dir = Path("/tmp/ti-seed-images/20261024-run2")
	if generated:
		source_root = Path(generated_source_dir)
		for credit in generated:
			key = credit["base_product_key"]
			source = source_root / f"{key}.source"
			if not source.is_file():
				# A tracked optimized copy supports verification and repeat builds after source cleanup.
				source = asset_root / "images" / "generated" / f"{key}.webp"
			output = asset_root / "images" / "generated" / f"{key}.webp"
			if source.resolve() == output.resolve():
				temporary = output.with_suffix(".tmp.webp")
				meta = _convert_generated(source, temporary)
				shutil.move(temporary, output)
				meta["bytes"] = output.stat().st_size
				meta["sha256"] = _sha256(output)
			else:
				meta = _convert_generated(source, output)
			rows.append(
				{
					"dataset": "generated",
					"key": key,
					"source": "Wikimedia Commons API",
					"output": f"images/generated/{key}.webp",
					"primary": True,
					**meta,
				}
			)
	rows.sort(key=lambda row: (row["dataset"], row["key"], row["output"]))
	total = sum(row["bytes"] for row in rows)
	if len(rows) != 175 + len(generated) or total > MAX_TOTAL_BYTES:
		raise ValueError(f"invalid optimized bundle: count={len(rows)} bytes={total}")
	(asset_root / "manifest.json").write_text(
		json.dumps(
			{
				"version": 1,
				"max_edge": MAX_EDGE,
				"generated_max_edge": GENERATED_MAX_EDGE,
				"quality": QUALITY,
				"total_bytes": total,
				"images": rows,
			},
			ensure_ascii=False,
			indent=2,
		)
		+ "\n",
		encoding="utf-8",
	)
	return {"count": len(rows), "bytes": total, "manifest": str(asset_root / "manifest.json")}


def verify(root):
	root = Path(root)
	asset_root = root / "sample_assets"
	payload = json.loads((asset_root / "manifest.json").read_text(encoding="utf-8"))
	credits_path = asset_root / "images" / "CREDITS.json"
	credits = json.loads(credits_path.read_text(encoding="utf-8")) if credits_path.exists() else {}
	expected_generated = len(credits.get("generated", []))
	total = 0
	manifest_outputs = set()
	for row in payload["images"]:
		path = asset_root / row["output"]
		if not path.is_file() or path.stat().st_size != row["bytes"] or _sha256(path) != row["sha256"]:
			raise ValueError(f"asset verification failed: {path}")
		with Image.open(path) as image:
			if image.size != (row["width"], row["height"]):
				raise ValueError(f"asset dimensions differ from manifest: {path}")
		manifest_outputs.add(path.resolve())
		total += path.stat().st_size
	actual_outputs = {
		path.resolve()
		for dataset in ("general", "costumes", "generated")
		for path in (asset_root / "images" / dataset).glob("*.webp")
	}
	if actual_outputs != manifest_outputs:
		raise ValueError("asset manifest does not list exactly the tracked WebP files")
	if total != payload["total_bytes"] or total > MAX_TOTAL_BYTES:
		raise ValueError("asset manifest count/size verification failed")
	generated_total = sum(row["bytes"] for row in payload["images"] if row["dataset"] == "generated")
	if generated_total > 4 * 1024 * 1024:
		raise ValueError("generated image bundle exceeds 4 MiB")
	generated_rows = [row for row in payload["images"] if row["dataset"] == "generated"]
	if len(generated_rows) != expected_generated or any(
		row["width"] != row["height"] or row["width"] > GENERATED_MAX_EDGE for row in generated_rows
	):
		raise ValueError("generated image count or square-dimension verification failed")
	if len(payload["images"]) != 175 + expected_generated:
		raise ValueError("asset manifest is missing existing or generated images")
	return {"count": len(payload["images"]), "bytes": total}


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("command", choices=("build", "verify"))
	parser.add_argument("--root", default=str(Path(__file__).resolve().parent))
	parser.add_argument("--generated-source-dir")
	args = parser.parse_args()
	print(
		json.dumps(
			build(args.root, args.generated_source_dir) if args.command == "build" else verify(args.root),
			ensure_ascii=False,
		)
	)


if __name__ == "__main__":
	main()
