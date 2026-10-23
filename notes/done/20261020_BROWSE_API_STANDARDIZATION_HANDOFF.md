# Inventory browsing, API, and navigation standardization handoff

Date: 2026-10-20

Status: implementation handoff, not an implementation or acceptance record.

This document consolidates the user's decisions from the planning conversation,
including the later hybrid hierarchy-sidebar and URL-reorganization decisions.
It is intended for an orchestrator that delegates bounded implementation work,
then independently reviews correctness, completeness, and the live UI.

## 1. Outcome and scope

Deliver a consistent Inventory application with:

- A shared desktop datatable foundation, meaningful density settings, flattened
  columns, account-saved column settings, and up to two grouping levels.
- Persistent search with integrated active-filter chips, Scan, Filters, and
  Expand/Collapse controls.
- A synchronized, optional warehouse/category hierarchy sidebar.
- An accessible filter megamenu, with an in-place date editor and quarter presets.
- Desktop top navigation with an Inventory dropdown.
- Organized URLs, named navigation, and breadcrumbs driven by one route model.
- Theme coverage across every custom Inventory page and overlay.
- Clean app-owned ERPNext customizations and current-format sample data.
- Permission-safe reuse of expensive read calculations for at most 15 seconds.

Prefer clean replacement over compatibility. Update schema, API callers, route
helpers, types, fixtures, samples, and tests together. Do not retain retired
endpoints, URL aliases, database columns, or style layers merely to support
temporary development data.

The user permits resetting/reseeding `development.localhost` when necessary.
This is not authorization to reset another site, change ERPNext/Frappe core,
deploy production, or destroy browser-only unfinished input.

### Out of scope

- A custom importer, image-import workflow, or new import shortcut.
- Column resizing, pinning, formulas, arbitrary custom fields, organization-wide
  layouts, or generic spreadsheet editing.
- A new Favorites/saved-search subsystem. Existing report saved views remain.
- Hierarchy-node result counts. Table group counts ARE included.
- Replacing dashboards, metadata forms, or management trees with tables.
- ERPNext Desk and native login-page theming.
- A separate design-preview site or a parallel inventory/attachment ledger.

## 2. Reading order, evidence, and orchestration

Read `AGENTS.md`, `UI_UX_DECISIONS.md`, and `DESIGN_SYSTEM.md` before implementation.
The latest user choices summarized here supersede conflicting historical UX
entries; record those supersessions in the decision documents during the change.
Do not silently treat old preview restrictions as current requirements.

Inspect these user-provided visual references:

- `notes/odoo-table-group-ref/`: flat tables, expandable groups, group counts.
- `notes/odoo-filters/`: embedded menu trigger, selection states, wrapping chips.
- `notes/odoo-multi-level-sidebar-filters/`: hierarchy sidebar and selection.

Use these as interaction/layout references, not as authority to copy Odoo's stock
model, selection semantics, or all of its features.

### Initial audit findings — recheck before acting

The planning audit found:

- All 33 then-current Custom Field fixtures existed in the development database.
- One extra app-owned field existed:
  `Stock Reconciliation.ti_count_warehouse`.
- Submitted sample `MAT-RECO-2026-00001` had a value in that old singular field,
  while `ti_count_warehouses` was empty.
- No extra app-owned DocTypes, app-owned Property Setters, Client Scripts, or
  Server Scripts were found in that audit. There were many native ERPNext
  Property Setters and other customizations that must NOT be blanket-deleted.
- `Inventory Dimension` is an ERPNext-owned DocType, not a retired app artifact.
- `temple_inventory/patches.txt` contained no registered cleanup patches.
- Reports build a temporary SQLite projection per request. ReportContext has
  request-local caches, not cross-request projection reuse.
- Six dashboard cards make separate requests with overlapping calculations.
- Ordinary browse-table cells used fixed 12px padding; reconciliation used
  5px vertical / 8px horizontal padding.
- Stock's filter column stretched with the result grid; other browse rails used
  a separate 70dvh cap. These are symptoms to eliminate, not geometry to retain.
- Route title inference mislabels some management pages and does not distinguish
  several list/create/edit/detail destinations.
- Hard-coded colors remain in shared styles despite global theme tokens.

One uninstrumented live desktop run observed approximately 2.2s for Stock, 2.6s
for Movement, 1.5s for Reports, and 5.5s until all dashboard cards finished.
These are leads, not benchmark averages or acceptance thresholds.

The planning browser run used the production app at
`http://127.0.0.1:8000/inventory`. The dev login provided by the user is
`Administrator` / `admin`. Confirm the current server/site before using it.
The available headless Chromium lacked Chinese fonts; geometry was inspected,
but those screenshots are not valid final Chinese typography evidence.

### Work packages and review gates

Use `gpt-6-luna` for implementation, formatting, type checks, and code-based tests.
Use `high` reasoning for route/state changes, grouping, cache/permissions, and
editable-table integration; `medium` is suitable for bounded style/token or
leaf-consumer migrations after contracts are established. Announce the exact
model identifier and reasoning for each delegation. Give each work package its
required sections of this handoff, owned files/contracts, and acceptance cases.

