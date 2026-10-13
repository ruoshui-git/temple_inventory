# Design-preview browser audit fixes — 2026-10-13

Implemented all eight findings directly, without subagents. Scope is the isolated
preview, one focused regression suite and documentation. Production UI, backend
APIs, ERPNext/Frappe core, database state, generated production assets and account
preferences were not changed. The pre-existing moves of the October 12/13 progress
notes into `notes/done/` were preserved.

## Finding status and viewed evidence

All paths below are under `/tmp/temple-inventory-audit-fixes/`. Before/after images
were opened and visually inspected; Chinese glyphs are readable using the audit's
font configuration. Original recheck screenshots were also inspected, including
`/tmp/temple-inventory-ui-recheck/item-identity-375.png` for the squeezed identity.

| Finding | Status and result | Before → after screenshots |
| --- | --- | --- |
| F1 reports overflow | Repaired. All five families, export dialogs and export review sample fit; the 650px table minimum stays in its scrollport. No document overflow masking. | `before-reports.png` → `after-report-0.png` through `after-report-4.png`, `after-report-export.png`, `after-report-pointer-scroll.png` |
| F4 count scope | Repaired. Baseline 80 bags; reviewed actual 0; adjustment −60; 1/3 reviewed, two excluded. No reviewed rows, mixed units, positive/negative/no-change, not-found, refresh/re-review and submitted summaries are covered. | `before-count.png` → `after-count-balanced-812.png`, `after-count-desktop-balanced.png` |
| New form focus | Repaired. Measured fixed-summary/navigation bounds, safe areas and floating actions protect focus; observers/listeners stop on deactivation. Desktop resize also keeps focused inputs visible. | `before-focus.png` → `after-focus-spacious-568.png`, `after-final-fields-reconciliation-form-new.png`, `after-final-fields-movement-form-Receive.png` |
| F2 browse Back | Repaired. Document/window and nested result/table positions restore after render; pending restoration is cancelled on later navigation. Context state survives, while ordinary navigation resets its documented scope/position. | `before-back.png` → `back-after-375-balanced.png`, `back-after-1440-balanced.png` |
| New Inventory controls | Repaired. One context row precedes compact title/search/scan/filter/count; secondary tools use a bounded disclosure. Focused enlargement clears the floating creation action. | `before-inventory.png` → `after-inventory.png`, `after-tools-disclosure.png`, `after-inventory-keyboard.png` |
| F3 touch targets | Repaired. Affected Dashboard, warehouse, loan and item-detail text actions are >=44px at mobile/tablet widths in every density; icon targets remain >=44×44px. Desktop density stays intact. | `before-targets.png` → `after-targets.png`; actual rectangles in `final-verification.json` |
| F5 item identity | Repaired. Name/code/description use the full text row below artwork at narrow widths; the rice name fits one line. Long names, missing images and independent enlargement remain usable. | Original `item-identity-375.png` → `after-identity-balanced.png`, `after-identity-long.png`, `after-identity-missing.png` |
| F6 return-to-top | Repaired. Dashboard and routed/local Inventory use the actual scroll owner, two-viewport threshold, 44px circle, heading focus, drawer hiding and reduced motion. Inventory targets the original browse position rather than its pinned heading. | `before-top.png` → `after-top-dashboard-overview-375.png`, `after-top-inventory-list-375.png`, `after-top-local-inventory-375.png` |

## Commands and results

Commands ran from `frontend/`, except browser harnesses, which use absolute paths:

```sh
pnpm exec prettier --write src/design-preview/PreviewApp.vue src/design-preview/PreviewInventory.vue src/design-preview/PreviewDashboard.vue src/design-preview/PreviewBrowsePages.vue src/design-preview/PreviewFormPages.vue src/design-preview/components/PreviewCountWorkspace.vue src/design-preview/components/PreviewCountSummary.vue src/design-preview/components/PreviewReturnToTop.vue src/design-preview/scroll.ts src/design-preview/focusVisibility.ts src/design-preview/workflowModel.ts src/design-preview/preview.css src/design-preview/form-pages.css src/design-preview/browse-pages.css src/design-preview/utility-pages.css tests/design-preview-audit-fixes.test.ts
pnpm exec vitest run tests/design-preview-audit-fixes.test.ts tests/design-preview-navigation.test.ts tests/design-preview-forms.test.ts tests/design-preview-completion.test.ts tests/design-preview-erpnext.test.ts tests/design-preview-browse.test.ts tests/design-preview-review.test.ts tests/design-preview-refinement.test.ts tests/design-preview-pages.test.ts tests/design-preview.test.ts --maxWorkers=2
pnpm type-check
pnpm design:build
```

Final results: **131 tests across 10 suites pass**, type checking passes, and the
isolated build passes (109 modules), writing only to
`/tmp/temple-inventory-design-preview`. The new suite has eight behavioral tests
for projections, refresh, confirmation/submission, route/table retention, scroll
owners, threshold/lifecycle, pinned-heading return and floating-action focus.
Entry/server behavior did not change, so HTTP isolation tests were not rerun.
No production build or backend test/mutation was run.

Browser entry: `http://127.0.0.1:5174/design-preview.html#review/` + encoded sample key.
The existing Vite listener (PID 495502, `vite.preview-design.config.ts`) was inspected
and reused; it was not stopped. A sandboxed server attempt failed with EPERM;
unsandboxed inspection confirmed the existing listener and HTTP 200. Chromium used
`/usr/bin/chromium-headless-shell` through the installed Playwright package.

```sh
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/before.cjs
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/verify.cjs
SKIP_REPORTS=1 SKIP_KEYBOARD=1 FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/verify.cjs
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/additional.cjs
SKIP_FORMS=1 FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/additional.cjs
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/recheck.cjs
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-audit-fixes/final-interactions.cjs
```

