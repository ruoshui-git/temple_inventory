# Acceptance matrices

Launch acceptance for viewing, exporting and editing inventory data. Browse pages are the reports: each page shows one line table, grouping only changes presentation, and 导出 writes that table with the page's filters and visible columns (all matching rows, Chinese headers, display labels, per-unit 合计 rows, a 导出说明 sheet and a readable filename). Mobile viewing is required; mobile export and mobile editing are not.

Legend: ✅ verified · ⚠️ works with a caveat (see 说明) · ❌ missing · 🆕 added after the first matrix · — not applicable.

Verified 2026-10-29 on `development.localhost` (sample data) at 1440×900 and 390×844, from generated XLSX/CSV/ZIP files, and by the backend, unit, browser and live acceptance suites. Column visibility follows each account's saved column choices; the statuses below describe the defaults, and the column menu’s 恢复默认 returns a table to them.

## Reports

### 库存列表 — 库存

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 | ✅ | ✅ | Export: choose 附带文件 → ZIP with `images/<物品编号>.*`, linked from 图片文件 |
| 物品名称 | ✅ | ✅ | |
| 编号 | ✅ | ✅ | |
| 类别 | ✅ | ✅ | |
| 库存位置 | ✅ | ✅ | 位置与批次 column; when shown, the export has one row per item × 库位 × 批次 |
| 数量 | ✅ | ✅ | 🆕 可用数量 (on hand); 借出 / 损坏 / 合计 hidden by default |
| 单位 | ✅ | ✅ | |
| 可选：批次编号、过期日期、剩余时间 | ✅ | ✅ | 效期 column → 过期日期、剩余天数、到期状态 |
| 汇总：物品数量 | ✅ | ✅ | 🆕 "N 种物品" + per-unit 可用 totals; export ends with 合计（单位） rows |

### 过期物品列表 — 效期批次

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 | ✅ | ✅ | ZIP option |
| 物品名称 / 物品编号 / 批次编号 | ✅ | ✅ | |
| 过期日期 / 剩余时间 | ✅ | ✅ | |
| 🆕 到期状态 | ✅ | ✅ | Page: 已过期 / 未过期 / 无效期 tabs and colored dates; export: 已过期 / 未过期 (无效期 for undated) |
| 数量 / 单位 | ✅ | ✅ | |
| 位置 | ✅ | ✅ | Canonical label, not the ERPNext name |
| 汇总：物品数量 | ✅ | ✅ | "N 个批次 · M 种物品" + per-unit totals |

### 库房清单 — 仓库 → a location (or 库存 filtered by location)

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 / 物品名称 / 物品编号 | ✅ | ✅ | |
| 🆕 库位 | ✅ | ✅ | Shelf inside the selected room |
| 数量 / 单位 | ✅ | ✅ | |
| 可选：批次编号、过期日期、剩余时间 | ⚠️ | ⚠️ | 仓库 page shows 批次 only; use 库存 or 效期批次 filtered by the location for dates |
| 汇总：物品数量 | ✅ | ✅ | 当前范围库存 per unit; export 合计 rows |

### 借出清单（物品） — 借用 → 明细

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 / 物品名称 / 物品编号 | ✅ | ✅ | |
| 数量（未归还） | ✅ | ✅ | 🆕 Default 未结清借用 lists open loan lines only (returns stay in 全部相关记录 and per-item history) |
| 原位置 | ✅ | ✅ | 来源位置 of the loan |
| 借出人 | ✅ | ✅ | 借用方 |
| 借出活动 | ✅ | ✅ | |
| 借出时间 | ✅ | ✅ | |
| 🆕 借出单号 | ✅ | ✅ | Opens the loan; returns start there |
| 汇总：物品数量 | ✅ | ✅ | "N 条明细 · M 种物品" + 未归还 per unit |

### 流动记录（物品） — 货物流动 → 明细 (default, ungrouped)

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 / 物品名称 / 物品编号 | ✅ | ✅ | |
| 🆕 流动编号 | ✅ | ✅ | |
| 日期 | ✅ | ✅ | |
| 移动类型 | ✅ | ✅ | 入库 / 出库 / 调拨 / 借出 / 归还 … |
| 来源位置 / 去向位置 | ✅ | ✅ | Empty endpoint = 外部 |
| 数量 | ✅ | ✅ | |
| 🆕 单位 | ✅ | ✅ | |
| 可选：状态 | ✅ | ✅ | |
| 🆕 次数 | ✅ | ✅ | 按物品汇总 grouping shows record counts per item; grouped XLSX keeps "物品 (N)" |
| 汇总 | ✅ | ⚠️ | 🆕 Page: per-type totals + 可用净变化 per unit. Export: per-unit 合计 rows; per-type subtotals need 单据 grouped by 类型 (明细 groups only by 物品 / 类别) |

