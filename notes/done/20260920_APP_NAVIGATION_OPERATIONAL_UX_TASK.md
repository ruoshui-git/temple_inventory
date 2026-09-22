# Task: App Navigation and Operational Inventory UX

## Status and authority

This is the confirmed product and implementation handoff for reorganizing the
volunteer-facing application around current inventory, loans, pending physical
work, and physical warehouses.

For overlapping behavior, this document is authoritative for:

- application navigation and the initial route;
- the distinction between current stock, the product catalog, and expiry batches;
- item and loan detail navigation;
- bulk action entry points and their prefill rules;
- the meaning and visibility of pending work;
- the physical-warehouse browser and warehouse administration entry points;
- placement of install, account, and logout actions; and
- deferred workspace creation and visually stable autosave.

Retain all compatible filtering, hierarchy-autocomplete, independent desktop
scrolling, image, feedback, accessibility, pagination/incremental-loading, and
permission requirements from:

- `AGENTS.md`;
- `notes/20260920_CORRECTIVE_UX_COMPLETION_TASK.md`; and
- the earlier filtering task documents that it incorporates.

Where an earlier task treats missing descriptions or photos as operational
`待处理` work, this document supersedes it: those deficiencies must not create
pending rows or navigation badge counts.

This is an implementation task, not permission to redesign ERPNext's inventory
model. ERPNext stock records and submitted stock documents remain the source of
truth. Do not edit generated frontend files by hand.

## Objective

Replace the current action-dashboard landing page with a responsive application
shell whose initial screen is `当前库存`. Make frequent browse-and-act workflows
direct, while keeping uncommon utilities out of the primary navigation.

The completed application must provide:

1. fixed primary navigation for `库存`, `借用`, `仓库`, and `更多`;
2. a conditional, permission-aware `待处理` notification and page;
3. `当前库存`, `全部物品`, and `效期批次` as modes of the Inventory destination;
4. product and loan detail pages that expose context before an operation starts;
5. explicit selection mode for starting multi-item inventory operations;
6. a physical-only warehouse browser with location-scoped quick actions;
7. manager-only warehouse administration inside the Warehouse destination;
8. deferred workspace creation without route-change remounts or visual jumps;
9. discoverable draft management without meaningless empty workspaces; and
10. consistent Chinese, mobile-first, accessible interaction throughout.

## Current implementation diagnosis

The implementation agent must inspect the current source before editing and
preserve useful work already present. At the time of this handoff:

- `frontend/src/pages/Inventory.vue` combines an action-dashboard home, current
  stock, broad attention results, scanner, install, settings, and logout.
- `/` opens that action dashboard. Current stock is a secondary `查看库存` view.
- Inventory, Expiry, History, and Settings already contain partial responsive
  filtering/table/tree work. Reuse it rather than recreating a second system.
- `ItemDetail.vue` shows basic stock locations and recent movements but not a
  complete product gallery, batch view, active-loan state, guarded editing, or
  contextual operations.
- `outstanding_loan_items()` returns an unpaginated flat collection and performs
  repeated per-line aggregate queries. It is not a suitable contract for the new
  loan list and detail pages as-is.
- Current pending logic combines stock in the configured pending warehouse with
  missing descriptions and conditionally required photos. The latter makes the
  view too broad and must be removed from operational pending semantics.
- `Settings.vue` is currently the room/location administration surface. Its
  required manager controls must move into the Warehouse destination before the
  separate navigation entry is removed.
- Workspace load currently schedules creation of a new server workspace even
  when the user has only opened `/new/:kind`.
- `App.vue` keys routed content with `route.fullPath`. Replacing a new-operation
  URL with `/workspace/:name` can therefore remount the workspace and cause the
  visible jump, focus loss, or scroll reset reported by the user.

These observations are not instructions to discard current work. Correct it in
place and keep APIs backward-compatible where practical.

## Locked information architecture

### Primary destinations

The fixed primary destinations are:

1. `库存`
2. `借用`
3. `仓库`
4. `更多`

There is no standalone home dashboard and no Quick Actions tab.

The default application route opens `库存` in `当前库存` mode. Existing useful
deep links should continue to work or redirect deliberately.

### Responsive navigation

On mobile, render the four fixed destinations as bottom navigation. Account for
safe-area insets and add sufficient content padding so navigation and contextual
action bars never obscure the last result.

On desktop, render the same destinations as top navigation. Do not invent a
different desktop information architecture.

