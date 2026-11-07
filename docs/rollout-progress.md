# Rollout progress

Tracks the four-phase rollout. Status words are used strictly: Implemented (code exists), Tested (suites passed), Committed, Deployed (Sample runs that commit), Verified (real-login smoke passed on Sample).

| Phase | Implemented | Tested | Committed | Deployed | Verified |
|---|---|---|---|---|---|
| 1 Permissions | ✅ | ✅ | ✅ `a89f326` | ✅ run 42363216839 | ✅ 15/15 real-login smoke on Sample |
| 2 Opening Stock | ✅ | ✅ | ✅ `0cdd812` | ✅ run 42388149090 | ✅ 14/14 real-login smoke on Sample |
| 3 Item import | ✅ | ✅ | ✅ `dcbf956` | ✅ run 42399028934 | ✅ 16/16 real-login smoke on Sample |
| 4 Opening Stock import | ✅ | ✅ locally | | | |

## Decisions confirmed by the owner (2026-11-06)

- Managers manage 类别, 单位 and 活动类型; Warehouses and Settings stay Administrator-only. Imports reject unknown categories and units instead of creating them.
- Anyone who can edit a draft or Item may remove its attachments; submitted records need cancel permission. Deleting Items and Activities is Administrator-only.

## Phase 1 — Permissions

**Scope.** Four native roles and Role Profiles (`roles.py`), one install patch that moves existing System Managers to Inventory Administrator once, admission by role, `session.info` capabilities and per-document `actions`, permission-aware UI on every page, read-only views, `ForbiddenState` for direct URLs, nine demo accounts plus a no-access account.

**Decisions.**

- `Administrator` is an automatic Frappe role, so the fourth role is `Inventory Administrator`. `admin@example.com` belongs to the built-in Administrator, so the demo account is `inventory.admin@example.com`.
- Rows for ERPNext DocTypes go through `add_permission`, never fixtures: a Custom DocPerm fixture would silently drop ERPNext's standard rows.
- `ensure_roles` runs from its own `after_install` entry and one patch, not `after_migrate`, so Role Permission Manager edits survive deployments.
- Export is a per-user job, not a stock write: every role may request and retry its own exports.
- `bootstrap.operations` follows native create permission, so every create menu and quick action shares one server-side gate.
- Bin read is added to the matrix for all roles because catalog and report paths use permission-filtered Bin reads.

**Found by real-login review, not by mocks.** 新建盘点 on 盘点记录, 登记借出 on 借用, 继续编辑/删除 on 草稿. The live spec now sweeps every page per role.

**Also fixed.** Tapping 完成 on the phone filter sheet could fall through to the 更多 tab (present on main; the test failed 2 of 3 runs there, 8 of 8 pass now).

**Tests.** Local, on the final code: backend 421 tests, 0 failures, 1 skipped; Vitest 1,155; browser 153 passed, 1 skipped; live acceptance 36; Ruff, Prettier and type-check clean. Branch CI run 42361580602 passed, including the full sample seed under the new roles.

**Visual review.** 240 real-login screenshots: four accounts at 1440, 1024 and 390 across every reviewed page (`notes/evidence/2026-11-07-roles/`, gitignored).

**Deployment.** Commit `a89f326`, Sample run 42363216839, image `sha256:a2b788d5f97f7b2e1c4d1b70dda598a45455c88a5de1e1b56c0c5bff39241484`, full reinstall and reseed. Smoke against sample.kufang.online with the committed spec: 15 of 15, covering all accounts, refused direct API calls, Operator submit with Manager cancel, Viewer export and the no-access page.

**Risks.** Operators cannot delete autosaved drafts, by design, so drafts can accumulate until a Manager clears them. Nothing reached staging or production; the patch that moves System Managers to Inventory Administrator has run only on development, not on a site with real accounts.

## Phase 2 — Opening Stock

**Scope.** Native Stock Reconciliation with purpose Opening Stock, its own editor at `/counts/opening/new`, read view, batch and serial lines, Temporary difference account, per Item × location eligibility, cancel and amend, background submit above 100 lines.

**Decisions.**

- A separate editor, not a Purpose dropdown: a count compares against a baseline, an opening declares a first quantity.
- Eligibility and scope run in `before_validate`, so Desk and the API agree. Any active ledger entry for an Item × location blocks it, at any date. Other locations of the same Item stay open.
- `OPENING_LINE_FIELDS` is separate, so ordinary counts still cannot revalue through the API.
- The declared date is honoured: `ti_time_mode` is forced to Historical, because Stock Reconciliation defaults to Current and submit would otherwise replace the date with now.
- A blank or zero rate uses ERPNext's fallback, else zero value with a note, matching donated goods.
- The difference account is server-set for the app; a Desk user's own choice is kept and ERPNext's account rules still apply.

