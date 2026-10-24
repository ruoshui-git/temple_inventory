import { expect, it } from "vitest";
import { reactive, watchSyncEffect } from "vue";
import {
  borrowerLoanPageState,
  type BorrowerLoanPageState,
  groupOutstandingLoans,
  shouldShowLineTools,
  showOnlyStockFilter,
  showCountRowsOrEmpty,
  transferDestinationOptions,
  validRememberedLocation,
  visibleOutstandingLoans,
} from "../src/features/documents/creationFormPresentation";

it("keeps first-page borrower loan loading and rows reactive", () => {
  const states = reactive({} as Record<string, BorrowerLoanPageState>);
  const page = borrowerLoanPageState(states, "甲");
  const observed: Array<[boolean, number]> = [];
  const stop = watchSyncEffect(() =>
    observed.push([page.loading, page.rows.length]),
  );
  page.loading = true;
  page.rows = [
    {
      name: "L1",
      date: "2026-10-01",
      borrower: "甲",
      activity: "晚课",
      items: [],
    },
  ];
  page.loading = false;
  stop();
  expect(observed).toEqual([
    [false, 0],
    [true, 0],
    [true, 1],
    [false, 1],
  ]);
});

it("accepts remembered locations only while they are current writable leaves", () => {
  expect(validRememberedLocation("Receive", "leaf-a", ["leaf-a"])).toBe(
    "leaf-a",
  );
  expect(validRememberedLocation("Receive", "retired", ["leaf-a"])).toBe("");
  expect(
    validRememberedLocation("Transfer", "leaf-a", ["leaf-a"], ["leaf-a"]),
  ).toBe("");
});

it("keeps the count empty result hidden when the initial request fails", () => {
  expect(showCountRowsOrEmpty(true, 0)).toBe(false);
  expect(showCountRowsOrEmpty(false, 0)).toBe(true);
  expect(showCountRowsOrEmpty(true, 3)).toBe(true);
});

it("excludes every line source from transfer destination choices", () => {
  expect(transferDestinationOptions(["a", "b", "c"], ["a", "c"])).toEqual([
    "b",
  ]);
});

it("groups filterable outstanding loans by borrower", () => {
  const loans = [
    {
      borrower: "甲",
      name: "L1",
      date: "2026-10-01",
      activity: "晚课",
      items: [{ code: "X", name: "香" }],
    },
    {
      borrower: "甲",
      name: "L2",
      date: "2026-10-02",
      activity: "晚课",
      items: [{ code: "Y", name: "灯" }],
    },
    {
      borrower: "乙",
      name: "L3",
      date: "2026-10-03",
      activity: "法会",
      items: [{ code: "Z", name: "钵" }],
    },
  ];
  const visible = visibleOutstandingLoans(loans, "灯");
  expect(visible.map((loan) => loan.name)).toEqual(["L2"]);
  expect(
    groupOutstandingLoans(loans).map((group) => [
      group.borrower,
      group.loans.length,
    ]),
  ).toEqual([
    ["甲", 2],
    ["乙", 1],
  ]);
});

it("hides line tools until lines exist and omits stock-only filters for stock-only purposes", () => {
  expect(shouldShowLineTools(0)).toBe(false);
  expect(shouldShowLineTools(2)).toBe(true);
  expect(showOnlyStockFilter("outbound")).toBe(false);
  expect(showOnlyStockFilter("damaged")).toBe(false);
  expect(showOnlyStockFilter("inbound")).toBe(true);
});
