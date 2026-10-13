# Temple Inventory UI/UX Decisions

This is the authoritative, concise record of durable UI/UX decisions. Read it
before changing user-facing behavior. A current user instruction may supersede
an older rule, but the conflict must be identified explicitly and recorded here
in the same change. Keep implementation details in code or task notes, not here.

## Current preview decision index — 2026-10-13

These approved **preview targets** supersede conflicting earlier proposals below;
production enforcement is unchanged. See [migration coverage](DESIGN_MIGRATION_COVERAGE.md)
for implementation evidence and backend prerequisites. Historical entries are retained
for rationale, not as competing current rules.

| ID | Decision / rationale | Migration impact |
| --- | --- | --- |
| UX-01 | ERPNext document type + name identifies transactions. One editor saves one Stock Entry or Stock Reconciliation. Desk and frontend are equal editors; no workspace ownership. | Replace workspace-exclusive guards/write APIs; ERPNext remains the ledger. |
| UX-02 | Return includes normal/damaged quantities. Loss is a separate explicit operation. Compatible loans may share one return; never silently split documents. | Structured borrowing document/line references on Stock Entry lines; derived balances. |
| UX-03 | New items default to Nos. Existing units/conversions remain authoritative. Large choices are searchable; contextual item/batch pickers expose availability/location/expiry. | Paginated full-dataset search, never just loaded options. |
| UX-04 | Count one leaf location, selected items or full location. Blank is unreviewed, zero deliberate. Summaries separate baseline, reviewed actual and differences with reviewed/unreviewed scope. Baseline refresh preserves counts and requires review. | Versioned ERPNext reconciliation adapter. |
| UX-05 | System Manager is the initial frontend audience; retain document authorization and clear access/session states. | Server gate is future work; preview stays login-free. |
| UX-06 | Private inventory originals and derivatives through Frappe File. Public preview artwork is non-sensitive fixture material. | Audit thumbnail helper and verify seeded files; no reset in preview work. |
| UX-07 | Clean database/API/UI preferred over compatibility during rapid development. A DB reset is acceptable during migration. | No obligation to preserve workspace IDs, old adapters or historical schema. Reset is a separate migration action. |
| UX-08 | Structured activity and purpose remain separate. Explicit supporting-data creation returns to the preserved draft; no stacked overlays. | Preserve queryable fields rather than putting context in Notes. |
| UX-09 | Inventory/Movement/Loans use complete filtered totals and exports. Loading, conflicts and recovery retain input. Submitted documents obey ERPNext lifecycle. | Preserve unknown document fields, reject stale writes; no stock engine in preview. |

Every future agent must update this index/log and the affected coverage rows with
each durable UI refinement. A missing preview capability is not an approved removal.

## Accessibility and responsive behavior

- The volunteer UI is Chinese and mobile-first, with touch-sized controls,
  associated labels, keyboard access, visible focus, and announced errors and
  status changes.
- Manual entry must remain available when camera or browser APIs are unavailable.
- Preserve user-entered data when validation, scanning, upload, or submission
  fails.
- Browse pages keep one semantic page heading. Their mobile header orders the
  title, context tabs, search/actions, then secondary browse tools. After the
  active result surface scrolls past 80px, tabs remain above the compact
  title/search/actions row; secondary tools collapse behind an
  accessible disclosure. Search, scan, filter, and the active-filter badge
  stay available, with controls at least 44px high on narrow phones.
- Browse return-to-top appears after the active scroll surface passes twice
  its viewport height, stays above mobile navigation and creation actions, and
  uses a circular 44px icon button with a desktop hover/focus tooltip. It
  returns focus to the page heading without changing results or filters.
- Dashboard uses the same return-to-top behavior: its desktop content pane is
  the scroll surface, while mobile scrolling belongs to the enclosing shell
  content. A mobile filter drawer hides the control; the desktop filter rail
  does not.
- Mobile browse tool disclosures use a rounded down-chevron that rotates when
  expanded and respects reduced-motion preferences.

## Approved foundation

- **2026-10-12:** Production adopts the quiet jade visual direction: a `#F4F6F3`
  canvas, `#24332D` ink, and `#28684E` accent, with compact, balanced, and
  spacious account preferences, with balanced as the default. Preferences are
  stored per account on the server; a versioned per-account browser cache holds
  confirmed values only. Server preferences remain usable without browser
  storage; balanced is the fallback when neither a server value nor confirmed
  account cache is available. Mobile body and input text remain at least 16px
  and touch controls at least 44px; the shared responsive breakpoint is 1024px. This
  supersedes the warm bronze production palette and 40px narrow-phone control
  minimums recorded above. The six primary destinations remain unchanged, with
  display preferences under 更多. Inventory and receiving behavior remains
  unchanged during migration. Preview image-viewer and receiving-layout
  proposals, along with broader creation, detail, and report redesigns, remain
  deferred.

