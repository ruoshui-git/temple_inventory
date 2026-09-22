# Task: Global Feedback, Searchable Hierarchical Filters, and Infinite Lists

## Status and design authority

This is an implementation handoff. Product decisions in this document are
confirmed.

For overlapping behavior, this document supersedes
`notes/20260920_RESPONSIVE_FILTER_DESKTOP_UX_TASK.md`, especially its use of
always-visible checkbox trees and numbered/previous-next pagination. Retain the
older note's compatible accessibility, responsive-layout, permission, and stock
integrity requirements.

Do not edit generated files in `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand.

## Goals

1. Make success, warning, and error feedback visible regardless of the user's
   scroll position through a global toast system.
2. Make long warehouse and category filters compact, searchable, browsable, and
   hierarchy-aware without requiring prior knowledge of the available values.
3. Replace page-oriented browsing with incremental automatic loading throughout
   the site wherever a result set can grow without a practical bound.
4. Clearly show how many records are loaded, how many match the current filters,
   and how many exist in the applicable unfiltered collection.
5. Make image previews reliably dismissible and preserve item images through
   every step of a movement transaction.

Keep the application Chinese and mobile-first. Preserve the inventory,
permission, autosave, session-recovery, scanner, and ERPNext source-of-truth
invariants in `AGENTS.md`.

## Confirmed product decisions

### Global feedback

- Add one app-level toast system used for discrete success, warning, and error
  events throughout the application.
- Desktop toasts appear at the upper-right. Narrow/mobile layouts use an
  upper-center or nearly full-width presentation that does not cover primary
  navigation unnecessarily.
- Default visible durations are:
  - success: 4 seconds;
  - warning: 6 seconds;
  - error: 8 seconds.
- Every timed toast has a subtle progress bar showing its remaining lifetime and
  a small accessible close button (`×`).
- Hovering a toast with a desktop pointer pauses both its timer and progress bar.
  Moving the pointer away resumes from the remaining time rather than restarting
  the full duration.
- Keyboard focus inside a toast also pauses its timer. Moving focus away resumes
  it. A keyboard user must have enough time to read and dismiss the message.
- Toasts remain above ordinary page and drawer content and survive route changes
  when the event that created them is still relevant.
- Do not emit repeated duplicate toasts for the same in-flight failure or one
  server response.

Autosave status is explicitly excluded from toasts. The existing saving, saved,
unsaved/error, conflict, and completed workspace states remain inline and
durable. Routine background saves must not create success toasts.

The following also retain an inline or modal presentation because disappearing
feedback alone would be unsafe or insufficient:

- session expiry and login recovery;
- optimistic-concurrency/save conflicts;
- application setup blockers and configuration warnings;
- field-level validation next to the affected form or confirmation surface;
- loading, refreshing, and persistent sync state.

A discrete failure may create a toast in addition to contextual inline feedback,
but it must be raised only once. For example, a failed final submission should
show a toast immediately even when the relevant field-level explanation remains
inside the form or review dialog.

### Long and dynamic choices across the site

Use the following as the site-wide interaction rule:

- Long or dynamic warehouse, category, activity, and item choices are searchable
  and browsable.
- Multi-select is used for browse filters. Transaction sources and destinations
  remain single-select because one stock line must resolve to one leaf warehouse.
- A closed filter remains compact. Focusing or clicking an empty filter opens a
  height-limited list of available choices, so a new user can discover values
  without knowing what to type.
- Typing filters the same list; it must not replace discovery with a mode that
  shows nothing until text is entered.
- Suggested placeholder copy is `搜索或浏览仓库 / 位置` and `搜索或浏览物品类别`.
- Selected values appear as removable chips and remain visible when the
  suggestion list is closed.
- Each filter section has its own `清除本项` action. It clears only that section,
  appears or becomes enabled when the section has selections, and has an
  unambiguous accessible name such as `清除所有仓库 / 位置筛选`.
- The existing page-level `清除全部` action remains available to clear all
  filter sections and text search together.
- A suggestion list has a bounded height and its own controlled overflow. One
  section must never push the next filter section out of the viewport.
- On mobile, the same model may use a drawer or bottom sheet to provide enough
  space. It must preserve selections when dismissed.
- Short fixed choices such as movement kind, return outcome, warehouse type, and
  a two-option sort direction remain radios, segmented controls, or simple
  selects. Do not turn every select into autocomplete for visual consistency.

### Filter semantics

- Values selected within one facet are ORed.
- Different facets are ANDed with one another and with text search.
- An empty facet means all applicable values. Do not store or submit a synthetic
  `all` value alongside real selections.
- Selecting a warehouse group includes all visible descendant leaf warehouses.
- Selecting a parent item category includes all descendant leaf categories.
- Overlapping parent and child selections are normalized for requests so they do
  not duplicate records, counts, or backend work.
- Preserve explicit user-facing filter choices in the URL even if the request is
  normalized into a descendant union internally.
- Filter changes apply automatically, reset the loaded result set, and return to
  the beginning. There is no Apply/Search button.
- Text search is debounced by approximately 300 ms. Discrete selections apply
  immediately.
- Abort or ignore stale requests so an older response cannot overwrite a newer
  query.

### Warehouse hierarchy and labels

Build hierarchy from `parent_warehouse`, `lft`, and `rgt`; never infer it from
names, delimiters, or depth. Do not hard-code `第1寺院` and `第2寺院` as the only
possible temple labels.

An unfiltered browse list uses indentation and concise local labels:

```text
第2寺院
  A02（全部位置）
    房间内，未细分到货架
    货架1
    货架2
