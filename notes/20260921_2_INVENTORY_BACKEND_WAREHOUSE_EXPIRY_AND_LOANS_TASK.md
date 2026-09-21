# Task 2: Inventory Backend — Warehouse, Expiry, Loans, and Bounded Queries

## Assignment

This is the complete handoff for the agent that owns the inventory-side
backend. Read `20260921_1_WAREHOUSE_ABSTRACTION_AND_DETAIL_UX_TASK.md` for the
locked product design, but implement only the scope below.

Primary ownership:

- `temple_inventory/inventory_api.py`;
- inventory-side helpers extracted from that module;
- Warehouse custom fields, fixtures, and versioned patches;
- inventory/warehouse/expiry/loan backend tests in a focused test module; and
- compatibility exports in `temple_inventory/api.py` only when required.

Do not edit `workspace_api.py`, Vue pages, components, or global CSS. Coordinate
an explicit handoff if a required change crosses that boundary.

## Outcomes

1. Warehouse topology is exposed as a safe volunteer-facing logical model while
   ERPNext leaf Warehouses remain the only stock locations.
2. Creating a room atomically creates its hidden fallback leaf; the UI never has
   to submit `is_group` or ERPNext Warehouse Type details.
3. `效期批次` returns the real bundle-backed batch stock on this site and supports
   overdue/upcoming expiry windows.
4. Loan, inventory, pending, bootstrap, summary, and detail readers are
   permission-aware, database-paged, deterministic, and query-bounded.
5. The remaining inventory-side requirements from
   `20260920_11_REMAINING_COMPLETION_AND_REGRESSION_GAPS_TASK.md` have regression
   coverage rather than only happy-path unit mocks.

## Shared boundary

Freeze representative JSON fixtures before changing implementations. The
frontend agents may implement against these fixtures concurrently.

### Warehouse presentation row

Return authoritative structured values equivalent to:

```json
{
  "name": "A02 - O",
  "stored_label": "A02",
  "parent": "第2寺院 - O",
  "is_group": true,
  "semantic_type": "room",
  "fallback_role": null,
  "local_label": "A02",
  "breadcrumb": "第2寺院 / A02",
  "display_depth": 1,
  "filter_value": "A02 - O",
  "operation_value": "A02 / 未指定 - O",
  "logical_room": "A02 - O",
  "default_leaf": "A02 / 未指定 - O",
  "can_filter": true,
  "can_operate": true
}
```

For the hidden child leaf, `fallback_role` is structured, its local label is
`无货位`, and normal logical browse output suppresses the separate row. A
fallback directly under another physical group type uses `无房间`. Determine
the wording from the direct parent's structured Warehouse Type, not hierarchy
depth or a name substring. Preserve raw document names as identifiers.

`filter_value` means “this node and permitted descendants.” `operation_value`
must be an allowed leaf or null. Never return an inaccessible leaf as an
operation value.

### Semantic mutations

Provide explicit operations equivalent to:

- `create_room(parent, label)` -> room group plus marked fallback leaf;
- `create_location(parent_room, label)` -> one named leaf; and
- manager-only edit/repair operations that cannot mutate ledger-bearing
  identity accidentally.

Return both the logical node and affected real Warehouse names. Validate
company, physical root, parent type, name collision, manager capability, User
Permissions, and allowed-location configuration on the server. Use one database
transaction; a failure rolls back both Warehouse records and settings updates.

Keep the existing endpoint temporarily if other callers depend on it, but route
it through semantic validation and mark the generic combination contract for
removal. Do not let a public client choose arbitrary `is_group`/type pairings.

### Warehouse detail

Expose one bounded detail payload containing:

- logical node metadata and capability flags;
- permitted descendant leaf identifiers used for the calculation;
- Item Group summaries with UOM-safe totals;
- a bounded current-stock preview and its total/count metadata;
- latest 10 relevant movements or a documented movement-query adapter;
- filter identifiers for Inventory and History deep links; and
- independent section errors/retry support where practical.

Never add quantities with incompatible UOMs. Never trust a client-supplied leaf
list.

### Expiry API

Extend `expiring_batches` compatibly with:

- `expiry_window`: empty, `overdue`, `7`, `30`, `90`, or `custom`;
- `expiry_days`: required integer for `custom`, 0–3650; and
- existing exact `expiry_from`/`expiry_to` support.

Reject ambiguous requests containing both a non-empty relative window and exact
dates. The frontend clears the alternative state, but the server still validates
it. Use server `today`:

- `overdue`: `expiry_date < today`;
- N-day window: `today <= expiry_date <= add_days(today, N)`.

Return an `as_of` date. Apply the effective predicate consistently to rows,
`total`, `overall_total`, and facets.

## Workstream A — warehouse model and creation

1. Add a narrowly scoped structured fallback-role field to Warehouse or an
   equivalent queryable ERPNext-compatible field. Export it through fixtures.
2. Add a versioned, idempotent migration that marks only unambiguous legacy
   generated leaves. Do not infer ambiguous records silently; report them for
   manager repair.
3. Centralize presentation and resolution so bootstrap, filters, Warehouse
   browse/detail, and transaction seeds cannot invent different labels.
4. Use `无货位` below a Room parent and `无房间` below other physical group
   parents. Raw legacy `未指定` remains searchable during migration.
