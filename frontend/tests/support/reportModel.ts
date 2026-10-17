import { reactive } from "vue";
import { previewDate } from "./model";
import {
  reviewSession,
  reviewMovementRows,
  type ReviewSession,
  type ReviewLoan,
} from "./reviewModel";
import {
  emptyScope,
  inPeriod,
  matchesItem,
  matchesWarehouse,
  movementLabels,
  resolvePeriod,
  type BrowseScope,
} from "./browseModel";
import { activities, activityLabel, activityTypeLabel } from "./activityData";
import {
  activityLoanLines,
  activityMovementCounts,
  relatedActivityRecords,
} from "./activityModel";
import {
  reportDefinitions,
  newReportQuery,
  type ReportDataset,
  type ReportRow,
  type ReportTable,
  type ReportDefinition,
  type ReportQuery,
} from "../../src/lib/reportContract";
export {
  reportDefinitions,
  newReportQuery,
  groupLabels,
  type ReportDataset,
  type ReportRow,
  type ReportTable,
  type ReportDefinition,
  type ReportQuery,
} from "../../src/lib/reportContract";
export const reportStates = reactive(
  Object.fromEntries(
    (Object.keys(reportDefinitions) as ReportDataset[]).map((dataset) => [
      dataset,
      newReportQuery(dataset),
    ]),
  ) as Record<ReportDataset, ReportQuery>,
);
export const reportWorkspace = reactive({
  dataset: "inventory" as ReportDataset,
  incoming: undefined as ReportQuery | undefined,
});
export const namedReportViews = reactive<
  { id: number; name: string; query: ReportQuery }[]
>([]);
let nextReportViewId = 1;
export function saveReportView(name: string, query: ReportQuery) {
  if (!name.trim()) return "请填写视图名称";
  if (namedReportViews.some((row) => row.name === name.trim()))
    return "视图名称已存在";
  namedReportViews.push({
    id: nextReportViewId++,
    name: name.trim(),
    query: structuredClone(JSON.parse(JSON.stringify(query))),
  });
  return "";
}
export function renameReportView(id: number, name: string) {
  if (
    !name.trim() ||
    namedReportViews.some((row) => row.id !== id && row.name === name.trim())
  )
    return "名称为空或已存在";
  const row = namedReportViews.find((row) => row.id === id);
  if (row) row.name = name.trim();
  return "";
}
export function openFullReport(query: ReportQuery) {
  reportWorkspace.dataset = query.dataset;
  reportWorkspace.incoming = JSON.parse(JSON.stringify(query));
}
const statusLabel = (status: number) =>
  ["草稿", "已提交", "已取消"][status] || "未知";
