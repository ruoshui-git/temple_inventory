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

test("Opening Stock preview is result-first, scoped, and responsive without writing", async ({
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
          name: "OPENING-FIXTURE",
          status: "Previewed",
          counts: { new: 1, update: 0, unchanged: 0, rejected: 0 },
          plan_hash: "opening-hash",
          posting_date: "2026-11-07",
          posting_time: "08:00:00",
          difference_account: "Temporary - ACME",
          totals_by_unit: { 个: 3 },
          total_value: 12,
          rows: [
            {
              row: 2,
              action: "NEW",
              target: "ITM-000003",
              item_code: "ITM-000003",
              item_name: "期初测试物品",
              stock_uom: "Nos",
              location_label: "一层 / A 室",
              qty: 3,
              valuation_rate: 4,
              line_value: 12,
              batch_no: "",
              serials: [],
              errors: [],
              warnings: [],
              before: {},
              after: {},
              values: { item_code: "ITM-000003", location: "一层 / A 室" },
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
  await page.goto("/imports/opening");
  await expect(
    page.getByRole("heading", { name: "期初库存导入" }),
  ).toBeVisible();
  await expect(page.getByLabel("期初日期")).toBeVisible();
  await expect(page.getByLabel(/选择期初库存模板/)).toBeVisible();
  await page.getByLabel("期初日期").fill("2026-11-07");
  await page.getByLabel("时间").fill("08:00:00");
  await page.getByLabel(/选择期初库存模板/).setInputFiles({
    name: "opening.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from("fixture"),
  });
  await page.getByRole("button", { name: "上传并预览" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("期初测试物品")).toBeVisible();
  await expect(page.getByText("Temporary - ACME")).toBeVisible();
  expect(commits).toBe(0);
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText(/写入库存和会计记录/)).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();
  expect(commits).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".import-cards")).toBeVisible();
  await expect(page.locator(".import-card")).toHaveCount(1);
});