- **2026-10-12 supersession:** The standalone design preview restored from
  `7b91ff5` is the visual reference for fidelity review. Jade remains the
  selected target direction with balanced density by default and the six main
  destinations; compact and spacious remain available. Production visual
  migration is paused until a manual comparison approves fidelity to that
  reference. The mobile touch-target minimum is **44px** (superseding the former
  40px narrow-phone rule), and body/input text remains at least 16px on mobile.
  Existing inventory and receiving workflows stay in place. Image-viewer,
  receiving-layout, four-destination navigation, and broader creation/detail/
  report redesign proposals remain deferred or experimental; the preview does
  not approve them for production.

## Navigation and layout

- **2026-10-12 preview proposal:** The standalone design pages use five primary
  destinations: 首页, 库存, 货物流动, 借用, 更多. Inventory owns 库存列表,
  效期批次, 仓库, and 损坏待处理, with 盘点调整 as a contextual action.
  Inventory subnavigation appears in the desktop sidebar or mobile page, once
  per surface. Movement and Loans each use one page-header 明细 / 记录 switch;
  their type/status filters never double as links to the other view. Movement
  types are single-select tabs (全部 clears the type); records separately filter
  submitted/draft/cancelled states. Search and applicable type/sort state survive
  view changes, and each view retains its status. More is a grouped tools,
  preferences, and account/device hub without duplicate subnavigation. It owns
  all drafts, while contextual draft records use the same data and editor.
  Setup/authentication/recovery examples remain in the review index only.
  These choices supersede six-destination navigation and multiselect movement
  chips **in the preview only**; production adoption still awaits design review.
  Existing route targets and preview hashes remain compatible.
- **2026-10-12 preview controls:** Hierarchy filters have marker-free, aligned
  rows with bounded scrolling. Composite search fields draw one focus ring around
  the entire visible field; standalone fields and scan buttons retain their own
  focus indicators.

- **2026-10-10:** 首页 is the routed Dashboard at `/`; 库存 is the dedicated
  current-stock destination at `/stock`. The mobile bottom navigation keeps six
  direct destinations, including 首页 and 库存. Dashboard global warehouse and
  category filters are URL-backed; ordinary navigation opens destination
  defaults without inheriting Dashboard filters.

- **2026-10-10:** 物资总览 combines current inventory, symmetric expired and
  upcoming batch buckets, movement summaries and recent records, outstanding
  loan balances, supported reminders, and one next-level distribution view.
  Dashboard loan summaries intentionally show only existing operational fields
  (borrower, activity, loan date, outstanding quantity, physical provenance,
  and current status); they never show due dates, overdue labels, or inferred
  overdue flags and do not introduce another data model.

- **2026-10-10:** Dashboard initial loads, manual refreshes, and global filter
  changes use one shared status centered in the visible dashboard data region;
  retained content fades while the header, navigation, filters, and local card
  controls stay usable. Stale drill-through links are unavailable until the
  current global scope loads. Period, preview, distribution-mode, and retry
  requests update only their affected card. A failed update keeps the prior
  content and reports the failure with retry. Browse and detail refreshes use
  the same visible-region status while retaining data, scroll position, and
  layout height; initial, empty, error, and load-more states remain distinct.
  Distribution uses horizontal bars on a shared zero baseline with integer
  count ticks and exact distinct Item-type counts; warehouse/category counts
  may overlap and never imply a unique grand total or percentages. This
  supersedes the earlier Dashboard-only bottom-card update indicator.

- Standalone creation and editing flows use normal routed pages under the
  application shell. Do not render a drawer over an otherwise empty page.
- Drawers are reserved for contextual work that returns to an in-progress flow,
  such as selecting or creating an Item during a transaction.
- Back and cancel actions must have a predictable destination and must not
  silently discard an in-progress transaction.
- Inventory defaults to an image-forward card view when no browser preference
  exists. Users may switch to the sortable table, and the browser remembers the
  valid local choice. Cards emphasize available stock while always retaining
  total, loaned, and damaged quantities.
- List quantity summaries describe the complete permission-filtered result, not
  only loaded pages. Group quantities by each Item's stock UOM and never combine
  incompatible UOMs into one total.
- `货物流动` opens on a mobile-first overview with rolling, natural, and custom
  inclusive date ranges. Each stock action keeps its own complete-result,
  stock-UOM summary and observer-paged Item breakdown; opening stock and
  reconciliation remain under `盘点调整`.
- `报表与导出` lives under `更多` as the complete report catalog. Inventory,
  expiry, warehouse detail, and movement views also offer a contextual export
  dialog that preserves the current filters without changing page state.
- Reports use stable report-specific columns rather than a mobile column
  builder. XLSX contains applicable summaries and detail sheets; CSV contains
  the flat detail data, and both export every permission-filtered match rather
  than only loaded rows.

## Feedback

- Show immediate success toasts for completed creation actions.
- Show field-specific validation and availability feedback inline and announce it
  accessibly. Keep the draft intact after a collision or server error.
- Distinguish loading, saving, saved, conflict, and failure states where work is
  asynchronous or durable. Browse surfaces show explicit initial loading before
  empty states; refreshes retain existing rows with a non-blocking update state.
