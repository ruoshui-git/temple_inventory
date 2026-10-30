import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const groupShots = "/tmp/codex-runs/group-rows-shots";
mkdirSync(groupShots, { recursive: true });
test.beforeEach(async ({ page }) => {
  test.skip(
    !process.env.NATIVE_ADMIN_PASSWORD,
    "Requires the local development account",
  );
  const response = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(response.ok()).toBe(true);
});

async function settled(page: Page, path: string) {
  await page.goto(path);
  await page.locator("h1").first().waitFor();
  await page.waitForLoadState("networkidle");
}

async function capture(page: Page, name: string, width: number, height = 844) {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll<HTMLElement>("*")) {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    }
  });
  await page.waitForTimeout(350);
  await page.screenshot({
    path: test.info().outputPath(`${name}-${width}.png`),
  });
}

function groupedPath(
  path: string,
  dataset: string,
  view: string,
  groupBy: string[],
) {
  const [base, search = ""] = path.split("?");
  const params = new URLSearchParams(search);
  params.set(
    "view",
    dataset === "movements" && view === "summary" ? "items" : view,
  );
  params.set("query", JSON.stringify({ dataset, view, groupBy }));
  return `${base}?${params.toString()}`;
}

async function captureGroup(page: Page, name: string, width = 1440) {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  await page.screenshot({
    path: join(groupShots, `${name}-${width}.png`),
    fullPage: true,
  });
}

async function assertDesktopGroupLabels(page: Page) {
  const measures = await page
    .locator(".data-table-group-row")
    .evaluateAll((rows) =>
      rows.slice(0, 5).map((row) => {
        const toggle = row.querySelector<HTMLElement>(
          ".data-table-group-toggle",
        );
        const label = row.querySelector<HTMLElement>(".data-table-group-name");
        const rowBounds = row.getBoundingClientRect();
        const toggleBounds = toggle?.getBoundingClientRect();
        return {
          row: {
            left: rowBounds.left,
            right: rowBounds.right,
            top: rowBounds.top,
            bottom: rowBounds.bottom,
          },
          toggle: toggleBounds && {
            left: toggleBounds.left,
            right: toggleBounds.right,
            top: toggleBounds.top,
            bottom: toggleBounds.bottom,
          },
          label: label && {
            clientWidth: label.clientWidth,
            scrollWidth: label.scrollWidth,
          },
          toggleContent: toggle && {
            clientWidth: toggle.clientWidth,
            scrollWidth: toggle.scrollWidth,
          },
        };
      }),
    );
  expect(measures.length).toBeGreaterThan(0);
  for (const measurement of measures) {
    expect(measurement.toggle).toBeTruthy();
    expect(measurement.toggle!.left).toBeGreaterThanOrEqual(
      measurement.row.left - 1,
    );
    expect(measurement.toggle!.right).toBeLessThanOrEqual(
      measurement.row.right + 1,
    );
    expect(measurement.toggle!.top).toBeGreaterThanOrEqual(
      measurement.row.top - 1,
    );
    expect(measurement.toggle!.bottom).toBeLessThanOrEqual(
      measurement.row.bottom + 1,
    );
    expect(measurement.label!.scrollWidth).toBeLessThanOrEqual(
      measurement.label!.clientWidth + 1,
    );
    expect(measurement.toggleContent!.scrollWidth).toBeLessThanOrEqual(
      measurement.toggleContent!.clientWidth + 1,
    );
  }
}

async function assertNoDuplicateGroupLabels(page: Page) {
  const labels = await page
    .locator(".data-table-group-row")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const path = JSON.parse(row.getAttribute("data-row-id") || "[]").slice(
          1,
        );
        const label =
          row.querySelector(".data-table-group-name")?.textContent || "";
        return { path, label };
      }),
    );
  const keys = labels.map(
    ({ path, label }) => `${JSON.stringify(path.slice(0, -1))}:${label}`,
  );
  expect(new Set(keys).size).toBe(keys.length);
}

async function assertSingleLineCells(page: Page) {
  const table = page.locator(".data-table-scroll table").first();
  await expect(table).toBeVisible();
  const rows = await table
    .locator("tbody tr:not(.data-table-group-row)")
    .evaluateAll((elements) =>
      elements.map((row) => {
        const rowHeight = row.getBoundingClientRect().height;
        const cells = Array.from(
          row.querySelectorAll<HTMLTableCellElement>("td"),
        )
          .filter((cell) => !cell.classList.contains("data-column-primary"))
          .map((cell) => ({
            column: cell.className,
            height: cell.getBoundingClientRect().height,
            scrollHeight: cell.scrollHeight,
            children: Array.from(cell.children).map((child) => {
              const element = child as HTMLElement;
              const bounds = element.getBoundingClientRect();
              return {
                class: element.className,
                text: element.innerText,
                height: bounds.height,
                scrollHeight: element.scrollHeight,
                display: getComputedStyle(element).display,
                lineHeight: getComputedStyle(element).lineHeight,
              };
            }),
          }));
        return { rowHeight, cells };
      }),
    );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.rowHeight, JSON.stringify(row)).toBeLessThanOrEqual(60);
    for (const cell of row.cells) {
      expect(cell.height, cell.column).toBeLessThanOrEqual(60);
      expect(cell.scrollHeight, cell.column).toBeLessThanOrEqual(
        cell.height + 1,
      );
    }
  }
}

