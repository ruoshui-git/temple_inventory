# Temple Inventory UI/UX Decisions

This is the current product decision record. Retired mockups, preview-only
proposals and implementation chronology belong in Git history. Add a dated
supersession below when a durable user-facing decision changes.

## Language and identity

- Product chrome and operation/status/outcome/document-type values are Chinese.
  Translate only presentation labels; retain native enum keys, IDs and query
  values for grouping, filtering, sorting and writes. User-entered content and
  explicit ERPNext identifiers remain unchanged.
- Hierarchy filters show the local node name in primary ink. Only while searching,
  show the matching node's full breadcrumb as smaller muted context. Search
  matches local names and full paths. Preserve accessibility names and native keys.
- Category is optional. Root categories are hidden in ordinary labels and
  selectors. Category filters combine selected subtrees with the independent
  exact-match `无分类` option. Renaming a category updates linked Items; native
  permission, child and link guards control deletion.
- Warehouse display resolves authorized names and parent paths when names
  collide. Route values and audit identities keep native keys.

## Navigation, routes and filters

- The six primary destinations are 首页、库存、货物流动、借用、报表、更多.
  Desktop `库存` opens an accessible menu for 库存列表、效期批次、仓库、损坏待处理;
  opening it does not navigate. Mobile keeps the six-destination horizontal
  navigation and contextual inventory links. `更多` is a menu, not a breadcrumb.
- Canonical paths are `/stock/items/:code`, `/stock/expiry`,
  `/stock/batches/:name`, `/stock/warehouses`, `/stock/categories`,
  `/stock/damaged`, `/movements?view=items|records`, `/movements/new/:kind`,
  `/movements/:name`, `/loans?view=items|records`, `/loans/:name`, `/counts`,
  `/counts/new`, `/counts/:name`, and `/settings/setup`. Named routes own
  navigation and breadcrumbs. Retired paths show not-found. Native Stock Entry
  opens Movement and Stock Reconciliation opens Counts; unsupported DocTypes
  are rejected.
- Search remains visible. Search, applied chips, scan and filter actions share
  one persistent toolbar. Category and warehouse restrictions may also appear
  in a synchronized sidebar; hiding it never changes selected values. Filter
  editors are viewport-bounded dialogs on desktop and sheets on phones. Date
  edits stage until Apply, use inclusive site-date bounds and support editable
  year/quarter shortcuts. Chips summarize fields; editors retain each selected
  value. Grouping is zero to two ordered levels from the active view contract.
- Browse scanning sits beside barcode/item search fields and reuses one
  interaction. Open, cancel and failure preserve typed input; generic browse
  scans follow the normal lookup path and release the camera. Camera, hardware
  scanner and manual entry converge on the same workflow.
- Movement and Loan browse mode is top-level `view=items|records`; other filters
  and drill-through identities remain URL state. Explicit view changes apply
  target-view defaults; browser history restores ordinary browse context.
- Desktop keeps title, view tabs, search and filter/sidebar controls in the
  persistent row when space allows. Create, export and secondary actions sit in
  the expandable toolbar below it. Filter popovers open below their trigger and
  scroll within remaining viewport space.

## Browse behavior

- The shared breakpoint is 1024px. Responsive coordinators mount one active
  surface while retaining controller state across viewport changes. Use the
  shared responsive and infinite-scroll contracts.
- Tables use flattened columns, zero to two ordered grouping levels, column
  settings and compact/balanced/spacious density. Grouped Stock stays tabular at
  every width. Movement/Loan record totals summarize whole matching native
  documents once; filtered line counts are not document totals. Native record
  identity, status, date/time, locations, original loan links and settlement
  eligibility remain available in grouped leaves.
- Paginated controls report loaded and matched totals for their immediate rows;
  expanded descendants do not add to parent counts. Group pages retain their
  matched count; nested group and history controls report their own totals.
- Browse summaries show a compact result count first. Full per-unit and
  per-status analysis is disclosed on demand. Keep units/statuses separate.
  Empty table values stay empty; zero, false, external endpoints, invalid expiry
  and unavailable/error states keep explicit meanings.
- Category trees start with only their visible first level. Branches start
  closed; warehouse/source/destination branches open only when they contain
  multiple selectable leaves. Search reveals matching full paths temporarily.
  Reference refresh preserves manual branch choices. Megamenu fields start
  collapsed on each open and summarize applied values; chips open and focus the
  matching editor. Grouping has a separate labeled section.
- Movement and Loan Item view support no grouping, Item, or Category → Item.
  Removing Category retains Item; removing Item clears the unsupported
  Category-only remainder. Inventory location/history and Expiry support
  Category, Item and Location in either grouping level.
- Loan Item cards show outstanding quantity. Per-item history defaults to
  `未结清借用`; `全部相关记录` includes settled allocations. `显示已结清物品`
  independently includes zero-balance Items with submitted loan history. Scope
  applies to grouped and ungrouped histories. Scope changes restart open
  histories; closed histories load lazily.
