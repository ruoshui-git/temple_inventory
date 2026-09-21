# Task: Finish the Remaining Completion and Regression Gaps After Task 10

## Audit conclusion

`20260920_10_REMAINING_LOANS_WAREHOUSES_SCANNER_AND_UX_TASK.md` is **partially
implemented, but not complete**.

This audit was performed against commit `2102607` plus the current uncommitted
working tree. Preserve all existing changes. In particular, preserve the new
database-paged active-loan query, warehouse-management bootstrap and adoption
work, scanner error callback and throttling, canonical `/movements` route,
structured warehouse-label helper, Pending server filters, reconciliation
workflow additions, attachment `file_type` correction, and current passing
frontend tests.

Do not hand-edit generated files under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html`.

## What task 10 now implements

- `loans()` applies the active-parent predicate, count, stable ordering, offset,
  and limit in SQL instead of materializing all parents before paging.
- Active status is line-based, and item search is deliberately limited to an
  active matching line.
- Loan detail reads only the requested loan's rows and batches Item metadata.
- Warehouse management has its own bootstrap endpoint, distinguishes roots
  hidden by permissions from missing roots, reports legacy candidates, and has
  a preview/confirmed adoption path.
- Warehouse mutations now show errors in the page, and newly created leaves are
  enabled automatically.
- The scanner switch path passes the asynchronous error callback. ZXing decode
  errors are throttled, startup cancellation is improved, and Frappe cleanup
  continues after a rejected captured startup promise.
- `/movements` is canonical and `/history` redirects while retaining query
  state.
- Browse pages use the loaded/filtered/overall status format, sticky result
  controls were added, Pending has server-side modes and URL-backed filters,
  and operation buttons consume a capabilities map.
- Reconciliation now has a dedicated capability check, idempotent request ID,
  explicit leaf scope, line states, conflict refresh, read-only completion, and
  a two-step submit dialog.

These are meaningful improvements, but they do not satisfy the acceptance gate
in task 10 or the inherited 27 parent acceptance criteria.

## 1. Close the remaining Loans permission and coverage gaps

The parent page query is bounded now, but authorization is incomplete:

- `_active_loan_parent_query()` applies the Inventory Loan match condition but
  its Item search subquery joins `tabItem` without the current user's Item match
  condition.
- `_all_loan_rows()` returns child item codes through raw SQL. In `loans()`, an
  Item omitted by permission-aware metadata loading is still returned with the
  item code as its fallback name. This leaks inaccessible Item identities.
- `loan_detail()` fails the whole request when Item metadata is inaccessible,
  but its attachment query uses `frappe.get_all("File", ...)` without an
  equivalent File permission/ownership check and returns direct file URLs.
- Company and User Permission behavior for parent, Item, child, and File data is
  not established by integration tests.

Only the mocked RPC paging test was added. Add the complete real-data matrix
from task 10: multiple pages of active and settled parents, exact totals, all
search fields beyond page one, identical timestamps/name tie-breaks, settled
line plus active sibling behavior, company and User Permission isolation,
bounded query counts, every original line/outcome, attachment authorization,
and `/loans` error/retry/incremental-loading component behavior.

## 2. Complete warehouse repair scope, capabilities, and tests

The adoption flow is useful but narrower than the requirement:

- `_warehouse_adoption_candidates()` only considers descendants of the current
  configured temple root. It cannot adopt a legitimate company warehouse that
  is outside that root, and it returns no candidates when either configured
  root is stale or missing.
- Stale roots still route the manager to Desk settings; there is no read-only
  repair preview and apply flow for stale setting references on this page.
- Diagnostics expose a short action token rather than a complete structured
  action/link contract. Permission-hidden roots have no actionable remediation
  metadata.
- Existing-node editing does not support or validate parent changes or
  group/leaf conversion policy. It therefore does not cover all edit invariants
  required by task 10.
- `_stock_operation_capabilities()` still returns the same
  `Stock Entry.create && any allowed leaf` result for every movement kind. It
  does not model the distinct source, destination, leased, damaged, submit,
  company, Item, and Warehouse requirements of each operation.
- Adoption, nested-set preservation, ledger preservation, User Permissions,
  other-company isolation, group stock, summary failure, manager/non-manager
  behavior, first-leaf creation, and preview/application lack the required real
  integration and component tests.

Keep group-stock repair separate and explicit. Adoption may reparent warehouse
identity, but it must never move stock, rewrite ledger history, or turn a group
with stock into an operational leaf.

## 3. Finish scanner adapter verification and error containment

The switch callback and basic component behavior are covered, but the required
engine-adapter matrix is still absent. `frontend/tests/scanner-service.test.ts`
tests service orchestration with fake engines; it does not exercise
`FrappeScannerEngine`, `ZxingWasmScannerEngine`, script/module loaders, canvas,
media tracks, or the emitted WASM asset.

Add adapter tests for loader cache and failed-load retry, Frappe startup failure
and cleanup, the `locateFile` URL, ImageData decoding, empty results,
non-overlapping decode calls, stale result suppression, cancellation during
each startup phase, rejected play/module/decode paths, and track cleanup.

Also fix or explicitly test errors thrown before ZXing's current decode
`try/catch`, including a missing 2D canvas context. The scheduled `void
this.decode(...)` call must not produce an unhandled rejection; the UI callback
must receive a deduplicated useful error while manual entry and engine switching
remain usable.

Add component tests for initial startup rejection, retry recovery, late startup
after unmount, decode errors both before and after switching, and teardown while
startup is pending. Run the production asset checks required by task 10: hashed
reader WASM, service-worker precache, app-local URL, no runtime CDN dependency,
and no unintended generated diffs. Retain the manual two-engine device checks.

## 4. Replace the still-unbounded and capped browse implementations

The inherited performance acceptance criteria remain open:

- `workspace_api.history()` still computes `candidate_limit` (capped at 1000),
  reads up to that cap independently from three DocTypes, loads parent documents
  and children in loops, filters and sorts in Python, and only then pages. This
  can omit older matches and return incorrect totals and facets.
- `expiring_batches()` still loads every permitted Item and every enabled dated
  Batch, then calls `get_batch_qty()` for every batch/warehouse pair before
  filtering and paging.
- `inventory()` / `pending()` still materialize broad Item, Bin, and Item Group
  sets in Python and repeat broad reads to calculate overall totals and facets.
- Reconciliation whole-location and batch discovery page through broad records
  while doing repeated Item document and stock-balance lookups. The expected set
  is based on current positive Bins, not the required historical whole-location
  set at the locked posting timestamp.
- Item detail/history, bootstrap counts, and warehouse summaries still need the
  bounded-query and permission-before-aggregation audit required by task 10.

Implement database-level stable paging/counting and permission-aware base
predicates. Remove arbitrary candidate caps and document/N+1 loops. Add bounded
query-count and beyond-old-cap regression tests.

## 5. Finish hierarchy, facets, layout, and selection behavior

The structured label helper and sticky toolbar are partial foundations, not
completion:

- Most surfaces still call the string `warehouseLabel()` rather than consuming
  one shared structured label/node-role/type contract end to end.
- Complete the locked temple/room unspecified wording, room-wide choices,
  friendly and raw-name search, suffix stripping, partial selection, keyboard
  focus, and root/category boundary tests.
- Prove self-facet exclusion, ancestor counts, distinct-row deduplication, and
  permissions for Inventory, Catalog, Expiry, Movements, and Pending. Movement
  facets remain absent.
- Inventory and Expiry still have separate page implementations. Complete their
  compatible state and scroll contract.
- Fixed viewport deductions remain in CSS (`100dvh - 220px`, `100dvh - 190px`)
  instead of measuring the actual shell/subtab/toolbar layout.
- Add Expiry and Movement scroll restoration, upward-scroll, route-return,
  deliberate-filter-reset, zero-stock Catalog, mobile information-priority,
  semantic table/card, and safe-area tests.
- Complete guarded selection exit, local preparation queues, selected-item and
  hierarchy-scope seeding, route-leave behavior, and all FAB focus/outside-close
  cases.

## 6. Complete attachments and Item image behavior

There is still no shared attachment component/contract. Item, workspace,
reconciliation, and direct ERPNext detail use separate markup and inconsistent
metadata and permission behavior.

Complete independent File create/delete authorization, private ownership,
camera/fallback input, primary Item image replace/clear, read-only direct Stock
Entry and Stock Reconciliation evidence, and completed-record immutability for
workspace, Stock Entry, Stock Reconciliation, Loan, Return, and Loss. Add the
server and component coverage required by task 10; the current `file_type`
presence test is not permission or lifecycle coverage.

## 7. Finish movement information architecture and detail

The canonical route is fixed, but the data and detail acceptance criteria are
not:

- Replace `history()` as described above and add exact movement facets.
- Verify all four mutually exclusive primary modes, special types, Drafts under
  More, URL state, and exact totals in component and backend tests.
- Finish the required card/table information: bounded item preview, full line
  count, source/destination, UOM-grouped quantities, handler/recorder, source,
  status, and filters without combining incompatible UOMs.
- Complete direct and app-authored Stock Entry/Reconciliation detail with every
  permitted line, before/after/difference, summaries, company/audit context,
  files, cancellation/amendment links, and permission-aware ERPNext links.
- Add direct-entry classification, reconciliation detail, Item Detail routing,
  cancellation, amendment, and beyond-cap paging tests.

## 8. Finish reconciliation correctness and lifecycle coverage

The new workflow still misses production-critical requirements:

- Enforce and test the exact create, submit, company, Item, Warehouse, and
  allowed-leaf capability at bootstrap, deep link, create, every scope-changing
  save, baseline refresh, and confirm.
- Prove no draft is created on mount and exactly one idempotent draft is created
  after the first meaningful edit, including concurrent/retried requests.
- Use the shared serialized autosave/session/conflict recovery contract and
  prove edits made during in-flight saves are retained.
- Invalidate signatures for every content, scope, posting-time, and baseline
  change. Add the explicit reset-to-current posting-time control.
- Complete equivalent browse, camera, hardware/manual barcode, repeated-scan,
  duplicate focus, stock-UOM, permitted new-Batch, expiry, and serialized-item
  behavior.
- Build the bounded historical expected set at the locked timestamp and require
  an explicit state for every expected identity.
- Complete changed/unchanged review controls, unresolved-conflict counts,
  accessible dialog focus behavior, valuation/account/cost-center prerequisites,
  and counts-preserving baseline refresh.
- Prove exactly-once Stock Reconciliation creation and submission when failure
  occurs between ERPNext submission and workspace save. The current early
  return is idempotent only after `stock_reconciliation` has been durably linked.
- Add completed detail, attachments, history visibility, routing, and shell
  refresh coverage.

## 9. Required tests and validation

Audit-time checks against the current worktree:

- `yarn test --run`: **8 files / 24 tests passed**;
- `yarn type-check`: **passed**;
- `git diff --check`: **passed**;
- backend integration suite: **did not run** because MariaDB hostname
  resolution failed with `MySQLdb.OperationalError: Unknown server host
  'mariadb'`;
- production build: **not run**, because this was a read-only audit and build
  output must not create or overwrite generated assets unexpectedly; and
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

Run focused Python static checks for the touched backend and `git diff --check`.
Do not claim backend, production-asset, browser, or real-device behavior as
validated until the corresponding checks complete in a functioning environment.

## Acceptance

This follow-up is complete only when every task-10 acceptance condition and all
27 inherited parent acceptance criteria are implemented and covered; Loans and
all browse endpoints are permission-safe and bounded; warehouse repair handles
legacy and stale configurations through reviewed explicit actions; both scanner
adapters pass their lifecycle matrix; reconciliation is durable and exactly
once; all required automated checks pass; and the manual browser/device checks
are handed off without being represented as automated validation.
