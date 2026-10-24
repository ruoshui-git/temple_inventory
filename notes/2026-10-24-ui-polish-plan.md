# Temple Inventory: UI polish, seed data and consistency pass

## Context

You listed 14 problems after using the app on a 1920×1080 desktop and on a phone. I reproduced each one in the live app (`development.localhost`, desktop 1840×940 and phone 390×844) and traced it to code. Evidence screenshots are in `notes/evidence/2026-10-24-ui-polish/` (baseline captures).

The aims are:
- seed data that looks like a real temple store, with stock spread across locations and most items pictured;
- popups that behave and stay in the viewport;
- one icon per movement kind;
- denser mobile headers;
- clear signals wherever a list or table is partial or scrolls.

**Done already:** I killed the stale Claude session (PID 471713) and its Playwright MCP tree.
- PID 4121 is an old codex-companion shell. It is the parent of the live `bench serve --port 8000`, so I kept it.
- The `<defunct>` entries are zombies owned by PID 1. They hold no memory and cannot be killed.

Durable decisions will be recorded in `UI_UX_DECISIONS.md` as a dated supersession for 2026-10-24, and visual contracts in `DESIGN_SYSTEM.md`.

---

## A. Root causes found (what is broken and why)

| # | Symptom | Root cause |
|---|---|---|
| 3, 5.3 | Menus never close on an outside click, and the split menu pushes the page wider | The split button, ⋯, editor ⋯, category ⋯, warehouse 更多 and dashboard 更多 menus are all native `<details>`, with no outside-click handling. `styles/browse.css:1616` has `inline-end: 0`, which is not a CSS property, so the menu hangs from the chevron's left edge and grows rightward. Nothing clips it. No shared popup primitive exists. |
| 2.1 | Warehouse dropdown opens far from its input | `SearchSelect.vue:292-306` uses `position:absolute; top:100%` of the whole field root. In the receive empty state the root is taller than the input, so the list opens **134px below** the input. It also has no flip, so the list ran ~1000px past the viewport bottom. |
| 4 | Reports top-right 导出 does nothing | `ReportsView.vue:166` emits `openExport`, which routes to the Reports page you are already on. Only the ⋯ menu's `QuickExport` sets `open = true`. |
| 5.2 | 数量 column cut off on the grouped Item view | Grouped tables switch to `width:max-content` (`data-table.css:133-136`). The group summary is a nowrap line of every kind×unit (`OperationBrowseView.vue:569-590`), capped only at 24rem. Measured: the 数量 column is 408px wide and the table overflows by 270px, which hides 状态 and 原借出. There is no overflow cue at all. |
| 6.1.1 | Unexplained "0" | The axis-minimum label `<span>0</span>` at `DashboardView.vue:287`. |
| 6.2 | Expiry list looks complete | The backend keeps the top 5 per side (`browse.py:371-387`) and the UI never says so. Row clicks also drill to *all* batches, not the expired/upcoming subset. |
| 7.2 | 外部 looks like export | It **is** the same glyph. `outward`, `receive` and `download` share one path in `InventoryIcon.vue`. So 入库, 外部, 报表 (nav) and 导出 all render the same icon. |
| 7.1 | Kind icons inconsistent | There is no kind→icon map. 出库/调拨/损坏/遗失/修复/报废 all use ⇄ in the create menus. 借出 and 归还 share one glyph. `trash` is missing from the registry and silently renders `box`. Dashboard quick actions have no icons. |
| 11 | No return-to-top on mobile | `:hidden="isMobile && filtersOpen"`. `filtersOpen` is the **desktop sidebar preference**, which is persisted, and Stock defaults it to open. On a phone the sidebar never renders, yet the button stays hidden for good. It is also not mounted on Reports, Drafts, Pending, Warehouses or Activities. |
| 1.1 | Stock sits in 3 places | Seed code only targets `DEMO_A` (the A02 direct leaf), `DEMO_SHELF` (货架1) and `DEMO_B` (A04) (`native_samples.py:131-144`, `:1066`, `:1107-1155`). The DS and EV areas (36 locations), T1, 106, 201 and the other T2 rooms never get stock. |
| 1.2 | Few images | 157 of ~600 items have images. The 436 generated items (`日常/厨房/法会物资 NNNN`), 僧帽, 海青, 居士服 and the 4 EXTRA items have none. |
| 10 | Misaligned table | The most visible case is the **warehouse detail item table**, a raw `<table>` in `NativeWarehousesView.vue`. The 物品 heading sits over the thumbnails while names start 38px to the right, the 库位 heading wraps to two lines, and ITM codes break at the hyphen. The text-geometry audit found only small, systematic offsets elsewhere (6–13px link/badge padding, plus the by-design group-identity indent). |

