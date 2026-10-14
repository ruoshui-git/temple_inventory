# Design-preview usability follow-up progress

Date: 2026-10-13

Status: V1–V3 implementation and automated verification complete. Native browser
zoom and final user visual approval remain manual review. No subagents. Scope: V1–V3 and the
follow-up verification gate in [the handoff](20261013_DESIGN_PREVIEW_USABILITY_HANDOFF.md).
Existing staged implementation and audit-note moves must be preserved.
Production migration remains pending; no production/backend changes are authorized.

## Initial checkpoint (historical)

- Read repository guidance, UX decisions, design-system notes, capability ledger,
  preview README and handoff. Inspected the prior browser-audit scripts/evidence.
- Confirmed V1: item identity competes with controls inside a narrow side rail;
  explicit allocation/action column placement survives narrow layouts.
- Confirmed V2: broad label rules override toolbar checkbox/search presentation;
  native fields and searchable selectors use different spacing/control sizing.
- Confirmed V3: auto-fit permits three creation columns; supporting creation
  remains inside individual grid cells.
- Next: restructure the shared rows, introduce explicit field patterns, isolate
  supporting-record editors into full-width creation sections, then run focused
  interaction tests, type-check, isolated build and requested browser geometry checks.

## Initial verification checkpoint (historical)

No checks have run for the follow-up yet. Prior handoff results are historical.
The isolated preview listener at 5174 must be inspected/reused; do not stop an
existing process. Browser checks are included in the user-requested handoff
follow-up gate. Native zoom and manual fidelity approval must be reported
separately from automated geometry/interaction checks.

## Resumed checkpoint

The previous turn reached the usage limit during approval review for a browser
rerun. The action was not executed; this was an approval-service usage failure,
not an unsafe-action finding. Continue from the current unstaged changes over
existing staged work; do not reset or stage unrelated files.

Implemented so far:

- Full-width structural item headings, allocation grids with no explicit second
  column, adjacent allocation actions, responsive summary reflow and a compact
  complete-draft count/totals summary with a detail disclosure.
- Shared explicit stacked/inline/choice field classes; normalized native control
  heights, searchable-selector label spacing and adjacent action alignment.
- Creation capped at two columns; full-width supporting category/unit editors
  remain inside the same form/dialog using optional in-surface Teleport targets.
- `PreviewAllocationSummary` retains every line's identity, quantity, location,
  batch/expiry and settlement reference in disclosure and final confirmation.
- Three new interaction regressions cover full confirmation after filtering,
  supporting editor persistence, and new batch controls/stable IDs.

Verification before interruption:

- 172 existing preview tests across eleven suites passed; type-check passed for
  the earlier intermediate implementation.
- Three follow-up interaction tests passed after correcting a fixture batch-name
  expectation. Latest changes still require full focused suites/type-check/build.
- Initial eight-case browser inspection completed without captured page errors.
  Viewed compact desktop and 390px screenshots directly. Identity/field width
  improved, but roomy/text-scaled layouts still needed measurement and refinement.
- Comprehensive browser script `/tmp/temple-inventory-usability-followup/verify.cjs`
  stopped on its incorrect close-button accessible-name locator. Locator corrected
  to `关闭对话框`; rerun is now in progress. No complete matrix pass claimed.

Next: inspect matrix failures, finish geometry/interaction review, run final checks,
update all durable records and append final status/evidence to the handoff.

## Verification checkpoint before final documentation

- Final shared movement/creation matrix: **225 geometry records**, all 45
  combinations of 375/390/768/1024/1440px × compact/balanced/spacious ×
  100/150/200% text. Ordinary Receive, canonical Receive, both 50-item variants,
  and contextual creation measured. No reported page overflow, squeezed identities,
  phantom allocation columns, field-row misalignment or missing allocations.
- Populated all nine movement kinds and expanded optional context/conversion
  panels at 1440px; **96 supplemental measurements**, including all 70 indexed
  routes, passed without page exceptions. Populated full-matrix extension is
  running, including active alternate-unit entry, manual time and activity creation.
- **39 browser interaction assertions passed**: hidden first-invalid focus,
  375×700px Tab/Shift+Tab visibility above fixed summary/navigation, one-overlay
  creation across resize, supporting input/pending selection retention, multi-add
  quantity preservation/focus, replacement creation wording, Escape restoration,
  focused text scaling, dashboard section retry and reduced motion.
- Six-case final shared-style smoke: **30 geometry records**, passed after the
  close-button wrapping and report/native field refinements.
- Latest focused suites: **176 tests across 12 files passed**. Final TypeScript
  check and isolated build passed (**115 modules**, output only under `/tmp`).
  Prettier check and `git diff --check` passed.
- Representative final screenshots inspected directly: 1440px/150% sample,
  desktop/mobile 200% creation, populated Transfer. Earlier desktop compact and
  390px screenshots were also inspected. Large-text mobile close-label squeezing
  found by screenshot review was repaired and the six-case smoke rerun.

