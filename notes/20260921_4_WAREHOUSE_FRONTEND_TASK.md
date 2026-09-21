# Task 4: Warehouse Frontend — Logical Browse, FAB Creation, and Detail

## Assignment

This is the complete handoff for the agent that owns the Warehouse frontend.
Read `20260921_1_WAREHOUSE_ABSTRACTION_AND_DETAIL_UX_TASK.md` for the locked
product design, but implement only the scope below.

Primary ownership:

- a focused warehouse presentation utility/composable under `frontend/src/lib/`;
- `frontend/src/pages/Warehouses.vue`;
- a new `frontend/src/pages/WarehouseDetail.vue`;
- Warehouse-specific components and frontend tests;
- the `/warehouses/:warehouse` route; and
- component-scoped Warehouse styles.

Do not edit `frontend/src/style.css` or non-Warehouse pages; task 5 owns those.
Do not change backend endpoints; task 2 owns them. Build against shared fixtures
until the real payload lands, then perform a narrow integration pass.

## Outcomes

1. Warehouse browse shows a simple logical hierarchy, not ERPNext group/leaf
   implementation details.
2. An indented room is `A02`, not `第2寺院 / A02`; generated fallbacks are shown
   only where distinction is needed as `无货位` or `无房间`.
3. Adding a room/location uses the shared FAB and semantic form; users never
   choose “group” or see the hidden generated child.
4. Warehouse detail is a separate route with Item Group summaries, current stock
   preview/link, recent movements, and useful actions.
5. Manager diagnostics/editing remain available as secondary actions without
   dominating volunteer UI.

## Backend fixture boundary

Use the contract defined by task 2. Keep TypeScript types explicit and validate
all nullable capability states.

### Presentation semantics

Each warehouse row provides separate values for:

- immutable real identifier;
- stored label;
- local display label;
- accessible breadcrumb;
- structured semantic type and fallback role;
- logical display depth;
- filter value for descendant expansion;
- real permitted operation leaf, which may be null;
- logical room/default-leaf relationship; and
- capability flags.

Never reconstruct semantic type from depth or parse `未指定` in page templates.
One shared presenter may retain legacy compatibility during migration, but the
structured server fields win.

Display rules:

- an indented named child uses its local label (`A02`);
- its breadcrumb remains available to screen readers/tooltips where ambiguity
  exists (`第2寺院 / A02`);
- a fallback directly under a Room is `无货位`;
- a fallback under another physical group is `无房间`;
- normal room browse collapses the generated fallback leaf into its room; and
- `filter_value` and `operation_value` are never treated as interchangeable.

### Semantic creation fixtures

Use distinct methods/forms for:

- Add Room: parent physical group + room name;
- Add Location: parent room + shelf/location name.

The Add Room response includes the logical room and its hidden real fallback
leaf. The client displays the logical room only. Do not send `is_group`, raw
Warehouse Type, company, or arbitrary allowed-location changes from the form.

### Detail fixture

Support:

- metadata/capabilities;
- Item Group summary rows with UOM-safe quantities;
- bounded stock preview, total/count, and Inventory deep link;
- latest 10 movement rows and History deep link;
- independent loading/error/empty states for stock and movements; and
- permission-safe quick-action seeds.

## Workstream A — shared warehouse presenter

1. Move warehouse-specific display logic out of generic `lib/api.ts` where
   practical into one typed utility/composable.
2. Produce explicit `localLabel`, `breadcrumb`, `displayDepth`, `filterValue`,
   and `operationValue` accessors.
3. Support the migration interval without allowing raw-name heuristics to
   override structured roles.
4. Export the presenter/type boundary for task 5. Task 5 applies it on Inventory,
   Expiry, History, Item Detail, Workspace, and reconciliation; this task does
   not edit those pages.
5. Test Room, Location, non-Room physical groups, fallbacks, duplicate local
   labels, hidden/inaccessible leaves, missing/multiple defaults, and renamed
   records.

## Workstream B — Warehouse browse

1. Keep `Warehouses.vue` browse-only. Remove embedded selected-node detail,
   create/edit form sprawl, and operational diagnostics from the main list.
2. Render desktop table and mobile cards from the same logical rows. Preserve
   hierarchy, keyboard navigation, touch targets, loading/error/empty states,
   count, incremental loading, and scroll restoration.
3. Clicking a row opens `/warehouses/:warehouse`. Disclosure and selection are
   separate controls in a tree-like UI.
4. Remove volunteer-facing ERPNext explanations, including:
   `仅显示实体仓库；虚拟、借出、损坏和未定位系统仓库不会出现在这里。` and
   `这是分组；库存操作会要求选择实际叶子位置。`
