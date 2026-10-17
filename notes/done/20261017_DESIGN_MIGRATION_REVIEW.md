# Design migration independent review and refinement report

Date: 2026-10-17  
Status: **Review complete. Substantial implementation is present, but correctness and UI refinement are still required. No implementation fixes made.**

**Implementation follow-up:** R1–R10 fixes and their new verification evidence are
recorded in [20261017_DESIGN_MIGRATION_FIXES.md](20261017_DESIGN_MIGRATION_FIXES.md).
The independent-review findings and historical results below are retained unchanged.

## Verdict

The replacement architecture is largely implemented: production uses the promoted component/style foundation, native ERPNext documents replace the old workspace/custom-loan model, and real services back the major features. The archived Activities/Reports requirements were substantially incorporated. This is more than a preview wired to a few endpoints.

However, the implementation should not yet receive completeness/correctness sign-off. This review reproduced one high-priority native loan-validation bug, found two missing saved-detail capabilities, and identified several visual regressions that passing fixture tests did not expose. The priority order is R1, R7/R6, R2–R5, then the smaller R8–R10 refinements.

## Reference identity and review method

| Role | Exact source | Browser target during review |
| --- | --- | --- |
| Original approved routed preview | `version-16` at `63c7f26b7a5be5e689e1e28071e801e967e8b6c6` | Isolated temporary Vite gallery, port 5291 |
| Migrated shared-component gallery | `design-migration` at `9c2387365aa8011ed7eeacc1d13819a073b9cece` | Separate Vite gallery, port 5292 |
| Actual application | Same migration commit, existing built assets and live `development.localhost` APIs | Temporary Frappe server, port 8102 |

The original frontend was extracted with `git archive`; the checkout was never switched or overwritten. In paired screenshots, **original is left; migrated gallery is right**. The candidate gallery is evidence about shared presentation, not an independent visual specification. The [consolidated handoff](20261016_DESIGN_TO_PRODUCTION_HANDOFF.md) remains the requirements authority; this report records defects and verification results rather than replacing it.

Browser checks used Chromium/Playwright at 1440×1000 and 375×1000. The same local CJK font was injected on both sides so Chinese text would render reliably. Product CSS was otherwise retained, except for explicitly recorded temporary DOM-only diagnostic/stress changes. Actual application access used normal login. No HTTP API responses were mocked in the live inspection.

No implementation source, schema, account preferences, or persistent stock records were changed by the review. Native tests/probes rolled back their business data. No reset, reseed, core modification, build, or deployment was performed. The existing user modification to `AGENTS.md` is preserved.

## Fixes required

### R1 — High: native entries without a movement kind can falsify loan settlements

**Actual:** `native_stock.before_validate()` returns early when `ti_movement_kind` is blank, before validating settlement metadata. `loan_balances()` counts submitted line references without requiring a valid settlement parent kind.

A rollback-only probe exercised ordinary native document insertion/submission:

1. Create and submit a five-unit Loan into the leased leaf.
2. Receive another ten units into a physical warehouse.
3. Create a seven-unit native Material Transfer between two physical warehouses, leaving `ti_movement_kind` blank.
4. On that transfer's line, set the original Loan and original child-row references, with settlement outcome `Returned`.
5. Insert and submit normally through native hooks.

Submission succeeded. The resulting projection reported **seven returned units against a five-unit loan**, while the original leased warehouse still contained all five. No stock was actually returned from the borrower. These changes were rolled back.

**Source:** [native_stock.py](../temple_inventory/native_stock.py), `before_validate` around line 211, `loan_balances` around line 287, and `validate_settlements` around line 312.

**Required refinement:** enforce settlement metadata consistency through shared native validation even when kind is absent/unsupported. Preserve legitimate ordinary ERPNext documents, but reject contradictory app settlement meaning. Do not solve this only in frontend controls or by suppressing negative balances in reports.

**Acceptance:** native Desk/API insert, save, and submit cannot count an unrelated transfer as a settlement; reject missing/incompatible kind, wrong source/provenance, and excess quantities. Valid partial Return/Damage/Loss remains supported. Verify outstanding balances and loan cancel/amend dependencies after native submission/cancellation.

