# Design-preview refinement handoff

Date: 2026-10-13

Status: **V1–V3 follow-up implementation is complete. Automated behavior and
browser geometry checks passed; native browser zoom and final visual approval
remain manual review.** See the linked
[follow-up progress note](20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md)
for current verification and reproduction evidence. The earlier audit below is
historical. Production migration remains pending. No subagents were used.

## Summary and delivery

Refine the isolated design site's dashboard feedback, movement forms, contextual
item creation, and text sizing. Preserve the jade direction and existing workflow
rules.

User-confirmed decisions:

- Support desktop and mobile equally.
- Include multi-select when adding existing items.
- Use a wide desktop dialog and full-screen mobile panel for contextual item creation.
- Provide independent text scaling from 100% through 200%.
- Target this handoff to a **preview implementer**. Use no subagents. This explicit
  user instruction supersedes the repository's implementation delegation rule.

Changes remain in preview-owned components, styles, fixtures, tests, and
documentation. Production components, backend APIs, account preferences, and
generated production assets remain unchanged. All data operations remain local
fixture simulations; do not introduce a stock engine, authentication, or API calls.

Read `AGENTS.md`, `UI_UX_DECISIONS.md`, `DESIGN_SYSTEM.md`,
`DESIGN_MIGRATION_COVERAGE.md`, and `frontend/src/design-preview/README.md` before
implementation. Preserve unrelated working-tree changes. At handoff time the
previous audit task/progress notes were being moved from `notes/` to
`notes/done/`; do not undo those moves.

## Starting points and findings (original pre-implementation baseline)

All component filenames below are relative to `frontend/src/design-preview/`
unless stated otherwise.

- `PreviewDashboard.vue`, `dashboardModel.ts`, and `browse-pages.css` own the six
  dashboard sections. The clear button is currently a grid cell alongside the
  two filter trees, which makes it stretch to their height. Failures use a single
  `failedSection` value and messages near the bottom of cards. Global refresh
  fades the entire grid with opacity.
- `components/PreviewOperationLines.vue` is shared by routed movement forms in
  `PreviewFormPages.vue` and the canonical `PreviewReceive.vue` example. It
  groups by location/item and renders large cards with repeated field grids.
  `PreviewDenseLines.vue` is a separate 30-row gallery mockup, not the working
  operation editor. Do not improve only that mockup.
- `components/PreviewItemPicker.vue` currently combines selection and creation
  in a 480px drawer. Its thumbnail is inline with the item name, a likely source
  of the reported image/text overlap; this was inferred from source, not verified
  in a browser. Creation currently returns a single item through `select`.
- `PreviewOverlay.vue` owns teleporting, focus containment/restoration, body
  scroll locking, and background inertness. Extend it carefully without changing
  unrelated overlay consumers.
- `formModel.ts` owns operation validation and currently returns the first error
  string. `reviewModel.ts` defines `DraftLine`, `ReviewDraft`, and fixture state.
  Preserve existing business checks and document lifecycle behavior.
- `model.ts` owns `PreviewPreferences`, defaults, and the preview-only storage
  key `ti:design-preview:v3`. `PreviewApp.vue` applies preferences and renders
  review controls; `PreviewUtilityPages.vue` renders in-app display settings.
  Current typography is coupled to density: spacious body text is 16px on desktop
  and 18px on mobile. There is no independent text-scale preference.
- `preview.css`, the feature CSS files, and preview component styles contain
  both tokens and literal font sizes. `focusVisibility.ts` already measures
  fixed form summaries and navigation and manages focus visibility.

## Dashboard

### Hover and keyboard feedback

- Give all six section cards a subtle border/shadow change on hover and
  `focus-within`, without movement or layout shift.
- Give actionable metric tiles, distribution bars, and record rows a stronger
  background/border response, visible keyboard focus, and pressed feedback.
- Keep informational cards semantically non-interactive: no added tab stops,
  click handlers, or pointer cursor.
- Preserve failure styling during hover; disabled actions must not appear
  enabled. Respect reduced motion.

### Compact scope actions

- Put warehouse and category filters in their own responsive grid.
- Place `清空范围` in a separate trailing action row, sized to its label rather
  than the available column.
- Disable it when no scope is selected. Retain immediate filter application.
- On mobile, retain the filter drawer, a compact clear action, and `完成`.
  All touch targets remain at least 44px.

### Unambiguous card failures

- Put an icon, `更新失败` label, explanation, and `重试` action directly beneath
  the affected card's heading.
- Label retained content `上次结果 · 尚未更新`. Apply consistent stale styling to
  numbers, labels, tables, and graphics while preserving readable contrast.
- Keep card titles, failure explanations, and recovery controls at normal
  prominence. Do not fade the entire card with opacity.
- Disable stale drill-through actions; preserve usable local filters and retry
  controls.
- Retry affects only that section, shows `正在重试…`, and replaces its retained
  result on success.
- When no successful result exists, show `暂时无法加载` and retry instead of
  fixture values or zero counts.
- Announce failures and retry results accessibly. Unaffected cards remain usable.

Represent loading/failure/retry state per section. Extend the existing preview
controls to demonstrate retained-result failure and failure without prior results.
Preserve global warehouse/category scope, movement-only period scope, and existing
drill-through versus ordinary-navigation behavior. Keep quantities separated by
stock unit.

