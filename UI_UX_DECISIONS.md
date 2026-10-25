# Temple Inventory UI/UX Decisions

This is the current product decision record. Retired mockups, preview-only
proposals and implementation chronology belong in Git history. Add a dated
supersession below when a durable user-facing decision changes.

## Supersession — 2026-10-25: runtime environment identity

- Sample, staging and development sites identify themselves in the browser
  title/theme, app header, login branding and installed PWA name/icons. The
  site config key `temple_inventory_environment` controls this at runtime;
  unknown or missing values default to production except missing on
  `developer_mode`, which defaults to development. Production keeps its current
  title, theme, icon set and unbadged header.
- Environment labels are 演示, 预发布 and 开发. The header uses a named,
  high-contrast badge; environment theme colours are sample amber `#8a4b08`,
  staging violet `#593d8c` and development blue `#245b9e`.

## Language and identity

- Product chrome and operation/status/outcome/document-type values are Chinese.
  Translate only presentation labels; retain native enum keys, IDs and query
  values for grouping, filtering, sorting and writes. User-entered content and
  explicit ERPNext identifiers remain unchanged.
- Hierarchy filters show `local_label` in primary ink and use `full_label` as the
  accessible title. Search matches the presenter's `search_text`; chips and other
  warehouse summaries use the canonical short `label` while preserving native keys.
- Category is optional. Root categories are hidden in ordinary labels and
  selectors. Category filters combine selected subtrees with the independent
  exact-match `无分类` option. Renaming a category updates linked Items; native
  permission, child and link guards control deletion.
- Warehouse labels come from the permission-filtered location presenter. Use its
  short, room-anchored `label` in cells and selectors and its `path` as secondary
  context or a tooltip. Route values and audit identities keep native keys.

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
- Activity detail, drafts and Reports use the canonical browse toolbar for
  search, filters and applied chips. Browse URLs omit default query state and
  serialize only changed fields, including changed fields inside nested scope.
- Browse scanning sits beside barcode/item search fields and reuses one
  interaction. Open, cancel and failure preserve typed input; generic browse
  scans follow the normal lookup path and release the camera. Camera, hardware
  scanner and manual entry converge on the same workflow.
- Movement and Loan browse mode is top-level `view=items|records`; other filters
  and drill-through identities remain URL state. Explicit view changes apply
  target-view defaults; browser history restores ordinary browse context.
- Desktop browse pages keep title, view tabs, search/chips and filter/sidebar
  controls in a persistent row when space allows. Filter popovers open below
  their trigger and scroll within remaining viewport space.

## Supersession — 2026-10-24: persistent browse header

- Browse headers do not collapse; remove 收起工具/展开工具. At 1024–1280px,
  the persistent row wraps in place. The filter control shows its active count;
  sidebar behavior follows the later 2026-10-24 rail supersession below.
- Create actions use a split button with the page's default action on the main
  face and other permitted kinds in the menu. Export, 草稿 (including its
  count) and secondary actions go in a `⋯` menu.
- The count and quantity preview occupy one line directly above results.
  Browse headers stick below the app bar, gain a hairline/shadow only while
  stuck, and table headers stick inside their result scrollport.
- `/` focuses the page search unless the user is typing in an editable field.
  Escape retains the current search/chip editor behavior.

## Supersession — 2026-10-24: browse rail and Reports export

- The persistent-header rule that called for an icon-only sidebar toggle with
  tooltip `显示/隐藏筛选侧栏` is superseded. On desktop, the open hierarchy
  rail owns a `收起筛选侧栏` control; its collapsed 28px edge rail owns the
  `展开筛选侧栏` control. Phones keep their filter sheet and no hierarchy rail.
- Reports' primary 导出 action opens the QuickExport dialog directly with the
  current query. The overflow menu does not duplicate that action.

## Supersession — 2026-10-24: Phase 8 browse consistency

- Category and warehouse hierarchy rails always sit outside the white result
  card as a flat panel aligned to the results top. This applies to Stock and
  Pending alongside Movements, Loans and Reports.
- Damaged rows use quiet Repair and danger-tone text Disposal actions. Item
  details and row export live in a `⋯` menu. The row count and analysis control
  share the result summary line; its explanatory callout stays one compact line.
- Warehouses uses `BrowseToolbar`: the title, search and node count stay in the
  shared browse header, 添加区域 is primary, and refresh/export are in overflow.
- PWA update availability appears as a persistent dismissible `ToastHost` toast
  with 更新. Dismissal lasts for the session and expires when a newer worker
  version appears.

## Supersession — 2026-10-24: compact visual-pass details

