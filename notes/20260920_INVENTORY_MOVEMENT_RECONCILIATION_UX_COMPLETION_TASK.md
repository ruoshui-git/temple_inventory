# Task: Complete Inventory Browsing, Movement History, and Stock Reconciliation UX

## Status and authority

This is the confirmed corrective product and implementation handoff for the
current `temple_inventory` application. It incorporates the source audit made
after commit `259131c` (`App UI revamp`) and the product decisions confirmed on
2026-09-20.

For overlapping behavior, this document takes precedence over:

- `notes/20260920_APP_NAVIGATION_OPERATIONAL_UX_TASK.md`;
- `notes/20260920_CORRECTIVE_UX_COMPLETION_TASK.md`;
- `notes/20260920_RESPONSIVE_FILTER_DESKTOP_UX_TASK.md`; and
- earlier filtering, feedback, and infinite-list task documents.

Retain every compatible requirement from those documents and from `AGENTS.md`.
In particular, the four fixed primary destinations, ERPNext source-of-truth
rules, leaf-warehouse rules, explicit confirmation, permission enforcement,
durable workspace behavior, and mobile-first accessibility requirements remain
mandatory.

The preceding app-navigation task is **not complete**. Do not treat the presence
of routes or components as acceptance. Correct the current implementation in
place, preserve useful work, and add focused regression coverage.

Do not edit generated files under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand.

## Locked product decisions

The following decisions are final:

1. The application name shown in the shell is `物资管理`. Do not use a
   temple-specific product name in volunteer-facing shell copy.
2. Primary navigation remains exactly `库存 / 借用 / 仓库 / 更多`.
3. `当前库存`, `全部物品`, and `效期批次` are modes of the one Inventory
   destination and use the same responsive list/filter foundation.
4. Desktop inventory results are compact tables; mobile inventory results are
   cards.
5. Available quantity is the dominant quantity. `未定位` is location/status
   context and is not a product-row summary metric.
6. Relevant browse/list pages use a floating expandable `＋` action button on
   both desktop and mobile. This supersedes the earlier desktop-toolbar-only
   action decision.
7. `待处理` appears only once in the application header when nonzero and remains
   quietly discoverable in More. It does not appear in the Inventory page
   header.
8. `更多 -> 库存记录` becomes `更多 -> 货物流动`.
9. The movement surface prominently separates `入库 / 出库 / 转移 / 盘点调整`.
   Special movement types remain discoverable without crowding the primary
   modes.
10. Stock Entries and Stock Reconciliations created directly in ERPNext are
    included when they affect the user's permitted inventory scope.
11. Stock reconciliation uses ERPNext `Stock Reconciliation`; it must not create
    a parallel stock ledger or directly rewrite Bin/Stock Ledger Entry rows.
12. Only a user with the correct server-confirmed permission may see or start a
    stock reconciliation action. Because this task does not add an approval
    handoff, `can_reconcile_stock` requires both create and submit permission for
    `Stock Reconciliation`, plus the applicable company and warehouse access.
    Read permission alone allows viewing permitted reconciliations but never
    exposes the start action.
13. Product Detail and transaction detail support attachments through standard
    private Frappe File records. Submitted/completed transaction attachments are
    read-only audit evidence.

## Audit of the current implementation

The implementation agent must inspect the live source again before editing. The
following findings were verified during preparation of this task.

### Useful work already present

- `/` opens Inventory rather than the former action dashboard.
- `ApplicationShell.vue` provides the four primary destinations.
- Inventory exposes current/catalog/expiry navigation.
- Initial Product, Loan, Pending, Warehouse, More, and detail pages exist.
- The hierarchy autocomplete contains useful parent-selection normalization.
- Inventory, Expiry, and History have partial URL filter and incremental-loading
  work.
- Item Detail already loads the primary Item image and image File attachments.
- Workspace transaction drafts already support multiple private attachments.
- Opening `/new/:kind` no longer immediately calls `create_workspace`.
- `App.vue` no longer keys normal route content by `route.fullPath`, permitting
  silent `/new/:kind` to `/workspace/:name` route adoption.
- Global toast infrastructure exists, although it is not consistently used.

### Confirmed deviations and defects

#### Shell and navigation

- The desktop brand is still `寺院库存`, is a `RouterLink` to `/`, and receives
  selected styling on the default route.
- Inventory duplicates the global `待处理` control in its page header.
- Shell bootstrap state is loaded once and is not coherently refreshed after a
  transaction changes pending/draft counts.
- The Inventory mobile FAB immediately starts Receive rather than opening the
  required menu.
- Desktop still uses an inline `新建库存操作` details menu instead of the newly
  confirmed floating expandable action.

#### Warehouse tree and labels

- The actual development bootstrap `physical_tree` includes `寺院仓库`,
  `虚拟库房`, and the virtual `未定位` branch. This violates the physical-only
  browser/filter contract.
- `_physical_warehouses()` deliberately retains the unlocated system warehouse;
  `_physical_tree()` then walks its virtual ancestors and leaks the root and
  virtual branch into the physical tree.
- `_physical_tree()` also contains hard-coded sample temple-name recovery.
  Hierarchy must derive from configured roots and structured ancestry instead.
- Stored unspecified leaves use values such as `第1寺院 / 未指定` and
  `A02 / 未指定`. Current label logic only recognizes a local name exactly equal
  to `未指定`, producing duplicate paths such as
  `第1寺院 / 第1寺院 / 未指定`.