Primary navigation remains fixed in order and position. Browse and detail pages
retain access to it. A transaction workspace may remain a focused flow with an
explicit back/close affordance rather than duplicating the bottom navigation.

Back navigation belongs at the upper-left. Logout or account controls must never
occupy the conventional back position.

### Conditional pending destination

`待处理` is not a fixed bottom/top tab. When the current user has one or more
actionable pending rows, show an accessible header notification such as
`待处理 5` with a numeric badge. Activating it opens the Pending page.

When the count is zero, omit the header notification so users are not distracted.
Keep a quiet `待处理（0）` link in `更多` for discoverability. This link does not
receive attention styling when empty.

Counts must be permission-aware and derived from the same query semantics as the
Pending page. Do not show a count for records the user cannot open or act upon.

## Application shell requirements

Create or extract a shared application shell instead of reimplementing navigation
inside every page. It owns, as applicable:

- desktop top navigation;
- mobile bottom navigation;
- active-destination state;
- the conditional pending notification;
- desktop account menu;
- responsive content boundaries and safe-area spacing; and
- global PWA update and session-expiry surfaces already provided by `App.vue`.

Navigation must use real routes and preserve browser back/forward behavior.
Restore inventory filters and scroll position when returning from a detail page
where reasonably possible. Do not encode large or sensitive workspace seed
payloads directly into query strings.

The shell must not key a routed workspace solely by `route.fullPath`. A URL
replacement within the same workspace lifecycle must not recreate the component.
Setup repair/reload behavior that genuinely requires a reset may use a separate,
explicit content version key.

## Inventory destination

### Modes and vocabulary

Inventory has three prominent, mutually exclusive modes:

```text
[ 当前库存 ] [ 全部物品 ] [ 效期批次 ]
```

- `当前库存` is the default and shows enabled stock items with positive current
  quantity in the user's permitted inventory scope.
- `全部物品` is the complete permitted product catalog, including enabled stock
  items with zero quantity.
- `效期批次` is a batch-level view of positive visible stock with an expiry date.

Do not describe the catalog and quantity state as separate primary apps. A
product is the catalog/master record; stock is its changing quantity, location,
batch, loan, and damage state.

Expiry is a view mode, not a checkbox and not a primary navigation destination.
The route may still use a dedicated internal component, but Inventory must remain
the active primary destination and users must perceive one coherent surface.

### Search, scanner, filters, and results

Keep search prominent in every mode. Place a clearly labelled scanner icon in or
immediately beside the search control.

- A known product/barcode scan opens Product Detail.
- A known batch scan opens the related product with the batch context visible.
- An unknown barcode offers `通过入库建立新物品` and carries the barcode into the
  existing create-item/receive flow.
- Camera scanning and hardware-scanner/manual input remain equivalent paths.

Reuse the confirmed responsive hierarchy-aware filter foundation. Warehouse and
category filtering, URL state, stale-request handling, friendly warehouse labels,
desktop independent scrolling, counts, images, and list loading must not regress.

Current Inventory results should make at least these values distinguishable:

- available quantity;
- total quantity in the configured inventory scope;
- on-loan quantity;
- damaged quantity; and
- unlocated/pending quantity.

Do not add incompatible UOM quantities together without labels.

### Default new-operation action

On mobile Inventory browse screens, show a floating `＋` button above the bottom
navigation. With no active selection it opens:

- `入库`
- `出库`
- `转移`

On desktop, provide the equivalent visible `新建库存操作` menu in the result
toolbar rather than a floating mobile-style control.

Damage, repair, disposal, return, and loss remain available from their relevant
contexts. Do not turn the default menu into an exhaustive list of every movement
kind.

### Explicit selection mode

Add a visible `选择` control. Do not require long-press to discover multi-select.

- Normal row/card activation opens Product Detail.
- Selection mode adds checkboxes and a contextual action bar.
- Leaving selection mode clears selection after confirmation if local edits would
  otherwise be lost.
- Selection must remain understandable with keyboard and assistive technology.

The contextual actions are:

- `入库`
- `出库`
- `转移`
- `借出`

Selected products seed the new operation, but the seed is not final stock data.
Apply these prefill rules:

- Never preselect a group warehouse as a source or destination.
- If the current view is scoped to exactly one permitted leaf location, that leaf
  may be preselected where appropriate.
