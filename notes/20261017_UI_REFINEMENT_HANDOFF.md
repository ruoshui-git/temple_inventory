# Production UI refinement — implementation handoff

Date: 2026-10-17

Status: **Ready for another agent to implement. No UI changes implemented by this handoff.**

Source baseline: `ac7fd9e` (migration pass 2: `d732ddc`). The working tree was
clean before this documentation change. Read current `AGENTS.md`,
`UI_UX_DECISIONS.md` and `DESIGN_SYSTEM.md` with this specification.

## Scope and authority

Implement the user's 16 production-site refinements below, including removal of
the separate design-preview site. This is a new refinement task. The migration
is closed; do not restart migration work, update its historical capability ledger,
or recreate the gallery. [Migration closure](done/20261017_MIGRATION_CLOSURE.md)
and its validation limits remain historical evidence.

This handoff consolidates the user's requests and the subsequent source review.
The three explicit clarification answers are binding:

1. The collapsed toolbar is a **compact action row**, retaining page/result
   summary plus Search, Scan, Filters and Expand; the full controls leave view.
2. For a cropped upload, **retain the uncropped original only when selected**.
   An explicit “使用原图” path skips cropping.
3. Linked loans use a **read-only modal preview**, with a chooser for multiple
   loans and full-page navigation for actions.

Other detailed layouts below are recommended implementation defaults answering
the user's requests, not claims of individually approved mockups. Resolve routine
geometry and implementation choices within the existing design system. Ask only
if a new material product decision is needed. Do not treat historical preview
designs as a reason to omit the requested changes.

The current documentation author must not implement UI changes. This file is the
specification to use when the receiving agent is assigned implementation. It does
not itself authorize deployment, database resets, reseeding, core changes or
changes to inventory semantics. No subagent/delegation requirement is introduced.

## Shared implementation boundaries

- Keep native ERPNext identity, permissions, submitted-document immutability,
  quantity/unit meaning, allocation provenance, save/recovery and leave guards.
- Reuse production components and tokens. Controllers own requests, query state,
  permissions and selections; views render state and emit intentions.
- Use the existing 1024px responsive contract. Dialog content may reflow by its
  available width. Retain state across layout changes without duplicate controllers.
- Use the existing overlay foundation: focus entry/containment/return, Escape,
  inert background, scroll locking, safe-area clearance and keyboard access.
  Preserve the page's scroll position and prevent scrollbar-induced horizontal
  jumps. Prefer one overlay with internal stages over stacked dialogs.
- Keep labels in Chinese, preserve selectable detail text, and retain accessible
  touch targets while reducing unused space. No blanket font-size reduction.
- Update the UX decision record for durable decisions and design-system guidance
  for new shared patterns; implementation progress belongs in a separate task note.

## Requirements and acceptance

### 1. A toolbar that actually collapses

Starting points: `frontend/src/features/inventory/StockBrowseView.vue`,
`frontend/src/styles/foundation.css`, and other sticky browse-toolbar consumers.
Currently `toolsOpen` hides only Sort and Column Summary; view switches, chips,
checkboxes and other left-side controls remain in their original positions.

Implement distinct expanded and collapsed presentations. In scrolled/collapsed
state show one compact summary/action row, including active-filter and selection
counts where relevant. Search is a trigger rather than a permanently wide input.
Full search/filter/view/sort controls remain reachable through expansion or their
appropriate overlay. Collapsing must reduce the actual occupied sticky height,
not leave hidden controls' gaps or move them elsewhere in the same tall header.
Use clear 展开工具/收起工具 labels. Preserve input, filters, selected rows and the
user's current collapse choice while scrolling; prevent threshold oscillation.

Acceptance: populated filters, long search, active selection, mobile and desktop
all retain access to controls with a visibly shorter collapsed bar. Focus is
never stranded in hidden content; focused results are not obscured by the bar.

### 2. Submitted status wording

Native `docstatus = 1` means submitted. Use **已提交**, including status badges,
filter options, table cells, quantity captions and human-readable export labels.
Keep 草稿 and 已取消 distinct. “确认提交” may describe the explicit submit action;
do not mechanically replace every occurrence of 确认 in unrelated instructions.

