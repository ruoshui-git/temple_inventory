# Task: Responsive Faceted Filtering and Desktop Layouts

## Goal

Improve browsing and selection throughout the volunteer-facing inventory app
without weakening its mobile-first behavior. Implement an Odoo-inspired,
responsive filter experience for record lists, use the available desktop width
where it improves scanning and comparison, and replace native select fields only
when another control better matches the decision being made.

The primary deliverable is a reusable filtering and responsive-layout foundation,
then its application to Inventory, Expiry, and History. Apply the same interaction
rules to other pages where there is a demonstrated usability benefit. Do not turn
this into a visual rewrite of the entire application.

Keep all volunteer-facing text in Chinese. Preserve existing inventory,
permission, workspace, autosave, scanner, PWA, and warehouse invariants from
`AGENTS.md`.

## Confirmed product decisions

1. Inventory browsing uses multi-select warehouse/location and item-category
   filters.
2. Selection semantics are:
   - values within the warehouse facet are ORed;
   - values within the item-category facet are ORed;
   - warehouse, category, text, and other distinct facets are ANDed;
   - selecting a warehouse group includes every visible descendant leaf;
   - selecting multiple warehouse groups or leaves uses the union of their
     visible descendant leaves;
   - redundant child selections beneath an already-selected parent must not
     alter results or create duplicate server work;
   - an empty facet means “全部”; do not store a synthetic “all” value alongside
     real selections.
3. Desktop inventory results use compact rows/a table rather than stretched or
   multi-column cards.
4. Where an item has an image, display a small row thumbnail. The thumbnail is a
   button that opens an accessible larger image preview:
   - desktop pointer users may open it on hover after a short delay;
   - keyboard users open the same preview on focus and can dismiss it with Escape;
   - click/tap pins or opens the preview for touch users;
   - do not implement the preview as a hover-only tooltip, because the content is
     visual and must be available to keyboard and touch users;
   - the preview should be a lightweight popover on desktop and may become a
     centered dialog/lightbox on narrow touch screens;
   - provide useful alt text from the item name, restore focus on close, and show
     no empty preview trigger when an image is absent.

## Current diagnosis

- `frontend/src/style.css` applies `max-width: 760px` to every `.app-shell`, so
  result-heavy desktop pages leave most of the viewport unused.
- `Inventory.vue` renders warehouse/location and item group as flat native
  selects followed by a manual Search button. This hides the warehouse hierarchy
  even though `inventory_api.inventory()` already resolves a selected warehouse
  to descendant leaves.
- Inventory text search has mixed sources of truth: `activeItems` filters the
  current client result immediately, while Enter/Search sends a server request.
  A user cannot reliably tell whether they are seeing all matches or only matches
  from the last fetched set.
- Inventory returns an unpaginated array. Its text-search helper caps matching
  codes at 100, which can silently omit matches as the catalog grows.
- `Expiry.vue` and `History.vue` repeat manual-apply filtering and narrow layouts.
  History already paginates; Expiry paginates at 50; Inventory does not.
- `ItemPicker.vue` correctly auto-searches but still uses flat category and
  warehouse selects. Its drawer is only 560px wide on desktop.
- `Settings.vue` renders hierarchical warehouses as a flat series of cards,
  obscuring parent/child relationships.
- The representative sample catalog has numerous rooms/leaf locations and at
  least twelve general item categories, so the limitations are already visible
  before production growth.
- `frappe-ui` is already installed and exports `Combobox`, `MultiSelect`, and
  `Select`; do not add a second selection-component dependency.

Odoo is an interaction reference, not a visual specification. Its useful ideas
are the left search panel, hierarchy-aware fields, multi-value facets, visible
active filters, and immediate list refinement. Relevant references:

- https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_architectures.html
- https://www.odoo.com/documentation/19.0/applications/essentials/search.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/use_locations.html

## Milestone 1: shared responsive filtering foundation

Build small, focused shared components/composables rather than duplicating each
page's filter behavior. Names are suggestions, not mandatory contracts:

- `ResponsiveFilterPanel.vue`
  - persistent, sticky left sidebar at the desktop breakpoint;
  - full-width drawer or bottom sheet on smaller screens;
  - displays an active-filter count on the mobile trigger;
  - provides an accessible title, close button, focus management, and Escape
    handling;
  - uses the same filter content and model in both presentations.
