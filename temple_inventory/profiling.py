"""Read-only per-endpoint SQL and wall-time profiler for development sites."""

import cProfile
import hashlib
import io
import json
import pstats
import re
import statistics
import time
import traceback
from collections import Counter
from pathlib import Path

import frappe

LOCAL_STATE = (
	"user_perms",
	"role_permissions",
	"inventory_permission_signatures",
	"inventory_configuration_signature",
	"inventory_cache_revision_touched",
	"inventory_cache_dirty_scheduled",
	"inventory_cache_request_generation",
	"inventory_cache_request_started",
	"temple_inventory_uom_labels",
	"ti_readable_parents",
)
_ALLOW_HOOK_COMMIT = [False]


def _query(dataset, view=None, **extra):
	value = {"dataset": dataset, **extra}
	if view:
		value["view"] = view
	return value


def _specs():
	base = _query("inventory", "locations")
	movement = _query("movements", "records")
	loans = _query("loans", "records")
	counts_query = _query("counts", "records")
	expiry = _query("expiry", "batches")
	newest_entry = frappe.db.sql(
		"select p.name from `tabStock Entry` p inner join `tabStock Entry Detail` d on d.parent=p.name "
		"where p.docstatus=1 group by p.name order by count(*) desc, p.name desc limit 1",
		as_list=True,
	)
	newest_entry = newest_entry[0][0] if newest_entry else None
	largest_count = frappe.db.sql(
		"select parent from `tabStock Reconciliation Item` group by parent order by count(*) desc limit 1",
		as_list=True,
	)
	item = frappe.db.sql(
		"select item_code from `tabStock Ledger Entry` group by item_code order by count(*) desc limit 1",
		as_list=True,
	)
	loan = frappe.db.get_value(
		"Stock Entry", {"docstatus": 1, "ti_movement_kind": "Loan"}, "name", order_by="creation desc"
	)
	code = item[0][0] if item else ""
	count_name = largest_count[0][0] if largest_count else ""
	count_items = (
		[
			row[0]
			for row in frappe.db.sql(
				"select distinct item_code from `tabStock Reconciliation Item` where parent=%s order by item_code",
				(count_name,),
				as_list=True,
			)
		]
		if count_name
		else []
	)
	defs = {
		"session.info": ("temple_inventory.session", "info", (), {}),
		"browse.bootstrap": ("temple_inventory.browse", "bootstrap", (), {}),
		"browse.dashboard_card.inventory": (
			"temple_inventory.browse",
			"dashboard_card",
			(),
			{"card": "inventory"},
		),
	}
	for card in ("inventory", "distribution", "expiry", "movement", "loans", "reminders"):
		defs[f"browse.dashboard_card.{card}"] = (
			"temple_inventory.browse",
			"dashboard_card",
			(),
			{"card": card},
		)
	for key, query in (
		("default", base),
		("zero_stock", {**base, "includeZero": True}),
		("search", {**base, "search": code[:3] if code else ""}),
	):
		defs[f"browse.inventory_page.{key}"] = (
			"temple_inventory.browse",
			"inventory_page",
			(),
			{"query": query},
		)
	defs.update(
		{
			"browse.expiry_page": ("temple_inventory.browse", "expiry_page", (), {"query": expiry}),
			"browse.operation_page.movements_grouped": (
				"temple_inventory.browse",
				"operation_page",
				(),
				{"query": movement},
			),
			"browse.operation_page.movements_flat": (
				"temple_inventory.browse",
				"operation_page",
				(),
				{"query": {**movement, "view": "lines"}, "records": True},
			),
			"browse.operation_page.loans": (
				"temple_inventory.browse",
				"operation_page",
				(),
				{"query": loans},
			),
			"browse.movement_history": (
				"temple_inventory.browse",
				"movement_history",
				(),
				{"query": movement},
			),
			"browse.operation_contributions": (
				"temple_inventory.browse",
				"operation_contributions",
				(),
				{"query": movement},
			),
			"browse.native_drafts": ("temple_inventory.browse", "native_drafts", (), {"query": movement}),
			"browse.counts_page": ("temple_inventory.browse", "counts_page", (), {"query": counts_query}),
			"browse.native_draft_count": ("temple_inventory.browse", "native_draft_count", (), {}),
			"browse.more_summary": ("temple_inventory.browse", "more_summary", (), {}),
			"native_api.load_document.stock_entry": (
				"temple_inventory.native_api",
				"load_document",
				("Stock Entry", newest_entry),
				{},
			),
			"native_api.load_document.largest_count": (
				"temple_inventory.native_api",
				"load_document",
				("Stock Reconciliation", count_name),
				{},
			),
			"native_api.loan_detail": ("temple_inventory.native_api", "loan_detail", (loan,), {}),
			"native_api.outstanding_loans": ("temple_inventory.native_api", "outstanding_loans", (), {}),
			"native_api.outstanding_loan_groups": (
				"temple_inventory.native_api",
				"outstanding_loan_groups",
				(),
				{},
			),
			"catalog.item_detail": ("temple_inventory.catalog", "item_detail", (code,), {}),
			"catalog.item_summaries": (
				"temple_inventory.catalog",
				"item_summaries",
				(count_items,),
				{},
			),
			"catalog.search_items": (
				"temple_inventory.catalog",
				"search_items",
				(),
				{"search": code[:3] if code else ""},
			),
			"catalog.picker_rows": (
				"temple_inventory.catalog",
				"picker_rows",
				(),
				{"search": code[:3] if code else ""},
			),
			"counts.count_baseline": (
				"temple_inventory.counts",
				"count_baseline",
				(str(frappe.utils.now_datetime()),),
				{},
			),
			"warehouses.tree": ("temple_inventory.warehouses", "tree", (), {}),
			"warehouses.stock_summary": (
				"temple_inventory.warehouses",
				"stock_summary",
				(frappe.db.get_value("Warehouse", {}, "name"),),
				{},
			),
			"notifications.unread_count": ("temple_inventory.notifications", "unread_count", (), {}),
			"notifications.inbox": ("temple_inventory.notifications", "inbox", (), {}),
		}
	)
	for dataset in ("inventory", "movements", "loans", "expiry", "counts", "activities"):
		defs[f"projections.report_page.{dataset}"] = (
			"temple_inventory.projections",
			"report_page",
			(),
			{"query": _query(dataset)},
		)
	return defs, {"item": code, "largest_count": count_name, "stock_entry": newest_entry, "loan": loan}


