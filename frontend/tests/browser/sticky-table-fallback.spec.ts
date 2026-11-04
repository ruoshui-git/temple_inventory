import { expect, test } from "@playwright/test";
import { openGroupedStock, prepare } from "./fixtures/stickyTable";

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