## Movement forms and nested item creation

### Compact editor for 50 items

Extend `PreviewOperationLines`, shared by routed forms and the canonical receiving
example.

- Use bordered rows and restrained separators instead of a large card around
  every item.
- Group Receive rows by location, then item, with batch allocations beneath the
  item. Show each location heading once.
- Desktop rows align item identity, quantity/unit, applicable locations, and
  actions. Batch, expiry, and other required operation fields occupy a compact
  second row when needed.
- Mobile rows stack identity, quantity/location, then applicable batch/expiry
  fields. Maintain readable labels and 44px touch targets.
- Required fields remain visible. Only optional manufacturing dates, notes, and
  inactive conversion controls may collapse.
- When alternate-unit entry is active, keep the entered quantity/unit and
  stock-unit equivalent visible.
- Preserve thumbnails and image enlargement, using a reserved image column and
  wrapping identity text.

Add a line toolbar containing:

- `添加物品`, existing scanning access, and search by item name, code, location,
  or batch.
- Distinct item and allocation counts.
- `仅看待完善` and an error count with navigation to the next invalid field.

Search changes the displayed rows only. Totals, validation, saving, and
confirmation always use the complete draft. Show `显示 X / Y 行` when filtered.

Keep all 50 allocations mounted without pagination or virtualization. Use stable
line IDs for errors, optional-field state, focus, and navigation. Editing a
location must not unexpectedly reorder the focused row.

On confirmation failure, reveal the first invalid row even if filters hide it,
expand any relevant optional section, and focus the invalid field above fixed
controls. Preserve aggregate stock limits, integer-unit rules, batch rules, loan
references, and explicit confirmation.

Apply the shared compact treatment to its movement consumers while retaining
operation-specific fields: source and destination for Transfer, stock/batch
selection for outbound operations, and outstanding-loan references and outcomes
for settlement. Reconciliation retains its dedicated `PreviewCountWorkspace`
and existing counting semantics; do not replace it with ordinary movement rows.

### Multi-select adding

- Add mode uses checkboxes and a persistent `添加所选（N）` action.
- Selection survives searches and category/location filters. Cancel discards
  uncommitted selection.
- Adding creates one allocation per selected item in selection order, using
  existing location/defaulting rules; incomplete required fields remain visible.
- Do not silently merge with existing allocations.
- Replacing an existing item remains single-select and preserves existing
  group-replacement behavior.
- After adding, clear any line filter that would hide the new rows and focus the
  first new quantity field.
- Scanning retains its existing configuration-and-resume flow.

### Adaptive contextual creation

Retain the drawer for choosing existing items. Choosing `新建物品` changes the
same overlay into:

- A centered dialog up to 880px wide on desktop, viewport-clamped with 24px outer
  margins.
- A full-screen panel below the existing 1024px responsive breakpoint.

Use one overlay and focus trap; never stack a creation dialog over the picker.

- Header: `新建物品` and receiving context.
- Body: identity/category/unit fields, followed by barcode and tracking settings.
  Use two columns where space permits, otherwise one.
- Footer: a primary creation action and `返回选择物品`.
- Keep category/unit creation inline. Preserve default `Nos`, editable unique
  item code, and expiry-implies-batch behavior.
- Preserve the receipt, picker filters, selection, scroll, and unfinished item
  input while switching surfaces.
- In multi-add mode, `创建并选中` creates the catalog item, returns to the picker,
  and adds it to the pending selection.
- Scanner creation and replacement retain their immediate add/replace behavior
  with appropriately labeled actions.
- Closing with unfinished item edits shows an inline discard decision within the
  same surface.
- Clearly explain that created catalog items and supporting records remain if
  the receipt is cancelled.

Repair picker rows using separate thumbnail, identity, and stock-information
areas. Stack stock details below identity at narrow widths or large text sizes.
Long names, codes, and batch descriptions wrap without crossing the image.

Only Receive offers contextual item creation; keep existing eligibility rules
for other operations. Standalone Inventory item creation remains a routed page.

### Internal interfaces

- Extend `PreviewItemPicker` with explicit add-multiple versus replace-single
  modes and a typed multiple-selection event; update all preview consumers.
- Add structured operation issues containing message, optional line ID, and
  field target. Keep `validateOperation()` as a compatibility wrapper returning
  the first issue, using the same underlying validation rules.
- Extend `PreviewOverlay` with an opt-in adaptive creation presentation; existing
  dialog consumers retain their behavior.
- Keep draft search and selection as UI state, separate from stock/document data.

## Larger text throughout the preview

Add `文字大小` to both in-app display settings and the review controls:

**100% · 125% · 150% · 175% · 200%**

- Apply immediately, with a sample sentence and `恢复默认`.
- Preserve the selected density. Scale typography from that density's existing
  baseline; spacing remains governed by density.
- Add a validated `textScale` preference, defaulting to 100%, using the existing
  preview-only storage mechanism. Older preferences without this field continue
  to load.
- Scale body text, headings, labels, navigation, buttons, inputs, badges, errors,
  and supporting text. Convert fixed font-size declarations that would bypass
  the setting.
