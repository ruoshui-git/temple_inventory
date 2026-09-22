# Task 2: Datatable Viewport, Navigation, and Filter UX

## Status and authority

This is an implementation handoff based on investigation performed on
2026-09-22. It covers the shared datatable presentation, desktop browse-page
scrolling, inventory sub-navigation, mobile filter drawers, Expiry range input,
and installed-app bottom navigation.

Do not change backend APIs for this task. Preserve unrelated working-tree
changes, especially the in-progress image, attachment, validation, and
`frontend/src/style.css` work from Task 1. Do not edit generated files under
`temple_inventory/public/frontend/` or `temple_inventory/www/inventory.html` by
hand. The user will perform manual browser/device validation; do not run
Playwright or launch a browser unless separately requested.

## Goal

Make Inventory, Expiry, and History efficient desktop browse surfaces without
weakening their mobile behavior:

- desktop pages occupy the viewport below the application header;
- filters and result rows scroll independently, with no outer page scrollbar;
- search, totals, active filters, and table headings stay available while rows
  scroll;
- primary datatable cells align correctly and separate primary and secondary
  text;
- inventory view tabs consume less vertical space;
- filter drawers close when the user clicks outside them; and
- the installed-app bottom navigation is taller, safer, and easier to recognize.

Keep all volunteer-facing text in Chinese. Preserve current filtering, URL
state, server sorting, infinite loading, scanner, selection, permissions, and
safe-return behavior.

## Confirmed design decisions

1. The viewport-locked desktop layout applies to all current
   `SortableDataTable` pages: Inventory, Expiry, and History.
2. At widths below 1024px, these pages use normal document scrolling. The
   mobile search toolbar is not sticky.
3. On desktop, `当前库存 / 全部物品 / 效期批次` is displayed inline in the
   application header beside the active `库存` destination. On mobile, the same
   choices remain a compact row at the top of Inventory and Expiry.
4. Clicking outside an open filter drawer closes it. Transaction/editor dialogs
   do not gain outside-click dismissal because accidental closure could discard
   input.
5. Expiry's day input remains visible and enabled even when `全部效期` is
   selected, but it does not affect requests, chips, or active-filter counts
   until a relative range is selected.
6. No inventory or history endpoint contract changes are in scope.

## Current diagnosis

- `SortableDataTable.vue` leaves slotted primary-cell content inline. The image
  and link therefore align on the text baseline, while the nested `<small>` is
  not guaranteed to form a separate line.
- The table component does not vertically center cells and its `<thead>` is not
  sticky.
- `.desktop-list-layout` currently receives a calculated viewport height while
  Inventory/Expiry sub-tabs and History's `.app-shell` height/padding remain
  outside that calculation. This produces an outer document scrollbar in
  addition to `.results-column` scrolling.
- `.results-column` itself scrolls, so its toolbar, active chips, table, and
  infinite-loading sentinel all share one scrolling surface. Sticky offsets
  become fragile when the toolbar wraps.
- Inventory implements a custom mobile filter overlay while Expiry and History
  use `ResponsiveFilterPanel`. The custom overlay has no full-screen backdrop,
  so clicking apparent main content does not close it.
- `ResponsiveFilterPanel` already implements Escape, focus trapping, focus
  restoration, and body-scroll locking, but its drawer should be teleported to
  the body to make its viewport layer independent of page overflow containers.
- Expiry renders the `天数` field after all four radio choices and only after a
  range is selected. It can be below the visible part of a long filter panel.
- The bottom navigation has text-only destinations. Although its CSS references
  `env(safe-area-inset-bottom)`, `frontend/index.html` does not request
  `viewport-fit=cover`, so iOS standalone mode may not provide the intended safe
  inset.

## Workstream A — shared datatable presentation

Update `frontend/src/components/SortableDataTable.vue` without changing its
public props, slots, or emitted events.

1. Vertically center desktop header and body cells. Keep ordinary text left
   aligned and preserve numeric alignment supplied by page classes.
