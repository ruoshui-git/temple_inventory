# Task: Correct and Complete Filtering, Scrolling, Feedback, and Item Images

## Status and authority

This is the corrective implementation handoff for the current uncommitted UX
work. Its product decisions are confirmed.

For overlapping behavior, this document supersedes both:

- `notes/20260920_RESPONSIVE_FILTER_DESKTOP_UX_TASK.md`
- `notes/20260920_GLOBAL_FEEDBACK_FILTERS_AND_INFINITE_LISTS_TASK.md`

Retain compatible security, accessibility, responsive-layout, and ERPNext
source-of-truth requirements from those documents and from `AGENTS.md`.

The repository currently has an uncommitted partial implementation. Treat those
changes as existing work: inspect and correct them in place, preserve useful
parts, and do not discard unrelated edits. Do not manually edit generated files
under `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html`.

## Objective

Finish the previously approved UX rather than merely polishing the current
checkbox-tree implementation:

1. Warehouse/location and item-category filters use the same compact,
   autocomplete-based, hierarchy-aware multi-select interaction.
2. On desktop list screens, filters and results have independent vertical scroll
   regions.
3. The global toast, incremental loading, complete counts, friendly warehouse
   labels, filter clearing, preview dismissal, and transaction-image continuity
   requirements are actually implemented.
4. Item images appear on every appropriate item-centric surface, including the
   expiration view.
5. Item Detail shows a gallery containing the main Item image and every image
   File attached directly to that Item.

Keep the volunteer-facing application Chinese and mobile-first.

## Audit of the current partial implementation

The implementation is not complete even though its current frontend checks
pass.

### Implemented or partially implemented

- Warehouse groups can be sent to the server and expanded to leaf warehouses.
- Some list requests now abort or ignore stale responses.
- Filter URL serialization supports repeated values.
- The warehouse tree search and hierarchy rendering were improved.
- Expiry and History received responsive table/card and request-state cleanup.
- Settings received a hierarchy-oriented layout.
- The image preview gained viewport-positioning and transient-versus-pinned
  state.
- Current frontend unit tests pass, and `vue-tsc` reports no errors.

These pieces may be reused, but they do not satisfy the final interaction
design by themselves.

### Missing or materially divergent

- There is no global toast provider/service. `App.vue` and workspace submission
  feedback still use only inline error state.
- Inventory and Expiry still use 50-record previous/next pagination; History and
  Item Picker also retain page buttons. No infinite/incremental list foundation
  exists.
- Endpoints return `total` but not the required permission-aware
  `overall_total`.
- Inventory and Expiry categories are flat checkbox lists.
- `bootstrap()` still requests only leaf Item Groups and omits hierarchy fields.
- Warehouse and category filters do not share one interaction or component
  contract.
- There is no section-level `清除本项` action.
- The desktop filter sidebar and results still share the document scroll.
- Warehouse labels still hard-code `第1寺院` and `第2寺院`; friendly contextual
  `未指定` presentation is absent.
- Search does not normalize slash spacing as required for queries such as
  `A02/货架1`.
- The image preview still renders a large `关闭` text button and does not close on
  outside click/tap.
- Workspace quantity/location editing and confirmation do not show the selected
  Item image.
- Expiry does not return or render an Item image.
- Item Detail returns and renders only `Item.image`.
- Loan Picker loads the entire outstanding-loan collection and has neither
  server paging nor item images.
- Long transaction warehouse selects remain flat native selects.

### Current correctness defect to fix

The current warehouse tree has an exclusion inversion bug. If a parent is
selected and a user deselects one covered leaf, the client removes the parent and
adds only the clicked leaf. The expected effective selection is all permitted
siblings except the deselected leaf.

The final autocomplete must implement parent/child normalization correctly and
add a regression test. Do not carry this behavior into the replacement control.

## Locked interaction design

### Matching hierarchy autocomplete for both facets

Warehouse/location and item-category facets use the same reusable visual and
interaction structure. Do not preserve the current category checkbox block, and
do not treat the current always-visible warehouse tree as the final design.

Each facet is a distinct card with:

- a visible heading;
- selected-value count;
- a `清除本项` action that clears only that facet;
- a compact multi-select autocomplete input;
- selected values shown as removable chips;
- a bounded suggestion surface that opens on focus/click;
- a hierarchy-aware, indented browse list inside the suggestion surface; and
- appropriate empty, no-match, loading, and error states.

