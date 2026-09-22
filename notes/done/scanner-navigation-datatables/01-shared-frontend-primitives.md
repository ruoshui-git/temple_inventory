# Task 01 — Shared frontend primitives

## Dependencies and ownership

- Wave 1; may run in parallel with task 02.
- Own `frontend/src/components/Scanner.vue`, new shared datatable code, new safe-return code, component-scoped/shared styling needed by these primitives, and focused unit tests.
- Do not edit routed page components owned by tasks 03 and 04.

## Scanner presentation contract

Extend `Scanner.vue` without changing `ScannerService` engine semantics.

Add a presentation prop with these values:

```ts
type ScannerPresentation = 'inline' | 'modal' | 'continuous'
```

- Default to `inline` for compatibility, but all routed call sites added by tasks 03–04 must explicitly choose `modal` or `continuous`.
- `modal`:
  - Render the backdrop and dialog through `<Teleport to="body">`.
  - Use a layer above existing drawers/filter panels (`z-index: 50`) and ordinary content, but below `.auth-modal` and `.toast-host`.
  - Use `role="dialog"`, `aria-modal="true"`, a programmatically associated Chinese title, and the title `扫描条码`.
  - Close on Escape, backdrop click, or the close button.
  - Trap Tab/Shift+Tab inside the dialog and focus the close button or first control after mount.
  - Remember and restore the invoking element when closed/unmounted.
  - Preserve and restore the previous `document.body.style.overflow` value while open.
- `continuous`:
  - Use the title `连续扫码`.
  - At a sufficiently wide desktop breakpoint, position the scanner as a fixed/sticky sidecar in unused space beside the centered workspace, never over its main content.
  - At narrower widths, keep it in normal document flow immediately after the scan controls.
  - On opening or switching to the narrow layout, call `scrollIntoView({ block: 'nearest' })` after render so the camera does not appear elsewhere in the document.
  - Do not add a backdrop or lock document scrolling.
- `inline` retains the current in-flow behavior for compatibility.
- Preserve manual entry, engine switching, duplicate suppression, `paused`, session-expiry handling, and stop-on-unmount behavior.
- Ensure every close path calls `service.stop()` before or while emitting `close`; repeated stops must remain safe.

Keep presentation styling with the component where practical so Wave 2 tasks do not need to edit the global stylesheet.

## Responsive sortable datatable

Create `frontend/src/components/SortableDataTable.vue` and export its TypeScript contracts from the component or an adjacent type file:

```ts
type SortOrder = 'asc' | 'desc'

interface DataTableColumn {
  key: string
  label: string
  sortable?: boolean
  initialOrder?: SortOrder
  headerClass?: string
  cellClass?: string
}

interface SortState {
  sort_by: string
  sort_order: SortOrder
}
```

Component inputs and outputs:

- Inputs: `rows`, `columns`, `rowKey`, current `sort`, optional `selectionMode`, and optional `selectedKeys`.
- Emits: `sort` with a complete `SortState`, `activate` with the row, and `toggle` with the row.
- Slots: dynamic desktop cell slots (`cell-<key>`) and a mobile row slot. Provide the row and column as slot data.

Interaction rules:

- A sortable header is a real button inside `<th scope="col">`.
- Apply `aria-sort="ascending"`, `descending`, or `none` to the header.
- Show a visible up/down arrow only for the active direction; inactive sortable headers still have an accessible hint.
- Clicking the active column reverses its direction. Clicking another column uses that column's `initialOrder`.
- Desktop rows and mobile cards emit `activate` when a non-control area is clicked or activated with Enter/Space.
- Mark explicit nested controls with `data-row-control`. Native controls wrapped by that marker must not activate or toggle the row.
- Mark a title link that represents the row action with `data-row-action`. In normal mode it navigates normally; in selection mode prevent navigation and emit `toggle`.
- In selection mode all non-control row/card clicks emit `toggle`, never `activate`.
- Apply pointer, hover, focus-visible, and selected-state styling to the complete interactive row/card.
- Avoid duplicate activation when the title link performs the same navigation as the row.
- Preserve semantic table markup on desktop and render the supplied mobile slot in the existing mobile breakpoint.

The component does not sort rows locally. It only emits sort intent; page owners reset pagination and request sorted server data.

## Safe-return helper

Create `frontend/src/lib/navigation.ts` with a small public function:

```ts
returnToOpener(router: Router, fallback: RouteLocationRaw): Promise<void> | void
```

Behavior:

1. Read Vue Router's current history state and its recorded `back` location.
2. Resolve that value against `window.location.origin`.
3. Call `router.back()` only when the previous URL is same-origin and lies under the app's `/inventory` history base.
4. If there is no safe in-app predecessor, call `router.replace(fallback)` so direct-entry fallback does not create a back-button loop.

Do not place a synthetic `returnTo` query parameter on routes. Native history is what preserves the exact opener query and scroll position. The helper must tolerate SSR/test environments and malformed history values.

## Focused tests

Add Vitest coverage for:

- Scanner modal teleportation, roles/labels, Escape and backdrop close, focus trap/restoration, body scroll restoration, and stop-on-close/unmount.
- Continuous presentation staying nonmodal and retaining pause/resume behavior.
- Sort header first-click direction, reversal, arrows, and `aria-sort`.
- Desktop and mobile activation, keyboard activation, explicit-control isolation, title-link handling, and selection-mode toggling.
- Safe in-app back versus direct-entry contextual replacement, including malformed or external history values.

Run `yarn test` and `yarn type-check` from `frontend/`.

