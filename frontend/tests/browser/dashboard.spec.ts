import { expect, test } from "@playwright/test";

const quantity = (qty: number) => ({
  unitless_total: qty,
  by_uom: [{ uom: "Nos", qty }],
});

const dashboard = {
  generated_at: "2026-10-10 15:30:00",
  warehouses: [
    {
      name: "ROOT",
      warehouse_name: "寺院仓库",
      local_label: "寺院仓库",
      is_group: 1,
      lft: 1,
      rgt: 4,
    },
    {
      name: "A02",
      warehouse_name: "A02",
      local_label: "A02",
      parent_warehouse: "ROOT",
      is_group: 0,
      lft: 2,
      rgt: 3,
    },
  ],
  item_groups: [
    { name: "All Item Groups", item_group_name: "全部物品组", lft: 1, rgt: 4 },
    {
      name: "食品",
      item_group_name: "食品",
      parent_item_group: "All Item Groups",
      lft: 2,
      rgt: 3,
    },
  ],
  inventory: {
    totals: {
      available_stock: quantity(12),
      total_stock: quantity(15),
      on_loan_qty: quantity(2),
      damaged_qty: quantity(1),
    },
  },
  expiry: {
    buckets: Object.fromEntries(
      [
        ["expired_1_30", "已过期 1–30 天"],
        ["expired_31_90", "已过期 31–90 天"],
        ["expired_over_90", "已过期 >90 天"],
        ["upcoming_0_30", "0–30 天内到期"],
        ["upcoming_31_90", "31–90 天内到期"],
        ["upcoming_over_90", ">90 天后到期"],
      ].map(([key, label]) => [key, { key, label, count: 1, rows: [] }]),
    ),
    preview: [],
  },
  movement: {
    summaries: [
      {
        kind: "Receive",
        label: "入库",
        record_count: 1,
        quantity: quantity(5),
      },
    ],
    recent: [],
  },
  loans: { record_count: 0, quantity: quantity(0), rows: [] },
  reminders: [],
  distribution: { mode: "warehouse", bars: [] },
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/method/**", async (route) => {
    const method = route.request().url().split(".").pop()?.split("?")[0];
    const result = method === "dashboard_summary" ? dashboard : [];
    await route.fulfill({ json: { message: result } });
  });
});

test("dashboard keeps controls and filter state across the responsive breakpoint", async ({
  page,
}) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/inventory/");
	await expect(page.getByRole("heading", { name: "物资总览" })).toBeVisible();
	await page.getByRole("button", { name: "本年", exact: true }).click();
  await page.getByRole("button", { name: /^筛选/ }).click();
  await expect(page.locator(".dashboard-desktop-filter")).toBeVisible();
  await expect(page.locator(".filter-drawer-backdrop")).toHaveCount(0);

	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.locator(".mobile-nav a")).toHaveCount(6);
  await expect(page.getByRole("dialog", { name: "首页筛选" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "本年", exact: true }),
  ).toHaveClass(/active/);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "首页筛选" })).toHaveCount(0);
});
