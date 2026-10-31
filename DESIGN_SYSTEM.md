# Design system

This document owns tokens, geometry and shared visual contracts. [UI_UX_DECISIONS.md](UI_UX_DECISIONS.md) owns behavior and interaction; [AGENTS.md](AGENTS.md) owns architecture and workflow. Keep only reusable current-state rules here.

## Foundations

- Shared semantic `--p-*` tokens own palette, status, spacing, density, type, shape, shadows, scrims and layer scale. Themes use `data-ti-theme`; artwork, photos, camera content and theme swatches retain their intended colors. Every `var(--p-*)` used must be defined in `foundation.css`; reuse an existing token (ink, small, soft, control radius, menu shadow/layer) rather than adding a synonym.
- Jade, bronze and blue are the app palettes. Non-production environment badge colors are sample amber `#8a4b08`, staging violet `#593d8c`, development blue `#245b9e`, all with white text. Production uses jade `#28684e` chrome and no badge.
- AppFrame owns navigation and measured mobile obstruction. ApplicationShell supplies route/account context and registry breadcrumbs. Shared breakpoint is 1024px; coordinators mount one surface at a time.
- Text scale is independent of density, including teleported content. Use semantic HTML, explicit labels, visible focus, reduced motion and 44px mobile/coarse-pointer targets.
- Layer order: sticky table content 10, sticky page chrome 20, FAB 25, app navigation 30, menus/popovers 40, overlays 50, toasts 60. Menus from header/form chrome stay above sticky content and FAB.

## Shared component catalogue

- **UnitValues:** the one display for mixed-unit quantities in tables, group rows, the counts list and dashboard records: up to two unit values on one line (unit display labels, `+`/`−` when signed, existing tone classes), then a `+N 单位` DetailPopover listing every unit. The full text is the group's accessible label and title; the disclosure never triggers a surrounding link.
- **DataTable:** declare semantic column kinds (`number`, `unit`, `code`, `date`, `datetime`, `status`, `chip`, `text`, `thumb`, `actions`, `primary`). Under auto table layout, cell `max-width` is ignored: cap inner text with `width: max-content; max-width`. A long nowrap group label can widen its column; constrain its container with `width: 0; min-width: 100%`. One primary column absorbs spare width and clamps names to two lines; group identity uses a single-line ellipsized name with thumbnail/disclosure/count and aligned metrics. A group row is one row per label (never split by unit); its identity cell spans the leading visible columns up to the first column holding a group summary, so hiding or reordering columns never clips the chevron or label. Mixed-unit values in record and group cells show at most two units on one line plus a `+N 单位` disclosure; negatives use `−`. Keep optional detail rows explicit. Sort headers expose stable icon gutter and `aria-sort`; visible table headers are the sole sort control. Settings/edge cues stay in result summary/outlet. Group disclosure and desktop roving focus remain keyboard-operable; pinned columns stay opaque. Phone overflow uses edge fades, desktop scroll hints/proxy scrollbar; do not globally hide scrollbars.
- **DataTable columns:** browse columns live in feature `*Columns.ts` modules and declare `export` fields. `pinned: "start"` pins a table's identity column (with the selection checkbox; a leading image scrolls away) only while the table overflows horizontally; on phones the pinned group unpins above 45% of the table width. `hint` adds a compact 14px info glyph after the label (its enlarged hit area does not widen the header or trigger sort) for explanations; unit qualifiers stay in labels. Sort indicators are SVG icons, never text arrows (iOS renders ↕ as an emoji tile). `quantity` cells use bold tabular numerals; headers stay regular. Group label cells span every column through the label column.
- **Overlay / ConfirmDialog / ToastHost:** Overlay owns focus containment/return, inert background, Escape, scroll lock, system Back and stacking. Use bounded desktop dialog and phone sheet. ConfirmDialog is one AppFrame host above overlays. ToastHost is one body-level stack below desktop header/phone top bar and above overlays.
- **PopupMenu / Disclosure:** PopupMenu anchors/flips/clamps to viewport, scrolls internally and closes on outside pointer, Escape, route change, activation or lost anchor. Phone presentation is an Overlay sheet. Row and editor action menus use PopupMenu, never `<details>`; omit the trigger when no item would render; style panels through `panelClass`. FilterPanel and PeriodFilter popovers take part in the same nesting. A popup anchored inside an open popup nests: descendants count as inside, Escape closes the innermost first, and choosing a nested option closes its parent menu. Otherwise one transient menu/filter panel at a time. Menu keyboard supports arrows and Home/End. Disclosure uses one leading rotating chevron; popup triggers use a static trailing chevron. Use DisclosureSection for divided detail rows.
- **FormField / useFormValidation:** FormField owns label, required mark, hint and inline error; pass ids and ARIA state to controls. useFormValidation clears edited errors and focuses the first invalid control. Forms use inline field errors and danger callouts for server failures.
- **BrowseToolbar / FilterPanel / SortControl:** Search, chips, scan and filter share a mounted toolbar. Its `#selection` slot holds the `.stock-selection-actions` bar driven by `useBrowseSelection`; phone page actions move into the search bar while the header is stuck. Filters are viewport-bounded with internal scroll; phone sheets stack fields and keep header/footer fixed. Hierarchy rails remain outside the result card and align with its top. Use SortControl only without sortable table headers.
- **AsyncRegion / skeletons:** AsyncRegion and SkeletonBlock own data-load states; DataTable provides table skeletons and DocumentLoadingState is editor-specific. Match skeleton shape, retain/dim stale results during refresh and keep errors distinct from successful empty results.
- **ItemImage / ItemLine:** ItemImage reserves stable dimensions and uses shared missing/error SVG artwork. ItemLine pairs image/lightbox and Item name, with one secondary related identity.
- **LocationEndpoint / QuantitySummary / UnitText:** Use semantic endpoint treatments for physical, leased/damaged and outside locations. QuantitySummary keeps unit/status categories distinct and complete breakdown in accessible text. UnitText is the standalone unit presentation; keep quantity and unit together.
- **Attachments:** shared file picker uses a localized button/label, hidden native input and chosen-file list. Main-image controls use image icons; general attachments use paperclip. Never show native English file-input text.
- **Scanner dialog:** small dialog, square preview, camera controls, manual entry and image recognition in one column. ItemPicker retains its inline scan stage.
- **NotificationCenter:** bell target at least 44px, count capped at `99+`, accessible name includes unread count. Desktop bounded popover; phone full-height sheet. Rows use kind icon, emphasized subject, unread dot, relative time and export action.