### R2 — Medium: real export tables expose internal JSON identities and lose compactness

**Actual:** `/inventory/reports` and the Quick Export preview show a leading `标识` column containing serialized grouping keys such as `["summary", "TI-SAMPLE-C-A01", "绿色古风裙袄(男)", ...]`. Rows become roughly 120px tall and useful quantity columns move out of the visible area. Both original and candidate fixture galleries use cleaner display columns, so gallery-only validation misses the real API mismatch.

**Source:** [projections.py](../temple_inventory/projections.py), `group()` around line 257 includes `id` in columns and generates a JSON identity around line 289; [ReportTable.vue](../frontend/src/components/ui/ReportTable.vue) renders every returned column; [useReportController.ts](../frontend/src/features/export/useReportController.ts) adopts server columns directly.

**Evidence:** [live export table](assets/20261017-design-migration-review/reports-live-desktop.png), [original versus candidate gallery](assets/20261017-design-migration-review/reports-original-vs-candidate.png), [live Quick Export](assets/20261017-design-migration-review/quick-export-live.png).

**Required refinement:** define intentional visible columns for each dataset/view, keeping synthetic row identity separate from display data. Keep real document, child-row, Item, Batch, warehouse, Activity and loan identities required for audit/export. Review exported column presentation separately; do not indiscriminately remove required audit IDs from CSV/XLSX.

**Acceptance:** render real API-shaped responses in gallery/contract tests; the default inventory summary and five-row export preview show readable names and quantities without serialized implementation keys. Check all six datasets and grouped/detail tables.

### R3 — Medium: mobile warehouse labels collapse into narrow text strips

**Actual:** indentation, icon/toggle, label, Details, and Edit compete in one flex row. At 375px, deep gallery labels have only 63px outer width and rows grow to 129–152px. Real labels such as `D03 / 未指定` wrap almost one character per line; even `Location` breaks into fragments. Enlarged text makes the tree extremely tall. This is visibly worse than the original preview.

**Source:** [NativeWarehousesView.vue](../frontend/src/features/warehouses/NativeWarehousesView.vue), tree rows around line 102; [browse.css](../frontend/src/styles/browse.css), shared row flex layout and depth indentation around lines 62 and 374.

**Evidence:** [real mobile tree](assets/20261017-design-migration-review/warehouse-mobile.png), [200% text](assets/20261017-design-migration-review/warehouse-mobile-200.png), [original versus migrated tree](assets/20261017-design-migration-review/warehouse-original-vs-candidate.png).

**Required refinement:** retain native hierarchy and node actions, but give mobile labels enough space by changing action placement and/or indentation. Root/system nodes added for real configuration are valid; their presence does not justify unreadable descendant rows. Translate displayed physical types while keeping backend identifiers intact.

**Acceptance:** normal and long names remain readable at 375px through 200% text, with 44px mobile actions, no document overflow, and working expand/select/detail/edit behavior. Check both protected and editable nodes at maximum visible depth.

### R4 — Medium: desktop Receive action bar covers keyboard-focused content

**Actual:** on a normal 1440px Receive editor, focusing `来源、活动与备注` leaves the disclosure behind the sticky save/review bar. Hit-testing the focused control's center returns the action bar. The corresponding 375px focus test succeeds.

**Source:** [forms.css](../frontend/src/styles/forms.css), `.preview-document-actions` around line 650 is sticky on ordinary desktop; [OperationEditorView.vue](../frontend/src/features/documents/OperationEditorView.vue) enables `useFocusVisibility` only when mobile or expanded.

**Evidence:** [focused control covered by the bar](assets/20261017-design-migration-review/receive-focus-covered.png). Focused disclosure bounds were y=942–988 in a 1000px viewport; the action bar covered its center.

**Required refinement:** make desktop obstruction handling consistent with the sticky layout, or restore an unobstructed ordinary desktop action placement. This is an interaction/accessibility defect, not just spacing preference.

**Acceptance:** tab through every supplemental input/disclosure and trigger validation navigation at desktop/mobile widths and supported text sizes. Focus and error targets must remain above visible obstructions in ordinary and expanded modes.

