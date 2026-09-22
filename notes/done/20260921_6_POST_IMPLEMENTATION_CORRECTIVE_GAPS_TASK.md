# Task 6: Post-Implementation Corrective Gaps

## Status and authority

This is a corrective implementation handoff for defects found after tasks
`20260921_1` through `20260921_5` were reported complete.

It does not replace their product design. It identifies the remaining gaps and
defines the integration gate that must pass before those tasks may be considered
complete.

Preserve the current working tree and do not revert unrelated changes. Do not
edit generated files under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand; regenerate them with the frontend
build only after source changes pass focused tests.

## Goal

Finish the warehouse abstraction across the entire application, correct the
bundle-backed Expiry quantities, complete Warehouse Detail and relative-expiry
filtering, close the remaining History/signature/scanner/layout gaps, and add
tests that exercise the real cross-layer contracts rather than only isolated
helpers.

ERPNext remains the source of truth. Stock must remain in valid leaf Warehouses.

## Confirmed audit evidence

The following was verified on `development.localhost` on 2026-09-21:

- frontend unit suite: 12 files / 62 tests passed;
- frontend type checking passed;
- backend focused suite: 36 tests passed;
- production build passed and emitted local ZXing reader WASM in the PWA
  precache;
- those green checks do not cover several failed acceptance contracts below;
- the fallback-role patch is absent from Patch Log;
- every existing generated fallback leaf has a null fallback role;
- Expiry returns 18 rows, but the modern bundle query assigns each Item's total
  batch quantity to every Batch belonging to that Item;
- for example, BAT-000001/2/3 are returned as 32 each, while their actual Serial
  and Batch Entry quantities are 6, 9, and 17;
- History returns empty warehouse and Item Group facets; and
- History list responses hydrate full state including base64 signatures, making
  a five-row response unnecessarily large.

Passing the existing suites is therefore not completion of this task.

## Priority and implementation order

Implement in this order:

1. correct batch identity/quantity and expiry boundary semantics;
2. normalize fallback-role data and warehouse presentation contracts;
3. migrate every warehouse consumer to the shared presentation model;
4. repair semantic room/location creation;
5. complete Warehouse Detail contracts and UI;
6. finish relative Expiry filters;
7. close History, signature, scanner, and remaining layout gaps;
8. add cross-layer regressions and run the full integration gate.

Do not build further UI behavior on the current incorrect warehouse or batch
contracts before steps 1–3 are stable.

## Workstream A — correct bundle-backed Expiry quantities

### Defect

The modern branch in `_expiring_batch_candidate_query()` joins Batch to Item and
Stock Ledger Entry to Serial and Batch Bundle, but does not join
`Serial and Batch Entry.batch_no` to `Batch.name`. For an Item with several
Batches, every Batch receives the sum of all bundle entries for that Item and
warehouse.

### Required correction

1. Add the missing batch identity predicate:
   `sbe.batch_no = b.name`.
2. Also require Item and warehouse consistency using the installed ERPNext
   Serial and Batch Bundle schema. Do not assume a bundle contains only one
   Batch.
3. Preserve signed quantity and cancellation semantics from ERPNext:
   non-cancelled SLE, submitted/non-cancelled bundle and child rows, supported
   inward/outward transaction types, and correct signed child quantity.
4. Retain the legacy direct-SLE branch only for rows with direct `sle.batch_no`
   and no modern bundle representation. Never double-count a row.
5. Aggregate by `(batch_no, item_code, warehouse)` before applying positive
   balance rules.
6. Derive page rows, location totals, result total, overall total, and facets
   from the same normalized balance source.
7. Do not restore an empty-result unbounded compatibility scan.

### Expiry boundary correction

`overdue` means strictly `expiry_date < server today`. A Batch expiring today is
`今天到期`, not overdue. Do not implement overdue with an inclusive
`expiry_to=today` predicate unless the query also applies a strict comparison.

