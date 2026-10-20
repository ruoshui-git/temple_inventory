# Category, scanner and reconciliation refinement review — 2026-10-19

Implementation agent: **gpt-6-luna**, reasoning effort **max**, including review corrections, formatting, type checking and code-based tests. The parent agent independently inspected source and exercised the rebuilt production routes in Chromium.

## Delivered behavior

- Optional Item categories save to the native root, which stays hidden in ordinary labels. The explicit `(无分类)` filter matches direct root assignments and combines with selected category branches by union. Category management supports native create/edit/rename/delete guards and recoverable edits.
- More has one 盘点调整 card opening the existing count browser with a create action, plus category/configuration cards.
- Compact counting spans authorized physical locations in one native reconciliation. Visibility filters preserve all inputs. Blank and zero remain distinct; line notes are optional. Native document notes persist in `ti_notes`; table thumbnails open the shared lightbox.
- Camera selection is shared and locally remembered. Related detail histories are submitted-only. Native lifecycle badges distinguish draft, submitted and canceled documents.
- The development site schema was synchronized. No database reset was performed. Single-location and Not Found contracts were retired without compatibility adapters; seeds and fixtures use the new model.

## Independent review and corrections

Source and visual review found and corrected unchanged-name category renames, a stock-browse root-label leak, scanner startup pause/retry locking, missing baseline re-review controls, count paging/filter interactions, history quantity/navigation errors, duplicate action bars, and draft/canceled Loan export status scoping.

The visual pass also corrected oversized missing-image rows, false initial baseline warnings, stacked category dialogs, and category recovery losing its edit identity/version. Both custom and Desk-origin count tables constrain artwork. Final desktop rows measured **51.39px**, including missing-image placeholders, at balanced density.

## Validation

Implementation agent results:

- Frontend: **62 files / 404 tests passed**; subsequent focused scanner correction suite **26 tests passed**, count hydration suite **19 tests passed**, and final count confirmation suite **20 tests passed**. These focused runs overlap and are not additive.
- Backend: rollback-safe native inventory integration **103 passed**; focused catalog module **89 passed** on final backend test source. These runs overlap and are not additive.
- TypeScript checking, production Vite build, changed-file Prettier checks, Ruff lint/format checks, Python compilation and `git diff --check` passed.
- A project-wide Prettier check also found pre-existing formatting in untouched `RemoteSelect.vue` and `SortControl.vue`; these were left unchanged.

Parent browser checks used the actual built production bundle and routed components, with intercepted deterministic API responses; no parallel preview application was created. Viewports included **1440px desktop, 390px mobile, and 150% desktop text**. No page errors occurred in the exercised scenarios.

- Count page-two filtering clamps pagination, preserves entered quantities, shows hidden-input counts and restores inputs after clearing the location filter.
- Shared history shows correct quantities and omits status badges; lightbox opening/closing preserves count input.
- Optional document notes appear in confirmation. One Save/Review action area remains. Fresh blank rows have no baseline-change warning.
- Desktop and mobile layouts have no document-width overflow; the mobile count table scrolls horizontally. A focused count input remains visible above actions/navigation.
- Category creation uses the shared fields; canceling dirty input presents exactly one confirmation dialog.
- Movement/Loan record browsers show amber 草稿, green 已提交 and red 已取消. All three badges appear in native document viewers.
- Chromium fake-camera checks opened camera A, switched to B, remembered B on reopening, then fell back to A after simulated B disconnection. Old tracks stopped. Physical multi-camera hardware was not tested.

## Evidence

- [Desktop count table](assets/20261019-category-count-review/reconcile-new-1440.png)
- [Mobile count table](assets/20261019-category-count-review/reconcile-new-390.png)
- [Count image lightbox](assets/20261019-category-count-review/count-lightbox.png)
- [Mobile focused count](assets/20261019-category-count-review/count-focused-390-100.png)
- [150% text focus](assets/20261019-category-count-review/count-focused-1440-150.png)
- [Category form](assets/20261019-category-count-review/category-dialog-mobile.png)
- [Single category discard dialog](assets/20261019-category-count-review/category-discard-mobile.png)
- [Movement lifecycle badges](assets/20261019-category-count-review/movements-records.png)
- [Loan lifecycle badges](assets/20261019-category-count-review/loans-records.png)
- [Camera selection](assets/20261019-category-count-review/scanner-mobile.png)