- Shared buttons use primary, secondary, ghost, and danger variants with common
  compact sizing, icon placement, focus rings, hover, loading, and disabled
  states. Export actions always include a download icon.

## Shared compact filters

- Inventory, Expiry, 货物流动, 借用, 待处理, 草稿, and list-level browse pages
  use the same compact filter sections and hierarchy styling. Desktop filters
  occupy a 250px rail; mobile filters use one focus-safe drawer with an enabled
  count and immediate application, plus 清空/完成 actions. Reports keep filters inline, and 仓库 retains a
  search field rather than a filter sidebar.
- Async single-select controls close on outside pointer, Escape, Tab/focus
  leaving, and component unmount. Warehouse/category hierarchy filters are
  always-inline trees: their search and rows remain visible, and they do not
  close as a suggestion popup. Selection is committed before blur can close an
  async selector.
- Warehouse and category hierarchy filters share one normalized selector core,
  preserving parent/child selection, counts, indeterminate state, clear, and
  keyboard behavior across browse pages.

## Movement browsing

- Compact movement headers keep the selected period controls and resolved date
  range visible while title/count condense after result scrolling. The rolling
  period menu is body-teleported and anchored to its trigger so shell overflow
  cannot clip it.
- Custom movement dates use the same out-of-flow anchored popover contract.
  The resolved actual range remains visible inline and is the custom trigger;
  opening the two date fields must never reflow the movement header.
- Movement-kind chips live inside result chrome. All, non-zero kinds, and any
  selected zero kind remain visible; other zero-count kinds collapse behind an
  accessible `无记录 N` control. Kind selection is multi-select OR and 全部
  clears it.
- ERPNext Item metadata is authoritative whenever the caller has Item read
  permission: movement rows overwrite stale workspace values for name, image,
  group, and stock UOM. Unauthorized Items expose no catalog snapshot beyond
  their code. Raw posting time stays unchanged in APIs/exports; the UI shows
  `HH:MM`.

## Item creation

- Item Code is an editable ERPNext-compatible identifier. New forms preview the
  next unused `ITM-######` code without reserving it; users may replace it with
  any valid unique code. Recheck uniqueness on submission and offer a one-action
  way to request a fresh automatic suggestion.
- Item Code identifies an item type or style, not an individual physical unit.
- Default Unit is a visible searchable autocomplete over ERPNext UOM records.
  Select `Nos` initially only when it exists, allow users to clear or replace it,
  and submit exactly the selected UOM. Never silently substitute `Nos` or the
  alphabetically first UOM.
- A typed UOM is valid only when it resolves to an existing UOM. A newly created
  UOM is added, selected, and must not clear other draft fields.
- A newly created Item is immediately available in the transaction that opened
  its form. Standalone creation navigates to the new Item detail after success.

## Scanning

- Put a labeled scanner icon button directly beside scannable barcode/search
  inputs. Use one reusable interaction for item creation and item lookup.
- Opening, cancelling, or failing a scan preserves typed text. A successful
  single scan fills the associated input, triggers its normal lookup/update path,
  and releases the camera.
- Camera, hardware-scanner, and manual entry paths converge on the same workflow.

## Inventory and expiry browsing

- `全部物品` is not a separate Inventory destination. `有库存` is a filter on
  the main `库存列表`; old `mode=catalog` links hydrate that filter for
  compatibility and are rewritten to the canonical query form.
- Desktop Inventory and Expiry use the compact story density, shared filter
  panel, icon-plus-text controls, and a header that condenses after 80px of
  result scrolling. The existing mobile page layout remains unchanged.
- Expiry uses one shared positive day threshold for the four standard,
  non-overlapping relative windows. `无效期` is explicit. `自定义` accepts an
  independent inclusive signed range from -3650 to 3650 days, where negative
  values are past dates; invalid input remains visible and is not requested.
- Expiry option counts describe the complete current scope and exclude only the
  expiry choice itself: distinct items on Inventory and distinct batches on
  Expiry. There is no `需关注` expiry concept.
- Batch-tracked items show the real batch count, including `0 批次`. Items that
  do not track batches never show a batch badge. Older API rows may show the
  neutral `批次管理` fallback only when batch tracking is enabled.
- Inventory batch badges expose the scoped batch number, quantity, and expiry
  details on desktop hover/focus and mobile click/tap. `效期范围` choices are
  full-width highlighted rows with native radio semantics but no visible radio
  icon; `All Item Groups` is hidden while its descendants remain selectable.
- Expiry keeps the same Receive/Issue/Transfer heading actions as Inventory on
  desktop; mobile browse actions live in the accessible top-right overflow menu.
- Mobile Inventory and Expiry browse pages use the v2 responsive shell below
  1024px: card-first Inventory with a compact list alternative, batch-level
  Expiry rows, complete-scope summary cards, and compact-on-scroll chrome.
  Inventory headline totals intentionally sum numeric per-UOM values as a
  unitless comparison figure; tapping a summary exposes the exact UOM values.
- Card images are ordinary lazy-loaded images and never open a preview. Table
  thumbnails retain the interactive image preview.