Upcoming N-day windows remain inclusive of today and day N:

```text
today <= expiry_date <= add_days(today, N)
```

### Required tests

Create real bundle-backed integration fixtures with at least two Batches for one
Item and different quantities. Cover:

- receipt, issue, transfer, cancellation, and zero balance;
- two or more Batches within one Item/bundle population;
- exact quantity per Batch and per warehouse;
- no multiplication or cross-attribution;
- mixed legacy and modern rows without double-counting;
- expired, today, tomorrow, Nth-day, and N+1-day boundaries;
- stable adjacent pages, totals, and facets; and
- a valid empty result that performs bounded work.

The live BAT-000001/2/3 values 6/9/17 are audit evidence, not hard-coded test
data.

## Workstream B — canonical warehouse presentation and migration

### One fallback-role vocabulary

Use one vocabulary in the custom field, patch, backend serializer, TypeScript,
tests, and UI:

- `room_default`: fallback directly below a Room, displayed as `无货位`;
- `group_default`: fallback directly below another physical group type,
  displayed as `无房间`.

Remove or migrate inconsistent `site_default`/`physical_default` values unless a
separate, documented semantic use genuinely exists. Do not make frontend code
recognize several accidental aliases indefinitely.

### Migration

1. Repair `v2_mark_warehouse_fallbacks` or supersede it with a new idempotent
   patch. If `v2` may already have run on another site, add a new patch rather
   than silently changing only its old source.
2. Mark only unambiguous legacy leaves whose direct parent is a physical group
   and whose raw generated name exactly matches the supported legacy convention.
3. Assign the role from the direct parent's structured Warehouse Type, not tree
   depth.
4. Report ambiguous candidates for manager repair; never guess.
5. Verify Patch Log and live role counts after `bench migrate`.
6. Preserve Warehouse names, nested sets, allowed-location settings, Bin rows,
   Stock Ledger Entries, and links. The patch only adds semantic metadata.

### Presentation payload

Return one authoritative structured presentation collection containing enough
data for both logical browsing and operational leaf selection:

- real Warehouse identifier;
- parent identifier;
- local label;
- concise breadcrumb excluding infrastructure roots;
- semantic type;
- fallback role;
- logical display depth relative to the first user-facing physical node;
- filter value;
- permitted operation value;
- logical Room/default leaf relationship; and
- capability/visibility flags.

Do not remove fallback rows from the structured payload before transaction
selectors have enough information to label and resolve them. Logical Warehouse
browse may collapse them through the presenter.

### Infrastructure roots

The following are implementation nodes and must not appear in ordinary physical
filters or ordinary breadcrumbs:

- temple inventory root, such as `寺院仓库`;
- `实体库房`;
- the virtual/system subtree;
- borrowed, damaged, and unlocated system Warehouses unless a specialized
  workflow explicitly needs one.

The physical filter tree starts at meaningful user-facing groups such as
`第1寺院` and `第2寺院`.

## Workstream C — migrate every warehouse UI consumer

The Warehouse presenter must be the only display/selection translation layer.
Remove direct use of legacy `warehouseLabelContract(...).full_label` from normal
consumer templates.

Audit and migrate at minimum:

- Inventory;
- Expiry;
- Pending;
- History;
- Item Detail;
- Workspace;
- Reconciliation;
- Loan Item Picker;
- Warehouse tree/filter components;
- active-filter chips and result rows; and
- any remaining Settings surface that is not deliberately manager/raw topology.

### Display rules

- An indented named row uses only its local label: `A02`.
- Indentation supplies hierarchy; do not repeat `第2寺院 / A02` in that row.
- A logical fallback row below a Room uses `无货位`.
- A logical fallback below another physical group uses `无房间`.
- A standalone chip or result may use a concise disambiguating breadcrumb such
  as `第2寺院 / A02`, but never `寺院仓库 / 实体库房 / ...`.
