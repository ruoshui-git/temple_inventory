Below is the accompanying spec I would give the agent together with the latest mockup. The **document should be treated as the behavioral/source-of-truth spec**, while the mockup is primarily the visual reference.

# 货物流动页面 UI/UX 设计说明

## 1. Purpose

Redesign the `货物流动` area around two different ways of inspecting inventory activity:

```text
货物流动
├─ 明细
└─ 记录
```

These are **two views over the same inventory movement domain**, not separate workflows.

### 明细

Answers:

> “During this period, which individual items moved?”

Each row represents **one item movement line**.

Examples:

- 白砂糖入库 5 Nos
- 口罩出库 4 包
- 演出服从 A04 转移到 C02
- 道具从 A04 借出
- 借出的相机归还 A04
- 盘点产生库存调整 −2 Nos

### 记录

Answers:

> “During this period, which stock-operation records were created?”

Each row represents **one operation/document**, which may contain multiple item lines.

Examples:

- 一张入库单，8 个物品行
- 一张转移单，3 个物品行
- 一张借出单，2 个物品行
- 一张库存调整记录
- 一张报废记录

---

# 2. Navigation

Under the main sidebar:

```text
库存
货物流动
    明细
    记录
盘点调整
借用
仓库
...
```

Remove the old movement subpages:

```text
概览
入库
出库
转移
```

`入库 / 出库 / 转移 / 借出 / 归还 / 库存调整 / 报废` are now **movement-type filters**, not navigation destinations.

The default `货物流动` destination should be **明细**.

Suggested routes:

```text
/inventory/movements/items
/inventory/movements/records
```

Query parameters should represent filters:

```text
/inventory/movements/items?period=this_month
/inventory/movements/items?period=this_month&kind=Receive

/inventory/movements/records?period=this_year
/inventory/movements/records?kind=Transfer
```

Exact internal route naming can follow the existing codebase conventions.

---

# 3. Shared page structure

Both pages use the same general layout:

```text
Main sidebar
↓
Filter sidebar
↓
Main content
    Time controls
    Search / actions
    Movement-type chips
    Table
```

Avoid dashboard-style cards taking significant vertical space.

The actual records should be the visual focus.

---

# 4. Time-range controls

Time range belongs in the **main page header**, not in the left filter sidebar.

Primary controls:

```text
[本周] [本月] [本年] [自定义] [更多 ▾]
```

Default:

```text
本月
```

Always display the resolved actual date range below/beside the controls:

```text
2026-09-01 至 2026-09-30
```

This remains visible even when using a preset.

## 更多 menu

`更多 ▾` contains rolling periods:

```text
近7天
近30天
近90天
近365天
```

Natural/calendar periods are intentionally given greater prominence than rolling periods.

If a rolling period is active, its selection must remain obvious.

For example:

```text
[本周] [本月] [本年] [自定义] [近30天 ▾]
```

Do not leave `更多` displayed without indicating which option is active.

## 自定义

Clicking `自定义` opens a date-range selector.

Once applied, display the exact selected dates.

---

# 5. Movement-type chips

Directly above the table on both pages:

```text
[全部 42]
[入库 12]
[出库 8]
[转移 6]
[借出 7]
[归还 4]
[库存调整 3]
[报废 2]
```

These are the primary movement-type filters.

Therefore:

**Do NOT duplicate movement type controls in the left filter sidebar.**

The number displayed on each chip represents the number of matching rows/records for the current date range and other active filters.

## Selection behavior

Prefer supporting multi-selection:

```text
[入库 ✓] [归还 ✓]
```

means:

```text
kind = Receive OR Return
```

Clicking `全部` clears movement-type filtering.

If multi-selection significantly complicates implementation, single-selection is acceptable for the first iteration, but the component should not be architected in a way that prevents future multi-select support.

---

# 6. `库存调整` vs `盘点`

Do **not** call `盘点` a stock movement type.

`盘点调整` remains its own main workflow/page.

Reason:

A physical count itself does not necessarily move inventory.

Example:

```text
System quantity: 100
Physical quantity: 100
Difference: 0
```

No stock movement occurred.

But:

```text
System quantity: 100
Physical quantity: 97
Difference: -3
```

creates an actual inventory adjustment.

Therefore:

