# Independent implementation review and repair handoff — 2026-10-20

## Outcome and scope

**The implementation needs another repair pass before acceptance.** Live browser
review found three major functional gaps: Movement/Loan group disclosure does
nothing on desktop, grouping selections do not affect their record tables, and
Loan item history fails at the API boundary. There are also two smaller functional
defects and four presentation/consistency findings below.

This is a review of the existing **uncommitted** implementation, not a new
implementation. No application source, generated assets, database schema, or
inventory documents were edited. Browser actions avoided deliberate saved-account
preference changes. Only this handoff and its evidence were added to the working
tree. Preserve the other agents' work.

Per the user's instruction, **no code-based tests, typechecks, formatting checks,
or builds were rerun**. The checks here were source review and interactions with
the actual running application using Chromium and the supplied dev Administrator
account. The earlier passing test claims are not independent verification of
the interactions that failed here.

Read alongside:

- [Original implementation handoff](20261020_BROWSE_API_STANDARDIZATION_HANDOFF.md).
- [Table migration review](20261020_TABLE_MIGRATION_REVIEW.md).
- [Implementation record](20261020_BROWSE_API_STANDARDIZATION_IMPLEMENTATION.md).
- Root `AGENTS.md`, `UI_UX_DECISIONS.md`, and `DESIGN_SYSTEM.md`.

Application routes below are relative to `http://127.0.0.1:8000/inventory`.
Source locations are relative to the app root; line numbers describe this working
tree and may move during repairs.

## Work order

| Order | Finding | Priority | Classification |
| --- | --- | --- | --- |
| 1 | F1: Desktop group disclosure never invokes its handler | P1 | Confirmed functional defect |
| 2 | F2: Record-view grouping is fetched but never rendered | P1 | Confirmed missing behavior |
| 3 | F3: Loan item history sends the wrong API view | P1 | Confirmed API integration defect |
| 4 | F4: Closing grouped item history leaves its contents visible | P2 | Confirmed functional defect |
| 5 | F5: Movement status displays raw native integers | P2 | Confirmed presentation defect |
| 6 | F6: Search/chips/actions still look like separate controls | P2 | Requested design not fully realized |
| 7 | F7: Browse chrome and summaries overwhelm the data | P2 | Visual/usability recommendation |
| 8 | F8: Group summaries defeat the intended column layout | P2 | Visual/usability recommendation |
| 9 | F9: Reports naming and filter count are inconsistent | P3 | Confirmed consistency defect |

Fix F1–F5 first. F6 follows the user's existing unified-search requirement.
F7–F8 describe the observed problems and a recommended direction, not a claim
that a particular new layout was already approved. Keep these repairs focused;
do not use them to reopen the entire route, cache, or schema migration.

## F1 — Group disclosure buttons do nothing

**Reproduction**

1. Open `/movements?view=items` or `/loans?view=items` at desktop width.
2. Click the triangle/name disclosure on a group row, not `查看历史`.
3. The triangle remains closed, `aria-expanded` remains `false`, and no child
   `projections.group_page` request is sent.

The browser observation recorded one group request before and after the Movement
click, and two cumulative requests before and after the Loan click. These were
successful clicks on enabled buttons, followed by an observation delay.

**Cause:** `frontend/src/features/movements/OperationBrowseView.vue:893`:

```vue
@toggle-group="
  query.groupBy.length ? c.groups.toggleGroup : toggleItemGroup
"
```

This inline expression returns a function. It does not invoke that function with
the emitted group ID. A simple member-expression handler elsewhere in the app
does not have this problem.

**Repair**

- Use an explicit dispatcher or invoke the chosen handler with `$event`.
- Cover both configured grouping and the ungrouped Item history disclosure branch.
- Preserve independent group pagination, authorized lazy loading, and collapse
  state. Do not preload every group's children.

**Acceptance:** Clicking or keyboard-activating a disclosure loads its children,
updates `aria-expanded`, and can collapse/reopen it. Verify both Movement and Loan,
one and two grouping levels, plus ungrouped Item detail rows.

Evidence: [observations.json](artifacts/20261020-independent-review/observations.json).

## F2 — Record-view Group By controls have no visible effect

**Reproduction**

- `/movements?view=records`: Filters → first grouping → `流动类型`.
- `/loans?view=records`: Filters → first grouping → `借用方`.

