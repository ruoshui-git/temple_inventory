import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nativeUiSession, sampleWarehouses } from "./fixtures/nativeUi";
import { newReportQuery } from "../../src/lib/reportContract";

// Review the actual built bundle, with controlled native HTTP responses.
const appRoot = fileURLToPath(new URL("../../..", import.meta.url));
const publicRoot = path.join(appRoot, "temple_inventory/public/frontend");
const indexPath = path.join(publicRoot, "index.html");
const fontPath = [
  process.env.NATIVE_UI_REVIEW_FONT,
  "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf",
].find((candidate) => Boolean(candidate && existsSync(candidate)));
const builtShell = existsSync(indexPath)
  ? readFileSync(indexPath, "utf8")
      .replace(/<script>\s*\{% for key in boot %\}[\s\S]*?<\/script>/, "")
      .replace(
        "</head>",
        `${fontPath ? "<style>@font-face{font-family:ReviewCJK;src:url(/review-font.otf)}body,button,input,select,textarea{font-family:ReviewCJK,sans-serif!important}</style>" : ""}</head>`,
      )
  : undefined;
const item = {
  item_code: "ITM-000004",
  item_name: "法会供灯用品",
  item_group: "日常用品",
  stock_uom: "Nos",
  image: "/review-item.webp",
  description: "供灯用品",
  version: "2026-10-19 10:00:00",
  has_batch_no: true,
  has_expiry_date: true,
  can_edit: true,
  barcodes: [],
  uoms: [],
  attachments: [],
};
const baseRow = {
  id: "batch-1",
  ...item,
  category: item.item_group,
  batch_no: "BATCH-001",
  date: "2026-10-19",
  warehouse: "ROOM-A",
  stock_qty: 12,
  available: 12,
  loaned: 0,
  damaged: 0,
  expiry_date: "2027-04-19",
  manufacturing_date: "2026-04-19",
  remaining_days: 182,
  document_count: 2,
  allocation_count: 2,
};
const locations = {
  rows: [baseRow],
  matched_count: 1,
  next_start: null,
  summary: [
    { stock_uom: "Nos", stock_qty: 12, available: 12, loaned: 0, damaged: 0 },
  ],
};
const history = {
  rows: [
    {
      ...baseRow,
      id: "entry-1",
      doctype: "Stock Entry",
      document: "MAT-2026-00001",
      kind: "Receive",
      docstatus: 1,
      source_warehouse: "",
      destination_warehouse: "ROOM-A",
    },
  ],
  matched_count: 1,
  next_start: null,
};

