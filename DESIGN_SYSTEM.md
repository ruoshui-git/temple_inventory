# Temple Inventory Design System

This documents the production token and shared-component contract. Durable user
interaction and responsive decisions live in [UI_UX_DECISIONS.md](UI_UX_DECISIONS.md).
The standalone gallery at `frontend/design-preview.html` currently preserves
its own visual reference and is not proof of production visual fidelity.
Production migration remains paused pending manual comparison with that
reference; preview fixtures and preview-only preferences are not production
data or app settings.

## Production entry points

- `frontend/src/styles/tokens.css` defines the single `--ti-*` token contract.
- `frontend/src/styles/primitives.css` provides shared controls and base
  surfaces; feature pages should reuse these and shared Vue components.
- `frontend/src/main.ts` imports `styles/tokens.css` before the shared global
  stylesheet and app mount, so routed views receive tokens before rendering.
- `frontend/src/lib/uiPreferences.ts` hydrates the current account's density,
  applies `data-ti-density` to the document root, and serializes preference
  saves. `frontend/src/pages/Settings.vue` presents that preference.
- `frontend/src/components/` owns shared controls and interaction patterns.
  Reuse `UiButton`, `IconButton`, `InventoryIcon`, `HierarchyFilter`,
  `QuantitySummary`, `AsyncImage`, and the existing overlay/menu components
  where applicable before adding page-local styling.
- `frontend/src/loading.css` owns application loading and skeleton presentation.

## Standalone preview reference

`frontend/src/design-preview/preview.css` and its local `components/Preview*.vue`
adapters own the restored reference presentation from commit `7b91ff5`. The
preview intentionally does not import production tokens or styled production
components. It may share unstyled icons and headless utilities. Reconnect it to
production styling only after manual fidelity review approves the comparison;
until then, treat the preview's copied controls and page mockups as isolated
reference material.

## Token contract

| Purpose             | Tokens                                                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation colors   | `--ti-canvas`, `--ti-surface`, `--ti-surface-raised`, `--ti-ink`, `--ti-muted`, `--ti-border`, `--ti-border-strong`, `--ti-accent`, `--ti-accent-strong`, `--ti-accent-soft` |
| Status colors       | `--ti-success`, `--ti-success-bg`, `--ti-warning`, `--ti-warning-bg`, `--ti-danger`, `--ti-danger-bg`, `--ti-info`, `--ti-info-bg`                                           |
| Movement categories | `--ti-movement-{receive,issue,transfer,loan,return,opening,damage,reconcile}` and matching `-bg` tokens                                                                      |
| Text and feedback   | `--ti-font-family`, `--ti-font-{body,small,heading,section}`, `--ti-line-height`, `--ti-focus-ring`, `--ti-overlay-scrim`, `--ti-skeleton`                                   |
| Density             | `--ti-density-control`, `--ti-density-control-pad-{x,y}`, `--ti-density-row-gap`, `--ti-density-page`, `--ti-density-gap`                                                    |
| Fixed spacing       | `--ti-space-{1,2,3,4,5,6,7,8}` (4px through 32px)                                                                                                                            |
| Shape and elevation | `--ti-radius-small`, `--ti-radius-control`, `--ti-radius-card`, `--ti-radius-pill`, `--ti-shadow-card`, `--ti-shadow-overlay`                                                |
| Motion and layers   | `--ti-motion-{fast,standard,loading}`, `--ti-layer-{nav,menu,context,backdrop,overlay,popover,auth,toast}`                                                                   |

The three visual directions in the review were resolved to quiet jade:
`#F4F6F3` canvas, `#24332D` ink, and `#28684E` accent. Density is
account-specific and server-authoritative. Balanced is the default. Compact,
balanced, and spacious adjust type and layout values; mobile text inputs remain
at least 16px and touch controls at least 44px in every density. Responsive
surfaces share the 1024px breakpoint. Reduced-motion preferences set token
durations to zero.

