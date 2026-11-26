import { expect, test, type Locator, type Page } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

const code = "T2/FUN/A01";
const room = "ROOM-A - TEST";
const storage = "A01-DIRECT - TEST";
const office = "A02-DIRECT - TEST";
const root = "PHYSICAL";
const site = "SITE-T2";
const area = "AREA-FUN";

function location(
  name: string,
  parent: string,
  kind: "area" | "room" | "system",
  path_segments: string[],
  path_names: string[],
  lft: number,
  rgt: number,
  owner = "",
) {
  const path = path_segments.join("/");
  return {
    name,
    parent,
    kind,
    path,
    label: path || "实体库房",
    local_label: path_names.at(-1) || "实体库房",
    full_label: path_names.join("/"),
    short_label: path_segments.at(-1) || "",
    search_text: path,
    path_segments,
    path_names,
    is_group: !owner,
    direct: Boolean(owner),
    storable: Boolean(owner),
    owner,
    can_edit: kind !== "system" && !owner,
    protected: kind === "system",
    version: "1",
    lft,
    rgt,
  };
}

const locations = [
  location(root, "", "system", [], [], 1, 14),
  location(site, root, "area", ["T2"], ["第2寺院"], 2, 13),
  location(area, site, "area", ["T2", "FUN"], ["第2寺院", "功能区域"], 3, 12),
  location(
    room,
    area,
    "room",
    ["T2", "FUN", "A01"],
    ["第2寺院", "功能区域", "阅览室"],
    4,
    7,
  ),
  {
    ...location(
      storage,
      room,
      "room",
      ["T2", "FUN", "A01"],
      ["第2寺院", "功能区域", "阅览室"],
      5,
      6,
      room,
    ),
    short_label: "前院",
  },
  location(
    "OFFICE",
    area,
    "room",
    ["T2", "FUN", "A02"],
    ["第2寺院", "功能区域", "A02"],
    8,
    11,
  ),
  location(
    office,
    "OFFICE",
    "room",
    ["T2", "FUN", "A02"],
    ["第2寺院", "功能区域", "A02"],
    9,
    10,
    "OFFICE",
  ),
];

function inventoryRow(
  id: string,
  name: string,
  warehouse: string,
  label: string,
  warehouse_name = "",
) {
  return {
    id,
    code: id,
    item_code: id,
    name,
    item_name: name,
    category: "用品",
    uom: "Nos",
    stock_uom: "Nos",
    available: 5,
    loaned: 0,
    damaged: 0,
    stock_qty: 5,
    tracksBatch: false,
    tracksExpiry: false,
    locations: [
      {
        location: warehouse,
        label,
        warehouse_name,
        available: 5,
        loaned: 0,
        damaged: 0,
      },
    ],
    warehouse,
    warehouse_label: label,
    warehouse_name,
  };
}

const readingStock = inventoryRow("ITEM-A", "折叠桌", storage, code, "阅览室");
const officeStock = inventoryRow("ITEM-B", "文件柜", office, "T2/FUN/A02");
const pickerRows = [readingStock, officeStock].map((row) => ({
  ...row,
  item_group: row.category,
  barcodes: [],
  uoms: [{ uom: "Nos", conversion_factor: 1 }],
  picker_quantity: row.available,
  stock: [row],
}));

