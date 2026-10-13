# Task: fix the design-preview browser audit findings

Status: implemented and verified; see [progress and evidence](20261013_DESIGN_PREVIEW_AUDIT_FIXES_PROGRESS.md).
The findings below retain the original audit context.

## Objective and authority

Implement the eight fixes below in the **standalone design preview**, then verify
them visually and interactively using a real browser through Playwright. This
task is based on the independent audit and the subsequent browser recheck of
commit `80c5a5b464b4bc29f2e3553911041cb5c6a1e419`.

**Work directly, without subagents.** The user's explicit instruction supersedes
the implementation-delegation guidance in `AGENTS.md` for this task.

Read these before implementation:

- [Agent guide](../AGENTS.md)
- [UI/UX decisions](../UI_UX_DECISIONS.md), including the latest supersessions
- [Design system](../DESIGN_SYSTEM.md)
- [Migration coverage](../DESIGN_MIGRATION_COVERAGE.md)
- [Preview README](../frontend/src/design-preview/README.md)

Keep changes in preview source, focused preview tests, and relevant documentation.
Preserve unrelated working-tree changes. Do not modify production UI, ERPNext or
Frappe core, backend APIs, database state, generated production assets, or account
preferences. Preserve preview-owned `--p-*` styling, jade defaults, three
densities, the 1024px responsive boundary, five primary destinations, imagery,
review hashes, and existing workflow contracts. Do not reconnect preview styles
to production components/tokens as part of these fixes.

## Evidence and starting point

- Original report: `/tmp/temple-inventory-ui-audit/audit-report.md`
- Original screenshots, traces, and rendering matrix: `/tmp/temple-inventory-ui-audit/`
- Independent recheck screenshots and JSON: `/tmp/temple-inventory-ui-recheck/`
- Recheck interaction evidence: `interactions.json`, `count-retest.json`,
  `density-and-browse.json`, and `final-evidence.json` in the recheck directory.

All six original findings were reproduced; this task adds two findings from the
recheck. The original CSV contains 852 unique successful rendering checks, not
852 complete interaction passes. Earlier harness selector failures are recorded
separately and are not application defects. Some raw recheck metadata selected a
cached hidden heading; use visible routed content when asserting page identity.

The evidence used Chromium 152 through Playwright, with fresh visual inspection
at representative desktop/mobile widths. No unexpected console/network errors
were observed in completed recheck scenarios. Native zoom, real devices,
Safari/Firefox, backend behavior, and historical visual fidelity were not proven.
The `/tmp` artifacts are temporary: if missing, reproduce the cases below rather
than treating their absence as a blocker or inventing evidence.

## Required fixes and acceptance criteria

### 1. Reports overflow — original F1; high severity, confirmed

At 375px, open `reports/overview` with review options collapsed. The document is
702px wide and report cards/actions extend off-screen in all three densities.
The original audit also found this across the report families and export sample.
Evidence: `reports-viewport-balanced.png` and `reports-overview-375.png`.

Inspect `PreviewUtilityPages.vue` and `utility-pages.css`. Constrain grid children
and the report workspace so the table's 650px minimum width does not enlarge the
page. Use a single catalog column on narrow phones; retain table columns inside
the existing horizontal-scroll container. Do not hide document overflow to mask
unreachable content.

Acceptance: catalog, heading, filters, export action, and navigation fit 375px
and 390px in every density. All table columns remain reachable by scrolling the
table itself. Confirm all five report types and the export review dialog, plus
768/1024/1440px layouts. Measure against the configured viewport/client width;
mobile emulation can expand `innerWidth` when content overflows.

### 2. Reconciliation summary and confirmation — original F4; high fix priority

This is a usability concern, not evidence of incorrect stock calculation. At
`reconciliation-form/new`, choose A-01, then `整个库位`. Enter 0 for the 60-bag
rice row and a difference reason; leave the other two rows blank. One of three
rows is reviewed, but the prominent summary remains 80 bags. The mobile summary
hides row explanations, the confirmation dialog has no adjustment details, and
the submitted summary still shows the unlabeled 80. Evidence:
`count-zero-1440.png`, `count-confirm-375.png`, and `count-retest.json`.

Inspect `PreviewFormPages.vue`, `components/PreviewCountWorkspace.vue`, and the
existing count/draft projection helpers. Add a reconciliation-specific summary
derived from existing lines; do not reuse an unexplained ordinary-operation total.

- Label the full baseline `账面合计`; keep quantities separate by stock unit.
- Show `已核对 X / Y 行`, the unreviewed count, reviewed actual totals, and
  reviewed differences. Label their scope explicitly, for example
  `已核对实点合计` and `本次调整差异`.
- For this example show baseline 80 bags, reviewed actual 0 bags, difference
  −60 bags, and two unreviewed rows excluded from adjustment.
- With no reviewed rows, show `尚未核对` rather than implying an actual count of
  zero. Preserve the distinction between blank, deliberate zero, and not-found.