async function prepare(page: Page, scale = 100, density = "balanced") {
  // This suite intentionally routes the production Vite bundle; run pnpm build first.
  if (!builtShell) {
    test.skip(true, "Built frontend bundle is missing; run pnpm build first.");
    throw new Error("Built frontend bundle is missing");
  }
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const prefix = "/assets/temple_inventory/frontend/";
    if (url.pathname.startsWith(prefix)) {
      const file = path.join(publicRoot, url.pathname.slice(prefix.length));
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "application/octet-stream";
      return route.fulfill({ body: readFileSync(file), contentType: type });
    }
    if (url.pathname === "/review-font.otf" && fontPath)
      return route.fulfill({
        body: readFileSync(fontPath),
        contentType: "font/otf",
      });
    if (url.pathname === "/review-font.otf")
      return route.fulfill({ status: 404, body: "" });
    if (url.pathname === "/review-item.webp")
      return route.fulfill({
        body: readFileSync(
          path.join(
            appRoot,
            "temple_inventory/setup/sample_assets/images/general/ITM-000004.webp",
          ),
        ),
        contentType: "image/webp",
      });
    if (url.pathname.startsWith("/inventory"))
      return route.fulfill({ body: builtShell, contentType: "text/html" });
    if (!url.pathname.startsWith("/api/"))
      return route.fulfill({ status: 404, body: "" });
    const method = url.pathname.split("temple_inventory.")[1] || "";
    const args = route.request().postDataJSON() || {};
    let message: unknown = [];
    const query = args.query || newReportQuery("movements");
    if (method === "catalog.batch_details")
      message = {
        name: "BATCH-001",
        item_code: item.item_code,
        item,
        expiry_date: baseRow.expiry_date,
        manufacturing_date: baseRow.manufacturing_date,
        description: "本批次供灯用品",
        disabled: false,
        version: item.version,
        can_edit: true,
        locations,
        history,
      };
    else if (method === "catalog.save_batch")
      return route.fulfill({
        status: 409,
        json: {
          exc_type: "TimestampMismatchError",
          message: "记录已被更改，请保留当前输入并重新载入",
        },
      });
    else if (method === "browse.expiry_page")
      message = {
        ...locations,
        rows: [baseRow],
        query,
        snapshot: item.version,
        item_count: 1,
        batch_count: 1,
        facets: { all: 1, expired: 0, unexpired: 1, undated: 0 },
        totals: locations.summary,
        analysis: {},
      };
    else if (method === "browse.operation_page") {
      const loan = query.dataset === "loans";
      const rows = [1, 2, 3].map((n) => ({
        ...baseRow,
        id: "operation-" + n,
        item,
        doctype: "Stock Entry",
        document: "MAT-2026-0000" + n,
        kind: loan
          ? "Loan"
          : n === 1
            ? "Receive"
            : n === 2
              ? "Issue"
              : "Transfer",
        borrower: "",
        activity_title: "",
        docstatus: 1,
        outcome_key: loan ? "outstanding" : undefined,
        totals: [
          {
            [loan ? "outcome_key" : "kind"]: loan
              ? "outstanding"
              : n === 1
                ? "Receive"
                : n === 2
                  ? "Issue"
                  : "Transfer",
            stock_qty: 12,
            stock_uom: "Nos",
            docstatus: 1,
            available_effect: n === 1 ? 12 : n === 2 ? -12 : 0,
          },
        ],
        whole: {
          quantities: [{ qty: 12, uom: "Nos" }],
          outstanding: [{ qty: 5, uom: "Nos" }],
          available_effects: [
            { qty: n === 1 ? 12 : n === 2 ? -12 : 0, uom: "Nos" },
          ],
          item_count: 1,
          line_count: 1,
          branches: [
            {
              source: n === 1 ? "" : "ROOM-A",
              destination: n === 2 ? "" : "ROOM-B",
            },
          ],
          original_loans: [],
          loan_status: "Open",
        },
      }));
      message = {
        rows,
        matched_count: 3,
        next_start: null,
        query,
        snapshot: item.version,
        analysis: {},
        totals: rows
          .flatMap((r) => r.totals)
          .map((t) => ({ ...t, outstanding: 5, borrowed: 12 })),
        summary: { item_count: 1, document_count: 3 },
      };
    } else if (method === "browse.dashboard_card") {
      message = {
        rows:
          args.card === "movement"
            ? history.rows.map((r) => ({
                ...r,
                item_names: item.item_name,
                quantities: [{ qty: 12, uom: "Nos", effect: 12 }],
              }))
            : [],
        query: newReportQuery(
          args.card === "movement" ? "movements" : "inventory",
        ),
        snapshot: item.version,
        totals:
          args.card === "movement"
            ? [
                {
                  kind: "Receive",
                  stock_uom: "Nos",
                  stock_qty: 12,
                  available_effect: 12,
                },
                {
                  kind: "Issue",
                  stock_uom: "Nos",
                  stock_qty: 5,
                  available_effect: -5,
                },
              ]
            : locations.summary,
        expiry_rows: { expired: [], upcoming: [] },
        buckets: [],
        kind_counts: { Receive: 1, Issue: 1 },
        matched_count: 1,
        item_count: 1,
        expired_count: 0,
        damaged_item_count: 0,
      };
    }
    return route.fulfill({ json: { message } });
  });
  await nativeUiSession(page, scale, {
    warehouses: sampleWarehouses,
    physical_leaves: [
      "A02-DIRECT",
      "SHELF-1",
      "DEMO-A-DIRECT",
      "ROOM-B-DIRECT",
    ],
    categories: [
      { name: "日常用品", item_group_name: "日常用品", is_group: false },
    ],
    operations: {
      Receive: true,
      Issue: true,
      Transfer: true,
      Loan: true,
      Return: true,
    },
  });
  await page.route("**/api/method/temple_inventory.session.info", (route) =>
    route.fulfill({
      json: {
        message: {
          user: "manager",
          csrf_token: "native-ui-test",
          ui_preferences: { theme: "jade", density, textScale: scale },
        },
      },
    }),
  );
  return errors;
}

