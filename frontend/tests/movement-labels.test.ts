import { describe, expect, it } from "vitest";
import { movementLabel, movementLabels } from "../src/lib/movementLabels";

describe("shared movement labels", () => {
  it("presents every supported movement kind in Chinese", () => {
    expect(movementLabels).toEqual({
      Receive: "入库",
      Issue: "出库",
      Transfer: "转移",
      Loan: "借出",
      Return: "归还",
      Damage: "损坏",
      Loss: "遗失",
      Repair: "修复",
      Disposal: "报废",
      Reconcile: "库存调整",
      Opening: "期初库存",
    });
  });

  it("preserves unknown labels and supplies a readable empty label", () => {
    expect(movementLabel("Custom movement")).toBe("Custom movement");
    expect(movementLabel()).toBe("库存变动");
  });
});