Use clear border, background, and vertical spacing between the two cards. They
must read as two separate filters rather than one uninterrupted list.

The category control must match the warehouse control in dimensions, heading
placement, search behavior, chips, clear action, hierarchy indentation, parent
selection, keyboard interaction, and empty/error presentation. The controls may
use a shared generic hierarchical-autocomplete component with warehouse/category
adapters.

### Discovery without prior knowledge

Autocomplete must remain browsable:

- Focusing or clicking an empty input shows available permitted choices without
  requiring text.
- The unqueried list shows the hierarchy in its natural order.
- Parents can be expanded/collapsed within the bounded dropdown.
- Typing filters the same hierarchy and reveals every ancestor needed to
  understand a matching descendant.
- Suggested placeholders are `搜索或浏览仓库 / 位置` and
  `搜索或浏览物品类别`.
- An empty query must not produce an empty dropdown or only recent values.

### Selection semantics

- A facet with no selection means all applicable values. Do not use a synthetic
  `全部` value in the selection array.
- Values within a facet are ORed.
- Warehouse, category, text, date, and other separate facets are ANDed.
- Selecting a parent warehouse includes all permitted descendant leaf
  warehouses.
- Selecting a parent Item Group includes all permitted descendant leaf groups.
- Selecting a parent removes redundant explicit descendant selections.
- Selecting overlapping parents/leaves never duplicates records, quantities,
  counts, or backend work.
- When a selected parent is partially excluded by toggling one child off, replace
  the parent with the remaining selected descendant leaves (or an equivalent
  explicit exclusion model if that model is fully serialized and server-tested).
  The effective result must be “all siblings except the child,” not “only the
  child.”
- Preserve the user's explicit choices in URL filter state while normalizing the
  effective descendant union for requests.
- Section clearing resets pagination/loading state and refreshes immediately but
  leaves every other facet unchanged.
- The existing page-level `清除全部` remains and clears text plus all facets.

### Warehouse hierarchy and labels

Build hierarchy from `parent_warehouse`, `lft`, and `rgt`. Do not infer ancestry
from names or hard-code the names/number of temples.

In browse mode, use concise local labels with indentation. Full path context is
available in search results and selected chips when needed for disambiguation.
Descendants do not repeat an already visible temple/room prefix.

Search matches:

- local label;
- full hierarchy path;
- stored warehouse label;
- friendly `未指定` alias;
- the raw literal `未指定`; and
- slash variants with normalized whitespace, so `A02/货架1` matches
  `A02 / 货架1`.

Do not expose the ERPNext company suffix as user-facing path context.

#### Friendly `未指定` handling

`未指定` leaves are real stock-holding warehouses and must remain filterable and
selectable where leaf warehouses are allowed.

- `<room> / 未指定` displays beneath its room as
  `房间内，未细分到货架`.
- `<temple> / 未指定` displays beneath its temple as
  `寺院内，未分配房间`.
- If a room has only its `未指定` leaf and no named child location, collapse the
  redundant group/leaf presentation into one visible `A02`-style choice.
- If a room has named child locations, its group choice is
  `A02（全部位置）`, and its friendly unspecified leaf remains a separate
  choice.
- Browse filters may select groups. Transaction stock controls may select only
  actual permitted leaves.

Centralize the label/path logic. Inventory, Expiry, History, Item Detail,
Workspace, Item Picker, Settings, active chips, and autocomplete results must not
implement divergent naming rules.

### Item Group hierarchy

Fetch the complete permitted Item Group hierarchy rather than only
`is_group = 0` rows. Include at least:

- `name`;
- `item_group_name`;
- `parent_item_group`;
- `is_group`;
- `lft`; and
- `rgt`.

Build and search category ancestry from those fields. Do not parse category names
to infer parents. Parent selection expands to descendants on the server, using
the same deduplication semantics as warehouses.

## Independent desktop scrolling

At the desktop list breakpoint (approximately 1024 px and above), list screens
use a viewport-bound two-pane work area below their page header/navigation:

```text
+----------------------+----------------------------------------------+
| Filters              | Sticky result toolbar / counts               |
|                      |----------------------------------------------|
| [Warehouse card]     | Product/result rows                          |
| [Category card]      |                                              |
| [Other filter cards] |                                              |
|                      |                                              |
| independent scroll   | independent scroll                           |
+----------------------+----------------------------------------------+
```

Requirements:

- The filter pane and results pane each have their own vertical scroll
  container.
- Scrolling products must not move the filters. Scrolling filters must not move
  the products.
- The list-screen body itself should not become a third competing vertical
  scroll area on desktop.
- Size the work area from actual layout/container constraints, using
  `min-height: 0` and `100dvh`-appropriate rules instead of brittle duplicated
  pixel offsets where possible.
- The result search toolbar, active result count, and loading/refresh state remain
  sticky at the top of the results pane.
- The filter-pane heading and page-level clear action remain easy to reach.
- Autocomplete suggestion surfaces are height-bounded and must not expand the
  filter pane or push another facet out of view.
- Prevent accidental scroll chaining where practical, while retaining keyboard,
  wheel, touchpad, Page Up/Down, Home/End, and browser-zoom usability.
- No horizontal page scrolling.

The separate-pane layout applies to Inventory/待处理, Expiry, and History, and
to future desktop list screens using the shared list shell.

Below the desktop breakpoint:

- results use ordinary page scrolling;
- filters open in their own full-height drawer/bottom sheet with independent
  scrolling;
- the result search, filter trigger/count, and active chips remain visible on the
  results page; and
- closing the drawer preserves selections and returns focus to its trigger.

## Incremental loading and counts

The existing page buttons are not the intended UX. Replace them on potentially
unbounded browse/result lists, including Inventory/待处理, Expiry, History, Item
Picker, and Loan Picker.

- Load 25 records initially.
- Automatically append 25 as an intersection sentinel approaches the bottom of
  the results pane/page.
- Provide an accessible `加载更多` fallback for keyboard users and environments
  where observation fails.
- Append without clearing or flashing already loaded rows.
- Deduplicate by a stable record identifier.
- Stop when loaded count reaches filtered total.
- On append failure, retain loaded rows, show an inline retry at the list end,
  and emit one error toast.
- Filter/mode/sort changes cancel stale work, reset the list to its first batch,
  and never append an older response to the new result generation.
- Use deterministic backend ordering with a stable tie-breaker.
- Preserve filter/sort/view state in the URL. A page-number UI must not reappear.

Every unbounded list exposes:

- loaded records currently rendered;
- filtered total; and
- permission-aware overall total for that page's fixed collection.

Example:

```text
已加载 25 · 筛选结果 93 · 全部库存物品 412
```

For Inventory, the overall count includes only stock-bearing items visible to
the current user. It excludes zero-stock Item masters and stock outside the
user's visible warehouse scope. Use page-specific wording for 待处理, Expiry,
and History.

The common page shape remains:

```json
{
  "results": [],
  "total": 93,
  "overall_total": 412,
  "start": 0,
  "page_length": 25
}
```

Apply user filters to `total`; remove only removable user filters for
`overall_total`. Authentication, permissions, company/root boundaries, and fixed
view modes remain in both counts.

## Global toast completion

Implement the previously confirmed app-level toast system for discrete success,
warning, and error events.

- Desktop placement: upper-right.
- Mobile placement: upper-center/nearly full width without obscuring primary
  navigation unnecessarily.
- Default durations: success 4 seconds, warning 6 seconds, error 8 seconds.
- Show a subtle remaining-time progress bar and a small accessible `×`.
- Pause the timer/progress on pointer hover and keyboard focus; resume from the
  remaining time on leave/blur.
- Use appropriate polite/assertive live-region behavior without announcing every
  progress tick.
- Avoid duplicate toasts for one response.
- Keep route-relevant messages across navigation.

Autosave status never uses toast. Saving/saved/unsaved/conflict/completed status
remains inline. Session expiry, concurrency conflicts, setup blockers,
configuration warnings, field-level validation, and persistent sync state retain
their inline/modal presentation. A discrete failure such as final submission may
also emit exactly one toast so it is visible at any scroll position.

Do not make the low-level API wrapper automatically toast every rejection;
callers must retain enough context to avoid duplicate or inappropriate feedback.

