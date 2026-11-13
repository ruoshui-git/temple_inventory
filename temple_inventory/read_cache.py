"""Small immutable cache for permission-scoped browse response pages."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import zlib
from pathlib import Path

import frappe
import redis
from frappe.utils import now_datetime

CACHE_TTL = 300
MAX_ENTRY_BYTES = 64 * 1024 * 1024
MAX_PROJECTION_BYTES = 256 * 1024 * 1024
IMPLEMENTATION_VERSION = "browse-v10"
GENERATION_KEY = "temple_inventory:browse:generation"
LOCK_WAIT_SECONDS = 3
CACHEABLE_METHODS = {
	"temple_inventory.activities.load_activity",
	"temple_inventory.projections.report_page",
	"temple_inventory.projections.group_page",
	"temple_inventory.browse.dashboard_card",
	"temple_inventory.browse.expiry_page",
	"temple_inventory.browse.inventory_page",
	"temple_inventory.browse.movement_history",
	"temple_inventory.browse.operation_analysis",
	"temple_inventory.browse.operation_contributions",
	"temple_inventory.browse.operation_page",
	"temple_inventory.browse.counts_page",
	"temple_inventory.browse.native_drafts",
}

READ_DOCTYPES = (
	"Batch",
	"Bin",
	"Company",
	"Custom DocPerm",
	"DocShare",
	"DocPerm",
	"DocType",
	"Delivery Note",
	"File",
	"Inventory Activity",
	"Inventory Activity Type",
	"Inventory Configuration",
	"Item",
	"Item Group",
	"POS Invoice",
	"Purchase Invoice",
	"Purchase Receipt",
	"Repost Item Valuation",
	"Role",
	"Role Profile",
	"Sales Invoice",
	"Serial and Batch Bundle",
	"Serial and Batch Entry",
	"Serial No",
	"Stock Entry",
	"Stock Ledger Entry",
	"Stock Reconciliation",
	"Subcontracting Receipt",
	"Has Role",
	"Temple Inventory Settings",
	"User",
	"User Permission",
	"UOM",
	"Warehouse",
)

DATASETS = ("access", "catalog", "counts", "entries", "ledger")
ALL_DATASETS = frozenset(DATASETS)
_REVISION_TABLE_READY_SITES = set()

# Every native DocType whose changes can alter a cached response is classified.
# Unknown DocTypes fail closed in datasets_for_doctype().
DOCTYPE_DATASETS = {
	"Batch": {"catalog", "ledger"},
	"Bin": {"ledger"},
	"Company": {"catalog"},
	"Custom DocPerm": {"access"},
	"DocShare": {"access"},
	"DocPerm": {"access"},
	"DocType": {"access"},
	"Delivery Note": {"entries", "ledger"},
	"File": {"catalog"},
	"Inventory Activity": {"catalog"},
	"Inventory Activity Type": {"catalog"},
	"Inventory Configuration": {"catalog"},
	"Item": {"catalog"},
	"Item Group": {"catalog"},
	"POS Invoice": {"entries", "ledger"},
	"Purchase Invoice": {"entries", "ledger"},
	"Purchase Receipt": {"entries", "ledger"},
	"Repost Item Valuation": {"ledger"},
	"Role": {"access"},
	"Role Profile": {"access"},
	"Sales Invoice": {"entries", "ledger"},
	"Serial and Batch Bundle": {"ledger"},
	"Serial and Batch Entry": {"ledger"},
	"Serial No": {"catalog", "ledger"},
	"Stock Entry": {"entries", "ledger"},
	"Stock Ledger Entry": {"ledger"},
	"Stock Reconciliation": {"counts", "ledger"},
	"Subcontracting Receipt": {"entries", "ledger"},
	"Has Role": {"access"},
	"Temple Inventory Settings": {"catalog"},
	"User": {"access"},
	"User Permission": {"access"},
	"UOM": {"catalog"},
	"Warehouse": {"catalog"},
}

# Projection dataset declarations. These are intentionally explicit for each
# cacheable endpoint; generic report projections additionally resolve by query dataset.
CACHE_METHOD_DATASETS = {
	"temple_inventory.activities.load_activity": ALL_DATASETS,
	"temple_inventory.projections.report_page": ALL_DATASETS,
	"temple_inventory.projections.group_page": ALL_DATASETS,
	"temple_inventory.browse.dashboard_card": ALL_DATASETS,
	"temple_inventory.browse.expiry_page": {"catalog", "access", "ledger"},
	"temple_inventory.browse.inventory_page": {"catalog", "access", "ledger"},
	"temple_inventory.browse.movement_history": {"catalog", "access", "entries", "counts", "ledger"},
	"temple_inventory.browse.operation_analysis": {"catalog", "access", "entries", "counts", "ledger"},
	"temple_inventory.browse.operation_contributions": {"catalog", "access", "entries", "counts", "ledger"},
	"temple_inventory.browse.operation_page": {"catalog", "access", "entries", "counts", "ledger"},
	"temple_inventory.browse.counts_page": {"catalog", "access", "counts"},
	"temple_inventory.browse.native_drafts": {"catalog", "access", "entries", "counts"},
}

PROJECTION_DATASETS = {
	"inventory": {"catalog", "access", "ledger"},
	# Movements, loans and drafts list count adjustments and count drafts as well.
	"movements": {"catalog", "access", "entries", "counts", "ledger"},
	"loans": {"catalog", "access", "entries", "counts", "ledger"},
	"counts": {"catalog", "access", "counts"},
	"expiry": {"catalog", "access", "ledger"},
	# Activity detail aggregates the linked operations and counts.
	"activities": ALL_DATASETS,
}


def _redis():
	return frappe.cache


def _redis_key(raw, key):
	return raw.make_key(key)


def _generation_key(dataset):
	return f"{GENERATION_KEY}:{dataset}"


def data_generation(datasets=None):
	"""Return the Redis generation snapshot for the requested datasets."""
	raw = _redis()
	datasets = tuple(sorted(datasets or ALL_DATASETS))
	values = {}
	for dataset in datasets:
		value = raw.get(_redis_key(raw, _generation_key(dataset)))
		values[dataset] = value.decode() if isinstance(value, bytes) else str(value or "0")
	return values


def invalidate_now(datasets=None):
	"""Advance Redis generations after commit; existing entries age out naturally."""
	try:
		raw = _redis()
		for dataset in sorted(datasets or ALL_DATASETS):
			raw.incr(_redis_key(raw, _generation_key(dataset)))
	except redis.exceptions.RedisError, OSError:
		# A cache outage must never make the source transaction fail.
		return False
	return True


def invalidate_after_commit(doc=None, *_args, **_kwargs):
	"""Coalesce app/native document hooks and publish only after commit."""
	if doc and getattr(doc, "doctype", None) not in READ_DOCTYPES:
		return
	if doc:
		frappe.local.inventory_permission_signatures = {}
		frappe.local.inventory_configuration_signature = None
		frappe.local.temple_inventory_memos = None
	if doc and doc.doctype == "User" and _args and _args[0] != "after_insert":
		before = doc.get_doc_before_save()
		roles_changed = _user_role_signature(doc) != _user_role_signature(before)
		if not roles_changed and not any(
			doc.has_value_changed(field) for field in ("enabled", "user_type", "role_profile_name")
		):
			return
	datasets = datasets_for_doctype(doc.doctype) if doc else set(ALL_DATASETS)
	_mark_durable_revisions(datasets)
	pending = getattr(frappe.local, "inventory_cache_revision_datasets", None)
	if pending is None:
		pending = frappe.local.inventory_cache_revision_datasets = set()
	pending.update(datasets)
	if getattr(frappe.local, "inventory_cache_dirty_scheduled", False):
		return
	frappe.local.inventory_cache_dirty_scheduled = True

	def publish():
		changed = set(getattr(frappe.local, "inventory_cache_revision_datasets", ()))
		frappe.local.inventory_cache_dirty_scheduled = False
		frappe.local.inventory_cache_revision_touched = set()
		frappe.local.inventory_cache_revision_datasets = set()
		invalidate_now(changed)

	def rolled_back():
		frappe.local.inventory_cache_dirty_scheduled = False
		frappe.local.inventory_cache_revision_touched = set()
		frappe.local.inventory_cache_revision_datasets = set()

	frappe.db.after_commit.add(publish)
	frappe.db.after_rollback.add(rolled_back)


def invalidate_after_clear_cache():
	"""Durably invalidate projections when Frappe clears app-wide metadata/auth caches."""
	invalidate_after_commit()


def warehouse_changed(doc, method=None):
	from temple_inventory.native_topology import sync_desk_warehouse_allowlist

	sync_desk_warehouse_allowlist(doc, method)
	invalidate_after_commit(doc, method)


def after_job(method=None, **_kwargs):
	"""Invalidate projections after ERPNext's direct-SQL stock repost jobs."""
	name = str(method or "").casefold()
	if "repost" in name or "stock_ledger" in name or "stock ledger" in name:
		try:
			_mark_durable_revisions(ALL_DATASETS)
			frappe.db.commit()
		except Exception:
			# The job already committed its native writes. Redis generation still
			# invalidates when available; never report a successful repost as failed.
			frappe.logger().exception("Could not persist inventory cache revision after stock repost")
		invalidate_now(ALL_DATASETS)


