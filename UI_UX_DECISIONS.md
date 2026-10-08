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
  asynchronous or durable.

## Shared compact filters

- Inventory, Expiry, 货物流动, 借用, 待处理, 草稿, and list-level browse pages
  use the same compact filter sections and hierarchy styling. Desktop filters
  occupy a 250px rail; mobile filters use one focus-safe drawer with an enabled
  count and immediate application, plus 清空/完成 actions. Reports keep filters inline, and 仓库 retains a
  search field rather than a filter sidebar.
- Hierarchy and async single-select controls close on outside pointer, Escape,
  Tab/focus leaving, and component unmount. Selection is committed before blur
  can close a suggestion list.

## Movement browsing

- Compact movement headers keep the selected period controls and resolved date
  range visible while title/count condense after result scrolling. The rolling
  period menu is body-teleported and anchored to its trigger so shell overflow
  cannot clip it.
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