5. Suppress the generated fallback leaf only in logical presentation. It
   remains a real leaf for Stock Entry, Batch, Bin, and ledger behavior.
6. Replace client-driven generic creation with atomic `create_room` and
   `create_location` behavior.
7. Preserve the reviewed root repair/adoption preview/apply flow. Keep group
   stock repair explicit and separate from adoption.
8. Test capabilities against their real requirements: create, submit, Item,
   company, source, destination, leased, damaged, allowed-leaf, and Warehouse
   permissions.

## Workstream B — repair the blank Expiry page

### Confirmed cause

The 2026-09-21 live site has:

- 18 dated Batch records;
- 208 Stock Ledger Entry rows;
- zero SLE rows with direct `batch_no`;
- 18 SLE rows referencing `serial_and_batch_bundle`; and
- 18 matching `Serial and Batch Entry` children with batch/warehouse/quantity.

The current candidate query joins `sle.batch_no=b.name`, so it returns zero. Its
empty-result compatibility path ultimately uses the same direct-SLE assumption.

### Required implementation

Build one normalized, permission-scoped batch balance source:

1. Modern branch: join non-cancelled SLE bundles to submitted, non-cancelled
   `Serial and Batch Entry` children. Follow the installed ERPNext
   `get_batch_qty`/Serial and Batch Bundle semantics for signed `qty`, supported
   transaction types, posting state, and cancellation.
2. Legacy branch: read direct SLE `batch_no` and signed `actual_qty` only when
   `batch_no` is set and the row is not represented by the modern branch.
3. Combine without double-counting; aggregate by batch, item, and warehouse;
   retain positive current balances.
4. Join permitted, enabled Item/Batch metadata only after applying company,
   physical-root, allowed-leaf, User Permission, and Item permission predicates.
5. Page batches in SQL, then hydrate locations for only that page.
6. Generate totals and both facets from the same normalized source.
7. Remove “SQL returned zero, therefore run unbounded legacy scan.” Detect
   capability deterministically or use the normalized union. Zero is valid.

Do not hard-code 18; it is audit evidence. After the fix the current site should
surface those positive rows subject to permissions and filters.

### Expiry tests

Cover:

- modern bundle-backed receipt, issue, transfer, cancellation, and zero balance;
- signed child quantities and duplicate/double-count protection;
- legacy direct-SLE batch rows where supported;
- mixed modern/legacy data;
- permission-hidden Item, warehouse, other company, group warehouse, and
  outside-root stock;
- exact dates and each relative window, including today, Nth day, N+1 day, and
  expired boundaries;
- invalid enum, invalid/missing custom days, >3650, and mixed exact/relative
  parameters;
- totals, location quantities, self-excluding facets, stable ties, adjacent
  pages, page beyond prior caps, and bounded query count; and
- a genuinely empty result that does not trigger unbounded work.

## Workstream C — inventory, loan, and task-11 query closure

1. Database-page active loans and `loan_items` before hydration. Searching a
   match beyond the first page must find it without materializing all rows.
2. Apply company, DocType, Item, File, Warehouse, and User Permissions before
   totals/facets. Never reveal an inaccessible Item code as fallback text.
3. Add exact stable ordering and adjacent-page tests for active/settled sibling
   records, all outcomes, attachments, and equal timestamps.
4. Audit Inventory/Pending facets, overall totals, bootstrap counts, warehouse
   summaries, Item Detail history/active loans, and reconciliation discovery
   readers that live in this module. Remove N+1 or unbounded reads.
5. Retain permission-filtered private File reads and add ownership tests for the
   inventory/loan endpoints owned here. File mutation lifecycle belongs to task
   3 unless it is an Item-image-only endpoint.
6. Make primary-image operations explicitly Item-only and enforce Item write
   permission server-side.

## Test ownership and commands

Prefer a dedicated module such as
`temple_inventory/tests/test_inventory_backend.py` so task 3 can work without
editing the same test file. Reuse existing setup helpers without moving or
rewriting unrelated tests. The integration lead may later add the module to the
aggregate runner.

Run focused tests during development, then from `frappe-bench/`:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If the dedicated module is not invoked by that helper, also run it through the
supported Frappe test command and document the exact command. A restricted
sandbox DNS failure for `mariadb` is environmental; rerun with the development
container network before reporting a test failure.

## Acceptance gate

- The live Expiry endpoint returns real bundle-backed data instead of an empty
  response.
- `已过期`, 7/30/90-day, custom-day, and exact-date filtering have exact tested
  boundary semantics.
- A room create request yields one group plus one structured fallback leaf, or
  nothing on failure.
- Logical Warehouse rows use `A02`, `无货位`, and `无房间` correctly while all
  stock writes still use valid leaves.
- Warehouse detail calculations cannot cross company, root, allowed-location,
  or User Permission boundaries.
- Inventory/loan readers are paged before hydration and remain query-bounded at
  datasets beyond previous caps.
- Existing API callers remain compatible or are accompanied by explicit fixture
  and migration notes for the integration lead.

## Non-goals

- Do not create a parallel stock, batch, loan, or warehouse ledger.
- Do not write stock to group Warehouses.
- Do not edit ERPNext/Frappe core.
- Do not implement frontend presentation in this task.
- Do not broaden manager/setup authority to solve a display problem.
