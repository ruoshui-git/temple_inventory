# Design migration capability ledger

**Follow-up fixes — 2026-10-17:** F1–F4 from the follow-up review are implemented.

| Capability | Replacement and evidence |
| --- | --- |
| F2 Opening Stock exports | Saved purpose selects movements, preserving exact native identity/status and opening quantity. Real ERPNext draft/submitted/cancelled projection regression plus quick/full browser scope checks; ordinary Counts scope regression retained. |
| F1 linked Activity labels | Shared operation/Count controller resolver calls the authorized exact Activity endpoint, including archived links. Fresh entry, unchanged-version reload, recovery, rename, unavailable, stale response, account switch and cleanup tests. |
| F3 Quick Export identifiers | Shared table explicitly renders text in export previews; full report links retain activation. Native UI desktop/mobile and API-shaped component checks. |
| F4 dashboard gallery | Current fixture contract supplies Item names/kind/activity context, with a separate missing-context scenario; shared gallery unit/browser checks and inspected desktop/mobile screenshots. |

See the [follow-up fix record](notes/20261017_DESIGN_MIGRATION_FOLLOWUP_FIXES.md)
for commands, results, and limits. This closes these findings, not the broader
migration's unverified real-device/zoom/race acceptance.

**Independent-review follow-up — 2026-10-17:** R1–R10 have implementations in the
shared native hooks, saved-document editors/export scope, screen report columns,
Receive/focus geometry, mobile warehouse layout and display formatting. Native
settlement validation runs even without an app movement kind; balance projections
also require compatible submitted parent/provenance. Ordinary ERPNext stock remains
supported. Report exports retain audit columns independently of screen presentation.

| Review capability | Replacement/evidence |
| --- | --- |
| R1 settlement boundary | Native insert/save/submit regression; complete references, source/provenance, quantity/outcome, cancellation/amendment; rollback native suite |
| R6/R7 saved details | Exact DocType/name/status exports for both native types and all three states; selectable metadata; retained paused input; `migration-review.test.ts` and native report scope case |
| R2 actual report shape | Server display-column definitions for all six datasets/tables; stable row keys retained; audit export columns unchanged; native page contracts and API-shaped table tests |
| R3–R5 responsive editing | Shared compact Receive matches final routed geometry; ordinary/expanded focus; warehouse labels/actions at 375/1440 and 100/200%; focused Chromium regressions |
| R8–R10 readability | Stable short/empty-list alignment, overview heading/Item context, display-only site timestamps; shared gallery and routed production/browser checks |

See the [review-fix record](notes/20261017_DESIGN_MIGRATION_FIXES.md) for actual
results, inspected screenshots, the native transaction-interference rerun, and the
broader gallery sweep's timeout. Earlier aggregate acceptance counts below remain
historical; they do not certify this change or replace its scoped evidence.

**Implementation checkpoint — 2026-10-17:** Native stock/count/Item editors,
activities, inventory/dashboard/reports, movement/loan browse, loan details, expiry,
shared shell/styles, account display settings, damaged-stock Pending, native
Drafts/Counts browse, native warehouse list/detail/metadata editing and explicit
configuration setup/repair have replacement implementations.
Loan details preserve original allocation/batch identities; expiry facets count
distinct Item/Batch pairs independently of location pages. The gallery renders
these same feature components with fixtures. Backend and focused UI evidence,
including limitations, is in the
[progress record](notes/20261016_DESIGN_TO_PRODUCTION_PROGRESS.md). Browse navigation
restoration now has focused router/Chromium evidence. Native reset/seed tooling is
implemented; the authorized reset/reseed completed on development.localhost.
Native balance/media/schema verification passes with164 Items and0 public sample
copies. Local automated acceptance now passes:85 native tests,308 frontend tests,21
production browser cases,79 gallery cases plus6 post-rename regressions. Real
server6-case integration/worker acceptance and5 reference/file/count cases pass.
Native zoom/real devices and a committed two-successful-stock-write race remain
unverified; rollback-only independent lock/rejection scenarios pass. This records
local implementation evidence, not deployment or blanket manual visual approval.

