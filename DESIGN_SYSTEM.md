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

## Density, tables and scrollbars

- Desktop compact/balanced/spacious controls are 32/36/44px high, gaps are
  8/12/16px, and table cell padding is 5×8, 12×12, and 18×16px (block × inline).
  Thumbnail slots are 32/48/64px. Text size and line height follow independent
  user text scaling. Mobile controls preserve 44px targets at every density.
- `DataTable` headers, sort buttons, rows, group cells and metrics use the same
  explicit column alignment. Text, dates, IDs and status are left aligned;
  quantities are right aligned with tabular numerals; selection and image
  controls are centered. Use subtle horizontal separators, never full vertical
  grid lines. Group metrics align with visible columns or carry clear labels.
- Sortable headings always show a neutral bidirectional icon when inactive and
  a directional arrow when active. Reserve a stable icon gutter, set `aria-sort`
  and keep keyboard focus visible. Column settings stay available during
  loading and empty states.
- Dense tables scroll horizontally within their own container. Use themed slim
  draggable scrollbars for overflowing desktop filter areas only. Native touch
  and coarse-pointer scrolling, plus forced-colors scrollbars, remain unchanged.
  Do not globally hide scrollbars.
- Group disclosure supports keyboard and pointer activation across the row,
  reports `aria-expanded`, and leaves embedded links/buttons/inputs independent.
  Keep nested histories under the shared parent table header. Pagination counts
  refer to the immediate rows only.

## Browse and hierarchy geometry

- Keep search, applied chips, scan and filter in one focus-within toolbar. Keep
  the input mounted when density/layout changes. Filter surfaces are anchored
  below their trigger, bounded by the remaining viewport and internally
  scrollable; phone sheets use the shared focus-managed overlay.
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
  Compact/balanced/spacious preferred widths are 160/225/300px with 8/16/24px
  gaps. Available width and text scale determine the rendered column count.
- Stock-card artwork fills the card width in a square 1:1 reserved area using
  contain fit. Density adjusts the card geometry; DataTable image slots remain
  compact and fixed.
- Dashboard scope controls sit with the page header on desktop and wrap on
  narrow surfaces. Quick actions sit directly below the header.

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
- `QuantitySummary` uses text-relative minimum tracks and keeps units/statuses
  separate. History links and metadata wrap or scroll inside their own surface.
- Fixed bounds are reserved for overlays, internal scrolling, artwork/icons,
  touch targets, page widths and measured shell obstructions. They express
  geometry, not typography.

## Operation picker and workspace geometry

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

## Verification contract

Before visual browser inspection, run the browser command through
`scripts/ui-visual-preflight` (see [AGENTS.md](AGENTS.md)). Inspect the routed
production app with realistic Chinese text, long names, 1024px boundary,
desktop/phone surfaces, all densities and enlarged text. Focus checks on
alignment, skeleton/refresh retention, image placeholders, scroll containment,
keyboard access and overlapping touch targets. Fixture-based browser results
are client evidence; live-service/device evidence must be named separately.
Source review or automated tests alone do not establish visual acceptance.