- Use typography tokens and natural layout, not CSS transforms or CSS `zoom`.
- Controls grow with their text; fixed heights must not clip labels. Preserve
  minimum touch targets.
- Reflow cards, form fields, picker rows, and dialog columns as available space
  decreases. Keep the existing mobile/desktop breakpoint.
- Include teleported menus, dialogs, toasts, sticky controls, and bottom
  navigation in the scaling pass.
- Recalculate existing focus-obstruction measurements after text-size changes.
  Browser zoom remains available.

At 200%, all primary actions, required fields, and recovery controls must remain
reachable without page-level horizontal scrolling. Existing intentional table
scrollports may retain internal horizontal scrolling. Do not hide document
overflow to mask inaccessible content.

## Validation and completion criteria

### Representative fixture

Create a deterministic 50-item receiving example using the real shared editor,
with multiple locations, tracked and untracked items, mixed units, long
identities, and additional batch allocations. Provide an invalid variant with
errors near the beginning, middle, and end. Make both variants discoverable in
the preview review controls/index and document their exact review links here
after implementation. Do not require reviewers to manufacture the fixture by
hand or change ordinary drafts merely by visiting the gallery.

### Automated checks

Cover:

- Dashboard failure isolation, retry, stale drill-through disabling, and scope
  clearing.
- Multi-selection retention, cancellation, replacement, and contextual creation.
- Editing and validation across the full 50-item draft, including hidden-row
  errors and unchanged complete-draft totals.
- State preservation across responsive changes and overlay transitions.
- Text-scale persistence, legacy/default handling, and synchronization between
  both settings surfaces.
- Existing availability, settlement, batch, and unit constraints.

Run focused preview Vitest suites, `pnpm type-check`, and `pnpm design:build`
from `frontend/`. Relevant existing suites include design-preview refinement,
completion, forms, ERPNext, navigation, review, and audit fixes; add focused
behavioral coverage for the new interactions. Update existing expectations where
the approved multi-select creation behavior intentionally changes them. Do not
replace interaction coverage with CSS-source assertions. Format touched files
only. The isolated build writes to `/tmp/temple-inventory-design-preview`; do not
run the production build for this task.

### Manual visual and interaction review

Browser automation requires an explicit request under repository instructions.
The original implementation task did not request it; the user subsequently
requested the Playwright audit documented at the end of this file. Its coverage
is partial. Continue to distinguish recorded browser results from outstanding
manual review using the following checklist.

Start or reuse the isolated preview server with `pnpm design:dev` from
`frontend/`, then open `http://localhost:5174/design-preview.html`. Inspect an
existing listener before starting another server; do not terminate processes
you did not start.

Review at **375, 390, 768, 1024, and 1440px** widths, all three densities, and
**100%, 150%, and 200%** text. Include short viewports and these scenarios:

- Hover and keyboard focus on every dashboard card and actionable tile/row;
  no misleading click affordance on informational cards.
- Open/clear global scope; compact clear action and accessible mobile completion.
- Fail each section with and without retained data; inspect both text and
  graphics, retry locally, and verify unaffected cards still work.
- Add several items across picker filters; cancel, replace, create, and return
  without losing the receiving draft or selection.
- Inspect long item names/codes, images, availability, locations, and batch text
  for overlap at large text sizes.
- Open the 50-item fixture; edit early/middle/last rows, search, filter errors,
  navigate to hidden errors, and verify complete-draft summaries.
- Exercise tracked items, multiple allocations, unit conversion, required fields,
  and explicit confirmation without silently merging allocations.
- Tab and Shift+Tab through forms/dialogs, checking focus containment,
  restoration, and visibility above sticky/fixed controls.
- Resize across 1024px while editing and while the picker/creation surface is
  open; verify retained values, selection, scroll, and sensible focus.
- Change text size while an input is focused. Inspect dialogs, menus, toasts,
  bottom navigation, and summaries for clipping or inaccessible actions.
- Check reduced motion and native browser zoom separately from in-app text
  scaling. Resizing or changing DPR does not establish a native zoom pass.

### Documentation and decision records

Update the UX decision record, migration coverage, design-system notes, and
preview README. Explicitly record the preview-only replacement of drawer-based
contextual creation and the addition of independent text scaling. Preserve the
rule that required movement fields stay visible. Mark production migration as
pending, not approved by this task.

Finish this handoff, or a linked dated progress note, with implemented status,
actual verification results, exact fixture/review links, manual review steps,
and remaining limitations. Do not claim visual verification from unit tests or
an isolated build.

## Delivery status and verification record

- [x] Design decisions agreed with the user and saved for another agent.
- [x] Dashboard feedback, compact scope actions, and per-section failures implemented.
- [x] Shared movement editor and 50-item fixtures repaired after browser review;
      compact identity/allocation layout (V1) and field alignment (V2) verified.
- [x] Multi-select picker and adaptive contextual creation implemented; desktop
      centering preserved and internal two-column/one-column layout repaired (V3).
- [x] Independent text scaling implemented across preview surfaces.
- [x] Focused tests, type check, and isolated build completed; commands/results recorded.
- [x] Durable UX records, coverage, design notes, and README updated.
- [x] Manual review results or explicit outstanding checklist recorded.

