# Independent Activities and Reports implementation review — 2026-10-16

Scope: review the implementing agent's working tree against the approved
[handoff](20261015_DESIGN_ACTIVITIES_REPORTS_HANDOFF.md), repair preview gaps,
and independently exercise the browser and inspect screenshots. No subagents.
Production code, schemas, APIs, database state and generated production assets
remain unchanged. The original handoff is preserved as planning evidence.

Status: **Independent review and preview repairs complete. All final automated
checks passed.** Native browser zoom and final user visual approval remain
unverified; production migration is still pending.

## Findings and repairs

Nine focused report regression cases now cover:

1. Historical search must restrict balances and contributing ledger rows.
   Item/location restrictions also apply; ledger matching includes item/unit,
   not only warehouse. Grouping retains the original location balance table.
2. Loan allocation IDs must use the original line index before filtering.
3. Settlement matching must use loan plus allocation identity, including an
   indirect Activity relationship when the settlement's own Activity is blank.
4. Borrowing rows are not settlement events; missing original-line references
   stay missing instead of silently becoming line zero. Fixtures with known
   references now explicitly provide them. Grouped settlements use group columns.
5. Activity loan balances require canonical item/unit/loan/allocation fields.
   Grouping separates units, retains detail and master tables, and shows actual
   borrowed/returned/damaged/lost/outstanding measures instead of empty columns.
6. Grouped Activity records retain allocation details and related master rows.
7. Incomplete related-record custom dates must block the projection/export.
8. Inventory location detail grouped by item needs summary columns, without
   empty location/batch columns.
9. Movement document quantity summaries must distinguish DocType plus name,
   including when two document types happen to have the same name.

Additional interaction and presentation repairs:

- Supplementary report tables formerly stopped at 30 visible rows without a
  continuation. Each now has Load more and displayed/total counts. Quick Report
  retains its deliberate five-row preview; export projections remain complete.
- Inventory/Expiry/Counts no longer offer an ineffective Activity filter.
  Activity loan grouping offers applicable Activity/Item groups.
- Quick Report table selection resets if its selected table is no longer
  available. Scope text now includes snapshot semantics and previously omitted
  source/destination, Activity, loan-outcome, count and allocation restrictions.
- Activity Quick Report uses the list's modification-time ordering. Archive
  updates use the same timestamp format and modification attribution as edits.
  Activity type labels participate in both list and report text search.
- Lifetime movement chips clear stale related search/date/status restrictions
  through shared state. A browser test exposed separate cached list/detail
  component instances, so clearing a local ref alone was insufficient.
- Activity tabs support arrow/Home/End keys, roving focus and labeled panels.
- Screenshot inspection exposed a mobile date button sticking over other report
  controls. Activity/report date controls now remain in normal flow; existing
  movement browse behavior is preserved.
- Supplemental warehouse/attachment columns have translated column headings.

Backend documentation now calls out explicit original-allocation joins, retained
grouping details, historical scope and document-type identity. This documents
future requirements; frontend fixtures are not permission or deletion enforcement.

## Validation evidence

Final source verification:

- Browser: **67 passed, 0 failed, 0 skipped, 0 flaky**, in 8.1 minutes.
  Command from `frontend/`:
  `DESIGN_PREVIEW_PORT=5211 DESIGN_PREVIEW_RESULTS=/tmp/activities-independent-final FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf pnpm exec playwright test --config playwright.design-preview.config.ts`.
  Machine-readable results: `/tmp/activities-independent-final/results.json`;
  log: `/tmp/activities-independent-final.log`.
- `pnpm type-check`: passed; `/tmp/activities-independent-types-final.log`.
- `pnpm design:build`: passed, 145 modules; output remains isolated under
  `/tmp/temple-inventory-design-preview`, not generated production assets.
  Log: `/tmp/activities-independent-build-final.log`.
- Prettier check on all source/test files changed during this review: passed.
- `git diff --check`: passed.
- `pnpm exec vitest run --maxWorkers=2`: **578 tests passed in 74 files**,
  54.83 seconds; `/tmp/activities-independent-unit-bounded.log`.
  jsdom's existing media `pause()` notices were non-failing.

Early evidence is deliberately distinguished from final results:

- The eight initially added correctness tests all failed before repairs and
  passed after repairs. A ninth verifies settlement event/line semantics.
- An earlier full frontend run passed 577 tests in 74 files before the final
  ninth regression and small presentation corrections.
- Initial restricted runs could not bind the local test/Vite server. Authorized
  reruns use loopback listeners outside the restricted sandbox.
- A later full unit run competing with Chromium hit timeouts and was stopped;
  final unit verification uses bounded workers. Interrupted browser runs while
  fixes were still being made are not claimed as completed acceptance runs.

## Visual review

The initial independent phone/desktop route sweeps produced 156 screenshots
(75 registered routes plus three canonical local examples at each width).
All 14 route contact sheets were inspected directly under
`/tmp/activities-independent-browser/contact-{375,1440}-{0..6}.jpg`.
Full-resolution checks additionally covered Activity list/detail and long notes,
historical tables at 200% text, grouped loan balances, loaded details and Quick
Report overlays. Chinese fonts render correctly using
`FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf`.

Final browser coverage includes all 75 registered routes plus three canonical
examples at both 375px and 1440px. Shared high-risk screens were exercised at
375/768/1024/1440px, compact/balanced/spacious density and 100/150/200% application
text scaling. Final full-resolution screenshots directly inspected include:

- `/tmp/activities-independent-final/screenshots/independent-grouped-loans-375.png`
  and `independent-grouped-loans-1440.png`: corrected group columns, unit separation,
  and mobile controls in normal flow.
- `independent-loaded-details-375.png`: detail rows after loading beyond 30.
- `independent-quick-report-375.png` and `independent-quick-report-1440.png`:
  bounded table preview, readable scope/format controls and reachable actions.
- `route-375-reports-activities.png`, `activity-detail-375-balanced-200.png`
  and `completed-display-375.png`: wrapping controls, multiline notes at enlarged
  text, and plain information display without disabled metadata inputs.

The filenames without directories above share
`/tmp/activities-independent-final/screenshots/`. Table horizontal scrolling is
intentional; the document itself must
not overflow. Screenshots supplement geometry assertions rather than replace
them. Native browser zoom is not verified; 150/200% application text scaling is
not equivalent. Final user visual approval and production migration remain
outside this review.