async function reviewScreenshot(
  page: Page,
  options: { path: string; fullPage: boolean },
) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot(options);
}

for (const width of [1440, 390]) {
  test(`records, compact header and navigation at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await prepare(page);
    await page.goto("/inventory/movements?view=records");
    await expect(page.locator("[data-browse-row]")).toHaveCount(3);
    await expect(page.locator("thead th")).toHaveText([
      "记录",
      "类型",
      /日期/,
      "来源",
      "去向",
      "数量",
      "状态",
    ]);
    await expect(page.locator("tbody .stock-effect.is-increase")).toHaveCount(
      1,
    );
    await expect(page.locator("tbody .stock-effect.is-decrease")).toHaveCount(
      1,
    );
    await expect(page.locator("tbody .stock-effect.is-decrease")).toHaveCSS(
      "color",
      "rgb(161, 50, 44)",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(page.getByText("符合筛选的明细", { exact: true })).toHaveCount(
      0,
    );
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await reviewScreenshot(page, {
      path: info.outputPath("movement-records.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("button", { name: "按物品", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "按记录", exact: true }),
    ).toBeVisible();
    await reviewScreenshot(page, {
      path: info.outputPath("persistent-header.png"),
      fullPage: true,
    });
    if (width < 1024) {
      const nav = page.locator(".sample-mobile-nav");
      await expect(nav.getByRole("button")).toHaveCount(6);
      expect(await nav.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
        true,
      );
      await expect(
        page
          .locator(".sample-breadcrumb")
          .getByRole("button", { name: "更多", exact: true }),
      ).toHaveCount(0);
      await nav.getByRole("button", { name: "更多", exact: true }).click();
      await expect(page).toHaveURL(/\/more$/);
      await expect(nav.locator('[aria-current="page"]')).toHaveText("更多");
    } else
      await expect(
        page
          .locator(".sample-sidebar")
          .getByRole("button", { name: "更多", exact: true }),
      ).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test(`loan records and item summaries at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await prepare(page);
    await page.goto("/inventory/loans?view=records");
    await expect(page.locator(".loan-record-table tbody tr")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "登记归还", exact: true }),
    ).toHaveCount(3);
    await expect(
      page.locator(".loan-record-table tbody tr").first().locator("td").nth(1),
    ).toBeEmpty();
    await expect(
      page.locator(".loan-record-table tbody tr").first().locator("td").nth(2),
    ).toBeEmpty();
    if (width < 1024) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const tableScrollport = page.locator(".loan-record-table");
      expect(
        await tableScrollport.evaluate((el) => el.scrollWidth > el.clientWidth),
      ).toBe(true);
    }
    await page.evaluate(() => document.fonts.ready);
    await reviewScreenshot(page, {
      path: info.outputPath("loan-records.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "按物品", exact: true }).click();
    await expect(page.locator(".preview-group-metrics")).toHaveCount(3);
    await expect(page.locator(".preview-group-metrics").first()).toContainText(
      "未归还",
    );
    await expect(page.locator(".preview-group-metrics").first()).toContainText(
      "12 Nos",
    );
    await reviewScreenshot(page, {
      path: info.outputPath("loan-items.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });

  test(`expiry lightbox, batch route, edit conflict at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = await prepare(page);
    await page.goto("/inventory/stock/expiry");
    await expect(page.locator("[data-browse-row]")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "查看批次明细", exact: true }),
    ).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await reviewScreenshot(page, {
      path: info.outputPath("expiry.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: /放大查看.*图片/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/inventory/stock/expiry");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /关闭/ })
      .click();
    await page
      .getByRole("button", { name: /BATCH-001.*批次/ })
      .first()
      .click();
    await expect(page.locator(".batch-detail-page")).toBeVisible();
    await expect(page.locator(".batch-detail-page")).toContainText("已提交");
    await expect(page.locator(".batch-detail-page")).toContainText("入库");
    await expect(page.locator(".batch-detail-page")).toContainText("库房甲");
    await expect(
      page.locator('.quantity-summary[aria-label="批次数量汇总"]'),
    ).toContainText("12 Nos");
    await reviewScreenshot(page, {
      path: info.outputPath("batch-detail.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page
      .getByLabel("批次说明", { exact: true })
      .fill("尚未保存的批次说明");
    await page.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByLabel("批次说明", { exact: true })).toHaveValue(
      "尚未保存的批次说明",
    );
    await reviewScreenshot(page, {
      path: info.outputPath("batch-edit-conflict.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page.locator("[data-browse-row]")).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("expiry date header toggles its own sort direction", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await prepare(page);
  await page.goto("/inventory/stock/expiry");
  const nameHeader = page.getByRole("columnheader", { name: /物品名称/ });
  const nameButton = nameHeader.getByRole("button");
  const nameLabel = await nameButton
    .locator(".data-table-sort-label")
    .boundingBox();
  const nameIndicator = await nameButton
    .locator(".data-table-sort-indicator")
    .boundingBox();
  expect(nameLabel).not.toBeNull();
  expect(nameIndicator).not.toBeNull();
  expect(nameIndicator!.x - (nameLabel!.x + nameLabel!.width)).toBeLessThan(10);

  const quantityHeader = page.getByRole("columnheader", { name: /库存数量/ });
  const quantityButton = quantityHeader.getByRole("button");
  const quantityLabel = await quantityButton
    .locator(".data-table-sort-label")
    .boundingBox();
  const quantityIndicator = await quantityButton
    .locator(".data-table-sort-indicator")
    .boundingBox();
  const quantityCell = await quantityHeader.boundingBox();
  expect(quantityLabel).not.toBeNull();
  expect(quantityIndicator).not.toBeNull();
  expect(quantityCell).not.toBeNull();
  expect(quantityIndicator!.x).toBeLessThan(quantityLabel!.x);
  expect(
    quantityCell!.x +
      quantityCell!.width -
      (quantityLabel!.x + quantityLabel!.width),
  ).toBeLessThan(18);

  const dateHeader = page.getByRole("columnheader", { name: /效期/ });
  const before = await dateHeader.getAttribute("aria-sort");
  await dateHeader.getByRole("button").click();
  await expect(dateHeader).toHaveAttribute(
    "aria-sort",
    before === "ascending" ? "descending" : "ascending",
  );
});

test("large text and adaptive filter density", async ({ page }, info) => {
  const errors = await prepare(page, 200);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory/movements?view=items");
  await expect(page.locator("[data-browse-row]")).toHaveCount(3);
  await page
    .locator(".browse-toolbar")
    .getByRole("button", { name: /^筛选/ })
    .click();
  await expect(page.locator(".preview-filter-rail")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await reviewScreenshot(page, {
    path: info.outputPath("filters-200-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await reviewScreenshot(page, {
    path: info.outputPath("filters-200-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("desktop navigation wraps at the 1024px text scale breakpoint", async ({
  page,
}) => {
  const errors = await prepare(page, 200);
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.goto("/inventory/");
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const header = document.querySelector(".sample-sidebar");
    if (!header) return false;
    const measured = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--preview-desktop-nav-height",
      ),
    );
    return Math.abs(measured - header.getBoundingClientRect().height) < 1;
  });
  const metrics = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".sample-sidebar")!;
    const account = document.querySelector<HTMLElement>(".app-account-menu")!;
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      accountRight: account.getBoundingClientRect().right,
      navigationHeight: header.getBoundingClientRect().height,
      measuredHeight: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          "--preview-desktop-nav-height",
        ),
      ),
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.accountRight).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.measuredHeight).toBeCloseTo(metrics.navigationHeight, 0);
  expect(errors).toEqual([]);
});

test("dashboard uses the same increase/decrease quantity colors", async ({
  page,
}, info) => {
  const errors = await prepare(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/inventory/");
  await expect(
    page.locator('[data-section="movement"] .stock-effect.is-increase').first(),
  ).toBeVisible();
  await expect(
    page.locator('[data-section="movement"] .stock-effect.is-decrease').first(),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await reviewScreenshot(page, {
    path: info.outputPath("dashboard.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
