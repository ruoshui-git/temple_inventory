import { expect, type Locator, type Page } from "@playwright/test";
import { nativeUiSession } from "./nativeUi";

// Routed production components with controlled HTTP data: a 类别 → 物品 stock table long enough
// that its column header and group rows stick while the page scrolls.
const categories = Array.from({ length: 12 }, (_, index) => `类别${index}`);
const itemsPerCategory = 12;
// Two-level stock (类别 → 物品): each 物品 group holds leaves named after its own label, so a
// stuck 物品 row can be checked against the rows directly below it.
const itemGroupsPerCategory = 3;
const leavesPerItemGroup = 4;
export const nestedGroupQuery =
  "/inventory/stock?query=%7B%22groupBy%22%3A%5B%22category%22%2C%22item%22%5D%7D";

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

function itemGroupLabel(category: string, index: number) {
  return `${category} / 物品${index}`;
}

function itemGroupRow(category: string, index: number) {
  const label = itemGroupLabel(category, index);
  return {
    id: `item:${label}`,
    parent_group_id: `category:${category}`,
    row_grain: "group",
    group_depth: 2,
    group_path: [`category:${category}`, `item:${label}`],
    group_label: label,
    group_field: "item",
    row_count: leavesPerItemGroup,
    display_count: leavesPerItemGroup,
    has_children: true,
    unit_totals: [
      { stock_uom: "个", available: 21, loaned: 6, damaged: 3, stock_qty: 30 },
    ],
  };
}

function nestedLeafRow(label: string, index: number) {
  const name = `${label} / 条目${index}`;
  return {
    ...itemRow(label.split(" / ")[0]!, index),
    id: name,
    code: name,
    item_code: name,
    item_name: name,
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
      const nested = (args.query?.groupBy || []).length > 1;
      const category = parent[0]?.replace(/^category:/, "") ?? "";
      const message =
        parent.length === 2
          ? {
              rows: Array.from({ length: leavesPerItemGroup }, (_, index) =>
                nestedLeafRow(parent[1]!.replace(/^item:/, ""), index),
              ),
              matched_count: leavesPerItemGroup,
              next_start: null,
              parent_path: parent,
              query: args.query,
              row_grain: "detail",
              leaf_columns: [],
            }
          : parent.length && nested
            ? {
                rows: Array.from(
                  { length: itemGroupsPerCategory },
                  (_, index) => itemGroupRow(category, index),
                ),
                matched_count: itemGroupsPerCategory,
                next_start: null,
                parent_path: parent,
                query: args.query,
                row_grain: "group",
                leaf_columns: [],
              }
            : parent.length
              ? {
                  rows: Array.from({ length: itemsPerCategory }, (_, index) =>
                    itemRow(category, index),
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
      await clickClearOfStuckRows(toggle);
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

// Opens 类别 → 物品 stock with the categories at `categoryIndexes` expanded. Their 物品 groups are
// expanded too unless `itemGroups` is false, so the table is long enough to scroll through.
export async function openNestedStock(
  page: Page,
  phone: boolean,
  {
    categoryIndexes = [0, 1],
    itemGroups = true,
  }: { categoryIndexes?: number[]; itemGroups?: boolean } = {},
) {
  await page.goto(nestedGroupQuery);
  if (phone)
    await page.getByRole("button", { name: "表格视图", exact: true }).click();
  await expect(page.locator("tr.data-table-group-row").first()).toBeVisible();
  for (const category of categoryIndexes.map((index) => categories[index]!)) {
    await toggleGroup(page, category);
    if (!itemGroups) continue;
    for (let index = 0; index < itemGroupsPerCategory; index++)
      await toggleGroup(page, itemGroupLabel(category, index));
  }
  await expect(page.locator("tr[data-browse-row]").first()).toBeVisible();
}

async function toggleGroup(page: Page, label: string) {
  const toggle = page.locator(
    `.data-table-group-toggle:has(.data-table-group-name:text-is("${label}"))`,
  );
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await clickClearOfStuckRows(toggle);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

// A stuck row's own box stays at its layout place; its cells move with the sticky offset, so
// the visual position is read from the first cell.
// Stuck group rows of the visible table, shallowest first. `labelBelow` is the id of the first
// leaf under the stuck stack; leaf ids carry their group labels because grouped tables hide the
// name columns that the group headers already show.
export function stuckState(page: Page) {
  return page.evaluate(() => {
    const table = Array.from(
      document.querySelectorAll<HTMLElement>(".data-table-scroll"),
    ).find((element) => element.offsetParent !== null)!;
    const header = table.querySelector("thead th")!.getBoundingClientRect();
    return {
      headerBottom: header.bottom,
      rows: Array.from(table.querySelectorAll<HTMLElement>("tr.is-stuck")).map(
        (row) => {
          const box = (
            row.firstElementChild as HTMLElement
          ).getBoundingClientRect();
          let next = row.nextElementSibling;
          while (
            next &&
            !next.matches("tr[data-browse-row]:not(.data-table-group-row)")
          )
            next = next.nextElementSibling;
          return {
            label:
              row.querySelector(".data-table-group-name")?.textContent ?? "",
            top: box.top,
            bottom: box.bottom,
            expanded: row.getAttribute("aria-expanded"),
            deeper: row.classList.contains("is-stuck-deeper"),
            last: row.classList.contains("is-stuck-last"),
            labelBelow: (next as HTMLElement | null)?.dataset.rowId ?? "",
          };
        },
      ),
    };
  });
}

// A stuck group row covers the rows under the header, so a toggle that scrolled under it would
// receive the click meant for the stuck row. Centering the toggle keeps it clear of the stack.
async function clickClearOfStuckRows(toggle: Locator) {
  await toggle.evaluate((element) =>
    element.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await toggle.click();
}