Audit `ReportTable.vue`, native Operation/Count editors, NativeRecords, movement
browse/controllers, shared label helpers and backend display/export labels.
Centralize lifecycle display labels where appropriate. Preserve enum/API values,
native transitions and loan settlement status; this is a wording change.

Acceptance: the same submitted record reads 已提交 in list, detail, filters and
export preview; native status is unchanged.

### 3. Navigable breadcrumbs without duplicate captions

Starting points: `components/ApplicationShell.vue`, `lib/appNavigation.ts`,
`lib/pageDomain.ts`, router and feature page headings. Breadcrumbs are currently
plain spans. Stock adds `INVENTORY / 库存管理`; analogous decorative captions occur
in Activities, NativeRecords, Export and warehouse sections.

Use real route links for navigable ancestors, with the root leading home. Preserve
router leave guards and applicable browse context. Mark the current segment as
the current page; do not invent a destination for a purely organizational label.
If the current segment is a link, it must not force-reset the page. Keep one
breadcrumb trail and meaningful page/section titles; remove redundant taxonomy
or bilingual eyebrow captions, not useful item category/code or status metadata.

Acceptance: all supported ancestor links work with keyboard and normal link
behavior; stock has one breadcrumb trail. Audit all routed pages for duplication.

### 4. Square thumbnails and optional crop on upload

Starting points: `components/ItemImage.vue`, `components/ui/AsyncImage.vue`,
`components/Attachments.vue`, `features/attachments/useAttachments.ts`, Item
editor/primary-image flow, `services/itemArtwork.ts`, native File services and
thumbnail CSS. Some current wrappers use conflicting width/height geometry.

Create one shared 1:1 frame for all thumbnails: item cards, tables, pickers,
groups, attachments and placeholders. Reserve its space during loading/error.
Thumbnails must not stretch; uncropped images fit inside the square without
discarding content. Full-image previews retain the image's natural proportions.

Offer image uploads a square crop helper with reposition/zoom, preview, cancel,
and “使用原图”. For a crop, **保留原图** starts unchecked. If checked, retain the
uncropped file as an explicitly labeled record attachment in addition to the crop;
otherwise upload only the chosen crop. “使用原图” uploads the original alone.
Do not retroactively delete existing originals. Do not silently crop document
evidence. Apply the helper to image upload entrypoints, not non-image attachments.

Reuse private Frappe File ownership and Item image links. Avoid accidental duplicate
uploads during primary-image selection, retries or metadata saves. Keep cropping
before upload finalization; cancellation creates no unintended saved attachment.
Handle multiple files deliberately, image orientation, invalid/unsupported images,
upload errors and object-URL cleanup. Preserve same-account recovery semantics;
do not claim in-memory file bytes survive reload.

Acceptance: portrait/landscape/square/missing/failed images share square thumbnail
geometry. Verify crop-only, crop plus original, original-only, cancel and retry
paths, including which private files are retained and which is the primary image.

### 5. Center warehouse hover icons

Starting points: `features/warehouses/NativeWarehousesView.vue`, `.warehouse-toggle`,
`.browse-link` and `.browse-tree-type` in shared CSS. The toggle inherits a
left-aligned flex button, while location icons use a differently sized centered box.

Use consistent centered arrow/location-icon geometry within the intended highlight
and hit area. Preserve selected/hover/focus states and hierarchy semantics.
Acceptance: expanded/collapsed arrows and leaf icons are centered at ordinary and
enlarged text sizes, in all density presets and both responsive surfaces.

### 6. Table detail inspection without column reflow

Starting points: `features/movements/OperationBrowseView.vue` and
`components/ui/ReportTable.vue`, then all nested details in table cells.
Movement records currently put an entire detail table inside their status cell.

Replace dense cell disclosures with labeled 查看明细/匹配分配明细 actions opening
a wide modal. Header: compact row identity, type/date/status and relevant totals.
Body: the selected data point or allocation detail, with loading/error/retry and
pagination. Distinguish matching allocations from whole-document totals.
On phones use a full-width/full-height sheet through the shared overlay contract.
Load the complete permitted detail through existing controllers; do not substitute
only the rows already loaded in the parent list.

