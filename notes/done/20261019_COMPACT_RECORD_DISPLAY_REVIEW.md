# Compact record displays — independent review

Implemented by Luna and independently reviewed against the approved follow-on
plan. The previous uncommitted browse/loan refinements remain included.

## Result

- Expiry images sit beside Item names in one column; Batch remains separately
  sortable. Loaded, missing and failed thumbnails retain the same bounds.
- Shared typed history tables replace schema-driven record tables in Movement
  expansion and Item, Loan, Batch and Warehouse details. Item loan records show
  selected-item borrowed/outstanding quantities, rather than whole-document totals.
- Stock-effect row tints and quantity colors use aggregated native effects and
  the authorized warehouse scope. Loan-balance signs remain separate. Desktop
  cells use 6px/10px padding; mobile controls retain 44px targets.
- Recovery displays use Chinese summaries and quantity tables, preserving blank,
  zero, false and negative values. The complete unchanged payload remains
  copyable, with a selectable fallback when clipboard access fails.
- Activity cards use readable labels and formatting. Loan allocation displays
  retain meaningful batch/conversion information without child-row IDs. Export
  and its previews retain their audit-oriented presentation.

## Repairs found during review

Independent inspection caught missing count rows when recovery contains both an
empty `items` array and populated count review rows; stale/permission handling;
ineffective contribution retries; remaining schema-driven Loan card rendering;
misaligned table-cell borders; unwired Item/Loan links; and incorrect stock-effect
scope when narrowing an inherited warehouse group to a child. These were repaired
and covered by focused regression checks before signoff.

## Code checks

- Latest full frontend suite: **368 tests passed**.
- Subsequent targeted repair checks: **33 tests**, then **12 tests**, passed.
- Type checking, production build, touched-file Prettier/Ruff and diff checks
  passed after the final repairs.
- Final rollback-only native inventory suite: **97 tests passed**, including
  child/group transfer and reconciliation effects, filtered loan completeness,
  grouping/pagination, and selected-item quantities.

## Browser checks

Chromium exercised the actual production bundle at 1440px and 390px, plus 200%
text at 390px. Controlled records verified increase/decrease/neutral/draft rows,
cell padding and alignment, mobile touch targets, horizontal containment, expiry
image placement, loan-balance neutrality, and encoded Batch-to-Loan navigation
with the return path preserved.

Routed recovery checks verified real count-value shapes, translated states,
pending-file notices and exact clipboard-failure payloads at both widths.

Authorized Administrator login against `development.localhost` verified **10
live contextual history checks** across Movement, Item, Loan handling, Batch and
Warehouse at desktop/mobile widths, including Item/Loan record navigation. Native
APIs and existing private images were real; only a local Chinese font response
was supplied for readable screenshots. No uncaught page errors or horizontal
document overflow were observed in those checks.

Temporary scripts, measurements and screenshots are under
`/tmp/ti-compact-review/`. No database reset, stock edits or commit were performed.
