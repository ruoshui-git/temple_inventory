// Mobile audit pass 2: detail pages and common sheets. Usage: node audit-details.mjs OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const [out] = process.argv.slice(2);
const base = "http://development.localhost:8000/inventory";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200); }
async function shot(page, name) { await page.screenshot({ path: `${out}/${name}.png` }); console.log("shot", name, page.url().replace(base, "")); }
async function step(name, fn) { try { await fn(); } catch (e) { console.log("FAIL", name, e.message.split("\n")[0]); } }
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
  await step("item", async () => { await page.goto(base + "/stock"); await settle(page); await page.locator(".stock-list-row, [class*=stock-list] a, [class*=stock-list] button").filter({ hasText: "A4打印纸 70g 500张" }).first().tap(); await settle(page); await shot(page, "d-item-1"); await page.evaluate(() => scrollBy(0, 750)); await page.waitForTimeout(600); await shot(page, "d-item-2"); await page.evaluate(() => scrollBy(0, 750)); await page.waitForTimeout(600); await shot(page, "d-item-3"); });
  await step("item-edit", async () => { if (/\/stock\/items\/[^/]+$/.test(page.url())) { await page.goto(page.url() + "/edit"); await settle(page); await shot(page, "d-item-edit-1"); } });
  await step("movement", async () => { await page.goto(base + "/movements?view=records"); await settle(page); await page.getByText(/^MAT-STE-2026-\d+$/).first().tap(); await settle(page); await shot(page, "d-movement-1"); await page.evaluate(() => scrollBy(0, 750)); await page.waitForTimeout(600); await shot(page, "d-movement-2"); });
  await step("loans", async () => { await page.goto(base + "/movements?view=records"); await settle(page); await page.locator(".sample-mobile-nav").getByText("借用").tap(); await settle(page); await shot(page, "d-loans-1"); });
  await step("count", async () => { await page.goto(base + "/counts"); await settle(page); await page.getByText(/^MAT-RECO-2026-/).first().tap(); await settle(page); await shot(page, "d-count-1"); });
  await step("warehouse", async () => { await page.goto(base + "/stock/warehouses"); await settle(page); await page.getByText("A02", { exact: true }).first().tap(); await settle(page); await shot(page, "d-warehouse-1"); });
  await step("batch", async () => { await page.goto(base + "/stock/expiry"); await settle(page); await page.getByText(/^批次 /).first().tap(); await settle(page); await shot(page, "d-batch-1"); });
  await step("more-menu", async () => { await page.goto(base + "/stock"); await settle(page); await page.locator(".sample-mobile-nav").getByText("更多").tap(); await page.waitForTimeout(700); await shot(page, "s-more-nav"); });
  await step("filter", async () => { await page.goto(base + "/stock"); await settle(page); await page.locator("button[aria-label*='筛选']:visible").first().tap(); await page.waitForTimeout(800); await shot(page, "s-filter-sheet"); });
  await step("overflow", async () => { await page.goto(base + "/stock"); await settle(page); await page.locator(".browse-overflow-menu .popup-menu-trigger, button[aria-label='更多操作']").first().tap(); await page.waitForTimeout(600); await shot(page, "s-overflow-menu"); });
  await step("picker", async () => { await page.goto(base + "/movements/new/Receive"); await settle(page); await page.getByRole("button", { name: "添加物品" }).first().tap(); await page.waitForTimeout(1200); await shot(page, "s-item-picker"); await page.getByText("A4打印纸 70g 500张").first().tap().catch(() => {}); await page.waitForTimeout(800); await shot(page, "s-item-picker-2"); });
  await step("receive-with-line", async () => { await page.goto(base + "/movements/new/Receive?items=" + encodeURIComponent(JSON.stringify(["ITM-000210", "ITM-000044"]))); await settle(page); await shot(page, "d-receive-lines-1"); await page.evaluate(() => scrollBy(0, 600)); await page.waitForTimeout(600); await shot(page, "d-receive-lines-2"); });
  await step("transfer-with-line", async () => { await page.goto(base + "/movements/new/Transfer?items=" + encodeURIComponent(JSON.stringify(["ITM-000210"]))); await settle(page); await shot(page, "d-transfer-lines-1"); });
  await ctx.close();
} finally { await browser.close(); }