---

## B. Implementation plan

### Phase 1: Shared popup primitive (fixes 2.1, 3, 5.3 everywhere)

New `components/ui/PopupMenu.vue` and `composables/useAnchoredPopup.ts`:
- **Rendering and placement:** teleported to `body` and positioned `fixed` from the anchor rect. Opens below the anchor, flips above when there is more room, and is clamped horizontally to the viewport minus 8px. Supports `align: start | end`. Repositions on scroll and resize.
- **Dismissal:** closes on an outside `pointerdown`, on Escape (focus returns to the trigger), on route change and on item activation.
- **Menu semantics:** `role="menu"` with arrow-key, Home and End navigation.
- **Placement logic:** generalize the existing `lib/filterPopoverPlacement.ts` instead of adding a dependency. It already flips and clamps.

Convert to it:
- `BrowseSplitButton.vue` and `BrowseOverflowMenu.vue`, which covers Movements, Loans, Stock, Drafts, Expiry, Activities and Reports;
- the editor ⋯ (`OperationEditorView.vue:306`), category ⋯ (`CategoriesPage.vue:89`), warehouse 更多 (`NativeWarehousesView.vue:252`) and dashboard 更多 (`DashboardView.vue:204`).

Also:
- `SearchSelect`: anchor the listbox to the **input**, not the field root, using the same placement (teleport, flip, max-height bounded by viewport space).
- `PeriodFilter` and `NotificationCenter`: add the same reposition and outside-click behavior.
- Delete the dead `.action-menu`, `.menu-popover` and `.current-fab .menu-popover` CSS.
- Unify overflow triggers to the `more` icon button. Today some are text "⋯" and some are "更多 ▾".

### Phase 2: Icons (7.1, 7.2)

- Add `lib/kindIcons.ts` as the single map from movement kind (and Count) to icon, label and tone. Every kind surface uses it:
  - dashboard quick actions and 更多;
  - split and create menus (`OperationBrowseView`, `NativeRecordsView`, `ReportsView`, `useStockBrowseController`);
  - the Pending actions;
  - `notifications/model.ts`, `RecordRef`, `LocationEndpoint`;
  - the kind filter options and chips;
  - drafts rows, editor headers and More tiles.
- Add distinct glyphs to `InventoryIcon.vue`, drawn from Lucide (ISC license, same 24×24 stroke format):

  | Meaning | Icon |
  |---|---|
  | 入库 | package with arrow in |
  | 出库 | package with arrow out |
  | 调拨 | ⇄ |
  | 借出 | arrow up-right from hand |
  | 归还 | undo arrow |
  | 损坏 | cracked/x package |
  | 遗失 | search-x |
  | 修复 | wrench |
  | 报废 | trash |
  | 盘点调整 | clipboard-check |
  | **外部** | door-open (outside the store) |
  | 导出 | file-down |
  | 报表 (nav) | bar chart |

  Remove the duplicate path aliases (`outward`/`receive`/`download`, `movement`/`transfer`, `loan`/`return`, `adjust`/`settings`/`count`). A unit test asserts that every registry path is unique and every name used in `src/` exists.