- For stock-out, transfer, and loan, a source may also be preselected when the
  product has exactly one eligible positive-stock location.
- Otherwise the workspace asks for a source per affected line.
- For receipt, a destination remains explicitly confirmable.
- Non-return bulk quantities remain blank/unconfirmed. Do not assume the entire
  available quantity, and do not silently submit a default quantity.
- Seeded products may be shown in a local preparation queue until their required
  line fields are valid; do not create invalid Stock Entry rows merely to persist
  a selection.

The normal review and explicit confirmation flow remains mandatory.

## Product Detail

Product Detail is the canonical page for understanding one product. It should
contain, when applicable:

- the main Item image plus every image File attached directly to that Item;
- product name, code, category, description, UOM, and barcodes;
- available, total, on-loan, damaged, and unlocated quantities;
- quantities by permitted physical location;
- relevant batch numbers and expiry dates;
- active loans involving the product;
- recent inventory movements; and
- contextual actions such as receipt, issue, transfer, loan, or mark damaged.

Do not expose empty sections. Keep summary information first and progressively
disclose long location, batch, loan, and history collections.

### Product editing

Show an edit affordance only when the server confirms the user has the relevant
Item write permission.

The normal guarded edit surface may include:

- product name;
- category;
- description;
- images; and
- barcodes.

Item code, stock UOM, and batch/expiry tracking settings are not casual edits once
transactions exist. Keep them manager-only and validate whether ERPNext permits
the change for the actual record state. Never rely on hiding controls for
authorization.

Do not implement inline list-row editing. Open Product Detail and then an explicit
edit state so list browsing cannot accidentally mutate master data.

## Loans destination

### List model

The primary Loan list contains submitted loan transactions with at least one
outstanding loan line. One card/row represents one loan transaction, not one flat
loan-item line.

Each result should summarize:

- borrower, when independently recorded;
- activity, when present;
- loan date;
- a preview of the first few products;
- number of outstanding item lines;
- meaningful outstanding quantity summaries with UOMs; and
- partial-return state when applicable.

Search must match loan identifier, product code/name, borrower, activity, and
batch as applicable. Matching a product not shown in the preview must still return
the parent loan.

Provide real paging or the shared incremental-loading behavior. Do not load every
loan and issue repeated aggregate queries per item. Compute returned, damaged,
lost, and outstanding values in bounded queries and enforce the current user's
permissions and company scope.

The Loan tab has a contextual new-operation menu containing:

- `借出`
- `归还`
- `记录遗失`

### Loan Detail

Activating a loan opens a dedicated page showing:

- loan identifier and status;
- borrower declaration/borrower, activity, purpose, and notes;
- loan date, handler, witness/audit context, and recorded-by metadata as allowed;
- attachments;
- every original loan line;
- original source location and batch;
- loaned, returned, damaged, lost, and outstanding quantities per line; and
- links to related submitted return/loss records where useful.

Submitted signatures are audit evidence. Display them only in accordance with
permissions and do not make submitted records editable.

### Return and loss actions

Use the label `创建归还记录`; the action creates a prefilled workspace and does
not immediately move stock.

- If exactly one line is outstanding, the action may select it directly.
- With multiple outstanding lines, let the user select one or more explicitly.
- Provide visible checkboxes; do not rely on long-press.
- Default each selected return quantity to that line's full outstanding quantity.
- Keep quantities editable for partial return.
- Preserve the exact `Inventory Loan Item` link, UOM, batch, borrower/activity
  context, and original return destination.
- Revalidate outstanding quantities on the server when saving and again when
  confirming, protecting against another return completed in the meantime.
- Continue through the normal workspace review and explicit confirmation.

`记录遗失` is a secondary action using the same selected-line model and exact
loan-item linkage.

Multi-select across different loan transactions is out of scope for this task.
The current business record has one borrower/activity context, so combining
unrelated loans would create ambiguous audit data. Multi-select is limited to
lines within one Loan Detail page.

Fully settled loans remain readable by deep link/history but expose no new return
or loss actions for zero-outstanding lines.

No expected-return-date field or overdue-loan workflow is included in this task.

## Pending destination

### Exact semantics

Pending contains only physical stock requiring an operational decision:

1. `损坏`: positive stock in the configured damaged leaf warehouse.
2. `未定位`: positive stock in the configured pending/unlocated leaf warehouse.

Use an internal switch:

```text
[ 损坏 ] [ 未定位 ]
```