Harnesses ran with normal sandbox escalation for loopback/browser access. Final
merged evidence: **1,182 distinct passing assertions, zero remaining failed
assertions, zero console errors/page exceptions/failed requests/HTTP errors** in
`final-verification.json`. These are individual geometry/interaction assertions,
not 1,182 complete interaction passes or an exhaustive fidelity audit. Intermediate
raw reports are retained; later rechecks replace assertions of the same name.

Verified widths: **375×812, 390×812, 768×812, 1024×900 and 1440×900**, with all
three densities. Keyboard checks also cover 375×568, Tab/Shift+Tab through count
reasons and final personnel fields, Receive, and breakpoint changes. Dialogs retain
focus containment/restoration. Browse covers filter application/clear, card/table,
selection, local hashes, pointer actions, resizing, in-app Back and browser
Back/Forward. Final initiating-pointer positions restore exactly: mobile balanced
**871→871px**, desktop balanced **584→584px**. Nested horizontal table positions
also restore. Compact desktop detail history restores **200→200px**; scroll positions
are naturally clamped by current layout bounds.

Additional inspection includes 320×568 reflow, real pointer horizontal table
scrolling, reduced motion, missing artwork and long names. Desktop hover/focus tooltip and
heading visibility were also checked at 1440×350; drawer suppression was verified
with the underlying page still past the threshold. Runtime geometry exposed
and corrected desktop focus after resize, pinned-heading top navigation, and a
floating creation action covering focused enlargement. Harness corrections included
hidden native options, implicit-label matching, the required warehouse-export
filter, explicit dismissal of the submission toast, dynamic disclosure visibility,
and measuring scroll at the actual initiating pointer action rather than before
Playwright brings an off-screen target into view. Independent image selection and
enlargement retain separate targets; the large image target is hit-tested at its
center to account for its intentional checkbox/enlargement overlays.

## Limits and migration status

Native browser zoom, physical devices, Safari/Firefox, backend behavior and
historical visual fidelity were not tested. Narrow reflow is not a native zoom
pass. The original 852 rendering combinations were not repeated. Temporary browser
artifacts may be removed by the environment; durable behavioral regressions remain
in the repository. These repairs do not approve production styling/workflow migration.

## Implementation review and follow-up fixes — 2026-10-13

Independent review found two remaining gaps in the repairs, both now fixed directly
without subagents:

- **Focus-observer cleanup:** KeepAlive calls both mount and activation on its
  initial render. Both asynchronous starts created a ResizeObserver, but cleanup
  retained only the second reference. An in-memory reproduction measured two live
  observers after mount and one after deactivation/unmount. Generation guards now
  cancel superseded starts in both focus and scroll helpers; cleanup clears the
  observer reference. Unit tests cover mount, deactivation, reactivation,
  breakpoint changes and unmount. Chromium instrumentation confirms one active
  form observer and zero after navigating away for Reconciliation and Receive.
- **Inventory focus during compaction:** Focus the inventory sort selector and
  scroll down: the old implementation hid secondary tools and moved focus to
  `body`. Compaction now opens the disclosure when it contains focus. Expansion
  transfers focus from its removed trigger to the first tool, and the contextual
  reconciliation action retains focus when moving between layouts. Real wheel
  scrolling and hit-tested focus checks pass at 375/768/1024/1440px in all three
  densities. Viewed evidence: `compact-focus-before.png` and
  `compact-focus-after.png` under `/tmp/temple-inventory-review-fixes/`.

All eight original findings remain repaired in the reviewed scope. Fresh browser
evidence under `/tmp/temple-inventory-review-fixes/` includes:

- `verification.json`: 715 passing report/export, keyboard/count, touch-target,
  item identity, return-to-top and narrow-reflow assertions.
- `recheck-verification.json`: 109 passing browse state, in-app Back, browser
  Back/Forward and return-to-top assertions.
- `focused.json`: 54 passing focus-transition and observer-lifecycle checks.

Each completed harness reports zero failures and zero console/page/network errors.
These are assertion counts; scenarios overlap between harnesses. Representative
report, count-dialog, short-height focus, item identity, browse-return and Dashboard
top screenshots were opened and inspected. The existing port-5174 server was
reused; no server process was stopped. The targeted harness initially reused the
same URL and attempted to select density in collapsed review controls; its reload
setup was corrected before the successful run.

Validation commands from `frontend/`:

```sh
pnpm exec prettier --write src/design-preview/PreviewInventory.vue src/design-preview/focusVisibility.ts src/design-preview/scroll.ts tests/design-preview-audit-fixes.test.ts
pnpm exec vitest run tests/design-preview-audit-fixes.test.ts tests/design-preview-navigation.test.ts tests/design-preview-forms.test.ts tests/design-preview-completion.test.ts tests/design-preview-erpnext.test.ts tests/design-preview-browse.test.ts tests/design-preview-review.test.ts tests/design-preview-refinement.test.ts tests/design-preview-pages.test.ts tests/design-preview.test.ts --maxWorkers=2
pnpm exec vitest run tests/design-preview-pages.test.ts --maxWorkers=1
pnpm type-check
pnpm design:build
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-review-fixes/regression.cjs
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-review-fixes/navigation.cjs
FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf node /tmp/temple-inventory-review-fixes/focused.cjs
```

Final validation covers **133 tests across 10 suites**, including ten audit-fix
tests. During concurrent browser/type-check work, the all-pages rendering test hit
its existing five-second timeout (132 other tests passed); its full five-test
suite passed when rerun without competing browser work. Type checking and the
isolated 109-module build passed. Production/backend files, generated production
assets and pre-existing note moves were untouched. The earlier native-zoom,
physical-device, other-browser, backend and historical-fidelity limitations remain.