- `WarehouseTreeFilter.vue`
  - builds the tree from `parent_warehouse`, `lft`, and `rgt`; do not infer
    hierarchy from names or depth;
  - supports expand/collapse, parent and leaf selection, indeterminate states,
    keyboard navigation, and a local tree search when the option list is long;
  - displays readable path/context without exposing company suffixes where the
    existing `warehouseLabel` helper already provides the intended label;
  - excludes warehouses the user cannot see and never implies that a group can
    hold stock;
  - preserves a user's explicit selections in the URL while normalizing the
    effective leaf set for requests.
- `ActiveFilterChips.vue`
  - shows selected warehouse paths, categories, and other active filters;
  - supports removing one selection and clearing all;
  - does not render a chip for the default/all state.
- A shared debounced request/filter composable:
  - text input debounce around 300 ms;
  - select, checkbox, and date changes apply immediately;
  - reset pagination to the first page on any filter change;
  - discard or abort stale requests so a slower old response cannot overwrite a
    newer filter state;
  - retain current results with a non-blocking updating indicator where possible,
    rather than blanking the page on every change;
  - expose initial loading, refreshing, empty, error, and success states;
  - serialize stable filter state into route query parameters and hydrate from
    them on mount/back/forward navigation;
  - use repeated query values or another unambiguous array encoding; do not use
    comma splitting because valid names may contain punctuation.
- `ItemImagePreview.vue`
  - implements the thumbnail/popover/dialog behavior in the confirmed decisions;
  - positions the popover within the viewport and does not obstruct row actions;
  - cancels delayed hover opening if the pointer leaves before the delay;
  - avoids downloading a separate full-resolution image if the existing item
    image is already the appropriate asset; browser lazy loading is preferred for
    off-screen thumbnails.

Prefer semantic HTML checkboxes and buttons for the always-visible facet panel.
Use Frappe UI `Combobox` for long searchable single choices and `MultiSelect` for
compact multi-choice popovers outside the facet-panel context. Do not force a
popover multi-select into the desktop sidebar when visible checkboxes are easier
to scan.

## Milestone 1: Inventory page

### Responsive structure

At a desktop breakpoint near 1024px:

- use a wide content shell capped around 1280–1440px with sensible viewport
  gutters;
- render a 280–320px sticky filter sidebar and a flexible results column;
- put the warehouse/location tree first and category checkboxes below it;
- put the text search, result count, active chips, and any result actions above
  the table;
- do not render an Apply/Search button;
- keep the filter panel independently usable when the result list is long.

Below the desktop breakpoint:

- keep the search field visible above results;
- replace the persistent sidebar with a `筛选` button and active-filter count;
- open the same filters in a drawer/bottom sheet;
- continue to apply selections automatically;
- retain removable active-filter chips outside the closed drawer.

### Desktop result table

Render one item per row with stable columns:

1. thumbnail and item name/code;
2. category;
3. available stock;
4. total stock;
5. location summary;
6. attention/status information when applicable.

Requirements:

- make the primary item link explicit rather than making the entire row a
  misleading link with nested controls;
- use `ItemImagePreview` for the thumbnail and larger preview;
- summarize locations compactly in the row, for example the first one or two
  locations plus `另有 N 个位置`; allow an accessible inline expansion for the
  complete per-location breakdown;
- align quantities for fast comparison and retain the stock UOM;
- ensure the table remains understandable at browser zoom and at intermediate
  widths; switch to the existing card-like mobile presentation before columns
  become cramped;
- use proper table semantics if a table is implemented. If CSS grid rows are
  chosen for responsive reasons, reproduce the required row/column accessibility
  semantics and test them;
- provide a visible result range/total and real pagination or incremental loading;
  do not render the entire catalog indefinitely.

The `待处理` view should use the same shell and filters, keep its explanatory
copy, and show structured reason badges without introducing a second filtering
implementation.

### Inventory API contract

Extend `inventory()` in a backward-compatible way:

- accept warehouse and item-group arrays while continuing to accept the existing
  scalar parameters during migration;
- validate every requested warehouse against the current user's visible
  warehouse tree;
- expand groups server-side to visible leaf descendants, union the resulting
  leaves, and deduplicate them;
- never accept a client-provided expanded leaf list as authorization;
- apply category OR semantics and AND it with the warehouse leaf union and text
  search;