- The desktop `库存` navigation parent is an accessible expand/collapse button
  containing only `库存列表` and `效期批次`. The app mark remains neutral in
  active, hover, and focus states; keyboard focus still has a visible outline.
- Desktop module parents for `库存`, `货物流动`, `借用`, and `更多` use one
  single-open accordion model: parent buttons only expand/collapse, child links
  navigate, and opening one module closes the previous module. `仓库` remains a
  direct destination; mobile bottom navigation remains direct.

## Warehouses

- ERPNext is the source of truth. Compatible warehouses created through ERPNext
  must appear in the app; do not require creation through the custom UI.
- Compatibility requires membership below the configured physical warehouse
  root. Warehouses outside that root remain hidden and are not automatically
  moved or offered for adoption.
- `Warehouse Type` expresses physical meaning (`Room` or `Location`), while
  `is_group` expresses hierarchy. Do not infer type from depth or naming.
- Stock is held only in leaf warehouses. Group warehouses remain navigable
  organizational nodes.

## Transactions

- The custom workspace is optional convenience, not a requirement for stock
  documents created and managed directly in ERPNext.
- Volunteers use domain language and do not need to understand Stock Entry
  purposes, DocType navigation, batch screens, or group/leaf mechanics.
- Group lines by room and location. Receiving starts with one destination but may
  add multiple location sections; stock-out operations may use multiple sources.
- Expired batches may be received, including expired donations; show their state
  without blocking the operation solely because they are expired.
- Handwritten signatures and attestation controls are not part of the workflow.
- Every movement and reconciliation form ends with optional text fields for
  记录人, 经手人, and 鉴证人. These never block saving or confirmation.
- The system `recorded_by` user is captured separately from the optional 记录人
  text because the person entering data may differ from the on-site recorder.
- Supporting-data creation returns to the current transaction without losing its
  draft or context.

## Supersession log

- **2026-10-11:** Compact browse headers keep context tabs and search/actions
  available while secondary dates, result counts, filters, quick status/kind
  choices, view controls, and column summaries collapse behind an accessible
  disclosure. Movement and Loans tabs now belong to their page headers instead
  of the mobile shell. Warehouse, Pending, and Drafts mobile pages own bounded
  result scrollers; restoration and infinite loading follow those surfaces.
  Browse pages add a return-to-top control after two viewport heights, above
  bottom navigation and any creation action. This supersedes the 2026-10-09
  always-visible Movement date/count row and shell-owned Movement/Loans tabs.

- **2026-10-11:** Mobile Expiry removes its summary cards and `全部 / 即将到期 /
已过期` quick selectors; its filter drawer, active chips, result count, view
  switch, and column summary remain. Loan 明细 and 记录 use inclusive all,
  natural, rolling, and custom original-borrow-date ranges; record mode returns
  complete matching loan documents with cumulative outcomes. This supersedes
  the mobile Expiry summary/quick-selector rule and exact-date Loans filter.
  Inventory and Expiry place list/card controls on the left and the outlined
  sigma `列汇总` trigger on the right; its label remains visible at 14px, and
  compact mobile tab labels are 14px.

- **2026-10-11:** Return-to-top controls use an icon-only circular 44px button
  with a desktop hover/focus tooltip. Dashboard joins the shared return-to-top
  behavior, targeting its content pane on desktop and the shell content on
  mobile; only its mobile filter drawer hides the control. The mobile browse
  tools disclosure uses a reduced-motion-aware rotating chevron instead of a
  text glyph. This supersedes the previous visible `↑ 返回顶部` button label.

- **2026-10-10:** Shared loading boundaries own visible-region refresh status.
  Dashboard initial/global requests use one boundary across all data sections;
  local card requests and other refresh surfaces use a boundary within their
  affected data region. This supersedes the Dashboard's previous bottom-card
  update indicator.
- **2026-10-10:** The Dashboard now stacks inventory, expiry, movement, loans,
  reminders, and distribution in that order below the shared 1024px breakpoint
  or when measured content is narrower than 760px. At wider desktop content,
  independently stacked columns group inventory, expiry, and distribution on
  the left, and movement/recent records, loans, and reminders on the right.
  This supersedes the paired-row Dashboard layout recorded below.
- **2026-10-10:** The Dashboard follows a compact, viewport-owned layout:
  inventory and expiry, movement and recent records, loans, reminders, and
  distribution form six sections in paired desktop columns when available
  content is at least 760px wide; narrower content and surfaces below the
  shared 1024px breakpoint use one column. Movement summaries precede recent
  records; inventory metrics use two columns and expiry uses balanced groups
  of three. This supersedes the generous-spacing direction in the earlier
  Dashboard brief and `notes/done/20261010-temple_inventory_dashboard_design_spec.md`.
  Desktop shell navigation and page content scroll independently. Ordinary
  forms, details, warehouses, and reports scroll in the shell content; the
  Dashboard owns its content scroller and bounded filter rail, while viewport
  browse pages keep their results scroller and bounded filter rail. Responsive
  filter panels lock document scrolling and trap focus only while an open
  mobile drawer is active; desktop filters stay in the page layout.

