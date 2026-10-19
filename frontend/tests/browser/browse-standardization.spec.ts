import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";

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
      locations: [],
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
      document_count: 1,
      allocation_count: 1,
      totals: [
        { kind: "Receive", docstatus: 1, stock_uom: "件", stock_qty: 11 },
      ],
      whole: {
        item_count: 1,
        quantities: [{ uom: "件", qty: 11 }],
        branches: [],
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
    warehouses: [
      {
        name: "A14",
        local_label: "A14",
        breadcrumb: "T2 / A14",
        is_group: true,
      },
      {
        name: "DEFAULT-A14",
        local_label: "无货位",
        breadcrumb: "T2 / A14 / 无货位",
        parent_warehouse: "A14",
        room_default: true,
        is_group: false,
      },
    ],
    physical_leaves: ["DEFAULT-A14"],
    operations: {
      Receive: true,
      Issue: true,
      Transfer: true,
      Loan: true,
      Return: true,
    },
  });
  const font = "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf";
  await page.route("**/review-font.otf", (route) =>
    route.fulfill({ body: readFileSync(font), contentType: "font/otf" }),
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
    { name: "phone-large-text", width: 390, height: 844, scale: 200 },
    // 1440x900 at browser zoom 200% has this effective CSS viewport.
    {
      name: "zoom-200-effective-viewport",
      width: 720,
      height: 450,
      scale: 100,
    },
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
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`/inventory/${surface}`);
      const chrome = page.locator(".browse-chrome");
      await expect(chrome.locator("h1")).toBeVisible();
      await expect(page.locator(".quantity-summary-empty")).toHaveCount(0);
      await expect(
        chrome.locator(".browse-sort-control select option:checked"),
      ).toHaveCount(1);
      const tabs = chrome.locator(".browse-tabs button");
      const minimumTarget = scenario.width >= 1024 ? 36 : 44;
      for (const tab of await tabs.all()) {
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(
          minimumTarget,
        );
        await tab.click();
      }
      release();
      await expect(page.locator("[data-browse-row]")).toHaveCount(24);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator(".quantity-summary")).toHaveCount(1);
      for (const tab of await tabs.all()) {
        expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(
          minimumTarget,
        );
        await tab.click();
      }
      if (surface.startsWith("movements")) {
        const summary = page.locator(".quantity-summary-metric");
        await expect(summary).toHaveCount(2);
        await expect(summary.first()).toContainText("入库");
        await expect(summary.first()).toContainText("3 套");
        await expect(summary.first()).toContainText("12 件");
      }
      if (surface.startsWith("loans"))
        await expect(page.locator(".quantity-summary-metric")).toHaveCount(1);
      await page.screenshot({ path: info.outputPath("loaded.png") });
      await chrome.locator(".browse-tools-toggle").click();
      await expect(chrome.locator(".browse-compact-summary")).toHaveCount(0);
      await chrome.getByRole("button", { name: /^筛选/ }).click();
      const tree = page.getByRole("tree", {
        name: "物品类别选项",
        exact: true,
      });
      await expect(tree).toBeVisible();
      const dimensions = await tree.evaluate((element) => {
        const scroller = element.closest(".facet-suggestions")!;
        const label = element.querySelector("label > span")!;
        return {
          scrollWidth: scroller.scrollWidth,
          clientWidth: scroller.clientWidth,
          whiteSpace: getComputedStyle(label).whiteSpace,
        };
      });
      expect(dimensions.whiteSpace).toBe("nowrap");
      expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
      if (surface !== "stock") {
        await expect(
          page.locator(".preview-period-trigger").filter({
            hasText: new RegExp(
              surface === "expiry"
                ? "到期日期"
                : surface.startsWith("movements")
                  ? "流动日期"
                  : "借出日期",
            ),
          }),
        ).toBeVisible();
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
