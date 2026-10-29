import { expect, test } from "@playwright/test";
import { newReportQuery } from "../../src/lib/reportContract";
import { nativeUiSession } from "./fixtures/nativeUi";

test("desktop stock and expiry table thumbnails keep the lightbox open", async ({
  page,
}, info) => {
  const itemCode = `LIGHTBOX-${crypto.randomUUID()}`;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page",
    (route) =>
      route.fulfill({
        json: {
          message: {
            rows: [row(itemCode)],
            matched_count: 1,
            next_start: null,
            query: newReportQuery("inventory"),
            snapshot: "2026-10-16 12:00:00",
            analysis: { category: [], location: [] },
            summary: [
              { stock_uom: "Nos", available: 12, loaned: 0, damaged: 0 },
            ],
          },
        },
      }),
  );
  await page.route(
    "**/api/method/temple_inventory.browse.expiry_page",
    (route) =>
      route.fulfill({
        json: {
          message: {
            rows: [row(itemCode)],
            matched_count: 1,
            next_start: null,
            query: newReportQuery("expiry"),
            snapshot: "2026-10-16 12:00:00",
            item_count: 1,
            batch_count: 1,
            facets: { all: 1, expired: 0, unexpired: 1, undated: 0 },
            totals: [
              { stock_uom: "Nos", available: 12, loaned: 0, damaged: 0 },
            ],
            analysis: {},
          },
        },
      }),
  );
  await page.route("**/files/lightbox-regression.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>',
    }),
  );

  for (const [path, filename] of [
    ["/inventory/stock", "stock-thumbnail.png"],
    ["/inventory/stock/expiry", "expiry-thumbnail.png"],
  ]) {
    await page.goto(path);
    const thumbnail = page
      .getByRole("button", { name: /放大查看.*图片/ })
      .first();
    await expect(thumbnail).toBeVisible();
    await thumbnail.click();
    const lightbox = page.getByRole("dialog").last();
    await expect(lightbox).toBeVisible();
    await page.waitForTimeout(500);
    await expect(lightbox).toBeVisible();
    await page.screenshot({ path: info.outputPath(filename), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Closing pops the overlay's history entry asynchronously; navigating
    // before that settles aborts the next page.goto.
    await page.waitForFunction(
      () => !(history.state as { tiOverlay?: string } | null)?.tiOverlay,
    );
  }

  const unexpired = page.getByRole("tab", { name: /未过期/ });
  await unexpired.click();
  await expect(unexpired).toHaveAttribute("aria-selected", "true");
  await page.screenshot({
    path: info.outputPath("expiry-unexpired.png"),
    fullPage: true,
  });

  const reportQuery = newReportQuery("expiry");
  reportQuery.expiryWindow = "unexpired";
  await page.route(
    "**/api/method/temple_inventory.projections.report_page",
    (route) => {
      const query = route.request().postDataJSON().query;
      return route.fulfill({
        json: {
          message: {
            query,
            scope: query.scope,
            period: { key: "all", date_from: "", date_to: "" },
            snapshot: "2026-10-16 12:00:00",
            table: "expiry",
            columns: [],
            sortable_columns: [],
            rows: [],
            matched_count: 0,
            next_start: null,
            summary: [],
            tables: [{ id: "expiry", label: "效期", count: 0 }],
          },
        },
      });
    },
  );
  await page.goto(
    `/inventory/reports?query=${encodeURIComponent(JSON.stringify(reportQuery))}`,
  );
  await expect(
    page.getByText("到期窗口：未过期", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("expiry-unexpired-chip.png"),
    fullPage: true,
  });
});

function row(itemCode: string) {
  return {
    id: "LIGHTBOX-ROW",
    code: itemCode,
    item_code: itemCode,
    name: "回归检查物品",
    item_name: "回归检查物品",
    category: "用品",
    uom: "Nos",
    stock_uom: "Nos",
    available: 12,
    loaned: 0,
    damaged: 0,
    stock_qty: 12,
    tracksBatch: true,
    tracksExpiry: true,
    image: "/files/lightbox-regression.svg",
    locations: [],
    batch_no: "BATCH-REGRESSION",
    expiry_date: "2026-11-18",
    remaining_days: 33,
    warehouse: "DEMO-ROOM-A",
  };
}
