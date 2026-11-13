"""R1-R10 live race scenarios. Each function returns concise result evidence."""

import hashlib
import json
import time
import uuid
from datetime import datetime, timedelta


def _data(audit, item, qty, kind="Receive", **kwargs):
	warehouse = kwargs.pop("warehouse", audit.manifest["AUDIT-LEAF"])
	return audit.movement(item, qty, kind, warehouse=warehouse, **kwargs)


def _message(audit, response):
	return audit.value(response) or {}


def _name(audit, response):
	return _message(audit, response).get("name") if isinstance(_message(audit, response), dict) else None


def _version(audit, response):
	return _message(audit, response).get("version") if isinstance(_message(audit, response), dict) else None


def _succeeded(response):
	return 0 < response.get("status", 0) < 400


def _plain_message(value):
	if isinstance(value, dict):
		return " ".join(str(part) for part in value.values())
	if isinstance(value, (list, tuple)):
		return " ".join(_plain_message(part) for part in value)
	if not isinstance(value, str):
		return str(value or "")
	try:
		return _plain_message(json.loads(value))
	except (TypeError, ValueError):
		return value


def _r5_loser_kind(response, winner):
	message = _plain_message(response.get("message"))
	if "TimestampMismatchError" in str(response.get("exc_type")):
		return "timestamp_mismatch"
	if response.get("status") in (409, 417) and response.get("exc_type") == "ValidationError":
		if "只能" in message and ("草稿" in message or "已提交" in message):
			return "document_state_validation"
	if (
		winner == "delete"
		and response.get("status") == 404
		and response.get("exc_type") == "DoesNotExistError"
	):
		return "deleted_404"
	if (
		response.get("status") == 403
		and response.get("exc_type") == "PermissionError"
		and message
		and message != "frappe.exceptions.PermissionError"
		and "Traceback (most recent call last)" not in message
	):
		return "clean_permission"
	return "unexpected"


def _create(audit, scenario, iteration, item, qty, kind="Receive", user="Operator A", **kwargs):
	return audit.create(scenario, iteration, _data(audit, item, qty, kind, **kwargs), user=user)


def _tracked(audit, data, tracking, serials=None, batch_name=None):
	if tracking == "batch":
		data["items"][0]["batch_no"] = batch_name or audit.manifest["batch_no"]
		data["items"][0]["use_serial_batch_fields"] = 1
	elif tracking == "serial":
		data["items"][0]["serial_no"] = "\n".join(serials or [])
		data["items"][0]["use_serial_batch_fields"] = 1
	return data


def _submit_requests(audit, scenario, iteration, docs, users=None):
	users = users or ["Operator A"] * len(docs)
	return audit.fire(
		scenario,
		iteration,
		[
			(
				f"submit:{name}",
				audit.session(user),
				"native_api.submit_document",
				{"doctype": "Stock Entry", "name": name, "version": version},
			)
			for (name, version), user in zip(docs, users, strict=True)
		],
	)


def R1(audit, iteration):
	item = audit.manifest["items"]["plain"]
	key = str(uuid.uuid4())
	data = _data(audit, item, 1)
	starting_balance = audit.balance_for(item, audit.manifest["AUDIT-LEAF"])
	responses = audit.fire(
		"R1",
		iteration,
		[
			(
				f"create:{i}",
				audit.session("Operator A"),
				"native_api.create_document",
				{"doctype": "Stock Entry", "request_id": key, "data": data},
			)
			for i in range(10)
		],
	)
	names = {_name(audit, row) for row in responses}
	first = next(
		((_name(audit, row), _version(audit, row)) for row in responses if _name(audit, row)), (None, None)
	)
	submits = []
	doc_count = 0
	if first[0]:
		audit.check_global("R1", iteration)
		submits = _submit_requests(audit, "R1", iteration, [first] * 10)
		request_key = hashlib.sha256(
			f"{audit.users()['Operator A']['email']}\0Stock Entry\0{key}".encode()
		).hexdigest()
		doc_count = audit.direct(
			lambda frappe: frappe.db.count("Stock Entry", {"ti_request_key": request_key})
		)
	final_balance = audit.balance_for(item, audit.manifest["AUDIT-LEAF"])
	other_key = str(uuid.uuid4())
	second = audit.fire(
		"R1",
		iteration,
		[
			(
				user,
				audit.session(user),
				"native_api.create_document",
				{"doctype": "Stock Entry", "request_id": other_key, "data": data},
			)
			for user in ("Operator A", "Operator B")
		],
	)
	second_names = {_name(audit, row) for row in second if _name(audit, row)}

	def clean(result):
		return _succeeded(result) or (
			result["status"] in (403, 409, 417)
			and result.get("exc_type")
			and any("\u3400" <= char <= "\u9fff" for char in str(result.get("message") or ""))
		)

	passed = (
		len(names) == 1
		and None not in names
		and len(responses) == 10
		and doc_count == 1
		and len(submits) == 10
		and all(clean(result) for result in submits)
		and abs(final_balance - starting_balance - 1) < 0.000001
		and len(second_names) == 2
	)
	if not passed:
		audit.evidence["findings"].append(
			{
				"scenario": "R1",
				"iteration": iteration,
				"reason": "idempotency identities",
				"names": sorted(str(name) for name in names),
				"cross_user_names": sorted(second_names),
				"document_count": doc_count,
				"stock_balance": {"before": starting_balance, "after": final_balance},
				"responses": responses + submits + second,
			}
		)
	return passed, (
		f"same-key names={len(names)} docs={doc_count} submits={[(r['status'], r['exc_type']) for r in submits]}; "
		f"stock={starting_balance}->{final_balance}; cross-user names={len(second_names)}"
	)


def R2(audit, iteration):
	if audit.sequential_mode:
		return _r2_self_check(audit)
	tracking = ("plain", "batch", "serial")[(iteration - 1) % 3]
	item = audit.manifest["items"][tracking]
	leaf = audit.manifest["AUDIT-LEAF"]
	serial_token = uuid.uuid4().hex[:8]
	serials = (
		[f"AUDIT-SERIAL-R2-{iteration}-{serial_token}-{number:02d}" for number in range(1, 6)]
		if tracking == "serial"
		else []
	)
	if serials:
		audit.manifest.setdefault("serial_names", []).extend(serials)
	opening_data = _tracked(audit, _data(audit, item, 5, "Receive"), tracking, serials)
	loan = audit.create("R2", iteration, opening_data)
	if _name(audit, loan):
		audit.submit("R2", iteration, _name(audit, loan), _version(audit, loan))
	loan_data = _tracked(
		audit,
		_data(audit, item, 5, "Loan", target=_leased(audit), ti_borrower=f"AUDIT borrower {iteration}"),
		tracking,
		serials,
	)
	loan = audit.create("R2", iteration, loan_data)
	loan_name = _name(audit, loan)
	if loan_name:
		loan = audit.submit("R2", iteration, loan_name, _version(audit, loan))
		loan_lines = _message(audit, loan).get("items", [])
		line = loan_lines[0].get("name") if loan_lines else None
		settlements = []
		settlement_outcomes = (
			(("Return", "Returned"), ("Return", "Returned"))
			if iteration % 2 == 0
			else (("Return", "Returned"), ("Loss", "Lost"))
		)
		for kind, outcome in settlement_outcomes:
			data = _data(
				audit,
				item,
				3,
				kind,
				warehouse=_leased(audit),
				target=leaf,
				ti_borrower=f"AUDIT borrower {iteration}",
			)
			data = _tracked(audit, data, tracking, serials[:3])
			if kind == "Loss":
				data["items"][0]["t_warehouse"] = None
			data["items"][0].update(
				{
					"ti_original_loan": loan_name,
					"ti_original_loan_line": line,
					"ti_settlement_outcome": outcome,
				}
			)
			draft = audit.create("R2", iteration, data)
			if _name(audit, draft):
				settlements.append((_name(audit, draft), _version(audit, draft)))
		results = _submit_requests(audit, "R2", iteration, settlements[:2]) if len(settlements) == 2 else []
		wins = sum(bool(audit.value(row) and _succeeded(row)) for row in results)
		balance = audit.stock_state(item)
		leased_balance = audit.balance_for(item, _leased(audit))
		settled = audit.direct(
			lambda frappe: float(
				frappe.db.sql(
					"select coalesce(sum(abs(line.transfer_qty)), 0) from `tabStock Entry Detail` line "
					"inner join `tabStock Entry` parent on parent.name=line.parent "
					"where line.ti_original_loan=%s and parent.docstatus=1",
					loan_name,
				)[0][0]
			)
		)
		passed = (
			wins == 1
			and settled <= 5
			and leased_balance >= 0
			and all(float(row.actual_qty or 0) >= 0 for row in balance)
		)
		return (
			passed,
			f"settlement successes={wins}/2; settled={settled}/5; leased balance={leased_balance}; "
			f"leased-bin rows={len(balance)} SQL={[dict(row) for row in balance]}",
		)
	return False, "loan draft could not be created"