- Phone primary navigation always shows all six destinations within the viewport.
  Shared back controls become icon-only at narrow widths and keep an accessible
  返回 name.
- Activity identifiers stay out of the overview. Related-record tables scroll
  within their own result container; movement summaries show the three highest-
  count kinds inline and disclose the rest on demand.
- Submitted document headers show the record identity and one native status
  badge. Reload is available for editable drafts and detected conflicts.
- Reports use 导出 as their primary action. Expiry keeps 入库 in its overflow
  menu; Drafts uses 新建. Loan settlement actions stay grouped before the quiet
  ERPNext Desk link.

## Supersession — 2026-10-24: movement icons and labels

- A single kind map supplies the icon and canonical Chinese label for each
  movement kind and count adjustment. Every surface uses the same glyph for a
  kind, including dashboard actions, menus, filters, records, notifications,
  drafts, editor headings and More tiles. Glyphs are distinct across kinds.
- Repair is labeled `修复归库`; Reconcile and Stock Reconciliation are labeled
  `盘点调整`. Native enum keys, IDs, query values and ERPNext DocType names
  remain unchanged.

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
- Sortable table headers are the only sort control while a table is visible.
  Keep `SortControl` on card views and surfaces without sortable headers.
- Category trees start with only their visible first level. Branches start
  closed; warehouse/source/destination branches open only when they contain
  multiple selectable leaves. Location search matches presenter search text.
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
- The location model is Area → Room → Shelf. Room groups and subdivided Shelves
  have one hidden direct-storage leaf; the tree hides all direct leaves so choosing
  a Room selects its subtree. Write selectors list storable leaves only and show
  a Room's direct leaf with the Room label. Areas and Rooms own their structure;
  shelves are physical storage locations. Compatible Warehouse records outside
  the configured physical root remain hidden and are never silently adopted.
- The warehouse manager offers contextual create, rename, move, disable, subdivide
  and direct-storage repair actions. Names and optional short labels are the only
  location identity fields edited there; ERPNext identifiers stay in a collapsed
  details section.
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
- A pristine new movement or count form has no record badge or status chip. After
  the first edit, status uses plain language: `未保存`, `正在保存草稿单据…`,
  `已存为草稿单据`, `已暂存在此浏览器` or `保存失败`; conflict, deleted and
  forbidden states remain visible in plain wording. Saved documents show their
  document name subtly without describing it as “native”.
- **草稿单据** means a system-saved draft that has not changed stock and can be
  continued on any device or in ERPNext. **浏览器暂存** means incomplete input
  retained only in this browser and account; it can be lost with browser data.
  New forms do not list other browser snapshots. The `/drafts` page combines
  system movement drafts and browser snapshots, newest first, with kind/source
  filters, a concise summary, relative time, continue and delete/discard actions.
  Full recovery data is disclosed per browser row. Opening a recovery link
  validates and applies the snapshot automatically, then confirms with a toast;
  inspection failures and version conflicts remain explicit.
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
- Desktop Stock cards use a square contain-fit image area; on phones, list rows
  are the default and the optional card view uses two columns. Density changes
  desktop card geometry; compact DataTable thumbnails keep their existing size.
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
- Every pending action is visibly pending on its trigger, and sibling actions
  stay disabled while it runs. Option lists that are still loading show a
  skeleton instead of silently changing their choices.
- Blocked validation uses the design-system warning callout, marks the
  associated fields invalid, and moves focus to the first actionable error.
  Server and save failures use danger callouts and retain their inline detail.

## Picker, scanning and export refinements

- **2026-10-24 — Data clarity and frontend authorization, superseding earlier
  permission-gated frontend behavior:** Movement endpoints use the shared
  `LocationEndpoint`: physical locations retain the canonical primary label;
  leased and damaged destinations use icon plus muted/warning text; empty ends
  use an outward icon with kind-specific tooltip meaning. Related settlement
  controls are labeled `原借出`; their read-only dialog is titled `原借出记录 ·
  只读` and explains that quantity and settlement status follow the original
  Loan. Cross-document links use the shared kind-labeled `RecordRef`, Item lines
  include compact artwork, and mixed-value summaries use labeled fields. All
  frontend users admitted by `require_frontend_account` are System Managers, so
  per-DocType visibility checks are removed. Configuration readiness and
  document-state behavior remain; server native permission checks remain the
  sole authorization boundary. A single original Loan chip names the borrower
  and month-day, with the document name secondary; multiple originals use
  `N 笔借出`. Count adjustment rows show distinct counted locations in the source
  cell joined by `·` and `—` in the destination cell, consistently in records,
  histories and reports. A count adjustment describes checked locations, not a
  movement to or from outside inventory.