The orchestrator owns independent review, cross-package integration, live browser
inspection, and final completeness. Do not accept a subagent's passing tests or
completion claim as sufficient evidence for the whole task.

Use blocking agent-wait tools while delegated work runs; do not repeatedly poll
or generate reasoning/status text just to wait. Give meaningful updates when
there is new information. Avoid simultaneous ownership of shared contracts.

Recommended sequence:

| Package | Work | Review gate |
| --- | --- | --- |
| A | Baseline inventory, customization audit, current tests, route/table coverage checklist | Scope and existing failures recorded |
| B | Route registry, canonical URLs, navigation, breadcrumbs, recovery links | Direct-entry/Back/unsaved-input checks |
| C | Query/group/column contracts and server grouping | Group totals, permissions, pagination validated |
| D | Shared table, density, column preferences | Representative read-only and editable consumers pass |
| E | Shared search, filters, hierarchy sidebar, date editor | One state across all surfaces; no clipped controls |
| F | Migrate every in-scope consumer and remove obsolete implementations | Coverage checklist complete |
| G | Projection cache and metadata/query optimizations | Concurrency, invalidation, permission review |
| H | Clean schema/samples, theme pass, integrated build and visual acceptance | Real app, all required routes/states verified |

These packages may be split further. Integrate and review before moving a flawed
contract into many consumers. Caching must follow the final query/group contract;
it must not hide incorrect uncached results.

## 3. Repository map and architecture constraints

Main source locations:

| Concern | Existing source |
| --- | --- |
| Routes/navigation | `frontend/src/router.ts`, `lib/appNavigation.ts`, `lib/nativeNavigation.ts`, `lib/recoveryNavigation.ts`, `lib/nativeEditorRoute.ts` |
| Shell/breadcrumbs | `components/AppFrame.vue`, `components/ApplicationShell.vue`, `App.vue`, `lib/pageDomain.ts` |
| Search/filter controls | `components/ui/BrowseToolbar.vue`, `components/filters/BrowseFilters.vue`, `CompactFilters.vue`, `ui/HierarchyFilter.vue`, `ui/PeriodFilter.vue` |
| Filter/query state | `lib/browseQuery.ts`, `lib/filterPresentation.ts`, `lib/hierarchySelection.ts`, `lib/sitePeriod.ts`, feature controllers |
| Tables | `components/ui/ReportTable.vue`, `MovementHistoryTable.vue`, feature-owned raw tables, `features/counts/CountWorkspace.vue` |
| Preferences/themes | `lib/displayPreferences.ts`, `lib/uiPreferences.ts`, `features/settings/`, `temple_inventory/preferences.py` |
| Styles | `styles/app.css` importing `foundation.css`, `forms.css`, `utilities.css`, `browse.css` |
| Client API/state | `services/contracts.ts`, `services/frappeServices.ts`, `lib/api.ts`, `lib/browseMemory.ts` |
| Read projections | `temple_inventory/browse.py`, `report_query.py`, `report_sources.py`, `projections.py`, `periods.py` |
| Native semantics | `native_api.py`, `native_access.py`, `native_stock.py`, `native_balances.py`, `counts.py`, `native_topology.py` |
| Exports/attachments | `exports.py`, `native_files.py`, `file.py` |
| Schema/setup | `fixtures/custom_field.json`, app DocType JSON, `hooks.py`, `deployment.py`, `sample_install.py`, `native_samples.py` |
| Reset tool | `scripts/reset-development-samples` |

Keep coordinators thin, business state in feature controllers, and shared UI
presentational. Tables/search widgets must not fetch data or mutate router state
independently. Keep exactly one responsive surface active through the shared
`useResponsiveLayout` contract (1024px, mobile-first without DOM).

Preserve native autosave, optimistic versions, idempotent request identities,
private attachment authorization, count blank-versus-zero semantics, explicit
submission, cancel/amend behavior, and native Desk/API parity. Shared table work
must not accidentally change these invariants.

## 4. Canonical routes, navigation, and breadcrumbs

### Route registry

Use one typed route model for stable names, paths, navigation ownership,
breadcrumb parents/labels, and page capabilities. Navigation callers use named
routes and parameters, not scattered path strings or prefix matching.

Keep the existing `/inventory` application prefix. Paths below are relative to it:

| Page | Canonical path / view |
| --- | --- |
| Home | `/` |
| Stock | `/stock` |
| New Item | `/stock/items/new` |
| Item detail/edit | `/stock/items/:code`, `/stock/items/:code/edit` |
| Expiry | `/stock/expiry` |
| Batch detail | `/stock/batches/:name` |
| Warehouses/detail | `/stock/warehouses`, `/stock/warehouses/:name` |
| Categories | `/stock/categories` |
| Damaged/Pending stock | `/stock/damaged` |
| Movement browse | `/movements?view=items` or `?view=records` |
| New movement | `/movements/new/:kind` |
| Native Stock Entry | `/movements/:name` |
| Loan browse | `/loans?view=items` or `?view=records` |
| Loan contextual overview | `/loans/:name` |
| Counts browse/new/native reconciliation | `/counts`, `/counts/new`, `/counts/:name` |
| Activities/list/new/detail/edit | `/activities`, `/activities/new`, `/activities/:name`, `/activities/:name/edit` |
| Native drafts/local recovery hub | `/drafts` |
| Reports | `/reports` |
| Display settings | `/settings` |
| Configuration/recovery | `/settings/setup` |
| More menu | `/more` |
| Login completion | `/auth-complete` |

Defaults for Movement/Loan browse are `view=items`. Keep validated existing
movement-kind identifiers for `:kind`; do not invent a second kind vocabulary.

Native document routing maps `Stock Entry` to `/movements/:name` and
`Stock Reconciliation` to `/counts/:name`. Preserve appropriate opening-stock
versus count behavior after loading the native reconciliation. Unsupported
DocTypes must not be routed to an arbitrary editor.

The Loan overview and native Stock Entry editor are different page purposes, not
aliases. A Loan overview's native-record action opens the canonical movement
editor. Return/Loss/etc. creation uses the canonical new-movement route with
existing contextual query parameters.

There is no separate `/stock/items` list: Item breadcrumbs can link to `/stock`.
Do not invent empty pages merely to make every URL segment a breadcrumb.

### Query state and safe navigation

- View, filters, sort, grouping, and drill-through context are query state.
- Use the top-level `view=items|records` as the browser-mode authority.
- Centralize route encoding/decoding. On browse URLs, omit duplicated dataset/view
  fields from the serialized query payload and reconstruct them from the route
  and top-level view. Reports retain their complete dataset/view query.
- Preserve existing scope/record/loan/editor identities needed by workflows.
- Native IDs remain exact; test URL encoding for Unicode, spaces, and slashes.
- Replace callers in pages, dashboard links, export links, detail links, recovery,
  post-save navigation, return paths, and tests.
- Retire old aliases rather than maintaining a compatibility router.
- Unknown URLs get a deliberate not-found state, not a silent Home redirect.
- Reconstruct recovery destinations from stored native identity/workflow data.
  Do not wipe unfinished browser input or silently reinterpret its schema because
  paths changed. Surface any unresolvable recovery entry with preserved input.
- Keep navigation guards and actual Back/Forward restoration working. Route
  replacement after autosave must not discard input or change document identity.

### Top navigation and breadcrumbs

Desktop top navigation: 首页、库存、货物流动、借用、报表、更多, with account identification.
Inventory opens a dropdown with 库存列表、效期批次、仓库、损坏待处理. Triggering the
dropdown does not navigate. Support keyboard access, current-page indication,
Escape, outside-click dismissal, and focus return. No desktop Inventory submenu row.
Preserve mobile navigation and contextual access.

Breadcrumbs derive from route definitions and already-authorized page data,
not URL-string splitting or a second handwritten path map. Typical examples:

- `寺院物资 / 库存 / 物品名称 / 编辑`
- `寺院物资 / 库存 / 效期批次 / 批次编号`
- `寺院物资 / 盘点调整 / 记录编号`
- `寺院物资 / 活动 / 活动名称`

`更多` is a menu arrangement, not a domain or breadcrumb ancestor. Categories
belong to Stock even if their shortcut remains in More. Stock Entry editors have
Movement ownership; Loan contextual overviews have Loan ownership. Accessing an
Item from a Loan does not change the Item's canonical breadcrumb; Back returns to
the originating Loan.

Every routed page gets one accurate breadcrumb, including create/edit/detail,
management, reports, and auth completion. Reuse it in loading/login/error/initial
setup shells without duplication. Do not fetch otherwise-inaccessible names for
labels. Current segments are noninteractive with `aria-current="page"`; ancestors
are guarded links. Handle long names, loading, and unavailable records.

## 5. Persistent search and filter surfaces

### Search bar

One shared bar remains mounted and usable in expanded and compact headers:

1. Active filter and ordered grouping chips.
2. Text input.
3. Trailing Scan (where supported), Filters, and Expand/Collapse actions.

Remove the compact Search button/modal; use the actual persistent input. Reuse
the existing scanner, scan result behavior, camera selector, and cleanup. It must
not become a new scanning subsystem or replace an exact Item filter with fuzzy
search unless the current feature already behaves that way.

Keep title and record/item switches visible. Creation/export actions retain their
expanded placement. Selected-row workflow actions remain independently reachable.

Use available width before wrapping. Reserve 12rem for typing on desktop, clamped
to available width on small screens. Chips grow the bar vertically; exceptionally
many chips get a region capped at 30dvh and internally scrollable while typing and
actions stay reachable. Measure actual header height for sticky tables and focus
visibility. Expansion/collapse must not remount the input, lose focus, or reset
query/controller state.

