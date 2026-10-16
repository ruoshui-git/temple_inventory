# Design preview handoff: Activities, reports, and display consistency

Date: 2026-10-15.
Status: **Approved design and implementation handoff; implementation has not started.**

This is the complete replacement for the earlier proposal discussed in chat.
It includes the user's final corrections to activity types, detailed notes,
information display, and the preference for breaking changes. This document is
planning evidence, not evidence that code, backend migrations, tests, or visual
inspection have been completed.

## 1. Delivery and implementation boundaries

Implement the approved behavior in the standalone design preview. Document
backend and production requirements separately; do not implement production
APIs, schemas, database changes, or generated production assets in this task.
The implementing agent performs the visual audit and fixes described below.
**Do not use subagents.** This explicit user instruction supersedes the default
implementation-delegation workflow in `AGENTS.md` for this task.

**Prefer breaking changes across both previews and production.** Replace
obsolete schemas, APIs, types, routes, and fixtures cleanly. Do not add
compatibility aliases, preserve old hashes, or migrate obsolete field values
solely for compatibility. Database resets are acceptable when needed during a
later production migration; no reset belongs to this preview implementation.

Preserve functional capabilities and stock/accounting correctness, rather than
obsolete implementation contracts. ERPNext remains the inventory source of
truth. A breaking-change preference does not authorize a parallel stock ledger
or silently changing the meaning of recorded quantities.

The comparison baseline was the repository's production frontend and backend
source, not a live deployed session. No new browser audit or implementation
checks were run during planning. Historical progress notes are not current
verification evidence.

In the implementation change, update:

- `UI_UX_DECISIONS.md`, including explicit supersessions in the decision log.
- `DESIGN_SYSTEM.md` for shared display patterns and intentional geometry.
- `DESIGN_MIGRATION_COVERAGE.md` for preserved/replaced capabilities and backend
  dependencies.
- The preview README, route index, fixtures, and affected tests.
- Any conflicting guidance about mandatory obsolete metadata or compatibility;
  preserve unrelated repository instructions.

Create a separate dated progress note, such as
`notes/20261015_DESIGN_ACTIVITIES_REPORTS_PROGRESS.md`, with actual implementation
status, commands/results, review URLs, screenshot paths, unresolved issues, and
backend requirements. Do not mark this handoff itself as execution evidence.

### Read-first implementation map

Read root `AGENTS.md`, `UI_UX_DECISIONS.md`, `DESIGN_SYSTEM.md`, and
`DESIGN_MIGRATION_COVERAGE.md` before implementation. The completed 2026-10-14
simplification handoff/progress under `notes/done/` explains existing allocation,
conversion, text-scaling, and virtual-selector behavior that must remain usable.

Relevant entry points:

- Production comparison: `frontend/src/features/workspace/WorkspaceView.vue`,
  `frontend/src/features/reports/useReportsController.ts`,
  `temple_inventory/reporting.py`, and `temple_inventory/workspace_api.py`.
- Preview forms/context: `PreviewFormPages.vue`, `PreviewReceive.vue`,
  `components/PreviewTransactionContext.vue`, `formModel.ts`, `reviewModel.ts`,
  and `workflowModel.ts`, all under `frontend/src/design-preview/`.
- Preview routing/reports: `PreviewApp.vue`, `navigation.ts`,
  `PreviewUtilityPages.vue`, `PreviewBrowsePages.vue`, `PreviewInventory.vue`,
  `browseModel.ts`, and `components/PreviewPeriodFilter.vue`.
- Despite its name, `PreviewActivityBrowse.vue` currently implements Movement
  and Loan browsing. It is not an existing activity-management page. Keep those
  capabilities intact when adding actual Activities.

The preview keeps its own `--p-*` styling and preview-local components. Do not
replace that visual foundation with production styled components during this
task. Use the shared responsive-layout contract and 1024px breakpoint.

## 2. Movement cleanup and information display

### 2.1 Movement fields

Apply these rules to routed forms, canonical Receive, contextual creation,
confirmations, and saved-record displays:

| Field | Approved behavior |
| --- | --- |
| 来源类型 | Remove. Activity type remains a separate concept. |
| 负责人 | Remove. |
| 来源 | Receive only; free text using the production label. |
| 用途 | Non-Receive movements only; separate from Activity. |
| 关联活动 | Retain searchable selection and contextual creation. |
| 借用方 | Preserve operation-specific requirements and loan-derived values. |
| 记录人、经手人、鉴证人 | Retain as optional personnel fields. |
| 备注、附件 | Retain. |

