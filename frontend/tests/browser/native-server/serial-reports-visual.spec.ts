import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const shots = "/workspace/tmp/codex-runs/serial-reports-shots";
mkdirSync(shots, { recursive: true });

test("serial tracking browse and item tab visual evidence", async ({
  page,
}) => {
  const login = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(login.ok()).toBe(true);
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    if (
      ["session.info", "configuration.status", "browse.bootstrap"].includes(
        method,
      )
    )
      return route.fallback();

    let message: unknown;
    if (method === "browse.inventory_page") {
      message = {
        rows: [
          {
            code: "ITEM-SERIAL-LAMP",
            name: "礼佛照明设备",
            category: "仪式用品",
            uom: "个",
            has_serial_no: true,
            tracksBatch: false,
            tracksExpiry: false,
            available: 2,
            loaned: 0,
            damaged: 0,
            serial_nos: "LAMP-SN-001、LAMP-SN-002、LAMP-SN-003、LAMP-SN-004",
            locations: [
              {
                location: "SHELF-1",
                available: 2,
                loaned: 0,
                damaged: 0,
                serial_nos:
                  "LAMP-SN-001、LAMP-SN-002、LAMP-SN-003、LAMP-SN-004",
                batches: [],
              },
            ],
          },
        ],
        matched_count: 1,
        next_start: null,
        snapshot: "2026-11-01 10:00:00",
        analysis: { category: [], location: [] },
        summary: [],
      };
    } else if (method === "catalog.operation_items") {
      message = {
        items: [
          {
            item_code: "ITEM-SERIAL-LAMP",
            item_name: "礼佛照明设备",
            item_group: "仪式用品",
            stock_uom: "个",
            has_serial_no: true,
            has_batch_no: false,
            has_expiry_date: false,
            description: "供仪式使用",
            disabled: false,
            can_edit: false,
            barcodes: [],
            uoms: [],
            stock: [
              {
                warehouse: "SHELF-1",
                available: 2,
                loaned: 0,
                damaged: 0,
                serial_nos: "LAMP-SN-001、LAMP-SN-002",
              },
            ],
          },
        ],
        errors: [],
      };
    } else if (method === "catalog.item_lifecycle") {
      message = {
        disabled: false,
        tracking_changeable: false,
        tracking_change_reason: "已有库存",
        can_delete: false,
      };
    } else if (method === "catalog.item_serials") {
      message = {
        rows: [
          {
            serial: "LAMP-SN-001",
            status: "在库",
            location: "演示室甲 / 演示架1",
            last_movement: { doctype: "Stock Entry", name: "STE-SERIAL-001" },
          },
          {
            serial: "LAMP-SN-002",
            status: "借出",
            location: "借出库",
            last_movement: { doctype: "Stock Entry", name: "STE-SERIAL-002" },
          },
        ],
        next: null,
      };
    } else if (method === "native_files.attachments") message = [];
    else if (method === "browse.movement_history")
      message = {
        rows: [],
        matched_count: 0,
        next_start: null,
        history_complete: true,
      };
    else return route.fallback();
    await route.fulfill({ json: { message } });
  });

  let serialStockUrl = "/inventory/stock";
  for (const [width, height, label] of [
    [1440, 900, "desktop"],
    [390, 844, "phone"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto(label === "phone" ? serialStockUrl : "/inventory/stock");
    await expect(page.locator("h1").first()).toBeVisible();
    const filterToggle = page.getByRole("button", { name: /^筛选/ });
    if (await filterToggle.isVisible())
      await filterToggle.evaluate((button: HTMLButtonElement) =>
        button.click(),
      );
    await page
      .locator('details[data-filter-field="tracking"] summary')
      .evaluate((summary: HTMLElement) => summary.click());
    await page.getByLabel("物品追踪", { exact: true }).selectOption("serial");
    await expect(page.getByText("礼佛照明设备").first()).toBeVisible();
    if (label === "desktop") {
      serialStockUrl = page.url();
      await page.getByRole("button", { name: "完成", exact: true }).click();
      await expect(
        page.getByRole("columnheader", { name: "序列号" }),
      ).toBeVisible();
      await expect(
        page.getByText("LAMP-SN-001、LAMP-SN-002、LAMP-SN-003、LAMP-SN-004"),
      ).toBeVisible();
    } else {
      await page.getByRole("button", { name: "完成", exact: true }).click();
      const serialPreview = page.locator(".stock-serial-preview");
      await expect(serialPreview).toBeVisible();
      await expect(serialPreview).toContainText("LAMP-SN-001、LAMP-SN-002");
      await expect(serialPreview).toContainText("+2");
    }
    await page.screenshot({
      path: `${shots}/stock-serial-${label}.png`,
      fullPage: true,
    });

    await page.goto("/inventory/stock/items/ITEM-SERIAL-LAMP?tab=serials");
    await expect(page.getByRole("heading", { name: "物品详情" })).toBeVisible();
    await expect(page.getByText("礼佛照明设备").first()).toBeVisible();
    await page
      .getByRole("button", { name: "序列号", exact: true })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByText("LAMP-SN-001")).toBeVisible();
    await page.screenshot({
      path: `${shots}/item-serials-${label}.png`,
      fullPage: true,
    });
  }
});
