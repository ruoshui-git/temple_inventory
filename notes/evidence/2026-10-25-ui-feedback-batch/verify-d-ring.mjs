// Focus ring appearance on record and group rows. Usage: node verify-d-ring.mjs OUTDIR
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
  for (const [path, name] of [["/movements", "d-ring-group"], ["/stock", "d-ring-record"]]) {
    await page.goto(base + path); await settle(page);
    if (path === "/stock") { await page.locator(".stock-view-icons button[aria-pressed]").nth(1).click(); await settle(page); }
    await page.locator(".data-table-scroll tbody tr[tabindex='0']").first().focus();
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
    const box = await page.locator(".data-table-frame").first().boundingBox();
    await page.screenshot({ path: `${out}/${name}.png`, clip: { x: box.x, y: box.y, width: box.width, height: 260 } });
  }
  await ctx.close();
} finally { await browser.close(); }
