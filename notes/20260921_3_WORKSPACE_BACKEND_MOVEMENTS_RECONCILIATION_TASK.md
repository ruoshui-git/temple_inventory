# Task 3: Workspace Backend — Movements, Signatures, Attachments, and Reconciliation

## Assignment

This is the complete handoff for the agent that owns transaction-workspace and
movement backend behavior. Read
`20260921_1_WAREHOUSE_ABSTRACTION_AND_DETAIL_UX_TASK.md` for the locked product
design, but implement only the scope below.

Primary ownership:

- `temple_inventory/workspace_api.py`;
- workspace DocTypes/controllers and narrowly related versioned patches;
- `temple_inventory/file.py`, attachment hooks, and workspace permission helpers
  where the lifecycle requires changes;
- movement/history/detail and reconciliation server tests in a focused module;
- compatibility exports in `temple_inventory/api.py` only when required.

Do not edit `inventory_api.py`, Vue pages, components, or global CSS. Task 2 owns
warehouse/expiry/loan APIs; consume its warehouse resolution contract rather
than reimplementing it. Coordinate an explicit handoff for any crossed file.

## Outcomes

1. Signatures remain stored and visible after edits/autosave while the server
   distinguishes valid, stale, re-confirmed, and absent attestations.
2. History and movement detail provide complete permission-filtered information,
   exact facets/totals, deterministic paging, and bounded hydration.
3. Workspace, movement, and reconciliation attachments have complete private
   File authorization and immutable completed-record behavior.
4. Reconciliation capability, autosave, historical expected set, submission,
   and recovery are correct at every lifecycle boundary, including exactly-once
   behavior through the post-submit linkage failure window.
5. The workspace-side remainder of
   `20260920_11_REMAINING_COMPLETION_AND_REGRESSION_GAPS_TASK.md` is proven by
   integration tests.

## Shared boundary

Freeze representative request/response fixtures before changing behavior so the
cross-app frontend agent can work concurrently.

### Signature validity contract

Each required signer stores structured state equivalent to:

```json
{
  "image": "data:image/png;base64,...",
  "attested_digest": "sha256:...",
  "current_digest": "sha256:...",
  "status": "valid",
  "confirmed_at": "2026-09-21 12:00:00",
  "confirmed_by": "user@example.com"
}
```

Allowed statuses are `absent`, `valid`, and `stale`. The client may display
`reconfirming`, but that is not durable server truth.

Canonical business content includes, in stable order and normalized form:

- movement/reconciliation kind and posting date/time;
- item identity, quantity, UOM, batch, and row ordering-independent identity;
- source/destination real leaf Warehouses;
- activity, source/donor, purpose, borrower/recipient, responsible person, and
  other accountable declarations; and
- reconciliation scope, expected identities, counted values, and applicable
  valuation/account/cost-center prerequisites.

Exclude revision numbers, autosave timestamps, File metadata, UI state, and
other non-business fields. Define the exact serializer once and test key-order,
null/empty, decimal, time, and row-order behavior.

Server rules:

- drawing completion stores the image and attests the current digest;
- an ordinary autosave never clears the image;
- a later business-content change retains the image and changes status to
  `stale`;
- explicit re-confirmation binds the retained image to the new digest;
- explicit clear removes image and attestation metadata;
- completed records retain the submitted image and digest;
- required stale/absent signatures block final confirmation; and
- a conflict merge retains local drawing safely but requires confirmation
  against the resolved content.

Adding/re-confirming one signer must not stale an unchanged other signer.

### Movement list/detail boundary

Return canonical movement rows with:

- stable route identity and source DocType/name;
- primary mode/status/classification, including drafts and special types;
- posting timestamp and cancellation/amendment relationships;
- bounded item preview plus full line count;
- source/destination logical labels and real identifiers;
- UOM-grouped quantities, never summed across incompatible UOMs;
- handler/recorder, source/context, and permitted attachment evidence; and
- permission-aware Desk link capability.

Movement detail must support app-authored Workspace/Stock Entry and direct Stock
Entry/Stock Reconciliation records without hiding permitted lines.

## Workstream A — persistent, valid signatures

1. Remove backend normalization that erases signature images merely because
   editable content changed.
2. Add structured digest/status metadata using an appropriate existing DocType
   field, fixture-backed custom field, or narrowly scoped schema change.
3. Centralize canonical content serialization and use it at save, hydrate,
   re-confirm, conflict resolution, and final confirmation.
4. Preserve current optimistic revision and serialized autosave behavior.
5. Validate required signatures on the server immediately before stock document
   submission, not only in the client.
6. Update old tests that assert destructive clearing; replace them with
   persistence/staleness/re-confirmation tests.
7. Apply equivalent semantics to normal movement Workspace and Reconciliation.

## Workstream B — exact movement list, facets, and detail

1. Complete mutually exclusive primary modes, special classifications, Drafts
   routing, URL-compatible filters, exact totals, and stable tie-breaking.
2. Replace parent-document/child N+1 hydration with bounded joins or batched
   reads after database paging.
3. Implement exact permission-aware warehouse and Item Group facets. Empty
   placeholder facet objects are not completion.
4. Permission-scope candidates before aggregates so totals/facets cannot leak
   inaccessible document, Item, Warehouse, company, or File identities.