def _r2_self_check(audit):
	"""Submit each settlement payload once in isolation for every tracking mode."""
	for tracking in ("plain", "batch", "serial"):
		item = audit.manifest["items"][tracking]
		leaf = audit.manifest["AUDIT-LEAF"]
		serials = (
			[f"AUDIT-R2-PREFLIGHT-{uuid.uuid4().hex[:8]}-{index:02d}" for index in range(1, 13)]
			if tracking == "serial"
			else []
		)
		if serials:
			audit.manifest.setdefault("serial_names", []).extend(serials)
			opening = _tracked(audit, _data(audit, item, 12, "Receive"), tracking, serials)
		else:
			opening = _tracked(audit, _data(audit, item, 12, "Receive"), tracking)
		opened = audit.create("R2", 0, opening)
		if not _name(audit, opened):
			raise RuntimeError(
				f"R2 {tracking} opening failed: HTTP {opened['status']} "
				f"exc_type={opened['exc_type']} message={opened['message']}"
			)
		opened = audit.submit("R2", 0, _name(audit, opened), _version(audit, opened))
		if not _succeeded(opened):
			raise RuntimeError(
				f"R2 {tracking} opening submit failed: HTTP {opened['status']} "
				f"exc_type={opened['exc_type']} message={opened['message']}"
			)
		batch_name = audit.manifest["batch_no"] if tracking == "batch" else None
		for settlement_mode in ("return_pair", "return_loss"):
			borrower = f"AUDIT R2 preflight {tracking} {settlement_mode}"
			loan_data = _tracked(
				audit,
				_data(audit, item, 6, "Loan", target=_leased(audit), ti_borrower=borrower),
				tracking,
				serials[:6]
				if tracking == "serial" and settlement_mode == "return_pair"
				else (serials[6:] if tracking == "serial" else None),
				batch_name,
			)
			loan = audit.create("R2", 0, loan_data)
			if not _name(audit, loan):
				raise RuntimeError(
					f"R2 {tracking} loan failed: HTTP {loan['status']} "
					f"exc_type={loan['exc_type']} message={loan['message']}"
				)
			loan = audit.submit("R2", 0, _name(audit, loan), _version(audit, loan))
			if not _succeeded(loan):
				raise RuntimeError(
					f"R2 {tracking} loan submit failed: HTTP {loan['status']} "
					f"exc_type={loan['exc_type']} message={loan['message']}"
				)
			loan_name = _name(audit, loan)
			line_name = _message(audit, loan).get("items", [{}])[0].get("name")
			if settlement_mode == "return_pair":
				settlements = (("Return", "Returned", 0), ("Return", "Returned", 3))
			else:
				settlements = (("Return", "Returned", 6), ("Loss", "Lost", 9))
			for kind, outcome, serial_offset in settlements:
				settlement_data = _tracked(
					audit,
					_data(
						audit,
						item,
						3,
						kind,
						warehouse=_leased(audit),
						target=leaf,
						ti_borrower=borrower,
					),
					tracking,
					serials[serial_offset : serial_offset + 3] if tracking == "serial" else None,
					batch_name,
				)
				if kind == "Loss":
					settlement_data["items"][0]["t_warehouse"] = None
				settlement_data["items"][0].update(
					{
						"ti_original_loan": loan_name,
						"ti_original_loan_line": line_name,
						"ti_settlement_outcome": outcome,
					}
				)
				draft = audit.create("R2", 0, settlement_data)
				if not _name(audit, draft):
					raise RuntimeError(
						f"R2 {tracking} {kind} draft failed: HTTP {draft['status']} "
						f"exc_type={draft['exc_type']} message={draft['message']}"
					)
				result = audit.submit("R2", 0, _name(audit, draft), _version(audit, draft))
				if not _succeeded(result):
					raise RuntimeError(
						f"R2 {tracking} {kind} submit failed: HTTP {result['status']} "
						f"exc_type={result['exc_type']} message={result['message']}"
					)
	return True, "plain, batch, and serial loan/return/loss payloads succeeded sequentially"


def _leased(audit):
	return audit.direct(
		lambda frappe: frappe.db.get_single_value("Temple Inventory Settings", "leased_warehouse")
	)


def R3(audit, iteration):
	if audit.sequential_mode:
		return _r3_self_check(audit)
	tracking = ("plain", "batch", "serial")[(iteration - 1) % 3]
	token = uuid.uuid4().hex[:6]
	item = f"AUDIT-R3-{tracking.upper()}-{iteration:03d}-{token}"
	audit.direct(lambda frappe: _ensure_item(frappe, item, tracking))
	audit.manifest["items"][item] = item
	if tracking in ("batch", "serial"):
		audit.manifest.setdefault("tracked_item_names", []).append(item)
	leaf = audit.manifest["AUDIT-LEAF"]
	starting = audit.balance_for(item, leaf)
	serials = (
		[f"AUDIT-R3-SN-{iteration}-{number:02d}-{uuid.uuid4().hex[:4]}" for number in range(1, 6)]
		if tracking == "serial"
		else []
	)
	if serials:
		audit.manifest.setdefault("serial_names", []).extend(serials)
	if tracking == "batch":
		batch_result = audit.rpc(
			audit.session("Operator A"),
			"R3",
			iteration,
			"create_batch",
			"catalog.receipt_batches",
			{
				"rows": [
					{
						"item_code": item,
						"local_id": f"r3-{iteration}-{token}",
						"batch_id": f"AUDIT-R3-{iteration:03d}-{token}",
					}
				]
			},
		)
		batch_rows = (audit.value(batch_result) or {}).get("batches", [])
		if not batch_rows:
			return (
				False,
				f"batch setup failed: HTTP {batch_result['status']} exc={batch_result['exc_type']} message={batch_result['message']}",
			)
		batch_name = batch_rows[0]["name"]
		audit.manifest.setdefault("batch_names", []).append(batch_name)
	else:
		batch_name = None
	opening_data = _tracked(audit, _data(audit, item, 5, "Receive"), tracking, serials, batch_name)
	opening = audit.create("R3", iteration, opening_data)
	if _name(audit, opening):
		audit.submit("R3", iteration, _name(audit, opening), _version(audit, opening))
	drafts = []
	kinds = ("Issue", "Transfer") if iteration % 2 else ("Issue", "Issue")
	for _index, kind in enumerate(kinds):
		target = audit.manifest["AUDIT-OTHER-LEAF"] if kind == "Transfer" else None
		data = _tracked(audit, _data(audit, item, 3, kind, target=target), tracking, serials[:3], batch_name)
		response = audit.create("R3", iteration, data)
		if _name(audit, response):
			drafts.append((_name(audit, response), _version(audit, response)))
	results = _submit_requests(audit, "R3", iteration, drafts)
	wins = sum(_succeeded(row) for row in results)
	rows = audit.stock_state(item)
	leaf_rows = [row for row in rows if row.warehouse == leaf]
	expected = starting + 2
	passed = wins == 1 and leaf_rows and float(leaf_rows[0].actual_qty) == expected
	if not passed:
		audit.evidence["findings"].append(
			{
				"scenario": "R3",
				"iteration": iteration,
				"reason": "competing issue balance",
				"successes": wins,
				"sql_rows": [dict(row) for row in rows],
			}
		)
	return (
		bool(passed),
		f"issue successes={wins}/2; expected={expected}; leaf balance={leaf_rows[0].actual_qty if leaf_rows else 'missing'}",
	)


