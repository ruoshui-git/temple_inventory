# Task: Warehouse Abstraction, Completion Gaps, and Cross-App UX Reliability

## Status and design authority

This is an implementation handoff. The product decisions in this document are
confirmed.

For warehouse presentation, warehouse creation, fallback-location wording, and
the Warehouse destination, this task supersedes the overlapping requirements in:

- `20260920_GLOBAL_FEEDBACK_FILTERS_AND_INFINITE_LISTS_TASK.md`;
- `20260920_CORRECTIVE_UX_COMPLETION_TASK.md`; and
- `20260920_APP_NAVIGATION_OPERATIONAL_UX_TASK.md`.

This task also incorporates every still-open item found by re-auditing
`20260920_11_REMAINING_COMPLETION_AND_REGRESSION_GAPS_TASK.md` against commit
`5f9a62e` plus the live uncommitted working tree on 2026-09-21. Where this task
defines signature preservation, it supersedes the older requirement to erase
signature image data after a content change. Signature validity is retained
through explicit stale/re-confirmed state instead, as specified below.

Retain their compatible permission, stock-integrity, responsive-layout,
filtering, toast, incremental-loading, accessibility, and workspace requirements.
Do not edit generated files in `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand.

## Goal

Present rooms and locations in volunteer concepts while retaining ERPNext's
required group/leaf warehouse structure underneath.

A room is represented in ERPNext by:

1. a group Warehouse for the room; and
2. a generated child leaf Warehouse that holds stock not assigned to a named
   shelf/location.

The volunteer UI treats this pair as one logical room wherever the generated
leaf does not need to be distinguished. Users must not need to understand group
warehouses, leaf warehouses, or the generated `未指定` record.

Also rebuild the Warehouse destination as a browse page plus a separate detail
page, use a floating Add action, provide useful stock and movement context, and
correct warehouse labels throughout the application.

In the same delivery program, close the still-open task-11 permission,
bounded-query, scanner, attachment, movement-detail, and reconciliation gaps;
finish barcode scanning wherever barcode input is expected; preserve signatures
without treating stale attestations as valid; provide reliable completion
feedback; and make Expiry and desktop interaction/layout behavior consistent.

Keep the application Chinese and mobile-first. ERPNext remains the only source
of truth for Warehouse topology, stock balances, and stock movements.

## Current implementation diagnosis

- `inventory_api.configure_warehouse` already creates a room group and a child
  `<room> / 未指定` leaf when the client submits `warehouse_type = 房间` and
  `is_group = true`.
- The current form nevertheless exposes `类型` and `包含下级位置`, leaking the
  ERPNext representation and allowing the UI to request the wrong combination.
- `warehouseLabel()` and `warehouseLabelContract()` in
  `frontend/src/lib/api.ts` return full paths on nearly every surface. An
  indented option therefore renders redundant text such as `第2寺院 / A02`.
- The raw fallback-label logic can render a room fallback as
  `A02 / 寺院内，未分配房间`, which is semantically wrong.
- `Warehouses.vue` combines the hierarchy, selected-node details, creation,
  manager editing, permission toggles, diagnostics, and movement shortcuts in a
  single route.
- Warehouse creation is a top-right header button instead of the shared FAB
  interaction used elsewhere.
- Warehouse details contain only aggregate counts and operation buttons. They do
  not show category-grouped stock, recent movements, or links into filtered
  Inventory and History views.

## 2026-09-21 live-state audit

The task-11 handoff is **not complete**. The current tree contains meaningful
follow-up work beyond that earlier audit, including uncommitted changes, but the
full permission, lifecycle, performance, detail, and regression acceptance gate
has not been met.

Preserve the existing working-tree changes. Do not revert or overwrite them
while implementing this handoff.

### Validation evidence from this audit

- `yarn test --run`: **10 files / 39 tests passed**.
- `yarn type-check`: **passed**.
- `git diff --check`: **passed**.
- Backend focused integration suite: **36 tests passed** when run outside the
  restricted sandbox so the bench could resolve the `mariadb` Compose service.
- The first restricted backend run failed only because `mariadb` could not be
  resolved; it was not an application-test failure.
- Production build, browser automation, and physical-device scanner validation
  were not run during this documentation audit.

Passing existing tests does not close the task-11 gaps below; much of its
required permission and beyond-cap coverage does not yet exist.

### Expiry blank-page diagnosis

The empty `效期批次` page is a backend data-source defect, not an absence of
data and not primarily a Vue rendering problem.

Live-site evidence on 2026-09-21:

- `tabBatch` contains 18 batches and all 18 have an expiry date;
- `tabStock Ledger Entry` contains 208 rows, but none of those rows has the
  legacy `batch_no` field populated;
- 18 Stock Ledger Entry rows instead reference a `serial_and_batch_bundle`;
- joining those bundles to `tabSerial and Batch Entry` returns 18 batch rows
  with warehouse, signed quantity, and expiry data; and
- the current `expiring_batches(start=0, page_length=25)` response is empty
  with `total=0` and `overall_total=0`.

`_expiring_batch_candidate_query()` currently joins Batch to Stock Ledger
Entry with `sle.batch_no=b.name`. Current ERPNext stores this site's batch
identity and signed quantity in submitted, non-cancelled Serial and Batch Entry
children referenced by `sle.serial_and_batch_bundle`, so the join cannot match.
The subsequent compatibility path repeats the same legacy-ledger assumption in
`_current_batch_balances()`. Falling back merely because a valid query returned
zero rows also makes a genuinely empty result indistinguishable from an
unsupported storage layout.

Replace both paths with one version-aware normalized balance source:

1. The modern branch joins non-cancelled Stock Ledger Entry rows to submitted,
   non-cancelled `Serial and Batch Entry` children by bundle parent. Use the
   child's `batch_no`, `item_code`, `warehouse`, and signed `qty`, following the
   installed ERPNext batch-balance semantics and supported transaction types.
2. The legacy branch reads direct SLE `batch_no` plus signed `actual_qty` only
   where that direct value is set.
3. Combine compatible branches without double-counting, then aggregate by
   `(batch_no, item_code, warehouse)` and retain positive balances only.
4. Apply company, Item permission, physical-root, allowed-leaf, and User
   Permission predicates before aggregation. Page the aggregated batch set in
   SQL before hydrating locations.
5. Derive result totals, location quantities, overall totals, warehouse facets,
   and Item Group facets from that same source so the counts cannot disagree.
6. Do not choose a fallback implementation because the result is empty. Detect
   schema/capability support deterministically or use the normalized union; an
   empty result is valid data.

The live data should produce 18 positive batch/location candidates before
ordinary permission and filter narrowing. Treat that as audit evidence, not as
a permanent hard-coded expected count.

### Task-11 completion matrix

| Area | Current status | Work still required by this proposal |
| --- | --- | --- |
| Loans permission and coverage | Partial | Item predicates and permitted File reads were added, but the real-data multi-page, company/User Permission, attachment, tie-break, bounded-query, component retry, and picker paging matrix is absent. `loan_items()` still materializes the full outstanding set before slicing. |
| Warehouse repair and capabilities | Partial | Outside-root adoption, stale-root preview/apply, parent editing, and per-operation capability data improved. Real integration/component coverage for adoption, nested sets, ledger preservation, permission-hidden roots, group stock, summary failure, and manager boundaries remains incomplete. The logical-room task below now owns warehouse presentation/creation. |
| Scanner adapters | Partial | Adapter and component tests now cover several startup, cleanup, decode, cancellation, and stale-result cases. Loader cache/failure retry, every startup phase, late component startup, production WASM/service-worker assertions, and real two-engine device checks remain open. |
| Bounded browse queries | Partial | Production Inventory and Expiry gained database paths, and the common History path pages parents in SQL. History still hydrates parent documents in loops and returns empty warehouse/item-group facets; Expiry can fall back to the unbounded compatibility reader after an empty SQL result; loan picker, summaries, item detail, reconciliation discovery, and query-count proofs remain incomplete. |
| Hierarchy, facets, layout, selection | Partial | Searchable facets, URL state, sticky controls, scroll restoration, shell height measurement, and some selection seeding exist. Warehouse labels still expose redundant paths/old fallback wording; movement facets are incomplete; hierarchy/permission/count tests and several selection/route-leave/FAB cases remain open. |
| Attachments and Item images | Partial | A shared `AttachmentList` and permission-filtered reads exist. Full File create/delete/ownership/lifecycle coverage is missing. The shared component currently offers `设为主图` for any editable image attachment even on non-Item surfaces, because primary-image capability is not an explicit prop. |
| Movement information/detail | Incomplete | Canonical routing and basic list rows exist, but exact warehouse/item-group facets, complete row summaries, full direct/app-authored detail, cancellation/amendment context, attachment evidence, and beyond-cap tests remain open. |
| Reconciliation correctness/lifecycle | Partial | Historical expected-set queries, capability checks, draft reuse, review UI, attachments, and success feedback improved. Exact capability enforcement at every boundary, shared autosave recovery proofs, full scanner/batch behavior, content/signature validity, prerequisite checks, and exactly-once failure-window coverage remain open. |

### Improvement-suggestion completion matrix

| Suggestion | Current status | Decision for this task |
| --- | --- | --- |
| Scan barcode/QR code in Item Detail and wherever a barcode is expected | Partial | Item Detail now has `扫描添加条码`, and Inventory/Reconciliation/Workspace expose scanning. The Item Picker's search and new-item barcode fields still lack adjacent scanner actions, and coverage is missing. Build a reusable barcode-field/scanner interaction and audit every barcode-capable input. |
| Unknown homepage scan prompts before adding | Implemented, unverified | Inventory now opens a confirmation dialog and only enters the Receive/new-item flow after confirmation. Add focus, Escape/cancel, barcode continuity, and component tests; do not regress to immediate navigation. |
| Keep signatures instead of clearing after edits/autosave | Not implemented | The bug is confirmed: SignaturePad completion calls `changed(true)`, while frontend `invalidate()` and backend normalization clear signatures. Replace destructive clearing with persistent drawing plus explicit stale/re-confirmed validity. |
| Success toast after final submission | Implemented, lightly covered | Workspace and Reconciliation emit success toasts after confirmed submission. Add workflow-level tests proving one toast after a successful server response and none on failure, conflict, autosave, or duplicate clicks. |
| Friendly Expiry duration, data, and overdue row | Broken/partial | The page is blank because its query assumes legacy `Stock Ledger Entry.batch_no`, while this site stores batch identity in Serial and Batch Bundle children. Repair the normalized balance source, add the relative expiry-window filter below, fix the duration remainder error (for example 394 days), and retain a non-color `过期` cue plus accessible high-contrast row styling. |
| Hover feedback on all buttons | Implemented, needs audit | A global hover/focus-visible rule exists. Verify component overrides, disabled buttons, touch behavior, reduced motion, and that transforms do not cause clipping/layout movement. |
| Context action contrast | Implemented, needs regression coverage | The working tree gives context-bar buttons a white background with dark text. Retain it and add a focused visual/DOM contract test. |
| Desktop spacing and organization | Partial | Inventory's redundant shell title and Expiry's page heading were removed; Expiry now uses the Inventory destination shell, and contextual text can appear in desktop navigation. Consolidate the remaining inconsistent list/detail shells and remove obsolete CSS. |

## Non-negotiable inventory model

- Stock remains in real ERPNext leaf Warehouses only.
- A group Warehouse must never be written into a Stock Entry, Stock
  Reconciliation, Bin, or Stock Ledger Entry.
- The UI abstraction must not merge, delete, or rewrite ledger-bearing Warehouse
  records.
- Group/filter expansion, default-leaf resolution, company boundaries, physical
  root boundaries, allowed-location checks, Frappe User Permissions, and final
  leaf validation remain server-authoritative.
- Room versus location comes from structured Warehouse metadata, especially
  `warehouse_type`; do not infer it from hierarchy depth or names.
- The generated fallback role must be structured. Raw `未指定` parsing is allowed
  only to migrate and remain compatible with legacy records.

## Confirmed terminology

Fallback wording is based on the **direct parent's semantic Warehouse Type**,
not on hard-coded depth, temple names, or the number of ancestors.

| Underlying node | Direct parent type | Local UI label |
| --- | --- | --- |
| generated fallback leaf | `房间` / `Room` | `无货位` |
| generated fallback leaf | another permitted physical group type, including `地点` / `Location` | `无房间` |

This makes the rule general:

- a fallback below a room means that no shelf/location within that room was
  specified, hence `无货位`;
- a fallback below a non-room physical grouping means that no room was specified,
  hence `无房间`.

Do not display `房间内，未细分到货架` or `寺院内，未分配房间` anywhere in the
volunteer UI after this task.

The raw term `未指定` remains searchable for compatibility, but it is not the
default display text.

## Logical warehouse presentation contract

Build one centralized contract used by every warehouse surface. Names are
illustrative; the implementation may choose different identifiers, but it must
provide equivalent semantics.

```ts
type WarehousePresentation = {
  name: string                 // actual ERPNext Warehouse name
  local_label: string          // label within an already-visible hierarchy
  breadcrumb_label: string     // path without ERPNext company suffix
  search_text: string          // local, breadcrumb, raw, aliases, slash variants
  semantic_kind: 'site' | 'room' | 'location' | 'fallback'
  is_group: boolean
  parent_warehouse?: string
  default_leaf?: string        // actual permitted fallback leaf for a room
  filter_value: string         // group or leaf value submitted to browse filters
  operation_value?: string     // actual leaf submitted to a stock operation
}
```

### Local labels versus breadcrumbs

Use concise local labels whenever indentation or surrounding layout already
provides ancestry:

```text
第2寺院
  A02
    无货位
    货架1
