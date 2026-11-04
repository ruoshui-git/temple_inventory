import { existsSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  headerTop,
  openGroupedStock,
  openNestedStock,
  prepare,
  scrollTableBandIntoView,
  stickyToolbarBottom,
  stuckState,
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

const cellBottom = (row: Element) =>
  row.firstElementChild!.getBoundingClientRect().bottom;

for (const viewport of viewports) {
  test(`${viewport.name}: stuck group rows stay on one line`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openNestedStock(page, viewport.name === "phone");
    await scrollTableBandIntoView(page);
    await expect.poll(async () => (await stuckState(page)).rows.length).toBe(2);
    const { rows } = await stuckState(page);
    for (const row of rows)
      expect(row.bottom - row.top).toBeLessThanOrEqual(50);
  });
}

test("one jump from the top leaves the stuck row flush as the toolbar condenses", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await openGroupedStock(page, false);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator(".browse-chrome.is-stuck")).toHaveCount(0);
  // The header moves up when the toolbar condenses, after the scroll event: no later scroll happens.
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(page.locator(".browse-chrome.is-stuck")).toHaveCount(1);
  await page.waitForTimeout(400);
  const { rows, headerBottom } = await stuckState(page);
  expect(rows).toHaveLength(1);
  expect(Math.abs(rows[0]!.top - headerBottom)).toBeLessThanOrEqual(1);
});

