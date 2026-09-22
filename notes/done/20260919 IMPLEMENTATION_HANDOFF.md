# Temple Inventory Implementation Handoff

Date: 2026-09-19
Status: In progress; validation substantially complete, clean-site installer acceptance and commit still pending.

## Completed in this session

### Optimized sample assets

Generated and verified assets under temple_inventory/setup/sample_assets/:

- manifest.json
- images/general/: 61 WebP files
- images/costumes/: 114 WebP files
- Total: 175 WebP files, 176 files including the manifest
- Total bytes: 22,676,358 (approximately 21.63 MiB)
- Largest file: approximately 363 KiB

The optimizer is now a reproducible CLI at temple_inventory/setup/optimize_images.py. It applies EXIF orientation, limits the long edge to 1280px without upscaling, writes WebP quality 80, preserves alpha, strips metadata, writes SHA-256/dimension/size metadata, and fails on missing/duplicate/oversized output.

Example commands:
~~~sh
frappe-bench/env/bin/python temple_inventory/setup/optimize_images.py build
frappe-bench/env/bin/python temple_inventory/setup/optimize_images.py verify
~~~

Raw source directories remain intentionally ignored:

- temple_inventory/setup/costumes-data/images/
- temple_inventory/setup/sample_images/

### Backend/model work already present

- New DocTypes: Inventory Loan, Inventory Loan Item, Inventory Return, Inventory Return Item, Inventory Loss, Inventory Loss Item.
- Workspace audit fields and borrower_same_as_reviewer.
- Canonical warehouse hierarchy and movement-specific reserved warehouse checks.
- outstanding_loan_items endpoint.
- Room-to-/ 未指定 handling in several selectors/importers.
- Stock Entry cancellation hooks and business-document links.
- Loan/Return/Loss row stock_entry_detail population after Stock Entry submission.
- Sample installer status fields and manager-only enqueue endpoint.
- Representative transaction seed module: temple_inventory/sample_transactions.py.

### Installer/importer work already present

