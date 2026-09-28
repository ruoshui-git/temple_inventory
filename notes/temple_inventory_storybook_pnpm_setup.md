# Temple Inventory — Local Storybook + pnpm Setup Handoff

## Goal

Set up Storybook locally for the existing `temple_inventory` Vue frontend so UI components can be developed, reviewed, and later exposed to Codex through Storybook MCP.

This task is **local-development first**.

Do **not** modify the production OVHCloud Docker image in this task.

Do **not** deploy this package-manager migration to production until the production Docker build is updated to provide pnpm.

---

## Repository context

Repository:

```text
ruoshui-git/temple_inventory
```

Working branch:

```text
version-16
```

Frontend:

```text
frontend/
```

Current relevant stack:

```text
Vue             ^3.5.42
Vite            ^7.3.6
TypeScript      ~5.9.3
Vitest          ^5.0.1
Playwright      ^1.63.0
frappe-ui       1.0.0-beta.72
Tailwind CSS    ^3.4.19
```

The frontend currently uses Yarn 1 (`frontend/yarn.lock`).

The root `package.json` delegates frontend installation/build commands into `frontend/`.

Important files:

```text
AGENTS.md
UI_UX_DECISIONS.md

frontend/package.json
frontend/yarn.lock
frontend/vite.config.ts
frontend/tsconfig.json
frontend/postcss.config.js
frontend/tailwind.config.js

frontend/src/style.css
frontend/src/main.ts

frontend/src/pages/Inventory.vue
frontend/src/pages/Expiry.vue

frontend/src/components/InventoryCardGrid.vue
frontend/src/components/QuantitySummary.vue
frontend/src/components/ActiveFilterChips.vue
frontend/src/components/DetailPopover.vue
```

Before changing UI behavior, read:

```text
AGENTS.md
UI_UX_DECISIONS.md
```

Do not rewrite or weaken their existing rules.

---

# Scope

This setup should accomplish all of the following:

1. Use **pnpm 10.x** for the frontend.
2. Install and configure Storybook for **Vue 3 + Vite**.
3. Run Storybook inside the dev container on port `6006`.
4. Make Storybook accessible from the host browser.
5. Avoid loading the application's Frappe/PWA-specific Vite plugins inside Storybook.
6. Load the application's real global CSS in Storybook.
7. Create initial useful stories for existing inventory components.
8. Install/configure the official Storybook MCP addon.
9. Enable Vue component manifests needed by the Storybook MCP docs tools.
10. Validate that normal frontend type checking/building still works locally.
11. Leave production Docker configuration unchanged.

---

# Important boundary: production is out of scope

Do **not** edit the production Dockerfile, production compose files, or OVH deployment configuration in this task.

This branch may require pnpm to be added to the production build image before it is safe to deploy.

At the end of the task, explicitly report:

```text
Production follow-up required:
the production Docker build must make the pinned pnpm version available
before this package-manager migration is deployed.
```

---

# Phase 1 — Preflight

Start from the application directory, normally:

```bash
cd /workspace/development/frappe-bench/apps/temple_inventory
```

Check repository state first:

```bash
git status --short
git branch --show-current
```

Do not discard unrelated working-tree changes.

If appropriate, create a dedicated branch:

```bash
git switch -c storybook-poc
```

If already working on a user-created feature branch, stay on it instead.

Check runtime versions:

```bash
node --version
npm --version
corepack --version || true
```

The current frontend declares:

```json
"node": ">=20.19.0"
```

For this setup, use **pnpm 10**, not pnpm 11.

Reason:

- pnpm 10 supports Node 20.
- Storybook supports pnpm 9+.
- Pinning pnpm 10 avoids changing the project's Node baseline just for Storybook.

---

# Phase 2 — Enable and pin pnpm

From:

```bash
cd frontend
```

Prefer Corepack if it exists.

Run:

```bash
corepack enable pnpm
corepack use pnpm@latest-10
```

This should add an exact `packageManager` entry to `frontend/package.json`, for example:

```json
"packageManager": "pnpm@10.x.x"
```

Do **not** manually invent the exact version. Use the version resolved by `corepack use pnpm@latest-10`.

Verify:

```bash
pnpm --version
```

The reported major version must be:

```text
10
```

If Corepack is unavailable or broken in this development container, use a container-local fallback that installs **pnpm 10**, then still add/preserve an exact `packageManager` pin in `frontend/package.json`.

Do not install pnpm 11.

---

# Phase 3 — Migrate the frontend package installation to pnpm

This is a real frontend package-manager migration.

Inside:

```text
frontend/
```