Acceptance: opening/closing details changes neither parent column widths nor page
scroll. Sort/filter/selection survive; return focus to the triggering row. Preserve
native document navigation, pagination and stale-result protections.

### 7. Movement quantity summary uses available width

Starting points: `components/ui/QuantitySummary.vue`, `.quantity-summary` in
`styles/foundation.css`, movement browse summary. Source review found grid column
definitions without a corresponding `display: grid` on this summary.

Use a responsive grid of compact type/quantity cards in the full summary width,
reflowing as text grows. Replace the long bare 各类型数量 disclosure with a useful
visible summary and, when necessary, a 查看数量明细 modal for extensive breakdowns.
Never add incompatible units together. Retain submitted/draft/cancelled distinctions
and complete-filtered-result scope.

Acceptance: ordinary desktop summaries use multiple readable columns; narrow or
large-text layouts reflow. Opening a breakdown does not stretch the results page.

### 8. Loading before empty, throughout the app

Confirmed starting defects: ReportTable's empty message checks only row length;
Attachments checks only file length; HierarchyFilter checks only option count.
Some browse controllers and DashboardSection already have useful result flags.
Audit every routed page and async child, including reference selectors, summaries,
details, attachments, reports, image placeholders and newly introduced modals.

Use explicit request/result state, not array length as proof of completion:

- Initial/request pending with no successful result: loading placeholder/status.
- Successful zero-result response for the current identity/query: empty state.
- Failed initial request: error and retry, never a misleading empty message.
- Refresh with prior result: retain content with updating/stale context; keep
  existing stale-action restrictions. Discard superseded/account-switched responses.
- Intentionally idle searches: explain how to start searching; do not spin forever.
- New local drafts may truthfully have no attachments without a remote request.

Acceptance: delayed success, empty success, initial failure, retry, refresh, query
changes and late responses produce truthful states. Suppress premature zero totals
and “not found” alongside empty messages. Do not reset all successful content to
skeletons on every refresh.

### 9. Friendly warehouse names everywhere

Starting points: `lib/filterPresentation.ts` currently combines raw ID and label;
movement rows render raw `branch.source/destination`; dashboard expiry and some
item/batch rows also expose raw identifiers. Reference data supplies `local_label`;
native warehouse services and report projections expose labels separately.

Use a shared display resolver or explicit server display fields backed by native
`warehouse_name`/authorized labels. Show readable parent paths when names collide.
Apply to flows, chips, options, summaries, detail rows, scanner results, reports
and ordinary human-readable export fields. Full names belong in explicitly labeled
ERPNext-name/audit-ID fields, including warehouse metadata and audit exports.

Never mutate keys, URLs, filters, QR payloads, request values or stored identities.
Do not strip arbitrary hyphenated suffixes with a global regex. Resolve labels even
for paginated/off-screen references; handle inaccessible labels truthfully without
inventing a warehouse or revealing unauthorized data.

Acceptance: names with company suffixes and legitimate internal hyphens render
correctly; duplicate local names remain distinguishable; filters/navigation still
use exact native identity.

### 10. Scanner modal, ZXing-WASM only

Starting points: `features/scanner/ScanPanel.vue`, `useScanController.ts`,
`components/Scanner.vue`, `lib/scanner.ts`. ZXing-WASM is currently default, but
the saved engine preference and UI switch can select the Frappe engine.

Replace the collapsible scanner section with a labeled modal trigger. Consolidate
camera, manual entry, matching results, continuous scanning and recent feedback
into one overlay. Use ZXing-WASM exclusively; retire the Frappe scanner path and
obsolete engine selection. Existing saved `frappe` preferences must not restore it.
Do not remove the broader frappe-ui dependency solely for this scanner change.

Preserve item/batch/location dispatch, unknown-code/create permissions, duplicate
scan handling and pauses for quantity/location completion. Hardware/manual input
must work without camera access. Reuse existing local WASM bundling and lifecycle.
If opened from another editor overlay, use a single active surface/stage and
restore the editor state instead of stacking independently active dialogs.

Acceptance: denial/retry/manual entry, repeated open/close, navigation, unmount,
pause/resume and breakpoint changes release or pause camera resources correctly;
no background scanning or Frappe-engine fallback occurs.

