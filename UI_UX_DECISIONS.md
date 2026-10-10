# Temple Inventory UI/UX Decisions

This is the authoritative, concise record of durable UI/UX decisions. Read it
before changing user-facing behavior. A current user instruction may supersede
an older rule, but the conflict must be identified explicitly and recorded here
in the same change. Keep implementation details in code or task notes, not here.

## Accessibility and responsive behavior

- The volunteer UI is Chinese and mobile-first, with touch-sized controls,
  associated labels, keyboard access, visible focus, and announced errors and
  status changes.
- Manual entry must remain available when camera or browser APIs are unavailable.
- Preserve user-entered data when validation, scanning, upload, or submission
  fails.

## Navigation and layout

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

- **2026-10-10:** 借用 now uses separate 明细 (`/loans/items`) and 记录
  (`/loans/records`) browse destinations, matching 货物流动. Both default to
  全部 status; 未结 and 已结清 are filters. 明细 is one row per loan item line,
  while 记录 is one row per complete loan document. The persistent quantity
  summary row is removed; column totals remain available on demand.

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
