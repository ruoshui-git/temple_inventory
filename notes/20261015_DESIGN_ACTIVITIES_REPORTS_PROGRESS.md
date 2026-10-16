# Activities, reports and display implementation progress — 2026-10-15

Status: **Preview implementation complete; automated validation and implementing-agent visual audit complete.**
Production migration and final user visual approval have not occurred. Native
browser zoom remains unverified. This execution record is separate from the
approved handoff, which remains planning evidence.

Subsequent independent review and repairs are recorded in
[20261016_DESIGN_ACTIVITIES_REPORTS_REVIEW.md](20261016_DESIGN_ACTIVITIES_REPORTS_REVIEW.md).
The original results below describe the implementing agent's run; use the later
review for verification of the corrected source.

## Scope and completion

- [x] Read handoff, app AGENTS, UI decisions, design system, migration coverage and prior simplification evidence.
- [x] Implement without subagents; preserve the initially untracked user handoff.
- [x] Stable activity/type reference data, metadata editor, list/detail/create/edit routes, lifecycle and simulated guards.
- [x] Movement cleanup and information displays, preserving allocation/conversion/count/loan semantics and paused input buffers.
- [x] Six report datasets, shared projection/quick reports, historical fixtures, complete scope, numeric flat tables and session presets.
- [x] Update AGENTS, UI decisions/supersessions, design system, migration coverage, README and backend specification.
- [x] Format touched source, run tests/type-check/isolated build and authorized browser checks; inspect screenshots directly.
- [x] Review final diff, scope, limitations and backend dependencies.

Production source, APIs, schemas, database state and generated production assets
are unchanged. No stock engine, attachment store, migration, database reset or
production permission enforcement was implemented.

## Implemented preview

`activityData.ts`, `activityModel.ts`, `activityUiState.ts`, `PreviewActivities.vue`
and `PreviewActivityEditor.vue` provide immutable activity IDs, data-driven ordered
types, separate description/plain-text multiline notes, validation, active/archive
filtering, metadata/version checks, archive/restore/delete, lifetime submitted
movement chips and current loan balances. Existing retired types stay readable.
References survive title edits. Direct and loan-derived relationships retain
origin labels and stable document/line identities. Hidden-reference/deletion and
permission behavior is simulated, not server enforcement.

Activity navigation now carries IDs: `activity-detail/ACT-0002` and
`activity-form/edit-ACT-0002` reopen the intended fixture on reload. The review
index's `selected` variants are canonical review samples. Creation, contextual
create-and-use and editing share one editor; movement buffers/focus are retained.
The opt-in `activity-list/large` sample adds 48 activities, long names/notes/paths,
mixed units, many movement chips and an indirect settlement.

Movement source type and responsible-person state/fixtures/controls are removed.
Receive uses 来源; other operations use 用途. Activity, borrower, optional
recorder/handler/reviewer, remarks and attachments remain. Canonical and routed
Receive share contextual creation. Fixed Item metadata, completed/cancelled
records, counts and allocation/context displays use text/definition lists/tables.
Recovery input uses selectable text plus Copy. Temporary conflicts/busy states
retain input controls and buffers; attachments retain viewing/downloading.

`reportModel.ts`, `PreviewReports.vue`, `PreviewReportTable.vue` and
`PreviewQuickReport.vue` replace the old five-family implementation. Inventory,
Expiry/Batch, Movements, Loans, Activities and Counts share typed projections,
fixed relevant columns, explicit statuses, unit-aware groups, inclusive periods,
independent content/format choices and complete filtered counts. Empty contexts
stay empty; pending exports retain exact item/location scope. Activity stock
scope follows explicit movement/loan references. Activity related-record posting
period/search/type/status remain separate from Activity start dates. Mixed-unit
loan records and allocation/settlement tables remain numeric and traceable.

Historical Inventory uses independent fixed checkpoints/events: opening 120,
incoming 40, outgoing 10, signed adjustment -3, closing 147. The transfer's two
warehouse branches net to zero in combined scope; receipt cancellation/reversal
nets to zero. Warehouse A-01 closes at 117 and A-02 at 30. Contributing documents
open a scoped drill-through dialog. Nothing is reconstructed from current stock.

