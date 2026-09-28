# Task: Signature, ERPNext Desk, Expired Batch, and Warehouse Interoperability

## Purpose

Resolve four reported production problems without weakening ERPNext as the
inventory source of truth:

1. a retained signature can be re-confirmed, the re-confirm button disappears,
   and submission still fails with another re-confirmation message;
2. users entering ordinary stock-in/stock-out records in ERPNext Desk are
   forced into the custom Inventory Workspace;
3. the custom transaction UI rejects already-expired donated batches; and
4. Warehouses created in ERPNext Desk do not become usable in the custom app
   even when they follow the app's physical warehouse structure.

Read and follow `AGENTS.md`. Do not edit generated files in
`temple_inventory/public/frontend/` or `temple_inventory/www/inventory.html`.
Preserve unrelated worktree changes.

## Product decisions and invariants

- ERPNext Stock Entry, Batch, Warehouse, Bin, and Stock Ledger Entry records
  remain authoritative. Do not add a parallel inventory store.
- A standard Stock Entry created and maintained in ERPNext Desk must remain a
  valid supported workflow. Using the volunteer-facing app is optional.
- A Stock Entry genuinely owned by an Inventory Workspace must retain its
  revision, signature, and out-of-band edit protections.
- Expired stock is valid stock. The temple may receive an already-expired
  donation and must be able to record it faithfully.
- Group Warehouses never hold stock. Only valid permitted leaves may be used in
  transaction rows.
- Warehouse meaning comes from structured fields and configured ancestry, not
  display-name substrings or hierarchy depth.
- Server-side permission, company, configured-root, leaf, and allowlist checks
  remain authoritative.

## Scope assumption to confirm

The report says "add a new IN/OUT transaction from ERPNext's interface." This
task assumes that means the standard ERPNext **Stock Entry** form using
Material Receipt and Material Issue. If the reporter instead means direct
creation of the custom Inventory Loan, Inventory Return, or Inventory Loss
DocTypes, stop and confirm the desired lifecycle before changing those
controllers: those documents currently depend on linked Stock Entries and have
additional loan/outcome invariants.

## Investigation findings

### 1. The visible signature control and authoritative state disagree

`workspace_api.py` tracks independent structured state for `handler`,
`recorder`, and `reviewer` signatures. A business edit can correctly mark every
retained signature stale, and `_audit_check` rejects any present signature that
is no longer valid.

`frontend/src/pages/Workspace.vue`, however, only renders the stale warning and
`reconfirm_signature` action for `handler`. It does not expose equivalent stale
state/actions for `reviewer` or `recorder`. Therefore this sequence is possible:

1. handler and reviewer/recorder signatures exist;
2. business content changes, making more than one signature stale;
3. the user re-confirms the handler;
4. the handler button disappears because that signature is now valid; and
5. submission still fails because another retained signature is stale and has
   no visible re-confirm control.

The backend error is generic (`签名内容已变化，请重新确认签名`), which gives the
user no way to identify the remaining signer. Existing backend coverage checks
only the handler stale state and does not exercise the full multi-signer
re-confirm-and-submit sequence.

### 2. Direct Desk entries can be claimed by the workspace lifecycle

`workspace_api.open_entry` creates an Inventory Workspace for an unsubmitted
Stock Entry whenever `ti_movement_kind` is populated and no workspace exists.
After that, `stock.protect_workspace_entry` correctly blocks direct edits
because a reverse `Inventory Workspace.stock_entry` link now exists.

Separately, `stock.validate_stock_entry_submission` applies custom signature
requirements to every Stock Entry with `ti_movement_kind`, whether or not the
entry is actually owned by a workspace. These two policies conflate optional
Temple Inventory metadata with workspace ownership.

Direct ERPNext entries are already intentionally included by history/detail
logic, so supporting them does not require converting them into workspaces.

### 3. Expired receipt rejection is custom code

`workspace_api._prepare` explicitly throws `This batch is expired` whenever a
Batch expiry date precedes the posting date. This check applies to all movement
kinds, including Material Receipt, and prevents recording already-expired
donations. The batch lookup itself already returns enabled expired batches; the
blocking behavior is the preparation validator.

### 4. Physical-tree membership and operational allowlisting are separate

