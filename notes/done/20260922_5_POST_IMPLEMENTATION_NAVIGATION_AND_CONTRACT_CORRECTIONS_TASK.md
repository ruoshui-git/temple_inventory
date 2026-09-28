# Task 5 — Post-Implementation Navigation, Data Contract, and UX Corrections

## Purpose

Audit and correct the current uncommitted implementation of Tasks 3 and 4. Preserve the useful work already present, but fix the incomplete or incorrect behavior documented below.

This task is based on an implementation audit, frontend type-check/test/build runs, backend tests, and development sample verification performed on 2026-09-22.

Do not edit generated frontend assets. Preserve unrelated user changes. The timestamp-only change in `temple_inventory/desktop_icon/物资管理.json` is unrelated noise and should not remain in the final implementation diff.

## Verified Baseline

The following already works and should not be regressed:

- The six primary destinations are present in the requested order.
- Movement, adjustment, and loan list foundations exist.
- Single-image gallery controls are hidden.
- Batch-enabled items hide the redundant stock-location section.
- Receive item creation defaults the UOM to `Nos` and uses an existing-UOM combobox.
- Item code generation uses the centralized `ITM-######` allocator.
- The development reset completed successfully, sample verification passed, and generated sample/costume Items use six-digit codes.
- Frontend type-check and production build pass.
- Existing backend test suite passes, although required coverage is still missing.

The frontend test suite currently has two failures, and the implementation has additional correctness gaps that existing tests do not cover.

## 1. Desktop Page Identity and Navigation Selection

### Locked title design

Do not keep the current separate `shell-page-title`/`shell-nav-title` placement.

On desktop, replace the top-left visible `物资管理` brand text with a large, prominent dynamic title for the current view. This is preferable to inserting a large heading between the primary and contextual navigation because the header already contains six primary destinations and the contextual choices; inserting another large block between them makes both navigation groups harder to scan.

Use these visible titles where applicable:

- `当前库存`
- `全部物品`
- `效期批次`
- `入库`
- `出库`
- `转移`
- `盘点调整`
- `未结借用`
- `已结借用`
- `仓库`
- `更多`
- `草稿`
- `待处理`

Requirements:

- Render the desktop view title as the page's semantic heading and style it approximately 22–24 px, bold, and visually dominant without increasing the header height excessively.
- Do not also render a duplicate visible title bar inside top-level list content.
- Detail and editor pages retain their own existing page headers. On those routes, the shell may fall back to the small application identity `物资管理` rather than competing with the detail heading.
- On mobile, do not render a shell-generated page-title bar. The fixed primary/context navigation already identifies the active view. Preserve detail/editor headers and any content heading that carries information beyond merely repeating the active navigation label.
- Maintain an accessible single page-level heading even when its visible presentation changes by breakpoint; use an `sr-only` heading if required.

### Make contextual selection canonical and exclusive

The current `currentContext()` uses independent `OR` clauses. It can mark both `当前库存` and `全部物品` selected at `/ ?mode=catalog`, and it marks no option for default `/movements` or `/loans` routes.

Replace this with a normalized contextual-view key derived from route path and query defaults, then compare exact keys. At every route that has contextual navigation:

- Exactly one contextual item must have the selected styling and `aria-current="page"`.
- `/` defaults to `当前库存`.
- `/?mode=catalog` selects only `全部物品`.
- `/expiry` selects only `效期批次`.
- `/movements` defaults to `入库`.
- `/movements?kind=Issue` selects only `出库`.
- `/movements?kind=Transfer` selects only `转移`.
- `/loans` defaults to `未结借用`.
- `/loans?status=settled` selects only `已结借用`.

Normalize invalid query values to the documented default rather than leaving the navigation with no active choice. Add component/router tests that assert the exact number of active primary and contextual items.

### Preserve route-specific state correctly

- Movement contextual links may preserve shared search/category/date/sort filters, but must clear warehouse filters that are invalid for the newly selected movement kind.
- Loan contextual links must preserve loan filters and sort state, including exact loan date, warehouse, item group, activity, search, and ordering.
- Switching among components that reuse `History.vue` must reinitialize destination-specific status, filters, ordering, scroll key, empty copy, and FAB behavior. Do not leak state from movements into adjustments or drafts.
- Observe the mobile contextual-navigation element itself when calculating CSS height variables. Its height must update when routes/breakpoints add, change, or remove contextual navigation.
- Use distinct local icons for 货物流动 and 盘点调整.

## 2. History, Movements, Adjustments, and Drafts

Correct the destination configuration in `History.vue` instead of forcing one movement kind globally:

- `盘点调整` defaults to all adjustment types. Its `全部`, `期初库存`, and `库存盘点` choices must remain selectable and must produce the correct backend filters.
- `草稿` is the unified draft list and must not be forced to `Receive`.
- Fixed route configuration must not inflate the visible active-filter count.
- Draft deletion/navigation must return to `/drafts`, never to the removed `/movements?status=unfinished` URL.
- Use a destination-specific scroll-restoration key.
- Remove stale/dead slots and wording, including the filter placeholder that still mentions the removed 来源 filter.

Movement mobile cards must summarize the same information as the desktop list: date, item-line count, distinct locations, category count/breakdown, and status. Adjustment cards must show type, date, increase-line count, decrease-line count, and status. Do not reuse the old generic history-card layout when it hides these required fields.

### Restore the missing desktop DataTables

货物流动, 盘点调整, and 草稿 currently share `History.vue`, and users can reach those pages without seeing a usable DataTable. Treat this as an implementation regression, not as an intentional empty-page design.

The audit established two separate causes that must both be corrected:

- The read-only backend call for completed `Receive` history returns rows correctly, so a missing 货物流动 table is a frontend render/layout problem rather than absence of backend data.
- The current development data contains a 盘点调整 draft, but the 草稿 page sends a forced `movement_kind=Receive` filter and therefore receives no rows. Remove that forced filter as required above.
- The current development data has no completed adjustment row but does have an unfinished adjustment row. An empty result must still show the correct desktop table header and an in-table empty state; it must not look as though the table failed to render.

Implementation requirements:

- At desktop widths, always mount and visibly size the `SortableDataTable` for all three destinations after page initialization, whether the response contains rows, an empty result, a loading state, or a recoverable error.
- Keep the required destination-specific columns visible while loading and when empty. Render the empty message as a full-width table row or equivalent row-region state under the persistent header instead of as detached copy beneath an apparently missing table.
- Verify the viewport-locked flex/grid height chain from `.shell-content` through `.viewport-list-root`, `.desktop-list-layout`, `.results-column`, and `.results-scroll`. Every `minmax(0, 1fr)`/scroll child must receive a definite non-zero available height; do not rely on an unrelated page's content to establish it.
- Do not conditionally hide the desktop table based on row count, `busy`, `refreshing`, destination, or the presence of facets. The mobile card renderer may replace it only at the documented mobile breakpoint.
- Initial state and route hydration must not leave `busy` permanently true or abort the current request through a route-replacement watcher loop.
- A backend/API error must remain visible together with a retry action and the stable table shell; do not collapse the whole results region.
- Preserve horizontal overflow for narrower desktop/tablet layouts instead of clipping the table or switching to neither the desktop nor mobile presentation.

Add route-level integration coverage for `/movements`, `/adjustments`, and `/drafts`, each with both non-empty and empty responses. Tests must assert the appropriate visible headers and row/empty state after route hydration, not merely assert that a hidden table exists in the DOM. Add at least one browser/layout test at a desktop viewport to catch zero-height, clipping, and breakpoint regressions that DOM-only unit tests cannot detect.

## 3. Loading States and Automatic Pagination

The current loading implementation conflates refresh and append behavior. Correct it across every shared table/card list.

### Refresh

- On filter or sort changes, keep the DataTable component and its header mounted.
- Pass a true row-region refresh state to `SortableDataTable`; do not use its trailing append-loader state for refresh.
- Do not clear the rows merely to trigger an initial-loading layout.
- While refreshing, replace/hide only the row region with one full-width loader and suppress empty-state copy.
- Retain stale-request protection so a slower previous response cannot replace newer results.

### Append

- Keep existing rows visible and render a trailing full-width loader only while an append request is actually in flight.
- Do not render permanent “正在加载更多结果” text merely because more results exist.
- Maintain a distinct append lock to prevent duplicate concurrent observer/fallback requests.
- On append failure, show a full-width retry state without discarding existing rows.

### Scroll roots

Use the actual scrolling element for each breakpoint and container:

- Desktop internal result panes/drawers use their pane as the `IntersectionObserver.root`.
- Mobile document scrolling uses a `null` viewport root.
- Recreate the observer after breakpoint or scroll-root changes.

Known corrections include:

- `History.vue`, `Inventory.vue`, and `Expiry.vue` currently use the desktop result pane as the observer root even on mobile.
- `Loans.vue` currently uses the viewport even though desktop results scroll inside a pane.
- `Pending.vue` removed its button without adding automatic pagination, making later pages inaccessible.
- `ItemPicker.vue` needs a separate append-in-flight state and must not issue repeated overlapping requests.

