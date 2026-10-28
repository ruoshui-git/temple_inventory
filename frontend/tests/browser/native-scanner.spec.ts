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

for (const fixture of ["barcode.png", "barcode-rotated.png"])
  test(`decodes ${fixture} from the local image picker`, async ({ page }) => {
    const input = page.locator('input[type="file"][accept="image/*"]').first();
    await input.setInputFiles(`tests/browser/fixtures/${fixture}`);
    await expect(page.getByText("正在识别…")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /6931234567890 ·/ }),
    ).toBeVisible({ timeout: 30000 });
    if (fixture === "barcode.png")
      await page.screenshot({
        path: test.info().outputPath("image-success.png"),
        fullPage: true,
      });
    await page.getByRole("button", { name: /6931234567890 ·/ }).click();
    await expect(
      page.getByRole("region", { name: "已扫描明细" }),
    ).toContainText("大米");
  });

test("opens the ItemFields barcode scanner in a compact dialog", async ({
  page,
}) => {
  await page.goto("/inventory/stock/items/new");
  await expect(
    page.getByRole("button", { name: "扫码添加条码", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "扫码添加条码", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("item-fields-desktop.png"),
    fullPage: true,
  });
});

test("shows camera control with Chromium fake media and captures scanner layouts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "启用相机", exact: true }).click();
  await expect(page.locator(".scanner-camera video")).toBeVisible();
  await expect(
    page.locator(".scanner-camera-name, .scanner-camera-select").first(),
  ).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("scan-panel-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "停用相机", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: test.info().outputPath("scan-panel-phone.png"),
    fullPage: true,
  });
});

test("Stock browse scanner is a compact centered dialog with enumerated camera", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/stock");
  await page.evaluate(() => {
    const devices = navigator.mediaDevices.enumerateDevices.bind(
      navigator.mediaDevices,
    );
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => [
        ...(await devices()),
        {
          kind: "videoinput" as MediaDeviceKind,
          deviceId: "fake_device_1",
          groupId: "fake_group",
          label: "Fake Secondary Camera",
        } as MediaDeviceInfo,
      ],
    });
  });
  await expect(
    page.getByRole("button", { name: "扫码", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "扫码", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".scanner-camera video")).toBeVisible();
  await expect(page.locator(".scanner-camera-select select")).toBeVisible();
  await expect
    .poll(() => page.locator(".scanner-camera-select select").inputValue())
    .not.toBe("");
  await expect
    .poll(() =>
      page
        .locator(".ui-dialog")
        .evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBeLessThan(500);
  await page.screenshot({
    path: test.info().outputPath("stock-scanner-desktop.png"),
    fullPage: true,
  });
});

test("Expiry uses the same ScanPanel dialog presentation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/stock/expiry");
  await expect(
    page.getByRole("button", { name: "扫码", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "扫码", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("expiry-scan-panel-desktop.png"),
    fullPage: true,
  });
});

test("shows crop fallback for an undecodable local image", async ({ page }) => {
  await page
    .locator('input[type="file"][accept="image/*"]')
    .first()
    .setInputFiles("tests/browser/fixtures/blank.png");
  await expect(
    page.getByText("未识别到条码。请框选条码区域、旋转或换一张更清晰的图片。", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("button", { name: "旋转 90°" })).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath("image-failure-crop.png"),
    fullPage: true,
  });
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
