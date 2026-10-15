# Design-preview simplification and unit-conversion handoff

Date: 2026-10-14

Status: **Approved implementation plan (planning-time record).** Implementation
and independent verification are recorded in
[the execution progress note](20261014_DESIGN_PREVIEW_SIMPLIFICATION_PROGRESS.md).
This handoff preserves the approved scope; it is not validation evidence.

## Authorization and boundaries

- Implement only the standalone design preview, its fixtures, tests, browser-test
  configuration and documentation. Document required backend changes; do not
  implement them or change production components, APIs, ERPNext/Frappe core,
  database records or generated production assets.
- **No subagents.** The user's explicit instruction supersedes the implementation
  delegation rule in `AGENTS.md`; the receiving agent implements directly.
- **Browser automation is required for this task.** The user explicitly requested
  it on 2026-10-14. This satisfies the exception in `AGENTS.md` that permits
  browser automation when specifically requested. It replaces the earlier plan's
  browser-automation exclusion. Run automated checks, fix failures and record
  evidence; do not leave browser checking solely to the user.
- Preserve unrelated work, including the user-provided comparison images in
  `notes/current-design-ui.jpeg` and `notes/odoo-in-form.jpeg`.
- Read `AGENTS.md`, `UI_UX_DECISIONS.md`, `DESIGN_SYSTEM.md`,
  `DESIGN_MIGRATION_COVERAGE.md` and `frontend/src/design-preview/README.md` first.
  Prior implementation context is in
  [the usability handoff](done/20261013_DESIGN_PREVIEW_USABILITY_HANDOFF.md) and
  [follow-up progress](done/20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md).
- Preserve the jade direction, balanced default, all density presets, independent
  text scaling, 1024px responsive surface boundary, Chinese UI, keyboard access,
  44px mobile targets and readable mobile text.
- Keep fixture operations local. Confirmation may update sample documents but
  must not create a parallel stock engine or call production services.

## Goal and approved choices

Make large movements substantially easier to scan and edit through compact rows
and progressive disclosure, then apply the same treatment to related browse,
detail and reporting pages without removing capabilities.

The user selected:

- Inline editing plus Details; **one row per allocation**, not one row per Item.
- A desktop side panel for Details and a full-screen mobile panel.
- An expanded line editor that fills the available workspace.
- Warehouse summaries initially collapsed except for a single warehouse with at
  most five allocations.
- One new `盘点调整` entry under Tools.
- Loan/Return events remain in Movement; simplify their prominent filters.
- Apply targeted simplification across all related design pages in this pass.
- Contextual unit/conversion editing applies to the current allocation, with
  **保存为此物品的常用换算 checked by default**.

The previous rule that all required fields remain permanently visible is
superseded in the preview: secondary required fields may live in Details, with
visible incomplete indicators and automatic reveal/focus on validation failure.
Record this change explicitly in the durable UX decisions and coverage ledger.

## Implementation starting points

All paths in this section are relative to `frontend/src/design-preview/`.

- `components/PreviewOperationLines.vue` is the working editor shared by routed
  forms and canonical Receive. `PreviewDenseLines.vue` is only a gallery example;
  changing that example alone does not deliver this task.
- `PreviewFormPages.vue`, `PreviewReceive.vue` and
  `components/PreviewAllocationSummary.vue` own surrounding form/review behavior.
- `components/PreviewItemPicker.vue` renders every matching Item, followed by all
  location and batch details. Its local grid reserves a 48px thumbnail, while
  `preview.css` sets `.picker-row .product-art` to 72px by 60px. Remove that
  conflicting geometry, including its effects on other picker consumers.
- `components/PreviewUnitField.vue` creates UOM names and whole-number settings.
  It does not configure Item conversions. The operation editor can select only
  existing `StockItem.alternateUnits`; it cannot create conversions.
- `model.ts`, `reviewModel.ts`, `formModel.ts` and `workflowModel.ts` own fixture
  types, document snapshots and validation. Current conversion display derives
  entered quantity from stock quantity and the Item's current factor; replace
  that dependence with recorded line conversion state.
- `PreviewActivityBrowse.vue` shares Movement/Loans browsing;
  `PreviewInventory.vue`, `PreviewBrowsePages.vue` and `PreviewUtilityPages.vue`
  own other affected surfaces. `PreviewApp.vue` and `navigation.ts` own repeated
  count shortcuts and the Tools hub.
- Reuse `PreviewOverlay.vue` focus/scroll/inert behavior and
  `focusVisibility.ts`. Preserve activation/deactivation cleanup and retained
  form state. Add preview-owned components/utilities where needed.

## 1. Compact movement editor

- Replace nested mini-form cards with lightweight location headings and aligned
  allocation rows. Desktop columns: thumbnail/item identity, quantity/unit,
  applicable source/destination, compact batch/status summary, Details and remove.
  Use shared column headings and accessible per-control names.
