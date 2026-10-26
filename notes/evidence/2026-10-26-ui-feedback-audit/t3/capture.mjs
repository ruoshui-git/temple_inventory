import { launch, login, settle, base, DESKTOP, PHONE } from "../lib.mjs";
const browser = await launch();
try {
 for (const [vp, opts] of [["desktop", DESKTOP], ["phone", PHONE]]) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
  await page.goto(base + "/movements/new/Receive"); await settle(page, 1200);
  await page.getByRole("button", { name: "添加物品" }).first().click(); await settle(page, 800);
  if (vp === "desktop") {
   await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/picker-rail-expanded-desktop.png" });
   const toggle = page.locator(".preview-item-picker-dialog .filter-rail-heading button").first(); await toggle.click(); await page.waitForTimeout(300);
   await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/picker-rail-collapsed-desktop.png" }); await toggle.click();
  }
  await page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建物品" }).first().click(); await settle(page, 1000);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/create-top-${vp}.png` });
  const expiry = page.locator(".preview-item-picker-dialog").getByLabel("记录效期"); await expiry.check(); await page.waitForTimeout(200);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/expiry-batch-${vp}.png` });
  const code = page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']"); await code.fill(""); await code.blur(); await page.waitForTimeout(200);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/code-cleared-${vp}.png` });
  const cat = page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建分类" }); await cat.click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/category-stacked-${vp}.png` }); await page.getByRole("button", { name: "取消" }).last().click(); await page.waitForTimeout(300);
  const unit = page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建单位" }); await unit.click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/unit-stacked-${vp}.png` }); await page.getByRole("button", { name: "取消" }).last().click(); await page.waitForTimeout(300);
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").fill("CUSTOM");
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").fill("");
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").focus();
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").press("Tab");
  await page.getByRole("button", { name: "创建并使用物品" }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/validation-errors-${vp}.png` });
  const scroll = page.locator(".picker-creation-scroll"); await scroll.evaluate((e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t3/create-bottom-${vp}.png` });
  await ctx.close();
 }
 const ctx = await browser.newContext(DESKTOP); const page = await ctx.newPage(); await login(page); await page.goto(base + "/stock"); await settle(page, 1000);
 const detailLink = await page.locator("a[href*='/stock/items/']").first().getAttribute("href").catch(() => null);
 await page.goto(detailLink ? new URL(detailLink, base).href : base + "/stock/items/ITM-000044"); await settle(page, 1200);
 if (await page.getByRole("button", { name: "物品操作" }).count()) { await page.getByRole("button", { name: "物品操作" }).click(); await page.waitForTimeout(300); await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/item-menu-desktop.png" }); const disable=page.getByRole("button", { name: "停用物品" }); if (await disable.isEnabled()) { await disable.click(); await page.waitForTimeout(300); await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/disable-confirm-desktop.png" }); await page.keyboard.press("Escape"); await page.waitForTimeout(300); } else { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } await page.getByRole("button", { name: "物品操作" }).click(); await page.waitForTimeout(200); const del=page.getByRole("button", { name: "删除物品" }); if (await del.isEnabled()) { await del.click(); await page.waitForTimeout(300); await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t3/delete-confirm-desktop.png" }); } }
 await ctx.close();
} finally { await browser.close(); }
