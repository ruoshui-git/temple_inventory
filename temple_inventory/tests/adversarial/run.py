"""CLI entry point for the committed HTTP race audit."""

import argparse
import json
import sys
import traceback
from pathlib import Path

from temple_inventory.tests.adversarial.harness import SITE, Audit
from temple_inventory.tests.adversarial.scenarios import SCENARIOS


def _arguments(argv=None):
	parser = argparse.ArgumentParser(description="Run committed native inventory HTTP race scenarios")
	parser.add_argument("--base", default="http://127.0.0.1:8001")
	parser.add_argument("--site", default=SITE)
	parser.add_argument("--only", choices=tuple(SCENARIOS))
	parser.add_argument("--iterations", type=int, default=20)
	parser.add_argument("--setup-only", action="store_true")
	parser.add_argument("--cleanup-only", action="store_true")
	parser.add_argument("--json", dest="json_path")
	return parser.parse_args(argv)


def main(argv=None):
	args = _arguments(argv)
	if args.site != SITE:
		raise SystemExit(f"Refusing site {args.site!r}; only {SITE!r} is allowed")
	if args.iterations < 1:
		raise SystemExit("--iterations must be positive")
	if args.setup_only and args.cleanup_only:
		raise SystemExit("--setup-only and --cleanup-only cannot be combined")
	audit = Audit(args.base, args.site)
	if args.cleanup_only:
		try:
			audit.manifest = audit._read_manifest()
			if audit.manifest.get("site") != SITE:
				raise SystemExit("No audit.localhost audit manifest exists")
			failures = audit.cleanup()
			print(
				f"CLEANUP {'FAIL' if failures else 'PASS'} failures={len(failures)} "
				f"left={json.dumps(audit.evidence.get('left_in_place', {}), ensure_ascii=False)}"
			)
			for failure in failures:
				print(f"CLEANUP ITEM {json.dumps(failure, ensure_ascii=False)}")
		except Exception as error:
			audit.evidence["cleanup_error"] = {
				"type": type(error).__name__,
				"message": str(error),
				"traceback": traceback.format_exc(),
			}
			print(f"CLEANUP FAIL {type(error).__name__}: {error}")
		finally:
			_write_result(audit, args.json_path)
		return int(bool(audit.evidence.get("cleanup_failures") or audit.evidence.get("cleanup_error")))
	try:
		audit.setup()
	except Exception as error:
		audit.evidence["setup_error"] = {
			"type": type(error).__name__,
			"message": str(error),
			"traceback": traceback.format_exc(),
		}
		try:
			failures = audit.cleanup()
			if failures:
				audit.evidence["setup_cleanup_failures"] = failures
		except Exception as cleanup_error:
			audit.evidence["setup_cleanup_error"] = {
				"type": type(cleanup_error).__name__,
				"message": str(cleanup_error),
				"traceback": traceback.format_exc(),
			}
		_write_result(audit, args.json_path)
		print(f"SETUP HARNESS ERROR {type(error).__name__}: {error}")
		return 1
	if args.setup_only:
		_write_result(audit, args.json_path)
		status = "FAIL" if audit.evidence.get("findings") else "PASS"
		print(
			f"SETUP {status} users={len(audit.users())} items={len(audit.manifest.get('items', {}))} leaf={audit.manifest.get('AUDIT-LEAF')}"
		)
		return int(status == "FAIL")
	selected = [args.only] if args.only else list(SCENARIOS)
	for scenario in selected:
		failures = set()
		harness_error = None
		last = ""
		start_event = len(audit.evidence["events"])
		if scenario in ("R7", "R8"):
			try:
				audit.queue_hygiene()
				audit.wait_for_background_idle(f"{scenario} before self-check")
			except Exception as error:
				harness_error = f"background preflight {type(error).__name__}: {error}"
		audit.sequential_mode = True
		try:
			if not harness_error:
				selfcheck_passed, selfcheck_detail = SCENARIOS[scenario](audit, 0)
				if not selfcheck_passed:
					harness_error = f"self-check baseline failed: {selfcheck_detail}"
		except Exception as error:
			harness_error = f"self-check {type(error).__name__}: {error}"
		finally:
			audit.sequential_mode = False
		preflight_events = audit.evidence["events"][start_event:]
		preflight_responses = [event for event in preflight_events if event.get("request")]
		if not harness_error and not preflight_responses:
			harness_error = "self-check made no HTTP requests"
		rejected = [
			event
			for event in preflight_responses
			if event.get("status", 0) >= 400
			and (
				(scenario == "R8" and event.get("rpc") == "counts.save_count")
				or not (
					(
						scenario == "R8"
						and event.get("exc_type") == "DocumentLockedError"
						and event.get("sequence") in ("save_while_queued", "second_submit")
					)
					or (
						scenario == "R8"
						and event.get("status") in (403, 417)
						and "enqueued as a background job" in str(event.get("message") or "")
					)
					or (
						event.get("status") in (403, 409, 417)
						and event.get("exc_type")
						and any("\u3400" <= char <= "\u9fff" for char in str(event.get("message") or ""))
					)
				)
			)
		]
		if not harness_error and rejected:
			first = rejected[0]
			harness_error = (
				f"sequential self-check rejected {first.get('sequence')}: HTTP {first.get('status')} "
				f"exc_type={first.get('exc_type')} message={first.get('message')}"
			)
		audit.evidence.setdefault("self_checks", []).append(
			{
				"scenario": scenario,
				"status": "HARNESS ERROR" if harness_error else "PASS",
				"request_count": len(preflight_responses),
				"error": harness_error,
				"events": preflight_events,
			}
		)
		if harness_error:
			print(f"{scenario} SELF-CHECK HARNESS ERROR {harness_error}")
			print(f"{scenario} HARNESS ERROR 0/{args.iterations} {harness_error}")
			audit.evidence.setdefault("summaries", []).append(
				{
					"scenario": scenario,
					"status": "HARNESS ERROR",
					"failed": 0,
					"iterations": args.iterations,
					"harness_error": harness_error,
				}
			)
			continue
		print(f"{scenario} SELF-CHECK PASS requests={len(preflight_responses)}")
		try:
			if scenario == "R7":
				audit.queue_hygiene()
				audit.wait_for_background_idle(f"{scenario} self-check")
		except Exception as error:
			harness_error = f"background preflight {type(error).__name__}: {error}"
			print(f"{scenario} HARNESS ERROR 0/{args.iterations} {harness_error}")
			audit.evidence.setdefault("summaries", []).append(
				{
					"scenario": scenario,
					"status": "HARNESS ERROR",
					"failed": 0,
					"iterations": args.iterations,
					"harness_error": harness_error,
				}
			)
			continue
		for iteration in range(1, args.iterations + 1):
			findings_before = len(audit.evidence.get("findings", []))
			try:
				if scenario in ("R7", "R8"):
					audit.queue_hygiene()
					audit.wait_for_background_idle(f"{scenario} iteration {iteration}")
				passed, detail = SCENARIOS[scenario](audit, iteration)
			except Exception as error:
				passed, detail = False, f"{type(error).__name__}: {error}"
				harness_error = detail
				audit.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "scenario harness error",
						"message": detail,
						"traceback": traceback.format_exc(),
					}
				)
			last = detail
			if harness_error:
				try:
					audit.queue_hygiene()
				except Exception as queue_error:
					audit.evidence.setdefault("queue_hygiene_errors", []).append(str(queue_error))
				break
			if not passed:
				failures.add(iteration)
				audit.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "scenario invariant failed",
						"detail": detail,
						"request_sequence": [
							event
							for event in audit.evidence["events"]
							if event.get("scenario") == scenario and event.get("iteration") == iteration
						],
					}
				)
			try:
				audit.check_global(scenario, iteration)
			except Exception as error:
				failures.add(iteration)
				audit.evidence["findings"].append(
					{
						"scenario": scenario,
						"iteration": iteration,
						"reason": "global invariant check failed",
						"message": f"{type(error).__name__}: {error}",
					}
				)
			if len(audit.evidence.get("findings", [])) > findings_before and iteration not in failures:
				failures.add(iteration)
			audit._write_manifest()
			try:
				removed = audit.queue_hygiene()
				audit.evidence.setdefault("queue_hygiene", []).append(
					{"scenario": scenario, "iteration": iteration, "removed": removed}
				)
			except Exception as error:
				harness_error = f"queue hygiene {type(error).__name__}: {error}"
				break
		status = "HARNESS ERROR" if harness_error else "FAIL" if failures else "PASS"
		print(f"{scenario} {status} {len(failures)}/{args.iterations} {harness_error or last}")
		audit.evidence.setdefault("summaries", []).append(
			{
				"scenario": scenario,
				"status": status,
				"failed": len(failures),
				"iterations": args.iterations,
				"harness_error": harness_error,
				"last_evidence": last,
			}
		)
	if args.only == "R4" or (args.only is None and "R4" in selected):
		observations = [
			row for row in audit.evidence.get("r4_observations", []) if row.get("iteration", 0) > 0
		]
		groups = {}
		for row in observations:
			key = (row["order"], row["issue_in_flight_at_count_start"])
			group = groups.setdefault(
				key,
				{
					"order": key[0],
					"issue_in_flight_at_count_start": key[1],
					"accepted": 0,
					"stale_rejected": 0,
					"no_adjustment": 0,
					"accepted_baseline_checks": [],
				},
			)
			group[row["outcome"]] += 1
			if row["outcome"] in ("accepted", "no_adjustment"):
				group["accepted_baseline_checks"].append(
					{
						"iteration": row["iteration"],
						"baseline": row["baseline_recorded"],
						"ledger_at_timestamp": row["ledger_at_timestamp"],
						"matches": row["baseline_matches_ledger"],
					}
				)
		matrix = list(groups.values())
		audit.evidence["r4_outcome_matrix"] = matrix
		print(f"R4 MATRIX {json.dumps(matrix, ensure_ascii=False, default=str)}")
	try:
		failures = audit.cleanup()
		if failures:
			print(f"CLEANUP FAIL {len(failures)} unable to cancel/delete")
			for failure in failures:
				print(f"CLEANUP ITEM {json.dumps(failure, ensure_ascii=False)}")
		else:
			print(
				f"CLEANUP PASS left={json.dumps(audit.evidence.get('left_in_place', {}), ensure_ascii=False)}"
			)
	except Exception as error:
		audit.evidence["cleanup_error"] = {
			"type": type(error).__name__,
			"message": str(error),
			"traceback": traceback.format_exc(),
		}
		print(f"CLEANUP FAIL {type(error).__name__}: {error}")
	_write_result(audit, args.json_path)
	return int(
		bool(
			audit.evidence.get("findings")
			or audit.evidence.get("cleanup_failures")
			or audit.evidence.get("cleanup_error")
		)
	)


def _write_result(audit, path):
	if not path:
		return
	target = Path(path)
	target.parent.mkdir(parents=True, exist_ok=True)
	target.write_text(json.dumps(audit.evidence, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
	sys.exit(main())