remove the Yarn 1 lockfile and regenerate dependencies with pnpm.

Before doing so, make sure no unrelated user change exists in `frontend/yarn.lock`.

Then:

```bash
rm -f yarn.lock
rm -rf node_modules
pnpm install
```

Expected new lockfile:

```text
frontend/pnpm-lock.yaml
```

Do not commit both `yarn.lock` and `pnpm-lock.yaml` for the same frontend package.

After installation:

```bash
pnpm type-check
pnpm test
```

If existing tests fail for an unrelated pre-existing reason, preserve the exact output and distinguish that from Storybook setup failures.

---

# Phase 4 — Root package delegation

The repository root currently delegates commands into `frontend/`.

Update root `package.json` so the delegated frontend commands use pnpm.

The intent should be:

```json
{
  "scripts": {
    "postinstall": "cd frontend && pnpm install --frozen-lockfile",
    "dev": "cd frontend && pnpm dev",
    "build": "cd frontend && pnpm build"
  }
}
```

Preserve the existing package name, version, description, and unrelated fields.

Do not add Storybook dependencies to the root package.

## Important

This root change means the future production build environment will need pnpm.

That production Docker change is **not part of this task**.

---

# Phase 5 — Install Storybook

Work from:

```bash
cd frontend
```

Use the current Storybook installer with pnpm and Vue 3.

Prefer a non-interactive install so the agent does not stall on prompts:

```bash
pnpm create storybook@latest \
  --type vue3 \
  --package-manager pnpm \
  --features docs a11y \
  --yes \
  --no-dev
```

If the exact current CLI rejects one of those flags, inspect:

```bash
pnpm create storybook@latest --help
```

and use the nearest supported equivalent.

Requirements:

- framework must be `@storybook/vue3-vite`
- use pnpm
- include docs
- accessibility support is useful
- do not add React-specific packages
- do not switch the application away from Vite

The installer may create example stories.

Remove generic Storybook demo/example components and stories after confirming installation.

Do not leave `Button.vue`, `Header.vue`, demo assets, or other generated sample UI unless they are needed by the installer itself.

Expected files include:

```text
frontend/.storybook/main.ts
frontend/.storybook/preview.ts
```

and Storybook scripts in:

```text
frontend/package.json
```

---

# Phase 6 — Do not reuse the full application Vite config

The current application Vite config contains production/app-specific behavior:

```text
frappe-ui/vite
Frappe proxy behavior
Frappe frontendRoute build integration
VitePWA
ZXing WASM rewriting
generated Frappe asset output
```

Storybook does not need these.

Do not run Storybook through all of `frontend/vite.config.ts`.

Create:

```text
frontend/storybook.vite.config.ts
```

Use a minimal Vite config containing only application-independent settings Storybook needs.

Recommended starting point:

```ts
import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
});
```

Do not add:

```text
frappeui()
VitePWA()
ZXing production transforms
Frappe frontendRoute
```

to this Storybook Vite config.

---

# Phase 7 — Configure `.storybook/main.ts`

Use `@storybook/vue3-vite`.

Story files should live beside the real components, using:

```text
src/**/*.stories.ts
```

A suitable target configuration is approximately:

```ts
import type { StorybookConfig } from "@storybook/vue3-vite";

const config: StorybookConfig = {
	stories: [
		"../src/**/*.mdx",
		"../src/**/*.stories.@(js|jsx|mjs|ts|tsx)",
	],

	addons: [
		"@storybook/addon-docs",
		"@storybook/addon-a11y",
	],

	framework: {
		name: "@storybook/vue3-vite",
		options: {
			docgen: {
				plugin: "vue-component-meta",
				tsconfig: "tsconfig.json",
			},
		},
	},

	core: {
		builder: {
			name: "@storybook/builder-vite",
			options: {
				viteConfigPath: "../storybook.vite.config.ts",
			},
		},
	},

	staticDirs: ["../public"],
};

export default config;
```

Adapt this to the exact structure generated by the installed Storybook version.

Do not downgrade Storybook merely to force this exact syntax.

If Storybook's current `@storybook/vue3-vite` type expects a slightly different `docgen` shape, follow the installed package's types/current docs.

The important outcomes are:

```text
Vue 3 + Vite framework
minimal Storybook-specific Vite config
vue-component-meta enabled
src/**/*.stories.* discovered
```

---

# Phase 8 — Configure `.storybook/preview.ts`

Storybook must render components using the actual application styling.

Import:

```ts
import "../src/style.css";
```

The application stylesheet already imports:

```css
@import 'frappe-ui/style.css';
```

Use a fullscreen default layout unless a story overrides it.

