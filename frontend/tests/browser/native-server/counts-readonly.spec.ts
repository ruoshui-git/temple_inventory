import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { newReportQuery } from "../../../src/lib/reportContract";

let csrf = "";
async function call(request: APIRequestContext, method: string, data = {}) {
  const response = await request.post(
    `/api/method/temple_inventory.${method}`,
    {
      data,
      headers: {
        "X-Frappe-CSRF-Token": csrf,
        "X-Inventory-Account": "Administrator",
      },
    },
  );
  expect(response.ok(), `${method}: ${response.status()}`).toBe(true);
  const body = await response.json();
  expect(body.exc_type).toBeUndefined();
  return body.message;
}

test.beforeEach(async ({ page }) => {
  test.skip(
    !process.env.NATIVE_ADMIN_PASSWORD,
    "Requires the local development account",
  );
  const login = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(login.ok()).toBe(true);
  const session = await page.request.get(
    "/api/method/temple_inventory.session.info",
  );
  csrf = (await session.json()).message.csrf_token;
});

async function countRows(page: Page, statuses: number[]) {
  const result = await call(page.request, "browse.counts_page", {
    query: { dataset: "counts", view: "records", statuses },
    page_length: 1000,
  });
  return result.rows as Array<Record<string, any>>;
}

async function openingReconciliation(page: Page) {
  const response = await page.request.post(
    "/api/method/frappe.client.get_list",
    {
      data: {
        doctype: "Stock Reconciliation",
        fields: ["name"],
        filters: { purpose: "Opening Stock", docstatus: 1 },
        limit_page_length: 1,
      },
      headers: {
        "X-Frappe-CSRF-Token": csrf,
        "X-Inventory-Account": "Administrator",
      },
    },
  );
  expect(response.ok(), `opening reconciliation: ${response.status()}`).toBe(
    true,
  );
  return ((await response.json()).message as Array<{ name: string }>)[0];
}

async function capture(page: Page, route: string, label: string) {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main h1").first()).toBeVisible();
    if (label === "counts-browse") {
      await expect(page.locator(".browse-results")).toBeVisible();
      await expect(
        page.getByText("期初库存", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("净差异", { exact: true }).first(),
      ).toBeVisible();
      const recordId = page
        .locator(".count-records-table td.count-record-id-column strong")
        .first();
      await expect(recordId).toBeVisible();
      const idLayout = await recordId.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        textOverflow: getComputedStyle(element).textOverflow,
      }));
      expect(idLayout.textOverflow).toBe("clip");
      expect(idLayout.scrollWidth).toBeLessThanOrEqual(
        idLayout.clientWidth + 1,
      );
    } else if (label === "movements-count-available-change") {
      await expect(
        page.getByRole("columnheader", { name: "可用变化" }),
      ).toBeVisible();
      await expect(
        page
          .locator(".browse-table tbody tr")
          .filter({ hasText: "盘点调整" })
          .first(),
      ).toBeVisible();
    } else if (label === "count-draft-workspace") {
      await expect(page.locator(".form-page form")).toBeVisible();
      await expect(
        page.getByText("盘点范围与基准", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("combobox", { name: "分组方式" }),
      ).toHaveValue("location");
      await expect(page.getByText("确认时自动记录当前时间。")).toBeVisible();
    } else {
      await expect(page.locator(".count-readonly")).toBeVisible();
      await expect(page.locator(".count-readonly th")).toHaveCount(8);
      await expect(page.locator(".count-summary-strip .metric")).toHaveCount(5);
      await expect(
        page.locator(".count-readonly-table .data-table-group-row").first(),
      ).toBeVisible();
      await expect(
        page.locator(".count-readonly-table .stock-effect").first(),
      ).toBeVisible();
      await expect(page.locator(".count-workspace")).toHaveCount(0);
    }
    if (width < 1024)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        `${label} must not scroll the page sideways at ${width}px`,
      ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`${label}-${width}x${height}.png`),
    });
  }
}

test("count read-only detail, browse columns, and writable draft at desktop and phone sizes", async ({
  page,
}) => {
  const submitted = await countRows(page, [1]);
  const reference = submitted.find((row) => {
    const gains = row.whole?.gains || [];
    const losses = row.whole?.losses || [];
    const net = row.whole?.quantities || [];
    return (
      gains.some((value: { qty: number }) => Number(value.qty) === 1) &&
      losses.some((value: { qty: number }) => Number(value.qty) === -1) &&
      net.some((value: { qty: number }) => Number(value.qty) === 0)
    );
  });
  expect(reference, "submitted +1/-1 count with zero net").toBeTruthy();
  const mixed = submitted
    .filter(
      (row) =>
        Number(row.whole?.line_count) >= 30 &&
        row.whole?.gains?.length &&
        row.whole?.losses?.length,
    )
    .sort(
      (left, right) =>
        Number(right.whole.line_count) - Number(left.whole.line_count),
    )[0];
  expect(mixed, "large mixed submitted count").toBeTruthy();
  const opening = await openingReconciliation(page);
  expect(opening, "Opening Stock reconciliation").toBeTruthy();
  const drafts = await countRows(page, [0]);
  const draft = drafts.find((row) => row.whole?.editable);
  expect(draft, "writable draft count").toBeTruthy();

  await capture(
    page,
    `/inventory/counts/${encodeURIComponent(reference!.document)}`,
    "count-net-zero-reference",
  );
  await capture(
    page,
    `/inventory/counts/${encodeURIComponent(mixed!.document)}`,
    "count-large-mixed",
  );
  await capture(
    page,
    `/inventory/counts/${encodeURIComponent(opening!.name)}`,
    "count-opening-stock",
  );
  const countsQuery = newReportQuery("counts");
  countsQuery.view = "records";
  countsQuery.sortBy = "identity";
  countsQuery.sort = "asc";
  await capture(
    page,
    "/inventory/counts?view=records&query=" +
      encodeURIComponent(JSON.stringify(countsQuery)),
    "counts-browse",
  );
  await capture(
    page,
    `/inventory/counts/${encodeURIComponent(draft!.document)}`,
    "count-draft-workspace",
  );

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
    await expect(
      page.getByRole("button", { name: "添加物品", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".form-actions.document-actions")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`count-editor-${width}x${height}.png`),
    });
    if (width === 1440) {
      const first = rows.first();
      const baseline = Number(
        (await first.locator("td").nth(6).innerText()).replaceAll(",", ""),
      );
      await first.locator('input[type="number"]').fill(String(baseline + 1));
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
  const movementQuery = newReportQuery("movements");
  movementQuery.view = "records";
  movementQuery.scope.kinds = ["Reconcile"];
  const movementPage = await call(page.request, "browse.operation_page", {
    query: movementQuery,
    records: true,
    page_length: 50,
  });
  const movement = (movementPage.rows as Array<Record<string, any>>).find(
    (row) =>
      row.whole?.available_effects?.some(
        (effect: { qty: number }) => Number(effect.qty) !== 0,
      ),
  );
  expect(
    movement,
    "filtered count adjustment with an available effect",
  ).toBeTruthy();
  const movementRoute =
    "/inventory/movements?view=records&query=" +
    encodeURIComponent(JSON.stringify(movementQuery));
  await capture(page, movementRoute, "movements-count-available-change");
});
