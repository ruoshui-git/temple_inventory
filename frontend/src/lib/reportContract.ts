import { emptyScope, type BrowseScope, type DatePeriod } from "./browseQuery";
export type ReportDataset =
  "inventory" | "expiry" | "movements" | "loans" | "activities" | "counts";
export type ReportRow = Record<string, string | number | boolean | null>;
export interface ReportTable {
  id: string;
  label: string;
  columns: string[];
  rows: ReportRow[];
}
export interface MovementHistoryRow extends Record<
  string,
  string | number | boolean | null
> {
  id: string;
  doctype: "Stock Entry" | "Stock Reconciliation";
  document: string;
  item_code: string;
  item_name: string;
  date_time: string;
  kind: string;
  source_warehouse: string;
  destination_warehouse: string;
  stock_uom: string;
  docstatus: number;
  quantity: number;
  available_effect: number;
  loan_balance_effect: number;
  borrower: string;
}
export interface MovementHistoryPage {
  rows: MovementHistoryRow[];
  matched_count: number;
  next_start: number | null;
  history_complete?: boolean;
}
export interface LoanItemHistoryRow extends Record<
  string,
  string | number | boolean | null
> {
  id: string;
  doctype: "Stock Entry";
  document: string;
  item_code: string;
  item_name: string;
  date_time: string;
  borrower: string;
  source_warehouse: string;
  destination_warehouse: string;
  stock_uom: string;
  docstatus: number;
  kind: "Loan";
  borrowed: number;
  outstanding: number;
}
export interface ReportDefinition {
  label: string;
  views: { id: string; label: string }[];
  groups: string[];
  dateLabel: string;
}
export const reportDefinitions: Record<ReportDataset, ReportDefinition> = {
  inventory: {
    label: "库存",
    views: [
      { id: "summary", label: "物品汇总" },
      { id: "locations", label: "库位 / 批次明细" },
      { id: "historical", label: "历史数量余额" },
    ],
    groups: ["item", "category", "location"],
    dateLabel: "历史记账日期",
  },
  expiry: {
    label: "效期 / 批次",
    views: [{ id: "batches", label: "批次 / 库位" }],
    groups: ["item", "category", "location"],
    dateLabel: "到期日期",
  },
  movements: {
    label: "货物流动",
    views: [
      { id: "summary", label: "流动汇总" },
      { id: "records", label: "单据记录" },
      { id: "lines", label: "库存明细" },
    ],
    groups: ["item", "category", "location", "kind", "activity", "month"],
    dateLabel: "记账日期",
  },
  loans: {
    label: "借用",
    views: [
      { id: "records", label: "借用记录" },
      { id: "items", label: "物品结余" },
      { id: "outcomes", label: "物品 / 处理结果" },
      { id: "settlements", label: "结算明细" },
    ],
    groups: ["item", "activity", "borrower", "month"],
    dateLabel: "借出日期 · 余额为当前结算状态",
  },
  activities: {
    label: "活动",
    views: [
      { id: "metadata", label: "活动资料" },
      { id: "records", label: "关联记录" },
      { id: "loans", label: "借用结余" },
    ],
    groups: ["activity", "kind"],
    dateLabel: "活动开始日期",
  },
  counts: {
    label: "盘点",
    views: [
      { id: "records", label: "盘点记录" },
      { id: "lines", label: "盘点差异明细" },
    ],
    groups: ["item", "location", "month"],
    dateLabel: "盘点 / 记账日期",
  },
};
export const groupLabels: Record<string, string> = {
  item: "物品",
  category: "类别",
  location: "库位",
  kind: "流动类型",
  activityType: "活动类型",
  activity: "活动",
  borrower: "借用方",
  month: "月份",
  status: "单据状态",
  outcome: "处理结果",
  source: "来源位置",
  destination: "目标位置",
};
export function groupsForView(dataset: ReportDataset, view: string): string[] {
  const key = `${dataset}:${view}`;
  const groups: Record<string, string[]> = {
    "inventory:summary": ["category", "item"],
    "inventory:locations": ["category", "item", "location"],
    "inventory:historical": ["category", "item", "location", "month"],
    "expiry:batches": ["category", "item", "location"],
    "movements:summary": ["item", "category"],
    "movements:records": ["kind", "status", "activity", "month"],
    "movements:lines": [
      "item",
      "category",
      "source",
      "destination",
      "kind",
      "activity",
      "month",
    ],
    "loans:records": ["borrower", "activity", "status", "month"],
    "loans:items": ["item", "category"],
    "loans:outcomes": ["item", "borrower", "activity", "outcome", "month"],
    "loans:settlements": ["item", "borrower", "activity", "outcome", "month"],
    "activities:metadata": ["activityType", "status"],
    "activities:records": ["kind", "status", "month"],
    "activities:loans": ["item", "borrower", "activity", "outcome", "month"],
    "counts:records": ["kind", "status", "month"],
    "counts:lines": ["item", "location", "month"],
  };
  return groups[key] ?? [];
}
export function groupSequencesForView(
  dataset: ReportDataset,
  view: string,
): string[][] {
  if (
    (dataset === "movements" && view === "summary") ||
    (dataset === "loans" && view === "items")
  )
    return [[], ["item"], ["category", "item"]];
  const fields = groupsForView(dataset, view);
  return [
    [],
    ...fields.map((field) => [field]),
    ...fields.flatMap((first) =>
      fields
        .filter((second) => second !== first)
        .map((second) => [first, second]),
    ),
  ];
}
export const sortableColumnsByView: Record<string, string[]> = {
  "inventory:summary": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "available",
    "loaned",
    "damaged",
    "stock_qty",
  ],
  "inventory:locations": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "warehouse_label",
    "batch_no",
    "available",
    "loaned",
    "damaged",
    "stock_qty",
  ],
  "inventory:historical": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "warehouse",
    "period_from",
    "period_to",
    "opening",
    "incoming",
    "outgoing",
    "adjustment",
    "closing",
  ],
  "expiry:batches": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "warehouse",
    "batch_no",
    "expiry_date",
    "remaining_days",
    "stock_qty",
  ],
  "movements:summary": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "kind",
    "docstatus",
    "stock_qty",
    "available_effect",
  ],
  "movements:records": [
    "identity",
    "document",
    "doctype",
    "kind",
    "docstatus",
    "date",
    "time",
    "modified",
    "item_count",
    "stock_uom",
  ],
  "movements:lines": [
    "identity",
    "document",
    "doctype",
    "item_name",
    "item_code",
    "category",
    "kind",
    "docstatus",
    "date",
    "time",
    "source_warehouse",
    "destination_warehouse",
    "stock_uom",
    "activity",
    "borrower",
    "stock_qty",
    "available_effect",
  ],
  "loans:records": [
    "identity",
    "document",
    "doctype",
    "borrower",
    "activity_title",
    "loan_status",
    "date",
    "time",
    "modified",
    "stock_uom",
    "outstanding",
  ],
  "loans:items": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "outstanding",
    "borrowed",
    "returned",
    "damaged",
    "lost",
  ],
  "loans:outcomes": [
    "identity",
    "document",
    "doctype",
    "item_name",
    "item_code",
    "category",
    "kind",
    "docstatus",
    "date",
    "time",
    "source_warehouse",
    "destination_warehouse",
    "stock_uom",
    "borrower",
    "activity_title",
    "outcome",
    "outstanding",
    "borrowed",
  ],
  "loans:settlements": [
    "identity",
    "document",
    "doctype",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "borrower",
    "activity_title",
    "outcome",
    "date",
    "stock_qty",
  ],
  "activities:metadata": [
    "identity",
    "title",
    "activity_type_label",
    "status",
    "start_date",
    "end_date",
    "document_count",
  ],
  "activities:records": [
    "identity",
    "document",
    "doctype",
    "kind",
    "docstatus",
    "date",
    "time",
    "modified",
    "activity_title",
  ],
  "activities:loans": [
    "identity",
    "document",
    "doctype",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "borrower",
    "activity_title",
    "outcome",
    "date",
    "outstanding",
  ],
  "counts:records": [
    "identity",
    "document",
    "doctype",
    "kind",
    "docstatus",
    "date",
    "time",
    "modified",
    "item_count",
    "stock_uom",
    "difference",
  ],
  "counts:lines": [
    "identity",
    "item_name",
    "item_code",
    "category",
    "stock_uom",
    "warehouse",
    "kind",
    "date",
    "baseline_qty",
    "actual_qty",
    "difference",
  ],
};
export const sortableColumnLabels: Record<string, string> = {
  identity: "编号",
  item_name: "物品名称",
  item_code: "物品编码",
  category: "类别",
  stock_uom: "库存单位",
  modified: "更新时间",
  warehouse: "库位",
  warehouse_label: "库位",
  batch_no: "批次",
  expiry_date: "到期日期",
  remaining_days: "剩余天数",
  available: "可用量",
  loaned: "借用量",
  damaged: "损坏量",
  stock_qty: "库存数量",
  opening: "期初余额",
  incoming: "入库量",
  outgoing: "出库量",
  adjustment: "调整量",
  closing: "期末余额",
  kind: "类型",
  docstatus: "状态",
  date: "日期",
  time: "时间",
  source: "来源",
  source_warehouse: "来源位置",
  destination_warehouse: "目标位置",
  document: "单据编号",
  doctype: "单据类型",
  borrower: "借用方",
  activity: "活动",
  activity_title: "活动",
  activity_type_label: "活动类型",
  loan_status: "借用状态",
  outcome: "处理结果",
  outstanding: "未归还量",
  borrowed: "借出量",
  returned: "归还量",
  lost: "遗失量",
  title: "活动名称",
  status: "状态",
  start_date: "开始日期",
  end_date: "结束日期",
  document_count: "单据数",
  item_count: "物品数",
  period_from: "期间开始",
  period_to: "期间结束",
  available_effect: "可用量变化",
  baseline_qty: "盘点基准",
  actual_qty: "实际数量",
  difference: "差异量",
};
export function sortableColumnsForView(
  dataset: ReportDataset,
  view: string,
): string[] {
  return sortableColumnsByView[`${dataset}:${view}`] ?? ["identity"];
}
export interface ReportQuery {
  dataset: ReportDataset;
  view: string;
  scope: BrowseScope;
  search: string;
  batchNo: string;
  batchNoExact: boolean;
  groupBy: string[];
  sort: "asc" | "desc";
  sortBy: string;
  statuses: number[];
  includeAdjustments: boolean;
  includeZero: boolean;
  includeUndated: boolean;
  activityStatus: "all" | "active" | "archived";
  typeId: string;
  record: string;
  recordDoctype: string;
  loan: string;
  itemCodes: string[];
  restrictItems: boolean;
  itemLocationKeys: string[];
  relatedPeriod: DatePeriod;
  relatedSearch: string;
  loanStatus: string;
  loanOutcome: string;
  expiryWindow: string;
  countReviewed: string;
  allocationKeys: string[];
  restrictAllocations: boolean;
  damageOnly: boolean;
  activityKind: string;
  relatedPresence: string;
  outstandingOnly: boolean;
}
export function newReportQuery(
  dataset: ReportDataset = "inventory",
): ReportQuery {
  const view = reportDefinitions[dataset].views[0]!.id;
  return {
    dataset,
    view,
    scope: emptyScope(),
    search: "",
    batchNo: "",
    batchNoExact: false,
    groupBy: [],
    sort: "asc",
    sortBy: "identity",
    statuses: [1],
    includeAdjustments: true,
    includeZero: false,
    includeUndated: true,
    activityStatus: "all",
    typeId: "",
    record: "",
    recordDoctype: "",
    loan: "",
    itemCodes: [],
    restrictItems: false,
    itemLocationKeys: [],
    relatedPeriod: { key: "all", from: "", to: "" },
    relatedSearch: "",
    loanStatus: "all",
    loanOutcome: "all",
    expiryWindow: "period",
    countReviewed: "all",
    allocationKeys: [],
    restrictAllocations: false,
    damageOnly: false,
    activityKind: "",
    relatedPresence: "all",
    outstandingOnly: false,
  };
}