Small fixed sizes remain appropriate for icon glyphs, indicators, and compact
navigation chrome when their containing touch target still meets its minimum.
When adding or changing a shared token, update its consumers and gallery
examples; add a token test when the contract changes. Record only durable user
experience decisions in `UI_UX_DECISIONS.md`.

Movement tokens express record category and remain separate from lifecycle
status tokens. A badge should use the matching category foreground and `-bg`
pair; its border can be derived with
`color-mix(in srgb, var(--ti-movement-receive) 20%, var(--ti-surface))`.

## Reuse and migration

Use the closest semantic token instead of adding a color, spacing, radius, or
shadow literal. Add a new token only when the meaning is reusable across
surfaces. Keep component interaction and accessibility behavior with the shared
component; a token supplies visual values and does not replace that behavior.
Current routed workflows keep their existing behavior during the visual
migration. Check this reference and the preview gallery before introducing a
new shared style, then update the gallery when a shared component gains a
meaningful variant.

## Routed feature migration audit

The following routes use the production foundation and shared component styles.
The feature visual pass was validated by focused automated tests and typecheck;
manual visual review at the viewport sizes below remains outstanding.

| Route or area                   | Production source                                                                                       | Foundation and status                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Dashboard                       | `features/dashboard/`, `/`                                                                              | Tokenized dashboard cards and shared shell; current route behavior retained           |
| Inventory and expiry            | `features/inventory/`, `features/expiry/`, `/stock`, `/expiry`                                          | Tokenized browse surfaces, density-aware controls, responsive desktop/mobile views    |
| Movement overview and ledger    | `features/movement-overview/`, `features/movements/`, `/movements/*`                                    | Shared movement category and status semantics; existing filters and ledger retained   |
| Loans and loan detail           | `features/loans/`, `features/loan-detail/`, `/loans/*`                                                  | Shared detail, status, action, and loading components                                 |
| Pending and drafts              | `features/pending/`, `features/history/`, `/pending`, `/drafts`                                         | Shared operation, status, and table styles                                            |
| Workspace and reconciliation    | `features/workspace/`, `features/reconciliation/`, `/new/*`, `/workspace/*`, `/entry/*`, `/reconcile/*` | Shared controls and operation components; workflow behavior/form structure retained   |
| Items and item creation         | `features/items/`, `pages/NewItem.vue`, `/item/:code`, `/items/new`                                     | Shared typography, muted text, form controls, attachments, and image components       |
| Warehouses and warehouse detail | `features/warehouses/`, `features/warehouse-detail/`, `/warehouses/*`                                   | Semantic feedback, surfaces, borders, typography, and density                         |
| Reports                         | `features/reports/`, `/reports`                                                                         | Shared cards, selection, form, and action styles with tokenized surfaces and feedback |
| Shell, More, and preferences    | `features/shell/`, `pages/More.vue`, `pages/Settings.vue`                                               | Six main destinations remain; density preferences are grouped under More              |
| Shared interaction components   | `components/`, `styles/primitives.css`, `loading.css`                                                   | Shared filters, scanner, attachments, overlays, menus, loading, and control states    |
| Startup and authentication      | `main.ts`, `lib/uiPreferences.ts`, `lib/api.ts`                                                         | Session preference hydration precedes mount and recovers on authentication refresh    |

Feature controllers and workflow state remain with their feature directories.
Local scoped styles that remain are for specific geometry or sample/page
layout; shared palette, typography, and common control treatment comes from the
token foundation and shared components. Item creation retains its standalone
routed-page structure.

## Deliberate geometry exceptions

Tokens govern repeated visual meaning and spacing. Fixed dimensions remain for
measured responsive shell geometry, scroll and overlay bounds, icon/swatch
artwork, readable page-width limits, and operation row touch targets. Examples
include the 1024px shared breakpoint, warehouse result-row minimum heights,
dialog width caps, inventory illustration dimensions, and navigation icon
boxes. Density changes surrounding type, padding, and gaps without changing
these layout contracts. Do not replace a geometry value with a nearby spacing
token when that would change its measured behavior.

