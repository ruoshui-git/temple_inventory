# Temple Inventory Design System

This file defines the current reusable visual contracts. Durable product
behavior is in [UI_UX_DECISIONS.md](UI_UX_DECISIONS.md); agent and architecture
rules are in [AGENTS.md](AGENTS.md). Historical preview and migration detail is
kept in Git.

## Foundation and ownership

- `frontend/src/styles/app.css` is the sole active stylesheet entry. It imports
  `foundation.css`, `forms.css`, `utilities.css`, `browse.css` and
  `data-table.css`.
- The shared `--p-*` tokens own theme palette, status, spacing, density, type,
  shape, shadows, scrims and layers. Jade, bronze and blue are selected with
  `data-ti-theme`. Components consume semantic tokens; artwork, user images,
  camera content and preview swatches retain intended colors.
- `AppFrame` owns navigation and measured mobile obstruction. `ApplicationShell`
  supplies route/account context and registry breadcrumbs. The shared surface
  breakpoint is 1024px. `components/ui` contains reusable controls, overlays,
  filters and tables; feature controllers own data and permissions.
- Keep typography independent of density. Root text scale applies to normal and
  teleported content. Use semantic HTML, explicit labels, visible keyboard
  focus, reduced motion and 44px mobile/coarse-pointer targets.

## Mobile browse geometry

- Below 1024px, browse titles use the `--p-mobile-heading` token (22px at the
  default text scale). The initial header places title, optional view switch and
  overflow on the first row, then a search field with scan and counted filter
  control. Once scrolled, the title/action rows collapse and only search/filter
  remains sticky at the top. The Stock subpage tab strip scrolls away with the
  page and uses 44px targets; it is not part of sticky height.
- On phones, applied chips occupy one horizontal touch-scroll line below search,
  with 32px chip height and accessible remove controls. Do not suppress
  scrollbars globally.
- Mobile create FABs sit 12px above the measured `--preview-nav-height` and
  include a minimum 48px primary face plus a 44px chevron segment. Return to Top
  uses the same obstruction measurement, with its bottom at nav + 68px, leaving
  an 8px gap above the 48px FAB. The FAB uses accent/on-accent tokens and hides
  while an overlay or keyboard is open. Its kind menu and sort menu use a
  viewport-width bottom sheet with safe-area padding.
- Results summary lines wrap to at most two compact rows at phone widths. Sort,
  Stock card/list and analysis controls sit alongside the count and quantity
  preview. Stock's desktop summary carries card/list and analysis controls so
  they do not create a second browse-header row.
- The Stock subpage nav uses a full-width underline strip with a 3px accent
  underline, strong active ink and horizontal scrolling when enlarged text no
  longer fits. It scrolls away rather than increasing the sticky stack.

## Icons

- Movement kinds use the single `frontend/src/lib/kindIcons.ts` map for their
  canonical label and icon. Reuse that map in menus, filters, rows, records,
  notifications, drafts, editor headings and More tiles.
- Every registry path has a distinct glyph. Declare an intentional alias by
  pointing its name to the canonical key.
- Use `outside` (door-open) for the 外部 endpoint, `export` (file-down) for
  导出 actions and `report` (chart-column) for the 报表 destination. Reserve
  `download` for actual file downloads.

## Creation editors

- `Attachments` is the shared file-picker control for editors and new Items.
  Use a localized button or label to open a visually hidden native input, then
  show chosen files as a list. The Item main-image role includes a square
  preview with placeholder artwork before a file is chosen. Use an image icon
  for main-image and image-attachment controls and a paperclip for general
  attachments. Never expose the browser's native English file input label.
- An empty movement editor shows one centered, kind-specific hint and its
  add/scan actions. Hide line search, completion filters, totals, issue
  navigation and column headings until at least one line exists. Location
  selectors required to begin the operation may remain visible.
- High-volume Return selection uses collapsed borrower summaries and paged loan
  cards in a bounded internal scroll region; selected loans remain visible as
  removable chips when the list is collapsed.

## Disclosure

- Use `DisclosureIcon` for disclosure indicators: inline disclosures show one
  leading 2.25-stroke chevron-right that rotates in place; popup triggers show a
  static trailing chevron-down. Keep the icon in a fixed square with a centered
  transform origin and disable its transition for reduced motion.
- Use `.ti-disclosure` for simple native `<details>` summaries that need the
  compact inline treatment. Use `DisclosureSection` for divided detail rows;
  actions do not toggle the row, and the body aligns with the title start.
