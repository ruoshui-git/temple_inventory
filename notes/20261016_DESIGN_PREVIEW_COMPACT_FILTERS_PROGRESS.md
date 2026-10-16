# Compact preview filters implementation — 2026-10-16

Implemented the scope in
[the handoff](20261016_DESIGN_PREVIEW_COMPACT_FILTERS_HANDOFF.md) without subagents.
This is preview-only source/documentation work; manual visual acceptance is pending.

## Delivered

- Reports: compact desktop scope dialogs, one combined mobile filter sheet,
  primary search/date/window controls, visible common/dataset/inherited chips,
  separate result Group/Sort and a named-view management panel with local errors.
  Empty restricted scopes stay empty. Removing selected-item/allocation scopes
  clears their flags and keys together. Large inherited scopes have concise count
  chips opening their full context. Submitted-only and all-dates undated defaults
  remain visible. Clear Filters retains primary controls and presentation; Reset
  Report retains the previous full-reset behavior.
- Drafts: shared compact scope controls/chips and complete result count, retaining
  operation date/search, all kinds, hierarchy/location filters and continuation.
- Dashboard: one bounded scope dialog/sheet with existing option sources,
  summary, disabled empty Clear, complete item count and mobile return-to-top
  hiding. Opening/closing does not refresh sections; changing scope does.
- Activities: secondary movement/presence/outstanding filters with removable
  chips and a separate Sort panel. Primary filters and detail-return state remain.
- Shared panels coordinate with date/Quick Report dialogs, dismiss on context,
  deactivation and breakpoint changes, and preserve committed filters. Nested
  selector/tree Escape, focus containment/return, outside dismissal and listener/
  observer cleanup are covered. Panel-local searchable menus flow inside the
  scrolling body. Existing browse rails and default BrowseFilters controls remain.
- Updated UI_UX_DECISIONS, DESIGN_SYSTEM and DESIGN_MIGRATION_COVERAGE.

ReportQuery, report projections/export APIs, production UI/backend and generated
assets were not changed. The earlier notes moves remain untouched.

## Actual automated checks

Run from `frontend/`:

- Prettier formatted only touched Vue/TypeScript/CSS/test files.
- `pnpm test tests/design-preview --exclude tests/design-preview-server.test.ts`:
  **16 suites / 263 tests passed**. Includes activities/reports, forms, completion,
  independent review, usability, browse, ERPNext, refinement and other preview UI
  suites. The HTTP entry/server suite was excluded because routing is unchanged.
- After the final undated-exclusion indicator and Dashboard count refinement:
  `pnpm test tests/design-preview-compact-filters.test.ts tests/design-preview-activities-reports.test.ts tests/design-preview-usability.test.ts tests/design-preview-completion.test.ts`:
  **4 suites / 104 tests passed**, including **26 new compact-filter tests**.
- `pnpm type-check`: passed after final source changes.
- `git diff --check`: passed.

At the initial implementation checkpoint, no production build, backend integration, production requests, Playwright,
Chromium or other browser automation was run. No known functional defects remain
from these checks; component tests do not establish visual fidelity.

## Unverified manual review

Review 375/768/1024/1440px, compact/balanced/spacious density, 100/150/200%
application text and native browser zoom. Verify stable underlying result position
when opening/closing, viewport clamping/short screens, internal panel/menu scrolling,
reachable footer actions and safe areas, long chips, table horizontal scrolling,
invalid custom dates, keyboard operation and visible results after dismissal.

## Subsequent review

The user subsequently authorized browser automation. The
[review record](20261016_DESIGN_PREVIEW_COMPACT_FILTERS_REVIEW.md) supersedes the
initial no-browser status and records the completed checks. Review corrections
address first-open desktop keyboard focus and compact-panel controls below the
44px target minimum; existing browser tests now use the new panels. Native
browser zoom and real-device safe-area/keyboard behavior remain manual checks.
