# Temple Inventory Design System

## Browse repair patterns — 2026-10-20

The persistent browse search uses one semantic surface for chips, typing,
scanner and filter actions, with a focus-within ring. Desktop filter dialogs
may widen to a two-column, labeled filter/group layout; phone filter sheets
stack the same labeled sections. Keep the input mounted across compact changes
and preserve semantic tokens and phone touch geometry.

`DataTable` keeps column settings in the trailing header cell, including during
loading and empty results. Group rows remain in the same table and align their
content to visible columns. The complete disclosure row supports click and
keyboard activation, while links and form controls retain their own actions.
Browse pages show the result count before an optional full quantity analysis.
Keep all unit/status quantities in that disclosed analysis.

## Shared browse density and table geometry — 2026-10-20 supersession

Desktop compact, balanced and spacious density use 32px, 36px and 44px shared
control heights, 8px, 12px and 16px control gaps, and table-cell padding of
5px/8px, 12px/12px and 18px/16px (block/inline). Table thumbnails use 32px,
48px and 64px. Density controls geometry and spacing; the 14px body type and
1.6 line-height scale independently with the user's text-size setting. Narrow
phone controls retain 44px touch targets. This supersedes prior density-specific
font and line-height changes.

## 2026-10-20 semantic theme token supersession

Jade, bronze and blue palettes now live in the shared `foundation.css` root
token sets, selected through `data-ti-theme`. Runtime preference application
sets the theme selector and text scale; component and page styles consume
semantic palette, shadow and scrim tokens. Product artwork, camera/image content
and theme preview swatches retain intentional colors. This supersedes fixed
presentation colors in shared surfaces; visual acceptance remains a separate
review gate.

The routed production application is the visual review surface. The separate
preview entry, gallery controls and dedicated build/browser configuration are
retired. Historical reference: commit `63c7f26` on `version-16`. Test-only service
fixtures and mount hosts live in `frontend/tests/support`; production imports none
of them. Do not create a replacement preview application.

Durable interaction decisions live in [UI_UX_DECISIONS.md](UI_UX_DECISIONS.md).
The [refinement record](notes/20261017_UI_REFINEMENT_IMPLEMENTATION.md) maps the
16 requirements to implementation, checks, visual evidence and limitations.

## Browse navigation and route foundation — 2026-10-20 supersession

`lib/routeRegistry.ts` is the source for stable route names, canonical paths,
navigation ownership, page capabilities and breadcrumb context. Routed callers
use named destinations. `ApplicationShell` reads ownership and breadcrumb
definitions from route metadata; authorized page data may refine a displayed
name. The desktop shell has six primary destinations and an accessible Inventory
dropdown. The former desktop sidebar geometry is retired; mobile keeps its
horizontal six-destination bar and contextual Inventory links. More is a menu
arrangement, never a breadcrumb ancestor.

Movement and Loan browse mode is carried by top-level `view=items|records`.
Central route serialization omits duplicate dataset/view fields from those
browse payloads and reconstructs them from route context. Other filters and
drill-through identities remain query state. Retired paths do not alias into
canonical routes; unknown paths render a deliberate not-found state. Native
Stock Entry and Stock Reconciliation links resolve to Movement and Count routes
respectively; unsupported DocTypes are rejected.

Shared browse search remains visible in compact mode. Hierarchy restrictions use
the optional synchronized category/warehouse sidebar and remain represented by
active chips in the same toolbar as ordered group chips. The sidebar contains
category and warehouse trees only, below the measured shared browse header.
Sidebar visibility is saved in the user's Frappe defaults, with a local
site/account/page-view presentation cache;
it never owns or clears filter values. The viewport-bounded Filters form remains
the shared editor on desktop and a sheet on phones. Date ranges stage until Apply,
use inclusive site-date bounds, and support editable calendar-year and quarter
shortcuts. Compact chips summarize active fields while the shared editor keeps
each selected value removable. Supported browse views expose zero to two ordered
grouping fields from the active view's sequence contract. Inventory location,
history and Expiry include Category, Item and Location at either grouping level.
Movement summary and Loan Item allow no grouping, Item, or Category → Item;
removing Category from that pair retains Item, while removing Item clears the
unsupported Category-only remainder. Search stays mounted through
compact/expanded transitions, including IME composition and debounced updates.
Tables share flattened columns, ordered
grouping up to two levels, column settings and density tokens. These rules
supersede page-local search dialogs, all-filter rails, and earlier remove-all-
sidebar proposals.

