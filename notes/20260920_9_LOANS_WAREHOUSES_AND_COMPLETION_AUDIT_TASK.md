# Task: Fix Loans and Warehouses, Then Complete the Scanner and Inventory UX Follow-ups

## Status and authority

The current application does **not** complete either of these handoffs:

- `notes/20260920_7_Scanner_impl.md`
- `notes/20260920_8_INVENTORY_MOVEMENT_RECONCILIATION_UX_FOLLOW_UP_TASK.md`

This task records the audit of the current `version-16` working tree at commit
`2102607`, including the existing uncommitted attachment-field fixes. Preserve
those changes. Do not edit generated files under
`temple_inventory/public/frontend/` or `temple_inventory/www/inventory.html` by
hand.

The first two sections are release-blocking regressions reported from the live
UI. Fix and cover them before resuming the broader follow-up work.

## 1. Release blocker: the Loans page raises `NameError`

### Evidence and cause

`temple_inventory.inventory_api.loans()` calls bare `cint()` for `start` and
`page_length`, but `inventory_api.py` imports only `flt`, `getdate`, and
`nowdate` from `frappe.utils`. This produces the reported 500 response:

```text
NameError: name 'cint' is not defined
```

Other functions in the same module already use `frappe.utils.cint(...)`, while
`workspace_api.py` explicitly imports `cint`. Use one consistent, explicit
approach and add a regression test that invokes the endpoint with the string
arguments sent by an RPC request.

### The one-line import fix is not sufficient

The active-loan query still violates the preceding follow-up task:

- it pages submitted parent loans first and removes settled parents afterward;
- a page can therefore be short or empty while later active loans exist;
- unfiltered `total` and `overall_total` count every submitted loan, including
  fully settled loans;
- searched totals are derived only from the fetched page;
- item-code search is capped before the exact active-parent predicate is known;
- `loan_detail()` still calls `_all_loan_rows()` without restricting it to the
  requested parent and then performs one Item document lookup per line.

Implement an exact, permission-aware active-parent query. Apply search and the
outstanding-quantity predicate before stable parent pagination, then fetch the
selected parents' child aggregates and Item metadata in bounded batches.
`loan_detail()` must query only the requested permitted loan and return every
original line, outcome total, audit field, and attachment without an all-site
scan or per-line Item lookup.

### Required loan coverage

Add backend and routed-page regression tests for:

- RPC-style string `start` and `page_length` values (the reported `cint` bug);
- multiple pages containing a mixture of open and fully settled loans;
- exact active totals and no short page caused by post-page filtering;
- borrower, activity, parent ID, item code, and item-name search across pages;
- stable ordering when posting times tie;
- permission filtering and company isolation;
- detail loading that is scoped to one parent and does not perform N+1 Item
  reads; and
- an API error rendering a useful Chinese retry state on `/loans`.

## 2. Release blocker: the Warehouses page can show no warehouses

### Evidence and likely failure modes

`Warehouses.vue` renders only `bootstrap.physical_tree`. The backend builds that
tree by starting with qualifying **leaf** warehouses and retaining their
ancestors. Consequently:

- an existing physical group with no qualifying leaf descendant disappears;
- a site with missing/stale `root_warehouse` or company links returns an empty
  visible tree even when `tabWarehouse` contains records;
- legacy warehouse topology that was not adopted into the configured inventory
  structure can be invisible;
- a group-stock validation error during `bootstrap()` can prevent the warehouse
  management page from rendering the tree needed to repair the problem; and
- `Promise.all([bootstrap, warehouse_summaries])` discards a successful tree if
  the optional summaries request fails.

The page has no loading state and no empty-tree explanation. If `physical_tree`
is empty, it renders neither navigation nor a non-manager empty state; for a
manager it jumps to an add form whose parent list may contain an empty or stale
physical-root value. This makes “there are Warehouse rows in the database” look
like a blank warehouse browser.

The live database could not be inspected during this audit because bench/MariaDB
commands did not return a result in the available environment. The implementer
must first record the affected site's settings links, company, nested-set
bounds, warehouse types, group flags, and actual stock before choosing a data
migration. Do not assume that merely showing every ERPNext warehouse is safe.

### Required behavior

1. Separate the warehouse-management bootstrap contract from stock-browse
   validation so managers can see diagnostics and repair topology even when
   stock is incorrectly stored in a group warehouse.
2. Return a structured status that distinguishes:
   - loading;
   - no company/root initialization;
   - stale or missing system links;
   - no physical nodes;
   - physical groups that do not yet have leaves;
   - no allowed operational leaves;
   - inaccessible warehouses due to permissions; and
   - summary loading failure.
3. Include valid empty physical groups in the management tree. Continue to
   exclude virtual, loan, damage, and unlocated system branches from physical
   stock operations.
