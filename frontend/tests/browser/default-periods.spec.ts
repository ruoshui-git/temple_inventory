import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

test("display settings show saved period choices on desktop and phone", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inventory/settings");
  await expect(
    page.getByRole("heading", { name: "默认时间范围" }),
  ).toBeVisible();
  for (const label of ["首页概览", "货物流动", "借用", "盘点"])
    await expect(page.getByLabel(label)).toHaveValue("this_month");
  await page.screenshot({
    path: info.outputPath("settings-periods-1280.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("settings-periods-390.png"),
    fullPage: true,
  });
});

test("a fresh movements page requests the account default month", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  let requestedPeriod = "";
  await page.route(
    "**/api/method/temple_inventory.browse.operation_page",
    async (route) => {
      const query = route.request().postDataJSON().query;
      requestedPeriod = query.scope.period.key;
      await route.fulfill({
        json: {
          message: {
            query,
            rows: [],
            matched_count: 0,
            next_start: null,
            summary: {},
            totals: [],
            analysis: {},
            snapshot: "2026-10-16 12:00:00",
          },
        },
      });
    },
  );
  await page.goto("/inventory/movements");
  await expect.poll(() => requestedPeriod).toBe("this_month");
  // The account default is the baseline: no date chip, the filter shows 本月.
  await expect(page.getByText(/^日期：/)).toHaveCount(0);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await expect(
    page.locator('[data-filter-field="period"]').first(),
  ).toContainText("本月");
  await page.screenshot({
    path: info.outputPath("movements-period-this-month.png"),
    fullPage: true,
  });
});
