# Browse, API, and navigation standardization implementation record

Date: 2026-10-20

Status: Implementation and independent review completed, with the device and
environment limits recorded below. Final frontend checks pass (462 tests, type-
check, formatting and Vite build); the native rollback suite passes 133 tests.
The baseline sections are historical; the final review is the acceptance record.

## Package A — baseline

### Working tree and source contracts

- Initial `git status --short` contained only the untracked
  `notes/20261020_BROWSE_API_STANDARDIZATION_HANDOFF.md`; no tracked edits were
  present.
- The router in `frontend/src/router.ts` uses legacy paths and redirects unknown
  routes to `/`. Examples: `/expiry`, `/item/:code`, `/items/new`, `/batch/:name`,
  `/warehouses`, `/pending`, `/reconcile/:name`, `/new/:kind`, and separate
  `/movements/items|records` and `/loans/items|records` routes.
- Current report state is a single `grouping` value, serialized and validated
  through `frontend/src/lib/reportContract.ts`, `reportQuery.ts`, and
  `temple_inventory/report_query.py`. Backend report projections in
  `temple_inventory/projections.py` are built into a temporary SQLite database
  per request. No reusable Redis projection cache was found in app Python source.
- Existing `ReportTable` is shared by some readers, but raw tables remain in
  Stock, Expiry, Movement, Drafts, Counts, Item and Batch detail, Recovery
  Summary, and related history surfaces. Column settings are absent; settings
  persistence covers theme/density/text-scale through user defaults and
  account-scoped local cache in `frontend/src/lib/uiPreferences.ts`.
- Browse API entry points include `inventory_page`, `expiry_page`,
  `operation_page`, `native_drafts`, `counts_page`, `movement_history`,
  `loan_item_history`, and `operation_analysis` in `temple_inventory/browse.py`,
  plus `report_page` in `projections.py`. Report export and saved views are
  separate consumers. Analysis grouping is currently dimension-specific; it is
  not the requested ordered `groupBy` query contract.

### Live read-only customization audit

The live site was reachable for `bench execute` reads on retry. The exact
read-only field query found all fixture-backed `ti_*` Custom Fields plus the
retired extra `Stock Reconciliation-ti_count_warehouse`. The query also
returned unrelated standard ERPNext Custom Fields, which were not treated as
app-owned. Query result names are consistent with the 33 current fixture fields
and one extra singular field.

`Stock Reconciliation` `MAT-RECO-2026-00001` has
`ti_count_warehouse = "A02 / 无货位 - O"` and `ti_count_warehouses = NULL`.
This confirms the sample/schema conflict noted in the handoff. No metadata was
changed. A read-only live query returned empty Client Script and Server Script
lists and no Property Setter whose name begins `Inventory`; that prefix query
alone does not establish ownership of every generic-named Property Setter.
The broader Property Setter query showed extensive native ERPNext customizations;
they must be preserved. A complete ownership audit should compare fixtures,
DocType JSON, hooks/setup, and exact historical retirement names before cleanup.

### Baseline checks and environment

| Check                                      | Command / observation                                                                                                                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend tests                             | `cd frontend && pnpm test`                                                                                                                             | Pass: 63 files, 413 tests                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Frontend types                             | `cd frontend && pnpm type-check`                                                                                                                       | Pass, exit 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Native rollback suite, first connected run | `cd frappe-bench && bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run`                                       | Failed: 103 tests, 3 errors. `CatalogTests.test_item_history_uses_only_effective_damage_and_loss_events_after_cancellation` hit stock-availability validation for `TI-NATIVE-2de48ccd6b` in its test warehouse. `NativeSampleTests.test_seed_attachments_write_one_private_blob_and_preserve_native_image_field_link` hit MariaDB error 1020 (`tabUser` record changed), then its rollback reported missing savepoint.                                                                             |
| Initial sandbox DB connectivity            | `getent hosts mariadb redis-cache redis-queue` and bench invocation                                                                                    | `mariadb` unresolved; command failed before tests with `Unknown server host 'mariadb'`.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native rollback suite, retry               | Same bench command after `getent hosts mariadb redis-cache redis-queue` returned `172.19.0.3`, `.4`, and `.5`; escalated invocation used `login:false` | Failed again: 103 tests, 3 errors. The item-history stock-availability validation recurred (new test Item `TI-NATIVE-7008ed16ee`). `CatalogTests.test_expired_receipt_and_batch_count_use_native_bundles` hit MariaDB error 1020 (`tabUser` record changed), then its rollback reported missing savepoint. The attachment test passed on retry. Bench's trailing `NameError: name 'temple_inventory' is not defined` is secondary to the test runner's `AssertionError`, not the original failure. |
| Local production server                    | `curl -I --max-time 3 http://127.0.0.1:8000/inventory` from sandbox                                                                                    | Sandbox returned connection refused. Parent independently reports the URL is reachable under escalation and completed the live browser review; screenshot artifacts are under `/tmp/ti-standardization-review`.                                                                                                                                                                                                                                                                                    |
| Browser and Chinese font                   | `command -v chromium*`; `fc-list :lang=zh`                                                                                                             | No system Chromium executable or registered Chinese font found by these commands. Parent reports `/usr/bin/chromium-headless-shell`, Noto Sans CJK at `/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf`, completed screenshot review, and artifacts under `/tmp/ti-standardization-review`.                                                                                                                                                                                         |

