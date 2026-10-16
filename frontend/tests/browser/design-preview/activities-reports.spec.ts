import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const output =
  process.env.DESIGN_PREVIEW_RESULTS ||
  "/tmp/temple-inventory-design-browser/activities";
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
  await page.goto(`/design-preview.html?audit=${Date.now()}`);
  await page
    .getByLabel("文字大小", { exact: true })
    .selectOption(String(scale));
  await page.getByLabel("显示密度", { exact: true }).selectOption(density);
  await page.getByRole("button", { name: "收起评审选项", exact: true }).click();
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    `#review/${route.startsWith("local/") ? route : encodeURIComponent(route)}`,
  );
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await page.evaluate(() => document.fonts.ready);
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${output}/screenshots/${name}.png` });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}
for (const width of [375, 1440])
  test(`all preview routes ${width}`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/design-preview.html");
    const routes = await page.evaluate(async () => {
      const { previewPages } =
        await import("/src/design-preview/reviewModel.ts");
      return previewPages.map((row: { key: string }) => row.key);
    });
    for (const route of [
      ...routes,
      "local/gallery",
      "local/inventory",
      "local/receive",
    ]) {
      await open(page, route);
      await noOverflow(page);
      await shot(page, `route-${width}-${route.replaceAll("/", "-")}`);
    }
    writeFileSync(`${output}/routes-${width}.json`, JSON.stringify(routes));
  });
for (const width of [375, 768, 1024, 1440])
  test(`density and text matrix ${width}`, async ({ page }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const density of ["compact", "balanced", "spacious"])
      for (const scale of [100, 150, 200]) {
        await open(page, "activity-list/large", scale, density);
        await noOverflow(page);
        await page
          .getByRole("button", { name: /大型活动 1 ·/ })
          .first()
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toContainText(
          "大型活动",
        );
        await page.getByText("详细备注", { exact: true }).click();
        await noOverflow(page);
        await shot(page, `activity-detail-${width}-${density}-${scale}`);
        await page
          .getByRole("button", { name: "快速导出", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toContainText("ACT-AUDIT");
        await noOverflow(page);
        if (density === "balanced" && scale === 200)
          await shot(page, `activity-export-${width}-200`);
        await page.getByRole("button", { name: "取消", exact: true }).click();
        await page.getByRole("button", { name: "编辑", exact: true }).click();
        await expect(
          page.getByRole("textbox", { name: "详细备注" }),
        ).toHaveValue(/第一段/);
        await noOverflow(page);
        await open(page, "reports/inventory", scale, density);
        await page
          .getByRole("combobox", { name: "视图", exact: true })
          .selectOption("historical");
        await expect(page.locator(".report-table-wrap").first()).toContainText(
          "117",
        );
        await noOverflow(page);
        if (density === "balanced") {
          await page
            .locator(".report-table-wrap")
            .first()
            .scrollIntoViewIfNeeded();
          await shot(page, `historical-${width}-${scale}`);
        }
      }
  });
test("activity lifecycle, stable title references, retired type and preserved list return", async ({
  page,
}) => {
  await open(page, "activity-list/active");
  await page
    .getByRole("textbox", { name: "搜索活动", exact: true })
    .fill("秋季法会");
  await page.getByRole("button", { name: "秋季法会", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page
    .getByRole("textbox", { name: "名称 *", exact: true })
    .fill("修改后的法会名称");
  const notes = "第一段\n第二行\n\n<script>此处作为文本</script>";
  await page
    .getByRole("textbox", { name: "详细备注", exact: true })
    .fill(notes);
  await page.getByRole("button", { name: "保存活动", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "修改后的法会名称",
  );
  await page.getByText("详细备注", { exact: true }).click();
  await expect(page.locator(".activity-notes")).toHaveText(notes);
  await page.getByText("更多操作", { exact: true }).click();
  await page.getByRole("button", { name: "删除活动", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("关联记录");
  await page.getByRole("button", { name: "归档活动", exact: true }).click();
  await expect(page.locator(".preview-activities")).toContainText("已归档");
  await page.getByRole("button", { name: "恢复活动", exact: true }).click();
  await page.getByRole("button", { name: "返回上一页", exact: false }).click();
  await expect(
    page.getByRole("textbox", { name: "搜索活动", exact: true }),
  ).toHaveValue("秋季法会");
});
test("quick report failure, independent choices, full report scope and no production calls", async ({
  page,
}) => {
  await open(page, "movement-items/list");
  await page.getByRole("button", { name: "快速导出", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "文件格式", exact: true }),
  ).toHaveValue("xlsx");
  await dialog
    .getByRole("combobox", { name: "预览表", exact: true })
    .selectOption("lines");
  await dialog
    .getByRole("combobox", { name: "文件格式", exact: true })
    .selectOption("csv");
  await dialog.getByText("预览失败状态", { exact: true }).click();
  await dialog.getByLabel("下次模拟生成失败", { exact: true }).check();
  await dialog.getByRole("button", { name: "模拟生成", exact: true }).click();
  await expect(dialog).toContainText("选择已保留");
  await expect(
    dialog.getByRole("combobox", { name: "CSV 导出表", exact: true }),
  ).toHaveValue("lines");
  await dialog
    .getByRole("button", { name: "打开导出页面", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "数据集", exact: true }),
  ).toHaveValue("movements");
  await noOverflow(page);
});

for (const width of [375, 1440])
  test(`audit repairs, information states and history drill-through ${width}`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    await open(page, "movement-records/completed");
    await expect(
      page.getByRole("button", { name: "快速导出", exact: true }),
    ).toHaveCount(1);
    await shot(page, `repaired-movement-heading-${width}`);
    await open(page, "loan-records/detail");
    await expect(
      page.getByRole("button", { name: "快速导出", exact: true }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "快速导出", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("MAT-STE-2026-00004");
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await open(page, "drafts/open");
    await page.locator(".preview-drafts-table").scrollIntoViewIfNeeded();
    await expect(
      page.locator(".preview-drafts-table tbody tr").first(),
    ).toContainText("MAT-STE");
    expect(
      await page
        .locator(".preview-drafts-table td")
        .first()
        .evaluate((node) => node.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(220);
    await noOverflow(page);
    await shot(page, `repaired-drafts-${width}`);
    await open(page, "activity-list/active");
    await page
      .getByRole("textbox", { name: "搜索活动", exact: true })
      .fill("没有这个活动");
    await page
      .getByText("没有符合条件的活动。可清空筛选或新建活动。", { exact: true })
      .scrollIntoViewIfNeeded();
    await shot(page, `activities-empty-${width}`);
    await page.getByRole("button", { name: "清空筛选", exact: true }).click();
    await page
      .locator(".preview-activities > details")
      .getByText("预览状态", { exact: true })
      .click();
    await page
      .getByRole("combobox", { name: "列表状态", exact: true })
      .selectOption("loading");
    await page
      .getByText("正在加载活动…", { exact: true })
      .scrollIntoViewIfNeeded();
    await shot(page, `activities-loading-${width}`);
    await page
      .getByRole("combobox", { name: "列表状态", exact: true })
      .selectOption("error");
    await page.getByRole("alert").scrollIntoViewIfNeeded();
    await shot(page, `activities-error-${width}`);
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await open(page, "movement-form/Receive");
    await page.evaluate(async () => {
      const { reviewSession } =
        await import("/src/design-preview/reviewModel.ts");
      reviewSession.drafts.find(
        (row: { kind: string }) => row.kind === "Receive",
      ).status = "completed";
    });
    await expect(page.locator(".preview-document-display")).toBeVisible();
    await expect(
      page.locator(
        ".preview-document-display input,.preview-document-display select,.preview-document-display textarea",
      ),
    ).toHaveCount(0);
    await page.locator(".preview-document-display").scrollIntoViewIfNeeded();
    await shot(page, `completed-display-${width}`);
    await open(page, "reports/inventory");
    await page
      .getByRole("combobox", { name: "视图", exact: true })
      .selectOption("historical");
    await page.locator(".report-table-wrap").first().scrollIntoViewIfNeeded();
    await shot(page, `historical-table-${width}`);
    await page.getByText("贡献单据 · 6", { exact: true }).click();
    await page
      .getByRole("button", { name: "查看 HIST-TRANSFER", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("LED-2");
    await expect(page.getByRole("dialog")).toContainText("LED-3");
    await shot(page, `historical-drill-${width}`);
    await noOverflow(page);
  });

test("named report views and relative/custom settings stay session local", async ({
  page,
}) => {
  await open(page, "reports/movements");
  await page.getByRole("textbox", { name: "搜索", exact: true }).fill("米");
  await page.getByRole("button", { name: /^个人命名视图/ }).click();
  await page
    .getByRole("textbox", { name: "视图名称", exact: true })
    .fill("本次米粮流动");
  await page.getByRole("button", { name: "保存视图", exact: true }).click();
  await page
    .getByRole("combobox", { name: "数据集", exact: true })
    .selectOption("activities");
  await page.getByRole("button", { name: /^个人命名视图/ }).click();
  await page
    .getByRole("combobox", { name: "已保存视图", exact: true })
    .selectOption({ label: "本次米粮流动" });
  await expect(
    page.getByRole("combobox", { name: "数据集", exact: true }),
  ).toHaveValue("movements");
  await expect(
    page.getByRole("textbox", { name: "搜索", exact: true }),
  ).toHaveValue("米");
  await page.getByRole("button", { name: /^个人命名视图/ }).click();
  await page
    .getByRole("textbox", { name: "视图名称", exact: true })
    .fill("米粮记录");
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "已保存视图", exact: true }),
  ).toContainText("米粮记录");
  await page.getByRole("button", { name: "删除视图", exact: true }).click();
  await expect(
    page
      .getByRole("combobox", { name: "已保存视图", exact: true })
      .locator("option"),
  ).toHaveCount(1);
});

test("activity links carry immutable IDs and reopen the intended fixture", async ({
  page,
}) => {
  await open(page, "activity-list/active");
  await page.getByRole("button", { name: "日常供餐", exact: true }).click();
  await expect(page).toHaveURL(/activity-detail%2FACT-0002/);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("日常供餐");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page).toHaveURL(/activity-form%2Fedit-ACT-0002/);
  await expect(
    page.getByRole("textbox", { name: "名称 *", exact: true }),
  ).toHaveValue("日常供餐");
});
