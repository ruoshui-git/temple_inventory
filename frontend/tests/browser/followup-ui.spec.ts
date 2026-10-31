import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nativeUiSession } from "./fixtures/nativeUi";

const shots = "/tmp/codex-runs/followups-shots";
mkdirSync(shots, { recursive: true });
const thumbnail = fileURLToPath(
  new URL("./fixtures/barcode.png", import.meta.url),
);

const locationColumns = [
  "item_name",
  "warehouse_label",
  "batch_no",
  "available",
  "loaned",
  "damaged",
  "stock_qty",
  "stock_uom",
  "item_code",
  "warehouse",
];

const stockRows = Array.from({ length: 12 }, (_, i) => ({
  id: `ROW-${i}`,
  item_code: `ITEM-${i}`,
  item_name: `测试物品${i}`,
  category: "用品",
  stock_uom: "件",
  warehouse: "DEFAULT-A14",
  warehouse_label: "A02 · 直接存放",
  batch_no: `BATCH-${i}`,
  image: "/files/sample-item.png",
  available: 8,
  loaned: 2,
  damaged: 1,
  stock_qty: 11,
  tracksBatch: true,
  tracksExpiry: true,
  date: "2026-10-18",
  document: `MAT-${i}`,
  doctype: "Stock Entry",
  docstatus: 1,
  kind: "Receive",
  outcome_key: "outstanding",
}));

const damagedRows = Array.from({ length: 4 }, (_, i) => ({
  id: JSON.stringify([`ITEM-${i}`, "DAMAGED-A", `BATCH-${i}`]),
  item_code: `ITEM-${i}`,
  item_name: `损坏物品${i}`,
  image: "/files/damaged-item.png",
  warehouse: "DAMAGED-A",
  warehouse_label: "损坏待处理 · A",
  batch_no: `BATCH-${i}`,
  stock_uom: "件",
  available: 0,
  loaned: 0,
  damaged: 2 + i,
  stock_qty: 2 + i,
}));

// Stock, loans and damaged pages share one catch-all browse mock. Register it
// before nativeUiSession so the session and bootstrap replies keep precedence.
async function mockBrowse(page: Page, rows: Record<string, unknown>[]) {
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    const args = route.request().postDataJSON() || {};
    const message = {
      rows,
      matched_count: rows.length,
      next_start: null,
      query: args.query,
      snapshot: "2026-10-18 10:00:00",
      table: "locations",
      columns: locationColumns,
      tables: [{ id: "locations", label: "位置", count: rows.length }],
      period: { date_from: "", date_to: "" },
      summary: [{ stock_uom: "件", available: 96, loaned: 24, damaged: 12 }],
      totals: [
        { kind: "Receive", docstatus: 1, stock_uom: "件", stock_qty: 11 },
      ],
      analysis: { category: [], location: [] },
      item_count: rows.length,
      document_count: rows.length,
      allocation_count: rows.length,
    };
    if (method === "projections.group_page")
      return route.fulfill({
        json: {
          message: {
            rows: [],
            matched_count: 0,
            next_start: null,
            leaf_columns: [],
          },
        },
      });
    await route.fulfill({ json: { message } });
  });
  await page.route(
    "**/api/method/temple_inventory.item_images.thumbnail**",
    (route) => route.fulfill({ path: thumbnail, contentType: "image/png" }),
  );
}

async function openSelectMode(page: Page) {
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "选择", exact: true }).click();
  await page
    .locator(
      ".stock-list-checkbox input, .card-checkbox input, .data-table-row-checkbox input",
    )
    .first()
    .check();
  await expect(page.locator(".stock-selection-actions")).toBeVisible();
}

for (const width of [1440, 390]) {
  test(`sort glyph is centred on its label at ${width}px`, async ({ page }) => {
    // The damaged table renders its sortable headers at phone width too.
    await page.setViewportSize({ width, height: 900 });
    await mockBrowse(page, damagedRows);
    await nativeUiSession(page, 100);
    await page.goto("/stock/damaged");
    const sort = page
      .locator(".damaged-results-card .data-table-sort")
      .filter({ hasText: "损坏" })
      .first();
    await expect(sort).toBeVisible();
    const label = await sort.locator(".data-table-sort-label").boundingBox();
    const icon = await sort
      .locator(".data-table-sort-indicator svg")
      .boundingBox();
    expect(label).not.toBeNull();
    expect(icon).not.toBeNull();
    const labelCentre = label!.y + label!.height / 2;
    const iconCentre = icon!.y + icon!.height / 2;
    expect(Math.abs(labelCentre - iconCentre)).toBeLessThanOrEqual(2);
    expect(icon!.height).toBeLessThanOrEqual(label!.height);
    expect(icon!.height).toBeLessThanOrEqual(16);
    await page.screenshot({ path: `${shots}/sort-centre-${width}.png` });
  });
}

test("phone selection bar replaces the FAB on 库存 and exits from 取消", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBrowse(page, stockRows);
  await nativeUiSession(page, 100);
  await page.goto("/stock");
  await expect(page.locator(".browse-split-button")).toBeVisible();
  await openSelectMode(page);
  await expect(page.locator(".browse-split-button")).toBeHidden();
  const bar = page.locator(".stock-selection-actions");
  const cancel = bar.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeVisible();
  const barBox = await bar.boundingBox();
  const navBox = await page.locator(".app-mobile-nav").boundingBox();
  expect(barBox && navBox && barBox.y + barBox.height <= navBox.y + 1).toBe(
    true,
  );
  await page.screenshot({ path: `${shots}/stock-phone-selection.png` });
  await cancel.click();
  await expect(bar).toBeHidden();
  await expect(page.locator(".browse-split-button")).toBeVisible();
});

test("phone selection bar replaces the FAB on 借用 and exits from 取消", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBrowse(page, stockRows);
  await nativeUiSession(page, 100, {
    operations: { Loan: true, Return: true, Receive: true },
  });
  await page.goto("/loans?view=items");
  await expect(page.locator(".browse-split-button")).toBeVisible();
  await openSelectMode(page);
  await expect(page.locator(".browse-split-button")).toBeHidden();
  const bar = page.locator(".stock-selection-actions");
  const cancel = bar.getByRole("button", { name: "取消", exact: true });
  await expect(cancel).toBeVisible();
  await page.screenshot({ path: `${shots}/loans-phone-selection.png` });
  await cancel.click();
  await expect(bar).toBeHidden();
  await expect(page.locator(".browse-split-button")).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`damaged page shows thumbnails and damaged-only columns at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBrowse(page, damagedRows);
    await nativeUiSession(page, 100);
    await page.goto("/stock/damaged");
    const results = page.locator(".damaged-results-card");
    await expect(results.locator("tbody tr").first()).toBeVisible();
    const headers = await results
      .locator("thead th:not(.data-table-settings-heading)")
      .allTextContents();
    expect(headers.map((text) => text.trim())).toEqual([
      "图片",
      "物品名称",
      "物品编号",
      "损坏",
      "库存单位",
      "批次编号",
    ]);
    await expect(
      results
        .locator(".table-item-image img, .table-item-image button")
        .first(),
    ).toBeVisible();
    expect(await results.textContent()).not.toContain(
      "/files/damaged-item.png",
    );
    await page.screenshot({
      path: `${shots}/damaged-${width}.png`,
      fullPage: true,
    });
  });
}