- **2026-10-10:** Dashboard desktop columns place inventory, distribution, and
  expiry on the left, with movement, loans, and reminders on the right. Stacked
  layouts use inventory, distribution, expiry, movement, loans, and reminders
  in that order. Warehouse and category trees show descendants as selected
  through a selected ancestor. Selecting a parent replaces all selected
  descendants with that parent; unchecking the parent clears its entire branch.
  Unchecking an inherited child excludes that branch and retains the other
  covered leaves. Selector chips and Dashboard active-filter chips never show
  an ancestor and its descendant together. Dashboard distribution labels its
  unique in-stock Item Code total `物品种数 · N 种` and explains that it is
  deduplicated by Item Code rather than summed stock quantity. Warehouse mode
  also explains that an Item Code may appear in several warehouses, so bar
  counts can sum above the total. This user-approved rule supersedes the
  previous Dashboard section order and selection-chip semantics recorded
  above.

- **2026-10-10:** 借用 uses separate 明细 (`/loans/items`) and 记录
  (`/loans/records`) browse destinations, matching 货物流动. 明细 defaults to
  未归还, while 记录 defaults to 全部; both expose their mode-specific status
  choices as mutually exclusive quick-select chips in the result chrome. An
  explicit 明细 全部 selection remains URL-backed and reproducible. 未结 and
  已结清 remain the 记录 status choices. 明细 is one row per loan item line,
  while 记录 is one row per complete loan document. The persistent quantity
  summary row is removed; column totals remain available on demand. This
  supersedes the earlier decision that both destinations default to 全部.

- **2026-10-10:** 借用明细 groups positive quantities by Item Code and outcome:
  outstanding, returned, damaged, and lost. Each group has item, quantity,
  return status, and a distinct contributing-record count. Its bounded preview
  lists the contributing loan documents and each matching batch/location line;
  selection never opens an arbitrary loan. This supersedes the line-per-loan
  明细 rule above. Loans 明细 and 记录 share the compact browse shell. Inventory
  no longer shows desktop or mobile headline quantity-summary cards; per-item
  quantities, on-demand column summaries, and Dashboard summaries remain. This
  supersedes the Inventory mobile summary direction recorded on 2026-10-09.

- **2026-10-10:** Expiry batch identity is rendered once per browse result. The
  batch number remains in the item identity/card text; the redundant batch
  popover is removed while location popovers remain available for per-location
  quantities. Shared desktop browse table headers apply sticky positioning to
  each `th` so they remain legible inside the results scroller. Operation-level
  movement records preserve first-occurrence source/destination branches and
  render each branch independently, including mixed Return destinations.
  Browse result metadata places left-to-right filter chips beside a right-
  aligned complete-result count strip. Responsive filter panels with a custom
  trigger hide their built-in trigger, and filter rails/drawers use one
  continuous background.

- **2026-10-10:** User-content images use one lazy async-image contract: a
  size-matched skeleton while loading, a stable no-image/error fallback, and a
  reset whenever the source changes. Inventory card images remain inert while
  table thumbnails retain preview behavior. Browse pages keep a persistent
  `已加载 · 筛选结果 · 全部` result strip and omit duplicate title-adjacent
  totals; `全部` is the permission-scoped base view/status count before search
  and browse filters. Desktop multi-action creation uses the shared keyboard-
  accessible menu, closing on selection, outside press, Escape, focus leaving,
  and unmount; mobile continues to use the shared FAB menu. Truncated notes are
  text-like controls with a subtle affordance rather than chips while retaining
  hover, focus, touch, outside-click, and Escape popover behavior.

- **2026-10-10:** Movement locations present operational system warehouses as
  short `借出` and `损坏待处理` labels with a restrained icon/accent treatment;
  ordinary locations retain breadcrumbs. `未定位` is retired as a system
  warehouse and Pending is damaged-stock-only. Loans use the compact browse
  shell, status-aware titles, complete-result quantity summaries, adaptive
  cards/table, and permitted `新建借出` plus `新建归还` actions.

- **2026-10-10:** Browse creation actions use one shared action model. Mobile
  browse surfaces expose permitted actions through an expandable `＋` FAB;
  desktop surfaces keep actions in an immediately reserved top-right group,
  disabling controls while bootstrap permissions resolve and hiding actions
  unavailable after bootstrap. Expiry cards, lists, and tables use the same
  touch-sized batch/location detail chips; expired batches mark every location
  line in the location popover as expired. The mobile context strip is anchored
  only to the top and never stretches toward the bottom navigation.

- **2026-10-09:** Mobile browse context tabs share one compact segmented control.
  Inventory, Expiry, Movement, and Loans use top-positioned tabs on mobile;
  Movement and Loans reserve the measured context height above their content,
  and the compact state is a 40px border-box tab strip after 80px of scrolling.
  Mobile filter drawers keep an always-visible `‹ 返回` header action alongside
  `完成`, backdrop, and Escape dismissal with focus restoration. Filter section
  disclosures use the same right-pointing triangle as `更多条件`; hierarchy
  node expanders remain a separate control. Movement results own the only
  mobile vertical scroll surface within the viewport-safe page shell.

