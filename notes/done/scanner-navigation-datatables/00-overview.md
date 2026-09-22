# Scanner, navigation, and datatable improvements

## Objective

Improve scanner placement, make routed pages return to their actual opener, and standardize the three paginated record tables with server-side stable sorting and whole-row interaction.

This folder is an implementation handoff. Do not edit generated frontend assets under `temple_inventory/public/frontend/` or `temple_inventory/www/inventory.html`.

## Delivery waves and ownership

### Wave 1 — run tasks 01 and 02 in parallel

- `01-shared-frontend-primitives.md` owns reusable frontend components/composables, their scoped styling, and focused unit tests.
- `02-backend-sorting.md` owns Python endpoints and backend tests.

### Wave 2 — run tasks 03 and 04 in parallel after Wave 1 is merged

- `03-inventory-expiry-integration.md` exclusively owns `Inventory.vue`, `Expiry.vue`, and their integration tests.
- `04-history-scanner-navigation-integration.md` exclusively owns `History.vue`, `Workspace.vue`, `ItemDetail.vue`, `Reconciliation.vue`, `Pending.vue`, `LoanDetail.vue`, `WarehouseDetail.vue`, and their integration tests.

Wave 2 agents must consume the interfaces delivered by tasks 01 and 02 rather than redefining them. They must not both edit a common page or global stylesheet. If a shared primitive needs correction, coordinate that correction through the task 01 owner.

## Cross-task behavior

- One-shot scanners are modal; continuous transaction scanning is nonmodal.
- Modal scanners render at the document body so they cannot be clipped by a drawer or stacking context.
- A routed detail/editor returns through safe in-app history when possible and uses a contextual fallback only for direct entry.
- Sorting is executed by the server before pagination. Client-side sorting of the currently loaded rows is not acceptable.
- Equal primary values retain one fixed canonical order even when the selected direction reverses.
- Explicit row controls keep their own behavior. All other row/card space performs the row action.
- In multi-select mode, the row action becomes selection toggling.
- Preserve existing endpoint callers by keeping omitted sort parameters and the expiry endpoint's legacy `sort` parameter compatible.

## Acceptance criteria

- Inventory, item editing, and reconciliation open one-shot scanners in accessible overlays above sidebars and drawers.
- Workspace continuous scanning remains visible near the active workflow without covering important content.
- Camera resources stop on close, pause, unmount, session expiry, and route navigation.
- Back/close actions restore the exact in-app opener, including its filter query and browser scroll state.
- Inventory, Expiry, and History use the shared table interaction and expose accessible sortable headers.
- Expiry no longer has a sidebar sorting fieldset.
- Inventory selection mode toggles from the full row/card without opening the item.
- All supported sorting columns work across the complete filtered result set and across page boundaries.

## Validation

Run from `frontend/`:

```sh
yarn test
yarn type-check
```

Run the focused backend suite from the bench root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If the restricted sandbox cannot resolve `mariadb`, rerun the backend command with the approved dev-container network before reporting a failure. Do not run Playwright, Chromium, or camera emulation. The user will perform the manual browser checks listed in the integration tasks.

## Change discipline

- Preserve unrelated working-tree changes.
- Keep Chinese user-facing copy and touch-friendly controls.
- Do not change transaction semantics, permissions, or server-side authorization.
- Use allowlists for all server-provided sort fields and directions.

