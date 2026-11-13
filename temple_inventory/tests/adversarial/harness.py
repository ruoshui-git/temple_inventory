"""HTTP and direct-database helpers for the live concurrency audit."""

import concurrent.futures
import datetime
import hashlib
import http.cookiejar
import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from contextlib import contextmanager
from pathlib import Path

SITE = "audit.localhost"
MANIFEST = Path("/tmp/codex-runs/audit-races.json")
ROLE_USERS = {
	"Inventory Viewer": "audit-viewer@example.com",
	"Inventory Operator": "audit-operator@example.com",
	"Inventory Manager": "audit-manager@example.com",
	"Inventory Administrator": "audit-administrator@example.com",
	"Operator A": "audit-operator-a@example.com",
	"Operator B": "audit-operator-b@example.com",
}
AUDIT_EVENT_METHODS = {
	"temple_inventory.notifications.deliver_document_event",
	"frappe.model.delete_doc.delete_dynamic_links",
}
JOB_QUEUES_FOR_CLEANUP = {"default", "short"}


class HarnessError(RuntimeError):
	"""The scenario request could not be exercised with a valid harness setup."""


def _frappe(site):
	import frappe

	if site != SITE:
		raise ValueError(f"Refusing site {site!r}; only {SITE!r} is allowed")
	current_site = getattr(frappe.local, "site", None)
	if current_site and current_site != site:
		raise ValueError(f"Refusing current Frappe site {current_site!r}; only {SITE!r} is allowed")
	if not current_site:
		frappe.init(site=site)
		frappe.connect()
	elif not getattr(frappe.local, "db", None):
		frappe.connect()
	return frappe


@contextmanager
def db_connection(site=SITE):
	"""Open a separate Frappe connection for a check and always close it."""
	import frappe

	if site != SITE:
		raise ValueError(f"Refusing site {site!r}; only {SITE!r} is allowed")
	current_site = getattr(frappe.local, "site", None)
	if current_site and current_site != site:
		raise ValueError(f"Refusing current Frappe site {current_site!r}; only {SITE!r} is allowed")
	frappe.init(site=site)
	frappe.connect()
	try:
		yield frappe
	except BaseException:
		frappe.db.rollback()
		raise
	else:
		frappe.db.commit()
	finally:
		frappe.destroy()


class Session:
	def __init__(self, base, username, password, site=SITE):
		if site != SITE:
			raise ValueError(f"Refusing site {site!r}; only {SITE!r} is allowed")
		self.base = base.rstrip("/")
		self.username = username
		self.race_context = None
		self.jar = http.cookiejar.CookieJar()
		self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
		self.headers = {
			"X-Frappe-Site-Name": site,
			"Host": site,
		}
		login = urllib.parse.urlencode({"usr": username, "pwd": password}).encode()
		self.login_response = self._request("/api/method/login", login, form=True)
		self.info_response = self.call("session.info", method_http="GET")
		info = (self.info_response.get("body") or {}).get("message") or {}
		self.csrf = info.get("csrf_token", "") if isinstance(info, dict) else ""
		self.headers["X-Frappe-CSRF-Token"] = self.csrf
		self.headers["X-Inventory-Account"] = username
		self.authenticated = bool(
			self.info_response.get("status") == 200 and info.get("user") == username and self.csrf
		)

	def _request(self, path, data=None, *, form=False, method=None):
		url = self.base + path
		body = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else None
		headers = dict(self.headers)
		if form:
			headers["Content-Type"] = "application/x-www-form-urlencoded"
		elif body is not None:
			headers["Content-Type"] = "application/json"
		request = urllib.request.Request(url, data=body, headers=headers, method=method)
		started = time.monotonic()
		started_at = datetime.datetime.now(datetime.UTC).isoformat()
		try:
			with self.opener.open(request, timeout=120) as response:
				status, raw = response.status, response.read().decode("utf-8", "replace")
		except urllib.error.HTTPError as error:
			status, raw = error.code, error.read().decode("utf-8", "replace")
		except Exception as error:  # Keep transport failures in the same evidence stream.
			return {
				"status": 0,
				"exc_type": type(error).__name__,
				"message": str(error),
				"elapsed": time.monotonic() - started,
				"started_at": started_at,
				"completed_at": datetime.datetime.now(datetime.UTC).isoformat(),
			}
		try:
			payload = json.loads(raw)
		except ValueError:
			payload = {"raw": raw}
		return {
			"status": status,
			"exc_type": payload.get("exc_type"),
			"message": payload.get("_server_messages") or payload.get("exception") or payload.get("message"),
			"body": payload,
			"elapsed": time.monotonic() - started,
			"started_at": started_at,
			"completed_at": datetime.datetime.now(datetime.UTC).isoformat(),
		}

	def call(self, method, data=None, *, method_http="POST"):
		query = urllib.parse.urlencode(data or {}) if method_http == "GET" else ""
		path = f"/api/method/temple_inventory.{method}"
		if query:
			path += "?" + query
		result = self._request(path, None if method_http == "GET" else data, method=method_http)
		result["rpc"] = method
		if self.race_context:
			result.update(self.race_context)
		return result


def _queue_job(job, site):
	kwargs = getattr(job, "kwargs", {}) or {}
	return kwargs.get("site") == site, kwargs.get("method")


def _compact_http_body(body):
	if not isinstance(body, dict):
		return body
	result = dict(body)
	message = result.get("message")
	if isinstance(message, dict):
		result["message"] = {
			key: message.get(key)
			for key in ("name", "version", "docstatus", "queued", "queue_error", "editable")
			if key in message
		}
		if isinstance(message.get("items"), list):
			result["message"]["items_count"] = len(message["items"])
	return result


def _compact_http_message(message):
	if isinstance(message, dict):
		return _compact_http_body({"message": message})["message"]
	return str(message)[:2000] if message is not None else None


def _background_queue_state(frappe, site):
	from frappe.utils.background_jobs import get_queues
	from rq.job import Job
	from rq.registry import StartedJobRegistry

	queues = get_queues()
	queued, started = [], []
	queue_counts = {}
	for queue in queues:
		queue_counts[queue.name] = queue.count
		for job in queue.jobs:
			belongs, method = _queue_job(job, site)
			if belongs:
				queued.append({"queue": queue.name, "id": job.id, "method": method})
		registry = StartedJobRegistry(queue=queue, connection=queue.connection)
		for job_id in registry.get_job_ids():
			try:
				job = Job.fetch(job_id, connection=queue.connection)
			except Exception:
				continue
			belongs, method = _queue_job(job, site)
			if belongs:
				started.append({"queue": queue.name, "id": job.id, "method": method})
	return {
		"total_queued": sum(queue_counts.values()),
		"queues": queue_counts,
		"audit_queued": queued,
		"audit_started": started,
	}


