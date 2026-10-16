import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  failures.set(page, []);
  page.on("pageerror", (error) => failures.get(page)!.push(error.message));
  page.on("request", (request) => {
    if (/\/api\//.test(request.url()))
      failures.get(page)!.push("Production request: " + request.url());
  });
});
test.afterEach(async ({ page }) => {
  expect(failures.get(page)).toEqual([]);
});
async function open(
  page: Page,
  route = "movement-form/Receive-50",
  density = "balanced",
  textScale = 100,
) {
  await page.goto(
    `/design-preview.html?case=${Date.now()}#review/` +
      (route === "local/receive" ? route : encodeURIComponent(route)),
  );
  await expect(page.locator("#design-preview")).toBeVisible();
  await page.getByLabel("显示密度", { exact: true }).selectOption(density);
  await page
    .getByLabel("文字大小", { exact: true })
    .selectOption(String(textScale));
  await page.getByLabel("入库表单实验方案").selectOption("proposed");
  await page.getByRole("button", { name: "收起评审选项", exact: true }).click();
}
async function geometry(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  for (const selector of [
    ".compact-allocation:visible",
    ".picker-row:visible",
    ".dialog-heading:visible",
    ".dialog-footer:visible",
  ]) {
    const intersections = await page.locator(selector).evaluateAll((rows) =>
      rows.flatMap((row) => {
        const children = [...row.children].filter(
          (child) => getComputedStyle(child).display !== "none",
        );
        return children.flatMap((a, index) =>
          children.slice(index + 1).flatMap((b) => {
            const x = a.getBoundingClientRect(),
              y = b.getBoundingClientRect();
            return x.width &&
              y.width &&
              Math.min(x.right, y.right) - Math.max(x.left, y.left) > 2 &&
              Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 2
              ? [row.className + ": " + a.className + "/" + b.className]
              : [];
          }),
        );
      }),
    );
    expect(intersections).toEqual([]);
  }
}
for (const width of [375, 768, 1024, 1440])
  for (const density of ["compact", "balanced", "spacious"])
    for (const scale of [100, 150, 200]) {
      test(`geometry ${width} ${density} ${scale}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        for (const route of [
          "movement-form/Receive",
          "local/receive",
          "movement-form/Receive-50",
          "movement-form/Receive-50-invalid",
          "movement-form/Transfer",
          "movement-form/Return",
        ]) {
          await open(page, route, density, scale);
          await geometry(page);
          if (route === "movement-form/Return") {
            const choice = page.getByRole("combobox", { name: "关联借用记录" });
            await choice.fill("MAT-STE-2026-00004");
            await page
              .locator(".search-select-menu [role=option]")
              .first()
              .click();
            await page
              .getByRole("button", { name: "加入此借用", exact: true })
              .click();
          }
          const rows = page.locator(
            ".preview-operation-lines:visible [data-line-id]",
          );
          if (route.includes("Receive-50")) await expect(rows).toHaveCount(55);
          if (await rows.count()) {
            const first = rows.first();
            await first
              .getByRole("button", { name: "详情", exact: false })
              .first()
              .click();
            await expect(page.getByRole("dialog")).toBeVisible();
            await geometry(page);
            await page
              .getByRole("button", { name: "单位与换算", exact: true })
              .click();
            await geometry(page);
            await page
              .getByRole("button", { name: "完成详情", exact: true })
              .click();
          }
          await page
            .getByRole("button", { name: "展开工作区", exact: true })
            .click();
          await expect(page.locator(".workspace-expanded")).toBeVisible();
          await geometry(page);
          if (
            [375, 1440].includes(width) &&
            density === "balanced" &&
            [100, 200].includes(scale) &&
            route === "movement-form/Receive-50"
          ) {
            mkdirSync("/tmp/temple-inventory-design-browser/screenshots", {
              recursive: true,
            });
            await rows.first().scrollIntoViewIfNeeded();
            await page.screenshot({
              path: `/tmp/temple-inventory-design-browser/screenshots/workspace-50-${width}-${scale}.png`,
            });
          }
          await page
            .getByRole("button", { name: "收起工作区", exact: true })
            .click();
        }
        await open(page, "movement-form/Receive-50", density, scale);
        await page
          .getByRole("button", { name: "添加物品", exact: true })
          .click();
        await geometry(page);
        if (width === 375 || width === 1440)
          if (density === "balanced" && scale === 200) {
            mkdirSync("/tmp/temple-inventory-design-browser/screenshots", {
              recursive: true,
            });
            await page.screenshot({
              path: `/tmp/temple-inventory-design-browser/screenshots/picker-${width}-200.png`,
              fullPage: false,
            });
          }
      });
    }

test("recorded conversions, failure, discard and complete confirmation", async ({
  page,
}) => {
  await open(page, "movement-form/Receive");
  const row = page
    .locator(".preview-operation-lines:visible [data-line-id]")
    .first();
  await row.getByRole("button", { name: "详情", exact: false }).first().click();
  await page.getByRole("button", { name: "单位与换算", exact: true }).click();
  const editor = page.locator(".preview-conversion-editor");
  await editor.getByRole("button", { name: "新建单位", exact: true }).click();
  await editor.getByLabel("单位名称", { exact: true }).fill("测试箱");
  await editor
    .getByRole("button", { name: "保存并使用单位", exact: true })
    .click();
  await editor.locator('[data-field="conversionFactor"]').fill("10");
  await editor.getByText("预览换算状态", { exact: true }).click();
  await editor.getByLabel("模拟保存失败", { exact: true }).check();
  await editor.getByRole("button", { name: "应用换算", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("保存失败");
  await editor.getByLabel("模拟保存失败", { exact: true }).uncheck();
  await editor.getByRole("button", { name: "应用换算", exact: true }).click();
  await page.getByRole("button", { name: "完成详情", exact: true }).click();
  await expect(row).toContainText("折合 120 袋");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByRole("button", { name: "复核并确认", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("1 测试箱 = 10 袋");
  await page.getByRole("button", { name: "返回检查", exact: true }).click();
  await row.getByRole("button", { name: "详情", exact: false }).first().click();
  await page.getByRole("button", { name: "单位与换算", exact: true }).click();
  await page.locator('[data-field="conversionFactor"]').fill("20");
  await page.getByRole("button", { name: "完成详情", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("尚未应用");
  await page
    .getByRole("button", { name: "放弃换算并关闭", exact: true })
    .click();
  await expect(row).toContainText("折合 120 袋");
});

test("1,000-item picker keeps ordered selection, bounded rows, retry and creation return", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "添加物品", exact: true }).click();
  await page.getByText("预览大型选择器", { exact: true }).click();
  await page
    .getByRole("button", { name: "载入 1,000 种物品", exact: true })
    .click();
  const list = page.locator(".preview-virtual-list.is-virtual");
  expect(await page.locator(".picker-row").count()).toBeLessThan(35);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.locator('[data-picker-code="PICKER-1000-1000"]'),
  ).toBeVisible();
  await page
    .locator('[data-picker-code="PICKER-1000-1000"] input[type=checkbox]')
    .check();
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.getByLabel("搜索物品", { exact: true }).fill("PICKER-1000-0001");
  await page
    .locator('[data-picker-code="PICKER-1000-0001"] input[type=checkbox]')
    .check();
  await page.getByLabel("选择器加载状态").selectOption("error");
  await page.getByRole("button", { name: "重试加载" }).click();
  await page.getByRole("button", { name: "新建物品", exact: true }).click();
  await page
    .getByLabel("物品名称", { exact: true })
    .fill("创建后返回的大型物品");
  await page.getByRole("button", { name: "创建并选中", exact: true }).click();
  await page
    .getByRole("button", { name: "添加所选（3）", exact: true })
    .click();
  const codes = await page
    .locator(
      ".preview-operation-lines:visible [data-line-id] .preview-line-identity small",
    )
    .allTextContents();
  expect(
    codes.filter((code) => /PICKER-1000-|ITM-PREVIEW/.test(code)).join("|"),
  ).toMatch(/PICKER-1000-1000.*PICKER-1000-0001.*ITM-PREVIEW/s);
});

test("phone hidden error reveal, Details focus and resize retention", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await open(page, "movement-form/Receive-50-invalid");
  await page
    .locator(".preview-operation-lines:visible")
    .getByLabel("搜索明细")
    .fill("no-match");
  await page.getByRole("button", { name: /处待完善 · 下一个/ }).click();
  const input = page
    .locator(".preview-operation-lines:visible [data-line-id]")
    .first()
    .locator('[data-field="qty"]');
  await expect(input).toBeFocused();
  await input.fill("3");
  await page.getByRole("button", { name: "展开工作区", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(input).toHaveValue("3");
  await page.getByRole("button", { name: "收起工作区", exact: true }).click();
  mkdirSync("/tmp/temple-inventory-design-browser/screenshots", {
    recursive: true,
  });
  await page.screenshot({
    path: "/tmp/temple-inventory-design-browser/screenshots/editor-desktop.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 375, height: 844 });
  await page.screenshot({
    path: "/tmp/temple-inventory-design-browser/screenshots/editor-phone.png",
    fullPage: false,
  });
});

for (const width of [375, 1440]) {
  test(`allocation editing, scan, summary and save/reopen ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, "movement-form/Receive");
    const editor = page.locator(".preview-operation-lines:visible");
    const row = editor.locator("[data-line-id]").first();
    await row.locator("[data-field=qty]").fill("20");
    await row.getByRole("button", { name: /详情/ }).click();
    await page.getByLabel("批次编号", { exact: true }).fill("BROWSER-BATCH");
    await page
      .getByRole("button", { name: "添加批次分配", exact: true })
      .click();
    await expect(editor.locator("[data-line-id]")).toHaveCount(2);
    const newRow = editor.locator("[data-line-id]").last();
    await newRow.getByRole("button", { name: /详情/ }).click();
    await page.getByLabel("到期日期", { exact: true }).fill("2027-06-01");
    await page.getByRole("button", { name: "完成详情", exact: true }).click();
    await newRow.getByRole("button", { name: /移除.*明细/ }).click();
    await expect(editor.locator("[data-line-id]")).toHaveCount(1);
    await editor.getByText("扫描物品 / 批次 / 库位", { exact: true }).click();
    await editor.getByLabel("扫描值", { exact: true }).fill("ITM-000130");
    await editor.getByRole("button", { name: "查找", exact: true }).click();
    await editor
      .getByRole("button", { name: "配置数量与库位", exact: true })
      .click();
    await expect(editor.locator("[data-line-id]")).toHaveCount(2);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    const originalId = await row.getAttribute("data-line-id");
    const documentName = (await page.locator(".form-record-tag").innerText())
      .split(" · ")[0]!
      .trim();
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("button", { name: /草稿.*继续未完成/ }).click();
    await page
      .getByRole("button", { name: new RegExp(documentName) })
      .first()
      .click();
    await expect(
      page.locator(
        `.preview-operation-lines:visible [data-line-id="${originalId}"] [data-field=qty]`,
      ),
    ).toHaveValue("20");
    await page.getByRole("button", { name: "复核并确认", exact: true }).click();
    await expect(
      page.getByRole("dialog").locator("[data-summary-line-id]"),
    ).toHaveCount(2);
    await expect(page.getByRole("dialog")).toContainText("BROWSER-BATCH");
  });
  test(`fractional conversion, integer rejection and denied writes ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await open(page, "movement-form/Receive");
    await page.getByRole("button", { name: "添加物品", exact: true }).click();
    await page.getByRole("button", { name: "新建物品", exact: true }).click();
    await page.getByLabel("物品名称", { exact: true }).fill("整数库存物品");
    await page.getByRole("button", { name: "创建并选中", exact: true }).click();
    await page
      .getByRole("button", { name: "添加所选（1）", exact: true })
      .click();
    const row = page
      .locator(".preview-operation-lines:visible [data-line-id]")
      .filter({ hasText: "整数库存物品" });
    await row.getByRole("button", { name: /详情/ }).click();
    await page.getByRole("button", { name: "单位与换算", exact: true }).click();
    const editor = page.locator(".preview-conversion-editor");
    await editor.getByRole("button", { name: "新建单位", exact: true }).click();
    await editor.getByLabel("单位名称", { exact: true }).fill("半件包装");
    await editor.getByLabel("只允许整数数量", { exact: true }).uncheck();
    await editor
      .getByRole("button", { name: "保存并使用单位", exact: true })
      .click();
    await editor.locator("[data-field=conversionFactor]").fill("0.5");
    await editor.getByLabel("输入数量（半件包装）", { exact: true }).fill("1");
    await editor.getByRole("button", { name: "应用换算", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("Nos只允许整数");
    await editor.getByLabel("输入数量（半件包装）", { exact: true }).fill("2");
    await editor
      .getByLabel("保存为此物品的常用换算", { exact: true })
      .uncheck();
    await editor.getByText("预览换算状态", { exact: true }).click();
    await editor.getByLabel("允许新建单位", { exact: true }).uncheck();
    await editor.getByLabel("允许更新物品", { exact: true }).uncheck();
    await expect(
      editor.getByRole("button", { name: "新建单位", exact: true }),
    ).toBeDisabled();
    await expect(
      editor.getByLabel("保存为此物品的常用换算", { exact: true }),
    ).toBeDisabled();
    await editor.getByRole("button", { name: "应用换算", exact: true }).click();
    await page.getByRole("button", { name: "完成详情", exact: true }).click();
    await expect(row).toContainText("2 半件包装 · 折合 1 Nos");
  });
}

test("navigation, retained Loan/Return filters, compact reports and independent export format", async ({
  page,
}) => {
  await open(page, "more/index");
  await expect(page.getByRole("button", { name: /盘点调整/ })).toHaveCount(1);
  await page.getByRole("button", { name: /盘点调整/ }).click();
  await expect(
    page.getByRole("heading", { name: "新建盘点", exact: true }),
  ).toBeVisible();
  await open(page, "movement-items/list");
  await expect(page.locator(".browse-kind-tabs button")).toHaveCount(4);
  await page
    .getByRole("button", { name: /筛选/ })
    .filter({ has: page.locator("svg") })
    .first()
    .click();
  await page
    .getByRole("group", { name: "流动类型 · 可多选", exact: true })
    .getByLabel("借出", { exact: true })
    .check();
  await page
    .getByRole("group", { name: "流动类型 · 可多选", exact: true })
    .getByLabel("归还", { exact: true })
    .check();
  await expect(page.locator(".preview-active-filters")).toContainText("借出");
  await expect(page.locator(".preview-active-filters")).toContainText("归还");
  await open(page, "reports/overview");
  const selector = page.getByRole("combobox", { name: "数据集", exact: true });
  await expect(selector.locator("option")).toHaveCount(6);
  await selector.selectOption("expiry");
  await page.getByRole("button", { name: "快速导出", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: "文件格式", exact: true }),
  ).toHaveValue("xlsx");
  await expect(dialog).toContainText("完整结果");
});
