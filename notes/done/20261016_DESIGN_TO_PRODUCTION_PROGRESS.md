# Design-to-production implementation progress

Started: 2026-10-16. Specification: [handoff](20261016_DESIGN_TO_PRODUCTION_HANDOFF.md).
Status: **Implementation and local automated acceptance complete; verification limits recorded below; no deployment.**

**Current result:** Native replacement and the shared production/gallery UI are
implemented. Final local checks pass: **85 native tests /74.893s**, **308 frontend
tests /48 files /17.08s**, **21 production browser cases /34.1s**, **79 full gallery
cases /18.7m** plus6 targeted cases after internal alias cleanup. Actual HTTP6-case
route/Desk/concurrency/CSV-XLSX worker acceptance passed; additional5 real Item/File,
Activity, Warehouse, matching-count and seeded-private-image cases passed /40.5s.
Typecheck, both builds,43-source Ruff lint/format and import/precache audits pass.
Four independent MariaDB lock/rejection scenarios passed with rollback.

**Do not reset again:** development.localhost reset/reseed completed; subsequent
scoped image repair retained164 Items/175 private images/16 native documents,
removed157 duplicate File rows and176 unreferenced private copies. Read-only native
balances/schema/media verification passes (176 sample files,0 public copies).
Administrator authentication was preserved. No subagents or live deployment.

**Verification limits:** native browser zoom and physical camera/device behavior
were not verified. Deterministic camera emulation and CSS text scaling are separate
evidence. A race between two successful stock commits was not executed; independent
rollback lock/rejection checks and native invariant tests cover the implemented
guards. Actual RQ exports cover164 rows;1,005-allocation completeness/order is proved
through the real native projection and both writers. Screenshots were inspected
directly at representative high-risk combinations; no blanket pixel-perfect manual
approval is claimed. Latest chronological checkpoint and artifact index are below.

## Starting state and safety

- App revision: `63c7f26`.
- Pre-existing user changes: `AGENTS.md`, `DESIGN_MIGRATION_COVERAGE.md`,
  `DESIGN_SYSTEM.md`, `UI_UX_DECISIONS.md`; untracked consolidated handoff.
  Preserve these edits. No subagents.
- Only `development.localhost` may be reset, after native tooling is ready.
- No Frappe/ERPNext core changes; generated frontend files come from builds.

## Capability and acceptance checklist

Checked items have implementation and local evidence recorded below. The verification
limits above remain explicit; fixture results do not replace real-server evidence.

- [x] Baseline routed preview screenshots and import/consumer audit.
- [x] Native Stock Entry/Reconciliation identity, version locks, retry-safe creation,
  Desk interoperability, draft lifecycle, all nine movement kinds.
- [x] Native loan line provenance, derived balances, compatible partial settlements,
  concurrency, cancel/amend dependencies.
- [x] Per-line recorded conversions and explicit versioned reusable Item conversions.
- [x] Counts: ledger baseline, blank/zero/not-found, refresh/re-review, review metadata,
  differences only, no matching server record, no valuation workaround.
- [x] Activities: immutable identity, reference types, notes, lifecycle, versions,
  concurrent reference/delete guards and direct/indirect relationships.
- [x] Item/reference data, warehouse setup/editing, full-dataset search and scanner.
- [x] Private native-parent originals, relinking/removal guards, pending uploads.
- [x] Six report datasets, typed shared queries, historical ledger balances,
  complete permission-filtered aggregates, details and facets.
- [x] Background CSV/XLSX exports, ownership, permission rechecks, retry and private files.
- [x] Per-account display preferences and named views.
- [x] Browser recovery scoped by site/account/tab/editor, conflict-safe autosave,
  session restoration and local/native draft distinctions.
- [x] Promote preview presentation to one production implementation; injected gallery,
  real controllers, no runtime fixtures or legacy CSS/implementations.
- [x] Navigation/query/context/scroll retention and responsive integration.
- [x] Development reset tooling, scoped sample-file cleanup, native seeds and balance checks.
- [x] Backend integration scenarios; frontend tests/typecheck; both builds/browser suites.
- [x] Direct screenshot inspection at 375/768/1024/1440, densities/text scales/themes;
  document unavailable real-device/native-zoom checks.
- [x] Final complete diff review; architecture/coverage documentation updated.

## Evidence and next action

Repository instructions and consolidated requirements read. Source confirms legacy
workspace ownership, custom loan records, title-named activities, density-only account
preferences, synchronous legacy exports and isolated fixture presentation remain.
### Implemented foundation (not yet a complete replacement)

- `native_api.py`, `native_access.py`, `native_stock.py`: native identities and
  versions, account-scoped idempotent creation, row identity/unknown-field retention,
  native draft/save/submit/delete/cancel/amend, structured movement validation and
  derived exact-line loan outcomes. Native hooks replace workspace-exclusive guards.
- Activity schema/reference type/controller/services: unique editable title with
  immutable native identity, Active/Archived, dates/plain-text notes, type validation,
  and generic reference deletion blockers including cancelled records.
- `conversions.py`: explicit versioned Item-specific conversion writes; native
  document lines retain their recorded factors.
- `counts.py` and native-parent review child fields: timestamped baseline, stale
  checks/re-review, differences-only native rows, no matching-count server record.
  Native count tests pass, including unchanged valuation and Desk invalidation.
- Account display contracts extended to theme/density/textScale. Exact theme data
  moved from preview fixtures to shared product data. Frontend saves/cache/Settings
  are being migrated together; tests and final visual promotion remain pending.
- `native_files.py`/File mixin: private originals, current/previous parent checks,
  submitted attachment immutability, parent-based downloads and no public thumbnail
  generation for inventory parents. File tests pass; seeded-media cleanup is pending.
- `report_query.py`, `report_sources.py`, `projections.py`: canonical six-dataset
  query, native allocation/reference rows, ledger history, complete pagination and
  unit/status-aware summaries. Temporary SQLite sorting/grouping is deleted per
  request and is not a stock store. Report integration tests pass (see below).
- `exports.py` and `Inventory Export Request`: request-owned background job lifecycle,
  bounded CSV/XLSX writers, related master tables, private output/reference manifest,
  download permission rechecks and retry. Writer/request tests pass; actual worker,
  revoked-access and large export acceptance still require evidence.
- Native user defaults now also store versioned personal named views. Canonical
  relative dates stay relative; no account argument is accepted in view APIs.
- `browserRecovery.ts` and `features/documents/nativeEditor.ts`: site/account/editor
  snapshots, invalid-input local retention, serialized native saves, in-flight edit
  retention, conflict/deletion recovery guard and lost-confirmation retry. These
  controllers are tested but not wired into the routed UI yet.
- `lib/browseQuery.ts` / `lib/reportContract.ts` extracted shared query definitions;
  gallery report/browse models consume these instead of duplicating the definitions.
- Newly added `catalog.py` and `browse.py` supply real Item/search/scanner/bootstrap/
  dashboard services. They still require focused integration tests and review.

### Evidence so far

- Captured 16 baseline screenshots (four routes × 375/768/1024/1440) in
  `/tmp/temple-inventory-migration/baseline-cjk/`. Initial screenshots without a
  Chinese font were unusable; recaptured using the existing audit Noto Sans CJK
  font. Directly inspected the 375px Receive screenshot with readable glyphs.
  Other baseline screenshots still need direct inspection.
- `bench --site development.localhost migrate --skip-search-index`: passed twice
  to sync the new native fields. **No reset/reseed** has occurred. Migration also
  rewrote Desktop Icon timestamps; revert that unrelated generated diff.
- `bench --site development.localhost execute temple_inventory.tests.test_native_documents.run`:
  latest run **23 tests passed**, 7.423s. Rollback suite covers native retry/confirmation,
  Desk/frontend versions/unknown fields, row identity, group rejection, partial
  outcomes, stale over-settlement, cancel dependencies, Activity references and
  recorded conversion factors, counts, preferences and private files. Additional
  scope/validation changes made after that run still need rerunning. True
  separate-connection concurrency is not yet tested.
- Logs and baseline capture helper: `/tmp/temple-inventory-migration/`.
- Full frontend suite was inadvertently started via `pnpm test -- ...` (the `--`
  does not select Vitest files here). Read its final results; use `pnpm exec vitest
  run FILES` for subsequent focused checks. Preview dependency-boundary test needs
  its obsolete preview-only style/data restriction updated for shared theme data.
- That full-suite attempt ended at **592 passed, 2 failed, 10 skipped** plus a
  server-suite EPERM. The two obsolete foundation assertions were updated, and
  focused preferences/settings/design-system/design-preview: **43 passed**.
- Typecheck passed after the display preference change; rerun after newer files.
- `test_native_reports.run`: **10 tests passed**, 14.979s. Six datasets/all views,
  complete 205-line pagination/summary, restrictive-empty scope, exact loan lines,
  indirect Activity settlement links, matching-count absence, named views and
  identical selected CSV/XLSX numeric scope. Initial failures exposed and fixed
  optional child-table handling and native reconciliation `actual_qty=0` quantity
  resets; historical adjustment now uses the authoritative running-balance delta.
- Recovery/editor Vitest: **10 passed**. Initial proxy-clone issue fixed by creating
  plain recovery values before cloning. New code is not production-integrated yet.
- Ruff binary available at `/tmp/temple-inventory-ruff-task/bin/ruff`. Import fixes
  applied to new Python modules; remaining lint is Chinese fullwidth punctuation
  (RUF001), to address explicitly while preserving correct Chinese text. Format
  touched source before finishing. No broad legacy reformat.
- Reverted migration-only Desktop Icon timestamp changes; future migrations may
  rewrite these again, so check/revert only that unrelated generated diff.

Next: finish catalog/dashboard/export permission tests and bounded-query review;
wire shared promoted presentation/controllers, update native sample/reset tooling,
then reset/reseed, remove obsolete UI/APIs/schema and complete routed acceptance.
Legacy production UI/workspace callers and schemas are still present; do not reset
the site or claim migration completion until the replacement and seeds are ready.

### Continuation checkpoint: shared browse/export promotion

- Latest native document rerun: **23 passed**, 7.630s. Report suite now **11 passed**,
  including private export manifest protection and revoked warehouse download denial.
  Catalog suite **5 passed**. These are rollback tests; no site reset/reseed yet.
- Shared UI primitives, compact/browse filters, scroll/focus helpers and Item images
  are promoted into normal components/composables. Neutral query, display and stock
  presentation types are shared by both entrypoints. The gallery supplies its own
  service/reference adapters; product code has no fixture imports.
- ReportsPage/ReportsView with a service controller now renders native paginated
  report tables, complete server totals, named views and background export requests.
  PreviewReports is a thin gallery wrapper around this implementation.
- StockBrowsePage/StockBrowseView now uses `browse.inventory_page`, which returns
  Item cards, native per-location/batch quantities, complete unit totals and analysis.
  Available-quantity sorting operates on the complete server projection. Gallery
  inventory now uses the same coordinator/controller through fixture services.
- Gallery services support inventory pages, named views and export-job lifecycle.
  Product export controller now invalidates configuration-specific jobs, guards late
  status responses, resumes polling after reopen and avoids duplicate jobs after a
  status-read failure. Focused controller tests/typecheck are the next verification.
- Remaining: promote dashboard, all document/count/Item/Activity/setup surfaces and
  shell/router; integrate native editor/recovery/attachments; then native reset/seed,
  remove old UI/schema/API, builds, routed browser acceptance and final review.
  Existing production entrypoint is still legacy. This checkpoint is not completion.

### Continuation checkpoint: dashboard, Activities and supporting references

- Dashboard now has a shared native service controller and promoted view. Cards
  fetch independently, retain scoped stale results on failure, disable stale
  drill-through, and retry separately. Movement date/distribution dimension refresh
  only their own cards. Native card APIs consolidate preview rows by native record
  and return complete unit totals; Inventory sorting is tested against loaned stock.
- Shared Activity list/detail/editor now use native Activity identity/version,
  permission-aware CRUD, plain-text notes, lifetime direct movement counts/totals,
  derived outstanding loan totals and paginated related records/loan lines. Gallery
  wrappers inject fixtures into these same coordinators/controllers. Native overview
  totals are verified against an indirect settlement with its direct Activity blank.
- Promoted UnitField/CategoryField and supporting controllers create real native
  UOM/Item Group records, preserve selected units/parents/group meaning, and only
  update selection after server success. Item Group create now supports group nodes.
- Scanner uses the shared Overlay and neutral session state. Manual/hardware input
  remains after lookup; explicit retries are allowed while camera duplicates are
  debounced. Removed the scanner's separate modal/focus code and 1600px layout branch.
- Production Dashboard/Inventory/Reports coordinators now point at promoted views;
  Activities routes/coordinator added. App provides native service/reference context.
  Other routes/shell/styles are still legacy and the migration is **not ready**.
- Inventory retains full inherited restrictions, including restrictive-empty scopes;
  all scope/report chips are removable independently. Fixed reference-only query
  changes resetting retained input in the gallery. Gallery artwork uses slots in
  the shared Item image; product imports no fixture assets.
- Latest checks: native catalog **6 passed** (2.362s); native reports **11 passed**
  (17.023s); shared browse/export/dashboard + scanner **15 passed**; Activity/reference
  controller tests **6 passed**; gallery foundation **27 passed**. Typecheck passed
  before the newest artwork/query-chip changes; a newer run is in progress.
  Logs: `/tmp/temple-inventory-migration/`. No reset/reseed/deployment performed.
- Still required: transaction/count/Item editors and recovery integration, contextual
  Item/conversion/attachment/scanner services; native browse details/loans/warehouse
  management/setup; shared shell/styles/preferences; reset/seeds and public sample
  cleanup; remove old schemas/APIs/UI/tests; comprehensive validation/visual review.

### Latest continuation: conversions, native batch outcomes and query guards

- ConversionEditor promoted behind native Item/UOM services. Staged factors and
  entered quantities survive save errors and stale-Item reloads. Explicit reusable
  saves use Item version and all conversions; failures never become line-only
  success. Unknown factors stay unset and fraction/precision checks reject rounding.
  Focused conversion controller suite: **6 passed**.
