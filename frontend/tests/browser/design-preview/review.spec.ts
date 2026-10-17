import { test, expect, type Page, largePicker, failNextCall } from "./fixtures";
import { mkdirSync } from "node:fs";

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
async function open(page: Page, route: string, scale = 100) {
  await page.goto(
    `/design-preview.html?review=${Date.now()}#review/${encodeURIComponent(route)}`,
  );
  await page
    .getByLabel("文字大小", { exact: true })
    .selectOption(String(scale));
  await page.getByRole("button", { name: "收起评审选项", exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  mkdirSync("/tmp/temple-inventory-design-browser/screenshots", {
    recursive: true,
  });
  await page.screenshot({
    path: `/tmp/temple-inventory-design-browser/screenshots/${name}.png`,
  });
}

for (const width of [375, 1440]) {
  test(`virtual keyboard, stock detail return, large text and focus ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "movement-form/Receive", 200);
    await largePicker(page);
    await page.getByRole("button", { name: "添加物品", exact: true }).click();
    const list = page.locator(".preview-virtual-list.is-virtual");
    const first = list.locator('input[type="checkbox"]').first();
    await first.focus();
    await page.keyboard.press("End");
    const last = page.locator('[data-picker-code="PICKER-1000-1000"]');
    await expect(last.locator('input[type="checkbox"]')).toBeFocused();
    await page.keyboard.press("Space");
    await last.getByRole("button", { name: "库存详情" }).click();
    await expect(page.locator(".picker-detail")).toBeFocused();
    await page.getByRole("button", { name: "返回物品列表" }).click();
    await expect(last.getByRole("button", { name: "库存详情" })).toBeFocused();
    await expect(
      last.getByRole("button", { name: "库存详情" }),
    ).toBeInViewport();
    await expect(last.locator('input[type="checkbox"]')).toBeChecked();
    expect(await list.locator(".picker-row").count()).toBeLessThan(35);
    await screenshot(page, `review-virtual-${width}-200`);
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "添加物品", exact: true }),
    ).toBeFocused();
    const row = page
      .locator(".preview-operation-lines:visible [data-line-id]")
      .first();
    await row.getByRole("button", { name: /详情/ }).click();
    const dialog = page.getByRole("dialog");
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "完成详情" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "关闭对话框" }),
    ).toBeFocused();
    await page.getByRole("button", { name: "单位与换算", exact: true }).click();
    const unit = page.getByRole("combobox", { name: "输入单位", exact: true });
    await unit.focus();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(unit).toHaveAttribute("aria-expanded", "false");
    await screenshot(page, `review-conversion-${width}-200`);
    await page.keyboard.press("Escape");
    await expect(row.getByRole("button", { name: /详情/ })).toBeFocused();
  });

  test(`all operation editors and persistent actions ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const kind of [
      "Receive",
      "Issue",
      "Transfer",
      "Loan",
      "Return",
      "Damage",
      "Loss",
      "Repair",
      "Disposal",
    ]) {
      await open(page, `movement-form/${kind}`);
      const editor = page.locator(".preview-operation-lines:visible");
      if (kind === "Return") {
        await page
          .getByRole("combobox", { name: "关联借用记录" })
          .fill("MAT-STE-2026-00004");
        await page.locator(".search-select-menu [role=option]").first().click();
        await page
          .getByRole("button", { name: "加入此借用", exact: true })
          .click();
      }
      if (!(await editor.locator("[data-line-id]").count())) {
        await page
          .getByRole("button", { name: "添加物品", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .locator('input[type="checkbox"][aria-label^="选择"]')
          .first()
          .check();
        await page.getByRole("button", { name: /添加所选/ }).click();
      }
      await expect(editor.locator("[data-line-id]").first()).toBeVisible();
      await page
        .getByRole("button", { name: "展开工作区", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "保存草稿", exact: true }),
      ).toBeInViewport();
      await expect(
        page.getByRole("button", { name: "复核并确认", exact: true }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (["Receive", "Transfer", "Return"].includes(kind))
        await screenshot(page, `review-${kind}-${width}`);
      await page
        .getByRole("button", { name: "收起工作区", exact: true })
        .click();
    }
  });
}

test("Desk row conversion survives reopening and later Item default changes", async ({
  page,
}) => {
  await open(page, "movement-records/completed");
  // Seed a Desk-origin row that has no frontend draft; all editing below uses the UI.
  await page.evaluate(async () => {
    const { reviewSession } =
      await import("/src/design-preview/reviewModel.ts");
    const row = reviewSession.movements.find(
      (row: { name: string }) => row.name === "MAT-STE-2026-00003",
    );
    Object.assign(row, {
      docstatus: 0,
      entryUom: "箱",
      entryQty: 3,
      conversionFactor: 10,
      qty: 30,
    });
    reviewSession.stock.find(
      (item: { code: string }) => item.code === row.code,
    ).alternateUnits = [{ uom: "箱", factor: 20 }];
  });
  await page.evaluate(() => {
    location.hash =
      "#review/" + encodeURIComponent("movement-records/entry-detail");
  });
  await expect(
    page.getByRole("button", { name: "保存草稿", exact: true }),
  ).toBeVisible();
  const row = page
    .locator(".preview-operation-lines:visible [data-line-id]")
    .first();
  await expect(row.locator("[data-field=qty]")).toHaveValue("3");
  await expect(row).toContainText("折合 30");
  await row.getByRole("button", { name: /详情/ }).click();
  await page.getByRole("button", { name: "单位与换算", exact: true }).click();
  const editor = page.locator(".preview-conversion-editor");
  await expect(editor.locator("[data-field=conversionFactor]")).toHaveValue(
    "10",
  );
  await editor.locator("[data-field=conversionFactor]").fill("15");
  await page.evaluate(async () => {
    (
      await import("/src/design-preview/conversionModel.ts")
    ).conversionAccess.staleItem = true;
  });
  await editor
    .getByRole("button", { name: "更新常用换算并应用", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("已被修改");
  await editor
    .getByRole("button", { name: "重新载入常用换算", exact: true })
    .click();
  await expect(editor).toContainText("原换算：1 箱 = 20");
  await editor
    .getByRole("button", { name: "更新常用换算并应用", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "单位与换算", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "完成详情", exact: true }).click();
  await expect(row).toContainText("折合 45");
});

test("Item conversion editor guards cancellation and saves fractional reusable factors", async ({
  page,
}) => {
  await open(page, "item-detail/overview");
  await page.getByText(/计量单位与换算（/).click();
  await page.getByRole("button", { name: "编辑常用换算", exact: true }).click();
  const editor = page.locator(".preview-conversion-editor");
  await editor
    .getByRole("combobox", { name: "输入单位", exact: true })
    .fill("箱");
  await page.getByRole("option", { name: "箱", exact: true }).click();
  await editor.locator("[data-field=conversionFactor]").fill("0.5");
  await page.getByRole("button", { name: "关闭换算", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("尚未保存");
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(editor.locator("[data-field=conversionFactor]")).toHaveValue(
    "0.5",
  );
  await editor
    .getByRole("button", { name: "更新常用换算并应用", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "编辑常用换算", exact: true }),
  ).toBeFocused();
  await expect(
    page.locator("details").filter({ hasText: "计量单位与换算" }),
  ).toContainText("1 箱 = 0.5 袋");
});

test("large flat unit options keep keyboard targets mounted and unknown factors unset", async ({
  page,
}) => {
  await open(page, "movement-form/Receive");
  await page.evaluate(async () => {
    const { reviewSession } =
      await import("/src/design-preview/reviewModel.ts");
    for (let index = 1; index <= 150; index++)
      reviewSession.units.push({ name: `测试包装-${index}`, whole: false });
  });
  await page
    .locator(".preview-operation-lines:visible [data-line-id]")
    .first()
    .getByRole("button", { name: /详情/ })
    .click();
  await page.getByRole("button", { name: "单位与换算", exact: true }).click();
  const unit = page.getByRole("combobox", { name: "输入单位", exact: true });
  await unit.focus();
  await page.keyboard.press("End");
  const option = page.getByRole("option", {
    name: "测试包装-150",
    exact: true,
  });
  await expect(option).toBeInViewport();
  expect(await page.getByRole("option").count()).toBeLessThan(35);
  await expect(unit).toHaveAttribute(
    "aria-activedescendant",
    (await option.getAttribute("id")) || "",
  );
  await page.keyboard.press("Enter");
  await expect(unit).toHaveValue("测试包装-150");
  await expect(page.locator('[data-field="conversionFactor"]')).toHaveValue("");
  await page.getByRole("button", { name: "应用换算", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("换算比例");
});

test("warehouse disclosures retain independent choices while complete totals remain visible", async ({
  page,
}) => {
  await open(page, "movement-form/Receive-50");
  const summary = page.locator(
    ".form-review:visible .preview-allocation-summary",
  );
  const groups = summary.locator("details");
  expect(await groups.count()).toBeGreaterThan(1);
  await expect(groups.locator(":scope[open]")).toHaveCount(0);
  await groups.first().locator("summary").click();
  await expect(groups.first()).toHaveAttribute("open", "");
  await page
    .locator(".preview-operation-lines:visible [data-line-id]")
    .first()
    .locator('[data-field="qty"]')
    .fill("7");
  await expect(groups.first()).toHaveAttribute("open", "");
  await expect(groups.nth(1)).not.toHaveAttribute("open");
  await page.getByRole("button", { name: "复核并确认", exact: true }).click();
  await expect(
    page.getByRole("dialog").locator("[data-summary-line-id]"),
  ).toHaveCount(55);
  await expect(
    page.getByRole("dialog").locator(".preview-allocation-summary details"),
  ).toHaveCount(0);
});
