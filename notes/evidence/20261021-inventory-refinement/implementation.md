# 2026-10-21 inventory refinement implementation evidence

This note records code and test evidence for the approved picker, image, recovery,
expiry, and sample-seed changes. It is not a visual acceptance record; the root
agent performs the separately authorized browser review.

## Behavior and focused regression coverage

- `catalog.picker_rows` flattens Item/location stock, applies paging after flattening,
  and returns an inbound stockless Item per authorized target leaf. Backend
  regression: `test_picker_rows_page_flattened_warehouses_and_include_stockless_receipts`.
  It asserts exact single-location quantities and that two batches with quantities
  4 and 6 become one location row totaling 10 with both batch choices preserved.
- Expiry-only Batch records keep an omitted manufacturing date blank, can be
  received, and reject a genuinely reversed manufacturing/expiry pair.
  Backend regression: `test_expiry_only_batch_keeps_blank_manufacturing_date_and_can_be_received`.
- Native recovery preserves create request identity, durably stores recovered
  input before retiring its prior browser entry, and leaves a changed competing
  tab snapshot intact. Item recovery also keeps its source entry when replacement
  persistence fails. Regressions are in `frontend/tests/native-editor.test.ts` and
  `frontend/tests/native-item-editor.test.ts`.
- Picker account changes discard stale results, receiving-purpose/target changes
  reload rows, and discarding a dirty item draft completes the pending row choice
  exactly once. Recovery summaries resolve sanitized local rows by code and do not
  display native child-row IDs as item names. A newly created item stays visible
  above filtered results with its warehouse path and fixed 48px cover preview;
  the picker regression confirms the preview remains compact after a non-matching
  search.
- Cropper.js 2.3.1 provides a keyboard-adjustable square selection, original
  choice, explicit original attachment choice, and capped WebP output. The crop
  UI regression uses a mocked Cropper selection and verifies emitted files. Crop
  geometry tests ensure the selection remains inside the transformed image after
  zooming out.
- Sample setup puts non-costume samples in sibling sample locations, keeps
  costumes in T2 with Nos units, separates costume receipt, and removes only an
  empty initializer-owned physical `通用库房` leaf.

## Validation status

Frontend checks passed after the review fixes: `pnpm exec vitest run` (79 files,
545 tests), `pnpm type-check`, and `pnpm build`. Targeted Prettier formatting and
Ruff formatting/linting pass for changed source files. The rollback-only native
integration runner passed all 140 tests; its before/after audit matched for
settings, warehouses, Items, and Stock Entries (50 warehouses, 164 Items, and 58
Stock Entries). It includes exact flattened picker aggregation and expiry-only
receipt with a past expiry date and blank manufacturing date. The guarded reset
of `development.localhost` completed successfully, and sample verification
passed for 164 Items, 96 costumes using Nos, 114 costume images, native balances,
count review, and schema.

Root completed independent desktop, short-desktop, breakpoint, phone and 200% text
checks, plus live Item creation, private-file byte verification, expiry-only receipt
submission and cancellation. Browser findings were corrected and rechecked. The
final guarded cleanup reset restored the intended samples with no acceptance Items
remaining and preserved Administrator authentication. See [review.md](review.md)
for the acceptance details and screenshots.