def _normalize(sql):
	sql = re.sub(r"'([^']|'')*'", "?", str(sql))
	sql = re.sub(r"\b\d+(?:\.\d+)?\b", "?", sql)
	sql = re.sub(r"\bIN\s*\([^)]*\)", "IN (?)", sql, flags=re.I)
	return re.sub(r"\s+", " ", sql).strip().lower()


def _reset(user, method=""):
	frappe.set_user(user)
	for name in LOCAL_STATE:
		setattr(frappe.local, name, None if name in ("user_perms",) else {})
	frappe.local.user_perms = None
	frappe.local.role_permissions = {}
	frappe.local.temple_inventory_memos = None
	frappe.local.temple_inventory_settings = None
	frappe.local.form_dict = frappe._dict(cmd=method)
	frappe.local.request = frappe._dict(path=f"/api/method/{method}", headers={})
	from temple_inventory.read_cache import begin_read_request

	# The production hook commits a clean auth transaction to own the cache snapshot.
	# This runner permits that single hook commit (read-only state), then always rolls back.
	_ALLOW_HOOK_COMMIT[0] = True
	try:
		begin_read_request()
	finally:
		_ALLOW_HOOK_COMMIT[0] = False


def _invoke(module, name, args, kwargs, user, refresh):
	_reset(user, f"{module}.{name}")
	function = getattr(__import__(module, fromlist=[name]), name)
	if refresh and "refresh" in function.__code__.co_varnames:
		kwargs = dict(kwargs)
		kwargs["refresh"] = True
	return function(*args, **kwargs)


_VOLATILE_KEYS = {
	"generation",
	"snapshot",
	"snapshot_at",
	"snapshot_time",
	"site_time",
	"balance_at",
	"cache",
	"cache_hit",
	"site_date",
}


def _stable_response(value, endpoint=None, path=()):
	if isinstance(value, dict):
		return {
			key: _stable_response(item, endpoint, (*path, key))
			for key, item in sorted(value.items())
			if key.lower() not in _VOLATILE_KEYS
			and not key.lower().endswith(("_generation", "_snapshot_at", "_cache"))
			and not (
				key == "remaining_days"
				and endpoint
				in (
					"browse.expiry_page",
					"browse.dashboard_card.expiry",
					"browse.dashboard_card.reminders",
					"projections.report_page.expiry",
				)
			)
			and not (key in {"expired", "unexpired"} and endpoint == "browse.expiry_page")
			and not (key == "timestamp" and endpoint == "counts.count_baseline")
			and not (
				key in {"expiry_rows", "expired_count"}
				and endpoint in ("browse.dashboard_card.expiry", "browse.dashboard_card.reminders")
			)
			and not (
				key == "count"
				and endpoint in ("browse.dashboard_card.expiry", "browse.dashboard_card.reminders")
			)
		}
	if isinstance(value, (list, tuple)):
		return [_stable_response(item, endpoint, path) for item in value]
	return value


