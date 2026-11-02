import { expect, test, type Page } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

// Export UX: the 导出 action lives in the 更多 menu on phones, and the job continues in the tray.
const shots = "/tmp/codex-runs/r7-export-ux-shots";
const exportJob = (
  status: string,
  progress: number,
  extra: Record<string, unknown> = {},
) => ({
  name: "EXPORT-1",
  status,
  progress,
  error: "",
  version: "v1",
  attempt: 1,
  generated_at: status === "Completed" ? "2026-10-16 12:05:00" : "",
  row_count: 24,
  download_url:
    status === "Completed"
      ? "/api/method/temple_inventory.exports.download_export?name=EXPORT-1"
      : null,
  file_label: "货物流动.xlsx",
  ...extra,
});

async function mockApi(page: Page) {
  let statusReads = 0;
  // Generic browse/report reads return an empty page; the export dialog only needs the count.
  await page.route("**/api/method/temple_inventory.**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = path.split("temple_inventory.").pop() || "";
    if (method.startsWith("exports.")) return route.fallback();
    const args = route.request().postDataJSON() || {};
    return route.fulfill({
      json: {
        message: {
          query: args.query || {},
          rows: [],
          matched_count: 24,
          next_start: null,
          summary: [],
          totals: [],
          analysis: {},
          snapshot: "2026-10-16 12:00:00",
        },
      },
    });
  });
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.exports.**",
    async (route) => {
      const method = new URL(route.request().url()).pathname
        .split("temple_inventory.")
        .pop();
      let message: unknown = null;
      if (method === "exports.export_print_formats")
        message = [{ name: "物资表格", label: "物资表格", count_sheet: false }];
      else if (method === "exports.request_export")
        message = exportJob("Queued", 0);
      else if (method === "exports.export_status") {
        statusReads += 1;
        message =
          statusReads < 3
            ? exportJob("Running", 45, {
                stage: "读取数据",
                progress_detail: "已读取 12 行",
              })
            : exportJob("Completed", 100);
      } else if (method === "exports.mark_watched") message = { watched: true };
      await route.fulfill({ json: { message } });
    },
  );
}

test.describe("phone export from the 更多 menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const [name, path] of [
    ["Movement", "/inventory/movements"],
    ["Expiry", "/inventory/stock/expiry"],
  ] as const) {
    test(`opens the export dialog from 更多 on ${name}`, async ({ page }) => {
      await mockApi(page);
      await page.goto(path);
      await page.getByRole("button", { name: "更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "导出", exact: true }).click();
      const dialog = page.locator(".quick-export-dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("共 24 行");
      await dialog.page().screenshot({
        path: `${shots}/phone-${name.toLowerCase()}-export-dialog.png`,
      });
    });
  }

  test("hands a started export to the tray and keeps polling after the dialog closes", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto("/inventory/movements");
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "导出", exact: true }).click();
    await page.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect(page.locator(".quick-export-dialog")).toHaveCount(0);
    const pill = page.locator(".task-tray-pill");
    await expect(pill).toContainText("正在导出 1 项");
    await pill.click();
    await expect(page.getByRole("region", { name: "后台任务" })).toBeVisible();
    await page.screenshot({ path: `${shots}/phone-tray-running.png` });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: "后台任务" })).toHaveCount(0);
    await pill.click();
    await expect(
      page
        .getByRole("region", { name: "后台任务" })
        .getByRole("button", { name: "下载", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${shots}/phone-tray-completed.png` });
  });
});

test.describe("desktop export tray", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("shows running then finished exports in the tray without blocking the page", async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto("/inventory/movements");
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await page.getByRole("menuitem", { name: "导出", exact: true }).click();
    await page.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect(page.locator(".quick-export-dialog")).toHaveCount(0);
    const pill = page.locator(".task-tray-pill");
    await expect(pill).toContainText("正在导出 1 项");
    await pill.click();
    await expect(page.getByRole("region", { name: "后台任务" })).toBeVisible();
    await page.screenshot({ path: `${shots}/desktop-tray-running.png` });
    await pill.click();
    await expect(pill).toContainText("1 项任务已完成", { timeout: 15000 });
    await pill.click();
    await expect(
      page
        .getByRole("region", { name: "后台任务" })
        .getByRole("button", { name: "下载", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `${shots}/desktop-tray-completed.png` });
    // The page stays usable: the More menu opens again after the tray was used.
    await page.getByRole("button", { name: "更多操作", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "导出", exact: true }),
    ).toBeVisible();
  });
});
