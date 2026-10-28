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