Warehouse browse data comes from readable Warehouses below the configured
`physical_root_warehouse`, while transaction choices come from the
`Temple Inventory Settings.allowed_warehouses` child table. App creation APIs
append new leaves to that allowlist. Creating the equivalent leaf directly in
ERPNext Desk does not append it, so it may be present in the physical topology
but absent from transaction selectors and balances.

The relevant structured Warehouse Types currently accepted by the app are
Chinese and English forms (`房间`/`Room`, `库位`/`Location`, and physical
organizational groups such as `地点`). A room group also needs a stock-holding
leaf; the app normally creates a marked fallback leaf for that purpose.

## Workstream A: complete the multi-signer signature workflow

Primary files:

- `temple_inventory/workspace_api.py`
- `frontend/src/pages/Workspace.vue`
- `frontend/src/pages/Reconciliation.vue` if the same state loss is confirmed
- `frontend/src/components/SignaturePad.vue` only if its contract must change
- focused backend and frontend tests

Required behavior:

1. Show the authoritative `valid`, `stale`, or `absent` state for every signer
   that is present or applicable to the transaction: handler, reviewer, and
   recorder where used.
2. Keep every retained drawing visible after business edits. Never clear or
   silently replace a signature as part of autosave, hydration, or
   re-confirmation.
3. For each stale signer, provide an adjacent and role-specific action to:
   re-confirm the retained drawing, redraw/replace it, or clear it.
4. Re-confirming one signer must update only that signer's validity. It must not
   make another signer valid, stale, or absent.
5. The review/submit flow must detect missing/stale required signatures before
   opening or confirming the final review. It should list the exact roles still
   needing action and focus or link back to those controls. Keep the server
   check authoritative.
6. Backend validation errors must identify the stale role, or return structured
   signer state that the frontend can map to an exact message. Do not leave the
   user with a generic instruction and no actionable control.
7. After all required retained signatures are re-confirmed against unchanged
   business content, the very next submit must succeed. Submission itself must
   not change the canonical digest.
8. Preserve the rule that reviewer-only metadata changes do not invalidate an
   unchanged handler/recorder attestation.
9. Apply the same state-preservation and actionable stale controls to
   Reconciliation if its current `adopt()` path drops or hides signature state.

Regression tests must cover at least:

- handler plus reviewer signed, then one business edit marks both stale;
- re-confirm handler: handler becomes valid, reviewer remains visibly stale;
- re-confirm reviewer: both become valid, and submission succeeds;
- a retained optional recorder signature becoming stale is either actionable
  or deliberately excluded from final blocking according to the documented
  requirement—never hidden while blocking;
- adding/re-confirming reviewer data does not stale the handler;
- autosave/hydration and an unchanged save do not alter a valid digest;
- role-specific server errors and local review validation; and
- clear/redraw/re-confirm behavior for each exposed signer.

Do not "fix" this by treating every retained image as valid or by automatically
re-attesting it after an edit.

## Workstream B: keep ERPNext Desk Stock Entries independent

Primary files:

- `temple_inventory/stock.py`
- `temple_inventory/workspace_api.py`
- `temple_inventory/hooks.py` only if event wiring must change
- `temple_inventory/fixtures/custom_field.json` only if field presentation or
  ownership metadata must change
- backend integration tests

Define one authoritative ownership predicate. A Stock Entry is
workspace-owned only when a real Inventory Workspace links to that entry (and,
where available, the forward `ti_workspace` link agrees). Do not use the mere
presence of `ti_movement_kind` as proof of workspace ownership.

Required behavior:

1. A user with normal ERPNext permissions can create, save, edit, and submit a
   standard Material Receipt or Material Issue entirely in Desk.
2. Opening or viewing that direct entry from custom history/detail must not
   create an Inventory Workspace, move attachments, rewrite the Stock Entry, or
   make subsequent Desk edits fail.
3. Direct entries remain visible in the app's permission-filtered history and
   detail views with movement kind inferred from standard ERPNext purpose when
   needed.
4. Custom signature requirements apply to workspace/accountable app flows, not
   to unrelated direct Stock Entries merely because optional Temple metadata is
   populated. Standard ERPNext mandatory fields and permissions still apply.