Verify Inventory, Expiry, movements, adjustments, drafts, Loans, Pending, ItemPicker, and LoanItemPicker. No visible `加载更多` button may remain, but every paginated view must still be able to reach all results.

## 3A. Restore FAB Menu Anchoring

The menu opened by the `+` FAB is positioned incorrectly and part of it appears behind the FAB. This is a confirmed CSS positioning regression.

Current cause:

- `.floating-action-menu` and `.action-fab` are both globally assigned `position: fixed`.
- The fixed child FAB is therefore removed from the menu container's flex layout, so the menu panel is laid out down to the same bottom anchor instead of ending above the button.
- On mobile, the container currently uses only `--mobile-nav-height`, while the child button also uses `--mobile-context-nav-height`. The two pieces consequently use different anchors and can overlap or become detached from one another.

Required solution:

- Make `.floating-action-menu` the single fixed-position anchor.
- Keep its menu panel and its own trigger button in normal container flow, ordered vertically as panel, gap, trigger. Explicitly override `.floating-action-menu > .action-fab` to `position: static` (or use a dedicated non-fixed trigger class).
- On mobile, anchor the whole component above both `--mobile-nav-height` and `--mobile-context-nav-height`, plus the intended spacing and safe-area inset. On desktop, retain the established lower-right inset.
- Keep standalone FABs, such as the direct movement/adjustment creation buttons, fixed using a separate selector; do not break their placement while correcting the composite menu.
- Give the expanded panel enough z-index to remain above page content, sticky toolbars, and the trigger, but below modal/filter-drawer layers. The trigger must remain fully visible and clickable.
- Constrain an unusually tall action menu to the available viewport and make only its action panel scroll. It must never extend behind the bottom navigation or beyond the top safe area.
- Use a component root ref for outside-click containment rather than querying the document for the first `.floating-action-menu`.
- When opened from the keyboard, focus the first menu item. Escape, outside click, selection, and route departure close the menu and return focus appropriately.

Verify the menu on Inventory, Expiry, and Warehouses, at desktop and mobile widths, both with and without contextual mobile navigation. Add a browser/layout assertion that the expanded panel's bottom edge is above the trigger's top edge with the configured gap, that their right edges align, and that neither intersects the primary/context navigation.

## 4. Loan List Backend and Frontend Contract

### Backend

`inventory_api.loans` must not load every loan and every loan line into Python before filtering, sorting, and paging.

- Query and page the permitted parent loan set at the database layer.
- Apply status, permissions, filters, and stable ordering before bounded page hydration.
- Hydrate item previews, activities, and per-loan line summaries only for the requested page.
- Compute facets and totals with permission-safe aggregate queries; do not expose disallowed Item, company, or warehouse values.
- Keep the settled definition inclusive of returned, damaged, and lost resolution outcomes.
- Remove the unreachable legacy implementation that remains after `return _loans_modern(...)`.

Add focused tests for outstanding, partially returned, and settled classification; damaged/lost settlement; each filter; every supported sort; stable paging; bounded preview size; permission-safe totals/facets; and query-count/bounded-hydration behavior.

### Frontend

- Hydrate filters/sort/status from the URL and serialize changes back to the URL so refresh, browser navigation, and copied links preserve list state.
- Use the correct desktop scroll root for automatic pagination.
- Use the established searchable selection pattern for activity rather than a native select when the option set is searchable or nontrivial.
- Render active-filter chips/counts consistently with the other top-level lists.
- Keep row/card navigation to Loan Detail and the direct new-loan FAB.

## 5. History and Item-Detail Backend Correctness

### History aggregation

`_history_hydrate_item_metadata` currently derives Item codes from the short preview list. As a result, rows after the preview limit can be missing category/UOM metadata and can produce incorrect category counts or item changes.

- Derive metadata from the complete permitted child-row set used for aggregation, never from the bounded display preview.
- Category breakdown counts all matching item rows, while category totals count distinct categories.
- Signed item history must aggregate every matching warehouse/UOM pair, not only preview lines.
- Use read visibility/User Permissions for historical data. Do not incorrectly apply operational allowed-leaf warehouse restrictions to read-only history if a warehouse remains visible to the user.
- Replace unbounded full-document materialization/N+1 behavior in summary sorting and facets with stable aggregate queries or another demonstrably bounded approach.
- Preserve deterministic secondary ordering for equal primary sort values.

Add focused tests for all movement filters, separate transfer source/destination filters, reconciliation direction/counts, direct ERPNext and workspace transactions, preview lengths greater than five, signed per-location/UOM item history, permission-safe facets, and stable paging/sorting.

