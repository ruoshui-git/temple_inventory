import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const output =
  process.env.DESIGN_PREVIEW_RESULTS || "/tmp/activities-independent-final";
mkdirSync(`${output}/screenshots`, { recursive: true });
async function open(page: Page, route: string) {
  await page.goto("/design-preview.html");
  await page.getByRole("button", { name: "收起评审选项", exact: true }).click();
  await page.evaluate((route) => {
    location.hash = `#review/${encodeURIComponent(route)}`;
  }, route);
  await page.evaluate(() => document.fonts.ready);
}
for (const width of [375, 1440]) {
  test(`independent report details, groups and paging ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await open(page, "reports/activities");
    await page.evaluate(async () => {
      const { reviewSession } =
        await import("/src/design-preview/reviewModel.ts");
      const loan = reviewSession.loans[0];
      loan.lines = Array.from({ length: 35 }, (_, index) => ({
        code: index % 2 ? "ITM-000128" : "ITM-000129",
        qty: 10,
        returned: 2,
        damaged: 1,
        lost: 1,
        location: "斋堂 / A-01",
      }));
    });
    await page
      .getByRole("combobox", { name: "视图", exact: true })
      .selectOption("loans");
    await page.getByRole("button", { name: /^分组：/ }).click();
    await page
      .getByRole("combobox", { name: "分组", exact: true })
      .selectOption("activity");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "完成", exact: true })
      .click();
    const main = page.locator(".report-table-wrap").first();
    await expect(
      main.getByRole("columnheader", { name: "未归还", exact: true }),
    ).toBeVisible();
    await expect(main).toContainText("袋");
    await expect(main).toContainText("桶");
    await main.scrollIntoViewIfNeeded();
    expect(
      await page
        .locator(".preview-reports .preview-period-trigger")
        .first()
        .evaluate((element) => getComputedStyle(element).position),
    ).toBe("static");
    await page.screenshot({
      path: `${output}/screenshots/independent-grouped-loans-${width}.png`,
    });
    const balances = page
      .locator("details")
      .filter({ has: page.locator("summary", { hasText: /^当前借用结余 ·/ }) });
    await balances.locator("summary").click();
    await expect(balances.locator("tbody tr")).toHaveCount(30);
    await balances
      .getByRole("button", { name: "加载更多 · 当前借用结余", exact: true })
      .click();
    expect(await balances.locator("tbody tr").count()).toBeGreaterThan(30);
    await balances.locator("tbody tr").last().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${output}/screenshots/independent-loaded-details-${width}.png`,
    });
    await page.getByRole("button", { name: "快速导出", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("combobox", { name: "预览表", exact: true })
      .selectOption("balances");
    await expect(dialog.locator("tbody tr")).toHaveCount(5);
    await expect(dialog.getByRole("button", { name: /加载更多/ })).toHaveCount(
      0,
    );
    await page.screenshot({
      path: `${output}/screenshots/independent-quick-report-${width}.png`,
    });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await page
      .getByRole("combobox", { name: "数据集", exact: true })
      .selectOption("inventory");
    // Snapshot inventory has no activity attribution; grouping remains available in its own panel.
    await expect(
      page.getByRole("button", { name: "活动", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("combobox", { name: "视图", exact: true })
      .selectOption("locations");
    await page.getByRole("button", { name: /^分组：/ }).click();
    await page
      .getByRole("combobox", { name: "分组", exact: true })
      .selectOption("item");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "完成", exact: true })
      .click();
    await expect(
      main.getByRole("columnheader", { name: "合计", exact: true }),
    ).toBeVisible();
    await expect(
      main.getByRole("columnheader", { name: "批次", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("lifetime activity chips clear stale related-record filters", async ({
  page,
}) => {
  await open(page, "activity-list/active");
  await page.getByRole("button", { name: "秋季法会", exact: true }).click();
  await page
    .getByRole("textbox", { name: "搜索关联记录", exact: true })
    .fill("does-not-exist");
  await page.getByRole("button", { name: /返回上一页/ }).click();
  const card = page.locator(".activity-card").filter({
    has: page.getByRole("button", { name: "秋季法会", exact: true }),
  });
  await card.getByRole("button", { name: /^借出 \d+$/ }).click();
  await expect(
    page.getByRole("textbox", { name: "搜索关联记录", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "流动类型", exact: true }),
  ).toHaveValue("Loan");
  await expect(page.locator(".preview-activities")).toContainText(
    "MAT-STE-2026-00004",
  );
  const recordsTab = page.getByRole("tab", { name: "关联记录", exact: true });
  const loansTab = page.getByRole("tab", { name: "借用结余", exact: true });
  await recordsTab.focus();
  await recordsTab.press("ArrowRight");
  await expect(loansTab).toBeFocused();
  await expect(loansTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("tabpanel", { name: "借用结余", exact: true }),
  ).toBeVisible();
  await loansTab.press("Home");
  await expect(recordsTab).toBeFocused();
});