A reasonable base:

```ts
import type { Preview } from "@storybook/vue3-vite";

import "../src/style.css";

const preview: Preview = {
	parameters: {
		layout: "fullscreen",
	},
};

export default preview;
```

Do not import `src/main.ts`.

Do not bootstrap the full application.

Do not call:

```text
refreshSession()
bootstrap()
inventory()
```

from global Storybook setup.

The first stories should run entirely from static mock props.

---

# Phase 9 — Make Storybook container-friendly

The dev container must expose Storybook outside the container.

Ensure the `storybook` script binds to all interfaces.

Target:

```json
"storybook": "storybook dev -p 6006 --host 0.0.0.0"
```

Preserve any additional flags generated by Storybook if needed.

The build script should remain similar to:

```json
"build-storybook": "storybook build"
```

## Dev container port forwarding

Find the active devcontainer configuration for this workspace.

If it is version-controlled and appropriate to modify, add port:

```text
6006
```

with a label similar to:

```text
Storybook
```

For a VS Code devcontainer, the intended result is conceptually:

```json
{
  "forwardPorts": [
    8000,
    9000,
    6787,
    6006
  ],
  "portsAttributes": {
    "6006": {
      "label": "Storybook",
      "protocol": "http",
      "onAutoForward": "notify"
    }
  }
}
```

Do not delete or reorder unrelated port settings unnecessarily.

If the active devcontainer configuration is outside the repository or should not be edited, do not invent a new one. Report that port `6006` must be forwarded manually.

---

# Phase 10 — Create the first real stories

Do not begin with `pages/Inventory.vue`.

`Inventory.vue` currently owns too much runtime behavior:

```text
Vue Router
Frappe API requests
bootstrap data
inventory queries
IntersectionObserver
localStorage
sessionStorage
scanner state
URL filter synchronization
infinite loading
navigation
```

Start with presentational components that already accept props.

Create these first:

```text
frontend/src/components/InventoryCardGrid.stories.ts
frontend/src/components/QuantitySummary.stories.ts
frontend/src/components/ActiveFilterChips.stories.ts
frontend/src/components/DetailPopover.stories.ts
```

Use realistic but static warehouse-app data.

Do not call Frappe APIs from these stories.

Do not use production/private images.

---

## `InventoryCardGrid.stories.ts`

Use the existing component:

```text
InventoryCardGrid.vue
```

Provide representative item rows such as:

```ts
const rows = [
	{
		item_code: "ITM-000161",
		item_name: "鼻吸棒 SIGNAL Natural Inhaler",
		item_group: "个人用品",
		image: null,
		available_stock: 10081,
		total_stock: 10081,
		on_loan_qty: 0,
		damaged_qty: 0,
		stock_uom: "Nos",
	},
	{
		item_code: "ITM-000162",
		item_name: "柯达相机 KODAK camera 35mm",
		item_group: "电子用品",
		image: null,
		available_stock: 5,
		total_stock: 5,
		on_loan_qty: 0,
		damaged_qty: 0,
		stock_uom: "Nos",
	},
	{
		item_code: "ITM-000163",
		item_name: "饼干烤盘 COOKIE EXCHANGE",
		item_group: "厨房用品",
		image: null,
		available_stock: 20,
		total_stock: 24,
		on_loan_qty: 3,
		damaged_qty: 1,
		stock_uom: "Nos",
	},
];
```

At minimum create:

```text
Default
Loading
LoadingMore
Empty
Error
SelectionMode
```

For emitted interactions, use Storybook actions/spies where appropriate instead of wiring real navigation.

---

## `QuantitySummary.stories.ts`

Create states that are actually useful for future redesign:

```text
Default
MultipleUOMs
Loading
ZeroQuantities
LargeNumbers
```

Example multi-UOM data:

```ts
[
	{
		key: "available_stock",
		label: "可用",
		quantities: [
			{ uom: "Nos", qty: 10081 },
			{ uom: "箱", qty: 35 },
		],
	},
	{
		key: "total_stock",
		label: "总计",
		quantities: [
			{ uom: "Nos", qty: 10500 },
			{ uom: "箱", qty: 37 },
		],
	},
	{
		key: "on_loan_qty",
		label: "借出",
		quantities: [{ uom: "Nos", qty: 12 }],
	},
	{
		key: "damaged_qty",
		label: "损坏",
		quantities: [{ uom: "Nos", qty: 3 }],
	},
]
```

This component is an important initial Storybook target because the inventory summary height is already a known UX concern.

Do not redesign it in this setup task unless a small compatibility fix is required.

The goal here is to expose its current state clearly.