**Frontend retirement checkpoint — 2026-10-16:** Removed unreachable legacy production
views/styles and workspace URL aliases after replacing their routed consumers.
Warehouse structure guards now apply through native Desk saves as well as the app.
Frontend contract migration is recorded explicitly in
frontend/tests/migration-ledger.json; the full replacement suite308 passed across48
files. All21 production browser cases and79 full gallery cases pass. Six targeted
gallery regressions also pass after internal component alias cleanup. The gallery
uses the production components; fixture evidence remains distinct from real HTTP.
Current capability evidence maps as follows:

| Retired surface | Shared native replacement and focused evidence |
| --- | --- |
| Workspace, entry detail, reconciliation | features/documents + counts; native-editor, native-operation-editor, native-count-editor; native document integration suite |
| Inventory/expiry + old item detail | StockBrowse/ExpiryBrowse + ProductDetail; native-browse-export, native-expiry-browse, native-item-editor |
| Movement overview/ledger, loan browse/detail | OperationBrowse + LoanDetail; native-operation-browse, native-loan-detail |
| Workspace History/Drafts | NativeRecords; native-records + catalog native draft/count grouping |
| Warehouse browse/detail | NativeWarehouses; native-warehouses + native Warehouse integration |
| Old reports/shell/settings | export/Reports + AppFrame/ApplicationShell + settings; native-browse-export, native-shell, native-navigation-memory, native-application, UI preferences |
| Old global/token/primitive/loading CSS | styles/app.css → foundation/forms/utilities/browse; shared production/gallery builds,79 full gallery cases and directly inspected CJK screenshots |

**Backend retirement checkpoint — 2026-10-16:** Removed old workspace/custom-loan
modules, DocTypes, links, fallback fields and adoption patches from source after
consumer audit. The authorized development reset removed the retired installed schema. All85 native
integration cases pass, including164-Item seed installation under rollback, media
safeguards and multi-batch Desk count/cancel provenance. Real native HTTP navigation,
private files and164-row CSV/XLSX workers pass. Separate HTTP connections verify
retry-safe creation and competing version saves. Four separate-connection, rollback-only
scenarios verify stock/count locks, overdraw/over-settlement rejection, and Activity
link/delete guards. Committed stock races and real devices/native zoom are separate
limits. The automated browser matrix passes; representative screenshots were
directly inspected at all four widths, all densities and100/150/200 text, plus
all themes and intermediate text sizes.

| Retired backend capability | Native replacement / evidence |
| --- | --- |
| Workspace writes, request/revision identity, stock lifecycle | native_api/native_stock; native document suite, recovery and native editor tests |
| Custom Loan/Return/Loss ledgers and browse | native child provenance + native_balances/report_sources; native document/catalog/report suites |
| Old inventory/setup/warehouse helpers and fallback roles | catalog/configuration/native_topology/warehouses; catalog, setup and Desk warehouse suites |
| Five old report/export contracts | six typed native datasets and native Frappe export jobs; report suite: actual164-row CSV/XLSX workers;1,005-allocation projection/writers; disabled-account/revoked-role worker failures; actual RQ scope164 rows;1,005-row queue benchmark not executed |
| Old sample imports/transactions/structure | native_samples + sample_install; all9 kinds, compatible partial loans, real count and native balance assertions under rollback |
| Reset's unbounded file leftovers | sample_media inventory/hash checks/exact paths/shared-file preservation; read-only site inventory and filesystem regressions |
| Old attachment/image components | shared Attachments/ItemImage + native parent services; migrated29-test editor/file/image subset and backend File permission tests |

**Migration specification — 2026-10-16:** Use the
[consolidated handoff](notes/20261016_DESIGN_TO_PRODUCTION_HANDOFF.md) as the single
implementation specification. It incorporates this ledger and the detailed
Activities/Reports and conversion requirements, including those archived under
`notes/done/`. Historical rows below record the pre-migration preview baseline; the checkpoints
above and progress record describe current implementation and its limits.
The handoff supersedes paused-migration restrictions and narrows reset authority
to `development.localhost`. Browser-only incomplete-input recovery replaces
server workspaces; matching counts create no server record. Native reconciliation
metadata retains review context when an actual adjustment exists. Shared gallery, account theme/text preferences and real service integration now
have implementations and passing local automated acceptance. The verification
limits above remain explicit.

Authority: [UI decisions](UI_UX_DECISIONS.md). Preview implementation progress:
[resumable checkpoint](notes/done/20261015_DESIGN_ACTIVITIES_REPORTS_PROGRESS.md).

