import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const output =
  process.env.DESIGN_PREVIEW_RESULTS || "/tmp/compact-filter-review";
mkdirSync(`${output}/screenshots`, { recursive: true });
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      errors.get(page)!.push(request.url());
  });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

async function open(
  page: Page,
  route: string,
  scale = 100,
  density = "balanced",
) {
  await page.goto("/design-preview.html");
  await page
    .getByLabel("文字大小", { exact: true })
    .selectOption(String(scale));
  await page.getByLabel("显示密度", { exact: true }).selectOption(density);
  await page.getByRole("button", { name: "收起评审选项", exact: true }).click();
  await page.evaluate((route) => {
    location.hash = `#review/${encodeURIComponent(route)}`;
  }, route);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
const dialog = (page: Page) => page.getByRole("dialog");
async function geometry(target: Locator) {
  return target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top + window.scrollY,
      width: rect.width,
      scroll: window.scrollY,
    };
  });
}
async function bounded(page: Page) {
  const box = await dialog(page).boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const done = dialog(page).getByRole("button", { name: "完成", exact: true });
  await expect(done).toBeInViewport();
  expect(
    await done.evaluate((element) => {
      const r = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
      );
    }),
  ).toBe(true);
  const content = dialog(page).locator(".compact-filter-content");
  expect(
    await content.evaluate(
      (element) => element.clientWidth >= element.scrollWidth - 1,
    ),
  ).toBe(true);
}