Do not include missing descriptions, missing photos, incomplete catalog metadata,
zero-stock products, or draft workspaces. Those concerns must not contribute to
the Pending navigation badge.

The badge count is the number of actionable result rows under the same grouping
used on the page, not a sum of physical quantities. Define a stable grouping key
that preserves relevant item and batch distinctions, and return separate damaged
and unlocated counts as well as the combined count.

### Pending actions

Damaged rows open sufficient context to choose:

- `修复归库`, selecting a permitted physical destination leaf; or
- `正式报废`, using the accountable disposal workflow.

Unlocated rows open sufficient context to assign stock to a permitted physical
leaf location through an auditable transfer. Do not rewrite Bin or Stock Ledger
Entry rows directly.

Nothing is resolved merely by opening or selecting a row. Stock remains in the
configured system leaf until the resulting workspace is confirmed.

## Warehouses destination

### Visible hierarchy

The Warehouse browser shows only the hierarchy below the configured `实体仓库`
root.

- Do not show the `实体仓库` root itself.
- Completely exclude `虚拟仓库` and every descendant.
- Do not expose Leased, damaged, pending, or other system warehouses merely
  because they exist in the full warehouse tree.
- Continue to apply company, Frappe User Permission, configured allowed-location,
  and leaf/group rules on the server.

Build hierarchy from structured parent/lft/rgt data. Preserve the friendly
warehouse-label behavior from the corrective filtering task.

### Warehouse summaries

Each visible room/location may show:

- number of distinct products, for example `18 种物品`;
- total quantities grouped by stock UOM, for example `83 件 · 4 箱`;
- top-level category summaries on desktop, limited to a short preview plus
  `另有 N 类`; and
- operational warning counts where they are genuinely relevant.

Never produce a single unitless total by adding incompatible UOMs. Group nodes
aggregate permitted descendant leaves; leaf nodes show their exact stock.

Category preview text may be hidden on narrow mobile screens. Core product and
quantity counts must remain available.

Selecting a warehouse opens its inventory using the shared inventory row/card
patterns rather than creating a separate list design.

### Location-scoped quick actions

Warehouse Detail provides:

- `入库`
- `出库`
- `转移`
- `借出`

For a selected leaf:

- receipt preselects it as destination;
- issue preselects it as source;
- transfer preselects it as source; and
- loan preselects it as source.

For a selected group/room:

- never write the group into a stock line;
- scope item and location choices to permitted descendant leaves;
- preselect a descendant only when exactly one eligible leaf exists; and
- otherwise ask the user to choose the actual leaf source/destination.

### Integrated warehouse administration

Remove the separate `仓库设置` entry from More only after all necessary controls
have moved into Warehouse.

Managers with server-confirmed permission receive:

- `添加房间 / 位置` from the Warehouse screen;
- add-child from an eligible selected group/room;
- edit warehouse name/type where ERPNext permits;
- group-versus-leaf explanation;
- `允许库存操作` for eligible leaves; and
- save/error/success feedback.

Ordinary users do not see unusable administrative buttons. Every create/update
operation must still validate manager permission, company, parent hierarchy,
system-boundary exclusions, and leaf/group invariants on the server.

Preserve old `/settings` bookmarks with a deliberate redirect to Warehouse or a
short compatibility route. Do not leave two competing warehouse editors.

## More destination

More contains low-frequency and account-related destinations:

- `库存记录`;
- `草稿`, with a nonzero count badge;
- `活动` where a standalone activity browser/manager exists or is added;
- the quiet `待处理（N）` link;
- `安装到手机 / 电脑` when installation is applicable;
- account identity; and
- `退出登录`.

Do not include `仓库设置` after the controls are integrated into Warehouse.

On desktop, account identity and logout may also appear in a top-right account
menu. Logout must not be a standalone back-like button. Separate it visually from
ordinary navigation and require a deliberate activation.

Do not reserve a permanent top-level install icon. Keep installation in More and
retain appropriate one-time install guidance when the browser supports it.

## Deferred workspace creation and autosave

### Required lifecycle

Autosave remains a feature. It protects multi-item, multi-location, attachment,
and signature work. It must never submit stock automatically.

Change the new-workspace lifecycle as follows:

1. Opening `/new/:kind` initializes local form state but creates no server
   `Inventory Workspace` and no draft Stock Entry.
2. Opening/closing a picker, scanner, help panel, or optional-details disclosure
   is not a meaningful edit.