def _r3_self_check(audit):
	"""Exercise issue, transfer, batch, and serial request shapes with separate stock."""
	for tracking in ("plain", "batch", "serial"):
		token = uuid.uuid4().hex[:8]
		item = f"AUDIT-R3-PREFLIGHT-{tracking.upper()}-{token}"
		audit.direct(lambda frappe: _ensure_item(frappe, item, tracking))
		audit.manifest["items"][item] = item
		if tracking in ("batch", "serial"):
			audit.manifest.setdefault("tracked_item_names", []).append(item)
		serials = (
			[f"AUDIT-R3-PREFLIGHT-SN-{token}-{index:02d}" for index in range(1, 13)]
			if tracking == "serial"
			else []
		)
		if serials:
			audit.manifest.setdefault("serial_names", []).extend(serials)
		batch_name = None
		if tracking == "batch":
			result = audit.rpc(
				audit.session("Operator A"),
				"R3",
				0,
				"selfcheck_batch",
				"catalog.receipt_batches",
				{
					"rows": [
						{
							"item_code": item,
							"local_id": f"r3-preflight-{token}",
							"batch_id": f"AUDIT-R3-PREFLIGHT-{token}",
						}
					]
				},
			)
			batch_rows = (audit.value(result) or {}).get("batches", [])
			if not batch_rows:
				raise RuntimeError(
					f"R3 batch setup failed: HTTP {result['status']} "
					f"exc_type={result['exc_type']} message={result['message']}"
				)
			batch_name = batch_rows[0]["name"]
			audit.manifest.setdefault("batch_names", []).append(batch_name)
		opening_data = _tracked(audit, _data(audit, item, 12, "Receive"), tracking, serials, batch_name)
		opening = audit.create("R3", 0, opening_data)
		if not _name(audit, opening):
			raise RuntimeError(
				f"R3 {tracking} opening failed: HTTP {opening['status']} "
				f"exc_type={opening['exc_type']} message={opening['message']}"
			)
		opening = audit.submit("R3", 0, _name(audit, opening), _version(audit, opening))
		if not _succeeded(opening):
			raise RuntimeError(
				f"R3 {tracking} opening submit failed: HTTP {opening['status']} "
				f"exc_type={opening['exc_type']} message={opening['message']}"
			)
		operations = (
			("Issue", serials[0:3]),
			("Transfer", serials[3:6]),
			("Issue", serials[6:9]),
			("Issue", serials[9:12]),
		)
		for kind, operation_serials in operations:
			data = _tracked(
				audit,
				_data(
					audit,
					item,
					3,
					kind,
					target=audit.manifest["AUDIT-OTHER-LEAF"] if kind == "Transfer" else None,
				),
				tracking,
				operation_serials if tracking == "serial" else None,
				batch_name,
			)
			draft = audit.create("R3", 0, data)
			if not _name(audit, draft):
				raise RuntimeError(
					f"R3 {tracking} {kind} draft failed: HTTP {draft['status']} "
					f"exc_type={draft['exc_type']} message={draft['message']}"
				)
			result = audit.submit("R3", 0, _name(audit, draft), _version(audit, draft))
			if not _succeeded(result):
				raise RuntimeError(
					f"R3 {tracking} {kind} submit failed: HTTP {result['status']} "
					f"exc_type={result['exc_type']} message={result['message']}"
				)
	return True, "plain, batch, serial, Issue, and Transfer payloads succeeded sequentially"


def R4(audit, iteration):
	item, leaf = f"AUDIT-R4-{iteration:03d}-{uuid.uuid4().hex[:8]}", audit.manifest["AUDIT-LEAF"]
	audit.direct(lambda frappe: _ensure_item(frappe, item))
	audit.manifest["items"][item] = item
	audit._write_manifest()
	today = datetime.now()
	yesterday = (today.date() - timedelta(days=1)).isoformat()
	opening = _create(audit, "R4", iteration, item, 10, when=yesterday, posting_time="12:00:00")
	if _name(audit, opening):
		audit.submit("R4", iteration, _name(audit, opening), _version(audit, opening))
	stamp = today.strftime("%Y-%m-%d %H:%M:%S")
	baseline = audit.rpc(
		audit.session("Inventory Manager"),
		"R4",
		iteration,
		"count_baseline",
		"counts.count_baseline",
		{"timestamp": stamp},
	)
	rows = _message(audit, baseline).get("rows", []) if isinstance(_message(audit, baseline), dict) else []
	row = next(
		(
			dict(value)
			for value in rows
			if value.get("item_code") == item and value.get("warehouse") == leaf and not value.get("batch_no")
		),
		None,
	)
	if not row:
		return False, "count baseline did not include AUDIT leaf/item"
	row.update(actual_qty=10 if iteration % 2 else 8, review_state="Reviewed")
	count_data = {
		"company": audit.manifest["company"],
		"posting_date": stamp[:10],
		"posting_time": stamp[11:],
		"ti_time_mode": "Historical",
		"ti_notes": "AUDIT race",
		"ti_count_review": [row],
	}
	issue = _create(audit, "R4", iteration, item, 3, "Issue", when=yesterday, posting_time="23:59:00")
	issue_request = None
	if _name(audit, issue):
		issue_request = (
			"submit:issue",
			audit.session("Operator A"),
			"native_api.submit_document",
			{"doctype": "Stock Entry", "name": _name(audit, issue), "version": _version(audit, issue)},
		)

	def count_flow(session):
		payload = {"request_id": str(uuid.uuid4()), "data": json.dumps(count_data, ensure_ascii=False)}
		saved = session.call("counts.save_count", payload)
		audit.record(
			"R4",
			iteration,
			"save_count",
			saved,
			{"method": "counts.save_count", "data": payload, "account": session.username},
		)
		value = audit.value(saved)
		submitted = None
		if isinstance(value, dict) and value.get("name"):
			payload = {
				"doctype": "Stock Reconciliation",
				"name": value["name"],
				"version": value["version"],
			}
			submitted = session.call("native_api.submit_document", payload)
			audit.record(
				"R4",
				iteration,
				"submit_count",
				submitted,
				{"method": "native_api.submit_document", "data": payload, "account": session.username},
			)
		response = submitted or saved
		return {
			"status": response["status"],
			"exc_type": response.get("exc_type"),
			"message": response.get("message"),
			"body": response.get("body"),
			"rpc": "counts.save_count",
			"count_save": saved,
			"count_submit": submitted,
		}

	count_request = ("save_count", audit.session("Inventory Manager"), count_flow, None)
	if not issue_request:
		return (
			False,
			f"Issue draft failed: HTTP {issue['status']} exc={issue['exc_type']} message={issue['message']}",
		)
	variant = (iteration - 1) % 3
	if variant == 0:
		order, requests, delays = "count_then_issue", [count_request, issue_request], {}
	elif variant == 1:
		order, requests, delays = "issue_then_count", [issue_request, count_request], {}
	else:
		order, requests, delays = (
			"issue_headstart_overlap",
			[issue_request, count_request],
			{"save_count": 0.005},
		)
	responses = audit.fire("R4", iteration, requests, delay_by_label=delays)
	count_outcome = next(value for value in responses if value.get("rpc") == "counts.save_count")
	count_response = count_outcome["count_save"]
	count_result = audit.value(count_response)
	count_submit = count_outcome["count_submit"]
	state = audit.stock_state(item)
	iteration_events = [
		event
		for event in audit.evidence["events"]
		if event.get("scenario") == "R4" and event.get("iteration") == iteration
	]
	issue_event = next((event for event in iteration_events if event.get("sequence") == "submit:issue"), {})
	count_event = next((event for event in iteration_events if event.get("sequence") == "save_count"), {})
	issue_in_flight_at_count_start = bool(
		issue_event.get("started_at")
		and issue_event.get("completed_at")
		and count_event.get("started_at")
		and datetime.fromisoformat(issue_event["started_at"])
		< datetime.fromisoformat(count_event["started_at"])
		< datetime.fromisoformat(issue_event["completed_at"])
	)
	count_name = count_result.get("name") if isinstance(count_result, dict) else None
	ledger_at_timestamp = audit.direct(
		lambda frappe: float(
			frappe.db.sql(
				"select qty_after_transaction from `tabStock Ledger Entry` "
				"where item_code=%s and warehouse=%s and is_cancelled=0 and posting_datetime<=%s "
				"and not (voucher_type='Stock Reconciliation' and voucher_no=%s) "
				"order by posting_datetime desc, creation desc limit 1",
				(item, leaf, stamp, count_name or ""),
			)[0][0]
			or 0
		)
	)
	clean_rejection = (
		count_submit is not None
		and count_submit["status"] in (403, 409, 417)
		and bool(count_submit.get("exc_type"))
		and any("\u3400" <= char <= "\u9fff" for char in str(count_submit.get("message") or ""))
	) or (
		count_response["status"] in (403, 409, 417)
		and bool(count_response.get("exc_type"))
		and any("\u3400" <= char <= "\u9fff" for char in str(count_response.get("message") or ""))
	)
	accepted = isinstance(count_result, dict) and bool(
		count_result.get("name") or count_result.get("no_adjustment")
	)
	no_adjustment = isinstance(count_result, dict) and bool(count_result.get("no_adjustment"))
	stale_baseline = accepted and abs(float(row["baseline_qty"]) - ledger_at_timestamp) > 0.000001
	no_adjustment_on_mismatch = (
		isinstance(count_result, dict)
		and count_result.get("no_adjustment")
		and abs(10 - ledger_at_timestamp) > 0.000001
	)
	passed = (clean_rejection or accepted) and not stale_baseline and not no_adjustment_on_mismatch
	audit.evidence.setdefault("r4_observations", []).append(
		{
			"iteration": iteration,
			"order": order,
			"variant": "matching_actual_10" if iteration % 2 else "adjustment_actual_8",
			"issue_in_flight_at_count_start": issue_in_flight_at_count_start,
			"outcome": "no_adjustment" if no_adjustment else "accepted" if accepted else "stale_rejected",
			"baseline_recorded": float(row["baseline_qty"]),
			"ledger_at_timestamp": ledger_at_timestamp,
			"baseline_matches_ledger": (
				abs(float(row["baseline_qty"]) - ledger_at_timestamp) <= 0.000001 if accepted else None
			),
			"count_status": count_response["status"],
			"count_exc_type": count_response.get("exc_type"),
			"count_submit_status": count_submit["status"] if count_submit else None,
			"count_submit_exc_type": count_submit.get("exc_type") if count_submit else None,
		}
	)
	if not passed:
		audit.evidence["findings"].append(
			{
				"scenario": "R4",
				"iteration": iteration,
				"reason": "count accepted with stale timestamp baseline",
				"requests": iteration_events,
				"baseline_row": row,
				"ledger_at_timestamp": ledger_at_timestamp,
				"issue_in_flight_at_count_start": issue_in_flight_at_count_start,
				"sql_rows": [dict(value) for value in state],
			}
		)
	return (
		passed,
		f"baseline={row['baseline_qty']}; ledger@timestamp={ledger_at_timestamp}; "
		f"issue_in_flight_at_count_start={issue_in_flight_at_count_start}; "
		f"count HTTP={count_response['status']} exc={count_response['exc_type']}; "
		f"submit={count_submit}; response={count_result}; SQL={[dict(v) for v in state]}",
	)