2. Make the desktop `<thead>` sticky at `top: 0` inside the page's dedicated
   results scroller. Give header cells an opaque background and sufficient
   stacking order so rows never paint through them.
3. Add shared primary-cell styling hooks rather than targeting every link or
   `<small>` in a table:
   - the cell content is a horizontal flex row aligned to the center;
   - the thumbnail/control does not shrink;
   - the text link is a vertical stack with a minimum width of zero;
   - the primary name and secondary code/batch text are separate lines; and
   - long names may wrap without pushing other columns off screen.
4. Apply this primary-cell markup to Inventory and Expiry. Inventory shows
   `item_name` over `item_code`; Expiry shows `item_name` over
   `item_code · batch_no`.
5. Preserve current sortable-header buttons, `aria-sort`, row activation,
   explicit-control isolation, selection behavior, focus styling, and mobile
   slots.

Do not implement sticky behavior with JavaScript measurements. The table header
will be the first element in a dedicated scrolling region, so CSS sticky
positioning is sufficient.

## Workstream B — one desktop viewport and one results scroller

Use the same structural classes or a small shared layout primitive in
`Inventory.vue`, `Expiry.vue`, and `History.vue`. Do not duplicate three
different height formulas.

### Desktop structure

At `min-width: 1024px`:

1. Give each page a dedicated viewport-list root whose border-box height is the
   space remaining below `--shell-header-height`.
2. Make page-level contextual navigation/toolbars an automatic-height row and
   the two-column list layout `minmax(0, 1fr)`. Remove the existing fixed
   `.desktop-list-layout` height calculation.
3. Keep the left filter panel at 280–320px and give it `min-height: 0`,
   `overflow-y: auto`, and contained overscroll. It must not depend on sticky
   positioning once its parent already fills the remaining viewport.
4. Change the result column into two vertical regions:
   - `results-chrome`: search, mobile filter trigger where applicable, result
     totals/updating status, and active-filter chips; and
   - `results-scroll`: errors associated with loading results, initial loading,
     datatable/empty state, infinite-loading sentinel, and load-more fallback.
5. Keep `results-chrome` outside the scrolling region instead of stacking
   multiple sticky elements. Let it grow naturally if active chips wrap; the
   scrolling region receives the remaining height through
   `minmax(0, 1fr)`.
6. Give `results-scroll` `min-height: 0`, `overflow: auto`, and contained
   overscroll. The sticky datatable header uses this element as its scroll
   container.
7. Point every page's `IntersectionObserver.root`, scroll-to-reset behavior,
   saved scroll offset, and restored scroll offset at `results-scroll`.
8. Ensure the wide shell's padding and History's current `.app-shell`
   `min-height: 100vh` cannot add height outside the viewport-list root.

Do not globally lock `.application-shell` or `body` scrolling. Detail pages,
forms, setup screens, and all non-datatable pages must retain ordinary document
scrolling.

### Mobile structure

Below 1024px:

- remove fixed viewport heights and internal result overflow;
- use the existing mobile cards and normal document scroll;
- keep search and result totals in normal flow rather than sticky;
- preserve the fixed bottom navigation and floating-action offsets; and
- ensure no empty internal scroller interferes with touch scrolling or infinite
  loading.

## Workstream C — compact contextual navigation

### Inventory desktop navigation

Extend `ApplicationShell.vue` so the desktop header renders a compact contextual
navigation group after the active `库存` primary destination on `/` and
`/expiry`:

- `当前库存` -> `/` with `mode` omitted;
- `全部物品` -> `/` with `mode=catalog`; and
- `效期批次` -> `/expiry`.

Style these as subordinate tabs: smaller text and padding than the four primary
destinations, with a separator or spacing that makes the hierarchy clear. The
primary `库存` destination remains active for every inventory sub-view.

Add a small shared route-query helper if needed. Its transition rules are:

1. Preserve the shared `search`, repeated `warehouses`, and repeated
   `item_groups` query values across all three views.
2. Preserve `sort_by`/`sort_order` only when switching between `当前库存` and
   `全部物品`, because they share the same sortable columns.