### R5 — Medium: Receive was rebuilt from the earlier example instead of the final routed layout

**Actual:** original `movement-form/Receive` uses the compact workflow layout shared with the other operations. The migrated view special-cases Receive into `receive-example`/`receive-layout`: vertically stacked time fields, separate section cards, a different summary hierarchy, and always-visible attachment/personnel sections. The page is substantially taller and no longer matches the final routed preview baseline.

**Source:** [OperationEditorView.vue](../frontend/src/features/documents/OperationEditorView.vue), `receive`-specific classes, layout, section surfaces and summary.

**Evidence:** [desktop comparison](assets/20261017-design-migration-review/receive-original-vs-candidate-desktop.png), [mobile comparison](assets/20261017-design-migration-review/receive-original-vs-candidate-mobile.png).

**Required refinement:** use the final routed-preview geometry rather than the earliest Receive example. Removing simulation controls and replacing status/recovery text is expected. Keep real lifecycle, native identity, files and personnel capabilities while restoring compact presentation; do not recreate a second preview implementation.

**Acceptance:** compare the same populated Receive draft, with matching theme/density/text size, against commit `63c7f26`. Check ordinary/expanded desktop and mobile layouts, supplement disclosure, summary, and the single action region.

### R6 — Medium: saved native document details are missing Quick Export

**Actual:** saved Stock Entry and Stock Reconciliation details contain no Quick Export control. Live checks of `/inventory/documents/Stock%20Entry/MAT-STE-2026-00013` and `/inventory/documents/Stock%20Reconciliation/MAT-RECO-2026-00001` both found zero matching actions after loading completed. Stock, Activities and Drafts pages do have the shared action.

**Source:** [OperationEditorView.vue](../frontend/src/features/documents/OperationEditorView.vue), [CountEditorView.vue](../frontend/src/features/counts/CountEditorView.vue), and their coordinators contain no QuickExport integration. Handoff section 12 explicitly includes saved details and persisted reconciliations.

**Evidence:** [saved loan detail](assets/20261017-design-migration-review/saved-loan-metadata.png), [saved count detail](assets/20261017-design-migration-review/saved-count.png).

**Required refinement:** expose the shared export action for supported persisted details, restricted by native DocType/name and applicable status. Export the saved authoritative record, not unsaved buffers; keep unsaved editors and matching counts with no server record excluded.

**Acceptance:** saved draft/submitted/cancelled records export the intended document and its permitted allocations; the full export workspace inherits the same scope. A similarly named record of another DocType must not enter that scope.

### R7 — Medium: read-only Stock Entry detail loses date/time and borrower

**Actual:** the editable-only template contains both the time section and borrower/loan context. There is no read-only equivalent. Opening the supplemental disclosure does not restore them.

Verified against actual API responses:

| Native record | Authoritative fields | Visible detail |
| --- | --- | --- |
| `MAT-STE-2026-00005` — Loan | Date `2026-09-27`, time `12:00:00`, borrower `样例演出团队` | Date and borrower absent |
| `MAT-STE-2026-00013` — Receive | Date `2026-10-13`, time `12:00:00` | Date absent |

**Source:** [OperationEditorView.vue](../frontend/src/features/documents/OperationEditorView.vue), `v-if="writable"` block around lines 208–289. Date/time also appear in the pre-submit overlay, which is not a saved-detail presentation. The decoded fields already exist in [operationCodec.ts](../frontend/src/features/documents/operationCodec.ts).

**Evidence:** [submitted loan with supplements expanded](assets/20261017-design-migration-review/saved-loan-metadata.png).

**Required refinement:** render saved posting date/time, borrower and applicable operation context as labeled selectable text. A separate Loan detail route does not replace this requirement for native records opened from movements, activities, or direct URLs. Audit other editable-only fields for the same omission, including amendment provenance.

**Acceptance:** submitted/cancelled and permission-limited details expose the authoritative metadata without editable controls. Keep busy/conflict input handling separate so a temporary pause does not discard unsaved buffers.

### R8 — Low: short desktop pages are vertically centered and jump during loading

