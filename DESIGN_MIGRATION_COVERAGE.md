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
