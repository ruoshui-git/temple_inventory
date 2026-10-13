# Standalone design review

This app is an isolated visual reference and interaction gallery. Its visual
authority is the preview at commit `7b91ff5`, restored into preview-owned
`preview.css` and local presentation adapters. The current defaults use the
approved jade palette, balanced density, and the proposed five main destinations.
The intentional baseline differences are the jade starting palette, removed
hover underlines on item names, added route mockups, and the navigation/control proposal below. Production visual
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
pnpm exec vitest run tests/design-preview.test.ts tests/design-preview-browse.test.ts tests/design-preview-forms.test.ts tests/design-preview-pages.test.ts tests/design-preview-navigation.test.ts tests/design-preview-server.test.ts tests/design-preview-refinement.test.ts tests/design-preview-completion.test.ts tests/design-preview-review.test.ts tests/design-preview-erpnext.test.ts
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
experimental. The five-destination proposal is the active preview shell; production retains six. Keep
page mockup styles scoped to their own samples and avoid using them to imitate
production component styling.

Manually compare the restored gallery and inventory treatments with commit
`7b91ff5`, allowing only the listed baseline differences. Review all three
densities at **375px**, **768px**, **1024px**, and **1440px**. Check keyboard
focus, drawers and dialogs, overlay cleanup during hash navigation, 200% zoom,
reduced motion, image fallback, and the five-destination navigation. Automated
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

| App route / family                               | Preview renderer and review content                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                              | Browse: scoped dashboard, mixed-unit summaries, recent activity, drill-through                                                                                                      |
| `/stock`, `/expiry`                              | Original image-bearing inventory cards/table; expiry risk rows, conditional metadata, filters, selection, location popovers                                                         |
| `/movements/items`, `/movements/records`         | Item lines, record states, search/type/date ordering, contextual exports                                                                                                            |
| `/workspace/:name`, `/entry/:entry`              | Draft/completed detail, identity, lines, locations, attachments, continue editing; Opening read-only example                                                                        |
| `/loans/items`, `/loans/records`, `/loans/:name` | Outstanding/returned/damaged/lost examples, draft records, detail and contextual return                                                                                             |
| `/warehouses`, `/warehouses/:warehouse`          | Tree, scoped location inventory, detail/recent movements, create/edit overlays                                                                                                      |
| `/pending`, `/drafts`                            | Damaged stock with Repair/Disposal; retained drafts with continue/delete confirmation                                                                                               |
| `/items/new`, item editing, `/item/:code`        | Editable metadata, images, stock/location/batch/history/loan detail                                                                                                                 |
| `/new/:kind`                                     | Receive, Issue, Transfer, Loan, Return, Damage, Loss, Repair, Disposal; date first, visible required fields, grouped batch allocations, optional context disclosure, review summary |
| `/reconcile/new`, `/reconcile/:name`             | Counted versus book quantities, review and explicit confirmation                                                                                                                    |
| `/reports`                                       | Five report types and their filters; full filtered export review, formats, failure/retry                                                                                            |
| `/more`, `/settings`                             | Utility links and immediately applied preview-only density                                                                                                                          |
| Setup/recovery, `/auth-complete`                 | Simulated configuration and session-recovery feedback, retained draft links                                                                                                         |

Legacy `/loans`, `/movements`, and `/history` redirects map to the corresponding
samples rather than duplicate pages. Setup and editing overlays are selectable
states, not new production routes.

All operations are simulated. Confirming an operation updates a sample record;
stock quantities and batches remain a fixed snapshot rather than an alternate
stock engine. Item metadata and forms are editable in memory. Uploads retain local
file content in memory; exports show the complete filtered scope without downloading,
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