**Actual:** at 1440×1000, the activity-list breadcrumb starts at y=228 and the draft-list breadcrumb at y=169, while long pages begin at y=24. Sparse/loading pages leave a large empty band above their controls. The gallery's fuller sample data conceals this behavior.

**Source:** [foundation.css](../frontend/src/styles/foundation.css), `.sample-content { margin: auto }` around line 616 inside the sidebar/content grid. This is inherited styling exposed by production content sizes, not a newly introduced declaration. A temporary browser-only `margin-block: 0` diagnostic moved the activity breadcrumb from y=228 to y=24; source was not edited.

**Evidence:** [short activity list](assets/20261017-design-migration-review/activities-short-page.png).

**Acceptance:** top alignment stays stable for loading, empty, one-row, and long lists, including after filtering. Preserve horizontal centering/max width where appropriate.

### R9 — Low: dashboard lost its visible heading and useful recent-record names

**Actual:** the overview heading is now screen-reader-only; recent records emphasize native numbers such as `MAT-STE-2026-00009` instead of the original readable item names. This weakens recognition even though the backend still supplies `item_names`.

**Source:** [DashboardView.vue](../frontend/src/features/dashboard/DashboardView.vue), heading around line 52 and recent-record rows around line 304; [browse.py](../temple_inventory/browse.py) assembles `item_names` around lines 422–426.

**Evidence:** [dashboard comparison](assets/20261017-design-migration-review/dashboard-original-vs-candidate.png).

**Acceptance:** restore the approved visible heading and meaningful item/operation context, retaining native number/date as secondary audit information. Handle multi-item records and long names without inventing a single-item identity.

### R10 — Low: raw fractional-second timestamps clutter display text

**Actual:** dashboard snapshots, export scope and activity creation/update labels show strings such as `2026-10-17 14:34:48.267486`. On mobile they wrap and consume space; the original preview uses compact human-readable dates.

**Source:** [DashboardSection.vue](../frontend/src/components/DashboardSection.vue), snapshot around line 52; [ReportsView.vue](../frontend/src/features/export/ReportsView.vue), snapshot around line 107; [ActivitiesView.vue](../frontend/src/features/activities/ActivitiesView.vue), timestamps around lines 266 and 355–359; related browse/quick-export captions.

**Evidence:** [activity detail](assets/20261017-design-migration-review/activity-detail.png), [Quick Export dialog](assets/20261017-design-migration-review/quick-export-live.png).

**Acceptance:** apply consistent display-only date/time formatting with clear site-time meaning. Preserve exact native modification/version values for locking and API round trips; never round the stored concurrency token.

## What is already implemented

“Implemented” below means code exists with the stated evidence; it does not waive the defects above or imply exhaustive production acceptance.