The production source confirms that source type and responsible person were
reintroduced by the preview. It also shows source on Receive and purpose on
non-Receive operations. The three personnel fields still exist in production;
they are not cleanup targets.

Remove obsolete preview state and fixtures as well as controls. Preserve
required operation fields, allocation/conversion behavior, and entered data
through supporting-data creation. Do not infer movement behavior from the new
activity type: for example, an activity classified as 捐赠 does not replace a
movement's explicit Receive/Issue operation or its source/purpose fields.

### 2.2 Backend cleanup specification — documentation only

Document coordinated backend removal of:

- `Inventory Workspace.responsible_person` and `Stock Entry.ti_responsible_person`.
- Their API fields, defaults, filters, search logic, fixtures, obsolete
  responsible-person selector endpoint, and affected tests/callers.
- Activity's legacy `date`, `source_type`, `donor_source`, `purpose`, `recipient`,
  and `responsible_person` fields.

**Activity `notes` is retained/redefined as the detailed notes field.** This
supersedes the earlier proposal to remove it. Retain the short description
separately. Retain title, type, start/end dates, lifecycle status, and actual
system audit metadata.

Preserve movement source/purpose, personnel, and system attribution such as
`recorded_by`, owner, and modification metadata. Update conflicting
documentation and fixture field ordering. A later backend change may reset
obsolete data instead of carrying migration adapters. Do not remove native
ERPNext fields or audit attribution merely because a custom field is retired.

### 2.3 Display values as information

Audit all preview routes and shared components for controls used only to
display information. This is a behavior requirement, not just a cursor fix.

Confirmed starting points from source inspection:

- Fixed item code/unit/tracking metadata in `PreviewFormPages.vue`.
- Completed movement forms and canonical Receive using disabled editors.
- Count records and transaction context using disabled controls.
- Allocation details that reuse edit controls in a read-only state.
- The retained-input recovery textarea in `PreviewDocumentState.vue`.

Required presentation:

- Display non-editable metadata with labeled text, definition lists, cards,
  badges, or readable tables.
- In editable forms, permanently fixed fields still use labeled text, with a
  short explanation where useful.
- Completed, cancelled, and permission-limited records use display
  presentations rather than disabled editors.
- Render booleans as explicit text/status; dates, locations, units, and
  identifiers as readable values.
- Preserve selection and copying of text. Use actual buttons for copy or
  navigation actions; static surfaces have no button hover or pointer treatment.
- Empty values use consistent neutral text, not input placeholders.
- Long descriptions and notes preserve whitespace, wrap safely, and provide
  accessible expansion when collapsed.
- Replace the recovery textarea with a selectable text block and Copy action.
- Attachment display retains preview/download actions while omitting
  upload/removal controls.

Separate **display/edit mode** from **temporarily busy or blocked state** in
component interfaces. Controls temporarily disabled during saving, validation
prerequisites, or conflict recovery remain controls with an explanation.
Preserve their underlying input buffers; do not replace unsaved data with a
saved-record projection when editing pauses.

This changes presentation, not existing field editability or document lifecycle
rules. Apply the durable rule to future production migration as well, while
keeping actual changes in this task inside the preview.

## 3. Activities under 更多

### 3.1 Types and metadata

Use these initial types, in this order:

**捐赠、购买、分发、节目、投入使用、其它**

Do not retain or automatically map the production type list. The user explicitly
said that production Activities are not a finished design. The new type list
supersedes the earlier production-parity recommendation.

Document a small `Inventory Activity Type` reference DocType with stable
identity, display label, enabled status, and display order. Activity stores a
Link to that reference data instead of a hard-coded enum. Maintain types through
ERPNext Desk initially; there is no frontend type-management page in this
iteration.

The preview uses the same data-driven model. Adding another fixture type must
automatically populate creation, editing, filtering, and reporting. Retired
types remain readable on existing activities but are unavailable for new
assignments. Referenced types cannot be deleted. Editing other metadata on an
activity with a retired type must not require silently changing that type.

Activity metadata:

- Immutable identifier, separate from editable title.
- Required title and type.
- Optional start/end dates, short description, and detailed notes.
- Detailed notes use a multiline plain-text editor and a long-text backend
  field. Preserve paragraphs and line breaks; do not interpret HTML.
- Explicit active/archived status and system audit metadata.