### Item detail

- Return every positive permitted batch balance, including expired batches.
- Add tests proving expired batches appear and hidden warehouses do not leak.
- Ensure recent-history rows always include a meaningful change summary. A row must not fall back to showing only date and type when matching line data exists.

## 6. Item Detail Frontend Corrections

The batch presentation is only partially complete:

- Rename the prominent section to `批次与有效期`.
- Make 到期日期 and 数量 genuinely sortable; the current `toggleBatchSort` is not connected to the table headers.
- Use accessible sort buttons and `aria-sort` state.
- Default to expiry ascending and retain expired positive batches with a clear visual identifier.
- Keep compact cards on mobile.
- Test both sorting directions, the default order, expired rows, and keyboard activation.

For 最近库存变动:

- Show signed quantity, UOM, and location for each applicable change.
- Provide a clear fallback summary when an exceptional row has no line-level changes rather than silently reverting to only date/type.
- Test positive and negative colors and multiple locations/UOMs.

Update the existing Item Detail tests to locate icon-only controls by accessible name rather than expecting visible `编辑` text.

## 7. Count Popovers and Compact Utility Actions

The new count popover and icon-button foundations need completion before they are treated as shared UX components.

### Count popovers

- The closed trigger should present the compact count, not a long sentence such as `查看 2 个位置` as its visible content. Put the full description in the accessible name/tooltip.
- Support hover/focus on pointer devices and tap on touch devices without two popovers appearing open unintentionally.
- Keep the popover open while focus is inside it, close on Escape/outside interaction, and restore focus appropriately.
- Give the popup an accessible label/relationship and keep it within the viewport on narrow screens.
- Register global document listeners during mount and remove them during unmount; avoid setup-time DOM side effects.
- Add keyboard, pointer, outside-click, Escape, and touch-oriented tests.

### Icon actions

The compact icon treatment is currently limited mostly to Item Detail. Apply it consistently to compact utility actions such as scan, filter, selection mode, back, close, and edit where those actions occur in the audited pages.

- Keep submit, cancel, delete, business actions, and FAB menu actions as text.
- Use local SVGs and Chinese accessible names.
- Provide a real hover/focus label on desktop; do not rely solely on the browser's native `title` behavior.
- Preserve an obvious pressed, hover, and keyboard-focus state.

## 8. Item-Code Verification Coverage

The allocator/reset result is correct, but required automated coverage is incomplete.

Add tests for:

- exact first/normal boundary formatting;
- uniqueness under concurrent allocation;
- skipping an existing collision safely;
- explicit exhaustion at `ITM-999999`;
- rejection of a caller-selected Item code through every app-owned creation path;
- sample and costume verification rejecting malformed or duplicate codes.

Do not introduce a legacy rename migration. Do not change Inventory Loan/Return/Loss naming.

The destructive development reset already completed successfully for this implementation. Do not rerun it solely for this corrective task unless allocator/sample creation behavior is changed; if changed, rerun it with the command and authorization established in Task 3 and attach the new verification result.

## 9. Tests and Acceptance

At minimum, add or update coverage for every correction above and run:

```sh
cd frontend
yarn test --run
yarn type-check
yarn build
```

Then run the focused backend tests followed by the complete app backend test suite on `development.localhost`.

Current frontend failures that must be resolved correctly rather than hidden:

- Item Detail expects visible `编辑` text after the action became icon-only; assert its accessible name.
- History sorting expects the old first title column; update the test to the finalized destination-specific column contract.

Final acceptance requires:

- Exactly one selected contextual option on every contextual route, including default-query routes.
- A prominent desktop dynamic view title in the former top-left brand slot, no duplicate desktop content title, and no mobile shell-title bar.
- Adjustments and drafts no longer receive forced incorrect movement kinds.
- 货物流动, 盘点调整, and 草稿 always show the correct desktop DataTable shell and headers, including loading, empty, and error states; existing rows are not hidden by route initialization or zero-height layout.
- Persistent DataTable headers with a row-region refresh loader.
- Working automatic pagination on desktop panes, mobile viewport lists, and drawers, with no visible `加载更多` control.
- Every composite `+` menu opens wholly above its FAB with no overlap, detachment, clipping, or collision with either mobile navigation bar.
- Database-bounded, permission-safe loan/history queries and the specified tests.
- Functional accessible batch sorting and count popovers.
- All frontend and backend test suites, type-check, and build passing.
- No generated frontend assets or unrelated timestamp-only metadata changes in the final diff.