def _digest(value, endpoint=None):
	canonical = json.dumps(
		_stable_response(value, endpoint), sort_keys=True, separators=(",", ":"), default=str
	)
	return hashlib.sha256(canonical.encode()).hexdigest()


def _first_difference(left, right, path="$ "):
	if type(left) is not type(right):
		return f"{path.rstrip()}: {type(left).__name__} != {type(right).__name__}"
	if isinstance(left, dict):
		for key in sorted(set(left) | set(right)):
			if key not in left or key not in right:
				return f"{path.rstrip()}.{key}: {'added' if key not in left else 'removed'}"
			found = _first_difference(left[key], right[key], f"{path.rstrip()}.{key}")
			if found:
				return found
	elif isinstance(left, list):
		if len(left) != len(right):
			return f"{path.rstrip()}.length: {len(left)} != {len(right)}"
		for index, (a, b) in enumerate(zip(left, right, strict=True)):
			found = _first_difference(a, b, f"{path.rstrip()}[{index}]")
			if found:
				return found
	elif left != right:
		return f"{path.rstrip()}: {str(left)[:80]!r} != {str(right)[:80]!r}"


def _difference_paths(left, right, path="$ "):
	if type(left) is not type(right):
		return [path.rstrip()]
	if isinstance(left, dict):
		paths = []
		for key in sorted(set(left) | set(right)):
			if key not in left or key not in right:
				paths.append(f"{path.rstrip()}.{key}")
			else:
				paths.extend(_difference_paths(left[key], right[key], f"{path.rstrip()}.{key}"))
		return paths
	if isinstance(left, list):
		if len(left) != len(right):
			return [f"{path.rstrip()}.length"]
		return [
			part
			for index, (a, b) in enumerate(zip(left, right, strict=True))
			for part in _difference_paths(a, b, f"{path.rstrip()}[{index}]")
		]
	return [] if left == right else [path.rstrip()]


def _compare(data, previous):
	old = json.loads(Path(previous).read_text())
	old_rows = {(row["endpoint"], row["account"]): row for row in old["results"]}
	changed = 0
	for row in data["results"]:
		key = (row["endpoint"], row["account"])
		prior = old_rows.get(key)
		if not prior or _digest(row.get("cold", {}).get("response"), key[0]) != _digest(
			prior.get("cold", {}).get("response"), key[0]
		):
			changed += 1
			path = (
				_first_difference(prior.get("cold", {}).get("response"), row.get("cold", {}).get("response"))
				if prior
				else "missing baseline"
			)
			print(f"DIFF {key[0]} / {key[1]}: {path or 'digest differs (volatile fields only)'}")
	print(f"Compared {len(data['results'])} endpoints/accounts; {changed} digest differences")
	return changed