async function prepare(page: Page) {
  let requestedSearch: string | undefined;
  const exports: string[][] = [];
  await page.route("**/api/method/temple_inventory.**", (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    const args = route.request().postDataJSON() || {};
    let message: unknown = [];
    if (method === "table_preferences.get_column_preferences") message = {};
    if (method === "native_api.editor_clock")
      message = { timestamp: "2026-10-16 12:00:00" };
    if (method === "catalog.picker_rows") {
      requestedSearch = args.search;
      expect(args.purpose).toBe("outbound");
      const results =
        args.search === "阅览室" ? pickerRows.slice(0, 1) : pickerRows;
      message = { results, matched_count: results.length, next_start: null };
    }
    if (method === "browse.inventory_page")
      message = {
        rows: [readingStock, officeStock],
        matched_count: 2,
        next_start: null,
        query: args.query,
        snapshot: "2026-10-16 12:00:00",
        analysis: { category: [], location: [] },
        summary: [{ stock_uom: "Nos", available: 10 }],
      };
    if (
      [
        "browse.operation_page",
        "browse.movement_history",
        "browse.operation_contributions",
      ].includes(method)
    )
      message = {
        rows: [
          {
            ...readingStock,
            id: "LINE-1",
            document: "STE-1",
            doctype: "Stock Entry",
            date: "2026-10-16",
            time: "12:00:00",
            kind: "Issue",
            docstatus: 1,
            source_warehouse: storage,
            source_warehouse_label: code,
            destination_warehouse: "",
            available_effect: -5,
            whole: {
              item_count: 1,
              quantities: [{ uom: "Nos", qty: 5 }],
              branches: [{ source: storage, destination: "" }],
              original_loans: [],
            },
          },
        ],
        matched_count: 1,
        next_start: null,
        snapshot: "2026-10-16 12:00:00",
        totals: [],
        columns: [],
        history_complete: true,
        summary: { item_count: 1, document_count: 1 },
        analysis: {},
      };
    if (method === "projections.report_page")
      message = { matched_count: 2, rows: [], columns: [] };
    if (method === "exports.request_export") {
      exports.push(args.columns);
      message = { name: "EXPORT-1", status: "Queued", version: "1" };
    }
    if (method === "exports.export_status")
      message = { name: "EXPORT-1", status: "Queued", version: "1" };
    return route.fulfill({ json: { message } });
  });
  await nativeUiSession(page, 100, {
    warehouses: locations,
    physical_leaves: [storage, office],
  });
  return { exports, requestedSearch: () => requestedSearch };
}

async function showLocationTip(page: Page, label: Locator, phone: boolean) {
  await expect(label).toHaveText(code);
  await expect(label).not.toHaveAttribute("title");
  await expect(label).not.toHaveAttribute("tabindex");
  await label.scrollIntoViewIfNeeded();
  const client = phone ? await page.context().newCDPSession(page) : undefined;
  if (client) {
    const box = (await label.boundingBox())!;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
  } else await label.hover();
  const tip = page.getByRole("tooltip").filter({ hasText: "阅览室" });
  await expect(tip).toBeVisible();
  await expect(tip.locator(".inventory-tooltip-level")).toHaveText([
    "T2第2寺院",
    "FUN功能区域",
    "A01阅览室",
  ]);
  return async () => {
    if (client) {
      await client.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await client.detach();
    }
  };
}

