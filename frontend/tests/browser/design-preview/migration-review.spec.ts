import { test, expect, type Page } from "./fixtures";
import { mkdirSync } from "node:fs";
const evidence = "/tmp/temple-review-fixes/screenshots";
async function open(page: Page, route: string, scale = 100) {
  await page.goto(
    `/design-preview.html?review=${Date.now()}#review/${encodeURIComponent(route)}`,
  );
  await page
    .getByLabel("文字大小", { exact: true })
    .selectOption(String(scale));
  await page.getByRole("button", { name: "收起评审选项", exact: true }).click();
  await expect(page.locator(".sample-content")).toBeVisible();
}
async function unobstructed(page: Page) {
  return page.evaluate(() => {
    const field = document.activeElement as HTMLElement;
    if (!field || field === document.body) return false;
    const rect = field.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return !!hit && (hit === field || field.contains(hit));
  });
}
for (const width of [375, 1440])
  for (const scale of [100, 200]) {
    test(`compact Receive and unobstructed supplement focus ${width}/${scale}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await open(page, "movement-form/Receive", scale);
      const editor = page.locator(".preview-form-page:visible");
      await expect(editor.locator(".receive-layout")).toHaveCount(0);
      await expect(
        editor.locator(".form-date-section input[type=date]"),
      ).toBeVisible();
      await expect(editor.locator(".preview-document-actions")).toHaveCount(1);
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({
        path: `${evidence}/receive-default-${width}-${scale}.png`,
        fullPage: true,
      });
      const expand = editor.getByRole("button", {
        name: "展开工作区",
        exact: true,
      });
      await expand.click();
      await expect(editor).toHaveClass(/workspace-expanded/);
      const quantity = editor.locator('[data-field="qty"]').first();
      await quantity.focus();
      await expect.poll(() => unobstructed(page)).toBe(true);
      await page.screenshot({
        path: `${evidence}/receive-expanded-${width}-${scale}.png`,
      });
      await editor
        .getByRole("button", { name: "收起工作区", exact: true })
        .click();
      const supplement = editor.locator(".form-main > details.form-section");
      await expect(supplement.locator("textarea")).not.toBeVisible();
      await supplement.locator("summary").focus();
      await expect.poll(() => unobstructed(page)).toBe(true);
      await page.keyboard.press("Enter");
      await expect(supplement.locator("textarea")).toBeVisible();
      const controls = supplement.locator(
        "input:not([type=file]), textarea, select, button",
      );
      for (let index = 0; index < (await controls.count()); index++) {
        const control = controls.nth(index);
        if (!(await control.isVisible()) || !(await control.isEnabled()))
          continue;
        await control.focus();
        await expect.poll(() => unobstructed(page)).toBe(true);
        await page.keyboard.press("Tab");
        await expect.poll(() => unobstructed(page)).toBe(true);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({
        path: `${evidence}/receive-${width}-${scale}.png`,
      });
    });
    test(`warehouse labels and actions remain readable ${width}/${scale}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await open(page, "warehouses/tree", scale);
      for (let attempt = 0; attempt < 15; attempt++) {
        const toggle = page
          .locator('.warehouse-toggle[aria-expanded="false"]')
          .first();
        if (!(await toggle.count())) break;
        await toggle.click();
      }
      const rows = page.locator(".browse-tree-row");
      await expect(rows.first()).toBeVisible();
      const geometry = await rows.evaluateAll((rows) =>
        rows.map((row) => {
          const label = row
            .querySelector(".browse-grow")!
            .getBoundingClientRect();
          const actions = row
            .querySelector(".warehouse-node-actions")!
            .getBoundingClientRect();
          return {
            width: label.width,
            labelBottom: label.bottom,
            actionTop: actions.top,
          };
        }),
      );
      if (width === 375) {
        expect(Math.min(...geometry.map((row) => row.width))).toBeGreaterThan(
          150,
        );
        expect(
          geometry.every((row) => row.actionTop >= row.labelBottom - 1),
        ).toBe(true);
      }
      await expect(rows.filter({ hasText: "Location" })).toHaveCount(0);
      await rows.last().locator(".browse-grow").click();
      await expect(rows.last().locator(".browse-grow")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      const edit = rows
        .locator(".warehouse-node-actions button")
        .filter({ hasText: "编辑" })
        .first();
      await edit.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "取消", exact: true }).click();
      if (width === 375) {
        const sizes = await rows
          .locator("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.getBoundingClientRect().height),
          );
        expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await rows.last().scrollIntoViewIfNeeded();
      mkdirSync(evidence, { recursive: true });
      await page.screenshot({
        path: `${evidence}/warehouses-${width}-${scale}.png`,
      });
    });
  }
test("short lists stay at the same top alignment as populated lists", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of ["activity-list/active", "drafts/open"]) {
    await open(page, route);
    const initial = await page
      .locator(".sample-breadcrumb")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          el.closest(".sample-content")!.getBoundingClientRect().top,
      );
    expect(initial).toBeLessThan(50);
    const search = page.locator(".sample-content input:visible").first();
    if (await search.count()) {
      await search.fill("NO-MATCH-EMPTY-LIST");
      await expect
        .poll(() =>
          page
            .locator(".sample-breadcrumb")
            .evaluate(
              (el) =>
                el.getBoundingClientRect().top -
                el.closest(".sample-content")!.getBoundingClientRect().top,
            ),
        )
        .toBe(initial);
    }
  }
});
