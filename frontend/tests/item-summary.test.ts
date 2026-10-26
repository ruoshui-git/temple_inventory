import { describe, expect, it } from "vitest";
import { summarizeItems } from "../src/lib/itemSummary";

describe("summarizeItems", () => {
  it("uses the item name alone for one item", () => {
    expect(summarizeItems(["肥皂盒"], 1)).toBe("肥皂盒");
  });

  it("summarizes multiple names with their total count", () => {
    expect(summarizeItems(["肥皂盒", "纸巾"], 9)).toBe("肥皂盒 等 9 种物品");
  });

  it("handles count-only summaries", () => {
    expect(summarizeItems([], 3)).toBe("物品 等 3 种物品");
  });

	it("uses the supplied names when a count is missing", () => {
		expect(summarizeItems(["肥皂盒", "纸巾"], 0)).toBe("肥皂盒 等 2 种物品");
	});
});
