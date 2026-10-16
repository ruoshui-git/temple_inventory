# Design preview: compact filters and stable result layout

Date: 2026-10-16
Status: implemented; subsequent fixes and browser verification are recorded in
[the review](20261016_DESIGN_PREVIEW_COMPACT_FILTERS_REVIEW.md).
The scaffolding status and instructions below describe the original handoff.

## 1. Request and agreed direction

The user reported that Reports → 筛选与分组 expands a narrow, sidebar-shaped
filter section above the results. It leaves unused space to the right and forces
the user to scroll down after changing a filter. They asked to inspect other
preview pages and include fixes for equivalent layouts.

The user selected:

- **Desktop:** a compact toolbar with individual filter popovers, visible active
  filters, and a full-width result table.
- **Mobile:** one Filters button opening a single sheet, with immediate updates,
  a result count, and Done. Search and date controls remain visible on the page.

The user then stopped implementation and requested this handoff for another
agent. Continue from the work described below; do not assume the scaffolding is
finished or validated. No subagents were requested; the user explicitly said
“No subagents.” That overrides the repository's default delegation workflow.

This is standalone **design-preview work only**. Preserve the Chinese interface,
jade styling, preview density/text-size preferences, report semantics, and all
existing capabilities. Do not migrate production UI, change backend contracts,
make production requests, deploy, or modify generated production assets.

## 2. Inspection findings and page scope

Findings are from source inspection, not a browser or screenshot review.

| Page | Finding | Required change |
| --- | --- | --- |
| Reports, all six datasets | `PreviewReports.vue` nests the entire `PreviewBrowseFilters` component as one flex item alongside grouping/sorting. Its internal fields become a tall narrow column inside a disclosure above results. | Replace with the agreed compact toolbar/popover and mobile-sheet layout; separate result presentation controls from filters. |
| Drafts | `PreviewBrowsePages.vue`, `page.page === 'drafts'`, has a `筛选草稿` disclosure containing the full stacked `PreviewBrowseFilters` above the table. | Use the same compact scope filters, active chips, and mobile sheet as Reports. Keep search and operation date visible. |
| Dashboard | `PreviewDashboard.vue` renders desktop `总览范围` as an inline block containing two large hierarchy trees above cards. The trees use a grid, but expansion still pushes the dashboard down. | Keep one labeled `总览范围` trigger; open its warehouse/category controls in a bounded desktop popover or mobile sheet. Keep scope summary, clearing, and existing refresh behavior. |
| Activities list | `PreviewActivities.vue` has a `更多筛选与排序` disclosure above the list. It is a wrapping form, not the exact nested-column bug, but expansion displaces results and becomes tall on phones. | Replace the disclosure with a bounded secondary-filter panel and a separate compact Sort control. Keep search, activity status/type, and date visible. Show the applied secondary conditions outside the panel. |
| Inventory, Expiry, Movement, Loans | Desktop filters already sit beside their results in a genuine rail; mobile uses an overlay. | Preserve these layouts. Shared-control changes must not regress them. |

Do not convert unrelated disclosures for notes, metadata, contribution tables,
analysis, or preview-only state simulations into filters.

## 3. Current working tree and unfinished scaffolding

The previous agent made these changes before the user stopped implementation:

- Modified `frontend/src/design-preview/components/PreviewBrowseFilters.vue`:
  optional `fields` array gates individual controls. When absent, the original
  filter set should remain unchanged. Existing `movement`, `records`, and
  `hideActivity` conditions remain in force.
- Added `frontend/src/design-preview/components/PreviewFilterPanel.vue`:
  initial desktop teleported dialog/popover and mobile `PreviewOverlay` wrapper,
  trigger/count, placement calculation, dismissal, focus handling, and coordination
  through a `preview-filter-panel-open` document event.
- Added `frontend/src/design-preview/components/PreviewCompactFilters.vue`:
  initial common scope toolbar, individual desktop panels, a mobile combined
  sheet, secondary-filter slots, and scope chips.
- Added `frontend/src/design-preview/compactFilters.ts`:
  typed scope-field labels and chip descriptors for `BrowseScope`.

**Nothing is connected to page consumers yet. No new CSS, tests, or UX decision
updates have been written. Formatting, type-checking, tests, and visual checks
have not run for this scaffolding.** The existing Reports page still has its old
layout. The only existing consumer behavior touched is the optional filtering
of fields in `PreviewBrowseFilters`.