- Native multi-batch loan support now derives per-batch outcomes from native bundle
  allocations, retaining exact original row names. Prevents over-settling one batch
  using remaining quantity from another batch or another loan. Native loan detail,
  reports and settlements expose the batch allocations. Catalog suite: **7 passed**,
  including a native two-batch bundle loan and split partial return.
- Matching-count save path now locks/checks existing document permission/version
  and the current warehouse/ledger baseline even when no adjustment record is needed.
  Full-location candidate reads are current locking reads under that warehouse lock.
  Native document suite now **24 passed**, 7.528s; report suite **11 passed**, 18.451s.
- Added strict routed query decoding: malformed nested scope/date/enums show an
  error and restrictive-empty results, never silently widen to all data. Full
  restrictions remain through Activity and inventory contexts. Relative dates stay
  canonical. Focused query/controller/recovery/gallery/scanner set: **69 passed**
  across 8 files. Typecheck passed before final decoder/context edits; rerun pending.
- Development gallery build passed (2.75s), with its existing chunk-size warning.
  Isolated gallery server: 127.0.0.1:5197, log gallery-server.log. Captured 12 new
  screenshots (375/1440, six routes) in /tmp/temple-inventory-migration/shared-ui/.
  No page exceptions or production API requests in that capture. Directly inspected
  inventory375, Activity detail1440, dashboard1440, reports375 and dashboard baseline.
  These are gallery evidence only, not production acceptance. Inspection exposed
  dashboard regressions: all six expiry buckets and all movement-kind summaries
  are now restored; unit values get explicit wrapping/separation. Recapture needed.
- Targeted Ruff passed for current native access/API/stock/count/report/Activity
  and test files. More source has been formatted with Prettier. No reset/reseed,
  production build, deployment, complete browser suites or final acceptance yet.

### Continuation checkpoint: Item editor, pending files and allocation promotion

- Added shared native Item fields/editor and paginated Item picker, with private
  attachment handling, actual upload byte progress, retry and recovery reselection.
  No file bytes or object URLs enter browser recovery. Further integration and
  controller tests remain required; this is not accepted end-to-end evidence.
- Promoted allocation summaries, Details and operation lines behind a neutral
  operation context; removed count-only branches from the movement editor. Exact
  original native loan line names replace synthetic line indexes. Shared scan panel
  uses full native matching and warehouse lookup; contextual creation stays in the
  picker overlay. Transaction coordinator wiring is the next step.
- Fixed repeated contextual Item creation retaining a previous Item identity,
  discard re-retaining a removed recovery buffer, and failed picker refresh retry
  using the wrong pagination offset. Typecheck and focused tests pending.
- No reset/reseed, production acceptance, deployment or migration completion.

### Latest continuation: native movement and count editor integration

- Added shared `OperationEditorPage/View`, operation model/codec and service-backed
  controller. Native identity/version, exact original loan child/batch references,
  recorded conversions, serialized valid-only autosave, confirmation retries,
  private pending files, explicit reload/discard, recovery and lifecycle actions
  now connect to the promoted allocation UI. New movement/native document routes
  use these coordinators; unrelated old routes still need removal.
- Native receipt batches have retry-safe preparation and explicit date checks.
  Current-time movements resolve time on the server when saved/confirmed; manual
  historical times stay explicit. Native receipt insertion preserves ERPNext's
  existing valuation or permits a first-time zero-valued donation without inventing
  a rate. Reconciliations retain native valuation behavior. Added native allocation
  notes and time-mode custom fields; development schema migrated, **not reset**.
- Shared CountEditor/CountWorkspace/CountSummary now use native baseline/save and
  document services: blank/zero/not-found, full/selected scope, unchanged no-record
  result, retained removed rows, explicit re-review, old-draft deletion choice,
  actual native Desk-origin values, private files and browser recovery. Matching
  results remain local until explicitly finished; no fake native identity. Native
  count saves preserve stock-item and review-child names across saves.
- Added leave guards for movement/count navigation and native read-only dispatch.
  Item standalone/contextual editors and picker use native services; fixed recovery
  after a newly created Item's pending upload by recording/rechecking its real code
  and version. Permanent read-only Item metadata renders as selectable text.
- Receive/movement/Item/count gallery forms now wrap shared product editors. Fixture
  services provide native-shaped document/catalog/batch/file data. Gallery artwork
  is injected by the host; production has no fixture import. Old operation/count/
  document preview components still have browse consumers and require replacement
  and removal. New gallery wrappers no longer own duplicate form implementations.
- Latest evidence: native document suite **26 passed**, 7.927s; catalog **8 passed**,
  5.540s; targeted Ruff passed. Shared editor/count/gallery focused set **46 passed**
  across 4 files (verify latest combined log if newer changes follow). Typecheck
  passed before the final Item-recovery changes; rerun remains necessary. Gallery
  build passed, 2.73s, existing >500KB chunk warning.
- Captured 22 gallery screenshots (11 routes x375/1440) in
  `/tmp/temple-inventory-migration/shared-editors/`, errors.json: no exceptions and
  no production API requests. Directly inspected Receive375, Return1440, count375.
  Found/fixed stale gallery selection carrying a 50-item Receipt into Return; also
  fixed saved-draft expiry lookup for batches absent from current stock. These
  screenshots predate those fixes and are not production visual acceptance.

Next: verify latest Item recovery and editor fixes; recapture corrected forms;
finish shared Item detail/conversions, movement/loan/expiry/count browsing and
record details, warehouse/setup management, Activity recovery, shared shell/styles/
preferences/PWA/auth integration. Then native reset/seed tooling and scoped sample
file cleanup, authorized reset/seed, remove legacy schema/API/UI/styles/tests, run
full integration/build/browser/visual matrix and review the complete diff.
The existing production shell/styles and many browse/setup routes still use legacy
code. No production build/acceptance, reset/reseed, deployment or completion claimed.

### Further checkpoint: Item detail, conversions and context fixes

- Shared ProductDetail controller/view/page now reads real native Item metadata and
  complete per-location/batch stock, displays private files and guarded reusable
  conversions, and uses paginated shared report controllers for movement/loan
  history. Real Item route and gallery Item detail both use it; replaced the old
  gallery Item detail template. Old production Item feature source remains unused
  and must be removed with its obsolete tests in the final caller cleanup.
- Shared ItemConversions updates Item versions without replacing staged metadata.
  Supporting fields now participate in Item picker discard state. Private image
  preview creation failure leaves selected files usable for upload. Restored Item
  input with a created parent fetches and checks that parent's current version.
- New amendment requests now use a distinct retry identity from original document
  creation, preventing amendment retry from returning the original cancelled record.
  Amended counts reopen as editable new drafts after the original completion.
- Report lines include native allocation reasons; native enums get Chinese display
  labels. Native report suite **11 passed**, 19.752s. Latest focused shared set
  **86 passed across 11 files**; subsequent Item-detail/routed-context edits need
  the next focused run. Typecheck passed after Item detail wiring. Gallery build
  passed in 2.75s (existing chunk warning), before last route context edits.
- Fixed routed selection decoding to match the Inventory JSON contract, preserving
  commas in Item Codes. Count actions route to /reconcile/new. Added initial
  Activity context to movement props. Verify these newest edits; do not assume a
  prop's presence alone proves it is consumed (check initialization in controller).
- Remaining high-priority gaps: Activity local recovery/leave guards; Item route
  leave guards and staged supporting-record recovery; precise native loan browser/
  settlement links and all browse surfaces; native warehouse/setup; shared shell/
  CSS/PWA/auth and per-account state reset; cleanup/reset/seeds; full acceptance.
  No reset/reseed, deployment, production build or completion.

- Newest work: Activity editor now retains invalid/local input by site/account/tab,
  fetches and checks native version before recovery, guards pending save revisions,
  and has selectable copy plus explicit reload/leave decisions. Native Activity save
  returns real write/delete capabilities. Activity page/view forwards leave guards.
  Latest focused tests/typecheck are running; read editor-combined-tests.log and
  typecheck-current.log before treating this as verified.

- Latest verification after initial Activity recovery: **62 passed across 7 files**
  (editor-combined-tests.log); typecheck passed. Added further Activity recovery/
  in-flight revision/leave-guard regression cases next; their run is pending.
- ProductDetail and ItemConversions are now wired and typechecked. New Item codes
  are passed through JSON route selection; initial Activity context is consumed
  in movement initialization. Fifty-item gallery forms now use local initial
  values (native child names cleared), preserving their fixture expiry inputs.

### Current verification and precise next work

- Activity recovery, newer-input retention and leave decisions now have regression
  coverage. Latest focused editor/query/gallery set: **65 passed across 7 files**,
  typecheck passed (13:10 UTC logs). General shared suite previously **86 passed**;
  with new tests it needs the next full focused rerun after further feature edits.
- Standalone Item leave guards/beforeunload now preserve local/native pending input.
  Pending classification/unit/conversion input blocks retain-and-leave until it is
  finished or explicitly cancelled. Fixed untouched lazy Item editors appearing
  dirty before initialization, which otherwise intercepted ordinary picker selection.
- Item detail blocks navigation while conversion input is unapplied. ProductDetail
  currently loads all locations for one Item and paginates native related records.
  Per-batch links explicitly search the batch ID; precise structured batch scope is
  still a possible follow-up against report query requirements.
- Need: ProductDetail controller/browser tests, corrected gallery recapture, all
  remaining browse/detail/loan flows, warehouse/setup, shared shell/CSS and cleanup.
  Item and Activity staged supporting-record (UOM/category) fields are guarded but
  their own local recovery values are not yet persisted; implement before claiming
  complete recovery coverage. Activity save API capability change is formatted and
  Ruff-checked; rerun native tests after latest backend changes.

### Supporting recovery and loan-scope audit

- UOM/Item Group creation controllers now keep site/account/tab-scoped local
  recovery of name, parent, group and whole-number settings, expose explicit
  recovery, and remove only their own acknowledged/discarded revision. Empty open
  supporting editors also block an Item final save until finished/cancelled.
  Focused frontend run: **71 passed across 8 files**, typecheck passed.
- Audit found whole-loan lifecycle was incorrectly filtered per matching line.
  Loan status now derives from every original allocation before Item/location/
  selected-line filtering; records retain settled matching lines of an open loan.
  Draft/cancelled loans show no current outstanding balance. Exact native detail
  and report rows agree. Added two rollback integration cases; the latest report
  run is in report-tests.log and must be inspected (previous attempt had two
  Activity return-type errors, corrected by retaining Frappe's native _dict result
  while adding capabilities).
- Next implementation being prepared: shared movement/loan browse controllers and
  presentation from PreviewActivityBrowse. Must group/page complete native Item or
  document identities, preserve whole-versus-matching quantities, full totals and
  analysis, exact original-line contributions, and current whole-loan status. Do
  not use loaded-page frontend grouping or arbitrarily choose one loan from an Item.

### Native operation browsing foundation

- Added `browse.operation_page`, paginated `operation_contributions` and paginated
  `operation_analysis`. Native filtering and transient SQLite grouping happen before
  Item/document pagination. Whole-document quantities and matching quantities remain
  separate; mixed-unit record totals are arrays by stock unit. Item contribution
  rows and analysis groups are lazy/paged, not arbitrarily capped or all loaded.
- `Projection.group` supports native max timestamps for Item date sorting. Native
  posting-time sorting now uses the full raw timestamp before identity; a same-day
  reversed-creation-order regression verifies it. Header/export raw time retains
  fractional precision; input hour normalization preserves seconds.
- Latest sequential rollback runs: catalog **9 passed**, 17.740s; reports **14 passed**,
  18.714s; native documents **26 passed**, 6.748s.
  Includes whole-loan status, non-submitted zero current balances, 205 matching
  allocations versus whole-document 212 quantity, contribution paging, monthly
  analysis, and native posting-time ordering. Earlier missing import/type issues
  were corrected; latest successful logs supersede failed attempts.
- Added shared `features/movements/useOperationBrowse.ts` and `components/ItemGroup.vue`
  as the next UI foundation. They are **not yet routed or fixture-adapted**. Controller
  handles complete list/contribution/analysis pages, stale responses, exact group
  expansion, status/scope/chips and query context. Typecheck revealed nested group
  metadata cannot extend scalar ReportRow; removed that inheritance, rerun pending.
- Next: finish OperationBrowseView/Page and inject equivalent gallery services,
  replace Movement/Loans routed pages and preview wrapper, then Loan detail and
  remaining expiry/count/drafts/pending browse. Continue shell/setup/reset/cleanup
  checklist afterward. No reset/reseed, production build/acceptance or deployment.

### Shared movement/loan browse wiring and gallery inspection

- OperationBrowseView/Page now promotes Item-group disclosures, record tables/cards,
  compact scope filters, independent status/sort/search, complete totals, paged
  analysis and lazy contribution tables. Five focused tests pass, including stale
  query handling, failed page retry and explicitly choosing the second native loan
  for a Return. A reactive table-reference bug found by that rendered test is fixed.
- Movement/Loans production coordinators now use this shared implementation. Gallery
  PreviewActivityBrowse is a fixture wrapper; it no longer owns another browse UI.
  Added native-shaped fixture browse/page/contribution/analysis responses.
- Gallery build passed (3.01s), typecheck passed. Captured 12 screenshots at375/1440
  in /tmp/temple-inventory-migration/shared-operation-browse/; no exceptions, API
  requests or route alerts. Inspected loan-items375 and movement-records1440.
  Found duplicate gallery headings (old surrounding browse shell plus new heading)
  and a fixture destination-column mismatch; both corrected afterward. Recapture.
- Preserved ordinary Movement item defaults excluding opening/count adjustments.
  Added canonical boolean includeAdjustments, default true in reports, false for
  ordinary movement Item browse. The exclusion is explicit/removable and follows
  routed scope, named views and export; record browse still reads opening/count
  native identities. This replaces implicit frontend-only exclusion. Added the
  scope checkbox/chip and fixture predicate. Latest changes need focused tests.
- Fixed default fixed-status chips incorrectly increasing the secondary filter
  count. Restored one shared heading and permission-gated Receive/Issue/Transfer
  entry actions, with the locked 调拨 label. Further build/typecheck pending.