## Product-image coverage

### Main image on item-centric surfaces

When an Item has a main image, show its thumbnail everywhere the image materially
helps identify the item:

- Inventory and 待处理 tables/cards;
- Expiry table rows and mobile cards;
- recent-item and item-search results;
- Loan Picker results;
- Workspace quantity/unit/batch/location editor after selection;
- Workspace room/location item rows;
- final transaction confirmation summary; and
- completed/read-only transaction view.

Use the main Item image for dense list thumbnails. Do not display arbitrary
additional gallery images in every list row.

Do not add product thumbnails to surfaces where there is no single clear product
identity, such as transaction-level History rows, filter controls, or general
settings navigation.

Reuse the shared image preview when enlargement is useful. Preserve stable image
dimensions, meaningful alt text, lazy loading for off-screen images, and no
broken/empty trigger when an Item has no image.

Ensure a reopened/read-only Workspace resolves image metadata for all saved
lines through a batched catalog response. Do not rely on transient picker state
or add an N+1 item-detail request.

### Expiry API and UI

`expiring_batches()` must return the Item's main image as part of each aggregated
batch result without an N+1 query. Include `image` in the existing Item fetch,
then render the shared thumbnail/preview beside item identity in both desktop and
mobile expiration views.

The image identifies the Item; batch number, expiry date, quantities, and
locations remain textual batch-specific information.

### Item Detail multi-image gallery

The `/inventory/item/:item_code` page displays all images belonging directly to
the Item.

The item-detail API returns a stable `images` collection constructed from:

1. the Item's `image` field, if set; and
2. every image-type Frappe `File` whose `attached_to_doctype` is `Item` and whose
   `attached_to_name` is exactly that Item.

Rules:

- Check Item read permission before exposing image metadata.
- Respect standard Frappe File/private-file access behavior.
- Exclude non-image attachments using reliable File metadata with a safe
  extension fallback where needed.
- Deduplicate the same URL when the main image is also an attached File.
- Main Item image is first and marked primary.
- Remaining attached images have deterministic order, preferably their upload
  creation order with a stable name tie-breaker.
- Do not include images attached to Inventory Workspaces, Stock Entries, or
  unrelated documents.
- This task is display-only. Do not add a new gallery upload/reorder/delete
  manager.

Suggested response shape:

```json
{
  "image": "/files/main.webp",
  "images": [
    {
      "file_url": "/files/main.webp",
      "file_name": "main.webp",
      "is_primary": true
    },
    {
      "file_url": "/private/files/side.webp",
      "file_name": "side.webp",
      "is_primary": false
    }
  ]
}
```

The page uses:

- one selected large image;
- a thumbnail strip/grid for every returned image;
- clear selected-thumbnail state;
- click/tap on a thumbnail to change the selected large image;
- click/tap or keyboard activation on the large image to open the accessible
  enlarged preview;
- horizontally scrollable thumbnails on narrow screens rather than shrinking
  them to unusable sizes; and
- a graceful no-image state without an empty gallery shell.

### Shared enlarged preview corrections

Finish the partially changed `ItemImagePreview`:

- Replace text `关闭` with a small upper-right `×` whose accessible name is
  `关闭图片预览`.
- Escape closes and restores focus to the trigger.
- Clicking/tapping outside the enlarged image bounding box closes it.
- Click/tap pins the preview for touch users.
- Desktop hover preview closes after the pointer leaves both thumbnail and
  preview, using a short grace interval to avoid flicker.
- Focus can open the preview without making dismissal impossible.
- Outside interaction must not activate a row/link behind a mobile backdrop.
- Keep the popover in the desktop viewport; use a centered lightbox on narrow
  touch layouts.
- Respect reduced-motion preferences.

## Long single-choice controls

The site-wide long-choice rule still applies outside browse filters:

- Long warehouse/category/activity/item choices are searchable and browsable.
- Transaction warehouse controls are hierarchy-aware single-selects and allow
  only permitted leaves.
- Short fixed enums remain simple selects/radios.
- Item Picker and Loan Picker use server-backed search and incremental results,
  not a complete client-side dataset.

## Backend correctness and security

