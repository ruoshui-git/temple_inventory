# Inventory Card View and Quantity Summaries Implementation Plan

## Status and purpose

**Implemented on 2026-09-28. Manual browser/device validation remains.**

Validated implementation snapshot: focused frontend tests passed (9/9), the
full frontend suite passed (22 files, 112 tests), `yarn type-check` passed,
`yarn build` passed, Python compilation passed, and the backend workspace suite
passed (56/56). Ruff was not available in the environment.

This document is the authoritative implementation handoff for:

- making a visual card view the default view of the Inventory (`库存`) page;
- retaining the existing sortable DataTable as an alternate view;
- adding permission-aware, filter-aware quantity summaries to every inventory
  list destination; and
- consistently calculating and displaying quantities in each Item's ERPNext
  stock UOM while continuing to accept configured alternate UOMs during stock
  entry.

The implementation must remain within the existing Temple Inventory app and
must keep ERPNext as the only source of inventory truth. Do not add a parallel
ledger, cached quantity table, universal UOM, or duplicate Item model.

This plan reflects the repository as inspected on 2026-09-28. The repository
may change before implementation. Reverify every named file, endpoint, payload,
and test before editing. At the time this plan was written, the worktree already
contained unrelated changes, including changes to
`temple_inventory/inventory_api.py` and `frontend/src/pages/Warehouses.vue`.
Those changes belong to the current workspace and must be inspected and
preserved rather than overwritten.

## Confirmed product decisions

These are settled requirements, not suggestions:

1. Inventory opens in card view when no saved preference exists.
2. Users can switch between card and table views.
3. The browser remembers the last selected view on that device.
4. Inventory cards use a visual, image-forward design. Each card prominently
   displays `可用` and always displays `总计`, `借出`, and `损坏` as quieter
   secondary values; the latter values are not hidden behind expansion or a
   detail page.
5. Quantity summaries appear on all list destinations:
   `库存`, `货物流动`, `盘点调整`, `草稿`, `借用`, `待处理`, `效期`, and
   `仓库`.
6. A summary describes the complete result set matching the current fixed
   scope, permissions, status, search, and filters. It must not describe only
   the first page or the rows currently loaded by infinite scrolling.
7. All summary calculations use each Item's stock UOM. Quantities with
   different UOMs remain separate, for example `120 件` and `35 kg`.
8. The UI must never display a single arithmetic total that combines
   incompatible units.
9. Existing record counts such as `已加载`, `筛选结果`, and `全部记录` remain
   available. Quantity summaries complement rather than replace those counts.
10. Details, editor pages, creation forms, and the `更多` menu are outside the
    page-summary scope. Item and warehouse detail pages may retain their
    existing local summaries.

## ERPNext UOM behavior and app policy

### Verified ERPNext behavior

- Every stock Item has one `stock_uom`. ERPNext stock ledger and Bin balances
  are maintained in that Item's stock UOM.
- Alternate UOMs are configured per Item through UOM Conversion Detail rows.
  A conversion such as `1 Box = 12 Nos` belongs to that Item; it is not a
  universal relationship that can safely be applied to every Item.
- A Stock Entry Detail carries the user's entered `qty` and `uom`, its
  `conversion_factor`, the Item's `stock_uom`, and the converted stock quantity
  (`transfer_qty`). ERPNext calculates the stock quantity as entered quantity
  multiplied by the conversion factor and validates the resulting stock-UOM
  quantity.
- ERPNext's Stock Balance report displays a Stock UOM per row and can add
  optional alternate-UOM columns. Its generic report totals facility can
  numerically sum quantity columns even when rows have different UOMs. Such a
  number is not a meaningful physical quantity and must not be copied into this
  app's summary design.

### Existing Temple Inventory behavior to preserve

- `frontend/src/pages/Workspace.vue` initially selects the chosen Item's
  `stock_uom`, offers only alternate UOMs configured on that Item, displays the
  conversion factor, and converts quantities when checking source availability.
- `temple_inventory/workspace_api.py` independently validates the selected UOM,
  looks up its Item-specific conversion factor, enforces whole-number UOM
  constraints, and maps the conversion into ERPNext Stock Entry rows.
