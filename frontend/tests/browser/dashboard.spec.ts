import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";
import { newReportQuery } from "../../src/lib/reportContract";

// Production coordinator/transport with controlled native card responses.
test("dashboard retains applied scope and dismisses its filter across 1024px", async ({
  page,
}) => {
  const reads: Record<string, any>[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.browse.dashboard_card",
    async (route) => {
      const args = route.request().postDataJSON();
      reads.push(args);
      await route.fulfill({
        json: {
          message: {
            query: newReportQuery("inventory"),
            snapshot: "2026-10-16 12:00",
            rows: [],
            expiry_rows: { expired: [], upcoming: [] },
            kind_counts: {},
            totals: [],
            buckets: [],
            matched_count: 1,
            item_count: 1,
            expired_count: 0,
            damaged_item_count: 0,
          },
        },
      });
    },
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory/");
  await expect(
    page.getByRole("heading", { name: "物资总览", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-section="inventory"] [aria-busy="true"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "总览范围", exact: false }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /库房甲/ }).check();
  await expect
    .poll(() => reads.some((args) => args.scope.warehouses.includes("ROOM-A")))
    .toBe(true);
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("库房甲", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "总览范围", exact: false }).click();
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: /库房甲/ }),
  ).toBeChecked();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