Review and finish the scaffolding, replacing it if needed to meet the interaction
contract. In particular:

- Implement the missing `.preview-filter-popover`, `.preview-filter-control`,
  `.compact-filter-content`, `.compact-filter-toolbar`, and chip styles. Without
  fixed positioning CSS, the desktop implementation does not work as intended.
- Check first-open positioning, resizing, scrolling, content-size changes, and
  short viewports. Avoid resize-observer feedback loops.
- Verify keyboard focus, Escape in nested selectors/trees, dismissal, and focus
  restoration. Desktop panels are interactive dialogs, not tooltips. Ensure
  body-teleported controls remain within the intended interaction boundary.
- Existing searchable dropdowns are absolutely positioned; prevent their menus
  from being clipped by the panel's internal scroll region. Scope any menu-layout
  adjustment to these panels so other selectors retain their existing behavior.
- Verify panel coordination with existing date controls and Quick Report dialogs,
  as well as cleanup when pages deactivate or the responsive surface changes.
- Complete reset/count/chip semantics. The helper currently covers only common
  scope fields; it does not cover report-specific or inherited restrictions.
- Dashboard has its own scope shape and category options. Reuse its current
  controls and option sources in the shared panel rather than replacing them
  with a generic scope that loses behavior.

Unrelated pre-existing changes move three earlier activity/report notes from
`notes/` to `notes/done/`. Preserve those moves and all other unrelated changes.
Do not commit or discard them as part of this task.

## 4. Remaining implementation

### 4.1 Shared panel and filter behavior

- Use preview-local components and `--p-*` styling. Read `AGENTS.md`,
  `UI_UX_DECISIONS.md`, and `DESIGN_SYSTEM.md` before continuing.
- Use `useResponsiveLayout` and the existing 1024px boundary. Mount only one
  active filter surface. Preserve applied filter/query state across resizing.
- Desktop: open on click, one panel at a time, preferred width 400px, viewport
  clamping with a 12px gutter, and internal scrolling for long content. Opening
  panels must not add height to the page or alter the table/card width.
- Mobile: use a single full-width filter sheet with an internally scrolling body
  and visible footer actions. Reuse the existing overlay's focus containment,
  body-scroll locking, and return-focus behavior. Respect bottom navigation and
  safe areas. Display the applicable complete result count and Clear/Done.
- Non-date selections apply immediately. Multi-select panels remain open for
  successive selections. Done, outside dismissal, and Escape close the panel
  without rolling back committed selections or jumping the document scroll.
- Dates retain their current draft-until-Apply and Cancel behavior. Do not add
  an Apply step to ordinary filters.
- Close transient panels on dataset/view/context changes, deactivation, or
  breakpoint changes. Preserve applied selections and existing per-dataset state.
- Keep toolbars in normal document flow. Maintain readable labels, visible
  focus, 44px targets, reduced-motion support, and all density presets.
- Chips use readable labels and individually labeled removal buttons. Removing
  one chip changes only that condition. Keep existing reset behavior explicit;
  do not accidentally reset dates, dataset/view, or unrelated conditions through
  a field-specific clear action.

### 4.2 Reports

- Header: report title and Quick Report action.
- Primary toolbar: dataset, view, search, and applicable date/expiry-window
  controls. Current inventory retains its snapshot timestamp. Activity records
  retain their separate related-record search/date controls.
- Desktop scope toolbar: Item, Category, Location, Activity where applicable,
  and Movement Type where applicable. More Filters contains source/destination
  locations and the current dataset-specific controls.
- Preserve every existing option: document statuses, zero-stock inclusion,
  undated expiry inclusion, activity archive/type, and count reviewed state.
- Place active-filter chips below the toolbar. Document-status scope must remain
  visible, including the default submitted-only scope. Default status can be a
  non-removable indicator; removing a changed status condition restores the
  existing submitted-only default rather than silently including every status.
- Represent inherited Quick Report restrictions, including record/loan identity,
  selected items or allocations, location combinations, loan status/outcome,
  damage-only and activity-related conditions. Do not lose empty restricted
  scopes or silently broaden them when rendering/removing chips. Clearing a
  selected-items/allocations restriction must clear its enable flag and its keys
  together. Group these scopes into concise chips with full readable context.
- Results header: dataset/result count plus Group and Sort. Group uses the
  existing choices; Sort exposes the existing field and direction in one panel.