## Production foundation

- `frontend/src/styles/app.css` is the sole stylesheet entry, importing
  `foundation.css`, `forms.css`, `utilities.css`, `browse.css` and
  `data-table.css`.
- Shared `--p-*` semantic tokens own palette, typography, spacing, density,
  status, shape and layers. Jade/blue/bronze, compact/balanced/spacious and
  100–200% text settings apply at the root, including teleported content.
- `components/AppFrame.vue` owns top navigation and measured mobile obstruction;
  `ApplicationShell.vue` supplies route/account context and a linked breadcrumb
  trail from the route registry. The shared responsive boundary is 1024px.
- `components/ui` contains reusable controls, overlays, filters and tables.
  `components` contains stock, file, scanner and export surfaces. Controllers
  in `features` own requests, native identity, permissions and persistent state.
- Keep the existing `preview-*` shared CSS names. They are production contracts.

## Refinement patterns — 2026-10-17

Browse return-to-top is a fixed 44px mobile control and appears after 160px of
the active scroll surface. It scrolls that owner to zero and focuses the routed
page heading. On mobile it clears the measured navigation and action areas. Item
image enlargement uses a 16px badge with a centered 12px SVG and 2px inset; the
whole image remains the lightbox target.

`PageHeader` owns routed title/Back/action geometry. Desktop actions align right in
utility/workflow order; mobile labels wrap below the title. `BrowseToolbar` owns the
single Inventory/Expiry/Movement/Loans/Pending disclosure with a persistent heading
and trailing toggle. It compacts once after 160px, honors subsequent manual choices,
and reveals bounded sticky controls in place. Search and filters remain available
without expansion; analysis belongs to the expanded result toolbar. Stock selection
actions occupy a separate persistent strip outside the collapsible controls.

The 2026-10-18 desktop hierarchy geometry supersedes the historical 44px desktop
panel-row rule: 28px parent/leaf expander tracks, 16px checkbox, 4px gaps, 32px minimum
rows. Mobile rows/expanders retain 44px targets. Wrapped labels grow naturally; the
10px depth indentation remains capped at 40px. Shared browse.css owns this geometry.

`Overlay` owns one focus-contained surface, background inertness, Escape,
scroll locking and focus return. Descendant overlays become internal stages of
that surface, preserving the underlying editor without active stacked dialogs.
Wide inspection uses `adaptiveCreation`: bounded desktop width and a full mobile
sheet. Scrollbar compensation preserves page width. Modal inspection does not
change the route; full-record actions use normal router guards.

`AsyncImage` reserves square thumbnail space with contain fitting. Item cards,
pickers, table identities and attachments share this geometry. Full-image
viewers opt into natural proportions. `ImageCrop` processes images before File
finalization, with square preview, zoom, horizontal/vertical position, explicit
original-only and optional retained-original choices. Its 800px canvas and
56px attachment thumbnails are deliberate geometry bounds.

`ReportTable` separates loading, initial error, successful empty and retained
refresh. Async callers supply their successful-result flag. Dense tables keep
readable columns in an internal horizontal scrollport. Allocation and batch
inspection opens out of flow. In-place metadata/recovery uses styled semantic
accordions; analysis uses wide modals. `QuantitySummary` uses a full-width grid
with text-relative minimum tracks and separate units/statuses.

