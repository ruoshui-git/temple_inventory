# Acceptance matrices

Launch acceptance for viewing, exporting and editing inventory data. Browse pages are the reports: each page shows one line table, grouping only changes presentation, and 导出 writes that table with the page's filters and visible columns (all matching rows, Chinese headers, display labels, per-unit 合计 rows, a 导出说明 sheet and a readable filename). Mobile viewing is required; mobile export and mobile editing are not.

Legend: ✅ verified · ⚠️ works with a caveat (see 说明) · ❌ missing · 🆕 added after the first matrix · 🔁 changed in the 2026-10-29 feedback round · 🔄 changed in the 2026-10-30 feedback round · — not applicable.

Verified 2026-10-29 on `development.localhost` (sample data) at 1440×900 and 390×844, from generated XLSX/CSV/ZIP files, and by the backend, unit, browser and live acceptance suites; re-verified the same day after the feedback round (rows marked 🔁), and again on 2026-10-30 after the second feedback round (rows marked 🔄). Column visibility follows each account's saved column choices; the statuses below describe the defaults, and the column menu’s 恢复默认 returns a table to them.

## Reports

### 库存列表 — 库存

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 | ✅ | ✅ | Export: choose 附带文件 → ZIP with `images/<物品编号>.*`, linked from 图片文件 |
| 物品名称 | ✅ | ✅ | |
| 编号 | ✅ | ✅ | |
| 类别 | ✅ | ✅ | |
| 库存位置 | ✅ | ✅ | 位置与批次 column; when shown, the export has one row per item × 库位 × 批次 |
| 🔁 完整位置 / ERPNext 库位 | ✅ | ✅ | Hidden by default. 完整位置 is the app path ("T2 / A02 / S1"); ERPNext 库位 is the native warehouse_name without the company suffix ("T2 / A02 · 直接存放") |
| 数量 | ✅ | ✅ | 🆕 可用数量 (on hand); 借出 / 损坏 / 合计 hidden by default. 🔁 合计 now shows a value and exports as 合计 (was blank / 数量). 🔄 Numeric cells, bold tabular digits; 物品名称 stays pinned while the table scrolls sideways |
| 🔄 库存状态 | ✅ | ✅ | Per item across the selected locations: 有库存 (default, includes loaned/damaged-only), 有可用, 无可用, 无库存, 全部 |
| 单位 | ✅ | ✅ | |
| 🔄 可选：库位、批次编号、到期日期、剩余天数、到期状态 | ✅ | ✅ | Hidden columns beside the 位置与批次 and 效期 compound columns; the file headers are these column labels |
| 汇总：物品数量 | ✅ | ✅ | 🆕 "N 种物品" + per-unit 可用 totals; export ends with 合计（单位） rows |

### 过期物品列表 — 效期批次

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 | ✅ | ✅ | ZIP option |
| 物品名称 / 物品编号 / 批次编号 | ✅ | ✅ | |
| 🔄 到期日期 / 剩余天数 | ✅ | ✅ | The date is 到期日期 on page and in files; 效期 names the compound column |
| 🆕 到期状态 | ✅ | ✅ | Page: 已过期 / 未过期 / 无效期 tabs and colored dates; export: 已过期 / 未过期 (无效期 for undated). 🔁 The 未过期 filter chip reads 到期窗口：未过期 |
| 数量 / 单位 | ✅ | ✅ | |
| 位置 | ✅ | ✅ | Canonical label, not the ERPNext name; 🔁 完整位置 / ERPNext 库位 optional |
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
| 图片 / 物品名称 / 物品编号 | ✅ | ✅ | 🔁 Thumbnails load on every 明细 row (were placeholders) |
| 数量（未归还） | ✅ | ✅ | 🔁 筛选 → 范围: 记录范围 仅未归还借出 (default, the 借出清单) or 借出与归还全部记录 (every loan line plus its return / damage / loss lines); 包括已结清物品 adds fully returned loans. Both are in the URL and the export follows them. Quantity is signed: loan +, return − |
| 来源位置 | ✅ | ✅ | 🔁 Neutral labels (日期 / 编号 / 来源位置) because 明细 may list returns; 完整位置 / ERPNext 库位 optional |
| 借用方 | ✅ | ✅ | 🔄 One term on forms, columns, filters and files |
| 借出活动 | ✅ | ✅ | |
| 借出时间 | ✅ | ✅ | |
| 🆕 借出单号 / 编号 | ✅ | ✅ | Opens the record; returns start from the loan. 🔁 未归还数量 precedes 借出数量 in both loan views |
| 汇总：物品数量 | ✅ | ✅ | "N 条明细 · M 种物品" + 未归还 per unit |