4. Preserve the invariant that stock can exist only in leaves. Never solve this
   by making a group warehouse selectable for movement or reconciliation.
5. Provide a manager-only, explicit repair/adoption path for existing ERPNext
   warehouses. It must preserve names, stock ledger history, company ownership,
   nested-set correctness, and User Permissions. Preview what will change before
   moving/reparenting any records, and use a versioned patch only when the
   transformation is deterministic for all installations.
6. Decouple tree rendering from `warehouse_summaries()`. Show the tree if
   summaries fail, with a warning and retry for the summaries.
7. Add clear Chinese empty and setup states for managers and non-managers.
   Never render an unexplained blank browser.
8. Validate the configured physical root and parent server-side in
   `configure_warehouse`; do not send `None`/stale parent names from the form.
9. Keep the current exclusion of system roots from operational choices while
   allowing the physical root to act as a valid manager-only creation parent.

### Required warehouse coverage

Add backend and component tests for:

- a physical group with no children;
- a group with children but no positive stock;
- a valid leaf with zero stock;
- legacy leaves outside the canonical physical root;
- missing/stale root and physical-root settings;
- different-company and permission-hidden warehouses;
- stock incorrectly present on a group;
- a summary endpoint failure while the tree still renders;
- manager and non-manager empty states; and
- creating a first leaf beneath an empty physical group and then allowing it
  for operations.

## 3. Scanner task audit

### Implemented and to preserve

The current tree contains useful implementation from the scanner task:

- exact `zxing-wasm` 3.1.4 dependency and reader-only WASM import;
- emitted same-origin `zxing_reader-*.wasm` and PWA `wasm` glob coverage;
- Frappe and ZXing-WASM engine adapters plus a selecting service;
- stored engine preference, visible engine label, and deliberate switching;
- camera stop/restart hooks for pause, session expiry, close, and unmount;
- manual input and shared two-second duplicate suppression; and
- basic component/service tests.

### Still incomplete

Complete the original scanner task rather than treating the current 6 scanner
tests as its full acceptance matrix:

- load the ZXing reader JavaScript lazily; it is currently imported at module
  evaluation time;
- reuse one canvas/context across frames instead of allocating a canvas on every
  decode;
- make stop during `loadedmetadata`/`canplay` startup release tracks promptly;
  the current stop waits for the startup promise, which may keep a stream alive
  until the 10-second video timeout;
- catch decode failures and surface a recoverable engine error instead of
  creating an unhandled rejection from the timer callback;
- ensure a failed/stale decode can never restart its timer or emit after stop;
- remove duplicate scanner CSS declarations;
- add adapter-level tests for Frappe loader caching/retry/cleanup and for WASM
  URL initialization, ImageData decoding, non-overlap, empty results, stale
  results, initialization failure, and track cleanup at every startup phase;
- add component coverage for engine startup failure with working manual entry
  and switch controls, and for late startup after unmount; and
- rerun the build verification from the original task: hashed WASM, service
  worker precache, same-origin asset URL, and no runtime CDN dependency.

Do not add telemetry and do not run browser automation unless separately
requested. Retain the manual two-engine device matrix from the scanner task.

## 4. Inventory/movement/reconciliation follow-up audit

Commit `188355e` implemented a small subset of the prior handoff: canonical
`/movements` routing, submit-button copy, a shell browse title, sticky CSS
declarations, server-side Pending mode selection, and a bootstrap capability
map. These changes are useful but do not satisfy the task.

The following requirements remain materially incomplete and retain the full
authority and acceptance criteria of
`20260920_8_INVENTORY_MOVEMENT_RECONCILIATION_UX_FOLLOW_UP_TASK.md` and its
parent task.

### Hierarchy, labels, and facets

- `warehouseLabel()` is still a presentation helper, not the required shared
  structured `local_label` / `full_label` / `search_text` / role/type contract.
- Complete unspecified-location, temple, room-wide choice, raw-name search,
  friendly-path search, company-suffix removal, partial selection, and keyboard
  behavior across every warehouse surface.
- Expiry facets still use already-filtered rows rather than self-facet exclusion
  and lack complete ancestor Item Group counts.
- Movements and Pending still do not expose the required live facets.
- Add permission, cross-facet, self-facet, and deduplication backend coverage.

### Browse layout, mode foundation, and scroll ownership

- Inventory and Expiry remain separate, divergent page implementations.
- Inventory's status still omits `已加载 N`; the locked exact count format is
  not consistently present.
- Sticky declarations were added without incorporating chips/counts into one
  bounded toolbar, and desktop height still uses fixed `190px`/`220px`
  deductions.
- Expiry and Movements still lack the required bounded-pane scroll restoration.
- Add routed component coverage for desktop title placement, compact subtabs,
  upward scrolling, detail/mode return, filter reset, mobile quantity priority,
  zero-stock catalog state, and final-row safe area.

