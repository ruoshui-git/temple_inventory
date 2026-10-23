# Notifications, data clarity, density and seed-data plan (2026-10-23)

Approved by the user on 2026-10-23. Branch: `feat/notifications-density-audit`.
Phases run in order; each phase is one or more Codex tasks plus Claude verification
and a commit. No compatibility shims: reset rebuilds the site from scratch.

## Decisions

### Seed data (Phase 1)

- Split seeding into two installers selected by the reset script:
  `--data real` (location tree + real costume catalog, images, attachments and
  costume opening stock) and `--data full` (real + generated test volume; the
  default for development.localhost).
- No sample marking anywhere. Test data uses natural names and native IDs:
  Item codes from the normal `ITM-######` series, native Batch naming, native
  `MAT-STE-`/`MAT-RECO-` series, plain category names, activities without a
  `样例：` prefix. Test users have realistic Chinese names and `@example.com`
  emails. Remove `TI-SAMPLE-`/`ITEM_PREFIX`-based identification and checks.
- 第2寺院 and the costume catalog are real data, not samples.
- All frontend users have full access (System Manager). No restricted sample user.
- Test volume: about 600 Items across about 10 UOMs (个/双/套/箱/包/瓶/升/米/张/Kg,
  existing ERPNext UOM records reused where they exist), with UOM conversions
  (e.g. 箱 = 12 个), whole and fractional quantities, batch-tracked items with
  expiry spread, Items with long names, uncategorized Items, Items without images.
  About 1,500 submitted movements over 18 months covering every kind (Receive,
  Issue, Transfer, Loan, Return, Damage, Loss, Repair, Disposal), created by
  4-5 different users, plus native drafts, cancelled and amended documents,
  partially returned loans, a damaged backlog, about 20 counts and about 25
  activities. Test movements may touch real locations; they must not move real
  costume stock below zero.
- Location tree under 实体库房 (label, short label):

  ```
  第1寺院 (T1)                Area
  ├─ 106                       Room
  └─ 201                       Room
  第2寺院 (T2)                Area
  ├─ A02                       Room
  │  ├─ 货架1 (S1)             Shelf
  │  └─ 货架2 (S2)             Shelf
  ├─ A04, A07, A14, B01b, C06, C07   Rooms
  └─ 临时存放 (TMP)            Room
  东山寺区 (DS)               Area                       [full only]
  ├─ 斋堂 (ZT)                 Area nested in Area
  │  ├─ 厨房                   Room (direct storage + shelves)
  │  │  ├─ 冷藏柜              Shelf subdivided into 上层 / 下层
  │  │  └─ 干货架A–D           Shelves
  │  └─ 餐具间                 Room, direct storage only
  ├─ 大殿                      Room
  │  ├─ 供桌柜1–3              Shelves
  │  └─ 经书柜                 Shelf subdivided into 第1格–第6格
  ├─ 法物流通处临时周转货架（节庆期间使用）   Room (long name)
  └─ 旧仓库                    Room, disabled
  活动现场 (EV)               Area                       [full only]
  └─ 广场帐篷A / 广场帐篷B     Rooms
  ```

  T1 and T2 subtrees belong to the real installer; DS and EV to the full one.
- Model change: a `系统位置` group Warehouse under the configured root holds the
  loan (`借出`) and damaged (`损坏待处理`) leaves. Add a settings pointer for it.
  Display/filter trees render the real hierarchy generically; loan/damage
  behavior stays keyed to the leased/damaged pointers; physical count scope stays
  under 实体库房.

### Creation forms (Phase 2)

Audit every creation flow (入库、出库、调拨、借出、归还、损坏、遗失、修复、报废、盘点、
新建物品) at desktop and phone. Show what is needed for the decision at that step,
hide the rest. Known issues: misleading outbound empty state ("选择库位后添加物品"),
date field visible while time mode is "确认时的当前时间", zero-line toolbar noise
(line search, 仅看待完善, 待完善 navigator), redundant "仅有可用库存" filter in
outbound/damaged pickers, duplicated unit text and narrow wrapping names in the
picker, no batch/expiry hint for outbound batch items. Outbound-type pickers list
only rows with stock (already server-enforced; keep it so).