### 🔄 借用记录（单据） — 借用 → 单据

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 范围 | ✅ | ✅ | 仅未归还借出 (default) lists open loan documents; 借出与归还全部记录 adds 归还 / 损坏 / 遗失 documents. Non-default 范围 shows a chip |
| 编号 / 类型 / 日期 | ✅ | ✅ | Neutral headers because returns are listed too |
| 结算记录 / 原借出 | ✅ | ✅ | Loan rows link their settlements; settlement rows link their loans. Visible by default |
| 登记归还 | ✅ | — | Only on open loan rows |

### 流动记录（物品） — 货物流动 → 明细 (default, ungrouped)

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 图片 / 物品名称 / 物品编号 | ✅ | ✅ | |
| 🆕 流动编号 | ✅ | ✅ | 🔁 编号 column holds only the record; 物品名称 is its own column |
| 日期 | ✅ | ✅ | |
| 移动类型 | ✅ | ✅ | 入库 / 出库 / 调拨 / 借出 / 归还 … 🔁 盘点调整 and 期初库存 are always listed and selectable in 流动类型 (the 包括盘点调整 switch is gone) |
| 来源位置 / 去向位置 | ✅ | ✅ | Empty endpoint = 外部; a 盘点调整 names the checked location and leaves the other end blank. 🔁 来源/去向 完整位置 and ERPNext 库位 optional. 🔄 Fixed: they showed — on movement and loan pages |
| 🔁 可用变化 | ✅ | ✅ | Default quantity column (signed, per unit); 数量 is optional. 🔄 Files: numeric with a 单位 column |
| 🔄 原借出 / 时间 / 单位 | ✅ | ✅ | Hidden by default; exported when shown |
| 数量 | ✅ | ✅ | Optional |
| 🆕 单位 | ✅ | ✅ | |
| 可选：状态 | ✅ | ✅ | |
| 🆕 次数 | ✅ | ✅ | 按物品汇总 grouping shows record counts per item; grouped XLSX keeps "物品 (N)" |
| 汇总 | ✅ | ⚠️ | 🆕 Page: per-type totals + 可用净变化 per unit. 🔁 Group rows and export 合计 rows sum 可用变化 (合计可用变化（单位）). 🔄 Mixed-unit groups write one numeric "小计 · 单位" row per unit. Per-type subtotals in a file need 单据 grouped by 类型 (明细 groups only by 物品 / 类别) |