Hierarchy indentation is 10px per level, capped at 40px, with path context and
independent 44px expansion targets. Warehouse arrows and leaf icons share
centered geometry. Names receive readable tracks; actions wrap beneath identity,
icons do not shrink, and tables scroll inside their container. Density never
reduces mobile touch targets or the shared breakpoint.

Warehouse display resolves authorized names and parent paths for collisions;
keys, route values and native audit identities are preserved. Report exports
include readable labels and explicitly labeled ERPNext identity/status columns.
Submitted status reads 已提交; settlement states remain separate.

Dashboard expiry tabs sit between the summary cards and their adjacent list.
Expiry quick tabs sit in the expanded browse toolbar above search; the result
count and quantities share the standard normal-flow summary card. Both expose
Arrow/Home/End navigation and a labeled panel. Shared tab styling recognizes
`aria-selected` and `aria-pressed` where appropriate.

## Browse refinements — 2026-10-19

Browse controls on desktop use `--p-control` and compact row spacing; text size
remains independent. Mobile touch targets keep their 44px minimum. Movement and
Loan switches use `PageHeader`'s persistent title-tools slot so they remain
available when `BrowseToolbar` compacts. Mobile navigation scrolls horizontally
and `AppFrame` measures its actual height for content clearance.

Movement projections expose signed `available_effect` from native endpoints and
authorized leaves, alongside the original transaction quantity. The default is
the physical-leaf basis; explicit warehouse selections scope effects to every
selected authorized leaf, including loaned and damaged leaves. Status and unit
groups stay distinct. `ReportTable` renders absent values as empty while
preserving explicit booleans, numeric zero and external endpoint labels.

`/batch/:name` uses ERPNext Batch as its sole source. Its detail page shows the
authorized stock projection and paginated native movement rows; metadata writes
use the shared optimistic lock and Batch permissions. Exact `batchNo` query state
is shared by stock, movement, loan and export projections.

## Validation and fixed geometry

Use focused component tests, type checking and the production build when bundling
changes. Review the actual routed app in a browser with realistic Chinese text,
long names, phone/desktop widths, density changes and enlarged text. Controlled
HTTP fixtures establish client behavior; real-service and real-device evidence
must be identified separately. Do not infer visual acceptance from a source audit.

Fixed bounds are intentional for overlays, internal scrolling, artwork, icons,
touch targets, page widths and measured shell obstructions. Typography scales
independently from density. Add shared semantic tokens before page-local values.

## Historical design decisions

The dated sections below document the retired preview workflow and earlier
migration decisions. They do not assign gallery maintenance or migration work.

## Page mockup review gate (2026-10-12)

The standalone reference is the visual authority. Its complete page/state index
uses preview-only `#review/` links; the production route audit above describes
existing tokenization, not accepted visual fidelity. Review notes and the route
coverage matrix are in the archived preview README in commit `63c7f26`.
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
[progress note](notes/done/20261013_DESIGN_PREVIEW_USABILITY_FOLLOWUP_PROGRESS.md).

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
the [dated execution note](notes/done/20261015_DESIGN_ACTIVITIES_REPORTS_PROGRESS.md).
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
[review note](notes/done/20261016_DESIGN_PREVIEW_COMPACT_FILTERS_REVIEW.md).

## Native history and recovery details — 2026-10-19

`MovementHistoryTable` is a typed history surface with 6px vertical and 10px
horizontal cell padding, centered values, compact desktop links, and 44px mobile
link targets. Its internal scrollport handles long native identifiers and
warehouse names. Increase/decrease effects combine a low-contrast row tint,
matching quantity color, and a spoken text description; loan-balance quantities
remain neutral. `RecoverySummary` maps native fields to Chinese labels, preserves
empty/zero/false values, and exposes exact source payload text only after an
explicit copy failure or copy request. Preview images remain 44px square,
including missing-image and load-error states.