## Geometry

### Density and desktop browse

- Compact/balanced/spacious controls are 32/36/44px; gaps 8/12/16px; table cell padding 5×8, 8×12, 18×16px (block×inline); thumbnail slots 32/48/64px. Text size and line height scale independently. Mobile targets remain 44px at every density.
- Fine-pointer desktop browse rows target 40–44px at balanced density with 32px artwork. Desktop page/card/editor spacing uses density tokens. Card preferred widths are 160/200/280px and gaps 8/16/24px.
- Browse header keeps title, tabs, search/chips, scan, filter count and actions visible; it wraps at narrow desktop widths. It sticks under measured app bar; hairline/shadow appears only while stuck. Table headings stick in their own scrollport. Summary count/quantity and controls share a compact line; full analysis expands below.
- Open hierarchy rail owns its collapse control; collapsed browse filter edge is 28px wide with a divider, chevron, vertical label and active dot. It sits outside the result card. ItemPicker reserves a 40px collapsed grid track for that edge. The operation review panel is a separate 28px column with a 12px visual control; do not conflate the two.
- Desktop hierarchy indentation is 10px per level capped at 40px; fine-pointer rows 28–32px. Keep name tracks readable and allow actions to wrap below identity. DataTable uses subtle horizontal separators, no full vertical grid lines.

### Phone browse and actions

