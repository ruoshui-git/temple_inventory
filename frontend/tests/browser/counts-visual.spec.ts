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
    else if (method === "browse.counts_page")
      message = {
        rows: [
          {
            id: "count-list-row",
            doctype: "Stock Reconciliation",
            document: "MAT-RECO-2026-00023",
            item_name: "礼堂椅",
            kind: "Reconcile",
            docstatus: 1,
            date: "2026-10-16",
            time: "12:00:00",
            allocation_count: 2,
            item_count: 2,
            document_count: 1,
            whole: {
              version: "count-row-v1",
              editable: false,
              line_count: 2,
              item_count: 2,
              quantities: [{ uom: "Nos", qty: 2 }],
              branches: [],
              original_loans: [],
            },
          },
        ],
        matched_count: 1,
        next_start: null,
      };
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
    [1280, 900],
    [430, 932],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/inventory/counts/new");
    await expect(page.locator("[data-count-key]").first()).toBeVisible();
    const before = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    await page
      .locator(".ti-disclosure-section")
      .filter({ hasText: "活动、人员与附件" })
      .locator("summary")
      .click();
    await expect(
      page
        .locator(".ti-disclosure-section")
        .filter({ hasText: "活动、人员与附件" }),
    ).toHaveAttribute("open", "");
    const after = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    const overflowers = await page.evaluate(() =>
      Array.from(document.body.querySelectorAll<HTMLElement>("*"))
        .map((element) => ({
          tag: element.tagName,
          className:
            typeof element.className === "string" ? element.className : "",
          text: element.innerText?.slice(0, 80) || "",
          right: Math.round(element.getBoundingClientRect().right),
        }))
        .filter((element) => element.right > window.innerWidth + 1)
        .slice(-12),
    );
    expect(
      after,
      `horizontal overflow at ${width}px (before ${before}px): ${JSON.stringify(overflowers)}`,
    ).toBe(0);
    if (width === 430)
      await page.screenshot({
        path: test.info().outputPath("count-context-430x932.png"),
      });
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

  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/inventory/counts");
  await expect(page.getByText("MAT-RECO-2026-00023")).toBeVisible();
  const countId = page
    .locator(".count-records-table .count-record-id-column")
    .first();
  await expect(countId).not.toHaveClass(/data-table-pinned-start/);
  await expect(page.locator("body")).toContainText("新建盘点");
  await expect(
    page.locator(".browse-mobile-actions").getByRole("button", {
      name: "新建盘点",
    }),
  ).toHaveCount(0);
  await expect(
    page.locator(".browse-split-button").getByRole("button", {
      name: "新建盘点",
    }),
  ).toBeVisible();
  const beforeStyle = await page.addStyleTag({
    content: `
      .count-records-table :is(th, td).count-record-id-column { min-width: 240px !important; width: 240px !important; }
      .count-records-table td.count-record-id-column { position: sticky !important; left: 0 !important; z-index: 12 !important; }
      .count-records-table td.count-record-id-column > :first-child,
      .count-records-table td.count-record-id-column .browse-row-link { display: inline-flex !important; width: max-content !important; max-width: none !important; overflow: visible !important; text-overflow: clip !important; }
    `,
  });
  await page.screenshot({
    path: test.info().outputPath("count-records-before-430x932.png"),
  });
  await beforeStyle.evaluate((style) => style.remove());
  await page.screenshot({
    path: test.info().outputPath("count-records-430x932.png"),
  });
  expect(errors).toEqual([]);
});