### 11. Compact searchable hierarchy geometry

Starting points: `components/ui/HierarchyFilter.vue`, shared hierarchy and filter
panel styles. Current depth adds 1.5rem per level, plus an arrow/spacer column.

Reduce per-level indentation (roughly 8–12px is a starting point), cap the visual
indent at deep levels and use subtle branch guides/path context. Reduce repeated
panel padding, gaps and leaf spacer waste while preserving independent expand and
select hit targets. Do not shrink the important name to accommodate decoration.

Acceptance: deep trees, long names, search results with ancestor context and
selected-count badges remain readable at phone widths and large text. Preserve
parent/descendant selection normalization, mixed state, keyboard access and search.

### 12. Replace bare content disclosures with consistent patterns

Audit all production `<details>/<summary>` and equivalent content toggles. Start
with ProductDetailView, ItemConversions, LoanDetailView, ExpiryBrowseView,
StockBrowseView, PendingView, ReportsView, ActivitiesView, Operation/Count editor
supplements, recovery-input sections and configuration details.

Choose by purpose:

| Content | Presentation |
| --- | --- |
| Dense table-row detail, batch allocation, quick related-record inspection | Labeled action opening the shared detail modal |
| Item/loan metadata, images, conversions, notes, attachments where space allows | Styled section/accordion header with title, count/summary, chevron, clear hover/focus and generous content width |
| Analysis of current results | 分析结果 action opening a wide view with grouping controls and paginated tables; preserve scope and complete counts |
| Small contextual help | Lightweight accessible disclosure when appropriate |
| New movement / more actions | Explicit action buttons or compact action menu, not an unstyled content dropdown |

Native details semantics may remain behind styled accordions; do not replace
accessible disclosure behavior solely to avoid the HTML element. Preserve dirty
conversion edits, recovery Copy actions, validation revealing the correct section,
attachment controls and complete final-confirmation information. Ordinary select
inputs for choosing values are not the content-disclosure problem.

Acceptance: record an audit disposition for every affected location; no hidden
capabilities disappear, and shared styles replace ad hoc disclosure treatments.

### 13. Dashboard expiry tabs control only their adjacent list

Starting points: `features/dashboard/DashboardView.vue`, `DashboardSection.vue`,
`.browse-tabs`. Current tabs are in the controls slot above cards; only the list
changes. Buttons use `aria-pressed` while active CSS targets `aria-current`.

Keep summary cards above the list controls. Put the expired/upcoming tabs directly
above their associated list, with a clearly differentiated selected style and
consistent accessible tab/panel behavior. Keep card drill-through scope separate.

Acceptance: switching tabs updates the list and its empty/loading message without
implying the cards are filtered. Keyboard selection, active styling and card links
work consistently with other shared tab consumers.

### 14. Remove the design-preview site safely

