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
      "batch",
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
      "source",
      "destination",
      "activity",
      "month",
    ]);
    expect(
      nextGroupByField("movements", "summary", ["kind"], 1, "item"),
    ).toEqual(["kind", "item"]);
    expect(
      nextGroupByField("movements", "summary", ["kind", "item"], 0, "item"),
    ).toEqual(["item"]);
    expect(
      nextGroupByField("movements", "summary", ["item"], 1, "kind"),
    ).toEqual([]);
    const dataset = "loans" as const;
    const view = "items";
    expect(groupByFieldOptions(dataset, view)).toEqual([
      "item",
      "category",
      "borrower",
      "activity",
      "month",
    ]);
    expect(nextGroupByField(dataset, view, [], 0, "borrower")).toEqual([
      "borrower",
    ]);
    expect(nextGroupByField(dataset, view, ["borrower"], 1, "item")).toEqual([
      "borrower",
      "item",
    ]);
    expect(
      nextGroupByField(dataset, view, ["borrower", "item"], 0, "item"),
    ).toEqual(["item"]);
    expect(removeGroupByField(dataset, view, ["borrower", "item"], 0)).toEqual([
      "item",
    ]);
    expect(removeGroupByField(dataset, view, ["borrower", "item"], 1)).toEqual([
      "borrower",
    ]);
    expect(nextGroupByField(dataset, view, ["item"], 1, "category")).toEqual(
      [],
    );
  });
});