def profile_reads(
	only=None,
	out="/tmp/codex-runs/profile-reads.json",
	compare=None,
	cprofile=False,
	include_restricted=True,
	trace_permissions=False,
):
	"""Profile page-feeding reads. Run with bench execute; transaction ends in rollback."""

	original_sql, original_commit = frappe.db.sql, frappe.db.commit
	queries = []
	permission_stacks = []
	trace_permission_queries = [False]

	def sql(*args, **kwargs):
		statement = str(args[0]) if args else ""
		queries.append(statement)
		lower_statement = statement.lower()
		if (
			trace_permission_queries[0]
			and ("tabdocshare" in lower_statement or "`tabbatch`" in lower_statement)
			and len(permission_stacks) < 12
		):
			stack = "".join(traceback.format_list(traceback.extract_stack(limit=14)[:-1]))
			if stack not in permission_stacks:
				permission_stacks.append(stack)
		return original_sql(*args, **kwargs)

	def commit():
		if not _ALLOW_HOOK_COMMIT[0]:
			frappe.throw("Profiler rejected an unexpected database commit")
		return original_commit()

	frappe.db.sql, frappe.db.commit = sql, commit
	results = []
	try:
		defs, samples = _specs()
		users = ["Administrator"]
		operator = frappe.db.sql(
			"select hr.parent from `tabHas Role` hr join `tabUser` u on u.name=hr.parent "
			"where hr.role in ('Inventory Operator','Inventory Manager') and u.enabled=1 "
			"and u.name != 'Administrator' order by hr.role desc, u.name limit 1",
			as_list=True,
		)
		operator = operator[0][0] if operator else None
		if operator:
			users.append(operator)
		if include_restricted:
			from temple_inventory.roles import OPERATOR, ensure_roles

			ensure_roles()
			area = frappe.db.get_value("Warehouse", {"warehouse_type": "Area", "is_group": 1}, "name")
			if not area:
				area = frappe.db.get_value("Warehouse", {"warehouse_type": "Area"}, "name")
			if area:
				email = "profile-restricted@example.com"
				if frappe.db.exists("User", email):
					restricted = frappe.get_doc("User", email)
					restricted.enabled = 1
					restricted.user_type = "System User"
					restricted.save(ignore_permissions=True)
				else:
					restricted = frappe.get_doc(
						{
							"doctype": "User",
							"email": email,
							"first_name": "Profile Restricted",
							"user_type": "System User",
							"enabled": 1,
							"send_welcome_email": 0,
							"roles": [{"role": OPERATOR}],
						}
					).insert(ignore_permissions=True)
				if not frappe.db.exists(
					"Has Role", {"parent": email, "parenttype": "User", "role": OPERATOR}
				):
					frappe.get_doc(
						{
							"doctype": "Has Role",
							"parent": email,
							"parenttype": "User",
							"parentfield": "roles",
							"role": OPERATOR,
						}
					).insert(ignore_permissions=True)
				settings = frappe.get_single("Temple Inventory Settings")
				for warehouse, hide_descendants in (
					(settings.root_warehouse, 1),
					(settings.physical_root_warehouse, 1),
					(area, 0),
				):
					if warehouse and not frappe.db.exists(
						"User Permission",
						{"user": restricted.name, "allow": "Warehouse", "for_value": warehouse},
					):
						frappe.get_doc(
							{
								"doctype": "User Permission",
								"user": restricted.name,
								"allow": "Warehouse",
								"for_value": warehouse,
								"hide_descendants": hide_descendants,
							}
						).insert(ignore_permissions=True)
				frappe.clear_cache(user=restricted.name)
				users.append(restricted.name)
		selected = set(only or defs)
		for key, (module, function, args, kwargs) in defs.items():
			if key not in selected:
				continue
			for user in users:
				try:
					# cold uses refresh=True to bypass the app cache without touching Redis.
					measurements = {}
					responses = {}
					for state, refresh, repeats in (("cold", True, 1), ("warm", False, 3)):
						times, query_counts, final_sql = [], [], []
						cprofile_output = None
						response = None
						for _ in range(repeats):
							queries.clear()
							permission_stacks.clear()
							started = time.perf_counter()
							profiler = (
								cProfile.Profile()
								if cprofile
								and key == "browse.counts_page"
								and user == operator
								and state == "cold"
								else None
							)
							try:
								trace_permission_queries[0] = trace_permissions
								if profiler:
									profiler.enable()
								response = _invoke(module, function, args, kwargs, user, refresh)
							finally:
								trace_permission_queries[0] = False
								if profiler:
									profiler.disable()
								_ALLOW_HOOK_COMMIT[0] = False
							if profiler:
								stream = io.StringIO()
								pstats.Stats(profiler, stream=stream).sort_stats("cumtime").print_stats(40)
								cprofile_output = stream.getvalue()
							times.append((time.perf_counter() - started) * 1000)
							final_sql = list(queries)
							query_counts.append(len(final_sql))
						measurements[state] = {
							"queries": round(statistics.median(query_counts)),
							"ms": round(statistics.median(times), 2),
							"repeated": [
								{"count": count, "sql": statement[:140]}
								for statement, count in Counter(map(_normalize, final_sql)).most_common(5)
								if count > 1
							],
						}
						if trace_permissions and permission_stacks:
							measurements[state]["permission_stacks"] = list(permission_stacks)
						if cprofile_output:
							measurements[state]["cprofile"] = cprofile_output
						measurements[state]["digest"] = _digest(response, key)
						responses[state] = json.loads(
							json.dumps(_stable_response(response, key), default=str)
						)
						if state == "cold":
							measurements[state]["response"] = responses[state]
					measurements["consecutive_differences"] = _difference_paths(
						responses["cold"], responses["warm"]
					)
					results.append({"endpoint": key, "account": user, **measurements})
				except Exception as error:
					results.append(
						{
							"endpoint": key,
							"account": user,
							"error": str(error)[:300],
							"error_type": type(error).__name__,
							"traceback": traceback.format_exc()[-3000:],
						}
					)
	finally:
		frappe.db.sql, frappe.db.commit = original_sql, original_commit
		frappe.db.rollback()
	frappe.set_user("Administrator")
	frappe.local.request = frappe._dict(headers={})
	results.sort(key=lambda row: row.get("cold", {}).get("queries", -1), reverse=True)
	data = {"samples": samples, "results": results, "metadata": profile_metadata()}
	Path(out).parent.mkdir(parents=True, exist_ok=True)
	Path(out).write_text(json.dumps(data, indent=2, default=str))
	if compare:
		_compare(data, compare)
	print(
		"| endpoint | account | cold queries | cold ms | warm queries | warm ms | worst repeated statement |"
	)
	print("|---|---|---:|---:|---:|---:|---|")
	for row in results:
		cold, warm = row.get("cold", {}), row.get("warm", {})
		repeat = (cold.get("repeated") or [{}])[0]
		worst = f"{repeat.get('count', 0)} x {repeat.get('sql', row.get('error', ''))}"
		print(
			f"| {row['endpoint']} | {row['account']} | {cold.get('queries', '—')} | {cold.get('ms', '—')} | {warm.get('queries', '—')} | {warm.get('ms', '—')} | {worst} |"
		)
	return data


