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

  it("restricts movement and loan item grains to the canonical Item sequence", () => {
    for (const dataset of ["movements", "loans"] as const) {
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
