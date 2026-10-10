# 寺院物资 — 首页 / 物资总览
## Product and UX design requirements for implementation agent

**Status:** Approved design direction / implementation brief  
**Scope:** Dashboard (desktop + mobile), global filter UX, contextual drill-through into existing pages  
**Important:** This brief specifies **user-facing behavior and design goals, not an implementation plan**. First inspect the current repository, existing UI/UX decisions, actual data models, screens, filter behavior, and Storybook stories. Reuse existing conventions where practical. Resolve technical approach, component boundaries, queries, routes, and tests from the codebase. If a proposed statistic cannot be supported reliably, identify the gap rather than inventing data.

## 1. Purpose and naming

- The dashboard is a cross-module **overview and operations-awareness page**, not a second Inventory/Movement/Loans search interface.
- Sidebar navigation label: **首页**. Page heading: **物资总览**. Internal English terminology can remain *Dashboard*.
- It brings together current inventory, expiry, movements, outstanding loans, distribution, and actionable reminders; users visit dedicated pages to search, manage, or transact on records.
- Keep existing Inventory/Expiry/Movement page-level contextual counts (e.g. matching items, batches, or records); moving analytical summaries to the dashboard must **not** remove these useful counts.
- Do not add a separate item lookup/scanning tool to the dashboard. The existing Inventory search/scan remains its home.

## 2. Visual structure

- Follow the existing app's typography, colors, spacing, navigation, borders, and component style. Favor clarity, legibility, and meaningful hierarchy over fitting everything above the fold.
- **Vertical scrolling is expected on both desktop and mobile.** Cards and tables should be comfortably sized; avoid overcrowded micro-cards and tiny text.
- Suggested section order (adapt composition responsively):
  1. Compact page header + global filter trigger + visible active-filter summary.
  2. **库存概览** — summary metrics.
  3. **效期概览** — equally useful views of expired and upcoming batches, plus a shortlist.
  4. **货物流动概览 + 最近记录** — closely grouped; side by side where space permits, stacked together on mobile.
  5. **借出中** — one outstanding-loans summary and short, actionable current-loans list.
  6. **提醒事项** — cross-module alerts worth investigating.
  7. **库存分布** — one breakdown visualization with a grouping selector.
- Layout order can be adjusted for readability, but keep Recently Recorded Movements associated with Movement, not Reminders.
- Cards and meaningful summary rows serve as links into their respective detailed pages.
- All mockup numbers, records and dates are illustrative, not validated production totals.

## 3. Global filters: one familiar entry point

- **No permanently exposed row of global filter dropdowns in the dashboard header.** Use one **筛选** trigger.
- On **desktop**, it opens the same *left-hand filter sidebar* pattern used by existing Inventory screens, **immediately next to the main navigation and alongside the dashboard content**. This is a **nonmodal, in-layout sidebar**: it must **not** dim, grey out, blur, mask, or otherwise overlay the dashboard content with a backdrop. Preserve the exact existing Inventory filter-open interaction rather than introducing a modal drawer. On **mobile**, use the application's existing *bottom-sheet/modal* filtering pattern.
- Reuse the existing **hierarchical multiselect 仓库 / 位置 tree** (with expandable parent/child warehouses/rooms/locations, search, and multiselection). **仓库 and 库位 are levels within this one hierarchy**, not two independent global selectors.
- Include the existing hierarchical **物品类别** selection approach, where relevant. Avoid global controls whose meanings do not consistently apply to all dashboard sections.
- Show applied-filter chips or a compact current-scope summary even when the filter panel is closed; allow users to remove/reset active filters readily. In the default state, a concise “全部仓库 · 全部类别” summary is enough.
- Global warehouse and category selection should govern all applicable sections **consistently**; clearly indicate section-specific exceptions and scopes.
- The normal sidebar navigation to another page should open that page with **its own defaults**, not silently retain dashboard-derived filters.

## 4. Drill-through from dashboard to detail pages

- Selecting a summary metric, expiry bucket, loan row, reminder, or relevant recent record navigates to the appropriate dedicated page/view with **the corresponding filters already applied**.
- Carry over applicable global warehouse/category scope and local section scope (e.g. movement period/type or expiry bucket). Destination views visibly identify the active filters and allow adjusting/clearing them.
- By contrast, navigating to those pages through the ordinary app sidebar opens with normal page defaults.
- Preserve existing dedicated-page functionality and established navigation patterns; the dashboard is an entry point, not a replacement for detailed workflows.

## 5. 库存概览