- A `DisclosureSection` summary has a leading rotating chevron, a 16px/600
  title, an optional count pill, an optional muted one-line summary and an
  optional trailing actions slot. The body starts at the title's inline edge.
  Keep the summary hover tint inside a small control-radius row inset.
- Consecutive sections in one card form a single divided list: use one hairline
  between rows, with no extra row borders or gaps. When other content separates
  sections, give each section normal block spacing. Keep related detail rows on
  the same card inset.
- Put buttons, links or other controls in the `actions` slot when they belong
  to the section heading. Only blank space in that slot is prevented from
  toggling the section; interactive controls retain their native behavior.

## Popup menus

- Use `PopupMenu` for action menus. Its trigger is a labeled button, and the
  popup is fixed to the trigger, teleported into the active Overlay when one is
  open, and layered at `--p-z-menu`. Align to the start or end, keep an 8px
  viewport margin, open 4px below, and flip above when that side has more room.
  Bound the height to the available viewport space and scroll inside the menu.
- Menus close on outside pointerdown, Escape, route change, item activation,
  or when their anchor leaves the viewport. Escape returns focus to the trigger.
  Only one transient menu or filter panel may be open at a time.
- Menu items support ArrowUp/ArrowDown and Home/End; opening by keyboard puts
  focus on the first item. Respect reduced motion and keep coarse-pointer targets
  at least 44px high.
- Use the shared layer scale: sticky table content `--p-z-sticky-content` (10),
  sticky page chrome `--p-z-sticky` (20), app navigation `--p-z-nav` (30),
  menus and popovers `--p-z-menu` (40), overlays/sheets `--p-z-overlay` (50),
  and toasts `--p-z-toast` (60). Header navigation and its popovers stay above
  sticky page chrome; popovers opened by chrome or forms stay above the FAB.
- Popup menu rows use a compact anatomy: optional 18px leading icon, left
  aligned label and optional trailing metadata. When a panel uses icons, every
  row has one. Rows share hover, focus and danger states without dividers; panel
  width follows content within viewport bounds. Draft navigation remains a
  link rendered with the same row anatomy.
- Icon-only buttons have zero inline padding and grid centering. Their glyph
  center must align with the control center within 0.5px.

## Density, tables and scrollbars

- Desktop compact/balanced/spacious controls are 32/36/44px high, gaps are
  8/12/16px, and table cell padding is 5×8, 8×12, and 18×16px (block × inline).
  Thumbnail slots are 32/48/64px. Text size and line height follow independent
  user text scaling. Mobile controls preserve 44px targets at every density.
- `DataTable` headers, sort buttons, rows, group cells and metrics use the same
  explicit column alignment. Text, dates, IDs and status are left aligned;
  quantities are right aligned with tabular numerals; selection and image
  controls are centered. Group identity leads with its thumbnail, expander,
  name and count; metrics stay in their matching visible columns, with only
  hidden metrics summarized after the identity. Use subtle horizontal
  separators, never full vertical grid lines.
- Table action columns may stay pinned beside column settings when a page needs
  its actions visible while the result scrolls horizontally. Keep the pinned
  column opaque and within the table frame.
- Sortable headings always show a neutral bidirectional icon when inactive and
  a directional arrow when active. Reserve a stable icon gutter, set `aria-sort`
  and keep keyboard focus visible. Column settings stay available during
  loading and empty states.
- When a sortable table is visible, its headers are the only sort affordance.
  Use `SortControl` for cards or surfaces without sortable headers.
- Dense tables scroll horizontally within their own container. Use themed slim
  draggable scrollbars for overflowing desktop filter areas only. Native touch
  and coarse-pointer scrolling, plus forced-colors scrollbars, remain unchanged.
  Do not globally hide scrollbars.
- On narrow tables, keep visible quantity columns pinned beside the settings
  control. Summarize a metric after the group identity only while its metric
  column is hidden. Repeated context shared by every result belongs once in the
  page callout, not as a narrow table column.
- Group disclosure supports keyboard and pointer activation across the row,
  reports `aria-expanded`, and leaves embedded links/buttons/inputs independent.
  Keep nested histories under the shared parent table header. Pagination counts
  refer to the immediate rows only.

## Browse and hierarchy geometry

- Keep search, applied chips, scan and filter in one focus-within toolbar. Keep
  the input mounted when density/layout changes. Filter surfaces are anchored
  below their trigger, bounded by the remaining viewport and internally
  scrollable; phone sheets use the shared focus-managed overlay.
- Activity detail, drafts and Reports use this browse toolbar. Route query
  payloads omit default values and include only changed fields; decoding merges
  changed top-level and nested scope values onto the dataset defaults.