- `HierarchyAutocomplete` supplies already-expanded full paths as local labels
  and then prepends ancestors again. Chips can therefore duplicate path segments
  and expose ERPNext company suffixes.
- Raw roots such as `All Item Groups` remain selectable.

#### Filtering and scrolling

- Current Inventory and Expiry do not share one page/list implementation.
- Current Inventory lacks the active-chip behavior already present on Expiry and
  History.
- No filter row returns or displays a live faceted result count.
- Chips place the close sign at the end, force horizontal scrolling, and do not
  wrap/collapse as confirmed.
- Tree expand/collapse controls reserve excessive width.
- Inventory search sends a request for each keystroke rather than using the
  shared debounced/stale-request contract.
- Desktop `.results-column` has `overflow:auto` and
  `overscroll-behavior:contain` without a correctly bounded viewport height.
  This can create a scroll container that consumes wheel input without providing
  a usable independent scroll range, matching the reported loss of upward
  scrolling.
- Inventory records/restores `window.scrollY` even though the desktop results
  pane, not the document, must own result scroll state.

#### Inventory rows and quantities

- Inventory currently renders the same loose card layout on desktop and mobile.
- `可用` is embedded in prose and does not receive visual priority.
- Mobile cards expose loaned, damaged, and unlocated values instead of limiting
  the summary to available and a small total.
- `未定位` is rendered as a product summary even though it belongs in location
  detail and Pending context.

#### Product and transaction detail

- Product Detail returns only image attachments and offers no general attachment
  upload/removal interface.
- The global `can_edit_item` flag is not a per-record capability contract.
- Transaction workspace attachments are present and should be retained, but the
  same attachment component/permission/error behavior is not shared with Item
  Detail or future reconciliation detail.
- Completed transactions must keep attachment display but must not permit
  mutation.

#### Loans, Pending, Warehouses, and earlier navigation acceptance

- Loan APIs still materialize every submitted loan and perform repeated outcome
  and Item lookups. The list is only sliced after materialization.
- Loan list has no incremental-loading control despite requesting a first page.
- Loan Detail returns only currently outstanding lines, so fully settled lines
  and full audit context disappear.
- Loan Detail omits attachments and much of the metadata required by the earlier
  task.
- Pending fetches only the first 25 inventory rows, filters those rows locally,
  has no shared filters, and does not preserve item/batch grouping semantics.
- Pending counts are distinct item codes rather than counts produced from the
  exact actionable page grouping.
- Warehouse browser renders a flat sequence, not a true structured physical
  hierarchy, and inherits the leaked virtual/root nodes.
- Several workspace seeding paths ignore the confirmed location/group scope
  contract. `ti-scope:*` is written by Warehouse but is not consumed by
  Workspace.
- Leaving Inventory selection mode clears selection without the confirmed
  guarded behavior.
- The prior task's frontend acceptance cases for shell navigation, pending,
  selection, Loan Detail, warehouse exclusion, and stable first save do not have
  component tests.

#### Movement history and reconciliation

- `workspace_api.history()` reads Inventory Workspaces and only those Stock
  Entries whose `ti_movement_kind` is set.
- Standard Stock Entries created through ERPNext with a blank custom movement
  field are omitted.
- Every Stock Reconciliation is omitted.
- The development site contained 15 completed custom movements and 11 submitted
  opening Stock Reconciliations during this audit. None of those reconciliations
  appeared in custom history, explaining stock with no visible movement.
- There is no volunteer-facing reconciliation workflow or reconciliation detail
  route.

#### Errors and validation state

- `操作失败` in `frontend/src/lib/api.ts` is a generic fallback, not a TODO.
  It means the request did not expose a usable message. Do not merely replace the
  string; diagnose each failing endpoint and preserve a useful Chinese error.
- Frontend Vitest passed 14 tests and `yarn type-check` passed at audit time.
  These tests do not cover most of the new routed pages.
- The rollback-safe backend suite ran 29 tests with 26 passing and 3 errors. All
  three errors were in expiry tests because the mocked Item row lacked `image`
  while `expiring_batches()` accessed `item.image` unconditionally.
- The real development-site expiry endpoint returned data successfully. The test
  defect still must be fixed, and all routes require focused endpoint coverage.

## Objective

Finish the existing navigation and browse work and add one coherent inventory
movement and stock-count experience. The completed app must:

1. provide a stable, neutral `物资管理` application shell;
2. provide one shared, responsive Inventory surface for current stock, catalog,
   and expiry batches;
3. provide accurate hierarchy labels and live faceted counts without exposing
   technical roots or company suffixes;
4. provide compact desktop tables and high-signal mobile cards;
5. replace the partial history page with permission-aware `货物流动` views that
   include relevant ERPNext records;
6. provide a simple, progressively disclosed Stock Reconciliation workflow;
7. add coherent Item and transaction attachments; and
8. resolve generic page failures with focused diagnostics and tests.

## Application shell corrections

### Brand and active state

- Render `物资管理` as a wordmark or non-active brand affordance.
- It must never receive `aria-current`, active-tab background, or selected-tab
  styling.
- `库存` is the selected destination for `/`, `/expiry`, `/item/:code`, and
  `/pending` as appropriate.
- `更多` is selected for `/movements`, `/history` compatibility redirects,
  reconciliation detail reached from movement history, and draft management.
- Preserve an explicit upper-left Back affordance on detail/focused pages.

### Pending and shell counts

- Remove the Inventory-header Pending link.
- Show one global header notification only when the permission-aware actionable
  count is nonzero.