- Inventory, Item detail, Bin, batch, and warehouse balances are already read in
  stock UOM. Do not reconvert these balances.

### Required policy

- Inventory lists, cards, reports, and new page-level summaries display stock
  UOM quantities.
- Transaction entry continues to allow configured alternate UOMs. The initial
  selection remains the stock UOM.
- Add a live equivalent-stock-quantity hint when the selected transaction UOM
  differs from the stock UOM, for example `相当于 24 件`. This is explanatory;
  the server remains authoritative.
- Submitted-transaction summaries should use ERPNext's persisted stock quantity
  where it is available. Draft-only data must be converted with the Item's
  current configured conversion factor and must fail safely if the UOM is no
  longer valid.
- Never infer a conversion between two Items merely because their UOM names
  look related.

## Current implementation map

The future implementer must reverify this map before editing.

### Frontend

- `frontend/src/pages/Inventory.vue` owns the Inventory filters, server-side
  sorting, infinite paging, scanner, selection mode, action menu, and current
  DataTable presentation. Its mobile DataTable slot already renders a compact
  item card, but there is no user-selectable desktop card grid.
- `frontend/src/components/SortableDataTable.vue` is the shared table primitive
  used by Inventory, Expiry, History, and Loans. It owns stable table headers,
  sort events, row activation, selection behavior, loading/error/empty states,
  and the mobile-row slot. Do not weaken its existing contract to build the
  Inventory card view.
- `frontend/src/pages/History.vue` serves three routed destinations:
  `/movements`, `/adjustments`, and `/drafts`. Destination-specific filters,
  columns, route state, and scroll state must remain isolated.
- `frontend/src/pages/Loans.vue`, `Expiry.vue`, and `Pending.vue` own their
  respective filtered, paginated lists.
- `frontend/src/pages/Warehouses.vue` currently renders and filters a client-side
  hierarchy. `WarehouseDetail.vue` has local warehouse summaries, but those are
  not a substitute for the requested Warehouses list summary.
- Shared list styling currently lives partly in `frontend/src/style.css`.
  Prefer scoped component styles for new components and add global rules only
  when they are genuinely shared.

### Backend

- `temple_inventory/inventory_api.py::inventory` returns permission-scoped,
  filtered and server-paged Item rows with `available_stock`, `total_stock`,
  `on_loan_qty`, `damaged_qty`, `pending_qty`, and `stock_uom`.
- `inventory_api.py::pending` delegates to `inventory`, so it can share the same
  authoritative aggregation machinery.
- `inventory_api.py::expiring_batches` aggregates positive batch balances in
  stock UOM and pages grouped batches.
- `inventory_api.py::loans` produces permission-safe loan parents and bounded
  item previews. Loan lines retain the entered UOM, so page-level summaries
  need explicit normalization to stock UOM.
- `inventory_api.py::warehouse_summaries` already avoids mixing incompatible
  UOMs and aggregates descendant leaves for each warehouse node. A page-wide
  summary must additionally deduplicate leaves across matching parent and child
  nodes.
- `temple_inventory/workspace_api.py::history` combines workspace, Stock Entry,
  and Stock Reconciliation history. Existing per-record `quantities` can be in
  entered UOM and therefore must not be blindly added for page summaries.
- `workspace_api.py` validates transaction UOMs and conversion factors before
  syncing a workspace to ERPNext.

## Page-level metric contract

All values below are calculated after authentication, DocType permission,
company, warehouse visibility, Item permission, fixed destination/status scope,
and current user filters have been applied, but before page slicing.

