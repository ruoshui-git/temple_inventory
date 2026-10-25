// Claude's independent checks against the worktree Vite server. Usage: node verify-claude.mjs BASE OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); }
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 3, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
  await page.goto(base + "/stock"); await settle(page);
  const scroll = page.locator(".data-table-scroll").first();
  await scroll.evaluate((n) => { n.scrollLeft = 120; }); await page.waitForTimeout(400);
  const fb = await page.locator(".data-table-frame").first().boundingBox();
  await page.screenshot({ path: `${out}/v-corner-top-left.png`, clip: { x: fb.x - 6, y: fb.y - 6, width: 120, height: 90 } });
  await page.screenshot({ path: `${out}/v-corner-top-right.png`, clip: { x: fb.x + fb.width - 114, y: fb.y - 6, width: 120, height: 90 } });
  await page.mouse.wheel(0, 700); await page.waitForTimeout(700);
  const bar = page.locator(".floating-table-scrollbar");
  console.log("floating visible", await bar.count(), await bar.count() ? JSON.stringify(await bar.boundingBox()) : "");
  await page.screenshot({ path: `${out}/v-floating.png`, clip: { x: 300, y: 760, width: 1140, height: 140 } });
  // scroll to the bottom of the table so the native bar shows
  await scroll.evaluate((n) => n.scrollIntoView({ block: "end" })); await page.waitForTimeout(600);
  console.log("floating at table end", await bar.count());
  await page.evaluate(() => window.scrollTo(0, 600)); await page.waitForTimeout(500);
  await page.locator(".browse-chrome button[aria-label*='筛选']:visible").first().click().catch((e) => console.log("filter click", e.message));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/v-filter-stuck.png`, scale: "css" });
  await ctx.close();
} finally { await browser.close(); }
