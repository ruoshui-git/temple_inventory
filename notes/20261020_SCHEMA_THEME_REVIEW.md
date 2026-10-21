# Schema and theme review — 2026-10-20

This note records H source work, the completed exact-site reset and post-reset
read-only evidence, and the completed independent visual review. Parent-owned
Administrator login and final theme review are tracked separately below.

## Schema and customization audit

`temple_inventory.schema_audit.audit_app_customizations()` is a read-only
`bench execute` report. It compares app-module Custom Field fixtures to live
app-owned Custom Field metadata, app DocType JSON to live app-module DocTypes,
and Settings JSON fields to installed metadata. It lists module-owned Property
Setter, Client Script and Server Script rows and reports unexpected app-owned
fields or DocTypes for review; it does not delete or mutate anything. It also
checks the confirmed retired business DocTypes, retired app Custom Fields, and
the exact physical `Stock Reconciliation.ti_count_warehouse` column. Use:

```sh
bench --site development.localhost execute temple_inventory.schema_audit.audit_app_customizations
```

The exact historical singular `ti_count_warehouse` is now rejected by reset
preflight if present in fixtures and by sample verification if either its
Custom Field record or physical column remains. The current count workflow
continues to use plural `ti_count_warehouses`. Sample verification now checks
both selected warehouses and reviewed non-zero variance rows, alongside native
Stock Entry settlement and warehouse-balance assertions.

The Settings DocType source now includes hidden, read-only integer
`ti_read_generation` with default zero. It is a cache invalidation revision, not
inventory or movement data. C owns its transactional increments.

The source manifest currently contains 33 app-owned Custom Field fixture rows
and six app DocType JSON definitions. Source grep confirms the exact singular
count name appears only in retirement checks/tests, not in current fixtures or
sample writers. Python bytecode compilation, `git diff --check`, and isolated
Ruff format/check passed.

## Reset readiness and live evidence

The reset wrapper accepts only the exact `development.localhost` site, executes
`assert_native_reset_ready` before displaying its confirmation prompt, preserves
the current Administrator password hash, inventories only app sample media,
reinstalls, and runs sample preparation and verification synchronously. It
requires the existing database-root password via `MARIADB_ROOT_PASSWORD` or an
explicit supported option. The read-only pre-reset audit found all 33 app-owned
Custom Fields and six app DocTypes matched source; there were no unexpected app
DocTypes or module-owned Property Setter, Client Script, or Server Script rows.
The pre-reset site still had the retired singular count field and physical
column, and lacked installed `ti_read_generation` metadata. The audit made no
changes.

The reset wrapper's only supported database-root credential inputs are
`MARIADB_ROOT_PASSWORD` or explicit `--db-root-password`, with optional
`MARIADB_ROOT_USERNAME` / `--db-root-username`. The supported password and
username environment variables were unset during initial inspection.
`development.localhost/site_config` contains a non-empty site database-user
password; it is not a supported MariaDB root credential and was not reused.
The wrapper has no credential-file option. The user supplied the supported
root credential, which was passed through the supported environment variable
only. The value is not recorded here.

The wrapper's read-only `assert_native_reset_ready` preflight passed for the
exact site and reported `native_reset_ready: true`. After the parent confirmed a
quiet window and the frontend/native gates passed, the exact-site reset ran
with the literal `RESET development.localhost` confirmation and completed with
exit code zero. The wrapper reported that the existing Administrator password
was preserved and restored. Its full log is archived at
`/tmp/ti-standardization-review/reset-20261020T141714Z.log`. It reinstalled
ERPNext and Temple Inventory, seeded 164 items, 175 images, and 16 sample
transactions, and verified balances plus a two-row count review.

Post-reset read-only evidence is archived in
`/tmp/ti-standardization-review/schema-audit-after.json`,
`/tmp/ti-standardization-review/configuration-status-after.json`, and
`/tmp/ti-standardization-review/inventory-page-after.json`. The audit reports
zero missing/extra app Custom Fields, DocTypes, or Settings fields; no
module-owned Property Setter, Client Script, or Server Script rows; no retired
app Custom Fields or business DocTypes; and `singular_count_column: false`.
The plural `ti_count_warehouses` field is present, the retired singular
field/physical column are absent, and `ti_read_generation` is installed in
Settings metadata. Configuration is ready with no blockers and the original
sample warehouse pointers. An explicit refreshed inventory request returned
two rows from a matched total of 163 with `next_start: 2`. The wrapper verified
the count review and native balances. The parent subsequently authenticated as
Administrator successfully (HTTP 200) and completed real-site browser review.

