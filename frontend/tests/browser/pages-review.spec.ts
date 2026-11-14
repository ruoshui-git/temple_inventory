import { expect, test } from "@playwright/test";
import { newReportQuery } from "../../src/lib/reportContract";
import { nativeUiSession, sampleWarehouses } from "./fixtures/nativeUi";

async function warehouseFixture(page: Parameters<typeof nativeUiSession>[0]) {
  await nativeUiSession(page);
  await page.route("**/api/method/temple_inventory.warehouses.tree", (route) =>
    route.fulfill({
      json: {
        message: {
          rows: sampleWarehouses,
          physical_root: "PHYSICAL",
          can_create: true,
          company: "TEST",
        },
      },
    }),
  );
  await page.route(
    "**/api/method/temple_inventory.warehouses.stock_summary",
    (route) =>
      route.fulfill({
        json: { message: { rows: [{ stock_uom: "Nos", stock_qty: 8 }] } },
      }),
  );
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page",
    (route) => {
      const query =
        route.request().postDataJSON()?.query || newReportQuery("inventory");
      return route.fulfill({
        json: {
          message: {
            rows: [stockRow()],
            matched_count: 1,
            next_start: null,
            snapshot: "2026-10-16 12:00:00",
            query,
            summary: [{ stock_uom: "Nos", available: 8, stock_qty: 8 }],
            analysis: { category: [], location: [] },
          },
        },
      });
    },
  );
}

test("warehouse settings list and detail at phone and desktop sizes", async ({
  page,
}, info) => {
  await warehouseFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inventory/stock/warehouses");
  await expect(page.locator("[data-browse-row='warehouse:T2']")).toBeVisible();
  await expect(page.getByText("库存合计")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("warehouses-list-desktop.png"),
  });
  await page.goto("/inventory/stock/warehouses/T2");
  await expect(
    page.getByRole("heading", { name: "T2", level: 1 }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("warehouse-detail-desktop.png"),
  });
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/inventory/stock/warehouses");
  await expect(page.locator("[data-browse-row='warehouse:T2']")).toBeVisible();
  await page.screenshot({ path: info.outputPath("warehouses-list-phone.png") });
  await page.locator("[data-browse-row='warehouse:T2'] .browse-grow").click();
  await expect(page).toHaveURL(/\/inventory\/stock\/warehouses\/T2$/);
  await expect(
    page.getByRole("heading", { name: "T2", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "查看库存" })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("warehouse-detail-phone.png"),
  });
  await page.getByRole("button", { name: "查看库存" }).click();
  await expect(
    page.locator('.browse-active-chip[title^="仓库 / 位置："]'),
  ).toContainText("T2");
});

test("units filters and category groups show loaded rows", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  const countUnit = unitRow("Nos", "个", "计数", true, true);
  countUnit.item_count = 1;
  await page.route("**/api/method/temple_inventory.units.list_units", (route) =>
    route.fulfill({
      json: {
        message: [countUnit, unitRow("Kg", "公斤", "重量", false, true)],
      },
    }),
  );
  await page.route(
    "**/api/method/temple_inventory.units.list_categories",
    (route) =>
      route.fulfill({
        json: { message: [{ name: "计数" }, { name: "重量" }] },
      }),
  );
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/inventory/stock/units");
  await expect(page.locator(".units-phone-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /重量/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(page.locator(".mobile-context-back")).toContainText("库存");
  await expect(
    page.locator(".mobile-context:not(.mobile-context-back) a"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "筛选" }).click();
  const panel = page.getByRole("dialog");
  await panel.getByLabel("单位类别").selectOption("计数");
  await page.keyboard.press("Escape");
  await expect(page.locator(".units-phone-card")).toHaveCount(1);
  await expect(page.locator(".units-phone-group")).toContainText("计数");
  await expect(page.locator(".browse-active-chip")).toContainText("计数");
  await page.screenshot({
    path: info.outputPath("units-filtered-groups-phone.png"),
  });
});

test("activity types list and status filter at phone and desktop sizes", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.activities.list_activity_types",
    (route) =>
      route.fulfill({
        json: {
          message: [
            {
              name: "TI-TYPE-REVIEW-A",
              label: "供灯活动",
              enabled: 1,
              display_order: 1,
              activity_count: 3,
              deletable: false,
              delete_reason: "已有 3 个活动使用此类型，可停用",
            },
            {
              name: "TI-TYPE-REVIEW-B",
              label: "维护活动",
              enabled: 0,
              display_order: 2,
              activity_count: 0,
              deletable: true,
              delete_reason: "",
            },
          ],
        },
      }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/inventory/activities/types");
  await expect(page.getByRole("heading", { name: "活动类型" })).toBeVisible();
  await expect(page.getByText("供灯活动")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("activity-types-desktop.png"),
  });
  await page.getByRole("button", { name: "筛选" }).click();
  let panel = page.getByRole("dialog");
  await panel.getByLabel("状态").selectOption("disabled");
  await page.keyboard.press("Escape");
  await expect(page.getByText("供灯活动")).not.toBeVisible();
  await page.getByRole("button", { name: "筛选" }).click();
  panel = page.getByRole("dialog");
  await panel.getByLabel("状态").selectOption("all");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".activity-types-phone-row")).toHaveCount(2);
  await page.screenshot({ path: info.outputPath("activity-types-phone.png") });
  await page.getByRole("button", { name: "新建类型" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "停用后，此类型的活动不能再被新记录选择。",
  );
  await page.screenshot({
    path: info.outputPath("activity-types-create-phone.png"),
  });
});

