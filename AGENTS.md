# Temple Inventory Agent Guide

This guide covers the app. Follow repository instructions as well; do not edit
Frappe or ERPNext core, generated frontend assets, or unrelated working-tree
changes. Keep Python tab-indented, double-quoted, Ruff-formatted, and within 110
columns. Format touched TypeScript/Vue with Prettier.

## Ownership and decision records

- This file is the shared source of truth for Codex and Claude Code. It owns
  agent workflow, architecture and security invariants. `CLAUDE.md` imports it;
  update shared instructions here rather than duplicating them there.
- Read [UI_UX_DECISIONS.md](UI_UX_DECISIONS.md) before changing user-facing
  behavior. It owns durable interaction, language, accessibility and responsive
  decisions. Update its concise dated supersession log when a durable decision
  changes.
- [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) owns the current visual contracts,
  shared components, tokens and fixed geometry. Keep implementation details
  there when they affect reusable visual behavior.
- Git history holds retired proposals and preview records. Do not restore or
  maintain the retired standalone preview application.

## App map

Backend services live in `temple_inventory/`: `native_api.py` edits versioned
native Stock documents; `native_stock.py`, `native_balances.py` and `counts.py`
enforce stock and count rules; `catalog.py`, `activities.py`, `warehouses.py`,
`configuration.py` and `native_topology.py` provide reference data; `browse.py`,
`report_query.py`, `report_sources.py`, `projections.py` and `exports.py` provide
permission-filtered queries and private exports. `native_access.py`,
`native_files.py`, `file.py`, `session.py`, `preferences.py` and `hooks.py` own
authorization, accounts and attachment boundaries. `api.py` is only the app
access permission entry point.

Routed Vue coordinators live in `frontend/src/pages/`; feature controllers and
shared UI live in `frontend/src/features/`, `components/` and `services/`.
Python integration tests are in `temple_inventory/tests/`; frontend tests are
in `frontend/tests/` and `tests/browser/`. Development sample/reset tooling is
in `sample_install.py`, `native_samples.py`, `sample_media.py` and
`scripts/reset-development-samples`.

## Inventory invariants

ERPNext is the sole stock source of truth. Use native Stock Entry for Receive,
Issue/Loss, Transfer, Loan, Return, Damage, Repair and Disposal; use native
Stock Reconciliation for physical-count adjustments. Use Purchase Receipt only
for real purchasing and Delivery Note only for real sales delivery. Do not add
a shadow ledger, quantity table, inventory engine, image store or attachment
store. All categories use standard Items; use ERPNext Batch for batch/expiry
tracking and standard private Frappe Files for images and attachments.

One operation is one native Stock Entry or Stock Reconciliation, with native
child-row identities. ERPNext Desk and the frontend are equal editors. Writes
check account-scoped immutable request identity and the native version under
lock. Valid input can autosave as a native draft; incomplete recovery stays in
the editor's account/tab-scoped browser store. Only explicit confirmation
submits. Submitted documents follow native cancel/amend and dependency rules.
Preserve unknown native fields and child identities; reject incompatible input
instead of splitting it into multiple documents. Matching counts create no
record.

Keep reportable/filterable context in structured fields. Activity is contextual
metadata and never changes stock. Notes are supplemental.

Stock may exist only in authorized leaf Warehouses. Validate company, configured
root, User Permissions and allowed leaves on the server. The location hierarchy
uses Area groups, Room groups with exactly one hidden direct-storage leaf, and
Shelf leaves; subdividing an unreferenced Shelf turns it into a group with one
direct-storage leaf. Room and subdivided Shelf stock uses that direct leaf.
Configured root, physical root, loan and damaged Warehouses remain special
system nodes; loan and damaged destinations are excluded from physical count
scope. `Warehouse Type` describes physical meaning; `is_group` describes
hierarchy and must not be inferred from names or depth. `ti_label` is the local
name and `ti_short_label` is optional; server-generated `warehouse_name` is the
path below the physical root, using the short name where present. Borrower,
project and activity identity belong in transaction metadata.

## Frontend and security

`frontend/src/styles/app.css` is the sole active stylesheet entry and imports
the shared `--p-*` foundation. Add semantic tokens and reuse shared components
before page-local styles. Responsive branching uses
`composables/useResponsiveLayout.ts` at 1024px. A coordinator mounts one active
surface while its controller retains rows, filters, selection, dialogs, errors
and scroll state across viewport changes. Presentation components receive
typed state and emit intent; feature controllers own requests, routes,
permissions and persistent state. Do not hand-edit `temple_inventory/public/`
or `www/inventory.html`.

Frontend visibility and JSON never authorize a request. Whitelisted methods and
hooks enforce authentication, DocType permissions, company/User Permission
boundaries, item access, warehouse scope, native ownership, File privacy,
immutability and final-submission validation. Return normal Frappe exceptions;
do not expose raw server HTML.

