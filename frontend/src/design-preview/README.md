# Standalone design review

This app is an isolated visual reference and interaction gallery. Its visual
authority is the preview at commit `7b91ff5`, restored into preview-owned
`preview.css` and local presentation adapters. The current defaults use the
approved jade palette, balanced density, and the existing six main destinations.
The intentional baseline differences are the jade starting palette, removed
hover underlines on item names, and added route mockups. Production visual
fidelity is not approved by this gallery alone; the production migration remains
paused pending review.

The preview does not start the production app, authenticate, call APIs, install
a service worker, or modify inventory data. Fixture-only interactions may
simulate scanning, saving, export, and confirmation. Hash routes under
`#review/` select sample pages and can be shared; local gallery, inventory, and
receiving examples use `#review/local/` hashes.

## Open the preview

From `frontend/`:

```sh
pnpm design:dev
```

Open **http://localhost:5174/design-preview.html**. In a remote development
container, forward port 5174 and open that path on the forwarded origin. The
server needs no Frappe login or backend connection.

```sh
pnpm exec vitest run tests/design-preview.test.ts tests/design-preview-browse.test.ts tests/design-preview-forms.test.ts tests/design-preview-pages.test.ts tests/design-preview-server.test.ts
pnpm type-check
pnpm design:build
```

The isolated build writes to `/tmp/temple-inventory-design-preview` and excludes
the production entry, Frappe build hooks, and PWA plugins. The normal production
build does not include this preview entry.

## Visual ownership and review

`preview.css` owns the preview palette, typography, controls, surfaces, states,
and density behavior. Styled presentation dependencies live in
`components/Preview*.vue`; the shared inventory icon and headless responsive
utility and hierarchy-selection helper are the only shared dependencies allowed by the preview baseline.
`PreviewInventory.vue` remains the canonical inventory sample for list,
filtered, and empty states, including its image, filter, and detail interactions.
New route mockups use fixture state from `reviewModel.ts` and are review samples,
not claims that production routes have been visually migrated.

Jade is the default. Other palettes and workflow proposals are explicitly
experimental. Four-destination navigation is not an active shell option. Keep
page mockup styles scoped to their own samples and avoid using them to imitate
production component styling.

Manually compare the restored gallery and inventory treatments with commit
`7b91ff5`, allowing only the listed baseline differences. Review all three
densities at **375px**, **768px**, **1024px**, and **1440px**. Check keyboard
focus, drawers and dialogs, overlay cleanup during hash navigation, 200% zoom,
reduced motion, image fallback, and the six-destination navigation. Automated
tests and builds verify behavior and route isolation; they do not establish
visual fidelity. Record fidelity approval before reconnecting preview styles to
production tokens or styled shared components. See the app-level
[design-system reference](../../../DESIGN_SYSTEM.md) for production token
ownership and the full migration audit.

## Route and component coverage

Open **完整页面与状态** below the review controls to search and select every
sample. Each entry has a shareable hash. The retained gallery and original
inventory reference remain at `#review/local/gallery` and
`#review/local/inventory`; the compact receiving proposal is
`#review/movement-form%2FReceive`.