When changing the production foundation, update the production token, every owned
consumer, this audit/reference and focused contract tests. Preserve the isolated
preview as the visual authority; changes to it require an intentional reference
revision, not automatic synchronization from production. Add a `UI_UX_DECISIONS.md` entry only when user-visible behavior
or an accessibility/responsive rule changes.

## Page mockup review gate (2026-10-12)

The standalone reference is the visual authority. Its complete page/state index
uses preview-only `#review/` links; the production route audit above describes
existing tokenization, not accepted visual fidelity. Review notes and the route
coverage matrix are in [the preview README](frontend/src/design-preview/README.md).
Approval of jade does not approve new creation, detail, report, or navigation
workflows. This round changes preview files and documentation only. Keep the
current production migration, backend, and account preferences unchanged until
page designs and fidelity are explicitly accepted.

## Preview navigation proposal (2026-10-12)

The standalone preview now explores five main destinations while production
retains six. `navigation.ts` within the preview owns the shell and More links,
route ownership, and Inventory sections. Movement and Loans distinguish their
view switch from type/status filters; More no longer repeats shell subnavigation.
Shared preview draft projections keep contextual lists and the all-drafts hub
consistent without introducing a stock engine or production API changes.

The hierarchy adapter now owns its missing list/row/scroll geometry using
`--p-*` tokens. Composite searches put the focus ring around their outer field.
The hierarchy's 290px scroll cap is retained from the existing control; type-tab
rows scroll horizontally with a 44px minimum target. These are intentional
preview geometry revisions, subject to the density and viewport review matrix
in the preview README. They do not reconnect preview styling to production.

## Preview refinement (2026-10-12)

The reference now includes a shared `PreviewActivityBrowse` surface for Movement
and Loans, typed scope/projection helpers, `PreviewPeriodFilter`, and
`PreviewBrowseFilters`. Date controls use a pending value until Apply; hierarchy
filters apply immediately. Quick type shortcuts and combined checkbox filters
share one type-array state. `PreviewDashboard` covers all six production sections
using the same fixtures and unit-aware quantities. `PreviewItemImage` declares
its detail versus lightbox interaction explicitly. These remain preview-local
components; no production API, styling, persistence or inventory engine changes.

New deliberate geometry: a 250px bounded desktop filter rail, a 400px anchored
date panel (viewport-clamped), an 85dvh mobile date sheet, and independent dashboard
columns above the 1024px surface breakpoint when content is at least 760px wide.
The 44px target minimum applies in every density. Sidebar chevron placement is
explicit instead of relying on the last SVG child. Reports is the fifth primary
entry; Tools is secondary. Documented interaction supersessions are recorded in
`UI_UX_DECISIONS.md` and require manual preview review before production adoption.

## Preview form and browse completion (2026-10-12)

The preview uses `PreviewFilterButton` for consistent filter icons/counts and
`PreviewItemGroup` for aligned thumbnail, title, metrics and independent disclosure.
`PreviewOperationLines` is shared by routed forms and the canonical receiving
example. It keeps operation-specific required fields visible, groups receiving
batch allocations beneath each location/item and derives totals from allocations.
`PreviewItemPicker` switches between selection and contextual item creation;
`PreviewUnitField` creates units inline with their integer-only setting.
`formModel.ts` validates fixture availability, aggregate allocations and settlement
balances without modifying stock quantities or calling production APIs.

Item and warehouse details retain their Inventory sidebar ownership; Movement
and Loans own their record details. Origin Back preserves scope, view, selection
and scroll, including local review hashes. Item identity/unit/tracking are read-only
on edit; names, category, barcode, description and simulated image attachments
remain editable. Export dataset selection is independent of CSV/XLSX format.

Deliberate geometry: group thumbnails and disclosure rows use a 56px footprint;
enlargement controls remain 44px. Required form fields use two columns on desktop
and one below 1024px in every density. Long titles and metrics may wrap instead
of overflowing. Expiry uses desktop tables and mobile batch rows. All styling
remains preview-owned. These additions require the existing manual viewport,
density, keyboard and zoom review before production adoption.