3. Remove Inventory sort fields when entering Expiry and remove Expiry sort
   fields when returning to current/catalog.
4. Keep `expiry_window` and `expiry_days` only while remaining on Expiry; do not
   leak them into Inventory.
5. Do not carry `start` between modes. Each destination begins at its first
   result page.

### Mobile inventory navigation

Keep a page-level `aria-label="库存视图"` navigation on Inventory and Expiry,
but render it only below the desktop breakpoint. Make it a single compact,
horizontally scrollable row with no wrapping and a clear active state. It stays
in normal page flow.

### History modes

Keep History's movement/status modes on the History page. Reduce their margins,
padding, and minimum heights on desktop and allow horizontal scrolling rather
than wrapping into a tall block at constrained widths. Do not move them into the
global application header.

## Workstream D — consistent dismissible filter drawers

1. Replace Inventory's custom `filterOpen` sidebar presentation and manual body
   overflow watcher with `ResponsiveFilterPanel`, matching Expiry and History.
2. Teleport the open drawer/backdrop to `body` so it is not clipped or affected
   by the new viewport list overflow.
3. The backdrop covers the complete viewport. A click on the backdrop—including
   the area visually occupied by the underlying main content—closes the drawer.
4. A click, pointer action, or form interaction inside the drawer must not close
   it.
5. Preserve:
   - the visible `关闭筛选` and `完成` controls;
   - Escape dismissal;
   - initial focus inside the drawer;
   - Tab/Shift+Tab focus trapping;
   - focus restoration to the actual invoking button;
   - the body's previous overflow value; and
   - the same live filter models in desktop sidebar and mobile drawer.
6. Keep the persistent desktop filter sidebar nonmodal and always visible.

Do not apply this outside-click policy to ItemPicker, line editors, attachment
flows, confirmations, or other transaction dialogs.

## Workstream E — prominent Expiry day parameter

Replace the current conditional field at the bottom of Expiry's `choice-list`
with a clearly labelled group:

1. The header row contains the heading `效期范围` on the left and a compact
   `天数` number input on the right.
2. The input is always rendered and enabled, with `type="number"`, `min="1"`,
   `step="1"`, and `inputmode="numeric"`. Its practical width should fit four
   digits without stretching across the sidebar.
3. Render `全部效期` and the four relative-range radios immediately below the
   header. Their visible labels continue to interpolate the normalized day
   value.
4. Invalid, empty, zero, or negative values normalize to `30` on change/blur.
5. When `全部效期` is selected, changing the stored day value does not add an
   active filter, serialize `expiry_days`, change the results, or issue an
   otherwise identical API request.
6. Once a relative window is selected, the day value participates in the API
   request, URL state, chip label, and range labels exactly as it does today.
7. Keep the group accessible through a labelled `fieldset`/`legend` or an
   equivalent `role="group"` and associated heading. Do not place a form input
   inside invalid or unreliable legend markup merely to achieve the visual row.

## Workstream F — installed-app bottom navigation

1. Change the viewport meta content in `frontend/index.html` to include
   `viewport-fit=cover` while retaining the current width and scale settings.
2. Give each mobile primary destination a local decorative SVG icon:
   - 库存: package/inventory box;
   - 借用: exchange/return arrows;
   - 仓库: warehouse/building; and
   - 更多: horizontal ellipsis.
3. Keep each Chinese label visible. Set icons to `aria-hidden="true"`; the link
   text remains the accessible name. Do not add a new icon package or rely on a
   transitive dependency.
4. Render each link as an icon-over-label flex column. Use approximately 22–24px
   icons, compact 12–13px labels, and at least 56px of interactive content height
   before the safe-area inset.
5. Add comfortable internal bottom spacing using the safe-area inset with a
   nonzero fallback/minimum. The labels/icons must sit above the iOS home
   indicator rather than merely extending the nav's background behind it.
6. Centralize or measure the final rendered mobile-nav height. Use the same
   value for:
   - `.shell-content` bottom clearance;
   - `FloatingActionMenu` bottom offset;
   - mobile context-action bars; and
   - any other controls currently positioned relative to hard-coded 74/78/82px
     values.