### 流动记录（记录） — 货物流动 → 单据

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 流动编号 | ✅ | ✅ | |
| 类型 | ✅ | ✅ | |
| 物品类数 | ✅ | ✅ | 物品种数 (🔁 fixed: a mixed-unit record exported the first unit's count) |
| 具体数量 | ✅ | ✅ | 🔁 可用变化 by default (盘点调整 included); 库存数量 optional. Cells show two units plus "+N 单位". 🔄 Files write one numeric row per unit with a 单位 column instead of "12 个；3 箱" |
| 日期 | ✅ | ✅ | |
| 来源位置 / 去向位置 | ✅ | ✅ | A 盘点调整 names the checked locations only. 🔁 Many locations show the first plus "等 N 处" with a list (e.g. MAT-STE-2026-00056: 25 destinations); files join all with "；" |
| 状态 | ✅ | ✅ | 草稿 / 已提交 / 已取消 |
| 🆕 活动 / 借用方 | ✅ | ✅ | |

### 🆕 盘点记录 — 更多 → 盘点调整

| 字段 | 页面 | 导出 | 说明 |
|---|---|---|---|
| 盘点编号 / 日期 / 状态 / 盘点范围 | ✅ | ✅ | 🔁 One value per column (编号, 类型, 状态, 盘点范围, 行数, 物品种数, 日期, 活动); 期初库存 records listed; no 借用人 |
| 🔁 增加 / 减少 / 净差异 | ✅ | ✅ | Per unit; 净差异 is the offset net (MAT-RECO-2026-00021: +1 / −1 / 0). 🔄 Files keep them numeric, one row per unit |
| 账面 / 实点 / 差异 | ✅ | ✅ | 🔁 Submitted counts show changed lines only, with "另有 N 个物品核对无变化"; no filters or baseline controls |

### 🆕 Export behavior (all pages)

| 要求 | 结果 | 说明 |
|---|---|---|
| Columns follow the page's visible columns, in screen order | ✅ | 🔄 Every exported field is a browse column (export-only data hidden by default); pending, activities, counts, reports and item detail follow the same rule. 🔄 Fixed: 借用 明细 export always failed with 请选择有效的导出列 |
| All matching rows, not only loaded rows | ✅ | e.g. 2,651 movement lines from a page showing 30 |
| Chinese headers and display labels (no ERPNext names, `Receive`, `1`) | ✅ | 🔁 Headers equal the page's column labels (checked per page by a parity test) |
| Per-unit 合计 rows | ✅ | |
| 导出说明 sheet: page, filters, grouping, sort, period, time, account, row count | ✅ | XLSX only |
| Readable filename: page–period–time | ✅ | e.g. `货物流动 · 明细-2026-10-01至2026-10-29-20261029-0019.xlsx` |
| Grouped XLSX: grey "[group] (N)" rows, subtotals, collapsible outline | ✅ | Opens expanded; CSV stays flat |
| 附带文件: images / images + attachments as ZIP, de-duplicated by reference | ✅ | `images/<物品编号>.*`, `attachments/items/<物品编号>/`, `attachments/records/<编号>/` |
| 🔁 Progress and download feedback | ✅ | Stages 读取数据 / 写入文件 / 打包附件 with a progress bar; 下载 shows 正在准备下载… then byte progress. Permission check for a 2,285-line movements download: 7.3s → 1.7s |

## Data entry

Submitted stock records follow ERPNext: drafts can be edited or deleted; submitted records are 取消 (reverses stock) and then 修订 (a corrected draft copy). A loan with a submitted return can be cancelled only after that return is cancelled.

| 对象 | 添加 | 查看详情 | 修改 | 删除 | 停用 / 取消 | 说明 |
|---|---|---|---|---|---|---|
| 物品 | ✅ | ✅ | ✅ | ✅ | ✅ 停用 | Delete only when nothing links to it; disable only at zero stock |
| 单位 (UOM) | ✅ | ✅ | ✅ | ✅ | ✅ 停用 | Native name fixed; label, 🔄 单位类别 (ERPNext UOM Category) and whole-number rule editable; delete only if unused. 🔄 停用 is refused while any Item uses the unit |
| 物品类别 | ✅ | ✅ | ✅ | ✅ | — | Delete only if unused |
| 库房 | ✅ | ✅ | ✅ | ✅ 🆕 | ✅ 停用 | Delete only when unused (no stock, records, User Permissions or sub-locations) |
| 物品照片 | ✅ | ✅ | ✅ | ✅ | — | Crop / replace / remove |
| 条码 | ✅ | ✅ | ✅ | ✅ | — | In the item editor; scan and search find the item |
| 物品附件 | ✅ | ✅ | — | ✅ | — | |
| 流动记录附件 | ✅ | ✅ | — | ✅ | — | Also on 盘点 records. 🔄 Add/remove also on submitted records (cancelled stay read-only); in-app viewer for images, PDFs and text |
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

- Push notifications cannot be verified on `development.localhost`; verify on the sample site after deploy with 通知设置 → 发送测试通知.
- 明细 can group only by 物品 or 类别 + 物品, so per-type subtotals in a file come from 单据 grouped by 类型; the 明细 page header already shows per-type totals and 可用净变化.
- XLSX image links are relative paths that resolve after the ZIP is extracted.