- add `start` and bounded `page_length` parameters;
- return a standard page object with `results`, `total`, `start`, and
  `page_length` rather than an unbounded array;
- remove the 100-result text-search truncation. Apply search directly or through
  a helper that can return the complete filtered/paginated result correctly;
- preserve current available/total/reserved calculations, group-stock diagnostics,
  permission checks, and attention-reason behavior;
- use deterministic ordering so pagination is stable.

Facet counters are not required in this task. Odoo makes counters optional for
performance reasons; do not add expensive per-facet queries without measuring and
justifying them.

## Milestone 1: Expiry page

- Reuse the responsive filter panel and active chips.
- Warehouse and category use the same multi-select semantics as Inventory.
- Expiry-from and expiry-to remain native date inputs and apply immediately.
- Replace the two-option sort select with a compact radio/segmented control when
  it remains only `最近到期优先` and `最晚到期优先`.
- Use a desktop table with item/batch, category, expiry date, time remaining,
  quantity, and location summary columns; keep cards on mobile.
- If an item image is made available in the endpoint, reuse `ItemImagePreview`.
  Do not add an N+1 request per row solely to fetch images.
- Reset `start` when any filter changes and preserve real pagination.
- Extend `expiring_batches()` to accept validated warehouse/category arrays with
  the same OR/AND and descendant-union rules. Preserve positive-stock-only,
  server-date, group-stock, permissions, sorting, and batch aggregation behavior.

## Milestone 1: History page

- Reuse the responsive filter panel instead of the current form plus “应用筛选”.
- Keep completed/unfinished as the prominent view switch, not as a hidden facet.
- Put transaction type, dates, activity, and room/location in the filter panel.
- Use an accessible searchable combobox for Activity if it is a single-choice
  filter. Do not use multi-select unless the backend contract is deliberately
  expanded and tested in this task.
- Make room/location hierarchy-aware. Multi-select it using the confirmed
  warehouse semantics and update `history()` accordingly.
- Text fields use the shared debounce behavior. Resolve the current inconsistent
  exact-versus-substring matching of `source_text`; document and test the chosen
  behavior. User-entered text filters should normally be case-insensitive
  contains matches.
- Use a compact desktop table with type/description, posting date, item count,
  status, handler, and relevant actions. Keep readable cards on mobile.
- Preserve delete confirmation and permissions for unfinished drafts.

## Milestone 2: other justified improvements

### Item Picker

- Keep it as a drawer because it is a focused subtask within a transaction.
- Increase its useful desktop width, approximately 680–760px, without occupying
  the entire screen.
- Keep automatic text search and stale-response protection.
- Replace category and stock-warehouse native selects with searchable filter
  popovers/chips using the shared selection vocabulary. A single warehouse may
  remain single-choice here because it represents the source context for an
  operation, not a browse facet; do not reuse Inventory's multi-select merely for
  superficial consistency.
- Display item results as compact rows with small thumbnails and the shared image
  preview where appropriate.
- Preserve recent items, create-new-item continuity, barcode behavior, paging,
  stock-only semantics, and warehouse-change events.

### Settings

- Replace the flat warehouse card sequence with an expandable hierarchy.
- On desktop, use a tree/list on the left and the selected node's settings on the
  right, or a clearly indented tree table if inline editing remains simpler.
- On mobile, use an indented accordion/list with the same node relationships.
- Clearly distinguish group nodes from stock-holding leaf nodes and show the
  “允许库存操作” control only for eligible leaves.
- Warehouse type is a short fixed administrative enum; a native/Frappe UI Select
  remains appropriate. Do not replace it with a searchable control.
- Preserve explicit Save behavior for the allowed-warehouse configuration; this
  is a settings mutation, not a read-only filter, so automatic server writes are
  not implied by the filter design.

### Workspace

- Increase the desktop maximum width moderately, approximately 1000–1120px. Do
  not stretch ordinary form fields or signature pads across a 1440px canvas.
- Use desktop columns only where they preserve the transaction flow, for example
  item/location work in the main column and record details/status/summary in a
  secondary column.
- Keep the mobile order linear and preserve sticky save state, autosave,
  signatures, confirmation, scanner lifecycle, and conflict recovery.