| Sample acceptance | Source status | Live status |
| --- | --- | --- |
| Multiple categories, warehouses, batches, units and movement kinds | Existing native sample catalog/writer | Seeded 164 items and 16 transactions; inventory page returned two rows with total 163 |
| Two selected count warehouses and non-zero reviewed variance | Verification added | Wrapper reports count review verified with two rows |
| Loan settlements and outstanding balances | Existing native balance verifier | Wrapper reports sample balance verification passed |
| Native stock balances across inventory, leased and damaged leaves | Existing balance verifier | Wrapper reports balances verified for original sample topology |
| Retired singular field absent from metadata and physical schema | Preflight and verification added | Post-reset audit reports retired metadata absent and singular physical column false |
| Unrelated native ERPNext customizations preserved | Audit is scoped to app-owned module rows | Read-only audit found no module-owned script/property rows; user/global customizations are intentionally reported separately |

## Theme tokens

Jade, bronze and blue palette values are now selected through centralized
`foundation.css` `--p-*` token sets and the existing `data-ti-theme` selector.
`applyDisplayPreferences` selects a theme instead of setting palette colors as
inline styles. Semantic shadows and scrims now derive from the selected ink
color; shared Browse and SearchSelect surfaces use those tokens. Neutral
foregrounds over accent and ink now use `--p-on-accent` and `--p-on-ink`, while
surface highlights use `--p-surface`. A source scan found only centralized
palette/status/contrast values plus the three intentional product-art
backgrounds. Theme preview swatches and product/camera imagery remain
intentional color exceptions.

The focused `design-system.test.ts` suite passes (6 tests). The app type-check and
production Vite build passed before this note. Current `pnpm type-check` passes;
focused route registry, design system, and browse-filter suites pass 21/21, and
navigation-memory, settings preferences, and browse-filter suites pass 14/14.
Targeted Prettier and Ruff checks pass. The responsive-layout suite still
identifies two repeated table-preference reads on breakpoint changes; the table
owner is handling those. The all-route, all-theme, density and 200%-text live
visual matrix was completed by the parent; final measurements, screenshots and
physical-device limits are in the implementation record.

## Route and theme review checklist

The canonical route contract is documented in the Package B implementation
note and its focused route tests. The theme review below distinguishes source
coverage from live acceptance:

| Surface | Source/theme token check | Live theme/density review |
| --- | --- | --- |
| Stock, Expiry, Pending, Movement and Loan browse | Shared tokens and components | Reviewed; see final implementation record and evidence gallery |
| Activities, Drafts, Counts and Reports | Shared tokens and components | Reviewed; see final implementation record and evidence gallery |
| Item, Batch, Warehouse and Loan details | Shared tokens and components | Reviewed; see final implementation record and evidence gallery |
| Categories, settings, setup and access states | Shared foundation tokens | Reviewed; see final implementation record and evidence gallery |
| Overlays, menus, scanner, image lightbox and toasts | Shared semantic scrim/shadow/status tokens | Menus/scanner/lightbox reviewed live; no active toast renderer exists in production source |
| 1440/1024/short desktop, 390 phone, 200% text | Automated geometry tests only | Reviewed; see final implementation record and evidence gallery |
| Jade/bronze/blue and all densities | Palette selectors and source tests | Reviewed; see final implementation record and evidence gallery |


Final independent review and representative screenshots:
[implementation record](20261020_BROWSE_API_STANDARDIZATION_IMPLEMENTATION.md#independent-integration-review--2026-10-20),
[evidence gallery](artifacts/20261020-standardization/README.md).
The 133-case rollback-only native suite passed after the final cache correction,
with Settings and 29/164/15 Warehouse/Item/Stock Entry counts unchanged. Camera
lifecycle used emulation; physical camera/barcode hardware remains unverified.
