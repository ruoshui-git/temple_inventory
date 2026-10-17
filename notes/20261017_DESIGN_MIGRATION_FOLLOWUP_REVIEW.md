# Design migration follow-up review — 2026-10-17

Review complete. Reviewed commit: `ea15227e645b9ec995c8fad1ef0208bc21230f61`.

**Conclusion:** the first refinement pass substantially resolves the original findings. The native settlement bypass is addressed in the shared hooks, and the major visual problems are corrected. Do not mark the migration fully complete yet: saved opening-stock exports select an incompatible dataset; saved documents can show opaque activity IDs; Quick Export renders document buttons without handling their activation. The current dashboard gallery also lacks representative fields, although the live dashboard is improved.

No implementation fixes were made. This is a follow-up to [the original independent review](20261017_DESIGN_MIGRATION_REVIEW.md), scoped to the changes and claims in [the fix record](20261017_DESIGN_MIGRATION_FIXES.md). The [consolidated handoff](20261016_DESIGN_TO_PRODUCTION_HANDOFF.md) remains the task specification.

## Identity and method

| Role | Exact source | Inspection |
|---|---|---|
| Reviewed implementation | `design-migration`, `ea15227e645b9ec995c8fad1ef0208bc21230f61` | Source diff from `7c7561b`; existing built app at temporary port 8102; current shared-component gallery at 5292 |
| Original design reference | `version-16`, `63c7f26b7a5be5e689e1e28071e801e967e8b6c6` | Original archive under `/tmp/temple-inventory-review-20261017/reference-version-16`, served separately at 5291 |

No branches were switched. Original/current filenames are explicit; the current gallery is not treated as the design authority.

Per user instruction, **no test suites, type checks, linters, builds, backend test runners or mutation probes were run**. New test source was read to assess coverage; results in the fix record belong to the implementing agent, not this review. Playwright was used for requested browser navigation, focus interactions and screenshot capture, without test assertions. Live API responses were not mocked.

Browser captures used Chromium at 1440×1000 and 375×1000, green theme and normal density. The same local CJK font was injected into original and current pages for reliable Chinese rendering. Enlarged-text views used the gallery setting or temporary DOM-only application tokens, with no saved preference change. This is text enlargement, not native browser zoom.

Initial capture: eight live routes at both widths (dashboard, reports, warehouses, activities, drafts, new Receive, saved Loan, saved Count), plus three gallery routes at both widths and both commits (Receive, dashboard, warehouses). Additional views cover loaded export dialogs/full report scope, the supplement, focused controls, expanded Receive, and 200% text. No page exceptions were recorded in the 28 initial captures. Some early export screenshots caught loading; only explicitly loaded captures are retained as export-completion evidence.

## Original findings: disposition

| Finding | Follow-up disposition | Evidence / qualification |
|---|---|---|
| R1 — Untyped native entry falsifies loan settlement | **Addressed in source review** | `validate_settlement_metadata` runs before the blank-kind early return, rejects partial references and incompatible kinds; full typed validation still enforces source, original child/item/batch, quantities and provenance. `loan_balances` now joins valid original Loan parents/children and compatible settlement kinds/purposes. Added test source covers insert/save/submit and a malformed pre-existing row. No independent execution this pass. |
| R2 — Internal JSON keys dominate report tables | **Resolved in inspected views** | Server supplies explicit display columns; `ReportTable` also excludes `id`. Live inventory table leads with readable item name and quantities. Export writers retain their full audit-column source. [Live report](assets/20261017-design-migration-followup/reports-live-desktop.png). |
| R3 — Mobile warehouse labels crushed | **Resolved in inspected views** | Labels and actions occupy separate rows, bounded indentation; actual deep leaf is readable at both scales. [100%](assets/20261017-design-migration-followup/warehouse-mobile.png), [200%](assets/20261017-design-migration-followup/warehouse-mobile-200.png). |
| R4 — Sticky bar covers focused Receive controls | **Resolved in inspected views** | Focus visibility now applies to ordinary desktop too. Focused supplement/notes and expanded quantity controls remain above the action region at desktop/mobile, including enlarged text. [Desktop supplement](assets/20261017-design-migration-followup/receive-focus-desktop.png), [mobile note](assets/20261017-design-migration-followup/receive-focused-note-mobile.png), [expanded 200%](assets/20261017-design-migration-followup/receive-expanded-mobile-200.png). |
| R5 — Receive uses superseded example layout | **Resolved for the reported mismatch** | Current populated gallery uses the same compact date/main/review layout and optional supplement as the original routed preview. Native status, saved export/delete controls and real lifecycle text are expected changes. See paired references below. |
| R6 — Missing exports on saved native details | **Implemented for ordinary movement/count records; incomplete edge case** | Loan and Count quick previews load one correctly scoped saved record; full workspace preserves DocType/name/status. Helper reads `state.server`, not unsaved draft input. **F2 below remains for Opening Stock.** |
| R7 — Saved date/time and borrower absent | **Resolved in inspected Loan; source covers saved operations** | Live submitted Loan now shows 2026-09-27, 12:00:00, borrower and leased destination. Amendment source renders when present. Conflict input stays in editable-form presentation with controls disabled as appropriate. [Saved context](assets/20261017-design-migration-followup/loan-context-activity-id.png). Activity title is a separate remaining issue, F1. |
| R8 — Short pages vertically centered | **Resolved** | `.sample-content` now has `margin: 0 auto`; activities/drafts stay aligned at the top. [Activity list](assets/20261017-design-migration-followup/activities-live-desktop.png). |
| R9 — Dashboard heading/item names lost | **Resolved in live app; gallery coverage incomplete** | Live heading is visible; recent records show item names, with native identifiers secondary. [Live dashboard](assets/20261017-design-migration-followup/dashboard-live-desktop.png). Current fixture payload omits these fields; see F4. |
| R10 — Raw microsecond timestamps | **Resolved for targeted displays** | Shared formatter renders site-wall-time minute precision without altering version tokens. Live activity update, dashboard/report snapshots and loaded export timestamps are readable. This was not an audit of every possible timestamp field. |

