# Task 3: Transaction, Loan, Item Detail, and Item-Code Backend

## Assignment and boundaries

This is the backend half of the app reorganization and UX-consistency work.
It is designed to run in parallel with
`20260922_4_NAVIGATION_LISTS_AND_MOBILE_UX_FRONTEND_TASK.md`.

Own these areas:

- `temple_inventory/workspace_api.py` for transaction history and Item Detail;
- `temple_inventory/inventory_api.py` for loans and Item creation;
- a small shared Item-code allocator module if useful;
- Temple Inventory Settings schema changes;
- sample/costume Item creation and development-sample verification;
- backend compatibility exports where required; and
- focused Python tests.

Do not edit Vue files, frontend tests, global CSS, or generated frontend assets.
The frontend agent will build against the frozen response shapes below. If an
implementation constraint requires changing a field, coordinate that contract
before making the change.

Read and follow `AGENTS.md`. Preserve unrelated worktree changes. ERPNext is the
inventory source of truth; do not add a parallel transaction, loan, batch, or
stock ledger.

## Outcomes

1. Receipt, issue, transfer, reconciliation, and opening-stock records provide
   the summaries and filters required by their new top-level lists.
2. Item Detail displays complete positive batch stock, including expired
   batches, and signed per-location recent changes.
3. Loans can be browsed as permission-safe outstanding and settled parent
   records with stable server paging and sorting.
4. Every Item created by this app or its sample/import utilities uses exactly
   `ITM-######` from one concurrency-safe allocator.
5. A clean `development.localhost` reset installs all samples and passes final
   verification without errors.

## Frozen API contract

### Transaction history request

Extend `workspace_api.history` compatibly. Keep its current arguments and add
support for these values inside `filters`:

```json
{
  "posting_date": "2026-09-22",
  "movement_kind": "Receive",
  "item_groups": ["食品"],
  "warehouses": ["A02 - O"],
  "source_warehouses": ["A02 - O"],
  "destination_warehouses": ["B01 - O"]
}
```

- `posting_date` is one exact event date.
- Preserve `date_from`, `date_to`, `rooms`/`room`, and all existing filters for
  compatibility.
- `warehouses` means any relevant warehouse and is used by reconciliation.
- For Receive, destination filtering uses `destination_warehouses`.
- For Issue, source filtering uses `source_warehouses`.
- Transfer supports independent source and destination selections. A parent
  matches only when each non-empty side has a matching line.
- Group warehouse selections expand to their permitted descendant leaves using
  the existing warehouse-selection rules.
- `item_groups` accepts normal Item Group identifiers and includes descendants
  consistently with Inventory and Expiry.
- The new top-level pages call the endpoint with `status_group="completed"`,
  which continues to mean submitted and cancelled records. The existing
  unfinished query remains the unified draft source.

Allow stable server sorting for:

- movement rows: `posting_date`, `line_count`, `location_count`, and
  `category_count`;
- reconciliation rows: `posting_date`, `movement_kind`,
  `increase_line_count`, and `decrease_line_count`; and
- existing legacy sort fields until their callers are migrated.

Default to newest posting date, then newest modification/name as deterministic
ties. Validate sort names and directions; never interpolate unchecked values.

### Transaction history row

Preserve existing fields and add this shape:

```json
{
  "name": "IW-00001",
  "document_type": "Stock Entry",
  "movement_kind": "Receive",
  "posting_date": "2026-09-22",
  "docstatus": 1,
  "line_count": 4,
  "location_count": 2,
  "locations": [
    {"warehouse": "A01 - O", "roles": ["destination"]},
    {"warehouse": "A02 - O", "roles": ["destination"]}
  ],
  "category_count": 2,
  "categories": [
    {"item_group": "食品", "line_count": 3},
    {"item_group": "日用品", "line_count": 1}
  ],
  "increase_line_count": 0,
  "decrease_line_count": 0,
  "item_changes": []
}
```

Aggregation rules:

- `line_count` is the number of transaction child rows, not distinct Items.
- `location_count` counts distinct warehouse identifiers across the relevant
  roles. If the same warehouse occurs in two roles, count it once and include
  both roles in its `roles` array.
- Receive locations are destinations; Issue locations are sources; Transfer
  includes both. Reconciliation locations have role `warehouse`.
- `category_count` counts distinct permitted Item Groups.
- `categories[].line_count` counts transaction rows in that category, without
  multiplying transfer rows for their two warehouse roles.