5. Workspace-created draft Stock Entries remain protected from direct Desk
   modification, because bypassing the workspace would invalidate autosave,
   revision, and attestation state.
6. If conversion of a direct draft into an editable workspace is retained as a
   feature, make it an explicit, permission-checked user action with clear
   consequences. A read/open endpoint must not perform that mutation.
7. Do not relax cancellation propagation or the traceability of submitted
   Loan/Return/Loss records.

Regression tests must prove both sides of the boundary:

- direct Desk Material Receipt: create, second save, submit, no workspace link;
- direct Desk Material Issue with valid stock: create, edit, submit, no
  workspace link;
- a direct draft viewed through the app remains Desk-editable and creates no
  workspace or attachment mutation;
- direct entry with `ti_movement_kind` does not accidentally become
  workspace-owned or inherit workspace-only signature requirements;
- a workspace-created Stock Entry still rejects out-of-band Desk edits; and
- history/detail includes direct submitted entries without duplicates.

## Workstream C: accept already-expired donated batches

Primary files:

- `temple_inventory/workspace_api.py`
- `frontend/src/pages/Workspace.vue`
- focused batch tests

Required behavior:

1. Material Receipt must accept an expiry date before the posting date for a
   newly created batch. This is the core reported donation workflow.
2. Material Receipt must also allow selecting an existing enabled expired Batch
   belonging to the same Item when that is otherwise valid ERPNext behavior.
3. Preserve date integrity: when both exist, manufacturing date cannot be after
   expiry date. Preserve Item/Batch identity, disabled Batch, permission,
   warehouse, quantity, and ERPNext ledger validation.
4. Do not rewrite the expiry date, backdate the transaction automatically, or
   mislabel an expired donation as non-expired.
5. Show a clear non-blocking `已过期` warning beside expired batch choices and
   in the line/review summary. The choice must remain selectable.
6. Existing expired positive stock must remain available to the workflows that
   legitimately handle it (for example issue, transfer, reconciliation, damage,
   or disposal), subject to ERPNext's operation-specific rules. Do not add a
   second blanket expiry prohibition elsewhere.
7. Confirm behavior against the installed ERPNext version with an integration
   test; if ERPNext itself applies an operation-specific restriction, document
   that exact core restriction rather than bypassing core validation.

Regression tests must include:

- new expired Batch plus Receive draft sync and final submission;
- existing expired Batch plus Receive;
- expiry equal to posting date;
- manufacture-after-expiry still rejected;
- disabled/wrong-Item Batch still rejected; and
- frontend choice, warning, review rendering, and successful submission path.

## Workstream D: recognize valid Warehouses created in ERPNext Desk

Primary files:

- `temple_inventory/inventory_api.py`
- `temple_inventory/hooks.py` and a narrowly scoped Warehouse event helper if
  event-driven synchronization is selected
- Temple Inventory Settings and fixtures only if required
- Warehouse backend/frontend contract tests

### Eligibility contract

A Desk-created Warehouse may appear in the volunteer-facing physical tree when
all of these are true:

- it belongs to the configured Temple Inventory company;
- it is below the configured `physical_root_warehouse`;
- it is readable under normal Warehouse/User Permissions;
- it is not a configured system/virtual Warehouse and is not below the virtual
  or leased branch; and
- its `is_group` and structured Warehouse Type are compatible.

Operational use additionally requires a stock-holding leaf:

- `is_group = 0`;
- Warehouse Type is `库位` or `Location` (accept the established bilingual
  values consistently); and
- its ancestry is a valid physical branch, normally below a `房间`/`Room`
  group.

A Desk-created group may appear for browsing but must never be used directly in
a Stock Entry. A Room without a child leaf should remain visible with an
actionable "no stock location" status; it must not silently disappear or be
treated as a leaf. Creating/repairing a fallback leaf should be an explicit
manager action unless a reviewed Warehouse event can do so atomically without
surprise.

### Allowlist synchronization

Close the current gap where app-created leaves are appended to
`allowed_warehouses` but equivalent Desk-created leaves are not.

Implement one idempotent, permission-safe synchronization path for newly
eligible physical leaves. Prefer an explicit structural rule or narrowly scoped
Warehouse document event; do not mutate settings as an incidental side effect
of an ordinary GET request. Existing manual allowlist controls must retain a
documented meaning—if managers can deliberately exclude a leaf, automatic
discovery must not immediately undo that decision.

