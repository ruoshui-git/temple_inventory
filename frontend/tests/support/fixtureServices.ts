import { fixtureOperationCall } from "./fixtureOperationBrowse";
import { fixtureExpiryCall } from "./fixtureExpiryBrowse";
import { fixtureStockSession } from "./fixtureStock";
import { fixtureConfigurationCall } from "./fixtureConfiguration";
import { fixtureWarehouseCall } from "./fixtureWarehouses";
import { fixtureDisplayCall } from "./fixtureDisplaySettings";
import {
  fixtureNativeCall,
  fixtureUpload,
  fixtureCatalogItem,
  fixtureFileDisplayUrl,
} from "./fixtureNativeDocuments";
/** Development entry only. The product imports the service contract, never this adapter. */
import type {
  InventoryServices,
  ReportPage,
  NamedView,
  ExportJob,
} from "../../src/services/contracts";
import type { ReportQuery, ReportRow } from "../../src/lib/reportContract";
import { reviewSession } from "./reviewModel";
import { activities } from "./activityData";
import {
  activityPermissions,
  saveActivity,
  activityMovementCounts,
  activityLoanLines,
  relatedActivityRecords,
  setActivityArchived,
  deleteActivity,
} from "./activityModel";
import { conversionAccess, conversionFactorError } from "./conversionModel";
import { createPreviewUnit } from "./conversionModel";
import { reactive } from "vue";
import { dashboardData } from "./dashboardModel";
import { newReportQuery } from "../../src/lib/reportContract";
import type { ReviewSession } from "./reviewModel";
import { previewDate } from "./model";
import { projectReport } from "./reportModel";

