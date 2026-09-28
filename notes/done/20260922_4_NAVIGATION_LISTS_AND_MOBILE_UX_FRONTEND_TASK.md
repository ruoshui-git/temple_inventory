# Task 4: Navigation, Transaction/Loan Lists, Item Detail, and Mobile UX

## Assignment and boundaries

This is the frontend half of the app reorganization and UX-consistency work.
It is designed to run in parallel with
`20260922_3_TRANSACTION_LOAN_AND_ITEM_BACKEND_TASK.md`.

Own these areas:

- Vue routes, application-shell navigation, and page-title presentation;
- transaction, reconciliation, draft, and loan list pages;
- Item Detail and Receive Item creation presentation;
- shared DataTable, loading, icon-button, and detail-popover components;
- paginated card-list behavior and shared CSS; and
- frontend tests and API mocks/fixtures.

Do not edit Python, DocTypes, fixtures, patches, sample/reset scripts, or
generated files in `temple_inventory/public/frontend/` and
`temple_inventory/www/inventory.html`. Implement against the frozen response
contract in the backend task; representative frontend mocks should use those
exact field names.

Read and follow `AGENTS.md`. Preserve the current uncommitted Task 2 work and
integrate with its viewport, sticky-header, filter-drawer, and bottom-navigation
changes rather than replacing them wholesale.

## Outcomes

1. 货物流动 and 盘点调整 are first-class destinations instead of a mixed page
   under 更多.
2. 借用 has consistent outstanding/settled browse views, desktop DataTable,
   mobile cards, filters, loading, and navigation.
3. Mobile users receive thumb-reachable contextual navigation, compact sticky
   page identity/search, dense cards, and immediate press feedback.
4. Item Detail presents complete batch stock and meaningful recent changes.
5. List refreshes preserve DataTable headers, and no paginated result list
   exposes a stale or unclickable 加载更多 button.

## Frozen backend fields

Build frontend mocks before the backend task completes. Transaction rows add:

```ts
type TransactionHistoryRow = {
  name: string
  document_type?: 'Stock Entry' | 'Stock Reconciliation'
  legacy?: boolean
  movement_kind: string
  posting_date: string
  docstatus: 0 | 1 | 2
  line_count: number
  location_count: number
  locations: Array<{ warehouse: string; roles: Array<'source' | 'destination' | 'warehouse'> }>
  category_count: number
  categories: Array<{ item_group: string; line_count: number }>
  increase_line_count: number
  decrease_line_count: number
  item_changes: Array<{ warehouse: string; delta: number; uom: string }>
}
```

Loan rows add:

```ts
type LoanListRow = {
  name: string
  borrower: string
  loan_date: string
  activity?: string
  activity_title?: string
  line_count: number
  outstanding_lines: number
  loan_status: 'Outstanding' | 'Partially Returned' | 'Settled'
  items: Array<{
    loan_item: string
    item_code: string
    item_name: string
    image?: string
    uom: string
    loaned: number
    outstanding: number
  }>
}
```

Item Detail batch rows add:

```ts
type ItemBatchRow = {
  batch_no: string
  expiry_date?: string
  days_to_expiry?: number
  total_qty: number
  qty: number
  locations: Array<{ warehouse: string; qty: number }>
}
```

Do not silently invent fallbacks with different meanings. Compatibility
fallbacks may read old `qty` for `total_qty`, but the new contract remains the
primary path.

## Navigation and routes

### Primary destinations

Render in this order on desktop and mobile:

1. 库存 -> `/`
2. 货物流动 -> `/movements`
3. 盘点调整 -> `/adjustments`
4. 借用 -> `/loans`
5. 仓库 -> `/warehouses`
6. 更多 -> `/more`

Use local decorative SVGs with visible Chinese labels and correct active state.
Do not add an icon package.

### Routes and redirects

- `/movements` uses query `kind=Receive|Issue|Transfer`; omitted/invalid means
  Receive.
- `/adjustments` displays both reconciliation types and has no subnavigation.
- `/loans` uses query `status=outstanding|settled`; omitted/invalid means
  outstanding.
- `/drafts` displays all unfinished workspace types.
- `/history?status=unfinished` redirects to `/drafts`, preserving meaningful
  search/filter query values.
- Other `/history` links redirect to `/movements`, mapping a valid legacy
  `movement_kind` to `kind` where possible.
