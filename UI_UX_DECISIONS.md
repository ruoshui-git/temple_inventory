# Temple Inventory UI/UX Decisions

This is the authoritative, concise record of durable UI/UX decisions. Read it
before changing user-facing behavior. A current user instruction may supersede
an older rule, but the conflict must be identified explicitly and recorded here
in the same change. Keep implementation details in code or task notes, not here.

## Accessibility and responsive behavior

- The volunteer UI is Chinese and mobile-first, with touch-sized controls,
  associated labels, keyboard access, visible focus, and announced errors and
  status changes.
- Manual entry must remain available when camera or browser APIs are unavailable.
- Preserve user-entered data when validation, scanning, upload, or submission
  fails.

## Navigation and layout

- Standalone creation and editing flows use normal routed pages under the
  application shell. Do not render a drawer over an otherwise empty page.
- Drawers are reserved for contextual work that returns to an in-progress flow,
  such as selecting or creating an Item during a transaction.
- Back and cancel actions must have a predictable destination and must not
  silently discard an in-progress transaction.
- Inventory defaults to an image-forward card view when no browser preference
  exists. Users may switch to the sortable table, and the browser remembers the
  valid local choice. Cards emphasize available stock while always retaining
  total, loaned, and damaged quantities.
- List quantity summaries describe the complete permission-filtered result, not
  only loaded pages. Group quantities by each Item's stock UOM and never combine
  incompatible UOMs into one total.

## Feedback

- Show immediate success toasts for completed creation actions.
- Show field-specific validation and availability feedback inline and announce it
  accessibly. Keep the draft intact after a collision or server error.
- Distinguish loading, saving, saved, conflict, and failure states where work is
  asynchronous or durable.

## Item creation

- Item Code is an editable ERPNext-compatible identifier. New forms preview the
  next unused `ITM-######` code without reserving it; users may replace it with
  any valid unique code. Recheck uniqueness on submission and offer a one-action
  way to request a fresh automatic suggestion.
- Item Code identifies an item type or style, not an individual physical unit.
- Default Unit is a visible searchable autocomplete over ERPNext UOM records.
  Select `Nos` initially only when it exists, allow users to clear or replace it,
  and submit exactly the selected UOM. Never silently substitute `Nos` or the
  alphabetically first UOM.
- A typed UOM is valid only when it resolves to an existing UOM. A newly created
  UOM is added, selected, and must not clear other draft fields.
- A newly created Item is immediately available in the transaction that opened
  its form. Standalone creation navigates to the new Item detail after success.

## Scanning

- Put a labeled scanner icon button directly beside scannable barcode/search
  inputs. Use one reusable interaction for item creation and item lookup.
- Opening, cancelling, or failing a scan preserves typed text. A successful
  single scan fills the associated input, triggers its normal lookup/update path,
  and releases the camera.
- Camera, hardware-scanner, and manual entry paths converge on the same workflow.

## Warehouses

- ERPNext is the source of truth. Compatible warehouses created through ERPNext
  must appear in the app; do not require creation through the custom UI.
- Compatibility requires membership below the configured physical warehouse
  root. Warehouses outside that root remain hidden and are not automatically
  moved or offered for adoption.
- `Warehouse Type` expresses physical meaning (`Room` or `Location`), while
  `is_group` expresses hierarchy. Do not infer type from depth or naming.
- Stock is held only in leaf warehouses. Group warehouses remain navigable
  organizational nodes.

## Transactions

- The custom workspace is optional convenience, not a requirement for stock
  documents created and managed directly in ERPNext.
- Volunteers use domain language and do not need to understand Stock Entry
  purposes, DocType navigation, batch screens, or group/leaf mechanics.
- Group lines by room and location. Receiving starts with one destination but may
  add multiple location sections; stock-out operations may use multiple sources.
- Expired batches may be received, including expired donations; show their state
  without blocking the operation solely because they are expired.
- Handwritten signatures and attestation controls are not part of the workflow.
- Every movement and reconciliation form ends with optional text fields for
  记录人, 经手人, and 鉴证人. These never block saving or confirmation.
- The system `recorded_by` user is captured separately from the optional 记录人
  text because the person entering data may differ from the on-site recorder.
- Supporting-data creation returns to the current transaction without losing its
  draft or context.

## Supersession log

- **2026-09-28:** The remembered, card-first Inventory view and complete
  filter-aware per-stock-UOM summaries supersede the table-only Inventory
  presentation and record-count-only list chrome.
- **2026-09-28:** Optional recorder/handler/reviewer text fields supersede all
  handwritten-signature, independent-witness, and re-confirmation rules.
- **2026-09-28:** Only warehouses beneath the configured physical root appear in
  the app; out-of-root Desk warehouses remain hidden.

- **2026-09-28:** Editable Item Codes supersede the server-only allocation rule.
  Preview-only automatic suggestions were chosen to avoid gaps from abandoned
  forms.
- **2026-09-28:** A visible, changeable UOM autocomplete initialized to `Nos`
  when available supersedes Receive-only defaulting. Submission must never
  replace the user's selected UOM behind the scenes.
- **2026-09-28:** A dedicated routed page supersedes the standalone
  drawer-over-empty-page item-creation layout; the transaction ItemPicker keeps
  its contextual drawer.