def after_rename(*_args, **_kwargs):
	invalidate_after_commit(_args[0] if _args else None)


def _permission_signature(user):
	"""Read current role/user grants instead of trusting a user-only cache key."""
	if not getattr(frappe.db, "transaction_writes", 0):
		cache = getattr(frappe.local, "inventory_permission_signatures", None)
		if cache is None:
			cache = frappe.local.inventory_permission_signatures = {}
		if user not in cache:
			cache[user] = _permission_signature_uncached(user)
		return cache[user]
	return _permission_signature_uncached(user)


def _permission_signature_uncached(user):
	roles = sorted(
		row.role
		for row in frappe.get_all("Has Role", filters={"parent": user, "parenttype": "User"}, fields=["role"])
	)
	if user == "Administrator":
		roles.append("System Manager")
	roles = sorted(set(roles))
	user_doc = (
		frappe.db.get_value("User", user, ["enabled", "user_type", "role_profile_name"], as_dict=True) or {}
	)
	profile = None
	if user_doc.get("role_profile_name"):
		profile = frappe.db.get_value("Role Profile", user_doc.role_profile_name, ["modified"], as_dict=True)
		roles.extend(
			row.role
			for row in frappe.get_all(
				"Has Role",
				filters={"parent": user_doc.role_profile_name, "parenttype": "Role Profile"},
				fields=["role"],
			)
		)
		roles = sorted(set(roles))
	user_permissions = frappe.get_all(
		"User Permission",
		filters={"user": user},
		fields=["allow", "for_value", "applicable_for", "is_default", "modified"],
		order_by="allow, for_value, applicable_for",
	)
	permission_doctypes = [
		"Item",
		"Item Group",
		"Warehouse",
		"Batch",
		"Stock Entry",
		"Stock Reconciliation",
		"Inventory Activity",
		"Inventory Activity Type",
		"Company",
		"File",
		"Temple Inventory Settings",
	]
	role_permissions = frappe.get_all(
		"DocPerm",
		filters={"parent": ["in", permission_doctypes], "role": ["in", roles]},
		fields=[
			"parent",
			"role",
			"permlevel",
			"read",
			"write",
			"create",
			"delete",
			"submit",
			"cancel",
			"amend",
			"report",
			"export",
			"share",
			"print",
			"email",
			"if_owner",
			"modified",
		],
		order_by="parent, role, permlevel",
	)
	custom_permissions = frappe.get_all(
		"Custom DocPerm",
		filters={"parent": ["in", permission_doctypes], "role": ["in", roles]},
		fields=[
			"parent",
			"role",
			"permlevel",
			"read",
			"write",
			"create",
			"delete",
			"submit",
			"cancel",
			"amend",
			"report",
			"export",
			"share",
			"print",
			"email",
			"if_owner",
			"modified",
		],
		order_by="parent, role, permlevel",
	)
	share_fields = ["share_doctype", "share_name", "user", "everyone", "read", "write", "share", "modified"]
	shares = frappe.get_all(
		"DocShare", filters={"user": user}, fields=share_fields, order_by="share_doctype, share_name"
	)
	shares.extend(
		frappe.get_all(
			"DocShare", filters={"everyone": 1}, fields=share_fields, order_by="share_doctype, share_name"
		)
	)
	role_definitions = frappe.get_all(
		"Role",
		filters={"name": ["in", roles]},
		fields=["name", "desk_access", "disabled", "modified"],
		order_by="name",
	)
	return _digest(
		[
			user,
			user_doc,
			profile,
			roles,
			role_definitions,
			user_permissions,
			role_permissions,
			custom_permissions,
			shares,
		]
	)


