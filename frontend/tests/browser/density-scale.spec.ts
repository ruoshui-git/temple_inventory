import { expect, test, type Page } from "@playwright/test";
import { fullNativeCapabilities, nativeUiSession } from "./fixtures/nativeUi";

const stops = ["xcompact", "compact", "balanced", "spacious"] as const;
const pages = [
  ["库存", "/inventory/stock"],
  ["效期", "/inventory/stock/expiry"],
  ["仓库", "/inventory/stock/warehouses"],
  ["分类", "/inventory/stock/categories"],
  ["单位", "/inventory/stock/units"],
  ["损坏待处理", "/inventory/stock/damaged"],
  ["货物流动", "/inventory/movements"],
  ["借用", "/inventory/loans"],
  ["盘点记录", "/inventory/counts"],
  ["活动", "/inventory/activities"],
  ["活动类型", "/inventory/activities/types"],
  ["草稿", "/inventory/drafts"],
  ["报表", "/inventory/reports"],
] as const;

async function fixture(page: Page) {
  await nativeUiSession(page, 100, {
    capabilities: fullNativeCapabilities,
    operations: { Receive: true, Issue: true, Transfer: true, Loan: true },
  });
  await page.route("**/api/method/temple_inventory.**", async (route) => {
    const method = new URL(route.request().url()).pathname
      .split(".")
      .slice(-2)
      .join(".");
    if (
      [
        "session.info",
        "configuration.status",
        "browse.bootstrap",
        "warehouses.tree",
        "catalog.item_lifecycle",
        "native_api.load_document",
      ].includes(method)
    ) {
      await route.fallback();
      return;
    }
    const args = route.request().postDataJSON() || {};
    const rows = Array.from({ length: 8 }, (_, index) => ({
      id: `ROW-${index}`,
      code: `ITEM-${index}`,
      item_code: `ITEM-${index}`,
      item_name: `示例库存物品${index}`,
      name: `示例库存物品${index}`,
      category: "用品",
      uom: "件",
      stock_uom: "件",
      available: 12,
      loaned: 1,
      damaged: 0,
      tracksBatch: false,
      tracksExpiry: false,
      image: "",
      locations: [],
      date: "2026-11-09",
      modified: "2026-11-03 10:00:00",
      document: `MAT-${index}`,
      doctype: "Stock Entry",
      docstatus: 0,
      kind: "Receive",
      status: "草稿",
      summary: "示例记录",
      quantity: 12,
      stock_qty: 12,
      whole: { branches: [], item_count: 1 },
    }));
    let message: unknown = {
      rows,
      matched_count: rows.length,
      next_start: null,
      snapshot: "2026-11-09 10:00:00",
      query: args.query || {},
      summary: [],
      analysis: {},
    };
    if (method.endsWith("inventory_page")) {
      message = {
        ...(message as object),
        rows: rows.map((row) => ({
          ...row,
          available: 12,
          loaned: 1,
          damaged: 0,
        })),
      };
    } else if (method.endsWith("expiry_page")) {
      message = {
        ...(message as object),
        rows: rows.map((row) => ({
          ...row,
          batch_no: `B-${row.id}`,
          expiry_date: "2026-12-01",
          remaining_days: 22,
        })),
      };
    } else if (
      method.endsWith("operation_page") ||
      method.endsWith("counts_page") ||
      method.endsWith("native_drafts")
    ) {
      message = { ...(message as object), rows };
    } else if (method.endsWith("report_page")) {
      message = {
        ...(message as object),
        rows,
        columns: ["item_name", "available"],
        table: "summary",
        period: { key: "all", date_from: "", date_to: "" },
        tables: [{ id: "summary", label: "库存汇总", count: rows.length }],
      };
    }
    await route.fulfill({ json: { message } });
  });
}

