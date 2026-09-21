# Task 5: Cross-App Frontend — Expiry, Scanning, Signatures, and Layout

## Assignment

This is the complete handoff for the agent that owns non-Warehouse frontend
reliability and consistency. Read
`20260921_1_WAREHOUSE_ABSTRACTION_AND_DETAIL_UX_TASK.md` for the locked product
design, but implement only the scope below.

Primary ownership:

- `frontend/src/pages/Expiry.vue`, `Inventory.vue`, `History.vue`,
  `ItemDetail.vue`, `ItemPicker.vue`, `Workspace.vue`, `Reconciliation.vue`,
  Pending/Loans/More/detail pages touched by the consistency pass;
- `ApplicationShell.vue`, `SignaturePad.vue`, `AttachmentList.vue`, scanner and
  field-level input components;
- frontend scanner adapters/loaders and PWA/build asset checks;
- shared duration/layout/filter utilities and `frontend/src/style.css`; and
- corresponding frontend unit/component tests.

Task 4 owns Warehouse pages, route, presenter implementation, and scoped
Warehouse styles. Consume its presenter in non-Warehouse pages; do not modify
its implementation. Tasks 2 and 3 own APIs; use shared fixtures until they land.

## Outcomes

1. `效期批次` renders the repaired bundle-backed results, has readable controls,
   supports overdue/upcoming day windows, and formats duration correctly.
2. Every barcode-capable input has an adjacent scanner action while keyboard,
   manual, and hardware-scanner entry remain first-class.
3. An unknown Inventory scan asks before starting new-item Receive; the barcode
   and transaction context survive confirmation.
4. Signature drawings remain visible; changed business content becomes visibly
   stale and requires explicit re-confirmation rather than destructive clearing.
5. Final submission produces exactly one success toast after server success.
6. Buttons, context action bars, browse/detail shells, desktop spacing, and
   attachments are accessible and consistent across the app.
7. Remaining frontend/scanner requirements from
   `20260920_11_REMAINING_COMPLETION_AND_REGRESSION_GAPS_TASK.md` are covered.

## Shared boundaries

### Expiry API fixture

Consume task 2's compatible `expiring_batches` response and request fields:

- `expiry_window`: empty, `overdue`, `7`, `30`, `90`, or `custom`;
- `expiry_days`: 0–3650 and required for custom;
- existing exact `expiry_from`/`expiry_to` alternative;
- server `as_of`, results, exact totals, and facets.

Relative and exact date modes are mutually exclusive in UI state. Selecting a
quick window clears exact dates; editing an exact date clears the quick window.
Persist `expiry_window`/`expiry_days` in the route query and restore them on
reload/back. Use the API's server-relative result set; do not calculate filtering
client-side from the browser clock.

### Warehouse presenter

Consume task 4's typed presenter wherever warehouse choices/labels appear.

- indented named option: local label such as `A02`;
- fallback below Room: `无货位`;
- fallback below another physical group: `无房间`;
- accessible context: breadcrumb such as `第2寺院 / A02`;
- filters use `filterValue`; transactions use `operationValue`.

Do not parse depth/names independently in each page.

### Signature fixture

Consume task 3's signature state: retained image, attested/current digests,
`absent|valid|stale`, confirmation metadata, and explicit re-confirm/clear
operations. The server recomputes validity; the frontend explains and collects
intent without pretending client state is authority.

## Workstream A — make Expiry useful

### Results and states

1. Retain current search, warehouse, Item Group, exact dates, sort, pagination,
   loading/error/empty states, URL persistence, and self-excluding facets.
2. Render task 2's real bundle-backed results and location quantities. A true
   empty response still shows an intentional empty state; never invent data.
3. Add quick window choices: `全部效期`, `已过期`, `未来7天`, `未来30天`,
   `未来90天`, and `自定义天数` with `未来 N 天` input.
4. Bound custom input to 0–3650, validate before request, and show a removable
   active chip. Invalid route values produce a safe visible correction rather
   than silently broadening results.
5. Upcoming options exclude already expired batches; `已过期` is its own option.
   Use `as_of` in explanatory/status text when a date boundary matters.

### Radio/choice spacing

The squashed `排序` text has a confirmed CSS cause: the global
`input, select, textarea { width: 100% }` rule makes radio inputs full-width.

1. Reset `input[type="radio"]` and `input[type="checkbox"]` to `width: auto`,
   `flex: none`, and a controlled margin.
2. Add a shared `.choice-list`/`.choice-row` pattern using an `auto 1fr` grid or
   equivalent flex layout, readable line height/gaps, normal wrapping, and a
   fully clickable label.
