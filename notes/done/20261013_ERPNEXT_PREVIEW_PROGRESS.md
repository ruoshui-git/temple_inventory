# ERPNext-native preview refinement — resumable implementation

## Authority and boundaries

User approved the revised plan on 2026-10-13. Preview + documentation only;
no production behavior/API/database edits, no reset, no subagents or browser
automation. Starting working tree clean. Read AGENTS.md, UI_UX_DECISIONS.md,
DESIGN_SYSTEM.md and DESIGN_MIGRATION_COVERAGE.md before continuing.

Latest migration direction supersedes compatibility-first planning: prefer a
clean database/API/UI; this is rapid development and the database may be reset
during the later UI/UX migration. Do not build legacy adapters merely to preserve
workspace IDs. This round does not authorize executing a reset.

## Acceptance / work order

- [x] Durable decision index, capability ledger and future-agent instructions.
- [x] ERPNext document identities; editable Desk-origin drafts; external-change
      lifecycle examples; one transaction = one stock document, Return excludes Loss.
- [x] Nos defaults; shared searchable selections, hierarchy and richer item/batch
      pickers; explicit contextual creation.
- [x] Dedicated selective/full-location count workspace with unreviewed/zero,
      not-found, baseline refresh and re-review.
- [x] Structured context, multi-loan compatible returns, scan configuration,
      in-memory attachments/barcodes, warehouse and setup workflows.
- [x] Browse analysis/loading/retry, preferences/access and migration coverage.
- [x] Focused Vitest, type-check, isolated build; record actual results.
- [ ] Human review (not automated): 375/768/1024/1440, all densities, keyboard,
      200% zoom. Remains pending until a person performs it.

## Architecture / resume map

frontend/src/design-preview/reviewModel.ts owns shared fixtures and transaction
state; formModel.ts owns operation validation; PreviewFormPages.vue routes forms;
PreviewOperationLines.vue owns line allocation; PreviewItemPicker.vue contextual
catalog creation. browseModel.ts and PreviewActivityBrowse.vue own projections.
PreviewBrowsePages.vue and PreviewStockDetails.vue own catalog/location detail.
PreviewUtilityPages.vue owns tools/reports/setup. Keep --p-* styling isolated.

Target transaction identity is (Stock Entry | Stock Reconciliation, ERPNext name).
Workspace must never own the stock document. Production currently blocks Desk
editing of workspace records and opens direct entries read-only: document these
as backend prerequisites, do not remove production guards in this preview task.
Loan metadata belongs on Stock Entry header/lines; returns reference borrowing
document + line; loss is a separate explicit transaction. Stock fixtures remain
a snapshot, never a second stock ledger.

## Checkpoint log

### 0 — started

- Confirmed clean tree; reviewed existing decisions, prior progress and source.
- Created this file before implementation. No tests run yet.

### 1 — models and routed workflows wired

- Added decision index UX-01–09, migration capability ledger and agent maintenance
  instructions. Clean migration/reset preference supersedes compatibility.
- Replaced saved fixture transaction IDs with ERPNext-style IDs; added document
  origin/version/saved state and external lifecycle review component.
- Return rejects lost allocations; lines retain loan IDs. Compatible multi-loan
  picker and separate loss contract implemented in fixture model.
- Added shared searchable selector and wired unit, item/activity filters, item
  picker, warehouse and operation allocation fields. Nos default added.
- Added counting workspace, structured activity context, local attachments,
  scanner mock, setup/repair, browse analysis/result states.
- `pnpm type-check` passes at this checkpoint. First 3 focused suites: 17 passed,
  6 failed (old native-select/mixed-loss assertions + a fixture missing now-required
  borrower/activity). Updating tests and completing integration; not yet complete.
- Next: lifecycle projection consistency, contextual selections, remaining
  searchable fields, new regression suite, full focused checks and docs evidence.

### 2 — continuation and final review

- Honored the current no-subagent instruction over repository delegation guidance.
  Preserved the prior round's changes; preview/docs/tests only.
- The interrupted working tree was not runnable: missing operation script block,
  missing result-state closing tag, truncated utility template and a batch type
  mismatch. Repaired each, then updated obsolete native-select and mixed-loss tests.
- Completed shared selectors, hierarchy/contextual creation, richer stock/batch
  choices, scan allocation/continuous mode, and real in-memory local attachments.
  Categories persist in the shared fixture session; catalog creation survives
  receipt deletion. Existing item units/tracking remain immutable on edit.
- External lifecycle uses saved snapshots across remounts; dirty copies remain
  visible. External submission uses saved lines, deletion stays blocked after
  session recovery, cancellation reverses loan outcomes, and amendment creates
  a linked new document. Extra Desk fields survive edits. Borrowing movement and
  loan projection share the same Stock Entry identity; unsupported Purchase Receipt
  has accurate type/name and a Desk link instead of a stock editor.
- Dedicated count workspace covers selective/full leaf scope, unreviewed/zero,
  not-found, location-change confirmation, retained counts and baseline re-review.
  Refreshed full scope includes new rows; removed baseline rows become zero.
- Completed filtered analysis/pagination/retry, linked separate Loss, structured
  activity/purpose/source/personnel, warehouse restrictions/Room default leaf,
  reviewed setup repair, and confirmed-versus-failed preference examples.
