import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  headerTop,
  openGroupedStock,
  prepare,
  scrollTableBandIntoView,
  stickyToolbarBottom,
  viewports,
} from "./fixtures/stickyTable";

// Single-axis scroll containers are on by default from Chromium 156; the suite's browser is older
// and needs the flag. sticky-table-fallback.spec.ts covers browsers without them.
const singleAxisBrowser = {
  launchOptions: {
    executablePath:
      process.env.CHROMIUM_PATH ||
      (existsSync("/usr/bin/chromium-headless-shell")
        ? "/usr/bin/chromium-headless-shell"
        : undefined),
    args: ["--no-sandbox", "--enable-experimental-web-platform-features"],
  },
};

test.use(singleAxisBrowser);

for (const viewport of viewports) {
  const phone = viewport.name === "phone";

  test(`${viewport.name}: column header sticks flush under the toolbar after a long scroll`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openGroupedStock(page, phone);
    await scrollTableBandIntoView(page);
    await expect
      .poll(async () =>
        Math.abs(
          (await headerTop(page)) - (await stickyToolbarBottom(page, phone)),
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath("header-stuck.png") });
  });

  test(`${viewport.name}: a sideways-scrolled wide table keeps its header stuck and aligned`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openGroupedStock(page, phone);
    await page.addStyleTag({
      content: ".data-table-scroll table { min-width: 1800px !important; }",
    });
    await page.evaluate(() => {
      const table = Array.from(
        document.querySelectorAll<HTMLElement>(".data-table-scroll"),
      ).find((element) => element.offsetParent !== null)!;
      table.scrollLeft = 320;
    });
    await scrollTableBandIntoView(page);
    const aligned = await page.evaluate(() => {
      const table = Array.from(
        document.querySelectorAll<HTMLElement>(".data-table-scroll"),
      ).find((element) => element.offsetParent !== null)!;
      const headCell = table
        .querySelectorAll("thead th")[1]!
        .getBoundingClientRect();
      const bodyRow = table.querySelector(
        "tbody tr[data-browse-row]:not(.data-table-group-row)",
      )!;
      const bodyCell = bodyRow
        .querySelectorAll("td")[1]!
        .getBoundingClientRect();
      return { headLeft: headCell.left, bodyLeft: bodyCell.left };
    });
    expect(Math.abs(aligned.headLeft - aligned.bodyLeft)).toBeLessThanOrEqual(
      1,
    );
    await expect
      .poll(async () =>
        Math.abs(
          (await headerTop(page)) - (await stickyToolbarBottom(page, phone)),
        ),
      )
      .toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath("header-sideways.png") });
  });

  test(`${viewport.name}: a keyboard-focused row is not covered by the sticky layers`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openGroupedStock(page, phone);
    await scrollTableBandIntoView(page);
    const covered = await page.evaluate(() => {
      const table = Array.from(
        document.querySelectorAll<HTMLElement>(".data-table-scroll"),
      ).find((element) => element.offsetParent !== null)!;
      const rows = Array.from(
        table.querySelectorAll<HTMLElement>(
          "tbody tr[data-browse-row]:not(.data-table-group-row)",
        ),
      );
      const target = rows[rows.length - 1]!;
      target.focus();
      const headBottom = table
        .querySelector("thead th")!
        .getBoundingClientRect().bottom;
      return target.getBoundingClientRect().top < headBottom - 1;
    });
    expect(covered).toBe(false);
    await page.screenshot({ path: info.outputPath("row-focus.png") });
  });
}

test("desktop: the condensed toolbar stays within 56px while stuck", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await openGroupedStock(page, false);
  await scrollTableBandIntoView(page);
  await expect(page.locator(".browse-chrome.is-stuck")).toBeVisible();
  const height = await page.evaluate(
    () =>
      document.querySelector(".browse-chrome")!.getBoundingClientRect().height,
  );
  expect(height).toBeLessThanOrEqual(56);
  await page.screenshot({ path: info.outputPath("toolbar-condensed.png") });
});

test("a page with little scroll room keeps its full toolbar instead of flickering", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await page.goto(
    "/inventory/stock?query=%7B%22groupBy%22%3A%5B%22category%22%5D%7D",
  );
  await expect(page.locator("tr.data-table-group-row").first()).toBeVisible();
  // The filter rail is sized from the viewport, which would keep the page's scroll room constant.
  await page.addStyleTag({
    content: ".browse-filter-rail { display: none !important; }",
  });
  // Leave the page 20px of scroll room, less than the toolbar's height.
  const pageHeight = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({ width: 1440, height: pageHeight - 20 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      ),
    )
    .toBe(20);
  await page.mouse.move(700, 150);
  await page.mouse.wheel(0, 30);
  // A condensing toolbar would remove the scroll room and snap the page back to the top.
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.scrollY)).toBe(20);
  await expect(page.locator(".browse-chrome.is-stuck")).toHaveCount(0);
});