The frontend commands printed shell startup warnings about pyenv rehash and
`/home/frappe/.nvm/current` being read-only, but both checks completed normally.
Native-suite output was returned by the interactive command sessions and was
not persisted to a log file (log path: none); the commands, test names, and
primary failure messages above are the available baseline record.

### Canonical route checklist — historical baseline

This checklist records the initial state only. Current route implementation
evidence appears in the Integration status section below.

| Route family                      | Required canonical URL(s)                                                                                                       | Baseline status                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Home / Stock                      | `/`, `/stock`                                                                                                                   | Present, shell review pending                                           |
| Item                              | `/stock/items/new`, `/stock/items/:code`, `/stock/items/:code/edit`                                                             | Legacy `/items/new`, `/item/:code`, `/item/:code/edit`                  |
| Expiry / Batch                    | `/stock/expiry`, `/stock/batches/:name`                                                                                         | Legacy `/expiry`, `/batch/:name`                                        |
| Warehouses / categories / pending | `/stock/warehouses[/:name]`, `/stock/categories`, `/stock/damaged`                                                              | Legacy `/warehouses[/:warehouse]`, `/categories`, `/pending`            |
| Movement browse/create/native     | `/movements?view=items                                                                                                          | records`, `/movements/new/:kind`, `/movements/:name`                    | Legacy separate `/movements/items | records`, `/new/:kind`, `/documents/:doctype/:name` |
| Loan browse/context               | `/loans?view=items                                                                                                              | records`, `/loans/:name`                                                | Legacy separate `/loans/items     | records`, contextual route present                  |
| Counts                            | `/counts`, `/counts/new`, `/counts/:name`                                                                                       | Legacy `/counts`, `/reconcile/new`, `/reconcile/:name`                  |
| Activities                        | `/activities`, `/activities/new`, `/activities/:name`, `/activities/:name/edit`                                                 | Present                                                                 |
| Drafts / Reports / settings       | `/drafts`, `/reports`, `/settings`, `/settings/setup`                                                                           | Setup legacy `/setup`; others present                                   |
| More / auth                       | `/more`, `/auth-complete`                                                                                                       | Present                                                                 |
| Routing safety                    | unknown route deliberate not-found; unsupported DocType rejected                                                                | Catch-all redirects to `/`; verify native route guards and encoded IDs  |
| Query/history/recovery            | canonical query serializer, direct refresh, Back/Forward, named links, recovery identity, unsaved guards, post-save replacement | Existing legacy helpers and tests; migration not yet reviewed           |
| Shell labels                      | route-driven ownership/breadcrumb, loading/access states, current top-nav selection                                             | Existing shell exists; route registry and all-state accuracy unverified |

### Route/table requirement checklist

This is the initial requirement inventory, not a current acceptance claim. A
raw-table source inventory is not evidence of the shared contract.

