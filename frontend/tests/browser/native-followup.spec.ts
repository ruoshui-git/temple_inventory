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
    const queries: Record<string, unknown>[] = [];
    await page.route("**/api/method/temple_inventory.**", async (route) => {
      const method = new URL(route.request().url()).pathname
        .split(".")
        .slice(-2)
        .join(".");
      const args = route.request().postDataJSON() || {};
      let message: unknown = [];
      if (method === "native_api.load_document") message = doc;
      else if (method === "activities.load_activity") {
        expect(args.name).toBe("ACT-OPAQUE");
        if (denied) {
          await route.fulfill({
            status: 403,
            json: { exc: "denied", exc_type: "PermissionError" },
          });
          return;
        }
        message = { name: "ACT-OPAQUE", title, status: "Archived" };
      } else if (method === "projections.report_page") {
        queries.push(args.query);
        expect(args.query).toMatchObject({
          dataset: "movements",
          record: doc.name,
          recordDoctype: doc.doctype,
          statuses: [1],
          includeAdjustments: true,
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
      }
      await route.fulfill({ json: { message } });
    });
    await nativeUiSession(page);
    await page.goto("/inventory/documents/Stock%20Reconciliation/OPENING-1");
    await expect(page.locator(".preview-form-page")).toContainText(title);
    await expect(page.locator(".preview-form-page")).not.toContainText(
      "ACT-OPAQUE",
    );
    title = "重新命名的活动";
    await page.reload();
    await expect(page.locator(".preview-form-page")).toContainText(title);
    await page.getByRole("button", { name: "快速导出", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "快速导出", exact: true });
    await expect(dialog.locator("tbody")).toContainText("OPENING-1");
    await expect(dialog.locator("tbody")).toContainText("7");
    await expect(dialog.locator("tbody button")).toHaveCount(0);
    await dialog
      .getByRole("button", { name: "打开导出页面", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/inventory\/reports/);
    await expect(page.locator("tbody").first()).toContainText("OPENING-1");
    expect(queries.length).toBeGreaterThanOrEqual(2);
    await page.goto("/inventory/documents/Stock%20Reconciliation/OPENING-1");
    denied = true;
    await page.reload();
    await expect(page.locator(".preview-form-page")).toContainText(
      "活动暂不可用",
    );
    expect(errors).toEqual([]);
  });
}
