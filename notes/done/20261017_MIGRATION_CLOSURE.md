# Migration closure — 2026-10-17

**Done:** migration implementation, including pass 2 at `d732ddc1b5fbf19bc3e85facc4e34a12e29e974a`,
is accepted after the requested brief source review. The user's new UI requests
are subsequent refinement work, not reasons to keep the migration task active.

## Scoped review

- F2: saved export scope uses persisted purpose as well as DocType; Opening Stock
  selects movements while ordinary physical counts retain counts.
- F1: both native editors use the exact linked-activity resolver. It rechecks
  document changes, focus and session restoration, rejects obsolete/account-switched
  responses, and displays an unavailable label when access cannot be verified.
- F3: Quick Export explicitly disables document-link rendering; the shared table
  retains navigable document buttons for its other consumers.
- F4: dashboard fixtures supply item/type/activity context and an explicit
  missing-context scenario through the existing shared production view.

No blocking issue was found in this scoped inspection. This is not a fresh
whole-application audit. The implementing agent's commands/results remain in
[the pass-2 fix record](20261017_DESIGN_MIGRATION_FOLLOWUP_FIXES.md); no automated
tests, browser automation, type checks, linters or builds were run for this review.
Earlier real-device, native-browser-zoom, committed stock-write-race and full-suite
limits remain recorded as unverified. Closure does not claim those checks passed,
nor does it imply deployment or blanket visual acceptance.

## Documentation cleanup

Removed the active migration assignment and mandatory ongoing migration-ledger
updates from AGENTS.md, preserving its unrelated pre-existing edits. Added current
closure notices to the historical handoff, follow-up review and capability ledger.
The UX/design records now identify the old migration/preview workflow as historical.

The user's instruction to discontinue the design-preview site supersedes its
maintenance requirement. This turn is investigation and documentation cleanup only:
preview source, application source, tests and build configuration remain unchanged.
Preview removal should preserve fixtures used by production component tests before
deleting the gallery entry, wrappers, dedicated build/server configuration and
gallery-only tests. Do not delete shared production components or styles based on
legacy `preview-*` names. Historical screenshots and review evidence remain useful.