7. Preserve four equal-width destinations, current-route indication, keyboard
   focus styles, and desktop navigation behavior.

Using the existing `ResizeObserver` pattern in `ApplicationShell` for the
rendered mobile navigation height is acceptable and avoids duplicating a value
that includes a device-dependent safe inset.

## Compatibility and boundaries

- Keep `SortableDataTable`'s `rows`, `columns`, `rowKey`, `sort`,
  `selectionMode`, `selectedKeys`, cell slots, mobile slot, and events backward
  compatible.
- Do not change `inventory`, `expiring_batches`, or `history` request/response
  contracts.
- Do not change the 1024px desktop/mobile datatable breakpoint in this task.
- Preserve query hydration, browser back/forward behavior, stale-request
  protection, server sorting, selection mode, row links, and infinite loading.
- Do not introduce JavaScript viewport-height calculations when CSS grid/flex
  sizing can establish the remaining height.
- Keep component-specific styles with their components where practical. If
  shared CSS is required, merge carefully with Task 1's existing uncommitted
  `frontend/src/style.css` changes and avoid broad reformatting.

## Required automated coverage

Add or update focused frontend tests for:

1. datatable primary-cell hooks, separate primary/secondary elements, vertical
   centering hooks, and sticky header classes without weakening the current sort
   and activation tests;
2. Inventory and Expiry using the shared primary-cell markup;
3. Inventory, Expiry, and History rendering distinct `results-chrome` and
   `results-scroll` regions;
4. each page using `results-scroll` for scroll reset/restoration and as the
   `IntersectionObserver` root;
5. Inventory using `ResponsiveFilterPanel` rather than its custom mobile
   sidebar;
6. filter drawer backdrop dismissal, inside-click isolation, Escape, focus
   trapping/restoration, and exact body-overflow restoration;
7. desktop contextual-tab active state and the query preservation/cleanup rules
   for current, catalog, and expiry transitions;
8. Expiry always rendering the day input before the radio choices, normalizing
   invalid input to 30, and not activating or requesting a day range while
   `全部效期` is selected;
9. mobile navigation rendering four icons and four visible labels, preserving
   active state, and exposing no redundant icon accessible names; and
10. the viewport metadata and shared mobile-nav height/offset contract.

CSS layout cannot be proven by jsdom alone. Test semantic structure and state in
Vitest, then leave pixel/scroll behavior to the manual acceptance pass.

## Validation gate

From `frontend/`, run:

```sh
yarn test frontend/tests/sortable-data-table.test.ts frontend/tests/inventory-expiry-integration.test.ts frontend/tests/history-scanner-navigation-integration.test.ts
yarn type-check
yarn test
```

Do not run Playwright unless separately requested.

## Manual acceptance checklist

The user will validate these scenarios after implementation:

1. At approximately 1024x768 and 1440x900, Inventory, Expiry, and History do not
   scroll the overall document during ordinary result browsing.
2. The filter sidebar and result table scroll independently. Search, totals,
   active chips, contextual modes, and the datatable heading remain visible.
3. Long result sets continue infinite loading within the results scroller, and
   returning to a page restores that scroller's prior position.
4. At widths below 1024px, cards and filters use natural document scrolling with
   no trapped or empty nested result scroller.
5. Opening a filter drawer and tapping the apparent main-content area closes it;
   interacting inside the drawer does not.
6. Inventory and Expiry primary cells are vertically centered, with names above
   codes/batches rather than sharing a baseline.
7. Inventory sub-tabs are inline with the desktop primary header and compact at
   the top of mobile content, with correct active state and filter preservation.
8. Expiry's day input is immediately visible beside `效期范围`, including before
   a range is selected.
9. In installed iOS and Android PWA modes, all four bottom destinations have
   clear icons, comfortable tap targets, and enough clearance above system
   navigation/home indicators.
10. Floating actions and selection/context bars remain above the taller bottom
    navigation on every supported mobile route.