- **2026-10-09:** Mobile Inventory and Expiry browse chrome keeps a compact
  `库存列表 / 效期批次` submenu visible after result scrolling. Mobile filters
  use the shared focus-safe drawer, `Σ 列汇总` is placed beside result controls,
  Expiry defaults to the remembered card view, and contextual exports remain
  desktop-only while the Reports hub remains available on mobile. Global
  filter actions say `恢复默认筛选`; section-level actions retain `清除`.

- **2026-10-09:** `货物流动` and its detail/record/contextual export paths
  default to `全部时间`. The explicit all-time period clears custom dates,
  omits date predicates, reports an empty resolved date range, and omits the
  default period from canonical URLs.

- **2026-10-09:** The hierarchy-filter portion of the close-on-leave selector
  rule is superseded. Warehouse/category filters now use an always-inline,
  initially expanded tree with search, disclosure, counts, and keyboard
  selection; close-on-leave remains limited to async/dropdown selectors.

- **2026-10-09:** Desktop module children use one explicit vertical submenu
  column. Each child is a full-width, no-wrap horizontal row with shared
  active, badge, hover, and keyboard-focus treatment.

- **2026-10-11:** Navigation does not show the expiry-batch result count next
  to `效期批次`; expiry counts remain available in page filters and result
  summaries where their meaning is explicit. Mobile bottom navigation marks
  the selected destination with a dark filled brand treatment and white icon
  and label for clear contrast.

- **2026-10-09:** Movement desktop chrome has two deliberate states. Normal
  desktop uses title/count plus period controls, then a full-width search/action
  row, then movement-kind chips. The compact scrolled state combines title,
  period, search, and actions in its first row while keeping chips on row two.

- **2026-10-09:** Warehouse/category selector search, tree, disclosure, count,
  custom checkbox, indeterminate, hover, focus, selected, and responsive styles
  belong to `HierarchyFilter.vue`; InventoryFilterPanel only owns its additional
  inventory-specific sections and presentation.

- **2026-10-09:** Custom movement period dates are edited in a body-teleported,
  trigger-anchored dialog. The inline resolved range remains the interaction
  target, while the date editor stays out of normal header layout flow.

- **2026-10-08:** `列汇总` is a shared, on-demand result analysis surface on every
  sortable data table. Existing Inventory/Expiry business summary cards remain
  in place; column summaries add complete filtered-result totals and show a
  unitless comparison alongside the authoritative per-UOM breakdown. Movement
  records include both inventory reconciliation and read-only opening-stock
  records; adjustment is no longer a top-level navigation destination.

- **2026-09-30:** 货物流动桌面明细/记录共用 Inventory 紧凑结果壳：可收起的
  250px 高级筛选栏、结果滚动超过 80px 后压缩页头、独立移动端筛选抽屉；明细
  采用物品/从/到/关联记录列，记录采用稳定的多单位数量和状态邻接标记。
- **2026-09-30:** 货物流动桌面页 now defaults to separate `明细` and `记录`
  views. Movement kinds, including `库存调整`, are filters rather than
  navigation destinations; operation records retain optional draft/cancelled
  status filters and exports include the complete filtered result.

- **2026-09-30:** All list browse filters share the compact 250px rail/mobile
  drawer interaction contract, including close-on-leave dropdown behavior and
  complete-result filter counts. Movement Item metadata follows permission-
  scoped ERPNext Item records rather than workspace snapshots.

- **2026-09-30:** Batch-summary detail popouts, stacked expiry choices, hidden
  `All Item Groups`, and responsive Expiry primary actions extend the compact
  Inventory/Expiry browsing contract.
- **2026-09-30:** Desktop primary navigation and filter sidebars scroll within
  the shell viewport; the `寺院物资` brand never receives navigation selection
  or hover tint.

- **2026-09-30:** The mobile v2 Inventory and Expiry mockups supersede the
  deferred mobile layout and mobile action FAB. The production mobile shell
  uses top-right overflow actions, server-scoped summaries, and quick expiry
  filters; Item and batch detail routes remain unchanged.
- **2026-09-29:** The finalized Inventory redesign story is the visual source of
  truth for the production desktop Inventory shell, browse chrome, summaries,
  filters, table/card switch, and inventory cards. This desktop-only adoption
  does not supersede the existing mobile layout; mobile redesign remains
  deferred.
- **2026-09-29:** The compact desktop Inventory/Expiry contract above supersedes
  the separate `全部物品` destination and any `需关注` expiry shortcut.
- **2026-09-28:** A report hub plus contextual export dialogs establishes the
  reporting entry points and fixed-column XLSX/CSV behavior.
- **2026-09-28:** The default `货物流动` overview and its independent action
  summaries supersede defaulting that destination directly to the Receive list.
- **2026-09-28:** The remembered, card-first Inventory view and complete
  filter-aware per-stock-UOM summaries supersede the table-only Inventory
  presentation and record-count-only list chrome.
- **2026-09-28:** Optional recorder/handler/reviewer text fields supersede all
  handwritten-signature, independent-witness, and re-confirmation rules.
