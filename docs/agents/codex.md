# Codex delegation and verification

1. **Brief.** Save a scratchpad brief with the exact owned and do-not-touch files, task context, relevant file:line pointers, required validation and screenshot requirements. Require screenshots under `test.info().outputPath()` or `/tmp/codex-runs/NAME-shots/`, never committed paths. Route shared documentation edits through the orchestrator in `/tmp/codex-runs/NAME-docs.md`. Split dependent tasks into sequential work; parallel tasks need disjoint files.
2. **Launch.** Run `PATH="$HOME/.local/bin:$PATH" scripts/codex-run NAME BRIEF` with Bash `run_in_background`; do not enable fast mode. Codex uses `scripts/dx` for container tools and leaves changes uncommitted because its sandbox keeps `.git` read-only.
3. **Watch.** In the same turn, monitor `scripts/codex-watch NAME 20 45`. Re-arm after each expiry until `DONE`. While running, keep waiting. For `STALLED`, `NETWORK reconnecting` or `PROCESS GONE`, inspect the log and connectivity before resuming; do not poll the log between heartbeats.
4. **Read the result.** Read `/tmp/codex-runs/NAME.last`; read the full log only to diagnose a failure. Check `.last` for “could not run”.
5. **Verify independently.** A Codex report is not verification. Review the diff against the brief and task plan; compare test counts before/after; rerun the required validation through `scripts/heavy`; open every screenshot. Codex has reported completion with blank or loading-state screenshots. Compare test edits to intent: it has weakened assertions or changed deliberate design to agree with an audit note. Run live acceptance for API/write-flow changes. Build before `pnpm test:browser`, which routes the built bundle.
6. **Fix rounds.** Start `scripts/codex-run NAME-fix BRIEF --resume SESSION` using `NAME.session`. If resume reports an active writer, use `--fork SESSION`. Fix trivial blockers yourself; send scoped substantive fixes back to Codex and re-verify.
7. **After an outage.** Check `git status`; edits on disk survive ordinary container restarts, and host Codex sessions survive unless WSL restarted. Confirm safe service state with the orchestrator before bringing services up. When safe, run `docker compose -f dev/compose.yaml up -d`, confirm MariaDB with `scripts/dx bench --site development.localhost execute frappe.ping`, then resume from the current `git diff`.

## Brief and review notes

- Name both owned and do-not-touch files; mention concurrent tasks and expected documentation changes.
- Request screenshots in a temporary or test output location. Never commit screenshots or reports.
- Review every diff, test count and screenshot. Do not accept a claimed visual result without opening the images and checking that real data loaded.