- Category and location arrays use stable presentation ordering.
- For Stock Reconciliation, `increase_line_count` and `decrease_line_count`
  count rows by signed `quantity_difference`, falling back to
  `qty - current_qty` when necessary. Zero-difference rows count as neither.
- Keep `movement_kind="盘点调整"` for ERPNext purpose `Stock Reconciliation`
  and `movement_kind="期初库存"` for opening stock. The frontend displays
  `盘点调整` as `库存盘点` but the backend compatibility value remains intact.

Populate `facets.warehouses`, `facets.source_warehouses`,
`facets.destination_warehouses`, and `facets.item_groups` with record counts
after all permission predicates. A facet may exclude its own current selection
as Inventory/Expiry do, but it must never count an inaccessible parent, Item,
or warehouse.

### Item-scoped recent changes

When `history` is called with `filters.item_code`, populate:

```json
{
  "item_changes": [
    {"warehouse": "A01 - O", "delta": -3, "uom": "Nos"},
    {"warehouse": "B01 - O", "delta": 3, "uom": "Nos"}
  ]
}
```

- Receive: positive destination change.
- Issue: negative source change.
- Transfer: negative source and positive destination change.
- Reconciliation/opening stock: the signed difference at its warehouse.
- Aggregate only identical warehouse/UOM pairs; never add incompatible units.
- Use entered UOM values where they remain auditable. For ERPNext rows whose
  entered UOM is unavailable, use the stock UOM and its stock quantity.
- Include app-created and direct ERPNext records with the same semantics.
- Preserve workspace/direct-document deduplication and existing detail routes.

### Item Detail batch row

`workspace_api.item_detail` keeps all current fields. For a batch-enabled Item,
`batches` becomes:

```json
[
  {
    "batch_no": "BATCH-001",
    "expiry_date": "2026-09-01",
    "days_to_expiry": -21,
    "total_qty": 8,
    "qty": 8,
    "locations": [
      {"warehouse": "A01 - O", "qty": 5},
      {"warehouse": "B01 - O", "qty": 3}
    ]
  }
]
```

- Return every batch with positive current balance in at least one permitted
  visible leaf, including batches whose expiry date is before today.
- Keep `qty` as a compatibility alias of `total_qty`.
- Exclude zero/negative aggregate balances and non-positive location entries.
- Use the same modern Serial and Batch Bundle plus legacy direct-SLE balance
  semantics as `expiring_batches`; do not issue one query per batch/location.
- Apply Item, warehouse, root, company, and User Permission constraints before
  returning metadata or quantities.
- Preserve the existing non-batch `stock` response even though the new frontend
  hides that section when `has_batch_no` is true.

### Loan list request

Extend `inventory_api.loans` without changing `loan_items`:

```text
loans(
  search=None,
  status="outstanding",
  loan_date=None,
  item_groups=None,
  warehouses=None,
  activity=None,
  sort_by="loan_date",
  sort_order="desc",
  start=0,
  page_length=25,
)
```

- `status` accepts only `outstanding` and `settled`.
- `loan_date` is the exact date portion of `posting_datetime`.
- `warehouses` filters `Inventory Loan Item.original_warehouse`, expanding
  permitted group selections to leaves.
- `item_groups` includes descendant Item Groups.
- `activity` matches the structured activity identifier.
- Search matches the loan name, borrower, activity title/identifier, permitted
  Item code, and Item name.
- Allow validated sorting by `loan_date`, `borrower`, `line_count`,
  `outstanding_lines`, and `loan_status`. Use loan date/name as stable ties.

### Loan list row

```json
{
  "name": "TI-2026-00001",
  "borrower": "借用人",
  "loan_date": "2026-09-22 10:30:00",
  "activity": "ACT-0001",
  "activity_title": "中秋活动",
  "line_count": 3,
  "outstanding_lines": 1,
  "loan_status": "Partially Returned",
  "items": [
    {
      "loan_item": "ROW-1",
      "item_code": "ITM-000001",
      "item_name": "物品",
      "image": null,
      "uom": "Nos",
      "loaned": 4,
      "outstanding": 1
    }
  ]
}
```

Lifecycle definitions:

- `Outstanding`: every permitted line still has its full original quantity.
- `Partially Returned`: at least one quantity has been resolved and at least
  one quantity remains outstanding.
- `Settled`: every line has zero outstanding quantity, regardless of whether
  it was resolved as Returned, Damaged, or Lost.