Text search is debounced. Cancel superseded work and reject out-of-order replies.
Do not run searches during intermediate IME composition.

### Filter panel and canonical state

The embedded filter button opens a viewport-bounded desktop panel with Filters
and Group By sections. On phones it opens a sheet. Use accessible form/dialog
semantics; this is not an ARIA menu of action-only items.

Keep it open during multiple selections, indicate selected states, and support
Escape, outside dismissal, keyboard operation, and focus return. Ordinary filter
changes apply immediately; date editing uses explicit Apply/Cancel.

There is exactly one canonical filter state shared by:
sidebar, panel, chips, URL, tables/cards, grouping, summaries, analysis, and exports.
No sidebar-specific query, independent copy of selections, or duplicated API call
from presentation components.

Preserve OR within a multi-select field and AND across independent fields.
Preserve same-contributing-allocation constraints where required by existing
movement/loan filtering. Do not copy unrelated Odoo filter logic.

Use compact field chips, e.g. `位置：A02、A04` or `分类：食品 +2`.
Click opens that editor; the chip's X clears that field. The editor exposes every
selected value and individual removal. Keep ordered grouping chips distinct.
Do not repeat selected-value chips inside the hierarchy sidebar.

Remove redundant external filter buttons and active-filter rows. Keep current
quick-filter capabilities through the same canonical controls; do not duplicate
independent quick-tab state. Preserve fixed record/context restrictions separately
from user-editable filters, and never silently broaden a restricted export.

### Hierarchy sidebar — latest decision

The final decision is HYBRID, not removal of all sidebars:

| Page/view | Initial desktop sidebar |
| --- | --- |
| Stock, Expiry, Pending | Open |
| Inventory/expiry Reports | Open |
| Movement, Loans, other Reports with hierarchy filters | Available, closed |
| Pages without these filters | Absent |

Persist open/closed preference per account and stable page/view key in native
user defaults, with local caching. A saved preference overrides initial defaults.
On mobile, use the filter sheet regardless of desktop preference.

The sidebar contains category and warehouse trees only:

- Parent selection covers authorized descendants; partial branches are indicated.
- Expanding/collapsing a node does not select it.
- Tree search changes visible options, not the applied scope.
- Preserve `无分类` independently.
- Existing selection normalization removes redundant descendants covered by a
  selected ancestor. Preserve child deselection behavior.
- Source and destination filters stay separately labeled in the Movement filter
  panel, rather than adding two more permanent trees to the sidebar.

Selections ALWAYS appear in the search bar, even when the sidebar is open.
Removing a chip updates the tree. Hiding the sidebar never clears selection.

Clicking a hierarchy chip or panel entry:

- If the sidebar is visible: close the panel and focus/reveal that sidebar section.
- If hidden: open the same reusable tree editor inside the panel without forcing
  the user's sidebar preference to change.

Provide a labeled sidebar show/hide affordance within the shared browse/filter
controls; do not make discovery depend on an unlabeled thin edge.

Place the rail below the shared browse header beside results, with preferred
250px width and remaining viewport height. One vertical scroller, collapsible
sections, reachable hide/clear controls, no nested fixed-height tree boxes.
Long hierarchy labels retain horizontal access. Do not compute per-node counts
in this round.

### Date editor

Extract reusable content from `PeriodFilter.vue` and place it within the existing
filter panel/sheet, not a second stacked modal.

- Preserve all existing presets and arbitrary inclusive custom dates.
- Date state is drafted until Apply; validation is inline.
- Apply updates once. Cancel/Escape/panel dismissal discards only unapplied date
  edits, not other filters already applied.
- Clicking an active date chip opens the editor with the applied value.
- Add `this_quarter` / 本季度 (quarter-to-date) and `last_quarter` / 上季度
  (complete previous calendar quarter).
- Add year selection with Q1–Q4. These mean the full selected calendar quarter,
  including future days if selected, and materialize as `custom` bounds.
- A fixed `2026 Q1` selection must not roll to another year on later reopening.
  Show year and actual bounds; allow either boundary to be edited afterward.
- Keep existing 本周/本月/本年 semantics, which currently end at site today.
- Resolve relative periods from the Frappe site's date, never the browser clock.
- Update frontend previews, server validation, saved queries, exports, and cache
  keys together. Relative-date cached data must not survive a date-boundary change.
- Preserve separately labeled transaction/related-record period scopes.

## 6. Shared datatable system

### Responsibilities

Create one shared table foundation under `components/ui/`. It owns rendering,
column geometry, sort affordances, selection controls, group expansion UI,
loading/error/empty/retained-refresh states, load-more controls, density, theme,
column settings, keyboard operation, and horizontal scrolling.

It receives typed rows/columns/state and emits intent. Controllers own data,
authorization, routing, grouping requests, persistence, and workflow actions.
Thin domain-specific cell components/formatters are appropriate; copy-pasted
full tables or a giant string-name switch for every feature are not.