for (const viewport of viewports) {
  const phone = viewport.name === "phone";

  test(`${viewport.name}: a scrolled category sticks flush under the header and names the rows below`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openGroupedStock(page, phone);
    await scrollTableBandIntoView(page);
    await page.evaluate(() => window.scrollBy(0, 900));
    await expect
      .poll(async () => {
        const { rows, headerBottom } = await stuckState(page);
        return rows[0]
          ? Math.abs(rows[0].top - headerBottom)
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(1);
    const state = await stuckState(page);
    expect(state.rows).toHaveLength(1);
    const [category] = state.rows;
    expect(category!.deeper).toBe(false);
    expect(category!.label).toMatch(/^类别\d+$/);
    expect(category!.labelBelow.startsWith(`${category!.label}-`)).toBe(true);
    await page.screenshot({ path: info.outputPath("one-level.png") });
  });

  test(`${viewport.name}: a stuck category and its 物品 stack flush under the header, each naming the rows below`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openNestedStock(page, phone);
    await scrollTableBandIntoView(page);
    await expect
      .poll(async () => {
        const { rows, headerBottom } = await stuckState(page);
        return rows.length === 2
          ? Math.abs(rows[0]!.top - headerBottom)
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThanOrEqual(1);
    const state = await stuckState(page);
    const [category, item] = state.rows;
    expect(category!.deeper).toBe(false);
    expect(item!.deeper).toBe(true);
    expect(item!.label.startsWith(`${category!.label} /`)).toBe(true);
    expect(Math.abs(item!.top - category!.bottom)).toBeLessThanOrEqual(1);
    expect(category!.labelBelow.startsWith(`${category!.label} /`)).toBe(true);
    expect(item!.labelBelow.startsWith(`${item!.label} /`)).toBe(true);
    await page.screenshot({ path: info.outputPath("nested.png") });
  });

  test(`${viewport.name}: scrolling past an expanded category into a collapsed one leaves no stale 物品 row`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    // 类别0 is open with its 物品 and 类别1 stays collapsed. 类别2 and 类别3 are open below so the
    // page has room to scroll the collapsed 类别1 up to the line.
    await openNestedStock(page, phone, { categoryIndexes: [0, 2, 3] });
    await scrollTableBandIntoView(page);
    // A collapsed row is stuck only until the next group arrives, so place it just past the line.
    await page.evaluate(() => {
      const table = Array.from(
        document.querySelectorAll<HTMLElement>(".data-table-scroll"),
      ).find((element) => element.offsetParent !== null)!;
      const row = Array.from(
        table.querySelectorAll("tr.data-table-group-row"),
      ).find(
        (candidate) =>
          candidate.querySelector(".data-table-group-name")?.textContent ===
          "类别1",
      )!;
      const header = table.querySelector("thead th")!.getBoundingClientRect();
      window.scrollBy(0, row.getBoundingClientRect().top - header.bottom + 4);
    });
    await expect
      .poll(async () => (await stuckState(page)).rows.map((row) => row.label))
      .toEqual(["类别1"]);
    const state = await stuckState(page);
    expect(state.rows.some((row) => row.deeper)).toBe(false);
  });

  test(`${viewport.name}: a row focused while scrolling up is not covered by the header or stuck rows`, async ({
    page,
  }, info) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openNestedStock(page, phone, { categoryIndexes: [0] });
    await scrollTableBandIntoView(page);
    await expect.poll(async () => (await stuckState(page)).rows.length).toBe(2);
    // A row the stack partly covers, and the row below it that is fully visible.
    const pair = await page.evaluate(() => {
      const table = Array.from(
        document.querySelectorAll<HTMLElement>(".data-table-scroll"),
      ).find((element) => element.offsetParent !== null)!;
      const cellBottom = (row: Element) =>
        row.firstElementChild!.getBoundingClientRect().bottom;
      const stuck = Array.from(table.querySelectorAll("tr.is-stuck"));
      const stackBottom = Math.max(
        table.querySelector("thead th")!.getBoundingClientRect().bottom,
        ...stuck.map(cellBottom),
      );
      const rows = Array.from(
        table.querySelectorAll<HTMLElement>("tbody tr[data-row-id]"),
      );
      const index = rows.findIndex((row, position) => {
        const box = row.getBoundingClientRect();
        return (
          position + 1 < rows.length &&
          !row.classList.contains("is-stuck") &&
          box.top < stackBottom - 1 &&
          box.bottom > stackBottom + 1
        );
      });
      if (index < 0) throw new Error("no row under the stack to cover");
      return {
        current: rows[index + 1]!.dataset.rowId!,
        previous: rows[index]!.dataset.rowId!,
      };
    });
    await page.locator(`tbody tr[data-row-id="${pair.current}"]`).focus();
    await page.keyboard.press("ArrowUp");
    const after = await page.evaluate((id) => {
      const table = Array.from(
        document.querySelectorAll<HTMLElement>(".data-table-scroll"),
      ).find((element) => element.offsetParent !== null)!;
      const cellBottom = (row: Element) =>
        row.firstElementChild!.getBoundingClientRect().bottom;
      const row = table.querySelector<HTMLElement>(
        `tbody tr[data-row-id="${id}"]`,
      )!;
      const covers = Math.max(
        table.querySelector("thead th")!.getBoundingClientRect().bottom,
        ...Array.from(table.querySelectorAll("tr.is-stuck")).map(cellBottom),
      );
      return {
        focused: document.activeElement?.getAttribute("data-row-id"),
        top: row.getBoundingClientRect().top,
        covers,
      };
    }, pair.previous);
    expect(after.focused).toBe(pair.previous);
    expect(after.top).toBeGreaterThanOrEqual(after.covers - 1);
    await page.screenshot({ path: info.outputPath("focus-up.png") });
  });

  test(`${viewport.name}: clicking a stuck category collapses it and leaves its row at the sticky line`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await prepare(page);
    await openNestedStock(page, phone, { categoryIndexes: [0, 2, 3] });
    await scrollTableBandIntoView(page);
    await expect.poll(async () => (await stuckState(page)).rows.length).toBe(2);
    const label = (await stuckState(page)).rows[0]!.label;
    const id = `category:${label}`;
    await page.locator("tr.is-stuck").first().click();
    // Once collapsed, the row ends up on the sticky line: stuck, or flush as the row at the line.
    await expect
      .poll(() =>
        page.evaluate((rowId) => {
          const table = Array.from(
            document.querySelectorAll<HTMLElement>(".data-table-scroll"),
          ).find((element) => element.offsetParent !== null)!;
          const row = table.querySelector<HTMLElement>(
            `tr[data-row-id="${rowId}"]`,
          )!;
          const header = table
            .querySelector("thead th")!
            .getBoundingClientRect();
          if (row.getAttribute("aria-expanded") !== "false")
            return Number.POSITIVE_INFINITY;
          return Math.abs(
            row.firstElementChild!.getBoundingClientRect().top - header.bottom,
          );
        }, id),
      )
      .toBeLessThanOrEqual(1);
  });
}
