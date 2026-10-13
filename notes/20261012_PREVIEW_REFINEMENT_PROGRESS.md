# Standalone preview refinement — implementation handoff

## Authority and scope

User approved implementation on 2026-10-12. Preview and documentation only;
no production behavior/API/database changes, no subagents, no browser automation.
Starting working tree was clean. Preserve subsequent unrelated changes.
Read AGENTS.md, DESIGN_SYSTEM.md and UI_UX_DECISIONS.md. User's no-subagent
instruction supersedes AGENTS.md delegation. New decisions below supersede older
preview expiry, image-label, detail-modal and transaction creation decisions.

## Accepted design / acceptance checklist

- [x] Shared compact browse styling: aligned actions; consistent filter icon/count;
      selected date remains visible; remove Inventory inert expiry tabs and duplicate
      Warehouse create action. Inventory retains cards/table; Expiry table/mobile rows.
- [x] Expiry: 全部/已过期/未过期/无效期; today unexpired. Explicit date windows
      retained; dashboard six buckets retained; legacy soon links mean 0–30 days.
- [x] Image enlargement is always-visible icon with accessible name/tooltip;
      card image/name opens full item detail, thumbnails open lightbox independently.
- [x] Movement summaries: distinct records/items/categories and quantities per
      type/unit, using complete filtered results; draft/cancelled quantities labelled.
      Loans summaries: outstanding records/items and outcome quantities.
- [x] Group headers: thumbnail, title, metrics and disclosure on one line;
      accessible disclosure with independent lightbox. Records show item/category context.
- [x] Exports default item summary / operation records according to view;
      explicit contributing-line dataset, independent CSV/XLSX format, filtered parity.
- [x] Details: full item page/edit metadata+images (code/UOM/tracking read-only),
      group/leaf warehouse details + name edit, complete transaction/lifecycle,
      loan/history/settlements, reconciliation/counts. Batch details inline.
      Stable sidebar ownership and origin Back restores filters/view/scroll.
- [x] Forms: shared compact common fields, operation-specific required lines.
      Receive location→item→batches; allocation quantities derive item total.
      Outbound existing batches/availability; Transfer both locations; Loan borrower;
      Return linked outstanding/outcomes; Damage/Loss eligible stock; Repair/Disposal
      damaged stock; Reconcile actual count/difference/reason. Required inputs visible.
- [x] Receive-only transaction item creation; standalone Inventory create retained.
      Picker drawer swaps to create form; unit create inline (name/whole-number).
      Create/use returns to receiving batch allocations; created catalog survives
      cancelled receipt. Same components used by canonical/routed receiving examples.
- [x] Update DESIGN_SYSTEM.md, UI_UX_DECISIONS.md dated supersessions, preview README
      coverage. Preview-local typed state/projections only; preserve review hashes.
- [x] Focused Vitest, typecheck, isolated design build.
- [ ] Human review: viewport/density/keyboard/200%-zoom fidelity remains unverified.

## Implementation map

`frontend/src/design-preview/`: PreviewInventory.vue is browse visual reference;
PreviewActivityBrowse.vue shares Movement/Loans; PreviewBrowsePages.vue coordinates
expiry/warehouse/details; PreviewFormPages.vue handles routed forms; PreviewReceive.vue
is older canonical receive example. PreviewItemImage.vue owns lightbox variants.
reviewModel.ts owns session/fixtures; browseModel.ts filtering/grouping;
dashboardModel.ts dashboard projections. components/PreviewPeriodFilter.vue already
has pending dates, Apply/Cancel and responsive dialog; retain it.
navigation.ts owns sidebar; PreviewApp.vue owns cached pages/return routes.

## Progress log

### 2026-10-12 — checkpoint 0

- Read app instructions and design references; confirmed clean starting tree.
- Created this durable checklist before implementation as requested.
- Next: inspect targeted source, implement shared browsing/expiry/image changes,
  then summaries/exports, details/forms and validation. Do not mark tasks complete
  from planning alone. Record commands/results and remaining gaps here each stage.

## Validation / outstanding review

Final checks passed: 85 component/fixture tests, 10 HTTP entry-isolation tests,
`pnpm type-check`, and `pnpm design:build`. See checkpoint 4 for commands and
environment details. Production build and browser automation were not run.
Manual viewport/density/keyboard/200%-zoom fidelity remains outstanding.

### Checkpoint 1 — browse implementation underway

- Added shared PreviewFilterButton and PreviewItemGroup components. Inventory and
  activity browse use filter icon/count. Group headers now use accessible disclosure
  separate from thumbnail lightbox, with title/metrics/chevron aligned.
- Inventory image/name now navigates to full detail; removed inert expiry tabs.
  Warehouse duplicate toolbar create removed; enlargement now icon with label.
- Added expiry unexpired/undated routes, pure matchesExpiry; explicit date range
  and advanced controls on Expiry; dashboard unexpired preview spans future buckets.
- Added distinct Movement summary projection + visible Movement/Loans summary;
  export dataset choice independent of CSV/XLSX.
- First typecheck caught two obsolete 有效期内 comparisons; fixed to 未过期.
  No claim of passing checks yet. CSS additions need formatting/manual review.
- Next: finish forms/catalog/detail flows, report expiry alignment, tests/docs.

### Checkpoint 2 — forms and catalog integration

- Added shared PreviewOperationLines and typed form validation. Required locations,
  batch selection/expiry, return outcomes and reconciliation counts/reasons stay
  visible; optional transaction context uses a disclosure.
