# Task: Complete and Deploy Inventory, Expiry, and Handler Audit Changes

## Goal

Finish the previously requested inventory browsing, pending-item explanation,
batch-expiry page, and handler/witness audit workflow as one coherent change.
The work is complete only when the source, backend schemas, generated frontend
bundle, migrated site, and browser-visible behavior all agree.

Do not reset or reinstall `development.localhost` without explicit user
confirmation. Preserve all unrelated working-tree changes, especially the
existing sample-data, costume manifest/importer, and desktop-icon edits.

## Confirmed diagnosis

1. The browser is serving stale generated assets. The files under
   `temple_inventory/public/frontend/` were built around 2026-09-19 17:45,
   while the edited Vue sources are from about 18:45–18:48. The built
   Workspace bundle still contains `记录人`, `负责人`, `鉴证说明`, and the old
   borrower checkbox. There is no built Expiry chunk.
2. The source implementation is incomplete, so rebuilding it as-is is not a
   valid fix:
   - `Workspace.vue` only changes some labels. It still uses
     `responsible_person`, `recorder_signature`,
     `borrower_same_as_reviewer`, and `reviewer_note`.
   - `handler_name`, `handler_signature`, and
     `borrower_is_handler_or_witness` do not exist in Workspace, Stock Entry,
     Loan/Return/Loss schemas, API serialization, validation, or history.
   - The handler remains restricted to an enabled system User instead of being
     free-text.
   - The loan checkbox behavior, conditional borrower field, validation, and
     return/loss compatibility are not implemented.
   - The inventory category selector renders only `全部`; it never renders the
     bootstrap item groups.
   - `/expiry` exists in source routing, but there is no homepage link to it.
   - The new expiry API/UI has no focused backend tests and lacks the planned
     group-stock diagnostic parity and pagination controls.
3. Current development data is invalid for the canonical warehouse model:
   non-zero stock is held directly in room warehouses that are now groups, and
   sample installation is stuck at `Installing`. The inventory endpoint now
   reports this instead of silently returning an empty list. This data problem
   requires a separately approved disposable-site reset; it must not be hidden
   by allowing stock in group warehouses or by directly editing Bin/SLE rows.
4. Even after a correct build, the installed PWA may continue showing an old
   service-worker-controlled bundle until the update is accepted and the app is
   reloaded/closed and reopened.

## Required implementation

### Inventory and pending pages

- Keep `inventory(search, warehouse, item_group, needs_attention)` permission
  checked and restricted to visible leaf warehouses.
- Populate both warehouse/location and item-group selectors from bootstrap;
  use full warehouse labels and allow a room selection to include descendant
  leaf locations.
- Show per-location quantities on inventory cards/details.
- Keep the Chinese pending-page explanation and structured reason badges for
  unlocated quantity, missing description, and conditionally required photo.
- Detect non-zero group-warehouse balances consistently in inventory and
  expiry endpoints and return a clear Chinese administrator-facing error.
- Add backend tests for filters, reason codes, leaf-only behavior, and invalid
  group stock.

### Expiry page

- Add a visible homepage `有效期` link to `/expiry`.
- Return only positive current batch stock with a non-empty expiry date, using
  ERPNext batch/stock data as the source of truth.
- Apply warehouse and item-group filters before aggregation. Aggregate one row
  per batch, with expandable warehouse quantities.
- Support search, expiry range, ascending/descending expiry sorting, and real
  pagination (default 50) in both API and UI.
- Calculate `days_to_expiry` from the server date; display future days, today,
  and red negative overdue days.
- Add focused tests for multi-location aggregation, filters, sorting, expired
  values, zero-stock exclusion, permissions, and pagination.

### Handler, witness, and borrower audit model

- Add structured fields `handler_name` (Data), `handler_signature`
  (Signature), and `borrower_is_handler_or_witness` (Check) to Inventory
  Workspace, Stock Entry custom fields, and applicable Loan/Return/Loss
  records. Register any required versioned migration/backfill in `patches.txt`.
- Keep `recorded_by` immutable and server-controlled. Show it only as muted
  `系统记录用户：…` text below the primary action.
- For every movement, render and validate this visible order:
  1. 经手人 (required free text)
  2. 经手人签名 (required)
  3. 无独立鉴证人 (default unchecked)
  4. 鉴证人 and 鉴证人签名 when an independent witness is required
- Remove 负责人, visible 记录人, 鉴证说明, and the system-user handler selector
  from the volunteer form. Make SignaturePad labels configurable and
  accessible.
- For Loan, place `借用方是经手人或鉴证人` above 经手人 and outside the
  optional-details panel. Default it checked. When checked, hide and clear the
  independent borrower and store only the declaration; when unchecked, show
  and require borrower.
- Update server validation, Stock Entry synchronization, business-record
  creation, history serialization/filtering, confirmation summaries, and
  signature invalidation together. Never rely on frontend visibility.
- Return/loss and remaining-loan prompts must follow Loan Item links rather
  than borrower text, so an unspecified borrower still works.
- Retain legacy fields for reading old records. Old submitted records remain
  unchanged and readable; old drafts must collect the new required audit data
  before confirmation.

### Sample installer guard

- Before marking sample installation `Installed`, assert that every non-zero
  balance under the configured root is in a leaf warehouse. Fail with a clear
  diagnostic if not.
- Do not weaken the canonical leaf-warehouse invariant and do not directly
  rewrite ERPNext ledgers.

## Validation and deployment

1. Run focused backend tests, including all nine movement kinds and the new
   inventory/expiry cases:
   `bench --site development.localhost execute temple_inventory.tests.test_workspace.run`
2. From `frontend/`, run `yarn test`, `yarn type-check`, and `yarn build`.
3. Confirm the build produced a new Expiry chunk and that generated bundles no
   longer contain the obsolete volunteer-facing labels.
4. Run `bench --site development.localhost migrate` after schema/fixture
   changes, then clear applicable Frappe caches.
5. In the browser, accept the PWA update if prompted, hard reload, and if
   necessary close/reopen the installed PWA. Verify that the active service
   worker serves the newly generated asset hashes.
6. Do not run Playwright unless separately requested.
7. Do not run `reset-development-samples` until the user explicitly confirms
   permanent deletion of the disposable site database. After confirmation,
   reset and verify: status `Installed`, all non-zero stock in leaf warehouses,
   inventory results visible, and expired/future batches present on 有效期.

## Acceptance criteria

- 查看库存 shows valid leaf-location stock and filters by location and category.
- 待处理 explains its meaning and shows exact per-item reasons.
- 首页 links to 有效期; expiry rows aggregate batches, expand locations, filter,
  sort, paginate, and show negative overdue days in red.
- Every movement uses the requested 经手人/鉴证人 format and persists the new
  audit fields server-side.
- Loan defaults to the borrower declaration, conditionally shows borrower, and
  remains returnable/loss-trackable without borrower text.
- The system login is immutable audit metadata, not the responsible person.
- Old submitted records remain readable without semantic relabeling.
- Source, DocType schemas, fixtures, tests, generated assets, migrated site,
  and browser-visible PWA all reflect the same implementation.
