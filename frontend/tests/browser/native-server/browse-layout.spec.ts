import { expect, test, type Page } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  test.skip(
    !process.env.NATIVE_ADMIN_PASSWORD,
    "Requires the local development account",
  );
  const response = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(response.ok()).toBe(true);
});

async function settled(page: Page, path: string) {
  await page.goto(path);
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
}

async function capture(page: Page, name: string, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
  });
  await page.waitForTimeout(350);
  await page.screenshot({
    path: test.info().outputPath(`${name}-${width}.png`),
  });
}

async function assertSingleLineCells(page: Page) {
  const table = page.locator(".data-table-scroll table").first();
  await expect(table).toBeVisible();
  const rows = await table
    .locator("tbody tr:not(.data-table-group-row)")
    .evaluateAll((elements) =>
      elements.map((row) => {
        const rowHeight = row.getBoundingClientRect().height;
        const cells = Array.from(
          row.querySelectorAll<HTMLTableCellElement>("td"),
        )
          .filter((cell) => !cell.classList.contains("data-column-primary"))
          .map((cell) => ({
            column: cell.className,
            height: cell.getBoundingClientRect().height,
            scrollHeight: cell.scrollHeight,
          }));
        return { rowHeight, cells };
      }),
    );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.rowHeight).toBeLessThanOrEqual(60);
    for (const cell of row.cells) {
      expect(cell.height, cell.column).toBeLessThanOrEqual(60);
      expect(cell.scrollHeight, cell.column).toBeLessThanOrEqual(
        cell.height + 1,
      );
    }
  }
}

async function assertChipBaselines(
  page: Page,
  selector: string,
  labelSelector: string,
) {
  const measurements = await page.locator(selector).evaluateAll(
    (chips, labelSelector) =>
      chips.map((chip) => {
        const icon = chip.querySelector<SVGElement>("svg");
        const label = chip.querySelector<HTMLElement>(labelSelector);
        if (!icon || !label) return null;
        return {
          iconTop: icon.getBoundingClientRect().top,
          labelTop: label.getBoundingClientRect().top,
        };
      }),
    labelSelector,
  );
  const present = measurements.filter((measurement) => measurement !== null);
  expect(present.length).toBeGreaterThan(0);
  for (const measurement of present) {
    expect(measurement!.iconTop).toBeGreaterThanOrEqual(
      measurement!.labelTop - 4,
    );
  }
}

test("browse table chips stay single-line and browse pages retain their phone layouts", async ({
  page,
}) => {
  await settled(page, "/inventory/stock");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.locator(".data-table-scroll table").first()).toBeVisible();
  await assertSingleLineCells(page);
  await expect(page.locator(".stock-row-actions button").first()).toBeVisible();
  await assertChipBaselines(
    page,
    "td .detail-popover-trigger",
    ".stock-detail-trigger-label",
  );
  await capture(page, "stock", 1440, 900);
  await capture(page, "stock", 390);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(350);

  let blocked: import("@playwright/test").Route | undefined;
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page*",
    (route) => {
      blocked = route;
    },
  );
  await page
    .locator("input[data-browse-search]")
    .fill("browse layout refresh failure");
  const stockAction = page.locator(".stock-row-actions button").first();
  await expect(stockAction).toBeVisible();
  await expect(stockAction).toBeDisabled();
  expect(blocked).toBeTruthy();
  await blocked!.abort();
  await expect(page.locator(".browse-refresh-notice")).toBeVisible();
  await capture(page, "refresh-failure", 1440, 900);
  await capture(page, "refresh-failure", 390);

  await settled(page, "/inventory/movements?view=records");
  await page.setViewportSize({ width: 1440, height: 900 });
  await assertSingleLineCells(page);
  await expect(page.locator(".record-ref-chip").first()).toBeVisible();
  await assertChipBaselines(
    page,
    "td .record-ref-chip",
    ".record-ref-main > span",
  );
  await capture(page, "movements-records", 1440, 900);
  await capture(page, "movements-records", 390);

  for (const [name, path] of [
    ["loans-items", "/inventory/loans"],
    ["loans-records", "/inventory/loans?view=records"],
    ["expiry", "/inventory/stock/expiry"],
    ["pending", "/inventory/stock/damaged"],
  ] as const) {
    await settled(page, path);
    await capture(page, name, 1440, 900);
    await capture(page, name, 390);
  }

  await settled(page, "/inventory/loans");
  await page.getByRole("button", { name: "借还流动" }).click();
  await expect(page.locator(".record-ref-chip").first()).toBeVisible();
  await capture(page, "loan-history", 1440, 900);
  await capture(page, "loan-history", 390);
});