- Backend browse APIs and projection ordering have new modifications after the
  last successful native9/14/26 suites; rerun appropriate checks after UI wiring.

- Latest native catalog run **10 passed**, 16.767s, including finding a historically
  zero-balance native Batch in a selective count and reconciling a found quantity
  with native valuation unchanged. Refresh can now reuse retained removed input
  if that exact Item/location/batch re-enters the selected baseline; removed inputs
  are deduplicated and never silently become zero.
- Added separate native submit capability to movement/count controllers. Read/write
  users may save drafts; lack of submit permission does not turn an allowed draft
  into a forbidden editor. Matching counts still finish locally without submit.
  New permission/lazy-picker regression tests are running in promoted-tests.log.

- Added explicit native availability validation for app-classified Desk/frontend
  movements: aggregate Item/source and per-batch quantities at the posting timestamp,
  under native warehouse/current ledger locks, repeated before submission. It skips
  cancellation and ordinary after-submit updates. Other native stock workflows keep
  their own ERPNext policy. Integration execution was auto-review rejected because
  the first regression test wrote the site-wide allow_negative_stock setting. That
  write has been removed; the replacement test stubs only the local process getter,
  performs no preference mutation, and still uses real rollback native documents.
  No rejected setting update was executed. New native suite run is pending.

### Native loan details, settlement entry, and expiry browse in progress

- Latest native tests: **27 passed / 8.143s**, reports **15 passed / 19.747s**.
  The process-local availability policy stub passed; no site-wide negative-stock
  preference was changed. Logs remain native-tests.log/report-tests.log under
  /tmp/temple-inventory-migration/. Report count includes adjustment-exclusion.
- Replaced routed LoanDetail with shared features/loans/{useLoanDetail,
  LoanDetailPage,LoanDetailView}. Native identities, exact child/batch outcomes,
  mixed-UOM-safe totals, borrowing date vs current snapshot, paged settlement history,
  private attachments, lifecycle/Desk links, independent Return/Loss capabilities.
  Draft/cancelled loans offer no settlement. Request-generation guards reject stale
  details/files; unauthorized routes never start history reads.
- Gallery loan detail now wraps that same page; deleted its old loan-detail markup.
  Actions start a fresh operation and retain every originating native child; damaged
  return is Return + explicit initial outcome, Loss remains separate. Fixed missing
  OperationEditorPage initialActivity/initialValues props (previous gallery fixture
  values had been falling through). NativeOperationDocument fixes decoded row typing.
- Found/fixed Desk multi-destination Loan edits flattening all target warehouses:
  decode/encode now preserve each row's leased destination. Only explicit header
  destination changes update every loan row. Summary uses actual derived destination
  for Loan/Damage/damaged Return. Existing allowed damaged destinations also survive.
- Focused frontend: **54 passed / 5 files**, typecheck and gallery build **2.91s**
  before the newest expiry source changes. New tests cover native loan detail stale,
  denied, file retry, mixed UOM/history pagination and settlement permissions; damaged
  Return exact second-row identity; preserving distinct Desk destinations. Broader
  promotion tests still need rerun after expiry.
- Captured 12 gallery screenshots at375/1440, shared-loan-details/, with no exceptions,
  API requests or alerts. Inspected loan-detail-outstanding375: cramped line layout
  and header badge, plus tall summary stack. Fixed afterward with adaptive stacked
  line detail, collapsed conversion/batch details and unit summary, nowrap status;
  recapture latest. Gallery server restarted isolated127.0.0.1:5197 session85508.
- Began shared native expiry browser: browse.expiry_page + expiry_analysis use full
  projections, complete distinct Item/Batch facets excluding only own expiry choice,
  separate allocation count, full UOM totals and paged category/warehouse analysis.
  Added features/expiry/ExpiryBrowse{Page,View,Filters} + useExpiryBrowse, native route,
  fixtureExpiryBrowse + PreviewExpiryBrowse wrapper; old gallery expiry markup removed.
  Desktop rail/mobile sheet preserved. Canonical context/chips/search/window/date/
  zero-batch choice, scanned batch/location, private image, batch-scope QuickExport.
- Fixed native stock search to include Batch ID/expiry, period/window intersection,
  historical zero-batch inclusion when requested, and no fake undated Batch row for
  catalog-only zero Items. Stock allocation IDs now compact JSON; explicit allocation
  predicates accept those IDs. Fixture report predicate mirrors JSON and date/window.
  These backend changes are **new and untested**. Add native expiry integration tests,
  focused controller tests, run catalog/reports after formatting; typecheck underway.
- No reset/reseed or production build, cleanup or full acceptance yet. Large remaining
  scope: count/draft/pending/setup/warehouse surfaces, shared shell/style promotion,
  auth/PWA integration, reset/seed tooling, removal of legacy model/schema/APIs/UI,
  concurrency/export-worker proof, full tests/build/screenshots/docs.

### Expiry verification and shared shell/foundation migration

- Native catalog **11 passed / 21.827s**, then **11 passed / 19.038s** including
  bootstrap permission and warehouse-tree changes. Reports **15 passed / 21.471s**.
  A previous overlapping catalog/report run collided in shared rollback setup
  (Warehouse Type insertion deadlocks); reran report suite alone successfully.
  Do not overlap native suites using these same setup savepoints/metadata.
- Expiry integration covers4native batches, expiry today unexpired, same Batch in
  two locations (4distinct batches/5allocations), complete counts/totals with page1,
  exact compact-JSON allocation filtering, Batch search, intersecting explicit dates,
  restrictive-empty selection, historical zero Batch and no fabricated catalog batch.
  First test fixture failed because native Batch default manufacturing date was after
  its past expiry; corrected manufacturing date before rerunning. No production
  validation was weakened.
- Frontend latest before foundation: **67 passed / 7 files**, typecheck passed.
  Added actual routed repeated-query-parameter fail-closed regression (Expiry page
  had dropped arrays), real reactive gallery adapter test, paged/retry/account guards.
  Guarded Product/Loan history reads by current authorized parent identity.
- Browser found reactive structuredClone failure in fixtureExpiryBrowse; fixed by
  passing plain canonical query to fixtureReport. Recaptured12screenshots
  shared-expiry-loan/ at375/1440 with0exceptions/0APIrequests/0alerts. Inspected both
  expiry-all375 and loan-detail-outstanding375. Loan layout now fits. Fixed afterward
  clipped expiry tabs, default blank sort selection, and moved tools/zero choice into
  appropriate tools/filter surfaces; latest build/recapture pending.
- browse.bootstrap now derives draft-entry capabilities independently of submit
  permission and includes all permission-visible warehouse branches (including actual
  leased leaves), rather than only physical nodes. Native submission capability is
  still separate. Integration local permission stub verifies Receive/Return draft
  creation stays available without submit. No site permission settings mutated.
- Shared AppFrame.vue extracted from gallery shell; PreviewApp uses it. Production
  ApplicationShell.vue is now a coordinator for that same frame. Added neutral
  lib/appNavigation.ts, lib/pageDomain.ts; NativeOperation registers loaded Loan or
  loan-related settlement ownership. Five primary destinations, More, inventory
  children, mobile obstruction measurement are shared. **App.vue still has old
  focusedFlow bypass**, old root/auth/setup/PWA wrappers and lifecycle; fix next.
- Promoted the4gallery CSS files to styles/{foundation,forms,utilities,browse}.css;
  styles/app.css is the single entry imported by production and gallery. Removed
  old global frappe-ui/style.css, style.css, tokens/primitives/loading imports from
  main.ts. Those unused old files/components still need deletion after caller audit.
  Promoted selector geometry/values preserved; root density/text/theme attributes
  now data-ti-* consistently. Added applyDisplayPreferences to neutral module;
  both native account preferences and gallery apply the exact --p-* theme tokens.
  Shared text-resize measurement event renamed inventory-text-scale.
- Typecheck passed after shared frame and style moves. Focused foundation test had
  one stale dataset.previewTheme/previewDensity expectation; corrected to ti* and
  rerun underway (foundation-tests.log). Gallery build also underway. Shared frame
  geometry/focus/resize tests and latest browser comparison still required.
- Next: finish root App integration/auth/config/session/account/PWA around preserved
  input; style setup/More/settings with shared surfaces; pending/count/draft/warehouse
  pages. No reset, reseed, production build, deletion of legacy model, or final
  acceptance yet. Whole task remains open. No subagents used.

### Root application boundary and first production bundle

- Root App now uses shared ApplicationShell/AppFrame for editors too; removed the
  old focusedFlow branch and FrappeUIProvider. Shared production/gallery CSS is active.
  The native app root supplies inert/focus handling to promoted Overlay. Auth overlay
  supports non-dismissible login and stays mounted while checking resumption.
- New features/application/useApplication handles distinct loading/login/forbidden/
  configuration/network states, required-structure initialization (include_examples0),
  native bootstrap, same-account resumption and account-change reference clearing.
  Temporary same-account check failure leaves the current editor/input/files mounted.
  Existing missing configuration also preserves open input and shows blockers.
  Different accounts clear previous references before new bootstrap can fail; stale
  requests are generation-guarded. No automatic pointer repair action remains at root;
  full reviewed setup repair UI still needs implementation.
- Native session transport now returns typed identity/CSRF/preferences and distinguishes
  auth, permission and network failures. inventory_api session_info is callable for
  Guests but its account guard rejects them before data; non-System-Manager accounts
  also fail. Session identity/CSRF can be checked before ERPNext/configuration readiness;
  stock APIs retain ERPNext/Stock Entry/Company authorization. Setup company choices
  now use get_list and check the selected existing Company's read permission.
- Stock Entry/Count editors revalidate native versions after successful same-account
  login without replacing unsaved values or pending File bytes. Changed native versions
  become conflicts; deleted/forbidden records keep native failure semantics. Confirmation
  retries recognize their own submitted native confirmation version. New regression passes.
- PWA activation now waits while active movement/count/Item/Activity/reference/conversion
  editors have unsaved input or work in flight. updateSafety registry cleans up with each
  controller; root update button and handler both enforce it. Existing route leave/recovery
  flow remains the way to retain/discard unfinished input before leaving the editor.
- Latest focused frontend **72 passed /8files** (root-tests.log), typecheck passed.
  Includes app guest/forbidden/setup/account switch, preserved same-account DOM input,
  update activation blocking/cleanup, shared frame single surface and listener cleanup,
  retained input across 1024px breakpoint, native document post-login conflict, and
  existing native operation/count/expiry/UI-preference/gallery tests.
- Latest native documents **28 passed /7.257s**. First new session success test failed
  because bench execute has no HTTP session_obj; only its built-in CSRF getter is now
  locally stubbed for that test. Guest/role authorization remains real; no site/session
  preference or permission mutation. Native HTTP session behavior still needs browser proof.
- First production bundle **passed /8.31s**, PWA generated92precache entries2600.45KiB.
  Build still includes legacy Workspace/History/etc chunks: not final cleanup or acceptance.
  Gallery build passed3.22s; latest small full-height sidebar correction keeps gallery's
  60px header allowance while production has0. Latest gallery rebuild underway.
- Next: shared Settings/More/setup/pending/draft/count/warehouse replacement; native
  root HTTP/browser proof, full suites, reset/seed tooling and legacy schema/API/source
  removal. No reset/reseed or live deployment occurred. Keep native DB test suites serial.

### Shared account settings and More; account-bound transport

- Added features/settings/{useDisplaySettings,DisplaySettingsPage,DisplaySettingsView}.
  Production and gallery use the same service-injected controller/save queue and UI
  for3themes,3densities and5text sizes. Fixture profile/scenarios are development-only.
  Gallery review controls now track that fixture account's same working display state;
  its local design preferences never migrate to a real account. Failed fixture saves
  are explicit; confirmed native preference cache updates only after server success.
- Updated Settings integration tests to rendered shared controls and service injection:
  exact p-* theme tokens, text/density independence, failed save + retry + unchanged
  confirmed cache, old-account response rejection, storage denial with server saving.
  Latest settings/UI-preference/gallery subset38passed; typecheck passed.
- New X-Inventory-Account request header binds app RPCs and uploads to the window's
  authenticated account. Native stock/front-end APIs and File writes reject stale
  window data after an account switch. The System-Manager session handshake remains
  available to identify the actual account (no inventory data), and ordinary native
  Desk requests without this header retain their normal permissions. Regression uses
  real document/File guards with a process-local request header, no site mutation.
  Latest native documents **29passed /7.068s**.
- More now uses shared MorePage/View/useMoreController with injected device/logout
  host and native data service. Added browser-independent installGuidance helper;
  PWA registration/runtime remains production-only. More has5primary-nav-consistent
  tools, one new-count entry, real user, installation guidance, retryable logout and
  an independent native draft counter. Native host refreshes account before logout.
  Gallery supplies a fixture host and explicit device scenario; old More/settings
  gallery markup removed. Full setup/recovery mockups still remain pending replacement.
- Added browse.more_summary complete distinct native document count, not UOM group or
  page length. Integration proves one mixed-UOM native draft counts once and deletion
  removes it. Latest native catalog **12passed /18.489s**.
- Rendered More test exposed optional Boolean active props defaulting to false when
  omitted. Made default active=true explicit across promoted pages/controls and their
  thin fixture wrappers. This fixes ordinary directly opened production pages, not
  just the test. List: /tmp/temple-inventory-migration/active-default-files.txt.
- Latest More/settings/gallery/shell/application/PWA subset **46passed /6files**,
  typecheck passed. Earlier failed isolation test was corrected by extracting pure
  installGuidance rather than allowing gallery to import PWA runtime.
- Production build8.31s predates latest settings/More/account-header/active-default
  changes; rebuild required. Gallery latest2.96s also predates active defaults.
  New browser capture should include settings/density, more/index and device/logout
  dialogs, plus repeated mobile/desktop core routes. Prior shared-expiry-loan capture
  after shell extraction had0exceptions/0APIrequests/0alerts.
