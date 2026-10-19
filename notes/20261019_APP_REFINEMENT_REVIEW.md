# App refinements — implementation and independent review

Implemented by the requested Luna agent. The primary agent independently reviewed
the source/contracts, returned correctness and completeness findings for repair,
and ran the browser and visual acceptance checks.

## Delivered behavior

- Desktop controls, filters, forms and tables use shared density tokens. Mobile
  retains 44px touch targets and independent text scaling.
- Movement/Loan item-record switches remain beside the heading when tools collapse.
  Mobile primary navigation scrolls horizontally and includes 更多; secondary
  destinations keep their existing placement.
- Movement/Loan records show complete matching documents, including their complete
  unit-separated totals and record exports. Dates sort separately, source and
  destination have separate columns, and matching-line statistics/popups are removed.
  Loan records retain eligible return actions. Loan item cards show outcome totals
  and have one outcome filter.
- Movement quantities and Dashboard use native signed stock effects: green increase,
  red decrease, neutral zero/draft/cancelled. The default basis is available stock;
  an explicit warehouse selection includes all selected authorized leaves.
- Expiry uses the shared tabs/summary layout, independent thumbnail lightboxes and
  one explicit Batch link per result, on desktop and mobile.
- `/batch/:name` shows metadata, complete quantity summaries, paginated locations
  and native history. Permission-checked metadata editing uses native Batch saves,
  optimistic locking, retained input after errors, and unsaved-navigation guards.
  Exact `batchNo` query constraints replace fuzzy batch identity matching.
- Absent table values are blank; zero, false and meaningful states remain visible.
  Issue labels consistently say 出库.

Durable decisions are recorded in `UI_UX_DECISIONS.md` and `DESIGN_SYSTEM.md`.
No database reset, new ledger, compatibility adapter or Frappe/ERPNext core edits
were needed.

## Validation

- Luna: 345 frontend tests across 52 files; type-check; production build; touched
  source formatting including Ruff; `git diff --check`.
- Luna: 95 rollback-only native backend integration tests, including batch editing,
  authorization, date validation, stale versions, unchanged quantities, exact batch
  filtering, whole-document exports and stock-effect scope.
- Primary agent: 9 browser cases against the actual production bundle with controlled
  native HTTP contracts; desktop 1440px, phone 390px and 200% text.
- Primary agent: 50 responsive browser regressions covering all browse surfaces,
  320/375/390/768/1024/1440px layouts, native batch allocations, all density choices,
  enlarged text, effective 200% browser-zoom viewport, related loans, image cropping,
  filter/selection retention and deep-scroll header behavior. One final ambiguous
  warehouse-tree locator was corrected and its case rerun successfully; all 50
  scenarios passed across the final runs.
- Inspected the selected screenshots below. Browser review caught and repaired
  mobile Batch-link omission, inconsistent Expiry presentation, missing batch-summary
  spacing, and horizontal overflow caused by absolutely positioned screen-reader
  quantity labels escaping their table scrollport. Final production-bundle cases
  also assert computed decrease colors and document overflow containment.

The initial browser acceptance used controlled HTTP responses. The subsequent
[live-login acceptance](20261019_APP_REFINEMENT_LIVE_ACCEPTANCE.md) completed all
24 checks against real Frappe HTTP and production assets using the existing
Administrator account supplied by the user. No temporary account was created.
Logout/session invalidation and removal of the disposable zero-stock Batch and
private login file were verified. The temporary local Frappe server was stopped.

## Selected screenshots

- [Movement desktop](assets/20261019-app-refinement-review/movements-records-1440.png)
- [Collapsed Movement phone](assets/20261019-app-refinement-review/movements-collapsed-390.png)
- [Loan records desktop](assets/20261019-app-refinement-review/loans-records-1440.png)
- [Expiry desktop](assets/20261019-app-refinement-review/expiry-1440.png)
- [Batch desktop](assets/20261019-app-refinement-review/batch-detail-1440.png)
- [Batch phone](assets/20261019-app-refinement-review/batch-detail-390.png)
- [Retained batch edits after conflict](assets/20261019-app-refinement-review/batch-conflict-390.png)
- [Dashboard colors](assets/20261019-app-refinement-review/dashboard-1440.png)
