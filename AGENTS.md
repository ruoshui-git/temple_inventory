# Temple Inventory Agent Guide

## Scope and priorities

This file applies to the entire `temple_inventory` app. Follow it together with
the repository-level instructions, with this file taking precedence for this
app when guidance differs.

Keep changes focused on the requested behavior. Preserve unrelated working-tree
changes, avoid broad formatting-only diffs, and do not modify ERPNext or Frappe
core. Prefer extending the current model with structured fields and small custom
DocTypes over building parallel subsystems.

User-facing language, responsive behavior, accessibility, and interaction rules
belong in `UI_UX_DECISIONS.md`; do not duplicate them here.

## UI/UX decision record

Before changing user-facing behavior, read the root-level
`UI_UX_DECISIONS.md`. Treat its current rules as authoritative context. If a new
user instruction conflicts with a recorded decision, explicitly report the
conflict and which instruction supersedes it rather than silently changing the
behavior.

Update `UI_UX_DECISIONS.md` in the same change whenever a durable UX decision is
added or superseded. Keep it concise, record supersessions in its dated log, and
preserve unrelated working-tree changes.

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
- User-visible lifecycle states follow `UI_UX_DECISIONS.md`.
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
activity, recipient or borrower, responsible person, recorder, handler,
reviewer, and warehouse/location.
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

## Frontend boundaries

All interaction, layout, feedback, form-state, and warehouse-presentation rules
are owned by `UI_UX_DECISIONS.md`. The custom frontend translates those concepts
into the ERPNext documents described above; it must not introduce parallel stock,
attachment, scanner, or audit subsystems. Store transaction attachments through
Frappe's standard private `File` records.

### Responsive frontend architecture

Routed pages under `frontend/src/pages/` are coordinators. Feature-owned
controllers under `frontend/src/features/<domain>/` own API calls, route-query
synchronisation, filters, permissions, pagination, selection, exports, and
persistent state. Presentation components receive typed state and emit user
intentions; they do not fetch data, mutate route queries directly, or duplicate
permission and business rules.

Use `frontend/src/composables/useResponsiveLayout.ts` for every responsive
branch. The shared breakpoint is 1024px, and the initial no-DOM state is
mobile-first. A coordinator mounts exactly one active surface through the
shared layout contract; a viewport change may unmount the inactive view but
must retain the controller and its loaded rows, filters, selection, dialogs,
errors, and scroll-restoration state.

Pair `DesktopView` and `MobileView` components only when layout or interaction
is materially different. Keep same-flow forms and detail screens as one
adaptive view when CSS/layout changes are sufficient. Keep filters, scanners,
dialogs, cards, summaries, attachment controls, warehouse presenters, and
action menus shared. Infinite-scroll observers belong to the mounted surface
and should use the shared `useInfiniteScroll` list-surface contract.

When changing a responsive feature, test the coordinator and both surfaces:
initial breakpoint selection, listener cleanup, state retention across a
breakpoint change, loading/error/empty states, sorting, keyboard and row
activation, selection, filters, exports, query preservation, and load-more
behaviour. Do not edit generated files under `public/frontend/`.

## Storybook UI workflow

Reusable frontend UI should be developed and reviewed in Storybook when a
relevant story exists. For substantial visual or interaction changes, inspect
the component's stories first, add representative states when missing, and
prefer isolated component work before routed-page integration. Keep story data
static or mocked, preserve application behavior and API contracts, and never
replace production Frappe/ERPNext data access with Storybook fixtures. Use the
local Storybook MCP server when available.

Use docs-list/docs-show when component documentation is available.
Use existing stories as the reference states for component behavior.
When changing a reusable component, update or add representative stories.

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

Write maintainable production source code, not minified or code-golfed code. Use descriptive variable and function names, conventional whitespace, and normal line wrapping. Do not manually optimize code for fewer lines or characters. Format Python with Ruff and frontend files with Prettier before finishing. No need to check for whitespacing after using the formatter.

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

The official Frappe development container runs MariaDB and Redis as separate
Docker Compose services. `mariadb`, `redis-cache`, and `redis-queue` are the
expected internal service hostnames; do not replace `mariadb` with `localhost`.
Codex's default restricted network sandbox may be unable to resolve these
Docker-internal names and can report `MySQLdb.OperationalError: Unknown server
host 'mariadb'` even when the development stack is healthy. If that happens,
rerun the backend command with approved escalated/unsandboxed execution so it
can use the Dev Container network before reporting a database or setup failure.
Confirm with `getent hosts mariadb` and a real `bench` invocation when needed.
Distinguish database connectivity failures from test failures reached after a
successful connection. A trailing `NameError` from `bench execute` can be
secondary fallback noise when the invoked test function first raises its own
failure; report the original test results and traceback.

This test entry point uses savepoints and rolls its records and settings back.
Add or update focused tests for changed invariants, especially permissions,
warehouse restrictions, idempotency, revision conflicts, autosave, scanner
lifecycle, and explicit confirmation.

Use targeted Ruff or pre-commit checks for touched files. Avoid `--all-files`
when it would rewrite unrelated code. If a required check cannot run because of
the environment, report exactly what was and was not validated.
