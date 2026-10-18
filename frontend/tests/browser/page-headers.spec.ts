import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";

async function setup(page: Page, scale = 100, density = "balanced") {
  const font = "/tmp/temple-inventory-ui-audit/fonts/NotoSansCJKsc-Regular.otf";
  if (existsSync(font)) {
    await page.route("**/header-review-font.otf", (route) =>
      route.fulfill({ body: readFileSync(font), contentType: "font/otf" }),
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
        rows: [],
        matched_count: 0,
        next_start: null,
        snapshot: "2026-10-18 10:00:00",
        table: "summary",
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
  test(`shared browse headers and expanded-only analysis at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    for (const [path, title] of [
      ["stock", "库存"],
      ["expiry", "效期批次"],
      ["movements/items", "货物流动"],
      ["loans/items", "借用"],
      ["pending", "损坏待处理"],
    ]) {
      await page.goto(`/inventory/${path}`);
      const chrome = page.locator(".browse-chrome");
      await expect(
        chrome.getByRole("heading", { level: 1, name: title, exact: true }),
      ).toBeVisible();
      const toggle = chrome.locator(".browse-tools-toggle");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const analysis = chrome
        .locator(".browse-result-toolbar")
        .getByRole("button", { name: "分析结果", exact: true });
      await expect(analysis).toBeVisible();
      await toggle.click();
      await expect(analysis).toBeHidden();
      await expect(chrome.getByRole("heading", { level: 1 })).toBeVisible();
      await chrome.getByRole("button", { name: "搜索", exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(analysis).toBeVisible();
      if (path === "stock" || path === "expiry") {
        await expect(
          chrome
            .locator(".app-page-actions")
            .getByRole("button", { name: /^(入库|出库|调拨)$/ }),
        ).toHaveCount(0);
      }
    }
  });
}

for (const [width, scale, density] of [
  [320, 100, "compact"],
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
    await expect(page.locator(".stock-card")).toHaveCount(60);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator(".browse-chrome h1")).toBeInViewport();
    await page.screenshot({ path: info.outputPath("expanded-header.png") });
    await page.getByRole("button", { name: /^筛选/ }).click();
    const tree = page.getByRole("tree", { name: "物品类别选项", exact: true });
    await expect(tree).toBeVisible();
    const geometry = await tree.locator(".hierarchy-row").evaluateAll((rows) =>
      rows.map((row) => ({
        x: row.querySelector("label > span")!.getBoundingClientRect().x,
        checkbox: row.querySelector("input")!.getBoundingClientRect().x,
        track: row
          .querySelector(".tree-toggle, .tree-spacer")!
          .getBoundingClientRect().width,
        height: row.getBoundingClientRect().height,
      })),
    );
    expect(geometry).toHaveLength(3);
    expect(Math.abs(geometry[0]!.x - geometry[2]!.x)).toBeLessThan(1);
    expect(
      Math.abs(geometry[0]!.checkbox - geometry[2]!.checkbox),
    ).toBeLessThan(1);
    expect(geometry[0]!.track).toBe(width < 1024 ? 44 : 28);
    expect(geometry[0]!.height).toBeGreaterThanOrEqual(width < 1024 ? 44 : 32);
    await page.screenshot({ path: info.outputPath("hierarchy.png") });
    if (width < 1024) await page.keyboard.press("Escape");
    const actions = page.locator(".app-page-actions");
    const identity = page.locator(".app-page-identity");
    const actionRect = (await actions.boundingBox())!;
    const identityRect = (await identity.boundingBox())!;
    if (width < 1024)
      expect(actionRect.y).toBeGreaterThanOrEqual(
        identityRect.y + identityRect.height,
      );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}

for (const width of [390, 1440]) {
  test(`deep-scroll expansion preserves result context and selected actions at ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await page.goto("/inventory/stock");
    await expect(page.locator(".stock-card")).toHaveCount(60);
    await page.locator(".card-checkbox input").first().check();
    const chrome = page.locator(".browse-chrome");
    const toggle = chrome.locator(".browse-tools-toggle");
    await page.evaluate(() =>
      window.scrollTo({ top: 1100, behavior: "instant" }),
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(chrome.getByRole("heading", { level: 1 })).toBeInViewport();
    await expect(
      chrome
        .locator(".stock-selection-actions")
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
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(chrome.locator(".expanded-browse-tools")).toBeInViewport();
    await expect(
      page.locator(`[data-browse-row="${anchor}"]`),
    ).toBeInViewport();
    await expect(toggle).toBeFocused();
    await page.evaluate(() =>
      window.scrollBy({ top: 120, behavior: "instant" }),
    );
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.screenshot({ path: info.outputPath("compact-selection.png") });
  });
}
