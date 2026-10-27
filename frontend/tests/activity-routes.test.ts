import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  activityLoansTarget,
  activityMovementTarget,
} from "../src/features/activities/activityRoutes";
import { decodeReportQuery } from "../src/lib/reportQuery";

describe("activity summary destinations", () => {
  it("uses the shared anchored popover for overflow kinds", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/features/activities/ActivitiesView.vue"),
      "utf8",
    );
    expect(source).toContain("<DetailPopover");
    expect(source).toContain("activity-kind-popover-link");
    expect(source).not.toContain('<details\n\t\t\tv-if="activityKindCounts');
  });

  it("opens movement records filtered by activity and kind without decode errors", () => {
    const target = activityMovementTarget("ACT-2026-001", "Issue");
    const decoded = decodeReportQuery(target.query?.query, "movements");
    expect(target.name).toBe("movements");
    expect(decoded.error).toBe("");
    expect(decoded.query.dataset).toBe("movements");
    expect(target.query?.view).toBe("records");
    expect(decoded.query.scope.activity).toBe("ACT-2026-001");
    expect(decoded.query.scope.kinds).toEqual(["Issue"]);
  });

  it("opens all movement records and outstanding loans for the activity", () => {
    const records = activityMovementTarget("ACT-2026-001");
    const decodedRecords = decodeReportQuery(records.query?.query, "movements");
    expect(decodedRecords.error).toBe("");
    expect(decodedRecords.query.scope.activity).toBe("ACT-2026-001");
    expect(decodedRecords.query.scope.kinds).toEqual([]);

    const loans = activityLoansTarget("ACT-2026-001");
    const decodedLoans = decodeReportQuery(loans.query?.query, "loans");
    expect(loans.name).toBe("loans");
    expect(decodedLoans.error).toBe("");
    expect(decodedLoans.query.dataset).toBe("loans");
    expect(decodedLoans.query.scope.activity).toBe("ACT-2026-001");
    expect(decodedLoans.query.outstandingOnly).toBe(true);
  });
});