- Receiving groups allocations by location/item and derives item totals from batch
  quantities. Both routed and canonical examples now share these controls and the
  receive-only create/use picker; standalone item creation shares inline units.
- Validation checks aggregate repeated stock/settlement lines, whole-number units,
  distinct transfer endpoints, damaged stock and reconciliation differences.
- Found and fixed an interrupted edit that left TypeScript declarations inside a
  fixture object. Initial typecheck also found duplicate metadata keys; corrected.
- Still checking linked settlement history, complete details, expiry reports,
  navigation restoration and representative interaction tests. No passing-check
  claim yet; manual visual review remains outstanding.

### Checkpoint 3 — details, reports and interaction checks

- Item details now expose catalog metadata and simulated image attachments;
  code/unit/tracking are locked during editing. Group and leaf warehouse nodes
  have detail navigation and direct name editing with separate type/hierarchy data.
- Transaction details show complete lines, unit totals, category/batch context,
  optional personnel/notes and lifecycle; loan detail shows linked settlement history.
- Return supports split good/damaged/lost outcomes, with aggregate outstanding
  validation and correctly labelled linked Movement history. Reconciliation keeps
  actual count, difference and reason visible, including a zero actual count.
- Expiry includes batch-only undated stock, mobile batch rows and inline details.
  Reports use the same all/expired/unexpired/undated meaning; explicit windows stay
  available. Browse and report exports select dataset independently from file format.
- Back navigation restores the originating local/routed view and shell/result
  scroll; changing item detail tabs preserves the browse origin.
- First complete focused run passed 85 tests across seven preview suites. Added
  UI-driven settlement splitting and further export/origin fixes after that run;
  final validation follows. No browser automation or production build was run.

### Checkpoint 4 — implementation complete; manual review outstanding

- All implementation/documentation checklist items are complete. Human fidelity
  review is deliberately left unchecked, including every viewport and density,
  keyboard interaction and 200% zoom.
- Final component/fixture validation: `pnpm test tests/design-preview.test.ts
tests/design-preview-browse.test.ts tests/design-preview-forms.test.ts
tests/design-preview-pages.test.ts tests/design-preview-navigation.test.ts
tests/design-preview-refinement.test.ts tests/design-preview-completion.test.ts`
  — 7 suites, 85 tests passed.
- HTTP smoke validation: `pnpm test tests/design-preview-server.test.ts`
  — 1 suite, 10 tests passed with network-enabled execution. The restricted
  sandbox initially denied the local listener. HTTP assertions then passed but
  Vite dependency-discovery cleanup timed out at both 10s and 30s; the test-only
  server now disables unnecessary discovery, and the suite exits successfully.
- `pnpm type-check` passed. `pnpm design:build` passed (79 modules), writing only
  `/tmp/temple-inventory-design-preview`. Touched frontend/docs files formatted
  with Prettier. No production build or browser automation was run.
- Final review confirmed the working diff is limited to preview source, preview
  tests and the specified design/progress documentation; no production source,
  generated production assets, API, database or package changes.
- Last refinements include batch-specific damaged capacity, UI-driven split
  return outcomes, empty-draft item-count handling, and retaining browse origin
  through item editing/saving. Catalog edits and transactions remain in-memory
  samples; stock is still the fixed fixture snapshot.
- No remaining implementation gap identified. Next user action: manual review
  using the preview README matrix; production adoption remains a separate step.

### Independent review — corrections underway

The prior completion claim was too broad. Review found and is correcting:

- Returned/damaged-only Loan views reported zero distinct items; mixed settlement
  records displayed only their first type; Movement modes shared sort state.
- Expiry exposed an activity control with no filtering effect.
- Group-level replacement changed only the first allocation; outbound batch
  splitting lacked a direct action; form thumbnails were absent.
- Settlements with repeated item/batch across locations could update a different
  contributing loan line. Draft allocations now retain the loan-line index.
- Linked Damage/Loss editing activated Movement instead of Loans.
- Item edit lacked explicit cancel/discard and primary-image ordering; metadata
  save unnecessarily used stock confirmation. Added detail loading/empty/error/
  unavailable examples and prevented invalid selected details displaying another item.
- Supported alternate unit entry, optional manufacturing date and automatic receipt
  batch IDs were missing from the approved progressive-disclosure form proposal.

Changes are unstaged on top of the other agent's staged implementation; preserve
both. Regression tests, formatting, typecheck and isolated build remain to run for
this review. Manual browser review is still excluded/unverified.

### Independent review — completed and validated

- Corrected every issue listed in the review checkpoint above, plus repeat partial
  settlement (a completed draft previously reopened read-only), dashboard recent
  record grouping, legacy loan-detail hash rendering, and safe dismissal when
  switching from unfinished item creation to selecting an existing item.
- Added `design-preview-review.test.ts` with eight regression scenarios. Updated
  two older expectations for separate Movement sort states and direct item metadata
  saving. No production source, APIs, packages or generated assets changed.
- Final focused validation: seven existing component/fixture suites plus the new
  review suite — **8 suites / 93 tests passed**. `pnpm type-check` passed.
  `pnpm design:build` passed (79 modules; output only under
  `/tmp/temple-inventory-design-preview`). Touched files formatted with Prettier.
- HTTP entry-isolation tests were not repeated: this review did not change server
  configuration, entry points or production routing. Prior HTTP results remain
  recorded above. No browser automation or production build was run.
- Human viewport/density/keyboard/zoom fidelity review remains outstanding. No
  remaining functional deviation was identified in this code review. The prior
  agent's staged changes remain staged; review fixes remain unstaged alongside them.