- Current next UI gap: Pending (damaged-stock-only Repair/Disposal) with exact native
  Item/location/batch prefill; server/native operation source selection is already
  authoritative. Fixture stock still folds loaned/damaged quantities into physical
  locations; normalize fixture stock locations for native-shaped shared UI instead of
  inventing a first batch/loan. Then drafts/browser recovery, warehouse/setup, counts
  browse/Back targets, navigation state restoration, seed/reset/legacy removal and
  full acceptance. Source is still deliberately in transition. No reset/reseed/deploy.

### Pending native damaged stock and exact contextual creation

- Replaced Pending with shared service-injected controller/Page/View: native damaged
  balances only, full filtered totals, paging/retry, desktop rail/mobile sheet,
  complete analysis and exact allocation exports. Production and gallery render the
  same component. Repair/Disposal start fresh editors with exact Item, damaged leaf,
  Batch and stock-unit quantity; destination selection remains explicit.
- Added strict JSON allocation route decoding, preserving comma/slash identifiers
  and rejecting malformed or nonpositive quantities. Native editor prefill loads
  authoritative Item/Batch metadata and never invents an original loan reference.
- Normalized gallery stock into actual leased/damaged leaves rather than physical
  location summaries. Unassigned batch provenance remains unassigned. Corrected
  fixture distinct Item counts and batch allocation subtraction. Dashboard now uses
  the same normalized stock. Native current-stock queries reject transaction-only
  restrictions as empty; fixture projection now follows this rule. Native reports
  regression/rerun still required for the newest restriction guard.
- Gallery navigation now separates persistent Loan detail context from transient
  settlement prefill, consumes fresh operation allocations once, generates fresh
  form instance IDs and clears browse scope for primary navigation.
- Latest focused Pending/operation/expiry/More/settings/gallery **59 passed /6files**
  and typecheck passed, before the small Dashboard/restriction alignment above.
  No fresh browser capture or production/gallery build for this checkpoint yet.
- Next: finish these checks, replace legacy Drafts with native drafts plus clearly
  separate browser recovery, add actual Counts browse route, then setup/warehouses,
  context restoration, reset/seed/legacy cleanup and remaining acceptance evidence.
  No reset/reseed or deployment has occurred.

### Native Drafts and actual Counts browse

- Added shared features/drafts/NativeRecords{Page,View}/useNativeRecords for native
  Drafts and Counts. Production /drafts no longer routes to legacy History; /counts
  now resolves. Gallery drafts uses the same page and adds counts/records; removed
  the old drafts table/dialog markup. More retains its new-count action and links
  to count records. Browser recovery is separately labeled and account/site scoped,
  with copyable values, pending-file reselection guidance, exact selected revision
  discard and native-versus-local routing. Item/Activity recovery route IDs now
  propagate through coordinators to filter the selected candidate.
- browse.native_drafts/counts_page group complete projections by native document,
  independent of unit and paging, and return whole-document quantities/line counts,
  matching allocations, exact version and native edit/delete permissions. Filters
  use one matching allocation. Deletion is explicitly confirmed and version checked;
  failures retain rows/local input. Gallery native create/save/delete now synchronize
  its native-shaped saved records into report fixtures; incomplete examples stay local.
- Native catalog **13 passed /19.117s**, including mixed-unit draft once, same-row
  source/destination filters, native count identity and exact version. Native reports
  **16 passed /19.505s**, including fail-closed current-stock transaction predicates.
- Focused records/Pending/More/Item/Activity/gallery **57 passed /6files**; typecheck
  passed; gallery build **2.96s**. Two initial records test assertions compared all
  three RPC arguments against two-element arrays; corrected assertion boundaries,
  no production change. New browser capture remains next.
- Still incomplete: warehouse/setup replacement, browse state restoration, native
  HTTP/browser matrix, native recorded-factor amendment under Item read-only access
  audit, cleanup/reset/seed tooling, legacy removal, concurrency/export-worker proof,
  full suites/build/visual acceptance/docs. No reset/reseed or deployment.

### Setup replacement and additional native lifecycle verification

- Captured21gallery screenshots at375/1024/1440 in shared-pending-drafts-settings/:
  Pending, Drafts, Counts, Settings, More, Inventory and Receive. Browser reported
  0exceptions/0APIrequests/0alerts. Inspected Drafts375, Pending1440, Settings375 and
  Counts1024; native list retained preview horizontal-table behavior, settings used
  shared density/theme geometry. This capture predates the new Setup implementation.
- Fixed native amendment under Item read-only permission: an authorized cancelled
  original may supply its recorded Item/UOM/factor, while changing it to a new
  unconfigured factor is rejected. Native documents **29passed /7.343s**, including
  cancel/amend/retained factor10stockquantity after Item reusable-factor changes.
- Added configuration.py: manager/account/native permission checks, explicit missing
  vs inaccessible/disabled/wrong-group setup states, immutable current config version,
  clean native initialization (physical group + usable Room leaf, leased group + real
  leaf, damaged leaf), no stock/Items/sample installation. Re-initializing existing
  references is rejected. Pointer repair requires exact reviewed fingerprint and
  explicit confirmation; version/tree changes reject; candidate native Warehouse is
  locked. Pointer changes never reparent nodes or move stock. New initializer clears
  retired loan/virtual pointer values; their schema removal is still pending.
- Shared features/setup/Configuration{Page,View}/useConfiguration replaces gallery
  setup mockup and production startup's legacy setup UI. /setup now resolves. Root
  checks configuration.status; production setup changes trigger root recheck while
  same-account editing state stays mounted. Gallery uses fixtureConfiguration only.
- Native configuration **5passed /1.025s**, rollback-isolated. First-init test adjusts
  only test Warehouse labels to avoid colliding with existing development canonical
  names; native insert/permissions/hierarchy remain real. Config/changed tree/explicit
  confirmation/stock-and-record-preservation all pass. Latest minor candidate lock
  and obsolete-pointer-clearing changes need final rerun.
- Frontend config/application/records/Pending/gallery **47passed /5files** and
  typecheck passed. Tests cover initialization confirmation, precise review/version
  payload, conflict input retention, denied read distinct from missing, account change
  late-response rejection and shared gallery state. Build/capture latest Setup next.
- Began native warehouses.py metadata/tree/save API (new, **unverified**): native
  versions, physical scope, distinct Room/Location and is_group, system-node guard,
  cycles, existing stock/document hierarchy protection and whole native fields kept.
  No replacement warehouse UI yet. Finish API/tests, promote shared warehouse UI and
  gallery; old routed warehouse pages still exist. Broader remaining work remains as
  above. No development reset/reseed or deployment has occurred.

### Shared native warehouse workspace and session retention

- Replaced routed warehouse list/detail with NativeWarehouses{Page,View} and
  useNativeWarehouses. Gallery uses those same components with fixtureWarehouses;
  old warehouse list/detail/form markup removed from PreviewBrowsePages. Native
  topology, selection/search, expansion, group descendant stock, complete per-UOM
  totals, paged stock/history, exact Item/native document/export links, fresh native
  metadata/version/permissions and real read/loading/error states are wired.
- Native Warehouse API guards company/physical scope, native version, cycles,
  system nodes, group/leaf conversion, stock/document-linked hierarchy and disabling
  stock-holding nodes. Metadata edits preserve unknown native fields. New Room is
  a leaf by default; type and is_group stay independent. Fixed Desk discovery hook
  to admit native Room leaves as well as Location, and exclude disabled leaves.
- Added Warehouse browser-only recovery with version check and copyable values;
  exact candidate routing from Drafts, failed-save/newer-in-flight input retention,
  leave/discard/storage guard, account cleanup and PWA blocker. Raw invalid query
  selections fail closed. Warehouse actions preserve explicit physical source/target
  into Receive/Issue/Transfer and Count; no source chosen from another location just
  because it has stock. Saved metadata triggers production reference refresh.
- Native Warehouse **4passed /1.096s** (latest serial rerun). Native catalog
  **13passed /19.885s**, now covering complete distinct native Drafts/Counts too.
  Config repair now writes only its explicitly reviewed native singleton field,
  allowing another broken pointer to retain its own separate repair. Latest Config
  **6passed /1.155s**, including this partial-repair regression. Latest disabled-leaf
  status wording/filter is a small subsequent change, still needs final suite rerun.
- Frontend latest broad focused **80passed /10files** (warehouse-frontend-tests.log),
  typecheck passed, gallery build3.27s. Subsequent history fixture/root-pointer/long-label
  corrections **56passed /6files** (warehouse-visual-tests.log), typecheck and gallery
  build **3.28s**. Native transport/preferences/application after final JSON handling
  **15passed /3files** (transport-tests.log). Latest minor footer link not built yet.
- Same-account403 checks now keep the original editor DOM/files mounted behind a
  blocking access overlay until a successful check; a network error cannot unlock a
  known permission failure. Request transport wraps fetch failures in Chinese and
  recognizes401 even with malformed/non-JSON session responses. Local recovery skips
  malformed metadata safely; Warehouse recovery checks its field types.
- Browser captured20screens at375/768/1024/1440 in shared-warehouses-setup/ with
  0exceptions/0APIrequests/0alerts. Inspected create375, tree1440, setup375, detail768.
  Inspection found missing history kind/quantity/unit in the fixture adapter; corrected
  the adapter to native per-unit record grouping and added a rendered-history regression.
  Also corrected fixture setup roots and long-label stacking; latest recapture20 is
  complete but final corrected screenshots should still be inspected after this point.
- First full frontend run: **707tests,501passed,206failed in30files**. Raw Vitest
  also reports74failed nested suites. Full details /tmp/temple-inventory-migration/
  full-frontend-results.json and full-frontend-tests.log. Native replacement test
  files passed. Failures largely use obsolete direct API mocks, removed styled
  components, old preview state controls, old route/filter/style contracts or mount
  shared components without injected services. They still require a deliberate
  capability audit and migration/removal with legacy source cleanup; do not declare
  the full suite passing or delete behavioral coverage indiscriminately.
- Next: production contextual Back/Forward must retain browse selection/scroll/pages
  and nested table state. Avoid naive KeepAlive of reactive useRoute controllers.
  Then native source/API/schema/style cleanup and reset/seed tooling BEFORE reset,
  native HTTP/browser acceptance, separate-connection concurrency and real queued
  export/large-data proof, full tests/build/docs. Audit Desk warehouse metadata
  protection and recorded-factor duplication/read-only behavior during final native
  review. No reset/reseed or live deployment occurred.

### Scope/authorization audit before navigation restoration

- Found malformed Inventory and Reports links could still fetch default broader
  data. Stock controller now gates invalid/wrong-family/current-vs-historical scope,
  suppresses canonicalization until valid, and presents an explicit default-scope
  action. Export workspace similarly blocks data/quick-export UI until explicit reset.
  Repeated query parameters fail closed in Reports/Activities coordinators. Historical
  Inventory drill-through stays in its actual report rather than current stock cards.
- Added neutral serviceFailure classification. Inventory, common report tables,
  movement/loan browse (including parallel contributions/analysis), expiry and native
  records clear cached server rows/totals on forbidden/deleted/authentication failures;
  network failures retain stale results. Stock rejects late old-account responses.
  User queries/local recovery remain separate. Common watch tuples now compare actual
  sources, avoiding duplicate reloads after logically unchanged route canonicalization.
- Stock desktop/mobile creation actions now share controller-owned native capability
  choices; Warehouse operation/count capabilities also moved into its controller.
  Warehouse refresh labels retained stock as previous data while updating. Gallery
  record adapter now sorts native per-UOM records by requested date/identity.
- Latest scope/controller/gallery subset **79passed /10files**, typecheck passed
  (scope-guards-tests.log, scope-guards-typecheck.log). A gallery settings test previously
  typed into an inactive hidden inventory demo; it now opens the actual Inventory tab
  before asserting retained search across theme/density/breakpoint changes. No runtime
  workaround was added for that test. This checkpoint has not yet rebuilt the gallery
  or production bundle. Config's latest disabled-leaf availability filter needs rerun.
- Inspected corrected shared-warehouses-setup detail768 and tree1440 screenshots:
  history now has kind/quantity/unit, long warehouse labels/types stack cleanly. The
  screenshot predates the final date-sort correction and scope/capability changes.
- Immediate next implementation remains browse Back/Forward state. Prefer storing
  UI selections/expansion/scroll plus loaded-page depth per account/site/history-entry
  and reloading native rows, rather than caching server data or naive KeepAlive of
  reactive route controllers. A history-entry position in the root component key can
  distinguish fresh primary navigation from returning to an earlier entry while
  preserving ordinary query replacement. Native HTTP proof still waits for the clean
  reset/seeds and legacy removal. Do not reset early; no reset/reseed/deploy occurred.

### Navigation restoration in progress (unverified checkpoint)

- Added tab-local browseMemory keyed by site/account/path/browser history position.
  It stores selection/view/expansion/scroll and loaded-page depth; native result rows
  are fetched again on return. Read wrappers replay ordinary native pages to the
  previous depth, including explicitly named report tables. No writes are replayed.
- Root route identity distinguishes fresh primary navigation from history return;
  query replacement retains the active controller. Added row/table/detail identities
  to shared browse surfaces and UI-state hooks to Inventory, movements/loans, expiry,
  Pending, Drafts/Counts, warehouses, Dashboard and Reports. Work is not accepted yet.
- Audit found Activities did not write filters/tabs back into its URL and malformed
  scopes could still query default data. Added guarded canonical query events and
  explicit reset, suppressed report reads in the editor, and carried lifetime-kind
  drill-through in the detail route. These changes still need focused regression tests.
- Immediate next: format/typecheck, test real router Back/Forward/fresh same-path
  navigation and native-page replay, then inspect browser scroll/focus/table retention
  across 1024px. Continue the remaining cleanup/reset/seed/backend/browser checklist
  above afterward. No reset/reseed/deployment has occurred.

### Navigation checks and process cleanup

- Initial focused navigation/controller run **55passed /9files** and typecheck
  passed. Added Activity URL/malformed-scope/lifetime-link regressions; Activity and
  gallery subset **33passed /2files**. Latest navigation-memory subset **12passed
  /3files**. Formatting and final combined checks are still pending after the
  newest detail-page hooks. Native configuration rerun **6passed /1.514s**, covering
  the previously pending disabled-leaf availability change.