| Consumer / route                            | Required evidence                                                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stock, Expiry, Pending                      | Shared table, complete sorting/totals, filters, grouping where meaningful, preference persistence, refresh/error/empty, load more                                       |
| Movement items and records                  | Both views; document quantities counted once in records; allocation details retain allocation grain; query/view serialization                                           |
| Loan items and records                      | Outstanding balances, settlement/history scopes, settled-item toggle, correct full-document versus allocation grouping                                                  |
| Activities, Drafts, Counts                  | Shared rows where applicable; status/native identity; count editor keeps blank vs zero and editable behavior                                                            |
| Reports and Quick Export                    | Grouped result and related tables; full-result export independent of visible columns/collapsed groups                                                                   |
| Item, Batch, Warehouse, Loan detail/history | Consistent table/history, native links, permissions, pagination, independent image/link actions                                                                         |
| Recovery Summary                            | Preserve selectable exact payload and copy behavior while adapting table presentation                                                                                   |
| Responsive surface contract                 | 1023/1024 transition, one active surface, retained controller state, no duplicate loads/observers, cards and table agree                                                |
| Shared table behavior                       | Sorting across complete result; required columns; reorder/reset/save by account and table ID; column permissions; empty/error/retained-refresh; keyboard/row activation |
| Query/filter behavior                       | Search IME/debounce/abort; filter chip/sidebar sync; date apply/cancel; hierarchy selection; route/history restoration                                                  |
| Theme/density                               | All three themes and density modes on representative browse, grouped, detail/history, report, and editable count tables                                                 |

Source inventory found direct `<table>` markup in
`StockBrowseView.vue`, `ExpiryBrowseView.vue`, `OperationBrowseView.vue`,
`NativeRecordsView.vue`, `CountWorkspace.vue`, `CountEditorView.vue`,
`ProductDetailView.vue`, `BatchDetailView.vue`, `RecoverySummary.vue`, and
`MovementHistoryTable.vue`; `ReportTable.vue` is the shared table primitive.
`ReportTable` is consumed in Stock, Expiry, Pending, Movement and Reports/Quick
Export, but consumers still provide some specialized/parallel tables. Counts
must remain editable and retain their native state invariants while migrating.

## Implementation packages

Update these gates with exact commands and evidence as packages land. The final
acceptance matrix is specified in the handoff's sections 11–12.

| Package                                | Starting gate                                                  | Status                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — baseline/audit                     | Existing failures, live metadata, route/table inventory        | Complete; baseline details above                                                                                                                   |
| B — route registry/navigation          | Canonical direct entry, Back/Forward, guards, recovery         | Implemented; route registry tests and final real-site route sweep passed; evidence below                                                           |
| C — query/group/API                    | Ordered 0–2 `groupBy`, full groups, child paging, exports      | Implemented; full native suite passed 133/133, including group, sort, permission and cache contracts                                               |
| D — shared table/preferences           | Density, flattened columns, per-account table settings         | Implemented; full frontend suite passed 72 files / 462 tests, type-check, targeted formatting and production build                                 |
| E — search/filters/sidebar/date        | Shared state and accessible controls                           | Implemented; full frontend suite and final independent responsive/browser review passed                                                            |
| F — consumers                          | Every in-scope route migrated, obsolete implementation removed | Implemented; route/table matrix, 462 frontend tests, production build and independent review recorded below                                        |
| G — cache/performance                  | Permission-safe immutable projection reuse and invalidation    | Implemented; native suite 133/133 plus focused expiry/race/Redis cache tests 4/4; final TTL note at `notes/20261020_QUERY_CACHE_IMPLEMENTATION.md` |
| H — metadata/samples/theme/integration | Clean app metadata, current samples, visuals, build            | Exact-site reset, source audit, production build and independent visual review complete; environmental limits recorded below                       |

## Integration status — 2026-10-20

The historical checklist above is retained to show what the baseline audit
found. The current status below records the integrated bundle, test gates and
independent real-site review.