Use a clean Active/Archived lifecycle contract; there is no compatibility
requirement for old Open/Closed values. Validate duplicate titles and date
ordering. Include notes in detail, editing, exports, and text search, but not as
full text on list rows.

Use stable identifiers throughout selectors, linked movements/loans, filters,
fixtures, reports, and navigation. The current preview uses activity titles as
identities; replace that coupling so title changes cannot disconnect records.

### 3.2 Navigation and activity list

Rename the secondary **工具** destination to **更多**, including navigation,
headings, and back labels. Keep the existing five primary destinations:
首页、库存、货物流动、借用、报表. Add **活动** under More's work tools.

Add activity list, detail, and standalone creation routes. No compatibility
redirects or old-hash aliases are required; update internal navigation and tests.

- Desktop rows and mobile cards show title, type, dates, archive status, last
  update, movement-count chips, and an outstanding-loan indicator.
- Count directly linked submitted documents by movement type, deduplicated by
  document identity. Omit zero-count chips; label counts as lifetime totals.
- Clicking a movement chip opens related records filtered to that type.
- Search title, identifier, description, and notes.
- Filter active/archived/all, type, activity start date, movement type,
  related-record presence, and outstanding loans.
- Default to active activities, all dates, and most recently updated first.
  Offer title and start-date sorting.
- Include creation, quick reports, pagination/load-more, clear filters, and
  separate loading/error/empty states.
- Preserve filters and scroll position on return from detail.

Keep quantity totals off the list row to avoid tall, crowded cards. Counts and
the loan indicator provide the compact summary; quantities belong in detail.

### 3.3 Activity detail

Show an overview with metadata, movement totals, outstanding-loan summary, and
readable detailed notes. Place long notes in an independently expandable
section so they do not push related records excessively far down.

Actions: Edit, New Movement, 快速报表, and Archive/Restore/Delete in an overflow
menu. New Movement uses the existing operation chooser and opens the movement
with this activity preselected.

Two tabs:

- **关联记录:** document identity, date/time, type, status, items, quantities by
  unit, locations, relationship origin, and document links. Include search and
  period/type/status filters.
- **借用结余:** borrowed, normally returned, damaged, lost, and outstanding
  quantities, with original-loan and settlement links.

Related records include direct activity links and settlement documents reached
through associated loans. Label indirect relationships and deduplicate records.
Direct movement summaries exclude indirectly associated events. Do not infer
relationships from matching names, warehouse labels, or free-text notes.

Keep document attachments accessible through their related record; do not
introduce another attachment store. Preserve current borrowing/return and
normal/damaged/lost settlement semantics. Show draft/cancelled records through
explicit status controls without counting them as submitted stock movement.

### 3.4 Editing, archive, and deletion

Reuse one metadata editor across standalone creation, detail editing, and
contextual “create and use.” Preserve the movement draft and restore focus
after returning. Avoid stacked overlays. Editing titles must not disconnect
references or rewrite submitted stock documents.

Archived activities remain viewable and reportable but leave new-assignment
pickers. Existing links/drafts and loan settlement remain usable. Dates do not
automatically archive activities. Support explicit restore.

Deletion requires no related records, including drafts and cancelled documents.
Explain blockers and offer Archive. Document permission checks, stale-edit
handling, and transactional server-side deletion guards covering hidden
references without revealing their details. This must apply to Desk/API
deletion as well as the custom frontend; frontend visibility is not enforcement.

No bulk deletion or activity merging in this iteration.

## 4. Reports and shared quick reports

### 4.1 Six datasets in one workspace

Use one dataset selector, relevant filters, summary, view/grouping controls,
and export action. Put secondary controls and field explanations behind
disclosures. Keep report filters inline with responsive wrapping rather than
adding a second report navigation hierarchy.

| Dataset | Required coverage |
| --- | --- |
| Inventory | Item summary, warehouse/batch detail, available/loaned/damaged/total quantities, zero-stock option, related master data, historical quantity balances. |
| Expiry / Batch | Batch/location quantities, manufacturing/expiry dates, remaining days, no-expiry and zero-stock options. |
| Movements | Summaries, document records, and allocation lines; all operation types, opening entries, adjustments, and explicit document-status filters. |
| Loans | Records, item/outcome summaries, current outstanding balances, and settlement lines with original-loan references. |
| Activities | Metadata including notes, archive status, movement counts, related records, and loan balances. |
| Stock Counts | Count records and item/location/batch lines with baseline, actual, signed variance, and reviewed/unreviewed state. |

