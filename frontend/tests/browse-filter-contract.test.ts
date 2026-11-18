import { describe, expect, it } from "vitest";
import {
  decodeReportQuery,
  normalizeBrowseQueryPayload,
  normalizeReportQuery,
} from "../src/lib/reportQuery";
import { newReportQuery } from "../src/lib/reportContract";
import { reportFilterChips } from "../src/lib/reportFilters";
import { createReferenceData } from "../src/services/contracts";
import { scopeFilterFieldChips } from "../src/lib/filterPresentation";

describe("browse filter contracts", () => {
  it("drops category scope for whole-document views while keeping item views", () => {
    for (const [dataset, view] of [
      ["movements", "records"],
      ["loans", "records"],
      ["loans", "outcomes"],
      ["loans", "settlements"],
      ["counts", "records"],
      ["activities", "records"],
    ] as const) {
      const query = newReportQuery(dataset);
      query.view = view;
      query.scope.categories = ["FOOD"];
      query.scope.uncategorized = true;
      expect(decodeReportQuery(query).query.scope).toMatchObject({
        categories: [],
        uncategorized: false,
      });
      expect(normalizeReportQuery(query).scope).toMatchObject({
        categories: [],
        uncategorized: false,
      });
      if (dataset === "movements" || dataset === "loans")
        expect(
          JSON.parse(normalizeBrowseQueryPayload(query, dataset, "records")!)
            .scope,
        ).toMatchObject({ categories: [], uncategorized: false });
    }
    const itemQuery = newReportQuery("loans");
    itemQuery.view = "items";
    itemQuery.scope.categories = ["FOOD"];
    expect(decodeReportQuery(itemQuery).query.scope.categories).toEqual([
      "FOOD",
    ]);
  });

  it("round trips and labels the five inventory stock states", () => {
    const query = newReportQuery("inventory");
    query.stockState = "no_available";
    expect(decodeReportQuery(query)).toMatchObject({ error: "", query });
    expect(decodeReportQuery({ ...query, stockState: "empty" }).error).not.toBe(
      "",
    );
    const chip = reportFilterChips(query, createReferenceData()).find(
      (row) => row.key === "stockState",
    );
    expect(chip?.label).toBe("库存状态：无可用");
    // Removing a stock-state chip lifts the restriction to 全部, not the page default.
    expect(chip?.reset.stockState).toBe("all");
  });

  it("normalizes, serializes and restores multi-select stock units", () => {
    const query = newReportQuery("inventory");
    query.scope.units = ["Each", "Box", "Each"];
    const payload = normalizeBrowseQueryPayload(query, "inventory", "summary");
    expect(JSON.parse(payload!).scope.units).toEqual(["Each", "Box"]);
    expect(decodeReportQuery(payload).query.scope.units).toEqual([
      "Each",
      "Box",
    ]);
    expect(normalizeReportQuery(query).scope.units).toEqual(["Each", "Box"]);
    const reference = createReferenceData();
    reference.units = [
      { name: "Each", label: "件", whole: true },
      { name: "Box", label: "箱", whole: true },
    ];
    // Pages combine scope chips with report chips; 单位 must appear exactly once.
    const labels = [
      ...scopeFilterFieldChips(query.scope, reference),
      ...reportFilterChips(query, reference),
    ]
      .map((chip) => chip.label)
      .filter((label) => label.includes("单位"));
    expect(labels).toHaveLength(1);
    expect(labels[0]).toContain("件、箱");
  });
});