- Keep `更多 -> 待处理（0）` when empty.
- Pending and draft counts must update after successful confirmation, deletion,
  repair/disposal/location assignment, and route return without a full page
  reload.
- Derive list and badge counts from the same server predicates.

## Shared hierarchy facets

### Root boundaries

Use roots as boundaries, never as options:

- exclude the configured overall inventory root (`寺院仓库` in current sample
  data) from every browse facet;
- exclude the configured physical root itself while retaining its permitted
  descendants;
- exclude the virtual root and every virtual/system descendant from the physical
  warehouse facet and Warehouse destination;
- include the operational unlocated leaf only on surfaces where unlocated stock
  is intentionally filterable; do not pull its virtual ancestors into a
  physical tree; and
- exclude `All Item Groups` from displayed category options while using it to
  establish category ancestry.

The server, not the client, returns deliberately scoped trees. Do not ask every
client to repair a mixed physical/system tree.

### Central label model

Create one structured label/path adapter used by Inventory, Expiry, Movements,
Pending, Warehouse, Item Detail, Workspace, selected chips, and autocomplete.

For each hierarchy node expose or derive separately:

- `local_label`: concise text for an already-indented browse row;
- `full_label`: disambiguating user-facing path for chips/search/detail;
- `search_text`: raw label, normalized path variants, and friendly aliases; and
- node role/type metadata.

Rules:

- never show ` - <Company>` or any ERPNext naming suffix;
- never repeat an ancestor already communicated by indentation;
- a row under `第2寺院` is `D01`, not `第2寺院 / D01`;
- recognize unspecified leaves by structured parentage and normalized local
  tail, including stored values such as `A02 / 未指定`;
- a temple-level unspecified leaf displays `寺院内，未分配房间`;
- a room-level unspecified leaf displays `房间内，未细分到货架`;
- when a room has only its unspecified leaf, collapse redundant group/leaf
  presentation into one selectable room-style choice while preserving the leaf
  warehouse identity sent to stock operations;
- when a room has named child locations, show the room group as
  `<房间>（全部位置）` and keep the friendly unspecified leaf separately; and
- search continues to match raw names, friendly names, full paths, and slash
  spacing variants.

Do not rewrite historical warehouse identities merely to improve display.
If new warehouses are created, store a clean local `warehouse_name` such as
`未指定`; do not create another prefixed `A02 / 未指定` local label. If existing
records require normalization, use a reviewed migration that preserves links
and ERPNext rename semantics, not direct SQL.

### Tree-row density

- Use a compact disclosure chevron/control with an accessible expanded state.
- Keep disclosure, checkbox, and label visually adjacent.
- Do not reserve the current 30-pixel spacer plus large indentation at every
  level.
- Preserve a touch-friendly combined row target without making the icon consume
  unnecessary horizontal space.
- Parent selection and partial state remain visible and keyboard operable.

### Selected chips

- Put the accessible remove `×` control at the beginning of each chip.
- Use `full_label` without a company suffix.
- Allow chips to wrap into multiple rows.
- After a reasonable height/row threshold, collapse overflow behind
  `另有 N 项`; expansion and collapse must restore focus predictably.
- Removing a chip updates URL state, results, and facet counts.
- Retain per-facet `清除本项` and page-level `清除全部`.

## Dynamic faceted counts

Every displayed selectable warehouse/category filter row shows a count in a
visually secondary, tabular-number column.

The count means **distinct result rows**, never summed inventory quantity:

- Current Inventory and All Products: distinct products;
- Expiry: distinct batch result rows under the page's stable batch grouping;
- Movement modes: distinct movement documents;
- Pending: distinct actionable page rows under its item/batch grouping.

Count behavior:

1. Apply permission, company, mode, search, date, and every other active facet.
2. When calculating a warehouse row, ignore the current warehouse selection but
   apply all non-warehouse facets.
3. When calculating a category row, ignore the current category selection but
   apply all non-category facets.
4. Parent counts are the deduplicated union of permitted matching descendant
   leaves, not the sum of child counts.
5. Selected rows remain visible when their count becomes zero.
6. Zero-count unselected rows may be visually muted but should not disappear
   unexpectedly while the user is examining the hierarchy.
7. Counts and results must be computed from the same base predicates and stable
   grouping keys.
8. Do not issue one server request or database query per tree node. Return
   bounded facet aggregates with the list response or through one stale-safe
   facet request.

Add explicit API documentation/tests for these semantics; the term `count`
must not be confused with stock quantity.

## Desktop scrolling and responsive list foundation

At 1024 px and above:

- compute a viewport-bound work area below the actual shell/page-mode header;
- make filters and results independent vertical scroll containers;
- prevent the document body from becoming a third competing list scroll area;
- keep `min-height: 0` through the relevant grid/flex ancestors;
- keep the result toolbar/count/loading state sticky within the result pane;
- retain normal wheel, touchpad, keyboard, Home/End, and Page Up/Down behavior;
- use `overscroll-behavior` only on an element with a real bounded scroll range;
- store and restore the results-pane scroll offset, not `window.scrollY`; and
- preserve the offset when opening and returning from a detail page, while a
  deliberate filter/mode change resets to the first result.

At narrower widths:

- use normal document scrolling;
- render filters in an accessible modal drawer;
- lock background scroll only while the drawer is open;
- restore focus to the trigger on close; and
- ensure bottom navigation, action bars, and the FAB never cover the final row.

Add a component/layout regression test for upward scrolling after incremental
loading. Do not add Playwright unless separately requested; test scroll
ownership and state logic at the component/unit level and leave final browser
feel to manual validation.

## Inventory destination