- **Button audit:** add missing icons where siblings have them:
  - Reports 导出;
  - Dashboard 刷新 and Drafts 刷新 (refresh icon);
  - Movements 按物品/按记录 (to match Stock's 卡片/列表);
  - notification 下载 and 打开报表;
  - Pending 物品详情;
  - warehouse "入库到此库位".
- Unify label drift: 修复 vs 修复归库, and 库存调整 vs 盘点调整. Which wording wins is proposal P7 below.

### Phase 3: Browse page fixes (4, 5.1, 5.2, 11)

**Reports export (4).** The top-right 导出 (now with an icon) opens the QuickExport dialog directly. The ⋯ menu drops its duplicate 导出 entry, and the ⋯ menu is hidden when empty.

**Sidebar toggle (5.1, desktop).** Remove the second funnel icon from the toolbar. The rail itself owns collapse, mirroring the existing editor preview rail contract (`DESIGN_SYSTEM.md:255`):
- Open: a "‹" collapse button pinned at the top-right of the rail, with the tooltip 收起筛选侧栏.
- Collapsed: a 28px edge rail at the left of the results, showing a chevron and a vertical `筛选` label, plus an active-filter count dot.
- Phones are unchanged; the sidebar is desktop-only.

**Wide quantity column (5.2).**
- Group summaries follow the existing "up to two values inline, then `+N`" rule (`DESIGN_SYSTEM.md:142`). They show the top two kinds by quantity, then `+N 项`, and the full breakdown appears in a tooltip and in the expanded rows.
- Cap the quantity column at about 16rem.
- Drop the `max-content` switch for grouped tables, so the table fills its frame and only scrolls when the columns genuinely need it.

**Overflow cue (5.2.1).** Add `is-overflow-start` and `is-overflow-end` classes to `.data-table-scroll`, measured with a ResizeObserver plus the scroll position. They render soft edge shadows inside the frame, plus a small "→ 更多列" pill at the right of the header row that scrolls right when clicked.
- This applies to `DataTable` and `ReportTable`.
- It also makes shift-free wheel scrolling discoverable.

**Return-to-top (11).**
- Hide it only while the **mobile filter sheet** is open (the FilterPanel overlay state), not when the desktop sidebar preference is set.
- Mount it on Reports, Drafts, Pending, Warehouses and Activities.
- Fix the dashboard overlap by giving it a bottom inset for the measured obstruction.

### Phase 4: Mobile header, sort and stock subpages (8, 9, 12)

**Header (8).** My recommendation is no manual collapse button. Make the default header compact instead (target ≈170px, down from ≈430–500px today), with only the search row sticky once you scroll:
1. Hide the breadcrumb on the six top-level destinations, since the bottom nav already shows where you are. Deeper pages keep the breadcrumb and back button.
2. Row 1: title (22px), the view segmented control, and ⋯ on the right.
3. Row 2 (sticky): the search field with scan and the filter button showing its count badge. Applied chips become a single horizontally scrolling strip instead of wrapping inside the field.
4. The primary create action becomes a mobile FAB (icon + short label, e.g. "＋ 入库") above the bottom nav. Its kind menu opens as a bottom sheet, and return-to-top stacks above it.
5. Sort and 分析结果 move into the results summary line (see item 9). Stock desktop gets the same merge: 卡片/列表 and 分析结果 join the summary line instead of taking their own row.

**Sort (9).** Replace the label + `<select>` + "↑ 升序" row with a single sort chip in the results summary line, e.g. `⇅ 物品名称 A→Z`.
- It opens a bottom sheet on phones and the new PopupMenu on desktop.
- The options are a radio list with **meaningful direction text** per field type, e.g. 名称 A→Z/Z→A, 日期 最新优先/最早优先, 数量 从多到少/从少到多, so you never need a separate direction toggle.
- Desktop tables keep header sorting, as the existing rule requires.
- This also fixes the current accessible-name mismatch.

**Stock subpages on mobile (12).** The four subpage links get no styling today: the CSS targets `button` and the links are `<a>`. Render them as a full-width underline tab bar (库存 · 效期 · 仓库 · 损坏) directly under the top bar. It gets a clear active indicator, 44px targets, and scrolls horizontally at large text sizes.

### Phase 5: Cards and images (13)

**Guidelines.** Material 3 and Apple HIG both favor dense lists with small leading thumbnails (56–72px) for scannable, data-heavy collections. Image-led grids on phones are typically **2 columns** with square art (~160–180px at 390px wide), never one full-width square. Today one stock card is a 366px square, about 43% of the screen, so a phone shows about one item per screen.

**Proposal:**
- **Phones:** default to a **list** layout, with a 64px thumbnail, name and code, and quantities on the right. Phones also get the 卡片/列表 toggle (today they are forced into cards). The card layout becomes a 2-column grid of `minmax(150px, 1fr)` squares. Apply the same list-row pattern to the mobile Movement and Loan item cards, whose names currently squeeze into a narrow column beside a ~100px image.
- **Desktop:** keep the 1:1 contain cards. Reduce the balanced preferred width from 225px to 200px (compact 160, spacious 280), which gives about 6 columns at 1920.

### Phase 6: Dashboard (6)

- **库存分布 (6.1.1):** remove the axis row, since every bar already carries its value. Bars are sorted descending.
- **Empty locations (6.1.2):** my recommendation is to **omit empty locations but say so**.
  - Show the top 8 locations, then a `其余 N 个位置` disclosure.
  - Then a quiet footer: `另有 M 个位置当前无可用库存`. It expands to list them muted, with `0`.
  - The backend returns `empty_count` and `empty_labels` for authorized physical storable leaves in scope.
  - Category mode labels the blank category `无分类`.
- **Expiry list (6.2):**
  - A caption under the tabs reads `最早到期的 5 个批次 · 共 N 个`, where N is the matching bucket sum. A `查看全部 N 个` link sits after the list.
  - Row and caption links drill with the expired or upcoming window.
- **Quick actions:** use the kind icons from Phase 2.

### Phase 7: Seed data (1)

**Distribution (1.1)**, in `native_samples.py`:
- Build a category→location affinity pool from the full hierarchy. For example:

  | Category | Locations |
  |---|---|
  | 食品 | 厨房 冷藏柜上/下层, 干货架A–D |
  | 餐具 | 餐具间 |
  | 佛事 | 大殿 供桌柜 1–3, 经书柜 格1–6 |
  | 节日装饰 | 法物流通处, EV tents |
  | 工具/园艺 | T1 106/201, C06/C07 |
  | 电子 | A07, A14 |
  | Everything else | B01b, TMP |

- Opening stock for each general and generated item goes into 1–3 affinity leaves.
- The generator tracks balances per item and warehouse, so issues, loans, damage and loss draw only from leaves that hold stock, transfers move between real leaves, and returns and repairs land back at plausible leaves.
- Never target the disabled 旧仓库.
- Keep the costume data (a mirror of real records) in A02, as its tests and verifier expect. Keep the hand-written workflow and its `N-WORKFLOW` balance assertions unchanged. Keep `DEMO_A`/`DEMO_SHELF` for counts.

**Images (1.2):**
- Replace the generic generated names with realistic per-group vocabularies, about 60 base products. Examples:
  - 厨房: 不锈钢汤锅, 砧板, 电饭煲, 蒸笼 …
  - 日常: 扫帚, 拖把, 垃圾袋, 抽纸, 洗洁精 …
  - 法会: 香炉, 烛台, 供杯, 蒲团, 木鱼, 引磬, 经幡, 莲花灯 …
- Create variants with spec suffixes (`28cm`, `黄色`, `大号`). Keep every 7th name long, for layout testing.
- Each base product gets **one** image shared by its variants. Frappe's File content-hash dedup (`file.py:844-858`) stores the bytes once.
- Also add images for 僧帽, 海青, 居士服 and three of the EXTRA items. N-ZERO stays imageless, to keep a missing-image example.
- **Source:** Wikimedia Commons / Openverse, CC0 or public domain first, then CC BY or CC BY-SA. Record the source URL, author and license per file in `setup/sample_assets/images/CREDITS.json`.
- **Optimize** with the existing `setup/optimize_images.py`, extended for this set: square crop, WebP q80, max edge 800 (matching the app's crop cap). Budget about 60 × 40KB ≈ 2.5MB. The manifest gets sha256 and dimensions.
- Coverage goes from about 26% to about 98% of items.
- Fix the costume README, which wrongly says A04.

### Phase 8: Misalignment fix (10)

- Rebuild the warehouse detail item table on `DataTable`, with a centered image column, `ItemLine`, nowrap codes and a right-aligned quantity.
- While there, verify the `OperationLines` allocation grid header. It only aligns if every row has exactly five direct children.

---

## C. Proposals for item 14 (approve or deny each)

- **P1:** Stock and Pending put the filter sidebar inside the white result card, while Movements, Loans and Reports put it outside. Unify on *outside* (a flat rail aligned with the results top, per the design system).
- **P2:** Unify tab styles. 库存分布 uses filled pills, 效期 uses outlined tabs, and page views use a segmented control. Use the segmented control for in-card tabs.
- **P3:** The Damaged page shows 4 buttons per row, including a filled primary 修复归库 on every row. Make 修复归库 and 报废 secondary, and move 物品详情 and 导出 into a row ⋯. Remove the separate "28 条存放明细 · 分析结果" row by merging it into the summary line.
- **P4:** The Warehouses page header differs from every other browse page (search on its own row, `45 个节点`). Move it to `BrowseToolbar`. Shrink desktop tree icon tiles from 44px to 28px, per the design system's 28–32px desktop rows.
- ~~**P5:** Seed units 个/件~~. **Denied.** Keep `Nos` to match production. A single count unit keeps cross-item totals whole, because quantities are never summed across units.

**Approved:** P1, P2, P3, P4, P6, P7, P8. Implementation is sequential: one Codex task at a time, per `AGENTS.md`.
- **P6:** The `发现新版本，可以更新` banner is a full-width block at the end of every page. Make it a dismissible toast with the same 更新 action.
- **P7:** Labels: use **修复归库** for the Repair kind everywhere (it is clearer than 修复), and **盘点调整** for count adjustments everywhere (replacing 库存调整).
- **P8:** On the dashboard 货物流动 card, the per-kind tiles show tall ragged unit lists. Apply the same "two values + `+N`" rule.

---

## D. Execution

**Decisions (2026-10-24):** Compact mobile header with a FAB. Phones default to list rows, with 2-column cards as the alternative. Images come from Wikimedia/Openverse with CREDITS. **Codex Luna implements** through `scripts/codex-run`, one phase per brief, never two at once. Claude writes each brief (plan section, files, tests, required screenshots), then reviews the diff, reruns validation through `scripts/heavy`, opens every screenshot, and sends fixes back with `--resume`.

The work will be sequential commits, one per phase, on a new branch from `main` (`feat/ui-consistency-pass`).

Each phase:
1. Format with Prettier; Python with pinned Ruff.
2. Run the affected vitest files, then `pnpm type-check`.
3. Do browser verification through `scripts/ui-visual-preflight` at 1840, 1280 and 1024px, and 390px phone width, in all three densities. Save evidence under `notes/evidence/2026-10-24-ui-consistency/`.

After the final phase, each run once through `scripts/heavy`:
- `pnpm test` and `pnpm build`;
- the backend suite `test_native_inventory.run`;
- `reset-development-samples` (seed changed), then `verify_development_sample`;
- the live acceptance suite (Phases 3, 6 and 7 touch APIs: the dashboard card payload and seed).

New tests:
- `PopupMenu`: flip, clamp, outside click, Escape and focus return;
- the icon registry: unique paths, no missing names;
- the `ReturnToTop` hidden rule;
- the Reports 导出 opening the dialog;
- the group summary `+N`;
- the dashboard empty-location count;
- seed distribution: at least 15 distinct stocked leaves, no stock in disabled leaves, and image coverage of at least 90%.

## E. Critical files

- **Frontend shared:**
  - `frontend/src/components/ui/`: `BrowseSplitButton.vue`, `BrowseOverflowMenu.vue`, `SearchSelect.vue`, `DataTable.vue`, `ReportTable.vue`, `SortControl.vue`, `ReturnToTop.vue`, `BrowseToolbar.vue`, `FilterPanel.vue`, `PeriodFilter.vue`, `LocationEndpoint.vue`, `RecordRef.vue`
  - `frontend/src/components/InventoryIcon.vue`
  - `frontend/src/lib/filterPopoverPlacement.ts`
  - `frontend/src/styles/{browse,data-table,foundation,forms}.css`
- **Features:**
  - `features/movements/OperationBrowseView.vue`
  - `features/inventory/{StockBrowseView.vue,useStockBrowseController.ts}`
  - `features/export/ReportsView.vue`
  - `features/dashboard/{DashboardView.vue,useDashboardController.ts}`
  - `features/warehouses/NativeWarehousesView.vue`
  - `features/pending/PendingView.vue`
  - `features/notifications/model.ts`
  - `components/ApplicationShell.vue`
- **Backend:**
  - `temple_inventory/browse.py` (distribution `empty_count`, expiry totals)
  - `temple_inventory/native_samples.py`
  - `temple_inventory/sample_install.py`
  - `temple_inventory/setup/{optimize_images.py,sample_assets/}`
- **Docs:** `UI_UX_DECISIONS.md`, `DESIGN_SYSTEM.md`