- Search text may contain identifiers, stored labels, and concise breadcrumbs
  without displaying them all.
- Filters submit `filterValue`; stock operations submit only
  `operationValue`/real permitted leaves.

### Filter-tree rules

- Hide infrastructure nodes rather than merely removing their words from a
  displayed string.
- Preserve descendant expansion and group selection on the server.
- Keep local labels short at every indentation level.
- Generated room fallback leaves should normally collapse into the Room filter
  row. Where a selector must distinguish the fallback from named shelves, show
  `无货位` as a child.
- “All locations” is an explicit UI state, not selection of a hidden ERPNext
  root Warehouse.

### Room resolution

Replace `roomFor()` logic that recognizes only the literal English value
`Room`. Use the shared semantic-type normalization so current Chinese
`warehouse_type = 房间` records group correctly.

### Tests

Add component/contract coverage that uses the real Chinese structured payload,
including infrastructure roots, two temple groups, a Room, a fallback leaf, and
a named shelf. Assert:

- infrastructure roots are absent from filter rows;
- the Room row is `A02`, not a full path;
- the concise standalone breadcrumb is `第2寺院 / A02`;
- the fallback labels are correct;
- filter and operation values differ where required; and
- Workspace grouping recognizes `房间`.

## Workstream D — repair semantic room/location creation

### Unique internal fallback identity

Do not create every hidden child with raw `warehouse_name = 无货位`. The friendly
term is presentation, not durable identity.

Use an unambiguous, collision-free raw convention such as
`<room label> / 未指定`, mark it `room_default`, and present it as `无货位`.
Creating several Rooms in the same company must create one distinct fallback
leaf per Room.

### Parent rules

- `create_room` accepts an appropriate non-Room physical group below the
  configured physical root.
- It rejects Room, leaf, system, virtual, other-company, outside-root, and
  permission-hidden parents.
- `create_location` accepts a Room parent only.
- It rejects site/group, leaf, system, other-company, outside-root, and
  permission-hidden parents.

Keep creation atomic: Room, fallback leaf, allowed-location update, and
presentation response all succeed or all roll back.

Return a stable response containing the logical node, real created Warehouse
identifiers, and refreshed operation value.

### Tests

Cover at least two Room creations in one company, duplicate labels, rollback,
invalid parent combinations, company/permission boundaries, fallback-role
assignment, allowed-location update, and immediate operation resolution.

## Workstream E — complete Warehouse Detail

### Backend response contract

Return named fields that match the frontend types exactly:

- `warehouse` logical presentation row;
- `item_groups` containing every represented Item Group with quantities kept
  separate by UOM;
- `stock_preview` with a documented limit;
- `stock_total` representing the full permitted result count, not preview
  length;
- `movements` containing canonical latest movement summaries;
- `capabilities` for Receive, Issue, Transfer, and Reconcile;
- `filter_identifiers` for Inventory and History;
- `is_manager`/manager action flags where needed; and
- independent section error support if data is served separately.

Compute Item Group summaries independently from the preview cap. A room uses
only permitted descendant leaves. Never trust client-supplied descendants.

Movement summaries should use the canonical movement classification and include
enough information to route to detail, not raw SLE fragments alone.

### Frontend behavior

- Bind `库存分类` to the backend's actual `item_groups` field.
- Render friendly location labels in stock preview rows.
- Show the authoritative full count.
- Render working quick actions only when their exact capability is true.
- Seed operations with the permitted real leaf, never the group identifier.
- Make manager `更多` functional or remove it until real actions exist.
- Inventory deep link uses the Warehouse `filterValue`.
- History deep link uses the exact query key consumed by History.
- Stock and movement failures/retries must truly be independent. If using one
  atomic endpoint, present one atomic loading/error state instead of pretending
  section independence.
- Breadcrumbs must exclude infrastructure roots.

### Tests