3. The first meaningful business-data change schedules workspace creation.
4. Meaningful changes include adding/editing an item line, entering transaction
   context, changing transaction date/time, adding audit/signature data, or
   choosing an attachment.
5. Attachments must ensure a workspace exists before upload because File needs a
   document target.
6. After creation, retain the existing serialized save queue, optimistic revision
   checks, dirty state, signature invalidation, session recovery, and explicit
   confirmation invariants.
7. A user choosing a bulk/context action with valid seeded business data has made
   a meaningful change; it may create a workspace once the seeded payload is
   valid.
8. Do not persist incomplete/invalid Stock Entry lines merely to save a product
   selection. Preserve pending local selections until required line data is valid.

Default form values supplied by the application are not, on their own, a reason
to create a workspace.

### Visually stable first save

The first creation may replace `/new/:kind` with `/workspace/:name`, but it must
be visually silent. Preserve:

- the mounted Workspace component;
- all reactive form state;
- scroll position;
- focused control and text selection where practical;
- open details, picker, and dialog state;
- selected products and local preparation queues; and
- scanner state unless the workflow deliberately closes it.

Only the save-status badge should transition:

```text
尚未保存 -> 正在保存… -> 已保存
```

Use replace-style routing so the browser Back button does not return to a phantom
pre-save copy of the same transaction. Remove or narrow the current full-path
RouterView key so this replacement cannot remount Workspace. Do not hide a remount
with animations or manual scroll restoration; keep one component instance.

If route replacement fails after the server successfully creates the workspace,
retain the created identity and user input and show a recoverable error. Preserve
the existing idempotent `request_id` behavior so retries cannot create duplicate
workspaces.

### Draft management

`更多 -> 草稿` opens the unfinished-record list. Each row shows enough context to
decide whether to resume or delete:

- movement type;
- last modified time;
- item count/preview;
- relevant borrower/activity or source/purpose context; and
- saved/error/conflict state when available.

Users can resume or explicitly delete a draft subject to permission checks.
Nonempty drafts must never be silently deleted.

Because simply opening a new workflow no longer creates a document, empty
server-side draft accumulation should stop. Existing truly empty abandoned drafts
may be offered for explicit cleanup or handled by a separately documented,
conservative cleanup policy; do not introduce broad automatic deletion in this
task.

When starting an operation type for which the same user has a recent meaningful
draft, offer `继续草稿` and `新建记录`. Do not impose a one-draft-per-kind rule,
because concurrent real-world operations may be legitimate.

## API and data-contract work

Names below are suggestions, not mandatory public contracts. Prefer extending
the current API coherently over building parallel subsystems.

### Bootstrap/navigation state

Return permission-aware values needed by the shell, including:

- combined actionable pending row count;
- separate damaged and unlocated counts;
- unfinished draft count;
- current user's relevant capabilities; and
- the configured roots needed to distinguish physical from system warehouses.

Avoid expensive full result materialization just to produce a badge. Counts and
list queries must use the same predicates so they cannot visibly disagree.

### Inventory and catalog

Extend the existing paged inventory contract so it can deliberately represent:

- positive-stock current inventory; and
- the complete enabled stock-item catalog including zero-stock products.

Keep existing scalar parameters compatible while callers migrate. Preserve
permission-aware warehouse expansion, stable ordering, images, stock-status
breakdowns, and group-stock diagnostics.

The catalog mode still needs stock summaries where available; do not build a
second product engine.

### Product Detail

Return product metadata, permitted warehouse balances, relevant positive batches,
active-loan summaries, image attachments, and recent movements in bounded form.
Avoid an N+1 request per subsection or per row. Every linked record requires the
appropriate read permission.

### Loan list and detail

Replace or supersede the flat `outstanding_loan_items()` use with contracts that:

- page by parent loan transaction;
- filter/search across parent and child fields;
- aggregate line outcomes without per-row query loops;
- return small item/image previews for the list;
- load full permitted loan detail separately; and
- calculate outstanding as loaned minus submitted returned, damaged, and lost
  quantities.

Draft/cancelled returns and losses must not reduce outstanding quantities.
Revalidate exact loan-item links and outstanding amounts server-side.

### Pending list and counts

Use positive ERPNext stock in the configured damaged and pending leaf warehouses.
Return actionable row group keys, quantities, UOM, images, batch context, and
per-type totals. Do not base operational pending status on Item description/image
completeness.