Extract native labels, quantities, warehouse presentation, timestamps, badges,
and links into reusable formatters/cells. Existing ReportTable and history
components may become thin domain consumers, but retire their duplicate table
geometry/interaction engines. Do not create a compatibility wrapper that leaves
the actual old implementations unchanged.

### Required consumer coverage

| Surface | Required outcome |
| --- | --- |
| Stock | Shared desktop table default; keep useful table/card switch |
| Expiry and Pending | Shared desktop tables; appropriate mobile cards |
| Movement and Loan records | Shared flat/grouped table |
| Movement and Loan by Item | Shared expandable Item-group presentation |
| Activities list | Shared desktop table, preserve activity details/editor |
| Native Drafts and Counts history | Shared table, separate local recovery inputs |
| Reports and Quick Export | Shared table renderer |
| Analysis previews | Shared grouped/scalar table renderer |
| Item/Batch/Warehouse/Loan/Activity histories and balances | Shared embedded tables |
| Reconciliation | Shared foundation with domain-specific editable cells |
| StockDetails and other remaining native data tables | Shared cells/layout; document genuine exceptions |
| Warehouse/category management | Keep management trees |
| Dashboard, metadata, configuration/settings, non-tabular editors | Keep suitable presentation |

Inventory existing raw `<table>` sites and record their disposition; do not stop
after migrating the main Stock table. Preserve capabilities, links, errors,
selection, detail disclosures, and private file/image handling.

Desktop defaults to tables. Existing phone-friendly cards remain; use the same
controllers and filter/group state. Exactly one responsive surface is mounted.
Shared table preferences still apply when a table is available on mobile.

### Columns and sorting

- Flatten image, Item name, Item code, category, quantity, and stock unit into
  separate columns. Stock category is visible by default.
- Retain useful stock fields: available, loaned, damaged, and concise
  location/expiry information; additional scalar fields can be optional columns.
- Flatten document identity, type, status, date/time, source, destination,
  borrower, and activity where the dataset provides them.
- A date/time instant can remain one logical column. Do not mechanically split
  a meaningful scalar solely because its label has two words.
- Multi-location and mixed-unit summaries remain honest summaries/drill-throughs,
  not fake scalar fields. Never add a sortable combined-unit numeric total.
- Remove generic first-column/`:has(button)` minimum-width rules; define widths
  according to content. Keep data readable through horizontal scrolling.
- Sort meaningful scalar columns over the COMPLETE filtered dataset before
  pagination, with a stable native-identity tie-breaker.
- Use an explicit supported-column registry/server sort allowlist. Images,
  action controls, and compound summaries are not sortable.
- Visible header sorting and other sort controls share one state.
- Image viewing, checkbox selection, links, and row activation must not trigger
  one another accidentally.
- Remove visible `· 批次资料` from each Expiry row; the Batch ID remains a link
  with an accessible name describing its destination.

### Density

Use shared tokens, including cell padding, controls, and thumbnails:

| Preference | Cell padding | Controls / intent |
| --- | --- | --- |
| compact | 5px vertical, 8px horizontal | 32px desktop controls; reconciliation baseline |
| balanced (normal) | 12px | 36px desktop controls; current ordinary-table spacing |
| spacious | 18px vertical, 16px horizontal | 44px controls; visibly larger spacing |

Keep the existing preference identifiers; display labels may say normal for
balanced. Text scale is independent, rows grow for content/errors, and phone
interactive targets remain >=44px. Remove fixed sizes that defeat density.
Reconciliation must retain blank-vs-zero input, validation, pagination retention,
baseline review, and reachable actions.

### Column preferences

Every shared table has a top-right icon with accessible label `设置列`:

- Show/hide, reorder using keyboard-accessible controls, restore defaults.
- Protect required identity/editing/selection/action columns where hiding them
  would make the workflow unusable. Do not permit an empty visible column set.
- Persist per account + stable table/view ID in Frappe user defaults.
- IDs describe table purpose, not current URL, native record name, or filter.
  Item-history preferences should apply across Item details, for example.
- Local cache is namespaced by site and account; it contains presentation settings
  only. Clear in-memory state on account changes.
- Reconcile preferences with current permitted columns: drop unknown/retired
  fields, add new ones according to default visibility, restore required fields.
- Show save failure without silently claiming synchronization; retain local user
  choices for retry. Merge updates per table so saving one table does not erase
  another table's preferences.
- Preferences must not grant fields/permissions or change export content.

No resizing, pinning, arbitrary fields, formulas, or organization layouts.

## 7. Grouping contracts and correctness

Replace the current single `grouping` field with ordered `groupBy: string[]`,
length 0–2, unique validated fields. Update frontend/backend, routes, report named
views, projections, and exports together; do not retain a dual legacy query schema.
Reset incompatible saved report definitions explicitly rather than misreading them.

