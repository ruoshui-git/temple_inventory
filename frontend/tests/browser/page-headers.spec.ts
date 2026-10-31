import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";
const selectionShots = "/tmp/codex-runs/browse-selection-shots";
mkdirSync(selectionShots, { recursive: true });

async function setup(page: Page, scale = 100, density = "balanced") {
  const font =
    process.env.TEMPLE_UI_CJK_FONT ||
    "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf";
  if (existsSync(font)) {
    await page.route("**/header-review-font.otf", (route) =>
      route.fulfill({
        body: readFileSync(font),
        contentType: font.endsWith(".ttc") ? "font/collection" : "font/otf",
      }),
    );
    await page.addInitScript(() =>
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent =
          "@font-face{font-family:HeaderReview;src:url(/header-review-font.otf)}body,button,input,select,textarea{font-family:HeaderReview,sans-serif!important}";
        document.head.append(style);
      }),
    );
  }
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    const args = route.request().postDataJSON() || {};
    const rows = Array.from({ length: 60 }, (_, i) => ({
      code: `ITEM-${i}`,
      name: `法会供灯与日常储备用品长名称${i}`,
      category: "供灯用品",
      uom: "个",
      available: 7,
      loaned: 2,
      damaged: 1,
      tracksBatch: false,
      tracksExpiry: false,
      image: "",
      locations: [],
    }));
    let message: unknown = [];
    if (method === "browse.inventory_page")
      message = {
        rows,
        matched_count: 60,
        next_start: null,
        snapshot: "2026-10-18 10:00:00",
        query: args.query,
        summary: [],
        analysis: { category: [], location: [] },
      };
    else if (method === "browse.expiry_page")
      message = {
        rows: [],
        matched_count: 0,
        next_start: null,
        snapshot: "2026-10-18 10:00:00",
        query: args.query,
        summary: [],
        facets: {},
        totals: [],
        analysis: {},
        item_count: 0,
        batch_count: 0,
      };
    else if (method === "browse.operation_page")
      message = {
        rows: [],
        matched_count: 0,
        next_start: null,
        snapshot: "2026-10-18 10:00:00",
        query: args.query,
        summary: {},
        totals: [],
        analysis: {},
      };
    else if (method === "projections.report_page")
      message = {
        query: args.query,
        scope: args.query.scope,
        rows: [
          {
            id: "PENDING-ROW",
            item_name: "损坏待处理物品",
            item_code: "ITEM-PENDING",
            available: 8,
            loaned: 2,
            damaged: 1,
            stock_uom: "个",
          },
        ],
        matched_count: 1,
        next_start: null,
        snapshot: "2026-10-18 10:00:00",
        table: "summary",
        period: { key: "all", date_from: "", date_to: "" },
        columns: ["item_name", "damaged"],
        summary: [],
        tables: [{ id: "summary", label: "库存汇总", count: 0 }],
      };
    await route.fulfill({ json: { message } });
  });
  await nativeUiSession(page, scale, {
    capabilities: {
      Item: { read: true, create: true },
      "Stock Entry": { create: true, submit: true },
    },
    operations: { Receive: true, Issue: true, Transfer: true, Loan: true },
    categories: [
      {
        name: "PARENT",
        item_group_name: "类别分组",
        is_group: true,
        lft: 1,
        rgt: 4,
      },
      {
        name: "CHILD",
        item_group_name: "分组子项",
        parent_item_group: "PARENT",
        is_group: false,
        lft: 2,
        rgt: 3,
      },
      {
        name: "LEAF",
        item_group_name: "同级物品类别",
        is_group: false,
        lft: 5,
        rgt: 6,
      },
    ],
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
}

for (const width of [390, 1440]) {
  test(`shared browse headers keep search and page actions visible at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    for (const [path, route] of [
      ["stock", "stock"],
      ["expiry", "stock/expiry"],
      ["movements/items", "movements?view=items"],
      ["loans/items", "loans?view=items"],
      ["pending", "stock/damaged"],
    ]) {
      await page.goto(`/inventory/${route}`);
      const chrome = page.locator(".browse-chrome");
      await expect(chrome.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(chrome.locator(".browse-tools-toggle")).toHaveCount(0);
      await expect(chrome.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(chrome.getByRole("searchbox")).toBeVisible();
      await expect(chrome.getByRole("searchbox")).toHaveAttribute(
        "type",
        "search",
      );
      if ((path === "stock" || path === "pending") && width >= 1024) {
        const rows = page.locator(".data-table-scroll tbody tr");
        const oversizedRows = await rows.evaluateAll((items) =>
          items
            .filter((row) => row.getBoundingClientRect().height > 72)
            .map((row) => ({
              text: row.textContent?.trim(),
              height: row.getBoundingClientRect().height,
            })),
        );
        expect(oversizedRows).toEqual([]);
        const oversizedCells = await page
          .locator(
            ".data-table-scroll tbody td:not(.data-column-primary, .data-table-settings-cell, .data-table-selection-column)",
          )
          .evaluateAll((cells) =>
            cells
              .filter((cell) => cell.getBoundingClientRect().height > 72)
              .map((cell) => ({
                text: cell.textContent?.trim(),
                height: cell.getBoundingClientRect().height,
              })),
          );
        expect(oversizedCells).toEqual([]);
        if (path === "pending") {
          await expect(rows).toHaveCount(1);
          const tableFrame = page.locator(".data-table-frame").first();
          await expect(tableFrame).toHaveCSS(
            "--data-table-settings-column-width",
            "0px",
          );
          const tableScroll = page.locator(".data-table-scroll").first();
          if (
            await tableScroll.evaluate((node) =>
              node.classList.contains("is-overflowing"),
            )
          ) {
            await expect(
              page.locator(".data-table-pinned-end").first(),
            ).toHaveCSS("right", "0px");
          } else {
            await expect(tableScroll).not.toHaveClass(/is-overflowing/);
          }
        }
      }
      if (
        path === "stock" ||
        path === "movements/items" ||
        path === "loans/items"
      )
        await expect(
          page.getByRole("button", { name: "更多操作", exact: true }),
        ).toBeVisible();
    }
  });
}

for (const width of [390, 1440]) {
  test(`damaged browse screenshot ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
    await setup(page);
    await page.goto("/inventory/stock/damaged");
    await expect(page.locator("[data-browse-row]")).toHaveCount(1);
    await expect(
      page.locator(".notice-bar").filter({ hasText: "损坏物资待处理" }),
    ).toBeVisible();
    await page.screenshot({
      path: `${selectionShots}/damaged-${width}.png`,
      fullPage: true,
    });
  });
}