### Warehouse summaries

Return only the permitted subtree below the physical root, excluding the root
record itself. Include distinct-product counts, UOM-grouped totals, bounded
category previews, and child/aggregate metadata without querying stock once per
visible node.

All group aggregates must derive from permitted descendant leaves. A client-
provided descendant list is not authorization.

## Workspace seeding requirements

Inventory selection, Loan Detail, Product Detail, and Warehouse Detail all open
the existing workspace workflow with context. Implement one coherent seeding
contract rather than page-specific form mutations.

A seed may contain:

- movement kind;
- selected product identities;
- exact loan-item identities for return/loss;
- a physical leaf source or destination when unambiguous;
- a group scope used only to constrain later leaf selection; and
- batch/UOM/quantity only when known and valid.

The workspace owns final validation and lets users review/edit the seed. Server
validation remains authoritative. Do not put large seed JSON in the URL. Preserve
seed state across a refresh of a not-yet-persisted `/new/:kind` flow using a
bounded, request-id-keyed client mechanism if needed.

## Accessibility and responsive behavior

- Keep all volunteer-facing copy Chinese.
- Maintain at least touch-friendly target sizing and visible focus indicators.
- Give icon-only scanner, pending, selection, and account controls accessible
  names.
- Number badges must not be the only way status is communicated.
- Bottom navigation exposes the active destination semantically.
- Selection checkboxes have labels containing the relevant product/loan line.
- Contextual action bars remain reachable without covering selected results.
- Detail accordions, dialogs, drawers, and menus support keyboard operation,
  Escape behavior, and focus restoration.
- Preserve manual scanner input and release camera resources on close/unmount.
- Do not make a complex row containing buttons into one nested interactive link.
- Desktop should use available width; mobile cards must not be compressed desktop
  tables.
- Respect reduced-motion preferences. Do not animate the first autosave route
  adoption in a way that implies navigation.

## Security and inventory invariants

All existing `AGENTS.md` invariants remain mandatory, including:

- ERPNext is the sole inventory source of truth.
- Only valid permitted leaf warehouses hold stock.
- Group warehouses are navigation/aggregation nodes, never Stock Entry values.
- Physical and virtual/system warehouse boundaries are validated server-side.
- Frontend navigation visibility is not authorization.
- Submitted records remain immutable except through valid cancellation/reversal
  mechanisms.
- Loan, return, loss, damage, repair, disposal, and transfer retain their exact
  auditable document/link semantics.
- Autosave updates editing state only; confirmation explicitly submits stock.
- Optimistic revision conflict and session-expiry recovery remain intact.

## Suggested implementation sequence

Keep each milestone reviewable and preserve working routes between milestones.

### Milestone 1: shared shell and routing

- Extract the responsive application shell.
- Add the four fixed destinations and conditional pending notification.
- Make `/` open Current Inventory.
- Move install/logout/account entry points without yet removing old compatibility
  routes.
- Stabilize RouterView identity so Workspace route adoption does not remount.

### Milestone 2: Inventory modes and Product Detail

- Introduce Current Inventory, All Products, and Expiry modes.
- Integrate prominent scanning and default new-operation actions.
- Add selection mode and coherent workspace seeding.
- Complete Product Detail and guarded product editing.

### Milestone 3: Loans

- Add paged parent-loan listing and Loan Detail.
- Add within-loan line selection for return/loss.
- Seed and revalidate return/loss workspaces.

### Milestone 4: Pending

- Replace broad metadata attention semantics with damaged/unlocated only.
- Add matching permission-aware counts, notification, page modes, and actions.

### Milestone 5: Warehouses and More

- Build the physical-only Warehouse browser and summaries.
- Add leaf/group-aware contextual actions.
- Move manager warehouse controls into this destination.
- Complete More and redirect/remove the separate Settings entry.

### Milestone 6: deferred autosave and draft polish

- Stop creation on initial page open.
- Define meaningful-edit creation triggers.
- Preserve route/component/focus/scroll state on first save.
- Add continue-versus-new handling and improve Draft list context.

Autosave stabilization is high risk. It may be implemented earlier internally,
but it must be verified independently rather than bundled into unrelated visual
changes without focused tests.

## Testing and validation

Add focused tests in proportion to each milestone. At minimum cover:

### Frontend unit/component tests