| Width  | Manual scenarios                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 375px  | Five mobile destinations, labeled secondary links, FAB above navigation, wrapping Chinese labels, input keyboard, scrollable tables, fixed review bar without covered fields |
| 768px  | Mobile layout, multi-line forms, filtered lists, drawers, images and location popovers; navigate away and back to confirm retained edits                                     |
| 1024px | Desktop breakpoint, sidebar and separate creation actions; resize across breakpoint while preserving filters/quantities                                                      |
| 1440px | Gallery versus baseline, dashboard scope, image cards/table, detail hierarchy, compact transaction rows and persistent right review                                          |

At every width also test 200% zoom, long Chinese names, mixed units, 30-line
sample, keyboard Tab/Shift-Tab/Escape and focus restoration, reduced motion,
and save/export failures followed by retry. Use the page index to review each
layout independently. Automated checks establish behavior and isolation only;
manual comparison determines visual fidelity and approval.

## Original restoration verification (before the navigation proposal)

- 49 focused component, fixture, page-index, retained-state, validation, keyboard,
  contrast and isolation checks passed.
- 10 HTTP login-bypass checks passed; the running port 5174 returns 302 from `/`
  to the preview and 200 for `/design-preview.html`.
- TypeScript checking and the isolated preview build passed. Build output is
  `/tmp/temple-inventory-design-preview`; generated production assets were untouched.
- A before/after hash comparison confirmed no production source, account
  preference, backend, or existing non-preview test changes during this round.
- Visual comparison, viewport/zoom checks and page-design approval remain manual.

## Earlier navigation proposal (superseded by refinement below)

| Main destination | Pages and actions                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------ |
| 首页             | Dashboard and contextual drill-through links                                               |
| 库存             | 库存列表, 效期批次, 仓库, 损坏待处理; contextual 盘点调整 action                           |
| 货物流动         | 明细 / 记录 view switch; single-type tabs and separate record status                       |
| 借用             | 明细 / 记录 view switch; outcome/status filters and contextual return                      |
| 更多             | All drafts, reports, display settings, installation guidance, and simulated account/logout |

Inventory uses sidebar children on desktop and page navigation on mobile.
Movement, Loans, and More do not repeat those links in shell subnav. Detail and
form pages return to their origin where available, with stable defaults for
shared links. Movement and Loans retain common searches and each view's status;
Movement also retains type and sort. Opening/reconciliation records remain in
the record view's 盘点调整 type filter. Switching to submitted item details clears
that record-only type. Empty operation types stay selectable and show an empty
state rather than disappearing.

All existing sample hashes remain supported; review-only setup, recovery, and
authentication states stay in 完整页面与状态. They are not application destinations.
Draft records and reports project the same editable drafts used by More and the
forms. Saving, deleting, and submitting cannot leave a second stale draft row.
Stock quantities remain fixed fixture snapshots.

Filter trees restore their marker-free list layout and aligned controls. Search
focus surrounds the icon and input together; scan buttons remain separate focus
targets. Add these checks to the manual matrix above, along with tab overflow,
view/status retention, navigation back from details, and More overlay cleanup.
The tests verify behavior and isolation; they do not replace manual visual review.

## Refinement coverage (2026-10-12)

This supersedes the earlier preview navigation/control proposal above. Primary
navigation is 首页、库存、货物流动、借用、报表 on both surfaces. 工具 lives in the
mobile header and desktop utility area; old `more/*` hashes remain supported.
Reports/export routes belong to 报表. Movement and Loans use 按物品 / 按记录.