## Migration policy

**Prefer a clean database, API and UI over backward compatibility.** This is rapid
development. A database reset is acceptable during UI/UX migration; do not spend
work preserving Inventory Workspace identities, obsolete schema or adapters.
No reset is part of the standalone preview implementation. Obsolete preview hashes
and API/schema contracts may be replaced directly; update callers and tests.

ERPNext Stock Entry/Stock Reconciliation + document name are canonical. One
transaction produces one stock document. Loan semantics belong on Stock Entry
header/lines, with original borrowing document/line references. Derived loan
balances must respond to submit/cancel/amend equally from Desk or frontend.
Optional editing UI state cannot own or lock a stock document. Saves preserve
fields outside the custom editor and check the current document version.

## Audited capabilities

Status refers to preview coverage, not backend readiness. Keep evidence updated.

| Production source/capability | Preview evidence | Disposition / remaining work |
| --- | --- | --- |
| inventory_api.bootstrap, shell permissions | `setup/default`: guest, non-manager and denied states in `PreviewSetupWorkspace`; session expiry in operation forms | UX-05; represented locally, production System Manager gate pending |
| workspace_api open_entry/open_reconciliation; stock.protect_workspace_entry | `movement-form/Receive` and `movement-records/workspace-detail`: editable Desk draft, Stock Entry name; `PreviewDocumentState` and ERPNext test suite | UX-01; replace workspace-exclusive ownership/guards and direct-entry read-only APIs |
| workspace create/save/confirm/delete; direct Desk operations | Saved snapshots survive remount; dirty input copy, missing/deleted state, external edit/submit/cancel/delete, amendment and extra Desk field retention | UX-01/09; fixture replacement demonstrated; real ERPNext version checks/field preservation pending |
| Inventory Loan/Return/Loss controllers | `loan-detail/outstanding`: separate Loss, compatible multi-loan Return; per-line IDs in `addLoanToDraft`, `submitDraft`, `cancelPreviewDocument` | UX-02; replace custom loan ledgers with Stock Entry metadata and submit/cancel/amend hooks |
| reconciliation create/save/confirm/refresh_baseline | `reconciliation-form/new`: `PreviewCountWorkspace`, selective/full leaf, unreviewed/zero/not-found, baseline additions/removals, re-review | UX-04; represented; real reconciliation/version/availability adapter pending |
| search_items/search_warehouses/search_uoms; scan | `PreviewSearchSelect` full local search + pagination/state examples; filtered item picker, contextual batch choices, scan allocation gate | UX-03; represented locally; backend paginated search, stale-response wiring and real camera/scan adapter pending |
| create_item/update_item/create_uom/create_item_group | `item-form/new/edit`, Receive picker; Nos, multiline barcodes, `PreviewCategoryField` hierarchy and inline units | UX-03/08; represented; ERPNext catalog writes/uniqueness/permissions pending |
| Activities and movement context | `activityData`/`activityModel`, Activities list/detail/editor, contextual creation with immutable IDs, notes and data-driven types; Receive source / other purpose / optional personnel | UX-11/12 replace obsolete enum/title identity/source type/responsible; backend schema cleanup/reference data/guards pending |
| item_detail; Frappe File and remove_attachment | `PreviewAttachments` local image/document data, upload states, view/remove/primary; item thumbnails use selected primary | UX-06; represented locally; real private original/derivative authorization and reset/seed audit pending |
| warehouse_detail/configure/create_room/create_location | Warehouse group/leaf details and edit/create; parent/type, cycle/system-node restrictions, Room default leaf | UX-09; represented; real company/root/stock/document permission validation pending |
| initialization_status/repair_settings/repair_metadata/repair_warehouse_setting | Tools → `setup/default`: initialization structure, missing metadata/root, denied access, impact/confirmation | UX-05; represented locally; real repairs pending; pointer repair must never move stock/reparent nodes |
| inventory/expiry/pending/history/movement/loan filters and facets | Shared hierarchy/select controls, detail/batch/history links, complete totals, analysis by dimension/type/outcome/unit; retained load-more/retry | UX-09; represented with finite local fixtures; backend complete facets/analysis/pagination pending |
| reporting.export_report (five production types) | Six preview datasets in `reportModel`/`PreviewReports`, compact scope panels/chips, separate result Group/Sort, complete-scope quick reports and session named-view panel | UX-13 replaces old report routes; authoritative history, scalable permission-complete generation and per-account presets pending |
| dashboard_summary (six sections) | `dashboard/overview`: bounded global scope panel/summary, local movement period, six sections/buckets, drill-through and section retry | Preserved; backend parity must retain all six sections/buckets |
| save_ui_preferences/session_info; PWA guidance | `settings/density`, recovery and Tools install: confirmed preference versus retained failed display, retry; platform guidance | UX-05/09; represented; account persistence/cache/PWA integration pending |
| Other ERPNext stock vouchers/purposes | `movement-records/external`: Purchase Receipt type/name/Desk link; Opening retains reconciliation identity | Intentionally outside native editor; never mislabel unsupported stock purposes as Transfer |

