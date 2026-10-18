# Production UI refinement — implementation record

Date: 2026-10-17. Status: implemented locally; no deployment or database reset.
Specification: [16-item handoff](20261017_UI_REFINEMENT_HANDOFF.md).
Follow-up: [independent review, repairs and live browser evidence](20261017_UI_REFINEMENT_REVIEW.md).
Existing edits to that handoff and the UX decision record were preserved.

## Requirement map

| # | Implementation and verification |
| --- | --- |
| 1 | Stock has separate expanded/compact DOM regions; Movement/Loans use shared `BrowseToolbar`. Compact chrome retains counts, Search, Scan, Filters, Expand. Search/filter/selection remain in controllers. Automatic compaction happens once after 160px; explicit choices persist, avoiding scroll-height oscillation. Browser checks cover long search, selection, filter access and actual height reduction. |
| 2 | Native editor/count/browse/draft/report labels read 已提交. `nativeStatusLabel` centralizes numeric lifecycle display. Loan settlement labels remain separate. Export adds a readable status alongside explicitly labeled native numeric values; backend test verifies both. |
| 3 | `ApplicationShell` uses normal RouterLinks for home/domain ancestors and marks the current segment. Removed redundant stock/activity/export/draft/warehouse/editor captions. Item category/code, dates, status and confirmation context remain. |
| 4 | `AsyncImage` reserves a square contain frame; ItemImage, pickers, groups and attachments share it. Full-image views retain natural proportions. `ImageCrop` offers square preview, zoom/position, cancel and 使用原图. 保留原图 defaults off; retained originals are separate 原图-named attachments. Images are processed sequentially before `useAttachments.add`; cancellation uploads nothing. First Item image defaults to primary if absent; pending choice and metadata retry reuse the uploaded File. Crop/retention/cancel/primary-retry tests pass. |
| 5 | Warehouse arrows and leaf icons share a centered 44px box. Routed browser assertions measure both icon centers within 1px at 200% text on phone/desktop. |
| 6 | Movement/loan record allocation actions open a wide modal, keeping identity/type/date/status and matching-versus-whole totals in its header. Existing controller fetches all permitted pages. Browser test loads 36 rows, checks unchanged parent column widths, Escape and trigger focus return. Expiry/product batch inspection also leaves table flow. |
| 7 | `QuantitySummary` now actually displays a full-width responsive grid with text-relative minimum tracks. Movement shows the first six type/status/unit metrics and exposes extensive breakdowns in a modal. Separate units and filtered-result scope remain intact. |
| 8 | ReportTable supports explicit successful-result state; loading/error suppress premature empty/caption totals and retained content survives refresh. Attachments own remote loading/result/error/retry and stale-response guards. Hierarchy/search selectors preserve prior options during updates and suppress false empty states. Activity list/related records, Item picker, stock counters, dashboard and new modals were audited; local drafts truthfully show no attachments without a request. |
| 9 | Shared `warehouseLabel` resolves authorized labels and parent paths for collisions. Applied to chips, flows, stock breakdowns, Item picker, operation/count choices and summaries, loan details, dashboard and report cells. Projection adds display labels for every paginated row; exports explicitly identify ERPNext-name audit columns. Native filters/keys/URLs/payloads remain unchanged. Backend label/export and permission checks pass. |
| 10 | ScanPanel is a single modal with camera/manual input, matches, continuous mode and recent scans. Quantity configuration temporarily returns to the editor and continuous mode can resume afterward. ZXing-WASM is the sole engine; the Frappe adapter/switch/preferences are retired. Shared overlay staging preserves contextual editors. Unit checks cover pause/expiry/retry/cleanup; routed manual input and simulated camera decoding/tracks pass. |
| 11 | Hierarchy indentation is 10px/level capped at 40px, with branch guides, deep/search path context and reduced leaf spacers. Expand/select targets remain independent. Home/End and focused-row activation are retained/fixed. Selection normalization and deep phone/200% text checks pass. |
| 12 | Shared styled semantic accordions retain metadata, notes, conversions, supplements, configuration and recovery. Allocation/batch inspection and analysis use wide overlays. Stock and Movement analysis use paginated ReportTables; Pending/Expiry retain their existing complete-result controller pagination. Activity creation/more actions use labeled action dialogs. Full disposition below. |
| 13 | Expiry summary cards precede a list-local ARIA tablist/panel. Arrow/Home/End work with one tab stop; cards retain independent scope. Shared active styling handles pressed/selected states with readable contrast. Routed checks verify list changes while card text stays unchanged. |
| 14 | Removed `src/design-preview`, HTML/main/gallery wrappers, dedicated Vite/Playwright configuration, design scripts and gallery server/browser cases. Retained production assertions and their 33 dependency fixtures/mount hosts under `tests/support`; no runnable test application exists. Production graph/bundling checks and retained native regression tests pass. Historical capability ledger/review records were not changed. |
| 15 | Shared readable table minima/internal scrolling, wrapping identity/actions, nonshrinking icon boxes, bounded trees, modal heading reflow and attachment filename tracks address confirmed squeezing. Browser evidence covers Chinese names/native IDs at 320/390/1440px, all three densities and 100/200% app text. Source audit includes all route families; visual limits below are explicit. |
| 16 | A single related-loan action opens an authorized read-only preview; multiple links open a chooser with borrower/date/context and secondary native ID. Chooser/preview use one modal with staged focus. Unavailable/error/retry and late/account-switched responses are guarded. Full-record navigation closes the preview and uses the normal router. Browser tests cover chooser back, full-record navigation and browser back to the source movement page. |

## Disclosure and layout audit