- Desktop filter dialogs may use two labeled columns for filters and grouping;
  phone sheets stack them. Header/footer remain outside scrolling content.
  Show a hierarchy node's `local_label` in primary ink and put its `full_label`
  in the title. Warehouse nodes use the presenter's `search_text` for matching;
  direct-storage leaves stay in the selection model but are hidden as rows.
  Chips use the canonical `label`; full paths belong in tooltips or selector
  detail. Expansion controls retain their own touch target. Clearing selections
  or search preserves tree expansion.
- Hierarchy indentation is 10px per level, capped at 40px. Desktop expander
  tracks are 28px with 16px checkboxes, 4px gaps and 32px minimum rows. Phone
  rows and expanders remain 44px. Keep readable name tracks and allow actions
  to wrap below identity rather than forcing tall single-character columns.
- Card geometry uses `--p-card-min-width`, `--p-card-gap` and `--p-card-pad`.
  Compact/balanced/spacious preferred widths are 160/200/280px with 8/16/24px
  gaps. Available width and text scale determine the rendered desktop column
  count.
- Below 1024px, Stock defaults to list rows with a 64px square contain thumbnail,
  a two-line name, one muted code/category line and right-aligned quantities.
  Rows are at least 72px high; the checkbox, row activation and image lightbox
  have independent targets. Stock cards use two equal columns with a 10px gap,
  square contain images, a two-line name and one quantity line. Desktop cards
  retain square contain artwork and density-driven sizing; DataTable image slots
  remain compact and fixed.
- Mobile Movement and Loan Item groups use a list row with a 56px thumbnail,
  Item name, `明细条数 N` and up to two quantity summaries plus `+N`. The expand
  control remains available and nested history keeps its existing behavior.
- Dashboard scope controls sit with the page header on desktop and wrap on
  narrow surfaces. Quick actions sit directly below the header.

### Desktop browse density and header

- At `(min-width: 1024px) and (pointer: fine)`, page gutters, header spacing,
  card padding, editor padding and gaps use the density-specific `--p-*`
  tokens. Balanced browse table rows target 40–44px with 32px artwork. Coarse
  pointers and phones keep 44px targets and their normal page gutters.
- Browse headers keep the title, view tabs, search/chips, scan, filter count,
  sidebar icon and page actions visible. The toolbar never collapses and has no
  收起工具 control. At narrow desktop widths, controls wrap without horizontal
  page overflow. `/` focuses the mounted page search unless focus is in an
  editable field. Escape retains each editor's existing clear/close behavior.
- Create actions use a split button: the main face starts the page's default
  operation; its menu lists other permitted kinds. Export, drafts and secondary
  actions use the `⋯` overflow menu. Icon-only controls have an accessible name
  and a visible tooltip.
- The count and quantity preview share one line above results. Show up to two
  unit values inline; represent more as `+N 单位` and put the complete shared
  `QuantitySummary` inside the disclosure.
- The browse header sticks below the measured app bar. Show its hairline/shadow
  only while stuck. Table headings stick inside the table's own scrollport.
- A visible hierarchy sidebar is one flat panel aligned with the result top.
  Its section dividers are hairlines; the rail owns the only vertical scroll.
  Desktop fine-pointer hierarchy rows are 28–32px and remove nested bordered
  boxes. Phone tree semantics and touch targets remain unchanged.
- Desktop table row actions appear on row hover or keyboard focus without
  changing row height; touch surfaces retain visible actions. Wide-screen
  defaults may add secondary columns at 1440px, with column preferences for
  narrower viewports.
- **2026-10-24 supersession:** hierarchy filter rails always sit outside the
  white result card and align with its top edge. Damaged row actions use quiet
  Repair and danger-tone text Disposal buttons; details and export stay in the
  row overflow menu. Warehouses uses `BrowseToolbar`, with its node count in the
  subtitle and secondary refresh/export actions in overflow. PWA update notices
  use a persistent, dismissible `ToastHost` toast with an 更新 action; dismissal
  lasts for the session and a newer worker version can show a new notice.
- Off switches use `--p-switch-off` (or its semantic fallback) for the track;
  it must contrast at least 3:1 against the surface. A visible thumb remains
  distinct from the track in both states.
- More tiles use a compact icon-left layout at 64–72px on desktop. Editors use
  the shared desktop card padding tokens and avoid reserved blank space below
  their final section.

## Images and identity

- `AsyncImage` reserves the requested square thumbnail slot with contain fit.
  Its loading, missing and error placeholders must fit that slot without
  minimum dimensions or extra row padding. Use one scalable SVG placeholder at
  every size; center compact artwork and preserve the Item's accessible name.
  Long fallback labels wrap only when the slot can support them.
