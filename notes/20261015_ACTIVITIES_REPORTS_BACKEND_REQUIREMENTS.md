# Backend requirements for Activities, reports and information display — 2026-10-15

Specification only. This preview task does not change production schemas, APIs,
databases, ERPNext documents or generated production assets.

## Activity and movement metadata

Create `Inventory Activity Type` reference data: immutable name/identity, label,
enabled and display order. Initial ordered labels: 捐赠、购买、分发、节目、投入使用、其它.
Manage through ERPNext Desk initially; no frontend type-management page. Activity
stores a Link, with referential deletion guards. Retired types remain readable and
unchanged on unrelated edits; disallow new assignments to disabled types.

Activity retains immutable ID, editable unique title, required type Link, optional
start/end dates, short description, **notes Long Text** (plain text preserving
paragraphs), Active/Archived lifecycle and actual native audit metadata. Validate
duplicate titles/date ordering server-side. Do not map old enum values or old
Open/Closed lifecycle automatically. Prefer explicit schema/data replacement or
a separately authorized reset to compatibility adapters.

Remove Activity legacy `date`, `source_type`, `donor_source`, `purpose`, `recipient`,
and `responsible_person`; retain/redefine `notes`. Remove
`Inventory Workspace.responsible_person` and `Stock Entry.ti_responsible_person`,
including API serialization, defaults, filters, search predicates, selector endpoint
`responsible_people`, fixtures/field ordering, tests and callers. Source inspection
found defaulting/search/filter use in `workspace_api.py`, including `recorded_by`
nearby: keep `recorded_by`, owner/modification metadata, optional personnel and
native ERPNext fields. Keep Receive source, other-operation purpose, borrower,
activity Link, remarks and standard private File attachments.

Title edits update activity metadata only; submitted stock documents retain their
stable activity Link. Dates do not archive records. Archived records leave new
assignment pickers, but existing drafts/links and loan settlements stay usable.

Check read/write/archive/restore/delete permissions and optimistic document
version on the server. Deletion requires a transactionally enforced absence of
all references, including drafts, cancelled documents and references invisible
to the caller. Enforce in DocType hooks so Desk, API and custom frontend agree.
Return a generic blocker without revealing inaccessible references; offer Archive.
Lock/check in the same transaction as deletion and reference assignment so a
concurrent link cannot bypass it. No bulk deletion or merging in this iteration.

## Reporting and exports

Replace the five production report contracts and their callers with six datasets:
Inventory (summary/location-batch/history), Expiry/Batch, Movements (summary/
documents/allocations), Loans (records/outcomes/settlements), Activities (metadata/
related records/balances), Counts (records/variance lines). Warehouse stock becomes
an Inventory view and movement records a Movements view. No old-route aliases.

Use one typed projection contract for browsing, summaries, quick reports and
exports. Keep dataset/view/filters/group/sort/format independent. Search/filter
before aggregation; separate units, lifecycle and loan outcomes. Count distinct
submitted document type/name identities. Include explicit drafts/cancelled controls;
only submitted direct movements enter activity movement totals. Indirect loan
settlements are separately labeled and deduplicated by canonical document/line.
Never infer activity/borrower identity from warehouse labels or notes.

Use posting date for movements/counts, borrowing date with explicitly **current**
settlement balances for Loans, start date for Activities and separately labeled
expiry-date windows for Expiry. Inclusive periods share a resolver; invalid or
incomplete custom dates do not request data. Current Inventory has a snapshot
timestamp. Historical Inventory requires a bounded period (default this month).

Historical opening is the authoritative ERPNext balance immediately before the
period. Query native Stock Ledger with its cancellation/reversal semantics; show
opening, incoming, outgoing, signed adjustments and closing per item/warehouse/
unit, with contributing document drill-through. Count reconciliation once as an
adjustment. Transfers affect both warehouses and net to zero in combined scope.
Do not rebuild history from current stock or create another stock engine.
Valuation/financial measures remain out of scope.

Source inspection of `reporting.py` and frontend report controller identified:

- No dedicated loan, activity or count-variance reports in the five report types.
- Missing movement traceability columns, notably batch, posting time and recorded
  conversion factor.
- Current stock export limited to positive physical stock, missing full available/
  loaned/damaged breakdown and zero-stock catalog coverage.
- Blank submitted-status labels in movement-record exports.
- Frontend movement summaries absent from the active movement export path.

Exports must include stable document/line/item/location/batch/activity/type/loan
IDs plus labels; posting time/date/status, source/purpose/borrower/personnel/notes,
entered quantity/unit, recorded factor, stock quantity/unit and settlement source
references. Preserve exact item/batch/location allocation grain. Include fixed
related tables for master metadata, barcodes, conversions, warehouse hierarchy
and permitted attachment file/document references. Exclude binaries, transient
preview URLs, imports and backups. XLSX has applicable summary/detail and optional
related sheets; CSV selects one numeric flat table. These are analysis/extraction
exports, not backup/restore.

Generate complete permission-filtered results independent of visible pages;
preserve company/document/warehouse access and never silently truncate. Use
bounded queries/streaming or queued generation as required for scale, with scope,
generation timestamp, explicit failure/retry and stable ordering. A finite fixture
projection is not evidence of production completeness or permission enforcement.

Personal named views require per-account storage of dataset/view/filters/group/
sort. Relative periods remain relative; custom dates remain fixed. The preview's
memory-only views and filters reset on reload and never call account APIs.

## Presentation migration

Immutable, completed/cancelled and permission-limited values use selectable text,
definition lists, badges or readable tables, including booleans/empty values.
Keep long-text whitespace, safe wrapping, accessible expansion, Copy and standard
attachment preview/download. Separate durable display/edit mode from temporarily
busy/conflict-blocked controls. Preserve unsaved buffers while requests pause.
Do not change existing editability or native document lifecycle rules as a visual
cleanup side effect.

ERPNext remains the inventory source of truth. Existing allocation, conversion,
normal/damaged Return and separate Loss semantics remain required.

Activity warehouse/category/item scope must follow explicit related stock-document
and original-loan-line references. Never assign a warehouse to an activity from a
name or free-text note. Lifetime document counts remain labeled as lifetime totals.

Independent review clarification (2026-10-16): settlement queries join the
original loan document **and original allocation line**, retaining the line ID
after item/location filtering. A borrowing movement is not a settlement; a
missing allocation reference must not default to the first loan line. Indirect
activity matching follows the original loan even when a settlement has no own
activity. Grouping never removes exportable allocation/balance details or their
related master references, and all stock quantities remain separated by unit.
Historical searches and item/location restrictions apply to both balance rows
and their contributing ledger rows. Document summaries use DocType plus name
for quantity aggregation as well as identity.
