import { expect, test } from "@playwright/test";
import {
  openGroupedStock,
  prepare,
  scrollTableBandIntoView,
} from "./fixtures/stickyTable";

// The suite's Chromium has no single-axis scroll containers by default, like Safari and Firefox.
test("without single-axis scroll containers a wide table keeps its header off the rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await openGroupedStock(page, false);
  await page.addStyleTag({
    content: ".data-table-scroll table { min-width: 2400px !important; }",
  });
  await expect(page.locator(".data-table-scroll.is-overflowing")).toBeVisible();
  const header = await page.evaluate(() => {
    const table = document.querySelector<HTMLElement>(".data-table-scroll")!;
    const cell = table.querySelector("thead th")!;
    return {
      overflowY: getComputedStyle(table).overflowY,
      top: getComputedStyle(cell).top,
      offset:
        cell.getBoundingClientRect().top - table.getBoundingClientRect().top,
    };
  });
  expect(header.overflowY).toBe("hidden");
  expect(header.top).toBe("auto");
  expect(header.offset).toBeLessThanOrEqual(1);
});

test("without single-axis scroll containers a wide table never sticks its group rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await openGroupedStock(page, false);
  await page.addStyleTag({
    content: ".data-table-scroll table { min-width: 2400px !important; }",
  });
  await expect(page.locator(".data-table-scroll.is-overflowing")).toBeVisible();
  await scrollTableBandIntoView(page);
  await page.evaluate(() => window.scrollBy(0, 600));
  await page.waitForTimeout(200);
  await expect(page.locator("tr.is-stuck")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document
        .querySelector<HTMLElement>(".data-table-scroll")!
        .style.getPropertyValue("--data-table-stuck-height"),
    ),
  ).toBe("");
});

test("without single-axis scroll containers a table that starts and stops overflowing sticks and clears its group rows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await openGroupedStock(page, false);
  await scrollTableBandIntoView(page);
  await expect(page.locator("tr.is-stuck").first()).toBeVisible();
  const wide = await page.addStyleTag({
    content: ".data-table-scroll table { min-width: 2400px !important; }",
  });
  await expect(page.locator("tr.is-stuck")).toHaveCount(0);
  await wide.evaluate((element) => element.remove());
  await expect(page.locator("tr.is-stuck").first()).toBeVisible();
});
