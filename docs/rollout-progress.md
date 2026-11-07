# Rollout progress

Tracks the four-phase rollout. Status words are used strictly: Implemented (code exists), Tested (suites passed), Committed, Deployed (Sample runs that commit), Verified (real-login smoke passed on Sample).

| Phase | Implemented | Tested | Committed | Deployed | Verified |
|---|---|---|---|---|---|
| 1 Permissions | ✅ | ✅ | ✅ `a89f326` | ✅ run 42363216839 | ✅ 15/15 real-login smoke on Sample |
| 2 Opening Stock | ✅ | ✅ locally | | | |
| 3 Item import | | | | | |
| 4 Opening Stock import | | | | | |

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

**Risks.** Item × location eligibility ignores dates by design, so stock received through 入库 before a location's opening must be corrected with 盘点调整.
