import { launch, login, settle, base } from "../lib.mjs";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/followups";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: "zh-CN" });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
  await page.goto(base + "/stock/items/ITM-000390"); await settle(page, 1800);
  await page.getByRole("button", { name: "物品操作" }).click(); await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/item-menu-1100.jpg`, type: "jpeg", quality: 85 });
  await page.keyboard.press("Escape");
  const table = page.locator(".data-table-scroll").first(); await table.scrollIntoViewIfNeeded();
  await table.screenshot({ path: `${OUT}/item-table-1100.jpg`, type: "jpeg", quality: 85 });
  await ctx.close();
} finally { await browser.close(); }