### Semantics by data grain

Offer grouping only where a field is meaningful at the current row grain:

| View grain | Suitable group fields |
| --- | --- |
| Stock Item summary | Category, Item |
| Stock location/batch detail and Expiry | Category, Item, warehouse/location |
| Movement document records | Movement type, native status, activity, posting month |
| Movement allocation detail | Item, category, source, destination, type, activity, month |
| Movement Item browse | Item; optional Category → Item |
| Loan Item browse | Item; optional Category → Item |
| Loan document records | Borrower, activity, loan state, posting month |
| Loan allocation/outcome detail | Item, borrower, activity, outcome, month |
| Activity metadata | Activity type, status |
| Native drafts/count records | Native type where mixed, status where applicable, month |
| Count allocation detail | Item, location, month |

Only expose applicable fields from this matrix; a homogeneous dataset need not
show a meaningless constant grouping. Do not offer document-level category or
location grouping when one document spans multiple categories/locations.

An Item summary's expandable native history is a detail disclosure. It does not
change current balances into the sum of history rows and does not count as a
third configurable grouping level. Item views default to Item grouping.
Removing grouping can show flat Item summary rows with explicit detail expansion.

### Server behavior

- Group over the full authorized filtered result, before any page slicing.
- Return stable group IDs/paths, labels, row grain, full counts, appropriate
  aggregates, and child pagination metadata.
- Groups and each expanded child collection are independently paginated.
- Group expansion fetches only requested children; never preload every group.
- UI retains loaded data on collapse, with independent retry/loading states.
- Cache identity includes validated grouping, parent path, sorting, and scope.
- Use deterministic ordering and identity tie-breakers; never sort just loaded rows.
- Preserve full-document quantities once per matching native document in record
  views. Allocation views use matching allocations. Do not substitute one for the
  other to simplify grouping.
- Keep all numeric aggregates unit-separated. Item counts, distinct documents,
  and allocation counts must be labeled correctly.
- Overlapping distinct-document counts across allocation groups are not additive.
- Loan outstanding values must follow native loan/settlement rules; preserve
  current settled-Item toggle and per-Item history scope.
- Explicit totals must distinguish original borrowing, settlements, outstanding
  balances, stock quantity, and available-stock effect.
- Query changes reset incompatible child pagination/expansion. Back/Forward
  restores the saved query and expansion without resurrecting unauthorized rows.
- Keep existing load-more interaction; do not introduce numbered-page UX just
  because the reference screenshots have it.

Reports/exports must understand the new grouping contract. Exports cover complete
requested data and use fresh calculation; collapsed groups and visible columns
must not silently limit exported data.

## 8. Theme consistency

The shared foundation remains `--p-*` tokens from the document root.

- Cover canvas/surface, text/muted text, borders, accent/on-accent, selection,
  focus, success/warning/danger/info, backdrops, shadows, and artwork controls.
- Extend centralized definitions for jade, bronze, and blue; eliminate fixed
  presentation colors in shared/page styles.
- Inspect table cells, group rows, chips, top nav/dropdown, filter/tree/date
  panels, column settings, pagination, toasts, scanner controls, image lightboxes,
  standalone access states, and teleported overlays.
- Theme changes must apply immediately to already-open overlays.
- Semantic status colors retain meaning and readable contrast in every theme.
- Product images, camera content, and theme preview swatches are intentional
  exceptions; don't recolor them.
- Retire dead preview styles/classes only where their removal is verified.
  Do not undertake an unrelated repository-wide naming/formatting rewrite.
- Preserve shared typography and independent text-scale accessibility.

## 9. Customization cleanup and sample data

Create a repeatable read-only audit of app-owned metadata against:

1. Current fixtures and app DocType JSON.
2. App hooks/setup code and current API/callers.
3. Confirmed historical retirement names from git/history/reset preflight.

Do not infer ownership merely from a generic name such as `Inventory ...`.
Report uncertain ownership instead of deleting it.

Remove confirmed obsolete app metadata/source, including singular
`ti_count_warehouse`. Do not add a singular-to-plural compatibility API or retain
an orphan column for historical temporary sample data. The preferred resolution
for the observed submitted sample/schema conflict is the exact-site clean reset
and reseed after current source/seeding is ready.

Inspect the reset tool and supply existing credentials through supported
environment mechanisms; do not guess database-root credentials or modify
Docker hostnames. The wrapper rejects other site names and preserves existing
Administrator authentication. Do not run reset concurrently with tests/browser
sessions, and do not bypass its safety checks.

If a reset cannot run, report the concrete blocker and finish source/audit work;
do not improvise broad SQL drops. Removing Custom Field metadata alone is not
proof that obsolete physical columns were removed.

Update samples/preflight/verification:

- Only current app schema is created.
- Counts use `ti_count_warehouses` and current review metadata.
- No retired workspace/loan/return/loss DocTypes or fields reappear.
- Samples exercise multiple categories, warehouses, batches, units, movement
  types, loan settlements, count variance, and enough rows for pagination.
