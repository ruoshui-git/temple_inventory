# Task: Finish Inventory, Movement, and Reconciliation UX After `f255c66`

## Status and authority

Commit `f255c669c9ab74f572834cbed3ffffc31a8639f6`
(`INVENTORY_MOVEMENT_RECONCILIATION_UX_COMPLETION_TASK`) does **not** complete
`20260920_INVENTORY_MOVEMENT_RECONCILIATION_UX_COMPLETION_TASK.md`.

This is the next implementation handoff. It retains every locked requirement
and acceptance criterion from the parent task unless this file explicitly
changes the presentation copy or desktop layout. Do not treat routes,
components, or happy-path code as acceptance without the required behavior and
coverage.

Do not edit generated files under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand.

## Audit evidence from the last commit

Useful progress that must be preserved:

- the shell brand is now `物资管理` and is no longer a selected link;
- the duplicate Inventory Pending link was removed and shell state can be
  refreshed by the current workspace completion/deletion paths;
- the physical tree excludes configured root/system boundaries more carefully;
- current Inventory has desktop tables, mobile cards, active chips, facet-count
  payloads, debounced loading, result-pane scroll storage, and an expandable
  FAB;
- Item Detail now returns and manages general private attachments with a
  per-record `can_edit` capability;
- Loans received parent-oriented paging and Loan Detail received settled-line
  totals and attachments;
- the Warehouse destination now renders a structured tree and Workspace
  consumes warehouse scope seeds;
- movement history now attempts to include direct ERPNext Stock Entries and
  Stock Reconciliations;
- an initial durable reconciliation workspace, route, capability, baseline
  check, attachment path, and submission path were added; and
- frontend tests and type-check pass in the audited workspace: 7 files / 18
  tests, followed by `vue-tsc --noEmit`.

The backend suite was not validated during this audit. The command failed
before test collection because the environment could not resolve the `mariadb`
host. This must not be reported as a passing backend suite.

## Locked copy change: submit actions

Use one concise entry action on every editable stock-operation form:

- change `查看确认摘要` to `提交`;
- pressing `提交` still opens the confirmation summary and never submits
  immediately;
- the confirmation dialog heading is `确认提交`;
- retain the operation-specific context and the existing final explicit
  confirmation action inside the dialog;
- apply the same two-step convention to reconciliation: its form-level action
  is `提交`, it opens a discrepancy/attachment/audit summary headed `确认提交`,
  and only the final dialog action may call the confirmation endpoint; and
- keep focus trapping/restoration, Escape/cancel, saving/conflict protection,
  and double-submit prevention accessible.

Do not weaken explicit confirmation or change backend submission behavior for
this copy change.

## Locked desktop density and sticky browse header

At desktop width, move the routed page title into the persistent application
header instead of spending a separate content row on a large page heading.
This applies to the primary browse destinations and their modes; focused detail
and edit routes retain their Back affordance and contextual heading.

For Inventory (`当前库存 / 全部物品 / 效期批次`):

1. Render the three modes as one compact subtab row directly below the desktop
   application header.
2. Put search first in the results pane.
3. Keep search, scanner/filter controls, and result status visible while result
   rows scroll.
4. Always show status in the form
   `已加载 N · 筛选结果 M · 全部 T`; use the mode-appropriate label only when
   needed for clarity, for example `全部效期批次 T`.
5. Keep active-filter chips with the sticky result controls when space allows;
   if chips exceed the bounded sticky area, use the existing accessible
   collapse behavior rather than allowing the header to consume the viewport.
6. Recalculate the desktop work-area height from the real shell header,
   compact subtabs, and sticky result toolbar. Remove brittle fixed deductions
   that assume the old page heading height.
7. Filters and results remain independent bounded scroll panes; the toolbar and
   counts do not scroll away with rows. Mobile retains normal document
   scrolling and the existing bottom safe-area rules.

Use the same compact sticky search/count treatment on `货物流动` and other
paged browse pages where those controls exist, but do not invent subtabs for a
page that has no mode concept.

## Incomplete parent-task requirements

### 1. Shared hierarchy and facet contracts

The current `warehouseLabel()` helper is not the required structured,
centralized label adapter. Complete `local_label`, `full_label`, `search_text`,
and node-role/type semantics across all listed surfaces. Implement the locked
unspecified-location rules, including temple-level wording, room-only
unspecified-leaf collapse, room `（全部位置）` choices, raw-name/friendly-path
search, and consistent company-suffix removal.

