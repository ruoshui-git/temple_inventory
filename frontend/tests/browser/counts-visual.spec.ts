import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

const reviewRows = [
  {
    item_code: "ITEM-A",
    item_name: "礼堂椅",
    image: "",
    warehouse: "A02-DIRECT",
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: 4,
    actual_qty: 6,
    review_state: "Reviewed",
    reason: "",
    needs_review: false,
  },
  {
    item_code: "ITEM-B",
    item_name: "舞台灯",
    image: "",
    warehouse: "ROOM-B-DIRECT",
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: 7,
    actual_qty: 5,
    review_state: "Reviewed",
    reason: "",
    needs_review: false,
  },
  {
    item_code: "ITEM-C",
    item_name: "谱架",
    image: "",
    warehouse: "A02-DIRECT",
    batch_no: null,
    stock_uom: "Nos",
    baseline_qty: 2,
    actual_qty: 2,
    review_state: "Reviewed",
    reason: "",
    needs_review: false,
  },
];
const baselineRows = reviewRows.map((row) => ({
  ...row,
  actual_qty: null,
  review_state: "Unreviewed",
}));
const detailDocument = {
  doctype: "Stock Reconciliation",
  name: "COUNT-VISUAL",
  version: "count-visual-v1",
  docstatus: 1,
  purpose: "Stock Reconciliation",
  editable: false,
  posting_date: "2026-10-16",
  posting_time: "12:00:00",
  ti_time_mode: "Historical",
  ti_notes: "示例盘点备注",
  ti_count_review: reviewRows,
  items: [
    {
      name: "COUNT-LINE-A",
      item_code: "ITEM-A",
      item_name: "礼堂椅",
      warehouse: "A02-DIRECT",
      qty: 6,
      current_qty: 4,
      stock_uom: "Nos",
    },
    {
      name: "COUNT-LINE-B",
      item_code: "ITEM-B",
      item_name: "舞台灯",
      warehouse: "ROOM-B-DIRECT",
      qty: 5,
      current_qty: 7,
      stock_uom: "Nos",
    },
  ],
};

test("fixture count editor and detail render the review layouts at desktop and phone sizes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await nativeUiSession(page, 100, {
    physical_leaves: [
      "A02-DIRECT",
      "SHELF-1",
      "DEMO-A-DIRECT",
      "ROOM-B-DIRECT",
    ],
    capabilities: {
      "Stock Reconciliation": {
        read: true,
        create: true,
        write: true,
        submit: true,
        delete: true,
        cancel: true,
        amend: true,
      },
    },
  });
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split("/")
      .at(-1)!
      .replace("temple_inventory.", "");
    const args = route.request().postDataJSON() || {};
    let message: unknown = [];
    if (
      method === "session.info" ||
      method === "configuration.status" ||
      method === "browse.bootstrap"
    ) {
      await route.fallback();
      return;
    }
    if (method === "native_api.editor_clock")
      message = { timestamp: "2026-10-16 12:00:00" };
    else if (method === "counts.count_baseline") {
      const previous = (args.previous_rows as typeof baselineRows) || [];
      message = {
        rows: baselineRows.map((row) => {
          const old = previous.find(
            (candidate) =>
              candidate.item_code === row.item_code &&
              candidate.warehouse === row.warehouse,
          );
          return old
            ? {
                ...row,
                actual_qty: old.actual_qty,
                review_state: old.review_state,
              }
            : row;
        }),
        timestamp: args.timestamp,
        warehouses: ["A02-DIRECT", "ROOM-B-DIRECT"],
        removed_rows: [],
      };
    } else if (method === "counts.save_count") {
      message = {
        ...(args.data as Record<string, unknown>),
        doctype: "Stock Reconciliation",
        name: "COUNT-DRAFT",
        version: "count-draft-v1",
        docstatus: 0,
        editable: true,
      };
    } else if (method === "native_api.load_document") message = detailDocument;
    else if (method === "native_files.attachments") message = [];
    else if (method === "table_preferences.get_column_preferences")
      message = {};
    else if (method === "notifications.inbox")
      message = { items: [], unread_count: 0, has_running_exports: false };
    else message = {};
    await route.fulfill({ json: { message } });
  });

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/inventory/counts/new");
    const rows = page.locator("[data-count-key]");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole("combobox", { name: "分组方式" })).toHaveValue(
      "location",
    );
    await expect(page.locator(".form-actions.document-actions")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`count-editor-${width}x${height}.png`),
    });
    if (width === 1440) {
      await page.getByLabel("礼堂椅实点数量").fill("6");
      await page
        .getByRole("button", { name: "核对并确认", exact: true })
        .click();
      const dialog = page.locator(".ui-overlay");
      await expect(dialog).toBeVisible();
      await expect(
        dialog.locator(".count-summary-strip .metric.is-net.is-increase"),
      ).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath("count-confirmation-1440x900.png"),
      });
    }
  }

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/inventory/counts/COUNT-VISUAL");
    await expect(page.locator(".count-readonly")).toBeVisible();
    await expect(page.locator(".count-summary-strip .metric")).toHaveCount(5);
    await expect(
      page.locator(".count-readonly-table .data-table-group-row").first(),
    ).toBeVisible();
    await expect(
      page.locator(".count-readonly-table .stock-effect").first(),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`count-detail-${width}x${height}.png`),
    });
  }
  expect(errors).toEqual([]);
});
