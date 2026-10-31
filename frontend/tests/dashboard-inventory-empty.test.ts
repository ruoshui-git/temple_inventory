import { describe, expect, it } from "vitest";
import { inventoryMetricEmptyText } from "../src/features/dashboard/useDashboardController";

describe("dashboard inventory empty totals", () => {
  it("shows an explicit empty state when no unit total is available", () => {
    expect(inventoryMetricEmptyText([])).toBe("暂无库存");
    expect(inventoryMetricEmptyText([{ uom: "Nos", qty: 2 }])).toBe("");
  });
});