- Existing `/movements` bookmarks with `movement_kind` migrate to `kind`.
- Existing transaction, reconciliation, loan, item, and warehouse detail routes
  remain unchanged.

Remove the 货物流动 row from 更多. Change its 草稿 row to `/drafts` and retain
the count and every other More utility.

### Contextual navigation

Desktop ApplicationShell renders one compact contextual group beside the
active primary destination:

- 库存: 当前库存、全部物品、效期批次.
- 货物流动: 入库、出库、转移.
- 借用: 未结借用、已结借用.

On mobile, show the same contextual choices in a fixed strip directly above
the primary bottom navigation. Do not render it on destinations without
subviews. It must:

- be horizontally scrollable without wrapping;
- expose `aria-current="page"`;
- preserve shared filters when switching sibling views;
- reset paging and incompatible sort state; and
- contribute a measured `--mobile-context-nav-height` to content, FAB, toast,
  and contextual-action offsets.

The six-item primary bar must remain usable at 320px width: use approximately
20–22px icons, 11–12px labels, and compact equal columns without hiding text.

### Compact page titles

Add a small sticky title bar for these top-level list destinations only:

- Inventory/Expiry;
- Movements;
- Adjustments;
- Loans;
- Warehouses; and
- More.

Use the active subview title where relevant, such as 入库 or 已结借用. Do not
duplicate this global title on Item, Loan, Warehouse, Workspace,
Reconciliation, or other detail/editor pages that already own a header.

## Transaction list pages

Refactor the current mixed History page into shared transaction-list behavior
with thin page configurations for Movements, Adjustments, and Drafts. Avoid
three independent copies of paging, URL hydration, loading, row activation, and
filter logic.

### 货物流动

Use the same desktop viewport/list structure and mobile card behavior as
Inventory.

Subview request mapping:

- 入库 -> `movement_kind=Receive` and destination warehouse filter.
- 出库 -> `movement_kind=Issue` and source warehouse filter.
- 转移 -> `movement_kind=Transfer` with separate source and destination
  warehouse filters.

Shared filters:

- search;
- one exact 日期;
- 物品类别; and
- warehouse selector(s) as above.

Use `WarehouseSelector` for every warehouse field and `CategorySelector` for
categories. Give Transfer's two instances explicit headings and distinct
models/URL keys. Do not retain source text, purpose, activity, handler, date
range, or UI-versus-ERPNext-origin filters on this page.

Desktop columns, in order:

1. 日期 — sortable;
2. 物品行数 — sortable;
3. 位置数量 — sortable;
4. 相关类别 — sortable;
5. 状态.

Remove the old 类型/描述, 来源, and 操作 columns. The active subnavigation
already communicates transaction type, and app-created/direct ERPNext records
are equivalent here.

Render 位置数量 and 相关类别 as compact count triggers using the shared detail
popover described below. Location detail lists every warehouse breadcrumb.
Category detail displays `类别名：N 行`.

Status labels are 编辑中, 已完成, and 已取消, although this top-level view
normally requests completed/cancelled rows. Row activation keeps the existing
workspace/direct-entry routing.

The FAB is a direct action, not a one-option expansion menu:

- 入库 -> `/new/Receive`;
- 出库 -> `/new/Issue`;
- 转移 -> `/new/Transfer`.

Hide it when the matching capability is absent.

### 盘点调整

This page has no contextual subnavigation.

Filters:

- search;
- one exact 日期;
- 类型;
- 物品类别; and
- 位置.

Type choices and display mapping:

- backend `期初库存` -> 期初库存;
- backend `盘点调整` -> 库存盘点.

Desktop columns, in order:

1. 类型 — sortable;
2. 日期 — sortable;
3. 增加物品行数 — sortable;
4. 减少物品行数 — sortable;
5. 状态.

Mobile cards contain the same values without empty table-label chrome. Row
activation routes to the existing reconciliation detail/editor path. The FAB
directly opens `/reconcile/new` when permitted. Remove the old top navigation
button for new reconciliation.

### 草稿

Keep one unified draft list under 更多. It may reuse the shared transaction-list
component but retains type information and the explicit 删除草稿 action. Do not
mix drafts into Movements or Adjustments.

## Loan list

Replace the current mobile-only link list with the shared responsive browse
layout.

Subviews:

- 未结借用 -> `status=outstanding`;
- 已结借用 -> `status=settled`.

Both desktop and mobile use the same subview choice and filters:

- search borrower, record, activity, or Item;
- one exact 借出日期;
- 物品类别;
- 原始借出位置 using `WarehouseSelector`; and
- 相关活动 using the existing activity autocomplete data.

Desktop uses `SortableDataTable` with these columns:

1. 借出日期 — sortable, newest first by default;
2. 借用方 — sortable;
3. 物品行数 — sortable;
4. 未结物品行数 — sortable;
5. 相关活动;
6. 状态 — sortable.

Map lifecycle values:

- `Outstanding` -> 未归还;
- `Partially Returned` -> 部分归还;
- `Settled` -> 已结清.

Do not sum quantities across UOMs in the table. Mobile cards display borrower,
date, total/outstanding line counts, activity, status, and up to the bounded Item
preview supplied by the API. Preserve navigation to `/loans/:name`.

The FAB directly opens `/new/Loan` from either subview.

## Item Detail and Receive Item creation

### Gallery

- Zero images: render no gallery.
- One image: render only the hero image; do not render thumbnail controls.
- Two or more: retain selectable thumbnails and current keyboard behavior.

### Batch section

For `has_batch_no`, replace the collapsible details element with a prominent
section at the same visual level as other Item Detail sections.

Desktop columns:

1. Batch ID;
2. 到期日期 — sortable;
3. 剩余;
4. 数量 — sortable;
5. 位置.

Default sort is expiry ascending with batch ID as the stable tie. Reuse
`formatExpiryDuration`, warehouse presentation, quantity styling, and the
expired warning treatment from Expiry. A missing expiry date displays 无有效期
after dated batches.

At mobile widths, use compact cards rather than horizontal table scrolling.
Each card shows batch ID, expiry/remaining, total quantity/UOM, and all
locations. Respect an incoming `?batch=` value by highlighting the matching
row/card when present.

When batch tracking is enabled, do not render 库存位置 because the batch section
already contains location quantities. If no positive batches are returned,
show a clear batch empty state. Non-batch Items keep the existing stock-location
section.

### Recent inventory changes

Each 最近库存变动 row displays date, translated type, status if useful, and the
signed per-location summary from `item_changes`.

- Positive values use the existing success/available color.
- Negative values use warning/danger color.
- Include an explicit `+` sign for positive values.
- Format each warehouse through `warehousePresentation`.
- Preserve UOM per change and never combine different UOMs in the UI.
- Retain current detail links for workspace, Stock Entry, and reconciliation.

### New Item UOM

Only the Receive Item-creation path changes its initial value:

- initialize `stock_uom` to `Nos` when that UOM exists;
- if it is unexpectedly absent, leave the field invalid/empty rather than
  silently choosing the first UOM;
- render a text-style searchable Combobox over existing UOMs;
- typed text filters but is not accepted until it resolves to an existing UOM;
- retain the separate 新建单位 dialog; and
- after creating a UOM, add and select it immediately without losing the Item
  draft.

Pass the movement kind or an explicit default-UOM prop into `ItemPicker` so
other creation contexts are not changed accidentally.

## Shared components and list behavior

### SortableDataTable loading contract

Extend the component without breaking current slots/events:

```ts
loading?: boolean
loadingMore?: boolean
loadingText?: string
```

- `loading` keeps the table and `<thead>` mounted but replaces the desktop
  `<tbody>` content with one full-width loading row using the column count.
- Its mobile region displays one full-width loading panel instead of stale
  cards.
- `loadingMore` keeps current rows/cards and appends a full-width loader.
- Loading content is announced politely without repeatedly stealing focus.
- Sorting remains disabled only while the corresponding refresh is active.
- Do not clear `rows` merely to trigger a loading screen.

Inventory, Expiry, Movements, Adjustments, Drafts, and Loans must adopt this
contract. Aborted/stale responses must never replace newer state.

### Infinite result loading

Remove visible `加载更多` buttons from every paginated DataTable or result-card
list:

- Inventory;
- Expiry;
- Movements;
- Adjustments;
- Drafts;
- Loans;
- Pending;
- ItemPicker; and
- LoanItemPicker.

Use `IntersectionObserver` with `rootMargin` for prefetching. On desktop
viewport lists, root it in `results-scroll`; on normal mobile document lists,
use the viewport; inside ItemPicker/LoanItemPicker, root it in the drawer's
scrolling element. Reobserve the sentinel after refresh where necessary.