Temporary scripts/results/screenshots remain in
`/tmp/temple-inventory-usability-followup/`. No native browser zoom pass or user
visual approval is claimed. Test results establish fixture behavior, and geometry
checks establish measured layouts; production migration remains unauthorized.


## Final delivery and verification

V1, V2 and V3 are implemented. Existing staged changes and note moves were
preserved; no subagents, backend changes, production build or account-setting
changes were used. All follow-up changes are in preview-owned source, tests and
the requested documentation.

- V1: ordinary tracked Receive approximately **223px** high (target approximately
  220px), first long-name/two-allocation sample group approximately **340px**
  (target at most approximately 360px), at 1440px/balanced/100%. These are observed
  heights, not fixed CSS constraints. At 150%, the sample group is approximately
  475px instead of the earlier 1,988px. Fields use editor width, required inputs
  stay visible and all 55 allocations stay mounted. Mobile summaries retain
  item/allocation counts; details remain available at full confirmation.
- V2: stacked, inline and choice patterns replace the broad form-label override.
  Toolbar controls align; native and searchable fields share gaps/control sizing.
  Related activity/loan actions align with their input row. Reports no longer
  apply text-input sizing to checkboxes. Optional and active conversion fields
  were included in populated checks.
- V3: at most two creation columns, reflowing to one with available width/scaled
  text. Expanded category/unit editors occupy the full form width inside the same
  dialog. Existing selection remains a drawer; desktop creation stays centered,
  mobile stays full screen. Pending choices, item/unit/category inputs, scroll,
  creation wording and focus behavior are preserved.
- Four focused regressions cover sample/ordinary-draft separation, full summaries
  and confirmation despite filtering, supporting-record/input persistence across
  transitions, and batch addition/removal with stable IDs and required controls.
  Confirmation includes code, quantity/unit, locations, batch/expiry, production
  date/reason and settlement provenance/outcome.

Automated checks from `frontend/`:

```sh
pnpm exec vitest run tests/design-preview-usability-followup.test.ts tests/design-preview-usability.test.ts tests/design-preview-refinement.test.ts tests/design-preview-completion.test.ts tests/design-preview-forms.test.ts tests/design-preview-erpnext.test.ts tests/design-preview-navigation.test.ts tests/design-preview-review.test.ts tests/design-preview-audit-fixes.test.ts tests/design-preview.test.ts tests/design-preview-pages.test.ts tests/design-preview-browse.test.ts --maxWorkers=2
pnpm type-check
pnpm design:build
```

**176 tests across twelve suites passed.** The four follow-up tests were rerun
and passed after adding production-date/reason assertions and awaiting the
reactive update before taking their summary snapshot. Final type-check and
isolated build passed, with **115 modules** built only under
`/tmp/temple-inventory-design-preview`. Prettier check and `git diff --check`
passed. No generated production files were modified.

Browser evidence was captured with Playwright/system Chromium headless and
Chinese fonts, reusing the existing 5174 listener. No existing server was stopped.
All checks used local fixtures and isolated browser state.

| Check | Actual result |
| --- | --- |
| Shared editor/creation matrix | 225 geometry records across all 45 requested width/density/text combinations, zero reported failures/page exceptions |
| Populated movements | 1,540 geometry records across all nine kinds and all 45 combinations, including expanded optional context and active alternate units; manual time/activity creation at each width; zero reported failures/page exceptions |
| Indexed routes/secondary fields | 96 supplemental records including all 70 indexed routes at 1440px/100%; zero reported failures/page exceptions |
| Final shared-style smoke | 30 records at 375/768/1440px, balanced, 100/200%; zero reported failures/page exceptions |
| Keyboard/retained state/dashboard | 39 assertions passed, including 375×700px focus visibility, Tab/Shift+Tab, Escape restoration, resize/input/selection retention, focused text-scale change, local retry and reduced motion |

The populated Return audit fixture initially omitted stock UOM because the loan
fixture stores its unit on the Item. Its unit was corrected and its 45-case layout
rerun is recorded separately below. This was an audit-fixture correction, not a
preview data-model change.

Temporary evidence: `/tmp/temple-inventory-usability-followup/`, with
`matrix.cjs`/`matrix.json`, `populated-matrix.cjs`/`populated-matrix.json`,
`supplemental.cjs`/`supplemental.json`, `interactions.cjs`/`interactions.json`,
`final-smoke.cjs`/`final-smoke.json`, `return-matrix.cjs`/`return-matrix.json`, and
screenshots named by route/width/density/text. Earlier script runs stopped on
incorrect audit locators or inactive module fixture mutation; those runs are not
claimed as passes. Final scripts use active editor fixture state and visible
surfaces, excluding hidden gallery/canonical examples from row counts.

