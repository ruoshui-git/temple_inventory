# Creation-form audit (2026-10-23)

## All movement editors (shared)
1. Header subtitle is the same generic sentence for every kind ("核对物品、数量、批次与库位，复核后确认。"). Use a kind-specific one-liner (入库: 登记新到物资及其存放位置; 出库: 从现有库存领用/发出; 调拨: 在库位之间移动 …).
2. Date field shown while 时间方式 = 确认时的当前时间 (date ignored/redundant). Show date (+time) only for 指定时间; otherwise a compact "确认时自动记录当前时间" with a change link.
3. Zero-line noise: 搜索明细, 仅看待完善, `0 处待完善 · 下一个`, `0 种物品 · 0 条明细`, the column header row and "选择库位后添加物品。" all render with no lines. Hide until lines exist; empty state = a single centered call to action (添加物品 / 扫码) with a kind-specific hint.
4. Empty-state text "选择库位后添加物品。" is wrong for kinds without a location step (出库, 调拨, 损坏, 遗失…).
5. Sticky action bar (保存草稿 / 复核并确认) floats over content with no top divider/elevation, so it reads as part of the lines; give it a hairline + subtle shadow when stuck. 删除草稿单据 sits right next to the primary action; move it into a secondary/overflow position. Large empty padding below 补充记录 inside the card.
6. Preview rail shows a large "尚未添加物品" card when empty; collapse to a one-line empty summary.
7. "操作物资" helper text "按库位 → 物品 → 批次明细填写，数量由明细合计。" is implementation language.
8. Native file inputs render English "Choose Files / No file chosen". Replace with a styled 添加附件 button + file list (also in 新建物品 主图/附件).
9. Lines table 库位 column on 入库 repeats the single receiving location.

## 入库
10. 入库位置 defaults to an arbitrary leaf (冷藏柜 / 上层). Remember the account's last receiving location; with none, require an explicit choice before adding items.
11. (Fixed in Phase 1 follow-up: picker paging regression.)

## 借出
12. 借出存放库位 is a fixed system location shown as an editable field with a clear button. Hide it.
13. 借用人 / 团体 is free text; suggest previous borrowers (autocomplete) to keep names consistent for reporting.

## 归还
14. Starts with a search box + disabled "加入此借用" button that looks like an empty input; orphan "· 未填写" text under it. Better: list outstanding loans directly (grouped by borrower: borrower, loan date, activity, outstanding items with thumbnails and quantities), filterable, each with 加入; selected loans shown as RecordRef chips.
15. Lines search toolbar visible before any loan is chosen.

## 调拨
16. No destination step before adding items; transfers usually move several items to one destination. Add a compact 调入位置 selector in the lines toolbar (like 入库位置), excluding each line's source; per-line override stays possible.

## 盘点
17. Error state and "此范围没有库存行。" empty state shown together (violates initial-error vs empty rule).
18. 返回 is a bordered button here but a plain link on movement editors; align.

## 新建物品
19. Field order: name first; code auto-generated (ITM-######) can be a secondary editable field.
20. Primary image at the bottom; it is key for identification → place beside name/category.
21. Decision (user, 2026-10-23): real data uses ERPNext `Nos` for pieces and users learn it. The seed must not create a separate `个` unit; generated items that used `个` use `Nos`.
22. 新建分类 is a button, 新建单位 is a link: align.

## Lines and preview (seen with items added)
23. Saved-draft status row repeats itself: `草稿单据 MAT-STE-… · 已存为草稿单据 · 草稿` badge. Show one plain status plus the document name (per the pristine/status decision).
24. Group header (e.g. `A02`) above lines and every line's 库位 field repeat the same location.
25. Preview rail is too narrow at 1440px: location label wraps per character (`A0 / 2`), `3 种物品` pill wraps, quantities wrap to `· 1 / Nos`, and a horizontal scrollbar appears. Widen the rail or reflow its rows.
26. 调拨 lines show source and destination fields stacked with no 从/到 labels, and every destination defaults to the same arbitrary leaf (冷藏柜 / 上层). Add explicit labels/arrow and no arbitrary default (toolbar 调入位置 from finding 16, remembered per account).
27. Outbound picker: 981 rows sorted by name; for batch items no expiry/batch hint to support FEFO; `仅有可用库存` filter is redundant for outbound/damaged (rows are already stock-only); unit shown both under the name and in the quantity; name column narrow and wraps while 编号 and 类别 take space (make 类别 optional/hidden by default, give names room).
28. An editor header `导出` button on a draft movement is low value; move it to an overflow menu.

## Not audited live

- 归还 with a selected loan; scan flows; phone 390px pass.