def _user_role_signature(doc):
	if not doc:
		return ()
	return tuple(sorted(row.role for row in doc.get("roles", []) if row.get("role")))


def _configuration_signature():
	if not getattr(frappe.db, "transaction_writes", 0):
		value = getattr(frappe.local, "inventory_configuration_signature", None)
		if value is None:
			value = frappe.local.inventory_configuration_signature = _configuration_signature_uncached()
		return value
	return _configuration_signature_uncached()


def _configuration_signature_uncached():
	settings = frappe.db.sql(
		"select field, value from tabSingles where doctype=%s and field in ('company', 'modified')",
		("Temple Inventory Settings",),
		as_dict=True,
	)
	values = {row.field: row.value for row in settings}
	return _digest(values)


def datasets_for_doctype(doctype):
	"""Return the explicit cache datasets affected by a native DocType write."""
	return set(DOCTYPE_DATASETS.get(doctype, ALL_DATASETS))


def _bump_durable_revisions(datasets):
	"""Append one revision row per newly touched dataset in the source transaction."""
	for dataset in sorted(datasets):
		name = frappe.db.get_next_sequence_val("Inventory Read Revision")
		frappe.db.sql(
			"insert into `tabInventory Read Revision` (name, dataset) values (%s, %s)",
			(name, dataset),
		)


