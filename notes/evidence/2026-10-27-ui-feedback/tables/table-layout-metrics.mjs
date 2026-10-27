import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const base = "http://development.localhost:8000";
const output = "../notes/evidence/2026-10-27-ui-feedback/tables";
const longName =
  "超长名称检查法会物资项目物品库存名称字段测试LongNameCheckABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: [
    "--no-sandbox",
    "--host-resolver-rules=MAP development.localhost 127.0.0.1",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
let csrf = "";
const changedItems = new Map();
const failures = [];
const baselineTableWidths = new Map();

async function api(method, values = {}) {
  const response = await page.evaluate(
    async ({ method, values, csrf }) => {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(values))
        body.set(key, String(value));
      const result = await fetch(`/api/method/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(csrf ? { "X-Frappe-CSRF-Token": csrf } : {}),
        },
        body,
      });
      return { status: result.status, payload: await result.json() };
    },
    { method, values, csrf },
  );
  if (response.status < 200 || response.status >= 300 || response.payload.exc)
    throw new Error(`${method}: ${JSON.stringify(response.payload)}`);
  return response.payload.message;
}

async function waitForRows() {
  try {
    await page
      .locator("main")
      .first()
      .waitFor({ state: "attached", timeout: 20000 });
  } catch {
    throw new Error(
      `browse page did not load at ${page.url()}: ${(await page.locator("body").innerText()).slice(0, 500)}`,
    );
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => !document.querySelector(".skeleton-block"), null, {
      timeout: 12000,
    })
    .catch(() => {});
}

async function metrics(name, width) {
  const tables = await page
    .locator(".data-table-scroll")
    .evaluateAll((scrollports) =>
      scrollports.map((scroll) => {
        const rows = [...scroll.querySelectorAll("tbody tr")].filter(
          (row) => !row.querySelector("td.data-table-group-cell"),
        );
        const rowHeights = rows.map(
          (row) => row.getBoundingClientRect().height,
        );
        const allTallCells = rows.flatMap((row) =>
          [...row.querySelectorAll("td")]
            .filter(
              (cell) =>
                !cell.classList.contains("data-column-primary") &&
                !cell.classList.contains("data-table-group-cell") &&
                cell.getBoundingClientRect().height > 72,
            )
            .map((cell) => ({
              className: cell.className,
              height: cell.getBoundingClientRect().height,
              text: cell.textContent?.trim().slice(0, 100),
            })),
        );
        const cells = [
          ...scroll.querySelectorAll(
            "tbody td:not(.data-column-primary, .data-table-settings-cell, .data-table-selection-column)",
          ),
        ];
        const wrappedCells = cells
          .filter((cell) =>
            [cell, ...cell.querySelectorAll("*")].some(
              (node) =>
                [...node.childNodes].some(
                  (child) =>
                    child.nodeType === Node.TEXT_NODE &&
                    child.textContent?.trim(),
                ) && getComputedStyle(node).whiteSpace !== "nowrap",
            ),
          )
          .map((cell) => cell.textContent?.trim());
        const headers = [...scroll.querySelectorAll("thead th")];
        const clippedHeaders = headers
          .filter((cell) => cell.scrollWidth > cell.clientWidth + 2)
          .map((cell) => cell.innerText.trim());
        const clippedNowrapCells = cells.filter(
          (cell) =>
            cell.scrollWidth > cell.clientWidth + 2 &&
            getComputedStyle(cell).textOverflow !== "ellipsis",
        ).length;
        return {
          horizontalScroll: scroll.scrollWidth > scroll.clientWidth + 1,
          clientWidth: scroll.clientWidth,
          scrollWidth: scroll.scrollWidth,
          maxRowHeight: Math.max(0, ...rowHeights),
          tallCellCount: allTallCells.length,
          tallCells: allTallCells.slice(0, 8),
          oversizedRows: rowHeights.filter((height) => height > 72).length,
          wrappedCells,
          clippedHeaders,
          clippedNowrapCells,
        };
      }),
    );
  await page.screenshot({
    path: `${output}/${name}-${width}.png`,
    fullPage: true,
  });
  console.log(JSON.stringify({ name, width, tables }));
  tables.forEach((table, index) => {
    if (!name.startsWith("long-")) {
      baselineTableWidths.set(`${name}-${width}-${index}`, table.scrollWidth);
      return;
    }
    const baselineName = name.slice("long-".length);
    const baseline = baselineTableWidths.get(
      `${baselineName}-${width}-${index}`,
    );
    if (baseline !== undefined && table.scrollWidth > baseline + 1)
      failures.push(
        `${name}-${width}: long name expanded table ${baseline} -> ${table.scrollWidth}px`,
      );
  });
  for (const table of tables) {
    if (
      table.oversizedRows ||
      table.wrappedCells.length ||
      table.clippedHeaders.length ||
      table.clippedNowrapCells
    )
      failures.push(`${name}-${width}: ${JSON.stringify(table)}`);
  }
  return tables;
}

async function capture(name, path, width) {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await waitForRows();
  return metrics(name, width);
}

function codeFromText(text) {
  return (
    text.match(/\bITM-[A-Z0-9-]+\b/)?.[0] ||
    text.match(/\bITEM-[A-Z0-9-]+\b/)?.[0] ||
    ""
  );
}

async function captureLongName(name, path, width) {
  await page.setViewportSize({ width, height: width < 1024 ? 844 : 900 });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await waitForRows();
  const detailLinks = await page
    .locator('a[href*="/stock/items/"]')
    .evaluateAll((links) =>
      links.map((link) => {
        const parts = new URL(link.href).pathname.split("/");
        return decodeURIComponent(parts.at(-1) || "");
      }),
    );
  const visibleRows = await page
    .locator("tbody tr, .stock-list-row, [data-browse-row]")
    .allInnerTexts();
  const codeCells = await page
    .locator("tbody td.data-column-code")
    .allInnerTexts();
  let code =
    detailLinks.find(
      (value) => value.startsWith("ITM-") || value.startsWith("ITEM-"),
    ) ||
    visibleRows.map(codeFromText).find(Boolean) ||
    codeCells.map((value) => codeFromText(value) || value.trim()).find(Boolean);
  if (!code) {
    const visibleName = visibleRows
      .map((row) => row.split("\n")[0]?.trim())
      .find(Boolean);
    if (visibleName) {
      const namedItems = await api("frappe.client.get_list", {
        doctype: "Item",
        fields: JSON.stringify(["name"]),
        filters: JSON.stringify([["item_name", "=", visibleName]]),
        limit_page_length: 1,
      });
      code = namedItems?.[0]?.name || "";
    }
  }
  if (!code)
    throw new Error(
      `${name}: could not find an Item code in visible rows (${visibleRows.slice(0, 3).join(" | ")})`,
    );
  const items = await api("frappe.client.get_list", {
    doctype: "Item",
    fields: JSON.stringify(["name", "item_name"]),
    filters: JSON.stringify([["name", "=", code]]),
    limit_page_length: 1,
  });
  const item = items?.[0];
  if (!item?.name || !item.item_name)
    throw new Error(`${name}: could not load Item ${code}`);
  if (!changedItems.has(item.name)) changedItems.set(item.name, item.item_name);
  await api("frappe.client.set_value", {
    doctype: "Item",
    name: item.name,
    fieldname: "item_name",
    value: longName,
  });
  await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
  await waitForRows();
  const search = page.locator('input[placeholder*="搜索"]').first();
  if (!(await search.count()))
    throw new Error(`${name}: no browse search input`);
  await search.fill(code);
  await search.press("Enter").catch(() => {});
  const waitForLongRow = () =>
    page.waitForFunction(
      ({ code, longName }) => {
        const rows = [
          ...document.querySelectorAll("[data-browse-row], tbody tr"),
        ];
        return rows.some((row) => row.textContent?.includes(longName));
      },
      { code, longName },
      { timeout: 6000 },
    );
  try {
    await waitForLongRow();
  } catch {
    await search.fill(longName);
    await search.press("Enter").catch(() => {});
    await waitForLongRow();
  }
  const row = page
    .locator("[data-browse-row], tbody tr")
    .filter({ hasText: longName })
    .first();
  const box = await row.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0)
    throw new Error(`${name}: matching long-name row is not visible`);
  const tableMetrics = await metrics(name, width);
  const primary = await row
    .locator("td.data-column-primary")
    .first()
    .evaluate((cell) => {
      const text = cell.querySelector(
        ".browse-row-link, .data-table-group-name, .item-line-name, strong",
      );
      return {
        width: cell.clientWidth,
        scrollWidth: cell.scrollWidth,
        lineHeight:
          Number.parseFloat(getComputedStyle(text || cell).lineHeight) || 0,
        lineClamp: getComputedStyle(text || cell).webkitLineClamp,
        title: text?.getAttribute("title") || cell.getAttribute("title"),
      };
    })
    .catch(() => null);
  const visibleLongName = await row.evaluate(
    (element, expectedName) => element.textContent?.includes(expectedName),
    longName,
  );
  if (!visibleLongName)
    failures.push(
      `${name}-${width}: matching long-name row missing after capture`,
    );
  if (width >= 1024 && primary) {
    if (primary.lineClamp !== "2")
      failures.push(
        `${name}-${width}: primary line clamp is ${primary.lineClamp}`,
      );
    if (primary.title !== longName)
      failures.push(`${name}-${width}: primary full-name title is missing`);
  }
  console.log(
    JSON.stringify({
      name,
      width,
      item: code,
      visibleLongName,
      primary,
      tableMetrics,
    }),
  );
}

try {
  await mkdir(output, { recursive: true });
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  const login = await page.evaluate(async () => {
    const body = new URLSearchParams({ usr: "Administrator", pwd: "admin" });
    const response = await fetch("/api/method/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return { status: response.status, payload: await response.json() };
  });
  if (login.status < 200 || login.status >= 300)
    throw new Error(`login failed: ${login.status}`);
  csrf = (await api("temple_inventory.session.info")).csrf_token;

  const itemRows = await api("frappe.client.get_list", {
    doctype: "Item",
    fields: JSON.stringify(["name"]),
    limit_page_length: 1,
  });
  const batchRows = await api("frappe.client.get_list", {
    doctype: "Batch",
    fields: JSON.stringify(["name"]),
    limit_page_length: 1,
  }).catch(() => []);
  const normalRoutes =
    process.env.TABLE_PENDING_RIGHT === "true"
      ? [["pending", "/inventory/stock/damaged"]]
      : process.env.TABLE_LONG_ONLY === "true"
        ? []
        : [
            ["stock", "/inventory/stock"],
            ["expiry", "/inventory/stock/expiry"],
            ["movements-items", "/inventory/movements?view=items"],
            ["movements-records", "/inventory/movements?view=records"],
            ["loans", "/inventory/loans"],
            ["pending", "/inventory/stock/damaged"],
            ["drafts", "/inventory/drafts"],
            ["activities", "/inventory/activities"],
            ["warehouses", "/inventory/stock/warehouses"],
            ["reports", "/inventory/reports"],
            ["count-editor", "/inventory/counts/new"],
            ["item-picker", "/inventory/movements/new/Issue"],
            ...(itemRows?.[0]?.name
              ? [
                  [
                    "product-detail",
                    `/inventory/stock/items/${encodeURIComponent(itemRows[0].name)}`,
                  ],
                ]
              : []),
            ...(batchRows?.[0]?.name
              ? [
                  [
                    "batch-detail",
                    `/inventory/stock/batches/${encodeURIComponent(batchRows[0].name)}`,
                  ],
                ]
              : []),
          ];
  for (const [name, path] of normalRoutes) {
    for (const width of [1440, 390]) {
      await capture(name, path, width);
      if (name === "pending" && width === 1440) {
        const scrollport = page.locator(".data-table-scroll").first();
        await scrollport.evaluate((element) => {
          element.scrollLeft = element.scrollWidth;
        });
        await metrics("pending-right", width);
      }
      if (name === "item-picker") {
        await page
          .getByRole("button", { name: "添加物品", exact: true })
          .click()
          .catch(() => {});
        await page
          .locator(".picker-browser-grid")
          .waitFor({ timeout: 10000 })
          .catch(() => {});
        await metrics("item-picker-open", width);
      }
      if (name === "activities" && width === 1440) {
        await page.locator(".browse-row-link").first().click();
        await page
          .locator(".activity-movement-tiles")
          .waitFor({ timeout: 15000 });
        await metrics("activity-detail", width);
      }
      if (name === "activities" && width === 390) {
        await page.locator(".browse-row-link").first().click();
        await page
          .locator(".activity-movement-tiles")
          .waitFor({ timeout: 15000 });
        await metrics("activity-detail", width);
      }
    }
  }

  const longRoutes = [
    ["long-stock", "/inventory/stock"],
    ["long-expiry", "/inventory/stock/expiry"],
    ["long-movements-items", "/inventory/movements?view=items"],
    ["long-pending", "/inventory/stock/damaged"],
    ["long-reports", "/inventory/reports"],
  ];
  const startLongRoute = process.env.TABLE_LONG_START || "";
  const startLongIndex = longRoutes.findIndex(
    ([name]) => name === startLongRoute,
  );
  const selectedLongRoutes =
    process.env.TABLE_PENDING_RIGHT === "true"
      ? []
      : startLongIndex >= 0
        ? longRoutes.slice(startLongIndex)
        : longRoutes;
  for (const [name, path] of selectedLongRoutes) {
    for (const width of [1440, 390]) await captureLongName(name, path, width);
    for (const [itemName, originalName] of changedItems)
      await api("frappe.client.set_value", {
        doctype: "Item",
        name: itemName,
        fieldname: "item_name",
        value: originalName,
      });
    for (const itemName of changedItems.keys())
      console.log(
        JSON.stringify({ temporaryItem: itemName, originalNameRestored: true }),
      );
    changedItems.clear();
  }
} finally {
  for (const [name, originalName] of changedItems) {
    try {
      await api("frappe.client.set_value", {
        doctype: "Item",
        name,
        fieldname: "item_name",
        value: originalName,
      });
      console.log(
        JSON.stringify({ temporaryItem: name, originalNameRestored: true }),
      );
    } catch (error) {
      failures.push(`RESTORE FAILED for ${name}: ${error.message}`);
    }
  }
  await context.close();
  await browser.close();
}
if (failures.length) throw new Error(failures.join("\n"));
