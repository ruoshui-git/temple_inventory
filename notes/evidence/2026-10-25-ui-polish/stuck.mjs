import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const out = process.argv[2];
const base = "http://development.localhost:8000";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800); }
try {
  for (const [vp, size] of [["desk", { width: 1440, height: 900 }], ["narrow", { width: 1100, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, locale: "zh-CN" });
    const page = await ctx.newPage();
    await page.goto(base + "/login");
    await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
    await page.goto(`${base}/inventory/stock`); await settle(page);
    await page.mouse.wheel(0, 900); await page.waitForTimeout(600);
    await page.locator("[data-inventory-menu-trigger]").click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/stuck-${vp}-navpopup.png` });
    await page.keyboard.press("Escape"); await page.mouse.click(5, 600); await page.waitForTimeout(300);
    await page.locator("button.popup-menu-trigger-split:visible").first().click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/stuck-${vp}-split.png` });
    await page.keyboard.press("Escape");
    for (const path of ["stock/items/new", "movements/new/receive", "counts/new", "activities/new"]) {
      await page.goto(`${base}/inventory/${path}`); await settle(page);
      await page.screenshot({ path: `${out}/form-${vp}-${path.replaceAll("/", "_")}.png`, fullPage: false });
      const z = await page.evaluate(() => Array.from(document.querySelectorAll("*")).filter((e) => { const s = getComputedStyle(e); return (s.position === "sticky" || s.position === "fixed") && e.getBoundingClientRect().height > 0; }).map((e) => `${e.tagName}.${e.className.toString().slice(0, 50)} pos=${getComputedStyle(e).position} z=${getComputedStyle(e).zIndex}`));
      console.log(vp, path, JSON.stringify(z));
    }
    await ctx.close();
  }
} finally { await browser.close(); }