| Location / route family | Disposition |
| --- | --- |
| Stock; Movement/Loans item and record browse | Compact toolbar; analysis action/modal; allocation detail modal; styled ItemGroup sections. Complete summary and native navigation retained. |
| Expiry | Styled sort/tool accordion; batch detail modal for cards/tables; analysis modal with existing paging. |
| Product detail / Item editor / ItemConversions | Styled metadata/images, activity/history and conversion accordions; batch modal. Conversion inputs remain mounted/guarded; crop is an overlay stage. |
| Loan detail | Styled line allocation/conversion, unit summary, history, attachments and metadata sections; lifecycle and settlement wording remain distinct. |
| Operation/Count editors and AllocationSummary | Styled optional supplements and per-location summaries. Full final-confirmation content remains available; validation/recovery still reveal the relevant section. |
| Pending | Analysis action/modal; responsive result cards and readable warehouse names. |
| Reports | Styled supplementary-table accordions with controller pagination; lightweight styled field explanation. Main and supplementary tables use explicit result flags. |
| Activities | Explicit New movement / More actions buttons opening dialogs; styled detailed notes; truthful async activity/related-record empty states. |
| Drafts and Item/Activity/Category/Unit/Warehouse recovery | Styled semantic recovery sections retain copy/restore controls; native draft table minima remain. |
| Warehouses / Setup | Centered tree icons, bounded indentation, wrapped actions; styled recovery/configuration details. Native warehouse IDs remain in explicit metadata. |
| Dashboard / More / Settings / shell | Dashboard cards retain request/result state; adjacent expiry tabs; readable rank/action tracks; current breadcrumb links and account-scoped display controls. |
| SearchSelect / scanner | Removed the obsolete option-state simulation disclosure and scanner engine disclosure. Real loading/error/retry and manual entry remain. |

## Actual validation

- 18 focused Vitest files: **143 passed**. After the final hierarchy, modal-focus
  and header adjustments, the five affected files passed again (**31 tests**).
  The final thumbnail fix passed its three affected files (**35 tests**).
  No old migration suite was run to recertify the closed migration.
- `pnpm type-check`: passed. `pnpm build`: passed, including bundled local WASM
  and PWA output. Generated files were produced only by Vite, never edited by hand.
- Targeted Ruff lint/format: passed for exports, projection, display context and
  the new native-report scenario. Prettier formatted touched frontend files only.
- Production router in Chromium: **17 passed**, with controlled native-shaped HTTP
  responses and real rendered Chinese fonts. Covers six density/text/viewport
  combinations, modal pagination/focus, related-loan navigation/back, crop/original
  choices, square thumbnails, expiry tabs, warehouse icon centers, scanner manual
  input and a deterministic simulated-camera stream. Final modal-header changes
  passed both affected phone/desktop browser cases again. The final thumbnail
  constraint passed all eight affected stock/crop cases; a portrait 80×160 image
  measures 56×56 inside its 56×56 contain frame instead of overflowing to 112px.
- Five real-service, rollback-only backend checks passed on `development.localhost`:
  new display-label/native-identity/export scenario; private export owner/warehouse
  reauthorization; matching CSV/XLSX numeric scope; primary-image private File reuse;
  private-original attachment ownership/relink protection. Sandbox DNS could not
  resolve MariaDB; these checks succeeded on the Dev Container network.
- Existing tests that depended on gallery fixtures now resolve only test-support
  imports. Current guidance uses production and historical commits. New/current
  document links were checked locally.

## Visual evidence and measurements

Inspected routed production screenshots (HTTP data is mocked):

- [Desktop compact toolbar](evidence/20261017-ui-refinement/compact-toolbar-desktop.png)
  and [320px toolbar](evidence/20261017-ui-refinement/compact-toolbar-phone.png).
- [Compact hierarchy at 200%](evidence/20261017-ui-refinement/compact-tree-200.png)
  and [centered warehouse icons](evidence/20261017-ui-refinement/warehouse-icons-200.png).
- [Stable allocation modal](evidence/20261017-ui-refinement/stable-allocation-modal.png)
  and [quantity grid](evidence/20261017-ui-refinement/quantity-grid.png).
- [Crop choices](evidence/20261017-ui-refinement/crop-choices.png),
  [square attachment](evidence/20261017-ui-refinement/square-attachment.png) and
  [dashboard list tabs](evidence/20261017-ui-refinement/dashboard-tabs.png).

[Measured geometry](evidence/20261017-ui-refinement/measurements.json): desktop
1440px/100% toolbar reduced from **410px to 46px**; 320px/100% reduced from
**651px to 136px**. At 390px/200% spacious it reduced from **1327px to 222px**;
controls wrap instead of shrinking text or touch targets.

## Verification limits

This is local implementation and focused acceptance, not deployment approval.
Routed browser HTTP checks do not establish live-service end-to-end acceptance.
Crop/upload retention is checked through client contracts, and private File/
primary-image behavior is separately checked against Frappe. Real-device camera,
iOS/Safari, real-photo EXIF variations, unsupported-image fallbacks across browsers,
and real-service cropped-image uploads remain manual acceptance items.

App text scaling was tested at 200%; it is separate from native browser zoom.
Headless Chromium ignored six native Ctrl+Plus attempts (viewport 1440 and DPR 1
remained unchanged), so native zoom is **unverified**. The source audit covers all
route families; screenshots demonstrate representative shared surfaces rather
than exhaustive visual proof of every route and data/state combination. Dense
tables intentionally scroll internally; original-image viewers intentionally
retain natural proportions. No inventory, submission or warehouse semantics changed.