- Treat warehouse and Item Group selections as untrusted.
- Validate selected hierarchy nodes against the current user's permitted scope.
- Expand parent selections on the server and deduplicate descendants.
- Never treat a client-expanded warehouse list as authorization.
- Group warehouse filters may include descendants for reading; groups never
  become stock-holding sources/destinations.
- Preserve ERPNext stock as the source of truth and retain the non-zero
  group-stock diagnostic.
- Bound all page sizes and use stable ordering.
- Avoid N+1 queries for stock, item/category metadata, image URLs, paths, and
  workspace lines.
- Preserve scalar filter compatibility during coordinated migration or update
  every caller atomically.
- Server counts must apply company, root, visible warehouse, Frappe User
  Permission, and DocType permission constraints.

## Accessibility and interaction requirements

- Autocomplete inputs expose labels, expanded state, active option, and selected
  state. Use correct combobox/listbox semantics; if hierarchy cannot coexist with
  a fully conforming ARIA tree-combobox, use a simpler accessible nested option
  structure rather than inaccurate roles.
- Keyboard users can open, search, traverse, select/deselect, remove chips, clear
  a section, and close the suggestion surface.
- Indentation is not the only hierarchy signal; accessible option text contains
  sufficient path context.
- Mobile filter drawers trap focus while modal and restore it on close.
- Independent panes remain usable with keyboard scrolling and browser zoom.
- Incremental loading has a focusable fallback.
- Count changes announce politely only after requests settle.
- Toast progress animation and image transitions honor
  `prefers-reduced-motion`.
- Gallery thumbnails and large-image controls have useful item-aware labels.

## Suggested implementation order

1. Add centralized generic hierarchy and warehouse/category label/path helpers.
2. Extend bootstrap and backend filtering for complete Item Group hierarchy and
   descendant semantics.
3. Build the shared hierarchy autocomplete and regression-test selection
   normalization.
4. Convert Inventory/待处理 filters and establish the independent desktop list
   shell.
5. Reuse the filter/list shell in Expiry and History.
6. Add the common bounded page/count contract and incremental-list composable;
   remove page buttons from all unbounded lists.
7. Implement the app-level toast system and migrate discrete feedback while
   preserving inline autosave/critical states.
8. Finish the shared image preview.
9. Add Expiry images and Item Detail gallery data/UI.
10. Complete item-image continuity in picker, loan, Workspace editor, review,
    and read-only flows.
11. Run focused tests, type checking, backend integration tests, and the
    production build.

## Testing requirements

### Frontend

Add focused tests for:

- warehouse and Item Group autocomplete opening with an empty query;
- matching local labels, full paths, friendly aliases, raw `未指定`, and
  whitespace-normalized slashes;
- category control matching the warehouse control's shared behavior;
- parent selection, overlap normalization, indeterminate/partial state, and
  deselecting one child from a selected parent;
- section clear affecting only its facet and Clear All affecting every facet;
- desktop filter/results panes retaining independent scroll positions;
- mobile drawer scrolling and focus restoration;
- incremental first load, append, end state, deduplication, retry, reset, and
  stale-response rejection;
- loaded/filtered/overall count rendering;
- toast severity durations, progress, hover pause, focus pause, resume, close,
  duplicate suppression, route behavior, and live-region roles;
- autosave changes not creating toasts;
- Expiry desktop/mobile thumbnails and preview;
- preview `×`, outside click/tap, Escape, hover grace, and focus restoration;
- Workspace image presence in editor, item rows, confirmation, and read-only
  state;
- Item Detail image deduplication, primary ordering, thumbnail selection,
  keyboard operation, preview, and empty state.

Run from `frontend/`:

```sh
yarn test
yarn type-check
yarn build
```

Do not launch Playwright, Chromium, camera emulation, or other browser automation
unless the user separately requests it.

### Backend

Add focused coverage for:

- complete Item Group hierarchy metadata;
- parent category expansion and overlapping parent/child deduplication;
- warehouse group expansion, unauthorized nodes, and overlap deduplication;
- correct “all siblings except one child” request state after client
  normalization;
- OR-within and AND-between facet semantics;
- stable 25-record adjacent batches beyond 100 rows;
- filtered `total` and permission-aware `overall_total`;
- Inventory overall count excluding zero-stock/non-visible Items;
- bounded Expiry, History, Item Picker, and Loan Picker endpoints;
- Expiry returning main Item image without an N+1 query;
- Item Detail returning primary plus attached image Files, excluding non-images
  and other documents, deduplicating URLs, and enforcing permission;
