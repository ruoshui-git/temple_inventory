# Temple Inventory Claude Code Guide

@AGENTS.md

`AGENTS.md` is the shared source of truth for Codex and Claude Code. Maintain
shared instructions there; keep this file as the Claude Code import entry point
and for Claude-only orchestration notes.

## Delegating implementation to Codex

"Codex Luna" means the Codex model `gpt-6-luna`, the default model of
`scripts/codex-run`. Launch Codex through that script, not through the
`codex:codex-rescue` agent or `/codex:rescue`. The plugin runs without network,
so Codex cannot reach MariaDB or Redis. It also detaches the job, so no
completion notification arrives. `scripts/codex-run` runs Codex on the WSL host
with network and Bench write access, so Codex reaches Bench through
`scripts/dx`. It writes logs under `/tmp/codex-runs/` and saves only the final
report to `NAME.last`.

1. **Brief.** Write the task brief to a scratchpad file. Name the plan or notes
   file, the exact scope, file:line pointers, required validation, and any
   screenshots to capture. Codex reads `AGENTS.md` itself, so do not restate its
   rules. Split dependent work into sequential tasks, and never run two Codex
   tasks at once.
2. **Launch.** Run `scripts/codex-run NAME BRIEF` with Bash `run_in_background`.
   Its exit wakes you, however long the task takes.
3. **Watch.** In the same turn, arm a Monitor on `scripts/codex-watch NAME 20 45`
   with `timeout_ms: 1800000`, and re-arm it on every expiry until it prints
   `DONE`. Heartbeats arrive every 20 minutes.
   - While they report `running`, keep waiting, even for hours.
   - On `STALLED`, `NETWORK reconnecting` or `PROCESS GONE`, investigate.
     Check `tail` of the log and the network, then resume (step 6).
   - Do not sleep-poll or read the log in between.
4. **Read the result.** Read `/tmp/codex-runs/NAME.last`. Read the full
   log only when diagnosing a failure.
5. **Verify.** A Codex report is not verification.
   - Review `git diff` against the brief and the plan.
   - Compare test counts before and after, so deleted tests do not slip
     through.
   - Rerun the validation commands yourself through `scripts/heavy`.
   - Open every screenshot.
   - Run the live acceptance suite when APIs or write flows changed.
6. **Fix rounds.** Run `scripts/codex-run NAME-fix BRIEF --resume SESSION`, with
   the session id from `NAME.session`, so Codex keeps its context. If resume
   reports "already has an active writer", use `--fork SESSION`.
   - Fix trivial blockers yourself, such as a few lines that stop
     verification. Send substantive fixes back to Codex.
7. **After a container restart or outage.** Edits on disk survive, and Codex
   sessions on the host keep running unless WSL itself restarted.
   - Check `git status`.
   - Run `docker compose -f dev/compose.yaml up -d`, which restarts `web` and
     `worker`.
   - Confirm MariaDB with
     `scripts/dx bench --site development.localhost execute frappe.ping`.
   - Resume the session with "continue from your `git diff`".