for (const width of [1440, 390]) {
  const phone = width === 390;
  const layout = phone ? "phone" : "desktop";
  test.describe(layout, () => {
    test.use({
      viewport: { width, height: phone ? 844 : 900 },
      hasTouch: phone,
    });

    test("stock location tooltip and optional name column", async ({
      page,
    }, info) => {
      const { exports } = await prepare(page);
      await page.goto("/inventory/stock");
      await page.getByRole("button", { name: "表格视图", exact: true }).click();
      const table = page
        .getByRole("region", { name: "库存物品", exact: true })
        .getByRole("table");
      const openColumns = () =>
        page
          .locator(".browse-summary-controls")
          .getByRole("button", { name: "显示字段", exact: true })
          .click();
      const settings = page.getByRole("group", { name: "设置表格列" });
      const columnCheckbox = (label: string) =>
        settings.getByRole("checkbox", { name: label, exact: true });
      const nameHeader = table.getByRole("columnheader", { name: /库位名称/ });
      await expect(nameHeader).toHaveCount(0);
      await openColumns();
      await expect(columnCheckbox("库位名称")).not.toBeChecked();
      await columnCheckbox("库位名称").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`column-settings-${layout}.png`),
      });
      await columnCheckbox("库位").check();
      await columnCheckbox("库位名称").check();
      await page.keyboard.press("Escape");

      await expect(nameHeader).toBeVisible();
      await expect(
        table.getByRole("cell", { name: "阅览室", exact: true }),
      ).toBeVisible();
      await expect(
        table
          .getByRole("row", { name: /文件柜/ })
          .getByRole("cell", { name: "—", exact: true })
          .last(),
      ).toBeVisible();
      // The desktop 位置 chip opens the locations popover on hover; it carries no second tip.
      if (!phone)
        await expect(
          table.locator(".stock-detail-trigger-label .location-label").first(),
        ).not.toHaveAttribute("data-inventory-tip", "");
      const label = table
        .locator(".location-label")
        .filter({ hasText: code })
        .last();
      const release = await showLocationTip(page, label, phone);
      await page.screenshot({
        path: info.outputPath(`stock-tooltip-${layout}.png`),
      });
      await release();
      await page.keyboard.press("Escape");

      if (!phone) {
        await page
          .getByRole("button", { name: "更多操作", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "导出", exact: true }).click();
        await page.getByRole("button", { name: "开始导出" }).click();
        await expect.poll(() => exports[0]).toContain("warehouse_name");
      }
    });

    test("warehouse tree and detail show codes and names", async ({
      page,
    }, info) => {
      await prepare(page);
      await page.goto("/inventory/stock/warehouses");
      const search = page.getByRole("searchbox", { name: "搜索仓库" });
      const readingRoom = page.getByRole("group", {
        name: "A01 阅览室",
        exact: true,
      });
      const officeRoom = page.getByRole("group", { name: "A02", exact: true });
      await expect(readingRoom).toBeVisible();
      await search.fill("A02");
      await expect(readingRoom).toHaveCount(0);
      await expect(officeRoom.locator(".warehouse-tree-label")).toHaveText(
        "A02",
      );
      await search.fill("阅览室 Ｔ２");
      await expect(officeRoom).toHaveCount(0);
      await expect(readingRoom).toBeVisible();
      await expect(readingRoom.locator("button.warehouse-toggle")).toHaveCount(
        0,
      );
      await expect(
        readingRoom.locator("span.warehouse-toggle"),
      ).toHaveAttribute("aria-hidden", "true");
      await expect(
        page.getByRole("group", { name: "T2 第2寺院", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("group", { name: "FUN 功能区域", exact: true }),
      ).toBeVisible();
      if (phone)
        await page.screenshot({
          path: info.outputPath("warehouse-tree-phone.png"),
        });
      await readingRoom
        .getByRole("button", { name: "A01 阅览室 房间" })
        .click();
      await expect(
        page.getByRole("heading", { name: "A01 阅览室", exact: true }).last(),
      ).toBeVisible();
      // The heading names the room; the path above the details lists its ancestors.
      await expect(page.locator(".warehouse-detail-path")).toHaveText(
        /^\s*T2 第2寺院\s*›\s*FUN 功能区域\s*$/,
      );
      await page.screenshot({
        path: info.outputPath(`warehouse-detail-${layout}.png`),
      });
      await page.getByRole("button", { name: "更多位置操作" }).click();
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "代码" })).toHaveValue(
        "A01",
      );
    });

    test("Receive location picker matches codes and names in either order", async ({
      page,
    }, info) => {
      await prepare(page);
      await page.goto("/inventory/movements/new/Receive");
      const input = page.getByRole("combobox", { name: /入库位置/ }).first();
      const options = page.getByRole("listbox");
      for (const search of ["阅览室 Ｔ２", "T2 阅览室"]) {
        await input.fill(search);
        await expect(options.getByRole("option")).toHaveCount(1);
        await expect(options.getByRole("option").locator("small")).toHaveText(
          "阅览室",
        );
        await expect(options.getByRole("option")).toContainText(code);
      }
      await page.screenshot({
        path: info.outputPath(`receive-location-${layout}.png`),
      });
    });

    test("Issue picker keeps only the rows in the matching location", async ({
      page,
    }, info) => {
      const { requestedSearch } = await prepare(page);
      await page.goto("/inventory/movements/new/Issue");
      await page
        .getByRole("button", { name: "添加物品", exact: true })
        .first()
        .click();
      const picker = page.getByRole("dialog", {
        name: "选择物品",
        exact: true,
      });
      await expect(
        picker.getByText("文件柜", { exact: true }).first(),
      ).toBeVisible();
      await picker.getByRole("searchbox").first().fill("阅览室");
      await expect.poll(requestedSearch).toBe("阅览室");
      await expect(
        picker.getByText("折叠桌", { exact: true }).first(),
      ).toBeVisible();
      await expect(picker.getByText("文件柜", { exact: true })).toHaveCount(0);
      await expect(
        picker.getByText(code, { exact: true }).first(),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`issue-item-picker-${layout}.png`),
      });
    });

    test("movement rows keep code-only labels with the same tooltip", async ({
      page,
    }, info) => {
      await prepare(page);
      await page.goto("/inventory/movements?view=items");
      if (phone)
        await page
          .getByRole("button", { name: "表格视图", exact: true })
          .click();
      const release = await showLocationTip(
        page,
        page.locator(".location-label").filter({ hasText: code }).first(),
        phone,
      );
      await page.screenshot({
        path: info.outputPath(`movement-tooltip-${layout}.png`),
      });
      await release();
    });
  });
}
