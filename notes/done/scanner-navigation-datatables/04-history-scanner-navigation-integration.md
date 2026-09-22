# Task 04 — History, scanner call sites, and routed return behavior

## Dependencies and ownership

- Wave 2; start only after tasks 01 and 02 are merged.
- May run in parallel with task 03.
- Exclusively own `History.vue`, `Workspace.vue`, `ItemDetail.vue`, `Reconciliation.vue`, `Pending.vue`, `LoanDetail.vue`, `WarehouseDetail.vue`, and a new focused integration-test file.
- Do not edit Inventory, Expiry, shared primitives, `style.css`, or backend files.

## History datatable

- Replace History's desktop table/mobile-card interaction with `SortableDataTable`.
- Supported columns and initial directions:
  - `title` for “类型 / 描述”: ascending.
  - `posting_date`: descending.
  - `line_count`: descending.
  - Source, status, and actions are not sortable.
- Default state is `{ sort_by: 'posting_date', sort_order: 'desc' }`.
- Send sort state to `history`; reset rows, offset, result scroll, and incremental loading when it changes.
- Serialize non-default sort state in `sort_by`/`sort_order`, hydrate browser navigation, and omit the default pair from canonical URLs.
- Row/card activation opens the existing reconciliation, legacy entry, or workspace route.
- Mark delete and other explicit action buttons as row controls so they never open the record.
- Preserve filters, movement modes, facets, draft status, deletion confirmation, and infinite loading.

## Remaining scanner call sites

### Item detail

- Use `presentation="modal"` while editing barcodes.
- A decoded value adds it once, closes the scanner, and returns focus to the invoking control.
- Preserve manual textarea editing and duplicate-code suppression.

### Reconciliation

- Use `presentation="modal"`.
- After a decode, close/stop the scanner, place the value in search, run the existing lookup, and expose results in the page for explicit item/batch selection.
- Do not keep a modal open while the result list is behind it.
- Preserve reconciliation persistence and batch selection behavior.

### Transaction workspace

- Use `presentation="continuous"` and retain the existing recent-scan list.
- Keep the scanner open across successful line additions.
- Preserve pausing while an item is chosen, a picker/drawer is open, a scan lookup is busy, or the session is expired.
- On wide screens the scanner appears as the shared sidecar; on narrow screens it appears directly after the sticky scan controls and is scrolled into view.
- It must not cover the quantity/location drawer, review modal, signatures, or primary submission controls.

## Safe routed return behavior

Import and use `returnToOpener` for visible Back/Home/Close actions:

- `ItemDetail.vue`: fallback `/`.
- `LoanDetail.vue`: fallback `/loans`.
- `WarehouseDetail.vue`: fallback `/warehouses`.
- `Workspace.vue`: fallback `/movements`.
- `Reconciliation.vue`: fallback `/movements`.
- `History.vue`: fallback `/more`.
- `Pending.vue`: fallback `/`.

Additional rules:

- Convert hard-coded `RouterLink` return controls and raw `router.back()` calls to buttons invoking the helper.
- Do not add close buttons to top-level Inventory, Loans, Warehouses, or More destinations.
- Keep `router.replace('/workspace/<name>')` after first workspace persistence; replacement must retain the opener stored in the same history entry.
- After deleting a workspace draft, return to the safe opener. If none exists, replace with `/movements?status=unfinished`.
- Normal links from item details to loans/history/workspaces continue using router history, so closing the child returns to that item.
- Retry actions using `router.go(0)` are reloads, not close actions, and remain unchanged.

## Focused tests and manual checks

Add Vitest integration coverage for:

- History sort URL behavior, server parameters, pagination reset, row activation, and delete-button isolation.
- Item and reconciliation one-shot scanner closure.
- Workspace continuous presentation and paused-state propagation.
- Each contextual direct-entry fallback.
- Returning to a real opener with its full query intact.
- Workspace route replacement retaining its prior opener.
- Draft deletion returning to the opener or unfinished Movements fallback.

Run `yarn test` and `yarn type-check`.

Leave these manual checks for the user:

- Wide-screen sidecar and narrow inline continuous scanner placement.
- Scanner overlay above drawers/sidebars.
- Camera release after every close/navigation path.
- Exact filter and scroll restoration after opening and closing records.
- Directly loaded detail/editor routes using their contextual fallbacks.