| Destination | Summary metrics | Calculation rule |
| --- | --- | --- |
| 库存 | `可用`, `总计`, `借出`, `损坏` | Sum the corresponding Item stock-state fields by `stock_uom`. `总计` retains the current definition and includes all visible stock states represented by the Inventory endpoint. |
| 货物流动 | `入库数量`, `出库数量`, or `转移数量` | Use the active Receive/Issue/Transfer destination. Normalize each line to stock UOM. Count a transfer line once, not once at its source and again at its destination. |
| 盘点调整 | `增加`, `减少` | Use the signed reconciliation difference in stock UOM. Positive differences contribute to `增加`; the absolute value of negative differences contributes to `减少`; zero differences contribute to neither. |
| 草稿 | `草稿操作量` | For ordinary movement workspaces, sum the absolute stock-UOM quantity acted on and count transfer-like lines once. For reconciliation drafts, sum the absolute difference between counted and current quantities; do not sum the final counted balance as movement. |
| 借用 | `借出`, `未归还` | Normalize original loan quantity and outstanding quantity to stock UOM. Respect the page's outstanding/settled status and all active filters. |
| 待处理 | `损坏`, `未定位` | Sum `damaged_qty` and `pending_qty` by stock UOM across the complete matching Item set. Continue returning both metrics even when the page mode displays only one subset. |
| 效期 | `批次库存` | Sum positive `total_qty` for all matching batches by Item stock UOM. Preserve the active expiry-window, date, warehouse, category, and search filters. |
| 仓库 | `现有库存` | Resolve the warehouse nodes matching the current search, take the union of their visible descendant stock-holding leaves, and sum positive Bin balances once per leaf and Item by stock UOM. |

Do not add record counts, row counts, category counts, or line counts to the
quantity summary component. Existing list status text already communicates
those dimensions.

## Additive API contract

Every affected list response should add this field without changing or
removing existing fields:

```ts
type QuantityTotal = {
  uom: string;
  qty: number;
};

type QuantityTotals = Record<string, QuantityTotal[]>;

type ListResponse = {
  results: unknown[];
  total: number;
  overall_total?: number;
  quantity_totals: QuantityTotals;
  // Existing endpoint-specific fields remain unchanged.
};
```

Rules:

1. Metric keys are stable machine names; Chinese labels remain frontend-owned.
2. Recommended keys are:
   - Inventory: `available_stock`, `total_stock`, `on_loan_qty`, `damaged_qty`.
   - Movements: `moved_qty`.
   - Adjustments: `increase_qty`, `decrease_qty`.
   - Drafts: `draft_action_qty`.
   - Loans: `loaned_qty`, `outstanding_qty`.
   - Pending: `damaged_qty`, `pending_qty`.
   - Expiry: `total_qty`.
   - Warehouses: `stock_qty`.
3. Each metric value is sorted deterministically by UOM name.
4. Omit zero-valued UOM entries. Return an empty array for a known metric with
   no quantity so the frontend does not need to infer whether a metric exists.
5. Use the same numeric precision as the endpoint's existing quantity fields;
   do not round during aggregation. Formatting and insignificant trailing-zero
   removal belong to the frontend.
6. `quantity_totals` must represent the entire filtered set on initial load and
   every refresh. Append requests may return the same summary; the frontend
   must not add append summaries to the previous summary.
7. Sorting and page offset do not change quantity totals.
8. Keep existing endpoint parameters, response keys, facet behavior, and
   compatibility exports intact.

### Endpoint-specific API work

- Extend both the real database path and mocked/unit-test compatibility path of
  `inventory`. They must produce identical `quantity_totals` semantics.
- Let `pending` reuse Inventory aggregation but return only the pending-page
  metric keys needed by its frontend.
- Extend `expiring_batches` database and fallback paths with an unpaged grouped
  sum using exactly the same inclusion predicates as the result count.
- Extend `loans` after the permission-safe parent set and all filters are known,
  but before parent pagination. Do not derive totals from the five-item preview.
- Extend `history` only after the full permitted, filtered record set is known.
  Use persisted Stock Entry stock quantities for completed Stock Entries,
  Stock Reconciliation differences for adjustments, and validated Item
  conversion data for editable workspace payloads.
- Extend `warehouse_summaries` to accept the list-page search scope or add a
  narrowly scoped companion endpoint. Return both existing per-node summaries
  and a page summary derived from a set of unique leaves. Do not sum already
  aggregated parent rows.

## Backend aggregation rules

### Permission and filter equivalence

