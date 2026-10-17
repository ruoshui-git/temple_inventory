import { test, expect } from "./fixtures";

for (const width of [375, 1440])
  test(`themes and intermediate text settings at ${width}px`, async ({
    page,
  }, testInfo) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        requests.push(request.url());
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(
      "/design-preview.html#review/" + encodeURIComponent("reports/inventory"),
    );
    for (const theme of ["jade", "blue", "bronze"])
      for (const scale of [125, 175]) {
        await page.locator(`[data-theme-option="${theme}"]`).click();
        await page
          .getByLabel("文字大小", { exact: true })
          .selectOption(String(scale));
        await expect(
          page.locator(`[data-theme-option="${theme}"]`),
        ).toHaveAttribute("aria-pressed", "true");
        await page
          .getByRole("button", { name: "收起评审选项", exact: true })
          .click();
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath(`theme-${theme}-${width}-${scale}.png`),
        });
        await page
          .getByRole("button", { name: "展开评审选项", exact: true })
          .click();
      }
    expect(requests).toEqual([]);
  });
