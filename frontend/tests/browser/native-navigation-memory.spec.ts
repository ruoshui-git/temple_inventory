import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// This suite exercises the routed production UI and real HTTP transport with
// controlled native-shaped responses. It is not server/database acceptance.
for (const width of [375, 1024, 1440]) {
  test(`browse history, pages and responsive position at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [],
      unexpected: string[] = [],
      reads: number[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/method/**", async (route) => {
      const method = new URL(route.request().url()).pathname.split("/").at(-1)!;
      const args = route.request().postDataJSON() || {};
      let message: unknown;
      if (method === "temple_inventory.session.info")
        message = {
          user: "manager",
          csrf_token: "navigation-test",
          ui_preferences: {
            theme: "jade",
            density: "balanced",
            textScale: 100,
          },
        };
      else if (method === "temple_inventory.configuration.status")
        message = { setup_required: false, blockers: [], warnings: [] };
      else if (method === "temple_inventory.browse.bootstrap")
        message = {
          user: "manager",
          site: "navigation-ui-test",
          site_date: "2026-10-16",
          site_time: "12:00:00",
          settings: { company: "TEST" },
          physical_leaves: [],
          leased_leaves: [],
          damaged_leaves: [],
          categories: [],
          warehouses: [],
          uoms: [],
          activity_types: [],
          capabilities: {},
          operations: {},
        };
      else if (method === "temple_inventory.browse.inventory_page") {
        const start = Number(args.start || 0),
          end = Math.min(start + 30, 65);
        reads.push(start);
        message = {
          rows: Array.from({ length: end - start }, (_, index) => ({
            code: `ITEM-${start + index}`,
            name: `长名称物品${start + index} · 法会用品与日常储备`,
            category: "用品",
            uom: "个",
            available: 7,
            loaned: 0,
            damaged: 0,
            tracksBatch: false,
            tracksExpiry: false,
            locations: [],
          })),
          matched_count: 65,
          next_start: end < 65 ? end : null,
          snapshot: "2026-10-16 12:00",
          summary: [],
          analysis: { category: [], location: [] },
          query: args.query,
        };
      } else if (method === "temple_inventory.catalog.operation_items")
        message = {
          items: [
            {
              item_code: args.item_codes?.[0],
              item_name: "原生物品详情",
              item_group: "用品",
              stock_uom: "个",
              description: "",
              version: "v1",
              has_batch_no: false,
              has_expiry_date: false,
              can_edit: false,
              barcodes: [],
              uoms: [],
              stock: [],
              attachments: [],
            },
          ],
          errors: [],
        };
      else if (method === "temple_inventory.catalog.item_lifecycle")
        message = {
          disabled: false,
          tracking_changeable: true,
          tracking_change_reason: "",
          can_delete: true,
        };
      else if (method === "temple_inventory.notifications.inbox")
        message = { items: [], unread_count: 0, has_running_exports: false };
      else if (method === "temple_inventory.notifications.unread_count")
        message = 0;
      else if (
        method === "temple_inventory.table_preferences.get_column_preferences"
      )
        message = null;
      else if (
        method ===
        "temple_inventory.table_preferences.get_presentation_preference"
      )
        message = false;
      else if (
        method === "temple_inventory.table_preferences.save_column_preferences"
      )
        message = args.preference;
      else if (
        method === "temple_inventory.browse.movement_history" ||
        method === "temple_inventory.browse.loan_item_history"
      )
        message = { rows: [], matched_count: 0, next_start: null };
      else if (method === "temple_inventory.projections.report_page")
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
          snapshot: "2026-10-16",
          period: { key: "all", date_from: "", date_to: "" },
        };
      else {
        unexpected.push(method);
        await route.fulfill({
          status: 500,
          json: { message: "测试未配置此请求" },
        });
        return;
      }
      await route.fulfill({ json: { message } });
    });
    await page.goto("/inventory/stock");
    if (process.env.AUDIT_CJK_FONT) {
      const font = readFileSync(process.env.AUDIT_CJK_FONT).toString("base64");
      await page.addStyleTag({
        content: `@font-face { font-family: 'Audit CJK'; src: url(data:font/otf;base64,${font}); } html,body,button,input,select,textarea { font-family: 'Audit CJK',sans-serif !important; }`,
      });
      await page.evaluate(() => document.fonts.ready);
    }
    await expect(page.locator("[data-browse-row]")).toHaveCount(30);
    await page.getByRole("button", { name: "列表视图", exact: true }).click();
    await page.getByRole("button", { name: /^加载更多/ }).click();
    await expect(page.locator("[data-browse-row]")).toHaveCount(60);
    const row = page.locator('[data-browse-row="ITEM-42"]');
    await row.locator("input").check();
    await row.scrollIntoViewIfNeeded();
    await row.evaluate((element) =>
      window.scrollBy(0, element.getBoundingClientRect().top - 350),
    );
    // A narrow table may scroll its target into view during activation. Capture
    // the actual departure position, after the browser has focused that target.
    await row.evaluate((element) =>
      element.addEventListener(
        "click",
        () => {
          document.documentElement.dataset.departureRow = String(
            element.getBoundingClientRect().top,
          );
          document.documentElement.dataset.departureLeft = String(
            element.closest("[data-browse-scroll]")?.scrollLeft || 0,
          );
        },
        { once: true },
      ),
    );
    // Desktop tables link the name; phone list rows keep a name button.
    await row
      .getByRole("link", { name: /长名称物品42/ })
      .or(row.getByRole("button", { name: /长名称物品42/ }))
      .click();
    await expect(
      page.getByRole("heading", { name: "物品详情", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(page.locator("[data-browse-row]")).toHaveCount(60);
    await expect(row.locator("input")).toBeChecked();
    const departure = await page.evaluate(() =>
      Number(document.documentElement.dataset.departureRow),
    );
    await expect
      .poll(async () => Math.abs((await row.boundingBox())!.y - departure))
      .toBeLessThan(5);
    const tableScroll = page.locator('[data-browse-scroll="inventory-table"]');
    if (await tableScroll.count())
      expect(await tableScroll.evaluate((element) => element.scrollLeft)).toBe(
        await page.evaluate(() =>
          Number(document.documentElement.dataset.departureLeft),
        ),
      );
    else
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.departureLeft,
        ),
      ).toBe("0");
    expect(reads.slice(-2)).toEqual([0, 30]);
    await page.screenshot({
      path: testInfo.outputPath(`returned-${width}.png`),
    });

    // The same controller survives the shared breakpoint, including selection
    // and the logical row anchor; no extra native query is needed for resize.
    const readCount = reads.length;
    const switchedWidth = width < 1024 ? 1440 : 375;
    const prior = (await row.boundingBox())!.y;
    await page.setViewportSize({ width: switchedWidth, height: 1000 });
    await expect(row.locator("input")).toBeChecked();
    await expect
      .poll(async () => Math.abs((await row.boundingBox())!.y - prior))
      .toBeLessThan(5);
    expect(reads).toHaveLength(readCount);
    await page.screenshot({
      path: testInfo.outputPath(`resized-${switchedWidth}.png`),
    });

    // Phone navigation returns to its retained browse stack; desktop navigation
    // starts the section at its first page.
    await page
      .getByRole("navigation", { name: "应用主导航" })
      .getByRole("button", { name: "库存", exact: true })
      .click();
    await expect(page.locator("[data-browse-row]")).toHaveCount(
      width < 1024 ? 60 : 30,
    );
    await expect(
      page.locator('[data-browse-row] input[type="checkbox"]:checked'),
    ).toHaveCount(width < 1024 ? 1 : 0);
    expect(errors).toEqual([]);
    expect(unexpected).toEqual([]);
  });
}