| Requirement area                                                                         | Current source/test evidence                                                                                                                                                                                                  | Remaining acceptance                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical routes, named navigation, breadcrumbs, not-found and native operation recovery | Typed route registry tests and actual ItemDetail breadcrumb tests pass; independent route sweep and recovery navigation are documented in [routes.json](artifacts/20261020-standardization/routes.json) and the review below. | None for the reviewed routes.                                                                                                        |
| Query state, `view=items                                                                 | records`, ordered grouping and URL restoration                                                                                                                                                                                | Shared report query contract, `groupSequencesForView`, native group-page tests, browser Back/Forward and route serialization passed. | None for reviewed query flows. |
| Tables, page consumers and per-user preferences                                          | Shared DataTable and preference implementations cover all listed consumers; `pnpm test` passed 72 files / 462 tests, type-check and build passed.                                                                             | Editable reconciliation input grouping remains the documented domain exception.                                                      |
| Search, filters, hierarchy rail, date apply/cancel and responsive toolbar                | Persistent search and synchronized hierarchy surfaces passed full frontend tests and final keyboard/viewport review; date and rail evidence is archived below.                                                                | None for reviewed states.                                                                                                            |
| Cache and source invalidation                                                            | Full native suite passed 133/133; focused cache age/race/Redis tests passed 4/4, including expiration during grouped projection work; cache performance and committed invalidation probes are documented in the cache note.   | None for the reviewed cache paths.                                                                                                   |
| App schema, samples, native data and reset                                               | Exact-site reset and read-only audit completed; source counts and rollback audit are archived below.                                                                                                                          | None; no production migration or second reset is in scope.                                                                           |
| Theme, density, text scale and overlays                                                  | Three themes, three densities, 200% text, open overlays, editable count and narrow/short viewports passed independent browser review; measurements are in the recovery/density artifact.                                      | Physical device and camera hardware checks remain environmental limits.                                                              |
| Retired compact Search implementation                                                    | `CompactFilters.vue` and its test were removed; full frontend suite and page-header UI review pass with persistent search.                                                                                                    | None for the reviewed shell surfaces.                                                                                                |

### Final code checks — 2026-10-20

