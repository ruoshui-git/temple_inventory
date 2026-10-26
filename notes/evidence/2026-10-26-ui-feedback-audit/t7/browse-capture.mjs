import { launch, login, settle, base } from "../lib.mjs";
import { mkdir } from "node:fs/promises";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t7";
await mkdir(OUT, { recursive: true });
const browser = await launch();
try {
  async function context(viewport, mobile = false) {
    const ctx = await browser.newContext({ viewport, locale: "zh-CN", ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page); return { ctx, page };
  }
  async function grab(page, name, path, fullPage = false) {
    await page.goto(base + path); await settle(page, 1500);
    await page.locator("h1").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    if (path === "/counts/new") await page.locator(".count-baseline-status").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
    if (path === "/drafts") await page.locator(".draft-entry").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: `${OUT}/${name}.jpg`, fullPage, type: "jpeg", quality: 80 });
    const stats = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, overflowX: document.documentElement.scrollWidth - innerWidth, h1: document.querySelector("h1")?.textContent?.trim(), rows: document.querySelectorAll(".count-card, .native-count-card").length }));
    console.log(name, JSON.stringify(stats));
  }
  for (const [tag, width, height] of [["stock-1440", 1440, 900], ["stock-1100", 1100, 800]]) {
    const { ctx, page } = await context({ width, height }); await grab(page, tag, "/stock"); await ctx.close();
  }
  {
    const { ctx, page } = await context({ width: 1440, height: 900 });
    await page.goto(base + "/stock"); await settle(page, 1600);
    const triggers = page.locator(".data-table-scroll .stock-detail-chips button", { hasText: "库位" });
    let found = false;
    for (let i = 0; i < Math.min(await triggers.count(), 35); i++) {
      const trigger = triggers.nth(i); await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await page.waitForTimeout(300);
      const summary = page.locator(".detail-popover-content .stock-breakdown-other");
      if (await summary.count() && /借出\s*[1-9]/.test(await summary.first().textContent())) {
        await page.screenshot({ path: `${OUT}/stock-loan-popover.jpg`, type: "jpeg", quality: 80 });
        console.log("stock-loan-popover", JSON.stringify({ trigger: await trigger.textContent(), role: await page.locator(".detail-popover-content").getAttribute("role"), summary: await summary.first().textContent(), rows: await page.locator(".detail-popover-content tbody tr").count() })); found = true; break;
      }
      await page.keyboard.press("Escape"); await page.waitForTimeout(100);
    }
    if (!found) console.log("stock-loan-popover NOT FOUND");
    await ctx.close();
  }
  for (const [tag, width, height, mobile] of [["dashboard-1440", 1440, 900, false], ["dashboard-phone", 390, 844, true]]) {
    const { ctx, page } = await context({ width, height }, mobile); await grab(page, tag, "/"); await ctx.close();
  }
  {
    const { ctx, page } = await context({ width: 1440, height: 900 }); await grab(page, "movements-items", "/movements"); await ctx.close();
  }
  {
    const { ctx, page } = await context({ width: 1440, height: 900 }); await grab(page, "movements-records", "/movements?view=records"); await ctx.close();
  }
  for (const [tag, width, height, mobile] of [["drafts-1440", 1440, 900, false], ["drafts-phone", 390, 844, true]]) {
    const { ctx, page } = await context({ width, height }, mobile); await grab(page, tag, "/drafts"); await ctx.close();
  }
  {
    const { ctx, page } = await context({ width: 1100, height: 800 }); await grab(page, "reports", "/reports"); await ctx.close();
  }
  {
    const { ctx, page } = await context({ width: 390, height: 844 }, true); await grab(page, "count-new-phone", "/counts/new");
    console.log("count-card-page", await page.locator(".count-card").count());
    await page.screenshot({ path: `${OUT}/count-new-phone-full.jpg`, fullPage: true, type: "jpeg", quality: 80 }); await ctx.close();
  }
  {
    const { ctx, page } = await context({ width: 844, height: 390 }, true);
    await grab(page, "landscape-stock", "/stock"); await grab(page, "landscape-movements", "/movements?view=records"); await ctx.close();
  }
} finally { await browser.close(); }