```

Do not render `第2寺院 / A02` on the indented `A02` row. Do not render
`A02 / 货架1` on the already-indented `货架1` row.

Use breadcrumbs where context is not otherwise visible or duplicate local names
would be ambiguous, including:

- selected filter chips;
- search matches when identical labels exist in several branches;
- standalone detail headings/subheadings;
- movement and item-location text without a visible ancestor; and
- accessible names that need to preserve hierarchy context.

Example breadcrumbs:

- `第2寺院 / A02`;
- `第2寺院 / A02 / 无货位`;
- `第2寺院 / A02 / 货架1`; and
- `第2寺院 / 无房间`.

Do not expose the ERPNext company suffix as meaningful context.

### Search behavior

Search must match:

- the concise local label;
- the breadcrumb;
- the stored Warehouse label and actual Warehouse name;
- `无房间` or `无货位` as applicable;
- the legacy literal `未指定`; and
- slash variants with normalized surrounding whitespace.

Matching `A02/货架1` and `A02 / 货架1` must be equivalent.

### Logical room projection

The generated room fallback leaf is hidden on the Warehouse browse page. Its
stock contributes to its room's aggregate summary and detail.

The room remains one visible logical row/card named `A02`, even though its
default stock is physically held by the hidden child leaf. Named locations such
as `货架1` remain visible beneath the room.

The generated fallback is shown explicitly only where distinguishing that exact
stock scope is useful:

- in warehouse browse filters when the room also has named child locations;
- in current-stock location breakdowns;
- in movement records when the exact leaf matters; and
- in manager diagnostics for an invalid/ambiguous room mapping.

If a room has only its generated fallback child, filters collapse the redundant
pair to the room choice. Selecting that room as a browse filter includes its
permitted descendant stock.

### Context-dependent selection semantics

The same visible room has deliberately different values in different contexts:

- In a multi-select browse filter, selecting `A02` submits the real room group as
  `filter_value`; the server expands it to permitted descendant leaves.
- In a single-select transaction control, selecting `A02` submits its actual
  permitted fallback leaf as `operation_value`.
- Named child locations remain separately selectable in transaction controls.
- Expanding/collapsing a room uses a separate chevron or disclosure control; it
  must not make selection ambiguous.

The client must never place the room group itself into a stock line. Final
submission still validates the emitted leaf normally.

## Structured fallback identity and migration

Use structured metadata to identify a generated default leaf. The existing
Warehouse custom field `ti_system_role` already offers `无具体位置`; reuse it if
it can safely represent multiple physical fallback leaves. Ensure all Warehouse
metadata queries that build the UI contract include this field.

If implementation analysis proves that `ti_system_role` is constrained to a
globally unique role or otherwise unsuitable, add a narrowly scoped structured
Warehouse custom field instead. Do not continue relying on display-name parsing
as the permanent identity mechanism.

Add a versioned patch that:

1. examines only permitted physical-tree leaf Warehouses;
2. identifies legacy direct fallback children using the established terminal
   `未指定` convention;
3. marks an unambiguous fallback with structured metadata;
4. never renames or deletes the Warehouse;
5. never changes Bin or Stock Ledger data; and
6. leaves ambiguous cases unchanged and exposes an actionable manager diagnostic.

Multiple rooms may each have a fallback leaf. Code that resolves singleton
system roles must not assume `无具体位置` is globally unique.

Renaming a room does not require renaming its ledger-bearing hidden child. The
structured relationship and parent link determine its UI identity.

## Warehouse creation UX

### User-facing concepts

The custom UI exposes only:

- `添加房间`; and
- `添加货位`.

It does not expose:

- `is_group`;
- `包含下级位置`;
- group/leaf terminology;
- the generated fallback child name; or
- a general Warehouse Type selector.

Temple/site creation remains a setup responsibility and is not added to the
ordinary custom Warehouse UI.

### Add room

The Warehouse page FAB opens `添加房间`.

The form contains:

- room name;
- parent temple/site, using a searchable permitted physical-group choice when
  more than one is available; and
- Cancel/Save actions.

One server transaction creates:

1. a `房间` / `Room` group beneath the selected permitted physical parent;
2. its structured `无具体位置` fallback child leaf; and
3. the allowed-location association required to use the new leaf immediately.

Return both underlying names plus the logical room presentation. On success,
navigate to the new room detail page and show one success toast. A partial room
without its default leaf must never be committed.

### Add named location

A room detail page offers `添加货位` through its FAB/action menu. The parent room
is fixed by context. The form asks only for the location name.

The server creates a permitted leaf Warehouse of semantic type `库位` /
`Location` beneath the room and makes it immediately available where policy
allows. A named location must not be marked as the room fallback.

### Compatibility and validation

The existing generalized mutation may remain as a compatibility surface, but
the volunteer UI must use a semantic room/location contract. The server must
validate:

- manager permission;
- company;
- parent visibility and physical-root containment;
- allowed parent kind;
- duplicate/conflicting names;
- group/leaf invariants;
- exactly one structured fallback per logical room; and
- rollback of the whole creation operation on failure.

## Warehouse browse page

Route: `/warehouses`.

The page is a warehouse browser, not a split settings editor.

### Layout

- Desktop uses a compact table or dense hierarchical list.
- Mobile uses touch-friendly cards.
- Group rows are arranged beneath their physical site/temple and use local
  labels.
- A generated fallback leaf is suppressed as described above.
- Named child locations remain visible beneath their room.
- Clicking a logical room or named location navigates to its detail route.
- Preserve the user's list scroll position when returning from detail.

Each visible logical row may show:

- distinct item count;
- quantities grouped by UOM;
- number of named child locations for a room; and
- a short item-category preview on wider screens.

Never sum incompatible UOMs into one unitless quantity.

### Add action

Remove the top-right `添加房间 / 位置` button. Managers receive the shared `＋`
FAB with accessible label `添加房间`. Ordinary users do not receive it.

### Copy removal

Remove these implementation explanations from ordinary UI:

- `仅显示实体仓库；虚拟、借出、损坏和未定位系统仓库不会出现在这里。`
- `这是分组；库存操作会要求选择实际叶子位置。`
- `这是实际库存位置。`
- visible `分组`/leaf badges used only to explain ERPNext mechanics.

Continue to hide virtual/system Warehouses. This is application behavior and
does not need explanatory prose during normal use.

Show configuration and repair messages only when a real actionable problem
exists. Keep the existing manager-only preview/confirmation safeguards for
adoption and root repair.

## Separate Warehouse Detail page

Add a route equivalent to `/warehouses/:warehouse`. Use the actual encoded
Warehouse document name as the stable identifier; do not route by a mutable
display label.

The detail page is available for a logical room and for a named physical
location. It contains the following sections.

### Heading and navigation

- Back navigation to Warehouse;
- local heading;
- concise breadcrumb when useful; and
- key summary values without group/leaf explanations.

### Current stock by item category

“Groups of stock” means ERPNext Item Groups.

- Show every Item Group represented by positive visible stock in the selected
  scope.
- For each group, show distinct item count and quantities grouped by stock UOM.
- Provide a bounded compact item preview using the shared inventory row/card
  visual language.
- Do not build another independent unbounded inventory list on this page.
- `查看全部库存` opens Inventory with the selected room group or exact location
  encoded through the existing warehouse filter URL contract.

For a room, stock scope includes all permitted descendant leaves, including the
hidden fallback leaf and named locations. For a named location, scope is exact.

If there is no stock, use an actionable empty state such as
`此房间暂无库存`, with `入库` when the user has that capability.

### Recent movements

- Show the latest 10 permitted movements involving the selected scope.
- Reuse History's movement-row semantics rather than inventing a second record
  model.
- A room includes movements involving any permitted descendant leaf.
- A named location includes movements involving that exact leaf.
- Each row opens the existing movement/workspace detail.
- `查看全部记录` opens History with the same room/location filter serialized in
  the URL.

### Operational actions

Where server-confirmed capabilities permit, expose:

- `入库`;
- `出库`;
- `转移`; and
- `借出`.

For a logical room, these actions preselect its actual fallback leaf. The
workspace remains editable, so the user may choose a named child location before
confirming. For a named location, preselect that exact leaf.

Use the established workspace seed/scope mechanism without putting large JSON
payloads in the URL. Opening an action still must not create a server draft until
meaningful input exists.

### Manager actions

Keep administration secondary to operational use. Put manager-only actions in
an overflow menu or similarly quiet surface:

- rename;
- move to another eligible parent;
- add a named location to a room; and
- allowed-location management where still needed.

Do not expose group conversion, leaf conversion, or raw Warehouse Type changes.
Deletion and stock-moving warehouse conversion are outside this task.

## Filters and warehouse selectors across the application

Apply the centralized presentation contract to at least:

- Inventory;
- Pending;
- Expiry;
- History;
- Item Detail;
- Workspace transaction controls;
- Reconciliation;
- loan/item pickers where a physical location appears;
- active filter chips; and
- manager Warehouse choices.

### Browse filters

- Indented rows use local labels only.
- A room choice filters all permitted descendant leaves.
- If a room has named locations, expose its fallback as an indented `无货位`
  leaf so users can request only fallback stock.
- If a room has only its fallback, show only the room choice.
- A non-room physical group's fallback is `无房间`.
- Selected chips use enough breadcrumb context to disambiguate duplicates.
- Existing OR-within, AND-between, URL persistence, group expansion,
  deduplication, auto-apply, and stale-request rules remain in force.

### Transaction selectors

- Single-choice controls may show the logical room as a selectable `A02` row
  whose underlying value is its fallback leaf.
- Named child locations remain independently selectable.
- Non-room groups without an operational fallback are orientation-only and
  non-selectable.
- Do not offer both `A02` and a duplicate `无货位` option for the same underlying
  leaf in one transaction selector.
- The selected stock line stores only the actual leaf name.

## Cross-app barcode and QR-code scanning

Any visible field whose purpose includes entering, finding, or assigning a
barcode/QR-code value must have an adjacent, clearly named scanner action. Do
not require the user to discover a separate page-level scanner when the field is
already in front of them.

Audit and cover at least:

- Inventory search;
- Item Detail barcode editing;
- Item Picker search;
- Item Picker new-item barcode assignment;
- Workspace item selection/continuous scan;
- Reconciliation item search; and
- any future barcode field introduced by the touched flows.

Use one reusable field-level scanning interaction rather than embedding a
different Scanner lifecycle into every form. It must:

- preserve typed text when the scanner opens, fails, switches engine, or closes;
- place a successful scan into the associated field or invoke that field's
  documented lookup action;
- ignore an immediate duplicate scan without blocking a later deliberate reuse;
- support camera, manual input, and hardware-scanner keyboard input;
- retain both Frappe and ZXing-WASM engines;
- close/release the camera on success when the field expects one value;
- keep continuous-scanning workflows open where explicitly intended; and
- expose useful Chinese labels and error feedback.

Item Detail's existing `扫描添加条码` behavior is the baseline, but it needs
component coverage. Duplicate barcodes must be normalized and checked by the
server before Item save; client deduplication is convenience, not authority.

### Unknown scan on Inventory

Retain the new explicit confirmation step:

1. scan the unknown value;
2. show `未找到物品` and the scanned value;
3. ask whether to create a new item;
4. Cancel leaves the user on Inventory; and
5. confirm opens the existing Receive/new-item flow with the barcode prefilled.

Do not navigate merely because the scan was unknown. The dialog must support
Escape, outside-click only when safe, focus trapping/restoration, duplicate-scan
suppression, and a clear accessible name. The prefilled barcode and any active
transaction context must survive the route transition.

## Signature persistence and validity

The signature drawing must not disappear after signing, after autosave, or
after an ordinary form edit. The current frontend and backend clearing behavior
must be replaced.

### Confirmed validity model

- Preserve signature image data until the user explicitly presses `清除签名` or
  replaces the signature.
- Completing a signature must never invalidate or erase that same signature.
- Autosave/hydration, revision changes, server timestamps, attachment metadata,
  and other non-business state must not mark it stale.
- Compute a canonical digest/revision of the business content attested by each
  signature. Include movement kind, posting time, item identities and amounts,
  batches, source/destination leaves, relevant activity/borrower/purpose fields,
  and accountable-person declarations.
- If attested business content changes, keep the drawing visible but mark the
  signature `内容已更改，请确认签名仍适用于当前内容`.
- The signer may review the current confirmation summary and explicitly
  re-confirm the retained drawing, redraw it, or clear it.
- Final submission rejects a missing or stale required signature on the server.
- Adding or re-confirming a reviewer signature must not stale an unchanged
  handler signature.
- A conflict refresh must retain the local drawing safely while requiring
  re-confirmation against the resolved current content.

Store validity metadata in structured workspace state or narrowly scoped fields;
do not infer validity from whether a data URL happens to be present. Completed
records retain the submitted image and the content revision/digest it attested.

Apply the same semantics to Workspace and Reconciliation wherever signatures
are required. Update the older backend tests that currently assert destructive
signature clearing.

## Final-submission feedback

Every successful stock-affecting final submission produces exactly one success
toast after the server confirms completion:

- movement workspaces use `<操作>已完成`, for example `入库已完成`;
- reconciliation uses `盘点已完成`; and
- later accountable flows use equally specific wording.

Do not toast autosave success. A failed submission, validation error, conflict,
double click, retry of an already-completed idempotent request, or route refresh
must not produce duplicate success toasts. Keep the durable completed state
visible inline after the toast disappears.

## Expiry duration and overdue treatment

First repair the balance query described in **Expiry blank-page diagnosis**.
The page must render bundle-backed ERPNext batches and must not rely on an
unbounded per-batch compatibility scan.

Add one quick expiry-window control, separate from search/location/category:

- `全部效期` (no relative boundary);
- `已过期` (`expiry_date < server today`);
- `未来7天`;
- `未来30天`;
- `未来90天`; and
- `自定义天数`, revealing a positive integer `未来 N 天` input.

Upcoming windows exclude already expired rows and include today:
`server today <= expiry_date <= add_days(server today, N)`. Bound custom input
on both client and server (recommended maximum: 3650 days). The server remains
authoritative for `today`, including timezone/date rollover.

The quick window and exact `expiry_from`/`expiry_to` fields are alternative
ways to define the same date dimension: choosing a quick window clears exact
dates, and editing either exact date clears the quick window. Persist the
choice in the URL as `expiry_window=overdue|7|30|90|custom` and
`expiry_days=N`; show a removable active-filter chip. Reject an invalid enum,
negative/non-integer custom value, or `custom` without a value rather than
silently widening the query. Apply the same effective date predicate to result
rows, totals, and self-excluding facets.

Use a dedicated choice-list pattern for the `排序` and expiry-window options.
The current unreadable layout is caused by the global
`input, select, textarea { width: 100% }` rule also sizing radio inputs to the
full row. Reset both radio and checkbox controls to `width: auto` and
`flex: none`, then render each choice as a comfortably spaced, fully clickable
row with an `auto 1fr` icon/text layout. Keep visible focus, a minimum touch
target, and normal text wrapping. Apply the shared pattern to other radio groups
such as History instead of adding an Expiry-only override.

Move relative-day formatting to a tested shared helper. The output contract is:

- positive: `约x年x月x天（xxx天）`, omitting zero components;
- negative: `过期x年x月x天（xxx天）`, using the absolute day total inside the
  parentheses;
- zero: `今天到期`.

Use a deterministic approximation of 365 days per year and 30 days per month.
Calculate months and days from the remainder after removing whole years; do not
use the original absolute-day modulo for the final day component. Cover
boundaries including 1, 29, 30, 31, 364, 365, 394, 395, 730, zero, and their
negative equivalents.

An overdue table row/card uses an accessible high-contrast warm/red treatment.
Color is supplementary: the visible `过期…` text remains the primary status
cue. Verify link, secondary text, hover, focus, and selected-state contrast
inside the overdue row.

## Interaction feedback, contrast, and desktop consistency

### Button feedback

Retain the global hover and `:focus-visible` feedback now present in the working
tree, then audit every button variant:

- primary, secondary, link-style, icon, FAB, danger, disabled, menu, modal,
  table, card, and context-action buttons;
- no hover-only information;
- no hover transform that is clipped, shifts adjacent layout, or obscures a
  sticky region;
- touch devices do not retain a misleading hover state; and
- reduced-motion mode removes movement while retaining a non-motion color,
  border, or shadow cue.

### Context action bar

Retain a dark bar with clearly contrasting light buttons and dark button text,
or another combination meeting WCAG AA. White text on a white button is a
release blocker. Verify normal, hover, focus, active, and disabled states on
desktop and mobile.

### Page organization

Retain the accepted working-tree changes:

- Inventory has no redundant `shell-page-title`;
- Inventory and Expiry do not render a redundant `page-heading`;
- Expiry uses the same destination width, tabs, filter/results grid, toolbar,
  and spacing rhythm as Current Inventory and Catalog; and
- where a desktop-only route context is useful, place it in the desktop nav
  between primary navigation and `shell-actions`.

Finish the consistency pass by introducing shared layout primitives/tokens for
browse pages and detail pages instead of accumulating route-specific offsets.
The audit identified these additional improvements:

- Pending and History should use the same browse shell, result toolbar, error
  placement, counts, filter spacing, and measured viewport contract as Inventory
  and Expiry.
- Loans should use the same bounded list/count/error/empty/loading patterns and
  use a FAB for `新建借出` rather than a top-right desktop-only action.
- Warehouse browse/detail follows the dedicated design in this task.
- Item Detail should use a readable detail width or intentional desktop columns;
  `wide-shell` must not simply stretch a single text column to 1440px.
- Loan Detail, Workspace, and Reconciliation should share back/header/status and
  section spacing tokens while retaining form-appropriate widths.
- More should use an intentional desktop grid or grouped navigation rather than
  a narrow vertical mobile list floating in a wide viewport.
- Back links, page titles, primary actions, counts, and errors should appear in
  consistent positions for equivalent page types.
- Remove dead `.shell-page-title`/`.page-heading` rules after all consumers are
  migrated; do not retain hidden markup as spacing scaffolding.
- Continue measuring shell/header height through the existing CSS variable or a
  shared layout container. Do not reintroduce brittle route-specific
  `100dvh - Npx` constants.

## Incorporated task-11 completion requirements

The following unfinished work is part of this proposal even when it is not
directly visible in the Warehouse redesign.

### Loans

- Make active-loan list and line-picker queries permission-aware and genuinely
  database-paged before hydration.
- Never return an inaccessible Item code as fallback display text.
- Keep File reads permission-filtered and add ownership/private-file tests.
- Add real-data coverage for active/settled siblings, search beyond the first
  page, totals, stable ties, company/User Permissions, all outcomes, bounded
  queries, and `/loans` retry/incremental behavior.

### Warehouse repair and capabilities

- Retain reviewed preview/apply flows for root repair and legacy adoption.
- Add integration tests for outside-root candidates, stale roots, nested-set and
  ledger preservation, other-company isolation, permission-hidden roots,
  manager boundaries, group stock, summary failure, and first operational leaf.
- Keep group-stock repair explicit and separate from adoption.
- Test each movement capability against its actual create, submit, Item,
  company, source, destination, leased, damaged, allowed-leaf, and Warehouse
  requirements.

### Scanner platform hardening

- Complete loader cache and failed-load retry tests.
- Cover cancellation during each Frappe/ZXing startup phase, late resolution
  after unmount, rejected play/module/decode/canvas operations, engine switching,
  and track cleanup.
- Verify production output contains the hashed app-local reader WASM in the
  service-worker precache and has no runtime CDN dependency.
- Retain manual two-engine device validation as a handoff; do not represent it as
  automated.

### Bounded queries and facets

- Remove History parent-document/child N+1 hydration where bounded joins/batched
  hydration can be used.
- Implement exact permission-aware warehouse and Item Group movement facets;
  empty facet objects are not completion.
- Do not use the unbounded Expiry compatibility reader merely because the
  database query returned no rows. Detect a real legacy-data condition
  explicitly or migrate it.
- Database-page the outstanding loan picker rather than materializing all rows.
- Audit bootstrap counts, warehouse summaries, Item Detail history/active loans,
  reconciliation lookup/batches, Inventory/Pending facets, and overall totals
  for permission-before-aggregation and bounded query counts.
- Add regressions beyond previous caps and deterministic adjacent-page tests.

### Movement list and detail

- Complete mutually exclusive primary modes, special types, Drafts routing, URL
  state, and exact totals/facets.
- Show bounded item preview, full line count, source/destination, UOM-grouped
  quantities, handler/recorder, source, and status without adding incompatible
  UOMs.
- Complete app-authored and direct Stock Entry/Reconciliation detail with all
  permitted lines, reconciliation before/after/difference, audit context,
  attachments, cancellation/amendment relationships, and permission-aware Desk
  links.
- Add direct classification, Item Detail routing, cancellation/amendment, and
  beyond-cap tests.

### Attachments and Item images

- Make primary-image controls an explicit Item-only capability of the shared
  component; Workspace/Reconciliation attachments must not show `设为主图`.
- Complete File create/delete, private ownership, parent permission, completed
  immutability, replace/clear primary image, and direct-detail evidence tests for
  Workspace, Stock Entry, Stock Reconciliation, Loan, Return, and Loss.
- Preserve camera capture plus ordinary file fallback and consistent metadata.

### Reconciliation

- Enforce exact capability checks at bootstrap, deep link, create, every
  scope-changing save, baseline refresh, and confirm.
- Prove no draft on mount and exactly one idempotent draft after the first
  meaningful edit, including concurrent/retried calls.
- Use the serialized autosave/session/conflict contract and retain edits made
  during an in-flight save.
- Complete camera/manual/hardware/repeated scanning, duplicate focus, UOM,
  permitted new Batch/expiry, and explicit serialized-item behavior.
- Keep the historical expected set locked to the posting timestamp and require a
  state for every expected identity in whole-location mode.
- Complete changed/unchanged review, unresolved-conflict counts, focus behavior,
  valuation/account/cost-center prerequisites, and counts-preserving refresh.
- Prove exactly-once Stock Reconciliation submission across the failure window
  between ERPNext submit and durable workspace linkage.
- Complete read-only detail, attachments, History visibility, routing, shell
  refresh, and the persistent-signature contract above.

## Backend/API requirements

### Bootstrap/presentation metadata

Extend the relevant bootstrap response or add a bounded warehouse-presentation
endpoint containing enough structured data for the client to render the logical
tree without reimplementing fallback discovery.

At minimum return:

- actual Warehouse name;
- stored label;
- parent;
- lft/rgt;
- normalized semantic type;
- group flag;
- structured fallback role;
- local label and breadcrumb, or sufficient authoritative fields for one shared
  frontend presenter;
- logical room/default-leaf relationship;
- filter value;
- permitted operation value; and
- relevant capability flags.

Do not expose an operation value for a leaf the current user cannot read/use.

### Detail data

Add a `warehouse_detail`-style endpoint for bounded detail metadata and summary
data, or compose equivalent existing endpoints without N+1 requests. It must:

- validate the requested node against company, visible physical tree, and User
  Permissions;
- calculate a room from permitted descendant leaves only;
- return UOM-safe totals and all represented Item Group summaries;
- return only a bounded stock preview;
- return or support a bounded latest-10 movement request;
- provide filter/deep-link identifiers; and
- never trust a client-supplied descendant list.

Reuse the existing Inventory endpoint for the full stock list and History for
the full movement list. Extend their URL hydration only where needed to support
an exact room/location deep link.

### Mutation contract

Introduce semantic create operations or equivalent validated modes, for example:

```json
{ "kind": "room", "name": "A02", "parent": "..." }
{ "kind": "location", "name": "货架1", "parent_room": "..." }
```

The API response for room creation includes both the group and generated leaf,
but the success message and navigation refer to the logical room only.

### Performance

- Aggregate stock summaries in bounded queries; do not query once per Warehouse
  or Item Group.
- Fetch recent movements with deterministic ordering and a stable tie-breaker.
- Reuse shared warehouse descendant/filter helpers.
- Retain existing group-stock diagnostics.

## Suggested frontend structure

Names are illustrative rather than mandatory:

- move warehouse presentation out of the generic `lib/api.ts` into a focused
  shared warehouse utility/composable;
- extend the hierarchy option contract with separate display, filter, and
  operation values;
- split `Warehouses.vue` into browse-only responsibilities;
- add `WarehouseDetail.vue`;
- add a compact semantic room/location form in a dialog, drawer, or routed
  surface suitable for mobile;
- reuse `FloatingActionMenu.vue`, inventory row/card primitives, toast service,
  active-filter serialization, and movement-row presentation; and
- avoid adding a new UI dependency.

## Accessibility and responsive behavior

- The Add FAB has a visible tooltip where appropriate and an accessible Chinese
  name.
- Dialogs/drawers trap focus only while modal and restore focus to the FAB on
  close.
- Separate disclosure and selection controls in hierarchical selectors.
- Indentation is supplemented with accessible breadcrumb text.
- Room proxy options announce the logical label, not the hidden raw leaf name.
- Tables remain horizontally contained; mobile cards preserve the same
  information and touch targets.
- Recent movement and stock sections use semantic headings and useful empty
  states.
- Respect reduced-motion preferences.

## Error and edge states

- Missing default leaf: the room remains viewable, but transaction actions that
  require it are unavailable and managers receive an actionable repair message.
- Multiple marked fallback leaves: never guess. Disable proxy selection and show
  a manager diagnostic.
- Fallback leaf outside allowed/user-visible scope: do not expose it as an
  operation value.
- Partial room creation failure: roll back both records and the allowed-location
  update.
- Detail stock failure and movement failure are independent; one section may
  remain useful while the other offers retry.
- A removed or inaccessible route target shows a clear not-found/permission
  state and a path back to Warehouse.
- A renamed Warehouse remains reachable through its current document name and
  refreshed links; do not persist mutable display names as identifiers.

## Parallel implementation plan

This master file is the design authority, not a shared implementation queue.
Implementation is divided into four self-contained agent handoffs:

1. `20260921_2_INVENTORY_BACKEND_WAREHOUSE_EXPIRY_AND_LOANS_TASK.md` owns
   `inventory_api.py`, inventory-side migrations/fixtures, Expiry's normalized
   bundle-aware data source, warehouse contracts, and inventory/loan query gaps.
2. `20260921_3_WORKSPACE_BACKEND_MOVEMENTS_RECONCILIATION_TASK.md` owns
   `workspace_api.py` and the server-side movement, signature, attachment, and
   reconciliation lifecycle.
3. `20260921_4_WAREHOUSE_FRONTEND_TASK.md` owns Warehouse presentation helpers,
   browse/detail pages, route, Warehouse-specific components, and scoped styles.
4. `20260921_5_CROSS_APP_FRONTEND_EXPIRY_SCANNING_AND_LAYOUT_TASK.md` owns
   Expiry and the other non-Warehouse pages/components, global styles, scanner
   field UX, signatures, toasts, and cross-app consistency.

These four agents can work concurrently after the shared fixtures in their
Boundary sections are agreed. They must not edit outside their ownership without
an explicit handoff. In particular, task 4 uses component-scoped Warehouse
styles and task 5 is the sole owner of global `style.css`; task 4 exports the
warehouse presenter and task 5 consumes it in non-Warehouse pages.

### Integration wave

After all four worker tasks satisfy their focused tests:

1. integrate real inventory-backend payloads into Warehouse and Expiry and
   remove fixture-only shims;
2. run cross-page label, filter URL, workspace seed, permission, attachment,
   movement, reconciliation, and signature scenarios;
3. run the full frontend and backend suites plus production build/asset checks;
4. review `git diff` for unrelated/generated changes; and
5. hand off manual browser widths and two-engine device validation.

No package may claim overall completion based only on its focused tests. The
acceptance criteria at the end of this document are the integration gate.

## Backend test requirements

Add focused coverage for:

- fallback alias selection by direct parent Warehouse Type rather than depth;
- `房间`/`Room` parent producing `无货位`;
- another physical group type producing `无房间`;
- legacy raw `未指定` remaining searchable;
- migration marking only unambiguous physical fallback leaves;
- several rooms each having their own structured fallback;
- missing and multiple fallback diagnostics;
- atomic room plus fallback creation and rollback;
- named-location creation without fallback role;
- duplicate names, invalid parents, cross-company parents, virtual parents,
  unauthorized parents, and non-manager mutations;
- logical room operation resolution yielding only an allowed leaf;
- final stock validation continuing to reject groups;
- room detail aggregation over permitted descendants only;
- exact location detail aggregation;
- UOM-separated and Item-Group summaries;
- latest movements scoped to the room/location and ordered deterministically;
- Inventory and History deep-link filters preserving permission-aware expansion;
- canonical signed-content digest stability, stale detection, re-confirmation,
  conflict behavior, and server rejection of stale required signatures;
- successful idempotent submission returning one completed result suitable for
  one client toast;
- the Loans, bounded-query, movement-detail, attachment, capability, and
  Reconciliation matrices incorporated above; and
- existing group-stock detection and stock calculations remaining intact.

Run from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If the restricted sandbox cannot resolve the Compose service names, rerun with
approved unsandboxed execution before reporting a database failure, as described
in `AGENTS.md`.

## Frontend test requirements

Add focused coverage for:

- local versus breadcrumb label rendering;
- no repeated ancestor in indented filters;
- the complete `无房间`/`无货位` label matrix;
- room-only fallback collapsing;
- `无货位` appearing as an exact filter only when the room also has named
  locations;
- raw `未指定`, friendly alias, breadcrumb, local, and slash-normalized search;
- a browse-filter room using its group filter value;
- a transaction room proxy using its actual leaf operation value;
- no duplicate room/default-leaf choice in transaction controls;
- Warehouse table/cards, hierarchy, summaries, scroll restoration, and detail
  navigation;
- manager-only FAB visibility, focus behavior, create form, success, and errors;
- room creation navigating to its logical detail;
- Warehouse Detail category summaries, bounded stock preview, empty state,
  partial section failure, and recent movements;
- `查看全部库存` and `查看全部记录` URL serialization/hydration;
- detail quick actions seeding the actual fallback or named leaf;
- manager actions being secondary and absent for ordinary users;
- a scanner action adjacent to every audited barcode-capable input;
- Item Detail scan add/deduplicate/save and Item Picker scan continuity;
- unknown Inventory scan confirmation, Cancel, Escape, focus restoration, and
  confirmed barcode prefill;
- signature drawing persistence through completion, edit, autosave, conflict,
  and reload, plus stale/re-confirm UI;
- exactly one completion toast and no autosave/failure/conflict duplicates;
- Expiry duration boundaries and negative equivalents, including correct
  post-year remainder math;
- overdue row/card text and contrast states;
- hover/focus-visible/disabled/touch/reduced-motion behavior for button variants;
- context-action-bar contrast states;
- shared Inventory/Expiry/Pending/History desktop spacing and measured height;
- Loans FAB and consistent list feedback;
- explicit Item-only primary-image actions in `AttachmentList`; and
- removal of the specified ERPNext implementation copy.

Run from `frontend/`:

```sh
yarn test
yarn type-check
yarn build
```

Do not launch Playwright, Chromium, camera emulation, or other browser automation
unless separately requested. The user performs final browser validation.

## Manual validation checklist

Validate representative widths near 375px, 768px, 1024px, 1280px, and 1440px.

- The Warehouse browser shows `第2寺院` then indented `A02`, never
  `第2寺院 / A02` on that row.
- A room's hidden fallback is not shown as a duplicate Warehouse card.
- A room with named locations displays those locations beneath it.
- An Inventory/History/Expiry filter can select `A02` for all descendants and
  `无货位` for only fallback stock when applicable.
- A direct fallback under a non-room physical parent displays `无房间`.
- Searching `未指定`, `无货位`, `无房间`, `A02/货架1`, and spaced path variants
  finds the expected choices.
- Selecting `A02` in a transaction stores the real fallback leaf; selecting
  `货架1` stores that named leaf.
- The Warehouse page Add action is a FAB and no top-right Add button remains.
- Creating a room shows only volunteer concepts, creates both underlying nodes,
  and opens the logical room detail.
- Creating a named location from Room Detail makes it immediately usable.
- Warehouse Detail shows all represented Item Groups, a compact stock preview,
  the latest 10 relevant movements, and working filtered links.
- Warehouse Detail quick actions seed the correct actual leaf and remain
  editable before confirmation.
- Returning from detail restores the Warehouse list position.
- Ordinary users do not see manager actions.
- The UI contains none of the removed group/leaf or system-warehouse explanatory
  copy.
- Scan from Item Detail and Item Picker barcode fields; typed content survives
  camera failure, engine switching, and closing.
- Scan an unknown code on Inventory, cancel once, then confirm once; only the
  confirmed action enters new-item creation and the barcode is prefilled.
- Sign, wait for autosave, and make a business edit. The drawing remains visible,
  becomes stale, and can be explicitly re-confirmed before submission.
- Submit each movement flow and reconciliation; exactly one success toast appears
  after completion and the inline completed state remains.
- Check positive, zero, and overdue Expiry durations around year/month boundaries
  and verify overdue row contrast without relying on color alone.
- Keyboard through global buttons and context bars; focus feedback is visible and
  text remains readable.
- Compare Inventory, Catalog, Expiry, Pending, History, Loans, Item Detail, More,
  Workspace, and Reconciliation desktop spacing and action placement.

## Non-goals

- Do not change inventory accounting or create another stock ledger.
- Do not put stock in group Warehouses.
- Do not rename/delete legacy `未指定` Warehouses solely for presentation.
- Do not create temples/sites from the ordinary Warehouse UI.
- Do not expose raw group/leaf or Warehouse Type controls to volunteers.
- Do not add Warehouse deletion or group/leaf conversion.
- Do not duplicate the complete Inventory or History implementation inside
  Warehouse Detail.
- Do not weaken User Permissions, allowed-location rules, company boundaries, or
  final submission validation.
- Do not hard-code `第1寺院`, `第2寺院`, room codes, or hierarchy depths.
- Do not solve signature persistence by treating every retained image as valid;
  stale signatures require explicit re-confirmation.
- Do not toast autosave success or navigate on an unknown scan without explicit
  user confirmation.
- Do not create page-specific scanner engines, duration formatters, or desktop
  height constants when a shared contract applies.

## Acceptance criteria

- Warehouse fallback copy is consistently `无货位` below a room and `无房间`
  below another physical group, determined from the direct parent's structured
  type.
- Indented hierarchy rows use concise local labels; standalone contexts use
  disambiguating breadcrumbs.
- Rooms are logical UI locations backed by an ERPNext group and a structured
  default leaf, without ever placing stock in the group.
- A transaction room choice resolves to the actual permitted fallback leaf; a
  browse-filter room still includes all permitted descendants.
- The generated room fallback is hidden from the Warehouse browser and does not
  appear as a duplicate transaction choice.
- Managers create rooms and named locations through semantic forms. Room
  creation atomically creates and enables its fallback leaf.
- Warehouse uses a manager-only Add FAB and has no top-right Add button.
- Warehouse browse and Warehouse Detail are separate routes.
- Warehouse Detail shows all represented Item Group summaries, a bounded stock
  preview, recent movements, filtered Inventory/History links, and correctly
  seeded operational actions.
- ERPNext implementation explanations specified in this task are absent from the
  normal UI.
- Labels and logical mappings are shared across Inventory, Pending, Expiry,
  History, Item Detail, Workspace, Reconciliation, Warehouse, and chips.
- Every barcode-capable field has an adjacent scanner action with camera,
  hardware/manual, error, duplicate, and cleanup behavior preserved.
- Unknown Inventory scans ask before opening barcode-prefilled item creation.
- Signatures remain visible through edits/autosave and carry explicit valid or
  stale state; stale required signatures cannot be submitted until re-confirmed.
- Successful final movement and reconciliation submissions emit one success
  toast, while autosave/failure/conflict paths emit none.
- Expiry durations use the confirmed friendly wording with correct year/month/day
  remainder math, and overdue records have accessible high-contrast treatment.
- Every enabled button has perceivable hover and keyboard-focus feedback;
  context-action buttons remain legible in every state.
- Inventory, Catalog, Expiry, Pending, History, Loans, and other touched pages
  use consistent shared spacing/layout behavior without redundant headings or
  brittle fixed viewport deductions.
- All incorporated task-11 permission, bounded-query, scanner-adapter,
  attachment, movement-detail, and Reconciliation gaps are closed by tests; a
  passing legacy suite alone is not sufficient.
- Backend/frontend focused tests, type checking, and the production build pass,
  with environmental limitations reported precisely.