- **2026-10-23 — Creation forms, superseding earlier creation-editor behavior:**
  Receive and Transfer remember the account's last selected physical leaf in
  Frappe user defaults; saved values are discarded when they are no longer
  permitted storable leaves. No editor chooses an arbitrary first location.
  Without a valid remembered Receive location, users choose one before adding
  items. Transfer's `调入位置` toolbar value seeds newly added lines, while each
  line keeps an independent destination that cannot equal its source. The fixed
  leased destination is hidden on Loan forms and remains server-assigned.
- Borrower inputs remain free text and may suggest distinct borrowers from
  recent submitted, readable Loan entries. Return starts with filterable
  outstanding Loan cards grouped by borrower, showing loan date, activity,
  outstanding items, thumbnails and quantities. Each card can be added; selected
  Loans appear as removable chips. A return still requires one borrower and
  activity across all selected Loans and reports that incompatibility clearly.
- Editor empty states replace line controls and summaries until lines exist.
  Each shows one kind-specific hint and add/scan actions; a receive editor also
  requires an explicit or remembered receiving location. Initial load errors
  and successful empty states are mutually exclusive.
- **2026-10-24 — Return list at volume:** outstanding Loans are grouped by
  borrower and collapsed initially. Group summaries show loan and outstanding
  item counts plus the latest loan date. Expanded groups load 10 Loans at a
  time inside a bounded, filterable list. Adding a Loan collapses the list to
  removable selection chips and an `添加更多借用` control.

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
- Desktop operation previews use a thin, 12px edge rail with a 1px divider,
  chevron and token-tinted hover/focus state. Its hit area is at least 24px.
  When collapsed, both the grid column and review panel are 28px; the rail
  carries the vertical `确认前检查` label. It keeps its expanded state and focus
  return across full-workspace mode. Mobile has no rail and keeps the disclosure.
- The icon-only full-workspace control sits at the right of the `操作物资`
  heading row and remains available in display mode. Receive's `入库位置`
  selector is compact and inline with the lines toolbar; it lists only storable
  physical places and writes the selected leaf docname.
- The item picker presents one compact DataTable row per Item and warehouse,
  with each selected row retaining its warehouse identity. Outbound rows need
  available quantity; repair/disposal rows need damaged quantity. Inbound shows
  only the category facet, omits the warehouse column and filter, and ignores
  warehouse filters in its query. Its quantity header names the receiving
  location and says `现有`. Inbound rows include stockless Items and bind the
  selected authorized target warehouse.
  Count selections deduplicate Item codes while retaining the complete
  authorized warehouse scope. The picker has no separate stock-detail stage or
  toolbar-collapse action. Newly created Items remain pinned above filtered
  results with their receiving location until the picker closes.
- Picker and form warehouse selectors show the canonical label with the full
  authorized path as detail, while preserving native warehouse keys in writes.
- The full-workspace control stays on the `操作物资` heading row and restores
  the prior preview state on exit. The preview edge remains a separate
  accessible collapse/restore target; mobile uses its normal disclosure.
- Toasts report explicit user-triggered outcomes: manual draft save (including
  browser-only retention), submitted/cancelled/amended/duplicated/deleted
  results, supporting-data saves, file/image changes, and completed export or
  copy actions. Autosave, filtering, and routine scan feedback stay local.
- The 货物流动 browse header has a compact `草稿` entry with the combined count
  of system movement drafts and browser movement snapshots; `更多` keeps its
  separate 草稿 entry.

## Durable supersessions

- **2026-10-25 — Product name, popup layers and menu anatomy:** The app name in
  product chrome and breadcrumbs is `物资管理`. UI layers follow one ordered
  token scale from sticky content through toast, with header navigation and
  popovers above sticky browse chrome. Popup rows use a consistent optional
  icon, left label and trailing metadata; draft navigation is a normal menu
  link. Icon-only controls center glyphs within 0.5px.
- **2026-10-25 — Table horizontal-scroll cues:** Overflown tables expose paired
  left/right 80%-page hints, keep pinned columns clear, clip edge shading to
  the rounded frame and provide a synchronized viewport-bottom scrollbar on
  fine-pointer desktop while the native scrollbar is offscreen. Cues are hidden
  for print and respect reduced motion.

- **2026-10-24 — Dashboard clarity:** Inventory distribution omits the zero
  axis label, sorts stocked groups by item count and shows eight before a
  disclosure. Empty physical locations in the authorized scope are summarized
  in a quiet expandable list; they are not plotted with stocked locations.
  Category distribution labels uncategorized stock `无分类` and omits an empty
  category summary because there is no finite category set to enumerate. The
  expiry preview states its five-batch limit and the matching identity count;
  its rows and full-list link retain the selected expired or dated-not-expired
  window. Dashboard in-card tabs use the shared compact segmented control and
  tab semantics.

