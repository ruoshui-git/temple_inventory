# Task 03 — Inventory and Expiry integration

## Dependencies and ownership

- Wave 2; start only after tasks 01 and 02 are merged.
- May run in parallel with task 04.
- Exclusively own `frontend/src/pages/Inventory.vue`, `frontend/src/pages/Expiry.vue`, and a new focused integration-test file for these pages.
- Consume `Scanner.vue`, `SortableDataTable.vue`, and the endpoint parameters delivered by Wave 1. Do not edit shared primitives, `style.css`, backend files, or task 04 pages.

## Inventory scanner

- Open the Inventory scanner with `presentation="modal"`.
- On a successful decode, prevent another decode while the lookup is pending.
- For a known item, close/stop the scanner and navigate to the existing item-detail route.
- For an unknown item, close/stop the scanner before showing the existing create-item prompt.
- On a lookup failure, keep the modal usable and show the error through the page's existing error/toast conventions.
- Closing by button, Escape, backdrop, or route navigation must release the camera.

## Inventory sorting and rows

- Replace duplicated desktop table/mobile-card event handling with `SortableDataTable`.
- Columns and initial directions:
  - `item_name`: ascending.
  - `available_stock`, `total_stock`, `on_loan_qty`, `damaged_qty`: descending.
  - Category and selection controls are not sortable.
- Default state is `{ sort_by: 'item_name', sort_order: 'asc' }`.
- Send sort state on every `inventory` request. Reset rows, pagination offset, result-pane scroll, and intersection-observer loading when sort changes.
- Serialize non-default state as `sort_by` and `sort_order` query values; hydrate and validate URL state on mount/back-forward navigation. Omit the default pair from canonical URLs.
- Row activation navigates to the same item detail as the title.
- Mark image preview and checkbox areas as explicit row controls.
- In selection mode, title and non-control row/card clicks toggle selection without navigation. Checkbox changes toggle exactly once.
- Preserve current filters, facet counts, infinite loading, selected-operation behavior, and restored result scroll.

## Expiry sorting and rows

- Remove `sort` from the filter model, active filter controls, clear/reset behavior, and sidebar markup. Remove the entire `排序` fieldset.
- Add page sort state with these columns and first-click directions:
  - `item_name`: ascending.
  - `expiry_date`: ascending.
  - `total_qty`: descending.
- Default state is `{ sort_by: 'expiry_date', sort_order: 'asc' }`.
- Send new sort state to `expiring_batches`; reset rows/start/result scroll before reloading on change.
- Preserve warehouse, category, search, and expiry-window filters and keep them in the side panel.
- Hydrate old URLs containing `sort=asc|desc` as expiry-date sorting, replace them with the canonical new query representation, and remove the legacy query key.
- Use the shared datatable for desktop and mobile rendering. Any non-control area opens the item detail including the batch query; image preview remains independent.
- Preserve overdue styling, locations, duration labels, pagination, facets, and total counts.

## Focused tests and manual checks

Add Vitest integration coverage for:

- Inventory known/unknown scanner outcomes and modal closure.
- URL sort hydration, default omission, non-default serialization, direction reversal, and pagination reset on both pages.
- Legacy expiry URL canonicalization and absence of the sidebar sorter.
- Desktop/mobile row activation, image-control isolation, and Inventory selection toggling without navigation.

Run `yarn test` and `yarn type-check`.

Leave these manual checks for the user:

- Camera permission success/failure and manual barcode entry.
- Inventory scanner above an open mobile filter/sidebar layer.
- Narrow and desktop row/card appearance.
- Infinite loading after repeated sort changes.

