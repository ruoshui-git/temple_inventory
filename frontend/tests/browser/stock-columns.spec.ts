import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { nativeUiSession } from "./fixtures/nativeUi";

const shots = "/tmp/codex-runs/r7-stock-columns-shots";
mkdirSync(shots, { recursive: true });

function location(
  code: string,
  label: string,
  batches: { id: string; available: number; expiry: string }[],
  loaned = 0,
  damaged = 0,
) {
  const available = batches.reduce(
    (total, batch) => total + batch.available,
    0,
  );
  return {
    location: code,
    label,
    path: `T2 / ${code}`,
    nativeName: `T2 / ${code}`,
    available,
    loaned,
    damaged,
    batches,
  };
}

const rows = [
  {
    id: "ITEM-RICE",
    code: "ITEM-RICE",
    item_code: "ITEM-RICE",
    name: "大米",
    item_name: "大米",
    category: "食品",
    uom: "kg",
    stock_uom: "kg",
    available: 8,
    loaned: 3,
    damaged: 1,
    stock_qty: 12,
    tracksBatch: true,
    tracksExpiry: true,
    image: "",
    locations: [
      location("A01", "礼堂储物室第一层", [
        { id: "BATCH-A", available: 5, expiry: "2026-11-18" },
      ]),
      location(
        "A02",
        "礼堂储物室第二层",
        [{ id: "BATCH-B", available: 3, expiry: "2026-12-01" }],
        3,
        1,
      ),
    ],
  },
  {
    id: "ITEM-SALT",
    code: "ITEM-SALT",
    item_code: "ITEM-SALT",
    name: "食盐",
    item_name: "食盐",
    category: "食品",
    uom: "袋",
    stock_uom: "袋",
    available: 4,
    loaned: 0,
    damaged: 0,
    stock_qty: 4,
    tracksBatch: false,
    tracksExpiry: false,
    image: "",
    locations: [location("A02", "礼堂储物室第二层", [])],
  },
];

async function prepare(page: Page) {
  await nativeUiSession(page);
  // Only the stock list is controlled here; every other call keeps the session mocks.
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page*",
    (route) => {
      const args = route.request().postDataJSON() || {};
      return route.fulfill({
        json: {
          message: {
            rows,
            matched_count: rows.length,
            next_start: null,
            query: args.query,
            snapshot: "2026-10-16 12:00:00",
            analysis: { category: [], location: [] },
            summary: [{ stock_uom: "kg", available: 8, loaned: 3, damaged: 1 }],
          },
        },
      });
    },
  );
}

test("stock table shows 位置 and 批次 as separate columns without 效期 by default", async ({
  page,
}) => {
  await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/inventory/stock");
  await page.getByRole("button", { name: "表格视图" }).click();
  const table = page.locator(".data-table-scroll table").first();
  await expect(table).toBeVisible();
  const headers = table.locator("thead th");
  await expect(headers.filter({ hasText: "位置" }).first()).toBeVisible();
  await expect(headers.filter({ hasText: "批次" }).first()).toBeVisible();
  await expect(headers.filter({ hasText: "效期" })).toHaveCount(0);
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await page.screenshot({
    path: join(shots, "stock-table-location-batch.png"),
  });

  await page.getByRole("button", { name: "显示字段" }).first().click();
  await page
    .getByRole("group", { name: "设置表格列" })
    .getByRole("checkbox", { name: "批次", exact: true })
    .uncheck();
  await page.keyboard.press("Escape");
  await expect(
    table.locator("thead th").filter({ hasText: "批次" }),
  ).toHaveCount(0);
  await expect(
    table.locator("thead th").filter({ hasText: "位置" }).first(),
  ).toBeVisible();
  await page.screenshot({ path: join(shots, "stock-table-batch-hidden.png") });
});

test("the phone 更多 sheet opens the stock export dialog", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inventory/stock");
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "导出", exact: true }).click();
  const dialog = page.locator(".quick-export-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("导出", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: join(shots, "stock-phone-export.png") });
});