- Reuse an accessible hierarchy-aware single-location chooser when a warehouse
  list is long. Transaction source/destination fields remain single-choice per
  line; Inventory browse multi-select semantics do not apply.
- Short fixed choices such as return outcome should become radios/segmented
  buttons when that is clearer. UOM and batch may use searchable comboboxes when
  option counts justify it.

### Item Detail

- Use a restrained two-column desktop layout: item image/identity/summary in one
  region and location stock/recent movements in the other.
- Reuse the image preview behavior only if it adds value beyond the already-large
  detail image; do not create redundant controls.
- Keep a single-column mobile layout.

### Home

- At desktop widths, the three operation groups may be arranged as three clear
  panels/columns with their actions grouped beneath each heading.
- Keep the secondary navigation visually separate.
- Do not make the home page edge-to-edge simply to consume space.

### Pages that should remain constrained

Scanner, authentication/setup prompts, confirmation dialogs, nested creation
dialogs, and signatures should retain focused readable widths. “Use the full
screen” means allocate space according to the task, not stretch every screen.

## Selection-control rules

Use this decision table consistently:

| Decision | Control |
| --- | --- |
| Hierarchical browse filter | Visible tree with checkboxes |
| Several values from a long list in compact space | Frappe UI `MultiSelect` |
| One value from a long/dynamic list | Frappe UI `Combobox` |
| One value from a short list | Native or Frappe UI `Select` |
| Two to four fixed, important choices | Radio or segmented buttons |
| Date/range | Native date inputs |
| Boolean declaration/setting | Checkbox |
| Item lookup | Purpose-built searchable picker, not a generic select |

Do not globally replace every `<select>`. In particular, company setup,
warehouse type, and other short administrative lists may remain selects. A
control change must improve searchability, hierarchy comprehension, comparison,
or error prevention.

## Responsive shell and visual constraints

- Introduce page/layout variants instead of changing `.app-shell` to one wide
  size globally. Suggested variants include focused, standard, and wide/list.
- Use CSS breakpoints based on content needs, with approximately 1024px as the
  persistent-sidebar transition; confirm intermediate tablet layouts manually.
- Preserve the current warm visual language, touch targets of at least 44px on
  mobile, clear focus rings, Chinese labels, and sufficient contrast.
- Prefer a small number of repeatable spacing and column rules over page-specific
  pixel patches.
- Avoid horizontal page scrolling. A desktop table may scroll within a labelled
  container only as a last-resort fallback at intermediate widths.
- Long warehouse paths, item names, and category names must wrap or truncate with
  an accessible way to reveal the full value.

## Accessibility and interaction requirements

- Every filter section has a programmatic heading/legend.
- Checkbox groups, tree expansion controls, mobile drawers, popovers, image
  previews, tables, and pagination are usable with keyboard only.
- Custom tree behavior follows established ARIA tree/treeitem patterns or uses
  simpler nested checkbox groups if full tree keyboard behavior would be
  incomplete. Prefer a well-implemented simple structure over inaccurate ARIA.
- Focus is trapped only in modal presentations and is returned to the invoker on
  close.
- Loading and result-count changes use polite live regions without announcing on
  every keystroke before the debounce settles.
- Row thumbnails have meaningful alt text; decorative placeholders use empty alt
  text.
- Hover can enhance the image preview but can never be its only trigger.
- Reduced-motion preferences disable nonessential transition/preview animation.

## State, errors, and performance

- Distinguish initial loading from background refresh.
- Keep the last successful results visible during background refresh unless the
  selected mode makes them misleading.
- Surface request failures near the affected result area and provide Retry.
- Do not clear active filters after a transient error.
- Avoid an API request for expand/collapse-only tree changes.
- Avoid N+1 calls for row stock, images, labels, or filter metadata.
- Add lazy image loading and stable width/height to prevent row layout shifts.
- Measure with the representative sample catalog and also exercise larger mocked
  option/result sets. Do not introduce list virtualization unless measurement
  shows it is necessary.

## Backend security and compatibility

- Treat every filter parameter as untrusted input.
- Reapply company, user-permission, visible-root, and allowed/leaf restrictions
  on the server.
- A group filter may select descendant leaves for reading, but it never authorizes
  stock in a group or makes a group valid for a transaction.
- Preserve scalar filter compatibility long enough for coordinated frontend
  deployment or update all callers atomically and document the break explicitly.
