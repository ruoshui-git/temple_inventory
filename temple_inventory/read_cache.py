"""Small immutable cache for permission-scoped browse response pages."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

import frappe
import redis
from frappe.utils import now_datetime

CACHE_TTL = 15
MAX_ENTRY_BYTES = 4 * 1024 * 1024
IMPLEMENTATION_VERSION = "browse-v1"
GENERATION_KEY = "temple_inventory:browse:generation"
LOCK_WAIT_SECONDS = 3
CACHEABLE_METHODS = {
	"temple_inventory.projections.report_page",
	"temple_inventory.projections.group_page",
	"temple_inventory.browse.dashboard_card",
	"temple_inventory.browse.expiry_page",
	"temple_inventory.browse.inventory_page",
	"temple_inventory.browse.operation_analysis",
	"temple_inventory.browse.operation_contributions",
	"temple_inventory.browse.operation_page",
	"temple_inventory.browse.counts_page",
	"temple_inventory.browse.native_drafts",
}

READ_DOCTYPES = (
	"Batch",
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
	"Stock Entry",
	"Stock Ledger Entry",
	"Stock Reconciliation",
	"Subcontracting Receipt",
	"Has Role",
	"Temple Inventory Settings",
	"User",
	"User Permission",
	"Warehouse",
)


def _redis():
	return frappe.cache


def _redis_key(raw, key):
	return raw.make_key(key)


def data_generation():
	raw = _redis()
	value = raw.get(_redis_key(raw, GENERATION_KEY))
	return value.decode() if isinstance(value, bytes) else str(value or "0")


def invalidate_now():
	"""Advance the global generation; existing immutable entries age out naturally."""
	try:
		raw = _redis()
		raw.incr(_redis_key(raw, GENERATION_KEY))
	except (redis.exceptions.RedisError, OSError):
		# A cache outage must never make the source transaction fail.
		return False
	return True


def invalidate_after_commit(doc=None, *_args, **_kwargs):
	"""Coalesce app/native document hooks and publish only after commit."""
	if doc and getattr(doc, "doctype", None) not in READ_DOCTYPES:
		return
	if doc and doc.doctype == "User" and _args and _args[0] != "after_insert":
		before = doc.get_doc_before_save()
		roles_changed = _user_role_signature(doc) != _user_role_signature(before)
		if not roles_changed and not any(
			doc.has_value_changed(field) for field in ("enabled", "user_type", "role_profile_name")
		):
			return
	if (
		doc
		and doc.doctype != "Temple Inventory Settings"
		and not getattr(frappe.local, "inventory_cache_revision_touched", False)
	):
		_bump_durable_revision()
		frappe.local.inventory_cache_revision_touched = True
	if getattr(frappe.local, "inventory_cache_dirty_scheduled", False):
		return
	frappe.local.inventory_cache_dirty_scheduled = True

	def publish():
		frappe.local.inventory_cache_dirty_scheduled = False
		frappe.local.inventory_cache_revision_touched = False
		invalidate_now()

	def rolled_back():
		frappe.local.inventory_cache_dirty_scheduled = False
		frappe.local.inventory_cache_revision_touched = False

	frappe.db.after_commit.add(publish)
	frappe.db.after_rollback.add(rolled_back)


def invalidate_after_clear_cache():
	"""Durably invalidate projections when Frappe clears app-wide metadata/auth caches."""
	if not getattr(frappe.local, "inventory_cache_revision_touched", False):
		_bump_durable_revision()
		frappe.local.inventory_cache_revision_touched = True
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
			_bump_durable_revision()
			frappe.db.commit()
		except Exception:
			# The job already committed its native writes. Redis generation still
			# invalidates when available; never report a successful repost as failed.
			frappe.logger().exception("Could not persist inventory cache revision after stock repost")
		invalidate_now()


def after_rename(*_args, **_kwargs):
	invalidate_after_commit(_args[0] if _args else None)


def _permission_signature(user):
	"""Read current role/user grants instead of trusting a user-only cache key."""
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
	settings = frappe.db.sql(
		"select field, value from tabSingles where doctype=%s and field in ('company', 'modified', 'ti_read_generation')",
		("Temple Inventory Settings",),
		as_dict=True,
	)
	values = {row.field: row.value for row in settings}
	values.setdefault("ti_read_generation", "0")
	repost = frappe.db.sql(
		"select modified from `tabRepost Item Valuation` order by modified desc limit 1", as_dict=True
	)
	values["latest_repost_modified"] = repost[0].modified if repost else ""
	return _digest(values)


def _bump_durable_revision():
	"""Advance the app-owned revision in the source transaction.

	Frappe's ``tabSingles`` index on ``(doctype, field)`` is not unique, so an
	upsert would insert duplicate generation rows. Locking reads provide the
	current committed row under MariaDB repeatable-read; the UPDATE itself is
	atomic and participates in the source transaction.
	"""
	doctype = "Temple Inventory Settings"
	rows = frappe.db.sql(
		"select value from tabSingles where doctype=%s and field='ti_read_generation' for update",
		(doctype,),
		as_dict=True,
	)
	if rows:
		frappe.db.sql(
			"update tabSingles set value=cast(coalesce(value, '0') as unsigned) + 1 where doctype=%s and field='ti_read_generation'",
			(doctype,),
		)
		return

	# The field is not materialized until the singleton has been saved on older
	# installations. Serialize this one-time creation on its DocType metadata
	# row, then recheck with a locking/current read before inserting.
	frappe.db.sql("select name from tabDocType where name=%s for update", (doctype,), as_dict=True)
	rows = frappe.db.sql(
		"select value from tabSingles where doctype=%s and field='ti_read_generation' for update",
		(doctype,),
		as_dict=True,
	)
	if rows:
		frappe.db.sql(
			"update tabSingles set value=cast(coalesce(value, '0') as unsigned) + 1 where doctype=%s and field='ti_read_generation'",
			(doctype,),
		)
	else:
		frappe.db.sql(
			"insert into tabSingles (doctype, field, value) values (%s, 'ti_read_generation', '1')",
			(doctype,),
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
	if not getattr(frappe.local, "inventory_cache_request_generation", None):
		return False
	if getattr(frappe.db, "transaction_writes", 0):
		return False
	# ERPNext repost workers rewrite Stock Ledger Entry and balances through SQL.
	# Do not serve the intermediate state while a repost document is in progress.
	try:
		if frappe.db.exists("Repost Item Valuation", {"status": "In Progress"}):
			return False
	except Exception:
		return False
	return True


def begin_read_request():
	"""Start an owned read snapshot after auth, only when that transaction is clean."""
	method = getattr(frappe.form_dict, "cmd", None) or str(getattr(frappe.local.request, "path", ""))
	if method.startswith("/api/method/"):
		method = method.removeprefix("/api/method/")
	if method not in CACHEABLE_METHODS:
		return
	frappe.local.inventory_cache_request_generation = None
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
		return
	try:
		# HTTPRequest may have opened a repeatable-read snapshot while loading auth.
		# End it only after proving there are no writes or deferred transaction callbacks.
		database.commit()
		frappe.local.inventory_cache_request_generation = data_generation()
		frappe.local.inventory_cache_request_started = str(now_datetime())
	except (redis.exceptions.RedisError, OSError, ValueError, TypeError, RuntimeError):
		frappe.local.inventory_cache_request_generation = None


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
	for field in ("statuses", "itemCodes", "itemLocationKeys", "allocationKeys"):
		if isinstance(query.get(field), list):
			query[field] = sorted(set(query[field]))
	for field in ("warehouses", "categories", "sources", "destinations", "kinds"):
		if isinstance(query["scope"].get(field), list):
			query["scope"][field] = sorted(set(query["scope"][field]))
	for field in ("search", "relatedSearch"):
		if isinstance(query.get(field), str):
			query[field] = query[field].strip().casefold()
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


def capture_cache_context():
	"""Capture authorization and source generation before a projection reads its snapshot."""
	if not _request_cacheable():
		return None
	try:
		return {
			"generation": frappe.local.inventory_cache_request_generation,
			"permission": _permission_signature(frappe.session.user),
			"configuration": _configuration_signature(),
			"user": frappe.session.user,
		}
	except (redis.exceptions.RedisError, OSError, ValueError, TypeError):
		return None


def cache_context_current(context):
	if not context or context.get("user") != frappe.session.user:
		return False
	try:
		return (
			data_generation() == context["generation"]
			and _permission_signature(frappe.session.user) == context["permission"]
			and _configuration_signature() == context["configuration"]
		)
	except (redis.exceptions.RedisError, OSError, ValueError, TypeError):
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
		lock = raw.lock(_redis_key(raw, key + ":build-lock"), timeout=30, blocking_timeout=LOCK_WAIT_SECONDS)
		return lock if lock.acquire(blocking=True) else None
	except (redis.exceptions.RedisError, OSError, ValueError, TypeError):
		return None


def release_projection_lock(lock):
	if lock:
		try:
			lock.release()
		except (redis.exceptions.RedisError, OSError):
			pass


def _fresh(snapshot):
	from frappe.utils import get_datetime

	try:
		age = (now_datetime() - get_datetime(snapshot)).total_seconds()
	except (TypeError, ValueError, OverflowError):
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
		if not separator or len(database) > MAX_ENTRY_BYTES or not _fresh(snapshot.decode("utf-8")):
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
		if data_generation() != generation:
			return False
		if (
			_permission_signature(frappe.session.user) != permission
			or _configuration_signature() != configuration
		):
			return False
		projection.db.close()
		staging.replace(Path(projection.temp.name) / "projection.sqlite")
		projection.db = sqlite3.connect(Path(projection.temp.name) / "projection.sqlite")
		projection.db.execute("pragma cache_size = -4096")
		projection.column_names = metadata["column_names"]
		projection.main_table = metadata["main_table"]
		projection.summary_table = metadata["summary_table"]
		projection.sums = tuple(metadata["sums"])
		projection.context.snapshot = snapshot.decode("utf-8")
		return True
	except (redis.exceptions.RedisError, OSError, ValueError, TypeError, sqlite3.Error):
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
		if page_count * page_size > MAX_ENTRY_BYTES:
			return
		backup_path = Path(projection.temp.name) / "projection.cache"
		with sqlite3.connect(backup_path) as backup:
			projection.db.backup(backup)
		if backup_path.stat().st_size > MAX_ENTRY_BYTES:
			return
		database = backup_path.read_bytes()
		if not _fresh(projection.context.snapshot):
			return
		if data_generation() != generation:
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
		entry = projection.context.snapshot.encode("utf-8") + b"\n" + database
		if len(entry) > MAX_ENTRY_BYTES:
			return
		raw.set(
			_redis_key(raw, key),
			entry,
			ex=max(1, int(CACHE_TTL - age)),
		)
	except (redis.exceptions.RedisError, OSError, ValueError, TypeError, sqlite3.Error):
		return
