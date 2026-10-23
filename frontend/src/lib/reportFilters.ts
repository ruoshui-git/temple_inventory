import type { ReferenceData } from "../services/contracts";
import { movementLabels } from "./filterPresentation";
import { warehouseLabel } from "./warehouseLabel";
import { newReportQuery, type ReportQuery } from "./reportContract";
export interface ReportFilterChip {
  key: string;
  label: string;
  field?: string;
  summary?: string;
  reset: Partial<ReportQuery>;
  fixed?: boolean;
}
export function hasReportStatuses(query: ReportQuery) {
  return (
    ["movements", "counts"].includes(query.dataset) ||
    (query.dataset === "loans" && query.view !== "items") ||
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
// Presentation only: preserve enable flags, even when an inherited restriction is empty.
export function reportFilterChips(
  query: ReportQuery,
  reference: ReferenceData,
): ReportFilterChip[] {
  const itemLabel = (code: string) => {
    const name = reference.items.find((row) => row.value === code)?.label;
    return name ? `${name}（${code}）` : code;
  };
  const allocationLabel = (key: string, itemLocation = false) => {
    const inventoryIdentity =
      itemLocation || ["inventory", "expiry"].includes(query.dataset);
    try {
      const parts = JSON.parse(key);
      if (Array.isArray(parts)) {
        if (inventoryIdentity && parts.length === (itemLocation ? 2 : 3))
          return [
            itemLabel(String(parts[0])),
            warehouseLabel(parts[1], reference.warehouses),
            ...(!itemLocation ? [parts[2] || "无批次"] : []),
          ].join(" / ");
        return parts.map(String).join(" / ");
      }
    } catch {
      /* Native line IDs remain readable text. */
    }
    // Legacy keys can contain slashes in either native Item or Warehouse names.
    // Only format an unambiguous, authorized warehouse match; never change the key.
    if (inventoryIdentity) {
      const matches = reference.warehouses.flatMap((node) => {
        const suffix = `/${node.name}`;
        const start = itemLocation
          ? key.length - suffix.length
          : key.indexOf(suffix + "/");
        if (start <= 0 || (itemLocation && !key.endsWith(suffix))) return [];
        return [
          {
            item: key.slice(0, start),
            warehouse: node.name,
            batch: itemLocation ? "" : key.slice(start + suffix.length + 1),
          },
        ];
      });
      if (matches.length === 1) {
        const match = matches[0]!;
        return [
          itemLabel(match.item),
          warehouseLabel(match.warehouse, reference.warehouses),
          ...(!itemLocation ? [match.batch || "无批次"] : []),
        ].join(" / ");
      }
      return "所选存放明细（位置暂不可用）";
    }
    const slash = key.indexOf("/");
    return slash < 0
      ? key
      : `${itemLabel(key.slice(0, slash))} / ${key.slice(slash + 1)}`;
  };
  const activityTypeLabel = (id: string) =>
    reference.activityTypes.find((row) => row.value === id)?.label || id;
  const chips: ReportFilterChip[] = [];
  const add = (
    key: string,
    label: string,
    reset: Partial<ReportQuery>,
    fixed = false,
    summary?: string,
  ) => {
    const fieldByKey: Record<string, string> = {
      statuses: "status",
      includeZero: "includeZero",
      includeUndated: "includeUndated",
      includeAdjustments: "includeAdjustments",
      activityStatus: "activityStatus",
      typeId: "typeId",
      countReviewed: "countReviewed",
      record: "record",
      batchNo: "batchNo",
      loan: "loan",
      items: "item",
      allocations: "allocations",
      itemLocations: "itemLocations",
      loanStatus: "status",
      loanOutcome: "loanOutcome",
      damageOnly: "damageOnly",
      activityKind: "activityKind",
      relatedPresence: "relatedPresence",
      outstandingOnly: "outstandingOnly",
      expiryWindow: "expiryWindow",
    };
    chips.push({
      key,
      label,
      field: fieldByKey[key] || key,
      reset,
      fixed,
      summary,
    });
  };
  if (hasReportStatuses(query)) {
    const isDefault = query.statuses.length === 1 && query.statuses[0] === 1;
    add(
      "statuses",
      `单据状态：${query.statuses.map((status) => ["草稿", "已提交", "已取消"][status]).join("、") || "未选择（无结果）"}`,
      { statuses: [1] },
      isDefault,
    );
  }
  if (
    (["inventory", "expiry"].includes(query.dataset) ||
      (query.dataset === "loans" && query.view === "items")) &&
    query.includeZero
  )
    add(
      "includeZero",
      query.dataset === "loans" ? "显示已结清物品" : "包含零库存",
      { includeZero: false },
    );
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
  if (!query.includeAdjustments)
    add("includeAdjustments", "不含期初与库存调整", {
      includeAdjustments: true,
    });
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
  if (query.dataset === "expiry" && query.expiryWindow !== "period") {
    const labels: Record<string, string> = {
      next_7: "未来7天",
      next_30: "未来30天",
      next_90: "未来90天",
      next_365: "未来365天",
      expired: "已过期",
      undated: "无效期",
    };
    add(
      "expiryWindow",
      `到期窗口：${labels[query.expiryWindow] || query.expiryWindow}`,
      {
        expiryWindow: "period",
      },
    );
  }
  if (query.record || query.recordDoctype)
    add(
      "record",
      `限定单据：${query.recordDoctype ? query.recordDoctype + " · " : ""}${query.record}`,
      { record: "", recordDoctype: "" },
    );
  if (query.batchNo) add("batchNo", `批次：${query.batchNo}`, { batchNo: "" });
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
      `选定明细（${query.allocationKeys.length}）：${query.allocationKeys.map((key) => allocationLabel(key)).join("；") || "范围为空（无结果）"}`,
      { restrictAllocations: false, allocationKeys: [] },
      false,
      query.allocationKeys.length > 1
        ? `选定明细（${query.allocationKeys.length}）`
        : undefined,
    );
  if (query.itemLocationKeys.length)
    add(
      "itemLocations",
      `物品 / 库位：${query.itemLocationKeys.map((key) => allocationLabel(key, true)).join("；")}`,
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
export function clearReportSecondaryFilters(
  query: ReportQuery,
  reference: ReferenceData,
) {
  // Date/window, primary search, dataset/view and result presentation have their own controls.
  const defaults = newReportQuery(query.dataset);
  for (const chip of reportFilterChips(query, reference))
    Object.assign(query, chip.reset);
  query.includeUndated = defaults.includeUndated;
}