def _mark_durable_revisions(datasets):
	if not _revision_table_exists():
		return
	touched = getattr(frappe.local, "inventory_cache_revision_touched", None)
	if not isinstance(touched, set):
		touched = frappe.local.inventory_cache_revision_touched = set()
	new_datasets = set(datasets) - touched
	if new_datasets:
		_bump_durable_revisions(new_datasets)
		touched.update(new_datasets)


def _revision_table_exists():
	"""Cache positive schema readiness per site and process, without caching pre-migrate misses."""
	site = getattr(frappe.local, "site", None) or frappe.conf.db_name
	if site in _REVISION_TABLE_READY_SITES:
		return True
	if frappe.db.table_exists("Inventory Read Revision"):
		_REVISION_TABLE_READY_SITES.add(site)
		return True
	return False


def durable_revisions(datasets=None):
	"""Read the latest append-only revision for each dataset in one grouped query."""
	datasets = tuple(sorted(datasets or ALL_DATASETS))
	rows = frappe.db.sql(
		"select dataset, max(name) as revision from `tabInventory Read Revision` "
		"where dataset in %(datasets)s group by dataset",
		{"datasets": datasets},
		as_dict=True,
	)
	values = {row.dataset: row.revision for row in rows}
	return {dataset: str(values.get(dataset) or "0") for dataset in datasets}


def prune_durable_revisions():
	"""Keep only the current maximum revision per dataset without changing maxima."""
	frappe.db.sql(
		"delete from `tabInventory Read Revision` where name not in ("
		"select latest from (select max(name) as latest from `tabInventory Read Revision` group by dataset) "
		"current_revisions)"
	)


def _digest(value):
	return hashlib.sha256(
		json.dumps(value, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":")).encode()
	).hexdigest()