- Summary queries must reuse the endpoint's existing permission-safe candidate
  set or predicate builder. Do not create a broader query that can reveal
  quantities for inaccessible Items, warehouses, loans, or transactions.
- Category selection includes descendants exactly as the row query does.
- Warehouse group selection includes visible permitted leaves exactly as the
  row query does.
- Search, barcode search, date, expiry window, status, activity, movement kind,
  source warehouse, and destination warehouse filters must affect rows and
  summaries identically.
- Self-excluding facet queries are not the summary source; summaries follow the
  active filters rather than the relaxed facet scope.

### UOM normalization

- Bin, ledger, batch balance, and reconciliation difference values that are
  already in stock UOM must be grouped directly by the associated Item's
  `stock_uom`.
- For a draft or custom loan line stored in an entered UOM:
  1. obtain the permitted Item and its `stock_uom`;
  2. use factor `1` when the entered UOM equals `stock_uom`;
  3. otherwise require the Item's matching UOM Conversion Detail;
  4. calculate `stock_qty = qty * conversion_factor`;
  5. group the result under `stock_uom`.
- Do not silently use factor `1` for an unknown alternate UOM. Existing invalid
  draft data should produce a normal actionable validation error rather than a
  misleading summary.

### Movement semantics

- Receive and Issue contribute one converted quantity per line.
- Transfer, Loan, Return, Damage, Repair, and similar warehouse-to-warehouse
  operations contribute the moved quantity once. Do not calculate a page total
  by adding source and destination ledger effects, which would double the
  movement or net it to zero.
- Loss and Disposal contribute the absolute quantity removed.
- Cancelled records stay subject to the existing history destination contract.
  If displayed, their summary contribution must reflect the endpoint's current
  semantic status rather than resurrect cancelled stock effects. Reverify the
  current completed-history policy before implementation and add a regression
  test for it.

### Reconciliation semantics

- The metric is the stock effect, not the counted balance.
- Calculate `difference = counted_qty - ledger_qty` for editable drafts.
- Use ERPNext's persisted `quantity_difference` for saved/submitted
  reconciliation rows when available.
- Aggregate positive and negative effects separately as described in the metric
  matrix.

### Warehouse deduplication

- Determine which presented warehouse nodes match the current search using the
  same normalized search text as the list.
- Expand each matching group/room to visible, permitted stock-holding leaves.
- Add directly matching leaves to the same set.
- Query positive Bin balances for that leaf set and group by Item stock UOM.
- A leaf contributes once even when both it and one or more ancestors match.
- Never include group-warehouse stock; existing group-stock validation remains
  authoritative.

## Frontend architecture

### Shared quantity summary

Create a small reusable component, recommended name
`frontend/src/components/QuantitySummary.vue`, with a typed contract similar to:

```ts
type QuantityMetric = {
  key: string;
  label: string;
  quantities: Array<{ uom: string; qty: number }>;
};
```

The component should:

- render one compact metric card per page-relevant metric;
- render every nonzero UOM quantity without collapsing mixed UOMs;
- show `0`/an intentional empty state when a metric has no quantities;
- format numbers consistently without arbitrary unit conversion;
- wrap long UOM collections instead of clipping or horizontally overflowing;
- expose an accessible group label and status updates;
- avoid hover-only information; and
- accept loading state so existing content does not flash misleading stale
  values while a new filter request is authoritative.

Place it below the current result toolbar/filter chips and above the scrollable
results. Keep it inside the sticky result chrome only if it remains compact on
small screens; otherwise keep search/filter controls sticky and let summaries
scroll normally. Verify this manually at narrow phone heights before choosing.

### Inventory card grid

Create an Inventory-specific component, recommended name
`frontend/src/components/InventoryCardGrid.vue`. Do not turn
`SortableDataTable.vue` into a generic card/table hybrid.

Each card must include:

- a large Item image using the existing image/preview behavior where practical;
- a stable fallback when no image exists;
- Item name, Item Code, and category;
- prominent `可用 {available_stock} {stock_uom}`;
- secondary `总计`, `借出`, and `损坏` values, each with the stock UOM;
- an accessible link/action to Item detail; and
- the existing selection checkbox when selection mode is active.