function fixtureReport(
  query: ReportQuery,
  options: {
    start?: number;
    page_length?: number;
    table?: string;
    include_related?: boolean;
  } = {},
): ReportPage {
  const projected = projectReport(query, fixtureStockSession());
  if (projected.error) throw new Error(projected.error);
  const tables = [
    ...projected.tables,
    ...(options.include_related ? projected.related : []),
  ];
  if (
    query.dataset === "movements" &&
    query.view === "records" &&
    query.grouping === "none"
  ) {
    const lines = tables.find((value) => value.id === "lines")?.rows || [];
    const fields = [
      "documentType",
      "documentId",
      "postingDate",
      "postingTime",
      "docstatus",
      "status",
      "kind",
      "activityId",
      "activity",
      "borrower",
      "stockUom",
    ];
    const groups = new Map<string, { row: ReportRow; items: Set<string> }>();
    for (const line of lines) {
      const key = JSON.stringify(fields.map((field) => line[field] ?? null));
      const group = groups.get(key) || {
        row: {
          id: key,
          ...Object.fromEntries(
            fields.map((field) => [field, line[field] ?? null]),
          ),
          stockQty: 0,
          lines: 0,
          itemCount: 0,
        },
        items: new Set<string>(),
      };
      group.row.stockQty =
        Number(group.row.stockQty) + Number(line.stockQty || 0);
      group.row.lines = Number(group.row.lines) + 1;
      group.items.add(String(line.itemId));
      group.row.itemCount = group.items.size;
      groups.set(key, group);
    }
    const main = tables[0]!;
    const grouped = [...groups.values()].map((group) => group.row);
    grouped.sort((left, right) => {
      const value = (row: ReportRow) =>
        query.sortBy === "date"
          ? `${row.postingDate || ""} ${row.postingTime || "00:00:00"}`
          : query.sortBy === "quantity"
            ? Number(row.stockQty)
            : String(row.documentId || "");
      const a = value(left),
        b = value(right);
      const order =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b));
      return (
        (order || String(left.id).localeCompare(String(right.id))) *
        (query.sort === "desc" ? -1 : 1)
      );
    });
    tables[0] = {
      ...main,
      columns: ["id", ...fields, "stockQty", "lines", "itemCount"],
      rows: grouped,
    };
  }
  const table = tables.find((row) => row.id === options.table) || tables[0]!;
  const start = options.start || 0;
  const size = options.page_length || 30;
  const columns: Record<string, string> = {
    itemCount: "item_count",
    lines: "allocation_count",
    documentType: "doctype",
    documentId: "document",
    lineId: "line_name",
    postingDate: "date",
    postingTime: "time",
    itemId: "item_code",
    item: "item_name",
    stockUom: "stock_uom",
    stockQty: "stock_qty",
    enteredQty: "entered_qty",
    enteredUom: "entered_uom",
    conversionFactor: "conversion_factor",
    sourceLocationId: "source_warehouse",
    destinationLocationId: "destination_warehouse",
    locationId: "warehouse",
    batchId: "batch_no",
    activityId: "activity",
    activity: "activity_title",
    activityTypeId: "activity_type",
    loanId: "original_loan",
    loanLineId: "original_loan_line",
    baseline: "baseline_qty",
    actual: "actual_qty",
    variance: "difference",
    start: "start_date",
    end: "end_date",
    created: "creation",
    modifiedBy: "modified_by",
    activityType: "activity_type_label",
    total: "stock_qty",
    expiry: "expiry_date",
    manufacturingDate: "manufacturing_date",
    remainingDays: "remaining_days",
  };
  const nativeRows = table.rows.slice(start, start + size).map((row, index) => {
    const converted = Object.fromEntries(
      Object.entries(row).map(([key, value]) => [columns[key] || key, value]),
    ) as ReportRow;
    const item = reviewSession.stock.find((item) => item.code === row.itemId);
    if (item) converted.batch_tracked = item.tracksBatch;
    if (query.grouping !== "none" && row.group) {
      const field = {
        item: "item_code",
        location: "warehouse",
        category: "category",
        activity: "activity",
        kind: "kind",
        borrower: "borrower",
        month: "month",
      }[query.grouping];
      if (field) converted[field] = row.group;
    }
    if (row.status && row.documentId) {
      converted.docstatus =
        { 草稿: 0, 已提交: 1, 已取消: 2 }[String(row.status)] ?? 1;
      delete converted.status;
    }
    if (query.dataset === "activities" && row.title) {
      converted.status = row.status === "已归档" ? "Archived" : "Active";
      converted.has_outstanding = Number(row.outstandingLines) > 0;
      for (const count of activityMovementCounts(String(row.activityId)))
        converted[`count_${count.kind}`] = count.count;
    }
    return {
      ...converted,
      id:
        ["inventory", "expiry"].includes(query.dataset) &&
        query.view !== "historical" &&
        query.grouping === "none" &&
        converted.warehouse
          ? JSON.stringify([
              converted.item_code,
              converted.warehouse,
              converted.batch_no || "",
            ])
          : String(row.id || `${table.id}:${start + index}`),
    };
  });
  const totals = new Map<string, ReportRow>();
  const metrics = [
    "stock_qty",
    "available",
    "loaned",
    "damaged",
    "borrowed",
    "returned",
    "lost",
    "outstanding",
    "opening",
    "incoming",
    "outgoing",
    "adjustment",
    "closing",
    "baseline_qty",
    "actual_qty",
    "difference",
  ];
  for (const raw of table.rows) {
    const row = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [columns[key] || key, value]),
    ) as ReportRow;
    if (!row.stock_uom) continue;
    const key = JSON.stringify([
      row.stock_uom,
      row.kind,
      row.status,
      row.outcome,
    ]);
    const total = totals.get(key) || {
      stock_uom: row.stock_uom,
      kind: row.kind || "",
      docstatus: row.status
        ? ({ 草稿: 0, 已提交: 1, 已取消: 2 }[String(row.status)] ?? 1)
        : null,
    };
    for (const metric of metrics)
      if (typeof row[metric] === "number")
        total[metric] = Number(total[metric] || 0) + Number(row[metric]);
    totals.set(key, total);
  }
  return {
    query: structuredClone(query),
    scope: structuredClone(query.scope),
    period: {
      key: query.scope.period.key,
      date_from: query.scope.period.from,
      date_to: query.scope.period.to,
    },
    snapshot: projected.snapshot,
    table: table.id,
    columns: table.columns.map((key) => columns[key] || key),
    rows: nativeRows,
    matched_count: table.rows.length,
    next_start: start + size < table.rows.length ? start + size : null,
    summary: [...totals.values()],
    tables: tables.map((row) => ({
      id: row.id,
      label: row.label,
      count: row.rows.length,
    })),
  };
}