| Gate                                                                                          | Result                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cd frontend && pnpm test`                                                                    | Passed: 72 test files / 462 tests.                                                                                                                                                                                            |
| `cd frontend && pnpm type-check`                                                              | Passed.                                                                                                                                                                                                                       |
| Targeted Prettier check for the touched table/recovery/breadcrumb files                       | Passed.                                                                                                                                                                                                                       |
| `cd frontend && pnpm build`                                                                   | Passed: Vite transformed 377 modules; PWA generated 87 precache entries.                                                                                                                                                      |
| `bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run` | Passed: 133 tests, 0 failures/errors; rollback audit unchanged at generation 20, 29 Warehouses, 164 Items and 15 Stock Entries. Full result summary: [native-tests.log](artifacts/20261020-standardization/native-tests.log). |
| Focused cache TTL/race/Redis suite                                                            | Passed: 4 tests, 0 failures/errors; [cache-ttl-tests.log](artifacts/20261020-standardization/cache-ttl-tests.log).                                                                                                            |
| Targeted Ruff, Python compilation, `git diff --check`                                         | Passed for the final backend cache change.                                                                                                                                                                                    |

## Independent integration review — 2026-10-20

Implementation, formatting and code tests were delegated to `gpt-6-luna` with
`high` reasoning. The parent reviewed the shared contracts, authorization,
transaction/cache behavior and the real application independently. Agent success
claims were not used as browser acceptance. The final build is the production
Vite bundle served by the actual `development.localhost` Frappe site.

### Reviewed routes and consumers

| Requirement                                                                                                                                                                       | Evidence and result                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home, Stock, Expiry, Pending, Movement/Loan Item and record modes, Activities, Drafts, Counts, Reports, warehouse/category management, Settings, Setup, More and login completion | Final real-site route sweep passed without alerts, page errors, failed requests or document overflow: [routes.json](artifacts/20261020-standardization/routes.json). Retired `/expiry`, unknown URLs and invalid movement kinds show deliberate not-found pages.                                                                                                                                                                                          |
| Item/new/edit, Batch, Warehouse, native Stock Entry, Loan overview, Activity/new/edit and native reconciliation                                                                   | Loaded real sample identities, authorized labels and embedded data. The earlier Warehouse sort error and Item breadcrumb failure were fixed and independently rechecked. Query-only Item tab changes preserve the friendly label.                                                                                                                                                                                                                         |
| Shared table coverage                                                                                                                                                             | Raw-table inventory has one renderer, `DataTable.vue`; adapters and every consumer are listed in [the migration review](20261020_TABLE_MIGRATION_REVIEW.md). Management trees, metadata forms, dashboard cards and non-tabular editors remain suitable domain surfaces.                                                                                                                                                                                   |
| Two-level grouping                                                                                                                                                                | Category → Item → native stock leaf loaded on demand. Each expansion made one child request; collapse/reopen made no additional request. Counts and unit-separated quantities remained visible. [Group/responsive evidence](artifacts/20261020-standardization/groups-and-responsive.json).                                                                                                                                                               |
| Sort and columns                                                                                                                                                                  | Actual Item history sort emitted the independent server field/direction; Reports headers changed the canonical query. Show/hide survived reload, reorder changed rendered order, required identity columns stayed protected, and defaults restored. Portal layering and focus after reorder were fixed following real blocked-click/Escape findings.                                                                                                      |
| Search and hierarchy                                                                                                                                                              | The same input survived compact/expanded transitions with focus. Rail/panel/chip state synchronized; clearing the category chip unchecked the tree. A panel hierarchy action closed the panel and focused the matching rail search. Chips show selected labels, including `食品`, rather than opaque counts.                                                                                                                                              |
| Dates                                                                                                                                                                             | Reversed bounds produced inline validation; Apply changed the canonical URL, Escape discarded the next unapplied edit, and fixed 2027 Q4 materialized `2027-10-01`–`2027-12-31`. [Date/scanner evidence](artifacts/20261020-standardization/dates-and-scanner.json).                                                                                                                                                                                      |
| Native input/recovery                                                                                                                                                             | The unsaved Item navigation guard retained typed input when staying. Keeping input, leaving, going Back and explicitly restoring the candidate recovered the exact text. Recovery-summary IDs now satisfy the server preference contract and produce no preference request failures.                                                                                                                                                                      |
| Responsive                                                                                                                                                                        | Reviewed 1440px, 1024px, 1366×768, 390px and 200% text. No document overflow was observed; tables retain their own horizontal access. Phone Movement/Loan Item views mount cards and no duplicate browse table. New reconciliation retains an editable shared table on phones.                                                                                                                                                                            |
| Themes and density                                                                                                                                                                | Jade/compact, bronze/balanced and blue/spacious were inspected on Stock, Reports, Item balances/history and reconciliation. Open filter overlays immediately followed root theme changes. Final editable grid measurements: padding 5×8 / 12 / 18×16px; controls 32 / 36 / 44px; thumbnails 32 / 48 / 64px; text remained 14px at 100% in every density. [Final recovery/density evidence](artifacts/20261020-standardization/recovery-and-density.json). |
| Scanner and images                                                                                                                                                                | Camera open/close/reopen succeeded with emulated media; both stream tracks ended on close. Manual/hardware input remains present. Image enlargement opened its lightbox without changing route or row selection; private product image loads succeeded.                                                                                                                                                                                                   |

The only table exception is grouping within an unfinished reconciliation input
grid: editable business lines retain their identity and input order. Count record
browsing remains groupable. Quick Export previews are bounded previews of the
complete export query; hiding columns or collapsing groups does not restrict the
export calculation. Native workflow/permission/export invariants are covered by
the rollback-only backend suite as well as focused frontend tests.

### Review findings corrected before delivery

Independent review found and corrected default sort mismatches in Drafts and
Warehouses; a runtime-template login completion page; an immediate watcher using
an undeclared Item template ref; authorized breadcrumb clearing on query-only
changes; grouped Stock leaves incorrectly treated as Item summaries; stale row
snapshots on history restoration; missing shared header sorting; hidden hierarchy
panel entry points; a column panel under the sticky header; lost focus after
column reorder; invalid uppercase/spaced recovery table IDs; density-dependent
typography and fixed thumbnails; vertically wrapped reconciliation actions; and the desktop navigation covering
the persistent search during scrolling. The final Stock rail also uses the shared
250px geometry instead of its former stretched grid column.
Earlier evidence files may show these failures; the focused final evidence
records their corrections. No forced clicks were used to accept blocked controls.

Cache review also corrected the Redis wrapper integration, base-projection reuse,
request snapshot ownership, SQL singleton generation increments (the Singles index
is not unique), post-restore Redis failure handling, current app-role checks,
concurrent cold misses and restored snapshots expiring during grouping. Details,
source audit and permission/invalidation evidence are in [the cache review](20261020_QUERY_CACHE_IMPLEMENTATION.md).

### Schema, samples and measurements

The exact-site reset completed with exit 0, preserving Administrator
credentials. Post-reset audit found no retired app metadata or singular physical
`ti_count_warehouse` column, with all 33 current Custom Fields and six app DocTypes
matching source. Samples contain 164 Items, 175 images and 16 native transactions;
current plural count warehouses, two reviewed variance rows and native balances
were verified. Current live counts are 29 Warehouses, 164 Items and 15 Stock
Entries (the reconciliation is a separate native record). [Schema audit](artifacts/20261020-standardization/schema-audit.json),
[configuration](artifacts/20261020-standardization/configuration.json),
[reset details](20261020_SCHEMA_THEME_REVIEW.md).

Equivalent direct-service cold/repeat timings, with the same user, data and
query scope (milliseconds):

| Query                       | Cold | Immediate repeat |
| --------------------------- | ---: | ---------------: |
| Inventory report projection | 1763 |               55 |
| Expiry                      |  609 |               96 |
| Movement Item summary       | 2529 |               56 |
| Movement records            | 2273 |               52 |
| Loan Items                  | 4692 |               54 |
| Loan records                | 2309 |               42 |

Repeats, next-page reads, group expansion and compatible dashboard cards did not
repeat the instrumented source build. Actual HTTP warm repeats took 61–94ms;
response sizes and snapshot identities are retained in [service measurements](artifacts/20261020-standardization/performance-service.json)
and [HTTP measurements](artifacts/20261020-standardization/performance-http.json).
These are measured API calls, not whole-page latency targets. Cold cost remains
visible; explicit refresh and invalidation rebuilt the source.

Two synchronized cold Stock reads shared one build and snapshot in 1.87/1.96s.
A committed Item description edit invalidated the warm projection; a role revoke
committed through a second database connection denied the next read. The text was
restored and temporary account removed, with native stock untouched and counts
unchanged. This write probe changed Item metadata, not stock quantities.
[Concurrent reads](artifacts/20261020-standardization/concurrent-cold-reads.json),
[invalidation](artifacts/20261020-standardization/committed-invalidation.json),
[cleanup](artifacts/20261020-standardization/probe-cleanup.json).

### Environment and evidence limits

Final screenshots use Chinese-capable Noto Sans CJK via the browser fontconfig;
production typography was not modified for testing. Screenshots and JSON are
archived under [artifacts/20261020-standardization](artifacts/20261020-standardization).
Physical cameras, real barcode hardware and mobile device behavior were not
verified; camera lifecycle was emulated. Review used headless Chromium rather
than a full cross-browser/device lab. Mutation-heavy browser acceptance specs
were not run during the visual pass; native mutation semantics were exercised
by the rollback-only integration suite. Anonymous initial entry follows the
native Frappe login redirect, which is outside the custom theme scope.

The container reload stopped the web server; it was restored on port 8000 without
changing site or service-host configuration. MariaDB and Redis remained addressed
by their configured service names. Background worker, scheduler and realtime processes were restored after the
quiet verification window. No second reset, production deployment or core change
was performed.

### Final integrated gates and smoke check

| Gate                                                                                          | Final result                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cd frontend && pnpm test`                                                                    | PASS — 72 files, 462 tests                                                                                                                                     |
| `cd frontend && pnpm type-check`                                                              | PASS                                                                                                                                                           |
| `cd frontend && pnpm build`                                                                   | PASS — 377 modules, 87 PWA precache entries                                                                                                                    |
| Targeted Prettier, touched Python Ruff/compile, `git diff --check`                            | PASS                                                                                                                                                           |
| `bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run` | PASS — 133 tests; before/after Settings Singles and native record counts identical                                                                             |
| Restored cache snapshot expiry during grouping                                                | PASS — 4 focused cache tests, including an actual restore followed by expired-age rejection and a fresh-source rebuild                                         |
| Final production browser smoke                                                                | PASS — Stock, lazy two-level grouping, Drafts, Warehouses, login completion, retired URL not-found and Item history; no page/console errors or failed requests |
| Final unfinished-input recheck                                                                | PASS — exact text restored after Back and explicit recovery; no recovery preference 417; friendly breadcrumb survives query-only tab replacement               |