Cover non-empty group summaries, multiple UOMs, preview shorter than total,
latest movement routing, deep-link query hydration, operation seeds, no-default
state, permission-hidden descendants, independent/atomic retry behavior, and
manager action visibility.

## Workstream F — finish Expiry relative filters

Add UI and route state for:

- `全部效期`;
- `已过期`;
- `未来7天`;
- `未来30天`;
- `未来90天`; and
- `自定义天数`, with an integer `未来 N 天` input bounded to 0–3650.

Requirements:

- relative window and exact dates are mutually exclusive;
- choosing a window clears exact dates;
- editing an exact date clears the window;
- route query persists `expiry_window` and `expiry_days`;
- reload/back restores the state;
- an active chip describes and removes the window;
- invalid route values are surfaced/corrected without silently widening the
  result; and
- API requests include the relative parameters.

Retain the corrected choice-list/radio spacing and friendly duration formatter.

## Workstream G — complete History list/facets/detail boundary

### Exact facets

The database path must return permission-aware warehouse and Item Group facets,
not `{}` placeholders. Apply self-exclusion consistently with the other browse
pages and derive facets from the same permission-scoped candidate set as totals.

### Bounded row summaries

Database-page parent identities first, then batch-hydrate summary data. Remove
per-parent `get_doc` hydration from the common list path.

List rows must not include:

- base64 signature images;
- complete workspace state JSON;
- all transaction lines; or
- attachment bodies.

Return instead:

- bounded item preview;
- authoritative full line count;
- UOM-grouped quantities;
- source/destination summary;
- handler/recorder names;
- source/context/status;
- canonical detail route; and
- cancellation/amendment indicators.

Full signatures, all permitted lines, attachments, reconciliation differences,
and audit evidence belong to the detail endpoint/page.

### Tests

Cover exact facets and totals under Item/Warehouse/company/User Permissions,
matches beyond prior caps, stable adjacent pages, direct and app-authored
records, cancelled/amended records, bounded query count, and an assertion that
list JSON contains no signature data URL.

## Workstream H — complete signature UX parity

Backend digest/status behavior is present, but every signer and every supported
workspace must expose the same UX.

### Workspace

- Show valid/stale/absent state for handler, reviewer, and recorder where used.
- Retain each drawing after business edits.
- Provide explicit re-confirm, redraw/replace, and clear actions.
- Show a concise current-content confirmation summary.
- Re-confirming one signer must not change another signer's validity.

### Reconciliation

- Preserve `handler_signature_state`, `reviewer_signature_state`, and any
  applicable recorder state during `adopt()`.
- Display retained stale drawings with the required warning.
- Provide explicit re-confirm and clear operations using the backend endpoints.
- Block review/confirmation locally when a required signature is stale or
  absent, while retaining the authoritative server validation.
- Preserve the drawing through autosave, baseline refresh, conflicts, and
  hydration.

Add component/workflow tests for both Workspace and Reconciliation; backend-only
digest tests are insufficient.

## Workstream I — finish scanner placement

Add the shared Scanner action beside every barcode-capable Item Picker field:

- Item search/lookup;
- new Item barcode entry; and
- any other barcode input found in a final audit.

Do not create another scanner engine. Reuse the existing Scanner component and
preserve typed text on open, failure, engine switch, and close. A one-value scan
fills or invokes the owning field and releases the camera. Manual/hardware entry
continues to work.

Add component tests for both Item Picker modes and for unknown-barcode
continuity into new Item creation.

## Workstream J — finish remaining layout requirements

1. Replace the Loans top-right `新建借出` action with the shared FAB pattern.
2. Give Loans the same loading/error/empty/count/incremental browse structure as
   the other list destinations.
3. Give More an intentional desktop grouping/grid rather than a narrow vertical
   mobile list in a wide viewport.
4. Confirm Pending and History share the browse shell, measured viewport,
   toolbar, filter, error, and incremental-loading rhythm.