All users admitted to the frontend are System Managers through
`native_access.require_frontend_account`, so the frontend does not gate actions
by per-DocType permissions or consume permission/capability payloads. Keep
configuration readiness, location topology and document-state checks in the
frontend. The server remains the only authorization boundary and must continue
to enforce native permissions and scope on every request.

## Development environment

Agents, Git and editors run on the WSL2 host. The checkout is
`~/code/frappe_docker_wsl/development/frappe-bench/apps/temple_inventory`.
Bench, MariaDB and Redis run in the `temple_inventory_wsl` compose project from
[dev/compose.yaml](dev/compose.yaml), which mounts `~/code/frappe_docker_wsl` at
`/workspace`. The Bench virtualenv only works inside the container, so run
`bench`, `pnpm`, `uvx`, Playwright and Chromium through `scripts/dx`. It maps the
current directory to the matching `/workspace` path, runs the command in the
`frappe` service, and passes environment variables with `env`, as in
`scripts/dx env NAME=value COMMAND`. Never run `pnpm` or `node` on the host:
`node_modules` is shared with the container, and the host's `pnpm` may resolve
to a Windows binary.

The `web` service runs `bench serve` on port 8000, published on the host's
127.0.0.1, and `worker` runs `bench worker`. Both share the `frappe` network
namespace, so `127.0.0.1:8000` reaches the server from every container and from
the host. From the app root:

```sh
docker compose -f dev/compose.yaml up -d --build      # start, or rebuild the image
docker compose -f dev/compose.yaml restart web worker # reload Python changes
docker compose -f dev/compose.yaml logs -f web worker # service logs
scripts/dx bench --site development.localhost migrate
```

Bench logs are in `../../logs/`. Rebuilding or restarting containers does not
affect agents running on the host. Never pass `-v` to `docker compose down`,
because it deletes the development database volume.

## Branches and deployment

- `main` is the trunk and the only long-lived branch. Work on short-lived
  `feature/<topic>` or `fix/<topic>` branches cut from `origin/main`, and push
  them to `origin`; CI (`.github/workflows/ci.yml`) runs on every branch push.
- Integrate with a fast-forward: rebase the branch onto `origin/main`, rerun the
  validation the change needs, then push to `main`. Direct pushes to `main` are
  allowed; force-pushing or deleting `main` is blocked. Delete merged branches.
- Commit messages follow Conventional Commits (`feat(scope): ...`, `fix:`,
  `perf:`, `docs:`, `test:`, `chore:`) with a body explaining why.
- Every push to `main` is tested, built into one immutable image and deployed
  to `https://sample.kufang.online`, so push only commits that pass validation.
  Staging and production never build their own images: staging manually refreshes
  from production backups and promotes a sample digest; production verifies
  successful staging history and uses a manual, approval-gated workflow.
- [deploy/README.md](deploy/README.md) owns the image, hosts, deploy, backup and
  recovery procedures. Do not run commands against the VPSes, GitHub settings,
  DNS or email providers without explicit approval.

## Parallel agents

Several agents may work at once. The main checkout under `frappe-bench/apps/`
is the one the development Bench runs, so only one agent at a time edits it,
migrates `development.localhost` or resets its data. Other agents use their own
Git worktree outside `frappe-bench/` (for example
`git worktree add ~/code/ti-<topic> -b feature/<topic> origin/main`); a worktree
cannot run the Bench, so its changes are tested after they land in the main
checkout or in CI. All agents share the dev database, the `web`/`worker`
services and the `scripts/heavy` lock: queue heavy work through the lock, never
restart or rebuild the dev stack while another agent is testing, and rebase on
`origin/main` immediately before pushing.

## Visual browser preflight

Before every visual browser inspection, run the check through
`scripts/ui-visual-preflight`. It creates an isolated Fontconfig config, adds an
available Noto Sans CJK font, runs `fc-cache`, and verifies that Chromium's
Chinese-language sans-serif match covers `zh`. Known development files are
`/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf` and
`/tmp/NotoSansSC.ttf`. The script also checks system Noto locations. If no CJK
font is installed, install `fonts-noto-cjk` on Debian/Ubuntu (or the platform's
Noto CJK package), then rerun the helper. Launch the browser command beneath the
helper so it inherits the verified config. The development image installs
`fonts-noto-cjk`, so run both through `scripts/dx`. Do not add environment setup
to the product UI.

For ad hoc screenshots against the running dev server, Node cannot resolve
`development.localhost`. Launch `/usr/bin/chromium-headless-shell` through
`frontend/node_modules/@playwright/test` with `--no-sandbox` and
`--host-resolver-rules=MAP development.localhost 127.0.0.1`. Log in by POSTing to
`/api/method/login` with `fetch` from a page, then browse
`http://development.localhost:8000/inventory/...`. Wait for data to load before
capturing, unless you are deliberately capturing a loading state. Save evidence
under `notes/evidence/<date>-<topic>/`.