- Keep media in normal Frappe File/native Item fields.
- Verify balances through native stock records after reseeding.

Do not preserve unrelated native ERPNext customization removals as app cleanup.
This is not a production migration plan.

## 10. Cache and API performance

First profile uncached reads and confirm correctness. Main candidates are shared
projections, repeated metadata loads, and overlapping dashboard calculations.
Do not replace ERPNext balance semantics with Bin-only arithmetic to make a
benchmark faster.

### Cached material

Cache immutable, permission-scoped read projection snapshots in existing Redis,
reusable by pagination, grouping, summaries, analysis, and compatible cards.
Serialize data, not live Frappe documents, ReportContext instances, connections,
or a shared mutable SQLite file. Never create a persistent alternate stock ledger.

Default maximum reusable age is 15 seconds from calculation snapshot time, not
15 additional seconds after an expensive build finishes. Preserve that timestamp.
If calculation is already too old, return the fresh result to its caller but do
not advertise it as a reusable fresh cache entry.

Use a bounded serialized entry size (initial limit: 4 MiB); bypass larger results
without retaining the entire large export solely to test cache size. Keep values
immutable across callers. Redis entries expire automatically.

Separate base projection identity from page/group slices where possible so
requesting page 2 does not necessarily rebuild the source projection. Include all
actual calculation inputs; column visibility/order are presentation, not inputs.

Keys include site, account, normalized query, resolved date bounds/site date,
configuration/authorization revision, data generation, and implementation version.
Normalize types and equivalent defaults; never key on raw request strings.

### Authorization and invalidation

- Every hit still checks session, account binding, app access, and current
  authorization context. User-scoped keys alone do not solve permission revocation.
- Invalidate for contributing stock/ledger/reconciliation, bundle/batch, Item,
  category, warehouse, activity, configuration, attachment, sharing, user
  permission, and role/DocPerm changes.
- Audit native Desk, import, rename, and background reposting paths. Some native
  writes use direct database updates; document-save hooks alone are not sufficient.
  Use appropriate app hooks/cache-clear integration without editing core.
- Publish invalidation after commit; rolled-back changes must not publish dirty
  data or replacement snapshots.
- Capture a generation before reading the underlying snapshot and compare again
  before publishing/serving. A slow old computation must not be stored under a
  new generation after a concurrent stock or permission change.
- Do not serve cached data within a write transaction that has uncommitted
  contributing changes. Bypass for tests/jobs/writes unless their read-only
  lifecycle is explicitly established.
- If authorization freshness cannot be established for a scope, bypass caching.
  Correctness and access restrictions take precedence over hit rate.

### Concurrency and failure behavior

- Coordinate equivalent concurrent misses with a bounded per-key lock.
- Waiters recheck cache; don't block indefinitely or hold database row locks
  while waiting for Redis computation.
- Redis/lock failure falls back to ordinary fresh calculation. Never return an
  empty success, stale-forever result, or swallow a real validation/permission error.
- Add explicit refresh bypass to the service/read boundary.
- Keep editor loads, count baselines, stock availability validation, writes,
  submit/cancel/amend checks, and export generation fresh.
- Reuse equivalent inventory/expiry calculations for dashboard cards while keeping
  card-specific loading, retry, and errors.
- Batch repeated metadata reads and use request-local memoization where safe.
- Client duplicate-read suppression is account-scoped and read-endpoint opt-in.
  It must not deduplicate mutations or allow one caller's cancellation to abort
  other consumers. Clear pending reuse on account changes.

## 11. Required verification and acceptance evidence

Keep an explicit route/table requirement checklist. Record pass/fail with evidence,
not just a statement that the broad feature is implemented.

### Code checks

Run from `frontend/`:

```sh
pnpm test
pnpm type-check
pnpm build
```

Use focused tests during individual packages; run the suite at integration.
Formatting is targeted Prettier for touched frontend files and Ruff for touched
Python. Do not rewrite the whole repository. Build generated assets through Vite,
never hand-edit `public/frontend/` or `www/inventory.html`.