3. Keep a visible focus state and comfortable touch target.
4. Apply it to Expiry sort/window and other radio groups such as History; do not
   add a one-page positional hack.

### Friendly duration

Move formatting to a tested shared helper:

- positive: `约x年x月x天（xxx天）`, omitting zero components;
- negative: `过期x年x月x天（xxx天）`, absolute total in parentheses;
- zero: `今天到期`.

Use 365-day years and 30-day months. Calculate month/day from the remainder
after full years; the existing logic is wrong for values such as 394 days.
Test ±1, ±29, ±30, ±31, ±364, ±365, ±394, ±395, ±730, and zero.

Overdue row/card treatment must meet contrast requirements and retain visible
`过期…` text so color is not the only cue. Verify nested links, secondary text,
hover, focus, selected, and dark context interactions.

## Workstream B — reusable field-level scanning

Create or extend one reusable scanner affordance rather than duplicating
Scanner lifecycle in forms.

Requirements:

- every field whose semantic value can be a barcode/QR code has an adjacent
  scanner button, including Item Detail add-barcode, Item Picker search/new-item
  barcode, Workspace/Reconciliation item lookup, and equivalent fields found by
  the audit;
- preserve typed text when opening, failing, switching engine, or closing;
- successful one-value scan fills/invokes the owning field and releases camera;
- explicitly continuous workflows remain open;
- manual input and hardware-scanner keyboard entry always work;
- normalize immediate duplicate callbacks without preventing a later deliberate
  reuse; and
- use concise Chinese accessible names/status/error feedback.

Client deduplication is convenience only; duplicate barcode authority remains
server-side.

### Scanner platform closure

Retain both Frappe and ZXing-WASM engines and complete tests for:

- loader promise cache and failed-load retry;
- cancellation during every startup phase;
- late startup/decode resolution after unmount or engine switch;
- rejected play, module, decode, canvas, and permission operations;
- no stale callback after close;
- every MediaStream track stopped on success, close, failure, unmount, and
  engine switch; and
- repeated open/close and duplicate decode behavior.

Build verification must prove the hashed app-local reader WASM is emitted and
included in the service-worker precache with no runtime CDN dependency. Leave
real two-engine device validation as a clearly documented manual handoff; do
not claim it from unit tests.

## Workstream C — unknown Inventory scan

Retain and test this exact flow:

1. Scan a value with no Item match.
2. Show `未找到物品` and the scanned value.
3. Ask whether to add a new item.
4. Cancel remains on Inventory with prior filters/list context intact.
5. Confirm enters the existing Receive/new-item flow with barcode prefilled and
   any active transaction context preserved.

Never jump directly to `入库` merely because the scan is unknown. The dialog
needs a clear accessible name, initial focus, focus trap/restoration, Escape,
safe outside-click behavior, duplicate-scan suppression, and duplicate-submit
protection.

## Workstream D — signature and submission feedback UI

### Persistent signature interaction

1. Stop `SignaturePad` completion from triggering any path that clears the image.
2. Hydration/autosave/revision changes preserve the canvas/image.
3. When the server marks the attestation stale, keep the drawing visible and
   show `内容已更改，请确认签名仍适用于当前内容`.
4. Provide a concise current-content confirmation summary and explicit actions:
   `确认仍适用`, redraw/replace, and `清除签名`.
5. Distinguish valid/stale/missing in accessible text, not color alone.
6. Conflict recovery retains the local drawing but requires re-confirmation
   against the resolved content.
7. Apply the same UI semantics to Workspace and Reconciliation.

Do not derive validity solely from image presence or trust a locally generated
digest/status over the server response.

### Exactly-one success toast

After confirmed final server success:

- movement: `<操作>已完成`, for example `入库已完成`;
- reconciliation: `盘点已完成`.

Do not toast autosave. Failure, validation, conflict, a double click, retry of
an already-completed request, component remount, or route refresh must not
duplicate success feedback. Keep durable completed state visible after the toast
expires. Test the workflow, not only the toast host.

## Workstream E — attachments and remaining transaction UI

1. Make `show/set primary image` an explicit Item-only component capability.
   Workspace/Reconciliation/movement attachments must never show `设为主图`.
2. Retain multiple private attachments, direct camera capture, ordinary file
   fallback, metadata, upload/delete error states, and completed read-only state.
3. Consume task 3's complete movement rows/details: modes, drafts, special
   types, bounded preview/full line count, UOM-grouped quantities, handler,
   source/destination, context, attachments, cancellation/amendment, and guarded
   Desk links.
