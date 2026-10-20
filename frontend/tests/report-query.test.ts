import { decodeItemSelection } from "../src/lib/routeSelection";
import { describe, expect, it } from "vitest";
import { decodeReportQuery } from "../src/lib/reportQuery";
import {
  newReportQuery,
  reportDefinitions,
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