def R5(audit, iteration):
	if audit.sequential_mode:
		return _r5_self_check(audit)
	item = audit.manifest["items"]["plain"]
	draft = _create(audit, "R5", iteration, item, 1)
	name, version = _name(audit, draft), _version(audit, draft)
	if not name:
		return False, "draft creation failed"
	if iteration % 4 == 0:
		a = (
			"save:A",
			audit.session("Operator A"),
			"native_api.save_document",
			{"doctype": "Stock Entry", "name": name, "version": version, "data": {"remarks": "AUDIT A"}},
		)
		b = (
			"save:B",
			audit.session("Operator B"),
			"native_api.save_document",
			{"doctype": "Stock Entry", "name": name, "version": version, "data": {"remarks": "AUDIT B"}},
		)
		results = audit.fire("R5", iteration, [a, b])
	elif iteration % 4 == 1:
		results = audit.fire(
			"R5",
			iteration,
			[
				(
					"save",
					audit.session("Inventory Manager"),
					"native_api.save_document",
					{
						"doctype": "Stock Entry",
						"name": name,
						"version": version,
						"data": {"remarks": "AUDIT save"},
					},
				),
				(
					"submit",
					audit.session("Operator B"),
					"native_api.submit_document",
					{"doctype": "Stock Entry", "name": name, "version": version},
				),
			],
		)
	elif iteration % 4 == 2:
		results = audit.fire(
			"R5",
			iteration,
			[
				(
					"submit",
					audit.session("Operator A"),
					"native_api.submit_document",
					{"doctype": "Stock Entry", "name": name, "version": version},
				),
				(
					"delete",
					audit.session("Inventory Manager"),
					"native_api.delete_document",
					{"doctype": "Stock Entry", "name": name, "version": version},
				),
			],
		)
	else:
		submitted = audit.submit("R5", iteration, name, version)
		new_version = _version(audit, submitted) or version
		results = audit.fire(
			"R5",
			iteration,
			[
				(
					"cancel:A",
					audit.session("Inventory Manager"),
					"native_api.cancel_document",
					{"doctype": "Stock Entry", "name": name, "version": new_version},
				),
				(
					"cancel:B",
					audit.session("Inventory Manager"),
					"native_api.cancel_document",
					{"doctype": "Stock Entry", "name": name, "version": new_version},
				),
			],
		)
	state = audit.state("Stock Entry", name)
	winners = [result for result in results if _succeeded(result)]
	wins = len(winners)
	winner = winners[0].get("sequence") if len(winners) == 1 else None
	losers = [result for result in results if not _succeeded(result)]
	loser_rows = [
		{
			"sequence": result.get("sequence"),
			"status": result.get("status"),
			"exc_type": result.get("exc_type"),
			"message": result.get("message"),
			"classification": _r5_loser_kind(result, winner),
		}
		for result in losers
	]
	clean_losers = all(row["classification"] != "unexpected" for row in loser_rows)
	audit.evidence.setdefault("r5_outcomes", []).append(
		{
			"iteration": iteration,
			"winner": winner,
			"losers": loser_rows,
			"responses": [
				{
					"sequence": result.get("sequence"),
					"status": result.get("status"),
					"exc_type": result.get("exc_type"),
					"message": result.get("message"),
				}
				for result in results
			],
		}
	)
	if iteration % 4 == 0:
		final_ok = bool(state and state.docstatus == 0 and state.remarks in ("AUDIT A", "AUDIT B"))
	elif iteration % 4 == 1:
		final_ok = bool(state and state.docstatus in (0, 1))
	elif iteration % 4 == 2:
		final_ok = (
			state is None
			and any(_succeeded(row) for row in results if row.get("rpc") == "native_api.delete_document")
		) or bool(state and state.docstatus == 1)
	else:
		final_ok = bool(state and state.docstatus == 2)
	return (
		wins == 1 and clean_losers and final_ok,
		f"winner={winner}; loser={loser_rows}; final={state}",
	)


def _r5_self_check(audit):
	"""Verify each versioned write endpoint succeeds on a separate valid document."""
	item = audit.manifest["items"]["plain"]
	draft = _create(audit, "R5", 0, item, 1, user="Inventory Manager")
	if not _name(audit, draft):
		raise RuntimeError(
			f"R5 save/delete draft failed: HTTP {draft['status']} "
			f"exc_type={draft['exc_type']} message={draft['message']}"
		)
	saved = audit.rpc(
		audit.session("Inventory Manager"),
		"R5",
		0,
		"selfcheck_save",
		"native_api.save_document",
		{
			"doctype": "Stock Entry",
			"name": _name(audit, draft),
			"version": _version(audit, draft),
			"data": {"remarks": "AUDIT R5 selfcheck"},
		},
	)
	if not _succeeded(saved):
		raise RuntimeError(
			f"R5 save failed: HTTP {saved['status']} exc_type={saved['exc_type']} message={saved['message']}"
		)
	deleted = audit.rpc(
		audit.session("Inventory Manager"),
		"R5",
		0,
		"selfcheck_delete",
		"native_api.delete_document",
		{
			"doctype": "Stock Entry",
			"name": _name(audit, saved),
			"version": _version(audit, saved),
		},
	)
	if not _succeeded(deleted):
		raise RuntimeError(
			f"R5 delete failed: HTTP {deleted['status']} exc_type={deleted['exc_type']} "
			f"message={deleted['message']}"
		)
	submission = _create(audit, "R5", 0, item, 1, user="Inventory Manager")
	if not _name(audit, submission):
		raise RuntimeError(
			f"R5 submit/cancel draft failed: HTTP {submission['status']} "
			f"exc_type={submission['exc_type']} message={submission['message']}"
		)
	submitted = audit.submit("R5", 0, _name(audit, submission), _version(audit, submission))
	if not _succeeded(submitted):
		raise RuntimeError(
			f"R5 submit failed: HTTP {submitted['status']} exc_type={submitted['exc_type']} "
			f"message={submitted['message']}"
		)
	cancelled = audit.rpc(
		audit.session("Inventory Manager"),
		"R5",
		0,
		"selfcheck_cancel",
		"native_api.cancel_document",
		{
			"doctype": "Stock Entry",
			"name": _name(audit, submitted),
			"version": _version(audit, submitted),
		},
	)
	if not _succeeded(cancelled):
		raise RuntimeError(
			f"R5 cancel failed: HTTP {cancelled['status']} exc_type={cancelled['exc_type']} "
			f"message={cancelled['message']}"
		)
	return True, "save, submit, cancel, and delete succeeded sequentially"