### One coherent mode surface

Keep the prominent modes:

```text
[ 当前库存 ] [ 全部物品 ] [ 效期批次 ]
```

They share:

- one page heading and toolbar foundation;
- warehouse and category hierarchy facets;
- faceted counts;
- active chips;
- debounced/stale-safe search;
- scanner placement and behavior;
- incremental loading;
- URL/filter restoration;
- independent desktop scrolling; and
- floating expandable creation actions.

Expiry may retain an internal route/component and its date/sort facets, but it
must not look or behave like a legacy separate app. Switching modes preserves
compatible warehouse/category/search state and drops or ignores only
mode-specific facets deliberately.

### Current Inventory desktop table

Use a dense, accessible table with approximately these columns:

1. image and product identity;
2. category;
3. **可用** quantity, bold and visually dominant;
4. total quantity;
5. loaned quantity when applicable;
6. damaged quantity/status when applicable; and
7. selection control only while selection mode is active.

`未定位` is not a table summary column. Users find it through warehouse/location
filtering, Pending, and Product Detail.

Keep the row target understandable: the product identity opens Product Detail;
selection and action controls are separate interactive elements. Do not nest
buttons inside a row-wide link.

### Current Inventory mobile card

The card contains only the high-signal summary:

- image;
- product name and concise identity/category;
- a large, bold `可用` number with UOM; and
- a smaller total quantity.

Loaned, damaged, unlocated, per-location, batch, and other numerical details are
available in Product Detail rather than crowding every card.

### Catalog and expiry

- All Products includes permitted enabled stock Items at zero quantity.
- Zero-stock products display a clear zero state without looking like a load
  failure.
- Expiry rows/cards link to Product Detail with batch context.
- Desktop Expiry remains a compact table; mobile uses cards emphasizing expiry
  date/status and batch quantity.
- Preserve image display and date sorting.
- Fix the expiry test fixtures/API defensively and restore a fully passing
  backend suite.

### Floating action button

Use a visible floating `＋` button on desktop and mobile Inventory browse modes.
It expands into:

- `入库`;
- `出库`; and
- `转移`.

The menu is keyboard accessible, closes on Escape/outside activation, restores
focus, and communicates expanded state. Do not start Receive merely by pressing
the closed FAB.

Permission-aware menu items come from server capabilities. Hidden/disabled
frontend controls are never authorization.

Selection mode still exposes `入库 / 出库 / 转移 / 借出` for selected products
and follows the earlier source/destination prefill and local preparation-queue
rules.

## Product Detail and attachments

Product Detail remains the canonical place for all secondary stock state,
including:

- available and total;
- loaned and damaged;
- unlocated/location status;
- permitted balances by physical/system context;
- batches and expiry;
- active loans;
- recent movements and reconciliations; and
- attachments.

### Item attachment behavior

- Return every permitted File attached directly to the Item, not only images.
- Continue to build the image gallery from image files plus `Item.image`.
- Display non-image files in an attachment list with name/type/size where
  available.
- A user receives Item attachment upload/remove controls only when the server
  confirms write permission for that specific Item and File operation.
- Upload through standard private Frappe File attachment semantics.
- Removing the file used by `Item.image` requires an explicit replacement or
  clear-primary action and must not leave a broken image reference.
- Direct mobile camera capture may be offered through file input hints, with a
  normal file fallback.
- Item attachments are product reference material, not transaction evidence.

### Transaction attachments

- Retain multiple attachments on editable workspaces.
- Use a shared attachment component/contract for movement and reconciliation
  drafts where practical.
- Completed Stock Entries, business records, and Stock Reconciliations expose
  attachments read-only.
- Direct ERPNext records display their own permitted File attachments.
- File validation checks doctype, docname, privacy, user permission, and
  completed-record immutability on the server.

## More and movement information architecture

`更多` contains at least:

- `货物流动`;
- `草稿` with a nonzero count badge;
- `活动` if the standalone browser exists;
- quiet `待处理（N）`;
- installation when applicable;
- account identity; and
- logout.

Keep `/history` as a deliberate compatibility redirect to the new movement
surface, preserving recognized filter/status query state where practical.

The movement page title is `货物流动`. Do not use the ambiguous `库存记录` label
for the completed movement browser.

## Movement modes and special types

Use four prominent mutually exclusive modes:

```text
[ 入库 ] [ 出库 ] [ 转移 ] [ 盘点调整 ]
```

Provide an adjacent `其他类型` filter/menu for:

- `损坏`;
- `遗失`;
- `修复`;
- `报废`;
- `借出`; and
- `归还`.

The special-type surface may replace the active primary mode with an explicit
label while selected; it must remain obvious how to return to the four common
modes. Do not place all ten types in one permanently wrapping tab row.

The movement FAB expands to the actions the current user may start:

- `入库`;
- `出库`;
- `转移`;
- `盘点`; and
- a progressively disclosed `其他操作` group for the special contextual
  workflows that are valid outside Product/Loan/Pending detail.

Damage, repair, disposal, return, and loss should still favor their safer
contextual entry points. The global action menu must not encourage an ambiguous
operation that cannot yet identify the correct source record or system
warehouse.

## Movement list presentation

All movement modes share one responsive structure.

Desktop table columns should include, as applicable:

- date/time;
- document identifier and source (`本应用` or `ERPNext`);
- concise item preview and line count;
- source and/or destination location;
- quantity summaries grouped by UOM;
- handler/recorded-by context when permitted; and
- status.

Mobile cards show only:

- type;
- date;
- first item plus additional-line count;
- concise source-to-destination context; and
- status.

Long quantities, audit metadata, files, and every item line belong in Movement
Detail. Never add incompatible UOM values.

Search and filters include:

- document identifier;
- product code/name/barcode or batch where applicable;
- date range;
- hierarchy-aware source/destination warehouse;
- handler/recorded-by where permitted;
- app/ERPNext source; and
- submitted/cancelled state when useful.

Draft workspaces remain in `更多 -> 草稿`; they are not mixed into completed
movement modes by default.

## Unified movement data contract

Build a bounded, permission-aware movement query over both authoritative ERPNext
document types:

1. `Stock Entry`; and
2. `Stock Reconciliation`.

Do not materialize every document and filter JSON in Python. Page and filter in
bounded database queries, then fetch bounded child previews/aggregates.

### Stock Entry classification

Classification precedence is:

1. A valid app-authored `ti_movement_kind` and linked business record is the
   authoritative user-facing special type.
2. Otherwise classify a standard ERPNext Stock Entry using its purpose and the
   direction of permitted rows:
   - Material Receipt -> `入库`;
   - Material Issue -> `出库`;
   - Material Transfer -> `转移`.
3. A direct ERPNext transfer whose complete relevant direction unambiguously
   enters the configured damaged system leaf may be displayed as `损坏`.
4. A direct ERPNext transfer whose complete relevant direction unambiguously
   leaves the damaged leaf for a permitted physical leaf may be displayed as
   `修复`.
5. Do not infer `借出`, `归还`, or `遗失` merely from free text. Use exact linked
   business records and system-warehouse direction; if context is incomplete,
   keep the standard `转移` or `出库` classification and label it as an ERPNext
   record.
6. Mixed-purpose/mixed-direction entries that cannot safely map to one special
   type stay under their standard ERPNext purpose. Never fabricate audit
   semantics.

Only include documents with at least one permitted relevant row, and redact or
exclude inaccessible rows according to ERPNext permissions without presenting a
misleading total. Prefer excluding a parent the user cannot safely understand
over leaking hidden warehouse/item information.

### Stock Reconciliation classification

- `purpose == "Opening Stock"` displays as `期初库存` within the
  `盘点调整` mode.
- `purpose == "Stock Reconciliation"` displays as `盘点调整`.
- Preserve submitted/cancelled status and ERPNext identity.
- App-created reconciliations link to their durable workspace when present.
- Direct ERPNext reconciliations open a read-only custom detail surface with an
  optional manager-only ERPNext link.

### Detail routes

Movement Detail supports both document types without pretending a direct ERPNext
record is an app workspace. It shows:

- type, identifier, source, status, posting date/time, and company context;
- every permitted item/batch/location line;
- before/after/difference values for reconciliation;
- quantity summaries grouped by UOM;
- app audit context when present;
- attachments;
- cancellation/amendment relationships; and
- a manager/authorized link to the ERPNext form when appropriate.

Cancelled records remain readable and clearly marked. Do not make submitted
records editable from detail.

## Stock reconciliation workflow

### Authorization and capabilities

Return explicit server capabilities, including:

- `can_read_reconciliations`;
- `can_reconcile_stock`; and
- permitted leaf locations for reconciliation.

`can_reconcile_stock` is true only when all of the following are true:

- the user can create `Stock Reconciliation`;
- the user can submit `Stock Reconciliation`;
- the user can read the configured company and relevant Items/Warehouses;
- at least one permitted, allowed, physical leaf location is available; and
- initialization is ready.

Only `can_reconcile_stock` users see `盘点` in a creation menu or may open a new
reconciliation route. Deep-link access to the new route must call the same
server capability check and return a normal permission error before any draft is
created.

Recheck permissions when creating the first durable draft, on every save that
changes scope, and immediately before creating/submitting the ERPNext document.
Do not use `ignore_permissions` to elevate a Stock User into Stock Reconciliation
authority.

This task does not add a volunteer-count/manager-approval workflow. Do not expose
an action that an authorized user cannot finish.

### Workflow overview

Use progressive disclosure with four conceptual stages. They may remain on one
responsive route rather than becoming a rigid wizard, but the user's current
stage must be obvious.

#### 1. Choose count scope

- Require exactly one permitted physical leaf warehouse.
- Use the shared hierarchy autocomplete, but groups only constrain browsing and
  can never become a reconciliation line warehouse.
- Default to `抽查盘点`: only explicitly added products are reconciled.
- Offer a deliberate `整库盘点` option with a warning that every expected row
  must be accounted for.
- Freeze and display the reconciliation posting date/time when the count begins.
  The user may explicitly reset it to the current time while editable.
- Optional notes, handler/audit fields, and attachments stay collapsed until
  needed.

#### 2. Count products

- Keep search, camera scan, hardware/manual barcode input, and browse selection
  equivalent.
- Repeated scanning of a non-batch product may increment a provisional count,
  but the resulting number remains editable and is never auto-submitted.
- Show product image/name and a large editable `实点数量`.
- Show `账面数量` in smaller read-only text.
- Show difference only after an actual count has been entered.
- Use stock UOM as the reconciliation unit. Do not accept an alternate UOM
  without a validated conversion to stock UOM.
- Prevent duplicate lines for the same item/warehouse/batch identity; merge or
  focus the existing line.

For batch-tracked products:

- progressively reveal existing positive batch balances at the selected leaf;
- record counts per batch identity;
- show batch number and expiry date;
- support an authorized new Batch only when ERPNext permits it and the user has
  Batch create permission; otherwise present a clear manager action/error; and