- The `outstanding` page includes Outstanding and Partially Returned parents.
- The `settled` page includes Settled parents.
- `items` is a bounded preview suitable for mobile cards; `line_count` and
  lifecycle calculation always cover the full permitted parent.

Return `total`, `overall_total`, stable paging metadata, and facets for
`warehouses`, `item_groups`, and `activities`. Permission checks must occur
before parent totals, line counts, status classification, facets, or previews.
Do not reveal a parent whose lines would disclose an inaccessible Item or
warehouse.

## Fixed Item codes

### Canonical allocator

Create one shared, concurrency-safe allocator used by:

- `inventory_api.create_item`;
- `setup/sample_inventory_data.py`;
- `setup/import_costumes.py`; and
- every other Item insertion owned by this app.

The only valid generated form is `ITM-######`, from `ITM-000001` through
`ITM-999999`. Use one Frappe naming series or equivalently locked database
counter; do not maintain multiple scanners/counters in separate scripts.
Collision checks remain mandatory. Raise a clear validation error before
producing a seventh digit.

`create_item` always allocates its own code. Remove support for caller-provided
`data.item_code`; reject it if present so a stale/malicious client cannot choose
an identifier.

Remove these obsolete singleton fields from the Temple Inventory Settings
schema and all code references:

- `code_prefix`;
- `code_digits`; and
- `next_number`.

Remove the unused `next_item_code` endpoint. This is an intentional clean
breaking change. Do not add an in-place Item rename patch. Inventory Loan,
Inventory Return, and Inventory Loss autonames remain unchanged.

Update both sample installers to use the shared allocator. Do not keep their
current independent regex scan or naming-series implementation.

### Clean-reset verification

Extend `verify_development_sample` so the reset fails when:

- an Item generated by the Temple Inventory sample/costume installation does
  not match `^ITM-[0-9]{6}$`;
- two sample identities resolve to the same Item unexpectedly;
- the stored Item links in sample stock/loan/batch records are missing; or
- the next allocator result would collide with a generated sample Item.

The user has explicitly chosen a clean breaking reset instead of a migration of
existing four-digit development codes.

## Implementation constraints

- Keep SQL values parameterized and sort expressions allow-listed.
- Page parents in the database before hydrating bounded previews.
- Avoid per-row Item, activity, batch, or warehouse queries.
- Preserve current DocType and Item/Warehouse match conditions.
- Do not use frontend filtering to enforce visibility.
- Do not total quantities across different UOMs.
- Keep `loan_items` active-only because it is an operational chooser, not a
  history list.
- Do not change ERPNext core.

## Tests

Add focused coverage for:

1. Receive, Issue, and Transfer location roles/counts for workspace and direct
   Stock Entry sources.
2. Exact date, Item Group, any-location, source-location, and
   destination-location filters, including group expansion and invalid values.
3. Category breakdown line counts, stable ordering, facets, pagination ties,
   and each allowed numeric sort.
4. Reconciliation increase/decrease/zero rows using both
   `quantity_difference` and fallback fields.
5. Signed item history for receipt, issue, transfer, reconciliation, alternate
   UOMs, cancelled records, drafts, and direct ERPNext records.
6. Batch rows backed by Serial and Batch Bundles and legacy direct SLEs,
   including expired positive stock, transfers, zero balances, permissions,
   locations, and bounded query count.
7. Loan classification for untouched, partially resolved, normally settled,
   damaged-settled, lost-settled, and mixed-outcome parents.
8. Loan filters, activity title, facets, permission-hidden Items/warehouses,
   stable sorting, adjacent pages, and bounded preview hydration.
9. Exact six-digit Item generation, caller-code rejection, collisions,
   concurrent allocation, maximum exhaustion, and use by both sample importers.

Run focused Ruff checks and the backend integration entry point from the bench
root:

```sh
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
```

If the restricted sandbox cannot resolve MariaDB, rerun with approved access as
described in `AGENTS.md`.

After the focused tests pass, run the explicitly authorized destructive clean
development reset:

```sh
./apps/temple_inventory/scripts/reset-development-samples --site development.localhost
```

The task is incomplete until reinstall, sample import, costume import, and
`verify_development_sample` all finish successfully and the installed sample
Items are confirmed to use `ITM-######`.

## Handoff acceptance

- The frozen response examples are represented in backend tests/fixtures for
  the frontend agent.
- No frontend files or generated assets were changed.
- Old four-digit development Item data was not migrated in place.
- Test output distinguishes actual assertions from environment connectivity
  failures.
- The final report includes reset completion and the resulting Item-code range.