5. Do not replace them with other group/leaf jargon. Show an actionable manager
   diagnostic only for a real configuration problem.
6. Keep search/filter behavior and URLs stable across reload/back navigation.

## Workstream C — FAB room/location creation

1. Remove the top-right Add Warehouse button. Use the existing
   `FloatingActionMenu` pattern with accessible label and tooltip.
2. At the root/group context, offer `添加房间`. In a room context, offer
   `添加货位`. Avoid an unrestricted generic warehouse form.
3. Add Room asks only for parent (when not implied) and room name. Explain in
   plain language that stock can be placed in the room without naming a shelf;
   do not show that a hidden leaf will be created.
4. Add Location asks for parent room and location name.
5. On success, toast once, refresh/inject the logical row, focus it, and retain
   current scroll/search where sensible. On failure, retain form data.
6. Trap/restore modal focus, support Escape/cancel, prevent duplicate submission,
   and remain usable on narrow screens and with the keyboard.

## Workstream D — separate Warehouse detail

Create a dedicated route and page with:

1. back navigation, local title, optional breadcrumb, status/capability state,
   and no redundant page title;
2. `库存分类` section showing every represented Item Group with UOM-safe totals;
3. `当前库存` preview with item, batch/expiry where relevant, location label,
   quantity/UOM, bounded count, and a prominent link to Inventory filtered by
   the logical warehouse;
4. `最近动态` with latest 10 movement summaries and a link to History filtered by
   the same logical warehouse;
5. permitted quick actions for Receive/Issue/Transfer/Reconciliation using real
   operation leaves from the backend, never the group identifier; and
6. manager edit/repair/permission actions in an overflow/secondary region.

Group summaries must not add incompatible UOMs. A room detail aggregates only
permitted descendant leaves. Missing/multiple fallback leaves keep the page
viewable but disable operations and show an actionable manager state.

Stock and movement failures are independent: one successful section remains
visible while the other retries. Removed/inaccessible route targets show a clear
not-found/permission state and path back to Warehouse.

## Styling and accessibility

- Use component-scoped styles or Warehouse-specific component styles only.
- Do not edit global `style.css`; task 5 is the sole owner to avoid conflicts.
- Reuse current tokens/components for browse width, cards, toolbar, FAB, modal,
  detail sections, status, and errors.
- Tables stay contained; mobile cards show equivalent information.
- Announce logical labels, not hidden raw fallback names.
- Indentation is supplemented by breadcrumb/accessibility text.
- Provide visible hover, focus-visible, active, disabled, and reduced-motion
  states through existing shared rules plus scoped fixes where needed.
- Do not use hover motion that shifts layout or clips inside scroll containers.

## Frontend tests

Add focused tests for:

- presenter labels/values for named nodes and both fallback roles;
- `A02` local label versus `第2寺院 / A02` breadcrumb;
- logical collapse without losing filter/operation values;
- permission-hidden/missing/multiple default leaf behavior;
- browse loading/error/empty/incremental states and stable keyed rows;
- route encoding, back/scroll restoration, and renamed/current identifiers;
- FAB visibility by capability/context;
- Add Room request excludes group/type internals and renders one logical row;
- Add Location request/refresh, duplicate submit prevention, error retention,
  focus trap/restoration, and Escape;
- detail stock/group summaries, incompatible UOM separation, latest movements,
  partial-section errors, and empty states;
- Inventory/History deep-link query values use `filter_value`;
- quick actions use permitted `operation_value`; and
- removed ERPNext explanatory copy is absent.

Run from `frontend/`:

```sh
yarn test --run
yarn type-check
```

Run `yarn build` during the integration wave because this task adds a route.
Do not launch browser automation; manual responsive validation is handed off.

## Acceptance gate

- Warehouse browse contains no raw group/leaf education and no generated
  fallback row for an ordinary room.
- An indented room reads `A02`; fallback choices read `无货位`/`无房间` according
  to the direct structured parent type.
- The only primary Add affordance is a FAB with semantic Room/Location flows.
- Room creation displays the parent logical node while operations resolve to its
  real hidden leaf.
- Detail shows grouped stock, bounded current stock, recent movements, correct
  filtered links, quick actions, and independent section recovery.
- Focused tests, full frontend unit suite, type-check, and integration build pass.

## Non-goals

- Do not alter stock, Warehouse permission, or creation rules client-side.
- Do not edit non-Warehouse pages merely to migrate labels; task 5 owns them.
- Do not edit global CSS.
- Do not add a UI dependency or a second hierarchy store.
- Do not expose raw ERPNext group/leaf controls to volunteers.