- produce ERPNext-compatible batch/serial bundle state rather than writing a
  parallel batch quantity.

Serialized-item reconciliation is not silently approximated as an ordinary
quantity. If the current app does not support serial-number counting, show a
clear unsupported-state message and block that line; document serialization as
out of scope rather than corrupting stock.

#### 3. Review discrepancies

Default the review to changed rows while allowing the authorized user to reveal
unchanged rows.

Each row shows:

- product and batch identity;
- selected leaf;
- captured ledger quantity;
- counted quantity;
- signed difference; and
- valuation warning only when user action is genuinely required.

Summaries report:

- number of counted rows;
- number of discrepancy rows;
- increases and decreases grouped by UOM; and
- unresolved validation/conflict counts.

Never produce one unitless grand total.

#### 4. Confirm explicitly

- Flush durable autosave and require a conflict-free revision.
- Require the existing configured audit/signature fields in a manner consistent
  with other accountable stock operations.
- Present attachments and discrepancy summary.
- Use the explicit action `确认盘点调整`.
- Create/submit one standard ERPNext Stock Reconciliation for the logical count
  unless ERPNext batch/date constraints require multiple documents. If multiple
  authoritative documents are genuinely necessary, link every document to the
  same durable logical workspace and show this transparently in detail.
- Success routes to the completed reconciliation detail and refreshes movement,
  inventory, pending, and draft state.

### Selective versus whole-location safety

For `抽查盘点`:

- only explicitly counted/confirmed rows enter the Stock Reconciliation;
- an omitted product remains unchanged; and
- removing a line removes it from the proposed adjustment.

For `整库盘点`:

- load the complete permitted expected item/batch set for the selected leaf in
  bounded pages;
- every expected row must be marked `已盘点` or explicitly `未找到，计为 0`;
- omission never implies zero;
- newly found products can be added explicitly; and
- final confirmation is blocked until all expected rows have an explicit state.

Do not provide a one-click “set every unseen item to zero” shortcut.

### Posting-time and concurrency safety

When each expected row is loaded, capture the authoritative quantity at the
chosen reconciliation posting date/time. Immediately before confirmation:

1. lock/revalidate the draft revision;
2. re-read the authoritative balance at that same posting date/time for every
   item/warehouse/batch identity;
3. compare it with the captured baseline; and
4. block confirmation with a row-level conflict if the baseline changed.

Movements posted after the chosen count time do not automatically invalidate a
historical count, but a newly inserted/cancelled/amended ledger effect at or
before that time does. Let ERPNext perform its normal future reposting; do not
manually adjust later balances.

The conflict UI preserves entered physical counts and offers an explicit
`更新账面数量并重新检查` action. Updating the baseline invalidates signatures and
requires another review.

### Valuation and accounting

- Let ERPNext derive current valuation where possible.
- Reuse the company's valid difference account/cost center defaults or expose a
  permission-aware manager choice only when ERPNext requires it.
- Do not ask ordinary users to understand valuation rate for routine decreases.
- For a positive count with no valid valuation rate, show a specific blocking
  explanation and manager-resolvable field/action; do not silently post an
  invented rate.
- Preserve ERPNext `Opening Stock` versus `Stock Reconciliation` purpose. New
  routine physical counts use `Stock Reconciliation`, never `Opening Stock`.

### Responsive reconciliation layout

Desktop uses the full available width:

- scope/filter/search tools in a compact left or top region;
- a table with product, batch, expected, counted, and difference columns; and
- a sticky summary/confirmation region that does not cover rows.

Mobile uses cards and progressive disclosure:

- product identity and large counted quantity first;
- expected and difference second;
- batch/location detail collapsed when unambiguous; and
- one reachable primary next/review action above bottom safe-area spacing.

The camera must release on close, backgrounding, route leave, session expiry,
and component unmount. Manual entry remains available.

## Durable reconciliation editing state

Reconciliation needs the same reliability properties as movement workspaces:

- idempotent request ID;
- no server draft merely from opening the route;
- first meaningful count/scope edit creates durable state;
- serialized autosave;
- optimistic revision checks;
- signatures invalidated on content/baseline changes;
- private attachments;
- session-expiry recovery;
- visually silent route adoption; and
- explicit final confirmation.

Prefer coherently extending `Inventory Workspace` with an explicit authoritative
document kind and a `stock_reconciliation` Link if that model remains readable.
Do not overload the existing `stock_entry` Link with a reconciliation name. If
the existing lifecycle becomes unsafe or incoherent, a small dedicated
reconciliation workspace DocType is acceptable because a physical count has its
own baseline, scope, and line-state lifecycle. In either case:

- ERPNext Stock Reconciliation remains the authoritative completed record;
- draft JSON/state is editing state, not stock truth;
- completed state links back to the ERPNext document;
- workspace permissions and query conditions enforce company, Item, and
  warehouse access; and
- schema, patches, hooks, File rules, API exports, and tests change together.

Draft management labels reconciliation drafts as `盘点` and includes selected
location, counted/discrepancy progress, and modified time.

## Error handling and `操作失败`

Audit every routed page and every API it invokes:

- Inventory current/catalog;
- Expiry;
- Product Detail;
- Loans and Loan Detail;
- Pending;
- Warehouses;
- More;
- Movement modes/detail;
- Drafts/workspaces; and
- new reconciliation workflow/detail.

The request layer must safely handle:

- JSON Frappe errors;
- `_server_messages` in known Frappe encodings;
- authentication/CSRF expiry;
- permission errors;
- validation errors;
- optimistic conflicts;
- network/offline failure;
- aborted requests; and
- unexpected non-JSON server responses.

Show a concise Chinese user message and retain/log enough endpoint/request ID
context for diagnosis without exposing server tracebacks or secrets. A generic
fallback may remain only as a last resort and must not be the normal result of a
known backend exception.

Page-level failed loads need visible retry actions. Background refresh failures
may retain stale data with a warning rather than replacing the entire page with
an empty state.

## API and performance requirements

### Bootstrap/capabilities

Return only the trees and capabilities each surface needs. Include:

- per-operation creation capabilities;
- reconciliation read/start capability;
- pending/draft counts;
- configured physical/system root identities;
- permitted physical browse nodes; and
- permitted stock-operation leaves.

Do not expose a mixed tree and rely on clients to subtract system nodes.

### Inventory and facets

- Page/filter at the database/query layer where practical.
- Return results, stable total, unfiltered/mode total, and facet counts from
  consistent predicates.
- Avoid recursive endpoint calls such as computing `overall_total` by calling
  the full inventory endpoint again.
- Preserve group expansion and deduplication server-side.
- Apply Item/Warehouse/User Permission boundaries before aggregation.

### Loans and Pending carryover

The earlier navigation task remains authoritative where not superseded:

- replace loan N+1 aggregation with bounded parent paging;
- return every original Loan Detail line and outcome totals;
- retain exact loan-item concurrency validation;
- give Pending its own paged item/batch grouping and matching badge count; and

- apply the same shared filter/list patterns where appropriate.

Do not postpone these known prior-task defects merely because movement and
reconciliation are new in this handoff.

## Suggested implementation sequence

Keep changes reviewable and keep useful routes working between milestones.

### Milestone 1: restore shared shell/list correctness

- Rename and de-activate the brand.
- remove duplicate Pending;
- add refreshable shell state;
- correct physical/category tree payloads and central labels;
- fix desktop scroll ownership;
- restore shared debounced/stale-safe list state; and
- implement chip and facet-count contracts.

### Milestone 2: Inventory/Expiry responsive results

- Add compact desktop table and high-signal mobile cards.
- Make available quantity dominant and remove unlocated row summaries.
- Integrate Expiry into the shared mode/filter foundation.
- Implement the expandable desktop/mobile FAB.
- Preserve selection/seeding behavior and fill prior coverage gaps.

### Milestone 3: Product/transaction attachments and prior-detail gaps

- Add Item attachment contracts and UI.
- Extract/reuse transaction attachment behavior.
- Complete Loan Detail, Pending grouping, Warehouse hierarchy, and workspace
  scope seeding required by the earlier navigation task.

### Milestone 4: unified movement read model

- Add the paged Stock Entry/Stock Reconciliation query and classifications.
- Build responsive movement modes, filters, facet counts, and detail routes.
- Redirect `/history` deliberately.
- Verify direct ERPNext records and current app-authored records side by side.

### Milestone 5: reconciliation capability and durable draft

- Add exact server permission capability.
- Add durable local-first reconciliation state and attachments.
- Implement leaf scope, selective/whole-location modes, scan/search, batch
  counting, baseline capture, and conflict checks.

### Milestone 6: submission and hardening

- Create/submit standard ERPNext Stock Reconciliation with exact permissions.
- Add completed detail/history linkage.
- Resolve all route/API generic failures.
- Complete focused unit/backend coverage and manual-browser handoff notes.

Do not bundle the entire task into one unreviewable rewrite. Reuse the current
components only where their contracts can meet this specification.

## Testing and validation

### Frontend unit/component coverage

Add focused tests for at least:

- `物资管理` brand never receiving selected state;
- exactly one Pending notification;
- updated pending/draft counts after operations;
- shared Inventory/Expiry compatible filter state;
- root/system/category-root exclusion;
- local/full/friendly warehouse labels and no company suffix;
- room-only unspecified leaf collapse;
- compact tree disclosure spacing contract where testable;
- chip close-first order, wrapping/collapse, focus restoration, and removal;
- facet-count rendering and stale response rejection;
- upward scrolling and results-pane scroll restoration after incremental load;
- desktop table versus mobile-card content priorities;
- available quantity prominence semantics/classes;
- mobile cards omitting loaned/damaged/unlocated summaries;
- FAB open/close/Escape/outside behavior and permission-aware actions;
- Product attachment permission and completed transaction immutability;
- movement mode routing and direct ERPNext source labels;
- reconciliation start action absent without capability;
- deep-linked unauthorized reconciliation route rejection;
- selective count omission leaving stock unchanged;
- whole-location explicit zero requirement;
- batch-line identity and duplicate prevention;
- discrepancy review grouped by UOM;
- baseline conflict preserving counted values and invalidating signatures;
- no reconciliation workspace creation on initial route mount;
- one idempotent creation after first meaningful edit; and
- silent first-save route adoption without component/focus/scroll reset.

### Backend coverage

Add focused tests for at least:

- physical tree excludes overall root, physical boundary, virtual root, and
  system descendants;
- unlocated inclusion only on deliberate surfaces;
- complete Item Group ancestry with `All Item Groups` hidden as an option;
- facet counts follow other-facet/self-facet semantics and deduplicate parents;
- counts respect Item, Warehouse, company, and User Permission boundaries;
- Inventory/current/catalog/expiry results and counts share predicates;
- expiry image field fixtures and real response shape;
- pending page grouping exactly matches badge counts;
- loan parent paging/detail without per-row query loops;
- standard ERPNext receipts/issues/transfers appear in the correct movement
  mode without `ti_movement_kind`;
