import { createReferenceData } from "../src/services/contracts";
import { describe, expect, it } from "vitest";
import { scopeValueLabel } from "../src/lib/filterPresentation";
import { movementLabels } from "../src/lib/presentationLabels";

describe("shared movement labels", () => {
  it("presents every supported movement kind in Chinese", () => {
    expect(movementLabels).toEqual({
      Receive: "入库",
      Issue: "出库",
      Transfer: "调拨",
      Loan: "借出",
      Return: "归还",
      Damage: "损坏",
      Loss: "遗失",
      Repair: "修复归库",
      Disposal: "报废",
      Reconcile: "盘点调整",
      Opening: "期初库存",
    });
  });

  it("keeps unknown enum values generic and unselected filters empty", () => {
    expect(
      scopeValueLabel("kinds", "Custom movement", createReferenceData()),
    ).toBe("其他类型");
    expect(scopeValueLabel("kinds", "", createReferenceData())).toBe("");
  });
});