Independent review corrections keep group-level replacement consistent across
allocations and add form thumbnails, explicit outbound batch allocation, optional
manufacturing dates and alternate-unit entry. Quantities remain normalized to the
stock unit for availability checks, summaries and exports. Item metadata editing
has cancel/discard and primary-image ordering; stock confirmation remains separate.
The detail preview-state control demonstrates loading, empty, retry and unavailable
states without mutating fixture records. It is review chrome, not a production flow.

## Migration decisions and capability coverage

See [migration ledger](DESIGN_MIGRATION_COVERAGE.md) for ERPNext-native identity, one-document
transactions, searchable controls, and explicit backend prerequisites. Rapid
development favors clean DB/API/UI over legacy compatibility; database resets
are acceptable in migration, not performed by the standalone preview.

## ERPNext-native preview completion (2026-10-13)

`PreviewSearchSelect` supplies full local search, keyboard selection, paginated
options and loading/error/retry examples. `PreviewCategoryField` and the unit and
activity editors create supporting data inline. `PreviewCountWorkspace` replaces
the generic reconciliation line editor; `PreviewDocumentState` demonstrates
ERPNext identity, version conflicts and lifecycle using saved fixture snapshots.
`PreviewAttachments` retains local file content in memory and supplies the primary
image to `PreviewItemImage`. These are preview-owned state and presentation only.

Inventory/Movement/Loans analyse all filtered results independently of displayed
pages, with separate units and type/outcome/status context. New deliberate geometry:
320px selector menu scroll cap, viewport-clamped 280px preferred menu width, 44px
option targets, 56px attachment thumbnails and wrapping count rows. All densities
retain the shared 1024px responsive boundary. Manual width/density/keyboard/zoom
review remains required; automated checks do not approve visual fidelity.

## Preview browser-audit geometry repairs (2026-10-13)

Existing contracts were repaired within preview-owned styling. Report grid children
are shrinkable; the 650px table minimum stays inside the horizontal scrollport.
At <=620px, item artwork precedes a full-width identity row. Mobile form summaries
use measured navigation/summary geometry with an 8px gap, a 220px/40dvh height cap,
and focus visibility handling. Inventory secondary tools use a 45dvh bounded
popover after compaction; its context tabs are supplied once by the shell.
Return-to-top remains a circular 44px control above navigation/creation actions.
`scroll.ts` and `focusVisibility.ts` release listeners/observers on deactivation.

Count projections and confirmation labels are shared through `PreviewCountSummary`;
stock snapshots and production tokens/components/APIs remain unchanged. Browser
results and limitations are recorded in the [audit-fix progress note](notes/done/20261013_DESIGN_PREVIEW_AUDIT_FIXES_PROGRESS.md).


## Preview usability geometry and typography — 2026-10-13

Preview typography multiplies the existing density baselines by `--p-text-scale`
(1–2 in 0.25 steps). `--p-body`, `--p-small`, `--p-heading` and `--p-section`, plus
preview-local size declarations, scale without transforms or CSS zoom. Density
spacing and the 1024px breakpoint remain independent. Root typography also
reaches teleported overlays, menus and toasts. Navigation and form obstructions
are measured again after size changes; controls wrap and grow with their text.

Contextual Receive creation opts into `preview-adaptive-creation` on the existing
single focus-trapping overlay: maximum 880px width with 24px desktop outer margins,
full screen below 1024px, wrapping footer and a scrollable body. Existing dialogs
retain their presentation. Picker rows reserve a separate 48px image column;
stock details wrap below identity. Movement items use restrained bordered rows
with fully mounted batch allocations; thumbnails stay 48px, enlargement targets
44px. Required fields and active conversion fields stay visible. These fixed
image/icon footprints express geometry rather than typography.

Dashboard headings/recovery/local filters remain prominent while retained result
text and graphics use readable muted tokens. Cards change border/shadow without
movement; only actions receive pointer/pressed treatment. Reduced motion applies.
The 50-item receiving samples exercise the shared editor rather than the dense
row gallery. All changes are preview-owned; production migration and manual
visual review remain pending.


