import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { newReportQuery } from "../../../src/lib/reportContract";

let csrfToken = "";

test.beforeEach(async ({ page }) => {
  test.skip(
    !process.env.NATIVE_ADMIN_PASSWORD,
    "Requires the local development account",
  );
  const response = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(response.ok()).toBe(true);
  const session = await page.request.get(
    "/api/method/temple_inventory.session.info",
  );
  expect(session.ok()).toBe(true);
  csrfToken = (await session.json()).message.csrf_token;
  page.setExtraHTTPHeaders({
    "X-Frappe-CSRF-Token": csrfToken,
    "X-Inventory-Account": "Administrator",
  });
});

async function settled(page: Page, path: string) {
  await page.goto(path);
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
}

async function capture(
  page: Page,
  name: string,
  width: number,
  height: number,
) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({
    path: test.info().outputPath(`${name}-${width}x${height}.png`),
  });
}

test("loan scope, movement effects and multi-location records render at desktop and phone widths", async ({
  page,
}) => {
  await settled(page, "/inventory/loans");
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.locator('[data-filter-field="loanScope"] > summary').click();
  await page
    .getByRole("button", { name: "借出与归还全部记录", exact: true })
    .click();
  await expect(
    page.getByText("也列出已全部归还的借出行和物品（未归还余额为零）。"),
  ).toBeVisible();
  await capture(page, "loans-all-scope-filters", 1440, 900);
  await capture(page, "loans-all-scope-filters", 390, 844);

  await settled(page, "/inventory/movements?view=items");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "设置列" }).first().click();
  await page
    .getByRole("group", { name: "设置表格列" })
    .getByRole("button", { name: "恢复默认", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("columnheader", { name: "物品名称" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "可用变化" }),
  ).toBeVisible();
  await capture(page, "movements-items", 1440, 900);
  await capture(page, "movements-items", 390, 844);

  const pageResponse = await page.request.post(
    "/api/method/temple_inventory.browse.operation_page",
    {
      headers: { "X-Frappe-CSRF-Token": csrfToken },
      data: {
        records: true,
        page_length: 100,
        query: {
          dataset: "movements",
          view: "records",
          statuses: [1],
        },
      },
    },
  );
  expect(pageResponse.ok()).toBe(true);
  const payload = (await pageResponse.json()).message;
  const record = payload.rows.find(
    (row: {
      whole?: { branches?: { source: string; destination: string }[] };
    }) =>
      new Set((row.whole?.branches || []).map((branch) => branch.destination))
        .size > 1,
  );
  expect(
    record,
    "development data should include a record with multiple destinations",
  ).toBeTruthy();
  await settled(page, "/inventory/movements?view=records");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("input[data-browse-search]").fill(record.document);
  await expect(page.getByText(record.document, { exact: true })).toBeVisible();
  const manyLocations = page.getByRole("button", {
    name: /去向位置，共 \d+ 处/,
  });
  await expect(manyLocations).toBeVisible();
  await manyLocations.click();
  await expect(
    page.getByRole("dialog", { name: /去向位置，共 \d+ 处/ }),
  ).toBeVisible();
  await capture(page, "movements-records-many-locations-open", 1440, 900);
  await capture(page, "movements-records-many-locations-open", 390, 844);

  const grouped = {
    dataset: "movements",
    view: "summary",
    groupBy: ["item"],
  };
  await settled(
    page,
    `/inventory/movements?view=items&query=${encodeURIComponent(JSON.stringify(grouped))}`,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".data-table-group-row").first()).toBeVisible();
  await capture(page, "movements-grouped-item-summaries", 1440, 900);
  await capture(page, "movements-grouped-item-summaries", 390, 844);
});

test("live XLSX exports include loan scopes and movement available-effect totals", async ({
  page,
}) => {
  async function exportXlsx(
    query: ReturnType<typeof newReportQuery>,
    table: string,
    name: string,
    grouped = false,
  ) {
    const requested = await page.request.post(
      "/api/method/temple_inventory.exports.request_export",
      {
        headers: {
          "X-Frappe-CSRF-Token": csrfToken,
          "X-Inventory-Account": "Administrator",
        },
        data: { query, table, export_format: "xlsx", grouped },
      },
    );
    expect(requested.ok()).toBe(true);
    const job = (await requested.json()).message;
    let status;
    await expect
      .poll(
        async () => {
          const response = await page.request.post(
            "/api/method/temple_inventory.exports.export_status",
            {
              headers: {
                "X-Frappe-CSRF-Token": csrfToken,
                "X-Inventory-Account": "Administrator",
              },
              data: { name: job.name },
            },
          );
          expect(response.ok()).toBe(true);
          status = (await response.json()).message;
          if (status.status === "Failed") throw new Error(status.error);
          return status.status;
        },
        { timeout: 90000, intervals: [250, 500, 1000] },
      )
      .toBe("Completed");
    const download = await page.request.get(status.download_url);
    expect(download.ok()).toBe(true);
    const path = test.info().outputPath(name);
    writeFileSync(path, await download.body());
    const python =
      process.env.NATIVE_PYTHON || resolve("../../../env/bin/python");
    const workbookRows = execFileSync(
      python,
      [
        "-c",
        "import json,sys,openpyxl; w=openpyxl.load_workbook(sys.argv[1],read_only=True); s=w.worksheets[0]; print(json.dumps(list(s.iter_rows(values_only=True)),ensure_ascii=False))",
        path,
      ],
      { encoding: "utf8" },
    );
    return JSON.parse(workbookRows) as unknown[][];
  }

  const loansOpen = newReportQuery("loans");
  loansOpen.view = "items";
  const openRows = await exportXlsx(
    loansOpen,
    "loan_history",
    "loans-outstanding.xlsx",
  );
  const loansAll = { ...loansOpen, loanScope: "all" as const };
  const allRows = await exportXlsx(
    loansAll,
    "loan_history",
    "loans-all-history.xlsx",
  );
  const groupedLoans = {
    ...loansAll,
    includeZero: true,
    groupBy: ["item"] as typeof loansAll.groupBy,
  };
  const groupedLoanRows = await exportXlsx(
    groupedLoans,
    "loan_history",
    "loans-all-history-grouped.xlsx",
    true,
  );

  const movements = newReportQuery("movements");
  movements.view = "summary";
  const movementRows = await exportXlsx(
    movements,
    "history",
    "movements-history.xlsx",
  );
  const movementRecords = { ...movements, view: "records" as const };
  const recordRows = await exportXlsx(
    movementRecords,
    "records",
    "movements-records.xlsx",
  );

  expect(openRows[0]).toContain("编号");
  expect(openRows[0]).toContain("物品名称");
  expect(openRows[0]).toContain("数量");
  expect(openRows[0]).not.toContain("借出为正");
  expect(allRows.length).toBeGreaterThan(openRows.length);
  expect(groupedLoanRows.some((row) => String(row[0]).startsWith("合计"))).toBe(
    true,
  );
  expect(movementRows[0]).toContain("可用变化");
  expect(
    movementRows.some((row) => String(row[0]).startsWith("合计可用变化")),
  ).toBe(true);
  expect(recordRows[0]).toContain("可用变化");
  expect(
    recordRows.some((row) => String(row[0]).startsWith("合计可用变化")),
  ).toBe(true);
});
