import { describe, expect, it } from "vitest";
import {
  createReviewSession,
  createDraft,
  submitDraft,
} from "./support/reviewModel";
import {
  emptyScope,
  resolvePeriod,
  inPeriod,
  filterMovements,
  groupMovements,
  filterLoans,
  groupLoans,
  loanStatus,
  remaining,
} from "./support/browseModel";
import { previewDate, locations } from "./support/model";
describe("preview date and scoped projections", () => {
  it("resolves rolling, natural, leap-year and inclusive same-day periods", () => {
    expect(
      resolvePeriod({ key: "last_7_days", from: "", to: "" }, "2026-01-02"),
    ).toEqual({ from: "2025-12-27", to: "2026-01-02" });
    expect(
      resolvePeriod({ key: "this_week", from: "", to: "" }, "2026-10-11"),
    ).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(
      resolvePeriod({ key: "this_month", from: "", to: "" }, "2024-02-29").from,
    ).toBe("2024-02-01");
    expect(
      resolvePeriod({ key: "this_year", from: "", to: "" }, "2026-10-11").from,
    ).toBe("2026-01-01");
    const period = {
      key: "custom" as const,
      from: previewDate,
      to: previewDate,
    };
    expect(inPeriod(previewDate, period)).toBe(true);
    expect(inPeriod("2026-10-10", period)).toBe(false);
  });
  it("combines type OR selection with date, category, exact item, activity and physical location filters", () => {
    const session = createReviewSession();
    const scope = emptyScope();
    Object.assign(scope, {
      kinds: ["Receive", "Loan"],
      categories: ["食品"],
      warehouses: ["斋堂"],
      destinations: [locations[0]],
      item: "ITM-000128",
      activity: "ACT-0003",
      period: { key: "custom", from: "2026-10-11", to: "2026-10-11" },
    });
    expect(
      filterMovements(session.movements, scope, "珍珠", session).map(
        (row) => row.name,
      ),
    ).toEqual(["MAT-STE-2026-00009"]);
    scope.sources = [locations[2]];
    expect(filterMovements(session.movements, scope, "", session)).toEqual([]);
  });
  it("groups repeated movement lines by item with distinct record counts and separate quantities", () => {
    const session = createReviewSession();
    const original = session.movements.find(
      (row) => row.name === "MAT-STE-2026-00009",
    )!;
    const groups = groupMovements([
      original,
      { ...original, name: "SECOND", kind: "Issue", qty: 2 },
      { ...original, qty: 1, batch: "SECOND-BATCH" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].lines).toHaveLength(3);
    expect(groups[0].totals).toEqual([
      { kind: "Receive", text: "13 袋" },
      { kind: "Issue", text: "2 袋" },
    ]);
  });
  it("groups positive loan outcomes across records including partially settled loans", () => {
    const session = createReviewSession();
    expect(
      loanStatus(
        session.loans.find((loan) => loan.name === "MAT-STE-2026-00008")!,
      ),
    ).toBe("部分结清");
    const groups = groupLoans(session.loans, "all", session);
    const outstanding = groups.find(
      (group) => group.code === "ITM-000130" && group.outcome === "outstanding",
    )!;
    expect(outstanding.qty).toBe(5);
    expect(outstanding.count).toBe(2);
    expect(
      groups.find(
        (group) => group.code === "ITM-000130" && group.outcome === "returned",
      )?.qty,
    ).toBe(1);
    const scope = emptyScope();
    scope.period = { key: "custom", from: "2026-10-09", to: "2026-10-09" };
    expect(
      filterLoans(session.loans, scope, "", session).map((loan) => loan.name),
    ).toEqual(["MAT-STE-2026-00008"]);
  });
  it("settles a linked preview loan once and links its movement to the same loan", () => {
    const session = createReviewSession();
    const loan = session.loans.find(
      (loan) => loan.name === "MAT-STE-2026-00008",
    )!;
    const draft = createDraft("Return", "TEST-RETURN", session);
    draft.loanName = loan.name;
    draft.borrower = loan.borrower;
    draft.activity = loan.activity;
    draft.lines = [
      {
        id: "1",
        code: "ITM-000130",
        qty: 1,
        uom: "件",
        batch: "UNIFORM-2610",
        location: locations[1],
      },
    ];
    submitDraft("Return", draft.name, session);
    submitDraft("Return", draft.name, session);
    expect(remaining(loan.lines[0])).toBe(0);
    expect(loanStatus(loan)).toBe("已结清");
    expect(
      session.movements.filter((row) => row.name === draft.name),
    ).toHaveLength(1);
    expect(
      session.movements.find((row) => row.name === draft.name)?.loanName,
    ).toBe(loan.name);
  });
  it("keeps an excessive settlement draft without mutating the loan", () => {
    const session = createReviewSession();
    const draft = createDraft("Return", "EXCESS", session);
    draft.loanName = "MAT-STE-2026-00008";
    draft.lines = [
      {
        id: "1",
        code: "ITM-000130",
        qty: 2,
        uom: "件",
        batch: "UNIFORM-2610",
        location: locations[1],
      },
    ];
    expect(submitDraft("Return", draft.name, session)).toBeUndefined();
    expect(draft.status).toBe("draft");
    expect(
      remaining(
        session.loans.find((loan) => loan.name === draft.loanName)!.lines[0],
      ),
    ).toBe(1);
  });
});
