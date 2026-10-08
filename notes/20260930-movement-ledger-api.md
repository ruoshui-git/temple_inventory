# Movement ledger API contract

The desktop movement page reads the following permission-scoped methods from
`temple_inventory.workspace_api`.

## `movement_items`

`filters` accepts `period_key` (`this_month` is the default; rolling values include
`last_7_days`, `last_30_days`, `last_90_days`, and `last_365_days`), optional custom
`date_from`/`date_to`, `search`, `item_groups`, `warehouses`,
`source_warehouses`, `destination_warehouses`, `item_code`, `activity`, and repeated `movement_kinds`.
Kinds are `Receive`, `Issue`, `Transfer`, `Loan`, `Return`, `Damage`, `Loss`,
`Repair`, `Disposal`, and `Reconcile` (displayed as `库存调整`). `start` and
`page_length` page the posted item lines. Draft, cancelled, opening-stock, and
zero-difference reconciliation lines are excluded.

The response contains `results`, selected `total`, unfiltered `all_total`,
`resolved_period`, and permission-filtered `facets` (line counts for this
endpoint). Facets apply date, search, item/category/location/activity filters
but exclude only the selected movement-kind filter, so each chip remains a
complete line count. Each result includes posting date/time, item identity/image,
transaction and stock-UOM quantities, canonical kind, source/destination
warehouses, parent record, detail route, activity, source text, and notes.
Item and activity lookup choices are provided by `movement_filter_options`,
which accepts `search`, `start`, and `page_length`; search matches item code/name
and activity ID/title. The UI uses returned stable IDs for filters while showing
the returned item/activity titles, so arbitrary text cannot become a filter.

## `movement_records`

The same filters are accepted, plus `docstatuses` (defaults to `[0, 1]`; values
outside `0/1/2` are rejected). Results represent one operation
record, include `record_name`, document type, canonical kind, docstatus, line
count, quantities grouped by stock UOM, flow, activity, notes, and detail route.
`activity` is the stable activity ID and `activity_title` is its display title.
`source_warehouses` and `destination_warehouses` contain all distinct
structured locations in a multi-location record; their facets count each
parent once per location. `docstatus` facets retain draft `0` values.
Cancelled records are retained only when explicitly requested. Facets and
`all_total` exclude zero-difference reconciliation records; record counts are
parent-document counts while item counts are line counts.

Both methods enforce ERPNext permissions, company and visible leaf-warehouse
boundaries, Item read permission, and parent-level visibility. Export uses the
same complete filtered result sets (`movement` for lines and
`movement_records` for operation records), including the supplied status
filter, rather than the currently loaded infinite-scroll page. Activity values
are permission-checked IDs internally and returned with their display titles;
warehouse values are normalized to user-facing semantic locations. XLSX and
CSV movement exports retain transaction `qty/uom` alongside signed stock
`stock_qty/stock_uom`, notes, activity titles, and all filtered rows.

Item metadata in movement results is hydrated from the permission-scoped ERPNext
`Item` record and overwrites stale workspace snapshots for `item_name`, image,
`item_group`, and stock UOM. An Item the caller cannot read contributes no
catalog metadata beyond its code. Posting time remains raw in the API/export;
the compact UI may display only `HH:MM`.