The final dashboard measurement issued all six card requests concurrently. All
cards returned 200, with total completion **3054ms cold / 264ms warm**. Inventory
and distribution shared one snapshot; expiry and reminders shared another. Every
warm card retained its cold snapshot. This is API completion time, not a browser
paint benchmark: [dashboard-performance.json](artifacts/20261020-standardization/dashboard-performance.json).

Representative screenshots are indexed in [the evidence gallery](artifacts/20261020-standardization/README.md).
[Final smoke evidence](artifacts/20261020-standardization/final-smoke.json) was
captured after restarting the development web process with the final backend.
The final sticky-layout recheck passed at 1440px, 1024px, 1366×768, 390px and
200% text scaling. Desktop rails measured 250px wide, remained immediately below
the measured toolbar and inside the viewport, and had one working vertical
scroller. The input remained uncovered in every case, with no document horizontal
overflow or JavaScript errors. [Measurements](artifacts/20261020-standardization/sticky-layout.json),
[scrolled desktop](artifacts/20261020-standardization/sticky-desktop.png),
[200% text](artifacts/20261020-standardization/sticky-200percent.png).
The original grouping smoke observed one root request, one requested category
page, and one requested Item leaf page; the resulting leaf was rendered without
an alert or failed request. This evidence predates the independent review repairs
below. Its former completion statement is superseded by that review and the
remaining routed-browser check.