test("expiry window exposes its selected icon and page title on desktop and phone", async ({
  page,
}, info) => {
  await setup(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/inventory/stock/expiry");
    const selected = page.locator(
      '.expiry-window-switch [role="tab"][aria-selected="true"], .browse-expiry-window-switch [role="tab"][aria-selected="true"]',
    );
    await expect(selected).toHaveCount(1);
    await expect(selected.locator("svg")).toBeVisible();
    await expect(page).toHaveTitle(/物资管理.*效期批次/);
    await page.screenshot({
      path: info.outputPath(`expiry-selected-${width}.png`),
      fullPage: true,
    });
  }
});

for (const [width, scale, density] of [
  [390, 200, "spacious"],
  [1024, 100, "balanced"],
  [1440, 200, "compact"],
] as const) {
  test(`aligned hierarchy and header actions ${width}/${scale}/${density}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, scale, density);
    await page.goto("/inventory/stock");
    await page.getByRole("button", { name: "卡片视图", exact: true }).click();
    await expect(page.locator(".stock-card")).toHaveCount(60);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".browse-chrome h1")).toBeInViewport();
    await page.screenshot({ path: info.outputPath("expanded-header.png") });
    await page.getByRole("button", { name: /^筛选/ }).click();
    const filterPanel = page.getByRole("dialog", { name: "筛选", exact: true });
    await expect(filterPanel).toBeVisible();
    if (width < 1024) {
      await filterPanel
        .locator('details[data-filter-field="categories"] > summary')
        .click();
      await expect(
        filterPanel.getByRole("tree", {
          name: "物品类别选项",
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("hierarchy.png") });
      await page.keyboard.press("Escape");
    } else {
      await expect(
        filterPanel.locator(
          'details[data-filter-field="categories"] > summary',
        ),
      ).toBeVisible();
    }
    const actions = page.locator(
      width < 1024 ? ".browse-mobile-actions" : ".browse-header-actions",
    );
    const identity = page.locator(".app-page-identity");
    const actionRect = (await actions.boundingBox())!;
    const identityRect = (await identity.boundingBox())!;
    if (width < 1024)
      expect(Math.abs(actionRect.y - identityRect.y)).toBeLessThan(16);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}

for (const width of [390, 1440]) {
  test(`deep scroll keeps the persistent header and selected actions at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.goto("/inventory/stock");
    await page.getByRole("button", { name: "卡片视图", exact: true }).click();
    await expect(page.locator(".stock-card")).toHaveCount(60);
    if (width < 1024) {
      await page.getByRole("button", { name: "更多操作", exact: true }).click();
      await page.getByRole("menuitem", { name: "选择", exact: true }).click();
    } else
      await page.getByRole("button", { name: "选择", exact: true }).click();
    await page.locator(".card-checkbox input").first().check();
    const chrome = page.locator(".browse-chrome");
    await page.evaluate(() =>
      window.scrollTo({ top: 1100, behavior: "instant" }),
    );
    await expect(chrome.locator(".browse-tools-toggle")).toHaveCount(0);
    await expect(chrome.locator(".browse-persistent-bar")).toBeInViewport();
    await expect(
      page
        .getByRole("region", { name: "已选物品操作" })
        .getByRole("button", { name: "调拨", exact: true }),
    ).toBeInViewport();
    const anchor = await page
      .locator("[data-browse-row]")
      .evaluateAll((rows) => {
        const bottom = document
          .querySelector(".browse-chrome")!
          .getBoundingClientRect().bottom;
        return rows
          .find((row) => row.getBoundingClientRect().top >= bottom)
          ?.getAttribute("data-browse-row");
      });
    expect(anchor).toBeTruthy();
    await expect(
      page.locator(`[data-browse-row="${anchor}"]`),
    ).toBeInViewport();
    await page.evaluate(() =>
      window.scrollBy({ top: 120, behavior: "instant" }),
    );
    await expect(chrome.locator(".browse-persistent-bar")).toBeInViewport();
    await page.screenshot({
      path: info.outputPath("persistent-selection.png"),
    });
  });
}