## Earlier verification boundary (superseded below)

Automatic approval review rejected creating a privileged Administrator session cookie because the browser-review request did not explicitly authorize generating privileged credentials. No session was created and no workaround was attempted. Consequently, this browser acceptance does **not** establish authenticated end-to-end behavior against the live database; real backend behavior was checked through the native integration suites. The browser fixture scripts and raw measurements remain under `/tmp/ti-final-review` for this session.


## Authenticated live acceptance

The user subsequently authorized normal development login with Administrator credentials. This pass used that login against the running local Frappe site and the rebuilt production application, with real API responses and database records. Only a local font resource was provided for readable Chinese screenshots. The earlier fixture-only verification boundary is superseded by these results.

- Category create, unchanged-name group edits, native rename and deletion succeeded. Native child-node and linked-Item deletion guards rejected deletion as expected. Creating an Item with no visible category assigned the native root, and the explicit uncategorized browse filter found it without exposing the root label.
- Live Movement/Loan browsers loaded successfully. Draft, submitted and canceled native Stock Entry viewers displayed their colored badges. Item, Warehouse and Loan detail requests explicitly scoped histories to submitted records; Batch and Activity responses also contained only submitted records. Detail history tables omitted lifecycle badges.
- The real count baseline contained **177 rows across 13 physical locations**. Pagination/filtering, image lightbox, submitted-only history and mobile input focus worked. Two entered counts in different locations saved into one native draft with optional line reasons blank. Document notes and reviewed values survived reload. Filtering to one location reported exactly one hidden entered row.
- Live review found Frappe serializes untouched Float counts as zero. Native load/save hydration now restores Unreviewed counts to blank while preserving genuine Reviewed zeroes and retained quantities awaiting rereview. Regression tests cover both states.
- Confirmation now lists only reviewed rows across the entire scope, including rows hidden by workspace filters. Full-scope totals and the unreviewed count remain visible; unreviewed rows are excluded from adjustments. Optional notes appear near the summary rather than below all 177 baseline rows.
- Two Chromium-generated camera devices exercised the browser's actual media APIs. Selection survived scanner reopening and full page reload, including Chromium rotating device IDs. This exposed and fixed preference recovery using a unique browser-provided camera label when the stored ID disappears. Physical camera hardware remains untested.
- No JavaScript errors occurred in these scenarios. Temporary categories, Item and reconciliation draft were removed through normal native APIs. A final read-only check found no review Items/categories or count drafts. **No stock adjustment was submitted.**

Live evidence:

- [Compact desktop count table](assets/20261019-category-count-live/count-loaded-desktop.png)
- [Count image lightbox](assets/20261019-category-count-live/count-lightbox-live.png)
- [Two-location compact confirmation](assets/20261019-category-count-live/count-two-location-review.png)
- [Mobile focused count after draft reload](assets/20261019-category-count-live/count-mobile-focused-live.png)
- [Native category child-deletion guard](assets/20261019-category-count-live/category-child-delete-guard.png)
- [Loaded Movement browser](assets/20261019-category-count-live/movements-records-loaded.png)
- [Loaded Loan browser](assets/20261019-category-count-live/loans-records-loaded.png)
- Native viewer status: [draft](assets/20261019-category-count-live/document-status-0-live.png), [submitted](assets/20261019-category-count-live/document-status-1-live.png), [canceled](assets/20261019-category-count-live/document-status-2-live.png)
- [Camera choice restored after ID rotation](assets/20261019-category-count-live/live-camera-reload-mobile.png)
- Machine-readable results: [categories](assets/20261019-category-count-live/categories.json), [counts](assets/20261019-category-count-live/counts.json), [detail histories/statuses](assets/20261019-category-count-live/details.json), [scanner](assets/20261019-category-count-live/scanner.json), [cleanup](assets/20261019-category-count-live/cleanup.json).