Both pages show the new grouping chip. The group endpoint is requested, but the
table still contains the flat document rows with **zero group disclosures**.
For example, the two sample Loan documents for the same borrower remain two flat
rows rather than appearing beneath a borrower group.

**Cause**

- `OperationBrowseFilters.vue:24` exposes `GroupByFilter` in record views.
- `useOperationBrowse.ts:117` creates the grouped-page controller.
- `OperationBrowseView.vue:198` builds `operationRows` directly from `result.rows`.
- The records `DataTable` at `OperationBrowseView.vue:1119` always uses those flat
  rows and has no grouped-row rendering/disclosure wiring.

**Repair**

Render the grouped controller's entries when the record query has grouping,
including group metrics, loading/error/retry and root/child pagination.
Retain native document navigation, status, whole-document quantities, original
loan links, and settlement eligibility for leaf records. Group leaf data may have
a different shape from `operation_page` rows: adapt it deliberately rather than
blindly casting it to `OperationGroup`.

Do not simply hide the controls: grouping native records is in the original scope.
Do not change quantities to sums of only loaded child pages.

**Acceptance:** Each offered grouping actually changes the record table; grouped
children retain the correct document actions. Removing grouping restores the
normal flat table. Confirm both families and a valid two-level combination.

Evidence:
[Movement grouped by kind](artifacts/20261020-independent-review/records-grouped-kind.png),
[Loans grouped by borrower](artifacts/20261020-independent-review/loan-records-grouped.png).

## F3 — Loan Item “查看历史” returns HTTP 417

**Reproduction**

1. Open `/loans?view=items`.
2. On sample Item `活动周转箱`, click `查看历史`.
3. After the request completes, the history shows
   **“请选择借用结算结果”** with Retry.

The observed response from `browse.operation_contributions` was HTTP 417 with
`frappe.exceptions.ValidationError: 请选择借用结算结果`. This is not merely a
slow-loading screenshot; the request response was captured and the error was
visible after an eight-second observation.

**Cause**

`frontend/src/features/movements/useOperationBrowse.ts:367` rewrites a Loan Item
history query to `view: "outcomes"`. It supplies an Item and `history_scope`, but
the Item summary has no specific `outcome_key`.

`temple_inventory/browse.py:972` requires an outcome for non-Item Loan queries.
Its `view == "items"` branch at line 978 is the one that supports
`history_scope: "outstanding" | "all"` and reconstructs the appropriate history.

**Repair**

Align this caller with the existing Item-history API contract. Preserve the
Loan Item view for that request, clear irrelevant configurable grouping, and
retain independent history sorting. Do not weaken the server's requirement for
a specific outcome when the caller really requests outcome detail.

**Acceptance:** Both `未结清借用` and `全部相关记录` load, display correct quantities,
and support existing navigation/settlement actions. Retry must work after a real
request failure. Also inspect this caller's flat Item path, not only the default
grouped path.

Evidence:
[Loaded error state](artifacts/20261020-independent-review/history-after-eight-seconds.png),
[HTTP observation](artifacts/20261020-independent-review/observations.json).

## F4 — “收起历史” changes the button but does not hide history

After reproducing F3, click `收起历史`. The label changes to `查看历史` and the
history-scope select disappears, but the nested history error and its column
settings button remain visible.

`useOperationBrowse.ts:466` correctly removes the Item ID from `expanded`.
However, the grouped-row slot in `OperationBrowseView.vue:1032–1114` renders
`MovementHistoryTable` / `ReportTable` based on the existence of `details[id]`,
without checking that the Item is still expanded.

**Repair:** Gate history content on its explicit expansion state, including
loading/error/empty states. Retain loaded details in the controller so reopening
does not unnecessarily refetch. Do not delete the cache simply to make the
component disappear.

**Acceptance:** Open → close → reopen works for both Movement and Loan and for
successful, loading, and failed history states. Group-child expansion and Item
history expansion remain independent.

Evidence:
[History after closing](artifacts/20261020-independent-review/history-collapse-final.png).
The collapse problem was directly observed in the error state; repeat it with
loaded rows after fixing F3.

## F5 — Movement document status displays `1`

On `/movements?view=records`, the `状态` column displays raw `1` for submitted
documents. This loses the Chinese status label and the shared status treatment.