- Move named-view management into a labeled toolbar panel. Preserve save, load,
  rename, delete, error feedback, and session-only persistence. Errors must be
  visible inside the management panel while it is open.
- Retain field explanations below results. Preserve projections, unit/status
  totals, historical bounded periods, contribution drill-through, load-more,
  and independent export content/format selection.
- Keep `ReportQuery` and report calculation/export APIs unchanged. This is a
  presentation refactor, with typed preview-local helpers where needed.

### 4.3 Other affected pages

- **Drafts:** replace `筛选草稿` with the shared compact scope toolbar and mobile
  sheet. Show active chips and complete filtered draft count. Preserve date,
  search, all movement types, hierarchy filtering, draft continuation, and
  contextual Quick Report behavior.
- **Dashboard:** replace only the inline scope-expansion block with the shared
  panel. Preserve warehouse/category hierarchy semantics, disabled Clear when
  empty, scope summary, and per-section loading/error/retry behavior. Opening
  or closing the panel alone must not refresh the data. Keep Return to Top hidden
  while the mobile scope sheet is open, as it is currently.
- **Activities:** put movement type, related-record presence, and outstanding
  borrowing in a secondary-filter panel, with removable chips and immediate
  application. Put sorting in its own panel. Preserve list search/status/type/
  date, list restoration after detail navigation, lifecycle actions, and exports.

### 4.4 Documentation

Update `UI_UX_DECISIONS.md` in the same implementation change: explicitly
supersede the report-specific inline-filter/always-visible-tree presentation
rule with compact desktop panels and a combined mobile sheet. Tree selection
semantics remain unchanged; Inventory/Movement/Loans/Expiry retain their rails.
Record the Dashboard, Drafts, and Activities changes and update the relevant
`DESIGN_MIGRATION_COVERAGE.md` rows. Document intentional panel geometry in
`DESIGN_SYSTEM.md`. Do not present fixture behavior as production parity or
manual visual approval.

## 5. Validation and acceptance

Add focused Vitest component tests that exercise behavior, not only source text
or class names:

- Desktop/mobile opening, one-panel coordination, close/Done/outside/Escape,
  keyboard navigation, focus restoration, and listener cleanup.
- Immediate hierarchy/multi-select filtering, individually removed chips,
  Clear behavior, empty results, and long labels/large option lists.
- Breakpoint/context/deactivation transitions retain filters while dismissing
  transient panels. Mobile counts follow the complete filtered result.
- All six Reports datasets expose applicable controls. Named presets and incoming
  Quick Report queries survive the redesign. Include inherited empty restricted
  scopes, historical date behavior, grouping/sorting, export scope, and load-more.
- Drafts filters still affect the expected rows and continuation works.
- Dashboard scope changes still drive section updates; opening panels does not.
- Activities secondary filters/sorting update results and survive detail return.
- Existing browse-filter consumers without the new `fields` prop retain their
  controls and behavior.

Update existing tests whose selectors assume inline content. In particular,
`design-preview-usability.test.ts` currently expects Dashboard's scope controls
inside the page and an open scope panel to remain available after resizing;
adapt it to the documented dismissal-on-breakpoint behavior and teleported UI.

From `frontend/`, format only touched source files with Prettier, run the focused
new tests plus relevant preview regressions, and run `pnpm type-check`. The
relevant suites include activities/reports, forms, completion, independent
review, usability, browse, and ERPNext preview tests. Broaden testing if a shared
change exposes a regression. Run `git diff --check`. No production build or
backend integration run is needed for this bounded preview presentation work.

**Do not launch Playwright, Chromium, or other browser automation.** The current
request does not authorize browser tests; an older completed handoff's browser
authorization is not authorization for this task. Manual visual acceptance is
the user's responsibility unless they explicitly authorize browser tests later.

Manual review checklist: 375/768/1024/1440px, compact/balanced/spacious density,
100/150/200% application text size, and native zoom. Opening any changed filter
panel must leave the underlying result position unchanged; long content scrolls
inside the panel; menus remain usable; no viewport overflow or clipped actions;
tables retain internal horizontal scrolling. Check result visibility after
closing a panel, long chips, invalid custom dates, and keyboard operation.

Completion report must state the affected pages, actual checks/results,
unverified manual visual cases, and any remaining defects. Do not claim the
partial scaffolding or source inspection has already passed those checks.