The shared 快速报表 action is available on the reportable browse/detail pages,
Dashboard dataset chooser and saved counts. It preserves source scope, defaults
to XLSX, offers explicit CSV tables/optional related data, previews at most five
rows, carries context to full Reports and supports opt-in failure/retry. Output
is explicitly simulated: no file generation or production request. Named views
and per-dataset filters are in memory for the preview session, not account data.

## Commands and actual results

Run frontend commands from `frontend/`.

| Command | Actual result / evidence |
| --- | --- |
| `pnpm exec vitest run tests/design-preview*.test.ts --maxWorkers=2` | **239 passed, 15 suites**; `/tmp/activities-vitest-final.log`. Includes HTTP entry isolation and 30 new activity/report cases. |
| `pnpm type-check` | Passed; `/tmp/activities-typecheck.log`. |
| `pnpm design:build` | Passed, 145 modules; final output under `/tmp/temple-inventory-design-preview`; `/tmp/activities-build.log`. No generated production assets. |
| Prettier on touched frontend files only | Passed; formatter logs under `/tmp/activities-*-format.log`. |
| `git diff --check` | Passed after final edits. |

The HTTP/socket tests and Chromium/Vite runs required approved sandbox escalation.
The first non-escalated HTTP suite failed to bind a socket; the escalated runs
passed. No backend integration run was needed or performed.

Browser runs all used `playwright.design-preview.config.ts`, isolated ports and
`FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf` with the existing Noto
Sans CJK font. No unrelated listener was terminated.

| Browser command / output | Actual result |
| --- | --- |
| Full dedicated suite, port 5196, `/tmp/temple-inventory-activities-final` | **58/60 passed**. Both failures referenced the retired 工具 label. The two assertions were updated to 更多 and passed in the confirmation run below. `/tmp/activities-browser-final.log`. |
| New Activities/report spec excluding route sweep, port 5197, `/tmp/temple-inventory-activities-recheck` | **9 passed**; matrix/lifecycle/quick reports, repaired headings, empty/loading/error states, completed information display, history drill-through and named views. |
| Corrected navigation plus focused report/display checks, port 5198, `/tmp/temple-inventory-activities-confirm` | **6 passed**, including both previously failing save/reopen scenarios and More navigation. `/tmp/activities-browser-confirm.log`. |
| Final information-state/history checks, port 5199, `/tmp/temple-inventory-activities-final-check` | **2 passed** at phone/desktop after draft-table spacing cleanup. |
| New spec excluding route sweep, port 5200, `/tmp/temple-inventory-activities-navigation-final` | **10 passed**, including immutable activity URLs, reload and ID-based editing. `/tmp/activities-browser-navigation-final.log`. |
| Final density/text matrix, port 5201, `/tmp/temple-inventory-activities-text-final` | **4 matrix tests passed**: four widths × three densities × three text sizes. `/tmp/activities-browser-text-final.log`. |

Representative final matrix command:

```sh
DESIGN_PREVIEW_PORT=5201 \
DESIGN_PREVIEW_RESULTS=/tmp/temple-inventory-activities-text-final \
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf \
pnpm exec playwright test --config playwright.design-preview.config.ts \
  tests/browser/design-preview/activities-reports.spec.ts --grep 'density and text matrix'
```

Earlier intermediate runs exposed harness selector/default-overlay issues, old
contract assertions, a missing fixture line ID and an incorrect unlinked-activity
test expectation. These were corrected; their failures are not presented as
passing evidence. Source was kept unchanged during final browser runs. The final
full unit suite is green. The complete browser suite was not rerun as a single
64-case command after the focused repairs; affected scenarios and the final
matrix were rerun as recorded above. There are no known unresolved test failures.

## Visual review and repaired findings