- Phone browse title uses the 22px mobile-heading token; initial title/action row sits above search/filter. After scroll only search/filter remains sticky. Stock subpage tabs scroll away. Applied chips share one horizontal touch-scroll line, 32px high.
- Stock defaults to list: 64px square contain thumbnail, two-line name, muted code/category and right-aligned quantities; minimum row height 72px. Card view has two columns, square contain images, two-line name and quantity. Movement/Loan item groups use 56px thumbnails and compact quantity summaries. A phone item-group heading is the thumbnail (its own lightbox button) followed by one ≥44px toggle holding the chevron, the full-width name and a muted count/summary line; 查看物品 opens the item from inside the expanded group.
- Desktop expiry overview rows remain single-line; compact DataTable thumbnails do not grow row height.
- Result summaries wrap to at most two compact rows. Create FAB sits 12px above measured navigation, primary face at least 48px and separate 44px menu segment. Return-to-top sits above it with an 8px gap. Hide FAB while overlays/keyboard are open. Phone sort and kind menus are opaque Overlay sheets with scrim, handle, title, full-width cancel and safe-area padding.
- Phone list/detail gutter is 16px; avoid nested double padding. Sticky editor action bar occupies one row; keyboard visibility keeps focused controls clear and hides sticky actions while typing. Landscape phones use compact browse chrome and safe-area padding.

### Cards, picker, workspace and scanner

- More tiles are compact icon-left rows, 64–72px high. Editors use shared card padding and no reserved blank area under the last section. Phone dashboard quick actions sit directly below the header.
- ItemPicker uses a wide bounded desktop dialog and full-height phone sheet. Header/search and footer stay fixed; category/warehouse rails, results and scan/create stages scroll internally. Its toolbar stays outside result scrollport. Desktop Rails use shared BrowseFilters.
- Operation editor shares one grid between section column headings and line rows. Receive target stays compact in lines toolbar. Full-workspace toggle stays in 操作物资 heading row. Review panel collapse is independent from picker rail; restore prior state/focus on exit.
- Scanner video is a centered square cover viewport capped at `min(100%, 42dvh, 420px)`. Scanner control sizes and touch targets follow shared tokens.
- On desktop DataTable overflow, paired 80%-page hints track the visible scrollport and stay clear of pinned columns; a viewport-bottom proxy scrollbar appears only when the native bar is below viewport. On phones, in-frame fades show overflow; wide pinned groups unpin and settings move outside table body. Keep touch scroll native, hide cues in print, honor reduced motion.

## Icons and visual hierarchy

- `frontend/src/lib/kindIcons.ts` is the canonical map for movement/count kind labels and icons. Use it across menus, filters, rows, records, notifications, drafts, editor headings and More tiles. Registry paths have distinct glyphs; aliases point to canonical keys.
- Use `outside` for 外部, `export` for 导出, `report` for 报表; reserve `download` for file downloads. Icon-only controls need accessible names and visible tooltips.
- Definition lists (`.ti-fields`) label mixed-value summaries; `·` separates values of the same kind. Use consistent label/quantity alignment, tabular numerals and focus rings.

## Verification contract

Before visual browser inspection, run the browser under `scripts/ui-visual-preflight` (procedure in [docs/agents/visual-review.md](docs/agents/visual-review.md)). Inspect realistic Chinese text, long names, 1024px boundary, desktop/phone, all densities and enlarged text. Check alignment, skeleton/refresh retention, image placeholders, scroll containment, keyboard access and overlapping touch targets. Fixture browser evidence is client evidence; name live-service/device evidence separately. Source review or automated tests alone do not establish visual acceptance.

## Changelog

- 2026-10-30: filter panels nest their selects, stacked supporting dialogs, attachment viewer, reference chips compact on fine pointers.
- 2026-10-31: select mode (`useBrowseSelection`, selection bar), compact header hint glyph, SVG sort icons, phone actions reachable while stuck.
- 2026-10-30: column modules with export declarations, start-pinned identity columns, header hints, bold quantities, nested PopupMenu and press-and-release backdrop dismissal.
- 2026-10-29: one group row per label with spanning identity cells, two-unit cells with disclosure, full-row phone group toggles.
- 2026-10-28: current table, editor, picker and image geometry; separate filter, picker and review rails.
- 2026-10-27: semantic DataTable columns, units and shared editor grid.
- 2026-10-25: layer scale, phone sheets, browse density and keyboard focus.