| App route / family                               | Preview renderer and review content                                                                                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                              | Browse: scoped dashboard, mixed-unit summaries, recent activity, drill-through                                                                                        |
| `/stock`, `/expiry`                              | Original image-bearing inventory cards/table; expiry risk rows, conditional metadata, filters, selection, location popovers                                           |
| `/movements/items`, `/movements/records`         | Item lines, record states, search/type/date ordering, contextual exports                                                                                              |
| `/workspace/:name`, `/entry/:entry`              | Draft/completed detail, identity, lines, locations, attachments, continue editing; Opening read-only example                                                          |
| `/loans/items`, `/loans/records`, `/loans/:name` | Outstanding/returned/damaged/lost examples, draft records, detail and contextual return                                                                               |
| `/warehouses`, `/warehouses/:warehouse`          | Tree, scoped location inventory, detail/recent movements, create/edit overlays                                                                                        |
| `/pending`, `/drafts`                            | Damaged stock with Repair/Disposal; retained drafts with continue/delete confirmation                                                                                 |
| `/items/new`, item editing, `/item/:code`        | Editable metadata, images, stock/location/batch/history/loan detail                                                                                                   |
| `/new/:kind`                                     | Receive, Issue, Transfer, Loan, Return, Damage, Loss, Repair, Disposal; date first, compact expandable rows, grouped locations, desktop review sidebar/mobile summary |
| `/reconcile/new`, `/reconcile/:name`             | Counted versus book quantities, review and explicit confirmation                                                                                                      |
| `/reports`                                       | Five report types and their filters; full filtered export review, formats, failure/retry                                                                              |
| `/more`, `/settings`                             | Utility links and immediately applied preview-only density                                                                                                            |
| Setup/recovery, `/auth-complete`                 | Simulated configuration and session-recovery feedback, retained draft links                                                                                           |

Legacy `/loans`, `/movements`, and `/history` redirects map to the corresponding
samples rather than duplicate pages. Setup and editing overlays are selectable
states, not new production routes.

All operations are simulated. Confirming an operation updates a sample record;
stock quantities and batches remain a fixed snapshot rather than an alternate
stock engine. Item metadata and forms are editable in memory. Uploads keep
file names only, exports show the complete filtered scope without downloading,
and scanning accepts deterministic sample codes. Reloading resets this session;
only preview theme/density preferences use the separate preview storage key.

## Comparison checklist against `7b91ff5`

- Compare gallery and inventory with jade/balanced selected in both versions.
- Body/control type, heading weight, line height, spacing, radii, surfaces, borders,
  and overlay shadows match the restored reference CSS.
- Text actions/navigation are transparent; fields, outlined buttons, tables and
  intentional surfaces keep their borders. Hover colors and focus rings remain;
  hover underlines have been removed deliberately.
- Check missing images, image table thumbnails, location popovers, conditional
  batch/expiry labels, selected rows, errors, loading/empty states and tooltips.
- New page-index chrome and mockup layout proposals are intentional additions.
  Production styles must never redefine this reference.

## Manual review matrix

Repeat at **compact, balanced, and spacious** density. No browser automation was run.

| Width  | Manual scenarios                                                                                                                                                            |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 375px  | Six mobile destinations, labeled secondary links, FAB above navigation, wrapping Chinese labels, input keyboard, scrollable tables, fixed review bar without covered fields |
| 768px  | Mobile layout, multi-line forms, filtered lists, drawers, images and location popovers; navigate away and back to confirm retained edits                                    |
| 1024px | Desktop breakpoint, sidebar and separate creation actions; resize across breakpoint while preserving filters/quantities                                                     |
| 1440px | Gallery versus baseline, dashboard scope, image cards/table, detail hierarchy, compact transaction rows and persistent right review                                         |

At every width also test 200% zoom, long Chinese names, mixed units, 30-line
sample, keyboard Tab/Shift-Tab/Escape and focus restoration, reduced motion,
and save/export failures followed by retry. Use the page index to review each
layout independently. Automated checks establish behavior and isolation only;
manual comparison determines visual fidelity and approval.

## Verification for this restoration

- 49 focused component, fixture, page-index, retained-state, validation, keyboard,
  contrast and isolation checks passed.
- 10 HTTP login-bypass checks passed; the running port 5174 returns 302 from `/`
  to the preview and 200 for `/design-preview.html`.
- TypeScript checking and the isolated preview build passed. Build output is
  `/tmp/temple-inventory-design-preview`; generated production assets were untouched.
- A before/after hash comparison confirmed no production source, account
  preference, backend, or existing non-preview test changes during this round.
- Visual comparison, viewport/zoom checks and page-design approval remain manual.