- setup/sample_inventory_data.py consumes tracked general WebPs and no longer commits internally.
- setup/import_costumes.py consumes sample_assets/manifest.json, can attach costume WebPs, and no longer commits internally.
- sample_install.py performs the intended Installing/Installed/Failed status flow, clean-site guard, transaction-level install attempt, and physical File cleanup on failure.
- Opening stock documents are submitted by the importers.
- migration/import_costumes.py was removed; canonical setup copy exists at setup/import_costumes.py.
- .gitignore allows canonical setup inputs and sample_assets/**, while ignoring raw images and staging/legacy helper files.

### Frontend work already present

- Added LoanItemPicker.vue.
- Return workflow can select outstanding Loan Items, including cross-Loan rows and damaged-return targets.
- Loss can be opened from an outstanding Loan Item and Return confirmation offers 继续记录遗失.
- Repair and Disposal movement actions exist.
- Sample install UI/status polling changes are partially present.
- Frontend type-check and the earlier Vitest suite passed before the final cleanup work.

## Known unfinished work / blockers

### 1. Legacy frontend/API consumers still exist

frontend/src/pages/Inventory.vue still exposes the old 借用项目 page and calls lease_programs and save_lease_program. It also still uses legacy generic movement fields (recipient, donor_source, purpose, lease_program_warehouse). Remove or replace these consumers with the approved activity/borrower/workspace flow before retiring the legacy APIs.

inventory_api.py still contains lease_programs, save_lease_program, and an old outstanding_loans compatibility alias. Decide whether to remove them after the frontend consumers are gone.

### 2. Workspace UI still contains old fields

frontend/src/pages/Workspace.vue still renders source_type, donor_source, recipient, loan_reference, and generic purpose. Replace these with source_text, purpose_text, borrower, and the approved audit controls. Keep only compatibility normalization in the backend if needed.

The UI needs a clear borrower_same_as_reviewer control and must clear irrelevant reviewer fields/signatures when 无独立鉴证人 is selected.

### 3. Opening-stock dates need hardening

The general and costume importers currently create opening stock with a single posting date. Batch rows whose expiry is already past may fail ERPNext validation. Split opening-stock reconciliations by valid posting date (or otherwise choose a valid historical date per batch) so expired batches are submitted legally. Verify both catalogs on a clean site.

### 4. Installer atomicity needs verification

The importer internal commits were removed, but the complete installer must still be tested to ensure:

- only the initial Installing status is committed before work;
- all database writes roll back on failure;
- only files created by the current run are deleted;
- Failed status and error are committed after rollback;
- success commits data and sample-data version together.

Search all code called by the installer for hidden frappe.db.commit() calls before relying on atomicity.

### 5. Backend tests are stale

Existing temple_inventory/tests/test_workspace.py has legacy payloads that do not provide the mandatory audit fields, causing errors rather than meaningful failures. Update test fixtures to use no_independent_reviewer=1 (or valid reviewer name/signature), then add focused tests for:

- canonical warehouse hierarchy and Room resolution;
- reserved warehouse restrictions;
- immutable 记录人 and signature invalidation;
- Loan/Return/Loss accounting, cross-Loan returns, damaged returns, borrowed Loss;
- aggregate/concurrent over-resolution;
- cancellation propagation/dependency blocking;
- direct business-document protection;
- installer idempotency, rollback, file cleanup, exact transaction mix, and final balances.

Do not weaken production validation to satisfy legacy tests.

### 6. Public Room resolver endpoint

The plan calls for a Room-to-default-leaf resolver used consistently by APIs and selectors. Add/verify a whitelisted endpoint (for example resolve_room_leaf(room)) and route all relevant callers through the same helper.

### 7. Sample transaction seed requires clean-site execution

sample_transactions.py is present but has not yet been proven on a clean site. Verify the required mix:

- 2 入库
- 2 出库
- 2 转移
- 3 借出, same Item in multiple open Loans
- 1 cross-Loan 归还 with two normal destinations plus one damaged row
- 1 borrowed-stock 遗失
- 1 ordinary Damage
- 1 ordinary Loss
- 1 Repair
- 1 Disposal

Expected count is 14 Workspaces/Stock Entries. Verify partial outstanding quantities, multiple Activities, 损坏待处理 stock, and one 无独立鉴证人 example.

### 8. Migration and clean-site acceptance remain undone

Run bench migrate after final schema changes. Do not add production migration patches. Reinstall the disposable development site only after automated checks pass, then initialize the canonical hierarchy and run the one-click installer once.

### 9. Validation remains to run

~~~sh
bench migrate
bench --site development.localhost execute temple_inventory.tests.test_workspace.run
cd frontend
yarn test --run
yarn type-check
yarn build
~~~

Also run focused Ruff checks and the rollback-only backend integration suite. Fix all failures before declaring release-ready.

## Git staging/commit checklist

Do not commit raw sources, caches, or build output.

Expected tracked additions include:

- temple_inventory/setup/__init__.py
- temple_inventory/setup/sample_inventory_data.py
- temple_inventory/setup/import_costumes.py
- temple_inventory/setup/optimize_images.py
- temple_inventory/setup/costumes-data/costumes_source_normalized.csv
- temple_inventory/setup/costumes-data/image_manifest.csv
- temple_inventory/setup/sample_assets/manifest.json
- all 175 files below temple_inventory/setup/sample_assets/images/
- backend/frontend/DocType/fixture/hook/test changes

The deleted migration/import_costumes.py and new setup/import_costumes.py should appear as a rename once staged.

Before staging:
~~~sh
git ls-files temple_inventory/setup/sample_assets
git check-ignore temple_inventory/setup/costumes-data/images/<source-file>
git check-ignore temple_inventory/setup/sample_images/<source-file>
~~~

After git add, the first command must list 176 files. The two raw-source checks must report ignored paths. Git LFS is unnecessary; commit the approximately 21.63 MiB optimized assets directly.

Suggested final staging command (review first):
~~~sh
git add .gitignore frontend temple_inventory
git status --short
git diff --cached --check
~~~

Do not commit until the clean-site installer and acceptance checks pass.


## Continuation update (2026-09-19)

Completed after the earlier handoff:

- Removed the legacy Inventory page/API consumers for lease-program workflows.
- Canonicalized Workspace and History UI fields to 来源/用途/借用方 plus the two-signature audit model.
- Added service-only creation and submitted-document amendment protection for Inventory Loan/Return/Loss.
- Removed the active legacy v1 warehouse migration patch from patches.txt and deleted its module; clean installs now rely on canonical bootstrap logic.
- Fixed the Workspace root template closure so the production build parses successfully.
- Deduplicated the custom-field fixture and removed insert-after references to deleted fields.
- General sample image attachment now fails on missing manifest, unmapped sample key, missing output, or missing optimized WebP.
- Ran bench migrate successfully after the schema/fixture changes.
- Backend workspace suite: 19/19 passed.
- Frontend Vitest: 3 files / 10 tests passed.
- Frontend TypeScript check passed.
- Production frontend build passed.
- Installer invocation on the existing development site correctly stopped at the disposable-data clean-site guard; it was not run against a clean site.

Still required before release/commit:

1. Reinstall or otherwise provision a disposable clean development site, then run the complete installer once. Verify both catalogs (160 Items), 175 attached WebP images, submitted opening-stock reconciliations, exactly 14 representative Workspaces/Stock Entries, partial outstanding Loans, damaged stock, and cancellation/rollback behavior.
2. Add/execute installer integration tests for idempotency, failure rollback, File cleanup, and final balances.
3. Run the browser/Playwright suite after updating its mock labels/payloads for canonical 来源 and recorder_signature fields.
4. Review git diff --check, git status, and staging rules. Do not stage raw source image directories or generated frontend build output. Stage sample_assets/manifest.json plus all 175 WebPs directly in Git.
5. Re-run the exact asset checks from the plan. Expected sample_assets file count is 176 (manifest + 175 WebPs); raw image paths must be ignored.


Additional validation:

- Browser Playwright suite: 2 active tests passed; camera test skipped because SCAN_VIDEO was not supplied.
- Ruff could not be run because no ruff executable/module is installed in the available bench environment.
- Asset files are present in the working tree but intentionally not staged: 176 files total (manifest + 175 WebPs). After staging the canonical setup paths, git ls-files should report 176.
- git diff --check passed.


Final backend note:

- After adding draft/edit protection, one suite run hit a transient MariaDB record-changed lock in the test serialized request-id path. An immediate rerun passed all 19 tests. Treat this as an environment concurrency flake to investigate if it recurs, not as a production validation failure.
