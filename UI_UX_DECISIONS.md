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
- `Warehouse Type` expresses physical meaning (`Room` or `Location`), while
  `is_group` expresses hierarchy. Do not infer type from depth or naming.
- Stock is held only in leaf warehouses. Group warehouses remain navigable
  organizational nodes.

## Transactions

- The custom workspace is optional convenience, not a requirement for stock
  documents created and managed directly in ERPNext.
- Expired batches may be received, including expired donations; show their state
  without blocking the operation solely because they are expired.
- A transaction-changing edit invalidates its signature. If reconfirmation is
  required, the signature control must remain visible and actionable.
- Supporting-data creation returns to the current transaction without losing its
  draft or context.

## Supersession log

- **2026-09-28:** Editable Item Codes supersede the server-only allocation rule.
  Preview-only automatic suggestions were chosen to avoid gaps from abandoned
  forms.
- **2026-09-28:** A visible, changeable UOM autocomplete initialized to `Nos`
  when available supersedes Receive-only defaulting. Submission must never
  replace the user's selected UOM behind the scenes.
- **2026-09-28:** A dedicated routed page supersedes the standalone
  drawer-over-empty-page item-creation layout; the transaction ItemPicker keeps
  its contextual drawer.