Evidence is fixture-level, not proof of server parity. The dedicated regression
suite is `frontend/tests/design-preview-erpnext.test.ts`; existing preview suites
retain browse, navigation, dashboard, reports and form coverage. Review hashes
are under `#review/` with the page key URL-encoded. Supporting data and uploads
stay in memory; exports review complete scope without generating real files.

## Backend migration acceptance (not implemented in preview)

- Create/edit/submit/delete an eligible draft in Desk without Inventory Workspace;
  open the same ID in frontend. Reverse the direction and repeat.
- Borrow/return/loss use structured Desk fields and one stock document per action;
  cancellation/amendment updates balances and prevents invalid dependent changes.
- Dirty stale editors never overwrite external updates. Deleted/unavailable records
  never substitute another record. Additional ERPNext fields survive frontend edits.
- Private originals/derivatives are inaccessible anonymously; authorized document
  readers can load them. Sample reset/seed verifies this without public copies.
- No guarantee of legacy workspace URL/ID/schema preservation is required.

## Review still required

Browser/manual visual approval at all widths/densities, keyboard and zoom remains
separate from automated checks. Tests establish behavior, not visual fidelity.

### Independent review evidence — 2026-10-13

The ERPNext preview regression suite also verifies distinct repeated count IDs,
cached new-count navigation, imported Desk book/count/reason values, scan recovery
on allocation removal, unknown-barcode prefilling, combined draft filters with
parent categories, and two-stage Escape behavior in searchable selectors.
These fixes refine existing UX-01/03/04/09 contracts without changing production.
Attachment regression coverage also verifies that pending/failed uploads keep the
parent transaction editable until upload retry/removal, rather than making failed
files immutable through confirmation.

### Browser-audit repairs — 2026-10-13

| Capability | Repaired preview evidence | Migration disposition |
| --- | --- | --- |
| Reports/export | Shrinkable report workspace, one phone catalog column, internal table scrolling; five families and export dialog | Existing report capability preserved; file generation remains backend-dependent |
| Reconciliation | `countSummary`, `PreviewCountSummary`, shared confirmation/read-only scope; zero/blank/not-found, mixed units, baseline refresh | UX-04 clarified; ERPNext reconciliation/version adapter still pending |
| Form focus | Measured summary/navigation geometry, real Tab/Shift+Tab, responsive lifecycle cleanup | Existing accessibility convention repaired in preview |
| Browse return | Document + nested result/table positions, hash Back/Forward, retained search/filter/view/selection | Existing contextual-return contract repaired; no production route change |
| Inventory chrome | 80px compact header, single shell context row, bounded tools disclosure, available search/scan/filter/count | Existing browse convention repaired in routed and local samples |
| Actions/item identity | 44px mobile hit areas; full-width narrow-phone identity below artwork | Existing touch/readability contract repaired; images/detail actions preserved |
| Dashboard/Inventory top | Actual scroll owner, two viewport threshold, heading focus, reduced motion, mobile drawer hiding | Existing return-to-top convention repaired; stock scope unchanged |

Commands, browser measurements, screenshot evidence and remaining limitations are
in [the audit-fix progress note](notes/done/20261013_DESIGN_PREVIEW_AUDIT_FIXES_PROGRESS.md).
Browser verification establishes these repairs, not historical fidelity approval
or backend parity. Production migration remains paused.

The implementation review additionally verifies one focus observer per active
KeepAlive form, complete cleanup on deactivation/unmount, and retained keyboard
focus when Inventory tools/context actions move into or out of compact chrome.
Regression coverage is in `design-preview-audit-fixes.test.ts`; fresh Chromium
evidence is recorded in the linked progress note. These close accessibility and
lifecycle gaps in the existing repairs without changing backend dependencies.