| Area | Present implementation and evidence | Remaining qualification |
| --- | --- | --- |
| Frontend replacement | `main.ts` imports the single `styles/app.css` foundation; routed feature controllers/views replace legacy views. The development gallery injects fixtures into production components. | Receive fidelity, real-column parity and live-content layout need R2–R5/R8 refinements. |
| Native document lifecycle | Native identity/child identity, versioned create/save/submit/delete/cancel/amend, request idempotency, unknown-field retention and Desk hooks exist in native API/access/stock modules. Integration and frontend lifecycle tests passed except the separately described initial suite transaction errors. | Saved-detail presentation/export gaps R6/R7. Do not equate fixture lifecycle tests with new live stock-write acceptance. |
| All nine operations | Receive, Issue, Transfer, Loan, Return, Damage, Loss, Repair, Disposal have mappings, controllers, validators and live-loadable entry routes. | R1 is a native-hook bypass, despite ordinary typed operation coverage. |
| Loans | Native original-document/line references, partial settlements, batch-aware derived balances, borrower/activity compatibility, cancel/amend dependency checks and loan browse/detail are present. | R1 blocks correctness sign-off. |
| Counts | Native ledger baseline/fingerprint, review metadata, blank/zero/not-found handling, stale-baseline checks, differences-only reconciliation and no-record matching outcome exist with integration tests. | Saved count export missing; two-successful-commit race not independently tested. |
| Conversions and contextual creation | Per-line recorded factors; separately authorized Item defaults; Item/category/UOM/Batch/activity supporting services and editors exist. | No fresh live create/update acceptance in this read-only browser review; rely on inspected code and integration/unit evidence. |
| Activities and types | Immutable identity, editable unique title/type labels, Active/Archived lifecycle, notes, version checks, reference/delete guards, direct/indirect relationships, totals and filters are implemented. Real list/detail loaded. | Timestamp/readability refinements; no new live archive/delete cycle performed. |
| Inventory, expiry, movements and Pending | Real native projections, unit-aware totals, stock cards/list, movement and loan browsing, expiry buckets and damaged-stock scope exist. Live routes loaded without observed API/page errors. | Fixture/live column mismatch and dashboard context regressions described above. |
| Six report datasets | Inventory, Expiry, Movements, Loans, Activities, Counts; fixed views, grouping, pagination, historical SLE balances, complete summaries and shared query semantics exist. Integration cases cover complete 1,005-allocation projection/writers. | R2; visible table presentation needs live-shaped contract coverage. |
| Export jobs and named views | Native background jobs, CSV/XLSX writers, ownership/private files, download reauthorization, retry, per-account named view persistence and relative date queries exist. Independent native report tests cover these internals. | This review did not rerun an actual RQ export worker/download. Previous agent's real-worker evidence remains attributed to its progress log. R6 is missing frontend integration. |
| Files and images | Standard private File/native-parent services, parent authorization, completed-record guards, pending uploads and original image enlargement exist. Live private images/lightbox worked; backend file tests passed. | No new live upload/relink/delete operations during this review. Offscreen lazy images in full-page screenshots are not evidence of broken files. |
| Warehouses and configuration | Native tree/list/detail, protected-node management, server hierarchy guards, setup/repair and exact-site seed/reset tooling exist. Configuration/warehouse integration cases passed. | R3; no reset or configuration mutation was rerun. |
| Account display settings | Jade/blue/bronze themes, balanced density/100% defaults, native per-user persistence, validation, save serialization and confirmed cache behavior exist. Actual settings show jade selected. | Sampled contrast passed; all-device/all-combination accessibility is not certified. [Settings screenshot](assets/20261017-design-migration-review/settings-mobile.png). |
| Recovery/auth/navigation/PWA | Site/account/tab/editor browser recovery, serialized native autosaves, conflict/session handling, route/history restoration, logout/install guidance and prompt-based update code exist. Relevant UI/backend tests passed. | Physical installation, native browser zoom, service-worker update across two deployed builds, and real devices were not exercised. |
| Legacy cleanup | Old workspace/custom-loan modules and obsolete frontend view/style consumers are retired in the reviewed diff. Runtime production entry does not import gallery fixture data. | Do not remove legitimate development gallery/tests, seeded business example names, or shared `preview-*` CSS classes merely because their names contain “preview.” Those are not proof of placeholder production behavior. |

The Activities/Reports backend specification archived under `notes/done/` was not simply left out: its reference types/lifecycle, structured context, direct/indirect reporting, six datasets, historical balances and exports have concrete replacements. The defects found here are implementation gaps/regressions, not evidence that this entire requirement set remains unbuilt.

## Independent validation results

| Check | Result |
| --- | --- |
| `pnpm test` | **308 passed**, 48 files, exit 0 |
| `pnpm type-check` | **Passed**, exit 0 |
| Existing production Playwright suite | **19 passed, 2 initially skipped**; these use fixture API responses |
| Camera decoder follow-up with existing deterministic Y4M fixture | **2 passed**: ZXing-WASM and Frappe decoder, including track release |
| Native rollback integration runner | **85 cases executed; 83 passed, 2 cases errored**, with two additional teardown/savepoint errors |
| Native isolation follow-ups | Both errored cases **passed individually**: historical stock (1.002s), complete-original loan status (1.332s) |
| Independent loan-validation probe | **Defect reproduced** through native insert/submit; transaction rolled back |
| Original/candidate visual comparison | Ten routes × two widths × two identities = **40 screenshots**, no observed page errors/document overflow |
| Initial real-app route sweep | 25 desktop / 17 mobile routes, including all nine desktop operation entries; some initial captures preceded API completion and are not treated as final loaded-state evidence |
| Final real-app loaded-state sweep | 12 routes × two widths = **24 observations**, no page exceptions, HTTP failures, pending API calls at capture, or document horizontal overflow |
| Live interactions | Filters, stock list mode, Item detail, image lightbox, record/count detail, activity detail, Quick Export dialog and warehouse inspection; final activity detail explicitly awaited |
| Sampled text contrast | No failing eligible visible text in the sampled default pages or local-only jade/blue/bronze enlarged warehouse samples |

