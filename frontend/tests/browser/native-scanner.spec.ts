import { expect, test } from "@playwright/test";
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
    "**/api/method/temple_inventory.catalog.operation_items",
    (route) =>
      route.fulfill({
        json: {
          message: {
            items: [
              {
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
            ],
            errors: [],
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
  await page.goto("/inventory/movements/new/Receive?warehouse=A02-DIRECT");
  await expect(
    page.getByRole("heading", { name: "入库", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "展开完整工作区" }).click();
  const warehouse = page.getByRole("combobox", { name: "入库位置" });
  await warehouse.click();
  await page.getByRole("option", { name: /A02/ }).click();
  await page.getByRole("button", { name: "扫码添加", exact: true }).click();
});

test("manual and hardware-style scans preserve input and configure the same allocation", async ({
  page,
}) => {
  await page.getByLabel("扫描值", { exact: true }).fill("UNKNOWN-999");
  await page.getByLabel("扫描值", { exact: true }).press("Enter");
  await expect(
    page.getByText("未找到 UNKNOWN-999", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("扫描值", { exact: true })).toHaveValue(
    "UNKNOWN-999",
  );
  await expect(
    page.getByRole("button", { name: "新建物品", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "完成扫描", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "扫码添加", exact: true }).click();
  await page.getByLabel("扫描值", { exact: true }).fill("6931234567890");
  await page.getByLabel("扫描值", { exact: true }).press("Enter");
  await expect(page.getByLabel("扫描值", { exact: true })).toHaveValue(
    "6931234567890",
  );
  await expect(page.getByRole("region", { name: "已扫描明细" })).toContainText(
    "大米",
  );
  await page.getByRole("button", { name: "完成扫描", exact: true }).click();
  await expect(page.locator("[data-line-id]")).toHaveCount(1);
  await expect(page.locator("[data-line-id]")).toContainText("大米");
});

for (const engine of ["ZXing-WASM"])
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
    await page
      .getByRole("button", { name: "配置数量与库位", exact: true })
      .click({ timeout: 30000 });
    await expect(page.locator("[data-line-id]")).toHaveCount(1);
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