- **2026-10-24 — Phone Stock list default and two-column cards:** Below 1024px,
  Stock defaults to dense list rows with 64px thumbnails, a two-line Item name,
  code/category metadata and available quantity plus compact loaned/damaged
  indicators. The 卡片/列表 control is available on phones. Phone and desktop
  view choices are retained separately; desktop keeps its existing default and
  saved choice. Phone cards use two columns with square contain images and a
  two-line name. This supersedes the earlier rule that Stock cards reserve a
  full-width 1:1 image; desktop cards retain square artwork. Mobile Movement and
  Loan Item groups use the same list-row pattern with their existing disclosure
  and nested history behavior.

- **2026-10-24 — Compact browse chrome, sort and stock tabs:** On phones,
  top-level destination and Stock subpage breadcrumbs are omitted because the
  bottom navigation and Stock tabs identify the current page; detail routes
  retain breadcrumb/back navigation. Browse headers use a compact title row and
  a search/filter row that remains sticky after scrolling; applied filters stay
  in a single removable horizontal strip. Primary create actions become an
  accent FAB above the measured bottom navigation; its chevron opens a shared
  bottom sheet. The FAB hides for open overlays and the on-screen keyboard, and
  Return to Top stacks above it. SortControl becomes one stateful chip whose
  radio menu combines field and meaningful direction; desktop tables keep
  header sorting. Sort, Stock card/list and analysis actions live in the results
  summary line. Mobile Stock tabs are an underlined horizontal nav directly
  below the app bar and scroll away with page content, keeping sticky chrome
  within the 104px height budget.

- **2026-10-24 — Popup menus:** Menus close on an outside click and never widen
  the page. Shared action popups anchor to their trigger, flip and clamp within
  the viewport, and only one popup or filter panel is open at a time.

- **2026-10-23:** In-place disclosures use one leading rotating chevron;
  popup triggers use one static trailing chevron. Detail sections are divided
  list rows. Activity detail, drafts and Reports use the canonical browse
  toolbar. Pending actions show state on their triggers, and route changes use
  a delayed progress bar. Related export projections are cached. Browse URLs
  omit defaults, and sortable tables use their headers as the sole sort
  affordance; `SortControl` remains for cards and surfaces without headers.
  Multi-unit dashboard quantities use the shared aligned quantity presentation.

- **2026-10-24:** The app bell stays in the desktop app header and mobile top
  bar, above the bottom navigation. Unread count refreshes on focus, when the
  document becomes visible, and every 60 seconds while visible; supported app
  badges mirror that count. Desktop uses a focus-managed popover and phones use
  the shared full-screen sheet. Export dialogs say `文件将在后台生成，完成后会发送通知并提供下载。`
  before starting and `可以关闭此窗口继续工作，完成后会通知你。` while running.
  Push status distinguishes unsupported browsers, denied permission, iOS outside
  standalone mode and an active subscription.

- **2026-10-22:** The Area → Room → Shelf presenter replaces legacy warehouse
  breadcrumbs and `room_default` display rules. The canonical `label` is used for
  warehouse cells, chips, summaries and selector options; `path` is secondary
  context. Direct-storage leaves stay hidden from hierarchy trees and are the
  write value for a Room selection. The redesigned manager uses versioned
  location APIs and contextual hierarchy actions.

- **2026-10-22:** Data-loading presentation uses shared `AsyncRegion` and `SkeletonBlock` primitives (or `DataTable` skeletons), with retained results dimmed and inert during refresh.

- **2026-10-22:** Movement editor controls use a 28px collapsed preview rail,
  place workspace expansion on the `操作物资` heading row, and keep the Receive
  target compact in its toolbar. Inbound ItemPicker omits warehouse filtering
  and its warehouse column; its stock heading names the receiving location.

- **2026-10-22:** New movement and count forms use a quiet pristine status, and
  browser recovery candidates are hidden from new forms. `/drafts` combines
  草稿单据 with 浏览器暂存 entries; recovery links validate and restore
  automatically. The movement browse header exposes the combined draft count.

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

## Notifications (Phase 4)

Events include submitted movements (per kind), cancelled or amended movements, count adjustments, export completion or failure, and daily expiry digests. All event switches default on except expiry digest, which defaults off. Recipients are enabled System Users with app access, excluding the actor, who have the event enabled, have not disabled Frappe notifications, and pass native read permission for the referenced document. Export results always notify the requester; a result watched live in the export dialog is created as read. Expired export files remain in the inbox with an unavailable state.