def _request_cacheable():
	if getattr(frappe.flags, "in_test", False) or getattr(frappe.flags, "in_migrate", False):
		return False
	if getattr(frappe.local, "job", None) or not getattr(frappe.local, "request", None):
		return False
	if getattr(frappe.flags, "disable_inventory_read_cache", False):
		return False
	if not _revision_table_exists():
		return False
	if not getattr(frappe.local, "inventory_cache_request_revisions", None):
		return False
	if getattr(frappe.db, "transaction_writes", 0):
		return False
	# ERPNext repost workers rewrite Stock Ledger Entry and balances through SQL.
	# Do not serve the intermediate state while a repost document is in progress.
	user = frappe.session.user
	from temple_inventory.native_topology import request_memo

	checks = request_memo("repost_checks")
	if checks is not None and user in checks:
		return not checks[user]
	try:
		in_progress = bool(frappe.db.exists("Repost Item Valuation", {"status": "In Progress"}))
	except Exception:
		in_progress = True
	if checks is not None:
		checks[user] = in_progress
	return not in_progress


def begin_read_request():
	"""Start an owned read snapshot after auth, only when that transaction is clean."""
	method = getattr(frappe.form_dict, "cmd", None) or str(getattr(frappe.local.request, "path", ""))
	if method.startswith("/api/method/"):
		method = method.removeprefix("/api/method/")
	if method not in CACHEABLE_METHODS:
		return
	frappe.local.inventory_cache_request_revisions = None
	database = frappe.db
	if not _revision_table_exists():
		return
	callbacks = (
		database.before_commit,
		database.after_commit,
		database.before_rollback,
		database.after_rollback,
	)
	if (
		getattr(database, "transaction_writes", 0)
		or getattr(database, "_disable_transaction_control", 0)
		or any(getattr(callbacks, "_functions", ()) for callbacks in callbacks)
	):
		return
	try:
		# HTTPRequest may have opened a repeatable-read snapshot while loading auth.
		# End it only after proving there are no writes or deferred transaction callbacks.
		database.commit()
		frappe.local.inventory_cache_request_revisions = _revision_snapshot(ALL_DATASETS)
		frappe.local.inventory_cache_request_started = str(now_datetime())
	except redis.exceptions.RedisError, OSError, ValueError, TypeError, RuntimeError:
		frappe.local.inventory_cache_request_revisions = None


def restart_owned_read_snapshot():
	"""End a clean request snapshot before a cache-failure fresh rebuild."""
	if not _request_cacheable():
		return False
	database = frappe.db
	callbacks = (
		database.before_commit,
		database.after_commit,
		database.before_rollback,
		database.after_rollback,
	)
	if (
		getattr(database, "transaction_writes", 0)
		or getattr(database, "_disable_transaction_control", 0)
		or any(getattr(callbacks, "_functions", ()) for callbacks in callbacks)
	):
		return False
	try:
		database.commit()
		return True
	except Exception:
		return False


def _cache_key(*, kind, user, query, args, generation, permission, configuration):
	from temple_inventory.report_query import resolved_period

	periods = {}
	if isinstance(query, dict):
		period = query.get("scope", {}).get("period") if isinstance(query.get("scope"), dict) else None
		if isinstance(period, dict) and period.get("key"):
			periods["scope"] = resolved_period(period)
		period = query.get("relatedPeriod")
		if isinstance(period, dict) and period.get("key"):
			periods["related"] = resolved_period(period)
	material = {
		"site": frappe.local.site,
		"user": user,
		"query": query,
		"resolved_periods": periods,
		"args": args,
		"site_date": frappe.utils.nowdate(),
		"generation": generation,
		"permission": permission,
		"configuration": configuration,
		"implementation": IMPLEMENTATION_VERSION,
	}
	return f"temple_inventory:browse:{kind}:{_digest(material)}"