Independent usability review adds a 680px editor-container reflow threshold within the unchanged 1024px responsive surface boundary. Mobile floating actions, toasts and return-to-top use measured navigation height. Header tags wrap with text scaling. Dialog tab containment excludes hidden/inert controls and includes visible disclosure summaries. These repair the preview contracts; browser geometry remains subject to the handoff manual checklist.

## Preview usability follow-up geometry — 2026-10-13

`PreviewOperationLines` uses explicit identity, heading-actions, allocation-actions
and group-actions regions. One full-width item heading precedes the allocation
field grid; no allocation/action reserves a second item-row column. The reserved
thumbnail stays 48px and enlargement stays touchable. Fields use a preferred
minimum of `max(160px, 10em)` capped by available width; typography determines
reflow rather than fixed row heights. Summary width is 240–280px; below 1000px
available form width it follows the editor. Scaled-text summaries also reflow.

`preview-field`, `preview-inline-field` and `preview-choice-label` define stacked,
inline and choice patterns. Native and searchable controls share label gaps,
control line height and density/text-aware sizing. Form action cells align with
controls instead of stretching across label height. `PreviewAllocationSummary`
is shared by the bounded detail disclosure and full confirmation.

Creation has at most two columns. Its body uses an available-width container
query; category/unit editors optionally render into an in-form full-width host,
preserving their inputs and the existing single overlay. Field consumers across
forms, filters, reports, settings, setup and gallery use these preview patterns.
These are preview geometry repairs, with validation recorded in the linked
[progress note](notes/20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md).

Independent follow-up review (2026-10-14): required markers are grouped with label
text so they cannot create an extra field-grid row. Supporting creation surfaces
manage opening/return focus and report dirty input to the containing picker.
`PreviewAllocationSummary` now also supplies canonical Receive confirmation.
The review record documents focused browser verification and remaining manual checks.

## Preview compact allocation and selector geometry — 2026-10-14

Compact rows align identity/artwork, quantity/unit, locations, batch/status context
and Details/removal. The outer operation section supplies an available-width
container; below 52em allocation columns stack with readable labels. Scaled text
therefore reflows naturally without changing the 1024px surface boundary. Numeric
fields prefer 7ch plus padding; 48px artwork and 44px mobile targets are deliberate
fixed geometry. Rows have no fixed height. Split/replacement actions live in
Details to keep ordinary rows compact. Expanded layout uses a flex editor to
retain Chromium rendering after sibling form sections hide; allocations never
unmount across that toggle.

Details reuses `PreviewOverlay` focus/inert/scroll management. A staged conversion
editor shares the panel, rather than stacking a modal. Warehouse disclosures own
independent open state, and complete confirmation uses the same allocation
projection without collapse. One responsive form action area remains.

`PreviewVirtualList` measures row heights with ResizeObserver, keeps overscan and
focused options mounted, scrolls keyboard targets into view and releases detached
observations. It activates above 100 flat matches; editable allocations and
hierarchy trees remain fully mounted. The 480px/55dvh scrollport and 48px picker
thumbnail slot are fixed geometry exceptions. Picker selection lives outside the
rendered window, and location/batch details share the picker surface. Artwork no
longer has a conflicting 72×60 rule. Large opt-in fixtures include image, broken,
loading, missing and illustration states. See the execution note for browser
results and remaining native-zoom/user-approval checks.


Independent simplification review: numeric fields remain `7ch` plus padding;
column tracks use the same body-size basis for headings and rows, even when the
headings use smaller type. Wide rows visually hide repeated field labels without
removing accessible names. Expanded sections align content at the start. On
mobile only the action area is fixed, with measured navigation clearance and
bounded overflow; the warehouse summary remains in document flow. Notifications
stay clear of these actions. Virtual lists retain the last focused row during
pointer transfer/detail return and ignore hidden zero-size resize measurements.
Reusable Item conversions use the shared guarded overlay and focus restoration.


## Activities, reports and information display — 2026-10-15