### 流动记录（记录） — 货物流动 → 单据

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 流动编号 | ✅ | ✅ | |
| 类型 | ✅ | ✅ | |
| 物品类数 | ✅ | ✅ | 物品种数 |
| 具体数量 | ✅ | ✅ | One row per record; mixed units read "12 个；3 箱" |
| 日期 | ✅ | ✅ | |
| 来源位置 / 去向位置 | ✅ | ✅ | A 盘点调整 names the checked locations only |
| 状态 | ✅ | ✅ | 草稿 / 已提交 / 已取消 |
| 🆕 活动 / 借用方 | ✅ | ✅ | |

### 🆕 盘点记录 — 更多 → 盘点调整

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 盘点编号 / 日期 / 状态 / 盘点范围 | ✅ | ✅ | |
| 账面 / 实点 / 差异 | ✅ | ✅ | |

### 🆕 Export behavior (all pages)

| 要求 | 结果 | 说明 |
|---|---|---|
| Columns follow the page's visible columns, in screen order | ✅ | |
| All matching rows, not only loaded rows | ✅ | e.g. 2,651 movement lines from a page showing 30 |
| Chinese headers and display labels (no ERPNext names, `Receive`, `1`) | ✅ | |
| Per-unit 合计 rows | ✅ | |
| 导出说明 sheet: page, filters, grouping, sort, period, time, account, row count | ✅ | XLSX only |
| Readable filename: page–period–time | ✅ | e.g. `货物流动 · 明细-2026-10-01至2026-10-29-20261029-0019.xlsx` |
| Grouped XLSX: grey "[group] (N)" rows, subtotals, collapsible outline | ✅ | Opens expanded; CSV stays flat |
| 附带文件: images / images + attachments as ZIP, de-duplicated by reference | ✅ | `images/<物品编号>.*`, `attachments/items/<物品编号>/`, `attachments/records/<编号>/` |

## Data entry

Submitted stock records follow ERPNext: drafts can be edited or deleted; submitted records are 取消 (reverses stock) and then 修订 (a corrected draft copy). A loan with a submitted return can be cancelled only after that return is cancelled.

| 对象 | 添加 | 查看详情 | 修改 | 删除 | 停用 / 取消 | 说明 |
|---|---|---|---|---|---|---|
| 物品 | ✅ | ✅ | ✅ | ✅ | ✅ 停用 | Delete only when nothing links to it; disable only at zero stock |
| 单位 (UOM) | ✅ | ✅ | ✅ | ✅ | ✅ 停用 | Native name fixed; label and whole-number rule editable; delete only if unused |
| 物品类别 | ✅ | ✅ | ✅ | ✅ | — | Delete only if unused |
| 库房 | ✅ | ✅ | ✅ | ✅ 🆕 | ✅ 停用 | Delete only when unused (no stock, records, User Permissions or sub-locations) |
| 物品照片 | ✅ | ✅ | ✅ | ✅ | — | Crop / replace / remove |
| 条码 | ✅ | ✅ | ✅ | ✅ | — | In the item editor; scan and search find the item |
| 物品附件 | ✅ | ✅ | — | ✅ | — | |
| 流动记录附件 | ✅ | ✅ | — | ✅ | — | Also on 盘点 records |
| 入库记录 | ✅ | ✅ | ✅ draft | ✅ draft | ✅ 取消 / 修订 | |
| 出库记录 | ✅ | ✅ | ✅ draft | ✅ draft | ✅ 取消 / 修订 | Expired goods leave stock through 出库 |
| 调拨记录 | ✅ | ✅ | ✅ draft | ✅ draft | ✅ 取消 / 修订 | |
| 借出记录 | ✅ | ✅ | ✅ draft | ✅ draft | ✅ 取消 / 修订 | |
| 归还记录 | ✅ | ✅ | ✅ draft | ✅ draft | ✅ 取消 / 修订 | Starts from the outstanding loan |
| 库房盘点记录 | ✅ | ✅ | ✅ draft | ✅ draft | ✅ 取消 / 修订 | Matching counts create no record |
| 活动 | ✅ | ✅ | ✅ | ✅ | ✅ 归档 | Delete only if unreferenced |
| 🆕 批次 | via 入库 | ✅ | ✅ | — | — | Fix 过期日期 / 生产日期 |
| 🆕 草稿 | autosave | ✅ | ✅ | ✅ | — | 更多 → 草稿 lists server drafts and browser recovery |

### Process items (no app feature)

| 项目 | 做法 |
|---|---|
| 用户账号 | Create in ERPNext Desk; frontend accounts are System Managers |
| 初始数据 / 批量导入 | Prepared in Excel with images named by 物品编号; loaded by a script after launch. The export ZIP layout (`images/<物品编号>.*`) is the intended input layout |
| 活动类型 | Managed in Desk |

## Open items

- 明细 can group only by 物品 or 类别 + 物品, so per-type subtotals in a file come from 单据 grouped by 类型; the 明细 page header already shows per-type totals and 可用净变化.
- XLSX image links are relative paths that resolve after the ZIP is extracted.
