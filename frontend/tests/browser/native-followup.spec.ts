import { test, expect } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

// Controlled HTTP contracts; real opening quantities are checked by the rollback native suite.
for (const width of [375, 1440]) {
  test(`fresh linked activities and scoped opening export at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const doc = {
      doctype: "Stock Reconciliation",
      name: "OPENING-1",
      purpose: "Opening Stock",
      kind: "Opening",
      version: "2026-10-17 12:00:00",
      docstatus: 1,
      editable: false,
      posting_date: "2026-10-17",
      posting_time: "12:00:00",
      ti_activity: "ACT-OPAQUE",
      items: [
        {
          name: "OPENING-LINE",
          item_code: "ITEM-A",
          item_name: "期初物资",
          warehouse: "ROOM-A",
          qty: 7,
          stock_uom: "Nos",
        },
      ],
    };
    let title = "已归档的关联活动";
    let denied = false;
    let exportMode: "running" | "completed" = "running";
    const queries: Record<string, unknown>[] = [];
    await page.route("**/api/method/temple_inventory.**", async (route) => {
      const method = new URL(route.request().url()).pathname
        .split(".")
        .slice(-2)
        .join(".");
      const args = route.request().postDataJSON() || {};
      let message: unknown = [];
      if (method === "native_api.load_document") message = doc;
      else if (method === "activities.activity_label") {
        expect(args.name).toBe("ACT-OPAQUE");
        if (denied) {
          await route.fulfill({
            status: 403,
            json: { exc: "denied", exc_type: "PermissionError" },
          });
          return;
        }
        message = { name: "ACT-OPAQUE", title, archived: true };
      } else if (method === "projections.report_page") {
        queries.push(args.query);
        expect(args.query).toMatchObject({
          dataset: "movements",
          record: doc.name,
          recordDoctype: doc.doctype,
          statuses: [1],
        });
        message = {
          query: args.query,
          scope: args.query.scope,
          period: { key: "all", date_from: "", date_to: "" },
          snapshot: "2026-10-17 12:00:00",
          table: "records",
          columns: ["document", "kind", "stock_qty", "stock_uom"],
          rows: [
            {
              doctype: doc.doctype,
              document: doc.name,
              kind: "Opening",
              stock_qty: 7,
              stock_uom: "Nos",
            },
          ],
          matched_count: 1,
          next_start: null,
          summary: [],
          tables: [{ id: "records", label: "记录", count: 1 }],
        };
      } else if (method === "exports.request_export") {
        message = {
          name: "EXPORT-1",
          status: "Queued",
          progress: 1,
          error: "",
          version: "v1",
          attempt: 1,
          generated_at: "",
          row_count: 1,
          download_url:
            "/api/method/temple_inventory.exports.download_export?name=EXPORT-1",
          file_label: "期初明细.xlsx",
        };
      } else if (method === "exports.export_status") {
        message = {
          name: "EXPORT-1",
          status: exportMode === "completed" ? "Completed" : "Running",
          progress: exportMode === "completed" ? 100 : 52,
          stage: exportMode === "completed" ? "完成" : "写入文件",
          progress_detail:
            exportMode === "completed" ? "已生成 1 行" : "已写入 1 行",
          error: "",
          version: "v1",
          attempt: 1,
          generated_at: "2026-10-17 12:00:00",
          row_count: 1,
          download_url:
            "/api/method/temple_inventory.exports.download_export?name=EXPORT-1",
          file_label: "期初明细.xlsx",
        };
      } else if (method === "exports.download_export") {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.fulfill({
          status: 200,
          body: "export bytes",
          headers: {
            "content-type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition":
              "attachment; filename*=UTF-8''%E6%9C%9F%E5%88%9D%E6%98%8E%E7%BB%86.xlsx",
          },
        });
        return;
      }
      await route.fulfill({ json: { message } });
    });
    await nativeUiSession(page);
    await page.goto("/inventory/counts/OPENING-1");
    await expect(page.locator(".form-page")).toContainText(title);
    await expect(page.locator(".form-page")).not.toContainText("ACT-OPAQUE");
    title = "重新命名的活动";
    await page.reload();
    await expect(page.locator(".form-page")).toContainText(title);
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导出", exact: true });
    await expect(dialog).toContainText("共 1 行");
    await expect(dialog.locator(".report-table")).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: "打开报表", exact: true }),
    ).toHaveCount(0);
    expect(queries.length).toBeGreaterThanOrEqual(1);
    if (width === 1440) {
      await dialog
        .getByRole("button", { name: "开始导出", exact: true })
        .click();
      await expect(dialog).toContainText("写入文件 · 52% · 已写入 1 行");
      await page.screenshot({
        path: test.info().outputPath("export-generating.png"),
      });
      exportMode = "completed";
      await expect(dialog).toContainText("已生成", { timeout: 3000 });
      const downloadButton = dialog.getByRole("button", {
        name: /下载 期初明细/,
      });
      const downloadFinished = page.waitForEvent("download");
      await downloadButton.click();
      await expect(dialog).toContainText("正在准备下载…");
      await page.screenshot({
        path: test.info().outputPath("export-downloading.png"),
      });
      await downloadFinished;
    }
    await page.goto("/inventory/counts/OPENING-1");
    denied = true;
    await page.reload();
    await expect(page.locator(".form-page")).toContainText("活动暂不可用");
    expect(errors).toEqual([]);
  });
}
