import { describe, expect, it } from "vitest";
import { groupImpliedColumns } from "../src/lib/groupColumns";

describe("groupImpliedColumns", () => {
  it("returns no columns for an ungrouped table", () => {
    expect(groupImpliedColumns([])).toEqual([]);
  });

  it("hides the item identity columns when grouped by item", () => {
    expect(groupImpliedColumns(["item"])).toEqual([
      "image",
      "item_name",
      "item_code",
      "category",
      "stock_uom",
    ]);
  });

  it("keeps dates and month buckets visible because they vary within a group", () => {
    expect(groupImpliedColumns(["month"])).toEqual([]);
    expect(groupImpliedColumns(["expiryMonth"])).toEqual([]);
    expect(groupImpliedColumns(["activityType"])).toEqual([]);
  });

  it("unions and deduplicates columns across every grouping key", () => {
    expect(
      groupImpliedColumns(["item", "category", "kind", "unknown"]),
    ).toEqual([
      "image",
      "item_name",
      "item_code",
      "category",
      "stock_uom",
      "kind",
      "count_kind",
    ]);
  });

  it("maps location, batch, borrower, activity, source, destination, status and outcome", () => {
    expect(groupImpliedColumns(["location"])).toEqual([
      "locations",
      "warehouse",
      "warehouse_label",
      "warehouse_path",
      "warehouse_native_name",
    ]);
    expect(groupImpliedColumns(["batch"])).toEqual(["batches", "batch_no"]);
    expect(groupImpliedColumns(["borrower"])).toEqual(["borrower"]);
    expect(groupImpliedColumns(["activity"])).toEqual(["activity_title"]);
    expect(groupImpliedColumns(["source"])).toEqual([
      "source",
      "source_warehouse_path",
      "source_warehouse_native_name",
    ]);
    expect(groupImpliedColumns(["destination"])).toEqual([
      "destination",
      "destination_warehouse_path",
      "destination_warehouse_native_name",
    ]);
    expect(groupImpliedColumns(["status"])).toEqual(["docstatus"]);
    expect(groupImpliedColumns(["outcome"])).toEqual(["outcome"]);
  });
});
