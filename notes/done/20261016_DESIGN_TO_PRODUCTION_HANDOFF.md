# Design-to-production replacement: consolidated implementation handoff

Date: 2026-10-16

Status: **Closed — migration implementation accepted 2026-10-17, including pass 2.**
This handoff is historical specification, not active instructions. See the
[closure review](20261017_MIGRATION_CLOSURE.md). The original requirements and
acceptance criteria below are preserved as history; outstanding verification
limits are not represented as newly passing checks.

Source-inspection baseline: app commit `63c7f26`, plus the existing user edits to
`AGENTS.md`. Requirements below include the decisions made after that commit.

Quick navigation: [authority](#1-authority-purpose-and-delivery-boundary),
[remaining gaps](#2-audit-results-and-work-that-is-still-missing),
[native documents and recovery](#4-native-transaction-model-saving-and-browser-recovery),
[counts](#7-physical-counts-and-native-reconciliation),
[activities](#9-activities-and-transaction-metadata),
[reports](#12-reports-historical-balances-exports-and-named-views),
[reset and sequence](#14-development-reset-seeds-cleanup-and-delivery-sequence),
[acceptance](#15-validation-and-definition-of-done).

## 1. Authority, purpose, and delivery boundary

This is the single task specification for replacing the old production frontend
with the current design-preview UI and implementing the backend that UI requires.
It consolidates the relevant design decisions, backend specifications, review
corrections, and subsequent user decisions. The receiving agent does not need to
assemble requirements from the older handoffs. The source index at the end is
provenance, not an additional reading checklist or competing specification.

The current routed preview source is the visual baseline, not the old production
views or the earliest gallery commit. Promote its presentation into the real app;
do not patch old views until they resemble it. Preserve functional capabilities,
ERPNext stock correctness, accessibility, and input recovery through the rebuild.

The user requested a handoff for another agent, not implementation in the
documentation task. Creating this file does not mean any migration, reset, build,
test, or visual acceptance has occurred. During implementation, use a separate
progress record for evidence; do not turn this specification into a misleading
completion report.

### Locked choices

| Topic | Decision |
| --- | --- |
| Delivery | Complete frontend/backend replacement and local acceptance. No live deployment or production cutover. |
| Data | There is no production business data to preserve. Reset and reseed only `development.localhost`. No legacy business-data conversion project. |
| Compatibility | Prefer breaking schema/API/caller replacement. No old workspace identities, URL aliases, obsolete enum mapping, or compatibility adapters. |
| Native ERPNext | Use Stock Entry, Stock Reconciliation, Item, UOM, Warehouse, Batch, File, and native lifecycle/permissions. No core modifications or parallel stock ledger. |
| Incomplete input | Native ERPNext drafts when valid; browser-only recovery for incomplete edits. Remove Inventory Workspace and add no server recovery DocType. |
| Matching counts | If reviewed actual quantities match the authoritative baseline, show no adjustment needed and create no server count record. |
| Gallery | Keep a development-only gallery rendering the same production components with injected fixture services. No second UI implementation. |
| Preferences | Per-account jade/green, blue, and bronze themes; jade default. Balanced density and 100% text default. |
| Audience | Retain the recorded initial System Manager frontend audience. Document/company/warehouse permissions still apply. |
| UI language | Chinese. Five main destinations: 首页、库存、货物流动、借用、报表. Secondary destination is 更多. |

Do not spawn subagents merely because historical notes mention delegation. The
current task does not request delegation; follow the active agent instructions.
Preserve unrelated working-tree changes. At handoff preparation, `AGENTS.md`
already contained user changes; do not replace it with a historical copy.

### Explicit supersessions

These resolve the conflicts that otherwise make the older records ambiguous.

| Earlier instruction or implementation | Rule for this migration |
| --- | --- |
| Preview-only work; production migration paused | Production replacement is the receiving agent's task, through local acceptance. Historical preview evidence is not new production evidence. |
| Reuse old production styled components/tokens | Promote the current preview's styles/components as the sole production visual foundation. Preserve values and geometry; remove old competing CSS. |
| Permanently separate preview and production presentation | One shared production implementation plus a development-only fixture gallery. |
| Inventory Workspace owns a draft and protects it from Desk | Native document identity and version; Desk and frontend are equal editors. No workspace ownership or shadow server draft. |
| Incomplete forms saved durably to the server | Incomplete input is local to this browser; only ERPNext-valid drafts are server saved. |
| Every completed count becomes a persisted count | Entirely matching counts finish without a server record. Counts reporting covers native reconciliations that actually exist. |
| Custom Inventory Loan/Return/Loss records | Structured native Stock Entry header/line metadata; derive balances from submitted, uncancelled native records. |
| Item-default-only conversion factors | Native per-line recorded factors, plus separately authorized explicit Item conversion updates. |
| Five report families | Six datasets with the views and export contract in section 12. |
| 工具 as secondary destination; 快速报表 / 打开完整报表 | 更多; 快速导出 / 打开导出页面. Primary navigation still says 报表. |
| Inline expanding report filters | Compact desktop filter dialogs and one mobile sheet as specified below. |
| Required allocation fields always visible | Secondary fields may be in Details, with incomplete markers and automatic error reveal/focus. |
| Mixed Return/Loss and automatic multi-document splitting | Return has normal/damaged outcomes. Loss is explicit and separate. One stock operation produces one native stock document. |
| Session-only display preferences and named report views | Per-account server persistence; confirmed display preferences may be cached locally. |
| Old routes, old schema, and old enum values must remain usable | Replace callers and contracts together; reset development data. Preserve capabilities, not compatibility code. |

Other general repository rules remain applicable: preserve unrelated work, do not
modify core, format touched source, enforce permissions, and generate built assets
through the build. The operational rules needed for this task are included here.

## 2. Audit results and work that is still missing

The October 15 Activities/Reports backend document is a **specification**, despite
its location under `notes/done/`. The capability ledger contains its broad scope,
but does not reproduce its detailed requirements. The October 14 simplification
handoff also contains required backend conversion/search work. Both are integrated
below. Do not interpret the archive directory or fixture tests as implementation.

Source inspection established the following gaps:

- `workspace_api.py`, stock hooks, attachments, bootstrap, queries, and loan
  browsing still depend on Inventory Workspace and custom loan records.
- Native Stock Entry validation requires usable quantities, factors, and
  warehouses even before submission. The old workspace hides that difference by
  storing JSON separately and attempting a sync. That server mechanism is removed.
- Stock Reconciliation removes unchanged rows and normally rejects an entirely
  unchanged reconciliation. Do not bypass that rule or change valuation to create
  an otherwise unnecessary document.
- Activity currently uses title-based naming, old enums/lifecycle, and retired
  metadata. New reference types, identity, notes, and guards are not backend-ready.
- The backend resolves conversion factors from Item defaults; it needs recorded
  row factors and explicit, versioned reusable conversion saves.
- Reporting still has five legacy contracts. Loan/activity/count reports,
  complete traceability, historical balances, and account presets need real work.
- Session preferences currently persist density only. Theme and independent text
  size need real persistence and application to every surface.
- Preview stock, scanning, uploads, setup, exports, document conflicts, and
  permission states are simulations. They must be replaced with real services.
- The installed Frappe `File.make_thumbnail` writes under a public path. It must
  not be used unchanged to generate private inventory thumbnails.
- Production Python includes mock-detection/fake-query branches. Remove these as
  callers and tests are replaced; test doubles belong in tests.
- Several documentation links still target notes before their move to `done/`.
  Some early coverage tables still describe five reports or old labels. They are
  historical, not alternate requirements for this implementation.

There is no newly unresolved product decision at handoff creation. Native zoom,
real camera/device behavior, complete server-backed permissions, and production
visual fidelity remain **verification work**, not proven facts.

## 3. Code ownership and replacement architecture

### Starting points, not required implementation boundaries

| Area | Current source |
| --- | --- |
| Preview shell and route presentation | `frontend/src/design-preview/PreviewApp.vue`, `navigation.ts`, `Preview*` views |
| Visual foundation | Preview `preview.css`, `form-pages.css`, `utility-pages.css`, `browse-pages.css`, component styles, and theme values in `model.ts` |
| Shared interaction | Preview operation lines, Details, picker, conversion editor, overlays, compact filters, report table, document display, attachments, focus/scroll helpers |
| Simulated services/state | `reviewModel.ts`, `workflowModel.ts`, `model.ts`, activity/report/browse/dashboard models and opt-in review fixtures |
| Production startup | `frontend/src/main.ts`, `App.vue`, `router.ts`, Vite config, Frappe `www/inventory.py`, hooks, PWA integration |
| Reusable infrastructure | `frontend/src/lib/` transport/scanner/recovery utilities, responsive composable, unstyled icons |
| Backend | `inventory_api.py`, `workspace_api.py`, `reporting.py`, `periods.py`, `stock.py`, `stock_entry.py`, `file.py`, hooks and custom-field fixtures |
| Data/setup | App DocTypes, `sample_install.py`, setup modules, `scripts/reset-development-samples` |

Inspect actual imports and consumers before removing old modules. Extract useful
native queries or headless infrastructure; do not delete still-needed behavior
simply because it resides in a legacy module. Conversely, do not retain the old
workspace module as a permanent API adapter after its callers have moved.

### Production structure

- Routed pages are coordinators. Feature controllers own API calls, route-query
  synchronization, filters, permission state, pagination, selection, exports,
  requests, and persistence. Presentational components receive typed state and
  emit user intentions; they do not fetch or own business rules.
- Retain `useResponsiveLayout` with the 1024px boundary and mobile-first no-DOM
  state. Mount one active desktop/mobile surface. Keep controller state when the
  active surface changes. Same-flow forms/details remain one adaptive view.
- Put reusable promoted components and semantic styles in the normal production
  component/style structure. Remove production `Preview*` naming as it becomes
  misleading; gallery-only models and scenarios retain explicit development names.
- Remove old production page implementations, styling components, unused feature
  controllers, and competing stylesheet imports. Audit `frappe-ui/style.css`, old
  `style.css`, tokens, primitives, loading CSS, and feature CSS for leakage.
- Replace the production token values/definitions from the preview foundation;
  a mechanical token rename is acceptable only if rendered values and geometry
  remain identical. Do not map preview values to merely similar old tokens.
- Preserve scoped fixed geometry where it has interaction meaning. Shared styles
  belong to shared components/tokens, not repeated page-local overrides.
- Keep real loading/empty/error/permission/session states. Remove sample tags,
  fixture clocks, fake identities/counts, scenario selectors, developer review
  switches, simulated confirmation/download messages, and automatic fake success.
  Legitimate form hints, missing-image placeholders, and empty states remain.
- Errors use ordinary Frappe exceptions and sanitized Chinese feedback; never
  render server HTML into the volunteer UI.

### Development gallery

The gallery renders the same shell, components, and controller interfaces using
injected fixture service implementations. It may show explicit review controls,
sample data, state simulations, 50-item operations, and 1,000-item selectors.
Fixtures must be opt-in and isolated; visiting the gallery must not populate real
drafts or ordinary runtime catalog data.

Keep a separate build/entrypoint with no production API, authentication bootstrap,
PWA registration, or account-preference writes. Dependency direction is gallery
to shared product code, never production to fixtures/gallery state. Production
builds must exclude gallery assets and simulation branches. Do not keep a frozen
copy of all production views as another frontend to maintain.

## 4. Native transaction model, saving, and browser recovery

### Identity and document lifecycle

- A persisted transaction is identified by native DocType plus document name.
  Child references use native child-row names, not array indexes. Local input
  before native creation has a distinct local editor ID, never a fake ERPNext ID.
- One operation saves/submits one Stock Entry or Stock Reconciliation. Multiple
  items and permitted leaf warehouses are normal. Do not split one confirmation
  into hidden native documents. Reject incompatible inputs with an explanation.
- Replace Inventory Workspace, Inventory Loan/Return/Loss and their child records,
  obsolete links, ownership guards, permission handlers, serialization, seed
  dependencies, selectors, and compatibility exports once replacement callers work.
- Keep structured operation metadata on native documents. Relevant existing
  header fields include `ti_movement_kind`, `ti_source_text`, `ti_purpose_text`,
  `ti_activity`, `ti_borrower`, and optional personnel fields. Remove `ti_workspace`,
  legacy custom-ledger links, and `ti_responsible_person` with their consumers.
- Native APIs must load/create/save/submit/delete/cancel/amend using an explicit
  native identity and document version. Keep unknown native header and child-row
  fields when editing known fields. Preserve row identities, not just quantities.
- Perform version checks under the same transaction/lock as writes, including
  submit/delete/cancel. Reject stale requests without overwriting newer Desk data.
- Retry-safe creation uses an immutable request identity on the native document,
  scoped to the creating account and document type and protected against duplicate
  concurrent creation. Retries after a lost response return the same document.
  Do not create a new server editing system to implement idempotency.
- Submission is an explicit confirmed action. Autosave may save valid drafts but
  never changes stock. Serialize saves and retain newer input edited in flight.
  Drain the intended save revision before confirmation; revalidate on the server.
- Desk-created eligible drafts open and remain editable in the frontend, and
  frontend-created drafts remain editable in Desk. Neither editor claims ownership.
- External submit/cancel/delete transitions must be shown truthfully. Preserve
  dirty input separately with selectable text and Copy. Missing records never
  substitute another record or become editable after session recovery.
- Submitted records are not rewritten. Corrections use native cancellation,
  amendment, reversal, or reconciliation as appropriate, with traceable links.
- Unsupported native stock purposes and other voucher types are readable with
  their real identity and Desk link. Never classify an unknown purpose as Transfer.
  Opening stock retains Stock Reconciliation identity and a truthful opening label.

### Local incomplete input

Use native validation instead of bypasses to make incomplete records save. Keep
incomplete/temporarily invalid edits in a browser recovery store. The UI must
distinguish locally retained input, server-saved draft, saving, error, conflict,
and submitted/cancelled states.

- Store recoverable form values, local editor ID, native identity if any, base
  document version, edit revision, and update time. Namespace by site and account;
  separate concurrent tab/editor snapshots to avoid last-tab-wins data loss.
- Keep local recovery for all relevant unfinished editors, including count input
  and contextual catalog/activity input. Local entries in 更多 → 草稿 are clearly
  labeled as this browser's unfinished input; server-native drafts are distinct.
- Invalid edits must not replace the last valid server draft. Do not pretend a
  local save has changed the native document or reserved stock.
- After reload/session restoration, offer recovery and fetch current native state
  before applying it. Never automatically replay changes over a newer, cancelled,
  submitted, deleted, or inaccessible record. Reload/discard requires an explicit
  decision when it would lose input; Copy remains available.
- Only the same authenticated account may resume its local input. Account switches
  cannot hydrate another account's buffer. Incomplete input is not available on
  other devices; say so where local recovery is presented.
- Local storage failures leave the open form usable, report that recovery is not
  durable, and retain the normal leave/discard guard. Do not report saved status.
- Do not persist file bytes, temporary object URLs, passwords, session tokens, or
  CSRF tokens in recovery. Retain permitted uploaded File IDs; unfinished uploads
  require reselection after reload with clear feedback.
- Remove only the local revision acknowledged by a successful save/finalization;
  never clear newer edits because an older request completed. Explicit discard
  removes only the selected buffer. There is no server recovery DocType.

### Required business mappings

| Operation | Authoritative document and movement |
| --- | --- |
| Receive | Stock Entry / Material Receipt into permitted physical leaves |
| Issue | Stock Entry / Material Issue from permitted stock |
| Transfer | Stock Entry / Material Transfer between permitted leaves |
| Loan | Material Transfer into a valid leaf beneath Leased; structured borrower/activity/provenance |
| Return | Material Transfer from the original loan's Leased leaf to physical or damaged leaves; normal/damaged outcomes |
| Damage | Material Transfer to configured damaged leaf storage; retain original loan references when settling a loan |
| Loss | Separate Material Issue; retain original loan references for loan loss |
| Repair | Material Transfer from damaged storage to permitted physical leaves |
| Disposal | Material Issue from damaged storage |
| Count adjustment | Native Stock Reconciliation; see section 7 |

Purchase Receipt and Delivery Note are for real purchasing/sales workflows, not
alternate documents for categorization. Do not add independent donation,
distribution, conversion, attachment, or inventory ledgers.

### Server invariants and Desk parity

- Validate authenticated/document permissions, Frappe User Permissions, company,
  visible/allowed tree membership, leaf warehouses, Item/Batch access, quantities,
  UOM rules, and availability. Recheck at final submission.
- Group warehouses cannot hold stock. Native inventory records and batch/bundle
  APIs own balances; UI snapshots are never authoritative.
- Use real structured movement context, not arbitrary client flags, to apply
  app-owned business rules from both Desk and the frontend.
- Preserve the requirement to receive expired donations truthfully. The existing
  exception is tied to `workspace_service`; replace that dependency with a narrow
  validated Material Receipt policy covering relevant Desk/frontend operations.
  Keep Item/batch identity, date order, disabled-state, and permission validation.
  This is not permission to bypass expiry validation across every stock purpose.

## 5. Loans and settlements

Store loan meaning on native Stock Entry headers and allocation lines. A settlement
line references both the original borrowing Stock Entry and its exact child row.
Record the physical origin, actual leased source, batch, item, recorded unit/factor,
and outcome needed for validation and traceability. Never use the first loan row
as fallback when a reference is missing.

Derive borrowed, normally returned, damaged, lost, and outstanding stock-unit
quantities from submitted native documents with cancellation/amendment semantics.
No independently writable loan-balance table or custom loan document is retained.

- Compatible loans may share one Return: same borrower, same activity, compatible
  company and native document requirements. Preserve each originating line.
  Incompatible loans require another explicit operation, not silent splitting.
- Return may split normal and damaged quantities across allocations. Loss is a
  separate explicit action. Borrowing itself is not a settlement event.
- Validate aggregate settlements across all lines and concurrent requests against
  remaining original-line quantities in stock units. Lock original loan references
  in a stable order for settlement creation/submission/cancellation interactions.
- Cancelling a return/loss restores the corresponding derived outstanding amount.
  Prevent cancelling/amending a borrowing record while active dependent settlements
  would become invalid. Native amend links retain audit traceability.
- Subsequent partial settlements start a fresh operation after completion. Never
  reopen a completed transaction as editable or reuse its request identity.
- Loan dates mean original borrowing dates. Browse balances are explicitly current,
  even when borrowing-date filters select older loans. Links to movements show
  borrowing/return events within the requested event period separately.
- Loans owns settlement actions and outstanding balances. Movement includes
  borrowing/return/loss events and links back to the appropriate loan.

## 6. Movement editor, contextual creation, and conversions

### Allocation editor

- One compact row per allocation, with stable local/native identity. Desktop shows
  item/artwork, entered quantity/unit, applicable primary locations, compact
  batch/outcome context, Details, and removal. Mobile stacks readable labeled rows.
- Quantity and primary locations stay inline. Details holds secondary fields,
  batch/expiry/manufacturing date, conversion, and relevant operation context.
  Ordinary Details edits update the same draft immediately and survive closing.
- Show incomplete indicators. Validation examines the entire draft; error
  navigation clears obstructing search/incomplete filters, reveals the correct
  row/Details field, and focuses it above fixed actions. Report document-level and
  line-level problems without hiding one behind the other.
- All editable allocations remain mounted. Search changes visibility, not saved
  content/totals/validation. A focused location edit must not unexpectedly reorder
  its row. Do not virtualize editable rows or hierarchy trees.
- Preserve split/add allocation, multi-item selection, group replacement, scanning,
  unknown-code creation, image enlargement, and operation-specific controls.
- Details uses a desktop side panel/full-screen mobile panel. Conversion editing
  happens within that panel, not a stacked modal.
- Expanded workspace retains the same mounted editor, toolbar, totals, and single
  responsive save/review action area, while hiding surrounding sections. Restore
  layout, focus, and scroll on exit; it is not the browser Fullscreen API.
- Warehouse summary disclosures are independent. Initially expand only when there
  is one warehouse with at most five allocations; retain later manual choices.
  Final confirmation exposes every allocation, entered quantity/unit, recorded
  factor, stock equivalent, batch/location, outcome, and original-loan context.
- On mobile, only the form action region is fixed. Summary stays in document flow.
  Measure navigation/action heights and keep focus, toasts, and return-to-top clear.

### Contextual supporting data

- Receive alone offers contextual new Item creation; Inventory also has standalone
  creation. Existing-item multi-add uses ordered pending checkboxes, retained
  across filters/scroll. Commit appends allocations without silently merging them.
  Replacement is single-select and replaces the complete selected item group.
- Existing-item selection retains its drawer. Creation uses the same overlay
  system: viewport-clamped desktop dialog up to 880px and full-screen below 1024px.
  Category/unit/activity creation must not stack a second focus-trapping overlay.
- Retain surrounding draft, pending selection, creation input, filter, and scroll.
  Multi-add creation adds to pending selection; replacement/scan create-and-use is
  immediate. Cancel returns to the initiating context with restored focus.
- Explicit supporting-record saves survive cancelling the stock movement. Do not
  undo a created Item/UOM/category/activity merely because its receipt was discarded.
- Unfinished nested supporting editors participate in the containing discard guard.
  Finish or explicitly cancel them before saving the Item. Failures retain input.

### Units and conversion behavior

Use standard UOM, Item UOM Conversion Details, and Stock Entry Detail fields:
`qty`, `uom`, `conversion_factor`, `stock_uom`, and calculated `transfer_qty`.
The server computes stock quantity; never trust client arithmetic as authoritative.

- Show one editable entered quantity and searchable unit selector, with a concise
  stock equivalent. Prefer stock/configured units and offer other/new units.
- Stock-unit factor is 1. Unknown alternate factors are unset, never silently 1.
  Suggested standard factors require confirmation for a new Item relationship.
- Selecting an unknown conversion opens 单位与换算. Show `1 <unit> = <factor>
  <stock unit>`, live preview, and 保存为此物品的常用换算 checked by default.
- Apply commits staged changes. Unchecked means this allocation only. Checked
  means an explicit Item conversion save as well; replacing an existing reusable
  factor shows old/new equations and 更新常用换算并应用.
- Authorize UOM creation and Item modification separately. Check Item version,
  duplicate units, finite positive factor, precision, and entered/stock integer
  requirements. A failed reusable save cannot silently become line-only success.
  A user without Item write permission can use permitted existing units/factors.
- Changing a configured unit preserves stock quantity and recalculates entered
  quantity. Editing a factor preserves entered quantity and previews the changed
  stock equivalent. Never silently round invalid fractions.
- Existing draft/submitted lines retain recorded factors when Item defaults change.
  Save/reopen, history, duplication/amendment, confirmation, reports, and exports
  must all retain entered quantity/unit and the recorded factor.
- Item replacement clears incompatible conversion state. Conversion state survives
  Details/picker/viewport changes. Leaving unapplied conversion input asks to discard.
- Reusable factors are Item-specific, not a global packaging conversion. Preserve
  immutable stock UOM and unrelated Item fields. Item details/editing exposes the
  guarded 计量单位与换算 section. Counts always use stock units.

## 7. Physical counts and native reconciliation

Select one permitted physical leaf location and either selected items or full
location scope. Baselines use native ledger/batch balances at an explicit posting
timestamp, not current Bin quantities substituted into historical counts.

- Preserve item/location/batch identity. Blank is unreviewed; zero is deliberate;
  未找到 explicitly records zero with its distinct state. Require a nonnegative
  count, applicable stock-unit precision, and a reason for a difference.
- Require at least one reviewed row. Full-location scope determines the baseline
  item set, not permission to turn blanks into zero. Show reviewed/unreviewed scope
  explicitly when submitting reviewed differences; never claim all rows were checked.
- Label totals 账面合计, 已核对实点合计, and 本次调整差异, separately by stock
  unit. With no reviewed rows show 尚未核对, not an apparent zero adjustment.
- Refresh baseline preserves entered actual counts, reconciles additions/removals
  in the selected scope, marks changes for review, and requires explicit re-review.
  Recheck baseline/version on save/confirmation and reject stale adjustments.
- Submit native Stock Reconciliation with real applicable adjustment rows. Preserve
  native valuation behavior; do not set zero/Item default valuation merely to force
  saving or to manufacture a difference. No financial revaluation feature is added.
- Attach structured count-review metadata to the native reconciliation: scope,
  baseline timestamp, item/batch/location, baseline, reviewed actual/state, reason,
  and signed difference. This may use native-parent custom fields/child rows; it is
  not a standalone count ledger or recovery record. It preserves reviewed/unchanged
  context that native reconciliation may omit from its stock-adjustment rows.
- Native Desk-origin reconciliations retain actual native book/count/reason values.
  Do not invent full-location review metadata where none exists. Desk changes must
  invalidate or update inconsistent review metadata before it can be displayed as
  the current document's result. Preserve unknown native fields and native versions.
- If all reviewed quantities match, show no adjustment needed and create no server
  document, count audit record, or Counts-report row. Local unreviewed input remains
  recoverable until explicitly finished/discarded. If an older saved native draft
  exists, offer explicit discard/deletion; do not silently delete or submit it.
- A new count after completion has a new editor/request identity, including cached
  route revisits. Do not reuse a completed reconciliation.

## 8. Items, warehouses, scanning, and files

### Items and hierarchical reference data

- Standard ERPNext Item records represent all categories. Item Code identifies an
  item type/style, not each physical unit. Individual serial tracking is out of scope.
- New Item code is editable and unique; suggest the next available `ITM-######`
  without reserving it on form open. Recheck on save and offer a fresh suggestion
  after collision. Preserve the user's other input.
- Default UOM to `Nos` only if it exists; allow clearing/replacement and submit the
  chosen existing UOM. Do not silently select another unit on save.
- Creation supports category hierarchy, multiline barcodes, description, batch/
  expiry configuration, and images. Existing Item code, stock UOM, and tracking
  are displayed as immutable through this editor; editable metadata and reusable
  conversions remain available with appropriate permission/version checks.
- Category creation preserves parent hierarchy. UOM creation includes its whole-
  number setting. Validate uniqueness and permissions server-side; use native records.
- New items become available to the initiating picker; standalone creation opens
  detail. Detail retains inventory/batches/locations/movements/loans and related links.

### Warehouses and setup

- `Warehouse Type` (`Room`/`Location`) describes meaning; `is_group` describes children.
  Never infer semantic type from depth or name. Groups are navigable, never stocked.
- Physical warehouses must be under the configured physical root, company, visible
  tree, and allowed leaves. Compatible Desk-created warehouses appear normally.
  Never automatically adopt, move, or reparent out-of-root warehouses.
- Leased is a group with actual leaf storage below it; damaged stock is held in a
  configured leaf. Borrower/activity identity comes from transaction metadata.
- Preserve group and leaf detail, rename/edit, parent/type controls, creation of
  rooms/locations, cycle prevention, and system-node protection. A new Room is a
  usable leaf by default; hierarchy changes must respect existing stock/documents.
- Pending is damaged stock only and supports Repair/Disposal. Do not restore the
  retired 未定位 subsystem. Existing room/default-leaf rules must resolve to actual
  permitted leaves without hidden stock movement.
- Setup distinguishes guest, non-manager, unavailable/missing configuration, and
  denied access. An inaccessible warehouse must not be treated as missing/recreated.
- Initialization creates the required physical/leased/damaged structure, not sample
  quantities in an ordinary user action. Sample installation is a separate dev task.
- Repair physical metadata without changing stock/hierarchy. Pointer repairs show
  current/replacement/impact and require explicit user confirmation; they modify
  configuration references only, never move stock or reparent nodes.

### Search and scanner

- Search the full permission-filtered dataset before pagination, with stable sort
  and identity tie-breaks, complete counts, and contextual stock/batch retrieval.
  Do not search only options already downloaded. Retain selected options across pages.
- Cancel/ignore stale responses when query/context changes. Initial loading, empty,
  error, failed load-more, and retry retain prior results and pending selection.
- Virtualize large flat selectors above 100 rendered candidates with measured rows,
  overscan, focused-row retention, keyboard target scrolling, and width/text remeasure.
  Keep hierarchy trees and editable allocations fully mounted.
- Picker rows reserve 48px artwork, keep names/codes readable, and reveal stock/
  location/batch details within the same picker surface. Preserve scroll/selection
  when returning from details. Release observers on deactivation/unmount.
- Use the existing scanner engine, not another scanner subsystem. Camera, hardware,
  and manual codes converge on the same lookup/allocation workflow. Opening/cancelling/
  failing a scan preserves typed input; successful single scan fills the associated
  field and stops the camera. Clean up camera/workers on close, navigation, and failure.
- Require manual allocation for ambiguous item/location/batch matches. Preserve
  whole-draft availability and duplicate-scan handling; removing a blocked scanned
  allocation allows scanning to resume. Unknown barcode creation is Receive-only
  and prefills the barcode. Permission errors never become fake unknown-item success.

### Files and image presentation

- Store originals as private Frappe File records linked to the actual native Item,
  Stock Entry, Stock Reconciliation, or other permitted parent. No image store or
  attachment store outside Frappe. Validate current and previous parent on relinking.
- Enforce parent read/write, ownership, privacy, and submitted/completed immutability
  in server hooks as well as upload/remove APIs. Guessable URLs are not authorization.
- Initially display authorized originals instead of introducing thumbnail generation.
  If derivatives are required, create private permission-checked File records;
  never use the public-writing thumbnail helper unchanged or leave public copies.
- Preserve upload progress/error/retry/removal, preview/download, primary image
  ordering, and content-type handling. Pending/failed uploads block stock confirmation
  and final Item save; draft input remains editable and recoverable.
- Images have stable loading/missing/broken states and reset when the source changes.
  Real items with no image use neutral placeholders, not hardcoded rice/oil artwork.
- Card image/name open item detail. A separate always-visible accessible 查看大图
  action opens the lightbox; table/detail thumbnails open it directly. No enlargement
  action for a missing image. Image activation never toggles unrelated row selection.

## 9. Activities and transaction metadata

### Structured movement context

| Field | Requirement |
| --- | --- |
| 来源类型 / 负责人 | Remove UI, schema, defaults, filters, searches, selector endpoints, fixtures, and tests for retired custom metadata. |
| 来源 | Receive free text; retained independently from activity type. |
| 用途 | Non-Receive purpose; retained independently from Activity. |
| 关联活动 | Stable Activity Link, searchable with contextual create-and-use. |
| 借用方 | Required for borrowing; preserve original-loan-derived settlement values. |
| 记录人 / 经手人 / 鉴证人 | Optional free-text personnel, never required signatures/attestation. |
| Native audit / system `recorded_by` | Preserve actual system attribution separately from optional personnel text. |
| 备注 / 附件 | Supplemental notes and private File attachments. |

Do not infer a movement operation from an Activity type. A 捐赠 activity does not
automatically make a stock document a Receive. Keep reportable/filterable context
in structured fields, not only Notes.

### Activity schema and lifecycle

- Add `Inventory Activity Type` reference data: immutable identity, label, enabled
  flag, display order. Seed, in order: 捐赠、购买、分发、节目、投入使用、其它.
  Manage types through Desk; no frontend type-management page in this iteration.
- Activity has immutable ID, required unique editable title and type Link, optional
  start/end dates, short description, Long Text notes, Active/Archived lifecycle,
  and actual native audit metadata. Validate duplicate titles and date ordering.
- Remove Activity legacy `date`, `source_type`, `donor_source`, `purpose`, `recipient`,
  `responsible_person`. Retain/redefine `notes`; it is not a cleanup target. Do not
  map old enum/Open–Closed values; development data is reset.
- Detailed notes are plain text preserving paragraphs/whitespace. Search and export
  them, render markup literally, and do not put full notes on browse rows.
- Disabled types cannot receive new assignments. Existing references remain readable
  and unchanged on unrelated edits. Referenced types cannot be deleted.
- Archive removes activities from new-assignment pickers but preserves existing
  drafts/links/settlements/reporting. Restore is explicit; dates never auto-archive.
- Rename updates metadata, never submitted documents or link identity.
- Enforce read/create/write/archive/restore/delete and optimistic versions on the
  server. Any reference, including drafts/cancelled/invisible records, blocks
  deletion. Lock/check deletion and new reference assignment transactionally in
  DocType hooks so Desk/API agree. Return a generic blocker without leaking hidden
  references and offer Archive. No bulk deletion/merging.

### List, detail, and contextual editor

- 更多 owns Activities list/detail/creation. Reuse one metadata editor for standalone,
  detail edit, and contextual create-and-use; preserve caller draft/focus.
- Default list: active, all dates, modified descending. Offer title/start-date sort;
  search title/ID/description/notes; filter lifecycle/type/start date, movement type,
  related-record presence, and outstanding loans. Keep search/status/type/date visible.
- Adaptive desktop rows/mobile cards show title/type/dates/status/update, nonzero
  lifetime submitted-document-count chips by movement type, and outstanding-loan
  indication. No quantity totals crowding list rows.
- Count identities by DocType plus name. Clicking a lifetime chip resets related
  search/date/status to that lifetime submitted/type scope. Preserve list state/scroll
  when returning from detail.
- Detail shows metadata, direct movement unit totals, loan summary, and independently
  expandable long notes. Actions: Edit, New Movement with activity preselected,
  快速导出, and Archive/Restore/Delete in overflow.
- 关联记录 includes direct documents and settlements indirectly related through
  original loan lines, with explicit relationship labels and deduplication. Direct
  movement totals exclude indirect events. Include date/time/type/status/items/
  unit-separated quantities/locations and native record links.
- 借用结余 shows borrowed/normal return/damaged/lost/outstanding, with original
  loan and settlement links. Filters must retain exact original-line identity after
  item/location filtering. Never infer relationships from labels or free text.
- Activity tabs use one keyboard tab stop, arrows/Home/End, and labeled panels.

## 10. Navigation, browse scope, dashboard, and detail behavior

### Navigation and route identity

- Keep five primary destinations and secondary 更多 as specified in section 1.
  Inventory owns 库存列表、效期批次、仓库、损坏待处理. 更多 owns 活动、盘点调整、
  草稿、显示设置 and account/device/setup utilities. Keep one new-count entry there.
- Movement/Loans use 按物品 / 按记录 as view switches, separate from type/status
  filters. Preserve mode-specific sorting/status when switching views.
- Use the `/inventory` SPA base and real route/query state. Keep domain routes
  where suitable, replace `/workspace/:name` with native document routes, and remove
  obsolete report/history aliases. Local recovery entries use local IDs distinctly.
  Encode native identifiers safely; refresh/deep links must resolve correctly.
- Contextual Back and browser Back/Forward restore originating scope, view, selection,
  scroll, and nested table positions. Primary navigation opens its ordinary defaults.
  Detail sidebar ownership follows its domain; loan-related settlement stays in Loans.
- Do not export gallery `#review` routes or scenario variants into production.

### Browse semantics

- Inventory is card/table with available/loaned/damaged quantities and explicit
  in-stock/zero-catalog scope. There is no separate 全部物品 destination.
- Expiry uses desktop tables/mobile batch rows and 全部 / 已过期 / 未过期 / 无效期.
  Expiry today is unexpired. Batch-only items without a date belong in 无效期.
  Preserve explicit inclusive expiry windows and contextual location/batch details.
- Movement item mode groups by Item with separate operation-type quantities;
  records show whole native documents and all branches. Distinguish matching
  allocation quantities from whole-document quantities after filtering.
- Quick movement choices are 全部、入库、出库、调拨. Other kinds remain in the full
  type filter; multiple types use OR semantics and removable chips. Loan/Return
  events remain available in Movement.
- Loans item mode groups positive quantities by Item/outcome with contributing
  records/lines. Default outstanding item view; records retain all/unsettled/settled
  choices. Never open an arbitrary loan when selecting an aggregate item row.
- Complete filtered totals, facets, analysis, distinct record/item/category counts,
  and exports are independent of downloaded rows. Separate stock UOM, lifecycle,
  operation type, and settlement outcome. No misleading summed mixed-unit quantity.
- Expiry facets describe the complete applicable scope excluding only their own
  expiry choice: distinct Items in Inventory and distinct item/batch identities in
  Expiry. Batch badges appear only for batch-tracked Items, including a truthful
  zero-batch count; do not create an independent 需关注 expiry category.
- Source/destination/category restrictions on drafts must match the same allocation,
  not unrelated lines on the same document. Preserve empty restrictive selections
  as empty results, never reinterpret them as unrestricted.
- Initial loading precedes empty state. Refresh retains rows with updating/stale
  feedback; load-more failures retain selection/data and offer retry.
- Permission-filtered Item metadata is authoritative. Do not expose stale cached
  catalog details where the account lacks permission. Raw posting time retains
  precision in APIs/exports; ordinary display may use HH:MM.

### Dashboard

- Retain all six sections: inventory, distribution, expiry, movement/recent records,
  outstanding loans, reminders. Wide layout independently stacks the first three
  left and the last three right; narrow layout follows that reading order.
- Global warehouse/category scope applies to all relevant sections. The movement
  period is local to movement. Drill-through carries scope; ordinary navigation
  does not inherit it accidentally. Opening scope controls alone makes no request.
- Inventory quantities remain separated by stock UOM. Distribution counts distinct
  Item Codes, labeled 物品种数, not summed quantities. An item can occur in more
  than one warehouse branch, so bars may sum above the deduplicated total.
- Expiry counts distinct item/batch pairs across locations. Keep six buckets:
  expired 1–30, 31–90, >90 days; upcoming 0–30, 31–90, >90 days.
- Each card owns loading/failure/retry and snapshot scope. A failure with prior
  results says 上次结果 · 尚未更新, keeps readable stale data, and disables stale
  drill-through. Without prior results show unavailable. Retry replaces that card.
  Cards/metrics do not move on hover or pretend to be buttons without an action.
- Loan summary has outstanding records/quantities and supported operational context.
  Do not add due dates, overdue counts, or inferred overdue status.

### Readable information

Immutable Item metadata, completed/cancelled records, permission-limited records,
count details, and saved allocation/context values use selectable labeled text,
definition lists, badges, and readable tables. Booleans and empty values are
explicit. Long content wraps safely and retains whitespace; expansion is accessible.
Attachments retain preview/download without editable controls.

Display/edit mode is separate from temporarily busy/conflict-blocked state. Busy
controls retain underlying input buffers. Never replace unsaved input with a saved
projection just because an operation is paused. Recovery is a text block plus Copy,
not a misleading disabled textarea. Static surfaces have no button hover/cursor.

## 11. Filters, dates, and responsive interaction

### Shared filter contract

- Inventory/Expiry/Movement/Loans/Pending keep their desktop rail/mobile overlay.
  Do not apply report compact-panel layout globally to these rails.
- Reports and Drafts have normal-flow toolbars and desktop Item/Category/Location/
  Activity/applicable Type dialogs; More Filters holds secondary conditions.
  Mobile uses one Filters sheet with complete count and Clear/Done. Search/date
  stay on the page. Result Group/Sort are separate from scope controls.
- Dashboard uses one 总览范围 trigger plus readable scope summary. Activities
  keeps primary fields visible, secondary Filters, and separate Sort.
- Non-date filters apply immediately. Multi-selection keeps panels open. Done,
  outside click, and Escape close without rollback or scrolling the document.
- Date editors are pending until Apply; Cancel changes nothing. Invalid/incomplete
  custom ranges stay visible and do not request data. Only one transient filter/
  date/export panel opens at a time. Context change/deactivation/breakpoint change
  dismisses the panel while preserving committed scope.
- Nested selector Escape closes suggestions first; tree-search Escape clears/closes
  its search before the outer dialog closes on another Escape. Commit a selection
  before blur cleanup. Menus close on outside/focus leaving/unmount as appropriate.
- Hierarchy selection normalizes parents/descendants. Selecting a parent replaces
  descendants; removing an inherited child retains other covered branches. Preserve
  indeterminate state, counts, clear, keyboard search, and full readable labels.
- Chips expose all applied/inherited restrictions, including empty selected-item/
  allocation constraints, document/loan, item-location combinations, outcome/status,
  damage and activity conditions. Large selections use count chips with full context.
- Removing a chip clears only its condition; restrictive flag and IDs clear together.
  Submitted-only default status stays visible; clearing changed status restores it.
  Expiry all-dates also exposes undated inclusion and removable changed exclusion.
- Clear Filters preserves primary search, dates/window, dataset/view, Group/Sort.
  重置导出设置 performs the full workspace reset. Named views have a dedicated
  labeled management panel with local errors.

### Date meaning

Use shared inclusive resolution based on the Frappe site's date/time context,
returning resolved dates for UI/export consistency. Remove `previewDate` from live
logic. Presets: all, today, this week/month/year, last 7/30/90/365 days, and custom.
Rolling ranges include today; this week begins Monday. All time has no date predicate.

Movements/counts use posting date; Loans uses borrowing date and current balances;
Activities uses start date with undated records available under all dates; Expiry
uses labeled expiry-date windows. Current Inventory shows a snapshot timestamp.
Historical Inventory requires a bounded period and defaults to this month.

### Geometry, keyboard, and state retention

- Shared breakpoint 1024px, one active surface, retained controller state. Use
  adaptive layout/container width for form reflow instead of extra device breakpoints.
- Mobile body/input text is at least 16px, actionable targets at least 44px in every
  density. Text scaling applies to teleported menus/dialogs/toasts as well as pages.
- Use one focus-trapping overlay for contextual work; exclude hidden/inert surfaces
  from Tab order, restore initiating focus, and clean up listeners/observers on
  deactivation/unmount. Respect reduced motion and safe-area insets.
- Compact browse chrome after 80px keeps one context row, search, scan, filters,
  count/chips, and actions reachable. Secondary tools use bounded disclosure;
  preserve or transfer focus when compaction relocates a focused control.
- Return-to-top appears after two active-scroll viewports, clears bottom navigation/
  form actions, and focuses the page heading without changing scope. Hide it when
  a mobile filter sheet covers the page. Track the actual scroll owner.
- Desktop compact filter dialogs teleport to body, prefer 400px width, clamp to
  12px gutters with an 8px anchor gap, and scroll internally. Reposition on layout,
  content, viewport, and ancestor-scroll changes without observer feedback loops.
  Focus only after the positioned panel becomes visible.
- Mobile filter sheets use full available height/width, fixed accessible header/
  footer, internal scrolling, focus containment, and body-scroll lock. Searchable
  menus inside compact panels stay within their scroll/focus boundary.
- Preserve allocation numeric widths around 7ch plus padding, 48px picker artwork,
  wrapping identities, and no fixed editable row height. Report/table minima scroll
  internally, never force horizontal document overflow. Full report tables show
  displayed/total counts and Load more beyond initial 30 rows; quick preview is five.
- Report/Activity date triggers stay in normal page flow on mobile; do not pin them
  over adjacent filters. Density affects spacing; text scale affects type independently.

## 12. Reports, historical balances, exports, and named views

### Dataset/view contract

Retain these identifiers and fixed view choices in a shared typed definition.
Each dataset also permits no grouping. Fixed columns follow view/grouping; no
mobile column builder is introduced.

| Dataset | Views | Group choices | Required content |
| --- | --- | --- | --- |
| `inventory` | `summary`, `locations`, `historical` | item, category, location | Available/loaned/damaged/total, optional zero-stock catalog, item/location/batch detail, historical balances |
| `expiry` | `batches` | item, category, location | Batch/location quantities, manufacturing/expiry dates, remaining days, no-expiry and zero-stock options |
| `movements` | `summary`, `records`, `lines` | item, category, location, kind, activity, month | All operation kinds, opening and reconciliation, explicit draft/submitted/cancelled status, allocation detail |
| `loans` | `records`, `outcomes`, `settlements` | item, activity, borrower, month | Original borrowing records, item/outcome quantities, current outstanding, exact settlement references |
| `activities` | `metadata`, `records`, `loans` | activity, kind | Metadata/notes/lifecycle, direct document counts, direct/indirect related records, loan balances |
| `counts` | `records`, `lines` | item, location, month | Actual native reconciliations and attached count review/variance context; no synthetic matching-count records |

Replace old report APIs and callers together. Warehouse stock is an Inventory
view; movement-record export is a Movements view. Preserve their capabilities
without legacy aliases.

### Query/projection interfaces

- One typed query represents dataset/view, search, shared category/warehouse/item/
  activity/type scope, period, grouping, sort field/direction, lifecycle statuses,
  zero/undated inclusion, activity lifecycle/type, record/loan identity, explicit
  item/allocation restrictions, item-location restrictions, related search/period,
  loan outcome/status, expiry window, review state, damage, related presence, and
  outstanding-only where applicable.
- Preserve the distinction between an unrestricted query and an explicitly restricted
  empty selection. Filter before aggregation. Apply item/location/search constraints
  to both historical balance rows and contributing ledger rows.
- Report defaults: first view, no grouping, identity ascending, submitted status,
  zero excluded, undated included, activity lifecycle all; applicable ordinary date
  defaults are all except bounded history. Contextual entry retains the caller's
  applicable scope/sort. Dataset switching retains each dataset's current state.
- Page responses provide rows, stable IDs, matched count, pagination continuation,
  complete unit-aware summary/facets as applicable, resolved scope/period, and snapshot
  timestamp. Client-side formatting is allowed; client-side loaded-page aggregation
  must not masquerade as full-scope server results.
- Browse, result analysis, quick export, full workspace, and file generation share
  semantics and server projection/query services. Do not independently rebuild
  financial/stock math in the browser or copy fixture projection code as a ledger.
- Count document identity by DocType plus name for counts and quantity aggregation.
  Keep statuses and units separate. A grouped result retains exportable allocation,
  balance, and related-master detail tables rather than dropping them.
- For activity relationships, settlement joins follow original document and original
  line, even when the settlement has no own activity. Label indirect events, dedupe
  by canonical identity, and exclude them from direct submitted-movement totals.

### Historical Inventory

Opening is the authoritative ERPNext balance immediately before the bounded period.
Show opening + incoming − outgoing + signed adjustments = closing for each relevant
item/warehouse/stock-unit scope, with allocation/batch context and document drill-through.

Use native Stock Ledger and installed-version batch/bundle/cancellation semantics.
Never reconstruct history from current balances or only the app's movement types.
Reconciliation contributes once as adjustment. Transfers affect both warehouses
and net to zero when both are selected. Cancelled/reversed/amended records must
match ERPNext results. Exclude valuation/financial measures from this feature.

### Export behavior and completeness

- UI wording: 快速导出, Dashboard 快速导出数据集, full heading 导出,
  重置导出设置, and 打开导出页面. Primary navigation remains 报表.
- One labeled download-icon action/dialog serves all reportable browse/saved-detail
  pages: Dashboard, Inventory, Expiry, Movement/Loans, Activities, warehouses, Pending,
  persisted reconciliations, and Reports. No exports of unsaved editors or settings.
- Preserve caller filters/entity restrictions and sorting. Dashboard first selects
  dataset; movement period applies only to movement. Cancel preserves caller state/
  scroll. Opening full export carries the applicable query exactly.
- Dialog shows readable scope, complete result count, available tables, independent
  format choice, five-row preview, and full-workspace link. Defaults to XLSX; failure
  retains all choices and provides retry. Remove simulated-export wording in production.
- XLSX includes applicable summary/detail sheets and optional related-data sheets.
  CSV selects one explicit flat numeric table. Format must never change content scope.
- Include stable document/type/line, Item, location, Batch, Activity/type, loan and
  original-loan-line IDs plus labels; date/time/status; source/purpose/borrower/
  personnel/notes; entered quantity/unit/factor; stock quantity/unit; and settlement
  outcome/source references. Never replace allocation grain with joined location text.
- Include fixed related tables for Item metadata, barcodes, Item conversions,
  warehouse hierarchy, and permitted File/parent references. No binaries, transient
  preview URLs, import/backup formats, or unrestricted attachment URLs.
- Generate complete permission-filtered results independently of loaded pages.
  Preserve company/document/warehouse/Item access through aggregates, related tables,
  and files. State scope and generation timestamp; never silently truncate.
- Use native Frappe background jobs for export generation and private File downloads,
  with bounded queries/writers and stable ordering. Track request ownership, job
  state, progress/failure/retry, and recheck authorization before download. Background
  execution must enforce the requesting user's permissions, not inherit an unrestricted
  worker identity. Handle logout/session expiry and revoked access truthfully.

### Personal named views

Provide Save View, rename, and delete in the dedicated management panel. Persist
per account the dataset/view, filters, grouping, and sorting. Relative dates remain
relative and resolve on use; custom dates remain fixed. Users cannot read/write
another account's presets. Validation errors stay local to the management action
without clearing the active query. Gallery presets remain isolated fixture state.

## 13. Account preferences, authentication, and platform behavior

### Display preferences

Expose theme alongside density and text size in 更多 → 显示设置, not in production
review chrome. All three themes are available to the user; preserve their existing
visual characteristics, including radius differences.

| Theme ID | Label | Canvas | Ink | Accent | Muted / border | Soft / strong | Control / card radius |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jade` | 静石 · 青玉 | `#F4F6F3` | `#24332D` | `#28684E` | `#5E6B63` / `#829288` | `#E5EEE7` / `#194C37` | 12px / 18px |
| `blue` | 清透 · 靛蓝 | `#F5F7FA` | `#202938` | `#245DB5` | `#596577` / `#7D8B9C` | `#E8EFFA` / `#194587` | 6px / 8px |
| `bronze` | 暖砂 · 铜棕 | `#F7F5F0` | `#292622` | `#895024` | `#686158` / `#938A7D` | `#EEE4D6` / `#683A18` | 10px / 14px |

- Extend session/preference contracts with `theme`, `density`, and `textScale`.
  Allowed densities: compact/balanced/spacious. Text scales: 100/125/150/175/200.
  Defaults: jade/balanced/100; no migration of preview-local preferences to accounts.
- Server values are authoritative. Reuse native per-user preference storage rather
  than a new account settings subsystem. Validate enum/range values server-side.
- Apply locally immediately; serialize saves and guard account/request revision so
  late responses cannot overwrite newer choices or another account's settings.
- A versioned per-account browser cache stores confirmed values only. Valid server
  values win; use confirmed account cache when server hydration is unavailable,
  otherwise defaults. Storage denial must not prevent server persistence.
- Failed saves retain the selected display for the current session with explicit
  unsaved/retry feedback, never update the confirmed cache, and never claim success.
- Apply density/text/theme to root and teleported surfaces. Text scales typography
  independently of spacing, not CSS zoom/transform. Recompute measured obstructions.
- Keep status colors distinct from operation category colors, readable focus/contrast,
  mobile minima, wrapping, and reduced motion across all combinations.

### Authentication and PWA

- Gate frontend bootstrap/session/app visibility and custom frontend APIs for the
  initial System Manager audience, while retaining normal document authorization.
  Do not restrict unrelated native Desk workflows to match this frontend audience.
- Guest, forbidden, configuration-required, expired-session, network, validation,
  version-conflict, and unavailable-record states are distinct and recoverable.
- Refresh CSRF/session state through the existing transport; keep unsaved input and
  resume only after safe version checks. Recovery cannot resurrect a deleted record.
- Preserve logout/account switching, auth-complete return, platform-specific install
  guidance, and PWA integration. Avoid a second auth implementation.
- Build prompt-based PWA updates safely around unsaved work. Clear obsolete build
  caches so old CSS/JS cannot combine with the new UI. Do not cache private API/file
  results as public offline assets or add offline stock submission.
- Production deep links load the Frappe SPA; gallery URLs remain development-only.

## 14. Development reset, seeds, cleanup, and delivery sequence

### Reset boundary

The user expressly chose reset/rebuild of `development.localhost`. That authority
does not extend to another site, a live deployment, or deleting unrelated files.
Keep the reset tool's target checks. Use environment-provided connection credentials;
do not print credentials in commands, logs, or completion messages.

Adapt the existing reset and synchronous sample-install tooling to the new model
before resetting. It currently recreates the database but leaves site files behind.
Inventory old seeded File references/derivatives before reset and remove obsolete
inventory sample copies within that exact site's file directories, using the known
sample scope. Preserve site configuration and unrelated files. Verify no leftover
public copies of seeded inventory media remain.

Seed real native ERPNext data, not runtime frontend fixtures:

- Company/settings, physical Room/Location hierarchy and permitted leaves, leased
  leaves, damaged leaf, categories, UOMs, new Activity Types and activities.
- Items with images/missing images, multiple barcodes, reusable alternate units,
  mixed stock units, batch/expiry variations, and zero-stock catalog examples.
- Real receipt/issue/transfer/loan/normal and damaged return/loss/repair/disposal
  documents; partial/multiple compatible loans and native drafts/cancellations.
- Real reconciliation differences with review context, native Desk-origin examples,
  historical movements, and private original attachments. No fake matching-count
  document, no custom loan ledger, and no group-warehouse stock.

Use deterministic seed identifiers where practical and site-relative dates for
useful expiry/history states. Assert balances from ERPNext, not preview constants.
Initialization from the frontend remains separate from dev sample generation.

### Delivery sequence

1. Record the starting revision, existing user changes, routed preview screenshots,
   and a capability checklist derived from this document. Treat old test results
   only as historical evidence. No unreviewed screenshot replacement as acceptance.
2. Build native schema/services/hooks and contract tests: documents, loans, counts,
   conversions, activities, permissions, search, files, reports, and preferences.
3. Update seed/reset/verification tooling, remove obsolete fixture-schema dependencies,
   then reset the authorized development site and seed through native document APIs.
4. Promote presentation and wire real controllers/services. Replace routes/shell/CSS
   together; complete every covered feature before declaring replacement complete.
5. Convert the gallery and UI tests to shared production components with injected
   fixtures. Remove old production implementations, shadow preview implementations,
   mock-sensitive runtime branches, unused adapters, styles, endpoints, and schema.
6. Build and verify the routed real app and gallery, complete the acceptance matrix,
   inspect screenshots, and independently review the final diff against this handoff.
7. Update the implementation progress record and current architecture/status documents
   with actual results. Keep requirements here authoritative; use other docs as
   concise status/architecture indexes rather than divergent new specifications.

Do not manually edit generated `temple_inventory/public/frontend/` or
`temple_inventory/www/inventory.html`. Produce them through the Vite build. Preserve
Frappe route integration, locally bundled scanner WASM, and PWA asset paths.

## 15. Validation and definition of done

### Backend scenarios

| Area | Required evidence |
| --- | --- |
| Native interoperability | Create/save/edit/submit/cancel/amend from Desk and frontend in both directions; unknown fields/row names survive; no workspace ownership. |
| Concurrency/retry | Concurrent create retries produce one native document; stale save/delete/submit rejects; lost-response confirmation is safe; in-flight edits survive. |
| Permissions | Guest/non-manager frontend denial, DocType/Item/company/warehouse/User Permission checks, restricted aggregate/export scope, checks repeated at submit. |
| Movements | All nine kinds, multiple items/leaves, group rejection, native batch/bundle quantities, expired receipt policy, no unintended extra stock document. |
| Loans | Same-borrower/activity compatibility, exact original-line references, normal/damaged/Loss separation, partial/concurrent over-settlement rejection, cancel/amend dependencies. |
| Conversions | Per-line vs reusable, explicit failure, stale Item edit, duplicate UOM, historical factors, stock/entered integer and precision rules, no silent rounding. |
| Counts | Blank/zero/not-found; reviewed/unreviewed totals; full/selective baseline; new/removed baseline lines; stale re-review; native differences; matching no-record result; no valuation side effect. |
| Activities | Stable links after rename; new/disabled types; multiline safe notes; lifecycle; hidden/draft/cancelled deletion blockers; concurrent link/delete protection. |
| Files | Anonymous/unauthorized original and derivative denial; relinking/removal checks; pending upload finalization; primary images; seeded files private with no public leftovers. |
| Reports | All six datasets/views/groupings; native identities, date boundaries, mixed units, statuses, full scope beyond page limits, allocation/master references, empty restrictive selections. |
| History | Native opening/closing, both transfer branches, one count adjustment, cancellation/reversal/amendment, item/location/search drill-through reconciliation. |
| Export jobs | Request-user permissions, exact CSV/XLSX scope, large untruncated result, stable order, private download, denied/revoked access, failed job retry. |
| Account data | Theme/density/text-size validation and per-user isolation; named-view persistence and relative/fixed dates; no preview-state contamination. |

### Frontend and browser scenarios

- Test real routed integration separately from gallery fixtures. A mocked success
  is not proof of server behavior; a rendered route is not functional parity.
- Exercise all destinations, details, nine operation editors, reconciliation, Item/
  Activity/warehouse creation/edit, setup, recovery, attachments, quick/full exports,
  and preference settings. Include loading/empty/failure/forbidden/deleted states.
- Browser recovery: reload, expiry, account switch, competing tabs, blocked storage,
  pending upload reselection, local/native draft labeling, and external document edits.
- Navigation: ordinary reset vs contextual Back, browser Back/Forward, native-ID
  deep link/reload, selection/filters/scroll retained across 1024px transitions.
- Filters: immediate vs Apply/Cancel, nested Escape, stable page position, focus after
  panel placement, complete chips/counts, restricted-empty scope, Clear vs full reset.
- Forms: stable allocation identity, hidden-error reveal, Details/apply/discard,
  expanded workspace, complete review, same-overlay creation, denied saves, and
  valid/invalid 50-item operations. Keep all editable rows mounted.
- Selectors: 1,000-item gallery dataset, offscreen keyboard target/focus retention,
  ordered multi-add, thumbnail states, filtering and failed load-more retry.
- Scanner: deterministic camera emulation plus manual/hardware input paths; camera
  permission denial/unavailability, repeated/unknown/ambiguous scans, cleanup,
  blocked allocation recovery, and no loss of typed input.
- Inspect screenshots directly at 375/768/1024/1440px, all three densities, and
  100/150/200% text scaling for high-risk shared surfaces. Exercise 125/175% settings
  and all themes. Include long Chinese names/notes/paths, mixed units, many chips,
  wide tables, short viewports, focus targets, and reduced motion.
- Native browser zoom and real camera/device checks are separate from CSS text-size
  and emulation checks; explicitly record what was not verified. Automated geometry
  alone does not establish visual fidelity.
- Confirm the production import/build graph excludes gallery/test simulations and
  legacy global styles. Verify no private responses are precached, PWA updates do
  not mix old assets, and gallery entrypoints make no production requests.

### Commands and evidence

From `frontend/`, run the applicable tests and both real builds:

```sh
pnpm test
pnpm type-check
pnpm build
pnpm design:build
pnpm exec playwright test --config playwright.config.ts
pnpm exec playwright test --config playwright.design-preview.config.ts
```

Adapt browser fixtures/configuration to the new native services and shared gallery;
do not leave obsolete workspace tests passing against disconnected mocks. Use an
isolated available server/port and output paths; do not stop unrelated listeners.
Confirm Chinese fonts in screenshots and retain failure traces/results.

The native integration entrypoint, from the bench root, is:

```sh
bench --site development.localhost execute temple_inventory.tests.test_native_inventory.run
```

Continue replacing workspace-specific tests with native-document tests; the native
runner above replaces the old workspace entrypoint. Do not retain the obsolete
runner solely for compatibility. Tests
must use savepoints/rollback for their records/settings; sample reset is explicit.

Use targeted Ruff formatting/checks for Python (tabs, double quotes, line length
110) and Prettier for touched frontend source. Do not run broad rewriting on
unrelated files. Do not repeat passing checks without a change or unresolved concern.

MariaDB/Redis normally use Docker service names `mariadb`, `redis-cache`, and
`redis-queue`. Do not rewrite configuration to localhost when the restricted
tool network cannot resolve them. Verify host resolution and use the environment's
approved escalation path for a real bench invocation if needed. Distinguish
connectivity failure from an actual test assertion failure; report original
tracebacks rather than secondary bench fallback errors.

### Completion report

Record changed behavior/files, capability checklist, commands actually run and
results, screenshots directly inspected, reset/seed verification, and remaining
limitations in a new dated progress file. Review the complete diff independently
against this specification. Do not mark migration complete with missing features,
failed required checks, runtime fixtures, leftover legacy styling, or unresolved
backend prerequisites. No live site has been deployed as part of this task.

Explicit exclusions: financial/valuation reporting, individual-unit serialization,
due dates/overdue loans, imports/backup/restore, Activity merging/bulk deletion,
frontend Activity Type administration, offline stock submission, and cross-device
recovery of incomplete input. These exclusions do not remove the native mechanisms
needed for correct stock accounting or ordinary ERPNext Desk operations.

## 16. Provenance and requirement reconciliation

All relevant requirements from these records are consolidated above. They need not
be read as additional guides, and their former task boundaries are superseded by
section 1. Preserve historical evidence and unrelated references; only change active
guidance where it conflicts with this migration or claims incorrect current status.

| Historical source | Requirements incorporated here |
| --- | --- |
| `AGENTS.md` | ERPNext invariants, warehouse semantics, structured context, permissions, frontend architecture, generated assets, formatting, and test environment. Workspace/style rules superseded explicitly. |
| `UI_UX_DECISIONS.md`, UX-01–14 and latest dated supersessions | Native identity, loans, search, counts, audience, private files, clean replacement, creation, scope totals, compact editing, Activities, reporting, compact filters, and final labels. |
| `DESIGN_SYSTEM.md` | Current preview visual ownership, shared geometry, text scaling, focus/overlay patterns, responsive constraints. Old production foundation is replaced. |
| `DESIGN_MIGRATION_COVERAGE.md` | Preserved/replaced/backend-dependent capability checklist and native interoperability acceptance. |
| `notes/done/20261013_ERPNEXT_PREVIEW_PROGRESS.md` | Native document/version behavior, private files, no hidden stock engine, and preview-only evidence limits. |
| October 13 usability/audit handoffs and progress, including follow-up | Per-card dashboard recovery, selection/creation retention, focus/scroll behavior, full-draft validation, text scaling, attachments, and accessibility. |
| `notes/done/20261014_DESIGN_PREVIEW_SIMPLIFICATION_HANDOFF.md` and its implementation/review record | Compact allocations/Details, expanded editor, all conversion semantics, large selectors, native conversion/search requirements, and test matrix. |
| `notes/done/20261015_DESIGN_ACTIVITIES_REPORTS_HANDOFF.md` | Activity fields/types/lifecycle/list/detail, information display, six reports, export traceability, dates, named views, and More navigation. |
| `notes/done/20261015_ACTIVITIES_REPORTS_BACKEND_REQUIREMENTS.md` | Coordinated schema retirement, server guards, native historical balances, complete/scalable permission-safe exports, and account presets. |
| `notes/done/20261016_DESIGN_ACTIVITIES_REPORTS_REVIEW.md` | Original loan-line identity, indirect settlement joins, grouped detail retention, lifetime scope, paginated tables, and keyboard tabs. |
| October 16 compact-filter handoff/progress/review | Compact panels, normal-flow toolbar, chips/reset semantics, focus/placement, and 44px panel targets. Historical incomplete-scaffolding statements are not current requirements. |
| October 16 user decisions in this conversation | Replace old UI; development-only reset; shared gallery; three account themes; native drafts plus browser recovery; no record for matching counts; local-only delivery; one consolidated handoff. |

The implementation must not resurrect a superseded rule because an older file is
longer, marked approved, or under `done/`. If a later user request changes a locked
decision, update this specification and the concise active conflict notices together.