- Four high-level metrics consistent with existing inventory concepts: **可用库存, 库存总计, 借出, 损坏**. Adapt labels to actual product semantics where needed; do not substitute made-up formulas.
- Use meaningful color and emphasis: available/healthy, neutral inventory totals, borrowed/outstanding, damaged/attention.
- Selecting each card opens the relevant detailed view, respecting active global filters.
- The dashboard inventory metrics describe the **current stock snapshot**; a Movement date filter must **not** change them. Do not introduce historical/as-of inventory snapshots solely to serve the dashboard.
- Respect the application's existing UOM representation; do not imply unconverted mixed units are physically equivalent.

## 6. 效期概览: symmetric past and future

- **Already expired** inventory is operationally important: goods can arrive already past their expiration date. Give past and future the **same level of visibility**, not just one big “已过期” tile beside several approaching buckets.
- Present clear, nonoverlapping elapsed-time buckets on **both sides of today** (e.g. 0–30 days, 31–90 days, >90 days past; 0–30 days, 31–90 days, >90 days ahead). Make boundaries and “past” vs “future” unmistakable. Decide how items expiring *today* are classified, and display it consistently.
- Show relevant **batch counts**, not an ambiguous mix of item and batch counts; each tile can drill through to the appropriately filtered Expiry page.
- Include a small **效期批次预览** list with a local switch (e.g. 已过期 / 即将过期). If the list needs a time-range selector, locate it **beside the list heading**, not on the overall section header where it appears to affect all summary buckets.
- Preview a few actionable batches with expiration date, quantity, status, and drill-through. Keep both expired and upcoming previews navigable.
- Current stock relevance and warehouse/category filtering must be respected so historical or empty batches do not inadvertently appear as on-hand stock warnings without clear labeling.

## 7. 货物流动概览 + 最近记录

- The Movement overview has a **section-local time period** control (e.g. 本周 / 本月 / 本年 / custom when supported). This control governs Movement statistics and recent-record preview, **not** current Inventory totals or fixed expiry buckets.
- Cover the existing movement types reflected in the app, including **入库、出库、转移、借出、归还、损坏、遗失、修复、报废、库存调整** and any other applicable supported type; use the existing user-facing taxonomy. If full coverage is too dense, show a compact set with an accessible expansion, not a silently incomplete summary.
- **Every movement type summary must include:**
  - **记录数** — distinct matching movement records.
  - **合计数量** — prominent sum of the numerical quantities of matching detail lines (unitless/unconverted).
  - **单位明细** — subordinate breakdown of that quantity by recorded UOM, e.g. `48 Nos · 3 箱 · 2 包`.
- Visually group **合计数量 + 单位明细** together as one metric with its breakdown, and show **记录数** as a separate, legible metric. Do not treat record count as a quantity unit.
- The unitless sum is a **sum of numerical values, not a physical conversion across UOMs**. Make that semantic distinction consistent.
- Count matching parent records **once**, even when multiple detail lines match filters. Quantity sums and UOM breakdowns use only the matching lines.
- Global warehouse filtering means **movements involving the selected warehouse hierarchy**, whether source or destination; a movement touching it at both ends still counts once. With multiple source/destination warehouses inside one record, evaluate membership **per detail line**, then deduplicate matching parent records.
- On the dedicated Movement page, **retain its existing separate 来源仓库 and 目标仓库 filters**. Do not replace them with the dashboard's “involved warehouse” concept. If needed, support the additional involved-warehouse context without removing existing directional filtering.
- Borrowing/returning can involve a hidden virtual loan warehouse; dashboard summaries should make sense in terms of the relevant physical warehouse/loan provenance, not expose a fake physical location to users.
- Prefer submitted/effective records in operational totals; drafts/cancellations should not silently distort them. Reflect supported user-facing status behavior.
- **最近记录 belongs immediately next to / below the Movement section** with 3–5 recent entries and links to records/filtered views.

## 8. 借出中

- **One** summary section/card for **currently outstanding loans**. Do **not** create separate dashboard metric cards for 逾期未还, 今日归还, etc.
- Use the same understandable metric structure as Movement:
  - **未归还记录数** (count of distinct loan records with remaining outstanding quantity).
  - **尚未归还数量** (prominent unitless numerical total of what remains on loan).
  - **单位明细** immediately under that total, grouped by UOM.
- A partial return reduces outstanding quantity; a loan no longer outstanding should not count as an active loan. Avoid counting loan events as though they were outstanding records.
- Include a **shortlist of around 3–5 current loan items/records** that is useful at a glance: overdue/attention-needed first when known, then other outstanding loans. Show item, borrower/context, outstanding quantity, due status if available, and drill-through.
- Dedicated **借用** pages remain responsible for full details, searching, and loan/return workflows. Do not duplicate them on the dashboard.
- Global warehouse filters should be interpreted against relevant physical warehouse/loan ownership or provenance despite any hidden virtual loan warehouse.

## 9. 提醒事项

