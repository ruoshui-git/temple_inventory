# Design migration capability ledger

Authority: [UI decisions](UI_UX_DECISIONS.md). Preview implementation progress:
[resumable checkpoint](notes/20261013_ERPNEXT_PREVIEW_PROGRESS.md).

## Migration policy

**Prefer a clean database, API and UI over backward compatibility.** This is rapid
development. A database reset is acceptable during UI/UX migration; do not spend
work preserving Inventory Workspace identities, obsolete schema or adapters.
No reset is part of the standalone preview implementation. Preserve review hashes
where useful for design review, not as a production compatibility requirement.

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
| activities/create_activity/responsible_people | `PreviewTransactionContext`: activity type/dates/description, separate purpose/responsible, source type/source and personnel | UX-08; creation/context represented; API persistence and existing activity editing pending |
| item_detail; Frappe File and remove_attachment | `PreviewAttachments` local image/document data, upload states, view/remove/primary; item thumbnails use selected primary | UX-06; represented locally; real private original/derivative authorization and reset/seed audit pending |
| warehouse_detail/configure/create_room/create_location | Warehouse group/leaf details and edit/create; parent/type, cycle/system-node restrictions, Room default leaf | UX-09; represented; real company/root/stock/document permission validation pending |
| initialization_status/repair_settings/repair_metadata/repair_warehouse_setting | Tools → `setup/default`: initialization structure, missing metadata/root, denied access, impact/confirmation | UX-05; represented locally; real repairs pending; pointer repair must never move stock/reparent nodes |
| inventory/expiry/pending/history/movement/loan filters and facets | Shared hierarchy/select controls, detail/batch/history links, complete totals, analysis by dimension/type/outcome/unit; retained load-more/retry | UX-09; represented with finite local fixtures; backend complete facets/analysis/pagination pending |
| reporting.export_report (five types) | Five report families, contextual Inventory/Movement/Loans exports, independent dataset and CSV/XLSX review | Scope represented; file generation, loan exports/additional datasets need backend work |
| dashboard_summary (six sections) | `dashboard/overview`: global scope, local movement period, six sections/buckets, drill-through and section retry | Preserved; backend parity must retain all six sections/buckets |
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
| Dashboard scope/refresh/recovery | `PreviewDashboardSection`, per-section snapshots/timers, compact clear/completion; `design-preview-usability.test.ts` | Six sections and stock-unit separation preserved; stale/no-prior failures and isolated recovery replace older preview feedback. Real requests remain backend-dependent. |
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