- Table/detail movement thumbnails use 24px artwork when space permits and
  share the Item lightbox. Keep enlargement hit areas distinct and nonoverlap;
  do not increase row height. Existing editor/picker artwork remains larger.
- Current readable Item names and images are display metadata for native lines.
  Keep native Item codes and stored names for audit history; if the Item is no
  longer readable, fall back to its stored name and then code. Images must come
  through permission-filtered Item and File access, never a raw native image URL.
- `Item.image` is the only primary-image identity. Other private Item Files are
  attachments, including images; attachment previews use the shared lightbox
  but never become the main image automatically. The crop overlay uses
  Cropper.js with a square draggable selection and keyboard movement. Exported
  thumbnail WebP is quality 0.85, capped at 800px, and never upscaled. Keep
  original-as-main and original-as-attachment choices available; attachments
  preserve source bytes.

## Async presentation

- `AsyncRegion` and `SkeletonBlock` are the only data-loading presentation mechanism. Use `DataTable` for table results; `DocumentLoadingState` remains the editor-specific skeleton.
- Initial requests use shape-matched skeletons. A refresh retains the last
  successful snapshot, layout, scroll and selection; dim only the affected
  result region and show one compact accessible status. Headings and controls
  remain usable. Disable stale-result actions only.
- Refresh errors retain stale results and show retry. Load-more uses a local
  indicator. Initial errors and successful empty results stay distinct; never
  show false zeros or empties before the first successful response.
- Card requests affect that card. Page refresh affects each result region.
  Retain generation/account abort guards. While a grouped query changes, bind
  the prior display to its prior query until new rows arrive. Do not change
  mutation save/conflict semantics.
- Every pending action shows its state on the triggering control with a concise
  action-specific label; keep sibling actions disabled. Option lists that are
  still loading show shape-matched skeleton rows. Route changes show a thin
  delayed progress bar so fast navigations do not flash.
- Related export projections are cached separately from base projections so
  toggling supplementary sheets can reuse the matching result.

## Multi-unit quantities

- Render multi-unit dashboard and browse values with the shared quantity
  presentation. Keep each value and unit together, align values consistently,
  and separate units with spacing and a subtle divider rather than text glyphs.

## Draft labels

- `草稿单据` and `浏览器暂存` use compact pill tags with their document and
  device icons. Keep both labels readable without color; the icon and text carry
  the distinction. On the combined drafts page, summaries, relative timestamps
  and row actions remain visible at phone widths. Full recovery detail stays
  inside the browser row's disclosure.
- A pristine new movement or count form has no status chip or record tag. Once
  edited, show one plain status; a saved document name is secondary text.

## Overlays, reports and fixed geometry

- `Overlay` owns focus containment, background inertness, Escape, scroll lock
  and focus return. Descendant dialogs become internal stages of that surface.
  Adaptive creation uses a bounded desktop dialog and full mobile sheet.
  ItemPicker uses a wide bounded desktop dialog and full-height mobile sheet;
  keep its header/search and footer fixed while category/warehouse rails,
  results, scan stage and item-creation stage use internal scroll surfaces. Its
  browse toolbar is static inside the dialog, outside the result scrollport.
- `ReportTable` distinguishes initial loading/error, successful empty and
  retained refresh. Dense content stays in an internal scrollport; Load more
  follows 30 rows for full reports. Quick Report previews are explicitly
  bounded to five rows. Exports are never truncated by preview limits.
- A quantity omits its suffix only when the matching unit column is visible.
  `entered_qty` follows `entered_uom`; stock quantities follow `stock_uom`.
  Mixed-unit group summaries use the unit attached to each quantity entry.
- Grouped browse tables keep the same `width: 100%` sizing as flat tables.
  Quantity summaries show the two largest values and then `+N 项`; the cell
  title and accessible name retain the complete breakdown. Cap wide quantity
  columns at 16rem and allow their contents to wrap.
- Horizontally overflowing tables measure both edges and expose paired 80%-page
  scroll hints with accessible left/right names. Keep hints clear of pinned
  columns and track the visible table area. Edge shades are clipped to the
  rounded frame and stop before pinned end columns. On fine-pointer desktop, a
  viewport-bottom proxy scrollbar appears only while the table's native bar is
  below the viewport; it stays synchronized with the table. Hide cues in print
  and honor reduced motion. Vertical wheel input continues to scroll the page.
- `QuantitySummary` uses text-relative minimum tracks and keeps units/statuses
  separate. History links and metadata wrap or scroll inside their own surface.