async function assertChipBaselines(
  page: Page,
  selector: string,
  labelSelector: string,
) {
  const measurements = await page.locator(selector).evaluateAll(
    (chips, labelSelector) =>
      chips.map((chip) => {
        const icon = chip.querySelector<SVGElement>("svg");
        const label = chip.querySelector<HTMLElement>(labelSelector);
        if (!icon || !label) return null;
        return {
          iconTop: icon.getBoundingClientRect().top,
          labelTop: label.getBoundingClientRect().top,
        };
      }),
    labelSelector,
  );
  const present = measurements.filter((measurement) => measurement !== null);
  expect(present.length).toBeGreaterThan(0);
  for (const measurement of present) {
    expect(measurement!.iconTop).toBeGreaterThanOrEqual(
      measurement!.labelTop - 4,
    );
  }
}

test("browse table chips stay single-line and browse pages retain their phone layouts", async ({
  page,
}) => {
  await settled(page, "/inventory/stock");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.locator(".data-table-scroll table").first()).toBeVisible();
  await assertSingleLineCells(page);
  await expect(page.locator(".stock-row-actions button").first()).toBeVisible();
  await assertChipBaselines(
    page,
    "td .detail-popover-trigger",
    ".stock-detail-trigger-label",
  );
  await capture(page, "stock", 1440, 900);
  await capture(page, "stock", 390);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(350);

  let blocked: import("@playwright/test").Route | undefined;
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page*",
    (route) => {
      blocked = route;
    },
  );
  await page
    .locator("input[data-browse-search]")
    .fill("browse layout refresh failure");
  const stockAction = page.locator(".stock-row-actions button").first();
  await expect(stockAction).toBeVisible();
  await expect(stockAction).toBeDisabled();
  expect(blocked).toBeTruthy();
  await blocked!.abort();
  await expect(page.locator(".browse-refresh-notice")).toBeVisible();
  await capture(page, "refresh-failure", 1440, 900);
  await capture(page, "refresh-failure", 390);

  await settled(page, "/inventory/movements?view=records");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "设置列" }).first().click();
  const unitQuantityColumn = page
    .getByRole("group", { name: "设置表格列" })
    .getByRole("checkbox", { name: "库存数量" });
  await unitQuantityColumn.check();
  await page.keyboard.press("Escape");
  await assertSingleLineCells(page);
  await page.getByRole("button", { name: "设置列" }).first().click();
  await page
    .getByRole("group", { name: "设置表格列" })
    .getByRole("checkbox", { name: "库存数量" })
    .uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".record-ref-chip").first()).toBeVisible();
  await assertChipBaselines(
    page,
    "td .record-ref-chip",
    ".record-ref-main > span",
  );
  await capture(page, "movements-records", 1440, 900);
  await capture(page, "movements-records", 390);

  for (const [name, path] of [
    ["loans-items", "/inventory/loans"],
    ["loans-records", "/inventory/loans?view=records"],
    ["expiry", "/inventory/stock/expiry"],
    ["pending", "/inventory/stock/damaged"],
  ] as const) {
    await settled(page, path);
    await capture(page, name, 1440, 900);
    await capture(page, name, 390);
  }

  await settled(page, "/inventory/loans");
  await page.getByRole("button", { name: "借还流动" }).click();
  await expect(page.locator(".record-ref-chip").first()).toBeVisible();
  await capture(page, "loan-history", 1440, 900);
  await capture(page, "loan-history", 390);
});