- active mobile/desktop navigation and conditional Pending notification;
- zero/nonzero permission-aware badge presentation;
- inventory mode route/query restoration;
- scanner known/unknown navigation behavior;
- selection mode, action availability, and source/destination prefill rules;
- group warehouses never becoming stock-line values;
- Loan Detail outstanding-line selection and editable default return quantities;
- Pending excluding missing-description/photo-only products;
- physical warehouse root/system subtree exclusion;
- mixed-UOM warehouse summaries not becoming one unitless number;
- no workspace API creation call on initial `/new/:kind` mount;
- meaningful edits triggering one idempotent creation;
- first-save URL replacement preserving the same Workspace component instance,
  form state, focus where testable, and scroll state;
- retry behavior after route replacement or save failure; and
- no regressions to save serialization, dirty edits during in-flight saves,
  signature invalidation, conflict handling, or session-expiry recovery.

### Backend tests

- current-stock versus all-products inclusion and stable paging;
- item read/write permissions for detail/edit;
- active-loan parent paging and search through child products;
- submitted return/damage/loss aggregation and partial outstanding quantities;
- concurrent/stale return quantity rejection;
- damaged/unlocated page predicates exactly matching counts;
- missing metadata not affecting Pending counts;
- physical-only warehouse summaries, descendant aggregation, and User Permission
  boundaries;
- leaf-only enforcement for every prefilled movement kind;
- manager-only warehouse creation/configuration; and
- idempotent deferred workspace creation and confirmation for all movement kinds.

Run the repository-standard checks from the correct directories:

```sh
cd frontend
yarn test
yarn type-check
```

Run the focused backend integration entry point from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Run `yarn build` when routing/generated integration is ready for deployment, but
do not edit generated output by hand. Run schema migration only if this task adds
or changes schemas/fixtures. Do not launch Playwright or reset the development
site unless the user separately requests it.

## Acceptance criteria

The task is complete only when all of the following are true:

1. Opening the app shows `库存 -> 当前库存`, not an action dashboard.
2. Mobile has fixed `库存 / 借用 / 仓库 / 更多` bottom navigation; desktop has
   the same destinations at the top.
3. Pending appears as a badged header notification only when actionable damaged
   or unlocated rows exist, and remains quietly discoverable in More at zero.
4. Inventory visibly switches among Current Inventory, All Products, and Expiry
   Batches without turning Expiry into a primary tab or checkbox.
5. Search, hierarchy filters, scanner, loading, images, and responsive list
   behavior continue to satisfy the corrective filtering requirements.
6. Product Detail shows stock/location/batch/loan context and guarded basic edits.
7. Explicit Inventory selection mode can seed receipt, issue, transfer, and loan
   workflows without inventing ambiguous warehouses or quantities.
8. Loan list rows represent loan transactions; Loan Detail shows all line outcome
   quantities and can create a multi-line partial/full return for that loan.
9. Return/loss workspaces retain exact loan-item links and cannot exceed current
   outstanding quantities.
10. Pending contains only damaged and unlocated physical stock. Missing product
    metadata does not create rows or badge counts.
11. Warehouse shows only descendants of the physical root, hides the root and all
    virtual/system subtrees, and reports mixed quantities by UOM.
12. Warehouse quick actions correctly prefill a selected leaf or constrain a
    group to eligible descendant leaves.
13. Managers can add/configure physical rooms and locations from Warehouse;
    ordinary users cannot, and More has no duplicate Warehouse Settings entry.
14. Install, account, drafts, history, quiet Pending access, and logout are placed
    in More; logout cannot be mistaken for Back.
15. Opening a new operation creates no server draft until meaningful input exists.
16. The first autosave may replace the URL but causes no component remount, visual
    jump, form reset, focus loss, or scroll reset; only the save badge changes.
17. Nonempty drafts remain recoverable and are never silently deleted.
18. All stock-changing operations still require explicit review/confirmation and
    valid permitted leaf warehouses.

## Explicitly out of scope

- Expected return dates or overdue-loan notifications.
- Multi-select that combines different loan transactions into one return.
- A separate Quick Actions primary tab.
- A fixed Pending primary-navigation tab.
- Missing description/photo as operational pending work.
- Showing virtual/system warehouses in the Warehouse browser.
- Inline editing of product master data from list rows.
- Replacing ERPNext stock, batch, Item, Warehouse, or Stock Entry records with a
  parallel inventory model.
- Automatic deletion of nonempty drafts.
- Browser automation unless separately requested.
