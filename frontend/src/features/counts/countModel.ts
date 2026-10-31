export type ReviewState = "Unreviewed" | "Reviewed";
export interface CountRow {
  name?: string;
  item_code: string;
  item_name?: string;
  image?: string;
  ti_display_item_name?: string;
  ti_display_image?: string;
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
  baselineTimestamp: string;
  ti_count_review: CountRow[];
  items: Record<string, unknown>[];
  ti_activity: string;
  ti_recorder_name: string;
  ti_handler_name: string;
  ti_reviewer_name: string;
  ti_notes: string;
  [field: string]: unknown;
}
export function countKey(row: CountRow) {
  return JSON.stringify([row.item_code, row.warehouse, row.batch_no || ""]);
}
export function countSummary(rows: CountRow[]) {
  const baseline = new Map<string, number>(),
    actual = new Map<string, number>(),
    difference = new Map<string, number>(),
    gains = new Map<string, number>(),
    losses = new Map<string, number>();
  let reviewed = 0;
  let changed = 0;
  for (const row of rows) {
    const unit = row.stock_uom;
    baseline.set(unit, (baseline.get(unit) || 0) + row.baseline_qty);
    if (row.review_state === "Unreviewed" || row.actual_qty === null) continue;
    reviewed++;
    actual.set(unit, (actual.get(unit) || 0) + row.actual_qty);
    const delta = row.actual_qty - row.baseline_qty;
    if (delta !== 0) changed++;
    difference.set(unit, (difference.get(unit) || 0) + delta);
    if (delta > 0) gains.set(unit, (gains.get(unit) || 0) + delta);
    else if (delta < 0) losses.set(unit, (losses.get(unit) || 0) + delta);
  }
  return {
    total: rows.length,
    reviewed,
    changed,
    unreviewed: rows.length - reviewed,
    baseline: [...baseline],
    actual: [...actual],
    difference: [...difference],
    gains: [...gains],
    losses: [...losses],
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
    if (message) issues.push({ key: countKey(row), message });
  }
  return issues;
}