def R6(audit, iteration):
	item = audit.manifest["items"]["batch"]
	draft_data = _tracked(
		audit,
		_data(audit, item, 1),
		"batch",
		batch_name=audit.manifest["batch_no"],
	)
	draft = audit.create("R6", iteration, draft_data)
	if not _name(audit, draft):
		return (
			False,
			f"draft create failed: HTTP {draft['status']} exc={draft['exc_type']} message={draft['message']}",
		)
	line = _message(audit, draft).get("items", [{}])[0]
	row = {
		"item_code": item,
		"local_id": f"audit-row-{iteration}-{uuid.uuid4().hex[:8]}",
		"batch_id": f"AUDIT-R6-{iteration:03d}-{uuid.uuid4().hex[:8]}",
		"row_name": line.get("name"),
	}
	audit.manifest.setdefault("batch_names", []).append(row["batch_id"])
	audit._write_manifest()
	results = audit.fire(
		"R6",
		iteration,
		[
			(
				f"receipt_batches:{index}",
				audit.session("Operator A"),
				"catalog.receipt_batches",
				{"rows": [row]},
			)
			for index in range(2)
		],
	)
	values = [audit.value(result) for result in results]
	batch_rows = next(
		(
			(value or {}).get("batches", [])
			for result, value in zip(results, values, strict=True)
			if _succeeded(result)
		),
		[],
	)
	batch_name = batch_rows[0].get("name") if batch_rows else None
	all_batch_names = [
		row["batch_id"],
		*[row.get("name") for value in values for row in (value or {}).get("batches", []) if row.get("name")],
	]
	if all_batch_names:
		audit.manifest.setdefault("batch_names", []).extend(
			name for name in all_batch_names if name not in audit.manifest.get("batch_names", [])
		)
		audit._write_manifest()
	saved = audit.rpc(
		audit.session("Operator A"),
		"R6",
		iteration,
		"attach_batch_to_draft",
		"native_api.save_document",
		{
			"doctype": "Stock Entry",
			"name": _name(audit, draft),
			"version": _version(audit, draft),
			"data": {"items": [{"name": line.get("name"), "batch_no": batch_name}]},
		},
	)
	state = (
		audit.direct(
			lambda frappe: frappe.db.sql(
				"select (select count(*) from `tabBatch` where name in ("
				+ ",".join("%s" for _ in all_batch_names)
				+ ")) as batches, (select count(*) from `tabStock Entry Detail` "
				"where name=%s and batch_no in ("
				+ ",".join("%s" for _ in all_batch_names)
				+ ")) as references_count",
				(*all_batch_names, line.get("name"), *all_batch_names),
				as_dict=True,
			)[0]
		)
		if all_batch_names
		else {"batches": 0, "references_count": 0}
	)
	passed = (
		all(0 < result["status"] < 500 for result in results)
		and any(_succeeded(result) for result in results)
		and len(set(all_batch_names)) == 1
		and _succeeded(saved)
		and state.batches == 1
		and state.references_count == 1
	)
	return (
		bool(passed),
		f"responses={[(r['status'], r['exc_type'], audit.value(r)) for r in results]}; save={saved['status']}/{saved['exc_type']}; SQL={dict(state)}",
	)


def R7(audit, iteration):
	if audit.sequential_mode:
		return _r7_self_check(audit)
	import_token = uuid.uuid4().hex[:8]
	item_code = f"AUDIT-IMPORT-{iteration}-{import_token}"

	def make_import(status):
		name, digest = audit.direct(
			lambda frappe: _create_import(frappe, iteration, import_token, item_code, status)
		)
		imports = audit.manifest.setdefault("import_names", [])
		if name not in imports:
			imports.append(name)
			audit._write_manifest()
		return name, digest

	commit_name, plan_hash = make_import("Previewed")
	commits = audit.fire(
		"R7",
		iteration,
		[
			(
				f"commit:{index}",
				audit.session("Inventory Manager"),
				"imports.commit",
				{"name": commit_name, "plan_hash": plan_hash},
			)
			for index in range(5)
		],
	)
	commit_jobs = [audit.import_job_observation(commit_name, 1)]
	audit.wait_for_background_idle(f"R7 iteration {iteration} commit import")
	failed_name, _ = make_import("Failed")
	retries = audit.fire(
		"R7",
		iteration,
		[
			(f"retry:{index}", audit.session("Inventory Manager"), "imports.retry", {"name": failed_name})
			for index in range(3)
		],
	)
	failed_jobs = [audit.import_job_observation(failed_name, attempt) for attempt in (1, 2)]
	running_name, _ = make_import("Running")
	audit.direct(lambda frappe: _start_import_job(frappe, running_name))
	running = audit.fire(
		"R7",
		iteration,
		[
			(
				f"retry_running:{index}",
				audit.session("Inventory Manager"),
				"imports.retry",
				{"name": running_name},
			)
			for index in range(3)
		],
	)
	running_attempt = audit.direct(
		lambda frappe: frappe.db.get_value("Inventory Import", running_name, "attempt")
	)
	running_jobs = [audit.import_job_observation(running_name, 1)]
	audit.wait_for_background_idle(f"R7 iteration {iteration} running import retry")
	audit.direct(lambda frappe: frappe.db.set_value("Inventory Import", running_name, "status", "Failed"))
	queued_name, _ = make_import("Queued")
	stranded = [
		audit.rpc(
			audit.session("Inventory Manager"),
			"R7",
			iteration,
			"status_stranded",
			"imports.status",
			{"name": queued_name},
			expected=True,
		),
		audit.rpc(
			audit.session("Inventory Manager"),
			"R7",
			iteration,
			"retry_stranded",
			"imports.retry",
			{"name": queued_name},
			expected=True,
		),
	]
	stranded_jobs = [audit.import_job_observation(queued_name, attempt) for attempt in (1, 2)]
	deadline = time.monotonic() + 600
	commit_state = None
	while time.monotonic() < deadline:
		commit_state = audit.direct(
			lambda frappe: frappe.db.get_value(
				"Inventory Import", commit_name, ["status", "attempt"], as_dict=True
			)
		)
		if commit_state.status not in ("Queued", "Running"):
			break
		time.sleep(0.5)
	state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Inventory Import", failed_name, ["status", "attempt"], as_dict=True
		)
	)
	stranded_state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Inventory Import", queued_name, ["status", "attempt"], as_dict=True
		)
	)
	item_count = audit.direct(
		lambda frappe: frappe.db.count("Item", {"item_name": f"AUDIT Import {iteration} {import_token}"})
	)
	commit_ok = sum(_succeeded(result) for result in commits) == 5 and commit_state.status == "Completed"
	retry_ok = (
		all(_succeeded(result) for result in retries)
		and all((audit.value(result) or {}).get("status") == "Previewed" for result in retries)
		and state.attempt == 2
		and state.status
		in (
			"Previewed",
			"Queued",
			"Running",
			"Failed",
		)
	)
	stranded_values = [audit.value(result) for result in stranded]
	stranded_recovered = (
		isinstance(stranded_values[0], dict)
		and stranded_values[0].get("status") == "Failed"
		and stranded_values[0].get("can_retry")
		and isinstance(stranded_values[1], dict)
		and stranded_values[1].get("status") == "Previewed"
		and stranded_state.attempt == 2
	)
	running_ok = (
		all(
			_succeeded(result)
			and isinstance(audit.value(result), dict)
			and audit.value(result).get("status") == "Running"
			for result in running
		)
		and running_attempt == 1
	)
	running_state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Inventory Import", running_name, ["status", "attempt"], as_dict=True
		)
	)
	stranded_state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Inventory Import", queued_name, ["status", "attempt"], as_dict=True
		)
	)
	audit.evidence.setdefault("r7_import_observations", []).append(
		{
			"iteration": iteration,
			"commit": {
				"import": commit_name,
				"attempt": commit_state.attempt,
				"status": commit_state.status,
				"responses": [result["status"] for result in commits],
				"logical_job_ids": sorted({row["job_id"] for row in commit_jobs}),
				"job_records": commit_jobs,
				"items_created": item_count,
			},
			"retry": {
				"import": failed_name,
				"attempt": state.attempt,
				"status": state.status,
				"job_records": failed_jobs,
			},
			"running_retry": {
				"import": running_name,
				"attempt": running_state.attempt,
				"final_status": running_state.status,
				"responses": [result["status"] for result in running],
				"job_records": running_jobs,
			},
			"stranded": {
				"import": queued_name,
				"status_response": stranded_values[0],
				"retry_response": stranded_values[1],
				"final_status": stranded_state.status,
				"attempt": stranded_state.attempt,
				"job_records": stranded_jobs,
			},
			"http_500s": sum(
				result.get("status") == 500 for result in [*commits, *retries, *running, *stranded]
			),
		}
	)
	passed = commit_ok and retry_ok and running_ok and stranded_recovered and item_count == 1
	return (
		passed,
		f"commit={[(r['status'], r['exc_type']) for r in commits]} state={dict(commit_state)} items={item_count}; "
		f"retry={[(r['status'], r['exc_type']) for r in retries]} state={dict(state)}; "
		f"running={[audit.value(result) for result in running]} attempt={running_attempt}; "
		f"stranded={stranded_values} state={dict(stranded_state)}; job_records={{'commit': {commit_jobs}, 'retry': {failed_jobs}, "
		f"'running': {running_jobs}, 'stranded': {stranded_jobs}}}; final_statuses="
		f"{{'commit': {dict(commit_state)}, 'retry': {dict(state)}, 'running': {dict(running_state)}, "
		f"'stranded': {dict(stranded_state)}}}",
	)


