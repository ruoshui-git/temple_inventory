"""Read-only live probe for browse projection cache cold/warm behavior.

Run after the site is restored with:
bench --site development.localhost execute temple_inventory.tests.read_cache_benchmark.run

This measures direct service calls under a fresh request snapshot and records native
source-builder calls, elapsed time, and response bytes. It invalidates only the Redis
browse generation; it does not create or alter inventory documents.
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock
from time import perf_counter
from types import SimpleNamespace
from unittest.mock import patch

import frappe


def run():
	from temple_inventory import projections, read_cache

	methods = {
		"temple_inventory.projections.report_page": projections.report_page,
		"temple_inventory.projections.group_page": projections.group_page,
		"temple_inventory.browse.inventory_page": frappe.get_attr(
			"temple_inventory.browse.inventory_page"
		),
		"temple_inventory.browse.expiry_page": frappe.get_attr(
			"temple_inventory.browse.expiry_page"
		),
		"temple_inventory.browse.dashboard_card": frappe.get_attr(
			"temple_inventory.browse.dashboard_card"
		),
	}
	source_names = (
		"stock_rows",
		"movement_rows",
		"loan_rows",
		"historical_rows",
		"activity_rows",
		"count_rows",
	)
	source_calls = {name: 0 for name in source_names}

	def counted(name, original):
		def wrapper(*args, **kwargs):
			source_calls[name] += 1
			return original(*args, **kwargs)

		return wrapper

	missing = object()
	old_values = {
		field: getattr(frappe.local, field, missing)
		for field in (
			"request",
			"form_dict",
			"inventory_cache_request_generation",
			"inventory_cache_request_started",
		)
	}
	results = []

	def invoke(label, method, payload):
		frappe.local.request = SimpleNamespace(
			path=f"/api/method/{method}",
			method="POST",
			headers={"X-Inventory-Account": frappe.session.user},
		)
		frappe.local.form_dict = frappe._dict(cmd=method)
		read_cache.begin_read_request()
		before = source_calls.copy()
		started = perf_counter()
		response = methods[method](**payload)
		elapsed_ms = (perf_counter() - started) * 1000
		serialized = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
		results.append(
			{
				"case": label,
				"elapsed_ms": round(elapsed_ms, 2),
				"response_bytes": len(serialized.encode("utf-8")),
				"source_calls": {
					name: source_calls[name] - before[name]
					for name in source_names
					if source_calls[name] != before[name]
					},
				"matched_count": response.get("matched_count"),
				"rows": len(response.get("rows", [])),
				"snapshot": response.get("snapshot"),
			}
		)
		return response

	try:
		read_cache.invalidate_now()
		wrappers = {
			name: counted(name, getattr(projections, name)) for name in source_names
		}
		with (
			patch.object(projections, "stock_rows", wrappers["stock_rows"]),
			patch.object(projections, "movement_rows", wrappers["movement_rows"]),
			patch.object(projections, "loan_rows", wrappers["loan_rows"]),
			patch.object(projections, "historical_rows", wrappers["historical_rows"]),
			patch.object(projections, "activity_rows", wrappers["activity_rows"]),
			patch.object(projections, "count_rows", wrappers["count_rows"]),
		):
			query = {"dataset": "inventory", "view": "summary", "sortBy": "item_name", "sort": "asc"}
			invoke(
				"inventory-cold",
				"temple_inventory.projections.report_page",
				{"query": query, "page_length": 30},
			)
			invoke(
				"inventory-repeat",
				"temple_inventory.projections.report_page",
				{"query": query, "page_length": 30},
			)
			invoke(
				"inventory-next-page",
				"temple_inventory.projections.report_page",
				{"query": query, "start": 30, "page_length": 30},
			)

			group_query = {**query, "groupBy": ["category", "item"]}
			roots = invoke(
				"inventory-group-roots",
				"temple_inventory.projections.report_page",
				{"query": group_query, "page_length": 30},
			)
			if roots.get("rows"):
				root = roots["rows"][0]
				children = invoke(
					"inventory-group-children",
					"temple_inventory.projections.group_page",
					{
						"query": group_query,
						"parent_path": root.get("group_path", []),
						"parent_unit": root.get("stock_uom"),
						"page_length": 30,
					},
				)
				if children.get("rows"):
					child = children["rows"][0]
					invoke(
						"inventory-group-allocations",
						"temple_inventory.projections.group_page",
						{
							"query": group_query,
							"parent_path": child.get("group_path", []),
							"parent_unit": child.get("stock_uom"),
							"page_length": 30,
						},
					)

			invoke(
				"dashboard-overlap",
				"temple_inventory.browse.dashboard_card",
				{"card": "inventory", "scope": query.get("scope", {})},
			)

			invoke(
				"stock-endpoint",
				"temple_inventory.browse.inventory_page",
				{"query": query, "page_length": 30},
			)
			expiry_query = {
				"dataset": "expiry",
				"view": "batches",
				"sortBy": "expiry_date",
				"sort": "asc",
			}
			invoke(
				"expiry-cold",
				"temple_inventory.browse.expiry_page",
				{"query": expiry_query, "page_length": 30},
			)
			invoke(
				"expiry-repeat",
				"temple_inventory.browse.expiry_page",
				{"query": expiry_query, "page_length": 30},
			)

			for dataset, view, sort_by in (
				("movements", "summary", "item_name"),
				("movements", "records", "date"),
				("loans", "items", "item_name"),
				("loans", "records", "date"),
			):
				view_query = {"dataset": dataset, "view": view, "sortBy": sort_by, "sort": "desc"}
				label = f"{dataset}-{view}"
				invoke(
					f"{label}-cold",
					"temple_inventory.projections.report_page",
					{"query": view_query, "page_length": 30},
				)
				invoke(
					f"{label}-repeat",
					"temple_inventory.projections.report_page",
					{"query": view_query, "page_length": 30},
				)
			invoke(
				"inventory-explicit-refresh",
				"temple_inventory.projections.report_page",
				{"query": query, "page_length": 30, "refresh": True},
			)

			# Simulate a committed source invalidation without changing source records.
			read_cache.invalidate_now()
			invoke(
				"inventory-after-invalidation",
				"temple_inventory.projections.report_page",
				{"query": query, "page_length": 30},
			)
		return {"results": results, "total_source_calls": source_calls}
	finally:
		frappe.db.rollback()
		for field, value in old_values.items():
			if value is missing:
				try:
					delattr(frappe.local, field)
				except AttributeError:
					pass
			else:
				setattr(frappe.local, field, value)


def run_concurrent_cold_miss():
	"""Bounded two-request probe for equivalent concurrent cold projections."""
	from temple_inventory import projections, read_cache

	site = frappe.local.site
	query = {"dataset": "inventory", "view": "summary", "sortBy": "item_name", "sort": "asc"}
	barrier = Barrier(2, timeout=15)
	count_lock = Lock()
	source_builds = 0
	original = projections.stock_rows
	results = []

	def counted(*args, **kwargs):
		nonlocal source_builds
		with count_lock:
			source_builds += 1
		return original(*args, **kwargs)

	def request_once(index):
		from temple_inventory import projections as worker_projections
		from temple_inventory import read_cache as worker_cache

		frappe.init(site=site)
		frappe.connect()
		try:
			frappe.set_user("Administrator")
			method = "temple_inventory.projections.report_page"
			frappe.local.request = SimpleNamespace(
				path=f"/api/method/{method}",
				method="POST",
				headers={"X-Inventory-Account": frappe.session.user},
			)
			frappe.local.form_dict = frappe._dict(cmd=method)
			worker_cache.begin_read_request()
			barrier.wait()
			started = perf_counter()
			response = worker_projections.report_page(query, page_length=30)
			return {
				"index": index,
				"elapsed_ms": round((perf_counter() - started) * 1000, 2),
				"snapshot": response.get("snapshot"),
				"matched_count": response.get("matched_count"),
				"rows": len(response.get("rows", [])),
			}
		finally:
			frappe.db.rollback()
			frappe.destroy()

	try:
		read_cache.invalidate_now()
		with patch.object(projections, "stock_rows", side_effect=counted):
			with ThreadPoolExecutor(max_workers=2) as executor:
				results = list(executor.map(request_once, (1, 2)))
		return {"concurrent_cold_miss": results, "source_builds": source_builds}
	finally:
		frappe.db.rollback()


def run_invalidation_contract_probe():
	"""Exercise committed Item invalidation and a persisted role revoke on another connection."""
	from temple_inventory import projections, read_cache

	site = frappe.local.site
	method = "temple_inventory.projections.report_page"
	query = {"dataset": "inventory", "view": "summary", "sortBy": "item_name", "sort": "asc"}
	item_name = frappe.db.get_value("Item", {"disabled": 0}, "name")
	if not item_name:
		raise RuntimeError("No enabled Item exists for the reversible cache invalidation probe")
	item = frappe.get_doc("Item", item_name)
	original_description = item.description or ""
	probe_marker = f"\n[temporary cache probe {frappe.generate_hash(length=8)}]"
	original_stock_rows = projections.stock_rows
	builds = 0

	def counted(*args, **kwargs):
		nonlocal builds
		builds += 1
		return original_stock_rows(*args, **kwargs)

	def prepare_request(user):
		frappe.set_user(user)
		frappe.local.request = SimpleNamespace(
			path=f"/api/method/{method}",
			method="POST",
			headers={"X-Inventory-Account": user},
		)
		frappe.local.form_dict = frappe._dict(cmd=method)
		read_cache.begin_read_request()

	def save_user_roles_in_second_connection(email, roles=None, delete=False):
		frappe.init(site=site)
		frappe.connect()
		try:
			frappe.set_user("Administrator")
			if delete:
				if frappe.db.exists("User", email):
					frappe.delete_doc("User", email, ignore_permissions=True, force=True)
			else:
				user = frappe.get_doc("User", email)
				user.set("roles", [{"role": role} for role in roles or ()])
				user.save(ignore_permissions=True)
			frappe.db.commit()
		finally:
			frappe.destroy()

	def run_request(user):
		prepare_request(user)
		return projections.report_page(query, page_length=30)

	role_user = None
	role_denied = False
	result = {"item": item_name}
	try:
		read_cache.invalidate_now()
		with patch.object(projections, "stock_rows", side_effect=counted):
			cold = run_request("Administrator")
			warm = run_request("Administrator")
			result["source_builds_after_warm_repeat"] = builds
			item.description = original_description + probe_marker
			item.save(ignore_permissions=True)
			frappe.db.commit()
			updated = run_request("Administrator")
			result["source_builds_after_committed_item_edit"] = builds
			result["item_edit_matched_count"] = updated.get("matched_count")
			result["warm_snapshot"] = warm.get("snapshot")
			result["post_item_edit_snapshot"] = updated.get("snapshot")

			role_user = f"ti-cache-revoke-{frappe.generate_hash(length=10)}@example.test"
			user = frappe.get_doc(
				{
					"doctype": "User",
					"email": role_user,
					"first_name": "Temporary Cache Revocation",
					"send_welcome_email": 0,
					"user_type": "System User",
					"roles": [{"role": "System Manager"}, {"role": "Stock User"}],
				}
			).insert()
			frappe.db.commit()
			user_response = run_request(user.name)
			result["warm_revocable_user_matched_count"] = user_response.get("matched_count")
			frappe.db.commit()
			with ThreadPoolExecutor(max_workers=1) as executor:
				executor.submit(
					save_user_roles_in_second_connection,
					user.name,
					roles=["Stock User"],
				).result()
			try:
				run_request(user.name)
			except frappe.PermissionError:
				role_denied = True
			result["persisted_role_revoke_denied_next_read"] = role_denied
			result["source_builds_total"] = builds
			if not role_denied:
				raise AssertionError("Persisted System Manager revocation did not deny the next read")
		if cold.get("matched_count") != warm.get("matched_count"):
			raise AssertionError("Warm cache changed the complete matched count")
		return result
	finally:
		frappe.db.rollback()
		# Restore the original Item text through normal document hooks and remove
		# the committed temporary account even if an assertion above fails.
		try:
			frappe.set_user("Administrator")
			item = frappe.get_doc("Item", item_name)
			if item.description != original_description:
				item.description = original_description
				item.save(ignore_permissions=True)
				frappe.db.commit()
			if role_user:
				frappe.db.commit()
				with ThreadPoolExecutor(max_workers=1) as executor:
					executor.submit(save_user_roles_in_second_connection, role_user, delete=True).result()
		finally:
			frappe.db.rollback()


def cleanup_invalidation_probe_artifacts():
	"""Restore artifacts left by an interrupted manual invalidation probe."""
	import re

	frappe.set_user("Administrator")
	items = frappe.get_all(
		"Item",
		filters={"description": ["like", "%[temporary cache probe %]" ]},
		fields=["name", "description"],
	)
	restored = []
	for row in items:
		original = re.sub(r"\n\[temporary cache probe [a-zA-Z0-9]+\]$", "", row.description or "")
		if original != row.description:
			item = frappe.get_doc("Item", row.name)
			item.description = original
			item.save(ignore_permissions=True)
			restored.append(row.name)
	users = frappe.get_all(
		"User",
		filters={"email": ["like", "ti-cache-revoke-%@example.test"]},
		pluck="name",
	)
	for user in users:
		frappe.delete_doc("User", user, ignore_permissions=True, force=True)
	if restored or users:
		frappe.db.commit()
	return {
		"restored_items": restored,
		"deleted_users": users,
		"settings": frappe.db.sql(
			"select field, value from tabSingles where doctype='Temple Inventory Settings' order by field",
			as_dict=True,
		),
		"counts": {
			doctype: frappe.db.count(doctype)
			for doctype in ("Warehouse", "Item", "Stock Entry")
		},
	}
