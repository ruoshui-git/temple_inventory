# Outstanding-loan and browse refinements — review

Implemented by the Luna agent and independently reviewed against the approved
plan. The review found and repaired the Inventory sticky-heading focus helper
interrupting return-to-top, empty settled-item histories, dropped scoped return
events, incomplete Damage event handling, and report/export integration gaps.

## Delivered behavior

- Return-to-top appears after 160px and scrolls the active owner to zero on both
  desktop and mobile, with a 44px target and heading focus.
- Expiry separates Item and Batch columns, bounds all thumbnail states to 44px,
  and shows stock quantity once with loaned/damaged context where applicable.
- Thumbnail enlargement uses a centered SVG in a smaller badge.
- Movement item contributions are grouped before pagination and show record,
  timestamp, type, warehouse pair and quantity/unit.
- Loan Items show outstanding quantities, optionally include settled Items, and
  expose per-card `未结清借用 / 全部相关记录` history. Signed native events explain
  the balance; inaccessible history is explicitly marked incomplete. Reports
  and export previews use the same Item population.
- Shared editable Item barcode fields support scanner capture and manual entry,
  preserve leading zeros/case, deduplicate additions and retain normal Save.

## Code verification

Luna completed frontend type checking, production build, Prettier and Ruff.
All 359 frontend tests passed with a 10-second per-test timeout. The default
5-second run timed out in the large-fixture tests; these passed in the longer
full run. The rollback-only native inventory suite passed all 96 tests, including
the added loan-history scenarios. Focused loan integration tests also passed.

## Independent browser verification

Chromium checks exercised the built production bundle at 1440px and 390px.
Controlled API responses covered missing/failed/loaded thumbnails, exact badge
centering, simplified columns, settled cards, history scope and barcode append.
All 12 recorded checks passed after the review repairs.

Real `development.localhost` acceptance used the authorized Administrator login,
real APIs, private images and existing stock records. The 17 recorded checks
passed: Dashboard, Inventory, Expiry and Movement return-to-top; responsive
surfaces without document overflow; loan/history and report population agreement;
submitted-only report controls; and the export table chooser. The sample loan
Item had 19 outstanding units and five effective history rows whose signed sum
was 19. Loan return-to-top on a longer result list was covered by the controlled
browser run. No uncaught page errors were reported.

Screenshots were also captured with a local Chinese font for visual inspection.
Only the font response was overridden during those live captures; application
APIs remained real. Review artifacts and browser scripts are under
`/tmp/ti-outstanding-review/` (temporary, outside the repository).

No database reset or persistent stock edits were needed. Physical-device camera
decoding was not tested; barcode append/manual entry and scanner lifecycle were
covered by browser interaction and component/service tests.