Run from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run
```

Extend the existing rollback-only suites and runner for new invariants as needed.
Do not substitute tests that merely mirror the implementation.

Required behavior cases:

- Routes: every canonical route, old URL not-found, unknown DocType, encoded
  identifiers, direct refresh, named link destinations, view/query serialization,
  breadcrumbs/loading labels, top-nav selection, browser Back/Forward,
  unsaved-input guards, post-save replacement, recovery identity preservation.
- Filters: sidebar/panel/chip synchronization, sidebar hidden with active filters,
  preference restoration, parent/partial/child selection, tree search, no forbidden
  nodes, uncategorized, source versus destination, fixed-context constraints,
  same-line matching, complete summary/export agreement.
- Search: IME, debounce, abort/out-of-order responses, many chips, field clearing,
  active group order, expansion/collapse without lost input/focus.
- Dates: custom Apply/Cancel, invalid/reversed/missing dates, leap years,
  quarter/year boundaries, full future quarter versus quarter-to-date,
  browser/site timezone disagreement, relative-date rollover, two date scopes.
- Grouping: zero/one/two levels, duplicate/unsupported fields rejected, full groups
  before paging, independent child pages/retry, no collapsed-child fetches,
  stable ordering, mixed units, multi-allocation native documents, nonadditive
  distinct-document counts, loan/settlement histories.
- Tables: shared rendering contracts, independent image/link/checkbox actions,
  complete-result sorting, empty/error/refresh states, load more, required columns,
  reorder/reset persistence, permission-filtered columns, account/site isolation.
- Responsive: 1023/1024 transition, one active surface, controller state retained,
  no duplicate fetching/observers, mobile cards and desktop tables agree.
- Native editing: reconcile blank versus zero, validation visibility, editable
  cells after density/columns change, baseline review, autosave/version conflicts,
  explicit submit, attachments, cancellation/amendment.
- Cache: cold/hit/expiry, snapshot age, normalized keys, oversized bypass,
  Redis/lock failure, concurrent misses, explicit refresh, write transaction
  bypass, rollback, post-commit invalidation from Desk/native writes, permission
  revocation, old in-flight build racing a new generation, fresh exports.
- Schema/samples: retired artifacts absent, native customizations preserved,
  current count fields populated, stock/loan balances verified.

### Independent browser review

Review production routes backed by the actual development Frappe site, not just
mocked API tests. Use the existing native-server Playwright configuration as a
reference, but do not blindly run mutation-heavy acceptance specs during a
read-only visual pass.

Cover:

- 1440px desktop, 1024px desktop, 1366x768 or equivalent short viewport,
  390px phone, and effective 200% zoom/text scaling.
- All three themes and density modes on representative browse, grouped,
  detail/history, report, and editable reconciliation tables.
- Stock, Expiry, Pending, both Movement/Loan modes, Activities, Drafts, Counts,
  Reports/Quick Export, Item/Batch/Warehouse/Loan detail, categories, settings,
  setup, new/edit workflows, and shell access states.
- Search with many long chips, open megamenu, open tree/date/column editor,
  sidebar opened/closed, collapsed header, expanded two-level groups, load more,
  empty/error/retained-refresh states.
- Keyboard focus and screen-reader naming; sticky content must not cover the
  active row, input, menu action, or reconciliation action area.
- Theme switching while overlays are already open.
- Scanner open/close/reopen and camera resource release; retain hardware/manual
  entry and don't mistake camera emulation for real-device verification.

Use Chinese-capable fonts for final screenshots. If unavailable, remedy the
browser environment without altering production typography solely for tests,
or explicitly mark typography acceptance incomplete.

Sandbox network access may hide the running local server or Docker DNS.
`mariadb`, `redis-cache`, and `redis-queue` are expected service names.
Follow AGENTS.md's escalation guidance; distinguish connectivity failure from
actual test failures. Don't replace the configured host with localhost.

### Performance evidence

Compare equivalent uncached and cached queries with the same user/scope/data:

- Stock, Expiry, Movement items/records, Loan items/records, Reports, dashboard.
- First load, immediate repeat, next page, group expansion, after relevant write,
  after permission change, and explicit refresh.
- Record elapsed time, query/build counts, cache outcome, and response sizes.
- Warm equivalent reads must avoid repeating the expensive projection build.
- Verify dashboard reuse and no eager loading of collapsed group children.
- Report cold-path cost as well as warm gains; do not promise an unsupported
  absolute latency target or hide regressions behind cache hits.

## 12. Documentation and completion

Update `UI_UX_DECISIONS.md` and `DESIGN_SYSTEM.md` with dated supersessions:

- Top nav and Inventory dropdown replace the desktop app sidebar.
- Shared persistent search replaces compact Search-modal behavior.
- Hybrid hierarchy sidebar replaces both the old all-filter rail and the earlier
  proposal to remove all sidebars.
- All active hierarchy restrictions remain visible as synchronized search chips.
- Shared tables/flattened columns/two-level groups/column settings/density.
- In-place dates and quarter presets.
- Canonical URLs and route-driven breadcrumbs; More is not a breadcrumb domain.

Keep durable UX rules in those documents; keep implementation details/evidence in
a separate implementation/review note. This handoff remains the specification,
not a report that checks passed.

Final delivery must include:

1. Source/schema/API/route changes and removal of superseded implementations.
2. Live customization audit and exact-site cleanup/reset outcome.
3. Table/route/theme coverage checklist with any genuine exceptions explained.
4. Test commands/results, independent review findings, and fixes.
5. Cold/warm performance comparison.
6. Representative screenshots and explicit remaining device/environment limits.

Do not call the task complete because the main Stock page works or because a
delegated agent passed type checks. Completion requires every in-scope consumer,
correct native/permission behavior, and the integrated visual review.