At original handoff creation, only source inspection had been performed. The
implementation and independent review records below describe subsequent work;
the final Playwright audit section records the current open follow-up tasks.
Existing audit-note moves are unrelated and must be preserved.

### Implementation evidence — 2026-10-13

Implemented by the primary agent without subagents. Scope is preview-owned source,
styles, fixtures, tests and the requested design records. Production components,
backend APIs, account preferences and generated production assets were not changed.
The staged audit-note moves to `notes/done/` were preserved.

- Dashboard: per-section snapshots, loading/failure/retry, heading-level failure
  and no-prior-result state, readable stale result styling, isolated recovery and
  announcements, disabled stale drill-through, hover/focus/pressed treatment and
  compact separate scope clear/completion actions. Local filters remain usable.
- Movements: the real shared editor uses compact allocation rows, one heading per
  location, reserved thumbnails, visible required/active conversion fields, search,
  item/allocation counts, incomplete-only view and issue navigation. All allocations
  stay mounted. Confirmation reveals hidden invalid rows and optional fields,
  restores focus, and retains full-draft summaries/save/validation. Focused location
  edits retain their grouping anchor until focus leaves the editor. Reconciliation
  retains its counting workspace and semantics.
- Picker: typed ordered multiple-selection event; one allocation per committed
  item without merging; group replacement stays single-select. Receive creation
  switches the existing overlay into the adaptive dialog/panel, preserving input,
  selection, picker filters and scroll. Supporting records stay inline; discard
  stays in the same surface. Scanner creation immediately adds and then requires
  quantity/location configuration before continuing.
- Typography: validated `textScale`, 100–200% in 25% steps, default/legacy handling,
  synchronized settings and preview-local persistence. Density is retained; font
  declarations scale through tokens without zoom/transforms. Controls wrap/grow;
  navigation and focus obstructions are measured after changes, including the
  canonical receiving example and teleported surfaces.

### Exact review links

The existing isolated Vite listener on port 5174 was inspected and reused (PID
495502, `vite --config vite.preview-design.config.ts --open /design-preview.html`).
The preview entry returned HTTP 200 and loaded `/src/design-preview/main.ts`.
No process was started or stopped for this task.