def _projection_identity(projection, generation, permission, configuration):
	from temple_inventory.report_query import resolved_period

	query = dict(projection.query)
	query.pop("groupBy", None)
	query.pop("sort", None)
	query.pop("sortBy", None)
	query = {**query, "scope": dict(query.get("scope") or {})}
	query["include_related"] = bool(getattr(projection, "related", False))
	query["complete_records"] = bool(getattr(projection, "complete_records", True))
	query["count_records_only"] = bool(getattr(projection, "count_record_fast_path", False))
	query["load_item_attachments"] = bool(getattr(projection, "load_item_attachments", True))
	for field in ("statuses", "itemCodes", "itemLocationKeys", "allocationKeys"):
		if isinstance(query.get(field), list):
			query[field] = sorted(set(query[field]))
	for field in ("warehouses", "categories", "sources", "destinations", "kinds"):
		if isinstance(query["scope"].get(field), list):
			query["scope"][field] = sorted(set(query["scope"][field]))
	for field in ("search", "relatedSearch"):
		if isinstance(query.get(field), str):
			query[field] = query[field].strip().casefold()
	for field in ("borrower",):
		if isinstance(query.get(field), str):
			query[field] = query[field].strip().casefold()
	if isinstance(query.get("person"), dict):
		query["person"] = {
			**query["person"],
			"name": str(query["person"].get("name") or "").strip().casefold(),
		}
	for period in (query["scope"].get("period"), query.get("relatedPeriod")):
		if not isinstance(period, dict) or not period.get("key"):
			continue
		resolved = resolved_period(period)
		canonical = (
			{"key": "all", "from": "", "to": ""}
			if not resolved["date_from"] and not resolved["date_to"]
			else {"key": "custom", "from": resolved["date_from"], "to": resolved["date_to"]}
		)
		if period is query["scope"].get("period"):
			query["scope"]["period"] = canonical
		else:
			query["relatedPeriod"] = canonical
	return _cache_key(
		kind="base-projection",
		user=frappe.session.user,
		query=query,
		args={},
		generation=generation,
		permission=permission,
		configuration=configuration,
	)


def _projection_datasets(query):
	if not isinstance(query, dict):
		return set(ALL_DATASETS)
	return set(PROJECTION_DATASETS.get(query.get("dataset"), ALL_DATASETS))


def _revision_snapshot(datasets):
	datasets = set(datasets or ALL_DATASETS)
	return {
		"datasets": sorted(datasets),
		"durable": durable_revisions(datasets),
		"redis": data_generation(datasets),
	}


def capture_cache_context(query=None):
	"""Capture authorization and source generation before a projection reads its snapshot."""
	if not _request_cacheable():
		return None
	try:
		datasets = _projection_datasets(query)
		request_revisions = frappe.local.inventory_cache_request_revisions
		return {
			"generation": {
				"datasets": sorted(datasets),
				"durable": {key: request_revisions["durable"][key] for key in sorted(datasets)},
				"redis": {key: request_revisions["redis"][key] for key in sorted(datasets)},
			},
			"datasets": sorted(datasets),
			"permission": _permission_signature(frappe.session.user),
			"configuration": _configuration_signature(),
			"user": frappe.session.user,
		}
	except redis.exceptions.RedisError, OSError, ValueError, TypeError:
		return None


def cache_context_current(context):
	if not context or context.get("user") != frappe.session.user:
		return False
	try:
		return (
			_revision_snapshot(context["datasets"]) == context["generation"]
			and _permission_signature(frappe.session.user) == context["permission"]
			and _configuration_signature() == context["configuration"]
		)
	except redis.exceptions.RedisError, OSError, ValueError, TypeError:
		return None


def acquire_projection_lock(projection):
	"""Wait briefly for a competing base build, then let the caller calculate fresh."""
	if projection.cache_bypass or not projection.cache_context:
		return None
	try:
		captured = projection.cache_context
		raw = _redis()
		key = _projection_identity(
			projection,
			captured["generation"],
			captured["permission"],
			captured["configuration"],
		)
		lock = raw.lock(
			_redis_key(raw, key + ":build-lock"),
			timeout=30,
			blocking_timeout=getattr(projection, "cache_wait_seconds", LOCK_WAIT_SECONDS),
		)
		return lock if lock.acquire(blocking=True) else None
	except redis.exceptions.RedisError, OSError, ValueError, TypeError:
		return None


def release_projection_lock(lock):
	if lock:
		try:
			lock.release()
		except redis.exceptions.RedisError, OSError:
			pass


def _fresh(snapshot):
	from frappe.utils import get_datetime

	try:
		age = (now_datetime() - get_datetime(snapshot)).total_seconds()
	except TypeError, ValueError, OverflowError:
		return False
	return 0 <= age < CACHE_TTL


