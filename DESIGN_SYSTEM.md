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