### Preview usability implementation — 2026-10-13

| Capability | Preview evidence | Disposition / remaining work |
| --- | --- | --- |
| Dashboard scope/refresh/recovery | `PreviewDashboardSection`, per-section snapshots/timers, `PreviewFilterPanel` scope dialog/sheet with clear/completion; usability and compact-filter tests | Six sections and stock-unit separation preserved; stale/no-prior failures and isolated recovery replace older preview feedback. Real requests remain backend-dependent. |
| Movement allocation editing | Shared `PreviewOperationLines`, structured `operationIssues` + compatible `validateOperation`; 50-item/55-allocation valid and invalid Receive samples | Required fields, stock/settlement/batch/unit checks and explicit confirmation preserved. Search/errors are UI state; all allocations remain mounted. Reconciliation retains `PreviewCountWorkspace`. |
| Picker/contextual catalog creation | Ordered multi-selection, group replacement, inline supporting records, one adaptive `PreviewOverlay`; scanner immediate create/use | Preview drawer creation replaced by adaptive dialog/panel; existing selection remains a drawer. Real catalog writes, permissions and uniqueness recheck remain migration work. |
| Display settings/accessibility | Validated `textScale` in preview storage, both settings surfaces, scaled typography and measured navigation/focus | Independent text scaling added in preview only. Production/account storage unchanged; manual 100/150/200% layout and native zoom review pending. |

Fixtures are discoverable in the review index at
`#review/movement-form%2FReceive-50` and
`#review/movement-form%2FReceive-50-invalid`. They install their own sample catalog
and draft only when explicitly opened; opening the gallery does not modify
ordinary drafts. The [handoff verification record](notes/20261013_DESIGN_PREVIEW_USABILITY_HANDOFF.md)
contains commands, exact links and the outstanding manual checklist.
Production migration remains pending and is not approved by this task.


Independent usability review repairs originating-card navigation, retained loan status, no-prior-result refresh, full-draft scanner checks, document/line issue coexistence, and picker keyboard/discard behavior. Eleven additional cases in `design-preview-usability.test.ts` cover these behaviors; see the handoff for final results. Preview-only scope and backend dependencies remain unchanged.

### Usability follow-up repairs — 2026-10-13

| Capability | Follow-up preview evidence | Migration disposition |
| --- | --- | --- |
| Movement allocations/review | Explicit full-width identity and responsive allocation grid; compact summary/disclosure and `PreviewAllocationSummary` in final confirmation | Required fields, mounted lines, unit totals, batch/availability/settlement checks and explicit submission preserved; production adapter pending |
| Native/searchable fields | Shared stacked/inline/choice patterns across preview consumers; action-cell alignment and scaled control sizing | Presentation repaired locally; no production fields removed |
| Contextual creation | Two-column/one-column body, full-width category/unit creation within the same form, return/selection/input retention | Existing picker drawer and adaptive creation transition preserved; catalog API/permission validation pending |
| Review fixture isolation | Ordinary Receive default lookup excludes explicitly opened 50-item samples | Ordinary drafts preserved; samples remain local review fixtures |

`design-preview-usability-followup.test.ts` adds interaction coverage. Browser
measurements, automated results and remaining manual/native-zoom review are in the
[follow-up progress note](notes/20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md).
These fixes do not approve production migration or establish backend parity.

