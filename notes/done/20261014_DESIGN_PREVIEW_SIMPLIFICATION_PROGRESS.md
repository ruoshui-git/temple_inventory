# Design preview simplification — execution progress

Date: 2026-10-14. Scope: preview only; no subagents. Approved scope is in
`20261014_DESIGN_PREVIEW_SIMPLIFICATION_HANDOFF.md`; that file is planning evidence.

## Current checkpoint

**Independent review, repairs and automated verification are complete.**
Final results: **209 preview unit tests / 14 suites, 52 Chromium tests, type check
and isolated design build passed.** All changes remain in the
standalone preview, test configuration/tests and documentation. No production
components, API code, database data or generated production assets were changed.
The existing implementation and user comparison images were preserved.

## Work checklist

- [x] Compact allocation rows, Details and hidden-error focus
- [x] Expanded workspace and consolidated actions
- [x] Recorded conversion state, staged unit editor, permissions/conflicts
- [x] Warehouse disclosures, navigation and related page simplification
- [x] Measured virtual selectors, thumbnail repair, opt-in 1,000 items
- [x] Interaction suites, type check and isolated build
- [x] Final dedicated preview Playwright interaction/matrix run
- [x] Complete screenshot review and evidence record

Native browser zoom and final user visual approval remain separate manual checks.
The checkpoints immediately below are historical, not the final review result.

## Implementation checkpoint — core surfaces

Compact row editor, Details/conversion subeditor, recorded conversion fields,
workspace layout mode, warehouse disclosures, Tools count entry, Movement quick
filters, report selector, detail disclosures and virtual selectors implemented.
Type check passed at initial checkpoint. Regression update in progress: first run
165/180 passed; remaining failures included superseded permanent-field assertions.
Next run 177/180 passed; fixed missing alternate UOM fixtures and Details opening
focus race. Browser automation uses explicit port 5186 to avoid the existing 5174
listener, and needs sandbox escalation for local sockets. Initial browser run found
and fixed a conversion initialization error. Preview tests must target the visible
editor because canonical Receive remains mounted on routed pages.

Current logs: `/tmp/simplification-{vitest,typecheck,browser,format}.log`.
Do not claim final validation yet.

Latest core regression pass: **195 tests / 13 suites**, type check passed. Three
real Chromium interaction scenarios passed (conversion checked save/failure/discard;
large ordered picker with retry/create-return; hidden quantity error and resize).
Compact rows now move split/group replacement into Details. Canonical expanded
layout is being checked independently; do not count the full geometry matrix yet.


## Independent review and repairs — 2026-10-14

The resumed review inspected the implementation against the approved handoff and
ran Chromium directly. The initial implementation was incomplete at browser
verification. Real defects found and repaired:

1. Desktop quantity controls consumed excessive space and repeated inline labels.
   Quantity now uses approximately 7ch plus padding, its unit stays adjacent, and
   headings/rows share column geometry. Details and concise removal actions fit
   together. Expanded sections no longer distribute spare height between controls.
2. Mobile large-text styles kept the entire summary fixed, covering the editor.
   Only the save/review area is fixed now; the summary scrolls normally. Canonical
   Receive now exposes Save Draft as well as review. Notifications no longer
   intercept these buttons.
3. Reopening imported Desk movement rows dropped entered quantity/unit and factor.
   These fields now round-trip. Imported draft rows remain visible until an
   editable draft owns their projection, preventing duplicate draft rows.
4. Reusable Item conversions incorrectly validated a fictitious one-unit movement,
   rejecting valid fractional factors for integer stock units. Reusable factor
   validation is separate from movement quantity validation. Whole-stock checks
   tolerate floating-point representation error without accepting real fractions.
   Applying while a new UOM name is unsaved now blocks instead of discarding it.
5. Item conversion editing lacked a guarded close flow and could retain state for
   a different Item. Editing now uses a modal side/full-screen panel with explicit
   discard handling and a stable return-focus trigger. Read-only Item edits disable
   reusable conversion editing. Allocation conversion Apply restores its trigger.
6. The opt-in large fixture selected templates from the growing live array, causing
   generated names to recursively include earlier names. Fixtures now clone stable
   templates and remain idempotent. The 50-Item fixtures use the same stable source.
7. Virtual-row focusout could unmount a stock-details button between pointerdown
   and click. The last focused row now remains mounted through focus transfer.
   Hidden zero-size measurements no longer invalidate row heights; stock details
   and return preserve selection and restore visible focus.

Browser specifications also contained two incorrect expectations: save/reopen
selected a hardcoded Transfer draft instead of the Receive just saved, and export
assertions used a label/message that did not match the actual controls. These now
assert the saved document identity and actual export scope/format behavior.

### Verification scope

The dedicated suite includes 36 geometry cases: 375/768/1024/1440 CSS pixels ×
compact/balanced/spacious × 100/150/200% application text size. Each visits ordinary
Receive, canonical Receive, valid/invalid 50-Item fixtures, Transfer and loan Return,
then checks the picker. Details/conversion and expanded workspace are exercised.
The 50-Item fixtures contain 55 allocations, all kept mounted. Geometry assertions
check document overflow and intersecting row/dialog regions.

