import { launch, login, settle, base } from "../lib.mjs";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/followups";
const tag = process.argv[2] || "after";
const browser = await launch();
try {
  for (const [w, h] of [[1440, 900], [1100, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
    const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
    for (const [name, path] of [["stock", "/stock"], ["records", "/movements?view=records"], ["items", "/movements?view=items"], ["expiry", "/stock/expiry"], ["reports", "/reports"], ["item", "/stock/items/ITM-000390"]]) {
      await page.goto(base + path); await settle(page, 1800);
      if (name === "items") { const exp = page.locator(".data-table-scroll tbody tr button[aria-expanded='false']").first(); if (await exp.count()) { await exp.click(); await settle(page, 1500); } }
      const frame = page.locator(".data-table-scroll").first();
      if (!(await frame.count())) { console.log(name, w, "no table"); continue; }
      if (name === "item") await frame.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/edge-${name}-${w}-${tag}.jpg`, type: "jpeg", quality: 82 });
      const info = await page.evaluate(() => ({
        triggers: document.querySelectorAll(".data-table-column-trigger").length,
        summaryTriggers: document.querySelectorAll(".browse-summary-copy .data-table-column-trigger").length,
        settingsHeadings: document.querySelectorAll("th.data-table-settings-heading").length,
        overflowX: document.documentElement.scrollWidth - innerWidth,
      }));
      console.log(name, w, JSON.stringify(info));
    }
    await ctx.close();
  }
} finally { await browser.close(); }
