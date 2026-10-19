# Browse standardization implementation and review

Implemented with the requested Luna subagent, followed by independent source,
backend and visual review. Durable UX decisions are in `UI_UX_DECISIONS.md`.

## Delivered behavior

- Stock, Expiry, Movement and Loans use complete desktop filter sidebars/mobile
  drawers, shared field/direction sorting, and non-sticky quantity summaries.
- Tab rows retain their height during loading, refresh and reduced viewports.
  Long filter labels scroll within their own hierarchy sections.
- Movement quantities group by type in canonical order; units and document
  statuses stay separate. Loan records distinguish planned, outstanding and
  cancelled quantities. Plain 明细 terminology replaces allocation jargon.
- Default warehouse leaves have explicit native metadata. Daily views show the
  room name; management shows 无货位. Duplicate rooms use authorized ancestor
  context. Loan stock uses the single configured 借出 leaf, with T1/T2 seeds.
- Clearing editable filters retains inherited record/item/location restrictions.

## Verification

- Frontend: 337 Vitest tests across 51 files, type-check and production build.
- Backend: 93 rollback-only native inventory integration tests, all passing.
- Browser: 18 new loaded-result/filter regressions plus 8 existing header,
  hierarchy and scroll-state regressions, all passing. Coverage includes 200%
  app text and an effective CSS viewport corresponding to 200% browser zoom.
- Live production build: normal login against the reseeded Frappe site; all six
  browse surfaces checked at 1440px and 390px, plus warehouse management.
  No uncaught page errors. Temporary review session logged out successfully;
  temporary server stopped. Password and session material are absent from evidence.
- Targeted Ruff formatting/checks and `git diff --check` passed.

The first post-reset integration attempt overlapped normal HTTP login writes and
hit a `tabUser` database conflict. The complete isolated rerun passed all 93 tests.

## Development reset

The user explicitly authorized deleting the entire `development.localhost`
database and reseeding it. The guarded reset completed with 164 items, 16 sample
transactions, private media and verified native stock balances. Existing native
Administrator authentication was preserved by the reset script. Production data
was not changed. Sample verification was repeated after integration testing.

## Selected live screenshots

- [Movement desktop](assets/20261018-browse-standardization/movements-items-1440.png)
- [Movement phone](assets/20261018-browse-standardization/movements-items-390.png)
- [Expiry desktop](assets/20261018-browse-standardization/expiry-1440.png)
- [Stock filter sidebar](assets/20261018-browse-standardization/stock-1440-filters.png)
- [Loan filter drawer](assets/20261018-browse-standardization/loans-records-390-filters.png)
- [Warehouse tree](assets/20261018-browse-standardization/warehouses-1440.png)