```text
盘点调整 page
    ↓ discrepancy
库存调整 movement
```

The movement ledger should use the label:

```text
库存调整
```

not:

```text
盘点
```

A stock adjustment created from a count can link back to the underlying 盘点调整 record.

---

# 7. Semantic location display

The user should **not** be exposed to implementation-only virtual warehouses such as the internal Leased warehouse.

Borrowing is a native business concept in the custom app.

Render warehouse flows semantically.

Examples:

### 入库

```text
— → 第2寺院 / A02
```

or compactly:

```text
→ 第2寺院 / A02
```

### 出库

```text
第2寺院 / C02 →
```

### 转移

```text
A04 → C02
```

### 借出

Internally this may be:

```text
A04 → Leased warehouse
```

but render:

```text
A04 → 借出
```

### 归还

Internally:

```text
Leased warehouse → A04
```

render:

```text
借出 → A04
```

The UI should communicate the **business action**, not the backend warehouse implementation.

---

# 8. Filter sidebar — 明细

The filter sidebar should contain only secondary / advanced filters.

Do not include:

- movement type
- time range

Those already have dedicated controls in the main content.

Use:

```text
筛选

物品类别
[搜索或选择物品类别           ▾]

物品
[搜索物品名称或编码           ▾]

来源位置
[搜索或选择仓库 / 位置        ▾]

去向位置
[搜索或选择仓库 / 位置        ▾]

活动
[搜索或选择活动               ▾]


清除全部                [应用筛选]
```

Filters should reuse existing real application components when possible.

The filter panel should eventually be collapsible so users can reclaim horizontal space when advanced filtering is unnecessary.

---

# 9. 明细 page table

The table represents actual item-level stock movements.

Recommended columns:

```text
日期
物品
动作
数量
从
到
关联记录
备注
```

Example:

| 日期 | 物品 | 动作 | 数量 | 从 | 到 | 关联记录 | 备注 |
|---|---|---|---:|---|---|---|---|
| 09-28 14:32 | 白砂糖 50磅袋 | 入库 | +5 Nos | — | A02 / 货架1 | REC-000123 | 王喆媛捐赠 |
| 09-28 14:32 | 面粉 25磅袋 | 入库 | +3 Nos | — | A02 / 货架1 | REC-000123 | 王喆媛捐赠 |
| 09-28 11:06 | Bella Marie 小红鞋 | 转移 | 2 Nos | A04 | C02 | TRF-000081 | 演出前整理 |
| 09-27 16:42 | 一次性口罩 | 出库 | −4 包 | C02 | — | ISS-000047 | 分发活动 |
| 09-27 13:10 | 厨房隔热垫 | 借出 | 3 Nos | A04 | 借出 | LND-000032 | 舞台道具 |
| 09-26 10:15 | 柯达相机 | 归还 | 1 Nos | 借出 | A04 | RTN-000018 | 归还完整 |

## Item cell

Prefer:

```text
[thumbnail] 白砂糖 50磅袋
            ITM-000004
```

Image is secondary but useful for scanning.

## Quantity

Use the actual item's UOM.

Never aggregate incompatible UOMs into a fake total.

Examples:

```text
5 Nos
3 包
2 箱
```

Positive/negative indicators may be used where meaningful:

```text
+5 Nos
-4 包
```

Transfers/loans generally do not need a `+/-` sign because the from/to flow communicates the movement.

## Associated record

`REC-000123`, etc. should be clickable.

Clicking it should open the parent record.

Prefer a right-side detail drawer on desktop if that matches existing app patterns; navigating to a record detail page is also acceptable.

---

# 10. 明细 only contains movements that actually occurred

Draft records must **not** generate movement rows.

Therefore a draft Receive document containing:

```text
白砂糖 +5
面粉 +3
```

should not appear on `明细` until submitted/completed.

Canceled documents should also not be presented as normal active stock movements.

The movement ledger should reflect actual posted stock effects according to backend behavior.

---

# 11. 记录 page filter sidebar

Recommended filters:

```text
筛选

来源位置
[搜索或选择仓库 / 位置        ▾]

去向位置
[搜索或选择仓库 / 位置        ▾]

活动
[搜索或选择活动               ▾]

状态
☑ 已完成
☑ 草稿
☐ 已取消


清除全部                [应用筛选]
```