Warehouse stock becomes an Inventory view; movement records become a Movements
view. Replace obsolete report routes/types and update callers directly. Preserve
the capability of each former report without preserving its old interface.

Offer relevant fixed grouping choices: item, category, location, movement type,
activity, borrower, and month. Separate incompatible units and statuses. Do not
double-count transfer branches or interpret blank counts as zero. Use fixed
report-specific columns; do not introduce a mobile column builder.

### 4.2 Dates and historical balances

Reuse the movement period selector and resolver: all time, today, this
week/month/year, last 7/30/90/365 days, and inclusive custom dates. Preserve
pending edits until Apply and show the resolved range. Cancel changes nothing.
Invalid or incomplete custom ranges remain visible and do not trigger requests.

- Movements use posting date.
- Counts use count/posting date.
- Loans use borrowing date and explicitly show current settlement balances.
- Activities use start date; undated activities remain available under all dates.
- Expiry uses clearly labeled expiry-date windows, including relative and
  custom expiry ranges. Do not confuse these with movement posting dates.
- Current inventory displays a snapshot timestamp rather than implying a
  historical date filter.

Historical Inventory mode shows opening, incoming, outgoing, signed
adjustments, and closing quantities by item/warehouse/unit. Require a bounded
period, defaulting to this month.

Opening is the authoritative balance immediately before the period. Closing
equals opening plus incoming minus outgoing plus adjustments. Reconciliation
changes appear once as adjustments. Transfers contribute correctly at warehouse
level and net to zero within a combined scope.

Use ERPNext ledger queries and its cancellation/reversal semantics. Add
drill-through to contributing documents. Preview fixtures demonstrate the
behavior without reconstructing history from current stock or introducing a
second stock engine. Production ledger integration is documented backend work;
valuation and financial inventory measures remain excluded.

### 4.3 Export contract and coverage

Use one typed report-definition/projection layer shared by Reports and
contextual exports. Keep dataset, view, filters, grouping, sorting, and file
format independent. Preview browsing, summaries, and export review must use
the same complete filtered scope.

Exports include:

- Stable document/line, item, location, batch, activity/type, and loan
  identifiers alongside readable labels.
- Posting date/time, status, source/purpose, borrower, personnel, notes, batch,
  entered quantity/unit, recorded conversion factor, stock quantity/unit, and
  settlement references where applicable.
- Fixed related-data tables for item metadata, barcodes, conversions, warehouse
  hierarchy, and accessible attachment references.
- Complete permission-filtered results, independent of displayed pages, with
  scope and generation timestamp.

Default to XLSX with applicable summary/detail sheets and optional related-data
sheets. CSV exports one explicitly selected flat table with numeric quantities.
Keep format selection independent of content selection. Include the exact
item/batch/location grain needed to reconcile exported quantities; joined
location labels alone must not replace allocation data.

Attachment references identify the file and its associated document, subject
to permissions. Attachment binaries, transient preview URLs, imports, and
database backups are excluded. These exports support operational analysis and
data extraction; they are not a backup/restore mechanism.

Document the backend gaps found during source inspection:

- No dedicated loan, activity, or count-variance reports in the current five
  report types.
- Missing movement traceability columns, including batch, posting time, and
  recorded conversion factor.
- Current stock export limited to positive physical stock, without the full
  frontend available/loaned/damaged breakdown or zero-stock catalog coverage.
- Blank submitted-status labels in movement-record exports.
- Movement summaries advertised by the frontend but absent from the active
  movement export path.

Production export generation must preserve company/document/warehouse access,
avoid silent truncation, and support scalable generation. Preview output remains
simulated, with bounded displayed samples and complete-result counts. Do not
claim that a fixture projection proves backend export completeness.

### 4.4 Named report views

Add personal named presets with Save View, rename, and delete. Store
dataset/view, filters, grouping, and sorting. Relative periods remain relative;
custom dates remain fixed. Preserve each dataset's current filter state during
ordinary navigation as well.

Preview persistence is session-local and resets with the preview session.
Document per-account storage for production; do not call account APIs from
the preview or imply that preview settings are durable account preferences.

### 4.5 Consistent 快速报表

Use one download-icon action labeled **快速报表**, with consistent secondary
styling and dialog behavior across reportable browse/detail pages:

- Inventory, Expiry, Movements, Loans, Activities, warehouses, damage/pending,
  persisted count records, and the Reports workspace.