---

## `ActiveFilterChips.stories.ts`

Create:

```text
FewFilters
ManyFilters
SingleFilter
```

`ManyFilters` should contain more than six filters so the current overflow behavior can be exercised.

Use action/spies for:

```text
remove
clear
```

---

## `DetailPopover.stories.ts`

Create at least:

```text
Default
LongContent
```

The story should exercise:

```text
hover
focus
click/pin behavior
Teleport-to-body positioning
```

Do not replace `Teleport`.

---

# Phase 11 — Useful viewport presets

Storybook should make desktop/mobile review easy.

If the installed Storybook version already provides viewport tooling, configure or preserve it.

At minimum, make it easy to test approximately:

```text
Mobile:   390 x 844
Tablet:   768 x 1024
Desktop:  1440 x 900
```

Do not bake fixed viewport widths into production components.

---

# Phase 12 — Install Storybook MCP

Once ordinary Storybook runs successfully, add the official MCP addon.

From:

```bash
cd frontend
```

run:

```bash
pnpm exec storybook add @storybook/addon-mcp --package-manager pnpm
```

If the Storybook CLI is not exposed through `pnpm exec`, use the locally installed Storybook binary/package in the supported pnpm form.

Do not use npm or Yarn for this addon.

After installation, ensure `.storybook/main.ts` contains the MCP addon.

Example:

```ts
addons: [
	"@storybook/addon-docs",
	"@storybook/addon-a11y",
	"@storybook/addon-mcp",
],
```

---

# Phase 13 — Enable Vue manifests for MCP

For `@storybook/vue3-vite`, Storybook MCP's documentation tools require:

```ts
features: {
	componentsManifest: true,
	experimentalDocgenServer: true,
},
```

Add these feature flags to `.storybook/main.ts`.

Expected structure:

```ts
const config: StorybookConfig = {
	// ...

	features: {
		componentsManifest: true,
		experimentalDocgenServer: true,
	},
};
```

These are for Storybook/agent documentation and do not change the production frontend runtime.

---

# Phase 14 — Run Storybook

From:

```bash
cd frontend
```

run:

```bash
pnpm storybook
```

Expected server:

```text
http://localhost:6006
```

From inside the container, verify:

```bash
curl -I http://127.0.0.1:6006/
```

or equivalent.

From the host, confirm that the forwarded Storybook page loads.

Verify the initial stories render correctly.

Check both:

```text
Inventory Card Grid
Quantity Summary
Active Filter Chips
Detail Popover
```

---

# Phase 15 — Verify MCP endpoint

With Storybook running, check:

```text
http://localhost:6006/mcp
```

The MCP endpoint should exist.

If the addon provides a manifest/debug page, verify that it recognizes the Vue components and stories.

The Vue manifest configuration must remain:

```ts
features: {
	componentsManifest: true,
	experimentalDocgenServer: true,
},
```

Do not manually parse or depend on Storybook's internal manifest JSON schema in application code.

It is an AI/development integration only.

---

# Phase 16 — Optional Codex registration

If Codex CLI is installed and it is appropriate to modify the current user's Codex configuration, register:

```bash
codex mcp add temple-inventory-storybook \
  --url http://localhost:6006/mcp
```

Then verify:

```bash
codex mcp list
```

If modifying user-level Codex configuration is outside the agent's allowed scope, do not force it.

Instead, print the exact command for the user at the end.

Do not commit user-specific Codex configuration into the repository.

---

# Phase 17 — Update `AGENTS.md`

Add a concise Storybook workflow section.

Do not duplicate `UI_UX_DECISIONS.md`.

Suggested wording:

```md
## Storybook UI workflow

Reusable frontend UI should be developed and reviewed in Storybook when a
relevant story exists.

When making a substantial visual or interaction change:

- inspect the component's existing Storybook stories first;
- add representative states when they are missing;
- prefer working on the isolated component before integrating the change into a
  routed page;
- use the local Storybook MCP server when available;
- preserve real application behavior and API contracts;
- keep Storybook data static or mocked inside story/test files;
- never replace production Frappe/ERPNext data access with Storybook fixtures.
```

Keep this section short.

---

# Phase 18 — Do not redesign the application yet

This task is setup/infrastructure.

Do not use it as an excuse to:

```text
redesign Inventory.vue
change infinite scrolling
change batch behavior
change expiration behavior
change navigation
change warehouse workflows
rewrite global CSS
move components around broadly
```

Only make UI-source changes required to make existing components render independently in Storybook.

If an existing component cannot be isolated without a small refactor, make the smallest reasonable refactor and preserve behavior.