Additional browser workflows cover all nine operation editors at phone/desktop
widths, add/edit/remove/split, scanner fixtures, hidden error reveal, save/reopen,
complete confirmation, warehouse disclosure defaults/persistence, UOM creation,
checked/unchecked reuse, fractional/integer rules, permissions/save conflicts,
recorded factors after Item defaults change, Item-level cancel/save, 1,000-Item
selection/filter/create/retry, 150-unit keyboard navigation, Tab/Shift+Tab, Escape
precedence, reduced motion, focus restoration, resize retention, count navigation,
Loan/Return filters and report export scope/format. Tests fail on page exceptions
or unexpected production API requests. All operations use isolated local fixtures.

### Commands and artifacts

Commands run from `frontend/`:

```sh
pnpm exec vitest run tests/design-preview*.test.ts
pnpm type-check
pnpm design:build
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf \
DESIGN_PREVIEW_PORT=5197 \
DESIGN_PREVIEW_RESULTS=/tmp/temple-inventory-design-review-final \
pnpm exec playwright test --config playwright.design-preview.config.ts --workers=4
```

Touched frontend files were formatted with Prettier; `git diff --check` is included
in the closing checks. Local sockets/Chromium required the environment's sandbox
escalation. CJK screenshots use the already available Noto Sans CJK font via the
listed fontconfig file. No unrelated listener was stopped. Port 5187 is the isolated
inspection server; the final automated run uses 5197 with listener reuse disabled.

- Unit log: `/tmp/simplification-review-unit-complete.log`.
- Type/build logs: `/tmp/simplification-review-types-complete.log`,
  `/tmp/simplification-review-build.log`.
- Browser log: `/tmp/simplification-review-browser-complete.log`.
- Machine-readable results:
  `/tmp/temple-inventory-design-review-final/results.json`.
- HTML report: `/tmp/temple-inventory-design-review-final/report/index.html`.
- Screenshots: `/tmp/temple-inventory-design-browser/screenshots/`.
- Isolated build: `/tmp/temple-inventory-design-preview/`.

Earlier failed/interrupted runs were diagnostic; they are not final passes.
The final result summary and inspected screenshots are recorded below.

### Backend work remains documentation-only

- Add permission-filtered search, stable pagination/counts and stock/batch detail
  retrieval with stale-response protection for the virtual selectors.
- Round-trip native Stock Entry qty/uom/conversion_factor/stock_uom/transfer_qty
  through workspace save/read/history; preserve recorded factors independently of
  current Item defaults. Compute and validate stock quantities on the server.
- Separately authorize UOM creation and reusable Item UOM Conversion Detail writes;
  handle duplicate units, Item version conflicts and save failures explicitly.
  Preserve unrelated Item fields and stock UOM.
- Enforce precision/finiteness, whole-number constraints, aggregate stock limits,
  remaining loan quantities and canonical loan document/line references server-side.
- Keep ERPNext stock documents and normal submission/cancellation/amendment as the
  source of truth. No extra ledger or stock schema is needed for disclosure,
  workspace expansion or virtualization.

Review links (while the isolated inspection server is running):

- Ordinary Receive: `http://127.0.0.1:5187/design-preview.html#review/movement-form%2FReceive`
- Large Receive: `http://127.0.0.1:5187/design-preview.html#review/movement-form%2FReceive-50`
- Item: `http://127.0.0.1:5187/design-preview.html#review/item-detail%2Foverview`

Native browser zoom and final user visual acceptance are not claimed. Application
text scaling and viewport emulation were tested; production/backend migration was
intentionally excluded by the user's scope.


### Final verification result

- **209/209 unit tests across 14 preview suites passed.** The focused simplification
  suite was also rerun after the final focus repair: **19/19 passed**.
- **52/52 Chromium tests passed in the final clean run** (about 3.5 minutes):
  36 matrix tests and 16 interaction tests. No retries, skips, page exceptions or
  unexpected production API requests. The machine-readable report records zero
  unexpected/flaky/skipped tests.
- `pnpm type-check`, `pnpm design:build` and `git diff --check` passed. The build
  wrote only the isolated `/tmp/temple-inventory-design-preview` output. Touched
  frontend source/specs were formatted with Prettier.
- Reviewed the final diff boundaries: only preview source, its tests/configuration
  and docs changed; production browser discovery only excludes the new preview
  specs. The user's comparison images remain untouched.

Directly inspected final screenshots (under the screenshot directory above):

- `ordinary-50-1440-100.png`: ordinary large receipt, compact quantity/unit columns,
  aligned headings and collapsed independent warehouse summaries. The numeric field
  measures about 82px at balanced 100%; long names wrap instead of clipping.
- `review-Receive-1440.png`: expanded ordinary receipt, adjacent row actions and
  persistent save/review. `review-Transfer-375.png`: mobile extra-location workflow
  and navigation clearance.
- `workspace-50-1440-100.png`, `workspace-50-1440-200.png` and
  `workspace-50-375-200.png`: large expanded editor, natural large-text reflow and
  reachable fixed actions. Long names deliberately increase row height.
- `review-virtual-375-200.png`: last selected Item in the 1,000-Item picker after
  stock-detail return; visible focus target and preserved selection. The repaired
  fixture names are bounded and thumbnail/text regions remain separate.
- `review-conversion-1440-200.png` and `review-conversion-375-200.png`: desktop drawer
  and mobile full-screen Details/conversion, readable wrapped text and keyboard
  focus above the footer.

There are no known unresolved failures in the authorized preview scope. Native
browser zoom and final user visual approval remain unverified manual checks;
backend and production changes remain intentionally unimplemented.