- **2026-09-28:** Only warehouses beneath the configured physical root appear in
  the app; out-of-root Desk warehouses remain hidden.

- **2026-09-28:** Editable Item Codes supersede the server-only allocation rule.
  Preview-only automatic suggestions were chosen to avoid gaps from abandoned
  forms.
- **2026-09-28:** A visible, changeable UOM autocomplete initialized to `Nos`
  when available supersedes Receive-only defaulting. Submission must never
  replace the user's selected UOM behind the scenes.
- **2026-09-28:** A dedicated routed page supersedes the standalone
  drawer-over-empty-page item-creation layout; the transaction ItemPicker keeps
  its contextual drawer.

- **2026-10-12 preview refinement supersession:** The preview's five primary
  destinations are 首页、库存、货物流动、借用、报表. 工具 moves to the mobile
  header/desktop utility area and owns drafts, preferences, installation and
  account actions; existing 更多 hashes remain compatible. This supersedes the
  earlier preview five-entry proposal with 更多, without changing production.
  Sidebar leading icons and labels align independently of optional chevrons.
- **2026-10-12 preview browsing:** 按物品 / 按记录 supersedes 明细 / 记录 in the
  preview. Movement groups submitted lines by item with separate quantities for
  each movement type; Loans groups positive quantities by item and outcome.
  Groups disclose contributing records and batch/location lines. Record views
  show one operation/loan; Movement retains all location branches and explicitly
  distinguishes matching quantities from whole-operation quantities. Loans owns
  settlement actions; borrowing/return events stay in Movement with linked loans.
  Shared quick type shortcuts select one type, while advanced checkboxes combine
  types with OR semantics; both edit the same selection and show removable chips.
  This supersedes the preview's single-select-only movement tabs.
- **2026-10-12 preview dates:** The persistent date trigger opens an anchored
  desktop dialog or mobile sheet with presets and pending custom edits. Apply
  requires both dates in order and includes both endpoints; Cancel changes
  nothing. Loans labels this 借出日期 and shows current settlement balances, with
  a link to borrowing/return events during that range. View changes retain scope
  and mode-specific status/sort. Advanced hierarchy/item/activity filters and
  contextual exports share the full filtered projection.
- **2026-10-12 preview dashboard:** All six production sections are represented:
  inventory, distribution, expiry, movement, outstanding loans and reminders.
  Wide layouts stack the first three independently in the left column and the
  last three in the right; narrow layouts follow that same reading order.
  Warehouse/category scope applies globally; period applies only to movement.
  Drill-through preserves scope, while ordinary primary navigation resets it.
  Quantities stay separated by stock unit; distribution counts distinct item
  codes and expiry counts distinct item/batch pairs across locations. No inferred
  overdue-loan fields are added. Loading/refresh/empty/section retry examples
  remain preview-only controls.
- **2026-10-12 preview images:** Card images and item names open the same item
  detail surface. A separate always-visible 查看大图 button opens the lightbox;
  table/detail images open it directly. Missing images offer no enlargement.
  Selection remains independent; dialogs restore focus to the initiating control.
  This intentionally supersedes the inert-card-image rule in the preview only;
  production interaction and visual migration remain pending review.

- **2026-10-12 preview completion supersession:** Expiry browsing uses 全部 /
  已过期 / 未过期 / 无效期; expiry today is unexpired. Batch-only items with no
  date appear in 无效期. Explicit inclusive date windows and the six dashboard
  buckets remain; legacy soon hashes mean today through 30 days ahead. This
  supersedes the preview's default soon/valid-threshold categories. Inventory
  keeps cards/table and removes inert expiry tabs; Expiry uses tables/mobile rows.
- **2026-10-12 preview summary and export supersession:** Movement counts distinct
  records, item codes and categories across the complete filtered result, with
  quantities separated by movement type/unit and explicit draft/cancelled labels.
  Loans shows outstanding records/items and outcome quantities. Browse exports
  default to item/batch summaries or operation records for the active view, with
  a separate contributing-line option. CSV/XLSX selection never changes the
  selected dataset. This supersedes format-dependent preview summary/detail
  choices; production reporting rules remain unchanged.
- **2026-10-12 preview details supersession:** Item image/name opens the complete
  item page. Always-visible enlargement icons have accessible names/tooltips;
  table/group thumbnails enlarge independently from disclosure or selection.
  Item edit keeps code, unit and tracking read-only while editing metadata and
  simulated image attachments. Both warehouse groups and leaf locations have
  details and name editing. Transactions show all lines and lifecycle/context;
  loans show cumulative outcomes and linked settlement history. Batch details
  stay inline. Sidebar ownership follows the detail's domain and Back restores
  its origin's scope, view, selection and scroll. This supersedes preview item
  detail dialogs and partial record/detail proposals.
