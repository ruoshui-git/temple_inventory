import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

const baselineSerials = Array.from(
  { length: 20 },
  (_, index) => `SER-DEMO-${index + 1}`,
);
const actualSerials = [
  ...baselineSerials.slice(0, 18),
  "SER-FOUND-A",
  "SER-FOUND-B",
];
const countRow = {
  item_code: "SERIAL-DEMO",
  item_name: "便携式调音台（序列号样例）",
  image: "",
  warehouse: "A02-DIRECT",
  batch_no: null,
  stock_uom: "Nos",
  baseline_qty: 20,
  baseline_serials: baselineSerials,
  is_serial: true,
  actual_qty: 20,
  actual_serials: actualSerials,
  review_state: "Reviewed",
  reason: "",
  needs_review: false,
};
const serialAllocation = {
  item_code: "SERIAL-DEMO",
  warehouse: "A02-DIRECT",
  batch_no: null,
  baseline_serials: baselineSerials,
  actual_serials: actualSerials,
  missing_serials: baselineSerials.slice(18),
  found_serials: ["SER-FOUND-A", "SER-FOUND-B"],
};
const detailDocument = {
  doctype: "Stock Reconciliation",
  name: "COUNT-SERIAL-DEMO",
  version: "serial-count-v1",
  docstatus: 1,
  purpose: "Stock Reconciliation",
  editable: false,
  posting_date: "2026-11-01",
  posting_time: "12:00:00",
  ti_time_mode: "Historical",
  ti_count_review: [countRow],
  items: [
    {
      name: "COUNT-SERIAL-LINE",
      item_code: "SERIAL-DEMO",
      item_name: countRow.item_name,
      warehouse: "A02-DIRECT",
      qty: 20,
      current_qty: 20,
      stock_uom: "Nos",
    },
  ],
};

test("serial count editor and read-only detail render desktop and phone evidence", async ({
  page,
}, testInfo) => {
  await nativeUiSession(page, 100, {
    physical_leaves: ["A02-DIRECT"],
    capabilities: {
      "Stock Reconciliation": {
        read: true,
        create: true,
        write: true,
        submit: true,
      },
    },
  });
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split("/")
      .at(-1)!
      .replace("temple_inventory.", "");
    if (
      ["session.info", "configuration.status", "browse.bootstrap"].includes(
        method,
      )
    ) {
      await route.fallback();
      return;
    }
    const args = route.request().postDataJSON() || {};
    let message: unknown = [];
    if (method === "native_api.editor_clock")
      message = { timestamp: "2026-11-01 12:00:00" };
    else if (method === "counts.count_baseline")
      message = {
        rows: [
          {
            ...countRow,
            actual_qty: null,
            actual_serials: null,
            review_state: "Unreviewed",
          },
        ],
        timestamp: args.timestamp,
        warehouses: ["A02-DIRECT"],
        removed_rows: [],
      };
    else if (method === "counts.count_serial_details")
      message = [serialAllocation];
    else if (method === "native_api.load_document") message = detailDocument;
    else if (method === "native_files.attachments") message = [];
    else if (method === "table_preferences.get_column_preferences")
      message = {};
    else if (method === "notifications.inbox")
      message = { items: [], unread_count: 0, has_running_exports: false };
    await route.fulfill({ json: { message } });
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory/counts/new");
  await expect(page.locator(".serial-count")).toBeVisible();
  await expect(
    page.locator(
      ".count-table tr[data-row-id^='count-serial-detail:'] .data-table-group-toggle",
    ),
  ).toBeHidden();
  await expect(page.getByText("便携式调音台（序列号样例）")).toBeVisible();
  await expect(
    page.locator(".count-table tr[data-row-id^='count-serial-detail:']"),
  ).toBeVisible();
  await expect(page.getByText("实点 — / 账面 20")).toBeVisible();
  await expect(
    page.locator(".count-table tr.data-table-group-detail-row"),
  ).toBeVisible();
  const desktopDetailWidth = await page
    .locator(".count-table tr.data-table-group-detail-row")
    .evaluate((row) => row.getBoundingClientRect().width);
  const desktopTableWidth = await page
    .locator(".count-table")
    .evaluate((table) => table.getBoundingClientRect().width);
  expect(desktopDetailWidth).toBeGreaterThan(desktopTableWidth - 4);
  const desktopToggle = page.locator(
    ".count-table tr[data-row-id^='count-serial-detail:'] .serial-count-row-toggle",
  );
  await desktopToggle.click();
  await expect(
    page.locator(".count-table tr.data-table-group-detail-row"),
  ).toBeHidden();
  await desktopToggle.click();
  await expect(
    page.locator(".count-table tr.data-table-group-detail-row"),
  ).toBeVisible();
  await page.locator(".serial-count-chips .serial-count-chip").nth(0).click();
  await page.locator(".serial-count-chips .serial-count-chip").nth(1).click();
  await page.screenshot({
    path: testInfo.outputPath("serial-count-editor-desktop.png"),
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".count-card .serial-count")).toBeVisible();
  await page
    .locator(".count-card .serial-count")
    .evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
  const mobileBounds = await page.locator(".count-card").evaluate((card) => {
    const edge = card.getBoundingClientRect().right;
    const bounds = [
      ...card.querySelectorAll(
        ".serial-count, .serial-count-chip, .serial-count-actions, .serial-count-add, .serial-count-add input, .serial-count-add button",
      ),
    ].map((element) => element.getBoundingClientRect());
    return { edge, overflowing: bounds.some((box) => box.right > edge + 1) };
  });
  expect(mobileBounds.overflowing).toBe(false);
  expect(
    await page
      .locator(".count-card .serial-count-chip")
      .first()
      .evaluate((chip) => chip.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await page.screenshot({
    path: testInfo.outputPath("serial-count-editor-phone.png"),
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory/counts/COUNT-SERIAL-DEMO");
  await expect(page.locator(".count-readonly")).toBeVisible();
  await expect(
    page.locator(".count-readonly-table .stock-effect").first(),
  ).toBeVisible();
  await page
    .locator(".count-readonly-item .count-serial-detail details summary")
    .click();
  await page.waitForTimeout(100);
  await expect(page.getByText("缺少：SER-DEMO-19、SER-DEMO-20")).toBeVisible();
  await expect(page.getByText("多出：SER-FOUND-A、SER-FOUND-B")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("serial-count-readonly-detail.png"),
  });
});