Interaction rules:

- Normal card activation opens Item detail.
- In selection mode, activating the card toggles selection instead of
  navigating, matching the table contract.
- Image preview and checkbox controls must not accidentally trigger row/card
  navigation.
- Preserve seeded Receive/Issue/Transfer/Loan actions and the selected-item
  action bar.
- Preserve infinite-scroll sentinel behavior and loading-more feedback.
- Use a responsive grid with one column on small screens and multiple columns
  as space permits. Do not reduce touch targets to achieve density.

### View toggle and persistence

- Add adjacent, accessible `卡片` and `表格` controls to the Inventory result
  toolbar. Use the existing compact icon-button conventions but keep visible
  labels or an equally clear segmented-control treatment.
- Use a namespaced key such as `temple_inventory.inventory.view`.
- Read and write `localStorage` inside `try/catch`; storage can be unavailable.
- Accept only `card` and `table`. Missing, corrupt, or inaccessible values fall
  back to `card`.
- View selection is presentation state, not a server query parameter. Existing
  filter and sort URL state remains unchanged.
- Switching views must retain filters, sort, scroll context where feasible,
  loaded rows, selection state, and in-flight request handling.

### Card-mode sorting

The DataTable currently exposes sorting through column headers, so card view
needs an equivalent control. Add a labeled sort selector for:

- Item name;
- Available quantity;
- Total quantity;
- Loaned quantity; and
- Damaged quantity.

Add an accessible ascending/descending toggle. Both views consume the same
existing server-side `sort_by` and `sort_order` state. Switching views must not
reset sorting. The table headers continue to work as they do today.

### Other list pages

- Add only the shared summary component and response handling; do not add a
  card/table toggle to other pages as part of this task.
- Keep each History destination's metric labels and payload mapping isolated so
  route changes cannot leak movement metrics into adjustments or drafts.
- Preserve existing loading structures: refresh replaces row content with the
  current in-list loader; append preserves rows and shows trailing progress.
- A failed refresh must show the existing error state and must not present old
  quantities as if they matched the new filters.

## Transaction UOM UX

Retain the current UOM selector and backend validation. Add or verify these
behaviors:

1. The stock UOM is initially selected for every newly chosen Item.
2. Only alternate UOMs configured for that Item are selectable.
3. Each alternate option communicates its conversion factor.
4. When an alternate UOM and valid quantity are selected, show the equivalent
   stock quantity live.
5. Changing Item resets the UOM to that Item's stock UOM; editing an existing
   valid line preserves its saved UOM.
6. A missing or removed conversion produces a clear validation error and does
   not discard the line draft.
7. Server validation remains authoritative for conversion, whole-number UOMs,
   stock availability, and final Stock Entry mapping.

## Recommended implementation order

1. **Reverify and protect the workspace.** Read `AGENTS.md` and
   `UI_UX_DECISIONS.md`; inspect `git status` and the diffs of every overlapping
   file. Identify which changes predate this task.
2. **Define shared types and backend helpers.** Add a deterministic
   UOM-grouping helper and Item-specific draft conversion helper without
   changing endpoint behavior yet. Add focused backend tests for these helpers.
3. **Inventory and Pending contract.** Add unpaged filtered stock-state totals
   to both database and compatibility paths, then consume them in Inventory and
   Pending.
4. **Inventory presentation.** Add the shared summary component, card grid,
   view toggle, persistence, and card sorting while retaining the DataTable.
5. **Expiry and Warehouses.** Add batch totals and unique-leaf warehouse totals;
   integrate the shared summary component.
6. **Loans.** Normalize full permitted loan lines to stock UOM before paging
   parents; add loaned/outstanding summaries and UI.
7. **History destinations.** Implement submitted and draft stock-effect
   normalization, then expose destination-specific movement, adjustment, and
   draft summaries.
8. **Transaction conversion hint.** Add the live stock-UOM equivalent and its
   focused tests without weakening server validation.