Representative screenshots were directly inspected: desktop compact and balanced
samples, 390px sample, desktop 150% sample, desktop/mobile 200% creation, populated
Transfer and mobile Return. Screenshot review caught the mobile close-label
squeezing; the label now retains its full width. Screenshots/results under `/tmp`
are temporary; the links and method here remain the durable reproduction record.

Review URLs:

- Ordinary: http://localhost:5174/design-preview.html#review/movement-form%2FReceive
- Canonical: http://localhost:5174/design-preview.html#review/local/receive
- Valid large receipt: http://localhost:5174/design-preview.html#review/movement-form%2FReceive-50
- Invalid large receipt: http://localhost:5174/design-preview.html#review/movement-form%2FReceive-50-invalid

### Remaining manual review

- Native browser zoom at 200%, separately from the in-app text scale. Headless
  viewport/DPR/pinch emulation is not claimed as a native zoom check.
- User visual approval against the intended reference, real devices, other
  browser engines and exhaustive hidden/conditional gallery states.
- The earlier full dashboard hover/action-state checklist remains a manual
  review item; browser checks here covered local section failure/retry and reduced
  motion, while the unit suite covers every section's state behavior.

To reproduce: use the four URLs, select the requested density and text size in
review controls, collapse those controls, inspect the first visible shared-editor
row and creation transition, and repeat the widths listed above. Review the
invalid fixture through early/middle/last errors and the compact summary through
its detail disclosure and confirmation. Test native zoom separately. Stock is
still a fixed fixture snapshot; production migration remains pending.

Corrected Return verification completed: **90 records** across its 45
width/density/text combinations, zero reported failures/page exceptions, with
quantity units taken from the Item fixture. Final 39-case interaction audit was
also rerun successfully after keeping mobile summary counts visible. The final
four-test follow-up suite passed; final type-check/build passed after all source
changes. No outstanding implementation or automated-check failures remain.


## Independent follow-up review — 2026-10-14

Reviewed V1–V3 against the handoff without subagents. The main compact-row,
field-pattern, and adaptive-creation repairs are present. The following remaining
gaps were repaired in preview-owned source:

- Unsaved category/unit input now participates in the picker discard decision,
  including closing from the selection surface or committing pending items.
  Item creation cannot silently abandon unfinished supporting-record edits.
  Saving or explicitly cancelling a supporting editor clears its dirty state;
  already-created catalog records remain intact.
- Opening a supporting editor focuses its name input. Saving/cancelling restores
  focus to its creation trigger instead of leaving focus on a removed control.
- Canonical Receive now uses the same complete allocation confirmation as routed
  forms: automatic batch labeling does not hide expiry, and manufacturing dates,
  item codes and entered alternate-unit quantities remain visible alongside stock
  quantities. Canonical summary counts distinguish items from allocations and
  count actual draft locations, including newly created locations.
- Required markers stay in the label's text row in canonical Receive and the
  component gallery, removing an extra grid row that offset their inputs.

Actual verification for this review:

- **180 tests passed across 12 focused preview suites**, including eight follow-up
  cases (four additional regressions). The earlier 176-test baseline also passed
  before repairs. The full command is the twelve-suite command recorded above.
- `pnpm type-check`: passed. `pnpm design:build`: passed, 115 modules, output only
  under `/tmp/temple-inventory-design-preview`. No production build was run.
- Repeated the browser layout smoke: **30 geometry records**, balanced density,
  widths 375/768/1440px and text 100%/200%, covering ordinary/canonical Receive,
  both 50-item samples and creation. No reported layout failures/page exceptions.
- Four additional Playwright scenarios passed: category-only and unit-only dirty
  close protection with keyboard focus restoration; canonical automatic-batch
  expiry confirmation; gallery required-marker/input alignment. No page exceptions.
- Directly inspected desktop compact-row, mobile 200% row, expanded desktop
  category-creation, and canonical-confirmation screenshots. The 1440px balanced
  first two-allocation group remains approximately 340px tall.
- Source/test formatting and `git diff --check` passed. Staged work and unrelated
  audit-note moves were preserved.

The previous listener was no longer available (`ERR_CONNECTION_REFUSED`); started
an isolated Vite listener on 127.0.0.1:5174 for this review. Browser scripts and
results are in `/tmp/temple-inventory-usability-review/` (`smoke.cjs`,
`final-smoke.json`, `regressions.cjs`, `regressions.json`, and screenshots). These
are temporary evidence. The prior implementer's full matrix results remain
historical; this review reran the focused cases above, not the complete matrix.

No remaining implementation failures were found in the reviewed scope. Native
browser zoom, final user visual approval, other browser engines and the earlier
full dashboard visual-state checklist remain manual review. At large mobile text
sizes the bounded fixed summary scrolls internally to reach all controls; this
review does not claim all actions fit simultaneously in a short viewport.
Production migration remains pending and no account/backend changes were made.
