import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

test("Item import wizard is readable at desktop and phone widths", async ({
  page,
}) => {
  await nativeUiSession(page, 100, {}, "Manager");
  await page.setViewportSize({ width: 1440, height: 900 });
  let commits = 0;
  await page.route("**/api/method/temple_inventory.imports.upload", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        message: {
          name: "IMPORT-FIXTURE",
          status: "Previewed",
          counts: { new: 1, update: 1, unchanged: 1, rejected: 1 },
          plan_hash: "fixture-hash",
          rows: [
            {
              row: 2,
              action: "NEW",
              target: "",
              errors: [],
              warnings: [],
              before: {},
              after: { item_name: "新物品", stock_uom: "个" },
              values: { item_name: "新物品", stock_uom: "个" },
            },
            {
              row: 3,
              action: "UPDATE",
              target: "ITM-000001",
              errors: [],
              warnings: [],
              before: { item_name: "旧名称" },
              after: { item_name: "新名称" },
              values: { item_name: "新名称" },
            },
            {
              row: 4,
              action: "UNCHANGED",
              target: "ITM-000002",
              errors: [],
              warnings: [],
              before: {},
              after: {},
              values: { item_name: "无变化物品" },
            },
            {
              row: 5,
              action: "REJECTED",
              target: "",
              errors: ["库存单位不存在"],
              warnings: [],
              before: {},
              after: {},
              values: { item_name: "无法导入物品" },
            },
          ],
          error: "",
        },
      }),
    }),
  );
  await page.route("**/api/method/temple_inventory.imports.commit", (route) => {
    commits += 1;
    return route.fulfill({
      status: 200,
      body: JSON.stringify({ message: {} }),
    });
  });
  await page.goto("/inventory/imports/items");
  await expect(page.getByRole("heading", { name: "物品导入" })).toBeVisible();
  await expect(page.getByLabel(/选择物品模板/)).toBeVisible();
  await expect(page.getByRole("button", { name: "上传并预览" })).toBeVisible();
  await page.getByLabel(/选择物品模板/).setInputFiles({
    name: "items.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "上传并预览" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("无法导入物品")).toBeVisible();
  await page.getByRole("button", { name: "确认导入" }).click();
  const skip = page.getByLabel("跳过 1 行无法导入的行");
  await expect(skip).not.toBeChecked();
  await expect(page.getByRole("button", { name: "提交导入" })).toBeDisabled();
  expect(commits).toBe(0);
  await page.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".import-cards")).toBeVisible();
  await expect(page.locator(".import-card")).toHaveCount(4);
  await expect(page.getByText("无法导入物品")).toBeVisible();
  expect(commits).toBe(0);
});
