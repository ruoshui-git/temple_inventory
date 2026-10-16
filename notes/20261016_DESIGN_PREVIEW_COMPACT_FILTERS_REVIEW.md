# Compact filter implementation review — 2026-10-16

Scope: Reports, Drafts, Dashboard, Activities and their shared preview controls.
The user explicitly authorized browser automation for this review, superseding
the earlier handoff's no-browser restriction. Work was performed without subagents.

## Findings and corrections

1. **Desktop keyboard focus failed in a real browser.** The new panel initially
   renders with `visibility: hidden`. Its opening handler changed the position
   and immediately called `focus()` before Vue committed the visibility change.
   Chromium ignored the focus request, leaving focus on the trigger; Escape did
   not dismiss the panel. Wait for the visibility update before focusing, and
   check that the panel is still open/on desktop after that asynchronous boundary.
   A Playwright Enter → focused dialog → Escape → focused trigger test reproduces
   the original failure and verifies the correction.
2. **Compact hierarchy targets did not meet the documented 44px minimum.**
   Existing hierarchy CSS overrode the new label rule; measured compact desktop
   rows, expand buttons and Clear were 32px, and the search field was about 36px.
   Panel-local CSS now sets a 44px minimum for inputs, selects, buttons and labels,
   with 44px expansion-button/spacer widths. Existing browse rails are unchanged.
3. **Existing browser tests still targeted the removed inline controls.** Grouping
   tests now open/close the Group panel. Saved-view tests reopen their management
   panel after dataset/view restoration dismisses it. Report behavior is retained.

Source review found the requested capability coverage in all four pages: shared
compact scopes/chips, immediate selection, mobile counts and completion, dataset
options, inherited restrictions (including empty selections), separate grouping/
sorting, saved views, and existing projections/exports/drill-through/paging.
No production API, backend, generated asset or other browse-rail migration was
introduced by this review.

## Verification record

Browser verification completed with Chromium and one worker. The selected run
covered 16 scenarios: 15 passed, while the new desktop target-size assertion
found one remaining tree-button specificity override. After correcting that
override, all three affected checks (375px targets, 1440px targets and short
large-text desktop) passed. No known review findings remain open.

Run from `frontend/` with
`FONTCONFIG_FILE=/tmp/temple-inventory-ui-audit/fonts.conf` and
`DESIGN_PREVIEW_PORT=5199`:

```sh
DESIGN_PREVIEW_RESULTS=/tmp/compact-filter-review-verified pnpm exec playwright test --config playwright.design-preview.config.ts compact-filters.spec.ts independent-review.spec.ts activities-reports.spec.ts --workers=1 --grep 'stable filter layouts|desktop keyboard|search options|mobile focus|short large-text|filter inputs|independent report details|named report views|quick report failure|audit repairs'
DESIGN_PREVIEW_RESULTS=/tmp/compact-filter-review-targets pnpm exec playwright test --config playwright.design-preview.config.ts compact-filters.spec.ts --workers=1 --grep 'filter inputs|short large-text'
```

The browser checks cover keyboard entry/Escape/return focus, nested Escape,
panel switching, successive selections, chip removal, mobile focus containment,
breakpoint retention/overlay cleanup, selectors and export settings, saved views,
Quick Report failure/retry, grouped detail/paging and existing audit regressions.
The new compact-filter checks also assert no page errors or `/api/` requests.

The initial real-browser check reproduced the focus defect. With the focus fix,
the four-page layout matrix passed at 375/768/1024/1440px, all three densities and
100/150/200% application text size. Opening/closing preserves underlying result
geometry and document scroll; panels stay bounded with reachable footer actions.
The checks measure after Playwright's preparatory scroll clears fixed mobile
navigation, so automation's own scrolling is not mistaken for a layout regression.

Screenshots and machine-readable results are in the two output directories
above. Representative screenshots visually inspected include:

- `compact-filter-review-verified/screenshots/drafts-open-375-100.png`
- `compact-filter-review-verified/screenshots/dashboard-overview-768-200.png`
- `compact-filter-review-verified/screenshots/dashboard-overview-1024-100.png`
- `compact-filter-review-targets/screenshots/targets-1440-compact.png`

These paths are relative to `/tmp`; artifacts are local and may be cleared.

Final source checks:

- `pnpm test tests/design-preview --exclude tests/design-preview-server.test.ts --maxWorkers=1`:
  **16 suites / 264 tests passed**. The unchanged HTTP entry/server suite was
  excluded; the browser run serves the actual preview through Vite.
- `pnpm type-check`: passed after the Vue focus correction.
- Prettier formatted touched source/tests; `git diff --check` passed.
- No production build or backend integration was needed for these preview-only
  interaction and CSS corrections.

One attempted broad concurrent Vitest/browser run exhausted worker resources and
produced worker-start timeouts. Those incomplete results are not acceptance
evidence; final checks use one worker. New test locator mistakes were corrected
without changing application behavior.

Chinese screenshots use the existing audit font configuration at
`/tmp/temple-inventory-ui-audit/fonts.conf`. Native browser zoom and real-device
safe-area/virtual-keyboard behavior remain manual checks; application text scaling
is not native browser zoom. Preview evidence does not establish production parity
or final user visual approval.