test("group labels remain visible across browse groupings and phone toggles", async ({
  page,
}) => {
  const matrix = [
    [
      "stock-category",
      "/inventory/stock",
      "inventory",
      "summary",
      ["category"],
    ],
    [
      "stock-category-item",
      "/inventory/stock",
      "inventory",
      "summary",
      ["category", "item"],
    ],
    [
      "warehouses-category",
      "/inventory/stock",
      "inventory",
      "locations",
      ["category"],
    ],
    [
      "warehouses-category-item",
      "/inventory/stock",
      "inventory",
      "locations",
      ["category", "item"],
    ],
    [
      "expiry-category",
      "/inventory/stock/expiry",
      "expiry",
      "batches",
      ["category"],
    ],
    [
      "expiry-category-item",
      "/inventory/stock/expiry",
      "expiry",
      "batches",
      ["category", "item"],
    ],
    [
      "movement-items-item",
      "/inventory/movements?view=items",
      "movements",
      "summary",
      ["item"],
    ],
    [
      "movement-items-category-item",
      "/inventory/movements?view=items",
      "movements",
      "summary",
      ["category", "item"],
    ],
    [
      "movement-record-kind",
      "/inventory/movements?view=records",
      "movements",
      "records",
      ["kind"],
    ],
    [
      "movement-record-kind-status",
      "/inventory/movements?view=records",
      "movements",
      "records",
      ["kind", "status"],
    ],
    ["loan-items-item", "/inventory/loans", "loans", "items", ["item"]],
    [
      "loan-items-category-item",
      "/inventory/loans",
      "loans",
      "items",
      ["category", "item"],
    ],
    [
      "loan-record-borrower",
      "/inventory/loans?view=records",
      "loans",
      "records",
      ["borrower"],
    ],
    [
      "loan-record-borrower-activity",
      "/inventory/loans?view=records",
      "loans",
      "records",
      ["borrower", "activity"],
    ],
    ["counts-kind", "/inventory/counts", "counts", "records", ["kind"]],
    [
      "counts-kind-status",
      "/inventory/counts",
      "counts",
      "records",
      ["kind", "status"],
    ],
  ] as const;

  for (const [name, path, dataset, view, groupBy] of matrix) {
    await settled(page, groupedPath(path, dataset, view, [...groupBy]));
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.locator(".data-table-group-row").first(),
      name,
    ).toBeVisible();
    if (name === "movement-record-kind-status") {
      const summaryCell = page
        .locator(".data-table-group-row")
        .first()
        .locator("td.data-column-number")
        .first();
      await expect(summaryCell).toContainText(/\d/);
    }
    await assertDesktopGroupLabels(page);
    await assertNoDuplicateGroupLabels(page);
    await captureGroup(page, name);
    if (groupBy.length === 2) {
      const groupCount = await page.locator(".data-table-group-row").count();
      await page.locator(".data-table-group-toggle").first().click();
      await expect
        .poll(() =>
          page
            .locator(".data-table-group-row")
            .count()
            .then((count) => count > groupCount),
        )
        .toBe(true);
      await expect
        .poll(() =>
          page.locator(".data-table-group-row").evaluateAll((rows) =>
            rows.some((row) => {
              const id = JSON.parse(row.getAttribute("data-row-id") || "[]");
              return id.length === 3;
            }),
          ),
        )
        .toBe(true);
      await assertDesktopGroupLabels(page);
      await assertNoDuplicateGroupLabels(page);
      await captureGroup(page, `${name}-expanded`);
    }
  }

  await settled(
    page,
    groupedPath("/inventory/movements?view=items", "movements", "summary", [
      "item",
    ]),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".data-table-group-row").first()).toBeVisible();
  await page.getByRole("button", { name: "设置列" }).first().click();
  await page
    .getByRole("group", { name: "设置表格列" })
    .getByRole("checkbox", { name: "物品名称" })
    .uncheck();
  await page.keyboard.press("Escape");
  await expect(page.locator(".data-table-group-row").first()).toBeVisible();
  await assertDesktopGroupLabels(page);
  await captureGroup(page, "movement-item-label-column-hidden");
  await page.getByRole("button", { name: "设置列" }).first().click();
  await page
    .getByRole("group", { name: "设置表格列" })
    .getByRole("checkbox", { name: "物品名称" })
    .check();
  await page.keyboard.press("Escape");

  for (const [name, path, dataset, view] of [
    [
      "movement-phone",
      "/inventory/movements?view=items",
      "movements",
      "summary",
    ],
    ["loan-phone", "/inventory/loans", "loans", "items"],
  ] as const) {
    await settled(page, groupedPath(path, dataset, view, ["item"]));
    await page.setViewportSize({ width: 390, height: 844 });
    const toggle = page
      .locator(".mobile-operation-group-heading .browse-group-trigger")
      .first();
    await expect(toggle).toBeVisible();
    const target = await toggle.boundingBox();
    expect(target?.height).toBeGreaterThanOrEqual(44);
    const rowBounds = await toggle.evaluate((element) => {
      const row = element.closest(".browse-group-heading")!;
      const buttonBounds = element.getBoundingClientRect();
      const rowBounds = row.getBoundingClientRect();
      return {
        left: buttonBounds.left >= rowBounds.left - 1,
        right: buttonBounds.right <= rowBounds.right + 1,
        top: buttonBounds.top >= rowBounds.top - 1,
        bottom: buttonBounds.bottom <= rowBounds.bottom + 1,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    });
    expect(rowBounds).toMatchObject({
      left: true,
      right: true,
      top: true,
      bottom: true,
    });
    expect(rowBounds.scrollWidth).toBeLessThanOrEqual(
      rowBounds.clientWidth + 1,
    );
    const clipping = await toggle
      .locator(".mobile-operation-group-identity strong")
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(clipping).toBeLessThanOrEqual(1);
    // The name block, not empty space around the chevron, fills the toggle.
    const identityShare = await toggle.evaluate(
      (element) =>
        element
          .querySelector(".mobile-operation-group-identity")!
          .getBoundingClientRect().width /
        element.getBoundingClientRect().width,
    );
    expect(identityShare).toBeGreaterThan(0.7);
    await captureGroup(page, `${name}-collapsed`, 390);
    await toggle.click();
    await expect(
      page.getByRole("link", { name: "查看物品" }).first(),
    ).toBeVisible();
    await captureGroup(page, `${name}-expanded`, 390);
  }
});