async function noPageOverflow(page: Page, label = "") {
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (widths.document > widths.viewport)
    Object.assign(widths, {
      chipAncestors: await page
        .locator(".browse-active-chip")
        .first()
        .evaluate((chip) => {
          const ancestors = [];
          let node: HTMLElement | null = chip as HTMLElement;
          while (node && ancestors.length < 8) {
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            ancestors.push({
              tag: node.tagName,
              class: node.className,
              left: box.left,
              right: box.right,
              width: box.width,
              minWidth: style.minWidth,
              overflowX: style.overflowX,
              display: style.display,
              gridColumns: style.gridTemplateColumns,
            });
            node = node.parentElement;
          }
          return ancestors;
        })
        .catch(() => []),
      overflowing: await page.locator("body *").evaluateAll((elements) =>
        elements
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              class: (element as HTMLElement).className,
              text: (element as HTMLElement).innerText?.slice(0, 80),
              left: box.left,
              right: box.right,
              width: box.width,
              overflow: getComputedStyle(element).overflow,
            };
          })
          .filter(
            (element) =>
              element.right > document.documentElement.clientWidth + 1,
          )
          .slice(0, 12),
      ),
    });
  expect(
    widths.document,
    `${label} ${JSON.stringify(widths)}`,
  ).toBeLessThanOrEqual(widths.viewport);
  expect(widths.body, `${label} ${JSON.stringify(widths)}`).toBeLessThanOrEqual(
    widths.viewport,
  );
}