- Numeric input width is approximately `7ch` plus control padding; the unit
  selector is adjacent. Allocate remaining width to identity and locations.
  Long values and scaled text must reflow rather than clip. Do not force a fixed
  row height to meet density goals.
- Keep quantity and primary locations editable inline. Details contains batch,
  expiry, manufacturing date, conversion and secondary operation-specific fields.
  Keep compact batch/expiry, return outcome and borrowing-reference context in
  rows where applicable.
- Ordinary Details edits update the same draft immediately. Closing retains those
  edits and restores row focus and list scroll. The staged unit-conversion
  subeditor described below has its own Apply/discard semantics.
- Retain split/add allocation, group replacement, removal, scanning, unknown-code
  creation, image enlargement and all operation-specific controls. Preserve
  existing allocation IDs and prevent focused location edits from moving the row.
- Show incomplete indicators before opening Details. Error navigation must reveal
  a hidden row, clear obstructing search/incomplete filters, open the necessary
  Details section and focus the invalid control above fixed actions.
- Preserve complete-draft totals/validation regardless of displayed filters.
  Keep stock, batch, integer-unit, loan-reference and settlement validation.
- Mobile uses compact stacked rows with labels and 44px targets. The editor stays
  mounted across responsive transitions and expanded-workspace toggles.
- `展开工作区` fills the available application workspace, hiding surrounding form
  sections and the review rail. Retain line toolbar, totals and save/review
  actions. Restore prior layout, focus and scroll when exiting. This is an
  application layout mode, not the browser Fullscreen API.
- Keep all editable allocation rows mounted; virtualization below applies to
  selectors, not this editable surface. Consolidate duplicate save/review controls
  into one responsive action area. Preserve document/session/conflict feedback.

## 2. Contextual units and conversions

### ERPNext findings and intended mapping

ERPNext separates the global UOM name, the Item's reusable conversion and the
transaction row's factor. In Desk, reusable factors are configured at
**Stock → Item → UOM → UOM Conversion Details**. Native Stock Entry Detail stores
`qty`, `uom`, `conversion_factor`, `stock_uom` and calculated `transfer_qty`.
Stock Entry calculates `transfer_qty = qty × conversion_factor`; line-specific
conversion is native ERPNext behavior, not a frontend-only inventory mechanism.

References inspected during planning:

