import { expect, test, type Page } from "@playwright/test";
import { fullNativeCapabilities, nativeUiSession } from "./fixtures/nativeUi";

const shots = "/tmp/codex-runs/followups-shots";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

// Every restricting filter shows a chip at the page default; the list is never silently filtered.
const defaultChips: Array<{ path: string; slug: string; chips: string[] }> = [
  {
    path: "/inventory/movements",
    slug: "movements",
    chips: ["日期：本月", "物品状态：启用"],
  },
  {
    path: "/inventory/loans",
    slug: "loans",
    chips: ["借出日期：本月", "借用状态：未结清"],
  },
  {
    path: "/inventory/stock",
    slug: "inventory",
    chips: ["库存状态：有库存", "物品状态：启用"],
  },
  {
    path: "/inventory/stock/expiry",
    slug: "expiry",
    chips: ["物品状态：启用"],
  },
  {
    path: "/inventory/activities",
    slug: "activities",
    chips: ["活动状态：进行中"],
  },
  { path: "/inventory/counts", slug: "counts", chips: ["日期：本月"] },
];

function browsePage(query: Record<string, unknown>) {
  return {
    query,
    rows: [],
    matched_count: 0,
    next_start: null,
    summary: {},
    totals: [],
    analysis: {},
    snapshot: "2026-10-16 12:00:00",
  };
}

async function mockBrowseReads(page: Page) {
  for (const method of [
    "browse.operation_page",
    "browse.inventory_page",
    "browse.expiry_page",
    "browse.counts_page",
    "projections.report_page",
  ])
    await page.route(
      `**/api/method/temple_inventory.${method}`,
      async (route) => {
        const body = route.request().postDataJSON() as {
          query?: Record<string, unknown>;
        };
        await route.fulfill({
          json: { message: browsePage(body?.query ?? {}) },
        });
      },
    );
}

async function openDateFilter(page: Page) {
  // Open the filter panel only when the date filter is not already on screen.
  const period = page.locator("[data-filter-field='period']").first();
  if (!(await period.isVisible()))
    await page
      .getByRole("button", { name: /^筛选(，|$)/ })
      .first()
      .click();
  await expect(period).toBeVisible();
  const details = page.locator("details[data-filter-field='period']").first();
  if (
    (await details.count()) &&
    !(await details.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await details.locator("summary").click();
}

test.describe("default filter chips", () => {
  for (const viewport of viewports) {
    test(`shows the page defaults as chips on ${viewport.name}`, async ({
      page,
    }) => {
      await nativeUiSession(page);
      await mockBrowseReads(page);
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      for (const { path, slug, chips } of defaultChips) {
        await page.goto(path);
        for (const label of chips)
          await expect(
            page
              .locator(".browse-active-chip-label", { hasText: label })
              .first(),
          ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "恢复默认", exact: true }),
        ).toHaveCount(0);
        await page.screenshot({
          path: `${shots}/chips-${slug}-${viewport.name}.png`,
          fullPage: false,
        });
      }
    });
  }

  test("lifting a default chip shows 恢复默认, which restores the default and hides itself", async ({
    page,
  }) => {
    await nativeUiSession(page);
    await mockBrowseReads(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/inventory/movements");
    const itemChip = page.locator(".browse-active-chip-label", {
      hasText: "物品状态：启用",
    });
    await expect(itemChip.first()).toBeVisible();
    await page
      .getByRole("button", { name: "移除物品状态：启用" })
      .first()
      .click();
    await expect(itemChip).toHaveCount(0);
    const restore = page
      .getByRole("button", { name: "恢复默认", exact: true })
      .first();
    await expect(restore).toBeVisible();
    await restore.click();
    await expect(itemChip.first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "恢复默认", exact: true }),
    ).toHaveCount(0);
  });

  test("设为默认 saves the previewed preset for this area from the filter and the settings page reads it back", async ({
    page,
  }) => {
    await nativeUiSession(page);
    await mockBrowseReads(page);
    let saved: Record<string, unknown> | undefined;
    let savedDefaults = {
      dashboard: "this_month",
      movements: "this_month",
      loans: "this_month",
      counts: "this_month",
    };
    await page.route(
      "**/api/method/temple_inventory.session.info",
      async (route) => {
        await route.fulfill({
          json: {
            message: {
              user: "manager",
              csrf_token: "native-ui-test",
              role_label: "管理员",
              capabilities: fullNativeCapabilities,
              ui_preferences: {
                theme: "jade",
                density: "balanced",
                textScale: 100,
                default_periods: savedDefaults,
              },
            },
          },
        });
      },
    );
    await page.route(
      "**/api/method/temple_inventory.preferences.save_display_preferences",
      async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        saved = body;
        savedDefaults = body.default_periods as typeof savedDefaults;
        await route.fulfill({ json: { message: body } });
      },
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/inventory/movements");
    await openDateFilter(page);
    await page.getByLabel("流动日期时间范围预设").selectOption("last_30_days");
    await page.screenshot({
      path: `${shots}/date-filter-set-default-desktop.png`,
    });
    await page.getByRole("button", { name: "设为默认", exact: true }).click();
    await expect.poll(() => saved).toBeDefined();
    expect(saved?.default_periods).toMatchObject({ movements: "last_30_days" });
    await expect(
      page.getByRole("button", { name: "设为默认", exact: true }),
    ).toBeDisabled();

    await page.goto("/inventory/settings");
    await expect(page.getByLabel("货物流动")).toHaveValue("last_30_days");
    await page.screenshot({
      path: `${shots}/settings-default-after-set-desktop.png`,
      fullPage: true,
    });
  });

  test("a report's date range is named by exactly one chip", async ({
    page,
  }) => {
    await nativeUiSession(page);
    await mockBrowseReads(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/inventory/reports");
    await page.getByLabel("报表数据集").selectOption("movements");
    await openDateFilter(page);
    await page.getByLabel("记账日期时间范围预设").selectOption("this_month");
    await page.getByRole("button", { name: "应用日期", exact: true }).click();
    await expect(
      page.locator(".browse-active-chip-label", { hasText: "记账日期：本月" }),
    ).toHaveCount(1);
  });

  test("自定义 explains why it cannot become the default", async ({ page }) => {
    await nativeUiSession(page);
    await mockBrowseReads(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/inventory/movements");
    await openDateFilter(page);
    await page.getByLabel("流动日期时间范围预设").selectOption("custom");
    const button = page.getByRole("button", { name: "设为默认", exact: true });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute(
      "title",
      "自定义日期不会随时间更新，只能将预设范围设为默认",
    );
    await page.screenshot({ path: `${shots}/date-filter-custom-phone.png` });
  });
});