Preview-local `PreviewActivityEditor`, `PreviewDocumentDisplay`,
`PreviewTransactionContext`, `PreviewReportTable` and `PreviewQuickReport` share
`--p-*` styling. Immutable fields use definition lists; completion/cancellation
switches presentation, while temporary save/conflict states retain input buffers.
Text remains selectable and wraps anywhere; booleans have explicit labels, empty
values use neutral text and long plain-text notes preserve paragraphs in an
independent native disclosure. Attachments retain preview/download actions.

Activities use adaptive desktop rows/mobile cards and complete lifetime document
count chips. Reports keeps one dataset/view/filter workspace with secondary
controls in disclosures. Quick reports retain a download icon and Chinese label
at every width, wrap within toolbars and share one focus-managed overlay.

Intentional geometry: information grids prefer 220px columns bounded to 100% of
the container; activity notes have a 60dvh internal scroll limit. Report sample
tables retain a 650px minimum inside their own horizontal scrollport, 120px column
minimum and 360px preferred cell maximum. Browse samples show 30 rows, quick
report samples five; complete projected counts are independent of these limits.
These are presentation bounds, not export truncation. Adaptive editor grids use
two columns and switch to one below the shared 1024px breakpoint. Text scale and
density remain independent; no production tokens or generated assets change.

Actual screenshot inspections and viewport/density/text coverage are recorded in
the [dated execution note](notes/20261015_DESIGN_ACTIVITIES_REPORTS_PROGRESS.md).
Native browser zoom and final user visual approval are separate evidence.

Final audit geometry: browse headings retain a readable 180px preferred title
track and wrap their action group. Draft tables scroll internally with a 760px
minimum, 220px identity, 160px activity and 180px action column minima; ordinary
columns retain at least 96px. This prevents single-character identifiers and
action-induced tall rows on narrow phones. Static account/stock surfaces do not
receive a button cursor or hover border.

Activity movement-total columns use a 13em preferred minimum (clamped to their
container), so 200% text reduces the column count while keeping units readable.

## Independent activities/report review — 2026-10-16

Report tables show both displayed and total row counts. Full-report supplementary
tables use the shared Load more control after 30 rows; bounded Quick Report
previews explicitly show at most five. Horizontal scrolling stays inside each
table, while page controls wrap. Activity/report date controls stay in normal
document flow on mobile to avoid covering adjacent filters. Activity tab buttons
use a single keyboard tab stop, arrow/Home/End navigation and labeled panels.


## Compact preview filter geometry — 2026-10-16

`PreviewFilterPanel` and `PreviewCompactFilters` are preview-local `--p-*`
components shared by Reports, Drafts, Dashboard scope and Activities secondary
filters. Desktop dialogs teleport to body with fixed positioning, preferred
400px width, 12px viewport gutters, 8px anchor gap and internal overflow. Placement
updates after first mount, panel resizing, viewport resize and ancestor scroll;
unchanged measurements do not write geometry again. Header/footer remain outside
the scrolling body, with 30/35dvh overflow caps for short or large-text viewports.
Searchable menus use in-flow positioning only inside these panels so their
options share the dialog's scrolling/focus boundary and cannot be clipped.

Mobile uses the existing focus-managed overlay as a full-width/full-height sheet,
with safe-area padding, an internal scrolling body and visible Clear/Done/count
footer. The overlay sits above bottom navigation. Only one responsive filter
surface mounts at the shared 1024px boundary; applied state lives outside it.
Toolbar controls and removable chips retain 44px targets in every density;
spacing follows preview density and typography follows independent text scale.
No motion is added. Trees retain normalized parent/child selection. Existing
Inventory/Expiry/Movement/Loans rails and production styling are unchanged.

The browser review corrected first-open keyboard focus and the specificity of
panel-local 44px target rules, including hierarchy expansion buttons/spacers.
Existing browse-tree rules no longer shrink compact-panel targets to 32px.
These are intentional geometry exceptions, not final user visual approval.
Browser results and native-zoom/device limitations are recorded in the
[review note](notes/20261016_DESIGN_PREVIEW_COMPACT_FILTERS_REVIEW.md).
