import { expect, test, type Page } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  nativeUiSession,
  sampleWarehouses,
} from "../browser/fixtures/nativeUi";

const rows = Array.from({ length: 300 }, (_, index) => ({
  id: `ITEM-${index}`,
  code: `ITEM-${index}`,
  item_code: `ITEM-${index}`,
  name: `演示物品 ${index}`,
  item_name: `演示物品 ${index}`,
  category: "演示",
  uom: "Nos",
  stock_uom: "Nos",
  available: 1,
  loaned: 0,
  damaged: 0,
  stock_qty: 1,
  locations: [
    {
      location: "A02-DIRECT",
      label: "T2/FUN/A02",
      path: "T2/FUN/A02",
      available: 1,
      loaned: 0,
      damaged: 0,
      batches: [],
    },
  ],
}));
const prefix = "/assets/temple_inventory/frontend/";
const origin = "http://development.localhost";

async function serveFixture(page: Page, bundle: string) {
  const shell = (await readFile(join(bundle, "index.html"), "utf8"))
    .replace(/<script>\s*{% for key in boot %}[\s\S]*?<\/script>/, "")
    .replace(/\{\{[^}]+\}\}/g, "");
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      await route.abort();
    } else if (url.pathname === "/inventory/stock") {
      await route.fulfill({ body: shell, contentType: "text/html" });
    } else if (url.pathname.startsWith(prefix)) {
      await route.fulfill({
        path: join(bundle, url.pathname.slice(prefix.length)),
      });
    } else {
      await route.fulfill({ status: 404, body: "" });
    }
  });
  await nativeUiSession(page, 100, {
    warehouses: sampleWarehouses.map((row) =>
      row.name === "A02-DIRECT"
        ? {
            ...row,
            label: "T2/FUN/A02",
            path: "T2/FUN/A02",
            path_segments: ["T2", "FUN", "A02"],
            path_names: ["第2寺院", "功能区域", "演示室"],
          }
        : row,
    ),
  });
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page*",
    (route) => {
      return route.fulfill({
        json: {
          message: {
            rows,
            matched_count: rows.length,
            next_start: null,
            query: route.request().postDataJSON()?.query,
            snapshot: "2026-10-16 12:00:00",
            analysis: { category: [], location: [] },
            summary: [{ stock_uom: "Nos", available: rows.length }],
          },
        },
      });
    },
  );
}

async function timeTable(page: Page, bundle: string) {
  await serveFixture(page, bundle);
  await page.addInitScript(
    ({ rowCount }) => {
      // Watch from before app mount and allow a frame to paint the completed table.
      const observer = new MutationObserver(() => {
        if (
          document.querySelectorAll(".data-table-scroll tbody tr").length !==
          rowCount
        )
          return;
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            performance.mark("stock-table-painted");
          }),
        );
      });
      observer.observe(document, { childList: true, subtree: true });
    },
    { rowCount: rows.length },
  );
  await page.goto(origin + "/inventory/stock");
  await expect(page.locator(".data-table-scroll tbody tr")).toHaveCount(
    rows.length,
  );
  await page.waitForFunction(
    () => performance.getEntriesByName("stock-table-painted").length > 0,
  );
  return page.evaluate(() => {
    const response = performance
      .getEntriesByType("resource")
      .find((entry) =>
        entry.name.includes("temple_inventory.browse.inventory_page"),
      ) as PerformanceResourceTiming | undefined;
    if (!response?.responseEnd)
      throw new Error("Missing inventory response timing");
    return (
      performance.getEntriesByName("stock-table-painted")[0]!.startTime -
      response.responseEnd
    );
  });
}

async function bundleSize(bundle: string) {
  const assets = await readdir(join(bundle, "assets"));
  const selected = assets.filter((file) => /\.(?:css|js)$/.test(file));
  const files = await Promise.all(
    selected.map((file) => readFile(join(bundle, "assets", file))),
  );
  return {
    bytes: files.reduce((sum, file) => sum + file.length, 0),
    gzipBytes: files.reduce((sum, file) => sum + gzipSync(file).length, 0),
  };
}

test("production stock table render and JS/CSS bundle size", async ({
  browser,
}) => {
  const versions = [
    { name: "before", bundle: process.env.TI_TOOLTIP_BEFORE },
    { name: "after", bundle: process.env.TI_TOOLTIP_AFTER },
  ];
  const samples: number[][] = [[], []];
  for (let trial = 0; trial < 12; trial++) {
    for (const index of trial % 2 === 0 ? [0, 1] : [1, 0]) {
      const version = versions[index]!;
      if (!version.bundle)
        throw new Error(
          "Set TI_TOOLTIP_BEFORE and TI_TOOLTIP_AFTER to the built frontend directories",
        );
      const page = await browser.newPage({
        serviceWorkers: "block",
        reducedMotion: "reduce",
        viewport: { width: 1440, height: 900 },
      });
      try {
        const measured = await timeTable(page, version.bundle);
        if (trial >= 3) samples[index]!.push(measured);
      } finally {
        await page.close();
      }
    }
  }
  for (const [index, version] of versions.entries()) {
    const times = samples[index]!.sort((left, right) => left - right);
    const medianMs = times[Math.floor(times.length / 2)]!;
    console.log(
      JSON.stringify({
        name: version.name,
        rows: rows.length,
        medianMs,
        samplesMs: times,
        ...(await bundleSize(version.bundle!)),
      }),
    );
  }
});