9. **Durable decision record.** Update `UI_UX_DECISIONS.md` with the default
   card view, remembered preference, always-visible card quantities, complete
   filtered summaries, and per-UOM grouping.
10. **Validate and audit.** Run focused checks first, then the complete required
    suites. Reread this document and inspect the final diff for unrelated or
    generated-file churn.

Do not split backend and frontend work in a way that temporarily calculates
page summaries from paginated client rows. The additive API contract should be
established before broad page integration.

## Likely files

Reverify names and ownership before editing. Expected primary files are:

- `temple_inventory/inventory_api.py`
- `temple_inventory/workspace_api.py`
- `frontend/src/pages/Inventory.vue`
- `frontend/src/pages/History.vue`
- `frontend/src/pages/Loans.vue`
- `frontend/src/pages/Pending.vue`
- `frontend/src/pages/Expiry.vue`
- `frontend/src/pages/Warehouses.vue`
- new shared summary and Inventory card-grid components
- focused files under `frontend/tests/`
- `temple_inventory/tests/test_workspace.py`
- `UI_UX_DECISIONS.md`

Do not edit generated files under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand.

## Test plan

### Backend tests

Add focused coverage for:

- multiple Items sharing one stock UOM aggregate into one UOM entry;
- Items using different stock UOMs remain separate;
- an alternate transaction UOM converts through the correct Item-specific
  factor;
- an unknown or removed alternate UOM is rejected rather than treated as factor
  `1`;
- summaries use the complete filtered result when `page_length` is smaller than
  the result count;
- pagination offsets and sort direction do not change summaries;
- search, barcode, category descendants, warehouse descendants, status, date,
  activity, expiry, source, and destination filters affect rows and summaries
  consistently;
- Item and warehouse permissions exclude both rows and quantities;
- Inventory returns available/total/loaned/damaged totals in both database and
  test-double paths;
- Pending returns damaged and unlocated totals;
- Expiry sums positive matching batch balances and excludes zero/negative
  grouped batches;
- a Transfer contributes its stock quantity once;
- reconciliation increases and decreases are separated and zero differences
  are omitted;
- ordinary drafts and reconciliation drafts use the defined action/difference
  semantics;
- Loans calculate original and outstanding stock-UOM quantities from the full
  parent lines, not bounded previews;
- settled and outstanding Loan filters produce the expected totals;
- warehouse parents and matching descendants do not double-count leaves; and
- cancelled/completed History behavior matches the existing destination policy.

### Frontend tests

Add focused coverage for:

- Inventory defaults to cards without a saved preference;
- valid card/table preferences are restored and invalid values fall back to
  cards;
- storage read/write failures do not break the page;
- switching views preserves rows, filters, sort, and selection;
- cards render large image/fallback, identity, category, prominent available
  quantity, and all three secondary quantities;
- card activation and selection-mode activation follow the existing table
  semantics;
- image preview and checkbox controls do not trigger navigation;
- card sorting sends the same allowed server sort fields/directions as table
  sorting;
- mixed-UOM summary data renders as separate labeled values;
- zero/empty metric state, loading state, refresh error, and append behavior are
  accessible and do not show stale totals;
- each of the eight list destinations maps the correct metric keys and Chinese
  labels;
- filter changes replace rather than accumulate summary values;
- append responses do not double the summary; and
- the alternate-UOM editor displays the correct stock-UOM equivalent and
  preserves invalid drafts on error.

### Required automated validation

Run from `frontend/` after implementation:

```sh
yarn vitest run <focused-test-files>
yarn type-check
yarn test
yarn build
```

Run from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Run focused Ruff/Prettier checks for touched files when those tools are
available, then:

```sh
git diff --check
```

If the restricted sandbox cannot resolve the development database host, rerun
the backend suite with the approved dev-container network before reporting a
database failure. Do not treat `git diff --check` as formatter or linter
coverage.

### Manual validation

The user performs browser/device validation. Provide a concise checklist that
covers:

- first visit defaults to cards and a later visit restores the chosen view;
- desktop multi-column and phone single-column card layouts;
- long names, missing images, large/decimal quantities, and several UOMs;
- card/table sorting parity and infinite scrolling;
- filters changing both rows and summaries;
- selection mode, detail navigation, image preview, scanner, and floating
  actions in both views;
- summary wrapping and sticky chrome on short/narrow mobile screens; and
- alternate-UOM entry, live conversion hint, save, refresh, and submitted stock
  balance.

Do not launch Playwright, Chromium, camera emulation, or other browser
automation unless the user explicitly requests it.

## Acceptance criteria

Implementation is complete only when all of the following are true:

1. Inventory initially renders an image-forward card grid for users without a
   stored preference.
2. Users can switch to the existing DataTable and their valid choice survives a
   reload on the same browser.
3. Card and table views expose the same filtered Items, server sort order,
   quantities, selection behavior, loading states, and actions.
4. Every Inventory card visibly contains available, total, loaned, and damaged
   quantities in the Item's stock UOM.
5. All eight list destinations show the metrics defined in the page matrix.
6. Summary values cover the complete filtered result and do not change merely
   because more result pages were loaded.
7. Mixed stock UOMs display separately and no cross-UOM grand total appears.
8. Alternate entry UOMs convert using the selected Item's configured factor,
   display the stock-UOM equivalent, and remain authoritatively validated on the
   server.
9. Transfers and warehouse hierarchies are not double-counted; reconciliation
   increases and decreases use stock effects rather than ending balances.
10. Existing permissions, filters, facets, scanner behavior, route state,
    infinite scrolling, record counts, and detail navigation continue to work.
11. Existing endpoint callers remain compatible because the API change is
    additive.
12. Focused tests, full frontend tests, type checking, production build,
    backend integration tests, and diff checks pass, or any environmental
    unavailability is reported precisely.
13. `UI_UX_DECISIONS.md` records the durable user-facing decisions.

## Non-goals

- No universal or company-wide base UOM.
- No conversion between unrelated Items for the purpose of a grand total.
- No new stock ledger, quantity cache DocType, database migration, or Item
  replacement model.
- No removal or replacement of `SortableDataTable.vue`.
- No card/table toggle for pages other than Inventory.
- No redesign of Item detail, Warehouse detail, transaction history details,
  or creation workflows beyond the alternate-UOM equivalent hint.
- No monetary valuation summary, dashboard chart, export format, or analytics
  warehouse.
- No change to ERPNext core or Frappe core.

## Rollback and compatibility

- The server response extension is additive. A frontend rollback can ignore
  `quantity_totals` without requiring a backend rollback.
- The card view and shared summary components contain no durable business data.
  Removing them must not affect ERPNext records.
- A view preference is local presentation state. If the card feature is
  withdrawn, safely ignore the stored key; no migration is required.
- Keep summary aggregation isolated from stock posting and workspace save logic
  so a presentation rollback cannot alter inventory behavior.
- If performance is unacceptable, optimize the permission-equivalent grouped
  queries or add bounded indexes through a separately reviewed migration. Do
  not fall back to paginated client-side totals.

## Resume checklist

Before implementing this task in a later session:

1. Read `AGENTS.md` completely.
2. Read `UI_UX_DECISIONS.md` completely and identify any newer decision that
   supersedes this handoff.
3. Run `git status --short` and inspect every diff that overlaps the likely
   files, especially `temple_inventory/inventory_api.py` and
   `frontend/src/pages/Warehouses.vue`.
4. Preserve all unrelated and pre-existing changes. Do not reset, overwrite, or
   reformat them.
5. Reverify the installed ERPNext/Frappe behavior and current endpoint payloads;
   treat this plan's code observations as a dated snapshot.
6. Reconfirm that the eight destination routes and their filtering contracts
   remain as documented.
7. If following the project's task-file workflow, inspect first, implement
   before running tests, then validate and reread this plan after tests.
8. Update `UI_UX_DECISIONS.md` in the same implementation change with the
   durable card-view and summary rules.
9. Never edit generated frontend assets by hand.
10. At completion, report focused checks, full-suite checks, unavailable tools,
    and manual checks still requiring the user separately.
