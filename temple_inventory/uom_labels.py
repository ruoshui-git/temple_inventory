"""App-owned display labels for common ERPNext units of measure."""

import frappe

DEFAULT_LABELS = {
	"Nos": "个",
	"Box": "箱",
	"Pair": "双",
	"Set": "套",
	"Unit": "件",
	"Kg": "kg",
	"Gram": "g",
	"Milligram": "mg",
	"Tonne": "t",
	"Carat": "ct",
	"Litre": "L",
	"Millilitre": "mL",
	"Centilitre": "cL",
	"Decilitre": "dL",
	"Fluid Ounce (US)": "fl oz",
	"Fluid Ounce (UK)": "fl oz (UK)",
	"Gallon (UK)": "gal (UK)",
	"Pint (UK)": "pt (UK)",
	"Pint, Liquid (US)": "pt (US)",
	"Quart (UK)": "qt (UK)",
	"Quart Liquid (US)": "qt (US)",
	"Cup": "cup",
	"Tablespoon (US)": "tbsp",
	"Teaspoon": "tsp",
	"Meter": "m",
	"Centimeter": "cm",
	"Millimeter": "mm",
	"Kilometer": "km",
	"Micrometer": "µm",
	"Nanometer": "nm",
	"Inch": "in",
	"Foot": "ft",
	"Yard": "yd",
	"Mile": "mi",
	"Hectare": "ha",
	"Pound": "lb",
	"Ounce": "oz",
	"Square Meter": "m²",
	"Square Centimeter": "cm²",
	"Square Foot": "ft²",
	"Cubic Meter": "m³",
	"Cubic Centimeter": "cm³",
	"Cubic Foot": "ft³",
	"Gallon Liquid (US)": "gal",
	"Hour": "小时",
	"Minute": "分钟",
	"Day": "天",
	"Week": "周",
}
COMMON_MEASURES = {
	"Kg": 0,
	"Gram": 1,
	"Litre": 2,
	"Meter": 3,
	"Centimeter": 4,
	"Millimeter": 5,
	"Square Meter": 6,
	"Cubic Meter": 7,
	"Millilitre": 8,
}


def _normalized(value):
	return str(value or "").strip().casefold()


def matching_uom(values):
	"""Find a UOM whose native name or display label matches any supplied value."""
	keys = {_normalized(value) for value in values if _normalized(value)}
	if not keys:
		return None
	for row in frappe.get_all(
		"UOM", fields=["name", "ti_label", "must_be_whole_number"], limit_page_length=0
	):
		if keys.intersection({_normalized(row.name), _normalized(row.ti_label)}):
			return row
	return None


def clear_uom_label_cache():
	frappe.local.temple_inventory_uom_labels = None


def uom_label(name):
	"""Return an app display label, falling back to the native UOM name."""
	if not name:
		return ""
	return _labels().get(name) or name


def ranked_uoms():
	"""UOMs ordered by current use, count units, common measures, then category."""
	from temple_inventory.report_sources import paged

	used = dict(
		frappe.db.sql(
			"""select uom, count(distinct item) from (
			select stock_uom as uom, name as item from `tabItem`
			union all
			select uom, parent as item from `tabUOM Conversion Detail` where parenttype='Item'
		) as used where uom is not null and uom!='' group by uom"""
		)
	)
	rows = list(
		paged(
			"UOM",
			fields=["name", "uom_name", "must_be_whole_number", "category", "ti_label", "enabled"],
		)
	)

	def rank(row):
		name = row.name
		if name in used:
			return (0, -int(used[name]), name.casefold())
		if row.must_be_whole_number and not row.category:
			return (1, 0, name.casefold())
		if name in COMMON_MEASURES:
			return (2, COMMON_MEASURES[name], name.casefold())
		return (3, str(row.category or "").casefold(), name.casefold())

	return [
		{**dict(row), "label": row.ti_label or row.name, "enabled": bool(row.enabled)}
		for row in sorted(rows, key=rank)
	]


def _labels():
	# Report and export rows call this per cell, so load all labels once per request or job.
	labels = getattr(frappe.local, "temple_inventory_uom_labels", None)
	if labels is None:
		labels = {}
		if frappe.get_meta("UOM").has_field("ti_label"):
			labels = dict(
				frappe.get_all(
					"UOM", filters={"ti_label": ["is", "set"]}, fields=["name", "ti_label"], as_list=True
				)
			)
		frappe.local.temple_inventory_uom_labels = labels
	return labels


def seed_labels():
	"""Fill blank labels from the curated map without replacing edits or clashes."""
	for name, label in DEFAULT_LABELS.items():
		if not frappe.db.exists("UOM", name):
			continue
		if frappe.db.get_value("UOM", name, "ti_label"):
			continue
		if _clashing_unit(name, label):
			continue
		frappe.db.set_value("UOM", name, "ti_label", label, update_modified=False)


def _clashing_unit(current_name, value):
	key = _normalized(value)
	if not key:
		return None
	for row in frappe.get_all(
		"UOM", filters={"enabled": 1}, fields=["name", "ti_label"], limit_page_length=0
	):
		if row.name == current_name:
			continue
		if key in {_normalized(row.name), _normalized(row.ti_label)}:
			return row.name
	return None


def validate_uom(doc, method=None):
	"""Prevent enabled UOM names and labels from colliding with one another."""
	clear_uom_label_cache()
	if not doc.get("enabled", 1):
		return
	for value in (doc.name, doc.get("ti_label")):
		if not str(value or "").strip():
			continue
		other = _clashing_unit(doc.name, value)
		if other:
			label = str(value).strip()
			frappe.throw(f"「{label}」已被单位 {other} 使用", title=f"UOM_CLASH:{other}")
