import { expect, type Page } from "@playwright/test";
import { nativeUiSession } from "./nativeUi";

// Routed production components with controlled HTTP data: a 类别 → 物品 stock table long enough
// that its column header and group rows stick while the page scrolls.
const categories = Array.from({ length: 12 }, (_, index) => `类别${index}`);
const itemsPerCategory = 12;

function itemRow(category: string, index: number) {
  const code = `${category}-ITEM-${index}`;
  return {
    id: code,
    row_grain: "detail",
    code,
    item_code: code,
    item_name: `${category}物品${index}`,
    category,
    stock_uom: "个",
    available: 7,
    loaned: 2,
    damaged: 1,
    stock_qty: 10,
    tracksBatch: false,
    tracksExpiry: false,
    image: "",
    locations: [],
    document_count: 1,
    allocation_count: 0,
    totals: [
      { stock_uom: "个", available: 7, loaned: 2, damaged: 1, stock_qty: 10 },
    ],
  };
}

export async function prepare(page: Page) {
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page",
    (route) =>
      route.fulfill({
        json: {
          message: {
            rows: [],
            matched_count: 0,
            next_start: null,
            query: {},
            snapshot: "2026-10-18 10:00:00",
            analysis: { category: [], location: [] },
            summary: [{ stock_uom: "个", available: 0, loaned: 0, damaged: 0 }],
          },
        },
      }),
  );
  await nativeUiSession(page, 100, {
    categories: categories.map((name) => ({
      name,
      item_group_name: name,
      is_group: false,
    })),
  });
  await page.route(
    "**/api/method/temple_inventory.projections.group_page",
    async (route) => {
      const args = route.request().postDataJSON() || {};
      const parent: string[] = args.parent_path || [];
      const message = parent.length
        ? {
            rows: Array.from({ length: itemsPerCategory }, (_, index) =>
              itemRow(parent[0]!.replace(/^category:/, ""), index),
            ),
            matched_count: itemsPerCategory,
            next_start: null,
            parent_path: parent,
            query: args.query,
            row_grain: "detail",
            leaf_columns: [],
          }
        : {
            rows: categories.map((name) => ({
              id: `category:${name}`,
              row_grain: "group",
              group_depth: 1,
              group_path: [`category:${name}`],
              group_label: name,
              group_field: "category",
              row_count: itemsPerCategory,
              display_count: itemsPerCategory,
              has_children: true,
              unit_totals: [
                {
                  stock_uom: "个",
                  available: 84,
                  loaned: 24,
                  damaged: 12,
                  stock_qty: 120,
                },
              ],
            })),
            matched_count: categories.length,
            next_start: null,
            parent_path: [],
            query: args.query,
            row_grain: "group",
            leaf_columns: [],
          };
      await route.fulfill({ json: { message } });
    },
  );
}

// Phones keep hidden list and card layouts in the DOM, so every measurement uses the table on screen.
export const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

export async function openGroupedStock(page: Page, phone: boolean) {
  await page.goto(
    "/inventory/stock?query=%7B%22groupBy%22%3A%5B%22category%22%5D%7D",
  );
  // Phones open on 列表 for a grouped query; switch to the table layout explicitly.
  if (phone)
    await page.getByRole("button", { name: "表格视图", exact: true }).click();
  await expect(page.locator("tr.data-table-group-row").first()).toBeVisible();
  // Open the first few 类别 so the table is long enough to scroll past the header.
  for (const label of categories.slice(0, 4)) {
    const toggle = page.locator(
      `.data-table-group-toggle:has(.data-table-group-name:text-is("${label}"))`,
    );
    if ((await toggle.getAttribute("aria-expanded")) !== "true")
      await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
  await expect(page.locator("tr[data-browse-row]").first()).toBeVisible();
}

// The sticky line is the bottom of the toolbar that stays on screen: the whole condensed chrome on
// desktop, the persistent search bar on phones.
export function stickyToolbarBottom(page: Page, phone: boolean) {
  return page.evaluate((usePersistentBar) => {
    const element = document.querySelector(
      usePersistentBar ? ".browse-persistent-bar" : ".browse-chrome",
    );
    return element!.getBoundingClientRect().bottom;
  }, phone);
}

// Scrolls so the rendered table starts 300px above the viewport: the header is then stuck while
// the table still runs on below it. A fixed scroll amount depends on where group expansion left
// the page, so position the table instead.
export async function scrollTableBandIntoView(page: Page) {
  await page.evaluate(() => {
    const table = Array.from(
      document.querySelectorAll<HTMLElement>(".data-table-scroll"),
    ).find((element) => element.offsetParent !== null)!;
    window.scrollBy(0, table.getBoundingClientRect().top + 300);
  });
}

export function headerTop(page: Page) {
  return page.evaluate(() => {
    const table = Array.from(
      document.querySelectorAll<HTMLElement>(".data-table-scroll"),
    ).find((element) => element.offsetParent !== null)!;
    return table.querySelector("thead th")!.getBoundingClientRect().top;
  });
}
