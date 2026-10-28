import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";
import { newReportQuery } from "../../src/lib/reportContract";

test("phone dashboard keeps create actions in four columns and secondary actions reachable", async ({
  page,
}) => {
  await nativeUiSession(page, 100, {
    operations: {
      Receive: true,
      Issue: true,
      Loan: true,
      Transfer: true,
      Reconcile: true,
    },
  });
  await page.route(
    "**/api/method/temple_inventory.browse.dashboard_card",
    async (route) => {
      await route.fulfill({
        json: {
          message: {
            query: newReportQuery("inventory"),
            snapshot: "2026-10-16 12:00",
            rows: [],
            expiry_rows: { expired: [], upcoming: [] },
            kind_counts: {},
            totals: [],
            buckets: [],
            matched_count: 1,
            item_count: 1,
            expired_count: 0,
            damaged_item_count: 0,
          },
        },
      });
    },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inventory/");
  const actions = page.locator(".dashboard-quick-actions");
  await expect(actions.locator(":scope > .ui-button")).toHaveCount(4);
  expect(
    await actions.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(4);
  await expect(page.locator(".dashboard-secondary-actions")).toContainText(
    "刷新",
  );
  await expect(page.locator(".dashboard-secondary-actions")).toContainText(
    "更多",
  );
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator(".dashboard-secondary-actions")).toHaveCount(0);
  await expect(page.locator(".app-page-actions")).toContainText("刷新");
});

// Production coordinator/transport with controlled native card responses.
test("dashboard retains applied scope and its open filter across 1024px", async ({
  page,
}) => {
  const reads: Record<string, any>[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.browse.dashboard_card",
    async (route) => {
      const args = route.request().postDataJSON();
      reads.push(args);
      await route.fulfill({
        json: {
          message: {
            query: newReportQuery("inventory"),
            snapshot: "2026-10-16 12:00",
            rows: [],
            expiry_rows: { expired: [], upcoming: [] },
            kind_counts: {},
            totals: [],
            buckets: [],
            matched_count: 1,
            item_count: 1,
            expired_count: 0,
            damaged_item_count: 0,
          },
        },
      });
    },
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/inventory/");
  await expect(
    page.getByRole("heading", { name: "物资总览", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-section="inventory"] [aria-busy="true"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "总览范围", exact: false }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /演示室甲/ }).check();
  await expect
    .poll(() =>
      reads.some((args) => args.scope.warehouses.includes("DEMO-ROOM-A")),
    )
    .toBe(true);
  await page.setViewportSize({ width: 375, height: 900 });
  // Controllers retain open dialogs across the 1024px breakpoint (AGENTS.md).
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    page.getByRole("dialog").getByRole("checkbox", { name: /演示室甲/ }),
  ).toBeChecked();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "完成", exact: true })
    .click();
  await expect(page.getByRole("button", { name: /总览范围.*1/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("movement tiles are scoped browse links with a separate unit disclosure", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.browse.dashboard_card",
    async (route) => {
      const args = route.request().postDataJSON();
      const movement = args.card === "movement";
      const query = newReportQuery(movement ? "movements" : "inventory");
      query.scope = {
        ...query.scope,
        ...args.scope,
        ...(movement ? { period: args.movement_period } : {}),
      };
      await route.fulfill({
        json: {
          message: {
            query,
            snapshot: "2026-10-16 12:00",
            rows: [],
            expiry_rows: { expired: [], upcoming: [] },
            kind_counts: movement ? { Issue: 5 } : {},
            totals: movement
              ? ["Nos", "Box", "Set"].map((stock_uom, index) => ({
                  kind: "Issue",
                  stock_uom,
                  stock_qty: 3 - index,
                  available_effect: -(3 - index),
                }))
              : [],
            buckets: [],
            matched_count: 5,
            item_count: 0,
            empty_count: 0,
            empty_labels: [],
            expiry_preview_limit: 5,
            expired_count: 0,
            damaged_item_count: 0,
          },
        },
      });
    },
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/inventory/");
    const link = page
      .locator(".dashboard-movement-tile")
      .filter({ hasText: "出库" })
      .first();
    await expect(link).toBeVisible();
    const href = new URL((await link.getAttribute("href"))!, page.url());
    expect(href.pathname).toBe("/inventory/movements");
    const state = JSON.parse(href.searchParams.get("query") || "{}");
    expect(state.scope.kinds).toEqual(["Issue"]);
    expect(state.scope.period).toBeTruthy();
    const card = link.locator("..");
    const disclosure = card.locator(".dashboard-movement-disclosure");
    await expect(disclosure).toContainText("+1 单位");
    await expect(card.locator(".dashboard-movement-extra")).toHaveCount(0);
    expect(
      await card
        .locator(".dashboard-movement-meta-line")
        .evaluate((line) => line.contains(line.querySelector("button"))),
    ).toBe(true);
    const before = await card.boundingBox();
    const buttonBefore = await disclosure.boundingBox();
    expect(buttonBefore!.y).toBeGreaterThanOrEqual(before!.y);
    expect(buttonBefore!.y + buttonBefore!.height).toBeLessThanOrEqual(
      before!.y + before!.height,
    );
    await page.screenshot({
      path: info.outputPath(`movement-tiles-${width}-collapsed.png`),
      fullPage: true,
    });
    await disclosure.click();
    await expect(disclosure).toHaveText("收起");
    await expect(
      card.locator(".dashboard-movement-unit-line .stock-effect"),
    ).toHaveCount(3);
    await expect(card.locator(".dashboard-movement-meta-line")).toContainText(
      "5 笔记录",
    );
    await expect(card.locator(".dashboard-movement-unit-line")).toContainText(
      "1 Set",
    );
    const after = await card.boundingBox();
    expect(after!.height).toBeGreaterThan(before!.height);
    const buttonAfter = await disclosure.boundingBox();
    expect(buttonAfter!.y + buttonAfter!.height).toBeLessThanOrEqual(
      after!.y + after!.height,
    );
    await page.screenshot({
      path: info.outputPath(`movement-tiles-${width}-expanded.png`),
      fullPage: true,
    });
    await disclosure.click();
    await expect(disclosure).toHaveText("+1 单位");
  }
});

test("activity movement kinds keep link and unit disclosure as siblings", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.activities.load_activity",
    (route) =>
      route.fulfill({
        json: {
          message: {
            name: "ACTIVITY-1",
            title: "大型法会物资准备",
            activity_type: "TYPE-A",
            status: "Active",
            start_date: "2026-10-01",
            end_date: "2026-10-31",
            description: "活动说明",
            notes: "",
            modified: "2026-10-16 12:00:00",
            creation: "2026-10-16 10:00:00",
            owner: "manager",
            modified_by: "manager",
            summary: { count_Issue: 4 },
            movement_totals: [
              { kind: "Issue", stock_uom: "Nos", stock_qty: 5 },
              { kind: "Issue", stock_uom: "Box", stock_qty: 2 },
              { kind: "Issue", stock_uom: "Set", stock_qty: 1 },
              { kind: "Issue", stock_uom: "Kg", stock_qty: 3 },
            ],
            loan_totals: [],
            outstanding_line_count: 0,
          },
        },
      }),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/inventory/activities/ACTIVITY-1");
    const card = page.locator(".activity-movement-card").first();
    const link = card.locator("a.activity-movement-tile");
    const disclosure = card.locator(".activity-movement-disclosure");
    await expect(link).toBeVisible();
    const target = new URL((await link.getAttribute("href"))!, page.url());
    expect(
      JSON.parse(target.searchParams.get("query") || "{}").scope.activity,
    ).toBe("ACTIVITY-1");
    await expect(disclosure).toHaveText("+1 单位");
    await expect(link.locator(".activity-movement-disclosure")).toHaveCount(0);
    expect(
      await card
        .locator(".activity-movement-meta-line")
        .evaluate((line) => line.contains(line.querySelector("button"))),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`activity-kind-tiles-${width}-collapsed.png`),
      fullPage: true,
    });
    await disclosure.click();
    await expect(card.locator(".activity-movement-expanded-unit")).toHaveCount(
      1,
    );
    await expect(disclosure).toHaveText("收起");
    await page.screenshot({
      path: info.outputPath(`activity-kind-tiles-${width}-expanded.png`),
      fullPage: true,
    });
  }
});