def _r7_self_check(audit):
	"""Exercise valid commit, retry, running-retry, status, and stranded-retry payloads."""

	def make(status):
		token = uuid.uuid4().hex[:8]
		name, digest = audit.direct(
			lambda frappe: _create_import(frappe, 0, token, f"AUDIT-IMPORT-CHECK-{token}", status)
		)
		audit.manifest.setdefault("import_names", []).append(name)
		audit._write_manifest()
		return name, digest

	def call(label, method, payload):
		response = audit.rpc(
			audit.session("Inventory Manager"),
			"R7",
			0,
			label,
			method,
			payload,
			expected=True,
		)
		if response.get("status", 0) >= 500:
			raise RuntimeError(
				f"R7 {label} baseline failed: HTTP {response['status']} "
				f"exc_type={response['exc_type']} message={response['message']}"
			)
		return audit.value(response)

	commit_name, digest = make("Previewed")
	committed = call("selfcheck_commit", "imports.commit", {"name": commit_name, "plan_hash": digest})
	failed_name, _ = make("Failed")
	retried = call("selfcheck_retry", "imports.retry", {"name": failed_name})
	retried_state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Inventory Import", failed_name, ["status", "attempt"], as_dict=True
		)
	)
	running_name, _ = make("Running")
	audit.direct(lambda frappe: _start_import_job(frappe, running_name))
	running = call("selfcheck_retry_running", "imports.retry", {"name": running_name})
	queued_name, _ = make("Queued")
	status = call("selfcheck_status_queued", "imports.status", {"name": queued_name})
	stranded = call("selfcheck_retry_queued", "imports.retry", {"name": queued_name})
	stranded_state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Inventory Import", queued_name, ["status", "attempt"], as_dict=True
		)
	)
	if not isinstance(committed, dict) or committed.get("status") not in ("Queued", "Running", "Completed"):
		raise RuntimeError(f"R7 valid commit was not accepted: {committed}")
	if not isinstance(retried, dict) or retried.get("status") != "Previewed" or retried_state.attempt != 2:
		raise RuntimeError(f"R7 failed-import retry did not re-preview: {retried}")
	if not isinstance(running, dict) or running.get("status") != "Running":
		raise RuntimeError(f"R7 running-import retry was not rejected cleanly: {running}")
	if not isinstance(status, dict) or status.get("status") != "Failed" or not status.get("can_retry"):
		raise RuntimeError(f"R7 stale-queued status did not recover: {status}")
	if not isinstance(stranded, dict) or stranded.get("status") != "Previewed" or stranded_state.attempt != 2:
		raise RuntimeError(f"R7 stale-queued retry did not re-preview: {stranded}")
	return True, "all four import endpoint payloads succeeded sequentially"


def _create_import(frappe, iteration, token, item_code, status):
	from io import BytesIO

	import openpyxl

	from temple_inventory import imports

	frappe.set_user("audit-manager@example.com")
	filename = f"AUDIT-import-{iteration}-{token}.xlsx"
	book = openpyxl.Workbook()
	sheet = book.active
	sheet.title = "物品导入"
	sheet.append(imports.HEADERS)
	sheet.append(
		[
			"",
			f"audit-ref-{iteration}-{token}",
			f"AUDIT Import {iteration} {token}",
			"",
			"Nos",
			"",
			"",
			"不追踪",
			"否",
			"",
		]
	)
	stream = BytesIO()
	book.save(stream)
	raw = stream.getvalue()
	planned, digest = imports.IMPORT_TYPES["Item"]["plan"](
		imports.IMPORT_TYPES["Item"]["parse"](raw, filename)
	)
	file_doc = frappe.get_doc(
		{"doctype": "File", "file_name": filename, "content": raw, "is_private": 1}
	).insert(ignore_permissions=True)
	doc = frappe.get_doc(
		{
			"doctype": imports.DOCTYPE,
			"import_type": "Item",
			"status": status,
			"source_file": file_doc.name,
			"file_sha256": __import__("hashlib").sha256(raw).hexdigest(),
			"preview_json": json.dumps(planned, ensure_ascii=False),
			"plan_hash": digest,
			"attempt": 1,
		}
	)
	imports._save(doc)
	file_doc.attached_to_doctype, file_doc.attached_to_name = imports.DOCTYPE, doc.name
	file_doc.save(ignore_permissions=True)
	if status == "Queued":
		frappe.db.set_value(
			imports.DOCTYPE,
			doc.name,
			"modified",
			frappe.utils.add_to_date(frappe.utils.now_datetime(), minutes=-2),
			update_modified=False,
		)
	frappe.db.commit()
	return doc.name, digest


def _start_import_job(frappe, name):
	from datetime import UTC, datetime

	frappe.cache.set_value(f"ti-import-progress:{name}", {"heartbeat": datetime.now(UTC).isoformat()})
	frappe.enqueue(
		"temple_inventory.tests.adversarial.scenarios._hold_import_job",
		import_name=name,
		queue="short",
		timeout=30,
		job_id=f"ti-import:{name}:1",
		enqueue_after_commit=True,
	)


def _hold_import_job(import_name):
	"""Keep the audit import job present while concurrent retry calls arrive."""
	time.sleep(6)