- Put location, reviewed/unreviewed counts, and per-unit actual/difference totals
  in the confirmation dialog. Keep final submission explicit. Present truthful
  labels in submitted/read-only count summaries too.
- Keep the mobile bar concise and all actions reachable; full details can live
  in the confirmation dialog. Recheck its geometry together with fix 3.

Acceptance: cover no reviewed rows, one zero row, positive/negative/no-change
differences, mixed units, baseline refresh/re-review, and submitted detail. Blank
rows remain excluded, actual counts survive refresh, and no stock engine or
backend mutation is introduced.

### 3. Focus hidden behind mobile summary — NEW; medium severity, confirmed

At 375×812, configure the same full-location count, focus `盘点方式`, then press
Tab. The first number input receives focus at y=664–708, behind the fixed review
bar; later buttons and inputs can also be covered. Evidence:
`keyboard-count-covered-0.png` and the `keyboard-count-occlusion` measurements in
`density-and-browse.json`.

Inspect the shared form layout in `PreviewFormPages.vue` and `form-pages.css`.
Account for the actual fixed summary, bottom navigation, and safe-area geometry
when bringing focused controls into view. Existing bottom padding only makes
the end of the form scrollable; it does not protect focused fields. Use measured
geometry where the summary can resize. Clean up any listeners/observers when the
surface deactivates, and retain the fixed summary and form input.

Acceptance: real Tab and Shift+Tab leave each focused input/button visible above
the obstruction, including count reasons and final fields. Test reconciliation
and Receive, all densities, short viewport heights, and breakpoint changes.
Check both screenshot visibility and the focused element's hit-tested rectangle;
being inside the viewport alone is insufficient. Dialog focus containment and
restoration must still work.

### 4. Browse Back scroll restoration — original F2; medium severity, confirmed

Open `inventory/list`, scroll to the rice item, open it, scroll the detail, and
choose `返回上一页`. The recheck reproduced 1100→0px on mobile and 600→0px on
desktop. Evidence: `back-before-375.png`, `back-after-375.png`, `interactions.json`.

`PreviewApp.vue` currently saves `#sample-content.scrollTop`, although the
document/window is the active vertical scroller in these layouts. Capture the
actual scroll owner and relevant nested result/table positions. Restore after
the destination renders, without a stale delayed restoration overriding later
navigation. Keep stored positions associated with the correct route/surface.

Acceptance: in-app Back restores the initiating position, search, filters, view,
and selection on desktop/mobile, including local preview hashes. Exercise browser
Back/Forward too. Preserve nested horizontal table scrolling where present.
Across a resize, preserve state and a sensible clamped position without assuming
identical layout heights. Ordinary primary navigation must retain its documented
default/reset behavior rather than inheriting a contextual origin unexpectedly.

### 5. Inventory controls disappear during scrolling — NEW; medium severity

At 375px, scroll `inventory/list` down 1200px. Search is at y=−545px and search,
scan, and filter controls are absent from the viewport. Movement retains its
controls under comparable scrolling. Evidence: `inventory-list-scrolled.png`,
`movement-items-list-scrolled.png`, and `density-and-browse.json`.

Inspect `PreviewInventory.vue`, its shell/subnavigation, and `preview.css`.
Implement the documented compact browse header after 80px of active-result
scrolling: context tabs above compact title/search/actions, with secondary tools
behind an accessible disclosure. Keep search, scan, filter, and active-filter
count available. Reuse existing preview patterns/headless utilities where suitable;
do not copy Movement's whole expanded toolbar into a tall fixed block.

Acceptance: controls remain usable while browsing a long mobile list; one semantic
page heading, no duplicated tabs, no obscured first result or focused control.
Cards/table, search, filters, selection, and disclosure survive relevant navigation
and responsive changes. Verify desktop behavior and the retained local inventory
sample as well as the routed page. Respect reduced motion.

### 6. Mobile touch targets — original F3; medium severity, confirmed

At 375px, Dashboard drill-through actions, warehouse `编辑` buttons, and the loan
history action are 36px high across all densities. Related item-detail links have
the same issue. Evidence: `dashboard-target-375.png`, `final-evidence.json`, and
the density measurements in `density-and-browse.json`.

Inspect shared preview buttons and local overrides in Dashboard, browse/detail,
and loan surfaces, including `.browse-link`, `.browse-row-link`, and equivalent
text-action rules.
Enforce at least 44px-high mobile hit areas below 1024px in every density; icon-only
actions need 44×44px targets. Preserve readable labels and visible focus. Do not
enlarge decorative glyphs or globally change desktop density to achieve this.

Acceptance: measure actual interactive rectangles at 375/768px for affected
variants, including warehouse name/disclosure actions and item-detail links.
Check wrapping/spacing and confirm primary controls still fit.

### 7. Mobile item identity reflow — original F5; medium usability concern

