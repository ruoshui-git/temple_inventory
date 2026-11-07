import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

async function expectNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body).toBeLessThanOrEqual(widths.viewport);
}

test("Opening Stock batch and serial rows fit desktop and phone", async ({
  page,
}) => {
  await nativeUiSession(
    page,
    100,
    {
      physical_leaves: ["ROOM-A"],
      warehouses: [{ name: "ROOM-A", label: "礼堂" }],
    },
    "Manager",
  );
  await page.route(
    "**/api/method/temple_inventory.native_api.load_document",
    (route) =>
      route.fulfill({
        json: {
          message: {
            doctype: "Stock Reconciliation",
            name: "SR-OPEN-VISUAL",
            version: "v1",
            docstatus: 0,
            editable: true,
            purpose: "Opening Stock",
            company: "TEST",
            posting_date: "2026-10-16",
            posting_time: "10:00:00",
            expense_account: "Temporary Opening - TEST",
            items: [
              {
                name: "batch-row",
                item_code: "BATCH-ITEM",
                warehouse: "ROOM-A",
                batch_no: "B-001",
                qty: 2,
                valuation_rate: 3,
                ti_display_item_name: "批次物品",
                ti_display_tracks_batch: true,
                ti_display_tracks_expiry: true,
                ti_display_expiry_date: "2027-10-16",
                ti_display_manufacturing_date: "2026-01-01",
              },
              {
                name: "serial-row",
                item_code: "SERIAL-ITEM",
                warehouse: "ROOM-A",
                serial_no: "SER-0001\nSER-0002",
                qty: 2,
                valuation_rate: 4,
                ti_display_item_name: "序列号物品",
                ti_display_tracks_serial: true,
                ti_display_serial_no_series: "SER-.####",
              },
              {
                name: "plain-row",
                item_code: "PLAIN-ITEM",
                warehouse: "ROOM-A",
                qty: 1,
                valuation_rate: 2,
                ti_display_item_name: "普通物品",
              },
            ],
            ti_count_review: [],
          },
        },
      }),
  );
  await page.route(
    "**/api/method/temple_inventory.catalog.item_display_summaries",
    (route) =>
      route.fulfill({
        json: {
          message: {
            "BATCH-ITEM": {
              item_name: "批次物品",
              has_batch_no: true,
              has_expiry_date: true,
            },
            "SERIAL-ITEM": {
              item_name: "序列号物品",
              has_serial_no: true,
              serial_no_series: "SER-.####",
            },
            "PLAIN-ITEM": { item_name: "普通物品" },
          },
        },
      }),
  );
  await page.route(
    "**/api/method/temple_inventory.opening.batch_options",
    (route) =>
      route.fulfill({
        json: {
          message: [
            {
              name: "B-001",
              manufacturing_date: "2026-01-01",
              expiry_date: "2027-10-16",
            },
          ],
        },
      }),
  );

  let dispatchLoads = 0;
  page.on("request", (request) => {
    if (request.url().includes("native_api.load_document")) dispatchLoads += 1;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory/counts/SR-OPEN-VISUAL");
  await expect(page.getByRole("heading", { name: "期初库存" })).toBeVisible();
  expect(dispatchLoads).toBe(1);
  await expect(page.getByLabel("批次物品批次编号")).toHaveValue("B-001");
  await expect(
    page.locator(".operation-serial-chip").filter({ hasText: "SER-0001" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /生产日期/ }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("opening-desktop.png"),
    fullPage: true,
  });

  const columns = await page.locator(".opening-table thead th").count();
  const rows = page.locator(".opening-table tr.opening-grid-row");
  for (let index = 0; index < (await rows.count()); index += 1)
    await expect(rows.nth(index).locator("td")).toHaveCount(columns);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "期初库存" })).toBeVisible();
  await expect(page.getByLabel("普通物品批次编号")).toHaveCount(0);
  await expect(page.getByLabel("普通物品生产日期")).toHaveCount(0);
  await expect(page.getByLabel("普通物品序列号")).toHaveCount(0);
  await expect(page.getByLabel("普通物品到期日期")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("opening-phone.png"),
    fullPage: true,
  });
});

test("reconciliation dispatcher shows forbidden state instead of falling through", async ({
  page,
}) => {
  await nativeUiSession(page, 100, {}, "Manager");
  await page.route(
    "**/api/method/temple_inventory.native_api.load_document",
    (route) =>
      route.fulfill({
        status: 403,
        json: { message: "Forbidden", exc_type: "frappe.PermissionError" },
      }),
  );
  await page.goto("/inventory/counts/SR-FORBIDDEN");
  await expect(page.getByTestId("forbidden-state")).toBeVisible();
  await expect(page.getByRole("heading", { name: "期初库存" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "盘点调整" })).toHaveCount(0);
});

test("reconciliation dispatcher surfaces non-permission load errors without opening count editor", async ({
  page,
}) => {
  await nativeUiSession(page, 100, {}, "Manager");
  await page.route(
    "**/api/method/temple_inventory.native_api.load_document",
    (route) =>
      route.fulfill({
        status: 500,
        json: { message: "Temporary load failure" },
      }),
  );
  await page.goto("/inventory/counts/SR-ERROR");
  await expect(page.getByRole("alert")).toContainText("Temporary load failure");
  await expect(page.getByRole("heading", { name: "期初库存" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "盘点调整" })).toHaveCount(0);
});