def R8(audit, iteration):
	items = _ensure_r8_stock(audit)
	# The baseline is read as of a whole second; stock posted in that same second is not in it yet.
	time.sleep(2)
	# Site time, not the harness process clock: a count stamped ahead of the site hides later stock.
	stamp = audit.direct(lambda frappe: frappe.utils.now_datetime()).strftime("%Y-%m-%d %H:%M:%S")
	baseline = audit.rpc(
		audit.session("Inventory Manager"),
		"R8",
		iteration,
		"count_baseline",
		"counts.count_baseline",
		{"timestamp": stamp},
	)
	base_rows = (
		_message(audit, baseline).get("rows", []) if isinstance(_message(audit, baseline), dict) else []
	)
	rows = [
		dict(row)
		for row in base_rows
		if row.get("item_code") in items and row.get("warehouse") == audit.manifest["AUDIT-LEAF"]
	]
	if len(rows) != 101:
		return False, f"expected 101 AUDIT count rows, received {len(rows)}"
	for row in rows:
		row.update(actual_qty=0 if float(row.get("baseline_qty") or 0) else 1, review_state="Reviewed")
	data = {
		"company": audit.manifest["company"],
		"posting_date": stamp[:10],
		"posting_time": stamp[11:],
		"ti_time_mode": "Historical",
		"ti_notes": f"AUDIT queued count {iteration}",
		"ti_count_review": rows,
	}
	saved = audit.rpc(
		audit.session("Inventory Manager"),
		"R8",
		iteration,
		"save_count",
		"counts.save_count",
		{"request_id": str(uuid.uuid4()), "data": json.dumps(data, ensure_ascii=False)},
	)
	count = _message(audit, saved)
	if not isinstance(count, dict) or not count.get("name"):
		return (
			False,
			f"save_count failed: HTTP {saved['status']} exc={saved['exc_type']} message={saved['message']}",
		)
	name, version = count["name"], count["version"]
	started = time.monotonic()
	submitted = audit.submit(
		"R8",
		iteration,
		name,
		version,
		user="Inventory Manager",
		doctype="Stock Reconciliation",
		expected=True,
	)
	queued = _message(audit, submitted)
	queued = queued if isinstance(queued, dict) else {}
	if queued.get("queued") is None and "enqueued as a background job" in str(submitted.get("message") or ""):
		queued["queued"] = True
	load = audit.rpc(
		audit.session("Inventory Manager"),
		"R8",
		iteration,
		"load_after_submit",
		"native_api.load_document",
		{"doctype": "Stock Reconciliation", "name": name},
		compact=True,
	)
	current = _message(audit, load) or {}
	loaded_summary = {
		key: current.get(key) for key in ("name", "version", "docstatus", "queued", "queue_error", "editable")
	}
	version = current.get("version", version)
	interference = [
		audit.rpc(
			audit.session("Inventory Manager"),
			"R8",
			iteration,
			"save_while_queued",
			"native_api.save_document",
			{
				"doctype": "Stock Reconciliation",
				"name": name,
				"version": version,
				"data": {"ti_notes": f"AUDIT racing save {iteration}"},
			},
			expected=True,
			compact=True,
		),
		audit.rpc(
			audit.session("Inventory Manager"),
			"R8",
			iteration,
			"cancel_while_queued",
			"native_api.cancel_document",
			{"doctype": "Stock Reconciliation", "name": name, "version": version},
			expected=True,
			compact=True,
		),
		audit.rpc(
			audit.session("Inventory Manager"),
			"R8",
			iteration,
			"second_submit",
			"native_api.submit_document",
			{"doctype": "Stock Reconciliation", "name": name, "version": version},
			expected=True,
			compact=True,
		),
	]
	immediate = {
		"load": {
			"status": load.get("status"),
			"exc_type": load.get("exc_type"),
			"document": loaded_summary,
		},
		"save": {key: interference[0].get(key) for key in ("status", "exc_type", "message")},
		"cancel": {key: interference[1].get(key) for key in ("status", "exc_type", "message")},
		"second_submit": {key: interference[2].get(key) for key in ("status", "exc_type", "message")},
	}
	deadline = time.monotonic() + 600
	queue_state = None
	while time.monotonic() < deadline:
		latest = audit.rpc(
			audit.session("Inventory Manager"),
			"R8",
			iteration,
			"poll",
			"native_api.load_document",
			{"doctype": "Stock Reconciliation", "name": name},
			expected=True,
			compact=True,
		)
		current = _message(audit, latest) or {}
		if current.get("docstatus") in (1, 2) or (
			current.get("docstatus") == 0 and not current.get("queued")
		):
			break
		if time.monotonic() - started >= 15 and current.get("docstatus") == 0 and current.get("queued"):
			queue_state = audit.background_queue_state()
			if not queue_state["audit_queued"] and not queue_state["audit_started"]:
				break
		time.sleep(0.5)
	job_seconds = round(time.monotonic() - started, 3)
	status = audit.direct(lambda frappe: frappe.db.get_value("Stock Reconciliation", name, "docstatus"))
	sle_count = audit.direct(
		lambda frappe: frappe.db.count(
			"Stock Ledger Entry",
			{"voucher_type": "Stock Reconciliation", "voucher_no": name, "is_cancelled": 0},
		)
	)
	sle_items = audit.direct(
		lambda frappe: frappe.get_all(
			"Stock Ledger Entry",
			filters={"voucher_type": "Stock Reconciliation", "voucher_no": name, "is_cancelled": 0},
			pluck="item_code",
		)
	)
	queue_error = current.get("queue_error", "")
	final_queued = current.get("queued", False)
	sample_rows = audit.direct(
		lambda frappe: [
			{
				"item": item,
				"bin": frappe.db.get_value(
					"Bin", {"item_code": item, "warehouse": audit.manifest["AUDIT-LEAF"]}, "actual_qty"
				),
				"latest_sle": frappe.db.get_value(
					"Stock Ledger Entry",
					{
						"item_code": item,
						"warehouse": audit.manifest["AUDIT-LEAF"],
						"is_cancelled": 0,
					},
					"qty_after_transaction",
					order_by="posting_datetime desc, creation desc",
				),
			}
			for item in items[:5]
		]
	)
	passed = (status == 1 and sle_count == 101 and set(sle_items) == set(items)) or (
		status == 0
		and sle_count == 0
		and not final_queued
		and bool(queue_error)
		and bool(current.get("editable"))
	)
	if not passed and iteration > 0:
		audit.evidence["findings"].append(
			{
				"scenario": "R8",
				"iteration": iteration,
				"reason": "large count terminal state",
				"document": name,
				"responses": [submitted, load, *interference],
				"sql": {
					"status": status,
					"sle_count": sle_count,
					"sle_items": sle_items,
					"queued": final_queued,
					"queue_error": queue_error,
				},
			}
		)
	audit.evidence.setdefault("r8_timelines", []).append(
		{
			"iteration": iteration,
			"document": name,
			"submit_queued": queued.get("queued"),
			"submit_queue_error": queued.get("queue_error", ""),
			"immediate": immediate,
			"terminal_seconds": job_seconds,
			"final_docstatus": status,
			"final_queued": final_queued,
			"queue_error": queue_error,
			"rows_posted": sle_count,
			"rows_expected": len(items),
			"sample_bin_vs_ledger": sample_rows,
			"background_queue_state": queue_state,
		}
	)
	return (
		bool(passed or iteration == 0),
		f"queued={queued.get('queued')}; queue_error={queue_error or queued.get('queue_error')}; "
		f"final_docstatus={status} final_queued={final_queued} SLE={sle_count}/101 "
		f"distinct_items={len(set(sle_items))}/101 editable={current.get('editable')} job={job_seconds}s "
		f"immediate={immediate} sample={sample_rows}",
	)


def _ensure_r8_stock(audit):
	items = audit.manifest.get("r8_items")
	if not items:
		items = audit.direct(lambda frappe: _create_r8_items(frappe))
		audit.manifest["r8_items"] = items
		audit._write_manifest()
	balances = audit.direct(
		lambda frappe: {
			row.item_code: float(row.actual_qty or 0)
			for row in frappe.get_all(
				"Bin",
				filters={"item_code": ["in", items], "warehouse": audit.manifest["AUDIT-LEAF"]},
				fields=["item_code", "actual_qty"],
			)
		}
	)
	for item in items:
		if balances.get(item, 0) > 0:
			continue
		# Stamp with site time; R8 waits two seconds before stamping its count so
		# this receipt is included in that count even when the host clock is UTC.
		site_now = audit.direct(lambda frappe: frappe.utils.now_datetime())
		opened = _create(
			audit,
			"R8-SETUP",
			0,
			item,
			1,
			when=site_now.date().isoformat(),
			posting_time=site_now.strftime("%H:%M:%S"),
		)
		if not _name(audit, opened):
			raise RuntimeError(
				f"opening draft failed for {item}: HTTP {opened['status']} {opened['exc_type']} {opened['message']}"
			)
		result = audit.submit("R8-SETUP", 0, _name(audit, opened), _version(audit, opened))
		if not _succeeded(result):
			raise RuntimeError(
				f"opening submit failed for {item}: HTTP {result['status']} {result['exc_type']} {result['message']}"
			)
	return items


def _create_r8_items(frappe):
	frappe.set_user("Administrator")
	result = []
	for index in range(101):
		code = f"AUDIT-R8-{index:03d}"
		if not frappe.db.exists("Item", code):
			frappe.get_doc(
				{
					"doctype": "Item",
					"item_code": code,
					"item_name": code,
					"item_group": "All Item Groups",
					"stock_uom": "Nos",
					"is_stock_item": 1,
				}
			).insert(ignore_permissions=True)
		result.append(code)
	frappe.db.commit()
	return result


def _ensure_item(frappe, code, tracking="plain"):
	frappe.set_user("Administrator")
	if not frappe.db.exists("Item", code):
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": code,
				"item_name": code,
				"item_group": "All Item Groups",
				"stock_uom": "Nos",
				"is_stock_item": 1,
				"has_batch_no": int(tracking == "batch"),
				"has_serial_no": int(tracking == "serial"),
			}
		).insert(ignore_permissions=True)
	frappe.db.commit()