The route sweep visited **all 75 registered routes plus local Gallery, Inventory
and Receive at 375 and 1440px**: 156 screenshots. I directly inspected the 20
labeled contact sheets at
`/tmp/temple-inventory-activities-final/contact-sheets/routes-{375,1440}-{01..10}.jpg`,
with original screenshots for detailed checks.

Shared/high-risk coverage: **375/768/1024/1440px**, compact/balanced/spacious,
**100/150/200% application text**. The existing suite additionally exercised all
nine operation editors, 50-item allocations, virtual options, conversion editing,
keyboard/focus return and save/reopen. New checks covered long activity names,
multiline markup-as-text notes, many movement chips, loan tabs, archive/delete
blockers, quick-report failure/format choices and historical contributions. Page
exceptions and unexpected production API requests are test failures; none remain
in passing scenarios. Reduced motion was enabled in the matrix.

Directly inspected originals include:

- Initial route originals for mobile Movement records, desktop Inventory, Activity
  list/large list/editing and mobile Reports.
- `activities-recheck/screenshots/repaired-movement-heading-375.png`,
  `repaired-drafts-375.png`, `historical-table-375.png`, `historical-drill-1440.png`
  under the corresponding `/tmp/temple-inventory-...` output root.
- `/tmp/temple-inventory-activities-final-check/screenshots/`:
  `repaired-drafts-375.png`, `completed-display-375.png`,
  `activities-error-375.png`, `historical-table-1440.png`.
- `/tmp/temple-inventory-activities-navigation-final/screenshots/`:
  `historical-375-200.png`, `activity-detail-1440-spacious-200.png`.
- Final corrected text geometry:
  `/tmp/temple-inventory-activities-text-final/screenshots/activity-detail-1440-spacious-200.png`
  and `activity-detail-1024-balanced-200.png`.

Repairs from inspection: eliminate duplicate Movement quick actions; retain a
readable browse heading; provide the missing loan-record detail action; constrain
draft identities/actions to readable columns inside a scrollport; use relevant
report columns; show actual history tables/drill-through; make movement-total
columns scale with text (13em minimum) rather than crowd at 200%; remove pointer/
hover treatment from static account/stock surfaces. Chinese glyphs render correctly.

Review URLs used by browser runs were `http://127.0.0.1:<isolated-port>/design-preview.html`.
For an ordinary preview server, useful hash suffixes are:

- `#review/activity-list%2Factive`
- `#review/activity-list%2Flarge`
- `#review/activity-detail%2FACT-0001`
- `#review/activity-form%2Fnew`
- `#review/reports%2Finventory` (choose historical view)
- `#review/reports%2Floans`, `#review/reports%2Factivities`, `#review/reports%2Fcounts`

These URLs require a running isolated preview server; no server hosting or
publication is claimed by this task.

## Limitations and production dependencies

No known unresolved preview visual/interaction issue remains in reviewed cases.
**Native browser zoom was not verified**; application text scaling is different.
Other browser engines, real mobile devices and final user visual approval remain
separate review. Contact sheets establish route-level inspection; they do not
claim exhaustive screenshots of every possible combination of every dialog/state.

Backend work is specified in
[20261015_ACTIVITIES_REPORTS_BACKEND_REQUIREMENTS.md](20261015_ACTIVITIES_REPORTS_BACKEND_REQUIREMENTS.md):
Activity Type reference DocType and Activity Link/notes/lifecycle fields; coordinated
Workspace/Stock Entry/Activity metadata cleanup; server permission/version and
transactional Desk/API deletion guards including hidden references; ERPNext-ledger
historical quantities and native reversal semantics; complete scalable permission-
filtered exports with stable allocation IDs/related data; and per-account presets.
Fixture simulations do not prove those integrations or enforce server permissions.
ERPNext remains the inventory source of truth.

## Resume / handoff

Implementation and validation above are complete. Do not repeat the preview task
or start a production migration automatically. If revising this implementation,
inspect `git diff` and this note, preserve the user-provided handoff, and run checks
proportionate to the revision. No commits, pushes, deployment or database changes
were performed.