def _remove_audit_event_jobs(frappe, site):
	from frappe.utils.background_jobs import get_queues

	removed, errors = [], []
	for queue in get_queues():
		queue_type = queue.name.rsplit(":", 1)[-1]
		if queue_type not in JOB_QUEUES_FOR_CLEANUP:
			continue
		for job in list(queue.jobs):
			belongs, method = _queue_job(job, site)
			if not belongs or method not in AUDIT_EVENT_METHODS:
				continue
			try:
				queue.remove(job)
				job.delete()
				removed.append({"queue": queue.name, "id": job.id, "method": method})
			except Exception as error:
				errors.append({"queue": queue.name, "id": job.id, "method": method, "error": str(error)})
	return {"removed": removed, "errors": errors}


def _import_job_observation(frappe, import_name, attempt):
	from frappe.utils.background_jobs import get_redis_conn
	from rq.job import Job

	job_id = f"ti-import:{import_name}:{attempt}"
	try:
		job = Job.fetch(job_id, connection=get_redis_conn())
	except Exception:
		return {"job_id": job_id, "exists": False, "status": None}
	return {
		"job_id": job_id,
		"exists": True,
		"status": str(job.get_status(refresh=True)),
		"queue": job.origin,
		"kwargs": job.kwargs,
	}


class Audit:
	def __init__(self, base, site=SITE, *, evidence=None):
		if site != SITE:
			raise ValueError(f"Refusing site {site!r}; only {SITE!r} is allowed")
		self.base, self.site = base, site
		self.evidence = (
			evidence if evidence is not None else {"site": site, "base": base, "events": [], "findings": []}
		)
		self.sessions = {}
		self.manifest = {}
		self.manifest_lock = threading.Lock()
		self.sequential_mode = False

	def record(self, scenario, iteration, sequence, result, request=None):
		entry = {"scenario": scenario, "iteration": iteration, "sequence": sequence, **result}
		if request is not None:
			entry["request"] = request
		self.evidence["events"].append(entry)
		if request:
			method, data = request.get("method"), request.get("data") or {}
			doctype = data.get("doctype") if method == "native_api.create_document" else None
			if method == "counts.save_count":
				doctype = "Stock Reconciliation"
			if doctype and data.get("request_id") and request.get("account"):
				intent = {
					"doctype": doctype,
					"request_id": str(data["request_id"]),
					"account": request["account"],
				}
				with self.manifest_lock:
					intents = self.manifest.setdefault("create_intents", [])
					if intent not in intents:
						intents.append(intent)
						self._write_manifest()
		if result.get("status", 0) == 0 or result.get("status", 0) >= 400:
			print(
				f"{scenario} {iteration} {sequence}: HTTP {result.get('status')} "
				f"exc_type={result.get('exc_type')} message={result.get('message')}",
				flush=True,
			)
		if result.get("status") == 403:
			body = result.get("body") or {}
			server_message = result.get("message")
			clean_permission = bool(
				result.get("exc_type") == "PermissionError"
				and server_message
				and "Traceback (most recent call last)" not in str(server_message)
				and str(server_message) != "frappe.exceptions.PermissionError"
			)
			self.evidence.setdefault("permission_responses", []).append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"sequence": sequence,
					"status": 403,
					"exc_type": result.get("exc_type"),
					"classification": "clean_permission" if clean_permission else "unclear_permission",
					"full_message": server_message,
					"server_messages": body.get("_server_messages"),
					"exception": body.get("exception"),
				}
			)
		if result.get("status") in (403, 409, 417):
			message_text = str(result.get("message") or "")
			clean_error = result.get("exc_type") and any(
				"\u3400" <= char <= "\u9fff" for char in message_text
			)
			if result.get("status") == 403:
				clean_error = clean_error or any(
					row["scenario"] == scenario
					and row["iteration"] == iteration
					and row["sequence"] == sequence
					and row["classification"] == "clean_permission"
					for row in self.evidence.get("permission_responses", [])
				)
			queued_ack = "enqueued as a background job" in message_text
			if not clean_error and not queued_ack:
				self.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "rejection was not a clean Chinese Frappe error",
						"event": entry,
					}
				)
		elif result.get("status", 0) >= 400:
			message_text = str(result.get("message") or "")
			clean_server_error = result.get("exc_type") and any(
				"\u3400" <= char <= "\u9fff" for char in message_text
			)
			clean_deleted_document = (
				scenario == "R5"
				and result.get("status") == 404
				and result.get("exc_type") == "DoesNotExistError"
			)
			if (result.get("status", 0) < 500 and not clean_deleted_document) or (
				result.get("status", 0) >= 500 and not clean_server_error
			):
				self.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "unexpected HTTP response",
						"event": entry,
					}
				)
		message = self.value(result)
		if isinstance(message, dict) and message.get("name"):
			identity = message.get("identity") or {}
			doctype = identity.get("doctype")
			if doctype in ("Stock Entry", "Stock Reconciliation"):
				document = {"doctype": doctype, "name": message["name"]}
				with self.manifest_lock:
					created = self.manifest.setdefault("created_documents", [])
					if document not in created:
						created.append(document)
						self._write_manifest()
		if result.get("status", 0) == 0:
			self.evidence["findings"].append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"reason": "HTTP transport failure",
					"event": entry,
				}
			)
		if result.get("status", 0) >= 500 and not result.get("exc_type"):
			self.evidence["findings"].append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"reason": "HTTP 500 without exc_type",
					"event": entry,
				}
			)
		if result.get("status", 0) >= 500 and "Traceback (most recent call last)" in json.dumps(
			result.get("body", {}), ensure_ascii=False
		):
			self.evidence["findings"].append(
				{"scenario": scenario, "iteration": iteration, "reason": "HTTP 500 traceback", "event": entry}
			)
		return result

	def fire(self, scenario, iteration, requests, *, delay_first=0, delay_by_label=None):
		"""Run callables with independent HTTP sessions, released by one barrier."""
		if requests and scenario != "R4":
			rotation = (iteration - 1) % len(requests)
			requests = requests[rotation:] + requests[:rotation]
		barrier = threading.Barrier(len(requests))
		prepared = []
		auth_failed = False
		for label, old_session, method, data in requests:
			credentials = next(row for row in self.users().values() if row["email"] == old_session.username)
			new_session = Session(self.base, old_session.username, credentials["password"], self.site)
			self.evidence.setdefault("auth_events", []).append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"sequence": f"auth:{label}",
					"login": new_session.login_response,
					"session_info": new_session.info_response,
				}
			)
			if not new_session.authenticated or any(
				result["status"] == 0 or result["status"] >= 400
				for result in (new_session.login_response, new_session.info_response)
			):
				auth_failed = True
				for endpoint, result in (
					("login", new_session.login_response),
					("session.info", new_session.info_response),
				):
					if result["status"] == 0 or result["status"] >= 400:
						print(
							f"{scenario} {iteration} auth:{label} {endpoint}: HTTP {result['status']} "
							f"exc_type={result.get('exc_type')} message={result.get('message')}",
							flush=True,
						)
				if not new_session.authenticated:
					print(
						f"{scenario} {iteration} auth:{label}: session user mismatch; "
						f"login HTTP {new_session.login_response['status']} "
						f"exc_type={new_session.login_response.get('exc_type')} "
						f"message={new_session.login_response.get('message')}; "
						f"session.info HTTP {new_session.info_response['status']} "
						f"exc_type={new_session.info_response.get('exc_type')} "
						f"message={new_session.info_response.get('message')}",
						flush=True,
					)
				self.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "race session authentication failed",
						"sequence": label,
						"login": new_session.login_response,
						"session_info": new_session.info_response,
					}
				)
			prepared.append(
				(
					label,
					new_session,
					method,
					data,
				)
			)
		if auth_failed:
			raise HarnessError(f"HTTP race authentication failed in {scenario} iteration {iteration}")
		if self.sequential_mode:
			results = []
			for index, (label, session, method, data) in enumerate(prepared):
				session.race_context = {
					"fire_order": index,
					"barrier_released_at": datetime.datetime.now(datetime.UTC).isoformat(),
					"scheduled_delay_seconds": 0,
					"sequential_preflight": True,
				}
				if callable(method):
					result = method(session)
				else:
					result = self.record(
						scenario,
						iteration,
						label,
						session.call(method, data),
						{"method": method, "data": data, "account": session.username},
					)
				if isinstance(result, dict):
					result.setdefault("sequence", label)
				results.append(result)
			return results

		def invoke(index, label, session, method, data, offset):
			barrier.wait(timeout=30)
			released_at = datetime.datetime.now(datetime.UTC).isoformat()
			if offset:
				time.sleep(offset)
			session.race_context = {
				"fire_order": index,
				"barrier_released_at": released_at,
				"scheduled_delay_seconds": offset,
			}
			if callable(method):
				result = method(session)
			else:
				result = session.call(method, data)
				self.record(
					scenario,
					iteration,
					label,
					result,
					{"method": method, "data": data, "account": session.username},
				)
			if isinstance(result, dict):
				result.setdefault("sequence", label)
			return result

		with concurrent.futures.ThreadPoolExecutor(max_workers=len(requests)) as pool:
			futures = [
				pool.submit(
					invoke,
					i,
					label,
					session,
					method,
					data,
					(delay_by_label or {}).get(label, delay_first if i == 0 else 0),
				)
				for i, (label, session, method, data) in enumerate(prepared)
			]
			return [future.result() for future in futures]

	def rpc(self, session, scenario, iteration, label, method, data, *, expected=False, compact=False):
		result = self.record(
			scenario,
			iteration,
			label,
			session.call(method, data),
			{"method": method, "data": data, "account": session.username},
		)
		if compact:
			entry = self.evidence["events"][-1]
			entry["body"] = _compact_http_body(entry.get("body"))
			entry["message"] = _compact_http_message(entry.get("message"))
		if (result.get("status", 0) == 0 or result.get("status", 0) >= 400) and not expected:
			self.evidence["findings"].append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"reason": "unexpected HTTP response",
					"event": self.evidence["events"][-1],
				}
			)
		elif result.get("status", 0) == 0 or result.get("status", 0) >= 400:
			message = str(result.get("message") or "")
			clean_rejection = (
				result.get("status") in (403, 409, 417)
				and result.get("exc_type")
				and any("\u3400" <= char <= "\u9fff" for char in message)
			)
			if result.get("status") == 403:
				clean_rejection = clean_rejection or any(
					row["scenario"] == scenario
					and row["iteration"] == iteration
					and row["sequence"] == label
					and row["classification"] == "clean_permission"
					for row in self.evidence.get("permission_responses", [])
				)
			if (
				scenario == "R5"
				and result.get("status") == 404
				and result.get("exc_type") == "DoesNotExistError"
			):
				clean_rejection = True
			if not clean_rejection:
				self.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "unexpected HTTP response",
						"event": self.evidence["events"][-1],
					}
				)
		return result

	def value(self, response):
		return (response.get("body") or {}).get("message")

	def users(self):
		return self.manifest.get("users", {})

	def session(self, key="Operator A"):
		if key not in self.sessions:
			row = self.users()[key]
			self.sessions[key] = Session(self.base, row["email"], row["password"], self.site)
		return self.sessions[key]

	def _verify_http_site(self, frappe, manifest):
		"""Verify the HTTP listener serves the audit site before inventory setup writes."""

		def login_matches(label, expected_marker):
			credentials = manifest.get("users", {}).get(label) or {}
			email = credentials.get("email") or ROLE_USERS[label]
			if not frappe.db.exists("User", email):
				return None
			expected_marker = expected_marker or frappe.db.get_value("User", email, "full_name")
			if not expected_marker or not str(expected_marker).startswith("AUDIT"):
				return None
			session = Session(self.base, email, credentials.get("password", ""), self.site)
			body = session.login_response.get("body") or {}
			observed_marker = body.get("full_name")
			if isinstance(body.get("message"), dict):
				observed_marker = observed_marker or body["message"].get("full_name")
			info = (session.info_response.get("body") or {}).get("message") or {}
			matched = (
				session.login_response.get("status") == 200
				and session.info_response.get("status") == 200
				and info.get("user") == email
				and observed_marker == expected_marker
			)
			for endpoint, response in (
				("login", session.login_response),
				("session.info", session.info_response),
			):
				if response.get("status", 0) >= 400:
					print(
						f"SITE GUARD {email} {endpoint}: HTTP {response.get('status')} "
						f"exc_type={response.get('exc_type')} message={response.get('message')}",
						flush=True,
					)
			self.evidence.setdefault("server_identity", []).append(
				{
					"site": self.site,
					"user": email,
					"expected_marker": expected_marker,
					"observed_marker": observed_marker,
					"login_status": session.login_response.get("status"),
					"login_exc_type": session.login_response.get("exc_type"),
					"session_status": session.info_response.get("status"),
					"session_exc_type": session.info_response.get("exc_type"),
					"matched": matched,
				}
			)
			return (label, session) if matched else None

		for label in (
			"Inventory Viewer",
			"Inventory Manager",
			"Inventory Operator",
			"Operator A",
			"Operator B",
		):
			if manifest.get("users", {}).get(label, {}).get("password"):
				match = login_matches(label, None)
				if match:
					self.sessions[label] = match[1]
					return

		# A stale or absent manifest gets a one-user marker/password bootstrap on this direct site DB.
		label = "Operator A"
		email = ROLE_USERS[label]
		if not frappe.db.exists("User", email):
			# A freshly created audit site has no harness users yet; create the probe user so the
			# HTTP identity check can run before setup creates the rest.
			from temple_inventory import roles

			roles.ensure_roles()
			frappe.get_doc(
				{
					"doctype": "User",
					"email": email,
					"first_name": f"AUDIT {label}",
					"enabled": 1,
					"user_type": "System User",
					"role_profile_name": roles.ROLE_PROFILES[roles.OPERATOR],
					"send_welcome_email": 0,
				}
			).insert(ignore_permissions=True)
			frappe.db.commit()
		doc = frappe.get_doc("User", email)
		old_first_name = doc.first_name
		marker = f"AUDIT HTTP Probe {uuid.uuid4().hex}"
		password = uuid.uuid4().hex + "Aa9X"
		try:
			doc.first_name = marker
			doc.save(ignore_permissions=True)
			from frappe.utils.password import update_password

			update_password(email, password)
			frappe.db.commit()
			manifest.setdefault("users", {})[label] = {"email": email, "password": password}
			self.manifest = manifest
			self._write_manifest()
			if not login_matches(label, marker):
				last = self.evidence["server_identity"][-1]
				raise RuntimeError(
					"HTTP site verification failed "
					f"(login HTTP {last['login_status']} exc_type={last['login_exc_type']}; "
					f"session HTTP {last['session_status']} exc_type={last['session_exc_type']}; "
					f"marker={last['observed_marker']!r})"
				)
		finally:
			# The HTTP login updated this User row after our snapshot began; start a fresh
			# transaction so the restore does not fail with 1020.
			frappe.db.rollback()
			restore = frappe.get_doc("User", email)
			restore.first_name = old_first_name
			restore.save(ignore_permissions=True)
			frappe.db.commit()

	def setup(self):
		frappe = _frappe(self.site)
		from temple_inventory import activities, roles, warehouses

		frappe.set_user("Administrator")
		manifest = self._read_manifest()
		if manifest.get("site") != self.site:
			manifest = {}
		elif manifest.get("AUDIT-AREA") and not frappe.db.exists("Warehouse", manifest["AUDIT-AREA"]):
			# The audit site was recreated since this manifest was written; its fixtures are gone.
			manifest = {}
		self.manifest = manifest
		self._verify_http_site(frappe, manifest)
		if not frappe.db.get_single_value("Stock Settings", "enable_serial_and_batch_no_for_item"):
			raise RuntimeError(
				"Batch and serial scenarios require Stock Settings.enable_serial_and_batch_no_for_item=1"
			)
		roles.ensure_roles()
		activities.seed_activity_types()
		company = (
			frappe.db.get_single_value("Temple Inventory Settings", "company")
			or frappe.get_all("Company", pluck="name", limit=1)[0]
		)
		manifest.update({"site": self.site, "company": company, "users": manifest.get("users", {})})
		for label, email in ROLE_USERS.items():
			manifest["users"][label] = {"email": email, "password": uuid.uuid4().hex + "Aa9X"}
		self.manifest = manifest
		self._write_manifest()
		from frappe.utils.password import check_password, update_password

		for label, email in ROLE_USERS.items():
			profile = roles.ROLE_PROFILES.get(label, roles.ROLE_PROFILES[roles.OPERATOR])
			if not frappe.db.exists("User", email):
				user = frappe.get_doc(
					{
						"doctype": "User",
						"email": email,
						"first_name": f"AUDIT {label}",
						"enabled": 1,
						"user_type": "System User",
						"role_profile_name": profile,
						"send_welcome_email": 0,
					}
				)
				user.insert(ignore_permissions=True)
			else:
				user = frappe.get_doc("User", email)
				if user.role_profile_name != profile:
					user.role_profile_name = profile
					user.save(ignore_permissions=True)
			update_password(email, manifest["users"][label]["password"])
			if (
				check_password(email, manifest["users"][label]["password"], delete_tracker_cache=False)
				!= email
			):
				raise RuntimeError(f"Password self-check failed for {email}")
			frappe.set_user("Administrator")
		# Make credentials visible to the independently running HTTP process before setup calls.
		frappe.db.commit()
		physical = frappe.db.get_single_value("Temple Inventory Settings", "physical_root_warehouse")
		if not all(k in manifest for k in ("AUDIT-AREA", "AUDIT-ROOM", "AUDIT-SHELF")):
			area_label = f"AUDIT Area {uuid.uuid4().hex[:8]}"
			area_tree = warehouses.create_location("Area", area_label, physical)
			area_name = next(row["name"] for row in area_tree["rows"] if row.get("local_label") == area_label)
			room_label = f"AUDIT Room {uuid.uuid4().hex[:8]}"
			room_tree = warehouses.create_location("Room", room_label, area_name)
			room = next(
				row
				for row in room_tree["rows"]
				if row.get("local_label") == room_label and not row.get("direct")
			)
			shelf_label = f"AUDIT Shelf {uuid.uuid4().hex[:8]}"
			shelf_tree = warehouses.create_location("Shelf", shelf_label, room["name"])
			shelf = next(
				row
				for row in shelf_tree["rows"]
				if row.get("local_label") == shelf_label and not row.get("direct")
			)
			leaf = next(
				row["name"]
				for row in shelf_tree["rows"]
				if row.get("direct") and row.get("parent") == shelf["name"]
			)
			manifest.update(
				{
					"AUDIT-AREA": area_name,
					"AUDIT-ROOM": room["name"],
					"AUDIT-SHELF": shelf["name"],
					"AUDIT-LEAF": leaf,
				}
			)
			manifest["AUDIT-WAREHOUSES"] = list(
				dict.fromkeys(
					row["name"]
					for tree in (area_tree, room_tree, shelf_tree)
					for row in tree["rows"]
					if row.get("local_label") in {area_label, room_label, shelf_label}
				)
			)
		if manifest.get("AUDIT-SHELF"):
			direct_leaf = frappe.db.get_value(
				"Warehouse",
				{"parent_warehouse": manifest["AUDIT-SHELF"], "ti_direct_storage": 1},
				"name",
			)
			if direct_leaf:
				manifest["AUDIT-LEAF"] = direct_leaf
			else:
				shelf_is_group = frappe.db.get_value("Warehouse", manifest["AUDIT-SHELF"], "is_group")
				if shelf_is_group:
					raise RuntimeError(f"AUDIT Shelf group has no direct leaf: {manifest['AUDIT-SHELF']}")
				manifest["AUDIT-LEAF"] = manifest["AUDIT-SHELF"]
		if "AUDIT-OTHER-AREA" not in manifest:
			other_label = f"AUDIT Alternate Area {uuid.uuid4().hex[:8]}"
			other_tree = warehouses.create_location("Area", other_label, physical)
			other_area = next(
				row["name"] for row in other_tree["rows"] if row.get("local_label") == other_label
			)
			manifest["AUDIT-OTHER-AREA"] = other_area
			other_room_label = f"AUDIT Alternate Room {uuid.uuid4().hex[:8]}"
			other_room_tree = warehouses.create_location("Room", other_room_label, other_area)
			manifest["AUDIT-OTHER-LEAF"] = next(
				row["name"]
				for row in other_room_tree["rows"]
				if row.get("direct") and row.get("local_label") == other_room_label
			)
			manifest.setdefault("AUDIT-WAREHOUSES", []).extend(
				row["name"]
				for row in (*other_tree["rows"], *other_room_tree["rows"])
				if row.get("local_label") in {other_label, other_room_label}
			)
		leaf = manifest["AUDIT-LEAF"]
		owned_warehouses = set(manifest.get("AUDIT-WAREHOUSES", []))
		leaves_by_root = {}
		nodes_by_root = {}
		for root in (manifest["AUDIT-AREA"], manifest["AUDIT-OTHER-AREA"]):
			bounds = frappe.db.get_value("Warehouse", root, ["lft", "rgt"], as_dict=True)
			if bounds:
				nodes_by_root[root] = {
					row.name
					for row in frappe.get_all(
						"Warehouse",
						filters={
							"company": company,
							"lft": [">=", bounds.lft],
							"rgt": ["<=", bounds.rgt],
						},
						fields=["name"],
					)
				}
				leaf_rows = frappe.get_all(
					"Warehouse",
					filters={
						"company": company,
						"lft": [">=", bounds.lft],
						"rgt": ["<=", bounds.rgt],
						"is_group": 0,
						"disabled": 0,
					},
					fields=["name", "ti_direct_storage"],
				)
				leaves_by_root[root] = {row.name for row in leaf_rows}
				owned_warehouses.update(
					frappe.get_all(
						"Warehouse",
						filters={
							"company": company,
							"lft": [">=", bounds.lft],
							"rgt": ["<=", bounds.rgt],
						},
						pluck="name",
					)
				)
		manifest["AUDIT-WAREHOUSES"] = sorted(owned_warehouses)
		from temple_inventory.native_topology import _allow_warehouses

		_allow_warehouses(
			frappe.get_single("Temple Inventory Settings"),
			leaves_by_root.get(manifest["AUDIT-AREA"], set())
			| leaves_by_root.get(manifest["AUDIT-OTHER-AREA"], set()),
		)
		shared_nodes = {
			frappe.db.get_single_value("Temple Inventory Settings", "root_warehouse"),
			frappe.db.get_single_value("Temple Inventory Settings", "physical_root_warehouse"),
			frappe.db.get_single_value("Temple Inventory Settings", "leased_warehouse"),
			frappe.db.get_single_value("Temple Inventory Settings", "damaged_warehouse"),
		}
		shared_nodes.discard(None)
		for label in ("Inventory Manager", "Operator A", "Operator B"):
			email = manifest["users"][label]["email"]
			permitted_nodes = shared_nodes | nodes_by_root.get(manifest["AUDIT-AREA"], set())
			if label == "Operator A":
				permitted_nodes |= nodes_by_root.get(manifest["AUDIT-OTHER-AREA"], set())
			for warehouse in permitted_nodes:
				if not frappe.db.exists(
					"User Permission", {"user": email, "allow": "Warehouse", "for_value": warehouse}
				):
					frappe.get_doc(
						{
							"doctype": "User Permission",
							"user": email,
							"allow": "Warehouse",
							"for_value": warehouse,
							"apply_to_all_doctypes": 1,
							"hide_descendants": 1,
						}
					).insert(ignore_permissions=True)
		items = manifest.setdefault("items", {})
		manifest["tracked_item_names"] = list(
			set(manifest.get("tracked_item_names", [])) | {"AUDIT-BATCH", "AUDIT-SERIAL"}
		)
		for tracking, code in (
			("plain", "AUDIT-PLAIN"),
			("batch", "AUDIT-BATCH"),
			("serial", "AUDIT-SERIAL"),
		):
			if not frappe.db.exists("Item", code):
				item = frappe.get_doc(
					{
						"doctype": "Item",
						"item_code": code,
						"item_name": code,
						"item_group": "All Item Groups",
						"stock_uom": "Nos",
						"is_stock_item": 1,
						"has_batch_no": int(tracking == "batch"),
						"has_serial_no": int(tracking == "serial"),
						"create_new_batch": 0,
					}
				)
				item.insert(ignore_permissions=True)
			items[tracking] = code
		activity_title = "AUDIT Activity"
		activity = frappe.db.get_value("Inventory Activity", {"title": activity_title}, "name")
		if not activity:
			activity = activities.save_activity(
				{"title": activity_title, "activity_type": "TI-TYPE-OTHER"}
			).name
		manifest.update({"activity_title": activity_title, "activity": activity})
		frappe.db.commit()
		self.manifest = manifest
		self._write_manifest()
		self.sessions.clear()
		self._login_all()
		if not manifest.get("opening_seeded"):
			seed = self.create(
				"SETUP",
				0,
				self.movement(items["plain"], 100, "Receive", target=leaf),
				user="Operator A",
				request_id="audit-opening-plain-v1",
			)
			if self.value(seed) and seed["status"] < 400:
				opened = self.submit(
					"SETUP", 0, self.value(seed)["name"], self.value(seed)["version"], user="Operator A"
				)
				if opened["status"] < 400:
					manifest["opening_seeded"] = True
					manifest.setdefault("documents", []).append(self.value(opened).get("name"))
				else:
					self.evidence.setdefault("setup_failures", []).append(
						{"label": "plain_opening_submit", "response": opened}
					)
			else:
				self.evidence.setdefault("setup_failures", []).append(
					{"label": "plain_opening_create", "response": seed}
				)
			self.manifest = manifest
			self._write_manifest()
		if not manifest.get("tracked_opening_seeded"):
			batch_result = self.rpc(
				self.session("Operator A"),
				"SETUP",
				0,
				"receipt_batch",
				"catalog.receipt_batches",
				{
					"rows": [
						{
							"item_code": items["batch"],
							"local_id": "audit-opening",
							"batch_id": "AUDIT-BATCH-OPENING",
						}
					]
				},
			)
			batch_rows = (self.value(batch_result) or {}).get("batches", [])
			if batch_rows:
				manifest["batch_no"] = batch_rows[0]["name"]
				manifest.setdefault("batch_names", []).append(manifest["batch_no"])
				data = self.movement(items["batch"], 20, "Receive", target=leaf)
				data["items"][0]["batch_no"] = manifest["batch_no"]
				data["items"][0]["use_serial_batch_fields"] = 1
				batch_seeded = self._seed_receive(data, "batch_opening")
			else:
				batch_seeded = False
			serials = [f"AUDIT-SERIAL-{number:05d}" for number in range(1, 6)]
			manifest["serials"] = serials
			manifest.setdefault("serial_names", []).extend(serials)
			data = self.movement(items["serial"], len(serials), "Receive", target=leaf)
			data["items"][0]["serial_no"] = "\n".join(serials)
			data["items"][0]["use_serial_batch_fields"] = 1
			serial_seeded = self._seed_receive(data, "serial_opening")
			manifest["tracked_opening_seeded"] = batch_seeded and serial_seeded
			self.manifest = manifest
			self._write_manifest()
		frappe.destroy()
		return manifest

	def _seed_receive(self, data, label):
		draft = self.create("SETUP", 0, data, user="Operator A", request_id=f"audit-opening-{label}-v1")
		if self.value(draft) and draft["status"] < 400:
			result = self.submit(
				"SETUP", 0, self.value(draft)["name"], self.value(draft)["version"], user="Operator A"
			)
			if result["status"] >= 400:
				self.evidence.setdefault("setup_failures", []).append({"label": label, "response": result})
				return False
			return True
		else:
			self.evidence.setdefault("setup_failures", []).append({"label": label, "response": draft})
			return False

	def _login_all(self):
		failed = []
		for label in self.users():
			try:
				session = self.session(label)
				self.evidence.setdefault("auth_events", []).append(
					{"user": label, "login": session.login_response, "session_info": session.info_response}
				)
				if not session.authenticated or any(
					result["status"] == 0 or result["status"] >= 400
					for result in (session.login_response, session.info_response)
				):
					for endpoint, result in (
						("login", session.login_response),
						("session.info", session.info_response),
					):
						if result["status"] == 0 or result["status"] >= 400:
							print(
								f"SETUP {label} {endpoint}: HTTP {result['status']} "
								f"exc_type={result.get('exc_type')} message={result.get('message')}",
								flush=True,
							)
					if not session.authenticated:
						print(
							f"SETUP {label}: session user mismatch; "
							f"login HTTP {session.login_response['status']} "
							f"exc_type={session.login_response.get('exc_type')} "
							f"message={session.login_response.get('message')}; "
							f"session.info HTTP {session.info_response['status']} "
							f"exc_type={session.info_response.get('exc_type')} "
							f"message={session.info_response.get('message')}",
							flush=True,
						)
					self.evidence.setdefault("findings", []).append(
						{
							"reason": f"authentication failed for {label}",
							"login": session.login_response,
							"session_info": session.info_response,
						}
					)
					failed.append(label)
			except Exception as error:
				self.evidence["findings"].append(
					{"reason": f"login failed for {label}", "message": str(error)}
				)
				failed.append(label)
		if failed:
			raise RuntimeError(f"HTTP login failed for: {', '.join(failed)}")

	def _read_manifest(self):
		try:
			return json.loads(MANIFEST.read_text())
		except (OSError, ValueError):
			return {}

	def _write_manifest(self):
		MANIFEST.parent.mkdir(parents=True, exist_ok=True)
		MANIFEST.write_text(json.dumps(self.manifest, indent=2, ensure_ascii=False))

	def direct(self, function):
		with db_connection(self.site) as frappe:
			return function(frappe)

	def queue_hygiene(self):
		"""Remove only audit.localhost notification/link-cleanup jobs from default and short."""
		result = self.direct(lambda frappe: _remove_audit_event_jobs(frappe, self.site))
		if result["errors"]:
			raise HarnessError(f"queue hygiene could not remove audit jobs: {result['errors']}")
		self.evidence.setdefault("queue_hygiene", []).append(result)
		return result

	def background_queue_state(self):
		return self.direct(lambda frappe: _background_queue_state(frappe, self.site))

	def wait_for_background_idle(self, label, *, timeout=600, max_total=350):
		"""Wait for this site's queued or started jobs without disturbing other tenants."""
		started = time.monotonic()
		while True:
			state = self.direct(lambda frappe: _background_queue_state(frappe, self.site))
			if state["total_queued"] > max_total:
				raise HarnessError(
					f"{label}: all-site queue length {state['total_queued']} exceeds {max_total}; "
					f"queues={state['queues']}"
				)
			if not state["audit_queued"] and not state["audit_started"]:
				self.evidence.setdefault("queue_waits", []).append(
					{"label": label, "elapsed_seconds": round(time.monotonic() - started, 3), **state}
				)
				return state
			if time.monotonic() - started >= timeout:
				raise HarnessError(
					f"{label}: audit background jobs did not drain within {timeout}s; "
					f"queued={state['audit_queued']} started={state['audit_started']} "
					f"queues={state['queues']}"
				)
			time.sleep(1)

	def import_job_observation(self, import_name, attempt):
		return self.direct(lambda frappe: _import_job_observation(frappe, import_name, attempt))

	def state(self, doctype, name):
		return self.direct(
			lambda frappe: frappe.db.get_value(
				doctype, name, ["name", "modified", "docstatus", "remarks"], as_dict=True
			)
		)

	def movement(self, item, qty, kind, *, warehouse=None, target=None, when=None, **extra):
		stamp = when or time.strftime("%Y-%m-%d")
		posting_time = extra.pop("posting_time", "12:00:00")
		line = {
			"item_code": item,
			"qty": qty,
			"uom": "Nos",
			"conversion_factor": 1,
			"s_warehouse": None if kind == "Receive" else warehouse,
			"t_warehouse": target or (warehouse if kind == "Receive" else None),
			"basic_rate": 10,
		}
		borrower = extra.pop("ti_borrower", None)
		activity = extra.pop("ti_activity", None)
		data = {
			"company": self.manifest["company"],
			"posting_date": stamp,
			"posting_time": posting_time,
			"ti_time_mode": "Manual",
			"ti_movement_kind": kind,
			"ti_source_text": "AUDIT",
			"ti_purpose_text": "AUDIT",
			"items": [line],
			**extra,
		}
		if borrower:
			data["ti_borrower"] = borrower
		if activity or kind in ("Loan", "Return", "Damage", "Loss"):
			data["ti_activity"] = activity or self.manifest.get("activity")
		return data

	def create(self, scenario, iteration, data, *, user="Operator A", request_id=None):
		return self.rpc(
			self.session(user),
			scenario,
			iteration,
			"create_document",
			"native_api.create_document",
			{"doctype": "Stock Entry", "request_id": request_id or str(uuid.uuid4()), "data": data},
		)

	def submit(
		self,
		scenario,
		iteration,
		name,
		version,
		*,
		user="Operator A",
		doctype="Stock Entry",
		expected=False,
	):
		return self.rpc(
			self.session(user),
			scenario,
			iteration,
			"submit_document",
			"native_api.submit_document",
			{"doctype": doctype, "name": name, "version": str(version)},
			expected=expected,
		)

	def stock_state(self, item):
		return self.stock_states([item])

	def stock_states(self, items):
		items = sorted(set(items))
		if not items:
			return []
		placeholders = ",".join("%s" for _ in items)
		return self.direct(
			lambda frappe: frappe.db.sql(
				"""select stock_pairs.item_code, stock_pairs.warehouse, coalesce(stock_bin.actual_qty, 0) as actual_qty,
				coalesce(latest.qty_after_transaction, 0) as qty_after_transaction
				from (select item_code, warehouse from `tabBin` where item_code in ("""
				+ placeholders
				+ ") union select item_code, warehouse from `tabStock Ledger Entry` where item_code in ("
				+ placeholders
				+ ") and is_cancelled=0) stock_pairs "
				"left join `tabBin` stock_bin on stock_bin.item_code=stock_pairs.item_code "
				"and stock_bin.warehouse=stock_pairs.warehouse "
				"left join `tabStock Ledger Entry` latest on latest.item_code=stock_pairs.item_code "
				"and latest.warehouse=stock_pairs.warehouse and latest.is_cancelled=0 "
				"and latest.name=(select s2.name from `tabStock Ledger Entry` s2 "
				"where s2.item_code=stock_pairs.item_code and s2.warehouse=stock_pairs.warehouse and s2.is_cancelled=0 "
				"order by s2.posting_datetime desc,s2.creation desc limit 1) "
				"where stock_pairs.warehouse in (select name from `tabWarehouse` "
				"where warehouse_name like 'AUDIT%%' or ti_label like 'AUDIT%%') "
				"order by stock_pairs.item_code,stock_pairs.warehouse",
				(*items, *items),
				as_dict=True,
			)
		)

	def balance_for(self, item, warehouse):
		return self.direct(
			lambda frappe: float(
				frappe.db.get_value("Bin", {"item_code": item, "warehouse": warehouse}, "actual_qty") or 0
			)
		)

	def bundle_state(self, item):
		return self.direct(
			lambda frappe: frappe.db.sql(
				"""select ledger.warehouse, ledger.ledger_qty, bundles.bundle_qty
				from (select warehouse, sum(actual_qty) as ledger_qty from `tabStock Ledger Entry`
					where item_code=%s and is_cancelled=0 and warehouse in
					(select name from `tabWarehouse` where warehouse_name like 'AUDIT%%' or ti_label like 'AUDIT%%')
					group by warehouse) ledger
				inner join (select bundle.warehouse, sum(entry.qty) as bundle_qty
					from `tabSerial and Batch Bundle` bundle
					inner join `tabSerial and Batch Entry` entry on entry.parent=bundle.name
					where bundle.item_code=%s and bundle.warehouse in
					(select name from `tabWarehouse` where warehouse_name like 'AUDIT%%' or ti_label like 'AUDIT%%')
					and bundle.name in (select distinct serial_and_batch_bundle from `tabStock Ledger Entry`
						where item_code=%s and is_cancelled=0 and serial_and_batch_bundle is not null)
					group by bundle.warehouse) bundles on bundles.warehouse=ledger.warehouse
				order by ledger.warehouse""",
				(item, item, item),
				as_dict=True,
			)
		)

	def running_state(self, items):
		items = sorted(set(items))
		if not items:
			return []
		placeholders = ",".join("%s" for _ in items)
		query = (
			"select item_code, warehouse, posting_datetime, creation, voucher_type, "
			"previous_qty_after, actual_qty, qty_after_transaction from ("
			"select item_code, warehouse, posting_datetime, creation, voucher_type, actual_qty, qty_after_transaction, "
			"lag(qty_after_transaction) over (partition by item_code, warehouse "
			"order by posting_datetime asc, creation asc) as previous_qty_after "
			"from `tabStock Ledger Entry` where is_cancelled=0 and item_code in ("
			+ placeholders
			+ ")) as ledger where voucher_type != 'Stock Reconciliation' "
			"and abs(qty_after_transaction - coalesce(previous_qty_after, 0) - actual_qty) > 0.000001 "
			"and warehouse in (select name from `tabWarehouse` "
			"where warehouse_name like 'AUDIT%%' or ti_label like 'AUDIT%%') "
			"order by item_code, warehouse, posting_datetime, creation"
		)
		return self.direct(lambda frappe: frappe.db.sql(query, tuple(items), as_dict=True))

	def check_global(self, scenario, iteration):
		items = set(self.manifest.get("items", {}).values()) | set(self.manifest.get("r8_items", []))
		rows = self.stock_states(items)
		bad = [
			row
			for row in rows
			if float(row.actual_qty or 0) < 0
			or abs(float(row.actual_qty or 0) - float(row.qty_after_transaction or 0)) > 0.000001
		]
		if bad:
			self.evidence["findings"].append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"reason": "Bin/SLE invariant",
					"sql_rows": [dict(row) for row in bad],
				}
			)
		running_errors = self.running_state(items)
		if running_errors:
			self.evidence["findings"].append(
				{
					"scenario": scenario,
					"iteration": iteration,
					"reason": "SLE running quantity does not reconcile",
					"sql_rows": [dict(row) for row in running_errors],
				}
			)
		for item in set(self.manifest.get("tracked_item_names", [])):
			bundle_rows = self.bundle_state(item)
			mismatch = [
				row
				for row in bundle_rows
				if abs(float(row.ledger_qty or 0) - float(row.bundle_qty or 0)) > 0.000001
			]
			if mismatch:
				self.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "serial/batch bundle totals differ from SLE",
						"item": item,
						"sql_rows": [dict(row) for row in mismatch],
					}
				)
		return rows

	def cleanup(self):
		frappe = _frappe(self.site)
		frappe.set_user("Administrator")
		failures = []
		created = self.manifest.setdefault("created_documents", [])
		for intent in self.manifest.get("create_intents", []):
			key = hashlib.sha256(
				f"{intent['account']}\0{intent['doctype']}\0{intent['request_id']}".encode()
			).hexdigest()
			name = frappe.db.get_value(intent["doctype"], {"ti_request_key": key}, "name")
			document = {"doctype": intent["doctype"], "name": name} if name else None
			if document and document not in created:
				created.append(document)
		self._write_manifest()
		seen_documents = set()
		for row in reversed(created):
			identity = (row.get("doctype"), row.get("name"))
			if identity in seen_documents:
				continue
			seen_documents.add(identity)
			try:
				if not frappe.db.exists(row["doctype"], row["name"]):
					continue
				doc = frappe.get_doc(row["doctype"], row["name"])
				if doc.docstatus == 1:
					doc.cancel()
				elif doc.docstatus == 0:
					doc.delete()
			except Exception as error:
				try:
					state = _background_queue_state(frappe, self.site)
					if (
						row["doctype"] not in ("Stock Entry", "Stock Reconciliation")
						or not frappe.db.exists(row["doctype"], row["name"])
						or frappe.db.get_value(row["doctype"], row["name"], "docstatus") != 0
						or state["audit_queued"]
						or state["audit_started"]
					):
						raise error
					frappe.get_lazy_doc(row["doctype"], row["name"]).unlock()
					frappe.get_doc(row["doctype"], row["name"]).delete()
				except Exception as cleanup_error:
					failures.append(
						{
							"doctype": row["doctype"],
							"name": row["name"],
							"error": str(cleanup_error),
						}
					)

		for name in reversed(self.manifest.get("import_names", [])):
			try:
				if not frappe.db.exists("Inventory Import", name):
					continue
				doc = frappe.get_doc("Inventory Import", name)
				if doc.status in ("Queued", "Running"):
					from temple_inventory.imports import _interrupted, _save

					if not _interrupted(doc):
						failures.append(
							{"doctype": "Inventory Import", "name": name, "error": f"still {doc.status}"}
						)
						continue
					doc.status, doc.error = "Failed", "Audit cleanup of an interrupted import"
					_save(doc)
					frappe.db.commit()
				file_name = doc.source_file
				frappe.delete_doc("Inventory Import", name, ignore_permissions=True, force=True)
				if file_name and frappe.db.exists("File", file_name):
					frappe.delete_doc("File", file_name, ignore_permissions=True, force=True)
			except Exception as error:
				failures.append({"doctype": "Inventory Import", "name": name, "error": str(error)})
		frappe.db.commit()
		self._write_manifest()
		self.evidence["cleanup_failures"] = failures
		warehouse_names = [
			name
			for name in (
				*self.manifest.get("AUDIT-WAREHOUSES", []),
				*(entry.get("room") for entry in self.manifest.get("r9_locations", [])),
				*(entry.get("leaf") for entry in self.manifest.get("r9_locations", [])),
			)
			if name
		]
		item_names = list(self.manifest.get("items", {}).values()) + self.manifest.get("r8_items", [])
		self.evidence["left_in_place"] = {
			"warehouses": sorted(
				set(frappe.get_all("Warehouse", filters={"name": ["in", warehouse_names]}, pluck="name"))
			)
			if warehouse_names
			else [],
			"items": sorted(set(frappe.get_all("Item", filters={"name": ["in", item_names]}, pluck="name")))
			if item_names
			else [],
			"batches": sorted(
				set(
					frappe.get_all(
						"Batch", filters={"name": ["in", self.manifest.get("batch_names", [])]}, pluck="name"
					)
				)
			)
			if self.manifest.get("batch_names")
			else [],
			"serials": sorted(
				set(
					frappe.get_all(
						"Serial No",
						filters={"name": ["in", self.manifest.get("serial_names", [])]},
						pluck="name",
					)
				)
			)
			if self.manifest.get("serial_names")
			else [],
			"users": sorted(
				set(
					frappe.get_all(
						"User",
						filters={"name": ["in", [row["email"] for row in self.users().values()]]},
						pluck="name",
					)
				)
			),
		}
		try:
			removed = _remove_audit_event_jobs(frappe, self.site)
			self.evidence["cleanup_queue_jobs_removed"] = removed
		except Exception as error:
			failures.append({"queue_hygiene": f"{type(error).__name__}: {error}"})
		frappe.db.commit()
		self.evidence["cleanup_failures"] = failures
		return failures