def R9(audit, iteration):
	room, leaf = audit.direct(lambda frappe: _new_r9_room(frappe, audit, iteration))
	version = audit.direct(lambda frappe: str(frappe.db.get_value("Warehouse", room, "modified")))
	if iteration % 3 == 0:
		operation, method, payload = (
			"move_room",
			"warehouses.move_location",
			{"name": room, "parent": audit.manifest["AUDIT-AREA"], "version": version},
		)
	elif iteration % 3 == 1:
		operation, method, payload = (
			"disable_room",
			"warehouses.set_disabled",
			{"name": room, "disabled": True, "version": version},
		)
	else:
		operation, method, payload = (
			"delete_room",
			"warehouses.delete_location",
			{"name": room, "version": version},
		)
	item = audit.manifest["items"]["plain"]

	def receive_flow(session):
		create_data = {
			"doctype": "Stock Entry",
			"request_id": str(uuid.uuid4()),
			"data": _data(audit, item, 1, warehouse=leaf),
		}
		created = session.call("native_api.create_document", create_data)
		created = audit.record(
			"R9",
			iteration,
			"create_receive",
			created,
			{
				"method": "native_api.create_document",
				"data": create_data,
				"account": session.username,
			},
		)
		name = _name(audit, created)
		if not name:
			return created
		submitted = session.call(
			"native_api.submit_document",
			{"doctype": "Stock Entry", "name": name, "version": _version(audit, created)},
		)
		return audit.record(
			"R9",
			iteration,
			"submit_receive",
			submitted,
			{
				"method": "native_api.submit_document",
				"data": {"doctype": "Stock Entry", "name": name, "version": _version(audit, created)},
				"account": session.username,
			},
		)

	requests = [
		(
			operation,
			audit.session("Inventory Administrator"),
			method,
			payload,
		),
		(
			"submit_receive",
			audit.session("Inventory Administrator"),
			receive_flow,
			None,
		),
	]
	results = audit.fire("R9", iteration, requests)
	iteration_events = [
		event
		for event in audit.evidence["events"]
		if event.get("scenario") == "R9" and event.get("iteration") == iteration
	]
	operation_result = next(event for event in iteration_events if event.get("sequence") == operation)
	receive_result = next(
		(event for event in iteration_events if event.get("sequence") == "submit_receive"),
		next(event for event in iteration_events if event.get("sequence") == "create_receive"),
	)
	location = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Warehouse", room, ["parent_warehouse", "disabled", "warehouse_type", "is_group"], as_dict=True
		)
	)
	leaf_state = audit.direct(
		lambda frappe: frappe.db.get_value(
			"Warehouse", leaf, ["parent_warehouse", "ti_direct_storage", "is_group", "disabled"], as_dict=True
		)
	)
	children = audit.direct(
		lambda frappe: frappe.get_all(
			"Warehouse",
			filters={"parent_warehouse": room},
			fields=["name", "ti_direct_storage", "is_group", "disabled"],
		)
	)
	balance = audit.balance_for(item, leaf)
	receive_success = _succeeded(receive_result)
	mutation_success = _succeeded(operation_result)
	clean = all(
		0 < result["status"] < 500 and (_succeeded(result) or result.get("exc_type")) for result in results
	)
	tree_ok = (not location and not leaf_state and not children) or bool(
		location
		and leaf_state
		and location.warehouse_type == "Room"
		and location.is_group
		and location.parent_warehouse in {audit.manifest["AUDIT-OTHER-AREA"], audit.manifest["AUDIT-AREA"]}
		and len(children) == 1
		and children[0].name == leaf
		and children[0].ti_direct_storage
		and not children[0].is_group
		and leaf_state.parent_warehouse == room
		and leaf_state.ti_direct_storage
		and not leaf_state.is_group
		and (not location.disabled or leaf_state.disabled)
	)
	unsafe = (
		mutation_success
		and receive_success
		and (
			(method == "warehouses.set_disabled" and location.disabled)
			or (method == "warehouses.delete_location" and not location)
		)
	)
	return (
		clean and tree_ok and not unsafe,
		f"operation={operation}; responses={[(r.get('sequence'), r['status'], r['exc_type']) for r in iteration_events]}; "
		f"room={dict(location) if location else None}; children={[dict(row) for row in children]}; "
		f"leaf={dict(leaf_state) if leaf_state else None} tree_ok={tree_ok} balance={balance}",
	)


def _new_r9_room(frappe, audit, iteration):
	from temple_inventory import warehouses

	frappe.set_user("Administrator")
	label = f"AUDIT R9 Room {iteration:03d} {uuid.uuid4().hex[:6]}"
	tree = warehouses.create_location("Room", label, audit.manifest["AUDIT-OTHER-AREA"])
	room = next(
		row["name"] for row in tree["rows"] if row.get("local_label") == label and not row.get("direct")
	)
	leaf = next(row["name"] for row in tree["rows"] if row.get("direct") and row.get("owner") == room)
	audit.manifest.setdefault("r9_locations", []).append({"room": room, "leaf": leaf})
	audit._write_manifest()
	return room, leaf


def R10(audit, iteration):
	item, leaf = audit.manifest["items"]["plain"], audit.manifest["AUDIT-LEAF"]
	opening = _create(audit, "R10", iteration, item, 1)
	if _name(audit, opening):
		audit.submit("R10", iteration, _name(audit, opening), _version(audit, opening))
	loan_draft = _create(
		audit, "R10", iteration, item, 1, "Loan", target=_leased(audit), ti_borrower=f"AUDIT R10 {iteration}"
	)
	loan = (
		audit.submit("R10", iteration, _name(audit, loan_draft), _version(audit, loan_draft))
		if _name(audit, loan_draft)
		else {}
	)
	loan_value = _message(audit, loan)
	if not loan_value.get("name"):
		return False, "loan submission failed"
	line = loan_value.get("items", [{}])[0].get("name")
	ret = _data(
		audit, item, 1, "Return", warehouse=_leased(audit), target=leaf, ti_borrower=f"AUDIT R10 {iteration}"
	)
	ret["items"][0].update(
		{
			"ti_original_loan": loan_value["name"],
			"ti_original_loan_line": line,
			"ti_settlement_outcome": "Returned",
		}
	)
	return_draft = audit.create("R10", iteration, ret)
	if not _name(audit, return_draft):
		return (
			False,
			f"Return draft failed: HTTP {return_draft['status']} {return_draft['exc_type']} {return_draft['message']}",
		)
	responses = audit.fire(
		"R10",
		iteration,
		[
			(
				"cancel_loan",
				audit.session("Inventory Manager"),
				"native_api.cancel_document",
				{"doctype": "Stock Entry", "name": loan_value["name"], "version": loan_value["version"]},
			),
			(
				"submit_return",
				audit.session("Operator B"),
				"native_api.submit_document",
				{
					"doctype": "Stock Entry",
					"name": _name(audit, return_draft),
					"version": _version(audit, return_draft),
				},
			),
		],
	)
	wins = sum(_succeeded(result) for result in responses)
	settled = audit.direct(
		lambda frappe: float(
			frappe.db.sql(
				"select coalesce(sum(abs(line.transfer_qty)), 0) from `tabStock Entry Detail` line "
				"inner join `tabStock Entry` parent on parent.name=line.parent "
				"where line.ti_original_loan=%s and parent.docstatus=1",
				loan_value["name"],
			)[0][0]
		)
	)
	loan_state = audit.state("Stock Entry", loan_value["name"])
	return_state = audit.state("Stock Entry", _name(audit, return_draft))
	leased_balance = audit.balance_for(item, _leased(audit))
	losers = [result for result in responses if not _succeeded(result)]
	clean_loser = all(
		result["status"] in (403, 409, 417)
		and result.get("exc_type")
		and any("\u3400" <= char <= "\u9fff" for char in str(result.get("message") or ""))
		for result in losers
	)
	passed = wins == 1 and clean_loser and settled <= 1 and leased_balance >= 0
	return (
		passed,
		f"successes={wins}/2 settled={settled}/1 leased={leased_balance} loan={loan_state} "
		f"return={return_state} responses={[(r['status'], r['exc_type'], r['message']) for r in responses]}",
	)


SCENARIOS = {f"R{number}": globals()[f"R{number}"] for number in range(1, 11)}
