# Design migration review fixes

Date: 2026-10-17

Status: **R1–R10 implemented; scoped verification complete.**

Scope: implement R1–R10 from the [independent review](20261017_DESIGN_MIGRATION_REVIEW.md).
The consolidated handoff remains authoritative. Existing user changes to `AGENTS.md`
were preserved. No reset, reseed, core edit, commit or deployment was performed.

## Changes

| Finding | Implemented behavior |
| --- | --- |
| R1 | Shared native validation rejects partial or contradictory settlement metadata before the blank-kind early return. Typed settlements retain source, original-child/item/batch, borrower/activity, outcome, quantity and availability checks; supplied provenance must match. Loan balances independently require a valid submitted Loan, compatible settlement kind/purpose and matching actual source/item. Ordinary untyped ERPNext transfers without app settlement metadata still insert/submit. |
| R2 | `projections.display_columns` defines intentional screen columns for summary, records, grouped and allocation/related tables. Readable names/context and quantities precede secondary audit identifiers. Shared ReportTable excludes internal `id` cells while retaining row identity for rendering/paging. CSV/XLSX writers deliberately continue using full projection audit columns, including native document/child, Item, Batch, warehouse, Activity and loan identities. Screen formatting never changes export values. |
| R3 | Mobile warehouse rows use an icon/label grid and a separate action row, bounded 8px-per-level indentation and 44px actions. Detail headings also stack their action. Room/Location display as 房间/位置 without changing native values. Hierarchy, expansion, selection, protected nodes, details and editing remain. |
| R4 | Operation/count focus measurement accounts for the action bar on ordinary desktop as well as mobile/expanded layouts. The mobile normal-flow summary resets its inherited stacking level so it cannot cover focused action buttons at 200% text. |
| R5 | Receive now uses the final routed form geometry: shared form/main/review, compact date fields and summary, optional supplement disclosure, and one action region. Context, files, personnel and lifecycle remain; recovered/error attachments reveal the disclosure. Compared directly with the pinned `63c7f26` routed Receive screenshots. |
| R6 | Persisted Stock Entry and Stock Reconciliation details expose shared Quick Export. Controller queries use the saved server DocType/name/status, independently of unsaved buffers; missing/forbidden/local-only parents do not export. `recordDoctype` round-trips to the full workspace and is enforced by the shared server query. Removing the record chip clears both identity fields. |
| R7 | Read-only operations show labeled posting date/time, borrower, applicable loan warehouse and amendment provenance. Conflict/busy states retain their input controls and values rather than becoming saved-detail projections. |
| R8 | Shared content uses zero block margins with horizontal auto centering, keeping short/loading/empty lists aligned to the top. |
| R9 | Dashboard restores the visible 物资总览 heading. Recent rows lead with all supplied Item names (operation context as fallback), with native number/date/activity secondary. Existing wrapping handles multi-item/long text. |
| R10 | Shared native timestamp display preserves site wall time and shows minute precision in snapshots, activity audit labels, related browse/count/loan captions and report cells. Exact native modification/version/posting values remain unchanged for APIs, locking and exports. |

The production browser configuration now supports an isolated port, including the
Frappe UI proxy plugin's explicit port setting. This avoids stopping or reusing the
unrelated existing listener on 8080.

## Verification

| Check | Result |
| --- | --- |
| `pnpm test --maxWorkers=2` | 318 passed across 49 files; the final compact-header placement additionally passed all 10 saved-detail/review regressions. |
| `pnpm type-check` | Passed after the final frontend change. |
| `pnpm build`, `pnpm design:build` | Both passed; generated assets produced by Vite, no manual generated edits. Gallery retains its existing large-chunk warning. |
| Targeted Ruff format/check | Passed for all six touched Python files. |
| Native rollback runner | 88 executed: 87 passed, one sample-file case errored with `tabUser` 1020 plus teardown failure; that case passed alone. Both-type/status export scope and all-six-dataset/view/group display cases passed separately after final refinements. |
| Routed production Playwright | 21 passed, including both deterministic camera decoders and track release; controlled API fixtures. |
| Focused gallery Playwright | 12 passed (9 new layout/focus cases plus activity/export/disclosure interactions). The 9 layout/focus cases passed again after the final compact-header adjustment. |
| Live built application | 8 routes × 2 widths = 16 initial loaded observations; 4 routes × 2 widths repeated after header refinement. Zero page exceptions, HTTP failures or document overflow. Both saved details opened scoped export previews; no stock/configuration/preference mutation endpoints were called. Four final saved-export checks explicitly awaited loaded rows and verified exact DocType/name/status in the full workspace. |

