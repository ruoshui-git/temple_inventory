# Stock Movement Overview and Time-Based Summaries

## Status

Implemented on 2026-09-28. CSV/Excel export remains intentionally out of scope.
Manual browser and device validation remains required.

## Delivered behavior

- `货物流动` now opens a `概览` before the existing 入库、出库、转移 views.
- The overview supports rolling, natural, and custom inclusive server-date ranges,
  defaulting to 近30天.
- Submitted Receive, Issue, Transfer, Loan, Return, Damage, Loss, Repair, and
  Disposal Stock Entries have independent stock-UOM quantity, Item, and record
  summaries.
- The item breakdown is permission-aware, sortable, observer-paged, responsive,
  and filterable by action, category, warehouse, and Item search.
- Drafts, cancellations, opening stock, and reconciliations do not contribute.
- Existing movement history views share the range selector while retaining their
  role-aware warehouse filters and creation actions.

## Implementation map

- `temple_inventory/workspace_api.py` owns server period resolution and the
  reusable `movement_overview` aggregation contract.
- `frontend/src/pages/Movements.vue` selects overview versus the existing
  movement History view.
- `frontend/src/pages/MovementOverview.vue` owns overview filters, summaries,
  item results, route state, and pagination.
- `frontend/src/components/MovementPeriodSelector.vue` is shared by overview and
  movement History.
- `frontend/src/components/ApplicationShell.vue` owns the updated contextual
  navigation and shared period query.

## Contract boundaries

- ERPNext submitted Stock Entry and Stock Entry Detail remain authoritative.
- Quantities use persisted stock quantities and Item stock UOM; incompatible UOMs
  are never combined.
- Action cards ignore only the active action selection so they remain useful as
  comparative filters; all other active filters and permissions apply.
- Future export must reuse the same server period, permission, normalized-line,
  and aggregation helpers rather than recreating movement semantics.

## Validation

Validated on 2026-09-28:

- `yarn type-check` passed.
- focused movement, navigation, and History tests passed: 3 files, 15 tests.
- the full frontend suite passed: 23 files, 114 tests.
- `yarn build` passed and regenerated the normal Vite/PWA output.
- `yarn format:check` passed after formatting the touched Vue files.
- Python compilation passed.
- the backend workspace suite passed: 58 tests.
- `git diff --check` passed.

Browser automation was not run; manual responsive and real-data acceptance
remains with the user.