If automatic eligibility and manual exclusion cannot be represented by the
current child table, introduce the smallest structured state needed to
distinguish "new/unreviewed," "allowed," and "explicitly excluded" rather than
discarding the authorization boundary.

Required behavior:

1. A correctly typed physical location created in ERPNext Desk becomes visible
   in Warehouse management and, once allowed by the defined synchronization
   policy, in transaction selectors and balance queries without recreating it
   in the app.
2. A correctly typed Room/group created in Desk appears in the browse tree even
   before it has a usable child leaf.
3. Missing or incompatible Warehouse Type details produce an actionable manager
   diagnostic naming the exact field/value needed; they do not fail silently.
4. Wrong-company, outside-root, virtual/system, group-as-stock-location, and
   permission-hidden Warehouses never leak into operational choices.
5. Renames and moves use stable Warehouse document identifiers and authoritative
   ancestry. Do not match on labels or depth.
6. App-created warehouse behavior remains unchanged, including marked fallback
   leaves and immediate usability.
7. Bootstrap, Warehouse management, Inventory, Item Detail, Workspace selectors,
   and reconciliation use the same centralized eligibility/allowlist result.

Regression tests must cover:

- Desk-created `Location`/`库位` leaf under a valid physical Room;
- Desk-created `Room`/`房间` group with and without a child leaf;
- missing Warehouse Type and incompatible group/type combinations;
- explicit manager exclusion versus automatic discovery;
- other company, outside root, virtual branch, leased branch, and group rows;
- Warehouse User Permission hiding; and
- consistent appearance across bootstrap, Warehouse tree, transaction choices,
  inventory balances, and reconciliation choices.

## Coordination and suggested ownership

This task crosses backend and Vue behavior. It may be split between agents, but
freeze the contracts first:

- Agent A: signature backend plus backend regression tests.
- Agent B: Workspace/Reconciliation signature UX plus frontend tests.
- Agent C: Desk ownership boundary, expired batches, and Warehouse discovery/
  allowlist interoperability plus backend integration tests.

Agents must coordinate edits to `workspace_api.py` and
`temple_inventory/tests/test_workspace.py`; prefer separate focused test modules
where practical to reduce conflicts.

## Validation

Run focused Vitest files while developing, then from `frontend/`:

```sh
yarn test
yarn type-check
```

From `frappe-bench/`, run the focused backend modules and the aggregate suite:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

Do not launch Playwright unless explicitly requested. The user will perform
manual browser validation. If the restricted sandbox cannot resolve the Docker
service hostname `mariadb`, rerun backend tests with the development-container
network before reporting a database failure.

## Manual acceptance scenarios

1. Create a Receive transaction with handler and reviewer signatures, edit one
   quantity, re-confirm each visibly stale signer, and submit once successfully.
2. Create and submit Material Receipt and Material Issue in ERPNext Desk without
   visiting or being redirected to Inventory Workspace.
3. View those direct entries in the custom app, return to Desk, edit a remaining
   draft, and verify it was not silently converted.
4. Receive a donated batch whose expiry date is in the past; verify the warning,
   successful Stock Entry submission, Batch identity, and ledger quantity.
5. In ERPNext Desk, create a correctly typed Location leaf under the configured
   physical Room. Verify it appears in Warehouse management and becomes an
   eligible app transaction location under the documented allowlist policy.
6. Create a malformed or outside-root Warehouse and verify it is excluded with
   an actionable manager diagnostic where appropriate.

## Completion gate

- No required signer can remain stale and hidden while blocking submission.
- Re-confirming all identified stale required signatures permits immediate
  submission when content has not changed again.
- Direct ERPNext Stock Entries are first-class, supported records and are not
  implicitly claimed by Inventory Workspace.
- Workspace-owned Stock Entries retain out-of-band mutation protection.
- Already-expired donations can be received without falsifying dates.
- Correctly structured Desk-created Warehouses are discoverable and usable
  according to one explicit, tested authorization policy.
- Focused frontend/backend tests, full frontend unit tests, type checking, and
  the aggregate backend suite pass.
