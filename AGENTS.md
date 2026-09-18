# Temple Inventory Agent Guide

## Scope and priorities

This file applies to the entire `temple_inventory` app. Follow it together with
the repository-level instructions, with this file taking precedence for this
app when guidance differs.

Keep changes focused on the requested behavior. Preserve unrelated working-tree
changes, avoid broad formatting-only diffs, and do not modify ERPNext or Frappe
core. Prefer extending the current model with structured fields and small custom
DocTypes over building parallel subsystems.

The volunteer-facing application is Chinese and mobile-first. Keep user-facing
copy in Chinese unless localization is explicitly part of the request. Preserve
touch-friendly controls, accessible labels and status messages, narrow-screen
behavior, direct camera capture where available, and non-camera fallbacks.

## Application map

- `temple_inventory/inventory_api.py` contains catalog, inventory, setup, scan,
  and general inventory endpoints.
- `temple_inventory/workspace_api.py` owns the durable transaction workspace,
  synchronization to ERPNext stock documents, confirmation, history, and
  workspace attachments.
- `temple_inventory/api.py` is a compatibility export surface and app-access
  permission entry point. Keep its exports working unless callers are
  deliberately migrated.
- `temple_inventory/hooks.py`, `stock.py`, `file.py`, and
  `workspace_permissions.py` enforce framework hooks, submission rules,
  attachment rules, and document-level access.
- `temple_inventory/temple_inventory/doctype/` contains custom DocType schemas
  and controllers. Data migrations belong in versioned patches; exported ERPNext
  custom fields live under `temple_inventory/fixtures/`.
- `frontend/src/pages/` contains routed Vue views; `frontend/src/components/`
  contains reusable interaction components; `frontend/src/lib/` contains API,
  autosave, and scanner infrastructure.
- Python integration tests live in `temple_inventory/tests/`. Frontend unit tests
  live in `frontend/tests/`; browser specifications live in
  `frontend/tests/browser/` but are not run by default.

Do not edit generated files in `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html` by hand. They are produced by the Vite
build.

## Inventory architecture invariants

### ERPNext is the source of truth

ERPNext/Frappe is the sole source of truth for inventory. Quantities must come
from ERPNext stock records, the stock ledger, warehouse balances, or standard
ERPNext APIs and reports. Never add a parallel stock ledger, current-quantity
table, duplicate item inventory, image store, or attachment store.

Use standard ERPNext stock documents for physical movements:

- Receive (stock in) -> Stock Entry / Material Receipt
- Issue or Loss (stock out) -> Stock Entry / Material Issue
- Transfer -> Stock Entry / Material Transfer
- Loan -> Material Transfer into a leaf warehouse beneath Leased
- Return -> Material Transfer out of the applicable Leased leaf warehouse
- Damage -> Material Transfer into the configured damaged leaf warehouse
- Future physical-count corrections -> ERPNext reconciliation or adjustment
  mechanisms

Use Purchase Receipt only for genuine purchasing workflows and Delivery Note
only for genuine customer or sales-delivery workflows. Do not use either merely
for categorization or reporting convenience.

### Workspace and stock-document lifecycle

`Inventory Workspace` is durable editing state for one user-facing operation.
The current implementation synchronizes a workspace to one draft `Stock Entry`;
the Stock Entry remains the authoritative stock document. Autosave may update
editable workspace state and its draft Stock Entry, but it must never submit or
commit stock. Final confirmation is an explicit user action that submits the
movement.

Preserve these lifecycle properties:

- Workspace creation is idempotent through `request_id`.
- Writes use optimistic `revision` checks and reject stale saves.
- Frontend autosaves are serialized and retain changes made during an in-flight
  save.
- The UI clearly distinguishes saving, saved, unsaved/error, conflict, and
  completed states.
- A signature is invalidated when transaction contents change.
- Submitted stock-affecting records and completed workspaces are not silently
  rewritten.
- Corrections use traceable, ERPNext-compatible cancellation, reversal, or
  reconciliation workflows.
- Session-expiry recovery preserves unsaved input and resumes safely after
  authentication.

A real-world operation can contain multiple items, rooms, and leaf warehouses.
Do not force the volunteer UX to mirror ERPNext's document layout. If a future
operation genuinely requires multiple ERPNext documents, link every underlying
document to the same durable logical operation. This is a future compatibility
constraint, not a requirement to replace the current one-workspace/one-entry
implementation without a concrete need.

### Structured, auditable context

Store values that will be filtered, grouped, reported, or queried in structured
fields, not only in Notes. This includes source type, donor/source, purpose,
activity, recipient or borrower, responsible person, and warehouse/location.
Notes are supplemental context.

`Inventory Activity` is contextual metadata and may be linked from multiple
inventory transactions. It does not change stock and is not an inventory
ledger. Do not introduce separate Donation, Distribution, or similar inventory
ledgers without a concrete requirement.

