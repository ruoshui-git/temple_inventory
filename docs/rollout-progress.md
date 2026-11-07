# Rollout progress

Tracks the four-phase rollout. Status words are used strictly: Implemented (code exists), Tested (suites passed), Committed, Deployed (Sample runs that commit), Verified (real-login smoke passed on Sample).

| Phase | Implemented | Tested | Committed | Deployed | Verified |
|---|---|---|---|---|---|
| 1 Permissions | in progress | | | | |
| 2 Opening Stock | | | | | |
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

**Tests.** See the phase table once deployed.
