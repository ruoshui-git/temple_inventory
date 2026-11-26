# Claude Code guide

@AGENTS.md

## Delegating work

You orchestrate; Codex agents write most of the code. Your own job is planning, briefs, review and every
write to shared environments (commits, pushes, migrations, resets, deploys).

1. **Plan first.** For any non-trivial change, investigate, then present a plan (what changes, user-visible
   effects, open questions as concrete choices) and wait for explicit approval before implementing.
2. **Delegate through T3 Code.** Call `orchestrator_capabilities` once per thread, then `delegate_task`, one
   task per independent piece; parallel tasks are fine when their files do not overlap.
   - Models: personal account `codex` → `gpt-6-luna` only; workspace accounts `codex_ws1`..`codex_ws4` →
     `gpt-6.2-sol` or `gpt-6-luna`.
   - Prefer fast mode for Codex (`serviceTier: priority`). Claude subagents never run in fast mode.
   - Use `isolation: "worktree"` when another orchestrator may be working on the repo. When none is (you
     own the checkout), delegates may work directly in the main checkout if their files are disjoint.
   - Do not poll a running delegate; wait for its notification.
3. **Write a brief file** in the scratchpad for each task, and point the task text at it. It contains:
   - the goal and the user-visible behaviour wanted, including the user's exact decisions;
   - **owned files** (may edit) and **forbidden** files/dirs; no commits, no subagents, no calls to
     staging/production/remote hosts, no credentials or backups;
   - test data: work on copies, never on live data or a running service the user uses (use other ports);
   - acceptance: the tests to add, expected numbers, lint/format/test commands, browser checks at named sizes;
   - report format: changes per file, test counts, open doubts, worktree path; leave the work uncommitted.
4. **A delegate's report is not verification.** Read every diff, rerun lint and the full test suite, compare
   test counts, and check the result in a browser yourself. Then start a fresh `delegate_task` as an
   independent reviewer (brief + diff + what to look for). Fix small findings yourself; re-delegate only
   larger ones.

[docs/agents/codex.md](docs/agents/codex.md) keeps the verification checklist and the older
`scripts/codex-run` workflow (fallback when T3 tools are unavailable); where it conflicts with this
section (fast mode, launch method), this section wins.