- **2026-10-12 preview forms supersession:** Common fields are compact and optional
  context may collapse; required locations, batches and operation inputs remain
  visible. Receive follows location → item → batch allocations with derived
  totals. Outbound movements use existing stock/batches; Transfer requires both
  locations; Loan requires a borrower; Return links outstanding stock and may
  split good/damaged/lost outcomes. Repair/Disposal use damaged quantities.
  Reconciliation shows book/actual/difference with a reason for differences.
  Repeated lines share availability/outstanding limits and integer-only units
  reject fractional quantities. This supersedes expandable required-row fields.
- **2026-10-12 preview creation supersession:** Only Receive offers transaction
  item creation; Inventory retains standalone creation. The contextual picker
  replaces its selection surface with the create form, and unit creation stays
  inline with name/integer-only fields. Creation returns to the same receiving
  allocations; cancelling/deleting the receipt retains created catalog items and
  units. Canonical and routed receiving share these controls. All new behavior
  remains a fixture-only proposal; production migration still awaits review.

- **2026-10-12 independent preview review:** Summary item counts describe the
  displayed outcome; mixed settlement records name every contributing type.
  Movement modes remember separate sort choices. Loan settlement allocations
  retain their originating line/location, and another partial settlement opens
  a fresh editable draft. Linked Damage/Loss forms retain Loan navigation ownership.
  Item edits can explicitly cancel with discard confirmation; metadata saves
  directly, while stock operations retain confirmation. Image ordering identifies
  the primary image. Receipt batch IDs may be generated, manufacturing dates are
  optional, and supported alternate-unit entry shows the stock-unit equivalent.
  Group replacement applies to every allocation. Detail states include loading,
  empty, retry and unavailable; missing records never substitute another record.
  These clarify the approved preview proposal, without changing production.

- **2026-10-13 supersession (UX-01–09):** ERPNext-native identity and editing
  replaces workspace ownership and read-only Desk drafts. Separate Loss replaces
  mixed return/loss submission and automatic multi-document splitting. Clean
  migration/reset preference replaces legacy compatibility as a design constraint.
  Nos and searchable selections replace blank units and long fixed selects.
  These are approved preview targets; production implementation remains pending.

- **2026-10-13 preview implementation clarification (UX-01/03/04/06/09):**
  Saved document snapshots survive editor remounts; external submission uses the
  saved version while retaining dirty input separately. Missing/deleted documents
  never substitute another record, and session recovery cannot unblock deletion.
  Incomplete stock drafts may save; explicit confirmation validates complete input.
  Count baseline refresh preserves actual counts, includes newly present full-scope
  rows and requires review; blank never means zero. Search covers the full local
  option set before pagination, with manual allocation for ambiguous scan locations.
  Local upload content and primary-image selection supersede filename-only image
  mocks. These examples remain preview-only; real concurrency, search and private
  files are backend prerequisites in the capability ledger.

- **2026-10-13 independent review clarification (UX-01/03/04/09):** A new count
  after completion is a new document, including when returning to a cached page.
  Desk-authored count details retain book/count quantities and reasons. Unknown
  barcode creation opens Receive's item editor with that barcode prefilled;
  removing a scanned allocation resumes scanning. Draft source/destination and
  category hierarchy filters must affect the same contributing line. Escape
  closes suggestions first, then the enclosing dialog on the next press.
- **2026-10-13 attachment completion rule (UX-06/09):** Uploading or failed
  attachments block transaction confirmation and final item saving, with inline
  recovery instructions. Transaction draft saving remains available; retry or
  remove the attachment before finalizing. Never make a failed upload immutable
  by completing its parent document.

### Preview browser-audit repairs — 2026-10-13

These repairs enforce existing preview contracts; they do not approve production migration.

- UX-04 count summaries label the complete selected baseline `账面合计`, reviewed
  actual totals `已核对实点合计`, and reviewed differences `本次调整差异`, separately
  by stock unit. Blank rows are counted as unreviewed and excluded from adjustment;
  no reviewed rows means `尚未核对`. Zero and 未找到 remain distinct inputs.
  Confirmation includes location, reviewed/unreviewed counts and all totals;
  submitted records retain the same truthful scope labels.
- Fixed mobile form summaries reserve measured space above bottom navigation and
  safe areas. Keyboard focus must remain visible above them, including after
  density/viewport changes. Dialog containment and restoration still apply.
- Browse Back restores the initiating route's actual scroll owner and nested table
  positions with its filters, view and selection. Browser Back/Forward use the same
  route restoration; primary/context destination navigation retains its reset rules.
  In the standalone preview the document currently owns vertical scrolling at both
  desktop and mobile widths; production scroll surfaces remain unchanged.
- Inventory's compact header repairs the existing 80px convention: one context-tab
  row above title/search/actions, with secondary tools in an accessible bounded
  disclosure. Compaction must keep focused secondary tools visible; expansion
  transfers focus from the removed disclosure trigger to its first tool. The
  reconciliation action retains focus when moving between header layouts.
  Dashboard and Inventory share the existing two-viewport return-to-top
  convention, targeting the actual scroll owner and focusing the heading.
- Narrow-phone item identity places name/code/description on a full-width text row
  below artwork. All affected mobile text actions meet the existing 44px minimum;
  desktop densities and independent image enlargement remain intact.