### Data clarity (Phase 3)

- Shared record-reference chip for every cross-document link: kind icon, kind
  label, readable identity (e.g. borrower + date) or count, status, document ID as
  secondary text.
- Labeled fields instead of `·` chains when values are of different types.
- One shared item line with the compact thumbnail + existing lightbox wherever an
  Item appears.
- Related-loan control: column heading `原借出`; one loan → chip with loan icon
  `演出团队 · 10-02`; several → `2 笔借出`; tooltip `查看原借出记录`; dialog title
  `原借出记录 · 只读`; cards with labeled fields, thumbnail strip, status; detail
  table thumbnail · 物品 · 借出 · 完好归还 · 损坏 · 遗失 · 未结清 · 来源→去向; 备注 label.
- Endpoint presentation: real locations plain primary text. System locations
  `借出` (loan icon) and `损坏待处理` (warning icon) in muted text, no borrower in
  the cell (borrower in tooltip; it has its own column). Every non-location end is
  muted `外部` with an outward icon; tooltip per kind: 入库 来自库外, 出库 离开库存,
  遗失 不再计入库存, 报废 已报废处理. Exports keep raw values.
- Remove frontend permission/capability gating (all app users are System
  Managers). Keep configuration-readiness checks (e.g. Transfer needs two
  physical leaves) and document-state rules. Server native checks stay unchanged.
- Other known spots: warehouse detail stock list, scan result panel, editor review
  panel (AllocationSummary/AllocationDetails), drafts RecoverySummary, movement
  records `外部`, Loans 按物品 group summary floating mid-row, dashboard scope
  summary.

### Notifications (Phase 4)

- Store/inbox: Frappe `Notification Log` (shared with the Desk bell), app-owned
  `Notification Type` records registered after migrate.
- Events and defaults: new movement submitted by another user (on, per kind
  switch), movement cancelled/amended by another user (on), count adjustment by
  another user (on), export finished or failed for the requester (on), daily
  expiry digest (off). Every digest-style notification is off by default.
- Recipients: enabled app users other than the actor, with the event enabled,
  passing native `has_permission` for the document.
- Export UX: dialog states up front that files are generated in the background
  with a notification; closing during generation is fine; bell shows a progress
  ring while the user's export runs; notification always created (success with
  download action, failure with reason + 打开报表); created already read when the
  user watched it finish in the dialog; expired file shows 文件已不可用.
- Delivery: Web Push via `pywebpush` with server VAPID keys in settings and an
  `Inventory Push Subscription` DocType per user/device, pruned on 404/410;
  service worker push + notificationclick handlers. Unread count refresh on focus
  and every ~60s while visible (no socket.io dependency). App-icon badge via the
  Badging API.
- UI: bell with count badge (99+) in desktop app bar and mobile top bar; popover
  (desktop) / sheet (phone), grouped 今天/更早, record-reference rows, 全部已读;
  `/notifications` full page; 更多 → 通知设置 page (master switch, per-event and
  per-kind switches, per-device push enable/status/test).
- Fix the 更多 install card (UiButton centering) to match sibling cards.

### Density and polish (Phase 5)

Desktop fine-pointer density (touch keeps 44px): smaller gutters and header
margins, breadcrumb merged into title block, flat single-scroll sidebar with
hairline sections and compact rows, ~40-44px table rows, compact More tiles,
tighter editor cards. Browse header: one persistent row (title, view tabs,
search/filters, sidebar icon button with tooltip, filter count, 新建 split button
with the other kinds in its menu, export/drafts in a ⋯ menu); remove 收起工具;
merged result-count/analysis line; sticky header with scroll shadow; `/` focuses
search. Distinct destination icons, tooltips on icon buttons, empty states with an
action, hover row actions, sticky table headers, wider screens show extra columns.

### Visual pass (Phase 6)

Every page at 1440/1024/390px, all densities, enlarged text, many-unit rows, long
names and deep paths. Fix breakage, update DESIGN_SYSTEM.md and
UI_UX_DECISIONS.md, run full suites and the live acceptance suite.

## Baseline

- Frontend: 559 `it`/`test` cases. Backend: 140 test methods.