| Area             | Review scenarios                                                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Movement         | Item/type totals and contributing lines; complete operations with every location branch; quick types plus advanced combinations; all lifecycle states; scoped summary/contributing-line datasets independent of CSV/XLSX |
| Loans            | Item/outcome groups; partial settlement; all/open/settled/draft records; loan-date filters and period borrowing/return history; contextual settlement through the existing editor                                        |
| Date and filters | All ten presets; inclusive custom endpoints; invalid/missing dates; Apply/Cancel; hierarchy/item/activity/source/destination filters; resize with retained scope                                                         |
| Dashboard        | Six sections, six expiry buckets, distinct-item distribution, every movement kind, outstanding loans, supported reminders; global scope and local movement period; scoped drill-through                                  |
| Dashboard states | Expand 预览状态 for initial loading, empty, retained-content refresh and individual section failure/retry; fixtures use the visible fixed sample date                                                                    |
| Images           | Card image/name opens detail; separate enlargement icon with accessible name/tooltip; table/detail lightbox; missing image; independent selection; Escape, focus trapping and restoration                                |
| Navigation       | Five primary entries, Tools access, report/export ownership, aligned icon/label/chevron columns, old hashes and contextual back links                                                                                    |

The focused Vitest command above includes refinement and completion coverage.
Manual review remains required at 375/768/1024/1440px in all three densities,
including 200% zoom, keyboard use and mixed units. No browser automation is part
of this change. Preview transactions simulate loan settlement and corresponding
history on shared fixture records; stock quantities remain fixed snapshots.

## Completion review scenarios (2026-10-12)

- Review Expiry's all/expired/unexpired/undated tabs, today boundary, legacy soon
  link, explicit windows, desktop table/mobile batch rows and inline batch details.
- Check distinct Movement record/item/category counts and quantities per type/unit;
  Loans outstanding record/item counts and outcome totals; draft/cancelled labels.
- Choose summary/operation versus contributing lines, then switch CSV/XLSX; verify
  dataset choice, filtered scope and quantities stay consistent. Warehouse/Expiry
  quick exports also distinguish summaries from physical-location lines.
- Open items from images/names, enlarge independently, edit metadata/image names,
  and verify read-only identity/unit/tracking. Open group and leaf warehouse
  details, rename them, and return to the initiating browse view.
- Review every operation with required locations/batches visible. Receiving's
  item total must follow batch allocations. Test existing-batch availability,
  repeated allocations, integer-only quantities and expired donations.
- In receiving, swap the picker to new-item creation, create a unit inline,
  create/use the item, and cancel/delete the receipt: catalog entries survive.
  Both `#review/local/receive` and `#review/movement-form%2FReceive` share controls.
- Split one Return into good/damaged/lost quantities, preserve the outstanding
  limit, and inspect linked loan history and Movement records. Review damaged
  Repair/Disposal and reconciliation with zero actual count/difference reason.
- Navigate item tabs/edit/detail and Back; preserve the origin's filters, view,
  selection and scroll. Confirm overlay cleanup and focus restoration.

At the 2026-10-12 checkpoint, simulated item images retained filenames only;
the 2026-10-13 implementation below supersedes that limitation. Browser/manual fidelity review is still
outstanding at every width/density in the matrix above, including 200% zoom.

Completion validation: 85 component/fixture tests and 10 HTTP entry-isolation
checks passed; type checking and the isolated design build passed. The HTTP
harness disables unused dependency discovery so its test server closes cleanly.
These results do not establish visual fidelity; the manual matrix remains open.

### Independent review additions

- `tests/design-preview-review.test.ts` exercises outcome counts, independent
  sorting, mixed movement types, whole-group replacement, contributing loan lines,
  repeated partial settlement, item discard, unit conversion and detail retries.
- Detail pages expose **预览状态** for loading/empty/error/unavailable examples.
  Invalid selected identifiers show an unavailable state rather than another item.
- Receive line **单位换算 / 补充信息** includes the rice fixture's 1箱 = 10袋
  conversion and optional manufacturing date. Leave receipt batch ID blank for an
  automatically generated preview ID. Outbound **分配其他批次** uses existing stock.
- Item editing supports **取消编辑**, direct metadata saving and **设为主图**.
  Linked settlement forms remain under 借用, including damage/loss.

## Migration decisions and capability coverage