for (const viewport of [
  { width: 1440, height: 900, phone: false },
  { width: 1024, height: 768, phone: false },
  { width: 390, height: 844, phone: true },
]) {
  test(`density scale geometry ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await fixture(page);
    for (const [label, path] of pages) {
      await page.goto(path);
      await expect(page.locator("main").first()).toBeVisible();
      if (viewport.phone && label === "盘点记录")
        await expect(
          page
            .locator(".native-record-row-list > .browse-card-item--row")
            .first(),
        ).toBeVisible();
      const orderMeasurements: { height: number; top: number }[] = [];
      const densityRowMeasurements: number[] = [];
      for (const density of stops) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.tiDensity = value),
          density,
        );
        await noPageOverflow(page);
        if (viewport.phone) {
          const undersized = await page
            .locator(
              "button:visible, input:visible:not([type=radio]):not([type=checkbox]), select:visible, [role=tab]:visible, [aria-haspopup]:visible, label:visible:has(input[type=radio]), label:visible:has(input[type=checkbox])",
            )
            .evaluateAll((items) =>
              items
                .filter(
                  (el) =>
                    !(el as HTMLElement).matches(".card-fields-more") &&
                    (el as HTMLElement).getBoundingClientRect().height < 43.5,
                )
                .map((el) => ({
                  tag: el.tagName,
                  label:
                    (el as HTMLElement).innerText ||
                    (el as HTMLInputElement).ariaLabel,
                  height: (el as HTMLElement).getBoundingClientRect().height,
                })),
            );
          expect(undersized, `${label} ${density}`).toEqual([]);
          const moreButtons = page.locator(".card-fields-more:visible");
          for (const button of await moreButtons.all()) {
            const hitArea = await button.evaluate((element) => {
              const after = getComputedStyle(element, "::after");
              return {
                width: parseFloat(after.width),
                height: parseFloat(after.height),
              };
            });
            expect(hitArea.width).toBeGreaterThanOrEqual(44);
            expect(hitArea.height).toBeGreaterThanOrEqual(44);
          }
          if (label === "库存") {
            const itemRows = page.locator(".stock-list-row");
            if (await itemRows.count()) {
              const heights = await itemRows.evaluateAll((items) =>
                items.map((row) => row.getBoundingClientRect().height),
              );
              expect(heights[0]).toBeGreaterThanOrEqual(44);
              if (density === "xcompact")
                expect(heights[0]).toBeLessThanOrEqual(64);
              if (density === "balanced") {
                expect(
                  heights[0],
                  "balanced phone stock row height",
                ).toBeGreaterThanOrEqual(100);
                expect(
                  heights[0],
                  "balanced phone stock row height",
                ).toBeLessThanOrEqual(112);
                console.log(`库存 phone balanced row height: ${heights[0]}`);
                const row = itemRows.first();
                const [image, name, meta] = await Promise.all([
                  row.locator(".stock-list-image").boundingBox(),
                  row.locator(".stock-list-name").boundingBox(),
                  row.locator(".card-fields-inline-text").boundingBox(),
                ]);
                expect(image).not.toBeNull();
                expect(name).not.toBeNull();
                expect(meta).not.toBeNull();
                expect(name!.y).toBeLessThan(image!.y + image!.height);
                expect(meta!.y).toBeGreaterThanOrEqual(
                  name!.y + name!.height - 1,
                );
              }
              if (density === "spacious") {
                expect(
                  heights[0],
                  "spacious phone stock row height",
                ).toBeGreaterThanOrEqual(114);
                expect(
                  heights[0],
                  "spacious phone stock row height",
                ).toBeLessThanOrEqual(126);
                console.log(`库存 phone spacious row height: ${heights[0]}`);
                const row = itemRows.first();
                const [image, name, meta] = await Promise.all([
                  row.locator(".stock-list-image").boundingBox(),
                  row.locator(".stock-list-name").boundingBox(),
                  row.locator(".card-fields-inline-text").boundingBox(),
                ]);
                expect(image).not.toBeNull();
                expect(name).not.toBeNull();
                expect(meta).not.toBeNull();
                expect(name!.y).toBeLessThan(image!.y + image!.height);
                expect(meta!.y).toBeGreaterThanOrEqual(
                  name!.y + name!.height - 1,
                );
              }
            }
          }
        } else {
          const rows = page.locator(
            ".data-table-scroll tbody tr[data-browse-row]:not(.data-table-group-row)",
          );
          if (density === "xcompact" && (await rows.count())) {
            const rowHeight = await rows
              .first()
              .evaluate((row) => row.getBoundingClientRect().height);
            if (
              label !== "活动类型" &&
              label !== "分类" &&
              label !== "单位" &&
              label !== "仓库"
            )
              expect(rowHeight).toBeLessThanOrEqual(30.5);
          }
          if (viewport.width === 1440 && label === "草稿") {
            const row = page.locator(".draft-entry").first();
            await expect(row).toBeVisible();
            const rowHeight = await row.evaluate(
              (element) => element.getBoundingClientRect().height,
            );
            densityRowMeasurements.push(rowHeight);
            if (density === "xcompact") {
              expect(
                rowHeight,
                "草稿 xcompact row height",
              ).toBeGreaterThanOrEqual(30);
              expect(rowHeight).toBeLessThanOrEqual(32);
            }
            if (density === "compact") {
              expect(
                rowHeight,
                "草稿 compact row height",
              ).toBeGreaterThanOrEqual(36);
              expect(rowHeight).toBeLessThanOrEqual(38);
            }
            if (density === "balanced") {
              expect(rowHeight).toBeGreaterThanOrEqual(54);
              expect(rowHeight).toBeLessThanOrEqual(58);
            }
            if (density === "spacious") {
              expect(rowHeight).toBeGreaterThanOrEqual(68);
              expect(rowHeight).toBeLessThanOrEqual(72);
            }
            if (density === "xcompact" || density === "compact") {
              const summary = row.locator(".draft-entry-meta > span");
              const time = row.locator(".draft-entry-meta time");
              const [summaryBox, timeBox] = await Promise.all([
                summary.boundingBox(),
                time.boundingBox(),
              ]);
              expect(summaryBox).not.toBeNull();
              expect(timeBox).not.toBeNull();
              expect(timeBox!.y).toBeLessThan(
                summaryBox!.y + summaryBox!.height,
              );
              expect(timeBox!.y + timeBox!.height).toBeGreaterThan(
                summaryBox!.y,
              );
              const controlHeights = await row
                .locator(
                  ".draft-entry-heading .draft-type-tag, .browse-row-actions .ui-button",
                )
                .evaluateAll((elements) =>
                  elements.map(
                    (element) =>
                      (element as HTMLElement).getBoundingClientRect().height,
                  ),
                );
              expect(controlHeights.length).toBeGreaterThan(0);
              for (const height of controlHeights)
                expect(height).toBeCloseTo(density === "xcompact" ? 20 : 24, 0);
              const actions = row.locator(":scope > .browse-row-actions");
              await expect(actions).toBeVisible();
              expect(
                await actions.evaluate(
                  (element) => getComputedStyle(element).columnGap,
                ),
              ).toBe("4px");
              const buttons = await actions
                .locator(".ui-button")
                .evaluateAll((elements) =>
                  elements.map((element) => {
                    const box = element.getBoundingClientRect();
                    return { left: box.left, right: box.right };
                  }),
                );
              expect(buttons).toHaveLength(2);
              expect(buttons[1].left - buttons[0].right).toBeCloseTo(4, 0);
            }
          }
          if (viewport.width === 1440 && label === "仓库") {
            const row = page.locator(".browse-tree-row").first();
            await expect(row).toBeVisible();
            const rowHeight = await row.evaluate(
              (element) => element.getBoundingClientRect().height,
            );
            densityRowMeasurements.push(rowHeight);
            if (density === "xcompact") {
              expect(
                rowHeight,
                "仓库 xcompact row height",
              ).toBeGreaterThanOrEqual(26);
              expect(rowHeight).toBeLessThanOrEqual(28);
            }
            const indentation = await page
              .locator(".browse-tree-row")
              .evaluateAll((rows) =>
                rows.map((element) => {
                  const row = element as HTMLElement;
                  return {
                    depth:
                      Number.parseFloat(
                        row.style.getPropertyValue("--tree-depth"),
                      ) || 0,
                    padding: Number.parseFloat(
                      getComputedStyle(row).paddingLeft,
                    ),
                  };
                }),
              );
            const rootPadding = indentation.find(
              (entry) => entry.depth === 0,
            )?.padding;
            const nested = indentation.filter((entry) => entry.depth > 0);
            expect(rootPadding).toBeDefined();
            expect(nested.length).toBeGreaterThan(0);
            for (const entry of nested)
              expect(entry.padding - rootPadding!).toBe(entry.depth * 10);
            if (density === "compact") {
              expect(
                rowHeight,
                "仓库 compact row height",
              ).toBeGreaterThanOrEqual(31);
              expect(rowHeight).toBeLessThanOrEqual(33);
            }
            if (density === "xcompact" || density === "compact") {
              await expect(row.locator(".browse-grow strong")).toBeVisible();
              const name = row.locator(".browse-grow strong");
              const type = row.locator(".browse-grow small");
              const boxes = await Promise.all([
                name.boundingBox(),
                type.boundingBox(),
              ]);
              expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y);
              expect(boxes[1]!.y).toBeLessThan(boxes[0]!.y + boxes[0]!.height);
            }
          }
        }
        if (["库存", "货物流动", "盘点记录", "草稿"].includes(label)) {
          const firstRow = page
            .locator(
              viewport.phone
                ? ".browse-card-item--row[data-browse-row]"
                : ".data-table-scroll tbody tr[data-browse-row]:not(.data-table-group-row)",
            )
            .first();
          if (await firstRow.count()) {
            const box = await firstRow.boundingBox();
            if (box) orderMeasurements.push({ height: box.height, top: box.y });
          }
        }
        if (
          viewport.phone &&
          ["活动", "草稿", "货物流动", "借用", "盘点记录"].includes(label)
        ) {
          const row = page
            .locator(".browse-card-item--row[data-browse-row]")
            .first();
          if (await row.count()) {
            const rowHeight = await row.evaluate(
              (element) => element.getBoundingClientRect().height,
            );
            const targetRange = {
              xcompact: [49, 55],
              compact: [61, 67],
              balanced: [79, 87],
              spacious: [92, 100],
            }[density];
            expect(
              rowHeight,
              `${label} ${density} phone document row height`,
            ).toBeGreaterThanOrEqual(targetRange[0]);
            expect(
              rowHeight,
              `${label} ${density} phone document row height`,
            ).toBeLessThanOrEqual(targetRange[1]);
            if (label === "盘点记录" && density === "xcompact")
              console.log(`盘点记录 phone xcompact row height: ${rowHeight}`);
            if (label === "盘点记录" && density === "compact")
              console.log(`盘点记录 phone compact row height: ${rowHeight}`);
            if (["xcompact", "compact"].includes(density)) {
              const fields = row.locator(".card-fields-inline");
              await expect(
                fields,
                `${label} has a visible field line`,
              ).toBeVisible();
              const pairs = fields.locator(".card-field-inline");
              const pairWidths = await pairs.evaluateAll((elements) =>
                elements.map((element) => {
                  const pair = element as HTMLElement;
                  const label =
                    pair.querySelector<HTMLElement>(".card-field-label")!;
                  const canvas = document.createElement("canvas");
                  const context = canvas.getContext("2d")!;
                  context.font = getComputedStyle(pair).font;
                  const twoCharacters = context.measureText("00").width;
                  return {
                    pair: pair.getBoundingClientRect().width,
                    label: label.getBoundingClientRect().width,
                    twoCharacters,
                    labelFullyVisible:
                      label.scrollWidth <= label.clientWidth + 1,
                    isBare: pair.classList.contains("is-bare"),
                  };
                }),
              );
              expect(pairWidths.length, `${label} field pairs`).toBeGreaterThan(
                0,
              );
              for (const width of pairWidths)
                expect(width.pair).toBeGreaterThanOrEqual(
                  width.label + width.twoCharacters - 1,
                );
              for (const width of pairWidths)
                expect(
                  width.isBare || width.labelFullyVisible,
                  `${label} field label is readable`,
                ).toBe(true);
              // Whether +N appears depends on font metrics; when every field
              // fits there is none, so the line itself must not be clipped.
              const more = fields.locator(".card-fields-more");
              if (!(await more.count())) {
                const clipped = await fields
                  .locator(".card-fields-inline-text")
                  .evaluate((line) => line.scrollWidth > line.clientWidth + 1);
                expect(clipped, `${label} fields fit without +N`).toBe(false);
              } else {
                await expect(
                  more,
                  `${label} +N affordance on line 2`,
                ).toBeVisible();
                const [lineBox, moreBox] = await Promise.all([
                  fields.locator(".card-fields-inline-text").boundingBox(),
                  more.boundingBox(),
                ]);
                expect(lineBox).not.toBeNull();
                expect(moreBox).not.toBeNull();
                expect(moreBox!.y).toBeLessThan(lineBox!.y + lineBox!.height);
                expect(moreBox!.y + moreBox!.height).toBeGreaterThan(
                  lineBox!.y,
                );
              }
            }
          }
        }
        const firstTableRow = page
          .locator(
            ".data-table-scroll tbody tr[data-browse-row]:not(.data-table-group-row)",
          )
          .first();
        if (await firstTableRow.count()) {
          const spill = await firstTableRow.evaluate((row) => {
            const rowBox = row.getBoundingClientRect();
            return [...row.querySelectorAll("td")].flatMap((cell) => {
              const cellBox = cell.getBoundingClientRect();
              const range = document.createRange();
              const walker = document.createTreeWalker(
                cell,
                NodeFilter.SHOW_TEXT,
              );
              const bad: string[] = [];
              while (walker.nextNode()) {
                if (
                  walker.currentNode.parentElement?.closest(
                    ".sr-only, [aria-hidden='true']",
                  )
                )
                  continue;
                range.selectNode(walker.currentNode!);
                for (const textBox of [...range.getClientRects()]) {
                  if (
                    textBox.left < cellBox.left - 1 ||
                    textBox.right > cellBox.right + 1
                  )
                    bad.push(walker.currentNode!.textContent || "");
                }
              }
              for (const el of [...cell.querySelectorAll("*")]) {
                const box = el.getBoundingClientRect();
                if (
                  getComputedStyle(el).overflow === "visible" &&
                  box.bottom > rowBox.bottom + 1
                )
                  bad.push(el.textContent || "");
              }
              return bad;
            });
          });
          expect(
            spill,
            `${label} ${density} text spills from first row`,
          ).toEqual([]);
        }
        const firstCardRow = page
          .locator(".browse-card-item--row[data-browse-row]")
          .first();
        if (viewport.phone && (await firstCardRow.count())) {
          const spill = await firstCardRow.evaluate((row) => {
            const rowBox = row.getBoundingClientRect();
            const range = document.createRange();
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            const bad: {
              text: string;
              left: number;
              right: number;
              top: number;
              bottom: number;
              parent: string;
            }[] = [];
            while (walker.nextNode()) {
              const node = walker.currentNode as Text;
              if (node.parentElement?.closest(".sr-only, [aria-hidden='true']"))
                continue;
              range.selectNode(node);
              for (const box of [...range.getClientRects()]) {
                let left = box.left;
                let right = box.right;
                let top = box.top;
                let bottom = box.bottom;
                let ancestor = node.parentElement;
                while (ancestor && ancestor !== row) {
                  const style = getComputedStyle(ancestor);
                  const ancestorBox = ancestor.getBoundingClientRect();
                  if (
                    ["hidden", "clip", "auto", "scroll"].includes(
                      style.overflowX,
                    )
                  ) {
                    left = Math.max(left, ancestorBox.left);
                    right = Math.min(right, ancestorBox.right);
                  }
                  if (
                    ["hidden", "clip", "auto", "scroll"].includes(
                      style.overflowY,
                    )
                  ) {
                    top = Math.max(top, ancestorBox.top);
                    bottom = Math.min(bottom, ancestorBox.bottom);
                  }
                  ancestor = ancestor.parentElement;
                }
                if (
                  left < rowBox.left - 1 ||
                  right > rowBox.right + 1 ||
                  top < rowBox.top - 1 ||
                  bottom > rowBox.bottom + 1
                )
                  bad.push({
                    text: node.textContent || "",
                    left,
                    right,
                    top,
                    bottom,
                    parent: node.parentElement?.className.toString() || "",
                  });
              }
            }
            return bad;
          });
          expect(spill, `${label} ${density} phone row text spills`).toEqual(
            [],
          );
        }
      }
      if (viewport.width === 1440 && ["草稿", "仓库"].includes(label)) {
        expect(densityRowMeasurements).toHaveLength(4);
        console.log(
          `${label} desktop density row heights: ${densityRowMeasurements.join(", ")}`,
        );
      }
      if (
        ["库存", "货物流动", "盘点记录", "草稿"].includes(label) &&
        orderMeasurements.length === 4
      ) {
        for (let index = 1; index < orderMeasurements.length; index++) {
          expect(
            orderMeasurements[index].height,
            `${label} first-row height ${stops[index]}`,
          ).toBeGreaterThan(orderMeasurements[index - 1].height);
          expect(
            orderMeasurements[index].top,
            `${label} first-row top ${stops[index]}`,
          ).toBeGreaterThan(orderMeasurements[index - 1].top);
        }
      }
      await page.evaluate(() => {
        document.documentElement.dataset.tiDensity = "xcompact";
        document.documentElement.dataset.tiTextScale = "150";
        document.documentElement.style.setProperty("--p-text-scale", "1.5");
      });
      await noPageOverflow(page, `${label} at xcompact/150%`);
    }

    for (const path of [
      "/inventory/stock/items/ITEM-0",
      "/inventory/movements/new/Receive",
      "/inventory/counts/new",
      "/inventory/counts/opening/new",
      "/inventory/settings",
    ]) {
      await page.goto(path);
      await expect(page.locator("main").first()).toBeVisible();
      for (const density of stops) {
        await page.evaluate(
          (value) => (document.documentElement.dataset.tiDensity = value),
          density,
        );
        await noPageOverflow(page);
        if (viewport.phone) {
          const undersized = await page
            .locator(
              "button:visible, input:visible:not([type=radio]):not([type=checkbox]), select:visible, [role=tab]:visible, [aria-haspopup]:visible, label:visible:has(input[type=radio]), label:visible:has(input[type=checkbox])",
            )
            .evaluateAll((items) =>
              items
                .filter(
                  (el) =>
                    (el as HTMLElement).getBoundingClientRect().height < 43.5,
                )
                .map((el) => ({
                  text: (el as HTMLElement).innerText,
                  height: (el as HTMLElement).getBoundingClientRect().height,
                })),
            );
          expect(undersized, `${path} ${density}`).toEqual([]);
        }
      }
    }
  });
}

test("display settings exposes all density stops in order", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixture(page);
  await page.goto("/inventory/settings");
  const labels = page.locator(".density-choice label");
  await expect(labels).toHaveText(["超紧凑", "紧凑", "均衡", "宽松"]);
  await labels.filter({ hasText: "超紧凑" }).click();
  await expect
    .poll(() => page.locator("html").getAttribute("data-ti-density"))
    .toBe("xcompact");
});