## Development site authorization

The user has authorized local live-browser checks on the exact site
`development.localhost` using the intentionally public development credentials
`Administrator` / `admin`; do not ask permission again to use these credentials
for local development verification. This authorization does not override
platform controls. The user has also authorized killing running processes,
including earlier sessions, and starting local services/servers when required.
The user explicitly authorized resetting `development.localhost` when the
selected task scope says to reset development data. Use only the guarded
`scripts/reset-development-samples` and preserve the Administrator password. The
development MariaDB root credentials and the non-interactive reset command are
documented in README.md ("Development database credentials"); use them instead
of searching, and never substitute the Administrator password. Do not reset a
different site.

## Resource limits

The WSL VM has 14 GB of RAM (set in the Windows `.wslconfig`), shared by Docker,
VS Code and the agents. Overlapping heavy commands have crashed MariaDB and
restarted the container mid-task. Run every heavy command through
`scripts/heavy`, a shared lock that queues callers, and never run heavy work in
parallel. The lock file is on the bind mount, so host and container callers
share it. Heavy commands include `pnpm test`, `pnpm build`, the backend test
entry point, `bench migrate`, the sample reset, Playwright, Chromium screenshot
scripts and image builds. Close every browser your script launches. Do not start
Vite or extra dev servers; reuse the `web` service on port 8000. Run at most one
Codex implementation task at a time. If MariaDB reports "Server has gone away",
wait for the service, confirm with `scripts/dx bench --site development.localhost
execute frappe.ping`, then resume the interrupted step instead of restarting the
task.

## Validation

Run frontend commands from `frontend/`, one at a time:

```sh
../scripts/dx ../scripts/heavy pnpm test
../scripts/dx pnpm format:check
../scripts/dx pnpm type-check
../scripts/dx ../scripts/heavy pnpm build
```

For backend inventory and native-document changes, run from the bench root:

```sh
apps/temple_inventory/scripts/dx apps/temple_inventory/scripts/heavy bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run
```

Format touched Python with the pinned Ruff, from the app root:
`scripts/dx uvx ruff@0.14.10 check --select=I --fix`,
`scripts/dx uvx ruff@0.14.10 format`, then `scripts/dx uvx ruff@0.14.10 check`.

Mocked frontend tests do not catch API contract mismatches. When a change
touches a whitelisted API or a write flow, also run the live-server acceptance
suite from `frontend/`. It needs the `web` service and, for export jobs, the
`worker` service:

```sh
../scripts/dx env NATIVE_ADMIN_PASSWORD=admin NATIVE_BASE_URL=http://127.0.0.1:8000 \
	../scripts/heavy ../scripts/ui-visual-preflight \
	pnpm exec playwright test -c playwright.native.config.ts
```

The acceptance tests look up documents and warehouses through the APIs. Never
hardcode sample document names or warehouse docnames, which change on every reset.

While iterating, run only the affected backend scenarios with
`execute temple_inventory.tests.test_native_inventory.run --kwargs
"{'test_name': ['test_a', 'test_b']}"` and the affected frontend files with
`pnpm exec vitest run tests/<file>.test.ts`. Run each full suite once, after the
last code change, and reset development data only when seed code changed.

The reset and CI restore a cached seeded snapshot (`scripts/sample-snapshot`)
instead of seeding when nothing the seed depends on has changed. The key covers
every file under `temple_inventory/` except `tests/`, the Frappe and ERPNext
commits and the seed arguments, and a snapshot is used only on the day it was
seeded. Any backend change therefore reseeds once and saves a new snapshot
automatically; never edit or copy snapshots by hand. Pass `--no-snapshot` when
the seed depends on something the key cannot see, such as uncommitted edits in
`apps/frappe` or `apps/erpnext`, or when a restored site looks wrong.

The test entry point rolls back its changes. Add focused regression tests for
changed behavior and invariants. The development stack uses `mariadb`,
`redis-cache` and `redis-queue`; do not replace service hostnames with
`localhost`. Codex tasks started through `scripts/codex-run` reach these
services through `scripts/dx`. In another sandbox without Docker access,
distinguish connectivity errors from reached test failures and report checks the
environment prevented.

Prefer clean schema/API/caller updates over compatibility shims. Update schemas,
fixtures, patches, permissions and tests when changing DocTypes or hooks. Avoid
abstractions that add no concrete behavior.

## Notifications backend

Inventory notifications use Frappe `Notification Log` and app-owned `Notification Type` rows registered after migrate, so the same events appear in the Desk bell and the inventory inbox. Per-user JSON defaults control event and movement-kind delivery; daily expiry digests default off. Background event delivery rechecks app access, notification settings, and native document read permission as each recipient. Export results notify the requester, and push subscriptions are stored per user/device with VAPID keys in Temple Inventory Settings.