`OperationBrowseView.vue:122` defines the Movement column as `docstatus`, but the
cell renderer at line 1237 only handles `column.id === "status"` (the Loan column).
The unhandled Movement cell falls back to the raw value.

**Repair:** Render `docstatus` through `NativeStatusBadge`. Keep the Loan state
combination separate so Movement rows do not acquire irrelevant loan-state text.

**Acceptance:** Draft/submitted/cancelled documents display their intended labels;
none display `0`, `1`, or `2`. Check both record families.

Evidence: [Movement records](artifacts/20261020-independent-review/records.png).

## F6 — Finish the unified search-bar design

Search is persistent, and the controls share a flex row, but visually this is
still a standalone bordered input with separate Scan/Filters buttons and chips
outside it. On mobile, the controls split into additional rows. This does not
deliver the requested Odoo-like bar with embedded chips and trailing icons.

Relevant source:

- `components/ui/BrowseToolbar.vue:215`: chips, input and separate `UiButton`s.
- `styles/browse.css:1152`: `.browse-persistent-bar` only establishes flex layout.
- `styles/browse.css:1213`: the border/background belong to the input alone.

**Repair direction**

- Give the shared bar a single visual container and focus-within treatment.
- Place chips and typing space inside that container, with the filter/scanner
  controls visually embedded at the trailing edge.
- Use the shared icon system and accessible names; avoid a row of separately
  boxed buttons competing with the input.
- Preserve the persistent input instance, IME behavior, minimum typing width,
  chip wrapping, 30dvh overflow cap, scanner lifecycle, and canonical filter state.
- Preserve deliberate mobile touch-target sizes and a usable narrow layout.

The desktop filter panel is also a narrow, single-column form. Reports requires
scrolling before all grouping controls are visible even at 1366×768. Consider a
wider desktop panel with clearly separated Filters and Group By sections; keep
the existing mobile sheet and in-place date editing. This is a visual improvement,
not a request for another filter state implementation.

Evidence:
[Stock bar/panel](artifacts/20261020-independent-review/stock-filter.png),
[Reports panel](artifacts/20261020-independent-review/reports-filter.png),
[Phone Stock](artifacts/20261020-independent-review/phone-stock.png).

## F7 — Reduce the amount of chrome before the data

At 1440×900, the default Movement Item page reaches its table header at about
815px; **no data rows fit in the first viewport**. Stock's header starts around
688px. At 390×844, Stock and Loan spend virtually the entire first screen on
headings, tools and summaries.

Contributing factors:

- Separate rows for sort controls and analysis actions.
- Large whitespace between the global nav, breadcrumbs, title and tools.
- Large analysis cards; one multi-unit Receive metric stretches every card in
  its grid row, followed by another row of operation metrics.
- `收起工具` hides tools but leaves the large summary panel.
- Each table reserves a separate full-height toolbar row for one column icon.

Relevant source: `OperationBrowseView.vue:615–647`,
`features/inventory/StockBrowseView.vue:365`, `components/ui/QuantitySummary.vue`,
`components/ui/DataTable.vue:245`, and shared browse/layout styles.

**Recommended direction:** Keep a small, readable result count and summary strip
near the table, with the detailed per-unit/per-operation analysis disclosed on
demand. Preserve all units and values; never combine incompatible units or hide
quantities without a discoverable detail control. Place analysis/sort/column
actions in shared compact toolbar space where possible. Retain sorting access
for hidden columns and for card/mobile layouts.

**Visual acceptance target:** On the supplied sample data at 1366×768 and
1440×900, users can see several browse rows on initial desktop load. On a phone,
the first meaningful result should be reachable without scrolling through
multiple screens of chrome. Check normal and compact density, and long summaries.
Do not achieve this by shrinking text or touch targets below the shared rules.

Evidence:
[Movement initial](artifacts/20261020-independent-review/movements.png),
[Stock initial](artifacts/20261020-independent-review/stock.png),
[Stock collapsed tools](artifacts/20261020-independent-review/stock-compact.png),
[Phone Loan](artifacts/20261020-independent-review/phone-loans.png).

## F8 — Make grouped rows readable as part of a table

Default Loan Item grouping currently produces:

1. A normal table header with image/name/code/category/unit/count/quantity/actions.
2. A full-width colored group cell.
3. A long bold paragraph containing counts, unit, borrowed, returned, damaged,
   lost and outstanding quantities, with an inline history button.