const namedViews = new Map<string, NamedView>();
const exportJobs = new Map<string, ExportJob>();
let sequence = 0;

function inventoryPage(query: ReportQuery, start: number, size: number) {
  const projected = projectReport(
    {
      ...query,
      view: "locations",
      grouping: "none",
    },
    fixtureStockSession(),
  );
  if (projected.error) throw new Error(projected.error);
  const groups = new Map<string, Record<string, unknown>>();
  const aggregate = new Map<string, ReportRow>();
  const analysis = {
    category: new Map<string, ReportRow>(),
    location: new Map<string, ReportRow>(),
  };
  for (const line of projected.rows) {
    const code = String(line.itemId);
    const item = reviewSession.stock.find((row) => row.code === code);
    if (!item) continue;
    let current = groups.get(code);
    if (!current) {
      current = {
        ...JSON.parse(JSON.stringify(item)),
        image: item.images?.[0] || "",
        available: 0,
        loaned: 0,
        damaged: 0,
        locations: [],
      };
      groups.set(code, current!);
    }
    const locations = current!.locations as {
      location: string;
      available: number;
      loaned: number;
      damaged: number;
      batches: unknown[];
    }[];
    const location = String(line.locationId || "");
    let place = locations.find((row) => row.location === location);
    if (!place) {
      place = { location, available: 0, loaned: 0, damaged: 0, batches: [] };
      locations.push(place);
    }
    if (line.batchId)
      place.batches.push({
        id: line.batchId,
        available: line.available,
        loaned: line.loaned,
        damaged: line.damaged,
        expiry: line.expiry,
        manufacturingDate: line.manufacturingDate,
      });
    const unit = item.uom;
    if (!aggregate.has(unit))
      aggregate.set(unit, {
        stock_uom: unit,
        available: 0,
        loaned: 0,
        damaged: 0,
      });
    for (const dimension of ["category", "location"] as const) {
      const value = dimension === "category" ? item.category : location;
      const key = JSON.stringify([value, unit]);
      if (!analysis[dimension].has(key))
        analysis[dimension].set(key, {
          id: key,
          [dimension === "category" ? "category" : "warehouse"]: value,
          stock_uom: unit,
          available: 0,
          loaned: 0,
          damaged: 0,
        });
      const group = analysis[dimension].get(key)!;
      for (const field of ["available", "loaned", "damaged"])
        group[field] = Number(group[field]) + Number(line[field] || 0);
    }
    for (const field of ["available", "loaned", "damaged"] as const) {
      const qty = Number(line[field] || 0);
      current![field] = Number(current![field]) + qty;
      place[field] += qty;
      aggregate.get(unit)![field] = Number(aggregate.get(unit)![field]) + qty;
    }
  }
  const rows = [...groups.values()].sort((a, b) => {
    const order =
      query.sortBy === "quantity"
        ? Number(a.available) - Number(b.available)
        : String(a.name).localeCompare(String(b.name), "zh");
    return (
      (order || String(a.code).localeCompare(String(b.code))) *
      (query.sort === "desc" ? -1 : 1)
    );
  });
  return {
    rows: rows.slice(start, start + size),
    matched_count: rows.length,
    next_start: start + size < rows.length ? start + size : null,
    snapshot: `${previewDate} 10:00`,
    query,
    summary: [...aggregate.values()],
    analysis: {
      category: [...analysis.category.values()],
      location: [...analysis.location.values()],
    },
  };
}