Do not include movement type here because it is controlled by the chips above the table.

Do not include time range because it belongs in the header.

---

# 12. Record statuses

The records page is the home for all operation records, including:

```text
已完成
草稿
已取消
```

Default filter state:

```text
☑ 已完成
☑ 草稿
☐ 已取消
```

Why:

- Completed records represent actual work.
- Drafts may require user action.
- Canceled records should remain available for history/audit purposes, but should not clutter normal browsing.

Users can explicitly enable `已取消` when needed.

---

# 13. Do not use a permanent 状态 column

Most rows will usually be completed, so this would waste horizontal space:

```text
已完成
已完成
已完成
已完成
```

Instead:

### Completed records

Do not display a status badge.

Example:

```text
REC-000123
```

### Draft

Place a badge near the record/type:

```text
REC-000080  [草稿]
```

### Canceled

Display:

```text
REC-000071  [已取消]
```

Canceled rows may be visually muted.

Do not make them disappear entirely once the user explicitly filters for canceled records.

---

# 14. Optional draft indicator

Because drafts represent unfinished work, the UI may eventually show a small indicator such as:

```text
记录  2
```

where `2` = number of drafts.

Or near the records header:

```text
2 个草稿待完成
```

Clicking it should apply:

```text
status = Draft
```

This is optional for the first implementation.

---

# 15. 记录 table

Recommended columns:

```text
日期
记录编号
类型
物品行数
数量
流向
活动
备注
```

Do NOT include:

```text
负责人
Recorded_by
状态
```

as permanent columns.

Example:

| 日期 | 记录编号 | 类型 | 物品行数 | 数量 | 流向 | 活动 | 备注 |
|---|---|---|---:|---:|---|---|---|
| 09-28 14:32 | REC-000123 | 入库 | 8项 | 43 Nos | → A02 / 货架1 | 中秋活动 | 王喆媛捐赠 |
| 09-28 11:06 | TRF-000081 | 转移 | 3项 | 12 Nos | A04 → C02 | 演出 | 演出服整理 |
| 09-27 16:42 | ISS-000047 | 出库 | 5项 | 16 Nos | C02 → | 分发活动 | 志愿者分发 |
| 09-27 13:10 | LND-000032 | 借出 | 2项 | 6 Nos | A04 → 借出 | 演出 | 道具借出 |
| 09-26 10:15 | RTN-000018 | 归还 | 2项 | 6 Nos | 借出 → A04 | 演出 | 归还完整 |

Draft example:

```text
09-22 09:18
TRF-000080 [草稿]
转移
4项
10 Nos
A02 → C02
整理仓库
待确认后提交
```

---

# 16. Personnel fields

The application has several different concepts that should **not** be flattened into a generic `负责人` field:

```text
经手人
记录人
鉴证人
Recorded_by
```

`经手人 / 记录人 / 鉴证人` are text/domain fields.

`Recorded_by` is an uneditable system-user audit field.

Because there may only be one regular system user submitting records, `Recorded_by` provides little scanning value.

Therefore none of these should be permanent columns on the movement tables.

They belong in the record detail/drawer.

For example:

```text
人员信息
经手人：王某
记录人：李某
鉴证人：张某

系统信息
提交用户：Administrator
```

---

# 17. New record creation

Do **not** place an add button on `明细`.

Reason:

The user does not directly create a “movement line.” Movement lines result from operations/records.

On `记录`, include:

```text
[ + 新增记录 ▾ ]
```

Clicking should expose the available creation flows, e.g.:

```text
入库
出库
转移
借出
归还
盘点调整 / 库存调整 workflow as appropriate
报废
```

Important:

These must reuse the **same existing creation workflows/components** available elsewhere in the app.

Do not implement separate duplicate forms specifically for the records page.

The inventory page may continue having its own creation entry points too.

Multiple entry points are acceptable if they all lead into the same underlying workflows.

---

# 18. No card/list toggle

Do not implement a manual:

```text
卡片 / 列表
```

view switch.

Desktop records should use the table/list layout.

Mobile can naturally transform the same data into stacked rows/cards responsively.

That is a responsive UI concern, not a user-selectable display mode.

---

# 19. Search

### 明细

Placeholder:

```text
搜索物品名称、编码或记录编号…
```

Search should match at least:

- item name
- item code
- parent record ID

### 记录

Placeholder:

```text
搜索记录编号、活动或备注…
```

Search should match relevant record-level fields.

Do not make the search field narrower just to fit unnecessary controls.

---

# 20. Filter button

The header also contains:

```text
[筛选]
```

This toggles/collapses the left filter sidebar.

Possible behavior:

```text
click
→ sidebar opens/closes
```

When filters are active, show an indicator if helpful:

```text
筛选 · 3
```

meaning three advanced filters are active.

Movement chips and date range should **not** count toward this number because they are first-class page controls rather than advanced sidebar filters.

---

# 21. Export

Both pages contain:

```text
[导出]
```

Export should respect the currently applied:

- date range
- movement types
- sidebar filters
- search query

### 明细 export

Export individual movement lines.

### 记录 export

Export operation records.

Do not export only the currently rendered/infinite-scroll portion if the backend can export the full matching filtered result set.

---

# 22. Relationship between 明细 and 记录

The two pages should feel connected.

From `明细`:

```text
关联记录 REC-000123
```

clicking opens the parent record.

From `记录`:

```text
8 项
```

should make it easy to inspect the eight item lines.

Good interaction options include:

- click row → record detail drawer
- click `8 项` → expand/show item lines
- record drawer contains item line list

Avoid forcing users through several pages simply to answer:

> “What items were inside this record?”

---

# 23. Record detail drawer

A desktop drawer might contain:

```text
入库 REC-000123

2026-09-28 14:32

入库位置
第2寺院 / A02 / 货架1

物品
白砂糖 50磅袋       5 Nos
面粉 25磅袋         3 Nos
一次性口罩          10 包

来源
王某捐赠

活动
中秋活动

经手人
...

记录人
...

鉴证人
...

备注
...

系统信息
Recorded_by: Administrator
创建时间: ...
提交时间: ...
```

Draft records may expose an appropriate `继续编辑` action.

Canceled records should remain readable for audit/history purposes.

---

# 24. Summary statistics

Avoid the large dashboard summary cards used by the old design.

If a summary is retained, keep it compact.

For example:

```text
42 个物品行记录

入库 48 Nos
出库 20 Nos
转移 10 Nos
借出 18 Nos
归还 10 Nos
库存调整 -2 Nos
报废 1 Nos
```

However, never combine incompatible units:

Bad:

```text
48 Nos + 5 包 + 2 箱 = 55
```

Good:

```text
入库
48 Nos · 5 包 · 2 箱
```

If this section starts consuming too much vertical space, it should be collapsible or removed. The tables are more important.

---

# 25. Infinite scrolling

The app already uses infinite scrolling.

Retain that behavior unless there is a separate technical reason to change it.

Do not introduce page-number pagination merely because generic table components support it.

---

# 26. Visual priorities

Use the mockup for the visual language:

- existing warm beige background
- existing brown accent
- white/light table surface
- restrained borders
- compact row heights
- small thumbnails
- colored semantic movement badges
- strong table scanability
- minimal unnecessary cards

But prioritize the app's **existing design system/components** over pixel-perfect recreation of generated-image artifacts.

Do not introduce arbitrary icons, controls, or labels just because the generated mockup happens to contain them.

---

# 27. Desktop first

This spec currently describes the **desktop implementation**.

Do not independently invent a mobile layout while implementing this story unless an existing responsive behavior is necessary to prevent breakage.

Mobile exploration can be handled separately.

---

# 28. Core conceptual rules

These rules should guide implementation if any detail is ambiguous:

> **明细 represents actual item-level stock effects.**

> **记录 represents operation documents, including drafts and canceled documents.**

> **Movement type is a fast primary filter, not navigation.**

> **Date range is a first-class header control, not an advanced sidebar filter.**

> **The sidebar is for secondary filtering.**

> **盘点 is a workflow; 库存调整 is a stock movement.**

> **借出 / 归还 should expose business concepts, not the hidden virtual warehouse implementation.**

> **Audit/personnel metadata should not consume table columns unless it has clear scanning value.**

> **The app should reuse existing workflows/components rather than build duplicate implementations.**

> **Data should occupy most of the page; controls should remain compact.**

This should give the agent enough behavioral detail to implement the mockup without having to infer important domain rules from the image alone.