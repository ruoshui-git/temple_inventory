# Temple Inventory agent guide

Shared Codex/Claude guide; follow repository instructions.

## Working rules

- Python: tabs, double quotes, Ruff, 110 columns. Format touched Vue/TypeScript with Prettier.
- Do not edit Frappe/ERPNext core, generated `temple_inventory/public/` or `www/inventory.html`, or unrelated working-tree changes. Report out-of-scope failures; do not fix other tasks’ changes.
- Prefer clean breaking changes to compatibility shims. Avoid abstractions without concrete behavior.
- Add focused regression tests for changed behavior and invariants; update schemas, fixtures, patches and tests with DocType/hook changes.

## Documentation map

- [UI_UX_DECISIONS.md](UI_UX_DECISIONS.md): durable behavior, interaction and language.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md): tokens, geometry and shared components.
- Before user-facing changes, read the relevant decision doc; update it and add one changelog line.
- [docs/agents/](docs/agents/) has procedures. Git history holds retired proposals.

## App map

Backend domains (`temple_inventory/`): stock/counts, catalog/locations/activities, scoped browse/reports/exports, access/files/session. Frontend routes: `frontend/src/pages/`; UI/controllers: `frontend/src/features/`, `components/`, `services/`. Tests: `temple_inventory/tests/`, `frontend/tests/`. Sample reset: `sample_install.py`, `native_samples.py`, `scripts/reset-development-samples`.

## Inventory invariants

- ERPNext alone owns stock: Stock Entry for operations, Stock Reconciliation for counts; Purchase Receipt/Delivery Note only for real purchasing/sales. No shadow ledger, quantity table, inventory engine, image or attachment store.
- One operation is one native document; Desk/frontend are equal editors. Writes check account request identity and native version under lock. Valid input autosaves; incomplete recovery stays in account/tab storage. Explicit confirmation submits. Preserve unknown data and native cancel/amend rules; reject incompatible input, never split documents.
- Counts cover authorized physical leaves at one timestamp. Blank ≠ zero; matching counts create no record. Keep reportable context structured; Activity is metadata, never stock; notes supplement it.
- Server restricts stock to authorized leaves by company/root/User Permissions. Area → Room → Shelf; Rooms/subdivided Shelves have one hidden direct leaf. Roots and loan/damaged Warehouses are special; loan/damaged are outside count scope. `Warehouse Type` means physical role; `is_group` means hierarchy. Never infer from name/depth. Labels/paths follow presenter; borrower/project/activity are transaction metadata.

## Frontend and security

- `frontend/src/styles/app.css` is the only stylesheet entry; use `--p-*` tokens/shared components before local styles.
- `useResponsiveLayout.ts` coordinates 1024px. One surface mounts while its controller retains rows, filters, selection, dialogs, errors and scroll on resize. Presenters receive typed state/emit intent; controllers own requests/routes/persistence.
- UI visibility/JSON never authorizes. Server enforces auth, DocType/company/User Permissions, Item/Warehouse access, native ownership, File privacy, immutability and submit validation. Use Frappe exceptions; never expose raw server HTML.
- Frontend accounts admitted by `native_access.require_frontend_account` are System Managers. Do not gate actions by per-DocType permissions or capability payloads. UI checks readiness/topology/document state; server alone authorizes.

## Development environment

Agents/Git/editors run on WSL2; Bench/MariaDB/Redis run in `temple_inventory_wsl` via [dev/compose.yaml](dev/compose.yaml) at `/workspace`. Virtualenv is container-only. `scripts/dx` maps paths and runs tools in `frappe`; pass env with `scripts/dx env NAME=value COMMAND`. Never host `node`/`pnpm`.

| Task (app root) | Command |
|---|---|
| Start | `docker compose -f dev/compose.yaml up -d` |
| Reload Python/hooks | `docker compose -f dev/compose.yaml restart web worker` |
| Logs | `docker compose -f dev/compose.yaml logs -f web worker` |
| Migrate | `scripts/dx bench --site development.localhost migrate` |

`web`/`worker` share network namespace; `127.0.0.1:8000` works on host/container. Logs: `../../logs/`. Never `down -v` (deletes DB volume); README links here.

## Validation

Use `scripts/dx`; serialize heavy commands via `scripts/heavy`. Run frontend checks from `frontend/`:

| Check | Command | When |
|---|---|---|
| Vitest | `../scripts/dx ../scripts/heavy pnpm test` | Frontend behavior |
| Format | `../scripts/dx pnpm format:check` | Touched Vue/TS |
| Types | `../scripts/dx pnpm type-check` | Frontend changes |
| Build | `../scripts/dx ../scripts/heavy pnpm build` | Frontend changes; before browser suite |
| Browser | `../scripts/dx env NATIVE_UI_PORT=8081 ../scripts/heavy pnpm test:browser` | Browser/visual changes; local 8080 is occupied |
| Backend | `apps/temple_inventory/scripts/dx apps/temple_inventory/scripts/heavy bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run` | Native inventory changes; from bench root |
| Ruff (app root, ordered) | `scripts/dx uvx ruff@0.14.10 check --select=I --fix`; `scripts/dx uvx ruff@0.14.10 format`; `scripts/dx uvx ruff@0.14.10 check` | Touched Python |
| Live acceptance (`frontend/`) | `../scripts/dx env NATIVE_ADMIN_PASSWORD=admin NATIVE_BASE_URL=http://127.0.0.1:8000 ../scripts/heavy ../scripts/ui-visual-preflight pnpm exec playwright test -c playwright.native.config.ts` | API/write changes; web + worker required |

See [docs/agents/validation.md](docs/agents/validation.md) for snapshots/reset recovery. Never hardcode sample names.

## Resources and parallel work

- `scripts/heavy` serializes tests, builds, backend, migrate/reset, Playwright, screenshots and image builds; never overlap heavy work.
- One orchestrator owns checkout/DB. Parallel Codex tasks need disjoint files/scopes. They share DB/services/lock; never restart/rebuild/migrate/reset during another task’s tests.
- MariaDB “Server has gone away”: wait, run `scripts/dx bench --site development.localhost execute frappe.ping`, resume.
- Deployment work that must stay off the live Bench uses a worktree outside `frappe-bench/`; test after landing or in CI.
- Codex delegation: [docs/agents/codex.md](docs/agents/codex.md). Visual review: [docs/agents/visual-review.md](docs/agents/visual-review.md).

## Git and deploy

`main` is trunk; use short `feature/<topic>` / `fix/<topic>` branches from `origin/main`, rebase/fast-forward and use Conventional Commits with a why-body. Pushes to `main` deploy sample; staging promotes after refresh; production is manual/approval-gated. No VPS, GitHub settings, DNS or email actions without approval. See [deploy/README.md](deploy/README.md).

## Local development authorization

- Local checks may use `development.localhost` and public dev credentials `Administrator` / `admin` without asking.
- Killing stale processes and starting local services is authorized.
- Reset `development.localhost` only when task says so, through `scripts/reset-development-samples`; never another site. Credentials are in README’s “Development database credentials”.

## Notifications backend

Frappe `Notification Log` and app `Notification Type` rows feed Desk/inbox. Delivery rechecks app access/settings/native read permission; push is per user/device.