- Real routed production UI + HTTP transport with controlled native-shaped responses:
  Chromium **3passed /10.4s**, at375/1024/1440 (navigation-browser.log). Exercises
  Back, previous page-depth rereads, selected native Item, list view, logical row,
  horizontal table offset, resize in both directions and fresh primary reset. This
  is UI integration proof, NOT native DB/server authorization acceptance.
- Browser checks found compact-header layout settling and responsive wrapping moved
  the row after an initial restoration. Added bounded layout settling and the last
  measured focused-row anchor before width changes. Corrected the test's departure
  measurement to capture the actual click after the browser reveals its wide-table
  target; corrected its reset assertion to count row selections rather than the
  independent "in-stock only" checkbox. Removed temporary diagnostic logs.
- Inspected returned375 and resized1440 Chinese-font screenshots directly: selected
  Item42 remains at the same vertical position; mobile retains its horizontal table
  viewport, desktop expands the complete columns. Screenshot paths are under
  /tmp/temple-inventory-migration/navigation-browser/. No page exceptions or unexpected
  API calls in these tests. Added detail state hooks for Item/Loan tables afterward;
  no new browser acceptance is claimed for those two hooks yet.
- Per user's process-cleanup request, inspected host process list. No live test
  workers were hung. Stopped task-owned old gallery preview tree135402/135403/135415
  (port5197). Active production Vite tree158219/158220/158232 serves port8080 despite
  the CLI port5198 (Frappe plugin config); keep it while browser checks need it, then
  stop it before yielding. Exited Chromium children are zombies under PID1 and cannot
  be killed. Do not stop unrelated services or PID1.
- Next: finish remaining navigation/detail/gallery tests and builds; audit native
  Warehouse Desk parity and recorded-factor duplication, then legacy source/schema
  and reset/seed tooling. Full migration remains incomplete; no reset/reseed/deploy.

### Shared navigation completed; Desk Warehouse guards; frontend retirement started

- Combined frontend navigation/native-controller/gallery subset **99passed /14files
  /5.89s**, typecheck passed (navigation-final-tests.log / navigation-typecheck.log).
  Includes Activity malformed-scope/URL/lifetime-kind regressions and Item/Loan detail
  hooks. Gallery Activity wrapper now preserves native queries and lifetime links
  through the same controller interface; no production fixture dependency added.
- Moved Warehouse hierarchy/stock/system-node checks into its native validate hook,
  used by Desk and app saves. Kept ordinary native permissions; no System Manager
  frontend gate on Desk. Reference checks use locking current reads. Added direct
  Desk-style tests for stock, system nodes, children, hidden descendants, draft refs.
  Native **6passed /1.779s** (warehouse-tests.log), targeted Ruff passed. A first role
  mock used Stock Manager, which lacks native Warehouse write permission; replaced
  that mock with a real Item Manager account and proved frontend denial + Desk save.
- Removed legacy /workspace, /entry, /history, /loans and /movements aliases; current
  callers use explicit native/detail and items/records paths. Corrected gallery
  example URL metadata. Generated a relative-import closure from production and
  gallery entrypoints (/tmp/.../frontend-source-graph.json) and deleted unreachable
  old production features/pages/components/CSS and their dead helper modules.
  Exact removal manifest: /tmp/temple-inventory-migration/retired-frontend-files.json.
  New shared styles remain foundation/forms/utilities/browse; no old tokens stylesheet.
  Kept environment declarations and shared infinite-scroll infrastructure. Unreachable
  gallery duplicates and obsolete tests still require deliberate migration/cleanup.
- Cleanup typecheck/build verification is now running. Do not treat source deletion
  as acceptance: full frontend suite was already red on retired contracts, and tests
  must be mapped to native replacements instead of reinstating compatibility mocks.
  Backend workspace/schema/API/seed cleanup has NOT happened yet. Native Warehouse
  regression passing does not prove separate-connection races. No reset/reseed/deploy.

### Import cleanup, saved-document URLs and native helper extraction

- Production build **4.32s**, gallery build **3.92s** after retiring unreachable old
  frontend source. Generated assets were built, not hand edited. These builds predate
  the subsequent transport cleanup, native URL helper and session endpoint change.
  Source closure manifest is a read-only audit aid, not a permanent compatibility layer.
- Removed unused legacy frontend RPC/workspace/export/upload/label helpers and their
  warehouse presenter from lib/api; only account-bound transport/session remain.
  Shared UiButton, DetailPopover and HierarchyFilter tests now exercise their promoted
  component paths. Added native-editor-route regressions. Latest focused **33passed
  /7files**, typecheck passed (cleanup-focused-tests.log / cleanup-typecheck.log).
- Saved Stock Entry/Reconciliation URLs now replace the creation/original path with
  their actual native identity, including after amendment. The route helper waits
  for the entire save/finalize cycle, pending files, dirty input, supporting edits,
  review and lifecycle work; savePending counters cover serialized in-flight saves.
  Browser proof for actual create/submit/amend URL transitions is still outstanding.
- Full frontend diagnostic after source retirement is still red: collected498tests,
  316passed/172failed/10pending, with additional import-failed obsolete suites (Vitest
  reports105 nested failed suites). cleanup-frontend-results.json/log retain details.
  Missing-import suites cannot collect all old cases, so this is not comparable to
  the previous707-test denominator or a claim that coverage improved. Do not hide
  these failures. Remaining test migration must preserve behavioral capabilities.
- Extracted active Warehouse topology/discovery into native_topology and account
  handshake into session.info. Native services no longer need the giant legacy
  inventory_api module. Bootstrap now uses configuration.status, omits retired loan
  pointer and exposes native Warehouse labels/breadcrumbs without fallback identities.
  Physical/leased/damaged selections exclude disabled branches, while native history
  can still read permitted disabled records. Native leaf validation rechecks disabled.
  Updated app/services/gallery/settings and native session tests to new endpoint.
- This extraction is in progress: native document suite currently running, then
  serial catalog/reports/configuration/Warehouse regressions, frontend checks and
  browser rerun. Legacy backend files/schema, old patches and dev seeds still exist;
  do NOT delete/reset until all native dependencies and tooling have been replaced.

### Extraction regression results and native batch-amendment defect

- After extraction: native documents **29passed /7.952s**, catalog **13passed
  /20.755s**, reports **16passed /20.650s**, Warehouse **6passed /1.822s**.
  Configuration initially rejected its old stale-review test setup because it
  renamed a protected system node. Changed the test to edit a real unprotected
  replacement candidate; protection remains intact. Config **6passed /1.379s**.
- Frontend transport/settings/editor/navigation/shared controls **94passed /14files
  /5.25s**, typecheck passed. Production rebuilt **3.89s** with new session endpoint
  and native saved-identity URLs. Gallery rebuild still needed after endpoint change.
- Routed controlled-HTTP browser history subset **3passed** after endpoint change.
  New create/reload/submit/cancel/amend/reload URL scenario **1passed /2.3s**
  (editor-route-browser.log). Its initial run used the wrong generic confirmation
  label; corrected to the actual 确认提交 button. No app workaround added.
- A new native batch-amendment regression exposed a real defect: ERPNext detaches
  bundle links on cancellation, so the copied draft could not submit. Added exact
  voucher/child/warehouse bundle lookup and a fresh permission-checked native bundle
  copy. Never reuse the cancelled original or infer a batch from stock. Respect
  native no_copy fields and explicitly preserve the posting boundary. Native scope
  and validation now check Batch permissions inside bundles as well as direct rows.
  Focused regression **1passed /0.951s** (batch-amendment-tests.log); expanded bundle/
  recorded-factor/permission tests and full native runner still need to run.
- Added new rollback-only test_native_inventory.run entrypoint, with optional
  test_name selection for focused regressions; it collects each suite's own cases
  once. It has only run the focused new regression so far. Update current command
  references after verifying the full runner. Old workspace runner/schema/seed and
  pending frontend test migration remain work, not compatibility requirements.

### Verified native runner and next cancellation audit

- Complete new rollback-only runner **72passed /53.003s**
  (native-integration-tests.log): 29document +15catalog +16report +6configuration
  +6Warehouse cases, without inherited-case duplication. Updated current AGENTS
  and handoff command references to test_native_inventory.run; the task specification
  remains requirements, not a completion report. No reset or sample install in runner.
- Multi-batch amendment regression **1passed /1.332s** in its focused run before
  the full suite. Retains 1 entered package, recorded factor5 while Item default8,
  native allocations2/3 across two batches, safe native submit and original bundle
  provenance. A denied Batch cannot be read through the original active bundle.
- Latest production build **3.89s**, gallery build **3.38s**; source typecheck and
  focused94frontend tests passed before the two most recent backend-only regressions.
  Native URL unit test strengthened to prove Back returns to its caller; **2passed**.
- Next discovered audit: cancelled Stock Entry rows lose their direct bundle link,
  so reports/details may omit original Batch identities even though native bundles
  still retain exact voucher/child/warehouse provenance. Reuse a permission-checked
  native allocation resolver for history/scope/amendment; add a cancelled-record
  regression before claiming this is fixed. Duplication with recorded factors under
  Item read-only access remains unimplemented/unverified; do not conflate it with
  the now-tested amendment path.
- Outstanding major work unchanged: migrate remaining retired frontend/gallery tests,
  remove legacy backend/schema/patches and old sample code, prepare private-media
  inventory/reset/native seeds before resetting only development.localhost; actual
  native HTTP/browser, worker/large export and separate-connection concurrency proof;
  complete responsive/theme/text-scale acceptance and final architecture docs. Active
  Vite server remains task-owned and should be stopped when browser work is finished.

### Cancelled batch provenance and existing receipt editing

- Native balances now owns permission-checked entry_bundle resolution, shared by
  native scope checks, report allocation/loan rows, detail serialization and amendment.
  Cancelled Stock Entry provenance resolves only from its exact native voucher,
  child and warehouse; ambiguous bundles fail explicitly. No batch chosen from stock.
  Reports keep original allocation IDs/quantities; cancelled Loan borrowed quantities
  remain recorded while outstanding remains zero. Native serialization exposes
  recorded_bundle / recorded_batch_allocations separately from the cleared raw field.
- Focused cancelled-report/detail/Batch-denial regression **1passed /1.166s**.
  This is after the72-test checkpoint. Full native runner now running again with73
  cases; report its actual result before finalizing this checkpoint.
- Shared operation summary/details now display recorded batch numbers, quantities,
  native bundle identity and expiry dates, including cancelled records. A deliberate
  batch or Item replacement clears old bundle metadata. Existing receipt save skips
  Batch preparation when its native bundle remains; it no longer prepares a replacement
  batch or requires a fictitious single expiry date for a multi-batch native row.
  Frontend rendered-bundle/save regression and nearby movement/loan tests **22passed
  /3files**, typecheck passed (batch-display-tests.log / batch-display-typecheck.log).
  This UI change needs refreshed builds and browser screenshot inspection.

### Full native resolver validation and shared design test migration

- Complete runner after sharing the resolver **73passed /58.954s**
  (native-integration-tests.log). Source-bundle resolution now also checks Item identity;
  loan settlement projection selects its Item code explicitly for that check. Targeted
  Ruff passed. Latest frontend batch subset22passed/typecheck passed, production build
  **4.56s**, gallery build **4.00s**. Both build outputs generated normally.
- Replaced obsolete design-system assertions that loaded deleted CSS with the actual
  shared foundation contract: exact three themes/radii, 4.5:1 text/status contrast,
  3:1 control-border contrast, density/mobile44px/text settings and sole stylesheet.
  Added source-import graph checks proving production excludes gallery and gallery
  excludes live API/auth/PWA entrypoints; shared native document components are in
  both graphs. **5passed** (shared-design-tests.log). A first path check matched the
  workspace's absolute /workspace directory; corrected it to retired feature paths.
- Full current native/shared/frontend subset is now running. Batch browser screenshot
  matrix (375/768/1024/1440 x100/200%) is rerunning after scoping assertions to the
  main detail instead of counting both main and review summaries. No visual acceptance
  claimed until screenshots are directly inspected. Active server cleanup still due.

### Current focused frontend set and screenshot-found review layout defect

- Current native/shared frontend set **210passed /35files /7.20s**
  (current-native-frontend-tests.log), including scanner/PWA/recovery/preferences,
  design graph and promoted UiButton/DetailPopover/HierarchyFilter tests. Migrated
  quantity-summary/card tests to the actual native StockBrowsePage and StockDetails:
  **5passed**, covering mixed units, status quantities, native selection, distinct
  Item/Batch details across locations, site-date expiry and truthful zero-batch Items.
- Batch controlled-HTTP browser matrix **8passed /17.7s** at375/768/1024/1440 and
  100/200% text (before visual correction). Inspected375-100,375-200 and1440-100
  screenshots directly. They prove original batch quantities/dates and recorded
  factor5 while Item default8, but exposed a real mobile review panel defect: an old
  two-column floating-summary rule squeezed its expanded allocation details into
  half a card. Added a full-width stacked static summary rule and browser geometry
  assertion; recapture/rerun is in progress. Do not treat the pre-fix screenshots as
  final visual acceptance. No new global theme geometry or color changes made.

### Reset tool boundary correction (no reset executed)

- Auditing the old reset script found it accepted arbitrary developer site names,
  used hardcoded password fallbacks, and printed the Administrator password into its
  tee log. Restricted it to exact development.localhost, required environment/explicit
  credentials instead of default123/admin, and removed password output. Preserved
  its existing preflight/destructive acknowledgement flow. Shell syntax and early
  out-of-scope-site rejection passed without invoking Bench or touching a database.
- This does NOT make the old installer ready: it still calls legacy structure,
  sample transactions, public-media import and legacy verification. Replace these
  and inventory known seeded media/derivatives before using the reset script. No
  reset/reseed or Administrator password change occurred.

### Resume: process cleanup and native sample/media tooling

- Stopped the abandoned task-owned Vite/pnpm/esbuild processes (158220/158232/158245).
  No live test workers remained. Exited Chromium zombies belong to PID1 and cannot
  be reaped by this task; no unrelated service was stopped.
