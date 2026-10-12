# Design-system review playground

Experimental review material, not an approved design system or an agent rule.
Production screens, backend contracts, `AGENTS.md`, and `UI_UX_DECISIONS.md` are
unchanged. The current/proposed switches compare interaction structures; both
are drawn using the selected candidate theme, rather than reproducing historical
production screenshots.

## Open the preview

From `frontend/`:

```sh
pnpm design:dev
```

Open **http://localhost:5174/design-preview.html**. In a remote development
container, forward port 5174 and open that forwarded origin with the same path.
The server requires no Frappe login or backend connection.
Opening the bare port (`http://localhost:5174/`), `/index.html`, `/inventory`,
or an old `/login` URL redirects to the playground. Unknown routes and API
requests return 404 instead of falling back to the production app's login flow.
If an already-open tab shows the old login screen, reload it after the server
restarts; logging in on ports 8000/8001 is not required for this preview.

```sh
pnpm exec vitest run tests/design-preview.test.ts tests/design-preview-server.test.ts
pnpm type-check
pnpm design:build
```

The isolated build writes only to `/tmp/temple-inventory-design-preview`.
It excludes the production entry, Frappe build hooks, and PWA plugins. The normal
production build does not include the preview entry. No dependency was added.

## What the source audit found

The pre-change scan of Vue style blocks and CSS found **305 unique literal hex
colors**, **27 distinct font-size declarations**, and **24 border-radius
declarations**. These counts describe source declarations, not unique rendered
colors or computed sizes. Some component text was set to 9–11px.

- `src/style.css` layers older global element selectors, `.primary !important`
  styling, page-specific overrides, and a newer `--ti-*` button foundation.
  This makes control appearance dependent on context and cascade order.
- Cards, navigation, browse surfaces, and forms independently specify neutrals,
  accents, geometry, and typography. The same state has multiple visual treatments.
- The app already has reusable interaction infrastructure: buttons, hierarchy
  selection, quantity summaries, async images, and one 1024px responsive contract.
  The preview reuses those production components/helpers where appropriate.
- There were 201 native button tags and 39 `UiButton` usages. Native buttons are
  not inherently a problem; shared appearance and behavior ownership are missing.
- Durable UX decisions already exist, including mobile creation actions,
  explicit confirmation, grouped locations, and optional personnel fields. The
  proposed navigation and action grouping are candidates for explicit approval,
  not silent supersessions of those decisions.

## Review choices independently

1. **Visual direction:** warm bronze, clear blue, or quiet jade. All use the same
   sample content. Each has semantic color tokens, derived interaction colors,
   a Chinese-capable local font stack, and its own control/card rounding.
2. **Density:** compact, balanced (default), or spacious. Desktop text and
   spacing vary; mobile body/input text stays at least 16px and touch controls
   at least 44px. The review chrome retains its own stable sizes.
3. **Navigation:** the existing six destinations, or four groups with warehouses
   under 库存 and movements/loans/pending/drafts under 业务. All destinations
   remain represented, with explicit placeholders outside the two complete demos.
4. **Inventory actions:** retain separate icon-and-text desktop actions and the
   mobile creation FAB, as preferred in review. Contextual desktop export is a
   secondary action with explicit current-filter scope; the Reports destination
   remains available. Search, scan, and filters stay direct.
5. **Receiving form:** date stays at the top in both layouts. The preferred
   layout adds the persistent review summary on the right (a bottom summary on
   mobile); the original end-of-form submit remains available for comparison.
   Both require an explicit final confirm.

Only review choices are persisted, under `ti:design-preview:v2`. Existing v1
theme, density, and navigation choices are retained while the revised action
and form defaults are adopted. Fixture edits
survive view, theme, density, pattern, and breakpoint changes for the current
page session; a browser refresh resets sample records. Storage failures fall
back to in-memory choices without blocking use.

## Component and behavior coverage

| Area        | Review examples                                                                            |
| ----------- | ------------------------------------------------------------------------------------------ |
| Foundations | Type hierarchy, numbers, palettes, spacing, radii, restrained elevation                    |
| Controls    | Four button variants, icon button tooltip, disabled/loading/focus states                   |
| Forms       | Text, quantity, date, select, search, textarea, checkbox, radio, inline validation         |
| Browsing    | Tabs, hierarchy filters, removable chips, sorting, selection, cards/table                  |
| Data        | Per-unit summaries, long labels, batch/location details, expired and missing-image records |
| Feedback    | Loading, retained-content refresh, empty, error/retry, saved, conflict, toast              |
| Context     | Action menu, modal/drawer, item picker, simulated scanning and attachments                 |

