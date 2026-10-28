export const movementLabels: Record<string, string> = {
  Receive: "入库",
  Issue: "出库",
  Loss: "遗失",
  Transfer: "调拨",
  Loan: "借出",
  Return: "归还",
  Damage: "损坏",
  Repair: "修复归库",
  Disposal: "报废",
  Reconcile: "盘点调整",
  Opening: "期初库存",
};

export const operationLabels = Object.fromEntries(
  Object.entries(movementLabels).filter(
    ([kind]) => kind !== "Reconcile" && kind !== "Opening",
  ),
) as Record<string, string>;

export const recoveryLabels: Record<string, Record<string, string>> = {
  docstatus: { "0": "草稿", "1": "已提交", "2": "已取消" },
  kind: movementLabels,
  ti_movement_kind: movementLabels,
  review_state: { Reviewed: "已核对", Unreviewed: "未核对" },
  ti_count_scope: { Selected: "选择的物品", "Full Location": "完整库位" },
  ti_time_mode: {
    Manual: "手动指定",
    Now: "使用当前时间",
    manual: "手动指定",
    current: "使用当前时间",
  },
  status: {
    Active: "启用",
    Archived: "已归档",
    Inactive: "停用",
    Draft: "草稿",
    Submitted: "已提交",
    Completed: "已完成",
    Cancelled: "已取消",
    Current: "当前",
    Manual: "手动指定",
    draft: "草稿",
    completed: "已完成",
    cancelled: "已取消",
    current: "当前",
    manual: "手动指定",
  },
};

export const reportLoanStatusLabels: Record<string, string> = {
  open: "未结清",
  outstanding: "未结清",
  settled: "已结清",
  returned: "已归还",
  damaged: "损坏结清",
  lost: "遗失结清",
  draft: "草稿",
};
export const reportOutcomeLabels: Record<string, string> = {
  returned: "正常归还",
  damaged: "损坏",
  lost: "遗失",
  outstanding: "未归还",
};

const documentTypeLabels: Record<string, string> = {
  "Stock Entry": "库存流动",
  "Stock Reconciliation": "盘点调整",
  "Purchase Receipt": "采购收货",
  "Delivery Note": "销售发货",
};

const documentStatusLabels: Record<string, string> = {
  "0": "草稿",
  Draft: "草稿",
  草稿: "草稿",
  "1": "已提交",
  Submitted: "已提交",
  已提交: "已提交",
  "2": "已取消",
  Cancelled: "已取消",
  Canceled: "已取消",
  已取消: "已取消",
};

export function nativeStatusLabel(value: unknown): string {
  return documentStatusLabels[String(value)] || "状态未知";
}

const activityStatusLabels: Record<string, string> = {
  Active: "进行中",
  Archived: "已归档",
  Completed: "已完成",
  进行中: "进行中",
  已归档: "已归档",
  已完成: "已完成",
};

const loanStatusLabels: Record<string, string> = {
  Draft: "草稿",
  Cancelled: "已取消",
  Open: "未结清",
  Settled: "已结清",
  Closed: "已结清",
  未结清: "未结清",
  已结清: "已结清",
};

const outcomeLabels: Record<string, string> = {
  outstanding: "未归还",
  Outstanding: "未归还",
  returned: "完好归还",
  Returned: "完好归还",
  damaged: "损坏归还",
  Damaged: "损坏归还",
  lost: "遗失",
  Lost: "遗失",
};

const reviewLabels: Record<string, string> = {
  Unreviewed: "尚未核对",
  Reviewed: "已核对",
};

const countScopeLabels: Record<string, string> = {
  Selected: "选定物品",
  "Full Location": "整个库位",
};

const relationshipLabels: Record<string, string> = {
  direct: "直接关联",
  "via original loan": "经原借出关联",
  indirect: "经原借出关联",
};

/** Translate enum values for display while leaving IDs and query values untouched. */
export function enumPresentationLabel(
  field: string,
  value: unknown,
  options: { dataset?: string; view?: string } = {},
) {
  const raw = String(value ?? "");
  if (field === "kind") return movementLabels[raw] || "其他类型";
  if (field === "docstatus") return documentStatusLabels[raw] || "状态未知";
  if (field === "doctype") return documentTypeLabels[raw] || "库存记录";
  if (field === "outcome" || field === "outcome_key")
    return outcomeLabels[raw] || "处理结果未知";
  if (field === "loan_status") return loanStatusLabels[raw] || "借用状态未知";
  if (field === "status") {
    if (options.dataset === "activities" && options.view === "metadata")
      return activityStatusLabels[raw] || "状态未知";
    if (options.dataset === "loans" && options.view === "records")
      return loanStatusLabels[raw] || "借用状态未知";
    if (activityStatusLabels[raw]) return activityStatusLabels[raw];
    if (loanStatusLabels[raw]) return loanStatusLabels[raw];
    if (documentStatusLabels[raw]) return documentStatusLabels[raw];
    return "状态未知";
  }
  if (field === "review_state") return reviewLabels[raw] || "核对状态未知";
  if (field === "count_scope") return countScopeLabels[raw] || "盘点范围未知";
  if (field === "relationship")
    return relationshipLabels[raw] || "关联方式未知";
  return raw || "未指定";
}

export function tablePresentationLabel(field: string, value: unknown): unknown {
  const label = enumPresentationLabel(field, value);
  return label === "未指定" ? value : label;
}