- The corrected batch browser matrix from the preceding turn finished **8passed
  /17.6s**, including full-width mobile review-panel geometry. Corrected375-100
  screenshot inspected; additional high-text screenshots and rebuilt assets remain due.
- Extracted a clean, development-only native_sample_catalog.json:160 Items,175 known
  optimized assets,77 opening allocations and6 batch-tracked Items. It contains no
  runtime frontend fixtures or legacy custom-document imports. Native installer
  replacement is in progress; do not run the old installer/reset yet.
- Added read-only, exact-site sample media inventory with byte hashes, native
  thumbnail paths, symlink/path bounds and unrelated/shared-reference protection.
  Actual read-only bench inventory found160 known sample Items,350 original files
  /45,352,716bytes, **0 public copies**,0 unrelated protected paths. No manifest
  was written, no file was deleted and no database reset occurred. Cleanup still
  needs regression tests and wiring into the native reset sequence.

### Native seed implementation and backend retirement

- Native installer now creates164 standard Items (the original160 plus workflow,
  fractional-Kg, zero-stock/missing-image and undated-batch examples),175 private
  originals, native Room/Location leaves, site-relative expired/near/future batches,
  multiple barcodes and recorded-vs-current Box conversions. Its workflow creates
  all9 movement kinds, two compatible loans, a single multi-loan partial return,
  damaged return and separate loss, native draft and cancelled Desk-origin receipt,
  and one reviewed reconciliation difference. Stock/loan assertions read ERPNext.