Selected durable evidence is in [assets/20261017-design-migration-fixes](assets/20261017-design-migration-fixes):
[desktop Receive](assets/20261017-design-migration-fixes/receive-gallery-desktop.png),
[mobile Receive](assets/20261017-design-migration-fixes/receive-gallery-mobile.png),
[real report columns](assets/20261017-design-migration-fixes/reports-live-desktop.png),
[real deep warehouse labels at 200%](assets/20261017-design-migration-fixes/warehouses-live-mobile-200.png),
[saved Loan metadata/export action](assets/20261017-design-migration-fixes/saved-loan-live-desktop.png),
[saved reconciliation export](assets/20261017-design-migration-fixes/saved-count-export-live-mobile.png),
and [real dashboard](assets/20261017-design-migration-fixes/dashboard-live-desktop.png).
These were directly inspected, together with ordinary/expanded Receive and warehouse
screenshots at 375/1440 and 100/200% in `/tmp/temple-review-fixes/screenshots`.
The pinned `63c7f26` Receive captures from the original review were inspected directly
as the baseline, independently of the changed gallery.

[Live observations](assets/20261017-design-migration-fixes/live-observations.json)
retain the route/width/error/overflow/top-alignment measurements without authentication
state. [Loaded saved-export observations](assets/20261017-design-migration-fixes/saved-export-observations.json)
record the four complete preview/workspace checks; the earlier loading-state
export screenshots were replaced with these loaded captures. Full temporary test logs are under `/tmp/temple-review-fixes-*.log` and
`/tmp/temple-review-fixes/`; durable images and this record do not depend on them.

The rollback native suite exercised 88 cases. One full run passed 87 cases; the last
sample-file case hit the already documented MariaDB 1020 `tabUser` transaction
interference, followed by savepoint teardown failure. That case passed individually.
The final expanded scope regression also passed individually for both DocTypes across
draft/submitted/cancelled states, checking permitted detail/related projections and
preserved audit export columns. Do not describe this as a clean 88/88 single run.

The new native bypass regression covers direct native insert/save/submit, a legitimate
ordinary transfer, and a malformed pre-existing allocation excluded from derived loan
balances. Existing partial normal/damaged/Loss, batch, over-settlement, permission and
cancel/amend scenarios passed in the full run. All test business data was rolled back.

An attempted full 88-case gallery run timed out in its two all-route sweeps under
resource contention; two matrix cases were interrupted and 84 did not run. The final
focused gallery rerun is separate evidence. This does not claim a fresh full-gallery
or exhaustive theme/density/device certification. Initial browser failures from the
old Receive selectors were corrected to assert the restored shared workflow.

Live inspection uses normal login on an isolated development server and real built
assets/APIs, without API mocks. The user explicitly approved this after automatic
review rejected an earlier proposal to mint a privileged temporary session. No minted
session was created. No stock or configuration changes are needed for those checks;
text scaling is applied only to the browser DOM. The normal login is logged out and
the review-owned server stopped afterward.

Remaining verification limits: physical devices/native zoom, two successful committed
concurrent stock writes, and a fresh full gallery matrix. Export worker generation
was not repeated; native writer/permission tests and saved-scope preview/workspace
contracts were exercised. Existing historical worker evidence stays attributed to the
previous progress record.