Receive reference comparisons:

- Desktop: [original](assets/20261017-design-migration-followup/receive-original-desktop.png) / [current](assets/20261017-design-migration-followup/receive-current-desktop.png).
- Mobile: [original](assets/20261017-design-migration-followup/receive-original-mobile.png) / [current](assets/20261017-design-migration-followup/receive-current-mobile.png).

The remaining warehouse geometry difference is intentional within the reviewed fix: real native hierarchy, explicit details/edit actions and system nodes require more vertical space than the old flat fixture. It no longer has the unreadable narrow-label regression. The dashboard retains its main card arrangement. No additional obvious low-contrast text defect was identified by visual inspection of the captured green-theme states; this is not a measured accessibility certification or all-theme audit.

## Remaining fixes, in priority order

### F2 — Medium: saved Opening Stock export silently excludes its own document

**Evidence type: deterministic source review; not reproduced by creating a live opening document.**

[savedDocumentExport.ts](../frontend/src/features/documents/savedDocumentExport.ts), lines 12–14, chooses `counts` for every Stock Reconciliation. However, [report_sources.py](../temple_inventory/report_sources.py), `count_rows`, lines 526–532, explicitly skips any document whose purpose is not `Stock Reconciliation`. A native Stock Reconciliation with purpose `Opening Stock` therefore gets a Quick Export button and exact record filter but no matching rows. Its full export workspace inherits the same incorrect dataset.

This is a supported detail state: `useCountEditor` detects `Opening Stock`, `CountEditorView` displays its native opening lines, and the handoff explicitly preserves truthful opening identity. The `movements` dataset already handles opening reconciliations. The saved-detail regression tests exercise DocType/status combinations but do not exercise this purpose distinction.

**Refinement:** choose the report dataset using the saved document's purpose/kind as well as DocType. Route opening reconciliations through the existing movements projection while preserving `recordDoctype`, `record`, `statuses` and opening semantics. Do not broaden the counts dataset to silently classify opening stock as a physical count.

**Acceptance for the implementing agent:** inspect a permitted saved native opening reconciliation with actual rows; Quick Export and full workspace must show that document and its correct opening quantities. Normal count adjustments must retain count review/baseline/difference tables. Keep permissions and persisted-document scope intact.

### F1 — Medium: saved activity context depends on a previously populated search cache

**Reproduced live:** directly open `/inventory/documents/Stock%20Entry/MAT-STE-2026-00005` in a fresh page. The summary says `活动：ra8tim8q9h`. Open `补充记录（可选）`: `关联活动` shows the same opaque ID. The activity exists and is readable as `样例：秋季演出与物资周转` in the activity list and the same document's export preview.

[Evidence: saved context](assets/20261017-design-migration-followup/loan-context-activity-id.png). Compare the correct title in [loaded export observations](assets/20261017-design-migration-followup/loaded-export-observations.json).

[OperationEditorView.vue](../frontend/src/features/documents/OperationEditorView.vue), lines 444–448, and [TransactionContext.vue](../frontend/src/features/documents/TransactionContext.vue), lines 44–52, resolve labels only from `reference.activities`, falling back to the raw ID. This cache starts empty and is populated by activity searches. Saved-document loading does not resolve the linked title. The shared context component also serves Count details and loan-derived forms, so fix the shared resolution rather than only this summary.

**Refinement:** hydrate the exact linked activity's readable title through an authorized service/controller path, including archived activities; do not depend on the active-only search page or a prior visit. Preserve stable activity identity and permission boundaries. Labels should refresh appropriately after a rename.