Remove the runnable gallery, its entry HTML/main/wrappers, dedicated Vite and
Playwright configuration, scripts and gallery-only tests. Inspect package scripts,
test imports, TS/build globs, development documentation and stale runtime fallbacks
(including Overlay's `design-preview` root lookup).

Several production tests currently import `src/design-preview` fixtures. Move
genuinely useful fixtures into test support and update consumers before deleting
their source. Preserve meaningful production regression coverage; port necessary
gallery-only assertions to production components/routes rather than blindly
deleting them. Do not create a replacement preview application.

Legacy `preview-*` CSS names are widely used by production. Keep shared styles,
components and contracts; naming alone is not evidence of dead code. Avoid a broad
cosmetic rename. Keep historical screenshots, review records and commits as evidence.
Update current docs so agents no longer follow gallery build/maintenance instructions.
Historical comparison reference is `63c7f26` on `version-16`; inspect that commit
separately if needed, without switching/reverting the working implementation.

Acceptance: production build/router work, retained tests resolve their fixtures,
there is no runnable preview entry or design:* script, and current guidance points
to production plus historical references. Historical mentions may remain labeled
as history. No gallery build is required after retirement.

### 15. Audit text squeezing and establish a shared fix

The user requests an app-wide investigation and a reusable solution. Audit every
route family and shared layout, particularly table identity/status/action cells,
warehouse trees, chips, dashboard ranks, attachment names, item/loan headers,
selectors, form allocations, confirmation summaries and modal headers.

Apply the shared solution to confirmed cases: readable text-column minima, action
groups that wrap below names, bounded tree indentation, nonshrinking icons and
container-aware reflow. Dense tables keep sensible column minima and scroll
inside their own container; do not force a full table into a phone-width grid.
Allow long native identifiers to wrap without making ordinary Chinese labels
single-character vertical strips. `min-width: 0`, `overflow-wrap: anywhere`,
ellipsis or `white-space: nowrap` alone is not an app-wide solution.

Acceptance: document audited routes/components, confirmed fixes and any remaining
exceptions. Inspect long realistic Chinese names/IDs, 320–390px mobile, desktop,
all density presets and enlarged text up to 200%. Include native zoom where
available and identify it separately from the app text-size setting. Do not claim
exhaustive visual proof from a source-only search.

### 16. Related-loan preview and navigation

Starting points: `OperationBrowseView.vue` renders one raw-ID button per
`row.whole.original_loans`; reuse `features/loans/useLoanDetail.ts` and native
loan services for authorized detail loading.

One link: **查看关联借出** opens a read-only modal. Multiple links: **关联借出（N）**
opens a chooser with borrower, date, readable item/context summary and secondary
native ID. Selecting a loan replaces the chooser body with its preview; a back
control returns to the chooser. Do not stack another modal. Show meaningful loading,
unavailable and error states without leaking unreadable documents.

Preview includes original loan context and useful quantities/current settlement
state, preserving the distinction from the selected return/loss transaction.
**打开完整记录** closes the overlay and navigates through normal router/leave guards;
returns, edits and other actions occur on the full page. Keep existing direct
loan URLs and browser history. Back navigation should restore source filters,
sorting and scroll; modal inspection itself must not replace the movement page.

Acceptance: single/multiple/partly unavailable links, keyboard navigation, close,
chooser back, full-record navigation and source-context restoration all work.

## Suggested execution order

1. Inventory shared consumers and preserve required preview fixtures/coverage.
2. Establish async-result, display-label, modal, tab, thumbnail and readable-layout
   patterns. Preserve working request/controller behavior rather than rewriting it.
3. Implement compact toolbar/breadcrumbs, hierarchy/icon fixes, quantity and
   disclosure presentations; apply across all audited consumers.
4. Implement scanner, image crop/upload choices and related-loan preview lifecycle.
5. Retire the preview entry/tooling, finish current documentation, then verify the
   production application. Dependencies may justify a different order.

## Verification and delivery

No tests, builds or browser automation were run while preparing this handoff.
The earlier “do not run automated tests” instruction concerned rechecking the
already-tested migration pass. Do not rerun old migration suites merely to
recertify that pass. For new implementation, follow the current repository's
proportionate validation policy and any newer user instruction.

- Add focused behavioral regression coverage for loading transitions, crop/file
  retention, camera cleanup, modal/context restoration and hierarchy selection.
  Simple wording/spacing edits do not need implementation-mirroring tests.
- Run relevant frontend tests and `pnpm type-check`; preview retirement changes
  bundling, so run the production `pnpm build`. Format touched source only.
- Exercise routed production surfaces at representative phone and desktop widths,
  including real rendered Chinese text, keyboard/focus, long content, text scale,
  scroll and empty/error/loading states. Clearly distinguish mocked HTTP checks
  from real-service observations and camera simulation from a real device.
- Run targeted backend permission/private-file tests if native file handling or
  display projection APIs change. Preserve ERPNext/Frappe authorization boundaries.
- Do not edit generated production files by hand or reset/reseed the database.

Deliver an implementation record mapping **1–16** to changes, actual verification
and any unresolved limitation. Include representative visual evidence for collapsed
toolbar height, stable table/modal layout, square thumbnails/crop choices, compact
trees, quantity grids and dashboard tabs. Check links in new/current docs and keep
archived notes under `notes/done/` as history. Completion requires addressing the
full requested scope; a passing build alone is not acceptance of the UI behavior.