5. Complete detail hydration for direct and app-authored Stock Entry and Stock
   Reconciliation: all permitted lines, before/after/difference, audit context,
   attachments, cancellation/amendment links, and guarded Desk links.
6. Preserve canonical routes from History and Item Detail. Cover cancelled,
   amended, direct, draft, and beyond-cap records.
7. Provide a bounded latest-movements adapter usable by task 2's Warehouse
   detail without importing presentation logic. Agree on its request/response
   fixture; do not edit `inventory_api.py` concurrently.

## Workstream C — attachment lifecycle

1. Enforce authenticated DocType read/write permission, parent ownership,
   private File rules, company/User Permissions, and allowed lifecycle on every
   create/read/delete operation.
2. Completed Workspaces and submitted/cancelled stock records are immutable
   except through an explicit correction workflow.
3. Support multiple attachments and preserve standard Frappe File storage; do
   not create a parallel image/document store.
4. Primary-image behavior is Item-only. Workspace, Stock Entry, Stock
   Reconciliation, Loan, Return, and Loss attachments must never gain a
   `设为主图` backend capability.
5. Test File creation, private ownership, cross-user reads/deletes, parent
   permission, completion immutability, and direct-detail evidence.
6. Keep ordinary file upload and mobile camera capture metadata compatible; the
   frontend decides capture affordances.

## Workstream D — reconciliation correctness and exactly-once lifecycle

1. Enforce exact capability checks at bootstrap, deep link, first mutation,
   every scope-changing save, baseline refresh, and confirm.
2. Prove no draft is created on mount. The first meaningful edit creates or
   reuses exactly one idempotent draft, including concurrent/retried requests.
3. Use the existing serialized autosave/session-expiry/conflict contract and
   retain edits made while a save is in flight.
4. Lock the expected set to the historical posting timestamp. Whole-location
   mode requires an explicit state for every expected identity.
5. Preserve and validate permitted new Batch/expiry behavior; make serialized
   Item behavior explicit rather than silently mishandled.
6. Complete changed/unchanged review, unresolved-conflict counts, valuation,
   account, and cost-center prerequisites, plus counts-preserving refresh.
7. Make confirmation idempotent across the failure window where ERPNext Stock
   Reconciliation submits successfully but durable Workspace linkage has not
   yet committed. A retry must discover/link the same submitted document, never
   create a second stock effect.
8. Complete read-only detail, attachment evidence, History visibility, routing
   data, and shell-refresh response metadata.

## Test matrix

Prefer a dedicated module such as
`temple_inventory/tests/test_workspace_lifecycle.py` so task 2 does not edit the
same test file. Reuse existing setup helpers without moving unrelated tests.

### Signatures

- drawing completion, autosave, hydration, and non-business changes preserve
  the image and valid state;
- each business field class changes the digest and marks the image stale;
- reorder-only changes that are semantically identical remain stable where
  intended;
- re-confirm, redraw, clear, second signer, conflict merge, and completed record;
- missing/stale required signature blocks submit; and
- forged client digest/status cannot bypass server recomputation.

### Movements/history

- all primary/special types, drafts, direct/app-authored records, cancel/amend;
- exact totals/facets under company, Item, Warehouse, File, and User Permissions;
- stable adjacent pages and matches beyond historical caps;
- bounded item previews/full counts and incompatible UOM grouping;
- direct detail and reconciliation before/after/difference; and
- bounded SQL/query counts with no per-parent child reads.

### Attachments

- create/read/delete, private ownership, wrong parent, cross-user, completion,
  cancellation, direct detail, missing file, and malicious supplied owner;
- Workspace, Stock Entry, Stock Reconciliation, Loan, Return, and Loss; and
- no primary-image capability outside Item.

### Reconciliation

- capability loss at every boundary and scope change;
- mount creates nothing; concurrent/retried first edit yields one draft;
- in-flight edit retention, stale revision, session recovery, and conflict;
- historical expected set, every-identity completeness, new batches, serialized
  Items, repeated scans, and duplicate focus data contract;
- prerequisite failures and counts-preserving refresh; and
- injected failure after ERPNext submit but before linkage, followed by retry,
  proving one submitted Stock Reconciliation and one durable association.

Run the focused module, then from `frappe-bench/`:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If the aggregate helper does not discover the new module, document and run the
supported Frappe module command as well. Treat restricted `mariadb` DNS failure
as environment isolation, not an application result.

## Acceptance gate

- A signature never disappears due to signing, autosave, hydration, or ordinary
  editing; stale retained drawings cannot authorize submission.
- Movement totals/facets/details are complete, permission-safe, deterministically
  paged, and query-bounded beyond prior caps.
- Attachment create/read/delete and completed-record immutability are enforced
  for every owned parent type.
- Reconciliation creates one draft only after meaningful editing and exactly
  one submitted stock effect across retry/failure windows.
- The existing focused backend suite plus the new lifecycle tests pass.

## Non-goals

- Do not create a second transaction or attachment ledger.
- Do not edit ERPNext/Frappe core.
- Do not change warehouse presentation wording in this task.
- Do not implement frontend dialogs, scanner controls, toasts, or CSS.
- Do not weaken server checks because the current UI hides an action.
