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
