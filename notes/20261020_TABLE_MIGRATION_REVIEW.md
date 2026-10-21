# Table migration review — 2026-10-20

## Shared surface and disposition

`frontend/src/components/ui/DataTable.vue` is the only component that renders a native HTML `<table>` in the application source. It owns table geometry, responsive horizontal scrolling, sorting intent, selection intent, group rows, retained/loading/error/empty states, pagination affordances, density and column settings. It does not fetch data or navigate. `ReportTable.vue` is the report-cell adapter over that renderer; `MovementHistoryTable.vue` is the movement-history adapter and retains history-specific cells and actions.

| Surface | Shared renderer / adapter | Notes |
| --- | --- | --- |
| Inventory stock browse and expiry batches | `DataTable` | Separate image, item name, code, category, unit, quantity/status fields; location, batch and expiry details remain dedicated cells. Lazy grouping uses `group_page`. |
| Movement and loan item / record browse | `DataTable`, `MovementHistoryTable`, `ReportTable` | Item summaries use Item as the default group; phone layouts retain the Item card disclosure and mount no duplicate browse table. History remains a separate disclosure with one loan-scope control; record rows preserve document, related-loan, source/destination, status and settlement actions. Group pages load by path and unit. |
| Pending damage report and generic Reports | `ReportTable` | Report page roots seed group state; descendant groups use lazy pages. Pending action slots stay in the report adapter. |
| Native drafts and count records | `DataTable` | Native document identity, status, site time, full-document quantities and editor/delete actions stay on record rows; grouping is available per supported records view. |
| Activity list | `DataTable` | Activity metadata groups use the metadata report projection. Linked movement and loan tabs remain separate record views. |
| Count workspace and native count editor | `DataTable` | The editable line grid keeps its original item/location/batch identity, blank-versus-zero semantics, validation, notes and history actions. Grouping is intentionally not applied inside this editor grid because collapsing duplicate business lines would obscure unfinished inputs; the counts records browse remains groupable. |
| Product and batch detail balances/locations | `DataTable`, `MovementHistoryTable` | Current balances and batch/location rows remain distinct from movement history; batch navigation has an accessible name. |
| Recovery summary, stock details and movement history | `DataTable` through feature adapters | Existing recovery review, history expansion and document actions are preserved. |
| Quick export and report secondary tables | `ReportTable` | Report cells and preferences are shared. Secondary result tables load on disclosure; query grouping is applied to the selected main table. |

The table inventory scan was `rg -n '<table\b' frontend/src --glob '*.vue'`; its only result was `frontend/src/components/ui/DataTable.vue`. There are no remaining feature-owned raw HTML tables.

## Group and sort contracts

Group controls use the ordered `ReportQuery.groupBy` list, limited to valid sequences for the active view. `useReportGroups` owns root and child pages, expansion, retry, per-parent pagination, collapse/reopen retention and back/forward intent. It stores expanded paths and loaded page counts, not result rows; restoring a query re-reads the root and only re-fetches previously expanded child paths, so a permission change while away cannot expose stale rows. Requests pass `{query, parent_path, parent_unit, start, page_length}` to `temple_inventory.projections.group_page`; identical labels in different stock units remain separate. Report main-page groups seed root rows from `report_page`; the renderer emits expand/retry/load-more intent only.

Group rows use server `display_count` and `count_label`, which describe the underlying row grain (stock rows, allocations, documents or activities). Counts do not depend on the currently loaded page. Group snapshots are scoped to the current site and account and are cleared when either changes.

Sort requests use the canonical scalar allowlist for the active view, and the server sorts the full filtered result before paging with native identity as a stable tie-breaker. Stock, expiry, movement, loan, pending, count, activity, warehouse, and draft browse tables pass the supported fields into shared header controls; any separate sort menu updates the same query state. Reports' primary result table also has sortable headers wired to its existing query sort state. Images, action columns, and compound mixed-unit summaries remain unsortable. Legacy `name`, `quantity` and `batch` aliases are rejected and incompatible saved browse queries reset to canonical route defaults. `MovementHistoryTable` now owns an independent sort state, defaulting to date descending regardless of the parent browse query. Its endpoints sort the complete grouped history before paging, with loan allocation quantities and other supported scalar fields available where meaningful. Loan settlement/balance disclosures retain their domain chronology.

## Verification and remaining review

