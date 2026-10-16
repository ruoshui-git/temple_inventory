import { activityTypeLabel } from "./activityData";
import { movementLabels } from "./browseModel";
import { newReportQuery, type ReportQuery } from "./reportModel";
import { reviewSession } from "./reviewModel";

export interface ReportFilterChip {
  key: string;
  label: string;
  summary?: string;
  reset: Partial<ReportQuery>;
  fixed?: boolean;
}
export function hasReportStatuses(query: ReportQuery) {
  return (
    ["movements", "counts", "loans"].includes(query.dataset) ||
    (query.dataset === "activities" && query.view === "records")
  );
}
const loanLabels: Record<string, string> = {
  open: "未结清",
  outstanding: "未结清",
  settled: "已结清",
  returned: "已归还",
  damaged: "损坏结清",
  lost: "遗失结清",
  draft: "草稿",
};
const outcomeLabels: Record<string, string> = {
  returned: "正常归还",
  damaged: "损坏",
  lost: "遗失",
  outstanding: "未归还",
};
const itemLabel = (code: string) => {
  const name = reviewSession.stock.find((item) => item.code === code)?.name;
  return name ? `${name}（${code}）` : code;
};
function allocationLabel(key: string) {
  const slash = key.indexOf("/");
  return slash < 0
    ? key
    : `${itemLabel(key.slice(0, slash))} / ${key.slice(slash + 1)}`;
}
// Presentation only: preserve enable flags, even when an inherited restriction is empty.
export function reportFilterChips(query: ReportQuery): ReportFilterChip[] {
  const chips: ReportFilterChip[] = [];
  const add = (
    key: string,
    label: string,
    reset: Partial<ReportQuery>,
    fixed = false,
    summary?: string,
  ) => chips.push({ key, label, reset, fixed, summary });
  if (hasReportStatuses(query)) {
    const isDefault = query.statuses.length === 1 && query.statuses[0] === 1;
    add(
      "statuses",
      `单据状态：${query.statuses.map((status) => ["草稿", "已提交", "已取消"][status]).join("、") || "未选择（无结果）"}`,
      { statuses: [1] },
      isDefault,
    );
  }
  if (["inventory", "expiry"].includes(query.dataset) && query.includeZero)
    add("includeZero", "包含零库存", { includeZero: false });
  if (
    query.dataset === "expiry" &&
    query.expiryWindow === "period" &&
    query.scope.period.key === "all"
  )
    add(
      "includeUndated",
      query.includeUndated ? "全部日期中包含无效期" : "全部日期中不包含无效期",
      { includeUndated: true },
      query.includeUndated,
    );
  if (query.activityStatus !== "all")
    add(
      "activityStatus",
      `活动状态：${query.activityStatus === "active" ? "进行中" : "已归档"}`,
      { activityStatus: "all" },
    );
  if (query.typeId)
    add("typeId", `活动类型：${activityTypeLabel(query.typeId)}`, {
      typeId: "",
    });
  if (query.countReviewed !== "all")
    add(
      "countReviewed",
      `核对状态：${query.countReviewed === "reviewed" ? "已核对" : "未核对"}`,
      { countReviewed: "all" },
    );
  if (query.record) add("record", `限定单据：${query.record}`, { record: "" });
  if (query.loan) add("loan", `原借用：${query.loan}`, { loan: "" });
  if (query.restrictItems || query.itemCodes.length)
    add(
      "items",
      `选定物品（${query.itemCodes.length}）：${query.itemCodes.map(itemLabel).join("、") || "范围为空（无结果）"}`,
      { restrictItems: false, itemCodes: [] },
      false,
      query.itemCodes.length > 1
        ? `选定物品（${query.itemCodes.length}）`
        : undefined,
    );
  if (query.restrictAllocations || query.allocationKeys.length)
    add(
      "allocations",
      `选定分配（${query.allocationKeys.length}）：${query.allocationKeys.map(allocationLabel).join("；") || "范围为空（无结果）"}`,
      { restrictAllocations: false, allocationKeys: [] },
      false,
      query.allocationKeys.length > 1
        ? `选定分配（${query.allocationKeys.length}）`
        : undefined,
    );
  if (query.itemLocationKeys.length)
    add(
      "itemLocations",
      `物品 / 库位：${query.itemLocationKeys.map(allocationLabel).join("；")}`,
      { itemLocationKeys: [] },
      false,
      query.itemLocationKeys.length > 1
        ? `物品 / 库位（${query.itemLocationKeys.length}）`
        : undefined,
    );
  if (query.loanStatus !== "all")
    add(
      "loanStatus",
      `借用状态：${loanLabels[query.loanStatus] || query.loanStatus}`,
      { loanStatus: "all" },
    );
  if (query.loanOutcome !== "all")
    add(
      "loanOutcome",
      `借用结果：${outcomeLabels[query.loanOutcome] || query.loanOutcome}`,
      { loanOutcome: "all" },
    );
  if (query.damageOnly)
    add("damageOnly", "仅有损坏库存", { damageOnly: false });
  if (query.activityKind)
    add(
      "activityKind",
      `包含流动：${movementLabels[query.activityKind] || query.activityKind}`,
      { activityKind: "" },
    );
  if (query.relatedPresence !== "all")
    add(
      "relatedPresence",
      query.relatedPresence === "yes" ? "有关联记录" : "无关联记录",
      { relatedPresence: "all" },
    );
  if (query.outstandingOnly)
    add("outstandingOnly", "仅有未归还借用", { outstandingOnly: false });
  return chips;
}
export function clearReportSecondaryFilters(query: ReportQuery) {
  // Date/window, primary search, dataset/view and result presentation have their own controls.
  const defaults = newReportQuery(query.dataset);
  for (const chip of reportFilterChips(query)) Object.assign(query, chip.reset);
  query.includeUndated = defaults.includeUndated;
}