- Reuse a single tested helper for parsing arrays, validating selected nodes,
  expanding descendants, and deduplicating leaves across Inventory, Expiry, and
  History.
- Bound page sizes and provide stable ordering.
- Do not add a parallel search index, stock table, or client-side authorization
  cache.

## Testing and validation

### Backend tests

Add focused coverage for:

- one and several selected warehouse leaves;
- a selected group including all and only visible descendant leaves;
- overlapping parent/child selections without duplicated quantity or rows;
- multiple categories using OR semantics;
- category plus warehouse plus text using AND semantics;
- empty arrays behaving as “全部”;
- scalar backward compatibility;
- unauthorized, outside-root, missing, and malformed warehouse values;
- stable Inventory pagination beyond 100 matches;
- Expiry aggregation and pagination under multiple locations/categories;
- History matching transactions touching any selected descendant location;
- permissions and the existing non-zero group-stock diagnostic.

Run the focused integration entry point from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If the local site is not provisioned with ERPNext/`Warehouse`, report that exact
environment limitation instead of weakening or skipping production validation
logic silently.

### Frontend tests

Add focused Vitest coverage for:

- filter array/query serialization and hydration;
- OR/AND model construction sent to APIs;
- debounce and stale-response suppression;
- pagination reset after filter change;
- parent/child tree selection and indeterminate state;
- mobile/desktop filter presentation sharing one model;
- active chip removal and clear all;
- image preview hover delay, focus, click/tap, Escape, and focus restoration;
- responsive result data rendered in desktop and mobile presentations without
  duplicating fetches.

Run from `frontend/`:

```sh
yarn test
yarn type-check
yarn build
```

Do not launch Playwright or browser automation unless the user separately asks
for it. The user performs final manual browser validation.

### Manual validation checklist

Verify at representative widths near 375px, 768px, 1024px, 1280px, and 1440px:

- Inventory filter panel transitions cleanly between drawer and sidebar.
- Filters apply automatically and remain in the URL across reload/back/forward.
- Multi-select semantics match the confirmed rules.
- Keyboard-only operation reaches filters, table rows, expansions, thumbnails,
  image previews, pagination, and mobile drawer controls.
- Hovering a thumbnail previews the image without flicker; focusing and tapping
  provide equivalent access; Escape closes and restores focus.
- Inventory table is dense but readable; mobile cards remain touch-friendly.
- Expiry and History use the same interaction vocabulary.
- Workspace autosave, scanner, signatures, and confirmation are unchanged.
- Long Chinese names and warehouse paths do not overlap or force page scrolling.
- PWA update behavior still exposes newly built assets after deployment.

## Non-goals

- Do not copy Odoo branding or reproduce its generic query-builder UI.
- Do not add saved/favorite filters in this task.
- Do not add facet counters without a measured, approved follow-up.
- Do not make transaction warehouse fields multi-select.
- Do not redesign backend inventory accounting or warehouse structure.
- Do not change stock quantities, reset the development site, or reinstall sample
  data as part of this UI task.
- Do not edit generated files in `temple_inventory/public/frontend/` or
  `temple_inventory/www/inventory.html` by hand.
- Do not replace every select for consistency alone.

## Acceptance criteria

- Inventory has no manual Search/Apply step; text, warehouse, and category
  changes refine results automatically and reliably.
- Desktop Inventory presents a hierarchy-aware sticky sidebar and compact table;
  mobile presents the same filters in a touch-friendly drawer and results as
  cards.
- Warehouse and category multi-select behavior exactly matches the confirmed
  OR-within/AND-between rules, including descendant expansion and overlap
  deduplication.
- Inventory search is paginated, stable, and cannot silently truncate after 100
  matches.
- Item thumbnails remain compact while an accessible larger preview works with
  hover, keyboard focus, click, and touch.
- Expiry and History reuse the filtering foundation and make productive use of
  desktop width.
- Settings visibly represents the warehouse hierarchy, and the scoped Workspace,
  Item Detail, Item Picker, and Home changes improve desktop use without damaging
  their mobile flows.
- Short/fixed selections remain simple controls; searchable or multi-select
  inputs appear only where justified.
- Server-side permissions and leaf-stock invariants remain authoritative.
- Focused backend tests, frontend tests, type checking, and production build pass,
  with any environment-only limitation reported precisely.