At `item-detail/overview`, 375×812, `东北珍珠米` receives only 57px at 24px type
and wraps into three lines; code and description are also squeezed. Evidence:
`item-identity-375.png` and `final-evidence.json`.

The identity header is in `PreviewBrowsePages.vue` with
`.browse-item-detail-head` styles in `browse-pages.css`; `PreviewStockDetails.vue`
primarily handles stock chips/popovers. Reflow the narrow-phone identity area so
name, code, and description occupy a full-width text row below the icon/artwork,
with the edit action on its own row as needed. Retain artwork and independent
image enlargement; preserve the wider layout.

Acceptance: the five-character name is readable on one line at 375px, longer
fixture names wrap naturally, and code/description/edit controls remain legible
without overflow. Verify overview/batches, missing images, and all densities.

### 8. Dashboard return-to-top — original F6; low priority, confirmed gap

At 375×812, scroll Dashboard to the bottom: document scroll reaches approximately
3095px with no return-to-top action. Evidence: `dashboard-bottom-375.png`.
The tested desktop page did not exceed the threshold, so its absence alone was
not a desktop failure.

Implement the established behavior against the active scroll owner: appear after
two viewport heights, use a circular 44px control, stay above navigation/creation
actions, and hide while a mobile filter drawer is open. Desktop gets a hover/focus
tooltip. Activation returns to the page heading and focuses it without changing
scope or results; respect reduced motion. Coordinate scroll handling with fixes
4–5 and use a small preview-local helper if shared behavior warrants it.

Acceptance: check threshold crossing in both directions, heading focus, unchanged
scope, drawer visibility, and breakpoint/listener cleanup. A short page should not
show a needless top action. Extend the same helper to Inventory's long browse
surface where required by the documented browse convention.

## Validation and delivery

Run focused preview regression tests for changed behavior, then `pnpm type-check`
and `pnpm design:build` from `frontend/`. The isolated build writes to
`/tmp/temple-inventory-design-preview`; do not run the production build merely for
this task. Existing relevant suites include `design-preview-navigation`,
`design-preview-forms`, `design-preview-completion`, `design-preview-erpnext`,
`design-preview-browse`, and `design-preview-review`. Include the preview HTTP
isolation suite if entry/server behavior changes. Use behavioral assertions for
summary logic and retained state; do not substitute CSS-source assertions for
browser geometry. Format only touched source files with the project formatter.

Real Playwright browser verification is part of this task. Start or reuse the
isolated server on port 5174 using `vite.preview-design.config.ts`, and open
`/design-preview.html#review/` followed by the URL-encoded sample key. Do not use
production routes or backend browser tests. Inspect an existing listener before
starting another server; do not terminate processes you did not start.

Validate affected pages at 375×812, 390×812, 768×812, 1024×900, and 1440×900,
with compact/balanced/spacious density at the required 375/768/1024/1440 widths.
Also inspect a short viewport and reflow/zoom. Capture and **view** before/after
screenshots for every finding; use real keyboard input, pointer actions, scrolling,
and resize. Monitor console errors, page exceptions, failed requests, and HTTP
errors before navigation. Check filter application/clear, cards/table, detail/back,
form validation/confirmation, and dialogs after the shared changes. No need to
repeat all 852 original rendering combinations unless a regression warrants it.

Environment notes: sandboxed loopback/browser launch previously failed with EPERM;
use the normal escalation mechanism when needed. The installed browser was
`/usr/bin/chromium-headless-shell`; CJK font configuration was available at
`/tmp/temple-inventory-ui-audit/fonts.conf`. Verify readable Chinese glyphs before
visual review. If native zoom or a browser/device cannot be tested, state that
limitation; a resized viewport/DPR simulation is not a native zoom pass.

Update `UI_UX_DECISIONS.md` for durable clarifications/supersessions,
`DESIGN_MIGRATION_COVERAGE.md` for the affected evidence, and `DESIGN_SYSTEM.md` or
the preview README for changed geometry/review notes as appropriate. Existing
contracts should be marked as repaired, not presented as newly approved redesigns.
None of this constitutes approval to migrate production styling or workflows.

Keep progress and actual commands/results in this file or a linked dated progress
note. Finish with each finding's status, evidence paths, passing checks, remaining
limitations, and confirmation that production/backend files stayed untouched.

- [x] Reports fit narrow viewports; tables scroll internally.
- [x] Count summaries and confirmation identify scope and adjustment quantities.
- [x] Focused mobile form controls remain visible above fixed UI.
- [x] Detail return restores browse state and actual scroll positions.
- [x] Inventory compact controls remain usable during scrolling.
- [x] Affected mobile actions meet the 44px target convention.
- [x] Mobile item identity has readable text width.
- [x] Dashboard/browse return-to-top follows the existing convention.
- [x] Focused tests, type check, isolated build, real-browser evidence, and docs complete.