for (const width of [375, 768, 1024, 1440]) {
  test(`stable filter layouts across density/text preferences at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 900 });
    for (const density of ["compact", "balanced", "spacious"])
      for (const scale of [100, 150, 200])
        for (const [route, resultSelector, label] of [
          [
            "reports/movements",
            ".report-results-heading",
            width < 1024 ? /^筛选/ : /^更多筛选/,
          ],
          [
            "drafts/open",
            ".preview-drafts-table",
            width < 1024 ? /^筛选/ : /^更多筛选/,
          ],
          ["dashboard/overview", ".preview-dashboard-grid", /^总览范围/],
          ["activity-list/active", ".activity-list", /^更多筛选/],
        ] as const) {
          await open(page, route, scale, density);
          const results = page.locator(resultSelector).first();
          await expect(results).toBeAttached();
          // Scope via the unique visible label; some pages have no dedicated surface class.
          const trigger = page.getByRole("button", { name: label }).first();
          await trigger.scrollIntoViewIfNeeded();
          // Let Playwright move the trigger clear of fixed mobile navigation before
          // measuring. That preparatory scroll is not caused by opening the panel.
          await trigger.click({ trial: true });
          const before = await geometry(results);
          await trigger.click();
          await expect(dialog(page)).toBeVisible();
          await bounded(page);
          const during = await geometry(results);
          expect(Math.abs(during.top - before.top)).toBeLessThan(2);
          expect(Math.abs(during.width - before.width)).toBeLessThan(2);
          expect(Math.abs(during.scroll - before.scroll)).toBeLessThan(2);
          if (density === "balanced" && [100, 200].includes(scale))
            await page.screenshot({
              path: `${output}/screenshots/${route.replace("/", "-")}-${width}-${scale}.png`,
            });
          await dialog(page)
            .getByRole("button", { name: "完成", exact: true })
            .click();
          await expect(dialog(page)).toHaveCount(0);
          await expect(trigger).toBeFocused();
          const after = await geometry(results);
          expect(Math.abs(after.scroll - before.scroll)).toBeLessThan(2);
        }
  });
}

test("desktop keyboard entry, nested Escape, panel switching and dismissal", async ({
  page,
}) => {
  await open(page, "reports/movements");
  const category = page.getByRole("button", { name: /^物品类别/ });
  await category.focus();
  await page.keyboard.press("Enter");
  await expect(dialog(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(category).toBeFocused();
  await category.click();
  await dialog(page).getByPlaceholder("搜索类别").fill("食品");
  await page.keyboard.press("Escape");
  await expect(dialog(page).getByPlaceholder("搜索类别")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await category.click();
  await page.getByRole("button", { name: /^流动类型/ }).click();
  await expect(dialog(page)).toHaveCount(1);
  await dialog(page).getByLabel("入库", { exact: true }).check();
  await dialog(page).getByLabel("出库", { exact: true }).check();
  await dialog(page).getByRole("button", { name: "完成", exact: true }).click();
  await page
    .getByRole("button", { name: "移除流动类型：入库", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "移除流动类型：出库", exact: true }),
  ).toBeVisible();
});

test("search options remain usable and results/export share the selected scope", async ({
  page,
}) => {
  await open(page, "reports/movements");
  await page.getByRole("button", { name: "物品", exact: true }).click();
  await dialog(page)
    .getByRole("combobox", { name: "物品", exact: true })
    .fill("ITM-000128");
  await dialog(page).getByRole("option").first().click();
  await dialog(page).getByRole("button", { name: "完成", exact: true }).click();
  await expect(page.getByRole("button", { name: /^移除物品：/ })).toBeVisible();
  await page.getByRole("button", { name: "快速报表", exact: true }).click();
  await expect(dialog(page)).toContainText("ITM-000128");
  await dialog(page)
    .getByRole("combobox", { name: "文件格式", exact: true })
    .selectOption("csv");
  await expect(
    dialog(page).getByRole("combobox", { name: "文件格式", exact: true }),
  ).toHaveValue("csv");
});

test("mobile focus containment, immediate updates, and state across breakpoint changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, "reports/movements");
  const trigger = page.getByRole("button", { name: /^筛选/ });
  await trigger.click();
  await expect(dialog(page)).toBeFocused();
  const done = dialog(page).getByRole("button", { name: "完成", exact: true });
  await done.focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog(page).getByRole("button", { name: "关闭对话框", exact: true }),
  ).toBeFocused();
  await dialog(page).getByLabel("出库", { exact: true }).check();
  await done.click();
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("button", { name: "移除流动类型：出库", exact: true }),
  ).toBeVisible();
  await trigger.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "移除流动类型：出库", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      inert: document.getElementById("design-preview")!.inert,
      overflow: document.body.style.overflow,
    })),
  ).toEqual({ inert: false, overflow: "" });
});

test("short large-text desktop keeps footer and selectors reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 480 });
  await open(page, "reports/activities", 200, "spacious");
  await page.getByRole("button", { name: /^更多筛选/ }).click();
  await bounded(page);
  await dialog(page)
    .getByRole("combobox", { name: "活动类型", exact: true })
    .fill("法");
  await bounded(page);
  await page.screenshot({ path: `${output}/screenshots/short-large-text.png` });
});

for (const width of [375, 1440]) {
  test(`filter inputs and hierarchy targets retain 44px across densities at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const density of ["compact", "balanced", "spacious"]) {
      await open(page, "reports/movements", 100, density);
      await page
        .getByRole("button", { name: width < 1024 ? /^筛选/ : /^物品类别/ })
        .click();
      const sizes = await dialog(page)
        .locator(
          '.compact-filter-content button, .compact-filter-content select, .compact-filter-content input:not([type="checkbox"]):not([type="radio"]), .compact-filter-content .preview-choice-label',
        )
        .evaluateAll((elements) =>
          elements
            .map((element) => ({
              label:
                element.getAttribute("aria-label") ||
                element.textContent?.trim() ||
                element.tagName,
              height: element.getBoundingClientRect().height,
            }))
            .filter((target) => target.height > 0),
        );
      expect(sizes.length).toBeGreaterThan(4);
      for (const target of sizes)
        expect(target.height, target.label).toBeGreaterThanOrEqual(44);
      const toggles = await dialog(page)
        .locator(".tree-toggle")
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().width),
        );
      for (const width of toggles) expect(width).toBeGreaterThanOrEqual(44);
      await bounded(page);
      await page.screenshot({
        path: `${output}/screenshots/targets-${width}-${density}.png`,
      });
    }
  });
}