def restore_projection(projection):
	"""Restore immutable base tables into this caller's private SQLite file."""
	if projection.cache_bypass or not _request_cacheable():
		return False
	try:
		raw = _redis()
		captured = projection.cache_context
		if not captured or captured["user"] != frappe.session.user:
			return False
		generation = captured["generation"]
		permission = captured["permission"]
		configuration = captured["configuration"]
		key = _projection_identity(projection, generation, permission, configuration)
		value = raw.get(_redis_key(raw, key))
		if not isinstance(value, bytes):
			return False
		snapshot, separator, database = value.partition(b"\n")
		if not separator or not _fresh(snapshot.decode("utf-8")):
			return False
		if database.startswith(b"ZLIB\n"):
			database = zlib.decompress(database[5:])
		if len(database) > MAX_PROJECTION_BYTES:
			return False
		staging = Path(projection.temp.name) / "projection.restore"
		staging.write_bytes(database)
		connection = sqlite3.connect(staging)
		try:
			metadata = connection.execute("select value from cache_meta where key='projection'").fetchone()
			if not metadata:
				return False
			metadata = json.loads(metadata[0])
		finally:
			connection.close()
		if _revision_snapshot(captured["datasets"]) != generation:
			return False
		if (
			_permission_signature(frappe.session.user) != permission
			or _configuration_signature() != configuration
		):
			return False
		projection.db.close()
		staging.replace(Path(projection.temp.name) / "projection.sqlite")
		projection.db = sqlite3.connect(Path(projection.temp.name) / "projection.sqlite")
		projection.db.execute("pragma cache_size = -8192")
		projection.db.execute("pragma journal_mode = memory")
		projection.db.execute("pragma synchronous = off")
		projection.column_names = metadata["column_names"]
		projection.main_table = metadata["main_table"]
		projection.summary_table = metadata["summary_table"]
		projection.sums = tuple(metadata["sums"])
		projection.restored_snapshot = snapshot.decode("utf-8")
		return True
	except redis.exceptions.RedisError, OSError, ValueError, TypeError, sqlite3.Error, zlib.error:
		return False


def store_projection(projection):
	"""Persist a bounded SQLite snapshot; large bases are calculated fresh next time."""
	if projection.cache_bypass or not _request_cacheable():
		return
	try:
		captured = projection.cache_context
		if not captured or captured["user"] != frappe.session.user:
			return
		generation = captured["generation"]
		permission = captured["permission"]
		configuration = captured["configuration"]
		key = _projection_identity(projection, generation, permission, configuration)
		metadata = {
			"column_names": projection.column_names,
			"main_table": projection.main_table,
			"summary_table": projection.summary_table,
			"sums": list(projection.sums),
		}
		projection.db.execute("create table if not exists cache_meta (key text primary key, value text)")
		projection.db.execute(
			"insert or replace into cache_meta (key, value) values ('projection', ?)",
			(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")),),
		)
		projection.db.commit()
		page_count, page_size = (
			projection.db.execute("pragma page_count").fetchone()[0],
			projection.db.execute("pragma page_size").fetchone()[0],
		)
		if page_count * page_size > MAX_PROJECTION_BYTES:
			return
		backup_path = Path(projection.temp.name) / "projection.cache"
		with sqlite3.connect(backup_path) as backup:
			projection.db.backup(backup)
		if backup_path.stat().st_size > MAX_PROJECTION_BYTES:
			return
		database = backup_path.read_bytes()
		if not _fresh(projection.context.snapshot):
			return
		if _revision_snapshot(captured["datasets"]) != generation:
			return
		if (
			_permission_signature(frappe.session.user) != permission
			or _configuration_signature() != configuration
		):
			return
		raw = _redis()
		age = (
			now_datetime()
			- __import__("frappe.utils", fromlist=["get_datetime"]).get_datetime(projection.context.snapshot)
		).total_seconds()
		database = b"ZLIB\n" + zlib.compress(database, level=1)
		entry = projection.context.snapshot.encode("utf-8") + b"\n" + database
		if len(entry) > MAX_ENTRY_BYTES:
			return
		raw.set(
			_redis_key(raw, key),
			entry,
			ex=max(1, int(CACHE_TTL - age)),
		)
	except redis.exceptions.RedisError, OSError, ValueError, TypeError, sqlite3.Error, zlib.error:
		return
