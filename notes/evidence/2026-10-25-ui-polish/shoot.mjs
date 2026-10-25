// Ad hoc screenshots of the running dev server. Usage: node shoot.mjs OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const out = process.argv[2];
const base = "http://development.localhost:8000";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"],
});
const pages = ["stock", "movements", "loans", "drafts", "activities", "counts", "reports", "stock/expiry", "stock/warehouses"];
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}
try {
  for (const [vp, size] of [["desk", { width: 1440, height: 900 }], ["mob", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 2, locale: "zh-CN" });
    const page = await ctx.newPage();
    await page.goto(base + "/login");
    await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
    for (const p of pages) {
      const tag = `${vp}-${p.replace("/", "_")}`;
      await page.goto(`${base}/inventory/${p}`);
      await settle(page);
      await page.screenshot({ path: `${out}/${tag}.png` });
      const more = page.locator("button.popup-menu-trigger-icon:visible").first();
      if (await more.count()) {
        await more.click(); await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/${tag}-more.png` });
        await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      }
      const split = page.locator("button.popup-menu-trigger-split:visible").first();
      if (await split.count()) {
        await split.click(); await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/${tag}-split.png` });
        await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      }
    }
    if (vp === "desk") {
      await page.goto(`${base}/inventory/movements`); await settle(page);
      await page.locator("[data-inventory-menu-trigger]").click(); await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/desk-navpopup.png` });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
