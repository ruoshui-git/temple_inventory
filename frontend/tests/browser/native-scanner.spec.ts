import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { nativeUiSession } from "./fixtures/nativeUi";

// Routed production scanner + real camera decoders, controlled native HTTP data.
// Native database writes/lifecycle are exercised separately by native-server tests.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/method/temple_inventory.**", (route) =>
    route.fulfill({
      status: 500,
      json: { exc_type: "UnconfiguredTestRequest" },
    }),
  );
  await nativeUiSession(page, 100, {
    capabilities: {
      Item: { create: true },
      "Stock Entry": { create: true, write: true, submit: true },
    },
    operations: { Receive: true },
  });
  await page.route(
    "**/api/method/temple_inventory.catalog.scan_code",
    async (route) => {
      const { value } = route.request().postDataJSON();
      const matches =
        value === "6931234567890"
          ? [{ item_code: "RICE", item_name: "大米" }]
          : [];
      await route.fulfill({
        json: {
          message: {
            unknown: !matches.length,
            barcode: value,
            matches,
            batches: [],
          },
        },
      });
    },
  );
  await page.route(
    "**/api/method/temple_inventory.catalog.operation_item",
    (route) =>
      route.fulfill({
        json: {
          message: {
            item_code: "RICE",
            item_name: "大米",
            item_group: "食品",
            stock_uom: "Nos",
            description: "",
            version: "v1",
            has_batch_no: false,
            has_expiry_date: false,
            can_edit: false,
            barcodes: [],
            uoms: [{ uom: "Nos", conversion_factor: 1 }],
            stock: [],
            attachments: [],
          },
        },
      }),
  );
  await page.route(
    "**/api/method/temple_inventory.native_api.editor_clock",
    (route) =>
      route.fulfill({
        json: { message: { timestamp: "2026-10-16 12:00:00" } },
      }),
  );
  await page.route("**/assets/frappe/**", async (route) => {
    const relative = new URL(route.request().url()).pathname.replace(
      "/assets/frappe/",
      "",
    );
    const file = path.resolve("../..", "frappe/frappe/public", relative);
    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: "application/javascript",
      });
    } catch {
      await route.abort();
    }
  });
  await page.goto("/inventory/new/Receive?warehouse=ROOM-A");
  await expect(
    page.getByRole("heading", { name: "入库", exact: true }),
  ).toBeVisible();
  await page.getByText("扫描物品 / 批次 / 库位", { exact: true }).click();
});

test("manual and hardware-style scans preserve input and configure the same allocation", async ({
  page,
}) => {
  await page.getByLabel("扫描值", { exact: true }).fill("UNKNOWN-999");
  await page.getByLabel("扫描值", { exact: true }).press("Enter");
  await expect(
    page.getByText("未找到 UNKNOWN-999", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建物品", exact: true }),
  ).toBeVisible();
  await page.getByLabel("扫描值", { exact: true }).fill("6931234567890");
  await page.getByLabel("扫描值", { exact: true }).press("Enter");
  await page
    .getByRole("button", { name: "配置数量与库位", exact: true })
    .click();
  await expect(page.locator("[data-line-id]")).toHaveCount(1);
  await expect(page.locator("[data-line-id]")).toContainText("大米");
  await expect(page.getByLabel("扫描值", { exact: true })).toHaveValue(
    "6931234567890",
  );
});

for (const engine of ["ZXing-WASM", "Frappe 内置"])
  test(`${engine} decodes deterministic camera frames and releases tracks`, async ({
    page,
  }) => {
    test.skip(
      !process.env.SCAN_VIDEO,
      "Set SCAN_VIDEO to the generated Y4M fixture",
    );
    await page.evaluate(() => {
      delete (window as any).BarcodeDetector;
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      (window as any).__scanTracks = [];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await original(constraints);
        (window as any).__scanTracks.push(...stream.getTracks());
        return stream;
      };
    });
    await page.getByRole("button", { name: "打开相机", exact: true }).click();
    await expect(page.locator(".scanner-camera video")).toBeVisible();
    if (engine === "Frappe 内置") {
      await page.getByText("识别方式", { exact: true }).click();
      await page
        .getByRole("button", { name: "切换识别方式", exact: true })
        .click();
      await expect(page.locator(".scanner-engine")).toContainText(engine);
    }
    await page
      .getByRole("button", { name: "配置数量与库位", exact: true })
      .click({ timeout: 30000 });
    await expect(page.locator("[data-line-id]")).toHaveCount(1);
    await page
      .locator(".inventory-scanner")
      .getByRole("button", { name: "关闭相机", exact: true })
      .click();
    await expect(page.locator(".scanner-camera video")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).__scanTracks.length > 0 &&
            (window as any).__scanTracks.every(
              (track: MediaStreamTrack) => track.readyState === "ended",
            ),
        ),
      )
      .toBe(true);
  });
