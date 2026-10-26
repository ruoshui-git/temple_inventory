import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const base = "http://development.localhost:8000/inventory";
const routes = [
  "/movements?view=records", "/counts", "/activities", "/reports",
  "/stock/damaged", "/stock/items/ITM-000210", "/drafts", "/stock/expiry",
  "/stock/warehouses",
];
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: width < 1024, hasTouch: width < 1024, deviceScaleFactor: width < 1024 ? 2 : 1 });
    await page.goto(`${base}/`);
    await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
    for (const route of routes) {
      await page.goto(`${base}${route}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(500);
      const inspect = () => page.evaluate(() => [...document.querySelectorAll(".data-table-scroll")].map((table) => {
        const cell = table.querySelector("th.data-table-settings-heading");
        if (!cell) {
			const outlet = table.closest(".browse-page, .preview-browse-page, .inventory-surface")?.querySelector(".browse-summary-copy button[aria-label='设置列']");
          return { settings: Boolean(outlet), outlet: Boolean(outlet), width: outlet ? Math.round(outlet.getBoundingClientRect().width) : 0, overlaps: [] };
        }
        const button = cell.querySelector("button");
        const b = button.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        const overlaps = [...table.querySelectorAll("thead th:not(.data-table-settings-heading)")].filter((th) => {
          const range = document.createRange();
          range.selectNodeContents(th);
          return [...range.getClientRects()].some((r) => r.width && r.height && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top);
        }).map((th) => th.textContent?.trim());
        return { settings: true, width: Math.round(b.width), withinCell: b.left >= c.left && b.right <= c.right, overlaps };
      }));
      const start = await inspect();
      if (width < 1024) {
        await page.evaluate(() => document.querySelectorAll(".data-table-scroll").forEach((table) => { table.scrollLeft = table.scrollWidth; }));
        await page.waitForTimeout(100);
      }
      const end = width < 1024 ? await inspect() : [];
      console.log(width, route, JSON.stringify({ start, end }));
    }
    await page.close();
  }
} finally { await browser.close(); }