## Warehouse and item invariants

Stock may exist only in valid leaf warehouses. Group warehouses are
organizational nodes and must never directly hold stock. Validate every movement
against the configured company, temple root, visible warehouse tree, and allowed
leaf warehouses on the server.

`Warehouse Type` and `is_group` express different concepts:

- `Warehouse Type` describes physical meaning. `Room` is a physical room or
  storage area; `Location` is a shelf, rack, aisle, section, or similar place.
- `is_group` says whether a warehouse has children.

Do not infer Room versus Location from hierarchy depth or naming conventions.
`Leased` is an organizational group warehouse. Loaned stock belongs in leaf
warehouses below it, such as a program or general-loans warehouse. Borrower,
project, and activity identity belongs in transaction metadata and must not be
inferred from the warehouse name.

All categories use standard ERPNext `Item` records. Do not add separate item or
inventory engines for food, costumes, medicine, furniture, or other categories.
An Item Code identifies an item type or style, not an individual physical unit;
individual costume serialization is outside the current design. Use ERPNext
Batch tracking when batch or expiry handling is applicable. Store item images
through the standard Frappe File and ERPNext Item image fields.

## Transaction UX invariants

The custom UI translates volunteer concepts into valid ERPNext operations.
Volunteers should not need to understand Stock Entry purpose labels, DocType
navigation, batch-module navigation, draft/submitted terminology, or group/leaf
warehouse mechanics.

Preserve the transaction being entered when supporting data is missing:

- A newly created Item is immediately usable in the current transaction.
- A newly created UOM is immediately selected or available.
- A newly created Batch continues the same receiving flow.
- An unknown barcode offers Item creation with the barcode prefilled.
- Creating an Activity returns to and updates the current transaction.

Search, browsing, camera barcode scanning, and hardware-scanner/manual entry are
equivalent item-selection paths and must converge on the same workflow. Scanning
is not a separate inventory subsystem. Release camera resources when scanning is
paused, closed, or unmounted, and keep manual entry usable when camera access or
browser APIs are unavailable.

Visually group transaction lines by Room and Location. Do not default to an
unrestricted warehouse selector on every row. Receiving normally starts with
one destination location but may contain multiple location sections; stock-out
operations may draw from multiple source locations in one logical operation.

Transactions may have multiple attachments through Frappe's standard private
File attachments. Keep direct mobile camera capture where supported.
Responsible-person and handwritten-signature data belong with the transaction.
Signatures may be absent during editing but can be required before final
confirmation for accountable operations.

## Security and server-side rules

Never treat frontend visibility, disabled controls, or supplied JSON as
authorization. Whitelisted methods and document hooks must enforce:

- authenticated access and required DocType permissions;
- manager-only setup operations;
- company boundaries and Frappe User Permissions;
- item read/write access as appropriate;
- root, visible, allowed, and leaf-warehouse restrictions;
- attachment ownership, privacy, and completed-record immutability; and
- validation again at final submission.

Return errors through normal Frappe exceptions so `frontend/src/lib/api.ts` can
recognize authentication, CSRF, validation, permission, and revision-conflict
failures. Do not expose raw server HTML to the volunteer UI.

## Model and implementation choices

Prefer adding structured fields to an existing appropriate DocType. Create a
dedicated DocType only when a concept has its own identity, lifecycle, metadata,
or one-to-many relationships. Do not add abstractions or records solely because
a hypothetical future report might need them.

When changing a DocType or hook, update the schema, fixtures, patches, API
serialization, permissions, and tests together as applicable. Keep API payloads
backward-compatible unless the requested change includes a coordinated caller
migration.

Follow the configured formatting rules: Python uses tabs, double quotes, Ruff,
and a 110-character line length. TypeScript and Vue use the existing project
configuration. Format only touched code unless a broader reformat is explicitly
requested.

## Validation policy

Use proportionate, focused checks. Do **not** launch Playwright, Chromium, camera
emulation, or other browser automation unless the user specifically requests
browser tests. The user handles manual browser validation.

Run frontend commands from `frontend/`:

```sh
yarn test
yarn type-check
```

Run focused Vitest files when the change is narrow. Use `yarn type-check` when
TypeScript, Vue templates, API shapes, or component contracts change. Run
`yarn build` only when production bundling, generated assets, routing, or Frappe
integration is materially affected.

For backend inventory, permission, or workspace behavior, run from the bench
root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

This test entry point uses savepoints and rolls its records and settings back.
Add or update focused tests for changed invariants, especially permissions,
warehouse restrictions, idempotency, revision conflicts, autosave, signature
invalidation, scanner lifecycle, and explicit confirmation.

Use targeted Ruff or pre-commit checks for touched files. Avoid `--all-files`
when it would rewrite unrelated code. If a required check cannot run because of
the environment, report exactly what was and was not validated.
