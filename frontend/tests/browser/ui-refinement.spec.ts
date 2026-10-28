import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import {
  auditCjkFontType,
  nativeUiSession,
  requiredAuditCjkFont,
} from "./fixtures/nativeUi";
const font = requiredAuditCjkFont();
async function setup(page: Page, scale = 100, density = "balanced") {
  await page.route("**/refinement-font.otf", (route) =>
    route.fulfill({
      body: readFileSync(font),
      contentType: auditCjkFontType(font),
    }),
  );
  await page.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        "@font-face{font-family:Refinement;src:url(/refinement-font.otf)}body,button,input,select,textarea{font-family:Refinement,sans-serif!important}";
      document.head.append(style);
    }),
  );
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    const args = route.request().postDataJSON() || {};
    let message: any = [];
    if (method === "browse.inventory_page")
      message = {
        rows: Array.from({ length: 20 }, (_, i) => ({
          code: `ITEM-${i}`,
          name: `法会供灯与日常储备用品长名称${i}`,
          category: "供灯用品",
          uom: "个",
          available: 7,
          loaned: 2,
          damaged: 1,
          tracksBatch: false,
          tracksExpiry: false,
          image:
            i % 3 === 0
              ? "data:image/svg+xml," +
                encodeURIComponent(
                  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="120"><rect width="40" height="120" fill="#28684e"/></svg>',
                )
              : "",
          locations: [
            {
              location: "ROOM-A",
              label: "东-库房",
              available: 7,
              loaned: 2,
              damaged: 1,
            },
          ],
        })),
        matched_count: 20,
        next_start: null,
        snapshot: "2026-10-17 10:00:00",
        query: args.query,
        summary: [],
        analysis: { category: [], location: [] },
      };
    else if (method === "browse.operation_page")
      message = {
        rows: [
          {
            id: "M1",
            document: "MAT-STE-2026-LONG-NATIVE-IDENTIFIER-0001",
            doctype: "Stock Entry",
            kind: "Return",
            date: "2026-10-17",
            docstatus: 1,
            document_count: 1,
            item_count: 2,
            allocation_count: 36,
            matching_totals: [{ stock_qty: 7, stock_uom: "个" }],
            whole: {
              item_count: 2,
              line_count: 36,
              quantities: [{ qty: 20, uom: "个" }],
              branches: [{ source: "ROOM-A", destination: "ROOM-B" }],
              original_loans: ["L1", "L2"],
            },
          },
        ],
        matched_count: 1,
        next_start: null,
        query: args.query,
        snapshot: "2026-10-17 10:00:00",
        summary: { document_count: 1, item_count: 2, category_count: 1 },
        totals: ["Receive", "Issue", "Return", "Transfer"].map((kind) => ({
          kind,
          docstatus: 1,
          stock_qty: 7,
          stock_uom: "个",
        })),
        analysis: {},
      };
    else if (method === "browse.operation_contributions")
      message = {
        columns: [
          "item_name",
          "source_warehouse",
          "stock_qty",
          "stock_uom",
          "docstatus",
        ],
        rows: Array.from({ length: args.start ? 6 : 30 }, (_, i) => ({
          id: `A${args.start + i}`,
          item_name: `匹配物品明细${args.start + i}`,
          source_warehouse: "ROOM-A",
          stock_qty: 1,
          stock_uom: "个",
          docstatus: 1,
        })),
        matched_count: 36,
        next_start: args.start ? null : 30,
      };
    else if (method === "native_api.loan_detail")
      message = {
        name: args.name,
        kind: "Loan",
        doctype: "Stock Entry",
        docstatus: 1,
        version: "v1",
        posting_date: "2026-10-16",
        ti_borrower:
          args.name === "L1" ? "文化交流与法会筹备组" : "寺院志工服务组",
        activity_title: "秋季法会",
        items: [
          {
            name: "LL1",
            item_code: "ITEM-1",
            item_name: "供灯用品",
            transfer_qty: 20,
            outstanding_qty: 7,
            stock_uom: "个",
            outcomes: { Returned: 10, Damaged: 2, Lost: 1 },
            s_warehouse: "ROOM-A",
            t_warehouse: "ROOM-B",
            allocations: [],
          },
        ],
      };
    else if (method === "browse.dashboard_card")
      message = {
        item_count: 2,
        rows: [],
        totals: [],
        kind_counts: {},
        query: {
          dataset: "inventory",
          scope: { period: { key: "all" }, warehouses: [], categories: [] },
        },
        buckets: [
          { id: "expired_1_30", count: 1 },
          { id: "upcoming_0_30", count: 1 },
        ],
        expiry_rows: {
          expired: [
            {
              item_name: "已过期的供灯油",
              batch_no: "EXPIRED",
              expiry_date: "2026-10-01",
              warehouse: "ROOM-A",
              available: 2,
              stock_uom: "瓶",
            },
          ],
          upcoming: [
            {
              item_name: "即将到期的供灯油",
              batch_no: "UPCOMING",
              expiry_date: "2026-10-30",
              warehouse: "ROOM-A",
              available: 3,
              stock_uom: "瓶",
            },
          ],
        },
        snapshot: "2026-10-17 10:00:00",
      };
    else if (method === "warehouses.tree")
      message = {
        company: "TEST",
        physical_root: "ROOT",
        can_create: false,
        rows: [
          {
            name: "ROOT",
            label: "东院供灯与法会物资仓库",
            parent: "",
            type: "Location",
            is_group: true,
            disabled: false,
            protected: true,
            can_edit: false,
            lft: 1,
            rgt: 4,
            version: "v1",
          },
          {
            name: "ROOM-A",
            label: "供灯-用品与法会储备物资长名称库位",
            parent: "ROOT",
            type: "Room",
            is_group: false,
            disabled: false,
            protected: false,
            can_edit: false,
            lft: 2,
            rgt: 3,
            version: "v1",
          },
        ],
      };
    else if (method === "native_api.editor_clock")
      message = { timestamp: "2026-10-17 10:00:00" };
    else if (method === "projections.report_page")
      message = {
        query: args.query,
        scope: args.query.scope,
        rows: [],
        matched_count: 0,
        next_start: null,
        table: "records",
        columns: [],
        tables: [{ id: "records", label: "记录", count: 0 }],
        summary: [],
        snapshot: "2026-10-17",
        period: { key: "all", date_from: "", date_to: "" },
      };
    await route.fulfill({ json: { message } });
  });
  const warehouses = Array.from({ length: 8 }, (_, i) => ({
    name: i === 7 ? "ROOM-A" : `G${i}`,
    local_label: `东院第${i}层供灯与法会用品长名称`,
    parent: i ? `G${i - 1}` : "",
    is_group: i < 7,
    path: `演示区 / ${i}层`,
    full_label: `东院第${i}层供灯与法会用品长名称`,
    search_text: `演示区 ${i}层`,
    label: `第${i}层`,
  }));
  await nativeUiSession(page, scale, {
    warehouses: [
      ...warehouses,
      {
        name: "DEMO-ROOM-B",
        local_label: "演示室乙",
        label: "演示室乙",
        is_group: true,
        kind: "room",
        path: "演示区 / 演示室乙",
        search_text: "演示区 演示室乙",
      },
    ],
    capabilities: { Item: { create: true }, "Stock Entry": { create: true } },
    operations: { Receive: true },
  });
  await page.route("**/api/method/temple_inventory.session.info", (route) =>
    route.fulfill({
      json: {
        message: {
          user: "manager",
          csrf_token: "test",
          ui_preferences: { theme: "jade", density, textScale: scale },
        },
      },
    }),
  );
}
for (const [width, scale, density] of [
  [320, 100, "compact"],
  [390, 200, "spacious"],
  [1440, 100, "balanced"],
] as const) {
  test(`compact stock and hierarchy ${width}/${scale}/${density}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, scale, density);
    await page.goto("/inventory/stock");
    await page.getByRole("button", { name: "卡片视图", exact: true }).click();
    await expect(page.locator(".stock-card")).toHaveCount(20);
    const imageTrigger = page
      .getByRole("button", { name: /^放大查看.*图片/ })
      .first();
    await expect(imageTrigger).toBeVisible();
    await imageTrigger.click();
    const lightbox = page.getByRole("dialog").last();
    const naturalImage = lightbox.locator(".lightbox-image .async-image img");
    await expect(naturalImage).toBeVisible();
    const naturalImageBox = await naturalImage.boundingBox();
    expect(naturalImageBox?.width).toBeGreaterThan(0);
    expect(naturalImageBox?.height).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "搜索库存" })
      .fill("供灯用品与法会日常储备长关键词");
    await page.locator(".card-checkbox input").first().check();
    const persistentSearch = page.getByRole("searchbox", { name: "搜索库存" });
    await persistentSearch.focus();
    const headerBefore = await page
      .locator(".inventory-browse-header")
      .boundingBox();
    await expect(page.locator(".browse-tools-toggle")).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "已选物品操作" }),
    ).toContainText("已选择 1 项物品");
    await expect(persistentSearch).toBeVisible();
    await expect(persistentSearch).toBeFocused();
    await expect(persistentSearch).toHaveValue(
      "供灯用品与法会日常储备长关键词",
    );
    const headerAfter = await page
      .locator(".inventory-browse-header")
      .boundingBox();
    expect(headerAfter!.height).toBeGreaterThan(0);
    await page.screenshot({ path: info.outputPath("persistent-toolbar.png") });
    await page.getByRole("button", { name: /^筛选/ }).click();
    const filterSheet = page.getByRole("dialog", { name: "筛选", exact: true });
    if (width < 1024) {
      await filterSheet
        .locator('details[data-filter-field="categories"] > summary')
        .click();
      await expect(
        filterSheet.getByRole("tree", { name: "物品类别选项" }),
      ).toBeVisible();
      const indents = await page
        .locator(".hierarchy-row")
        .evaluateAll((rows) =>
          rows.map((row) =>
            parseFloat(getComputedStyle(row).paddingInlineStart),
          ),
        );
      expect(Math.max(...indents)).toBeLessThanOrEqual(40);
      await page.screenshot({ path: info.outputPath("compact-hierarchy.png") });
    } else {
      await expect(
        filterSheet.locator(
          'details[data-filter-field="categories"] > summary',
        ),
      ).toBeVisible();
    }
    writeFileSync(
      info.outputPath("toolbar-heights.json"),
      JSON.stringify({
        before: headerBefore!.height,
        after: headerAfter!.height,
      }),
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}
for (const width of [390, 1440]) {
  test(`whole movement records and related loans ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.goto("/inventory/movements?view=records");
    const record = page.locator(".browse-table tbody tr").first();
    await expect(record).toContainText("20 个");
    const quantityHeader = page
      .locator(".browse-table thead th")
      .filter({ hasText: /数量/ })
      .first();
    await expect(quantityHeader).toHaveClass(/align-end/);
    const quantityCell = record.getByRole("cell", { name: /20 个/ });
    await expect(quantityCell).toBeVisible();
    expect(
      await quantityCell.evaluate(
        (cell) => getComputedStyle(cell).fontVariantNumeric,
      ),
    ).toContain("tabular-nums");
    await expect(
      page.getByRole("button", { name: "符合筛选的明细", exact: true }),
    ).toHaveCount(0);
    const action = page.getByRole("button", { name: /借出记录 2 笔借出/ });
    await expect(action).toBeVisible();
    await action.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(action).toBeFocused();
    await action.click();
    await page.getByRole("button", { name: /文化交流与法会筹备组/ }).click();
    await expect(page.getByRole("dialog")).toContainText("7 个");
    expect(page.url()).toContain("/movements?view=records");
    await page
      .getByRole("button", { name: "全部原借出记录", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /寺院志工服务组/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /寺院志工服务组/ }).click();
    await page
      .getByRole("button", { name: "打开完整记录", exact: true })
      .click();
    await expect(page).toHaveURL(/\/loans\/L2/);
    await page.goBack();
    await expect(page).toHaveURL(/\/inventory\/movements\?view=records/);
    await expect(
      page.getByRole("button", { name: /借出记录 2 笔借出/ }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("whole-record-and-loans.png"),
    });
  });
  test(`adjacent expiry tabs and square crop ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.goto("/inventory/");
    if (width >= 1024) {
      const primaryAction = await page
        .getByRole("button", { name: "入库", exact: true })
        .boundingBox();
      expect(primaryAction?.height).toBeDefined();
    }
    const expiry = page.locator(".dashboard-expiry");
    await expect(
      expiry.getByRole("tab", { name: "已过期", exact: true }),
    ).toBeVisible();
    const cards = await expiry.locator(".preview-expiry-grid").textContent();
    await expiry.getByRole("tab", { name: "已过期", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      expiry.getByRole("tab", { name: "未过期", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(expiry.getByRole("tabpanel")).toContainText(
      "即将到期的供灯油",
    );
    expect(await expiry.locator(".preview-expiry-grid").textContent()).toBe(
      cards,
    );
    await page.screenshot({ path: info.outputPath("dashboard-tabs.png") });
    await page.goto("/inventory/stock/items/new");
    await page.setViewportSize(
      width < 1024 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    );
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 80;
      canvas.height = 160;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#28684e";
      context.fillRect(0, 0, 80, 160);
      return canvas.toDataURL();
    });
    const png = Buffer.from(dataUrl.split(",")[1]!, "base64");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "供灯用品.png",
      mimeType: "image/png",
      buffer: png,
    });
    await expect(
      page.getByRole("dialog", { name: "裁剪图片", exact: true }),
    ).toBeVisible();
    await expect(page.locator("cropper-selection")).toBeVisible();
    const cropSelection = await page
      .locator("cropper-selection")
      .evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      });
    expect(Math.abs(cropSelection.width - cropSelection.height)).toBeLessThan(
      1,
    );
    await expect(page.getByLabel("另存原图为附件")).not.toBeChecked();
    await page.screenshot({
      path: test
        .info()
        .outputPath(
          `item-thumbnail-cropper-${width < 1024 ? "phone" : "desktop"}.png`,
        ),
      fullPage: true,
    });
    await page.screenshot({ path: info.outputPath("crop-choices.png") });
    await page
      .getByRole("button", { name: "使用原图作为主图", exact: true })
      .click();
    const image = page.locator(".preview-attachments .async-image").first();
    await expect(image).toBeVisible();
    await image.scrollIntoViewIfNeeded();
    const metrics = await image.evaluate((frame) => {
      const img = frame.querySelector("img")!;
      const rect = img.getBoundingClientRect();
      return {
        frameWidth: frame.clientWidth,
        frameHeight: frame.clientHeight,
        imageWidth: rect.width,
        imageHeight: rect.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        fit: getComputedStyle(img).objectFit,
      };
    });
    writeFileSync(
      info.outputPath("thumbnail-metrics.json"),
      JSON.stringify(metrics),
    );
    expect(metrics.imageWidth).toBeLessThanOrEqual(metrics.frameWidth + 1);
    expect(metrics.imageHeight).toBeLessThanOrEqual(metrics.frameHeight + 1);
    expect(Math.abs(metrics.imageWidth - metrics.frameWidth)).toBeLessThan(1);
    expect(Math.abs(metrics.imageHeight - metrics.frameHeight)).toBeLessThan(1);
    const naturalAspect = metrics.naturalWidth / metrics.naturalHeight;
    expect(metrics.naturalWidth).not.toBe(metrics.naturalHeight);
    expect(metrics.frameWidth / metrics.frameHeight).toBeCloseTo(
      naturalAspect,
      2,
    );
    expect(metrics.imageWidth / metrics.imageHeight).toBeCloseTo(
      naturalAspect,
      2,
    );
    expect(metrics.fit).toBe("contain");
    const box = await image.boundingBox();
    expect(box!.width / box!.height).toBeCloseTo(naturalAspect, 2);
    await page.screenshot({ path: info.outputPath("square-attachment.png") });
  });
}

test("stock state and open filter survive the shared breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await setup(page);
  await page.goto("/inventory/stock");
  await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  await expect(page.locator(".stock-card")).toHaveCount(20);
  await page.getByRole("searchbox", { name: "搜索库存" }).fill("法会用品");
  await page.locator(".card-checkbox input").first().check();
  await page.getByRole("button", { name: /^筛选/ }).click();
  const mobileFilters = page.getByRole("dialog", { name: "筛选", exact: true });
  await mobileFilters
    .locator('details[data-filter-field="warehouses"] > summary')
    .click();
  await mobileFilters.locator(".hierarchy-row label").first().click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.locator(".browse-filter-rail")).toBeVisible();
  await expect(page.locator(".hierarchy-row input").first()).toBeChecked();
  await expect(
    page.getByRole("region", { name: "已选物品操作" }),
  ).toContainText("已选择 1 项物品");
  await page.setViewportSize({ width: 390, height: 1000 });
  // The open filter survives the breakpoint in both directions (controller state is retained).
  const reopenedFilters = page.getByRole("dialog", {
    name: "筛选",
    exact: true,
  });
  await expect(reopenedFilters).toBeVisible();
  await reopenedFilters
    .locator('details[data-filter-field="warehouses"] > summary')
    .click();
  await expect(page.locator(".hierarchy-row input").first()).toBeChecked();
  await expect(
    page.getByRole("region", { name: "已选物品操作" }),
  ).toContainText("已选择 1 项物品");
  await page.keyboard.press("Escape");
});

test("open movement filter follows the breakpoint without losing selection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await page.goto("/inventory/movements?view=records");
  await page.getByRole("button", { name: /^筛选/ }).click();
  const selectedLocation = "东院第0层供灯与法会用品长名称";
  const desktopRail = page.locator(".preview-filter-popover");
  await expect(desktopRail).toBeVisible();
  await desktopRail
    .locator('details[data-filter-field="warehouses"] > summary')
    .click();
  const desktopWarehouseTree = desktopRail.getByRole("tree", {
    name: "仓库 / 位置选项",
    exact: true,
  });
  const desktopChoice = desktopWarehouseTree.getByRole("checkbox", {
    name: selectedLocation,
    exact: true,
  });
  await desktopChoice.check();
  await page.setViewportSize({ width: 390, height: 1000 });
  const mobileFilters = page.getByRole("dialog", { name: "筛选", exact: true });
  await expect(mobileFilters).toBeVisible();
  await mobileFilters
    .locator('details[data-filter-field="warehouses"]:not([open]) > summary')
    .click();
  await expect(
    mobileFilters
      .getByRole("tree", { name: "仓库 / 位置选项", exact: true })
      .getByRole("checkbox", { name: selectedLocation, exact: true }),
  ).toBeChecked();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const desktopAgain = page.locator(".preview-filter-popover");
  await expect(desktopAgain).toBeVisible();
  const collapsed = desktopAgain.locator(
    'details[data-filter-field="warehouses"]:not([open]) > summary',
  );
  if (await collapsed.count()) await collapsed.click();
  await expect(
    desktopAgain
      .getByRole("tree", { name: "仓库 / 位置选项", exact: true })
      .getByRole("checkbox", { name: selectedLocation, exact: true }),
  ).toBeChecked();
});

for (const width of [390, 1440]) {
  test(`centered warehouse icons and readable long labels ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page, 200, width === 390 ? "spacious" : "compact");
    await page.goto("/inventory/stock/warehouses");
    const warehouse = page.getByRole("button", {
      name: /供灯-用品与法会储备物资长名称库位/,
    });
    await expect(warehouse).toBeVisible();
    await expect(warehouse).toContainText("供灯-用品与法会储备物资长名称库位");
    await page.screenshot({
      path: info.outputPath("warehouse-icons-and-labels.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}

test("large-text related-loan context keeps its close action visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, 200);
  await page.goto("/inventory/movements?view=records");
  const trigger = page.getByRole("button", { name: /借出记录 2 笔借出/ });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("寺院志工服务组");
  const close = dialog.getByRole("button", { name: "关闭对话框", exact: true });
  const geometry = await close.evaluate((button) => {
    const box = button.getBoundingClientRect();
    const header = button.closest("header")!.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      headerBottom: header.bottom,
      viewport: innerHeight,
    };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.headerBottom);
  expect(geometry.bottom).toBeLessThan(geometry.viewport / 2);
  await close.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
