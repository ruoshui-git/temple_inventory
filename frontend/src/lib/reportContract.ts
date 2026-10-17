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
      { id: "lines", label: "分配明细" },
    ],
    groups: ["item", "category", "location", "kind", "activity", "month"],
    dateLabel: "记账日期",
  },
  loans: {
    label: "借用",
    views: [
      { id: "records", label: "借用记录" },
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
  none: "不分组",
  item: "物品",
  category: "类别",
  location: "库位",
  kind: "流动类型",
  activity: "活动",
  borrower: "借用方",
  month: "月份",
};
export interface ReportQuery {
  dataset: ReportDataset;
  view: string;
  scope: BrowseScope;
  search: string;
  grouping: string;
  sort: "asc" | "desc";
  sortBy: "identity" | "date" | "modified" | "quantity" | "name";
  statuses: number[];
  includeAdjustments: boolean;
  includeZero: boolean;
  includeUndated: boolean;
  activityStatus: "all" | "active" | "archived";
  typeId: string;
  record: string;
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
  return {
    dataset,
    view: reportDefinitions[dataset].views[0]!.id,
    scope: emptyScope(),
    search: "",
    grouping: "none",
    sort: "asc",
    sortBy: "identity",
    statuses: [1],
    includeAdjustments: true,
    includeZero: false,
    includeUndated: true,
    activityStatus: "all",
    typeId: "",
    record: "",
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
