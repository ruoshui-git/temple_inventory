"""Read-only inventory of Temple Inventory-owned schema and customizations."""

import json
import re
from pathlib import Path

import frappe

APP_MODULE = "Temple Inventory"
RETIRED_CUSTOM_FIELDS = frozenset(
	{
		"ti_workspace",
		"ti_loan",
		"ti_return",
		"ti_loss",
		"ti_responsible_person",
		"ti_system_role",
		"ti_fallback_role",
		"ti_count_warehouse",
	}
)
RETIRED_DOCTYPES = frozenset(
	{
		"Inventory Workspace",
		"Inventory Loan",
		"Inventory Loan Item",
		"Inventory Return",
		"Inventory Return Item",
		"Inventory Loss",
		"Inventory Loss Item",
	}
)
APP_ROOT = Path(__file__).parent


def _source_manifest():
	fixtures = json.loads((APP_ROOT / "fixtures" / "custom_field.json").read_text())
	custom_fields = sorted(
		(row["dt"], row["fieldname"]) for row in fixtures if row.get("module") == APP_MODULE
	)
	doctypes = sorted(
		data["name"]
		for path in (APP_ROOT / "temple_inventory" / "doctype").glob("*/*.json")
		if (data := json.loads(path.read_text())).get("module") == APP_MODULE
	)
	settings = json.loads(
		(
			APP_ROOT
			/ "temple_inventory"
			/ "doctype"
			/ "temple_inventory_settings"
			/ "temple_inventory_settings.json"
		).read_text()
	)
	settings_fields = sorted(field["fieldname"] for field in settings.get("fields", []))
	hooks = (APP_ROOT / "hooks.py").read_text()
	deployment = (APP_ROOT / "deployment.py").read_text()
	api_source = (APP_ROOT / "native_api.py").read_text()
	current_callers = sorted(
		str(path.relative_to(APP_ROOT))
		for path in APP_ROOT.rglob("*.py")
		if "ti_count_warehouses" in path.read_text(errors="ignore")
	)
	retired_name_sources = {
		name: [
			str(path.relative_to(APP_ROOT))
			for path in APP_ROOT.rglob("*.py")
			if path.name not in {"schema_audit.py", "sample_install.py"}
			and re.search(
				rf"(?<![A-Za-z0-9_]){re.escape(name)}(?![A-Za-z0-9_])",
				path.read_text(errors="ignore"),
			)
		]
		for name in sorted(RETIRED_CUSTOM_FIELDS | RETIRED_DOCTYPES)
	}
	return {
		"custom_fields": custom_fields,
		"doctypes": doctypes,
		"settings_fields": settings_fields,
		"hooks": {
			"fixtures": ["Custom Field"],
			"after_migrate": "temple_inventory.deployment.after_migrate",
			"doc_event_handlers": sorted(set(re.findall(r'"(temple_inventory\.[a-zA-Z0-9_.]+)"', hooks))),
			"contains_retired_names": any(name in hooks for name in RETIRED_CUSTOM_FIELDS),
		},
		"setup": {
			"after_migrate_source": "deployment.py",
			"seeds_activity_types": "seed_activity_types" in deployment,
			"contains_retired_names": any(
				name in deployment for name in RETIRED_CUSTOM_FIELDS | RETIRED_DOCTYPES
			),
		},
		"native_count_api_field": "ti_count_warehouses" if '"ti_count_warehouses"' in api_source else None,
		"current_count_field_callers": current_callers,
		"retired_name_sources_outside_audit_and_preflight": retired_name_sources,
	}


def audit_app_customizations():
	"""Compare app-owned live metadata to source and report extras without changing data."""
	manifest = _source_manifest()
	expected_fields = set(manifest["custom_fields"])
	live_fields = {
		(row.dt, row.fieldname)
		for row in frappe.get_all(
			"Custom Field",
			filters={"module": APP_MODULE},
			fields=["dt", "fieldname"],
			limit_page_length=0,
		)
	}
	missing_fields = sorted(expected_fields - live_fields)
	extra_fields = sorted(live_fields - expected_fields)
	settings_meta = frappe.get_meta("Temple Inventory Settings")
	missing_settings_fields = sorted(
		field for field in manifest["settings_fields"] if not settings_meta.has_field(field)
	)

	expected_doctypes = set(manifest["doctypes"])
	live_doctypes = {
		row.name
		for row in frappe.get_all(
			"DocType",
			filters={"module": APP_MODULE, "custom": 0},
			fields=["name"],
			limit_page_length=0,
		)
	}

	customization_records = {}
	for doctype in ("Property Setter", "Client Script", "Server Script"):
		meta = frappe.get_meta(doctype)
		if not meta.has_field("module"):
			candidates = []
			if doctype == "Property Setter":
				app_doctypes = expected_doctypes | {row[0] for row in expected_fields}
				for row in frappe.get_all(
					doctype,
					fields=["name", "doc_type", "field_name", "property"],
					limit_page_length=0,
				):
					if row.doc_type in app_doctypes or row.field_name in RETIRED_CUSTOM_FIELDS:
						candidates.append(
							{
								"name": row.name,
								"doc_type": row.doc_type,
								"field_name": row.field_name,
								"property": row.property,
								"ownership": "uncertain; review only",
							}
						)
			customization_records[doctype] = {
				"module_filter_available": False,
				"uncertain_candidates_review_only": candidates,
			}
			continue
		customization_records[doctype] = {
			"module_filter_available": True,
			"records": sorted(
				row.name
				for row in frappe.get_all(
					doctype,
					filters={"module": APP_MODULE},
					fields=["name"],
					limit_page_length=0,
				)
			),
		}

	retired_live_fields = sorted(
		(row.dt, row.fieldname)
		for row in frappe.get_all(
			"Custom Field",
			filters={"fieldname": ["in", sorted(RETIRED_CUSTOM_FIELDS)]},
			fields=["dt", "fieldname", "module"],
			limit_page_length=0,
		)
		if row.module == APP_MODULE
	)
	retired_live_doctypes = sorted(
		name for name in RETIRED_DOCTYPES if frappe.db.exists("DocType", name) or frappe.db.table_exists(name)
	)
	old_count_column = bool(frappe.db.has_column("Stock Reconciliation", "ti_count_warehouse"))
	return {
		"site": frappe.local.site,
		"source": manifest,
		"live": {
			"custom_fields": sorted(live_fields),
			"doctypes": sorted(live_doctypes),
			"settings_fields": sorted(field.fieldname for field in settings_meta.fields),
			"customizations": customization_records,
		},
		"differences": {
			"missing_custom_fields": missing_fields,
			"extra_app_custom_fields_review_only": extra_fields,
			"missing_doctypes": sorted(expected_doctypes - live_doctypes),
			"extra_app_doctypes_review_only": sorted(live_doctypes - expected_doctypes),
			"missing_settings_fields": missing_settings_fields,
		},
		"retired": {
			"app_owned_custom_fields": retired_live_fields,
			"business_doctypes": retired_live_doctypes,
			"singular_count_column": old_count_column,
		},
		"read_only": True,
	}