- [50-item valid receiving fixture](http://localhost:5174/design-preview.html#review/movement-form%2FReceive-50)
- [50-item invalid receiving fixture](http://localhost:5174/design-preview.html#review/movement-form%2FReceive-50-invalid)
- [Canonical receiving example](http://localhost:5174/design-preview.html#review/local/receive)
- [Ordinary routed Receive](http://localhost:5174/design-preview.html#review/movement-form%2FReceive)
- [Dashboard](http://localhost:5174/design-preview.html#review/dashboard%2Foverview)
- [Display settings](http://localhost:5174/design-preview.html#review/settings%2Fdensity)

The two review-index samples each contain **50 distinct items and 55 allocations**
(five additional tracked batch allocations), three locations, tracked/untracked
items, mixed stock units, long identities and alternate-unit choices. The invalid
sample has initial errors on allocation IDs ending `line-1`, `line-25`, and
`line-50` (draft positions 1, 28 and 55). Samples create their own fixture catalog
and draft only when explicitly opened; simply visiting the gallery does not
modify ordinary drafts. Sample edits persist for the preview session.

### Actual automated verification

From `frontend/`:

```sh
pnpm exec vitest run tests/design-preview-usability.test.ts tests/design-preview-refinement.test.ts tests/design-preview-completion.test.ts tests/design-preview-forms.test.ts tests/design-preview-erpnext.test.ts tests/design-preview-navigation.test.ts tests/design-preview-review.test.ts tests/design-preview-audit-fixes.test.ts tests/design-preview.test.ts tests/design-preview-pages.test.ts tests/design-preview-browse.test.ts --maxWorkers=2
pnpm type-check
pnpm design:build
```

- **161 tests passed across 11 focused suites**, including 28 new usability
  cases. Tests cover every section's retained/no-prior failure and retry,
  simultaneous failure isolation, snapshot retention, disabled drill-through,
  scope clearing/mobile completion, ordered multi-selection/cancellation,
  replacement, adaptive creation/discard/scroll/focus, scanner configuration,
  all 55 mounted allocations, full-draft totals/save, repeated hidden-error
  confirmation/navigation, optional manufacturing-date focus, stable location
  edits, active conversions, resize retention, preference validation/persistence
  and synchronization. Existing batch/unit/availability/settlement/lifecycle
  constraints passed in the retained suites.
- `pnpm type-check`: passed.
- `pnpm design:build`: passed, 112 modules; output only in
  `/tmp/temple-inventory-design-preview`. The production build was not run.
- Prettier was run on touched TypeScript/Vue/CSS files only.
- The initial test command mistakenly passed `--` to `pnpm test`, running the
  broader suite. It exposed old single-add/retry expectations and the indexed
  route test timeout; these were corrected for the approved behavior and the
  additional fully mounted fixtures. The HTTP server suite could not bind
  `127.0.0.1:5173` in the restricted sandbox (`EPERM`, 10 skipped checks).
  The final focused command above passed; that unrelated HTTP suite was not rerun.
  The existing isolated preview entry was separately checked with HTTP outside
  the restricted network sandbox.

### Outstanding manual review and limits

**At the initial implementation handoff, no browser automation, screenshots,
or manual visual/keyboard/native zoom verification had been performed.** The
subsequent Playwright audit below supplies partial visual evidence and reopens
layout work. Automated tests and the build do not establish visual fidelity or
production parity.

Reuse the existing server, or inspect port 5174 before starting `pnpm design:dev`
from `frontend/`. Open the links above and complete the full **Manual visual and
interaction review** checklist earlier in this document at 375, 390, 768, 1024
and 1440px, all densities, and 100%, 150% and 200% text, including short viewports:

- [ ] Dashboard card/action hover, focus and pressed states; scope clear/complete;
      each retained/no-prior failure, stale graphics/text, local filters and retry.
- [ ] Multi-add across filters; cancel/replace/create/return; preserved receiving
      values, selection, scroll and unfinished creation; catalog survival on cancel.
- [ ] Long identities, codes, photos, stock/location and batch details at larger
      text sizes; primary actions and required fields without page overflow.
- [ ] Valid/invalid 50-item fixtures: early/middle/last edits, searches, pending
      filter, next issue, full totals/save/confirm, tracked allocations and conversion.
- [ ] Transfer/outbound/settlement required fields and existing batch, stock-unit,
      integer, outstanding-loan and explicit-confirmation checks.
- [ ] Tab/Shift+Tab containment/restoration and visibility above sticky/fixed
      controls; resize across 1024px during editing and picker/creation transitions.
- [ ] Text-size change while focused; menus/dialogs/toasts/navigation/summaries;
      reduced motion and a separate native browser zoom pass.

Operations remain local simulations and stock snapshots remain fixture-owned.
The pending counter reports the first actionable issue on each invalid allocation;
fixing it reveals any next constraint on that allocation. Created sample/supporting
records persist only for the current preview session. Production migration and
account text preferences remain pending, not approved.

### Independent implementation review and fixes — 2026-10-13

Reviewed against this handoff without subagents. The core implementation is
present; the following correctness gaps were found and repaired in preview-owned
source:

- Healthy reminder links now check their originating card's state, so an expiry
  card failure cannot silently block reminder navigation.
- Retained loan results include the original whole-record status label. Live
  settlement changes no longer change that label while quantities remain stale.
- Global busy feedback ends when every request has failed. A global refresh of
  a card without prior results does not briefly expose fixture values.
- Dialog keyboard containment ignores hidden/inert/disabled controls and closed
  disclosure contents while including disclosure summaries. Picker creation forms
  have unique IDs. Inline discard decisions receive focus, make background fields
  inert, and hide submission actions until the decision is resolved.
- Structured validation collects line issues even if a document-level field is
  missing; the first submission error remains backward-compatible. Navigating an
  issue reveals its explanation before the first submission attempt.
- Scanning an existing item clears filters hiding the new allocation and focuses
  its quantity. Scanner completion validates against all allocations, so repeated
  scans cannot bypass aggregate availability checks.
- Narrow editor containers stack identity and fields even on desktop. Header tags
  wrap, metric cards have hover feedback, and mobile floating actions/toasts/top
  controls use the measured navigation height at larger text sizes.

Eleven additional behavioral regression cases cover these repairs. No production
or backend files were changed. The unrelated audit-note moves were preserved.
CSS reflow repairs are based on source inspection; the manual visual/keyboard/
native-zoom checklist above remains outstanding. No browser automation was run.

Final verification (from `frontend/`, using the same eleven-suite command in the
original verification section):

- **172 tests passed across 11 suites**, including **39 usability tests**.
- `pnpm type-check`: passed.
- `pnpm design:build`: passed, 112 modules, output confined to
  `/tmp/temple-inventory-design-preview`.
- Prettier applied to review-touched source and tests; `git diff --check` passed.
- No production build, backend checks, or browser automation was run. Manual
  visual/keyboard/native-zoom validation remains outstanding as listed above.

## Playwright visual audit and follow-up tasks — 2026-10-13

**Historical audit status: visual acceptance failed; follow-up implementation was required.**
V1–V3 are repaired by the implementation documented in the linked follow-up note.
The user explicitly requested Playwright inspection and a handoff update only.
No implementation, production assets, tests, or design records were changed in
this audit. No subagents were used. The previous automated results above remain
historical results; they do not establish that the layouts below are correct.
This section takes precedence over earlier claims that the compact editor was
finished or that browser review had not been requested.

### Audit method, coverage, and evidence

Reused `http://127.0.0.1:5174/design-preview.html` with Playwright and system
Chromium headless, with Chinese fonts configured. No preview server was started
or stopped. Used isolated browser state, jade theme, collapsed review controls,
and a 1000px viewport height. Collected screenshots and DOM geometry; inspected
representative screenshots directly.

- Ordinary routed Receive, canonical Receive, 50-item Receive, Movement by
  record, Loans by record, existing-item selection, and contextual creation:
  1440, 1024, and 375px at balanced density / 100% text.
- First 50-item group: additional 390 and 768px widths, compact and spacious
  density at 1440px, and balanced 150% / 200% text at 1440px.
- All nine routed movement kinds: Receive, Issue, Transfer, Loan, Return,
  Damage, Loss, Repair, and Disposal at 1440px. Several initial drafts are empty;
  those checks establish header/toolbar layout, not populated allocation layout.
- Enumerated preview `<label>` and related field-container usage in source;
  swept visible labels/control geometry across all 70 indexed routes at 1440px.
  This included Movement and Loan item/record variants, item forms, inventory,
  warehouses, reconciliation, reports, settings, and setup. This was a route
  sweep, not exhaustive interaction with every conditional or hidden field.
- Opened receiving optional context fields and inline category creation;
  checked contextual creation from both routed and canonical Receive.
- Neither audit script captured a page JavaScript exception. This is not a
  behavioral test-suite pass. No page-level horizontal overflow was found in
  the initial measured cases; substantial internal squeezing still occurred.

Temporary evidence is in `/tmp/temple-inventory-usability-visual/`:
`audit.cjs`, `followup.cjs`, `measurements.json`, `followup.json`, `errors.json`,
`trace.zip`, and screenshots named below. These artifacts may disappear when
the environment is reset; the reproduction steps and measurements in this file
are the durable evidence. Measurements are approximate CSS pixels, rounded.
The scripts filter visible elements where the gallery retains hidden examples.

### V1 — High priority: rebuild genuinely compact movement rows

**Confirmed defects and reproduction:** Open the ordinary, canonical, and
50-item Receive links above. Scroll to the first actual editor row. Repeat at
100% and 150% text without changing density merely to hide the issue.

| Surface / viewport / text        | Observed result                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Canonical Receive, 1440px / 100% | Item-name text width about 14px at 14px font: one Chinese character per line.               |
| Routed Receive, 1440px / 100%    | One tracked allocation occupies about 287px; identity is squeezed into a 180px side column. |
| 50-item Receive, 1440px / 100%   | First item with two allocations is about 666px tall.                                        |
| 50-item Receive, 1440px / 150%   | First group is about 1,988px tall; title collapses to approximately one character per line. |
| 50-item Receive, 390px / 100%    | First group is about 2,170px tall; usable field column is only 154px.                       |
| 50-item Receive, 375px / 100%    | First group is about 1,341px tall; usable field column is only 139px.                       |
| Routed Receive, 1024px / 100%    | Editor row is about 354px wide, split into unintended 228px and 114px columns.              |
| Loan / Transfer, 1440px / 100%   | Short item names also collapse to 14px width; first rows are about 469px / 405px tall.      |

Screenshots: `local-receive-1440.png`, `movement-form-Receive-1440.png`,
`first-row-1440-150-balanced.png`, `first-row-390-100-balanced.png`,
`first-row-768-100-balanced.png`, `form-Loan-1440.png`, and
`first-row-1440-100-spacious.png`.

**Causes verified in source and computed browser layout:**

- `form-pages.css` places `.draft-line` identity beside allocations using
  `minmax(180px, 1fr) minmax(0, 3fr)`. The thumbnail, flexible identity, item
  total, and replacement button compete inside the first column. `min-width: 0`
  plus `overflow-wrap: anywhere` lets the actual name shrink to a single glyph.
  A tall identity then determines the grid row height and wastes allocation space.
- Mobile and container rules reset direct children to `grid-column: 1`, but
  `.preview-operation-lines .draft-line > button { grid-column: 2 }` has higher
  specificity. `添加批次分配` therefore creates an implicit second column.
  Confirmed at 375, 390, 768, and 1024px and in spacious desktop density. The
  175%/200% selectors happen to win; that does not fix 100%/150%.
- The routed form's side summary leaves an especially narrow editor near 1024px.
  In the 50-item sample it also repeats a very long list of allocation identities.

**Implementation tasks:**

- [x] Refactor the real shared `components/PreviewOperationLines.vue` layout,
      not only `PreviewDenseLines.vue`. Keep a reserved thumbnail and give identity
      meaningful width. Let totals and replacement/actions wrap into their own
      area before they can squeeze the name. Use explicit structural classes instead
      of relying on `div:last-of-type` to identify the text column.
- [x] Use a full-width item heading above its compact allocation grid when the
      available editor width cannot accommodate a readable identity beside fields.
      Do not reserve a narrow identity side rail across batch allocations. Keep
      location headings once per group and restrained row separators.
- [x] Put quantity/location and required batch/expiry fields into a compact grid
      that responds to the editor's available width and scaled text. Use one or two
      field rows where they fit, then stack naturally. Keep allocation actions close
      to their allocation and `添加批次分配` in the group action row; neither should
      reserve a large empty column or a disproportionately tall standalone row.
- [x] Correct all explicit grid placements at narrow widths so no implicit
      column survives the single-column layout. Check allocated fields, optional
      sections, action buttons, and newly added batches, not just the heading.
- [x] Reflow the outer summary before it squeezes the editor. For large drafts,
      show item/allocation counts and totals by unit compactly, with an accessible
      disclosure for detailed summary lines. Preserve full detail at confirmation,
      complete-draft totals, and reachable save/confirm controls.
- [x] Preserve full readable names/codes, image enlargement, visible required
      fields, active unit conversion, stable line IDs, editing order, focus/error
      navigation, and all 55 mounted allocations. Do not solve compactness with
      reduced font size, clipping names, hidden required fields, or pagination.

**Acceptance:** At 1440px / balanced / 100%, aim for at most approximately 220px
for the ordinary single tracked allocation and 360px for the fixture's first
long-name/two-allocation group, with optional sections closed. These are visual
review targets, not fixed CSS heights or permission to hide content. At all
specified widths/densities/scales, a name must not become a one-character column
because of sibling controls. At mobile widths, the fields should use the available
row width; inspect computed grid tracks to rule out the phantom action column.
Required controls remain readable, touchable, and reachable above fixed controls.
The 50-item editor must be materially denser while preserving its workflow.

### V2 — High priority: normalize field and toolbar alignment across the preview

**Confirmed examples:**

- Movement **by record** and both Loan item/record views: the status select is
  about 11–12px below the neighboring search, sort, filter, and export controls.
  `PreviewActivityBrowse.vue` mixes a stacked status label/select with bare
  controls in a flex row centered by whole field-wrapper height.
- All routed movement creation toolbars: search input is about 13px below
  `添加物品`; `仅看待完善` places the checkbox above its text. The broad
  `.preview-form-page .form-section label` grid rule overrides the toolbar's
  lower-specificity flex rule. Canonical Receive does not inherit that same
  wrapper, so checking only the canonical surface misses this defect.
- Receiving optional context: `新建活动` stretches to about 69px beside a 40px
  associated-activity input. Return's `加入此借用` has the same mixed
  labeled-field/bare-button pattern. Native date/select fields have inconsistent
  heights, and native labels versus search-select labels use different gaps.
- Contextual creation: code/name inputs start about 6px above the category
  combobox. Standalone item editing also places the unit input below category
  because the disabled unit label inherits a different field treatment.

Screenshots: `movement-records-completed-1440.png`, `loan-records-open-1440.png`,
`receive-date-fields-1440.png`, `receive-optional-fields-1440.png`, and
`creation-category-inline-1440.png`. The indexed-route sweep in `followup.json`
records additional field/control geometry.

**Implementation tasks:**

- [x] Establish explicit preview field patterns: stacked label/control for form
      fields, a compact inline label/control group for toolbar status filters, and
      inline checkbox/radio plus text. Avoid a global rule that forces every label
      into the same layout. Retain visible labels and programmatic associations.
- [x] Align actual inputs/selects/buttons in a toolbar on the same control row,
      with compatible heights. Wrap complete field groups as space decreases.
      Normalize the line-search presentation; keep its label associated with the
      input. Keep checkbox labels beside their controls and give the label a usable
      touch area.
- [x] Normalize label gaps, control sizing, and field wrappers for native inputs,
      dates, selects, textareas, and `PreviewSearchSelect`. Bottom-align action cells
      paired with labeled inputs so buttons do not grow to label-plus-input height.
      Helper/error text must not move adjacent controls out of alignment.
- [x] Audit every preview field consumer, including optional/expanded states:
      `PreviewActivityBrowse`, `PreviewFormPages`, `PreviewReceive`, shared operation
      lines, `PreviewTransactionContext`, category/unit fields, picker/creation,
      scanner, attachments, browse/period/hierarchy filters, warehouse forms,
      inventory/item forms, count workspace, reports/settings/setup, review controls,
      and gallery examples. Use the source label inventory and all indexed routes
      as the starting checklist; fix shared patterns rather than per-page offsets.
- [x] Specifically populate empty outbound/settlement drafts before reviewing
      their allocation fields. Expand alternate units, manufacturing dates, manual
      transaction time, optional context, and inline supporting-record creation.

**Acceptance:** Controls intended to share a desktop row have matching vertical
placement (approximately 2px tolerance for native rendering), without fixing the
problem with arbitrary top margins or blank labels. At narrow widths and large
text sizes, intentional stacking is consistent and labels stay with their fields.
Checkbox/radio text does not drop beneath its own control. Review all nine movement
creation kinds, both Movement browse modes, both Loan browse modes, and secondary
field consumers. Preserve accessible names, validation feedback, and 44px mobile
touch targets.

### V3 — Creation dialog is present; fix its internal layout, preserve the transition

**The centered desktop creation dialog was not missed.** The approved distinction
is implemented and was verified in Playwright:

1. `添加物品` opens **选择物品**, the existing-item selection drawer. At 1440px it
   is 480px wide at the right edge. This drawer is intentional.
2. Clicking **新建物品** inside it changes the same overlay to
   `.preview-adaptive-creation`. At 1440×1000 it is 880×640px, positioned at
   x=280 / y=180, centered. Canonical Receive uses the same centered surface.
3. At 1024px the creation surface remains centered, 880px wide with 72px side
   margins. At 375px it becomes the agreed full-screen mobile panel.

Screenshots: `creation-1440.png`, `creation-canonical-1440.png`,
`creation-375.png`, and `creation-category-inline-1440.png`.

**Actual remaining defect:** The body uses auto-fit 260px columns, resulting in
**three columns** at desktop dialog width, contrary to the agreed two-column
layout. Code, name, and category occupy the first row; unit is stranded on the
next. Inline category creation makes the first row much taller, leaving large
blank areas beneath code/name. Label/control alignment also differs between
native inputs and the shared category/unit fields.

- [x] Cap the desktop creation body at two columns; use one column when available
      space or larger text requires it. Organize code/name, category/unit, then barcode
      and tracking settings in coherent rows. Apply V2's consistent field treatment.
- [x] Give expanded inline category/unit creation a deliberate full-width section
      within the same surface, without inflating neighboring unrelated field cells.
      Preserve unfinished values, supporting records, and return-to-picker behavior.
- [x] Retain the existing centered desktop / full-screen mobile transition and
      one focus trap. Do not convert the existing-item picker into a dialog or add
      another overlay to fix a centering defect that is not reproduced.
- [x] Keep `选择物品` and `新建物品` clearly distinct in header/action wording.
      Recheck routed Receive, canonical Receive, and the 50-item fixture. Check
      replacement and scanner creation entry points as well; these paths were not
      exhaustively exercised in this visual audit.

### Follow-up verification and completion gate

The next implementer must make the preview-only fixes above and update this
handoff with actual results. Preserve the staged implementation and unrelated
note moves. Update the decision record, design-system notes, migration coverage,
and preview README as appropriate when these follow-up changes are implemented;
this audit intentionally changes only the handoff.

- [x] Repeat screenshots and visible-element geometry at 375, 390, 768, 1024,
      and 1440px; all three densities; 100%, 150%, and 200% text. Include the exact
      failing cases above, normal/canonical Receive, the valid/invalid 50-item samples,
      and populated Transfer/Loan/outbound/settlement rows.
- [x] Verify compact rows, non-squeezed identities, no phantom grid tracks,
      aligned field controls, and two-column/one-column contextual creation. Measure
      the visible editor rather than hidden gallery examples. Browser inspection was
      explicitly requested for this audit; follow repository authorization policy
      for any subsequent browser runs.
- [x] Recheck full-draft totals, multi-add/replace, first-new-quantity focus,
      early/middle/last editing, hidden-invalid-row recovery, batch/unit/availability
      constraints, and state retention across resize/overlay transitions. Run the
      focused preview Vitest suites, `pnpm type-check`, and `pnpm design:build` after
      implementation. Add meaningful regressions for changed behavior; source-text
      CSS assertions do not establish layout correctness.
- [ ] Finish the earlier keyboard, short-viewport, sticky-control occlusion,
      reduced-motion, dashboard-state, and native browser zoom checklist. This audit
      does **not** claim those passes or the complete width/density/text cross-product.

**Historical audit verification (before implementation):** Playwright screenshots and geometry captured;
70 indexed routes swept for visible field layout; reported scripts finished with
no captured page exceptions. No implementation fixes were made. Vitest, type-check,
and build were not rerun for this documentation-only change. V1, V2, and V3's
internal-layout work were open at that checkpoint; the follow-up below repairs them.
Production migration remains unauthorized.


## Follow-up delivery — 2026-10-13

V1–V3 are implemented without subagents. Read
[the follow-up progress note](20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md)
for final commands, measured results, screenshot evidence and remaining manual
review. Verification includes 176 focused tests, type-check, the isolated build,
225 shared-layout and 1,540 populated-form geometry records, a 70-route field
sweep, and 39 browser interaction assertions. No automated failures remain.
The earlier audit's measurements describe the previous implementation.

The working shared editor uses full-width identity headings, allocation field
reflow and explicit action regions. Review summaries retain complete item/line
counts and totals per unit, with detailed disclosure and every allocation in final
confirmation. Native/searchable fields use shared stacked/inline/choice patterns.
Contextual creation retains its one-overlay drawer → dialog/panel transition,
limits the body to two columns and uses a full-width category/unit editing host.
Ordinary Receive excludes the isolated large review drafts from default lookup.
Required fields, active conversion, image enlargement, stable IDs, full mounting,
validation and explicit confirmation are preserved. Production source, backend,
account preferences and generated production assets are unchanged.

Review links remain:

- [Ordinary Receive](http://localhost:5174/design-preview.html#review/movement-form%2FReceive)
- [Canonical Receive](http://localhost:5174/design-preview.html#review/local/receive)
- [Valid 50-item / 55-allocation receipt](http://localhost:5174/design-preview.html#review/movement-form%2FReceive-50)
- [Invalid receipt](http://localhost:5174/design-preview.html#review/movement-form%2FReceive-50-invalid)

Native browser zoom must still be checked separately from text scaling. User
visual approval, real device/browser variation and production migration remain
outside automated verification. Do not interpret these preview repairs as approval
for production adoption.


## Independent follow-up review — 2026-10-14

V1–V3 were reviewed and remaining supporting-editor discard/focus,
canonical-confirmation completeness, and required-label alignment gaps were
repaired without subagents. Unsaved category/unit edits are protected even when
item fields are untouched. Canonical and routed confirmations now share complete
allocation details, including automatic-batch expiry and entered-unit quantities.

**Verification:** 180 tests / 12 suites, type-check, and isolated design build
passed; 30 focused browser geometry records and four additional browser regression
scenarios passed with no reported failures/page exceptions. See the
[review record](20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md#independent-follow-up-review--2026-10-14)
for exact scope, evidence, and remaining manual checks. Full native browser zoom,
other engines and final visual approval remain outstanding. Production migration
is still pending.
