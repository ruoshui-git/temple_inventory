import { launch, login, settle, base } from "../lib.mjs";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/followups";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
  for (const [name, path] of [["stock-headers", "/stock"], ["expiry-headers", "/stock/expiry"]]) {
    await page.goto(base + path); await settle(page, 1500);
    const head = page.locator(".data-table-scroll thead").first();
    await head.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 85 });
  }
  await ctx.close();
} finally { await browser.close(); }