The full native run's errors were MariaDB `1020: Record has changed since last read in table 'tabUser'`, followed by missing-savepoint cleanup errors. Both affected scenarios passed alone. Their original failure mechanism is consistent with transaction interference, but the exact competing writer was not established. The trailing `bench execute` NameError is fallback noise, not the primary failure. Do not claim that this review obtained a clean 85/85 single full run; equally, do not confuse these transient/suite-interaction errors with the independently reproduced R1 defect.

The contrast checker measures text against composed solid ancestor backgrounds and excludes disabled, opacity and background-image cases. Direct visual inspection supplemented it. No low-contrast text defect was confirmed in that sample, but this is not a complete WCAG assessment, a non-text contrast audit, or a full three-theme × three-density × five-scale matrix. Lack of document overflow also does not prove readability: R3 is a counterexample.

Live dashboard loading took roughly six seconds including bootstrap; other final page captures took roughly 1.4–3.8 seconds, with individual dashboard API calls around 4.4 seconds. These are local development observations, not a production performance benchmark or a confirmed regression.

## Evidence and scope limits

Durable evidence is stored in [assets/20261017-design-migration-review](assets/20261017-design-migration-review): 15 selected screenshots plus a compact machine-readable evidence record. Screenshots are referenced next to findings. Full temporary captures/scripts/logs are under `/tmp/temple-inventory-review-20261017/`; these may disappear and are not required to understand the findings.

Useful temporary records: `gallery-observations.json`, `gallery-contrast.json`, `live-final-observations.json`, `interactions.json`, `final-checks.json`, `saved-metadata.json`, `layout-check.json`, and the test/probe logs. Paired screenshots compare equivalent gallery data; real screenshots intentionally use seeded native data, so row counts, images, entity names and additional native root nodes can differ legitimately.

Not independently repeated: the previous agent's full 79-case gallery suite and six rename regressions; actual RQ CSV/XLSX generation/download; live stock create/submit/cancel/amend; two successful concurrent stock commits; real-camera/device behavior; native browser zoom; production build/deployment. Existing integration tests, source inspection and the earlier progress record provide additional evidence but are distinguished from this review's direct execution. No exhaustive pixel-perfect or security sign-off is implied.

## Refinement sequence and completion checks

1. Fix R1 at the native validation boundary, with a regression reproducing the physical-to-physical false settlement and protection for valid ordinary ERPNext documents. Rerun relevant native settlement, cancellation, count/report and permission tests.
2. Complete saved-detail metadata/export (R7/R6). Verify submitted/cancelled/permission-limited views and exact DocType/name/status export scope.
3. Resolve actual API/table presentation parity (R2). Add real-response-shaped coverage so the gallery cannot silently conceal production-only columns.
4. Restore approved Receive geometry and unobstructed desktop focus (R5/R4), then repair mobile warehouse labels/actions (R3). Compare against the pinned original, not only the changed gallery.
5. Refine stable page alignment, dashboard context and formatted timestamps (R8–R10). Preserve backend identities, version precision, native hierarchy and scope semantics.
6. Run focused regressions plus required type/native checks; inspect final production screenshots at both widths and enlarged text. Record remaining real-device/concurrency limits accurately. Do not reset/reseed merely to rerun this review.

This review added only this report and its evidence assets. The migration implementation remains unchanged for the next agent.

Cleanup completed: temporary login/session files removed; all three review-owned servers stopped; report links checked successfully. No commit was created.