test("dashboard inventory overview labels empty totals after loading", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.browse.dashboard_card",
    (route) => {
      const args = route.request().postDataJSON() || {};
      return route.fulfill({
        json: {
          message: {
            query: args.query || newReportQuery("inventory"),
            snapshot: "2026-10-16 12:00:00",
            rows: [],
            expiry_rows: { expired: [], upcoming: [] },
            kind_counts: {},
            totals: [],
            buckets: [],
            matched_count: 0,
            item_count: 0,
            empty_count: 0,
            empty_labels: [],
            expiry_preview_limit: 6,
            expired_count: 0,
            damaged_item_count: 0,
          },
        },
      });
    },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/inventory/");
  const overview = page.locator('[data-section="inventory"]');
  await expect(overview.locator(".dashboard-inventory-metric")).toHaveCount(4);
  await expect(overview).toContainText("暂无库存");
  await page.screenshot({
    path: info.outputPath("dashboard-empty-inventory-desktop.png"),
  });
});

test("lightbox shows its skeleton while the display image loads", async ({
  page,
}, info) => {
  await warehouseFixture(page);
  await page.route(
    "**/api/method/temple_inventory.item_images.thumbnail**",
    async (route) => {
      if (route.request().url().includes("size=2048"))
        await new Promise((resolve) => setTimeout(resolve, 1800));
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: imageSvg,
      });
    },
  );
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/inventory/stock");
  const imageButton = page.getByRole("button", { name: /放大查看/ }).first();
  await expect(imageButton).toBeVisible();
  await imageButton.click();
  const lightbox = page.getByRole("dialog");
  await expect(
    lightbox.locator(".async-image--loading .async-image__skeleton"),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("lightbox-original-loading-phone.png"),
  });
});

function unitRow(
  name: string,
  label: string,
  category: string,
  whole: boolean,
  enabled: boolean,
) {
  return {
    name,
    label,
    category,
    must_be_whole_number: whole,
    enabled,
    item_count: 0,
    conversion_count: 0,
    used_in_transactions: false,
    deletable: true,
    delete_reason: "",
  };
}

function stockRow() {
  return {
    id: "PAGE-ITEM-1",
    code: "PAGE-ITEM-1",
    item_code: "PAGE-ITEM-1",
    name: "真实加载的供灯物资",
    item_name: "真实加载的供灯物资",
    image: "/private/files/pages-review.svg",
    stock_uom: "Nos",
    available: 8,
    loaned: 0,
    damaged: 0,
    locations: [
      {
        location: "T2",
        label: "T2",
        available: 8,
        loaned: 0,
        damaged: 0,
      },
    ],
  };
}

const imageSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#28684e"/><text x="10" y="60" fill="white">loaded</text></svg>';