export const fixtureDashboardScenario = reactive({
  failed: "",
  empty: false,
  missingContext: false,
  delay: 0,
});
function dashboardCard(args: Record<string, unknown>) {
  const card = String(args.card);
  const scope = args.scope as ReportQuery["scope"];
  const session = fixtureStockSession();
  session.filters.dashboard.categories = [...(scope.categories || [])];
  session.filters.dashboard.warehouses = [...(scope.warehouses || [])];
  session.filters.dashboard.period =
    args.movement_period as ReportQuery["scope"]["period"];
  const data = dashboardData(session);
  const query = newReportQuery(
    card === "movement"
      ? "movements"
      : card === "loans"
        ? "loans"
        : card === "expiry" || card === "reminders"
          ? "expiry"
          : "inventory",
  );
  query.scope = JSON.parse(JSON.stringify(scope));
  if (card === "movement") {
    query.view = "records";
    query.scope.period = session.filters.dashboard.period;
  }
  if (card === "loans") query.loanStatus = "outstanding";
  const result = {
    query,
    snapshot: `${previewDate} 10:00`,
    totals: [] as ReportRow[],
    kind_counts: {} as Record<string, number>,
    expiry_rows: { expired: [], upcoming: [] } as Record<string, unknown[]>,
    rows: [] as unknown[],
    buckets: data.buckets.map((row) => ({
      id: row.key.replace("over_90", "91_plus"),
      count: row.count,
    })),
    item_count: data.stock.length,
    matched_count: 0,
    expired_count: data.buckets
      .slice(0, 3)
      .reduce((sum, row) => sum + row.count, 0),
    damaged_item_count: data.damaged,
  };
  if (card === "inventory") {
    const units = new Set(data.stock.map((item) => item.uom));
    result.totals = [...units].map((unit) => ({
      stock_uom: unit,
      ...Object.fromEntries(
        ["available", "loaned", "damaged", "total"].map((field) => [
          field === "total" ? "stock_qty" : field,
          data.metric(field as "available").find((row) => row.uom === unit)
            ?.qty || 0,
        ]),
      ),
    }));
  }
  if (card === "distribution") {
    const groups = new Map<string, Set<string>>();
    for (const item of data.stock)
      for (const location of item.locations) {
        if (location.available <= 0) continue;
        const key =
          args.distribution === "category" ? item.category : location.location;
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key)!.add(item.code);
      }
    result.rows = [...groups].map(([id, codes]) => ({
      id,
      label: id,
      item_count: codes.size,
    }));
  }
  if (card === "expiry" || card === "reminders") {
    for (const status of ["expired", "upcoming"]) {
      const groups = new Map<
        string,
        {
          item_name: string;
          batch_no: string;
          expiry_date: string;
          warehouse: string;
          available: number;
          stock_uom: string;
        }
      >();
      for (const row of data.batches.filter((row) =>
        row.bucket.startsWith(status),
      )) {
        const key = JSON.stringify([row.item.code, row.id]);
        const existing = groups.get(key);
        if (existing) {
          existing.available += row.available;
          existing.warehouse += "、" + row.location;
        } else
          groups.set(key, {
            item_name: row.item.name,
            batch_no: row.id,
            expiry_date: row.expiry || "",
            warehouse: row.location,
            available: row.available,
            stock_uom: row.item.uom,
          });
      }
      result.expiry_rows[status] = [...groups.values()]
        .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))
        .slice(0, 5);
    }
  }
  if (card === "movement") {
    result.kind_counts = Object.fromEntries(
      data.summaries.map((row) => [row.kind, row.count]),
    );
    result.totals = data.summaries.flatMap((summary) =>
      summary.quantity.map((row) => ({
        kind: summary.kind,
        stock_uom: row.uom,
        stock_qty: row.qty,
      })),
    );
    const names = [...new Set(data.movements.map((row) => row.name))];
    result.matched_count = names.length;
    result.rows = names.slice(0, 5).map((name) => {
      const rows = data.movements.filter((row) => row.name === name);
      return {
        doctype: rows[0]!.documentType || "Stock Entry",
        document: name,
        item_names: [...new Set(rows.map((row) => row.itemName))].join("、"),
        kind: rows[0]!.kind,
        activity_title:
          activities.find((activity) => activity.id === rows[0]!.activity)
            ?.title || "",
        date: rows[0]!.date,
        quantities: rows.map((row) => ({ qty: row.qty, uom: row.uom })),
      };
    });
  }
  if (card === "loans") {
    result.totals = data.loanQuantities.map((row) => ({
      stock_uom: row.uom,
      outstanding: row.qty,
    }));
    result.matched_count = data.loans.length;
    result.rows = data.loans.slice(0, 5).map((loan) => ({
      doctype: "Stock Entry",
      document: loan.name,
      borrower: loan.borrower,
      activity_title:
        activities.find((activity) => activity.id === loan.activity)?.title ||
        "",
      date: loan.loanDate,
      quantities: loan.lines.map((row) => ({
        qty: row.qty - row.returned - row.damaged - row.lost,
        uom: session.stock.find((item) => item.code === row.code)?.uom || "",
      })),
    }));
  }
  if (
    fixtureDashboardScenario.missingContext &&
    ["movement", "loans"].includes(card)
  ) {
    for (const row of result.rows as ReportRow[]) {
      delete row.item_names;
      delete row.kind;
      delete row.activity_title;
    }
  }
  if (fixtureDashboardScenario.empty) {
    result.rows = [];
    result.expiry_rows = { expired: [], upcoming: [] };
    result.kind_counts = {};
    result.totals = [];
    result.item_count = 0;
    result.matched_count = 0;
    result.expired_count = 0;
    result.damaged_item_count = 0;
    result.buckets.forEach((row) => {
      row.count = 0;
    });
  }
  return result;
}

