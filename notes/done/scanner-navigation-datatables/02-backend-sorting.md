# Task 02 — Server-side stable sorting

## Dependencies and ownership

- Wave 1; may run in parallel with task 01.
- Own `temple_inventory/inventory_api.py`, `temple_inventory/workspace_api.py`, and relevant cases in `temple_inventory/tests/test_workspace.py`.
- Do not edit frontend files.

## Public endpoint additions

Add optional `sort_by` and `sort_order` arguments at the end of these signatures so existing positional callers remain compatible:

- `inventory(...)`
- `expiring_batches(...)`
- `history(...)`

Accepted directions are exactly `asc` and `desc`, case-normalized. Reject a supplied unknown column or direction with a normal Frappe validation error. SQL must use only expressions selected from server-owned allowlists.

Supported columns:

- Inventory: `item_name`, `available_stock`, `total_stock`, `on_loan_qty`, `damaged_qty`.
- Expiry: `item_name`, `expiry_date`, `total_qty`.
- History: `title`, `posting_date`, `line_count`.

When new arguments are omitted, preserve existing endpoint order. For `expiring_batches`, retain `sort`; when `sort_by`/`sort_order` are absent, treat legacy `sort` as the direction for `expiry_date`.

## Inventory implementation

- Apply sorting before `LIMIT/OFFSET` in `_inventory_database_page` and before `_page` in the mocked/fallback path.
- Extend the grouped candidate SQL so sortable aggregate expressions exactly match returned quantities:
  - `total_stock`: all selected visible stock.
  - `damaged_qty`: selected damaged warehouse stock.
  - `on_loan_qty`: selected stock in permitted descendants of the leased group.
  - `available_stock`: selected stock outside leased, damaged, and pending warehouses.
- Preserve filtering, permissions, facets, totals, and the group-warehouse invariant.
- Canonical tie order is case-insensitive `item_name` ascending, then `item_code` ascending. Keep this tie order fixed for both primary directions.
- For fallback data, establish canonical order first, then use Python's stable sort on the requested scalar field.

## Expiry implementation

- Apply sorting to grouped positive batch balances before pagination in both database and fallback paths.
- Include `sum(qty)` as the sortable `total_qty` in the grouped SQL; returned `total_qty` and ordering must use the same selected-location balance.
- Canonical tie order is `expiry_date` ascending, `item_code` ascending, then `batch_no` ascending, regardless of primary direction.
- `item_name` is compared case-insensitively.
- Keep legacy `sort=desc` behavior when no new sort state is supplied, but use the fixed canonical tie order rather than reversing ties.
- Do not change facet or overall-total scope.

## History implementation

- Apply ordering before pagination in `_history_database_page` and before `_page` in the general fallback path.
- Give each union branch compatible scalar fields for:
  - `posting_date`.
  - `line_count` (workspace state items, Stock Entry child rows, or Stock Reconciliation child rows).
  - A normalized `title` composed from movement kind plus the same first available description used by the list: source, purpose, activity, then record name.
- Continue hydrating only the selected parent page after database ordering.
- Canonical tie order is `modified` descending, then record `name` descending, fixed for both primary directions.
- Keep permissions, app-authored/direct-entry de-duplication, filters, facets, and status totals unchanged.

## Tests

Add focused backend cases that cover:

- Every allowlisted column in ascending and descending directions.
- Invalid column and direction rejection.
- Equal primary values retaining canonical relative order when direction reverses.
- Sorting before pagination, including a value that moves across a page boundary.
- Database and fallback-path parity where existing mocks allow both paths.
- Quantity sort values matching returned quantities.
- Existing endpoint behavior when sort arguments are omitted.
- Expiry legacy `sort=asc|desc` compatibility.
- History ordering across workspace, direct Stock Entry, and reconciliation sources.

Run the focused workspace test entry point from the bench root. If the sandbox cannot resolve `mariadb`, rerun with approved dev-container network access before classifying the result.

