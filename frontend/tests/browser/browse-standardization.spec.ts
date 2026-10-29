import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  auditCjkFontType,
  nativeUiSession,
  requiredAuditCjkFont,
  sampleWarehouses,
} from "./fixtures/nativeUi";

// Routed production components with controlled HTTP data. Native inventory
// correctness is checked separately by the rollback-only backend suite.
async function prepare(page: Page, textScale: number) {
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    const args = route.request().postDataJSON() || {};
    if (method.startsWith("browse.") && method.endsWith("_page")) await loaded;
    const rows = Array.from({ length: 24 }, (_, i) => ({
      id: `ROW-${i}`,
      code: `ITEM-${i}`,
      item_code: `ITEM-${i}`,
      name: `活动用品${i}`,
      item_name: `活动用品${i}`,
      category: "用品",
      uom: "件",
      stock_uom: "件",
      available: 8,
      loaned: 2,
      damaged: 1,
      stock_qty: 11,
      tracksBatch: true,
      tracksExpiry: true,
      image: "",
      locations: [
        {
          location: "A01",
          label: "礼堂储物室第一层",
          path: "T2 / A02 / S1",
          nativeName: "T2 / A02 / S1",
          available: 4,
          loaned: 0,
          damaged: 0,
        },
        {
          location: "A02",
          label: "礼堂储物室第二层",
          path: "T2 / A02",
          nativeName: "T2 / A02 · 直接存放",
          available: 4,
          loaned: 0,
          damaged: 0,
        },
      ],
      date: "2026-10-18",
      document: `MAT-${i}`,
      doctype: "Stock Entry",
      docstatus: 1,
      kind: "Receive",
      outcome_key: "outstanding",
      batch_no: `BATCH-${i}`,
      expiry_date: "2026-11-18",
      remaining_days: 31,
      warehouse: "DEFAULT-A14",
      source_warehouse: "SHELF-1",
      destination_warehouse: "A02-DIRECT",
      source_warehouse_path: "T2 / A02 / 演示架1",
      source_warehouse_native_name: "T2 / A02 / 演示架1",
      destination_warehouse_path: "T2 / A02",
      destination_warehouse_native_name: "T2 / A02 · 直接存放",
      document_count: 1,
      allocation_count: 1,
      totals: [
        { kind: "Receive", docstatus: 1, stock_uom: "件", stock_qty: 11 },
      ],
      whole: {
        item_count: 1,
        quantities: [{ uom: "件", qty: 11 }],
        branches: [
          {
            source: "SHELF-1",
            destination: "A02-DIRECT",
            source_path: "T2 / A02 / 演示架1",
            source_native_name: "T2 / A02 / 演示架1",
            destination_path: "T2 / A02",
            destination_native_name: "T2 / A02 · 直接存放",
          },
        ],
        original_loans: [],
        loan_status: "Open",
      },
    }));
    const totals = [
      {
        kind: "Transfer",
        outcome_key: "outstanding",
        docstatus: 1,
        stock_uom: "件",
        stock_qty: 6,
        outstanding: 6,
      },
      {
        kind: "Receive",
        outcome_key: "outstanding",
        docstatus: 1,
        stock_uom: "套",
        stock_qty: 3,
        outstanding: 3,
      },
      {
        kind: "Receive",
        outcome_key: "outstanding",
        docstatus: 1,
        stock_uom: "件",
        stock_qty: 12,
        outstanding: 12,
      },
    ];
    let message: unknown = [];
    if (method === "browse.inventory_page")
      message = {
        rows,
        matched_count: 24,
        next_start: null,
        query: args.query,
        snapshot: "2026-10-18 10:00:00",
        analysis: { category: [], location: [] },
        summary: [{ stock_uom: "件", available: 192, loaned: 48, damaged: 24 }],
      };
    else if (method === "browse.expiry_page")
      message = {
        rows,
        matched_count: 24,
        next_start: null,
        query: args.query,
        snapshot: "2026-10-18 10:00:00",
        item_count: 24,
        batch_count: 24,
        facets: { all: 24, expired: 0, unexpired: 24, undated: 0 },
        totals: [{ stock_uom: "件", available: 192, loaned: 48, damaged: 24 }],
        analysis: {},
      };
    else if (method === "browse.operation_page")
      message = {
        rows,
        matched_count: 24,
        next_start: null,
        query: args.query,
        snapshot: "2026-10-18 10:00:00",
        totals,
        summary: { item_count: 24, document_count: 24, category_count: 1 },
        analysis: {},
      };
    else if (method === "projections.group_page")
      message = {
        rows: [],
        matched_count: 0,
        next_start: null,
        parent_path: args.parent_path || [],
        row_grain: "group",
        query: args.query,
        leaf_columns: [],
      };
    await route.fulfill({ json: { message } });
  });
  await nativeUiSession(page, textScale, {
    categories: [
      {
        name: "LONG",
        item_group_name: "供灯用品与大型法会活动周转物资".repeat(5),
        is_group: false,
      },
      { name: "SHORT", item_group_name: "日常用品", is_group: false },
    ],
    warehouses: sampleWarehouses,
    physical_leaves: [
      "A02-DIRECT",
      "SHELF-1",
      "DEMO-A-DIRECT",
      "ROOM-B-DIRECT",
    ],
    operations: {
      Receive: true,
      Issue: true,
      Transfer: true,
      Loan: true,
      Return: true,
    },
  });
  const font = requiredAuditCjkFont();
  await page.route("**/review-font.otf", (route) =>
    route.fulfill({
      body: readFileSync(font),
      contentType: auditCjkFontType(font),
    }),
  );
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "@font-face{font-family:BrowseReview;src:url(/review-font.otf)}body,button,input,select,textarea{font-family:BrowseReview,sans-serif!important}";
      document.head.append(style);
    }),
  );
  return release;
}