See [migration ledger](../../../DESIGN_MIGRATION_COVERAGE.md) for ERPNext-native identity, one-document
transactions, searchable controls, and explicit backend prerequisites. Rapid
development favors clean DB/API/UI over legacy compatibility; database resets
are acceptable in migration, not performed by the standalone preview.

## ERPNext-native review scenarios (2026-10-13)

The current UX-01–09 decision index supersedes earlier mixed Return/Loss and
workspace-ownership examples above. Stock quantities remain fixed fixtures;
all lifecycle, upload and configuration examples are local simulations.

| Area | Open / review |
| --- | --- |
| Document identity | `#review/movement-form%2FReceive`: existing Desk-origin Stock Entry, incomplete draft save, explicit confirmation. New forms show 未保存. |
| External lifecycle | Expand 预览 ERPNext 生命周期. Edit quantity, then simulate modification/submission/deletion. Reload preserves an input copy and uses the saved document. Session recovery cannot unblock a deleted record. Cancel a submitted record, then amend to a new linked ID. |
| Other ERPNext vouchers | `#review/movement-records%2Fexternal`: Purchase Receipt type/name and Desk link; no custom stock editor. |
| Loan settlement | `#review/loan-detail%2Foutstanding`: normal/damaged Return, separate linked Loss. Add another loan with the same borrower/activity; incompatible loans remain blocked. Each contributing line keeps its borrowing document/line. |
| Count workspace | `#review/reconciliation-form%2Fnew`: choose a leaf location, selective/full count, blank versus zero, 未找到, location-change confirmation, baseline refresh and re-review. Only reviewed lines enter the simulated reconciliation. |
| Search / creation | Search units, items, activities, categories, locations and batches by name/code/context; options paginate after searching the full local set. Test keyboard selection, no matches, loading/failure/retry and retained selections. Inline category/unit/activity creation returns to the preserved draft. |
| Scan configuration | Routed operation forms: item codes, multiline barcodes, batch IDs and leaf locations; configure quantity/location before the next scan. Ambiguous sources require selection. Single-scan mode stops explicitly; unknown codes and camera denial retain manual lookup. Receive alone offers item creation. |
| Attachments | Item create/edit and operation context: choose real local files, review upload/failure/retry, open/remove and choose primary image. Content persists only in memory; no upload API or public file is created. |
| Warehouse / setup | Group/leaf details: name, physical type and parent editing, cycle/system-node restrictions, new Room plus default leaf. Tools → 配置与恢复: initialization, missing metadata/root pointer, permission/login/role failures and reviewed pointer repair. |
| Browse / preferences | Inventory, Movement and Loans: 分析当前结果 uses all filtered matches, with separate types/outcomes/units; pagination and failed load-more retain selection. Settings demonstrates confirmed versus failed density preference and retry. Installation guidance varies by platform. |

`tests/design-preview-erpnext.test.ts` covers these state and interaction
contracts. Real full-dataset APIs, permissions, document concurrency, loan hooks,
private-file derivatives and reset/seed verification remain backend migration
work, recorded in the [capability ledger](../../../DESIGN_MIGRATION_COVERAGE.md).
Manual viewport/density/keyboard/zoom review remains unperformed.

ERPNext refinement validation: **115 component/fixture tests**, **10 HTTP
entry-isolation tests**, `pnpm type-check` and `pnpm design:build` passed. A final
status-label adjustment was covered by 28 affected form/lifecycle tests. The
isolated build contains 103 modules and writes only under `/tmp`. These checks do
not establish visual fidelity; the manual review matrix remains open.

Independent review (2026-10-13): **123 component/fixture tests across nine suites**
passed (`--maxWorkers=2`), including 30 ERPNext workflow tests. Type-check and the
isolated build passed. Regression additions cover fresh/cached count creation,
Desk count values, scanning recovery and barcode creation, effective draft filters,
selector Escape/click behavior, and pending/failed attachment confirmation.
HTTP entry isolation was unchanged and not rerun in this review. Manual fidelity
review remains pending.