function nativeActivity(row: (typeof activities)[number]) {
  const loans = activityLoanLines(row.id);
  const units = new Map<string, ReportRow>();
  for (const line of loans) {
    if (!units.has(line.uom))
      units.set(line.uom, {
        stock_uom: line.uom,
        borrowed: 0,
        returned: 0,
        damaged: 0,
        lost: 0,
        outstanding: 0,
      });
    const total = units.get(line.uom)!;
    total.borrowed = Number(total.borrowed) + line.qty;
    for (const field of ["returned", "damaged", "lost", "outstanding"] as const)
      total[field] = Number(total[field]) + line[field];
  }
  const movements = new Map<string, ReportRow>();
  for (const record of relatedActivityRecords(row.id).filter(
    (record) => record.docstatus === 1 && record.activity === row.id,
  )) {
    const key = JSON.stringify([record.kind, record.uom]);
    if (!movements.has(key))
      movements.set(key, {
        kind: record.kind,
        stock_uom: record.uom,
        stock_qty: 0,
      });
    const total = movements.get(key)!;
    total.stock_qty = Number(total.stock_qty) + record.qty;
  }
  return {
    name: row.id,
    title: row.title,
    activity_type: row.typeId,
    start_date: row.start,
    end_date: row.end,
    description: row.description,
    notes: row.notes,
    status: row.status === "active" ? "Active" : "Archived",
    modified: String(row.version),
    creation: row.created,
    owner: row.owner,
    modified_by: row.modifiedBy,
    can_write: activityPermissions.write,
    can_delete: activityPermissions.write,
    summary: {
      ...Object.fromEntries(
        activityMovementCounts(row.id).map((count) => [
          `count_${count.kind}`,
          count.count,
        ]),
      ),
    },
    movement_totals: [...movements.values()],
    loan_totals: [...units.values()],
    outstanding_line_count: loans.filter((line) => line.outstanding > 0).length,
  };
}