### Shell refresh, operation capabilities, selection, and actions

- Browse FABs still gate on broad `can_create_stock_entry` instead of applying
  `stock_operation_capabilities` per action.
- The capability map currently repeats one Stock Entry create check for every
  operation; compute and enforce the real operation-specific permissions and
  prerequisites server-side.
- Complete refresh dispatch after every relevant confirmed operation and
  repair/action path, using the same predicate as the destination page/badge.
- Finish guarded selection exit, preparation queue, group/location seeding, and
  route-leave cases.
- Complete FAB arrow-key navigation, focus movement/restoration, and tests.

### Attachments

- Preserve the current uncommitted `file_type` corrections.
- Build the shared attachment contract/component and enforce File permission
  independently from Item write permission.
- Complete primary-image replacement/clear behavior and mobile camera/fallback.
- Show direct Stock Entry and Stock Reconciliation evidence read-only.
- Add ownership, privacy, and completed-record immutability tests for every
  supported transaction type.

### Pending

Server-side `damaged`/`unlocated` mode filtering is progress, but the page still
lacks search, hierarchy/category filters, URL state, facets, stable item/batch
grouping, and the exact badge predicate. Complete these and cover paging across
more than one page.

### Movement query and detail

`workspace_api.history()` still reads candidates from three sources up to an
arbitrary cap (maximum 1000), opens parent documents and Item documents in
loops, filters/sorts in Python, and only then paginates. Totals can still be
wrong and older matching records can disappear. Replace it with the required
stable, permission-aware database-level read model/union and bounded previews.

Complete mutually exclusive movement modes, the compact special-type surface,
movement facets, desktop/mobile summaries, direct ERPNext details,
reconciliation before/after/difference data, attachments, audit context,
cancellation/amendment links, and correct Item Detail links.

### Reconciliation authorization and lifecycle

The current Reconciliation page and endpoints are still an initial workflow,
not the production contract. In particular, complete:

- exact create+submit+company+Item+Warehouse+allowed-leaf authorization at
  bootstrap, deep link, creation, every save/scope change, refresh, and confirm;
- no draft on mount and exactly one idempotent draft after first meaningful edit;
- the shared robust autosave/conflict/offline/session recovery behavior;
- signature invalidation for every content, scope, time, and baseline change;
- editable reset-to-current posting time;
- equivalent browse, camera, manual/hardware scan, and repeat-scan behavior;
- duplicate focus, stock-UOM validation, batch expiry/new Batch handling, and
  explicit serialized-item blocking;
- a bounded historical whole-location expected set, including identities that
  existed at posting time but have no positive current Bin;
- changed/unchanged review, unresolved conflict count, grouped summaries, and
  an accessible two-step `提交` -> `确认提交` dialog;
- locked-baseline revalidation that preserves user counts;
- valuation/account/cost-center validation for positive adjustments;
- exactly-once Stock Reconciliation submission on retry; and
- completed routing, shell refresh, read-only details, history, and files.

The current `review` markup is not sufficient proof of the accessible dialog
contract. Add focus trap/restoration, Escape/cancel, save/conflict gating, and
double-submit coverage for both movement and reconciliation confirmations.

### Error handling and performance

Continue the complete routed-page/endpoint audit from the prior task. Every
foreground request needs a useful Chinese error and retry path. Preserve stale
data with a warning for failed background refreshes. Remove remaining all-site
scans, candidate caps, and per-document/per-line lookups from Inventory,
Expiry, Movements, Loans, Item Detail, Pending, Reconciliation, and bootstrap
counts.

## 5. Verification and acceptance

The audit itself changed no application code. At audit time:

- `yarn test --run`: **8 files, 21 tests passed**;
- `yarn type-check`: **passed**;
- backend integration tests: **not validated** because the database command did
  not return in the available environment; and
- production build: **not rerun**, to avoid modifying generated assets during
  an investigation-only task.

Implementation verification must include:

```sh
cd /workspace/development/frappe-bench/apps/temple_inventory/frontend
yarn test --run
yarn type-check
yarn build

cd /workspace/development/frappe-bench
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Also run focused Ruff/static checks that catch undefined names in touched Python
files. Do not report the backend suite as passing unless it runs to completion
against a functioning site database.

Acceptance requires all of the following:

1. `/loans` loads without a 500 and pages/searches exact active loans.
2. `/warehouses` always shows either the correct physical management tree or a
   clear, actionable state; existing valid warehouses are not silently hidden.
3. Existing stock and ledger history survive any warehouse repair/migration.
4. The complete scanner task matrix passes, including prompt stream cleanup.
5. Every still-open requirement and all 27 inherited acceptance criteria from
   the inventory/movement/reconciliation tasks pass.
6. Frontend tests, type-check, production build verification, and backend tests
   all pass, with manual browser/device checks handed off explicitly.