4. Complete History URL state, exact facet rendering, retry/incremental behavior,
   direct/app-authored routes, and Item Detail movement routing.
5. Complete Reconciliation camera/manual/hardware/repeated scanning UX, duplicate
   focus, UOM, new Batch/expiry, explicit serialized-item state, changed versus
   unchanged review, unresolved counts, and conflict focus.
6. Capability failures at deep link/save/refresh/confirm remain visible and do
   not discard local edits.

## Workstream F — interaction and layout consistency

### Buttons and context bar

- Audit primary, secondary, link, icon, FAB, danger, menu, modal, table/card,
  context, active, and disabled buttons.
- Every enabled button has visible hover and `:focus-visible` feedback.
- No hover-only information, layout shift, clipping transform, or sticky-region
  overlap.
- Touch devices do not retain misleading hover; reduced-motion mode removes
  motion while preserving color/border/shadow feedback.
- Context-action buttons must maintain WCAG AA contrast in normal, hover, focus,
  active, and disabled states. White text on white is a release blocker.

### Browse/detail organization

Retain accepted working-tree changes:

- Inventory has no redundant `shell-page-title`;
- Inventory and Expiry have no redundant `page-heading`;
- Expiry uses the same destination width, tabs, filter/results grid, toolbar,
  and spacing rhythm as Inventory/Catalog; and
- useful desktop route context may sit between nav and shell actions.

Finish with shared primitives/tokens rather than route-specific offsets:

- Pending and History: same browse shell, toolbar, errors, counts, filter
  spacing, measured viewport, retry, and incremental states;
- Loans: same list states plus FAB for `新建借出`, not a top-right-only action;
- Item Detail: readable width or intentional columns, not a 1440px text line;
- Loan Detail, Workspace, Reconciliation: shared back/header/status/section
  rhythm with form-appropriate widths;
- More: intentional desktop grouping/grid instead of a narrow mobile list; and
- equivalent back links, titles, primary actions, counts, and errors in
  equivalent locations.

Remove dead title/heading rules after consumers migrate. Preserve the measured
shell-height CSS variable/container; do not reintroduce route-specific
`100dvh - Npx` constants.

Task 4 owns Warehouse scoped styles. This task is the only global `style.css`
owner during parallel work.

## Frontend tests

Add or extend focused tests for:

- Expiry API parameter/URL state, exact/relative mutual exclusion, all presets,
  custom validation, active chips, retry, pagination, facets, and empty state;
- readable radio/checkbox shared layout contract;
- duration boundary table and overdue accessible class/text;
- scanner field integration at every barcode-capable input;
- unknown scan cancel/confirm/focus/context/barcode continuity;
- adapter startup cancellation, rejection, retry, stale callback, and cleanup;
- retained signature, stale message, re-confirm/redraw/clear, conflict, and
  reconciliation parity;
- exactly one success toast and none for failure/autosave/conflict/duplicate;
- Item-only primary-image controls and completed attachment state;
- movement modes/facets/detail routing and reconciliation interaction states;
- context-action contrast class contract, disabled/touch/reduced-motion button
  behavior; and
- shared Inventory/Expiry/Pending/History/Loans/detail spacing primitives.

Run from `frontend/`:

```sh
yarn test --run
yarn type-check
yarn build
```

Do not run Playwright/Chromium unless explicitly requested. Provide a manual
handoff for responsive widths, contrast inspection, and both scanner engines on
real devices.

## Acceptance gate

- Expiry displays the real API rows, readable choice controls, accurate totals,
  exact relative windows, correct duration text, and accessible overdue state.
- Every barcode field has a scanner button without breaking typed/hardware input.
- Unknown Inventory scans never navigate until the user confirms; confirmed
  creation retains the barcode/context.
- Signature images persist; stale signatures are visible but cannot silently
  confirm a transaction.
- Each successful final submit yields one specific toast and no duplicate.
- Context actions are legible, all enabled buttons give hover/focus feedback,
  and browse/detail spacing is consistent on desktop and mobile.
- Production build includes local scanner assets/service-worker entries and no
  runtime scanner CDN dependency.
- Focused tests, full unit suite, type-check, and build pass.

## Non-goals

- Do not patch backend correctness in Vue code.
- Do not edit Warehouse pages/presenter/scoped styles; task 4 owns them.
- Do not create a new scanner engine per form.
- Do not create a parallel signature, attachment, or inventory store.
- Do not claim manual device/browser validation was automated.