```

The temple heading and ancestors provide context. Descendants do not repeat a
leading `第2寺院`, room name, or other already-visible ancestor unnecessarily.
Search and selected chips may show a fuller breadcrumb when needed to
disambiguate identical local labels in different branches.

Search matches:

- the full hierarchy path;
- concise/local labels;
- stored warehouse labels;
- friendly aliases described below; and
- slash variants with or without surrounding whitespace, such that
  `A02/货架1` can match `A02 / 货架1`.

Matching should be case-insensitive where applicable and must not expose the
ERPNext company suffix as meaningful user-facing context.

### Friendly handling of `未指定`

`未指定` leaves are real stock-holding warehouses used when stock is assigned to
a room or temple but not to a more specific shelf/location. Never hide one if it
can contain stock, and never merge or rewrite the underlying ERPNext Warehouse
record merely to simplify display.

Translate these leaves contextually in the UI:

- a room-level `<room> / 未指定` leaf is shown as
  `房间内，未细分到货架` beneath that room;
- a temple-level `<temple> / 未指定` leaf is shown as
  `寺院内，未分配房间` beneath that temple;
- if a room has only its `未指定` leaf and no named child locations, collapse the
  redundant group/leaf presentation into one visible choice named only after the
  room, such as `A02`;
- if a room has other children, distinguish its group choice as
  `A02（全部位置）` and show the friendly `未指定` leaf separately;
- transaction controls offer only real leaf warehouses. They do not offer a
  group/`全部位置` as a stock source or destination;
- search for the literal raw term `未指定` must continue to find these choices,
  even though friendly copy is displayed by default.

Centralize this label/path behavior. Inventory filters, transaction selectors,
item details, history, expiry, settings, and chips must not each implement a
different warehouse-name rule.

### Item-category hierarchy

Item categories may have child categories. Fetch and retain the hierarchy rather
than exposing only `is_group = 0` categories in bootstrap data.

- Build it from ERPNext Item Group hierarchy fields (`parent_item_group`, `lft`,
  `rgt`, and `is_group`) rather than parsing names.
- Present parent and child categories using the same indentation and concise
  local-label technique as warehouses.
- Focusing an empty category filter shows the complete permitted category tree
  in a height-limited browse list.
- Selecting a parent includes its descendant leaf categories. Multiple selected
  parents/leaves form a deduplicated union.
- Search matches both a category's local label and its full ancestor path.
- A selected chip includes enough path context to distinguish duplicate local
  labels.
- Group expansion/collapse is local UI state and must not issue inventory
  requests.

### Incremental automatic loading

Potentially unbounded browse/result lists use incremental loading as the default
site behavior. This includes Inventory/待处理, Expiry, History, item search, loan
item search, and other dialogs or lists that can grow materially. Small bounded
configuration lists and short fixed-choice controls do not gain infinite loading
merely for consistency.

- Load 25 records initially and append 25 when the user approaches the end.
- Use an intersection sentinel rather than a global window-scroll calculation.
- Retain an accessible `加载更多` fallback/control so keyboard users and browsers
  without a functioning observer are not blocked. It is incremental loading, not
  numbered pagination.
- Do not replace or flash away already loaded records while appending.
- Deduplicate appended records by a stable identifier.
- Stop requesting when the loaded count reaches the filtered total.
- If an append fails, retain all loaded rows and show an inline retry at the end
  of the list as well as the appropriate toast. Do not reset filters or return to
  the top.
- A filter, mode, or sort change clears the old accumulated result set, resets
  `start` to zero, and loads the new first batch.
- A stale response from a prior filter generation must never append into the new
  result set.
- Stable deterministic backend ordering is mandatory so adjacent batches neither
  skip nor repeat rows.
- Avoid list virtualization unless measurement demonstrates it is necessary.

Every such list displays three concepts when they differ:

```text
已加载 25 · 筛选结果 93 · 全部库存物品 412
```

- `loaded`: records currently rendered by the client;
- `total`: records matching the active filters;
- `overall_total`: records in that page's applicable unfiltered collection after
  permissions and its fixed view/mode constraints are applied.

For 查看库存, `overall_total` means items with stock visible to the current user.
It must not include zero-stock Item masters or stock outside the user's visible
warehouse scope. Use page-appropriate wording elsewhere, for example
`全部待处理`, `全部记录`, or `全部有效期批次`. Fixed modes such as completed versus
unfinished History are part of that page's base collection, not a removable
user filter for purposes of `overall_total`.

Keep the count visible near the search/results toolbar while browsing long
lists. Count changes should use a polite live region after a filter request
settles, not announce on every keystroke.

## Page and component requirements

### 查看库存 and 待处理

- Keep the wide desktop results layout and compact table/cards as appropriate.
- Use a sticky, viewport-bounded filter region on desktop. It contains compact
  independent searchable warehouse and category sections rather than one fully
  expanded checkbox tree.
- On narrower layouts, keep text search visible and open the same filters in a
  drawer/bottom sheet.
- Opening a section with no query shows its hierarchy for discovery. Typing
  refines it.
- Selected filter chips remain outside a closed mobile filter drawer.
- Provide both section-level `清除本项` and page-level `清除全部`.
- Replace previous/next controls with the confirmed 25-record incremental load.
- Show loaded, filtered, and overall visible-stock counts.
- Preserve current available/total/reserved calculations, attention reasons,
  per-location summaries, and item-detail navigation.
- Keep the last successful results visible during a background filter refresh
  where doing so is not misleading. Use a non-blocking refreshing indicator.

### Expiry and History

- Use the same searchable/browsable hierarchy controls, chips, section clearing,
  automatic filtering, stale-request protection, and incremental-list behavior.
- Preserve their page-specific filters and backend semantics.
- History's completed/unfinished switch remains a prominent view mode.
- Expiry retains date filters and its short sort control.
- Provide page-appropriate `loaded`, `total`, and `overall_total` labels.

### Item and loan pickers

- Item/category/warehouse search fields follow the same discoverable long-choice
  rules, while stock source/location selection remains single-choice.
- Search results load incrementally and show useful counts without using page
  buttons.
- Preserve recent items, scanner/barcode continuity, create-new-item continuity,
  stock-only behavior, and the active transaction state.
- Loan results must be paginated on the server before adding client-side infinite
  loading; do not load every outstanding loan and only then filter in the
  browser.

### Transaction warehouse controls

- Any warehouse selector that can contain a long list becomes a searchable,
  browsable, hierarchy-aware single-choice control.
- Show group hierarchy for orientation but make non-leaf/group rows
  non-selectable in stock source/destination controls.
- Apply the centralized friendly `未指定` labels.
- Preserve validation against current allowed leaf warehouses on the server.

### Settings and other bounded forms

- Reuse hierarchy labels/search where a manager must choose among many warehouse
  parents or locations.
- Do not apply infinite loading to small fixed administrative enums or a bounded
  settings form.
- Preserve explicit Save behavior for settings mutations.

## Image preview behavior

Update the shared item-image preview rather than adding page-specific lightbox
implementations.

- Replace the large text `关闭` button with a small `×` button in the preview's
  upper-right corner. Its accessible name is `关闭图片预览`.
- Escape closes the preview and restores focus to the trigger.
- Clicking/tapping outside the enlarged image bounding box closes it.
- Clicking/tapping the thumbnail opens a pinned preview suitable for touch.
- A desktop hover preview may remain transient. It closes when the pointer has
  left both trigger and preview; use a short grace interval to avoid flicker when
  moving from the thumbnail into the preview.
- Keyboard focus provides an equivalent way to open and inspect the image.
- A desktop preview remains a bounded popover positioned within the viewport. A
  narrow/touch presentation may use a centered lightbox with a backdrop.
- Outside interaction must not accidentally activate the row or link behind the
  preview.
- Use meaningful item-name alt text, stable image dimensions, lazy loading for
  off-screen thumbnails, and reduced-motion preferences.
- If an item has no image, do not render a broken image or empty preview trigger.

## Transaction image continuity

If an Item has an image, keep it visible through every relevant movement stage:

1. item search/recent results;
2. the quantity, unit, batch, and source/destination editing step;
3. the added-item list grouped by room/location;
4. the final confirmation summary;
5. the completed/read-only transaction view.

Use a consistent compact thumbnail in dense lists and a somewhat larger but
bounded image in the single-item edit step. Reuse the shared preview behavior
where enlargement is useful. A user must not lose the visual identity of the
selected item when advancing from the picker to the quantity/location drawer or
reviewing the final submission.

Ensure reopened workspaces can resolve image metadata for every saved item
without relying only on transient picker state. Fetch it in an existing batched
workspace/catalog response or another bounded bulk request; do not issue an N+1
request per line.

## Backend/API contract

### Common page shape

Potentially unbounded endpoints should use a consistent bounded page shape:

```json
{
  "results": [],
  "total": 93,
  "overall_total": 412,
  "start": 0,
  "page_length": 25
}
```

- `total` applies all user filters.
- `overall_total` removes removable user filters but retains authentication,
  permissions, company/root restrictions, and fixed page modes.
- Bound `page_length` server-side and use deterministic ordering with a stable
  tie-breaker.
- Keep scalar filter compatibility where an existing caller still uses it, or
  migrate every caller atomically and document the break.

### Warehouse filters

- Treat all requested names as untrusted.
- Validate requested nodes against the current user's visible warehouse tree.
- Expand groups into visible descendant leaves on the server.
- Union and deduplicate overlapping selections.
- Never accept a client-expanded leaf list as authorization.
- A group is valid as a read filter but never becomes a valid stock-holding
  warehouse.

### Item-category filters

- Bootstrap/API metadata must include the permitted Item Group hierarchy, not
  only leaf groups.
- Validate requested category nodes.
- Expand parent categories into descendant leaf categories on the server and
  deduplicate overlaps.
- Apply OR semantics within the category facet and AND semantics against other
  facets.
- Preserve stable results when a hierarchy node is renamed or two local labels
  are the same by using actual DocType names as values.

### Counts and performance

- Compute counts after applying user/company visibility rules.
- Inventory `overall_total` counts distinct visible items with non-zero stock in
  the applicable visible warehouse universe. It must not count all Item masters.
- Do not compute `overall_total` by downloading all results to the browser.
- Avoid N+1 queries for stock, item images, warehouse paths, categories, or
  transaction rows.
- Reuse common parsing, hierarchy expansion, and page-shape helpers across
  Inventory, Expiry, History, and picker endpoints.
- Preserve the existing non-zero group-stock diagnostic and ERPNext stock as the
  sole inventory source of truth.

## Suggested frontend structure

Names are illustrative, not mandatory contracts:

- an app-level `ToastProvider`/toast viewport mounted in `App.vue`;
- a small typed toast service/composable with `success`, `warning`, and `error`;
- a reusable hierarchical searchable multi-select for browse facets;
- a reusable hierarchical searchable single-select for transaction locations;
- centralized warehouse/category path and friendly-label utilities;
- a reusable incremental-list composable handling generation IDs/abort,
  append/reset, counts, observer state, retry, and end-of-list state;
- the existing `ActiveFilterChips` extended with section clearing where useful;
- the existing `ItemImagePreview` corrected and reused.

Do not make the generic API wrapper automatically toast every rejected request.
Callers need enough context to avoid duplicate messages and to decide when a
failure is already represented by a session modal, conflict state, or field
error. A shared error-reporting helper may be used, but ownership of each toast
must remain explicit.

## Accessibility requirements

- Toast success messages use a polite status/live region. Errors that require
  immediate attention use an assertive alert without repeatedly re-announcing
  updates to the progress bar.
- Toast progress bars are decorative or have stable accessible text; their
  animation must not flood assistive technology.
- Pausing works for both hover and focus. Close buttons are keyboard reachable.
- Respect `prefers-reduced-motion` for toast, drawer, dropdown, progress, and
  image-preview animation.
- Searchable controls have programmatic labels, expanded state, listbox/tree
  relationships, selected state, and predictable keyboard navigation.
- If a full ARIA tree/listbox combination cannot be implemented correctly, use a
  simpler nested list of options with clear buttons/checkboxes rather than
  inaccurate ARIA.
- Indentation is not the only hierarchy cue; preserve accessible ancestor/path
  text.
- Mobile drawers/lightboxes trap focus only while modal and return focus to their
  invoker on close.
- Incremental loading is usable without a pointer through the `加载更多` fallback.
- Counts use polite live announcements only after settled changes.

## Error and empty states

- Initial-load failure: show a contextual retry and an error toast.
- Filter-refresh failure: retain the last successful set when safe, keep active
  filters, and offer Retry.
- Append failure: retain loaded rows and put Retry at the list end.
- Empty unfiltered list: explain that there are no applicable records.
- Empty filtered list: say that no records match and offer section/page filter
  clearing.
- End of list: show a quiet `已显示全部` state rather than continuing observer
  requests.
- No available filter options: explain whether this is due to configuration,
  permissions, or genuinely absent data; do not present a blank popup.

## Implementation sequence

1. Add and test centralized hierarchy/path/label helpers, including friendly
   `未指定` behavior and category paths.
2. Extend backend hierarchy metadata, descendant expansion, bounded paging, and
   `overall_total` contracts with focused integration tests.
3. Add the app-level toast foundation and migrate discrete feedback without
   touching autosave status or persistent blockers.
4. Build reusable searchable hierarchical selection controls with discovery and
   section clearing.
5. Build the incremental-list composable and apply it first to 查看库存/待处理.
6. Apply the same default rules to Expiry, History, item/loan pickers, and other
   demonstrably unbounded lists.
7. Correct the shared image preview.
8. Add transaction image continuity, including reload/read-only behavior.
9. Run focused validation and production build; do not manually edit build
   output.

## Testing requirements

### Backend integration tests

Add focused coverage for:

- one and several warehouse selections;
- a selected warehouse group including only visible descendant leaves;
- overlapping warehouse parent/child selections without duplicates;
- unauthorized, outside-root, missing, and malformed warehouse values;
- parent and child Item Group selection and overlap deduplication;
- warehouse/category OR-within and AND-between semantics;
- stable 25-record batches beyond 100 records;
- deterministic adjacent batches with no missing or repeated rows;
- filtered `total` versus permission-aware `overall_total`;
- Inventory `overall_total` excluding zero-stock and non-visible items;
- History, Expiry, item search, and loan search bounded pagination;
- existing group-stock detection and stock calculations remaining intact;
- workspace item/catalog responses containing image metadata after reload.

Run from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

### Frontend unit tests

Add focused coverage for:

- toast duration by severity;
- progress advancing, pausing on hover/focus, and resuming from remaining time;
- manual dismissal, route persistence, duplicate suppression, and live-region
  roles;
- autosave updates not emitting toasts;
- focusing an empty filter exposing browsable options;
- warehouse and category indentation/path search;
- full-path, concise-label, raw-label, and slash-normalized matching;
- friendly room-level and temple-level `未指定` labels;
- collapsing a room with only one `未指定` leaf;
- parent selection, indeterminate state where applicable, and overlap
  normalization;
- `清除本项` clearing only its facet and `清除全部` clearing every facet;
- URL serialization/hydration of explicit multi-selections;
- incremental first load, append, completion, reset, retry, and deduplication;
- stale filter and append responses being ignored;
- loaded/filtered/overall count rendering;
- image preview close button, outside click/tap, Escape, focus restoration, and
  hover transition between trigger and preview;
- item images appearing in picker, line editor, workspace rows, confirmation,
  and read-only transaction rendering.

Run from `frontend/`:

```sh
yarn test
yarn type-check
yarn build
```

Do not launch Playwright, Chromium, camera emulation, or other browser automation
unless the user separately requests it. The user performs final browser
validation.

## Manual validation checklist

Test representative widths near 375px, 768px, 1024px, 1280px, and 1440px.

- Trigger a final-submission error while scrolled to the bottom of a long
  workspace; the toast is immediately visible and the contextual message remains
  understandable.
- Verify success/warning/error timing, progress, close, hover pause, focus pause,
  resume, reduced motion, and multiple messages.
- Confirm autosave success does not produce toast noise.
- Open warehouse/category filters without typing and browse the available
  hierarchy.
- Search `A02/货架1`, full paths, local labels, and `未指定` aliases.
- Verify temple descendants are indented without repeating the temple prefix.
- Verify nested categories use the same hierarchy treatment.
- Verify room and temple fallback locations use friendly labels and remain
  selectable/filterable where appropriate.
- Clear one section without disturbing other selections; then clear all.
- Scroll long Inventory, 待处理, Expiry, History, and picker results through
  several automatic loads without page jumps, duplicates, or full reloads.
- Verify loaded, filtered, and overall counts at the start, after filtering, and
  after appending.
- Simulate append failure and recovery without losing existing rows.
- Open an image by hover, keyboard, click, and touch; close with `×`, outside
  interaction, and Escape.
- Complete and reopen each movement type with item images visible throughout the
  flow.
- Confirm long hierarchy labels do not create horizontal page scrolling.

## Non-goals

- Do not change inventory accounting, create a parallel stock ledger, or allow
  stock in group warehouses.
- Do not rename/delete `未指定` ERPNext warehouses solely for presentation.
- Do not add saved/favorite filters or expensive facet counters in this task.
- Do not toast routine autosave success, loading state, or every reactive field
  change.
- Do not make transaction warehouse fields multi-select.
- Do not use infinite scrolling for short enums or bounded settings forms.
- Do not load all records client-side and call it pagination.
- Do not introduce a second UI component dependency when the existing Vue/Frappe
  UI stack and focused local components can support the behavior.
- Do not reset sample data or modify stock quantities as part of this UI task.

## Acceptance criteria

- A submission error is visible at any scroll position through a global toast,
  with severity timing, progress, dismiss, hover pause, and focus pause working.
- Autosave status and critical persistent states remain inline and do not create
  toast noise.
- Long warehouse/category controls are compact when closed, show browsable
  choices when focused empty, search full hierarchy paths, and retain selected
  chips.
- Warehouse and Item Group children are indented with concise labels; selecting
  a parent includes its permitted descendant leaves without duplication.
- `未指定` stock remains accessible but is presented with the confirmed friendly
  contextual wording.
- Every filter section has a one-action clear control, and the whole page still
  supports Clear All.
- Potentially unbounded lists automatically append 25 records, have an accessible
  fallback, never use next/previous pages, and survive append errors without
  losing loaded results.
- Lists always expose loaded, filtered, and applicable overall counts. Inventory's
  overall count includes only stock-bearing items visible to the current user.
- Enlarged images close via a small `×`, outside interaction, and Escape.
- Item images remain present from selection through quantity/location editing,
  final confirmation, and completed/read-only transaction views.
- Server-side permissions, company boundaries, hierarchy validation, leaf-stock
  restrictions, and deterministic bounded queries remain authoritative.
- Focused backend/frontend tests, type checking, and the production build pass,
  with environment limitations reported precisely.