**Found by real-data review, not by the suites.** Submit replacing the declared posting time; merely opening a draft saving it; desktop cells shifting under the wrong headers; count wording on the read view; native unit names; a batch field that could not create a batch.

**Tests.** Local, on the final code: backend 441 tests, 0 failures, 1 skipped; Vitest 1,161; browser 156 passed, 1 skipped; live acceptance 37; Ruff, Prettier and type-check clean.

**Visual review.** Real-data draft, submitted and read views at 1440, 1024 and 390 (`notes/evidence/2026-11-07-opening/`, gitignored).

**Deployment.** Commit `0cdd812`, Sample run 42388149090, image `sha256:8804f1d87da7da10d7d99cb37a229c0a659122d4375780131d2e3afa5679b368`, full reinstall and reseed. The first CI attempt failed on one test, a 30-second Chromium launch timeout in the PDF screenshot helper; rerunning the failed job passed with no code change. Smoke against sample.kufang.online with the committed spec: 14 of 14, including a Manager creating and submitting Opening Stock over HTTP and the Operator refused.

**Risks.** Item × location eligibility ignores dates by design, so stock received through 入库 before a location's opening must be corrected with 盘点调整.

## Phase 3 — Item import

**Scope.** `Inventory Import` DocType as audit record and permission gate, `Item.ti_import_ref`, template, upload, dry run, commit job, result report, catalog download, and a wizard at `/imports/items`.

**Decisions.**

- Frappe Data Import is not used: it has no dry run or before/after preview and commits per row.
- Permission comes from the `Inventory Import` DocType, which is how Operators, who can edit Items, stay out of imports.
- All Items commit in one transaction. To keep other writers moving, codes are allocated in a short earlier commit and the global read-generation bump waits until just before the final commit.
- Barcodes are additive, so an import never removes one.
- The job runs as the person who confirmed it, and rechecks each Item's version at write time.

**Found by code and visual review, not by the suites.** Item updates replacing all barcodes; a passing test that stubbed `commit` and so hid the global lock being held for the whole job; `status` writing on GET; rows that passed the plan and only failed at commit; 确认导入 still offered after completion.

**Tests.** Local, on the final code: backend 468 tests, 0 failures, 1 skipped; Vitest 1,164; browser 157 passed, 1 skipped; live acceptance 39; Ruff, Prettier and type-check clean. A real browser import ran end to end: upload, preview, skip rejected rows, submit, result.

**Visual review.** Real-data start, preview, before/after, confirm and result at 1440 and preview at 390 (`notes/evidence/2026-11-07-imports/`, gitignored).

**Deployment.** Commit `dcbf956`, Sample run 42399028934, image `sha256:6c83a9ee28592304b4fd8dfea65f765acd116c73124f0a91f3cc70092ed114f2`, full reinstall and reseed, CI passed first time. Smoke against sample.kufang.online with the committed spec: 16 of 16, including a Manager importing a workbook over HTTP and Viewer and Operator refused at the page and the API.

**Limits.** 5 MB, 5,000 rows. Images are not imported. The concurrency proof is ordering-based: no test runs a second connection during a job.

## Phase 4 — Opening Stock import

**Scope.** Opening Stock import type on the shared import flow: template with a 位置清单 of authorized leaves, explicit posting date and time, dry run, commit, report, and a wizard at `/imports/opening`.

**Decisions.**

- One import makes exactly one native Stock Reconciliation across every location, keyed by `ti_request_key = sha256(import name)`, so a retry finds the same document instead of creating another.
- The draft and its batches commit first. The worker then submits with `_submit()`, because `submit()` re-queues documents over 100 lines and the job already is the worker. A failed submit keeps the draft and says so.
- Eligibility is the Phase 2 query, extracted into `opening.opening_pair_blockers` and shared by the editor and the import.
- Items are never created here; an unknown 物品编号 is rejected, so the documented order is Item import first.
- Posting date and time default to the site's current time and stay editable; they become the recorded stock time.

**Found by real-data review, not by the suites.** Posting date empty by default, leaving the upload button silently disabled; the context box repeated on the result page; `0:00:01` time formatting; a unitless quantity reading 未知单位; leading separators on phone cards.

**Tests.** Local, on the final code: backend 482 tests, 0 failures, 1 skipped; Vitest 1,165; browser 158 passed, 1 skipped; live acceptance 39; Ruff, Prettier and type-check clean. A real browser import ran end to end: six rows, three new and three rejected, submitted as one document with three lines across two locations at the declared 00:00:01.

**Visual review.** Real-data start, preview, confirm, result and resulting document at 1440, and preview at 390 (`notes/evidence/2026-11-07-opening-import/`, gitignored).

**Limits.** Writes to the import's locations wait while it submits.
