import { launch, login, settle, base, DESKTOP, PHONE } from "../lib.mjs";
const browser = await launch();
try {
 for (const [vp, opts] of [["desktop", DESKTOP], ["phone", PHONE]]) {
  const ctx = await browser.newContext(opts); const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
  await page.goto(base + "/movements/new/Receive"); await settle(page, 1200);
  await page.getByRole("button", { name: "添加物品" }).first().click(); await settle(page, 800);
  if (vp === "desktop") {
   await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t7/picker-rail-expanded-desktop.jpg", type: "jpeg", quality: 80 });
   const toggle = page.locator(".preview-item-picker-dialog .filter-rail-heading button").first(); await toggle.click(); await page.waitForTimeout(300);
   await page.screenshot({ path: "../notes/evidence/2026-10-26-ui-feedback-audit/t7/picker-rail-collapsed-desktop.jpg", type: "jpeg", quality: 80 }); await toggle.click();
  }
  await page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建物品" }).first().click(); await settle(page, 1000);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/create-top-${vp}.jpg`, type: "jpeg", quality: 80 });
  const expiry = page.locator(".preview-item-picker-dialog").getByLabel("记录效期"); await expiry.check(); await page.waitForTimeout(200);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/expiry-batch-${vp}.jpg`, type: "jpeg", quality: 80 });
  const code = page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']"); await code.fill(""); await code.blur(); await page.waitForTimeout(200);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/code-cleared-${vp}.jpg`, type: "jpeg", quality: 80 });
  const cat = page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建分类" }); await cat.click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/category-stacked-${vp}.jpg`, type: "jpeg", quality: 80 }); await page.getByRole("button", { name: "取消" }).last().click(); await page.waitForTimeout(300);
  const unit = page.locator(".preview-item-picker-dialog").getByRole("button", { name: "新建单位" }); await unit.click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/unit-stacked-${vp}.jpg`, type: "jpeg", quality: 80 }); await page.getByRole("button", { name: "取消" }).last().click(); await page.waitForTimeout(300);
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").fill("CUSTOM");
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").fill("");
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").focus();
  await page.locator(".preview-item-picker-dialog input[placeholder^='留空自动生成']").press("Tab");
  await page.getByRole("button", { name: "创建并使用物品" }).click(); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/validation-errors-${vp}.jpg`, type: "jpeg", quality: 80 });
  const scroll = page.locator(".picker-creation-scroll"); await scroll.evaluate((e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(300);
  await page.screenshot({ path: `../notes/evidence/2026-10-26-ui-feedback-audit/t7/create-bottom-${vp}.jpg`, type: "jpeg", quality: 80 });
  await ctx.close();
 }
} finally { await browser.close(); }