/** Gallery-only service controls; shared product components contain no simulations. */
export const fixtureScenarios = reactive({
  failEndpoint: "",
  failReport: false,
  reportDelay: 0,
  pickerPageSize: 0,
});
export const fixtureServices: InventoryServices = {
  async call<T>(
    endpoint: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    if (fixtureScenarios.failEndpoint === endpoint) {
      fixtureScenarios.failEndpoint = "";
      throw new Error("示例服务暂时失败，输入和选择已保留，请重试");
    }
    if (endpoint.startsWith("warehouses."))
      return fixtureWarehouseCall(endpoint, args) as T;
    if (endpoint.startsWith("configuration."))
      return fixtureConfigurationCall(endpoint, args) as T;
    if (
      endpoint === "browse.native_drafts" ||
      endpoint === "browse.counts_page"
    ) {
      const query = JSON.parse(JSON.stringify(args.query)) as ReportQuery;
      const page = fixtureOperationCall(
        "browse.operation_page",
        { ...args, query, records: true },
        fixtureReport,
      ) as import("../../src/features/movements/useOperationBrowse").OperationBrowsePage;
      const rows = await Promise.all(
        page.rows.map(async (row) => {
          const doc = (await fixtureNativeCall("native_api.load_document", {
            doctype: row.doctype,
            name: row.document,
          })) as import("../../src/features/documents/nativeEditor").NativeDocument;
          return {
            ...row,
            whole: {
              ...row.whole,
              version: doc.version,
              editable: doc.editable,
              can_delete:
                doc.docstatus === 0 &&
                (doc.permissions as Record<string, boolean>).delete,
            },
          };
        }),
      );
      return { ...page, rows } as T;
    }
    if (
      endpoint === "session.info" ||
      endpoint === "preferences.save_display_preferences"
    )
      return fixtureDisplayCall(endpoint, args) as T;
    if (endpoint === "browse.more_summary")
      return {
        draft_count: reviewSession.drafts.filter(
          (row) =>
            row.status === "draft" && !["Item", "Activity"].includes(row.kind),
        ).length,
        snapshot: `${previewDate} 10:00:00`,
      } as T;
    if (endpoint.startsWith("browse.operation_"))
      return fixtureOperationCall(endpoint, args, fixtureReport) as T;
    if (
      endpoint === "browse.expiry_page" ||
      endpoint === "browse.expiry_analysis"
    )
      return fixtureExpiryCall(endpoint, args, fixtureReport) as T;
    if (
      endpoint.startsWith("counts.") ||
      endpoint.startsWith("native_api.") ||
      endpoint.startsWith("native_files.") ||
      [
        "catalog.batch_details",
        "catalog.batch_metadata",
        "catalog.operation_item",
        "catalog.suggest_item_code",
        "catalog.receipt_batch",
        "catalog.scan_code",
        "catalog.save_item",
        "catalog.set_item_image",
      ].includes(endpoint)
    )
      return (await fixtureNativeCall(endpoint, args)) as T;
    if (endpoint === "catalog.item_detail") {
      const row = reviewSession.stock.find(
        (row) => row.code === args.item_code,
      );
      if (!row) throw new Error("物品不存在或不可访问");
      conversionAccess.staleItem = false;
      return {
        item_code: row.code,
        item_name: row.name,
        item_group: row.category,
        stock_uom: row.uom,
        version: String(row.conversionVersion || 0),
        uoms: [
          { uom: row.uom, conversion_factor: 1 },
          ...(row.alternateUnits || []).map((unit) => ({
            uom: unit.uom,
            conversion_factor: unit.factor,
          })),
        ],
      } as T;
    }
    if (endpoint === "conversions.save_item_conversions") {
      const row = reviewSession.stock.find(
        (row) => row.code === args.item_code,
      );
      if (!conversionAccess.updateItem) throw new Error("没有更新物品的权限");
      if (
        !row ||
        conversionAccess.staleItem ||
        String(row.conversionVersion || 0) !== String(args.version)
      )
        throw Object.assign(new Error("物品换算已被修改，请重新载入后核对"), {
          kind: "TimestampMismatchError",
        });
      if (conversionAccess.failSave)
        throw new Error("常用换算保存失败，输入已保留；请重试。");
      const values = args.conversions as {
        uom: string;
        conversion_factor: number;
      }[];
      const seen = new Set<string>();
      for (const value of values) {
        const error = conversionFactorError(
          value.uom,
          value.conversion_factor,
          row.uom,
        );
        if (error) throw new Error(error);
        if (seen.has(value.uom)) throw new Error("每个单位只能有一个常用换算");
        seen.add(value.uom);
      }
      row.alternateUnits = values
        .filter((value) => value.uom !== row.uom)
        .map((value) => ({ uom: value.uom, factor: value.conversion_factor }));
      row.conversionVersion = (row.conversionVersion || 0) + 1;
      return {
        item_code: row.code,
        version: String(row.conversionVersion),
        stock_uom: row.uom,
        conversions: [
          { uom: row.uom, conversion_factor: 1 },
          ...values.filter((value) => value.uom !== row.uom),
        ],
      } as T;
    }
    if (endpoint === "activities.load_activity") {
      const row = activities.find((row) => row.id === args.name);
      if (!row)
        throw Object.assign(new Error("活动不存在或不可访问"), {
          kind: "DoesNotExistError",
        });
      return nativeActivity(row) as T;
    }
    if (endpoint === "activities.save_activity") {
      const data = args.data as Record<string, string>;
      const previous = activities.find((row) => row.id === args.name);
      if (previous && String(previous.version) !== String(args.version))
        throw Object.assign(new Error("活动已更改，请重新读取"), {
          kind: "TimestampMismatchError",
        });
      if (data.status && !data.title && previous) {
        const error = setActivityArchived(
          previous.id,
          data.status === "Archived",
        );
        if (error) throw new Error(error);
        return nativeActivity(previous) as T;
      }
      const result = saveActivity(
        {
          title: data.title || "",
          typeId: data.activity_type || "",
          start: data.start_date || "",
          end: data.end_date || "",
          description: data.description || "",
          notes: data.notes || "",
        },
        args.name ? String(args.name) : undefined,
        args.version ? Number(args.version) : undefined,
      );
      if (result.error || !result.activity)
        throw new Error(result.error || "活动保存失败");
      return nativeActivity(result.activity) as T;
    }
    if (endpoint === "activities.delete_activity") {
      const row = activities.find((row) => row.id === args.name);
      if (!row || String(row.version) !== String(args.version))
        throw new Error("活动已更改，请重新读取");
      const error = deleteActivity(row.id);
      if (error) throw new Error(error);
      return { deleted: true } as T;
    }
    if (endpoint === "catalog.create_uom") {
      const error = createPreviewUnit(
        String(args.label || ""),
        Boolean(args.must_be_whole_number),
      );
      if (error) throw new Error(error);
      return {
        name: args.label,
        must_be_whole_number: Boolean(args.must_be_whole_number),
      } as T;
    }
    if (endpoint === "catalog.create_category") {
      const label = String(args.label || "").trim();
      if (!label) throw new Error("请填写分类名称");
      if (reviewSession.categories.some((row) => row.name === label))
        throw new Error("分类已存在");
      const parent = reviewSession.categories.find(
        (row) => row.name === args.parent && row.is_group,
      );
      if (!parent) throw new Error("请选择上级分组");
      const row = {
        name: label,
        label,
        parent: parent.name,
        is_group: Boolean(args.is_group),
      };
      reviewSession.categories.push(row);
      return { ...row } as T;
    }
    if (endpoint === "browse.dashboard_card") {
      if (fixtureDashboardScenario.delay)
        await new Promise((resolve) =>
          setTimeout(resolve, fixtureDashboardScenario.delay),
        );
      if (fixtureDashboardScenario.failed === args.card)
        throw new Error("图库设置的区块读取失败");
      return dashboardCard(args) as T;
    }
    if (endpoint === "browse.inventory_page")
      return inventoryPage(
        JSON.parse(JSON.stringify(args.query)),
        Number(args.start || 0),
        Number(args.page_length || 30),
      ) as T;
    if (endpoint === "preferences.named_views")
      return [...namedViews.values()].map((row) => structuredClone(row)) as T;
    if (endpoint === "preferences.save_named_view") {
      const previous = args.view_id
        ? namedViews.get(String(args.view_id))
        : undefined;
      if (args.view_id && (!previous || args.revision !== previous.revision))
        throw new Error("视图已更改，请重新读取");
      const title = String(args.title || "").trim();
      if (!title) throw new Error("请输入视图名称");
      if (
        [...namedViews.values()].some(
          (row) => row.title === title && row.id !== previous?.id,
        )
      )
        throw new Error("视图名称已存在");
      const row = {
        id: previous?.id || `fixture-view-${++sequence}`,
        title,
        revision: (previous?.revision || 0) + 1,
        query: JSON.parse(JSON.stringify(args.query || previous?.query)),
      } as NamedView;
      namedViews.set(row.id, row);
      return structuredClone(row) as T;
    }
    if (endpoint === "preferences.delete_named_view") {
      const row = namedViews.get(String(args.view_id));
      if (!row || row.revision !== args.revision)
        throw new Error("视图已更改，请重新读取");
      namedViews.delete(row.id);
      return { deleted: true } as T;
    }
    if (endpoint === "exports.request_export") {
      const query = JSON.parse(JSON.stringify(args.query)) as ReportQuery;
      const page = fixtureReport(query, {
        include_related: Boolean(args.include_related),
        table: (args.tables as string[])?.[0],
      });
      const row: ExportJob = {
        name: `fixture-export-${++sequence}`,
        status: "Queued",
        progress: 0,
        error: "",
        version: "1",
        attempt: 1,
        generated_at: "",
        row_count: page.matched_count,
        download_url: null,
      };
      exportJobs.set(row.name, row);
      return { ...row } as T;
    }
    if (
      endpoint === "exports.export_status" ||
      endpoint === "exports.retry_export"
    ) {
      const row = exportJobs.get(String(args.name));
      if (!row) throw new Error("导出任务不存在");
      if (endpoint === "exports.retry_export") {
        row.status = "Queued";
        row.attempt++;
      } else {
        row.status = "Completed";
        row.progress = 100;
        row.generated_at = `${previewDate} 10:00`;
      }
      // Gallery jobs demonstrate lifecycle without pointing at real private files.
      return { ...row } as T;
    }
    if (endpoint === "catalog.search_items") {
      const query = String(args.search || "").toLocaleLowerCase();
      const start = Number(args.start || 0),
        size =
          fixtureScenarios.pickerPageSize || Number(args.page_length || 30);
      const matches = reviewSession.stock.filter(
        (row) =>
          `${row.code} ${row.name} ${row.category} ${row.barcode || ""}`
            .toLocaleLowerCase()
            .includes(query) &&
          (!args.category || row.category === args.category) &&
          (!Array.isArray(args.item_codes) ||
            args.item_codes.includes(row.code)) &&
          (!args.warehouse ||
            row.locations.some((place) => place.location === args.warehouse)) &&
          (!args.in_stock_only || row.available > 0),
      );
      return {
        results: matches
          .slice(start, start + size)
          .map((row) => fixtureCatalogItem(row.code)),
        matched_count: matches.length,
        next_start: start + size < matches.length ? start + size : null,
      } as T;
    }
    if (endpoint === "activities.search") {
      const term = String(args.search || "").toLocaleLowerCase();
      const rows = activities.filter((row) =>
        `${row.id} ${row.title} ${row.notes}`
          .toLocaleLowerCase()
          .includes(term),
      );
      return {
        rows: rows.map((row) => ({
          value: row.id,
          label: row.title,
          detail: row.id,
        })),
        total: rows.length,
        next: null,
      } as T;
    }
    throw new Error(`示例服务尚未配置：${endpoint}`);
  },
  async report(query, options) {
    if (fixtureScenarios.reportDelay)
      await new Promise((resolve) =>
        setTimeout(resolve, fixtureScenarios.reportDelay),
      );
    if (fixtureScenarios.failReport) {
      fixtureScenarios.failReport = false;
      throw new Error("示例读取失败，当前范围已保留，请重试");
    }
    return fixtureReport(JSON.parse(JSON.stringify(query)), options);
  },
  upload: fixtureUpload,
  fileDisplayUrl: fixtureFileDisplayUrl,
};
