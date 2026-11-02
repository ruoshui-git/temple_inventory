import { expect, test, type Page } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

const requested: { query: { asOf?: string } }[] = [];

function location(code: string, label: string, available: number) {
  return {
    location: code,
    label,
    path: `T2 / ${code}`,
    nativeName: `T2 / ${code}`,
    available,
    loaned: 0,
    damaged: 0,
    batches: [],
  };
}

async function prepare(page: Page) {
  requested.length = 0;
  await nativeUiSession(page);
  // The stock list is the only controlled surface; the session mocks answer everything else.
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page*",
    (route) => {
      const args = route.request().postDataJSON() || {};
      requested.push(args);
      const pastRows = [
        {
          id: "ITEM-RICE",
          code: "ITEM-RICE",
          item_code: "ITEM-RICE",
          name: "大米",
          item_name: "大米",
          category: "食品",
          uom: "kg",
          stock_uom: "kg",
          available: args.query?.asOf ? 5 : 8,
          loaned: 0,
          damaged: 0,
          stock_qty: args.query?.asOf ? 5 : 8,
          tracksBatch: false,
          tracksExpiry: false,
          image: "",
          locations: [
            location("A01", "礼堂储物室第一层", args.query?.asOf ? 5 : 8),
          ],
        },
      ];
      return route.fulfill({
        json: {
          message: {
            rows: pastRows,
            matched_count: pastRows.length,
            next_start: null,
            query: args.query,
            snapshot: "2026-11-02 12:00:00",
            analysis: { category: [], location: [] },
            summary: [
              {
                stock_uom: "kg",
                available: pastRows[0]!.available,
                loaned: 0,
                damaged: 0,
              },
            ],
          },
        },
      });
    },
  );
}

test("stock can be read as of a past day, names it, and returns to now", async ({
  page,
}, testInfo) => {
  await prepare(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/inventory/stock");
  await expect(page.getByText("截至：现在").first()).toBeVisible();
  expect(requested.at(-1)?.query.asOf ?? "").toBe("");

  await page.getByRole("button", { name: /^筛选/ }).first().click();
  const disclosure = page.locator('details[data-filter-field="asOf"]').first();
  await disclosure.locator("summary").click();
  await expect(disclosure.getByLabel("截至日期")).toHaveAttribute(
    "max",
    /\d{4}-\d{2}-\d{2}/,
  );
  await disclosure.getByLabel("截至日期").fill("2026-10-12");
  await disclosure.getByRole("button", { name: "应用", exact: true }).click();

  await expect(page.getByText("截至：2026-10-12").first()).toBeVisible();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "正在查看 2026-10-12 的历史库存" }),
  ).toBeVisible();
  expect(requested.at(-1)?.query.asOf).toBe("2026-10-12");
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: testInfo.outputPath("stock-as-of-2026-10-12.png"),
    fullPage: false,
  });

  await page
    .getByRole("status")
    .filter({ hasText: "正在查看" })
    .getByRole("button", { name: "回到现在" })
    .click();
  await expect(page.getByText("截至：现在").first()).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "正在查看" }),
  ).toHaveCount(0);
  expect(requested.at(-1)?.query.asOf ?? "").toBe("");
});