test("stock and movement browse show exported full-location columns at 1440px", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    const preference = (order: string[]) =>
      JSON.stringify({
        version: 1,
        values: { order, hidden: [] },
        dirty: true,
      });
    localStorage.setItem(
      "temple-inventory:table-columns:v1:native-ui-test:manager:stock.summary",
      preference([
        "image",
        "item_name",
        "item_code",
        "available",
        "stock_uom",
        "category",
        "locations",
        "warehouse_path",
        "warehouse_native_name",
        "loaned",
        "damaged",
        "total",
        "expiry",
        "actions",
      ]),
    );
    localStorage.setItem(
      "temple-inventory:table-columns:v1:native-ui-test:manager:operations.movements.items",
      preference([
        "item_code",
        "image",
        "item_name",
        "document",
        "kind",
        "date",
        "docstatus",
        "source",
        "destination",
        "source_warehouse_path",
        "source_warehouse_native_name",
        "destination_warehouse_path",
        "destination_warehouse_native_name",
        "available_effect",
        "quantities",
        "related_loans",
      ]),
    );
  });
  const release = await prepare(page, 100);
  await page.goto("/inventory/stock");
  release();
  await expect(page.locator("[data-browse-row]")).toHaveCount(24);
  await expect(page.getByRole("columnheader", { name: /合计/ })).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /完整位置/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /ERPNext 库位/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("stock-total-full-location.png"),
  });

  await page.goto("/inventory/movements?view=items");
  await expect(page.locator(".browse-results")).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /来源完整位置/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /去向完整位置/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /来源 ERPNext 库位/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: /去向 ERPNext 库位/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("movement-full-location.png"),
  });
});