**Acceptance:** fresh/direct page entry, reload and a restored draft must present the readable linked title without first opening an activity picker. Cover both active and archived permitted activities and a truthful unavailable/permission fallback. The gallery's prefilled reference data must not substitute for this live behavior.

### F3 — Low: Quick Export's native document buttons have no action handler

**Reproduced live:** from the scoped full report, open Quick Export and activate `MAT-STE-2026-00005` in its loaded preview. The URL remains on the report and the dialog stays open. [Screenshot after activation](assets/20261017-design-migration-followup/report-preview-document-click.png), [navigation observation](assets/20261017-design-migration-followup/document-link-observation.json).

[QuickExport.vue](../frontend/src/components/QuickExport.vue), lines 114–124, renders `ReportTable` without listening for `openDocument`. [ReportTable.vue](../frontend/src/components/ui/ReportTable.vue), lines 264–272, always renders an enabled button for a native `document` cell and emits that event on activation. Consequently the record identifiers in the new saved-detail previews appear interactive but their activation is discarded. Full `ReportsView` does handle the same event correctly.

**Refinement:** either connect deliberate document navigation through the coordinator and close the overlay, or render noninteractive document text in export-only previews. Preserve dirty-editor leave guards if navigation is supported. Avoid enabled controls with no behavior.

**Acceptance:** mouse and keyboard activation must either open the correct native record through normal navigation or the identifier must be plain selectable text with no button semantics. File generation must remain separate.

### F4 — Low, review-fixture gap: dashboard sample still masks the live item-name improvement

The current `dashboard/overview` gallery renders `库存记录` for every recent record, whereas the original preview shows item names and the live app now does too. Its loan context also shows missing activity labels. [Original gallery](assets/20261017-design-migration-followup/dashboard-gallery-original.png) / [current gallery](assets/20261017-design-migration-followup/dashboard-gallery-current.png).

In [fixtureServices.ts](../frontend/src/design-preview/fixtureServices.ts), `dashboardCard`, recent movement rows around lines 509–518 contain only DocType/document/date/quantities, omitting `item_names`, `kind` and `activity_title`. Loan rows similarly omit activity context. `DashboardView` correctly falls back when fields are absent, so this is **not evidence that the live R9 fix failed**.

**Refinement:** make injected fixture payloads represent the current service contract and realistic populated cases. Continue sharing production components; do not add a second gallery-only rendering path. Include ordinary named records and deliberate fallback scenarios separately so future screenshot comparisons exercise the intended hierarchy.

## Completed capabilities and boundaries

- Shared native settlement validation now precedes the untyped early return; ordinary ERPNext entries without settlement metadata remain supported in the inspected code.
- Report presentation columns are separate from full export audit columns; canonical query handling includes `recordDoctype` on both client and server. Removing the record filter clears both name and DocType.
- Ordinary saved Loan and Count export previews load with exact persisted identity/status. [Loan desktop](assets/20261017-design-migration-followup/loan-export-desktop.png), [Count mobile](assets/20261017-design-migration-followup/count-export-mobile.png), [full Count scope](assets/20261017-design-migration-followup/count-full-export-scope-mobile.png). These are preview/navigation observations, not newly generated/downloaded files.
- Green remains the default in `displayPreferences`; this change did not replace the existing user-controlled themes or precision of native concurrency tokens.
- The original migration's architecture/completeness assessment still applies outside this scoped follow-up. No new high-priority stock-integrity defect was identified by this pass, but backend execution was intentionally not repeated.

## Limits and continuation

The fix record reports passing focused frontend/browser checks and a backend run with an intermittent sample-test database error that passed in isolation. Those claims were not rerun. Its incomplete full-gallery sweep remains incomplete; this visual pass does not turn it into a passing full suite.

No new export jobs, stock transactions, account changes, saved preferences, cancellation/amendment workflows, concurrency races, or real-device camera/zoom scenarios were exercised. The opening-export finding is source-confirmed and needs representative validation by the implementing agent. The native settlement fix is accepted here on code review and the documented implementation evidence, not an independently rerun probe.

Temporary capture workspace: `/tmp/temple-followup-review`. Durable selected evidence lives beside this report under `assets/20261017-design-migration-followup/`. Initial progress and findings were checkpointed in this file during the review, then consolidated into this report. Implementation files and the user's pre-existing `AGENTS.md` modification remain untouched.

Cleanup: review browser/gallery processes had exited; the briefly restarted review server was stopped. The protected temporary session file was deleted and the temporary capture script's literal development password was removed. A logout attempt used GET and received HTTP 403 because Frappe requires POST; server-side revocation of that session was not confirmed. No session token is retained in the report/evidence.