- Fixed bounds are reserved for overlays, internal scrolling, artwork/icons,
  touch targets, page widths and measured shell obstructions. They express
  geometry, not typography.

## Operation picker and workspace geometry

- Browse filter rails use a 28px collapsed edge column with a 12px visual rail,
  at least a 24px hit area, a one-pixel divider, chevron and vertical `筛选`
  label. An accent dot marks active hierarchy filters. The open rail owns its
  collapse control at the heading; expanding and collapsing moves focus to the
  newly visible control. The desktop preference remains page-scoped.

- The operation picker keeps search, scan, filter chips and persistent actions
  in its header; results scroll independently and the selection/create footer
  remains fixed. Desktop category and warehouse rails use shared BrowseFilters.
- Scanner lookups drain in FIFO order. Successful decoded frames report barcode
  presence; errors never count as empty frames. Re-arm a held barcode after
  500ms of successful empty frames. Repeated manual Enter stays deliberate.
- Scan feedback, ambiguity resolution and undo stay visible in the picker scan
  stage. Each accepted scan adds one stock unit and brings the changed row and
  group forward through presentation ordering only. Native child order and row
  identities remain stable; closing the stage cancels scans still in flight.
- Desktop preview collapse uses a 12px edge rail with a 24px hit area, divider,
  chevron and vertical `确认前检查` label when collapsed. The collapsed grid
  column and panel are both 28px. The full-workspace icon sits in the right side
  of the `操作物资` heading row, including display mode; exiting restores the
  previous preview state and focus returns to the rail. Mobile has no rail and
  uses the normal disclosure flow.
- Picker results use DataTable with flattened Item/warehouse row identity;
  canonical warehouse label, full-path tooltip, stock quantity and row selection
  stay in the same compact row for outbound, damaged and count. Inbound shows
  only the category rail and omits the warehouse column; its quantity heading
  is the receiving location label plus `现有`. Newly created selection preview
  stays above filtered results. The receive target selector is a compact inline
  control in the lines toolbar and lists storable physical leaves.
- ToastHost teleports token-styled messages and exposes polite feedback while
  remaining available above the active focus-managed overlay. Success feedback
  uses the normal surface; save/server failures use the danger background and
  border while retaining their inline error detail.

## Notifications and install cards

- `NotificationCenter` owns the bell, count badge, running-export ring and
  responsive inbox surface. Keep the bell target at least 44px, cap visible
  count text at `99+`, and include `通知，N 条未读` in its accessible name.
- The desktop panel is a bounded popover with focus containment and Escape and
  outside-pointer dismissal. Phone presentation uses the shared `Overlay` as a
  full-height sheet. Inbox rows use a 30px kind icon, stronger subject weight
  and a colored dot while unread, then relative time and any export action.
- Notification loading uses shape-matched skeletons before the first result;
  empty state appears only after a successful response. Keep grouping headings
  (`今天`, `更早`) and load-more feedback local to the inbox surface.
- More-grid actions share the `.more-card.surface` grid structure, icon tile,
  padding and minimum height. Interactive cards use a native button element so
  button internals do not change card alignment.

## Verification contract

Before visual browser inspection, run the browser command through
`scripts/ui-visual-preflight` (see [AGENTS.md](AGENTS.md)). Inspect the routed
production app with realistic Chinese text, long names, 1024px boundary,
desktop/phone surfaces, all densities and enlarged text. Focus checks on
alignment, skeleton/refresh retention, image placeholders, scroll containment,
keyboard access and overlapping touch targets. Fixture-based browser results
are client evidence; live-service/device evidence must be named separately.
Source review or automated tests alone do not establish visual acceptance.

## Data clarity components

- `RecordRef` is the shared cross-document chip. It combines a kind icon, an
  explicit kind name in its accessible label, readable identity or a kind-aware
  count, optional status and secondary document name. It emits `open` and stays
  generic enough for records, notifications and recovery links.
- `LocationEndpoint` presents a movement source or destination. Physical
  locations use their canonical label in primary ink and the full path as the
  tooltip. Leased and damaged system leaves are detected from the settings
  pointers, then shown with their dedicated icon and muted/warning label. Empty
  endpoints use the outward icon and `外部`, with kind-specific tooltip text.
  Exports retain native raw values.
- `ItemLine` pairs the compact shared `ItemImage` and lightbox with the Item
  name. A secondary slot carries one related identity, such as code or batch.
  Use it wherever an Item is presented without artwork.
- Use `.ti-fields` definition lists when a compact summary combines different
  kinds of values. Keep `·` for lists of the same kind, including quantities
  with their units.