4. `展开后读取相关记录。` repeated in the collapsed group.

The group content does not align with the column headings. Code/category/image
columns provide no information at this default collapsed level. This retains
much of the old summary-list layout inside a table and limits the benefit of
column customization and compact density.

Relevant source: `DataTable.vue:445` group cell spans all data columns;
`OperationBrowseView.vue:292` concatenates group metrics into prose, and its
`#group` slot at line 988 embeds that prose and nested history.

**Recommended direction**

- Use a compact group disclosure row with a clear label/count and restrained
  metrics aligned to meaningful quantity columns, or a consistently structured
  summary area when column alignment is not applicable.
- Keep full-grain counts and unit partitions intact.
- Put optional detailed metrics/history in the expanded area.
- Remove repeated instructional filler from every collapsed row.
- Keep native history as a separate disclosure from configured grouping.
- Implement the reusable group presentation in the shared table, then adapt its
  consumers. Avoid a new page-specific parallel table.

**Acceptance:** One- and two-level grouping remains scannable in compact, normal
and spacious density, with long names and multiple units. Hidden/reordered
columns must not mislabel aggregates.

Evidence: [Default Loan groups](artifacts/20261020-independent-review/loans.png).

## F9 — Reports has a different identity and a permanent “2” filter count

On `/reports`, the top nav and breadcrumb say `报表`, while the page title says
`导出`. With the default query and no active chips, Filters shows `2`.

`features/export/ReportsView.vue:124` hardcodes the title, and line 130 adds
`+ 2` to the filter count for dataset/view configuration. The error page in
`ReportsPage.vue:26` also says `导出`.

**Repair**

- Use the same page identity as the navigation/breadcrumb (`报表`), reserving
  `导出` for the export action/dialog.
- Make the badge represent applied restrictions consistently with other pages.
  Dataset/view choices are configuration, not two active restrictions.
- Ensure reset returns a truthful badge/chip state, and check grouped queries
  without double-counting grouping chips.

Evidence: [Default Reports](artifacts/20261020-independent-review/reports.png).

## Positive observations and limits

- Initial browser navigation covered Stock, Expiry, Movement Items/Records, Loan
  Items, Reports, Counts, New Count, Warehouses, Categories, Pending/Damaged,
  Activities, and Settings. There were no uncaught page errors or HTTP failures
  during that initial sweep, and no document-level horizontal overflow at
  1440×900. Later interaction exposed the history failure above.
- The reviewed pages had breadcrumbs and the desktop top navigation. This was
  not an exhaustive dynamic-detail/permission-state breadcrumb audit.
- Selecting `食品` in the Stock sidebar produced a matching search chip and a
  settled eight-Item result. The sidebar/chip foundation is useful and should be
  retained, rather than replaced during these repairs.
- The representative blue/compact theme check changed nav, chips, controls and
  the teleported filter panel consistently. This used DOM theme/density attributes
  in the review browser, without saving a new user preference. It is not proof of
  every overlay or every theme combination.
- Expiry no longer repeats `批次资料` on its rows.
- Source review included routing, shared tables, grouped-page handling, account
  column/rail preferences, cache/invalidation, and schema-audit code. No additional
  backend cache/security defect is asserted here. Cache race, rollback, permission,
  schema-reset and seed claims were **not rerun or independently certified**.
- No inventory lifecycle writes, physical camera tests, cross-account sessions,
  exhaustive column-preference persistence checks, or exhaustive date combinations
  were exercised.
- Existing completed implementation notes should be amended after repairs to
  record these independently reproduced gaps. Do not continue claiming complete
  visual acceptance solely from the earlier gallery.

## Repair verification handoff

The current review deliberately did not rerun code-based checks. For the later
repair task, follow its user's validation instructions. If focused tests are
authorized, prioritize real integration boundaries: the conditional emitted-event
handler, record-table grouped/flat selection, the Loan history request contract,
and expansion visibility after a response/error. Avoid relying only on source
text assertions.

Regardless of unit-test coverage, repeat the actual browser reproductions for
F1–F5 against the built app. Verify F6–F9 at desktop, short desktop and phone
sizes, normal/compact density, and at least one alternate theme. Capture settled
states after responses complete: a successful click or a temporary loading
indicator is not evidence that the feature works.

Evidence index:
[Independent review artifacts](artifacts/20261020-independent-review/README.md).