def profile_metadata():
	"""Read-only data volume, index, and isolated fixed-overhead measurements."""
	from temple_inventory import (
		browse,
		native_access,
		native_stock,
		native_topology,
		projections,
		report_sources,
	)

	frappe.set_user("Administrator")
	counts = {}
	for doctype in ("Item", "Warehouse", "Stock Entry", "Stock Ledger Entry", "Bin", "Batch", "Serial No"):
		counts[doctype] = frappe.db.count(doctype)
	indexes = {}
	for doctype in ("Stock Entry", "Stock Entry Detail", "Stock Ledger Entry"):
		rows = frappe.db.sql(f"show index from `tab{doctype}`", as_dict=True)
		indexes[doctype] = [
			row for row in rows if doctype == "Stock Ledger Entry" or str(row.Column_name).startswith("ti_")
		]
	from temple_inventory.report_query import validate_query

	query = validate_query(_query("inventory", "locations"))
	settings, warehouses, *_ = native_stock.warehouse_scopes()
	native_topology.present_locations(
		warehouses, physical_root=settings.physical_root_warehouse, settings=settings
	)
	measure = {}
	for key, fn, args in (
		("native_access.require_app", native_access.require_app, ()),
		("native_stock.warehouse_scopes", native_stock.warehouse_scopes, ()),
		("native_topology.present_locations", native_topology.present_locations, (warehouses,)),
		("report_sources.ReportContext", report_sources.ReportContext, (query,)),
	):
		_reset("Administrator", "temple_inventory.profiling.profile_metadata")
		statements = []
		original = frappe.db.sql
		frappe.db.sql = lambda *a, **kw: (statements.append(str(a[0]) if a else ""), original(*a, **kw))[1]
		started = time.perf_counter()
		try:
			if key.endswith("present_locations"):
				fn(*args, physical_root=settings.physical_root_warehouse, settings=settings)
			else:
				fn(*args)
		finally:
			elapsed = (time.perf_counter() - started) * 1000
			frappe.db.sql = original
		measure[key] = {"queries": len(statements), "ms": round(elapsed, 2)}
	calls = {}
	wrappers = [
		(browse, "require_app", "native_access.require_app"),
		(report_sources, "warehouse_scopes", "native_stock.warehouse_scopes"),
		(native_topology, "present_locations", "native_topology.present_locations"),
		(projections, "ReportContext", "report_sources.ReportContext"),
	]
	originals = [(owner, attr, getattr(owner, attr)) for owner, attr, _label in wrappers]
	for owner, attr, label in wrappers:
		original = getattr(owner, attr)

		def counted(*args, _fn=original, _label=label, **kwargs):
			calls[_label] = calls.get(_label, 0) + 1
			return _fn(*args, **kwargs)

		setattr(owner, attr, counted)
	try:
		from temple_inventory.report_query import validate_query

		_reset("Administrator", "temple_inventory.browse.inventory_page")
		browse.inventory_page(validate_query(_query("inventory", "locations")), refresh=True)
		invocations = {"inventory_page": dict(calls)}
		calls.clear()
		_reset("Administrator", "temple_inventory.browse.dashboard_card")
		browse.dashboard_card("inventory", refresh=True)
		invocations["dashboard_card"] = dict(calls)
	finally:
		for owner, attr, original in originals:
			setattr(owner, attr, original)
	result = {
		"data_counts": counts,
		"indexes": indexes,
		"fixed_overhead": measure,
		"fixed_overhead_calls": invocations,
	}
	frappe.db.rollback()
	return result