- Movement-kind filters are multi-select OR. All, nonzero kinds and selected
  zero-count kinds stay visible; other zero-count kinds collapse behind an
  accessible `无记录 N` control. Raw posting time remains in APIs/exports; the
  interface shows site-local `HH:MM`.
- Available-stock effect defaults to authorized physical leaves. Explicit
  warehouse selections scope it to all selected authorized leaves, including
  loaned and damaged leaves; transfers within the set are neutral. Actual
  movement quantities remain separate and unit-labeled.
- ERPNext Item metadata wins over stale cached names, groups and units when the
  viewer can read Items. Without that permission, expose no catalog snapshot
  beyond the native Item code.
- Expiry windows are shared, nonoverlapping relative ranges. Invalid expiry is
  explicit, custom signed ranges are bounded and invalid values are not
  requested. Batch counts appear only for batch-tracked Items; batch details
  show scoped quantity and expiry. Expiry quantity is physical stock in the
  selected location, with loaned and damaged amounts shown separately.
- Compatible ERPNext warehouses below the configured physical root appear in
  the app. Warehouses outside it are hidden and never silently adopted. Stock
  stays in leaf Warehouses; `Warehouse Type` describes meaning and `is_group`
  describes hierarchy.
- Return-to-top appears after 160px on the active scroll surface, scrolls that
  surface to zero and focuses the page heading. It clears measured mobile
  navigation/action obstruction and is hidden while the mobile filter drawer is
  open.

## Workflows and documents

- More has one `盘点调整` card opening the native reconciliation browser;
  permission-controlled `新建盘点` opens the editor. Category and setup/recovery
  share the management group.
- Dashboard quick actions are 入库、出库、借出、调拨. `更多` contains
  盘点调整、损坏、遗失、修复、报废 plus 归还 guidance leading to outstanding
  loans. Actions reuse existing editors and permission/routing rules; clicking
  never creates or submits a document.
- A count captures the complete authorized physical leaf set at one posting
  timestamp. Search, location and review filters change visible rows only;
  page changes retain entries. Blank differs from deliberate zero. Matching
  counts create no record. Difference reasons and persisted notes are optional.
- Item Code is an editable unique ERPNext identifier previewed from the locked
  `ITM-######` series without reserving it. It identifies a style/type, not a
  physical unit. UOM choices resolve to existing ERPNext records; new UOM
  creation retains the current draft. New Items are available immediately in
  the transaction that opened their editor.
- Receiving and stock-out operations can contain multiple location sections.
  Expired batches may be received; show their state without blocking a valid
  receipt solely because the batch expired. Optional recorder, handler and
  reviewer text stays distinct from the system account that created the
  document. Supporting-data creation returns to the open transaction with its
  draft and context intact.
- Browse and native document headers use the same labeled native status badge.
  Submitted history pages show submitted native documents only. Local editor
  feedback remains separate from document status.
- Activities link by immutable ID. Renames update display metadata, enabled
  types populate selectors, and retired linked types remain readable on
  unrelated edits. Notes are multiline searchable text separate from short
  descriptions. Archive prevents new assignment but preserves existing links
  and settlement; any reference blocks deletion. Activity counts are submitted
  document counts, never quantities.
- Reports retain complete scope and matched counts, fixed view columns, distinct
  units/statuses, pending-until-Apply dates, and account-scoped preferences.
  Historical Inventory shows bounded opening + incoming − outgoing + adjustment
  = closing; transfers retain both branches and net to zero in combined scope.
  No valuation or parallel ledger is shown.
- Batch detail is `/stock/batches/:name`; Item and Batch identities remain
  independent links. Expiry quantities are physical stock in the displayed
  warehouse; `借出` and `损坏` are shown where applicable.
- Item images use standard Frappe Files and a shared lightbox. Small table/detail
  thumbnails stay compact; editor/picker artwork may be larger. Image actions
  remain independent from Item/Batch links.
- An Item's `image` field alone identifies its primary image. Every other
  private Item File, including image files, is an attachment. Replacing the
  primary image keeps the old File as an attachment; removing it leaves the
  primary image empty and never promotes an attachment. Cropping offers a
  square WebP thumbnail capped at 800px without upscaling, use-original, and
  save-original-as-attachment choices. Attachments keep their original bytes.
- Stock cards reserve a full-width 1:1 image area with contain fit. Density
  changes the card's overall geometry; compact DataTable thumbnails keep their
  existing size.
- A batch may have an expiry date without a manufacturing date. Compare dates
  only when both are present; reject a real manufacturing date later than its
  expiry, while allowing expired receipts.
- Quick Export is contextual and uses the same selected query for preview and
  generated output. Dashboard may choose a dataset inside the export dialog;
  other contexts remain fixed. Cancelling does not change dashboard scope.

## Accessibility and feedback

- Interactive targets on mobile/coarse pointers are at least 44px. Keyboard
  focus remains visible; disclosures and tables expose state and useful labels.
  Reduced-motion preferences are respected. Density changes geometry while
  text scaling remains independent.
