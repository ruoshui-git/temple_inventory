import { expect, it } from "vitest";
import { createReferenceData } from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import { reportFilterChips } from "../src/lib/reportFilters";

it("presents and clears a non-default expiry window chip", () => {
  const query = newReportQuery("expiry");
  query.expiryWindow = "next_30";
  const chip = reportFilterChips(query, createReferenceData()).find(
    (value) => value.key === "expiryWindow",
  );
  expect(chip).toMatchObject({
    label: "到期窗口：未来30天",
    field: "expiryWindow",
    reset: { expiryWindow: "period" },
  });
});

it("translates every non-default report select value in its chip", () => {
  const reference = createReferenceData();
  const cases = [
    {
      dataset: "expiry" as const,
      field: "expiryWindow",
      values: [
        ["next_7", "未来7天"],
        ["next_30", "未来30天"],
        ["next_90", "未来90天"],
        ["next_365", "未来365天"],
        ["expired", "已过期"],
        ["unexpired", "未过期"],
        ["undated", "无效期"],
      ],
    },
    {
      dataset: "loans" as const,
      field: "person",
      values: [
        ["any", "人员"],
        ["recorder", "记录人"],
        ["handler", "经手人"],
        ["reviewer", "鉴证人"],
      ],
    },
    {
      dataset: "loans" as const,
      field: "loanOutcome",
      values: [
        ["returned", "正常归还"],
        ["damaged", "损坏"],
        ["lost", "遗失"],
        ["outstanding", "未归还"],
      ],
    },
    {
      dataset: "activities" as const,
      field: "activityStatus",
      values: [
        ["active", "进行中"],
        ["archived", "已归档"],
      ],
    },
    {
      dataset: "counts" as const,
      field: "countReviewed",
      values: [
        ["reviewed", "已核对"],
        ["unreviewed", "未核对"],
      ],
    },
    {
      dataset: "inventory" as const,
      field: "itemStatus",
      values: [
        ["disabled", "停用"],
        ["all", "全部"],
      ],
    },
  ];

  for (const { dataset, field, values } of cases) {
    for (const [value, translated] of values) {
      const query = newReportQuery(dataset);
      if (field === "person")
        query.person = { name: "人员甲", role: value as "any" };
      else Object.assign(query, { [field]: value });
      const chip = reportFilterChips(query, reference).find(
        (candidate) => candidate.key === field,
      );
      expect(chip?.label).toContain(translated);
      expect(chip?.label).not.toMatch(/[a-z][a-z_]+/i);
    }
  }
});

it("labels and clears person, borrower, item status and tracking filters", () => {
  const query = newReportQuery("loans");
  query.person = { name: "张三", role: "handler" };
  query.borrower = "办公室";
  query.itemStatus = "disabled";
  query.scope.tracking = "expiry";
  query.loanOutcome = "returned";
  const chips = reportFilterChips(query, createReferenceData());
  expect(chips.map((chip) => chip.label)).toEqual(
    expect.arrayContaining([
      "经手人：张三",
      "借用方：办公室",
      "物品状态：停用",
      "归还结果：正常归还",
    ]),
  );
  expect(chips.find((chip) => chip.key === "person")?.field).toBe("person");
  expect(chips.find((chip) => chip.key === "borrower")?.field).toBe("borrower");
});