- Desktop: consistent toolbar placement.
- Mobile: the same labeled action, allowed to wrap rather than becoming an
  ambiguous icon or squeezing adjacent controls.
- Preserve current page filters and detail/entity scope.
- Dashboard first selects a dataset; its movement period applies only to
  movement data. Preserve applicable warehouse/category scope.
- Do not add export actions to unsaved editors or settings.

The dialog shows scope, complete count, available tables, format, bounded
preview, and **打开完整报表**. Opening full Reports carries applicable context;
cancelling preserves the source page, filters, and scroll. Detail exports are
scoped to the selected entity or record.

Default to XLSX independently of selected content. Retain choices on failure
and provide retry. Simulated failures are opt-in review controls, not an
automatic first-click failure. Preview exports remain clearly simulated and
make no production requests.

### 4.6 Research references

The proposed simplification uses a single report workspace with filters,
grouping, and traceable detail, informed by these primary references. These
are design references, not requirements to reproduce Odoo's full interface.

- [Odoo reporting](https://www.odoo.com/documentation/19.0/applications/essentials/reporting.html):
  report views and grouping.
- [Odoo movement history](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/moves_history.html):
  movement dates, locations, lots, and traceability.
- [ERPNext Stock Ledger](https://docs.frappe.io/erpnext/stock-ledger):
  authoritative stock movement and balance reporting.

## 5. Visual audit, tests, and acceptance

The user explicitly authorized the implementing agent to use browser automation
and screenshots for this audit. This supersedes the default repository restriction
against launching browser tests without a specific user request.

### 5.1 Visual audit

Inspect every preview route and meaningful variant, including canonical
examples, dialogs, menus, information-display states, and loading/error/empty
states. Review each page at phone and desktop widths.

Exercise shared components and high-risk pages at 375/768/1024/1440px, all three
densities, and 100/150/200% application text scaling. Check native browser zoom
separately and report unverified cases. Include long activity names, long notes,
many movement-type chips, long warehouse paths, mixed units, and large result
sets in the fixtures.

Fix clipping, squeezed text, poor contrast, overflow, overlapping controls,
misleading editable styling, excessive empty space, and sticky regions
obscuring content. Maintain readable mobile text, 44px targets, keyboard access,
focus restoration, reduced motion, and the shared responsive breakpoint.
Inspect screenshots directly; geometry assertions alone are not visual approval.

### 5.2 Required behavioral checks

- Movement field parity across every operation type and both Receive
  implementations; retained drafts through supporting-data creation.
- New activity types across selectors, filters, and exports; an added
  reference-data type works without enum changes. Retired linked types remain
  readable and do not block unrelated metadata edits.
- Detailed notes preserve multiline content through save/edit/display/export
  and render markup as text.
- Activity creation/edit/archive/restore/delete, duplicate names, stable
  references after title edits, hidden-reference deletion blockers, and
  indirect-record deduplication.
- Display-only metadata has no form controls or misleading interactive
  styling; temporary busy/conflict states retain editable data.
- Report date boundaries, custom-date validation, hierarchy filters, statuses,
  complete-result totals, unit separation, and shared quick-report scope.
- Historical balances, transfers, adjustments, and cancellation/reversal
  fixtures. Drill-through totals reconcile to the corresponding summary.
- Export projections for every dataset/view, related identifiers, independent
  format selection, named presets, and failure/retry.
- Responsive state retention and absence of unexpected production API calls.

### 5.3 Commands and completion evidence

Run proportionate checks from `frontend/`:

```sh
pnpm exec vitest run tests/design-preview*.test.ts
pnpm type-check
pnpm design:build
```

Run the authorized preview browser suite using the dedicated preview
configuration, extending it for this scope. Use an isolated available server
port and isolated output paths; do not terminate unrelated listeners. Confirm
that screenshots render Chinese fonts correctly. Format touched source files
only and run `git diff --check`.

No backend integration run is required merely to document future backend work.
Do not represent fixture deletion/permission simulations as server enforcement.

The completion report and progress note must distinguish:

- Implemented preview behavior and files changed.
- Commands actually run and their real results.
- Screenshots directly inspected and the reviewed viewport/text-size coverage.
- Unresolved visual or interaction issues and remaining manual checks.
- Backend/production dependencies, including activity type reference data,
  metadata cleanup, server guards, historical balances, exports, and presets.

Do not claim production migration, database changes, or final user visual
approval occurred. Preserve unrelated working-tree changes.