- Rollback validation caught ordinary ERPNext opening-account/fiscal-year requirements;
  fixed using native Temporary Opening and explicit company/Fiscal Year associations.
  Native quantities and loan balances now pass. Final test iteration corrected an
  erroneous expected valuation (ERPNext's existing value is10); complete runner is
  executing and no passing total is claimed yet. Images/private receipt-file writes
  are deliberately skipped in this full-catalog rollback case; actual seeded media
  installation/download checks remain required after reset.
- Removed35 retired backend/schema/seed/patch files after import-consumer audit;
  exact manifest and82 retired workspace test names are in
  /tmp/temple-inventory-migration/retired-backend-files.json. Active code has **zero**
  imports of those retired modules. Retained native Stock Entry expired-receipt
  mixin, native File hooks, periods and Item code allocation. Removed workspace
  permission hooks, obsolete native links/personnel and Warehouse fallback fields,
  old settings pointers, and data-adoption patches from fresh installation.
- Replaced the old workspace runner with native suites earlier; this retirement
  removes its obsolete source-contract tests too. Capability coverage maps to
  native document/catalog/warehouse/configuration/report suites and new sample/media
  tests. This does not waive outstanding native HTTP, concurrency, worker/large
  export, full historical/permission matrix or frontend acceptance.
- Reset wrapper now inventories known media before reinstall, checks hashes again
  before unlinking exact scoped paths, then invokes native installer/verifier.
  Added preflight guard refusing reset while retired business schema/fields remain
  in source; verifies all175 asset hashes. Media cleanup preserves unrelated/shared
  originals, their thumbnails and user-added files even on known seeded Items.
  Traversal/symlink/shared-path/changed-content tests added; shell syntax passed.
- Current database still contains the OLD installed schema/data; source retirement
  does not remove database tables/fields. **No reset, reseed, file cleanup, admin
  password change or deployment has occurred.** Required root/admin credential env
  variables are absent; never guess defaults or print credentials. Continue useful
  code/test/acceptance work while the reset prerequisites are resolved.

### Post-cleanup builds and high-text visual inspection

- Generated production build **4.43s** and gallery build **3.28s** after the mobile
  review layout correction. Directly inspected corrected375-200 and1440-200 batch
  screenshots in addition to375-100. Batch IDs/quantities/dates and recorded factor5
  remain readable; mobile review details stack across the card width. These are
  controlled-HTTP examples, not native-server or full visual-matrix acceptance.
- Native seed test request identities now receive an isolated test namespace too,
  so future runs after reseeding cannot retry against the site's real sample docs.
- Requested an authorized local credential source asynchronously; root/admin
  passwords are absent from both environment and site/common config. Reset work
  remains pending that information; independent cleanup/testing continues.

### Native validation, file UI migration and reset credentials

- Full native integration after source retirement: **77passed /72.386s**.
  Native reset preflight passes, including all175 original asset hashes.
- Migrated attachments/image tests to actual shared components and native-parent
  controller. Added pending/native-parent finalization, denied removal/retry/version,
  image-only input, account change, private upload confirmation, primary images and
  recovery reselection coverage. Fixed primary() missing its active-account check
  and upload confirmation accepting a public URL with a private flag. Focused
  attachment/image/Item/operation editor subset **29passed /4files /1.03s**; typecheck
  passed. Native File authorization tests are separate from these service doubles.
- Two intended focused commands accidentally passed -- as a positional separator
  and ran the full frontend suite. Latest diagnostic: **60failed files/39passed;
  172failed tests/349passed/10skipped;1listen-EPERM environment error**. No waiver.
  Correct focused invocation is pnpm exec vitest run <paths>. Host process check
  confirmed no surviving Vitest/typecheck workers from those runs.
- Updated AGENTS application map, native lifecycle and sole shared styling/gallery
  instructions; preserved unrelated safety/workflow guidance and user edits.
  Coverage ledger now maps retired backend and file UI to native suites.
- User supplied database-root connection credentials (values intentionally omitted
  here). Administrator password is preserved across reinstall using its existing
  native hash in a transient0600 private file, restored/committed immediately after
  reinstall and removed. A generated temporary bootstrap credential is never logged.
  Fixed Path.open's unsupported opener argument during a non-destructive preflight;
  secure preserve/restore is being verified before reset. Reset steps now return on
  the first failed Bench action, preventing media deletion after a failed reinstall.

### Reset resumed (2026-10-17 UTC; active)

- Prior reset stopped BEFORE reinstall: Bench execute evaluates --kwargs as Python,
  so JSON literal true was rejected. Replaced it with1. Existing authentication
  hash was restored and transient backup removed before retry. No earlier reset
  or cleanup happened. User clarified both local credentials; values omitted.
- Restarted exact-site authorized reset. Preflight passed, media manifest recorded
 350 known private files /45,352,716bytes,0 public copies. Native reinstall is now
  executing. Do not start another reset or DB integration test concurrently. Current
  PTY session37438; poll it, avoid process command-line dumps (Bench CLI includes
  temporary credentials in its arguments). No unrelated services were stopped.

### Authorized reset and native seed executed

- Exact development.localhost reinstall **executed**, native-only DocTypes/fixtures
  installed. Existing Administrator hash restored and transient auth file removed.
  Media cleanup removed exactly350 inventoried old sample originals; no unrelated
  paths were included. Purged52 old jobs. Company/setup and native samples committed:
  **164 Items,175 private images,16 native transactions**, including reconciliation.
- Full log: /workspace/development/frappe-bench/logs/temple-sample-reset-20261017T010748Z.log.
  Do NOT run a second reset: installation finished. The wrapper returned failure
  solely in final verification: assert_balances subscripted a Frappe Document as
  though it were its serialized dict. Fixed to .get("items"), works for both native
  documents and API serialization; rerunning read-only final verifier now.
- Removed20 unreachable gallery copies identified by current source import graph,
  including obsolete count/line/conversion editors. Exact source list retained in
  /tmp/temple-inventory-migration/retired-gallery-files.json. Shared native forms
  remain the active gallery/production implementation.

### Native site verification and recorded-factor duplication

- Read-only verifier passes on the reset site:164 Items, native balance/loan
  assertions true; inventory found352 known private originals/copies (including
  the receipt text's native files),0 public copies. Native File records/private
  download still need actual HTTP evidence. Administrator preservation file absent.
- Added native duplicate_document (Stock Entry only): readable source/version/scope,
  create permission, fresh native identity/children/request key/bundles; preserves
  recorded factor through a narrowly scoped server-only insertion context. No Item
  conversion write or file copy. Reconciliation cannot copy an obsolete baseline.
  Routed editor offers a confirmation and retains stable request identity on retry.
  New copy flow frontend subset **27passed /4files /1.30s** (overlapping earlier29).
- First post-reset native run78 cases found3 issues: malformed version raised a
  parser error (now a normal timestamp conflict); duplication test lacked enough
  stock for batchB (fixed fixture quantity); seed test's secondary barcode namespace
  still collided with real samples (now uses isolated Item prefix). This was a
  failed run, not78passed. Corrected full run in progress, session17005.
- Built assets and typecheck passed after duplication wiring; added separate native
  browser configuration targeting built app on real Frappe8101, no API interception.
  It has not run yet. Wait for integration rollback to finish before native browser
  acceptance to avoid uncommitted settings cache interference.

### Fresh-schema native regression result

- Corrected post-reset complete native suite **78passed /72.677s**, including new
  duplication and existing multi-batch cancellation/amendment. Tests ran under
  rollback; original seeded data remains. Native browser acceptance is now running
  separately against real built assets/Frappe8101, with the existing Administrator
  credential supplied through PTY/env (never test source or progress logs).

### First real-server browser acceptance

- First native HTTP check **passed**: login with existing Administrator, live
  bootstrap/Item lookup, authorized private original200, guest original denied,
  built stock route rendered without API interception or JS exceptions.
- Remaining2 initial browser cases failed on real UI defects: Dashboard had no h1;
  added an accessible sr-only Home heading without changing approved geometry.
  The mobile200% native record showed horizontal overflow because form-status's
  badge kept a long native document identity unbroken. Added scoped wrapping/max
  width to status spans (both Stock Entry and counts). Rebuild/rerun pending.
- All9 native operation creation routes and count editor mounted successfully
  before the large-text overflow assertion failed. This initial run is1passed,
  2failed, not full native browser acceptance. Screenshots/traces retained under
  /tmp/temple-inventory-migration/native-browser.

### Real-server acceptance after heading/identity fixes

- Native Frappe browser **3passed /57.7s**: live bootstrap/private-image original
  authorization versus Guest denial;19 native destinations (all service responses
  checked); all9 new operation editors plus count;375px200% recorded factor view
  with0 horizontal overflow. No native API mocks. Directly inspected corrected
  native-recorded-factor-375-200.png; document identity and factor5 wrap/read correctly.
- Inspected the stock1440 screenshot too: it captured the loading state and lacked
  CJK fonts. It is NOT accepted stock visual evidence. Strengthened that case to
  wait for a real stock card and explicitly load the audit CJK font before capture;
  focused recapture remains due. No screenshot is accepted solely from geometry.
- Migrated six meaningful shared filter regressions from old gallery tests: focus/
  outside/Done/Escape coordination, geometry/reposition/observer cleanup, mobile
  focus/scroll lock, breakpoint/context/deactivation, remote nested selector Escape,
  multi-select/chip/clear preservation. Tests use the shared components with injected
  gallery services; **6passed** plus4 unchanged promoted AsyncImage regressions,
  combined **10passed /1.64s**. Original obsolete tests still await retirement/mapping.
- Replacing the remaining active duplicate saved-record/browse presentation in
  PreviewBrowsePages with shared native detail/count/operation pages; fixture
  adapter now translates recorded fixture rows into native-shaped documents.
  New NativeVoucherLink is shared by production and gallery unsupported vouchers.
  This cleanup still needs typecheck, gallery service/reset isolation regressions
  and refreshed gallery screenshots before claiming it complete.

### Shared gallery detail cleanup and export acceptance started

- PreviewBrowsePages now coordinates the same native Product/Operation/Count/Loan/
  Pending/Records/Warehouse/Dashboard/Browse components instead of retaining an
  alternate saved-record UI. Retired3 more unreachable helpers (23 total gallery
  sources). Shared NativeVoucherLink covers unsupported vouchers in both entries.
- Fixture adapter translates recorded fixture rows into native-shaped documents,
  resets cached docs/requests/files on review-session reset, and provides private-
  shaped File metadata plus an injected local display URL. Production keeps actual
  private URLs; shared controller still rejects unconfirmed/public upload responses.
- Shared-gallery component/isolation/reset/local-file cases plus compact filters,
  setup and design graph **31passed /4files /1.97s**; typecheck passed; gallery build
  **3.15s**. Full suite migration is still incomplete.
- Added actual native queued CSV/XLSX acceptance for all164 catalog Items beyond
  one-row preview: worker completion, exact row counts, XLSX XML row count, private
  redirect/download and Guest denial. Running browser+native long-queue burst
  worker orchestration in session89356; logs native-export-browser.log and
  native-export-worker.log. It also recaptures loaded Chinese stock screenshot.
  No queued-export result is claimed yet. Worker is stopped when orchestration ends.
- Read-only native sample verifier now also confirms retired business tables,
  DocTypes and old custom fields are absent from the reset database; **passed**.

### Actual export worker and test-contract migration

- Real native burst long-queue worker generated both CSV and XLSX successfully
  (2.66s/2.69s job execution). Browser verified all164 catalog rows despite a one-row
  preview, exact CSV/XLSX worksheet counts, private redirect/download and Guest
  denial. **2passed /18.8s**, including recaptured loaded Chinese stock. Worker
  exited0. Directly inspected the new native stock1440 image: readable Chinese,
  real private photos and native quantities; below-viewport lazy images are not
  interpreted as fully loaded-image evidence. Export requests3s7l89vcbp/3spgg30fin
  and private outputs remain reviewable on the dev site. This is164-row completeness,
  not a large-volume or revoked-account worker benchmark.
- Added shared table tests for complete/server counts, pagination/error retention,
  safe/plain text, booleans and native drill-through; migrated responsive test to
  retained native controller/rows/selection and all media listeners.6passed.
  Preserved19 original expiry-duration cases by wiring the pure formatter to actual
  server remaining_days; label cases now target the current presentation. Combined
  expiry/helper/native-expiry subset28passed.
- Large native gallery receipt regressions keep all55 allocations mounted under
  filtering and validate the complete draft. Caught missing overall count in the
  confirmation (all location groups were present); added overall Item/line/mixed-unit
  totals above them. Large-gallery/table/responsive subset **24passed /3.76s**.
- Retired55 obsolete source-bound frontend test files with an explicit capability/
  replacement/case-title ledger at frontend/tests/migration-ledger.json. This is
  deliberate contract replacement, not counting imports as passing tests. Preserved
  pure gallery scope/date/grouping/settlement cases in refinement, independent
  projection tests, server-isolation tests and migrated shared/native tests.
  Full frontend suite running now; its final result is still pending.

### Full frontend audit and native count provenance (2026-10-17 UTC)

- Full pnpm test now **307 passed /48 files /9.59s**. Obsolete test contracts were
  mapped by capability in frontend/tests/migration-ledger.json; this denominator
  differs from the retired implementation suites. Required browser suites remain open.
- A new real-native Desk count test found report rows collapsed multi-batch book/
  actual bundles and dropped batches counted as zero. Added a shared native bundle
  join, per-batch count/movement deltas, current-bundle Batch permission checks, and
  exact native cancelled-voucher/child/warehouse/transaction bundle resolution.
  Native cancellation detaches BOTH reconciliation bundle links; the regression
  demonstrated this before the fix. Ambiguous bundle versions fail closed.
- Focused native count regression **1 passed /1.380s**, using rollback-only fixtures:
  batches A/B book5 each, actual A3/B0, deltas-2/-5, stable native identities after
  cancellation, hidden baseline-only Batch blocks detail and whole report record.
- Running typecheck and first shared-gallery mobile200% browser audit. Count detail
  still needs the recorded per-batch presentation; do not claim that is wired yet.

### Count presentation, camera adapters and real HTTP concurrency audit

- Full native suite after per-batch reconciliation changes **79 passed /104.907s**;
  detail serialization and the count/confirmation surface now show saved book,
  actual (including zero), variance and native Batch identities. Count frontend8
  passed; typecheck passed before the later scanner/Activity changes. Production
  build passed7.21s, also before those later changes.
- First full gallery browser audit is running77 cases, retaining all failures.
  Route sweep375/1440 passed; large Activity fixture wiring and cached-detail
  refresh regressions surfaced, alongside obsolete simulation-control selectors.
  Do not mark this suite green. Large55 allocation geometry375/balanced/200 passed
  separately17.5s before this full audit.
- Replaced obsolete workspace browser cases with current routed scanner cases.
  Manual/hardware-style lookup and actual ZXing-WASM camera decoding passed;
  Frappe adapter failed because prepare_scan_area was never called before creating
  Html5Qrcode. Fixed the adapter initialization; rerun pending. Camera fixture
  dependencies are isolated under /tmp/temple-inventory-camera-tools.
- Real frontend created a native draft, standard frappe.client.save edited it, and
  stale frontend save correctly returned417. Test selector expected an extra word;
  corrected. That temporary draft was deleted in finally. Concurrency test exposed
  actual MariaDB snapshot conflict1020 on native retry lookup after account lock.
  Added bounded whole-HTTP-transaction deadlock retries (outer call only, full
  rollback/revalidation, no commit; internal/savepoint calls never roll back caller).
  Must rerun real independent connections before accepting this fix.
- First failed concurrency attempt left one temporary native draft (label
  并发验收临时草稿). Identify exact name/request identity from trace, verify docstatus0,
  and delete it; never delete unrelated drafts. Updated test should clean successful
  attempts even if another concurrent request fails.
- Native browser tracing now starts AFTER login to keep authentication secrets out
  of artifacts. Remove old task-owned failed native trace zips that included login;
  keep safe error summaries/screenshots. No credential is written in source/progress.
- Latest native HTTP server8101 session94229; stop after acceptance. Gallery full
  suite session69364; current scanner rerun and real HTTP rerun still pending.

### Independent HTTP and browser audit follow-through (2026-10-17 UTC)

- Real native HTTP regressions **2 passed /4.5s** after snapshot-deadlock retries:
  frontend draft → standard frappe.client.save Desk edit → stale frontend417 with
  input retained → re-read/save preserves native child and Desk handler;3 concurrent
  creates return one native/child identity;2 competing saves accept one version and
  reject one TimestampMismatchError. Temporary drafts deleted, including the exact
  failed-attempt draft verified as unsubmitted with its task label. No stock posted.
- Migrated obsolete workspace scanner/browser cases and dashboard native scope
  contract. Default production browser config excludes real-server tests (separate
  native config), owns its Vite listener and retains traces on controlled failures.
  Full production audit initially **15 passed /1 failed /27.3s**: real Frappe camera
  startup cancellation leaked a late stream. Capturing/releasing the original
  handler after startup, plus explicit track cleanup, fixes it. Meaningful late-
  startup adapter regression passes; repeated actual camera/manual runs **9 passed
  /15.4s**, both Frappe and ZXing, no BarcodeDetector, all captured tracks ended.
  Full production rerun still needed after this fix.
- First complete gallery diagnostic **51 passed /26 failed /11.5m**. Most failures
  were obsolete simulation controls/selectors; actual defects included missing
  opt-in large Activity fixtures, cached Activity detail after edit, non-Receive
  expanded action bars hidden by shared CSS, and automatic disclosure toggles
  incorrectly recorded as user choices during async hydration. Repaired these in
  shared components/fixtures. Keep this failed baseline; do not treat it as sign-off.
- A focused migrated gallery subset **5 passed /1 failed /1.0m** proved virtual
  keyboard/detail focus return375/1440, all9 expanded operation actions375/1440,
  and injected export failure with choices retained. Remaining failure was an old
  Activity delete-confirmation selector, subsequently corrected.
- Opt-in large Activity/report matrix now **4 passed**, widths375/768/1024/1440,
  all3 densities ×100/150/200 text; real Chinese font injected by browser fixture.
  Desk recorded conversion/reload/version conflict also passed. Other behavior
  cases still being corrected/rerun; latest run gallery-remaining session71790.
- Production components contain no gallery failure controls. Gallery-only injected
  services now offer fail-next endpoint/report and large-picker fixtures. Restored
  the pure opt-in activitiesReviewFixtures dataset; it is actively consumed again,
  so exclude it from earlier retired-gallery counts. Historical report and Activity
  links now select exact native-shaped gallery details, including transfer branches.
- Shared gallery/Activity/scanner focused unit subset **34 passed /3.84s**. Native
  full suite rerun session85998 is active; prior complete79/104.907 remains latest
  finished result. Current task HTTP server8101 session88179 must be stopped later.

### Report boundedness and current test snapshot

- Last complete native suite **79 passed /79.763s** after HTTP retry wrapper.
- Removed unbounded Python Bin/Item pair accumulation and O(Items×Bins) zero-item
  lookup, paged grouped historical Item/location identities, spooled per-location
  historical details with1MiB memory limit before whole-pair permission approval,
  and moved Activity outcome identity membership to the transient projection DB.
  Focused real history regression **1 passed /1.677s**; full native rerun still due.
- New real-native rollback-only export stress **1 passed /31.230s**:1,005 native
  draft allocations, one-row preview, complete CSV/XLSX with identical stable
  ordering,1,005 unique native child identities and exact unit totals. This validates
  the actual projection/writers beyond page limits; separate real RQ worker proof
  remains164 rows. No fabricated large-worker claim.
- Full frontend rerun **307 passed /1 timed out** (308 total);55-allocation test took
 6.3s under concurrent browsers vs5s default. Do not count this run as green. Rerun
  after browsers finish; do not increase timeout or remove assertions for load.
- Latest gallery fixes: large-picker complete ordered selection/new Item return
  passed; all report grouping/pagination cases375/1440 passed; valid/invalid55-row
  disclosure summary now stable; previously failing spacious geometry cases passed.
  Historical drill-through lacked native doctype in pure fixture ledger rows,
  now supplied. Active tests now scope selectors to visible editors because gallery
  keeps its local Receive sample mounted but hidden. Recorded fractional conversion
  is saved while permitted before checking existing-factor use after permission loss.
- Avoid source edits during browser runs: Vite HMR was replacing open dialogs while
  earlier long audits were executing, so some intermediate geometry failures were
  invalidated snapshots. Current remaining-case run gallery-current-behavior owns
  session returned by tool; keep frontend source fixed until it finishes.

### Current complete native/frontend results and screenshot inspection

- Complete native suite **80 passed /114.587s**, including1,005-row native export,
  bounded historical/stock/Activity report sources and all earlier invariants.
- Full frontend **308 passed /48 files /15.88s**. Bounded Vitest workers to4 for
  DOM-heavy55-row suites within the container CPU budget; retained5s timeouts and
  all assertions. The earlier two timeout runs remain failed diagnostics.
- Remaining gallery behavior narrowed to valid-batch save/reopen: new native-shaped
  Batch metadata was incorrectly shadowed by an incomplete draft's display fields.
  Fixture batch_details now reads its actual created Batch first, like production.
  Native backend metadata already behaved correctly. Save/reopen375/1440 plus all
  themes×125/175 text now **4 passed /12.9s**. Historical links/read-only display,
  fractional recorded conversions and navigation5 passed in the prior7-case run.
- Directly inspected gallery screenshots: Activity long Chinese notes375/200
  (safe literal HTML text, wrapping and navigation); historical table1440/200
  (two locations,117/30 closing quantities, separate adjustment and legible columns);
  1,006-result virtual picker375/200 (ordered last target visible, readable CJK,
  footer selection preserved); blue report375/175 (readable themed navigation/
  header, no horizontal overlap). Paths live in gallery-behavior/screenshots,
  /tmp/temple-inventory-design-browser/screenshots/review-virtual-375-200.png and
  gallery-allocation-fixed/artifacts. These are representative inspections,
  not a claim every matrix screenshot has been reviewed.
- Source graph refreshed:217 reachable files; only env.d.ts and the unstyled
  pre-existing useInfiniteScroll utility are outside the active entry graphs.
  No unreachable gallery implementation. Do not redirect the graph script stdout
  into its own JSON target (it writes that file itself).
- Updated DESIGN_SYSTEM's current architecture/token/route map, retaining dated
  historical visual decisions. Production build is now running; next gallery build
  and full79-case browser suite must use a fixed source snapshot. No live deploy.

### Fixed-snapshot full acceptance run in progress

- Production build **3.79s**, gallery build **3.42s**, typecheck pass. Targeted Ruff
  covers42 changed Python sources and passes; git diff --check passes. Production
  import audit:174 source files reachable (read production-import-isolation.json
  for exact current count),0 design-preview imports,0 built fixture markers among
  ACT-AUDIT/PICKER-1000/gallery-reviewer/图库示例/fixtureServices/PREVIEW-50.
- Full gallery **79 cases** running against a fixed source snapshot (session9252,
  gallery-final.log/results). Do NOT edit frontend source during this run; previous
  HMR interruptions made intermediate long-run failures unreliable. No new
  production/gallery component changes since current builds.
- All6 real-native browser cases plus actual long-queue worker running in session
 8089, native-final-browser.log, native-final-worker.log. Initial private-image case
  and19 real routes pass. Exact temporary draft cleanup is in test finally blocks.
  Task HTTP8101 session11168. Stop it once acceptance finishes.
- Added enabled-account recheck immediately before publishing/downloading an
  export. Real worker pipeline regression **1 passed /7.963s**: begins under its
  request owner's account, writes CSV, account disabled during generation, ends
  Failed without output/manifest File publication and restores caller account.
  Only worker transaction boundaries mocked to retain the outer savepoint; native
  permissions/projection/writer exercised. Full81-case native rerun still due.
- Avoid DB suites during real HTTP acceptance. The short worker test briefly
  overlapped; its cache was cleared immediately after rollback. Review actual
  browser results and repeat any affected failure after native tests finish.
- Full production controlled browser rerun after camera-race fix still due (latest
  complete diagnostic15/16, subsequent repeated scanner9/9 passed). User requested
  no subagents, no live deployment, and progress tracking; these remain in force.

### Continued acceptance: real server complete

- Fixed-snapshot real HTTP suite **6 passed /2.6m**: private originals and built app,
  all19 destinations,9 editors/count375/200, actual queued CSV/XLSX164 complete
  rows/private downloads, Desk/frontend version interoperability, and separate
  HTTP retry-create/competing-save protection. Both real long-queue jobs completed.
  Logs: native-final-browser.log, native-final-worker.log; trace capture starts
  after authentication. Test-owned temporary native drafts cleaned up.
- Stopped the task-owned HTTP8101 process after acceptance. Full native81-case
  rerun started (native-integration-final.log); do not start HTTP acceptance until
  it finishes and cache is cleared. Full gallery79-case audit continues on fixed
  frontend source; first route/density sweeps passed. No deployment.

### Native suite and recovery acceptance checkpoint

- Complete native suite **81 passed /177.917s**, native-integration-final.log,
  including revoked-account export generation and1,005-allocation writers. Cleared
  native caches after rollback. Production controlled browser existing16 cases
  all pass, including both real camera decoders;5 new recovery cases initially
  failed at a collapsed context selector before exercising recovery. Corrected
  test interaction to expand 来源、活动与备注; focused5-case rerun active.
- Added controlled-browser checks for reload/explicit recovery, independent tabs,
  account isolation, pending upload metadata/reselection, and blocked storage with
  leave guard. No native write claims from these controlled HTTP tests.
- Directly inspected gallery-final screenshots activity-detail768/spacious/200,
  1024/compact/150,1440/balanced/100 and historical375/200: readable CJK, literal
  HTML notes preserved as text, long notes wrap, navigation clear; narrow history
  table retains its horizontal scroll surface. Native zoom/device checks remain
  distinct and unverified.
- Task HTTP8101 restarted (session65486) for new real Item/image and Activity
  create/edit lifecycle browser acceptance (session27405, native-reference-browser).
  These tests clean up only their exact created Item/Activity/File identities.
  No DB integration suites while actual browser acceptance runs.

### Routed recovery and additional visual review

- Controlled-browser recovery **5 passed /12.3s**, recovery-browser.log: reload
  requires explicit recovery; two tabs retain distinct editor/tab IDs; another
  account cannot hydrate the previous account; pending uploads retain metadata
  without bytes/blob URLs and require reselection; blocked storage leaves input
  editable and the leave guard active. Earlier5 failures were the collapsed
  context selector, not suppressed. Existing16 cases passed in production-ui-final.
- Compared initial CJK baseline screenshots Receive768, Inventory1024 and Reports
 1440 with promoted surfaces; inspected current Activity quick-export1024/200
  (wrapped full scope, scrollable contents, reachable fixed footer). Baseline
  review controls/fixture status are intentionally gallery-only. No pixel-perfect
  claim for all screenshots.
- Real Item/image acceptance reached create/private upload/primary/edit/reload,
  then failed because the test expected the Item name in generic page h1 rather
  than the actual Item h2. Corrected assertion; cleanup removed its exact created
  File(s)/Item. Activity create/edit/archive run remains active. Native test
  output variable is NATIVE_RESULTS (not NATIVE_BROWSER_RESULTS); use correct
  unique directory for next run, preserve earlier logs.

### Actual Activity and report profiling

- Real Activity create/edit/rename/archive/reload/delete **passed** in the2-case
  reference browser run; Item failed only at the generic h1 assertion. Corrected
  it with an explicit patch (the first text replacement did not match formatted
  multiline source). Added actual matching-count and empty-group Warehouse
  create/edit/delete cases for the next native browser run.
- Profile of actual seeded Activity detail:19.232s,921 repeated item_fields /
  native attachment authorizations consuming14.302s,32,958 SQL calls. Added a
  context-owned bounded512-Item metadata/image cache; it never crosses report
  requests/accounts. Focused native regression **1 passed /1.442s** proves12
  allocations retain complete output with one image authorization and a fresh
  next report reauthorizes. Full82-case native rerun active, native-integration-cached.
- Gallery fixed-snapshot audit currently past43/79 without failures. No frontend
  runtime edits while it runs. Future native browser artifacts must use explicit
  NATIVE_RESULTS to avoid overwriting earlier default output. No reset or deploy.

### Independent connection and performance evidence

- Full native suite **82 passed /136.790s**, native-integration-cached.log.
- New opt-in native_concurrency_acceptance.run **4 scenarios passed**, each with
  separate Frappe/MariaDB contexts and rollback: stock/count serialization and
  matching no-record result; stock overdraw rejection; original-loan lock plus
  over-settlement rejection; native Activity link/delete serialization and blocker.
  Instrumentation observes the actual FOR UPDATE statement for the exact contested
  native identity before timing the wait. Logs: native-concurrency-observed.log.
  No test stock commits or persistent native records. This is lock/rejection proof,
  not a claim of two successful stock submissions racing through a commit.
- Same actual seeded Activity profile measured19.232s before vs6.819s after the
  request metadata cache (profiling/container load, not a latency guarantee).
  Complete report output remains covered by82 native tests. Frappe/ERPNext core
  working trees are clean; targeted Ruff and diff whitespace checks pass.
- Directly inspected bronze375/175, blue1440/125, historical768/150: palettes,
  wrapping and readable CJK maintained; table remains a distinct scroll surface.
- Restarted own HTTP8101 with current backend (session28485). Actual reference
  browser4 cases running session60630, native-reference-final artifacts/log.
  Native test suites must remain idle until it finishes. Gallery past67/79 green;
  no frontend runtime changes yet.

### Full gallery green; primary image regression found and repaired

- Full fixed-snapshot gallery **79 passed /18.7m**, gallery-final.log/results.
  Then removed remaining production Preview* import/type aliases in7 shared
  component files (no styles/geometry changes). Full frontend **308 passed /48
  files /17.08s**; typecheck passed. Production build6.45s; gallery build currently
  session64039. Post-rename targeted gallery6 cases session83339; full controlled
  production21 cases session49509. No further frontend runtime edits during them.
- Actual native reference run2 passed/2 failed: Activity lifecycle and matching
  count (no record) passed. Item found real File duplication from core's
  attach_files_to_document requiring attached_to_field=image; set_item_image now
  locks/reuses the uploaded native File and saves that field before Item.save.
  New real native regression **1 passed /0.533s** covers frontend primary selection,
  Desk edit, frontend metadata edit, one File, original URL and final removal.
  Native sample installer sets df=image for primary images in future installations.
  Full native83-case rerun session79958, native-integration-image-final.log.
- Warehouse test timed out because getByLabel exact included option text. Corrected
  to accessible combobox name. Its expired test timeout also prevented finally
  cleanup; explicitly deleted only own empty group 浏览器仓库验收-3124a0b7 - O
  through native frappe.delete_doc. Added a separate cleanup time budget and
  request deadline so primary failures retain cleanup. Rerun actual4 cases after
  DB suite finishes/cache clear/server restart (current HTTP28485 is old code).
- Existing seeded Item TI-SAMPLE-C-A01 has3 File rows for2 source images, confirming
  seed-time primary copies also need a scoped repair without another reset. Plan
  repair from exact catalog image hashes/native parents/current primary paths;
  preserve unrelated files and verify every candidate before deleting duplicate
  native File rows/private disk copies. This repair has NOT yet been executed.
- Remaining acceptance: Item/Warehouse rerun, seed image deduplication/verification,
  post-alias browser results, import/build audit and final independent diff review.
  Real devices/native browser zoom and committed stock race remain explicitly
  unverified (rollback lock contention/rejection evidence is separate).

### Final browser/build checks and seed image repair plan

- Complete production controlled browser **21 passed /34.1s**, production-ui-complete:
  current native routes, breakpoint/history memory, all5 browser recovery cases,
  manual/hardware input and actual ZXing/Frappe fake-camera decode/track cleanup.
- Post-alias gallery regression **6 passed /19.1s**, gallery-naming-final: desktop
  keyboard/nested Escape, mobile focus/resize, short200% text, all themes125/175
  and1,000-item picker. Full79-case gallery18.7m remains the preceding full visual/
  behavior run; aliases changed identifiers only. Latest gallery build3.61s;
  production6.45s; no production Preview* import/type aliases remain.
- Seed image dry-run found157 core-created duplicate File rows among175 source
  images. Plan /tmp/temple-inventory-migration/seed-image-repair-plan.json. Every
  candidate is an exact catalog image SHA256, private, attached to its exact seeded
  Item, created within60 seconds of that Item's seed insertion, and shares the
  keeper content hash. Current primary URLs are retained. No repair applied yet;
  wait until83-case native run completes. Script repair-native-images.py performs
  native File lifecycle changes and removes only unreferenced duplicate private
  paths after rechecking bytes and all File/Item references. No reset.

### Seed File metadata repair applied

- Latest native suite **83 passed /99.402s**. No backend source changes after it.
- Executed reviewed exact-site image repair:175 source images retained,157
  duplicate native File rows removed, primary URLs unchanged, private field links
  repaired through ordinary File saves. Native delete correctly kept blobs shared
  by the retained File rows (0 duplicate paths removed). Log: seed-image-repair-applied.
- Preparing a separate read-only plan for orphan private disk copies: only exact
  catalog/seed receipt SHA256 bytes with no File.file_url/thumbnail_url or Item.image
  reference anywhere qualify. Script repair-seed-orphans.py; no orphan deletion
  applied yet. This preserves unrelated native File records/paths. No reset.

### Seed originals and orphan repair complete

- Removed176 private orphan copies (22,676,444 bytes), each exact catalog/receipt
  SHA256 with no File URL/thumbnail or Item image reference anywhere. All native
  File rows outside the explicit duplicate-image repair were retained.
- Read-only native seed verification passes again:164 Items,176 sample disk files
  (175 images + receipt),22,676,444 bytes,0 public sample files,32 protected paths
  preserved, balances correct, retired schema absent. No reset/reseed.
- Future seed files now pass bytes directly to standard File.insert once, avoiding
  the convenience helper's prewritten orphan. New real native image/receipt test
  asserts exact physical file-count delta, original bytes, private status, image
  field linkage and no duplicate after Item.save. Focused log
  seed-file-single-write-tests.log; latest complete native84-case run active in
  session returned by tool, native-integration-complete.log.
- Actual reference5-case rerun (4 CRUD/matching plus private seeded originals) must
  follow completion/cache clear and HTTP8101 restart; current HTTP28485 is stale.
  Final remaining work: that rerun, task-owned temporary-file cleanup if needed,
  current production import/build audit, documentation/checklist and final review.

### Final native source green and real-server rerun

- Complete native suite **84 passed /77.413s**, native-integration-complete.log;
  includes both primary File identity and seed single-write image/receipt physical
  file regressions. No source changes after it. Cleared caches after rollback.
- Task HTTP8101 restarted with current backend/built assets (session43216).
  Actual reference5-case rerun active session76653, native-reference-complete:
  Item/private upload/primary/edit/remove; Activity lifecycle; Warehouse create/
  edit/cleanup; matching count no native record; repaired seeded private originals.
  Do not run DB integration suites during it.
- Current production audit:174 source files,0 gallery imports/fixture markers;
 74 precache URLs,0 private/API URLs. Shared entry graph217 files; unreachable
  only env.d.ts and pre-existing unstyled useInfiniteScroll utility.
- Direct screenshot review additionally covered55-row expanded editor375/200
  (wrapped CJK, mixed-unit fixed action summary above mobile navigation) and
  picker1440/200 (scrolling options with visible fixed selection footer).

### Final review: export role cache refresh

- Actual reference5-case rerun **5 passed /40.5s**, including the repaired one-File
  Item flow, Activity lifecycle, Warehouse create/edit/delete, matching count
  no-record result and repaired private seeded images. Task HTTP8101 stopped.
  Read-only cleanup confirms0 temporary acceptance Items/Files/Activities/Warehouses
  and no remaining orphan paths from the two earlier exact test image names.
- Final source audit found that Frappe Redis.hget memoizes roles/User Permissions
  in frappe.local.cache. Cross-request revocation invalidates Redis but not a long
  worker's existing local permission cache. generate_export now starts a fresh
  owner context before the post-write manifest check (worker only; no HTTP session
  reset). Added real native role-edit pipeline regression with the worker's old
  memoization retained to model an external change. Focused test running in
  export-role-revoked-tests.log; full85-case native rerun due after it passes.
- Pure Ruff formatting fixes in hooks.py/preferences.py followed the84-case run;
  all43 changed Python sources now pass lint/format. No frontend changes or rebuild
  required for this worker-only permission correction.

- Revoked-role worker regression **1 passed /2.987s**. It primes actual role
  permissions, writes a real CSV, makes a native User role edit, retains the long
  worker's prior local cache to model another request, then proves fresh-context
  authorization produces Failed with no private File publication and restores
  the original caller. Permission/projection/writer paths are real; transaction
  boundaries remain patched for the outer savepoint. Full85-case rerun active,
  native-integration-permissions-complete.log.

### Final handoff review and artifact index

Reviewed the final implementation against the consolidated requirements: native
identity/version/request locks and Desk hooks; one document per operation; exact
loan child/Batch settlement provenance; native count baseline/variance/cancel
metadata; immutable Activity links and reference deletion; per-line/reusable
conversion separation; parent-authorized private Files; complete six-dataset
queries and temporary bounded report projections; request-owned exports; scoped
browser recovery/account preferences; responsive navigation and shared gallery;
exact-site reset/native seeds and media cleanup. Obsolete workspace/custom-loan
source/schema/API/style consumers are retired with explicit test-capability mapping.
Frappe/ERPNext core working trees remain clean. No deployment or production reset.

Final artifact root: /tmp/temple-inventory-migration/.

| Evidence | Artifact |
| --- | --- |
| Latest native suite | native-integration-permissions-complete.log |
| Independent native locks/rejection, rollback only | native-concurrency-observed.log |
| Frontend48 files/308 tests | frontend-final-tests.log |
| Typecheck and both generated builds | type-check-final.log; production-build-final.log; gallery-build-final.log |
| Complete production browser21 cases | production-ui-complete.log |
| Complete gallery79 cases and screenshots | gallery-final.log; gallery-final/results.json; gallery-final/screenshots/ |
| Six post-alias gallery regressions | gallery-naming-final.log; gallery-naming-final/results.json |
| Actual HTTP6 cases and real CSV/XLSX long-queue jobs | native-final-browser.log; native-final-browser/; native-final-worker.log |
| Actual reference/File/count5-case final rerun | native-reference-complete.log; native-reference-complete/ |
| Private seed/media/balance/schema verification | native-sample-final-verification.log |
| Exact image File and orphan repair plans/results | seed-image-repair-plan.json; seed-image-repair-applied.log; seed-orphan-repair-plan.json; seed-orphan-repair-applied.log |
| Source/build/private-precache isolation | production-import-isolation.json; frontend-source-graph-current.json |
| Activity profiling (container load; not a latency guarantee) | profile-activity-before.log; profile-activity-after.log |

Earlier failed browser/selector/cache diagnostics remain in their separate logs;
they are not counted as passing runs. Native browser traces begin after login.
Native export requests/private outputs from real worker acceptance remain as
reviewable local artifacts and were protected during sample-media cleanup. All
exact temporary acceptance Item/Activity/Warehouse drafts were removed; own HTTP
8101 and browser-owned Vite servers/workers were stopped. Verification limits are
listed at the top of this record.

### Completed local implementation — 2026-10-17

- Final native suite **85 passed /74.893s**, including post-write enabled-account
  and revoked-role permission rechecks. Cleared caches after rollback; final
  read-only native seed/media/schema/balance verification passes again.
- Frontend **308/48 files**, production browser **21**, full gallery **79** plus
  post-alias **6**, actual native HTTP **6** plus reference/File/count **5**, and
  independent-connection rollback lock/rejection **4 scenarios** all pass. Both
  builds, typecheck,43-source Ruff lint/format and diff check pass. Source graph/
  precache audit excludes gallery fixtures, legacy styles and private/API caching.
- No task-owned HTTP8101, browser Vite servers or long-queue worker remain active.
  No unrelated listeners stopped. No deployment, no additional reset, no subagents.
  Remaining verification limits are explicit at the top; no unsupported physical
  device/native-zoom or successful-commit race claim. No required implementation
  work or failed automated checks remain.