---

# Phase 19 — Validation

Run from:

```bash
cd frontend
```

At minimum:

```bash
pnpm type-check
pnpm test
pnpm build-storybook
pnpm build
```

Also run a Storybook smoke start.

For example, if supported by the installed version:

```bash
pnpm exec storybook dev \
  -p 6006 \
  --host 0.0.0.0 \
  --smoke-test \
  --no-open
```

If `--smoke-test` behavior has changed in the installed Storybook release, use its current equivalent.

Do not launch the project's full Playwright browser suite unless specifically necessary.

The repository's current agent guidance says browser automation should not be run unless requested.

---

# Phase 20 — Check generated files

Before finishing:

```bash
git status --short
git diff --stat
```

Expected changes will likely include some of:

```text
frontend/package.json
frontend/pnpm-lock.yaml
frontend/.storybook/main.ts
frontend/.storybook/preview.ts
frontend/storybook.vite.config.ts

frontend/src/components/InventoryCardGrid.stories.ts
frontend/src/components/QuantitySummary.stories.ts
frontend/src/components/ActiveFilterChips.stories.ts
frontend/src/components/DetailPopover.stories.ts

package.json
AGENTS.md

possibly the active devcontainer config
```

Expected deletion:

```text
frontend/yarn.lock
```

Do not commit generated `storybook-static/`.

If Storybook creates it during validation, ensure it is ignored or remove it before finishing.

Do not commit:

```text
node_modules/
Storybook temporary logs
user-level Codex configuration
```

---

# Acceptance criteria

The task is complete only when all of the following are true.

## Package management

- [ ] `frontend` uses pnpm.
- [ ] pnpm is pinned to an exact **10.x** version.
- [ ] `frontend/pnpm-lock.yaml` exists.
- [ ] `frontend/yarn.lock` is removed.
- [ ] normal frontend scripts work through pnpm.

## Storybook

- [ ] Storybook uses `@storybook/vue3-vite`.
- [ ] Storybook starts successfully on port `6006`.
- [ ] Storybook binds to `0.0.0.0` in the dev container.
- [ ] host browser access works through forwarded port `6006`.
- [ ] real application CSS is loaded.
- [ ] Frappe/PWA production Vite plugins are not loaded into Storybook.
- [ ] generic generated demo stories are removed.

## Initial component library

- [ ] `InventoryCardGrid` has representative stories.
- [ ] `QuantitySummary` has representative stories.
- [ ] `ActiveFilterChips` has representative stories.
- [ ] `DetailPopover` has representative stories.
- [ ] stories use static/mock data and do not call Frappe APIs.

## MCP

- [ ] `@storybook/addon-mcp` is installed.
- [ ] `componentsManifest` is enabled.
- [ ] `experimentalDocgenServer` is enabled.
- [ ] `/mcp` is reachable while Storybook is running.
- [ ] Codex registration is completed or the exact user command is reported.

## Existing app

- [ ] `pnpm type-check` succeeds, or unrelated existing failures are documented precisely.
- [ ] `pnpm test` succeeds, or unrelated existing failures are documented precisely.
- [ ] `pnpm build` succeeds.
- [ ] `pnpm build-storybook` succeeds.
- [ ] no application behavior was intentionally changed.
- [ ] `UI_UX_DECISIONS.md` was not altered unless a genuine durable UX decision was made.

## Production boundary

- [ ] production Docker/OVH configuration was not modified.
- [ ] final report clearly states that production Docker must support the pinned pnpm version before deploying this migration.

---

# Final report format

At the end, report:

```text
Storybook setup:
- Storybook version:
- Framework:
- URL:
- MCP URL:

pnpm:
- Version:
- Lockfile:

Stories added:
- ...
- ...

Validation:
- pnpm type-check:
- pnpm test:
- pnpm build:
- pnpm build-storybook:
- Storybook smoke test:

Codex MCP:
- registered / not registered
- if not, command to register:

Production follow-up:
- production Docker must make the pinned pnpm version available before
  this package-manager migration is deployed.

Notes / unresolved issues:
- ...
```

Do not claim validation succeeded unless the command was actually run.

---

# Recommended first task after setup

Once the setup is complete and verified, the first actual Storybook-driven design task should be:

```text
Use the Storybook MCP and inspect QuantitySummary.

Keep the existing information and component contract, but explore ways to
substantially reduce its vertical footprint on desktop and mobile.

Create clearly named alternative stories before changing the production
Inventory page. Do not change Inventory.vue until an isolated direction has
been reviewed.
```

That is the intended proof of concept for whether Storybook improves the UI iteration workflow.