- explicit special movement classification takes precedence;
- ambiguous ERPNext movements remain standard rather than being misclassified;
- opening and routine Stock Reconciliations appear in `盘点调整`;
- submitted/cancelled/read-permission behavior for both document types;
- unauthorized users cannot create reconciliation editing state through API or
  deep link;
- `can_reconcile_stock` requires create plus submit permission;
- group/system/disallowed warehouses cannot become reconciliation lines;
- selective reconciliation changes only included identities;
- whole-location mode rejects implicit/unreviewed zeros;
- batch reconciliation uses valid ERPNext batch/bundle semantics;
- missing positive valuation produces a specific validation failure;
- captured posting-time baseline conflicts on a changed historical balance;
- idempotent retry cannot create duplicate workspaces or reconciliations;
- attachments enforce privacy, ownership, and completed immutability; and
- final submission produces a standard ERPNext Stock Reconciliation and no
  parallel stock record.

Run from `frontend/`:

```sh
yarn test
yarn type-check
```

Run the focused backend integration entry point from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Expand or split the backend test entry point if reconciliation tests become too
large, but keep rollback/savepoint safety. Run `yarn build` only when routing or
production integration is ready. Do not launch browser automation unless the
user separately requests it.

## Manual validation handoff

The user will perform final browser validation. Provide a concise checklist that
covers:

- desktop wheel/touchpad scroll down and back up in Inventory, Expiry, and
  Movements;
- mobile bottom-nav/FAB safe-area behavior;
- hierarchy labels for the current 第1寺院/第2寺院 sample data;
- chip wrapping with several locations/categories selected;
- dynamic counts while combining search, category, and warehouse filters;
- Product/transaction attachment upload and completed read-only display;
- direct ERPNext Stock Entry and Stock Reconciliation visibility;
- unauthorized account lacking every reconciliation start entry point; and
- authorized current, batch, selective, whole-location, conflict, and successful
  reconciliation scenarios.

## Acceptance criteria

This task is complete only when all of the following are true:

1. The shell says `物资管理`; the brand is never selected, and the active primary
   destination is correct.
2. Pending appears once in the global header when nonzero and quietly in More at
   zero.
3. Current Inventory, All Products, and Expiry visibly share one responsive
   filter/list experience.
4. Warehouse and category roots are hidden; virtual/system warehouse branches
   do not leak into physical browsing.
5. Every location uses centralized local/full/friendly labels without company
   suffixes or duplicated ancestry.
6. Chips are close-first, vertically stackable/collapsible, and remain keyboard
   accessible.
7. Each hierarchy row shows a live, permission-aware distinct-result count using
   the confirmed cross-facet semantics.
8. Desktop filter/results panes scroll independently in both directions without
   trapping the page; mobile uses ordinary document scrolling.
9. Desktop Current Inventory is a compact table with dominant bold Available;
   mobile shows large Available and small Total only.
10. Unlocated quantity is absent from product-row summaries and remains
    discoverable in location detail and Pending.
11. The expandable FAB works on desktop and mobile and never starts Receive from
    its closed state.
12. Product Detail supports permitted image/general attachments; editable
    transactions support attachments and completed records are read-only.
13. `更多 -> 货物流动` replaces the old label and `/history` remains compatible.
14. Movement modes provide 入库/出库/转移/盘点调整 plus a compact special-type
    selector.
15. Relevant Stock Entries created directly in ERPNext appear and are safely
    classified without requiring `ti_movement_kind`.
16. Opening and routine Stock Reconciliations created in ERPNext appear in
    盘点调整 with readable details.
17. Movement lists are paged, permission-aware, responsive, filterable, and do
    not add incompatible UOMs.
18. A user without create-and-submit Stock Reconciliation permission cannot see,
    deep-link into, create, save, or confirm a new reconciliation action.
19. An authorized user can perform a selective leaf-location count without
    changing omitted products.
20. Whole-location mode never interprets an uncounted row as zero.
21. Batch counts use ERPNext-compatible batch identities and block unsupported
    serial behavior clearly.
22. Reconciliation confirmation revalidates the posting-time baseline and
    preserves physical counts on conflict.
23. Successful confirmation creates/submits standard ERPNext Stock
    Reconciliation records and shows them in movement detail/history.
24. Direct and app-created movement/reconciliation attachments obey permission,
    privacy, and immutability rules.
25. Known page failures expose useful Chinese messages and retries rather than
    normalizing every error to `操作失败`.
26. The prior navigation task's incomplete Loan, Pending, Warehouse, selection,
    seeding, and deferred-workspace acceptance items are completed and covered.
27. Frontend tests, type-check, and the rollback-safe backend suite pass.

## Explicitly out of scope

- Changing the four primary destinations.
- A fixed top-level Pending or Movement primary destination.
- A volunteer-count/manager-approval reconciliation workflow.
- Allowing read-only users to start a reconciliation draft.
- Treating an omitted whole-location row as zero.
- A parallel inventory ledger, batch ledger, attachment store, or reconciliation
  record of truth.
- Inferring borrower, loan, return, or loss semantics from free-text ERPNext
  remarks.
- Silently treating serialized inventory as ordinary quantity-only stock.
- Replacing ERPNext Stock Entry, Stock Reconciliation, Item, Batch, Warehouse,
  Bin, or Stock Ledger Entry.
- Editing submitted documents or their attachments from the custom app.
- Browser automation unless separately requested.