- Added the ERPNext regression suite; expanded coverage evidence and corrected
  current README claims. Prettier applied only to changed frontend files.
- Interim checks passed: 9 component/fixture suites / 114 tests, type-check,
  isolated design build (103 modules, `/tmp/temple-inventory-design-preview`).
  HTTP isolation first failed at the sandbox loopback listener (EPERM); the
  network-enabled rerun passed all 10 tests. No browser automation was run.
- Final checks follow the last identity/settlement guard refinement. Manual visual
  review remains unperformed at all specified widths/densities, keyboard and zoom.

### 3 — validated completion; human review pending

- Final full component/fixture run: `pnpm test tests/design-preview.test.ts
  tests/design-preview-browse.test.ts tests/design-preview-forms.test.ts
  tests/design-preview-pages.test.ts tests/design-preview-navigation.test.ts
  tests/design-preview-refinement.test.ts tests/design-preview-completion.test.ts
  tests/design-preview-review.test.ts tests/design-preview-erpnext.test.ts`
  — **9 suites / 115 tests passed**. The new suite contains 22 regression cases.
- After the final lifecycle status-label clarification, the affected forms and
  ERPNext suites were rerun — **2 suites / 28 tests passed**.
- `pnpm test tests/design-preview-server.test.ts` — **10 HTTP isolation tests
  passed** with local-network-enabled execution after sandbox EPERM. These are
  HTTP assertions, not browser automation.
- Final `pnpm type-check` passed. Final `pnpm design:build` passed: 103 modules,
  output only `/tmp/temple-inventory-design-preview`. Changed frontend files were
  formatted with Prettier.
- Scope audit: 39 changed files, all preview source/tests and design/progress docs.
  No production behavior, APIs, packages, database, reset or generated production
  assets changed. No production build, backend integration tests, subagents or
  browser automation were run.
- All scoped implementation/check items are complete. Next required step is human
  review at 375/768/1024/1440px in compact/balanced/spacious density, keyboard and
  200% zoom. Leave that checkbox open until reviewed. Backend adoption, permissions,
  private-file verification and migration/reset remain separate work; the ledger
  names those prerequisites and does not claim production parity.

### 4 — independent review of uncommitted implementation (2026-10-13)

Reviewed the approved plan, changed preview models/controls/forms, migration
ledger and previous validation. Production/API/database scope remains unchanged.
Found and fixed these functional gaps directly (no subagents):

- New count reused a completed fixed-ID draft. New counts now receive distinct
  ERPNext-style IDs; returning to the cached new-count page after completion also
  creates a fresh draft while preserving the completed document.
- Direct Desk reconciliation opened from Movement discarded book/count quantities
  and difference reasons. The adapter now preserves them and selects the correct
  count location, document type and reconciliation editor.
- Deleting an invalid scanned allocation left scanning permanently paused.
  Removing that allocation now releases the configuration gate.
- Unknown-barcode creation opened the generic picker and lost the code. Receive
  now opens item creation directly with the barcode retained; the existing
  receive-only creation restriction and Nos default remain.
- Drafts exposed source/destination filters without applying them and used exact
  category equality for parent categories. All criteria now apply to the same
  contributing line with hierarchy-aware category/location matching.
- A focused combobox could not reopen by click after selection, and consumed
  Escape even when closed. Click reopens it; first Escape closes suggestions,
  second Escape can close the enclosing dialog.

Added seven regression scenarios (ERPNext suite now 29 tests), including cached
navigation, direct-document values, scanned-line removal, unknown-code creation,
keyboard propagation and combined draft filters. Full run: 8 suites passed;
ERPNext suite initially had one new assertion using an unsaved document ID (UI
correctly showed 未保存). Corrected that fixture to saved; focused rerun pending
below. Type-check passed. Isolated build pending below. Manual review remains
unperformed, and previous HTTP isolation checks were not rerun because entry or
server configuration did not change.

Final review also found confirmation could make failed/pending attachments
immutable. Added a completion guard and eighth regression: uploading must finish,
failed files must be retried/removed, transaction draft saving remains available.
The first seven regression scenarios passed (29 ERPNext tests); rerunning all
nine suites, type-check and isolated build after this final guard.

### 5 — independent review validation complete

- Final run: `pnpm exec vitest run --maxWorkers=2` with all nine component/fixture
  suites listed in checkpoint 3 — **9 suites / 123 tests passed**. ERPNext suite
  now has **30 tests**, including eight added review regressions.
- The attachment test initially asserted before pressing the dialog's final
  confirmation; corrected it to exercise both confirmation steps. One concurrent
  full-page traversal exceeded its 5s timeout while build/type-check also ran.
  Final suite run used two workers without competing build/check processes and
  passed; no timeout or test coverage was relaxed.
- Final source `pnpm type-check` passed. `pnpm design:build` passed, 103 modules,
  output only `/tmp/temple-inventory-design-preview`.
- Review fixes are formatted. Existing uncommitted implementation was preserved;
  no commits, production/API changes, database operations, subagents or browser
  automation. HTTP entry isolation was not rerun (unchanged server/entry paths).
- Design aligns with ERPNext identity/one-document transactions, searchable
  contextual choices and clean migration preference. The concrete gaps above are
  fixed. Manual visual/viewport/density/keyboard/zoom approval remains pending;
  do not infer visual approval from these automated results.
