# Task: Complete the Remaining Loans, Warehouses, Scanner, and Inventory UX Work

## Audit conclusion

The proposals in the following task files are **not complete**:

- `20260920_7_Scanner_impl.md`
- `20260920_8_INVENTORY_MOVEMENT_RECONCILIATION_UX_FOLLOW_UP_TASK.md`
- `20260920_9_LOANS_WAREHOUSES_AND_COMPLETION_AUDIT_TASK.md`

This audit was performed against commit `2102607` plus the current uncommitted
working tree. Preserve all existing changes, including the attachment
`file_type` corrections and the partial loans, warehouse, and scanner work.
Do not hand-edit generated files under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html`.

## Work completed since task 9

Preserve these improvements:

- `cint` is now imported and `/loans` accepts RPC string paging values;
- active-loan rows are selected before parent slicing, settled parents are no
  longer deliberately removed after the page is chosen, and detail reads are
  scoped to the requested loan with batched Item metadata;
- the physical management tree includes empty groups beneath the configured
  physical root;
- warehouse loading, diagnostics, empty states, summary retry, valid-parent
  checks, and automatic enablement of a newly created leaf were added;
- a group-stock validation error no longer necessarily prevents `bootstrap()`
  from returning the management tree;
- ZXing is dynamically imported, its canvas is reused, video startup can be
  cancelled promptly, and decode errors have a callback path; and
- the existing frontend suite and type-check still pass.

These changes resolve the immediate undefined-name Loans crash and improve the
reported blank Warehouse experience, but they do not meet the full acceptance
criteria below.

## 1. Finish Loans query correctness, permissions, and coverage

The new `_active_loan_names()` implementation still reads every matching active
parent name with raw SQL, then `frappe.get_list(..., limit_page_length=0)` reads
every permitted parent, and Python performs the page slice. This is unbounded
and is not database-level stable paging.

Replace it with a permission-aware query/read model that applies the exact
active-parent predicate, search, stable ordering, offset, and limit in the
database. Obtain the exact count from the same predicate without materializing
all parent names.

Also address these correctness cases:

- compute activity per line exactly as the detail contract requires;
- define search behavior when an item match is on a settled line but another
  line in the same parent remains active, and test the approved behavior;
- express “active” as at least one outstanding line, not only a parent-wide
  aggregate that can be distorted by invalid/legacy over-settlement;
- enforce Inventory Loan, Item, company, and User Permission predicates before
  returning parent or child data; do not leak inaccessible item codes through
  child rows when Item metadata is filtered out;
- avoid raw-SQL results becoming an authorization side channel;
- keep parent and item reads bounded for both list and detail; and
- return all required original-line outcomes, audit context, and attachments
  from `loan_detail()` with File access handled consistently.

Only one mocked loan test was added. Add the full task-9 matrix:

- real active and fully settled parents spanning multiple pages;
- exact filtered and unfiltered totals;
- borrower, activity, loan ID, item code, and item name search beyond page one;
- identical posting timestamps and deterministic name tie-breaking;
- the settled-line/active-sibling search case;
- company and User Permission isolation, including Item permissions;
- bounded query-count assertions for list and detail;
- every original detail line and outcome total; and
- `/loans` routed error/retry and incremental-loading behavior.

## 2. Finish Warehouses repair, authorization, and coverage

The new management UI handles loading and empty states, and summaries no longer
block the tree. The following task-9 requirements remain:

1. Add a manager-only repair/adoption flow for existing ERPNext warehouses that
   are outside the configured physical root or referenced by stale settings.
   Show a read-only preview before changes. Preserve warehouse identity, stock
   ledger history, nested-set integrity, company, and User Permissions.
2. Do not silently hide legacy physical warehouses outside the canonical root.
   Report them as candidates requiring explicit adoption or exclusion.
3. Distinguish a genuinely stale/missing root from a root that exists but is
   hidden by Warehouse User Permissions. The current status is derived from an
   already permission-filtered map and can mislabel access problems as stale
   configuration.
4. Separate the management bootstrap from the large general `bootstrap()`
   payload and stock-browse work. The management page should remain available
   for diagnosis when unrelated pending counts, Item Groups, UOMs, batches, or
   inventory queries fail.
5. Return structured actions/links with diagnostics, not message text alone.
   A manager who sees a stale root currently has no repair action on this page.
6. Validate edits as carefully as creation: allowed warehouse types, physical
   subtree membership, group/leaf invariants, company, and permissions. Show
   inline save failures instead of fire-and-forget `api()` calls from the
   template.
7. Apply per-operation capabilities to warehouse action buttons and do not
   offer operations the current user cannot complete.
8. Keep group-stock repair explicit and auditable. Never make a group an
   operational leaf or move stock/history implicitly.

Only one unit test for an empty group was added. Add all required backend and
component cases from task 9: zero-stock leaves, empty groups, legacy topology,
stale settings, permission-hidden parents, other companies, group stock,
summary failure, manager/non-manager states, first-leaf creation, and repair
preview/application. Verify nested-set and ledger preservation against a real
test site.

## 3. Finish Scanner lifecycle and adapter tests

Dynamic loading, canvas reuse, startup cancellation, and decode-error catching
are implemented. Remaining work:

- pass the decode-error callback when starting the newly selected engine in
  `Scanner.vue`; the switch path currently calls `service.start(area, decoded)`
  without it, so asynchronous decode errors after a switch are not displayed;
- define whether a decode error stops the loop or retries with throttled/error-
  deduplicated feedback; do not invoke the same UI error every 250 ms forever;
- make Frappe cleanup robust when its captured startup promise rejects, without
  replacing the original useful error or leaving handler resources behind;
- remove the duplicate `.scanner-engine` / `.scanner-camera video` CSS rules;
- add the adapter tests originally required for loader caching and retry,
  Frappe cleanup, emitted WASM URL initialization, ImageData decoding, empty
  results, non-overlap, stale result suppression, every startup-stop phase,
  rejected startup/decode, and track cleanup;
- add component tests for startup failure with usable manual/switch controls,
  late startup after unmount, decode failure before and after switching, and
  error recovery; and
- run the production build checks: hashed reader WASM, service-worker precache,
  app-local asset URL, no runtime CDN dependency, and no unintended generated
  diffs.

The scanner test count did not increase; the current basic service/component
tests are not evidence for the adapter matrix. Retain the manual two-engine
device checks from task 7.

## 4. Complete the inherited inventory/movement/reconciliation task

The large task-8 backlog remains materially unchanged. All inherited parent
requirements and all 27 acceptance criteria remain authoritative. Complete at
least the following known open areas.

### Hierarchy and facets

- Replace `warehouseLabel()` with the shared structured `local_label`,
  `full_label`, `search_text`, node-role, and type contract on every surface.
- Complete unspecified-location wording, room-wide choices, raw/friendly
  search, company-suffix handling, partial selection, and keyboard behavior.
- Implement correct self-facet exclusion and ancestor counts for Inventory,
  Catalog, Expiry, Movements, and Pending, with permission/deduplication tests.

### Browse foundations and desktop/mobile behavior

- Unify Inventory and Expiry behavior and compatible URL state.
- Use the locked `已加载 N · 筛选结果 M · 全部 T` status everywhere; Inventory
  still omits the loaded count.
- Put search, scanner/filter controls, counts, and bounded chips in one sticky
  results toolbar.
- Remove fixed `190px`/`220px` viewport deductions and calculate the work area
  from actual shell/subtab/toolbar layout.
- Add Expiry and Movement bounded-pane scroll restoration and all required
  desktop/mobile semantic, upward-scroll, return, reset, zero-stock, and safe-
  area tests.

### Shell state, capabilities, selection, and actions

- Stop gating browse actions on broad `can_create_stock_entry`.
- Compute and enforce real per-operation capabilities; the current map repeats
  the same Stock Entry create check for every operation.
- Refresh shell counts after every relevant completion, deletion, repair,
  disposal, assignment, reconciliation, and route return using identical
  server predicates.
- Finish guarded selection exit, preparation queues, hierarchy scope seeding,
  route-leave cases, and full FAB keyboard/focus behavior.

### Attachments

- Preserve the `file_type` fix, then implement the shared attachment component
  and independent File permissions.
- Complete primary Item image replace/clear, camera/fallback behavior, direct
  ERPNext evidence display, and ownership/privacy/completed-immutability tests
  for every transaction type.

### Pending

- Add search, warehouse/category hierarchy filters, URL state, facets, stable
  item/batch grouping, exact badge parity, and cross-page tests. Server-side
  damaged/unlocated mode selection alone is insufficient.

### Movements

- Replace `workspace_api.history()` candidate caps, document loops, Python
  filtering/sorting, and post-materialization paging with a stable, permission-
  aware database read model and bounded child previews.
- Add movement facets and finish mutually exclusive modes, special types,
  summaries, direct Stock Entry/Reconciliation detail, before/after/difference,
  files, audit fields, cancellation/amendment links, and Item Detail routing.

### Reconciliation

- Complete exact authorization at every entry point and scope change.
- Finish idempotent lazy draft creation, robust autosave/conflict/session
  recovery, and complete signature invalidation.
- Add posting-time reset, equivalent scanner/manual/browse paths, duplicate
  focus, stock-UOM validation, Batch flows, and serialized-item blocking.
- Implement a bounded historical whole-location expected set, explicit row
  states, full review/conflict summaries, accessible two-step confirmation,
  baseline refresh preserving counts, valuation prerequisites, and exactly-once
  authoritative submission.
- Complete read-only detail, attachments, movement visibility, routing, and
  shell refresh.

### Error handling and performance

Finish the routed-page and endpoint audit. Every foreground load needs a useful
Chinese retry state; failed background refreshes must retain stale data with a
warning. Remove remaining all-site scans, arbitrary caps, and repeated document
lookups from Inventory, Expiry, Movements, Loans, Item Detail, Pending,
Reconciliation, warehouse summaries, and bootstrap counts.

## 5. Validation status and required verification

Audit-time results:

- `yarn test --run`: **8 files / 21 tests passed**;
- `yarn type-check`: **passed**;
- `git diff --check`: **passed**;
- backend integration suite: **did not run** because `mariadb` could not be
  resolved (`MySQLdb.OperationalError: Unknown server host 'mariadb'`);
- production build: **not run** during this investigation; and
- browser/device validation: **not run**, per repository policy.

After implementation, run:

```sh
cd /workspace/development/frappe-bench/apps/temple_inventory/frontend
yarn test --run
yarn type-check
yarn build

cd /workspace/development/frappe-bench
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Run focused Python static checks that catch undefined names and the relevant
targeted formatting checks. Do not report backend behavior as validated until
the suite completes against a functioning database.

## Acceptance

This task is complete only when:

1. Loans use exact permission-aware database paging/counts and the complete
   loan regression matrix passes.
2. Warehouses display correct data or actionable diagnostics, and explicit
   repair/adoption safely handles existing topology.
3. Both scanner engines pass the full adapter/lifecycle matrix and production
   asset verification.
4. Every inherited task-8 requirement and all 27 parent acceptance criteria
   pass.
5. Frontend tests, type-check, build, and backend integration tests all pass in
   a functioning environment, with required manual checks handed off.
