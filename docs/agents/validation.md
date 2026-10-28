# Validation and development data

## Focused iteration

Use the backend runner’s `--kwargs` to select scenarios, for example:

```sh
apps/temple_inventory/scripts/dx apps/temple_inventory/scripts/heavy \
  bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run \
  --kwargs "{'test_name': ['test_a', 'test_b']}"
```

Run an affected Vitest file from `frontend/` with `../scripts/dx pnpm exec vitest run tests/<file>.test.ts`. Run each full suite once after the final code change. Serialize heavy commands with `scripts/heavy`.

## Sample snapshot and reset

`scripts/sample-snapshot` keys a seeded snapshot on every non-test file under `temple_inventory/`, Frappe/ERPNext commits and seed arguments. A snapshot is valid only on the local site date it was seeded. Reset and CI restore it when fresh; do not edit/copy snapshots. Use `scripts/reset-development-samples --site development.localhost`; it accepts no other site. Pass `--no-snapshot` when seed dependencies are outside the key (such as uncommitted Frappe/ERPNext changes) or a restored site is wrong. Reset only when the task authorizes it. Development DB credentials and the guarded noninteractive command are in README’s “Development database credentials”.

If reset/reinstall fails midway, finish the schema with `scripts/dx bench --site development.localhost migrate`, then run `scripts/dx bench --site development.localhost execute temple_inventory.sample_install.restore_administrator_auth` before retrying the reset. Preserve the Administrator password.

## Live acceptance

The native-server Playwright suite requires both `web` and `worker`; export jobs need the worker. From `frontend/`, run the `playwright.native.config.ts` command in AGENTS validation with `NATIVE_ADMIN_PASSWORD=admin` and `NATIVE_BASE_URL=http://127.0.0.1:8000`. It looks up Items, documents and Warehouses through APIs. Never hardcode sample names or docnames because resets replace them.

For the Vite browser suite, build first; `pnpm test:browser` routes the built bundle. Local port 8080 is occupied, so set `NATIVE_UI_PORT=8081`.

## Iteration tips

Run one backend scenario or one Vitest file while iterating, then run the relevant full suite after the final change. Do not parallelize heavy validation; shared services and the `scripts/heavy` lock belong to the whole checkout.