- reopened Workspace catalog metadata containing main images for every line; and
- existing stock, permission, group-warehouse, batch, and workspace lifecycle
  invariants.

Run from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If infrastructure cannot resolve/connect to the configured MariaDB host, report
that exact environment failure. Do not claim backend validation passed and do not
weaken production behavior to make an isolated test run succeed.

## Current validation baseline

At audit time:

- `yarn test`: passed, 4 files / 13 tests;
- `yarn type-check`: passed;
- backend integration entry point: not executed successfully because host
  `mariadb` could not be resolved in the current container.

The passing frontend suite does not cover the missing behavior listed in this
task and is not evidence that the product requirements are complete.

## Manual validation checklist

Check widths near 375, 768, 1024, 1280, and 1440 px.

- Warehouse and category facets look and behave like the same autocomplete
  control, with an obvious visual boundary between cards.
- A new user can focus either empty control and browse all permitted values.
- Search and select nested locations/categories, then clear only one facet.
- Select a parent and deselect one child; confirm every sibling remains selected.
- Verify friendly `未指定` wording in filters, chips, transactions, and details.
- On desktop, scroll a long result list while filters stay still; then scroll the
  filter pane while product position stays still.
- On mobile, open/scroll/close the filter drawer and verify result position and
  selections remain intact.
- Scroll through several 25-record result batches without page buttons, reloads,
  duplicates, or jumps.
- Confirm loaded, filtered, and overall counts before/after filtering and append.
- Trigger an append error and retry without losing loaded rows.
- Trigger a submission error from the bottom of a long Workspace and see one
  toast immediately; verify autosave remains inline and quiet.
- Verify toast progress, hover/focus pause, resume, `×`, reduced motion, and
  mobile placement.
- Confirm Expiry shows the product thumbnail and shared preview on desktop/mobile.
- Open an Item with one image, multiple attached images, duplicate main
  attachment, private image, non-image attachment, and no image.
- Verify the Workspace retains the product image from selection through final
  confirmation and when reopened read-only.
- Close enlarged images by `×`, outside interaction, and Escape.

## Non-goals

- Do not redesign inventory accounting or create another stock/image store.
- Do not allow stock in warehouse groups.
- Do not rename/delete `未指定` warehouses solely for presentation.
- Do not add gallery upload, ordering, or deletion management to Item Detail.
- Do not include movement attachments in the Item gallery.
- Do not add product images to transaction-level History rows without a separate
  item-expansion design.
- Do not toast routine autosave success, loading state, or every reactive change.
- Do not retain numbered/previous-next pagination on an unbounded list.
- Do not load all records client-side and describe it as infinite loading.
- Do not replace short fixed-choice controls with autocomplete.
- Do not reset development data or alter stock quantities for this UX task.

## Acceptance criteria

- Warehouse and category facets are matching hierarchy-aware multi-select
  autocompletes, browsable while empty, searchable by local/full paths, and
  visually separated.
- Parent/child selection and partial exclusion are correct and server-authorized.
- Each facet has `清除本项`; the page also has `清除全部`.
- Desktop filter and result panes scroll independently without a third page
  scrollbar; mobile uses a separately scrolling filter drawer.
- All unbounded lists append 25 records automatically with a keyboard fallback,
  stable ordering, retry behavior, and no page buttons.
- Loaded, filtered, and permission-aware overall counts are always available;
  Inventory overall count includes only visible stock-bearing Items.
- The global toast system works with approved timing, progress, dismissal, and
  pause behavior while autosave status remains inline.
- Friendly hierarchical warehouse labels and `未指定` aliases are consistent
  throughout the application.
- Expiry displays the Item's main image with the shared preview.
- Item Detail displays a deduplicated main-plus-attached Item image gallery and
  excludes non-image or unrelated attachments.
- Product main images persist through every appropriate picker and transaction
  stage, including final confirmation and read-only reload.
- Enlarged images close via small `×`, outside interaction, and Escape.
- Frontend tests, type checking, production build, and backend integration tests
  pass, or a genuine environment-only backend limitation is reported precisely.