### Independent review repairs (2026-10-20)

The independent review handoff identified additional browse defects after the
evidence above was captured. The source repairs now put column settings in the
last table header cell, keep the table/header available for empty and loading
states, make group rows keyboard-disclosable, and render expanded report record
and item-history entries as sibling rows in the shared table. Group summaries
are concise and align to the configured grouping/count columns. Operation
history keeps a separate explicit sort shared by the history table. Ungrouped
Loan Item history now requests the entire permission-filtered Item scope and
renders directly as flat native history rows; expanded terminal Item groups use
the same loader without an intermediate disclosure row. Loan Item history
remains in `items` view with a separate history sort contract, and grouped native
record leaves carry whole-document quantities and settlement eligibility.
Grouped report tables use native leaf-column metadata and root-page loading/error
state; native leaf identities are deduplicated across loaded pages while complete
group counts remain stable. Toolbar search,
filter/group panels, compact quantity summaries and report title/count behavior
were also corrected. These decisions are recorded in
[`UI_UX_DECISIONS.md`](../UI_UX_DECISIONS.md) and
[`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md).

Repair-specific code verification on 2026-10-20:

| Gate                                                                                        | Result                                      |
| ------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `cd frontend && pnpm test`                                                                  | PASS — 72 files, 471 tests                  |
| `cd frontend && pnpm type-check`                                                            | PASS                                        |
| `cd frontend && pnpm build`                                                                 | PASS — 377 modules, 87 PWA precache entries |
| `cd frontend && pnpm exec prettier --write` on touched frontend files                       | PASS — all unchanged after formatting       |
| `bench --site development.localhost execute temple_inventory.tests.test_native_reports.run` | PASS — 51 tests                             |
| Python `py_compile` for touched backend modules/tests                                       | PASS                                        |
| `git diff --check`                                                                          | PASS                                        |

Ruff could not be run because the command and Python module are not installed in
this environment. The production build generated its normal frontend assets;
none were edited by hand. These checks cover source behavior and build output.
The repairs have not yet received a post-change routed-browser review, so this
note makes no new visual acceptance claim; that review remains with the parent
agent.

### Round-two corrections

A second source review found that the first repair pass had not actually fixed
the ungrouped Loan history request scope: the synthetic flat scope had been
treated as a settled Item. It now defaults to outstanding, offers both scope
options, and leaves settled exact-Item groups defaulted to all history. Expanded
detail rows are retained by Item identity so a shared history sort reloads
terminal groups even when they fall beyond the first operation page. Loan
history rows carry the signed quantity, current outstanding only for original
Loan rows, linked Loan identity, status, and settlement eligibility; the Item
history record link routes original Loans to Loan detail and settlement records
to native-document detail. The flat table also displays Item identity.

The second pass removed embedded search chrome, exposed actual history errors,
preserved native Space behavior for interactive descendants of group rows, and
provided report leaf columns in the initial `report_page` response using the
display-column allowlist. Group summaries now show movement kinds and quantities
and use the “明细条数” count label for Item-history groups. The grouped report
header schema is seeded before any group is opened. Focused regressions cover
flat-scope selection, sort reload outside the initial page, report schema seed,
and keyboard behavior. This round also has no post-change browser-acceptance
claim; the parent agent owns the settled routed-browser review.

Round-two checks on 2026-10-20: `pnpm type-check` passed; `pnpm test --run`
passed (72 files, 471 tests); `pnpm build` passed (377 modules, 87 PWA precache
entries); `test_native_reports.run` passed all 51 tests, and its focused Loan
history test passed after adding linked-return and outstanding assertions.
Python compilation and `git diff --check` passed. Prettier ran on touched
frontend files. Ruff remains unavailable in the environment.

### Settled browser repair follow-up

The ungrouped Movement Item view is reached from the canonical Movement
`summary` view and loads native history through the `movement_history` endpoint
(the history request carries the backend's `lines` view). It renders flat
records with the same signed quantity treatment and available-stock effect cue
used by expanded Item history. On phones, an Item card's existing disclosure
opens native history directly; it does not open allocation rows or require a
second history disclosure. Group-level counts remain beside the label, while
expanded group details carry loading, error, retry and pagination controls in a
separate table row. Stock, Expiry and Reports group quantity summaries use
their metric columns and no longer repeat count or unit labels in expanded
summary text. The Reports Related Period chip is rendered once and counted
once.

Focused regressions cover the flat Movement history request and rendered
effect text, mobile single-disclosure Loan history including a breakpoint
change, and report group count labels. These source checks do not constitute
visual acceptance; the parent agent will perform the final settled browser
review.

### Final implementation verification

The final mobile disclosure regression uses a projection group ID that differs
from its summary Item ID, matching the live API shape. It verifies the correct
row remains expanded after history resolves, the history is visible, collapse
hides it, and reopening works across a breakpoint change. Projection errors
also remain hidden while collapsed and are exposed with an explicit retry on
reopen. Grouped report leaves use the curated display-column schema, while
Stock and Expiry group rows use authorized Item images from the projection.

Final source checks on 2026-10-20: `pnpm test --run` passed (72 files, 475
tests); `pnpm run type-check` passed; `pnpm run build` passed (377 modules, 86
PWA precache entries); touched-file Prettier check passed; Python compilation
and `git diff --check` passed. The focused grouped-report schema/image backend
test passed, and `bench --site development.localhost execute
temple_inventory.tests.test_native_reports.run` passed all 52 tests. Ruff is
unavailable in the environment. These checks do not claim visual acceptance;
the parent agent owns the final routed-browser review.

### Parent settled-browser review and terminal-history follow-up

The parent agent's final routed-browser pass covered 25 settled states at
1440x900, 1366x768, and 390x844, with no HTTP or page errors. It verified
Movement grouped, flat, and two-level views; Loan grouped/flat/all-scope and
native record views; Stock, Expiry, and Reports filters and grouped views;
column hide/reorder and date sorting; history retry; mobile history and
breakpoint retention; and blue compact / bronze spacious 200% text scaling.
The parent measured normal grouped rows at about 61px, with item images,
counts, and metrics, and reported usable phone touch targets with no normal-text
document overflow. Selected screenshots and a credential-free review summary
are in `notes/artifacts/20261020-browse-repairs/`. Inventory lifecycle writes
and physical camera scanning were outside that browser review.

The final source follow-up maps terminal Item-history loading and error state
onto the expanded DataTable detail row. A failed terminal read stays visible
after collapse/reopen until the user retries; the retry keeps the existing
loader and succeeds. Regression coverage asserts loading status, the exact
error text and alert role, hidden error while collapsed, cached error on
reopen, successful retry, and single-render Loan outstanding quantities. The
parent's final synthetic browser probe then confirmed the exact error text,
`aria-expanded=false` and hidden detail after collapse, the cached error after
reopen, and an explicit Retry that loads five native history rows. Loan
outstanding cells displayed exactly `8 Nos` and `11 Nos`; Return rows were
blank. Date sorting and temporary column hide/reorder still worked. Normal
text had no document overflow; the 200% spacious bronze layout scrolled
internally. The final probe screenshots are saved with the earlier selected
browser evidence in `notes/artifacts/20261020-browse-repairs/`.

Follow-up checks on 2026-10-20 after the terminal-history and Loan-cell fixes:
`pnpm exec vitest run tests/native-operation-browse.test.ts` passed (23 tests);
`pnpm run type-check` passed; `pnpm run build` passed (377 modules, 86 PWA
precache entries); touched-file Prettier check passed. No backend source changed
in this follow-up. The earlier full frontend suite (72 files, 475 tests) and
52-test report backend suite remain the latest full-suite runs.