- Initial async loads use shape-matched skeletons. Refresh retains the current
  snapshot, layout, scroll and selection while dimming only affected results and
  announcing a compact status. Headings and controls remain usable; disable
  stale result actions only. Failed refresh keeps stale results and offers
  retry. Load-more shows a local indicator. Do not show false empty or zero
  states before a successful result. Preserve generation/account guards.
- Card-local requests affect only that card; page refresh affects all result
  regions. Query changes retain prior grouped presentation against its old query
  until the new result is ready. Mutation save/conflict behavior stays separate.
- Blocked validation uses the design-system warning callout, marks the
  associated fields invalid, and moves focus to the first actionable error.
  Server and save failures use danger callouts and retain their inline detail.

## Picker, scanning and export refinements

- Clearing hierarchy search or selections preserves manually expanded tree
  branches. Uncategorized Items remain in the category facet.
- Every Item thumbnail size uses the same responsive SVG missing/error artwork.
  Loading, error state, reserved dimensions and the Item's accessible name remain
  stable from compact tables through the picker and detail view.
- Loan settlement status appears only on original submitted Loan documents.
  Return, Loss and other native operation rows show native document status only;
  malformed Loan rows keep an explicit unknown settlement label.
- Report dataset and view are labeled selectors above results. Main and
  supplementary tables name their role and matched row count. Filter counts
  represent actual restrictions, not fixed defaults. Opening a supplementary
  table does not select an export worksheet.
- Export dialogs are titled `导出`. Their preview shows at most five rows;
  generated files include all matching results for the same query. XLSX preview
  selection is separate from selected worksheets. CSV contains one chosen table.
  Contexts outside Reports offer `打开报表`; the Reports export dialog does not
  repeat that link.
- ItemPicker uses a bounded wide desktop dialog and a full-height mobile sheet.
  Search and actions stay in the header, browse chrome stays static outside
  internal scrollports, and the footer remains fixed. Results, scan and creation
  stages scroll within the dialog. Desktop shows category and warehouse rails.
  Secondary filters stay collapsed until opened; uncategorized is part of the
  category facet. Permission-gated creation and stock detail remain stages in the
  same picker, retaining selection, search and per-stage scroll. Selection-mode
  scans add an item to the selection idempotently; repeated scans do not toggle
  it off.
- The operation picker adds each accepted scan to the current draft as one stock
  unit. Scanning does not submit the operation; existing native-draft autosave
  behavior still applies. Resolve item, active source, destination and batch
  ambiguity before adding. Compatible basic allocations may merge by item,
  source, destination, batch and conversion; native bundles, loan allocations
  and outcome rows remain separate. Outbound capacity includes other draft
  requests and requires one full stock unit. Feedback names the latest item and
  quantity. Undo reverses only the latest increment when its quantity and
  allocation remain unchanged, preserving unrelated edits. Accepted scans move
  the changed line and group forward for display without reordering native lines.
- A camera barcode remains suppressed until at least 500ms of successful empty
  frames. Every failed frame resets the absence interval independently of the
  throttled visible error; decoder errors are not evidence of absence. Manual
  entry and scan-gun Enter count every deliberate submission. Count entry scanning helps locate an
  Item or Warehouse and never changes actual count quantity.
- Desktop operation previews have a separate edge collapse control. Full
  workspace mode remains a secondary explicit action and restores the prior
  preview state on exit. Mobile uses its normal disclosure layout.
- The item picker presents one compact DataTable row per Item and warehouse,
  with each selected row retaining its warehouse identity. Outbound rows need
  available quantity; repair/disposal rows need damaged quantity. Inbound rows
  include stockless Items and bind the selected authorized target warehouse.
  Count selections deduplicate Item codes while retaining the complete
  authorized warehouse scope. The picker has no separate stock-detail stage or
  toolbar-collapse action. Newly created Items remain pinned above filtered
  results with their receiving location until the picker closes.
- Picker and form warehouse selectors show complete authorized paths while
  preserving native warehouse keys in writes.
- The full-workspace control is an icon at the editable area's upper right;
  exiting restores the prior preview state. The preview edge remains a separate
  accessible collapse/restore target; mobile uses its normal disclosure.
- Toasts report explicit user-triggered outcomes: manual draft save (including
  browser-only retention), submitted/cancelled/amended/duplicated/deleted
  results, supporting-data saves, file/image changes, and completed export or
  copy actions. Autosave, filtering, and routine scan feedback stay local.

## Durable supersessions

- **2026-10-21:** Current rules above consolidate browse refinements through
  2026-10-21. They supersede older per-item Loan selectors, desktop browse
  toolbar placements, summary variants, density typography and preview-only
  proposals. The retired standalone preview is not a product surface.
- **2026-10-21:** ItemPicker rows now identify an Item plus warehouse; primary
  image identity, crop choices, batch date comparison, explicit outcome toasts,
  and stock-card image geometry are clarified above.
- **2026-10-20:** Theme palettes use centralized semantic `--p-*` tokens,
  selected by `data-ti-theme`; components consume tokens. Artwork, photos,
  camera output and theme swatches retain intentional colors.
- **2026-10-19:** Category, count, batch, history and availability rules above
  supersede earlier drafts. Native ERPNext stock and permission boundaries
  remain authoritative.