function table(
  id: string,
  label: string,
  rows: ReportRow[],
  columns?: string[],
): ReportTable {
  return {
    id,
    label,
    rows,
    columns: columns || [...new Set(rows.flatMap((row) => Object.keys(row)))],
  };
}
function uniqueDocuments(rows: ReportRow[]) {
  const result = new Map<string, ReportRow>();
  for (const row of rows) {
    const key = `${row.documentType}/${row.documentId}`;
    const previous = result.get(key);
    if (previous) {
      previous.itemLines = Number(previous.itemLines) + 1;
    } else
      result.set(key, {
        documentType: row.documentType!,
        documentId: row.documentId!,
        postingDate: row.postingDate!,
        status: row.status!,
        activityId: row.activityId!,
        activity: row.activity!,
        borrower: row.borrower!,
        itemLines: 1,
      });
  }
  return [...result.values()].map((record) => ({
    ...record,
    quantities: quantityByUnit(
      rows.filter(
        (row) =>
          row.documentId === record.documentId &&
          row.documentType === record.documentType,
      ),
    ),
  }));
}
function movementLines(
  query: ReportQuery,
  session: ReviewSession,
  related = false,
): ReportRow[] {
  const rows =
    related && query.scope.activity
      ? relatedActivityRecords(query.scope.activity, session)
      : reviewMovementRows(session);
  return rows
    .filter(
      (row) =>
        query.statuses.includes(row.docstatus) &&
        inPeriod(row.date, query.scope.period) &&
        matchesItem(row.code, query.scope, session) &&
        ((!query.restrictItems && !query.itemCodes.length) ||
          query.itemCodes.includes(row.code)) &&
        (!query.scope.activity ||
          related ||
          row.activity === query.scope.activity) &&
        (query.includeAdjustments ||
          !["Opening", "Reconcile"].includes(row.kind)) &&
        (!query.scope.kinds.length || query.scope.kinds.includes(row.kind)) &&
        (!query.record || row.name === query.record) &&
        (!query.loan ||
          row.loanName === query.loan ||
          row.name === query.loan) &&
        [row.from, row.to].some((value) =>
          matchesWarehouse(value, query.scope.warehouses, session),
        ) &&
        matchesWarehouse(row.from, query.scope.sources, session) &&
        matchesWarehouse(row.to, query.scope.destinations, session),
    )
    .map((row, index) => {
      const draft = session.drafts.find((draft) => draft.name === row.name);
      const activity = activities.find(
        (activity) => activity.id === row.activity,
      );
      return {
        documentType: row.documentType || "Stock Entry",
        documentId: row.name,
        lineId: row.lineId || `${row.name}/${index}`,
        postingDate: row.date,
        postingTime: draft?.postingTime || row.postingTime || "",
        kind: row.kind,
        operation: movementLabels[row.kind] || row.kind,
        status: statusLabel(row.docstatus),
        docstatus: row.docstatus,
        itemId: row.code,
        item: row.itemName,
        category:
          session.stock.find((item) => item.code === row.code)?.category || "",
        stockQty: row.qty,
        stockUom: row.uom,
        enteredQty: row.entryQty ?? row.qty,
        enteredUom: row.entryUom || row.uom,
        conversionFactor: row.conversionFactor ?? 1,
        sourceLocationId: row.from,
        locationId: row.to,
        batchId: row.batch || "",
        activityId: row.activity || "",
        activity: activityLabel(row.activity),
        activityTypeId: activity?.typeId || "",
        activityType: activity ? activityTypeLabel(activity.typeId) : "",
        borrower: row.borrower || "",
        source: draft?.source || "",
        purpose: draft?.purpose || "",
        recorder: draft?.recorder || "",
        handler: draft?.handler || "",
        reviewer: draft?.reviewer || "",
        notes: draft?.note || "",
        loanId: row.loanName || "",
        loanLineId:
          row.loanName && row.loanLineIndex !== undefined
            ? `${row.loanName}/${row.loanLineIndex}`
            : "",
        relationship:
          "relationship" in row ? String(row.relationship) : "直接关联",
      };
    });
}
/** Authoritative fixture checkpoints and ledger events; never derived from current stock. */
export const historicalCheckpoints = [
  {
    date: "2026-09-30",
    itemId: "ITM-000128",
    locationId: "斋堂 / A-01",
    stockUom: "袋",
    balance: 100,
  },
  {
    date: "2026-09-30",
    itemId: "ITM-000128",
    locationId: "斋堂 / A-02",
    stockUom: "袋",
    balance: 20,
  },
];
export const historicalEvents = [
  {
    id: "LED-1",
    documentId: "HIST-RECEIVE",
    date: "2026-10-02",
    locationId: "斋堂 / A-01",
    incoming: 30,
    outgoing: 0,
    adjustment: 0,
  },
  {
    id: "LED-2",
    documentId: "HIST-TRANSFER",
    date: "2026-10-03",
    locationId: "斋堂 / A-01",
    incoming: 0,
    outgoing: 10,
    adjustment: 0,
  },
  {
    id: "LED-3",
    documentId: "HIST-TRANSFER",
    date: "2026-10-03",
    locationId: "斋堂 / A-02",
    incoming: 10,
    outgoing: 0,
    adjustment: 0,
  },
  {
    id: "LED-4",
    documentId: "HIST-COUNT",
    date: "2026-10-04",
    locationId: "斋堂 / A-01",
    incoming: 0,
    outgoing: 0,
    adjustment: -3,
  },
  {
    id: "LED-5",
    documentId: "HIST-CANCELLED",
    date: "2026-10-05",
    locationId: "斋堂 / A-01",
    incoming: 5,
    outgoing: 0,
    adjustment: 0,
  },
  {
    id: "LED-6",
    documentId: "HIST-REVERSAL",
    date: "2026-10-06",
    locationId: "斋堂 / A-01",
    incoming: -5,
    outgoing: 0,
    adjustment: 0,
  },
].map((event) => ({
  ...event,
  documentType:
    event.documentId === "HIST-COUNT" ? "Stock Reconciliation" : "Stock Entry",
  reversalOf: event.id === "LED-6" ? "HIST-CANCELLED" : "",
  status:
    event.id === "LED-5"
      ? "已取消"
      : event.id === "LED-6"
        ? "有效冲销"
        : "已提交",
  itemId: "ITM-000128",
  stockUom: "袋",
}));
export function historicalBalances(
  query: ReportQuery,
  session: ReviewSession = reviewSession,
) {
  const range = resolvePeriod(query.scope.period);
  if (!range.from || !range.to || range.from > range.to)
    return {
      error: "历史余额需要有开始和结束日期的期间",
      rows: [] as ReportRow[],
      events: [] as ReportRow[],
    };
  if (range.from <= "2026-09-30")
    return {
      error: "样本账本从 2026-10-01 开始，较早期初余额未提供",
      rows: [] as ReportRow[],
      events: [] as ReportRow[],
    };
  const checkpoints = historicalCheckpoints.filter(
    (row) =>
      matchesItem(row.itemId, query.scope, session) &&
      matchesWarehouse(row.locationId, query.scope.warehouses, session) &&
      ((!query.restrictItems && !query.itemCodes.length) ||
        query.itemCodes.includes(row.itemId)) &&
      (!query.itemLocationKeys.length ||
        query.itemLocationKeys.includes(`${row.itemId}/${row.locationId}`)) &&
      (!query.search.trim() ||
        [
          row.itemId,
          row.locationId,
          session.stock.find((item) => item.code === row.itemId)?.name,
          session.stock.find((item) => item.code === row.itemId)?.category,
        ].some((value) =>
          String(value || "")
            .toLocaleLowerCase()
            .includes(query.search.trim().toLocaleLowerCase()),
        )),
  );
  const events = historicalEvents.filter((event) =>
    checkpoints.some(
      (row) =>
        row.itemId === event.itemId &&
        row.locationId === event.locationId &&
        row.stockUom === event.stockUom,
    ),
  );
  const rows = checkpoints.map((row) => {
    const before = events.filter(
      (event) =>
        event.itemId === row.itemId &&
        event.stockUom === row.stockUom &&
        event.locationId === row.locationId &&
        event.date < range.from,
    );
    const during = events.filter(
      (event) =>
        event.itemId === row.itemId &&
        event.stockUom === row.stockUom &&
        event.locationId === row.locationId &&
        event.date >= range.from &&
        event.date <= range.to,
    );
    const opening =
      row.balance +
      before.reduce(
        (sum, event) =>
          sum + event.incoming - event.outgoing + event.adjustment,
        0,
      );
    const incoming = during.reduce((sum, event) => sum + event.incoming, 0),
      outgoing = during.reduce((sum, event) => sum + event.outgoing, 0),
      adjustment = during.reduce((sum, event) => sum + event.adjustment, 0);
    return {
      ...row,
      item:
        session.stock.find((item) => item.code === row.itemId)?.name ||
        row.itemId,
      category:
        session.stock.find((item) => item.code === row.itemId)?.category || "",
      opening,
      incoming,
      outgoing,
      adjustment,
      closing: opening + incoming - outgoing + adjustment,
    };
  });
  return {
    error: "",
    rows,
    events: events.filter(
      (event) => event.date >= range.from && event.date <= range.to,
    ) as ReportRow[],
  };
}
function groupRows(rows: ReportRow[], grouping: string): ReportRow[] {
  const grouped = new Map<string, ReportRow>();
  const itemSets = new Map<string, Set<string>>();
  const field =
    (
      {
        item: "itemId",
        category: "category",
        location: "locationId",
        kind: "kind",
        activity: "activityId",
        borrower: "borrower",
        month: "postingDate",
      } as Record<string, string>
    )[grouping] || "itemId";
  for (const row of rows) {
    const group =
      field === "postingDate"
        ? String(row[field] || "").slice(0, 7)
        : row[field] || "未填写";
    const key = [group, row.stockUom, row.kind, row.status, row.reviewed].join(
      "/",
    );
    const result = grouped.get(key) || {
      group: String(group),
      groupLabel: String(
        field === "itemId"
          ? row.item || group
          : field === "activityId"
            ? row.activity || group
            : group,
      ),
      stockUom: String(row.stockUom || ""),
      ...(row.kind
        ? {
            kind: row.kind,
            operation:
              movementLabels[String(row.kind)] ||
              (
                {
                  returned: "正常归还",
                  damaged: "损坏",
                  lost: "遗失",
                  outstanding: "未归还",
                } as Record<string, string>
              )[String(row.kind)] ||
              String(row.kind),
          }
        : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(typeof row.reviewed === "boolean" ? { reviewed: row.reviewed } : {}),
      lines: 0,
    };
    result.lines = Number(result.lines) + 1;
    const items = itemSets.get(key) || new Set<string>();
    if (row.itemId) items.add(String(row.itemId));
    itemSets.set(key, items);
    result.itemCount = items.size;
    for (const quantity of [
      "stockQty",
      "available",
      "loaned",
      "damaged",
      "total",
      "borrowed",
      "returned",
      "lost",
      "outstanding",
      "opening",
      "incoming",
      "outgoing",
      "adjustment",
      "closing",
      "baseline",
      "actual",
      "variance",
    ]) {
      if (typeof row[quantity] === "number")
        result[quantity] = Number(result[quantity] || 0) + row[quantity];
    }
    grouped.set(key, result);
  }
  return [...grouped.values()];
}
export function projectReport(
  query: ReportQuery,
  session: ReviewSession = reviewSession,
) {
  let rows: ReportRow[] = [],
    extra: ReportTable[] = [],
    error = "";
  const dataset = query.dataset;
  const range = resolvePeriod(query.scope.period);
  const relatedRange = resolvePeriod(query.relatedPeriod);
  if (
    (query.scope.period.key === "custom" &&
      (!range.from || !range.to || range.from > range.to)) ||
    (dataset === "activities" &&
      query.view === "records" &&
      query.relatedPeriod.key === "custom" &&
      (!relatedRange.from ||
        !relatedRange.to ||
        relatedRange.from > relatedRange.to))
  )
    return {
      rows: [],
      tables: [table("result", "当前视图", [])],
      related: [],
      error: "请填写有效的完整日期范围",
      count: 0,
      generated: new Date().toISOString(),
      snapshot: `${previewDate} 10:00`,
      scope: reportScopeLabel(query),
    };
  const queryText = query.search.trim().toLocaleLowerCase();
  const filterText = (data: ReportRow[]) =>
    data.filter(
      (row) =>
        !queryText ||
        Object.values(row).some((value) =>
          String(value).toLocaleLowerCase().includes(queryText),
        ),
    );

  const itemMatches = (code: string) =>
    matchesItem(code, query.scope, session) &&
    ((!query.restrictItems && !query.itemCodes.length) ||
      query.itemCodes.includes(code));
  if (dataset === "inventory" && query.view === "historical") {
    const history = historicalBalances(query, session);
    rows =
      query.grouping === "none"
        ? history.rows
        : groupRows(history.rows, query.grouping);
    error = history.error;
    extra.push(table("historicalBalances", "库位历史余额", history.rows));
    extra.push(table("ledger", "贡献单据", history.events));
  } else if (dataset === "inventory" || dataset === "expiry") {
    const details = filterText(
      (query.scope.activity ||
      query.scope.kinds.length ||
      query.scope.sources.length ||
      query.scope.destinations.length ||
      query.record ||
      query.loan
        ? []
        : session.stock
      )
        .filter((item) => itemMatches(item.code))
        .flatMap((item) => {
          const places = item.locations.length
            ? item.locations
            : [{ location: "", available: 0, loaned: 0, damaged: 0 }];
          return places
            .filter((place) =>
              matchesWarehouse(place.location, query.scope.warehouses, session),
            )
            .flatMap((place) => {
              if (
                dataset === "expiry" &&
                (!item.tracksBatch || !place.batches?.length)
              )
                return [];
              const known = (place.batches || []).reduce(
                (totals, batch) => ({
                  available: totals.available + Number(batch.available || 0),
                  loaned:
                    totals.loaned +
                    Number((batch as { loaned?: number }).loaned || 0),
                  damaged: totals.damaged + Number(batch.damaged || 0),
                }),
                { available: 0, loaned: 0, damaged: 0 },
              );
              const unassigned = {
                id: "",
                expiry: "",
                available: Math.max(0, place.available - known.available),
                loaned: Math.max(0, place.loaned - known.loaned),
                damaged: Math.max(0, place.damaged - known.damaged),
              };
              const batches =
                item.tracksBatch && place.batches?.length
                  ? [
                      ...place.batches,
                      ...(dataset === "inventory" &&
                      unassigned.available +
                        unassigned.loaned +
                        unassigned.damaged
                        ? [unassigned]
                        : []),
                    ]
                  : [
                      {
                        id: "",
                        expiry: "",
                        available: place.available,
                        loaned: place.loaned,
                        damaged: place.damaged,
                      },
                    ];
              return batches.map((batch) => ({
                itemId: item.code,
                item: item.name,
                category: item.category,
                locationId: place.location,
                batchId: batch.id,
                manufacturingDate:
                  "manufacturingDate" in batch
                    ? String(batch.manufacturingDate || "")
                    : "",
                expiry: batch.expiry || "",
                remainingDays: batch.expiry
                  ? Math.round(
                      (Date.parse(batch.expiry) - Date.parse(previewDate)) /
                        86400000,
                    )
                  : "",
                available: batch.available,
                loaned: "loaned" in batch ? Number(batch.loaned) : 0,
                damaged: batch.damaged || 0,
                total:
                  batch.available +
                  (batch.damaged || 0) +
                  ("loaned" in batch ? Number(batch.loaned) : 0),
                stockUom: item.uom,
              }));
            });
        })
        .filter(
          (row) =>
            (!query.restrictAllocations ||
              query.allocationKeys.includes(
                JSON.stringify([row.itemId, row.locationId, row.batchId]),
              ) ||
              query.allocationKeys.includes(
                `${row.itemId}/${row.locationId}/${row.batchId}`,
              )) &&
            (!query.itemLocationKeys.length ||
              query.itemLocationKeys.includes(
                `${row.itemId}/${row.locationId}`,
              )) &&
            (!query.damageOnly || row.damaged > 0) &&
            (query.includeZero || row.total !== 0) &&
            (dataset !== "expiry" || matchesReportExpiry(row.expiry, query)),
        ),
    );
    rows =
      dataset === "inventory" &&
      (query.view === "summary" || query.grouping !== "none")
        ? groupRows(
            details,
            query.grouping === "none" ? "item" : query.grouping,
          ).map((row) => ({
            ...row,
            ...(query.grouping === "none" || query.grouping === "item"
              ? {
                  itemId: row.group!,
                  item:
                    session.stock.find((item) => item.code === row.group)
                      ?.name || "",
                }
              : {}),
          }))
        : details;
    extra.push(table("allocations", "库位批次明细", details));
  } else if (dataset === "movements") {
    const lines = filterText(movementLines(query, session));
    rows =
      query.view === "records"
        ? uniqueDocuments(lines)
        : query.view === "summary"
          ? groupRows(
              lines,
              query.grouping === "none" ? "item" : query.grouping,
            )
          : lines;
    extra.push(table("lines", "分配明细", lines));
  } else if (dataset === "loans") {
    const loans = reportLoans(session).filter(
      (loan) =>
        (!queryText ||
          `${loan.name} ${loan.borrower} ${activityLabel(loan.activity)} ${loan.lines.map((line) => session.stock.find((item) => item.code === line.code)?.name || line.code).join(" ")}`
            .toLocaleLowerCase()
            .includes(queryText)) &&
        (!query.loan || loan.name === query.loan) &&
        (query.loanStatus === "all" ||
        query.loanStatus === "open" ||
        query.loanStatus === "outstanding"
          ? query.loanStatus === "all" ||
            loan.lines.some(
              (line) => line.qty > line.returned + line.damaged + line.lost,
            )
          : query.loanStatus === "settled"
            ? loan.lines.every(
                (line) => line.qty === line.returned + line.damaged + line.lost,
              )
            : loan.status === query.loanStatus) &&
        (!query.scope.activity || loan.activity === query.scope.activity) &&
        inPeriod(loan.loanDate, query.scope.period) &&
        query.statuses.includes(
          loan.docstatus ?? (loan.status === "draft" ? 0 : 1),
        ),
    );
    rows = loans.flatMap((loan) =>
      loan.lines
        .map((line, index) => ({ line, index }))
        .filter(
          ({ line }) =>
            itemMatches(line.code) &&
            matchesWarehouse(
              line.location || "",
              query.scope.warehouses,
              session,
            ),
        )
        .map(({ line, index }) => ({
          documentType: "Stock Entry",
          documentId: loan.name,
          loanId: loan.name,
          loanLineId: `${loan.name}/${index}`,
          itemId: line.code,
          item:
            session.stock.find((item) => item.code === line.code)?.name || "",
          postingDate: loan.loanDate,
          activityId: loan.activity,
          activity: activityLabel(loan.activity),
          borrower: loan.borrower,
          status:
            loan.docstatus === 2
              ? "已取消"
              : {
                  draft: "草稿",
                  outstanding: "未结清",
                  returned: "已归还",
                  damaged: "损坏结清",
                  lost: "遗失结清",
                }[loan.status],
          locationId: line.location || "",
          batchId: line.batch || "",
          stockUom:
            session.stock.find((item) => item.code === line.code)?.uom || "Nos",
          borrowed: line.qty,
          returned: line.returned,
          damaged: line.damaged,
          lost: line.lost,
          outstanding: line.qty - line.returned - line.damaged - line.lost,
        })),
    );
    rows = filterText(rows);
    if (query.loanOutcome !== "all")
      rows = rows.filter((row) => Number(row[query.loanOutcome]) > 0);
    const settlements = movementLines(
      {
        ...query,
        scope: {
          ...query.scope,
          activity: "",
          warehouses: [],
          period: { key: "all", from: "", to: "" },
        },
      },
      session,
    ).filter(
      (row) =>
        ["Return", "Damage", "Loss"].includes(String(row.kind)) &&
        rows.some(
          (balance) =>
            balance.loanId === row.loanId &&
            balance.loanLineId === row.loanLineId &&
            balance.itemId === row.itemId,
        ),
    );
    extra.push(
      table("balances", "当前借用结余", rows),
      table("settlements", "结算明细", settlements),
    );
    if (query.view === "records") rows = groupLoanDocuments(rows);
    if (query.view === "settlements") rows = settlements;
    else if (query.view === "outcomes") {
      const outcomes = rows.flatMap((row) =>
        ["returned", "damaged", "lost", "outstanding"]
          .filter(
            (outcome) =>
              query.loanOutcome === "all" || query.loanOutcome === outcome,
          )
          .filter((outcome) => Number(row[outcome]) > 0)
          .map((outcome) => ({
            ...row,
            kind: outcome,
            stockQty: Number(row[outcome]),
          })),
      );
      rows = groupRows(
        outcomes,
        query.grouping === "none" ? "item" : query.grouping,
      );
    }
  } else if (dataset === "activities") {
    const selected = activities.filter(
      (activity) =>
        activityMatchesReportStockScope(activity.id, query, session) &&
        (!queryText ||
          `${activity.id} ${activity.title} ${activity.description} ${activity.notes} ${activityTypeLabel(activity.typeId)}`
            .toLocaleLowerCase()
            .includes(queryText)) &&
        (!query.scope.activity || activity.id === query.scope.activity) &&
        (!query.activityKind ||
          activityMovementCounts(activity.id, session).some(
            (row) => row.kind === query.activityKind,
          )) &&
        (query.relatedPresence === "all" ||
          relatedActivityRecords(activity.id, session).length > 0 ===
            (query.relatedPresence === "yes")) &&
        (!query.outstandingOnly ||
          activityLoanLines(activity.id, session).some(
            (line) => line.outstanding > 0,
          )) &&
        (!query.typeId || activity.typeId === query.typeId) &&
        (query.activityStatus === "all" ||
          activity.status === query.activityStatus) &&
        (query.scope.period.key === "all" ||
          (!!activity.start && inPeriod(activity.start, query.scope.period))),
    );
    rows = selected.map((activity) => ({
      activityId: activity.id,
      title: activity.title,
      activityTypeId: activity.typeId,
      activityType: activityTypeLabel(activity.typeId),
      start: activity.start,
      end: activity.end,
      description: activity.description,
      notes: activity.notes,
      status: activity.status === "active" ? "进行中" : "已归档",
      owner: activity.owner,
      created: activity.created,
      modified: activity.modified,
      modifiedBy: activity.modifiedBy,
      movementCounts: activityMovementCounts(activity.id, session)
        .map((row) => `${movementLabels[row.kind]} ${row.count}`)
        .join(" · "),
      outstandingLines: activityLoanLines(activity.id, session).filter(
        (line) => line.outstanding > 0,
      ).length,
    }));
    extra.push(table("activityMetadata", "活动资料", rows));
    if (query.view === "records")
      rows = selected.flatMap((activity) =>
        movementLines(
          {
            ...query,
            scope: {
              ...query.scope,
              activity: activity.id,
              period: query.relatedPeriod,
            },
          },
          session,
          true,
        ),
      );
    if (query.view === "records" && query.relatedSearch)
      rows = rows.filter((row) =>
        Object.values(row).some((value) =>
          String(value)
            .toLocaleLowerCase()
            .includes(query.relatedSearch.toLocaleLowerCase()),
        ),
      );
    if (query.view === "loans")
      rows = selected.flatMap((activity) =>
        activityLoanLines(activity.id, session)
          .filter(
            (line) =>
              itemMatches(line.code) &&
              matchesWarehouse(
                line.location || "",
                query.scope.warehouses,
                session,
              ),
          )
          .map((line) => ({
            activityId: activity.id,
            activity: activity.title,
            documentType: "Stock Entry",
            documentId: line.loanName,
            loanId: line.loanName,
            loanLineId: line.lineId,
            itemId: line.code,
            item:
              session.stock.find((item) => item.code === line.code)?.name ||
              line.code,
            stockUom: line.uom,
            borrowed: line.qty,
            returned: line.returned,
            damaged: line.damaged,
            lost: line.lost,
            outstanding: line.outstanding,
            locationId: line.location || "",
            batchId: line.batch || "",
          })),
      );
    if (query.view === "records")
      extra.push(table("lines", "关联分配明细", rows));
    if (query.view === "loans")
      extra.push(table("balances", "当前借用结余", rows));
  } else if (dataset === "counts") {
    const drafts = session.drafts.filter(
      (draft) =>
        draft.kind === "Reconcile" &&
        (!query.record || draft.name === query.record) &&
        query.statuses.includes(
          draft.status === "completed"
            ? 1
            : draft.status === "cancelled"
              ? 2
              : 0,
        ) &&
        inPeriod(draft.postingDate, query.scope.period),
    );
    rows = drafts.flatMap((draft) =>
      draft.lines
        .filter(
          (line) =>
            itemMatches(line.code) &&
            matchesWarehouse(line.location, query.scope.warehouses, session),
        )
        .map((line) => ({
          documentType: "Stock Reconciliation",
          documentId: draft.name,
          lineId: line.id,
          postingDate: draft.postingDate,
          status: statusLabel(
            draft.status === "completed"
              ? 1
              : draft.status === "cancelled"
                ? 2
                : 0,
          ),
          itemId: line.code,
          locationId: line.location,
          item:
            session.stock.find((item) => item.code === line.code)?.name ||
            line.code,
          batchId: line.batch || "",
          stockUom: line.uom,
          baseline: line.qty,
          actual: line.countedQty ?? "",
          variance:
            line.countedQty === undefined ? "" : line.countedQty - line.qty,
          reviewed: line.countedQty !== undefined,
          reason: line.reason || "",
        })),
    );
    const imported = reviewMovementRows(session)
      .filter(
        (row) =>
          row.kind === "Reconcile" &&
          !drafts.some((draft) => draft.name === row.name) &&
          (!query.record || row.name === query.record) &&
          query.statuses.includes(row.docstatus) &&
          inPeriod(row.date, query.scope.period) &&
          itemMatches(row.code) &&
          [row.from, row.to].some((place) =>
            matchesWarehouse(place, query.scope.warehouses, session),
          ),
      )
      .map((row) => ({
        documentType: "Stock Reconciliation",
        documentId: row.name,
        lineId: row.lineId || row.name,
        postingDate: row.date,
        status: statusLabel(row.docstatus),
        itemId: row.code,
        locationId: row.to,
        item: row.itemName,
        batchId: row.batch || "",
        stockUom: row.uom,
        baseline: row.bookQty ?? "",
        actual: row.countedQty ?? "",
        variance:
          row.countedQty === undefined || row.bookQty === undefined
            ? ""
            : row.countedQty - row.bookQty,
        reviewed: row.countedQty !== undefined,
        reason: row.reason || "",
      }));
    rows = filterText([...rows, ...imported]).filter(
      (row) =>
        query.countReviewed === "all" ||
        row.reviewed === (query.countReviewed === "reviewed"),
    );
    extra.push(table("countLines", "盘点明细", rows));
    if (query.view === "records") rows = uniqueCountDocuments(rows);
  }
  if (
    query.grouping !== "none" &&
    !["summary", "outcomes"].includes(query.view) &&
    dataset !== "inventory"
  )
    rows = groupRows(rows, query.grouping);
  const sortValue = (row: ReportRow) =>
    query.sortBy === "modified"
      ? String(row.modified || "")
      : query.sortBy === "date"
        ? String(row.postingDate || row.start || row.modified || row.date || "")
        : query.sortBy === "name"
          ? String(row.title || row.item || row.groupLabel || "")
          : query.sortBy === "quantity"
            ? Number(
                row.stockQty ??
                  row.total ??
                  row.outstanding ??
                  row.borrowed ??
                  row.closing ??
                  0,
              )
            : String(
                row.documentId ||
                  row.activityId ||
                  row.itemId ||
                  row.group ||
                  "",
              );
  rows.sort((a, b) => {
    const left = sortValue(a),
      right = sortValue(b);
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : String(left).localeCompare(String(right), "zh");
    return (
      (order || JSON.stringify(a).localeCompare(JSON.stringify(b), "zh")) *
      (query.sort === "asc" ? 1 : -1)
    );
  });
  const tables = [
    table("result", "当前视图", rows, reportColumns(query)),
    ...extra
      .filter((entry) => entry.id !== "result")
      .map((entry) => ({ ...entry, rows: entry.rows })),
  ];
  const codes = new Set(
    [...rows, ...tables.flatMap((entry) => entry.rows)]
      .map((row) => String(row.itemId || ""))
      .filter(Boolean),
  );
  const related = [
    table(
      "items",
      "物品资料",
      session.stock
        .filter((item) => codes.has(item.code))
        .map((item) => ({
          itemId: item.code,
          item: item.name,
          category: item.category,
          stockUom: item.uom,
          tracksBatch: item.tracksBatch,
          tracksExpiry: item.tracksExpiry,
          description: item.description || "",
        })),
    ),
    table(
      "barcodes",
      "条码",
      session.stock
        .filter((item) => codes.has(item.code))
        .flatMap((item) =>
          (item.barcode || "")
            .split("\n")
            .filter(Boolean)
            .map((barcode) => ({ itemId: item.code, barcode })),
        ),
    ),
    table(
      "conversions",
      "物品常用换算",
      session.stock
        .filter((item) => codes.has(item.code))
        .flatMap((item) =>
          (item.alternateUnits || []).map((unit) => ({
            itemId: item.code,
            enteredUom: unit.uom,
            stockUom: item.uom,
            factor: unit.factor,
          })),
        ),
    ),
    table(
      "warehouses",
      "仓库层级",
      session.warehouses
        .filter((place) =>
          referencedWarehouses(tables, session).has(place.name),
        )
        .map((place) => ({
          locationId: place.name,
          label: place.label,
          parentId: place.parent || "",
          type: place.warehouse_type,
          isGroup: place.is_group,
        })),
    ),
    table(
      "attachments",
      "可访问附件引用",
      session.drafts
        .filter((draft) =>
          tables.some((entry) =>
            entry.rows.some((row) => row.documentId === draft.name),
          ),
        )
        .flatMap((draft) =>
          (draft.files || []).map((file) => ({
            documentId: draft.name,
            fileId: file.id,
            fileName: file.name,
            state: file.state,
          })),
        ),
    ),
  ];
  return {
    rows,
    tables,
    related,
    error,
    count: rows.length,
    generated: new Date().toISOString(),
    snapshot: `${previewDate} 10:00（固定预览快照）`,
    scope: reportScopeLabel(query),
  };
}
export function reportScopeLabel(query: ReportQuery) {
  const range = resolvePeriod(query.scope.period);
  const relatedRange = resolvePeriod(query.relatedPeriod);
  return [
    reportDefinitions[query.dataset].label,
    reportDefinitions[query.dataset].views.find(
      (view) => view.id === query.view,
    )?.label || query.view,
    query.scope.activity ? activityLabel(query.scope.activity) : "",
    query.record,
    query.loan,
    query.scope.warehouses.join("、"),
    query.scope.sources.length
      ? `来源库位：${query.scope.sources.join("、")}`
      : "",
    query.scope.destinations.length
      ? `去向库位：${query.scope.destinations.join("、")}`
      : "",
    query.scope.categories.join("、"),
    query.scope.item,
    ...query.itemCodes,
    query.dataset === "inventory" && query.view !== "historical"
      ? `当前库存快照 ${previewDate} 10:00`
      : query.dataset === "expiry" && query.expiryWindow !== "period"
        ? ""
        : range.from
          ? `${range.from} 至 ${range.to}`
          : "全部日期",
    query.search,
    query.dataset === "movements" ||
    query.dataset === "counts" ||
    query.dataset === "loans" ||
    (query.dataset === "activities" && query.view === "records")
      ? query.statuses.map(statusLabel).join(" / ")
      : "",
    query.includeZero ? "含零库存" : "",
    query.relatedSearch ? `关联记录搜索：${query.relatedSearch}` : "",
    query.dataset === "activities" && query.view === "records"
      ? `关联单据：${relatedRange.from ? relatedRange.from + " 至 " + relatedRange.to : "全部日期"}`
      : "",
    query.typeId ? activityTypeLabel(query.typeId) : "",
    query.dataset === "activities" && query.activityStatus !== "all"
      ? `活动状态：${query.activityStatus === "active" ? "进行中" : "已归档"}`
      : "",
    query.activityKind
      ? `包含流动：${movementLabels[query.activityKind] || query.activityKind}`
      : "",
    query.relatedPresence !== "all"
      ? query.relatedPresence === "yes"
        ? "有关联记录"
        : "无关联记录"
      : "",
    query.outstandingOnly ? "仅有未归还借用" : "",
    query.loanStatus !== "all"
      ? `借用状态：${({ open: "未结清", outstanding: "未结清", settled: "已结清", returned: "已归还", damaged: "损坏结清", lost: "遗失结清", draft: "草稿" } as Record<string, string>)[query.loanStatus] || query.loanStatus}`
      : "",
    query.loanOutcome !== "all"
      ? `借用结果：${({ returned: "正常归还", damaged: "损坏", lost: "遗失", outstanding: "未归还" } as Record<string, string>)[query.loanOutcome] || query.loanOutcome}`
      : "",
    query.countReviewed !== "all"
      ? query.countReviewed === "reviewed"
        ? "仅已核对行"
        : "仅未核对行"
      : "",
    query.damageOnly ? "仅有损坏库存" : "",
    query.dataset === "expiry" && query.includeUndated ? "包含无效期批次" : "",
    query.itemLocationKeys.length
      ? `物品库位范围：${query.itemLocationKeys.join("、")}`
      : "",
    query.restrictAllocations
      ? `限定 ${query.allocationKeys.length} 个物品库位批次`
      : "",
    query.restrictItems && !query.itemCodes.length ? "选定物品范围为空" : "",
    query.scope.kinds.map((kind) => movementLabels[kind] || kind).join("、"),
    query.expiryWindow.startsWith("next_")
      ? `未来${query.expiryWindow.slice(5)}天到期`
      : query.expiryWindow === "expired"
        ? "已过期"
        : query.expiryWindow === "undated"
          ? "无效期"
          : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function uniqueCountDocuments(rows: ReportRow[]) {
  const docs = new Map<string, ReportRow>();
  for (const row of rows) {
    const key = String(row.documentId);
    const value = docs.get(key) || {
      documentId: key,
      documentType: "Stock Reconciliation",
      postingDate: row.postingDate!,
      status: row.status!,
      lines: 0,
      reviewedLines: 0,
      unreviewedLines: 0,
    };
    value.lines = Number(value.lines) + 1;
    const field = row.reviewed ? "reviewedLines" : "unreviewedLines";
    value[field] = Number(value[field]) + 1;
    docs.set(key, value);
  }
  return [...docs.values()];
}
function referencedWarehouses(tables: ReportTable[], session: ReviewSession) {
  const names = new Set<string>();
  for (const row of tables.flatMap((table) => table.rows))
    for (const field of ["locationId", "sourceLocationId"]) {
      let name = String(row[field] || "");
      while (name && !names.has(name)) {
        names.add(name);
        name =
          session.warehouses.find((place) => place.name === name)?.parent || "";
      }
    }
  return names;
}
export function matchesReportExpiry(expiry: string, query: ReportQuery) {
  if (expiry && !inPeriod(expiry, query.scope.period)) return false;
  if (!expiry && (!query.includeUndated || query.scope.period.key !== "all"))
    return false;
  if (!expiry)
    return (
      query.expiryWindow === "undated" ||
      (query.includeUndated &&
        query.scope.period.key === "all" &&
        query.expiryWindow === "period")
    );
  if (query.expiryWindow === "undated") return false;
  if (query.expiryWindow === "expired") return expiry < previewDate;
  if (query.expiryWindow === "unexpired") return expiry >= previewDate;
  const next = /^next_(\d+)$/.exec(query.expiryWindow);
  if (next) {
    const days = (Date.parse(expiry) - Date.parse(previewDate)) / 86400000;
    return days >= 0 && days <= Number(next[1]);
  }
  return inPeriod(expiry, query.scope.period);
}

function quantityByUnit(rows: ReportRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const unit = String(row.stockUom || "");
    totals.set(unit, (totals.get(unit) || 0) + Number(row.stockQty || 0));
  }
  return [...totals].map(([unit, qty]) => `${qty} ${unit}`).join(" · ");
}

function reportLoans(
  session: ReviewSession,
): (ReviewLoan & { docstatus?: number })[] {
  const drafts = session.drafts.filter((draft) => draft.kind === "Loan");
  const native = session.loans.filter(
    (loan) =>
      !drafts.some(
        (draft) => draft.name === loan.name && draft.status !== "completed",
      ),
  );
  return [
    ...native,
    ...drafts
      .filter((draft) => draft.status !== "completed")
      .map((draft) => ({
        name: draft.name,
        borrower: draft.borrower,
        activity: draft.activity,
        loanDate: draft.postingDate,
        status: "draft" as const,
        docstatus: draft.status === "cancelled" ? 2 : 0,
        lines: draft.lines.map((line) => ({
          code: line.code,
          qty: line.qty,
          returned: 0,
          damaged: 0,
          lost: 0,
          location: line.sourceLocation || line.location,
          batch: line.batch,
        })),
      })),
  ];
}
export function reportGroupingChoices(query: ReportQuery) {
  if (query.dataset === "activities" && query.view === "loans")
    return ["activity", "item"];
  if (
    (query.dataset === "activities" && query.view === "metadata") ||
    (["movements", "loans", "counts"].includes(query.dataset) &&
      query.view === "records")
  )
    return [];
  return reportDefinitions[query.dataset].groups;
}

function reportColumns(query: ReportQuery): string[] {
  const movement = [
    "documentType",
    "documentId",
    "lineId",
    "postingDate",
    "postingTime",
    "operation",
    "status",
    "itemId",
    "item",
    "stockQty",
    "stockUom",
    "sourceLocationId",
    "locationId",
    "batchId",
    "activityId",
    "activity",
    "activityTypeId",
    "activityType",
    "borrower",
    "source",
    "purpose",
    "recorder",
    "handler",
    "reviewer",
    "notes",
    "enteredQty",
    "enteredUom",
    "conversionFactor",
    "loanId",
    "loanLineId",
    "relationship",
  ];
  const group = [
    "group",
    "groupLabel",
    "operation",
    "status",
    "stockUom",
    "lines",
    "stockQty",
  ];
  if (query.dataset === "inventory") {
    if (query.view === "historical" && query.grouping !== "none")
      return [
        "group",
        "groupLabel",
        "stockUom",
        "opening",
        "incoming",
        "outgoing",
        "adjustment",
        "closing",
      ];
    if (query.view === "historical")
      return [
        "itemId",
        "item",
        "locationId",
        "stockUom",
        "opening",
        "incoming",
        "outgoing",
        "adjustment",
        "closing",
      ];
    if (query.grouping !== "none" && query.grouping !== "item")
      return [
        "group",
        "groupLabel",
        "stockUom",
        "available",
        "loaned",
        "damaged",
        "total",
      ];
    if (query.view === "summary" || query.grouping === "item")
      return [
        "itemId",
        "item",
        "stockUom",
        "available",
        "loaned",
        "damaged",
        "total",
      ];
    return [
      "itemId",
      "item",
      "category",
      "locationId",
      "batchId",
      "stockUom",
      "available",
      "loaned",
      "damaged",
      "total",
    ];
  }
  if (query.dataset === "expiry")
    return query.grouping !== "none"
      ? ["group", "groupLabel", "stockUom", "available", "damaged", "total"]
      : [
          "itemId",
          "item",
          "locationId",
          "batchId",
          "stockUom",
          "available",
          "damaged",
          "total",
          "manufacturingDate",
          "expiry",
          "remainingDays",
        ];
  if (query.dataset === "movements")
    return query.view === "summary" || query.grouping !== "none"
      ? group
      : query.view === "records"
        ? [
            "documentType",
            "documentId",
            "postingDate",
            "status",
            "activityId",
            "activity",
            "borrower",
            "itemLines",
            "quantities",
          ]
        : movement;
  if (query.dataset === "activities")
    return query.view === "loans"
      ? [
          ...(query.grouping !== "none"
            ? ["group", "groupLabel", "lines"]
            : [
                "activityId",
                "activity",
                "loanId",
                "loanLineId",
                "itemId",
                "item",
                "locationId",
                "batchId",
              ]),
          "stockUom",
          "borrowed",
          "returned",
          "damaged",
          "lost",
          "outstanding",
        ]
      : query.grouping !== "none"
        ? group
        : query.view === "records"
          ? movement
          : [
              "activityId",
              "title",
              "activityTypeId",
              "activityType",
              "start",
              "end",
              "status",
              "description",
              "notes",
              "movementCounts",
              "outstandingLines",
              "owner",
              "created",
              "modified",
              "modifiedBy",
            ];
  if (query.dataset === "loans")
    return query.view === "settlements"
      ? query.grouping !== "none"
        ? group
        : movement
      : query.view === "outcomes" || query.grouping !== "none"
        ? group
        : [
            "documentType",
            "documentId",
            "postingDate",
            "borrower",
            "activityId",
            "activity",
            "status",
            "itemIds",
            "stockUom",
            "borrowed",
            "returned",
            "damaged",
            "lost",
            "outstanding",
          ];
  return query.grouping !== "none"
    ? [
        "group",
        "groupLabel",
        "status",
        "stockUom",
        "reviewed",
        "lines",
        "baseline",
        "actual",
        "variance",
      ]
    : query.view === "records"
      ? [
          "documentType",
          "documentId",
          "postingDate",
          "status",
          "lines",
          "reviewedLines",
          "unreviewedLines",
        ]
      : [
          "documentType",
          "documentId",
          "lineId",
          "postingDate",
          "status",
          "itemId",
          "locationId",
          "batchId",
          "stockUom",
          "reviewed",
          "baseline",
          "actual",
          "variance",
          "reason",
        ];
}

function groupLoanDocuments(rows: ReportRow[]): ReportRow[] {
  const groups = new Map<string, ReportRow>();
  for (const row of rows) {
    const key = `${row.documentId}/${row.stockUom}`;
    const group = groups.get(key) || {
      documentType: row.documentType!,
      documentId: row.documentId!,
      postingDate: row.postingDate!,
      borrower: row.borrower!,
      activityId: row.activityId!,
      activity: row.activity!,
      status: row.status!,
      stockUom: row.stockUom!,
      itemIds: "",
      borrowed: 0,
      returned: 0,
      damaged: 0,
      lost: 0,
      outstanding: 0,
    };
    group.itemIds = [
      ...new Set([
        ...String(group.itemIds).split(",").filter(Boolean),
        String(row.itemId),
      ]),
    ].join(",");
    for (const field of [
      "borrowed",
      "returned",
      "damaged",
      "lost",
      "outstanding",
    ])
      group[field] = Number(group[field]) + Number(row[field]);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function activityMatchesReportStockScope(
  id: string,
  query: ReportQuery,
  session: ReviewSession,
) {
  if (
    !query.scope.item &&
    !query.scope.categories.length &&
    !query.scope.warehouses.length &&
    !query.itemCodes.length &&
    !query.restrictItems
  )
    return true;
  const itemMatches = (code: string) =>
    matchesItem(code, query.scope, session) &&
    ((!query.restrictItems && !query.itemCodes.length) ||
      query.itemCodes.includes(code));
  return (
    relatedActivityRecords(id, session).some(
      (row) =>
        itemMatches(row.code) &&
        [row.from, row.to].some((place) =>
          matchesWarehouse(place, query.scope.warehouses, session),
        ),
    ) ||
    activityLoanLines(id, session).some(
      (line) =>
        itemMatches(line.code) &&
        matchesWarehouse(line.location || "", query.scope.warehouses, session),
    )
  );
}