for (const surface of [
  "stock",
  "expiry",
  "movements/items",
  "movements/records",
  "loans/items",
  "loans/records",
]) {
  for (const scenario of [
    { name: "desktop", width: 1440, height: 1000, scale: 100 },
    { name: "phone", width: 390, height: 844, scale: 100 },
  ]) {
    test(`${surface} loaded controls and complete filters / ${scenario.name}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({
        width: scenario.width,
        height: scenario.height,
      });
      const release = await prepare(page, scenario.scale);
      const errors: string[] = [];
      page.on("pageerror", (error) =>
        errors.push(error.stack || error.message),
      );
      const routes: Record<string, string> = {
        stock: "/inventory/stock",
        expiry: "/inventory/stock/expiry",
        "movements/items": "/inventory/movements?view=items",
        "movements/records": "/inventory/movements?view=records",
        "loans/items": "/inventory/loans?view=items",
        "loans/records": "/inventory/loans?view=records",
      };
      await page.goto(routes[surface]!);
      const chrome = page.locator(".browse-chrome");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator(".quantity-summary-empty")).toHaveCount(0);
      const sortChip = chrome.locator(
        ".browse-sort-control .popup-menu-trigger",
      );
      if (await sortChip.count()) {
        await expect(sortChip).toHaveAttribute("aria-label", /排序：.+，.+/);
      }
      const tabs = chrome.locator(".browse-tabs button");
      const minimumTarget = scenario.width >= 1024 ? 36 : 44;
      for (const tab of await tabs.all()) {
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(
          minimumTarget,
        );
        await tab.click();
      }
      release();
      const itemHistoryView =
        surface === "movements/items" || surface === "loans/items";
      if (itemHistoryView)
        await expect(page.locator(".browse-results")).toBeVisible();
      else if (surface === "expiry" && scenario.width < 1024)
        await expect(
          page.locator(".expiry-mobile [data-browse-row]"),
        ).toHaveCount(24);
      else await expect(page.locator("[data-browse-row]")).toHaveCount(24);
      if (surface === "stock" && scenario.width >= 1024) {
        const oversizedRows = await page
          .locator(".data-table-scroll table.browse-table tbody tr")
          .evaluateAll((rows) =>
            rows
              .filter((row) => row.getBoundingClientRect().height > 72)
              .map((row) => ({
                text: row.textContent?.trim(),
                height: row.getBoundingClientRect().height,
              })),
          );
        expect(oversizedRows).toEqual([]);
      }
      await page.evaluate(() => document.fonts.ready);
      for (const tab of await tabs.all()) {
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(
          minimumTarget,
        );
        await tab.click();
      }
      await page.screenshot({ path: info.outputPath("loaded.png") });
      await expect(chrome.locator(".browse-tools-toggle")).toHaveCount(0);
      if (!itemHistoryView) {
        const resultSummary = page.getByRole("button", { name: /数量分析/ });
        await expect(resultSummary).toBeVisible();
        await expect(resultSummary).toHaveAttribute("aria-expanded", "false");
        await resultSummary.click();
        await expect(resultSummary).toHaveAttribute("aria-expanded", "true");
        await expect(
          page.locator(".browse-result-summary-panel"),
        ).toBeVisible();
        await expect(
          page.locator(".browse-result-summary-panel .quantity-summary"),
        ).toBeVisible();
        if (surface.startsWith("movements")) {
          const summary = page.locator(".quantity-summary-metric");
          await expect(summary).toHaveCount(3);
          await expect(summary.first()).toContainText("入库");
          await expect(summary.first()).toContainText("3 套");
          await expect(summary.first()).toContainText("12 件");
        }
        if (surface.startsWith("loans"))
          await expect(page.locator(".quantity-summary-metric")).toHaveCount(1);
        await resultSummary.click();
      }
      await chrome.getByRole("button", { name: /^筛选/ }).click();
      const filterPanel = page.getByRole("dialog", {
        name: "筛选",
        exact: true,
      });
      await expect(filterPanel).toBeVisible();
      if (scenario.width < 1024) {
        await filterPanel
          .locator('details[data-filter-field="categories"] > summary')
          .click();
        await expect(
          filterPanel.getByRole("tree", {
            name: "物品类别选项",
            exact: true,
          }),
        ).toBeVisible();
      } else {
        await expect(
          filterPanel.locator(
            'details[data-filter-field="categories"] > summary',
          ),
        ).toBeVisible();
      }
      if (surface !== "stock") {
        const periodLabel =
          surface === "expiry"
            ? "到期日期"
            : surface.startsWith("movements")
              ? "流动日期"
              : "借出日期";
        if (surface === "expiry") {
          const period = filterPanel.locator(
            'details[data-filter-field="period"] > summary',
          );
          await expect(period).toBeVisible();
          await period.click();
          await expect(
            filterPanel.getByRole("heading", {
              name: periodLabel,
              exact: true,
            }),
          ).toBeVisible();
        } else {
          const periodDisclosure = filterPanel.locator(
            'details[data-filter-field="period"] > summary',
          );
          await expect(periodDisclosure).toBeVisible();
          await periodDisclosure.click();
          await expect(
            page.getByRole("heading", { name: periodLabel, exact: true }),
          ).toBeVisible();
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath("complete-filters.png") });
      expect(errors).toEqual([]);
    });
  }
}

for (const scenario of [
  {
    name: "movements records",
    path: "/inventory/movements?view=records",
    label: "编号",
  },
  { name: "stock total", path: "/inventory/stock", label: "合计" },
  {
    name: "loans records",
    path: "/inventory/loans?view=records",
    label: "借出单号",
  },
]) {
  test(`${scenario.name} sort round trips through the URL`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const release = await prepare(page, 100);
    await page.goto(scenario.path);
    release();
    await expect(page.locator("[data-browse-row]").first()).toBeVisible();

    if (scenario.name === "stock total") {
      await page.getByRole("button", { name: "设置列" }).click();
      await page
        .getByRole("group", { name: "设置表格列" })
        .getByRole("checkbox", { name: "合计" })
        .check();
    }

    const header = page.getByRole("columnheader", {
      name: new RegExp(scenario.label),
    });
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    await expect(page).toHaveURL(/query=/);
    const urlAfterSort = page.url();
    await page.reload();
    await expect(page.locator("[data-browse-row]").first()).toBeVisible();
    await expect(page).toHaveURL(urlAfterSort);
    await expect(
      page.getByRole("columnheader", { name: new RegExp(scenario.label) }),
    ).toHaveAttribute("aria-sort", "ascending");
  });
}