5. Retain button hover/focus, reduced-motion, and context-action contrast fixes.

Do not reintroduce redundant `shell-page-title`, `page-heading`, or fixed
route-specific viewport deductions.

## Regression-test requirements

The existing tests missed real contract failures. Add tests at the layer where
each defect occurred:

- backend integration tests using real Serial and Batch Bundle rows;
- migration tests using legacy fallback names and both direct parent types;
- API contract tests using the real bootstrap presentation payload;
- frontend component tests rendering filter rows from that payload;
- Warehouse Detail response/component contract tests;
- Expiry request/route/window tests;
- History facet, payload-size/shape, paging, and query-count tests;
- Workspace and Reconciliation signature-state workflow tests;
- Item Picker scanner tests; and
- Loans FAB/More desktop structure tests.

Do not satisfy these requirements with source-string assertions alone. Exercise
observable request parameters, response shapes, rendered labels/actions, and
real permission behavior.

## Validation commands

From `frontend/`:

```sh
yarn test --run
yarn type-check
yarn build
```

From `frappe-bench/`:

```sh
bench --site development.localhost migrate
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Also run any new focused backend modules not discovered by the aggregate helper.
Verify the patch in Patch Log and inspect live bootstrap, Expiry, Warehouse
Detail, and History responses after migration.

Do not launch browser automation unless separately requested. Hand off manual
responsive, keyboard, contrast, and two-engine scanner validation.

## Live verification checklist

After migration/build, verify on `development.localhost`:

1. Filter tree starts with user-facing physical groups and contains neither
   `寺院仓库` nor `实体库房`.
2. The indented Room label is `A02`.
3. Existing Room fallback is recognized and displayed as `无货位` where needed.
4. A non-Room physical-group fallback displays `无房间`.
5. A Room resolves to its permitted fallback operation leaf.
6. Creating two new Rooms produces two distinct fallback Warehouses.
7. BAT-000001/2/3 display 6/9/17 on the current sample site, subject to any
   later legitimate transactions.
8. `已过期` excludes today; today displays `今天到期`.
9. Warehouse Detail renders non-empty `库存分类`, correct full count, recent
   movement links, and permitted quick actions.
10. History returns non-empty applicable warehouse/Item Group facets and no
    base64 signature images in list rows.
11. Reconciliation retains and exposes stale signature state and permits
    explicit re-confirmation.
12. Item Picker search and new-item barcode fields both have Scanner actions.
13. Loans uses a FAB and More uses an intentional desktop layout.

## Acceptance criteria

- Warehouse filters no longer display infrastructure roots or redundant full
  paths.
- All warehouse consumers use one structured presenter and respect separate
  filter/operation values.
- Existing and newly created fallback leaves have one consistent structured
  role and friendly wording.
- Multiple Rooms can be created without Warehouse-name collisions.
- Expiry quantities match real per-Batch balances; no cross-batch attribution
  or double-counting remains.
- Relative expiry filters are fully usable, URL-persistent, and date-correct.
- Warehouse Detail sections, totals, capabilities, links, and retry behavior
  match their backend contract.
- History facets are exact and list payloads are bounded summaries without
  signature images.
- Workspace and Reconciliation expose persistent valid/stale/re-confirmed
  signature UX for every required signer.
- Every barcode-capable Item Picker field has a shared Scanner action.
- Loans and More satisfy the agreed action/layout patterns.
- Migration, focused tests, full frontend tests, type checking, backend tests,
  production build, and the live verification checklist all pass.

## Non-goals

- Do not create parallel stock, batch, warehouse, signature, movement, or
  attachment stores.
- Do not rename or move existing ledger-bearing Warehouses merely to improve
  labels.
- Do not write stock to group Warehouses.
- Do not expose hidden ERPNext topology to volunteers.
- Do not weaken server authorization because frontend controls are hidden.
- Do not edit Frappe or ERPNext core.
