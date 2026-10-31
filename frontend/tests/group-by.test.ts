import { describe, expect, it } from "vitest";
import {
  groupByFieldOptions,
  nextGroupByField,
  removeGroupByField,
} from "../src/lib/groupBy";

describe("view-specific ordered grouping", () => {
  it("offers all valid inventory location pairs and keeps one-field grouping", () => {
    expect(groupByFieldOptions("inventory", "locations")).toEqual([
      "category",
      "item",
      "location",
    ]);
    expect(
      nextGroupByField("inventory", "locations", ["category"], 1, "location"),
    ).toEqual(["category", "location"]);
    expect(
      removeGroupByField("inventory", "locations", ["category", "location"], 0),
    ).toEqual(["location"]);
  });

  it("offers movement kind groups and preserves the loan item sequence", () => {
    expect(groupByFieldOptions("movements", "summary")).toEqual([
      "item",
      "category",
      "kind",
    ]);
    expect(
      nextGroupByField("movements", "summary", ["kind"], 1, "item"),
    ).toEqual(["kind", "item"]);
    expect(
      nextGroupByField("movements", "summary", ["kind", "item"], 0, "item"),
    ).toEqual(["item"]);
    for (const dataset of ["loans"] as const) {
      const view = dataset === "movements" ? "summary" : "items";
      expect(groupByFieldOptions(dataset, view)).toEqual(["item", "category"]);
      expect(nextGroupByField(dataset, view, [], 0, "category")).toEqual([
        "category",
        "item",
      ]);
      expect(
        nextGroupByField(dataset, view, ["category", "item"], 0, "item"),
      ).toEqual(["item"]);
      expect(
        removeGroupByField(dataset, view, ["category", "item"], 0),
      ).toEqual(["item"]);
      expect(
        removeGroupByField(dataset, view, ["category", "item"], 1),
      ).toEqual([]);
      expect(nextGroupByField(dataset, view, ["item"], 1, "category")).toEqual(
        [],
      );
    }
  });
});