Independent follow-up review (2026-10-14): contextual category/unit-only edits
participate in discard protection and return keyboard focus to their trigger.
Canonical Receive shares complete allocation confirmation, including expiry for
automatically generated batches and alternate-unit quantities. Eight follow-up
regressions and focused browser checks cover the repaired preview contracts;
production catalog writes and migration remain pending. See the
[review record](notes/20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md#independent-follow-up-review--2026-10-14).

### Preview simplification — 2026-10-14

| Capability | Preview evidence | Disposition / backend dependency |
| --- | --- | --- |
| Allocation editing and secondary required fields | Shared `PreviewOperationLines`, `PreviewAllocationDetails`, `operationIssues`; simplification component/browser suites | Permanent required-field visibility replaced by incomplete indicators and automatic Details reveal/focus; stock/batch/settlement constraints preserved. |
| Workspace, review and count navigation | `workspaceMode`, independent warehouse disclosures in `PreviewAllocationSummary`, sole Tools count entry | Retained mounted editor and single action area; complete confirmation; existing count records/examples preserved. No stock schema needed. |
| Entered quantity/unit and row factor | `conversionModel`, recorded fields in `DraftLine`/`ReviewMovement`, staged `PreviewConversionEditor`; saved/history/export projections | Item-only factor restriction replaced locally. Backend must round-trip native qty/uom/conversion_factor/stock_uom/transfer_qty; validate and compute stock quantity on server. Never replace recorded factors with defaults. |
| UOM and reusable Item conversions | Inline UOM create, checked/unchecked reuse, old/new equations, permission/failure/stale fixtures; Item details/edit disclosure | Independent server authorization, duplicate checks, Item version checks and explicit failure required. Preserve unrelated Item fields and immutable stock UOM; write standard UOM Conversion Details only. |
| Large full-dataset selectors | `PreviewVirtualList`, searchable Item/flat options, opt-in 1,000 items, ordered pending selection, retry/creation-return | Preview bounded measured rendering; permission-filtered stable pagination/counts, contextual stock retrieval and stale-response guards remain backend-dependent. |
| Related browse/detail/report capabilities | Movement quick filters plus complete type filters/chips, Loan event linking/settlement, Inventory tools, detail metadata/history disclosures, report selector | Capabilities preserved with progressive disclosure. Five report families, full-result scope and independent CSV/XLSX remain; actual downloads/server analysis pending. |
| Validation and accessibility | Preview Vitest, isolated Playwright geometry/interaction suite, screenshots under `/tmp/temple-inventory-design-browser` | Preview-only evidence. Native browser zoom and final visual approval remain manual; production untouched. |

Backend migration must also validate positive finite factors and precision, both
entered/stock whole-unit constraints, aggregate stock availability and loan
balances. Preserve canonical borrowing document/line references and ERPNext
submit/cancel/amend hooks. ERPNext remains the ledger; do not add a conversion
ledger or duplicate stock model. The
[execution record](notes/20261014_DESIGN_PREVIEW_SIMPLIFICATION_PROGRESS.md)
separates actual checks from this capability mapping.


Independent review repairs additionally cover Desk-origin draft conversion
round-tripping, stable large-fixture identities, picker pointer/keyboard return,
mobile scaled-text action reachability and Item-conversion discard/focus behavior.
`tests/browser/design-preview/review.spec.ts` exercises all nine operation editors,
large unit options, warehouse disclosure persistence, recorded-factor conflicts
and Item-level conversion editing. Results and actual screenshot inspections are
recorded in the execution note; backend requirements above remain outstanding.


### Activities, reports and display implementation — 2026-10-15

| Capability | Preview evidence | Production dependency / disposition |
| --- | --- | --- |
| Activity catalog and lifecycle | `PreviewActivities`, `PreviewActivityEditor`, `activityModel`, `activityData`; `design-preview-activities-reports.test.ts` | Immutable IDs, Activity Type Link reference records, notes Long Text, Active/Archived replace legacy fields. Transactional deletion guards on Desk/API including hidden references; permissions/version checks required. |
| Movement field cleanup | Canonical and routed Receive share context; no obsolete source type/responsible state, source on Receive and purpose elsewhere | Remove Workspace/Stock Entry custom responsible fields, defaults/search/selectors/callers/tests; retain personnel, movement source/purpose and native/system audit attribution. |
| Information presentation | Fixed Item metadata, completed/cancelled/count display, allocation/context display modes, recovery text+Copy, attachment display actions | Durable production presentation rule; no lifecycle/editability change and no saved projection over paused input. |
| Six report datasets | `reportDefinitions`, `projectReport`, shared browse/export projection; complete-result scope, unit/status grouping, allocation-grain tables | Former warehouse stock becomes Inventory location view; former movement records becomes Movements records view. Loan/activity/count reports are new backend gaps. |
| Historical quantities | Fixed checkpoints/events, warehouse transfer pairs, signed count adjustment and cancellation/reversal; history detail table | Fixture evidence only. Opening/closing must use ERPNext Stock Ledger and native reversal/cancellation semantics, not current-stock reconstruction. No valuation. |
| Quick reports and presets | Shared download action/dialog on Dashboard, Inventory, Expiry, Movement/Loan browse/detail, Activities, warehouses, pending and saved counts; in-memory named presets | Complete permission-filtered generation, company/warehouse/document access, stable row IDs, scalable untruncated output and per-account view storage. Preview is simulated and resets on reload. |

The [backend specification](notes/20261015_ACTIVITIES_REPORTS_BACKEND_REQUIREMENTS.md)
records source-inspection gaps and coordinated removal requirements. The
[execution note](notes/done/20261015_DESIGN_ACTIVITIES_REPORTS_PROGRESS.md) records actual
commands, screenshots and unverified cases. Production migration remains pending.

The [independent review](notes/20261016_DESIGN_ACTIVITIES_REPORTS_REVIEW.md) adds
regressions for historical search, stable filtered loan allocation identities,
explicit settlement joins, separate units in grouped Activity balances, retained
detail/master tables, related-date validation, grouped columns and document-type
identity. Browser evidence additionally covers loading detail rows beyond 30,
five-row Quick Report previews, lifetime-chip resets, keyboard tabs and mobile
filter overlap. These remain preview guarantees, with server enforcement and
complete real exports dependent on the documented production migration.


### Compact preview filters — 2026-10-16

| Capability | Preview evidence | Disposition / remaining work |
| --- | --- | --- |
| Reports, six datasets | `PreviewCompactFilters`, `PreviewFilterPanel`, `reportFilters`; `design-preview-compact-filters.test.ts` | Inline disclosure replaced with desktop popovers/mobile combined sheet, active/inherited scope chips, separate Group/Sort and named-view panel. Existing query/projection/export contracts, bounded history, drill-through, load-more and session presets preserved. Real permissions/history/export/preset persistence remain backend-dependent. |
| Draft browse/continue | `PreviewBrowsePages` drafts branch, shared scope chips and complete filtered count; compact-filter/ERPNext tests | Stacked disclosure replaced; search/date, all operation kinds, hierarchy/source/destination matching and continuation preserved. Production draft APIs unchanged. |
| Dashboard global scope | `PreviewDashboard` keeps existing warehouse/category option sources and refresh watchers inside `PreviewFilterPanel`; usability/compact-filter tests | Inline expansion replaced; scope summary, disabled empty Clear, six section snapshots/retries and mobile return-to-top hiding preserved. Opening/closing alone does not refresh. Backend integration unchanged. |
| Activities list secondary filters | `PreviewActivities` secondary-filter and Sort panels, removable chips; compact-filter tests | Disclosure replaced; immediate movement/presence/outstanding filtering and detail-return state preserved alongside primary search/status/type/date, lifecycle and Quick Report. Real reference/permission requirements remain pending. |
| Other browse filters | `PreviewBrowseFilters` optional `fields`, existing consumers omit it; browse/forms/completion/ERPNext regressions | Inventory/Expiry/Movement/Loans rails remain. Shared date/overlay coordination preserves Apply/Cancel and closes transient panels across surfaces. No backend/API migration or approved capability removal. |

The subsequent authorized browser review adds `compact-filters.spec.ts` coverage
for stable layout/scroll, bounded panels, keyboard entry/exit, mobile focus and
responsive retention, selectors/exports and 44px panel targets. It repairs
first-open focus and compact hierarchy sizing. Evidence remains preview/fixture
level; production behavior, native zoom and real-device behavior are not certified.

Actual checks and remaining manual review are recorded in the
[compact-filter execution note](notes/20261016_DESIGN_PREVIEW_COMPACT_FILTERS_PROGRESS.md).
The [browser review](notes/20261016_DESIGN_PREVIEW_COMPACT_FILTERS_REVIEW.md)
records subsequent checks, screenshots and limitations.

### Preview export wording — 2026-10-16

| Capability | Preview evidence | Disposition / remaining work |
| --- | --- | --- |
| Contextual export and full workspace | Shared `PreviewQuickReport` action/dialog uses 快速导出 and 打开导出页面; Dashboard uses 快速导出数据集; workspace heading/reset and review-index labels use 导出 wording | Wording replaced to clarify download intent. Desktop/mobile primary navigation preserves 报表. All datasets, filters, scope, reset behavior and simulated exports are preserved; production UI/APIs and real-download backend dependencies are unchanged. |
