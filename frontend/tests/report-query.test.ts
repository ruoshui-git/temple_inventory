import { decodeItemSelection } from "../src/lib/routeSelection";
import { describe, expect, it } from "vitest";
import { decodeReportQuery } from "../src/lib/reportQuery";
import { resolveSitePeriod } from "../src/lib/sitePeriod";
import {
  newReportQuery,
  reportDefinitions,
  sortableColumnsForView,
  type ReportDataset,
} from "../src/lib/reportContract";

describe("canonical routed report queries", () => {
  it("uses ordinary navigation defaults only when no query was supplied", () => {
    expect(decodeReportQuery(undefined).query).toEqual(newReportQuery());
    expect(decodeReportQuery(undefined).error).toBe("");
  });
  it("round trips all dataset views, explicit empty restrictions and relative dates", () => {
    for (const dataset of Object.keys(reportDefinitions) as ReportDataset[])
      for (const view of reportDefinitions[dataset].views) {
        const query = newReportQuery(dataset);
        query.view = view.id;
        query.groupBy = [];
        query.scope.period = { key: "last_30_days", from: "", to: "" };
        query.restrictItems = true;
        query.itemCodes = [];
        query.restrictAllocations = true;
        query.allocationKeys = [];
        query.statuses = [];
        const result = decodeReportQuery(JSON.stringify(query));
        expect(result.error).toBe("");
        expect(result.query).toEqual(query);
      }
  });
  it("rejects malformed nested scope without broadening it into all records", () => {
    for (const value of [
      "{",
      { dataset: "__proto__" },
      { dataset: "inventory", scope: { warehouses: null } },
      { dataset: "inventory", scope: { categories: [3] } },
      { dataset: "inventory", restrictItems: "false" },
      { dataset: "loans", statuses: ["1"] },
      { dataset: "inventory", scope: [] },
    ]) {
      const result = decodeReportQuery(value);
      expect(result.error).not.toBe("");
      expect(result.query.restrictItems).toBe(true);
      expect(result.query.itemCodes).toEqual([]);
    }
  });
  it("round trips independent category subtrees and direct root assignments", () => {
    const query = newReportQuery("inventory");
    query.scope.categories = ["FOOD", "COSTUMES"];
    query.scope.uncategorized = true;
    const decoded = decodeReportQuery(query);
    expect(decoded.error).toBe("");
    expect(decoded.query.scope.categories).toEqual(["FOOD", "COSTUMES"]);
    expect(decoded.query.scope.uncategorized).toBe(true);
    expect(
      decodeReportQuery({
        dataset: "inventory",
        scope: { uncategorized: 1 },
      }).error,
    ).not.toBe("");
  });
  it("validates date boundaries and requires a bounded historical balance", () => {
    for (const scope of [
      { period: { key: "custom", from: "2026-02-30", to: "2026-03-01" } },
      { period: { key: "custom", from: "2026-10-16", to: "" } },
      { period: { key: "all", from: "", to: "" } },
    ]) {
      expect(
        decodeReportQuery({ dataset: "inventory", view: "historical", scope })
          .error,
      ).not.toBe("");
    }
    expect(
      decodeReportQuery({
        dataset: "inventory",
        view: "historical",
        scope: {
          period: { key: "custom", from: "2026-10-01", to: "2026-10-16" },
        },
      }).error,
    ).toBe("");
  });
  it("rejects unsupported views and enum values while normalizing duplicate string selections", () => {
    expect(
      decodeReportQuery({ dataset: "counts", view: "historical" }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({ dataset: "inventory", sort: "random" }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({ dataset: "expiry", expiryWindow: "overdue" }).error,
    ).not.toBe("");
    const result = decodeReportQuery({
      dataset: "inventory",
      scope: { warehouses: ["A", "A", "B"] },
    });
    expect(result.query.scope.warehouses).toEqual(["A", "B"]);
  });
  it("validates ordered grouping fields by report grain and rejects the retired field", () => {
    const query = newReportQuery("inventory");
    query.groupBy = ["category", "item"];
    expect(decodeReportQuery(query).error).toBe("");
    expect(
      decodeReportQuery({ ...query, groupBy: ["item", "category"] }).error,
    ).toBe("");
    expect(
      decodeReportQuery({ ...query, groupBy: ["item", "item"] }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({ ...query, groupBy: ["item", "location"] }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({ ...query, groupBy: ["category", "item", "location"] })
        .error,
    ).not.toBe("");
    expect(
      decodeReportQuery({ dataset: "inventory", grouping: "item" }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({
        dataset: "movements",
        view: "summary",
        groupBy: ["category"],
      }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({
        dataset: "loans",
        view: "items",
        groupBy: ["item", "category"],
      }).error,
    ).not.toBe("");
    expect(
      decodeReportQuery({
        dataset: "loans",
        view: "items",
        groupBy: ["category", "item"],
      }).error,
    ).toBe("");
  });
  it("exposes scalar sortable fields per view without combined-unit totals", () => {
    expect(sortableColumnsForView("inventory", "summary")).toContain("available");
    expect(sortableColumnsForView("movements", "records")).toContain("document");
    expect(sortableColumnsForView("movements", "records")).not.toContain("stock_qty");
    for (const field of ["document", "doctype", "borrower", "source_warehouse", "destination_warehouse"])
      expect(sortableColumnsForView("movements", "lines")).toContain(field);
    for (const field of ["document", "doctype", "kind", "docstatus", "borrower", "source_warehouse", "destination_warehouse"])
      expect(sortableColumnsForView("loans", "outcomes")).toContain(field);
    expect(sortableColumnsForView("expiry", "batches")).toContain("expiry_date");
    expect(decodeReportQuery({ dataset: "inventory", sortBy: "quantity" }).error).not.toBe("");
    expect(decodeReportQuery({ dataset: "movements", view: "records", sortBy: "stock_qty" }).error).not.toBe("");
  });
  it("resolves current and previous quarters from the site date", () => {
    expect(
      resolveSitePeriod(
        { key: "this_quarter", from: "", to: "" },
        "2026-04-05",
      ),
    ).toEqual({
      from: "2026-04-01",
      to: "2026-04-05",
    });
    expect(
      resolveSitePeriod(
        { key: "last_quarter", from: "", to: "" },
        "2026-01-19",
      ),
    ).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
    });
  });
});

it("preserves Item codes containing commas and rejects malformed routed selections", () => {
  expect(decodeItemSelection('["A,B","中文物品","A,B"]').items).toEqual([
    "A,B",
    "中文物品",
  ]);
  expect(decodeItemSelection("A,B").error).toBeTruthy();
  expect(decodeItemSelection('["A",3]').error).toBeTruthy();
  expect(decodeItemSelection(undefined)).toEqual({ items: [], error: "" });
});
