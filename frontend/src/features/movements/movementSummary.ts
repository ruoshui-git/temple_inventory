import { movementLabels } from "../../lib/presentationLabels";
import type { ReportRow } from "../../lib/reportContract";
import { sortByUnit } from "../../lib/units";

const MOVEMENT_ORDER = [
  "Receive",
  "Issue",
  "Transfer",
  "Loan",
  "Return",
  "Damage",
  "Loss",
  "Repair",
  "Disposal",
  "Opening",
  "Reconcile",
];

export function movementSummaryMetrics(rows: ReportRow[]) {
  return MOVEMENT_ORDER.flatMap((kind) => {
    const matching = rows.filter((row) => row.kind === kind);
    if (!matching.length) return [];
    const quantities = new Map<
      string,
      { uom: string; qty: number; status?: string; effect: number }
    >();
    const statuses = new Set<string>();
    for (const row of matching) {
      const status =
        Number(row.docstatus) === 0
          ? "草稿"
          : Number(row.docstatus) === 2
            ? "已取消"
            : undefined;
      const uom = String(row.stock_uom);
      const key = `${uom}:${status || ""}`;
      const quantity = quantities.get(key) || {
        uom,
        status,
        qty: 0,
        effect: 0,
      };
      quantity.qty += Number(row.stock_qty || 0);
      quantity.effect += Number(row.available_effect || 0);
      quantities.set(key, quantity);
      statuses.add(status || "已提交");
    }
    for (const quantity of quantities.values()) {
      if (!quantity.status && statuses.size > 1) quantity.status = "已提交";
    }
    return [
      {
        key: kind,
        label: movementLabels[kind] || kind,
        quantities: sortByUnit(
          [...quantities.values()],
          (quantity) => quantity.uom,
        ),
        tone:
          [...quantities.values()].length > 0 &&
          [...quantities.values()].every((value) => value.effect > 0)
            ? ("success" as const)
            : [...quantities.values()].length > 0 &&
                [...quantities.values()].every((value) => value.effect < 0)
              ? ("danger" as const)
              : ("neutral" as const),
      },
    ];
  });
}

const OUTCOME_ORDER = ["outstanding", "returned", "damaged", "lost"];
const OUTCOME_LABELS: Record<string, string> = {
  outstanding: "未归还",
  returned: "完好归还",
  damaged: "损坏归还",
  lost: "遗失",
};

export function loanSummaryMetrics(rows: ReportRow[], records: boolean) {
  const groups = records
    ? [{ key: "outstanding", label: "未归还", rows }]
    : OUTCOME_ORDER.flatMap((outcome) => {
        const matching = rows.filter((row) => row.outcome_key === outcome);
        return matching.length
          ? [
              {
                key: outcome,
                label: OUTCOME_LABELS[outcome] || outcome,
                rows: matching,
              },
            ]
          : [];
      });
  return groups.map(({ key, label, rows: matching }) => {
    const quantities = new Map<
      string,
      { uom: string; qty: number; status?: string }
    >();
    const statuses = new Set<string>();
    for (const row of matching) {
      const docstatus = Number(row.docstatus);
      const statusKey =
        docstatus === 0 ? "draft" : docstatus === 2 ? "cancelled" : "submitted";
      const status = records
        ? undefined
        : statusKey === "draft"
          ? "草稿"
          : statusKey === "cancelled"
            ? "已取消"
            : "";
      const uom = String(row.stock_uom);
      const rowKey = `${uom}:${records ? statusKey : status}`;
      const quantity = quantities.get(rowKey) || {
        uom,
        qty: 0,
        status: status || undefined,
      };
      quantity.qty +=
        Number(
          records
            ? docstatus === 0 || docstatus === 2
              ? row.borrowed
              : row.outstanding
            : row.stock_qty,
        ) || 0;
      quantities.set(rowKey, quantity);
      statuses.add(statusKey);
    }
    if (records && statuses.size > 1) {
      for (const [rowKey, quantity] of quantities) {
        const statusKey = rowKey.slice(rowKey.lastIndexOf(":") + 1);
        quantity.status =
          statusKey === "draft"
            ? "计划借出（草稿）"
            : statusKey === "cancelled"
              ? "已取消"
              : "未归还";
      }
      return {
        key,
        label: "借用数量",
        quantities: sortByUnit(
          [...quantities.values()],
          (quantity) => quantity.uom,
        ),
        tone: "neutral" as const,
      };
    }
    if (!records && statuses.size > 1) {
      for (const quantity of quantities.values()) {
        if (!quantity.status) quantity.status = "已提交";
      }
    }
    const recordStatus = statuses.values().next().value;
    const summaryLabel =
      records && recordStatus === "draft"
        ? "计划借出"
        : records && recordStatus === "cancelled"
          ? "已取消借用"
          : label;
    return {
      key,
      label: summaryLabel,
      quantities: sortByUnit(
        [...quantities.values()],
        (quantity) => quantity.uom,
      ),
      tone: "neutral" as const,
    };
  });
}
