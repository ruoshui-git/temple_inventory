"""Backfill versioned primary-image derivatives in bounded Item batches."""

import frappe

from temple_inventory.item_images import VARIANT_SIZES, image_version, sync_item_image

BATCH_SIZE = 50


def execute():
	start = 0
	processed = 0
	while True:
		items = frappe.get_all(
			"Item",
			filters={"image": ["is", "set"]},
			fields=["name"],
			order_by="name asc",
			limit_start=start,
			limit_page_length=BATCH_SIZE,
		)
		if not items:
			break
		for row in items:
			sync_item_image(frappe.get_doc("Item", row.name))
			processed += 1
		start += len(items)
	items = frappe.get_all(
		"Item", filters={"image": ["is", "set"]}, fields=["name", "image"], limit_page_length=0
	)
	variants = frappe.get_all(
		"File",
		filters={"attached_to_doctype": "Item", "attached_to_field": "ti_image_variant"},
		fields=["attached_to_name", "file_name"],
		limit_page_length=0,
	)
	by_item = {}
	for row in variants:
		by_item.setdefault(row.attached_to_name, set()).add(row.file_name)
	missing = sum(
		{f"{item.name}-{size}-{image_version(item.image)}.webp" for size in VARIANT_SIZES}.difference(
			by_item.get(item.name, set())
		)
		!= set()
		for item in items
	)
	return {
		"items": processed,
		"derivatives": len(variants),
		"items_missing_derivatives": missing,
		"batch_size": BATCH_SIZE,
	}