The fixture reference date is **2026-10-11**, so expiry labels stay deterministic.
The rice, oil, clothing, and container graphics are local SVG illustrations;
missing-image samples use the production `AsyncImage` fallback. Scanning,
uploads, saves, exports, and confirmations never use real APIs, files, or cameras.

## Review revision: images, locations, and applicable metadata

- Cards and list rows use the same click/tap image viewer. Item names separately
  open the detail sample. Missing images remain noninteractive. This is an
  experimental preview change to the production rule that card images are inert;
  no production UI or durable UX rule is changed in this phase.
- Location chips show the single path or a count such as `3 个库位`. Hover/focus
  opens the shared production popover; click pins it and mobile uses tap.
  Its per-location available quantities sum to the item's displayed available
  quantity. Selecting warehouse filters restricts both to the same scope.
- Rice demonstrates two distinct batches across three locations (including one
  batch in multiple locations). Work clothes demonstrate multiple locations
  without batches. Cloth demonstrates batch tracking without expiry tracking.
- Batch identifiers appear only for batch-tracked items. Expiry badges and fields
  appear only when applicable; undated items have no generic “正常” badge.
- The gallery now includes a 30-row editable table with expandable supplementary
  fields and a read-only detail specimen. These test component density and visual
  hierarchy; complete creation, item/transaction/warehouse details, and report
  page redesigns remain a later pass.

## Manual review scenarios

No browser automation was run. Validate these scenarios manually:

- **375px:** all three themes and densities; no document-level horizontal scroll;
  readable Chinese labels and inputs; four/six bottom destinations; filter drawer,
  action menu, and review footer stay reachable. Tables may scroll within their
  own container. Keep the browser keyboard in view when editing a quantity.
- **768px:** gallery and inventory wrapping; labels with long names; drawer
  dismissal; mixed-unit summary; draft and selected items retained when resizing.
- **1024px:** desktop sidebar appears at the shared breakpoint; the filter rail
  replaces the drawer; changing layouts preserves filters and edited quantities.
- **1440px:** compare cards, table, form summary, type hierarchy, and whitespace
  in all three densities. Compare current and proposed workflows independently.
- **Keyboard:** Tab/Shift+Tab through controls, Enter/Space to activate; Escape
  closes menus and overlays; dialog focus stays inside and returns to its trigger.
- **Zoom/reduced motion:** 200% browser zoom without clipped operations; reduced
  motion disables spinners/transitions without hiding loading messages.
- **Receiving recovery:** set quantity to zero, correct it, toggle failure,
  attempt confirmation, return to editing, disable failure and retry. Inputs
  remain intact. Conflict pauses confirmation; completing the demo locks edits
  until “继续编辑示例” is chosen.
- **Locations:** inspect rice's `3 个库位` and `2 个批次`, then filter to
  `斋堂 / A-02`: rice should show 32 available bags, one location, and one batch.
  Work clothes have no batch/expiry chip; cloth has a batch chip but no expiry.
- **Images:** open a card image and a list thumbnail; close with Escape and check
  focus restoration. Open the image from the detail sample, close it, and verify
  the detail dialog remains usable. Missing-image placeholders do not open it.
- **Density:** edit quantities in the gallery's 30-row table, expand/collapse
  batch fields, and switch density. Values remain intact.

Automated checks cover preference corruption/unavailability, theme and density
independence, responsive state retention and listener cleanup, filter totals,
sorting/selection, menu dismissal, failed submission recovery, overlay focus and
scroll cleanup, and palette contrast. They do not establish visual correctness
or replace a full accessibility review.

## Approval gate

Record the chosen theme, default density, navigation grouping, inventory action
placement, and receiving organization separately, with requested modifications.
Revise this preview first. Only after approval should a follow-up migrate the
app, replace ad hoc declarations with tokens, add the app-wide density preference,
and record accepted durable decisions in `UI_UX_DECISIONS.md`.
