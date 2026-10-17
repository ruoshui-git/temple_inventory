export type ReviewState = "Unreviewed" | "Reviewed" | "Not Found";
export interface CountRow {
  name?: string;
  item_code: string;
  warehouse: string;
  batch_no: string | null;
  stock_uom: string;
  baseline_qty: number;
  actual_qty: number | null;
  review_state: ReviewState;
  reason: string;
  needs_review?: boolean;
  [field: string]: unknown;
}
export interface CountValues {
  posting_date: string;
  posting_time: string;
  ti_count_warehouse: string;
  ti_count_scope: "Selected" | "Full Location";
  ti_count_items: string[];
  ti_baseline_timestamp: string;
  ti_baseline_fingerprint: string;
  ti_count_review: CountRow[];
  items: Record<string, unknown>[];
  ti_activity: string;
  ti_recorder_name: string;
  ti_handler_name: string;
  ti_reviewer_name: string;
  remarks: string;
  [field: string]: unknown;
}
export function countKey(row: CountRow) {
  return JSON.stringify([row.item_code, row.warehouse, row.batch_no || ""]);
}
export function countSummary(rows: CountRow[]) {
  const baseline = new Map<string, number>(),
    actual = new Map<string, number>(),
    difference = new Map<string, number>();
  let reviewed = 0;
  for (const row of rows) {
    const unit = row.stock_uom;
    baseline.set(unit, (baseline.get(unit) || 0) + row.baseline_qty);
    if (row.review_state === "Unreviewed" || row.actual_qty === null) continue;
    reviewed++;
    actual.set(unit, (actual.get(unit) || 0) + row.actual_qty);
    difference.set(
      unit,
      (difference.get(unit) || 0) + row.actual_qty - row.baseline_qty,
    );
  }
  return {
    total: rows.length,
    reviewed,
    unreviewed: rows.length - reviewed,
    baseline: [...baseline],
    actual: [...actual],
    difference: [...difference],
  };
}
export function countIssues(
  rows: CountRow[],
  units: { name: string; whole: boolean }[],
) {
  const issues: { key: string; message: string }[] = [];
  for (const row of rows) {
    if (row.review_state === "Unreviewed") continue;
    let message = "";
    if (
      row.actual_qty === null ||
      !Number.isFinite(row.actual_qty) ||
      row.actual_qty < 0
    )
      message = "请填写非负实点数量，或清空为未核对";
    else if (
      units.find((unit) => unit.name === row.stock_uom)?.whole &&
      !Number.isInteger(row.actual_qty)
    )
      message = "库存单位要求整数实点数量";
    else if (
      Math.abs(row.actual_qty - Math.round(row.actual_qty * 1e6) / 1e6) > 1e-9
    )
      message = "实点数量精度超过允许范围";
    else if (row.review_state === "Not Found" && row.actual_qty !== 0)
      message = "未找到的实点数量必须为零";
    else if (row.actual_qty !== row.baseline_qty && !row.reason.trim())
      message = "请填写盘点差异原因";
    if (message) issues.push({ key: countKey(row), message });
  }
  return issues;
}