- **Keep** a visible dedicated Reminders section. It combines relevant actionable signals across modules (e.g. expired batches, near-expiry batches, overdue loans, unresolved damaged/lost items) where supported by real data.
- Use meaningful severity cues (critical vs warning vs informational), not arbitrary decorative rainbow coding.
- Each reminder links to a detail page with appropriate filters. Avoid repeating entire long lists already available in the corresponding modules.

## 10. 库存分布

- Keep **one distribution card/chart**, not two charts always displayed.
- A local selector switches between **按仓库** and **按类别** (use 类别, the app's existing wording; **not 按物品组**).
- The visualization must respond to **global warehouse/category filters**.
- **按仓库: show the immediate child level of the selected warehouse hierarchy**, rather than always showing a fixed warehouse list:
  - No warehouse selected → top-level warehouses (e.g. 第1寺院 / 第2寺院).
  - 第2寺院 selected → its direct children (e.g. A02 / A04 / A14 …).
  - A room/location selected → its immediate children, if any.
  - Multiple selections → represent the selected scope coherently without double-counting parent/child selections or pretending there is only one selected branch.
- **按类别:** apply the analogous current-scope / next-level principle to the item category hierarchy where possible.
- For leaf selections, sparse results, or no deeper subgroups, provide a useful truthful state rather than a misleading single-slice comparison.
- Make the **aggregation basis** clear (e.g. distinct item count vs comparable quantity) and remain honest about mixed units. A bar breakdown was preferred in prior explorations; other visuals are acceptable only if they preserve legibility and hierarchy.
- Clicking a breakdown entry should open the corresponding detail page or update the relevant dashboard scope in an understandable way.

## 11. Desktop and mobile behavior

- **Desktop:** existing left main nav with 首页 selected, compact active scope; filter sidebar opens **between the main navigation and main content**, using the existing nonmodal sidebar behavior. **The main content stays visible at normal brightness with no backdrop or grey-out**. Generous summary cards, related sections grouped spatially, page scrolls.
- **Mobile:** existing bottom navigation with 首页 selected; single 筛选 entry opens a **bottom sheet**, not a full-time second filter row. The warehouse tree remains usable within the sheet. Active filters are easy to see/clear. Cards can stack or use comfortable 2-column layouts; tables become compact previews rather than unreadable miniature desktop grids.
- Filter-open and filter-closed states should preserve dashboard context and avoid surprising loss of scroll/selection.
- Reuse existing accessible interaction patterns; text labels and colors should remain distinguishable at small sizes.

## 12. Quality and review checklist

- [ ] Nav says 首页; heading says 物资总览.
- [ ] Dashboard is visibly scrollable and not excessively dense.
- [ ] Desktop global filters use existing **nonmodal left sidebar next to main nav, without dimming the dashboard**; mobile uses **bottom sheet**.
- [ ] Warehouse/locations share one multilevel multiselect tree; category follows current taxonomy.
- [ ] Active global selections remain visible when filter panel is closed.
- [ ] Applicable global filters propagate to stats; local Movement/Expiry controls do not unexpectedly change unrelated sections.
- [ ] Inventory overview, symmetric expiry groups, Movement + adjacent recent records, outstanding loans, reminders, and single distribution card all exist.
- [ ] Movement shows separate **record counts** and **unitless quantity with UOM breakdown**, for supported types.
- [ ] Multi-endpoint / multi-line movement filtering counts records once and sums matching lines only.
- [ ] Existing Movement source/destination filters are preserved.
- [ ] Loan figures represent **outstanding** balances (including partial returns), with a short useful shortlist.
- [ ] Warehouse distribution drills down one level from selected hierarchy; category mode uses **类别**.
- [ ] Dashboard drill-through applies matching filters; ordinary sidebar navigation uses destination defaults.
- [ ] Individual pages retain their compact contextual counts and existing search/scan workflows.
- [ ] No invented live records, unsupported calculations, or misleading cross-UOM conversions.

## 13. Handoff expectations for the agent

1. **Review the latest repository** and relevant UI/UX decisions before proposing changes. Determine what functionality and filter components already exist.
2. Point out inconsistencies between these UX goals and the present code/data and suggest narrowly scoped product decisions where needed.
3. Explore desktop and mobile **default + filters-open** states in the project's existing UI exploration/story workflow before integrating them into the main app, if that is consistent with current development practice. In mockup images, show **only the application UI**; put goals, implementation notes, annotations, and acceptance criteria **in this Markdown document**, never in the image itself.
4. Implement the agreed experience using the repository's current architecture, patterns, and validations; the **agent chooses implementation details**.
5. Report which goals are achieved, which require additional data/model support, and which remain open questions. Preserve unrelated workflows.
