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

- `temple_inventory/native_api.py` edits versioned native Stock Entry and Stock
  Reconciliation documents. `native_stock.py`, `native_balances.py` and `counts.py`
  enforce movement, settlement and count invariants through shared Desk/API hooks.
- `catalog.py`, `activities.py`, `warehouses.py`, `configuration.py` and
  `native_topology.py` provide native reference-data and setup services.
- `browse.py`, `report_query.py`, `report_sources.py`, `projections.py` and
  `exports.py` provide shared permission-filtered queries and private export jobs.
- `session.py`, `preferences.py`, `native_access.py`, `native_files.py`, `file.py`
  and `hooks.py` own account, authorization and native-parent attachment boundaries.
  `api.py` is only the app-access permission entry point; old API exports are retired.
- `sample_install.py`, `native_samples.py`, `sample_media.py` and
  `scripts/reset-development-samples` are exact-site development tooling.
- App DocTypes and native custom-field fixtures live under
  `temple_inventory/temple_inventory/doctype/` and `temple_inventory/fixtures/`.
- Routed Vue coordinators live under `frontend/src/pages/`; feature controllers
  and shared presentation live under `features/`, `components/` and `services/`.
- Python integration tests live in `temple_inventory/tests/`; frontend unit tests
  and browser specifications live in `frontend/tests/` and `tests/browser/`.

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
- Loan -> Material Transfer into the single configured 借出 leaf warehouse
- Return -> Material Transfer out of that configured 借出 leaf warehouse
- Damage -> Material Transfer into the configured damaged leaf warehouse
- Future physical-count corrections -> ERPNext reconciliation or adjustment
  mechanisms

Use Purchase Receipt only for genuine purchasing workflows and Delivery Note
only for genuine customer or sales-delivery workflows. Do not use either merely
for categorization or reporting convenience.

### Native stock-document lifecycle

A persisted operation is identified by native DocType plus name; native child names
identify allocations. ERPNext Desk and the frontend are equal editors. Valid input
may autosave to an ERPNext draft; incomplete input is recoverable only in the
site/account/tab/editor-scoped browser store. No server recovery or workspace
DocType owns a stock document.

Creation uses an immutable native request identity scoped to account and DocType.
Writes and lifecycle actions check the native version under the same transaction
lock. Serialized autosaves retain edits made during a save; session restoration
and conflicts preserve input without submitting stock. Only explicit confirmation
submits. Submitted records use native cancel/amend semantics and dependency guards.
Preserve unknown native header fields and child identities when editing known fields.

One operation produces one native Stock Entry or Stock Reconciliation, including
multiple Items and permitted leaves. Reject incompatible input rather than silently
splitting it into multiple documents. Entirely matching counts create no server
record; actual native reconciliations retain their reviewed variance context.

### Structured, auditable context

Store values that will be filtered, grouped, reported, or queried in structured
fields, not only in Notes. This includes Receive source, non-Receive purpose, activity identity, borrower,
optional recorder/handler/reviewer, and warehouse/location. Source type and
responsible person are retired preview metadata; their coordinated backend
removal is specified in notes/20261015_ACTIVITIES_REPORTS_BACKEND_REQUIREMENTS.md.
Activity detailed notes remain separate from its short description.
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
The configured 借出 warehouse is one leaf beneath the inventory root. Loaned
stock belongs there; borrower, project, and activity identity belongs in
transaction metadata and must not be inferred from the warehouse name.

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

### Shared visual foundation

`frontend/src/styles/app.css` is the single active stylesheet entrypoint, importing
`foundation.css`, `forms.css`, `utilities.css` and `browse.css`. The shared
foundation uses the `--p-*` tokens. Shared components
live under `frontend/src/components/`, with reusable primitives under `ui/`.
Add semantic tokens and reuse these components before creating page-local styles.
`DESIGN_SYSTEM.md` records the shared foundation and fixed-geometry exceptions.

Production must never import test fixtures, fixture clocks or simulation branches.
Use the routed production app and historical commits for visual review; do not
maintain a separate design-preview site.

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

## Frontend UI workflow

Reusable UI belongs in production components under `frontend/src/components/`
and is exercised with focused Vitest tests. For substantial visual or
interaction changes, inspect the component implementation and its routed
consumers first, preserve application behavior and API contracts, and add
representative interaction assertions to `frontend/tests/`. Validate the
result through the routed app's production build and responsive surfaces.

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
serialization, permissions, and tests together as applicable. Prefer clean schema/API/caller replacement over compatibility adapters. Preserve
functional capabilities and ERPNext stock/audit semantics; database resets belong
to a separately authorized production migration, never preview work.

Follow the configured formatting rules: Python uses tabs, double quotes, Ruff,
and a 110-character line length. TypeScript and Vue use the existing project
configuration. Format only touched code unless a broader reformat is explicitly
requested.

Write maintainable production source code, not minified or code-golfed code. Use descriptive variable and function names, conventional whitespace, and normal line wrapping. Do not manually optimize code for fewer lines or characters. Format Python with Ruff and frontend files with Prettier before finishing. No need to check for whitespacing after using the formatter.

## Validation policy

Use proportionate, focused checks. Launch Playwright, Chromium, camera
emulation, or other browser automation when appropriate.

Run frontend commands from `frontend/`:

```sh
pnpm test
pnpm type-check
```

Run focused Vitest files when the change is narrow. Use `pnpm type-check` when
TypeScript, Vue templates, API shapes, or component contracts change. Run
`pnpm build` only when production bundling, generated assets, routing, or Frappe
integration is materially affected.

For backend inventory, permissions, and native document behavior, run from the bench
root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run
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
