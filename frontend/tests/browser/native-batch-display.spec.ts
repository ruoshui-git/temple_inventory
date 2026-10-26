import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";

for (const [width, textScale] of [
  [375, 100],
  [1024, 200],
  [1440, 100],
] as const) {
  test(
    "cancelled native batch allocations at " +
      width +
      "px / " +
      textScale +
      "%",
    async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await nativeUiSession(page, textScale);
      const doc = {
        doctype: "Stock Entry",
        name: "SE/CANCEL,1",
        kind: "Receive",
        ti_movement_kind: "Receive",
        company: "TEST",
        purpose: "Material Receipt",
        version: "2026-10-16 12:00:00",
        docstatus: 2,
        editable: false,
        permissions: {},
        posting_date: "2026-10-16",
        posting_time: "12:00:00",
        ti_time_mode: "Manual",
        items: [
          {
            name: "NATIVE-ROW",
            item_code: "ITEM/BATCH,1",
            ti_display_tracks_batch: true,
            ti_display_tracks_expiry: true,
            qty: 1,
            uom: "箱",
            stock_uom: "Nos",
            conversion_factor: 5,
            transfer_qty: 5,
            t_warehouse: "ROOM-A",
            serial_and_batch_bundle: null,
            batch_no: null,
            recorded_bundle: "BUNDLE/原始,1",
            recorded_batch_allocations: [
              {
                name: "ALLOCATION-A",
                batch_no: "批次甲/A,1",
                stock_qty: 2,
                expiry_date: "2026-10-20",
              },
              {
                name: "ALLOCATION-B",
                batch_no: "批次乙/B,2",
                stock_qty: 3,
                expiry_date: "2026-11-20",
              },
            ],
          },
        ],
      };
      await page.route(
        "**/api/method/temple_inventory.native_api.load_document",
        async (route) => {
          expect(route.request().postDataJSON().name).toBe(doc.name);
          await route.fulfill({ json: { message: doc } });
        },
      );
      await page.route(
        "**/api/method/temple_inventory.catalog.operation_item",
        (route) =>
          route.fulfill({
            json: {
              message: {
                item_code: "ITEM/BATCH,1",
                item_name: "长名称法会供养物品 · 保留原生批次与历史换算",
                item_group: "用品",
                stock_uom: "Nos",
                description: "",
                version: "item-v2",
                has_batch_no: true,
                has_expiry_date: true,
                can_edit: false,
                barcodes: [],
                uoms: [{ uom: "箱", conversion_factor: 8 }],
                stock: [],
                attachments: [],
              },
            },
          }),
      );
      await page.route(
        "**/api/method/temple_inventory.native_files.attachments",
        (route) => route.fulfill({ json: { message: [] } }),
      );
      await page.goto("/inventory/movements/" + encodeURIComponent(doc.name));
      const summary = page.locator(".form-main .preview-allocation-summary");
      await expect(summary.locator("[data-summary-line-id]")).toHaveCount(1);
      await expect(summary).toContainText("批次甲/A,1 2 Nos");
      await expect(summary).toContainText("批次乙/B,2 3 Nos");
      await expect(summary).toContainText("1 箱 × 5 Nos/箱 = 5 Nos");
      await expect(summary).not.toContainText("自动生成");
      await expect(page.locator("[role=alert]")).toHaveCount(0);
      if (process.env.AUDIT_CJK_FONT) {
        const font = readFileSync(process.env.AUDIT_CJK_FONT).toString(
          "base64",
        );
        await page.addStyleTag({
          content:
            "@font-face { font-family: 'Audit CJK'; src: url(data:font/otf;base64," +
            font +
            "); } html,body,button,input,select,textarea { font-family: 'Audit CJK',sans-serif !important; }",
        });
        await page.evaluate(() => document.fonts.ready);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      expect(
        await page.locator(".form-review").evaluate((element) => {
          const style = getComputedStyle(element);
          const available =
            element.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
          return (
            element
              .querySelector(".preview-allocation-summary")!
              .getBoundingClientRect().width >=
            available - 1
          );
        }),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath("batch-" + width + "-" + textScale + ".png"),
        fullPage: true,
      });
      expect(errors).toEqual([]);
    },
  );
}
