// Claude's live checks for Task A against the dev server. Usage: node verify-a.mjs OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const [out] = process.argv.slice(2);
const base = "http://development.localhost:8000/inventory";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); }
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
  // A2: table horizontal scroll button
  await page.goto(base + "/stock"); await settle(page);
  await page.locator(".stock-view-icons button[aria-pressed]").nth(1).click(); await settle(page);
  const scroll = page.locator(".data-table-scroll").first();
  console.log("floating bar mounted", await page.locator(".floating-table-scrollbar").count());
  const before = await scroll.evaluate((n) => [n.scrollLeft, n.clientWidth, n.scrollWidth]);
  await page.locator(".data-table-overflow-hint-end").first().click();
  await page.waitForTimeout(1200);
  const after = await scroll.evaluate((n) => n.scrollLeft);
  console.log("A2 scroll before/after/clientWidth/scrollWidth", before[0], after, before[1], before[2], "expected ~", Math.round(before[1] * 0.8));
  await page.screenshot({ path: `${out}/a2-after-scroll.png` });
  await page.locator(".data-table-overflow-hint-start").first().click(); await page.waitForTimeout(1200);
  console.log("A2 back to", await scroll.evaluate((n) => n.scrollLeft));
  // A3: summary expands, controls stay in line
  await page.evaluate(() => window.scrollTo(0, 0));
  const ctrl = page.locator(".browse-summary-controls").first();
  const c0 = await ctrl.boundingBox();
  await page.locator(".browse-result-summary-trigger").first().click(); await page.waitForTimeout(500);
  const c1 = await ctrl.boundingBox();
  console.log("A3 controls y before/after", c0?.y, c1?.y);
  await page.screenshot({ path: `${out}/a3-summary-expanded.png` });
  // A5: search -> 清除全部 clears search
  const search = page.locator("input[type=search]").first();
  await search.fill("香"); await settle(page);
  const clearAll = page.getByRole("button", { name: "清除全部" });
  console.log("A5 clear-all visible with search only (expect 0)", await clearAll.count());
  await page.getByText("食品", { exact: true }).first().click(); await settle(page);
  console.log("A5 chips", await page.locator(".browse-chip, [class*=chip]").count(), "clear-all visible with filter", await clearAll.count());
  await page.screenshot({ path: `${out}/a5-search-clear-all.png` });
  await clearAll.first().click(); await settle(page);
  console.log("A5 search after clear:", JSON.stringify(await search.inputValue()), "button left", await clearAll.count(), "checked boxes", await page.locator("input[type=checkbox]:checked").count());
  // A6 + A9: receive editor warehouse picker
  await page.goto(base + "/movements/new/Receive"); await settle(page);
  const combo = page.locator("input[role=combobox]");
  const rows = () => page.locator(".search-select-menu [role=option]").count();
  for (let i = 0; i < await combo.count(); i++) {
    const c = combo.nth(i);
    await c.click(); await page.waitForTimeout(500);
    const first = await page.locator(".search-select-menu [role=option]").first().textContent().catch(() => "");
    console.log(" combo", i, await c.getAttribute("placeholder"), "rows", await rows(), "first:", first?.trim().slice(0, 40));
    const more = page.locator(".search-select-menu button", { hasText: "显示更多" });
    if (await more.count()) {
      await page.screenshot({ path: `${out}/a6-before-show-more.png` });
      await more.click(); await page.waitForTimeout(500);
      console.log("A6 rows after show-more", await rows(), "menu open", await page.locator(".search-select-menu").count(), "focus in input", await c.evaluate((n) => document.activeElement === n));
      await page.screenshot({ path: `${out}/a6-after-show-more.png` });
    }
    await c.fill("第2寺院"); await page.waitForTimeout(600);
    console.log("A9 combo", i, "rows for 第2寺院", await rows());
    if (await rows()) await page.screenshot({ path: `${out}/a9-search-full-name-${i}.png` });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  }
  await ctx.close();
} finally { await browser.close(); }