Finish the compact, keyboard-operable tree-row contract. Verify parent partial
selection, focus behavior after chip collapse, and root/category boundary
handling in component tests.

Facet counts are only partial:

- Expiry currently derives both facets from already fully filtered rows, so it
  does not implement self-facet exclusion semantics;
- Expiry does not return complete ancestor Item Group counts;
- movement and Pending facets are absent; and
- permission/deduplication semantics have no backend regression coverage.

Return live distinct-row counts from the same base predicates as results and
test cross-facet/self-facet behavior for Current Inventory, All Products,
Expiry, Movements, and Pending.

### 2. Inventory mode foundation and scroll ownership

Inventory and Expiry still use separate page structures and divergent state,
observer, drawer, scroll-restoration, and error behavior. Make them one visible
foundation even if Expiry keeps an internal route/component. Preserve
compatible URL filters during mode switches.

The result toolbar is not sticky, Expiry and Movements do not restore the
bounded results-pane offset, and the current fixed-height calculation still
depends on the old vertical heading budget. Complete the parent task's desktop
scroll contract and unit-test upward scrolling, mode/detail return restoration,
and deliberate reset after filter changes.

Keep Current Inventory's desktop/mobile information priorities. Add the missing
semantic/component coverage for bold Available, mobile omission of secondary
quantities, zero-stock Catalog state, and the final-row safe area.

### 3. Shell state, selection, and creation capabilities

Shell refresh is currently dispatched only by a subset of workspace actions.
Refresh pending/draft counts after every confirmed movement, reconciliation,
draft deletion, repair, disposal, location assignment, and relevant route
return. Counts and pages must use identical server predicates.

The FAB is gated by one broad `can_create_stock_entry` flag and always receives
all three actions. Return and apply per-operation server capabilities. Complete
keyboard menu navigation, outside-close behavior, focus restoration, and tests.

Leaving Inventory selection mode still clears selection without the locked
guarded behavior. Finish the local preparation queue, selected-item seeding,
group/location scope, and route-leave acceptance cases from the parent task.

### 4. Product and transaction attachments

Item attachments are a useful partial implementation, but the shared
attachment contract/component and its permission/error tests remain missing.
Confirm File create/delete permission independently of Item write permission,
keep the primary-image replacement/clear rule, and include camera/fallback
behavior where supported.

Movement Detail and Reconciliation Detail must display attachments belonging
to direct ERPNext records as read-only audit evidence. Completed workspace,
Stock Entry, Stock Reconciliation, Loan, Return, and Loss attachment
immutability needs server tests.

### 5. Loans and Pending carryover

Loan parent paging is still incorrect for active loans: it pages submitted
parents before removing fully settled loans, can return short/empty pages, and
reports totals that include settled parents. Search totals are limited to the
current fetched page. Page the exact active-parent predicate, then fetch child
aggregates in bounded batches.

Loan Detail still calls the all-loan aggregation and filters it in Python.
Query only the requested permitted loan and return all original lines, outcomes,
metadata, audit context, and attachments without an all-site scan or per-line
Item lookups.

Pending still fetches a mixed page and switches between `损坏` and `未定位`
locally. This can hide matching rows beyond the current page and makes per-mode
counts inaccurate. Give Pending server-side mode/search/hierarchy/category
filters, stable item/batch grouping, exact per-mode totals/facets, URL state,
and incremental loading. Ensure the shell badge uses the same actionable
grouping.

### 6. Movement information architecture and query correctness

Make `/movements` the canonical route and `/history` the compatibility redirect,
not the reverse. Keep recognized query state.

The four primary movement modes must be mutually exclusive and one must be
visibly active; do not use a toggle that silently falls back to an unlabelled
all-types view. Keep special types in the compact `其他类型` surface. Drafts stay
in `更多 -> 草稿` and must not be a fifth movement mode.

The current `history()` implementation fetches up to an arbitrary candidate
cap from three sources, materializes documents/children, filters and sorts in
Python, then paginates. This can produce wrong totals, omit older matching
records, and does not meet the bounded database-query contract. Implement a
stable permission-aware union/read model with database-level filtering/paging
and bounded child previews. Add movement facet counts.

Complete desktop/mobile movement presentation: item preview, line count,
source/destination, UOM-grouped quantities, handler/recorder context, source
label, status, and the specified filters. Never add incompatible UOMs.