- `pnpm type-check` — passed.
- `pnpm test` — passed, 70 files / 450 tests.
- `pnpm build` — passed; Vite transformed 375 modules and generated PWA assets.
- `pnpm exec prettier --check` on the changed table consumers, preference/group controllers and focused tests — passed.
- Focused inventory group consumer test — passed through category → Item → raw stock leaf, verifying each child request waits for expansion, Item selection uses `item_code`, location/batch display uses server fields, and Item navigation keeps its code.
- Focused movement/loan group test — passed with the phone Item card active, no duplicate item table surface, a single loan-history scope selector, and settlement actions still attached to the selected native loan.
- Focused report-group summary test — passed for movement quantities by kind/status and loan borrowed/returned/outstanding values with their units; meaningless zero `stock_qty` is omitted.
- Focused Reports header sort test — passed; clicking a supported primary result header updates the canonical query field/direction and reloads the report.
- Focused short-viewport column-settings test — passed; the settings panel stays within the viewport when opened near its bottom edge.
- No DB-backed or mutation-heavy browser test was run for this package. The parent agent is doing the live read-only route review and will report its findings separately.

## Final F follow-up — 2026-10-20

- Drafts without a route query now start from the Movement records query contract, so the initial sort field is valid before the controller selects the records view.
- Movement and loan detail-history endpoints take independent `sort_by` and `sort` inputs, default to date descending, and sort full grouped results before pagination. The history controller sends its local sort state separately from the parent browse query.
- Column preference writes merge from the locked persisted `DefaultValue` row instead of the request's cached defaults; the stale-cache regression verifies an intervening table preference survives.
- Retired compact-filter selectors were removed from `foundation.css`. Source has no `.preview-drafts-table` sizing rule or generic first-column/first-button minimum-width selector.
- Movement item results have a single overall load-more control in `DataTable`; the other load-more controls are for individually expanded groups or details.
- Item, batch and stock balance tables expose scalar sorting with separate unit columns; paginated batch locations request sorting from the server before paging. The count editor tables expose image, Item name and Item code columns separately.
- Initial final frontend verification passed: `pnpm test` (72 files / 457 tests), `pnpm type-check`, and `pnpm build` (377 modules). Targeted Ruff format/check and Python compile passed for touched Python sources. Parent read-only browser review was outstanding at that point.
- The DataTable column editor was moved into `document.body` with the shared overlay z-index to clear the sticky browse toolbar. Reordering restores keyboard focus to a valid control on the moved column; Escape closes the panel and returns focus to its trigger. Its focused portal/viewport/preference and keyboard tests passed (10/10); type-check and the follow-up build passed (377 modules, 87 PWA precache entries).
- Final post-overlay frontend verification passed: `pnpm test` (72 files / 458 tests), targeted Prettier check for the touched table consumers/tests, and `git diff --check`.

Independent live review is complete; the final evidence and fixes are recorded in [the implementation record](20261020_BROWSE_API_STANDARDIZATION_IMPLEMENTATION.md#independent-integration-review--2026-10-20). The count editor grouping exception is limited to its unfinished editable input grid; read-only count records remain groupable.

## Final frontend follow-up — 2026-10-20

- Recovery-summary tables use normalized stable preference IDs (`Item` and `Stock Reconciliation` become `recovery-summary.item` and `recovery-summary.stock-reconciliation`) and leave the restored recovery payload untouched. Focused recovery and route-breadcrumb tests passed (6 tests); breadcrumb labels persist across query-only tab changes and reset when the named route identity or params change.
- Density now changes control and table-thumbnail geometry while text size and line height remain independent. Mobile retains 44px controls. Column-order buttons use the shared control token, and count action columns stay unwrapped with their domain text in separate cells.
- Final integrated frontend gates: `pnpm test` — 72 files / 462 tests passed; `pnpm type-check` passed; targeted Prettier check passed; `pnpm build` passed (377 modules, 87 PWA precache entries).
- No DB-backed test or browser review was run by this frontend validation pass. The parent subsequently completed the live browser rechecks; see the final independent review and evidence gallery.


## Independent acceptance

The parent verified persisted show/hide, reorder/reset, required columns,
keyboard/Escape focus, viewport-bounded column controls, actual history sorting,
Quick Export, image/selection isolation, shared phone cards, real recovery after
Back, theme changes and editable count densities against the production bundle.
The final recovery/density run had no page errors, console errors, failed requests
or preference failures. Three density modes retained 100 editable count inputs;
text remained 14px while padding, thumbnails and controls changed as specified.
[Evidence gallery](artifacts/20261020-standardization/README.md),
[final rechecks](artifacts/20261020-standardization/recovery-and-density.json).

## Final sticky layout review

The desktop navigation height is measured separately from the mobile bottom
navigation. Browse chrome, table scroll targets and the hierarchy rail use the
measured offset. Stock now shares the 250px bounded rail instead of stretching
with result height. Independent live checks passed at 1440px, 1024px, a short
1366×768 desktop, 390px phone and 200% text. The rail has one working vertical
scroller; search stays uncovered and the document does not overflow horizontally.
The final frontend suite passed 72 files / 462 tests, type-check, targeted Prettier
and the production build (377 modules, 87 PWA entries).
[Live measurements](artifacts/20261020-standardization/sticky-layout.json).
