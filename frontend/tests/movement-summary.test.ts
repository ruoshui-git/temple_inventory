import { describe, expect, it } from "vitest";
import {
  loanSummaryMetrics,
  movementSummaryMetrics,
} from "../src/features/movements/movementSummary";
import type { ReportRow } from "../src/lib/reportContract";

describe("movement quantity summary", () => {
  it("keeps canonical movement order, separates units and marks only draft/cancelled quantities", () => {
    const rows = [
      { kind: "Loss", stock_uom: "件", stock_qty: 2, docstatus: 1 },
      { kind: "Receive", stock_uom: "袋", stock_qty: 4, docstatus: 2 },
      { kind: "Receive", stock_uom: "箱", stock_qty: 3, docstatus: 0 },
      { kind: "Receive", stock_uom: "袋", stock_qty: 5, docstatus: 1 },
    ] as ReportRow[];

    const metrics = movementSummaryMetrics(rows);

    expect(metrics.map((metric) => metric.key)).toEqual(["Receive", "Loss"]);
    expect(metrics[0]?.quantities).toEqual([
      { uom: "袋", qty: 4, status: "已取消" },
      { uom: "箱", qty: 3, status: "草稿" },
      { uom: "袋", qty: 5, status: "已提交" },
    ]);
    expect(metrics[1]?.quantities).toEqual([
      { uom: "件", qty: 2, status: undefined },
    ]);
  });

  it("groups loan item outcomes and record outstanding totals across units and statuses", () => {
    const rows = [
      { outcome_key: "lost", stock_uom: "件", stock_qty: 1, docstatus: 1 },
      {
        outcome_key: "outstanding",
        stock_uom: "套",
        stock_qty: 2,
        docstatus: 1,
      },
      {
        outcome_key: "outstanding",
        stock_uom: "件",
        stock_qty: 3,
        docstatus: 0,
      },
      {
        outcome_key: "outstanding",
        stock_uom: "套",
        stock_qty: 4,
        docstatus: 1,
      },
      {
        outcome_key: "outstanding",
        stock_uom: "件",
        stock_qty: 5,
        docstatus: 2,
      },
    ] as ReportRow[];
    const itemMetrics = loanSummaryMetrics(rows, false);
    expect(itemMetrics.map((metric) => metric.label)).toEqual([
      "未归还",
      "遗失",
    ]);
    expect(itemMetrics[0]?.quantities).toEqual([
      { uom: "套", qty: 6, status: "已提交" },
      { uom: "件", qty: 3, status: "草稿" },
      { uom: "件", qty: 5, status: "已取消" },
    ]);
    const recordMetrics = loanSummaryMetrics(
      [
        { stock_uom: "件", docstatus: 0, borrowed: 2 },
        { stock_uom: "件", docstatus: 1, outstanding: 3 },
        { stock_uom: "套", docstatus: 2, borrowed: 4, outstanding: 0 },
      ] as ReportRow[],
      true,
    );
    expect(recordMetrics).toHaveLength(1);
    expect(recordMetrics[0]).toMatchObject({
      label: "借用数量",
      quantities: [
        { uom: "件", qty: 2, status: "计划借出（草稿）" },
        { uom: "件", qty: 3, status: "未归还" },
        { uom: "套", qty: 4, status: "已取消" },
      ],
    });

    expect(
      loanSummaryMetrics(
        [{ stock_uom: "件", docstatus: 0, borrowed: 2 }] as ReportRow[],
        true,
      ),
    ).toMatchObject([
      {
        label: "计划借出",
        quantities: [{ uom: "件", qty: 2, status: undefined }],
      },
    ]);
    expect(
      loanSummaryMetrics(
        [
          { stock_uom: "套", docstatus: 2, borrowed: 4, outstanding: 0 },
        ] as ReportRow[],
        true,
      ),
    ).toMatchObject([
      {
        label: "已取消借用",
        quantities: [{ uom: "套", qty: 4, status: undefined }],
      },
    ]);
  });
});
