import { beforeEach, describe, expect, it } from "vitest";
import {
  resetReviewSession,
  reviewSession,
  type ReviewSession,
} from "./support/reviewModel";
import { newReportQuery, projectReport } from "./support/reportModel";

let session: ReviewSession;
beforeEach(() => {
  resetReviewSession();
  session = JSON.parse(JSON.stringify(reviewSession));
});

describe("independent report correctness review", () => {
  it("excludes borrowing movements and unreferenced lines from settlement detail", () => {
    const loan = session.loans[0]!;
    const line = loan.lines[0]!;
    const base = {
      docstatus: 1 as const,
      date: loan.loanDate,
      code: line.code,
      itemName: "物品",
      qty: 1,
      uom: "袋",
      from: "借出",
      to: "斋堂 / A-01",
      loanName: loan.name,
    };
    session.movements = [
      {
        ...base,
        name: "BORROWING",
        lineId: "borrow",
        kind: "Loan",
        loanLineIndex: 0,
      },
      { ...base, name: "RETURN-UNKNOWN", lineId: "unknown", kind: "Return" },
      {
        ...base,
        name: "RETURN-EXPLICIT",
        lineId: "explicit",
        kind: "Return",
        loanLineIndex: 0,
      },
    ];
    const query = newReportQuery("loans");
    query.loan = loan.name;
    query.view = "settlements";
    expect(
      projectReport(query, session).rows.map((row) => row.documentId),
    ).toEqual(["RETURN-EXPLICIT"]);
    query.groupBy = ["item"];
    const grouped = projectReport(query, session);
    expect(grouped.tables[0]!.columns).toContain("groupLabel");
    expect(grouped.tables[0]!.columns).not.toContain("documentId");
  });
  it("applies historical search to balances and their contributing ledger rows", () => {
    const query = newReportQuery("inventory");
    query.view = "historical";
    query.scope.period = { key: "this_month", from: "", to: "" };
    query.search = "no-such-item";
    const result = projectReport(query, session);
    expect(result.rows).toEqual([]);
    expect(result.tables.find((table) => table.id === "ledger")?.rows).toEqual(
      [],
    );
  });

  it("keeps original loan line references after filtering the first allocation away", () => {
    const loan = session.loans[0]!;
    loan.lines = [
      {
        code: "ITM-000128",
        qty: 10,
        returned: 0,
        damaged: 0,
        lost: 0,
        location: "斋堂 / A-01",
      },
      {
        code: "ITM-000129",
        qty: 4,
        returned: 0,
        damaged: 0,
        lost: 0,
        location: "斋堂 / A-02",
      },
    ];
    const query = newReportQuery("loans");
    query.loan = loan.name;
    query.scope.item = "ITM-000129";
    const row = projectReport(query, session).tables.find(
      (table) => table.id === "balances",
    )!.rows[0]!;
    expect(row.loanLineId).toBe(`${loan.name}/1`);
  });

  it("selects settlements by original allocation, including indirect activity relationships", () => {
    const loan = session.loans[0]!;
    loan.lines = [
      {
        code: "ITM-000128",
        qty: 10,
        returned: 1,
        damaged: 0,
        lost: 0,
        location: "斋堂 / A-01",
      },
      {
        code: "ITM-000128",
        qty: 10,
        returned: 2,
        damaged: 0,
        lost: 0,
        location: "斋堂 / A-02",
      },
    ];
    session.movements = [0, 1].map((index) => ({
      name: `RETURN-${index}`,
      lineId: `RETURN-LINE-${index}`,
      kind: "Return",
      docstatus: 1,
      date: loan.loanDate,
      code: "ITM-000128",
      itemName: "珍珠米",
      qty: index + 1,
      uom: "袋",
      from: "借出",
      to: "斋堂 / A-01",
      activity: "",
      loanName: loan.name,
      loanLineIndex: index,
    }));
    const query = newReportQuery("loans");
    query.loan = loan.name;
    query.scope.activity = loan.activity;
    query.scope.warehouses = ["斋堂 / A-02"];
    query.view = "settlements";
    expect(
      projectReport(query, session).rows.map((row) => row.documentId),
    ).toEqual(["RETURN-1"]);
  });

  it("groups activity loan balances by actual stock units and retains detail/master rows", () => {
    const loan = session.loans[0]!;
    loan.lines = [
      {
        code: "ITM-000128",
        qty: 10,
        returned: 0,
        damaged: 0,
        lost: 0,
        location: "斋堂 / A-01",
      },
      {
        code: "ITM-000129",
        qty: 4,
        returned: 0,
        damaged: 0,
        lost: 0,
        location: "斋堂 / A-02",
      },
    ];
    const query = newReportQuery("activities");
    query.scope.activity = loan.activity;
    query.view = "loans";
    query.groupBy = ["activity"];
    const result = projectReport(query, session);
    expect(new Set(result.rows.map((row) => row.stockUom)).size).toBe(2);
    expect(
      result.related.find((table) => table.id === "items")!.rows,
    ).toHaveLength(2);
    expect(
      result.tables.some(
        (table) =>
          table.id !== "result" && table.rows.some((row) => row.loanLineId),
      ),
    ).toBe(true);
    expect(result.tables[0]!.columns).toContain("outstanding");
  });

  it("retains allocation detail when activity related records are grouped", () => {
    const query = newReportQuery("activities");
    query.view = "records";
    query.scope.activity = "ACT-0001";
    query.groupBy = ["kind"];
    const result = projectReport(query, session);
    expect(result.count).toBeGreaterThan(0);
    expect(
      result.tables.some(
        (table) =>
          table.id !== "result" && table.rows.some((row) => row.lineId),
      ),
    ).toBe(true);
    expect(
      result.related.find((table) => table.id === "items")!.rows.length,
    ).toBeGreaterThan(0);
  });

  it("rejects incomplete related-record dates rather than exporting a partial range", () => {
    const query = newReportQuery("activities");
    query.view = "records";
    query.relatedPeriod = { key: "custom", from: "2026-10-01", to: "" };
    expect(projectReport(query, session).error).not.toBe("");
  });

  it("uses summary columns when location detail is grouped by item", () => {
    const query = newReportQuery("inventory");
    query.view = "locations";
    query.groupBy = ["item"];
    const table = projectReport(query, session).tables[0]!;
    expect(table.columns).not.toContain("batchId");
    expect(table.columns).not.toContain("locationId");
    expect(table.columns).toContain("total");
  });

  it("separates quantities when different document types share a document name", () => {
    const base = {
      name: "SHARED-ID",
      kind: "Receive",
      docstatus: 1 as const,
      date: "2026-10-10",
      code: "ITM-000128",
      itemName: "珍珠米",
      uom: "袋",
      from: "",
      to: "斋堂 / A-01",
    };
    session.movements = [
      { ...base, documentType: "Stock Entry", lineId: "a", qty: 2 },
      { ...base, documentType: "Purchase Receipt", lineId: "b", qty: 7 },
    ];
    const query = newReportQuery("movements");
    query.view = "records";
    query.groupBy = [];
    const rows = projectReport(query, session).rows;
    expect(
      rows.find((row) => row.documentType === "Stock Entry")?.quantities,
    ).toBe("2 袋");
    expect(
      rows.find((row) => row.documentType === "Purchase Receipt")?.quantities,
    ).toBe("7 袋");
  });
});