- [ERPNext: Purchasing in Different UoM](https://docs.frappe.io/erpnext/purchasing-in-different-unit)
- [ERPNext: Unit of Measure](https://docs.frappe.io/erpnext/uom)
- Local `erpnext/stock/doctype/stock_entry_detail/stock_entry_detail.json` and
  `erpnext/stock/doctype/stock_entry/stock_entry.py` (`set_transfer_qty`, item-detail
  population retaining supplied alternate-unit factors).
- Local `erpnext/stock/get_item_details.py` (`get_conversion_factor`) and
  `erpnext/stock/doctype/item/item.py` (Item conversion validation).
- Our `temple_inventory/workspace_api.py` currently resolves factors only from
  Item conversions and rejects unconfigured units. Native line-factor support
  therefore needs a future custom-backend change, documented below.

### User flow

- Show one editable entered quantity with a compact searchable unit selector.
  Prefer the stock unit and configured alternate units; offer
  `选择其他单位 / 新建单位`.
- For alternate units show a concise equivalent: `3 箱 · 折合 30 件`. Do not show
  two competing editable quantities in the row.
- Selecting a unit without a confirmed conversion opens `单位与换算` within the
  existing Details panel, with no stacked modal. Show selected unit, read-only
  stock unit, `1 箱 = [10] 件`, live quantity preview and the checked option
  `保存为此物品的常用换算`.
- Create units inline with name and whole-number setting. A packaging factor is
  specific to the selected Item; do not write a global Box-to-Nos conversion.
- Prefill known Item conversions. Known standard conversions may be suggested but
  require confirmation when establishing a new Item relationship. Unknown factors
  remain unset; never silently use 1. Stock-unit factor is always 1.
- `应用换算` commits staged unit/factor changes. Checked means save the reusable
  Item factor as well; unchecked means apply only to this allocation. Existing
  Item-factor replacement shows old/new equations and uses
  `更新常用换算并应用` as the action label.
- Supporting-record saves are explicit and survive cancelling the movement,
  consistent with contextual Item/category creation. Guard unapplied edits on
  leaving the conversion editor, preserving input on failure. Do not silently
  downgrade a failed reusable save to line-only success.
- Switching configured units preserves stock quantity and recalculates entered
  quantity. Explicit factor editing preserves entered quantity and previews the
  changed stock quantity before Apply. Never silently round invalid fractions.
- Make conversion available for all movement kinds, including loan settlements.
  Reconciliation still counts in stock units. New Item creation chooses its base
  stock unit directly and requires no conversion from that unit to itself.
- Add collapsible `计量单位与换算` to Item details/editing for reusable conversions.
  Existing Item stock units remain immutable through movement editing.

### State and validation

- Extend preview allocation and document snapshot types to record entered
  quantity/unit and conversion factor, retaining stock quantity/unit for existing
  aggregation. Centralize conversion arithmetic to avoid double conversion.
- Update save/reopen, duplication/amendment, review, history and export projections
  together. Submitted records and existing draft lines retain recorded factors
  when Item defaults change; newly selected conversions use the current default.
- Reset incompatible conversion state on Item replacement. Preserve factor and
  entered quantity through Details close, picker transitions and responsive changes.
- Require positive finite factors and valid precision, entered-UOM whole-number
  rules and stock-UOM whole-number rules. Validate aggregate stock limits and
  remaining loan quantities in stock units.
- Model denied UOM creation, denied Item update, duplicate units, stale Item
  updates and save failures. Disable unauthorized reusable saving with a clear
  explanation; using permitted existing units must remain available.

## 3. Summaries, navigation and related pages

- Movement summary: independent warehouse disclosures, each header showing Item
  and allocation counts plus unit-separated totals. Initially expand only if
  there is one warehouse and at most five allocations. Retain subsequent manual
  choices; draft edits must not repeatedly reset disclosures.
- Final confirmation exposes all allocations, including entered quantity,
  recorded factor, stock equivalent and applicable batch/location/settlement
  details. Keep complete quantities separated by stock UOM.
- Move the sole **new** `盘点调整` entry to `工具 → 工作工具`. Remove repeated page
  header actions. Preserve existing count drafts, records and indexed examples;
  their continuation links are not duplicate creation shortcuts.
- Movement retains Loan/Return events in results, totals, analysis and exports.
  Quick filters become `全部、入库、出库、调拨`; expose all remaining types through
  the type filter and show selected values as removable chips. Keep existing
  multi-type combinations and view-specific filtering semantics.
- Loans owns outstanding balances and settlement actions. Preserve links to stock
  events and period-based borrowing/return history, with origin filters and scroll.
- Inventory/Expiry: keep search, scan, filters, view switch and common stock
  actions visible. Disclose sorting, analysis and export through labeled tools.
  Active filters and result counts stay visible.
- Movement/Loans: show concise headline counts; put detailed type/outcome totals
  behind a summary disclosure, retaining lifecycle labels and unit separation.
- Detail pages: keep identity, status, quantities and primary actions visible;
  disclose supplementary metadata, attachments and history with counts.
- Reports: replace persistent descriptive report cards above results with a
  compact report selector. Keep required scope and applicable date/expiry controls
  visible; disclose secondary filters and field descriptions. Preserve all report
  families, complete-result totals, export scope and independent format selection.

## 4. Large selectors and thumbnail repair

- Add a preview-local virtual-list utility for Item selection and large flat
  searchable option lists, activated above 100 matches. Do not virtualize editable
  movement allocations or hierarchical filter trees in this pass.
- Render a measured-height window with overscan. Recalculate after width/text
  changes; preserve scroll anchors and keep the focused row mounted. Keyboard
  navigation must bring offscreen target options into view before focusing them.
- Keep ordered pending Item selections by stable ID outside rendered rows.
  Preserve selection across scrolling, filtering, creation and return. Retain
  single-replacement behavior separately from multi-add.
- Search the complete fixture dataset. Model initial loading, empty results,
  failed additional loading and retry without losing selection or prior results.
- Picker rows show thumbnail, name/code and available quantity; disclose full
  location/batch information within the same picker surface. Preserve list state
  when returning from that detail view.
- Remove conflicting 72px artwork sizing from the reserved 48px slot. Use explicit
  checkbox, thumbnail, text and action regions, with shrinkable/wrapping text.
  Cover actual images, illustrations, loading, missing and broken-image states.
- Add an opt-in 1,000-Item fixture, including long Chinese names, mixed units and
  varied location/batch counts. Do not seed it into ordinary flows automatically.
  Retain existing valid/invalid 50-Item movement fixtures.

## 5. Backend requirements to document, not implement

- Permission-filtered full-dataset search with stable pagination, total counts,
  contextual stock/batch retrieval and stale-response protection.
- Native Stock Entry row entered quantity/unit/factor and stock quantity must
  round-trip through edit/save/read/history APIs. Replace the custom Item-only
  factor restriction with validated row factors; never trust client-calculated
  stock quantity or silently replace an existing row factor with an Item default.
- Independently authorize UOM creation and Item-conversion writes. Save reusable
  factors through Item UOM Conversion Details with version checks and explicit
  conflict/failure reporting. Preserve unrelated Item fields and never change its
  stock UOM as part of this flow. Account for applicable ERPNext configuration.
- Validate factor precision, finiteness, entered/stock whole-number constraints,
  stock availability and loan balances on the server. Retain submitted factors
  and normal ERPNext cancellation/amendment behavior.
- Preserve canonical borrowing-document/line references and event linking. Use
  ERPNext as the ledger; no custom conversion ledger or duplicate stock model.
- Collapse/expanded-workspace/virtual-list state requires no new stock schema.

## 6. Automated verification and evidence

### Unit, type and build checks

- Add focused interaction coverage for inline/Details synchronization, hidden-field
  validation, expansion/restoration, summary defaults, navigation and preserved
  reporting/loan capabilities. Update older assertions that encode superseded UI.
- Cover configured/new units, checked/unchecked reuse, existing-factor replacement,
  cancellation, permission/save conflicts, reopening, historical factors,
  fractional conversions, invalid factors and stock/settlement limits.
- Cover bounded virtual rendering, offscreen selection, keyboard navigation,
  filtering, resizing, creation return and load-more retry.
- Run affected preview Vitest suites, `pnpm type-check`, `pnpm design:build`,
  touched-file Prettier and `git diff --check`. Build output stays under
  `/tmp/temple-inventory-design-preview`; do not run a production asset build.

### Required browser automation

- Add a dedicated `frontend/playwright.design-preview.config.ts` and preview-only
  specs under `frontend/tests/browser/design-preview/`. Keep the existing
  production browser configuration unchanged and exclude preview specs from any
  accidental production execution if its broad test discovery would include them.
- Use the isolated Vite design config, `/design-preview.html` and review hashes.
  Start with `pnpm exec vite --config vite.preview-design.config.ts --host 127.0.0.1`.
  Reuse a listener only after verifying it serves the isolated preview; do not
  stop an unrelated service occupying 5174. Use a separate explicit port if needed.
- Run with `pnpm exec playwright test --config playwright.design-preview.config.ts`.
  Use installed Chromium/`CHROMIUM_PATH` as appropriate. Preview tests must not
  require login, real camera devices or production stock mutations.
- Set isolated browser storage and deterministic fixtures per test. Capture page
  exceptions and unexpected production API requests as failures. Save screenshots,
  failure traces and a machine-readable result summary outside generated app assets.
- Geometry matrix: 375/768/1024/1440px × compact/balanced/spacious × 100/150/200%
  text scaling. Cover ordinary/canonical Receive, large valid/invalid drafts,
  picker, Details/conversion editor and expanded workspace. Include Transfer and
  loan settlement to exercise extra locations/references. Check page overflow,
  thumbnail/text intersections, visible focus, clipped controls and action access.
- At desktop and phone widths, exercise add/edit/remove/split, search-hidden error
  reveal, scan fixture input, open/close Details, expand/restore workspace, warehouse
  disclosures, save/reopen and complete confirmation. Assert retained values and
  correct stock-unit totals, not screenshots alone.
- Exercise UOM create/select, positive fractional factor, integer-only rejection,
  checked reusable save, unchecked line-only conversion, old/new-factor replacement,
  failed save, cancellation and immutable historical factors through real controls.
- Exercise the 1,000-Item picker: scroll near the end and back; select offscreen
  Items; filter, create an Item, return and commit. Assert ordered selection and
  that mounted result rows stay bounded as scrolling proceeds. Repeat with long
  names, large text and image fallback/loading states.
- Verify the sole count-creation entry, all Movement event types including
  Loan/Return, Loans settlement navigation, report selection/filter/export scope
  and collapsed secondary controls. Check keyboard Tab/Shift+Tab, Escape precedence,
  focus restoration, resize retention and reduced-motion behavior.
- Directly inspect representative desktop/mobile screenshots, including 200% text,
  rather than treating geometry assertions as visual approval. Record actual
  failures and fixes. Browser emulation/text scaling is not native browser zoom;
  native zoom and final user visual approval remain explicitly identified manual
  checks unless verified through a genuine browser-zoom mechanism.

## Documentation and delivery

- Update `UI_UX_DECISIONS.md`, `DESIGN_SYSTEM.md`,
  `DESIGN_MIGRATION_COVERAGE.md` and the preview README in the implementation
  change. Map each preserved/replaced capability and backend dependency to evidence.
- Create a dated progress note alongside this handoff. Record implementation status,
  commands and real results, review URLs, screenshot/report paths, outstanding
  manual checks and backend requirements. Keep this plan distinct from execution
  evidence; previous tests in archived notes are historical, not current passes.
- Final implementation report should state what changed, what was verified and
  what remains backend-dependent. Do not imply production migration or final
  visual approval has occurred.