While appending, display a full-width loading animation. If append fails, keep
existing rows and replace the loading state with a full-width error/retry
control. If IntersectionObserver is unavailable, use an automatic bounded
fallback triggered on scroll proximity—not a manual Load More button.

### Sticky mobile list chrome

For page-level DataTable/card lists below 1024px:

- the search/action row and result summary stay sticky below the compact title
  bar;
- active-filter chips remain in normal flow below that row;
- filter drawers and modal pickers keep their own local sticky search chrome;
- calculate offsets with CSS variables rather than page-specific pixel copies;
- ensure focus targets are not hidden behind the sticky regions.

Desktop retains Task 2's separate fixed chrome and internal result scroller.

### Result-card density and feedback

Introduce/reuse a specific result-card class instead of globally compressing
transaction-entry cards.

- Use approximately 6–8px vertical gaps between result cards.
- Add immediate `:active` background/pressed feedback on pointer down.
- Add matching hover and `:focus-visible` feedback.
- A subtle transform is acceptable, but honor `prefers-reduced-motion`.
- Preserve at least 44px interactive targets and explicit-control isolation.

### Icon buttons

Create a reusable icon-button presentation with local SVGs, `aria-label`, and a
Chinese hover/focus tooltip. Use it for compact utility actions such as:

- scan;
- filter;
- enter/finish selection mode;
- back;
- close; and
- edit where the surrounding context is unambiguous.

Keep visible text for submit, cancel, delete/destructive operations, business
actions, and FAB menus. Do not rely on color or icon shape alone. Tooltips must
not trap pointer/focus and must respect viewport edges.

### Count detail popover

Create one reusable accessible detail trigger/popover for locations and
categories:

- desktop opens on hover or keyboard focus;
- touch opens on tap;
- tap outside or Escape closes it;
- the trigger exposes expanded state and a meaningful Chinese accessible name;
- content is readable by assistive technology; and
- opening it does not activate the result row.

## Tests and validation

Add/update frontend tests for:

1. Six primary destinations, active-state mapping, legacy redirects, and More's
   remaining Draft link.
2. Desktop and mobile contextual navigation for Inventory, Movements, and
   Loans, including preserved/cleared query fields.
3. Compact top-level titles without duplication on detail/editor pages.
4. Movement request mapping, exact date, categories, source/destination
   warehouse separation, columns, status, row routes, and direct FAB behavior.
5. Adjustment type labels, filters, increase/decrease columns, detail route,
   permission-gated direct FAB, and removal of the old create button.
6. Unified drafts and delete behavior.
7. Outstanding/settled Loan requests, filters, default sort, columns, lifecycle
   labels, desktop table, mobile cards, previews, and direct FAB.
8. Location/category popover mouse, keyboard, touch, Escape, outside-click, and
   row-activation isolation.
9. Zero/one/multiple image gallery states.
10. Item batch expiry/quantity sorting, expired treatment, location formatting,
    mobile cards, empty state, selected batch, and conditional removal of
    库存位置.
11. Signed recent movement summaries, explicit plus/minus signs, colors,
    warehouse labels, multiple UOMs, and routes.
12. Receive-only Nos default, searchable existing-UOM selection, invalid free
    text, and new-UOM continuation.
13. Stable DataTable headers during refresh, appended loaders, no stale-row
    flash, request cancellation, observer paging, fallback paging, retry, and
    absence of every `加载更多` result control.
14. Sticky mobile chrome, compact card classes, press/focus feedback, icon
    accessible names, and tooltip labels.

Run from `frontend/`:

```sh
yarn test
yarn type-check
yarn build
```

Do not run Playwright or launch a browser. The user owns manual browser/device
validation.

## Handoff acceptance

- The frontend uses the frozen backend field names without requiring backend
  files to change.
- All visible volunteer-facing text is Chinese.
- No generated assets or Python files were edited.
- No paginated result list retains a 加载更多 button.
- Desktop DataTable headings survive filters and sort changes.
- Mobile primary/context navigation, sticky chrome, cards, and FABs do not
  overlap at narrow widths or safe-area insets.
- Existing scanner, filters, URL restoration, selection mode, permissions,
  safe-return navigation, and transaction autosave behavior remain intact.