Complete detail for direct and app-authored Stock Entry and Stock
Reconciliation records: every permitted line, before/after/difference,
UOM-grouped summaries, source/status/company, audit context, files,
cancellation/amendment links, and permission-aware ERPNext links. Item Detail's
recent movement links must route reconciliation rows correctly.

### 7. Reconciliation authorization and durable lifecycle

The initial workflow is not accepted as production-complete. Finish and test:

- the exact create+submit+company+Item+Warehouse+allowed-leaf capability and
  its enforcement on bootstrap, deep link, create, every scope-changing save,
  baseline refresh, and confirmation;
- no draft on route mount and exactly one idempotent draft after the first
  meaningful edit;
- serialized autosave that retains edits made during an in-flight save,
  optimistic conflicts, offline/session recovery, and silent route adoption;
- signature invalidation for every content, scope, posting-time, and baseline
  change;
- an explicit user choice of one physical leaf scope and an editable
  reset-to-current posting time action;
- equivalent browse/search, camera scan, hardware/manual barcode entry, and
  repeated-scan behavior;
- duplicate-line prevention/focus and validated stock-UOM handling;
- batch expiry display, permitted new-Batch handling, ERPNext-compatible
  serial/batch bundle behavior, and a clear blocked serialized-item state;
- a genuinely bounded/paged whole-location expected set at the chosen posting
  time, including identities that existed at that time but have no positive
  current Bin; every expected row must receive an explicit state;
- changed/unchanged review controls, unresolved-conflict counts, UOM-grouped
  summaries, and the new two-step `提交` / `确认提交` dialog;
- locked posting-time baseline revalidation that preserves counts on conflict
  and invalidates signatures when refreshed;
- specific positive-quantity valuation/account/cost-center handling instead of
  relying on an opaque ERPNext submit failure;
- exactly-once authoritative Stock Reconciliation creation/submission on retry;
  and
- completed routing, shell refresh, read-only detail, history visibility, and
  attachments.

Do not add a parallel stock ledger, implicit whole-location zeroing, ordinary
quantity handling for serialized stock, or `ignore_permissions` submission.

### 8. Error handling and performance

Audit every routed page and endpoint listed in the parent task. Preserve useful
Chinese permission, validation, auth/CSRF, conflict, network, abort, and
non-JSON errors. Every foreground load needs a visible retry; background refresh
may retain stale rows with a warning. A generic `操作失败` remains last-resort
only.

Remove remaining all-site scans and repeated document lookups in Inventory,
Expiry, movement, loan detail, item detail/history, reconciliation batch/whole
scope, Pending, and bootstrap counts. Apply permission predicates before
aggregation and return stable totals from the exact result predicate.

### 9. Required coverage and validation

Implement the full frontend and backend matrices from the parent task. The two
new frontend files in `f255c66` cover only chip/FAB basics and two label values;
they do not satisfy the required routed-page, movement, reconciliation,
permission, concurrency, attachment, paging, or scroll coverage.

At minimum, add regression tests for every defect called out in this follow-up,
including:

- submit-copy/two-step confirmation behavior;
- desktop title placement, compact subtabs, sticky search/counts, exact loaded
  count, and independent scroll ownership;
- canonical movement routing and exclusive mode state;
- stable movement paging beyond the old candidate cap;
- active-loan and Pending exact totals across multiple pages;
- direct ERPNext movement/reconciliation classification and detail;
- unauthorized reconciliation access at every entry point;
- selective omission, whole-location explicit state, historical expected-set,
  batch identity, serialized blocking, valuation error, baseline conflict,
  signature invalidation, and idempotent confirmation; and
- File privacy, ownership, and completed-record immutability.

Run:

```sh
cd frontend
yarn test
yarn type-check

cd /workspace/development/frappe-bench
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Run `yarn build` when routing/production integration is ready. Do not run
browser automation unless separately requested. Hand off the parent task's
manual validation checklist, expanded with the sticky desktop header and
two-step submit-copy checks.

## Acceptance

This follow-up is complete only when all 27 acceptance criteria in the parent
task pass, every incomplete area above is implemented and covered, the new
desktop browse-header/count layout is present, all operation forms use the
locked `提交` -> `确认提交` two-step convention, and all declared automated checks
pass in a functioning environment.

## Deliberately excluded pending product approval

Do not implement additional presentation ideas merely because they appear in
the audit response that accompanied this task. Only the layout and copy changes
explicitly marked locked above are approved. Add any further ideas to a later
task after product confirmation.
