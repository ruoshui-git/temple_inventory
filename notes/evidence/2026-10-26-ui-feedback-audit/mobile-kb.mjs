// Phone keyboard simulation: focus a quantity input in the receive editor, shrink viewport to 500px.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch();
const M = `${OUT}/mobile`;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "zh-CN" });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000); await login(page);
  await page.goto(base + "/movements/new/Receive"); await settle(page);
  await page.getByRole("button", { name: "添加物品" }).first().tap(); await settle(page, 1200);
  await page.locator("[role=option].picker-phone-row").nth(0).tap(); await page.locator("[role=option].picker-phone-row").nth(1).tap();
  await page.screenshot({ path: `${M}/picker-selected.png` });
  await page.getByRole("button", { name: /添加所选/ }).tap();
  await page.waitForFunction(() => !document.querySelector(".preview-item-picker-dialog") && document.querySelectorAll("input[data-field=qty]").length >= 2, null, { timeout: 60000 });
  await settle(page, 800);
  await page.screenshot({ path: `${M}/receive-lines.png` });
  const qty = page.locator("input[data-field=qty]").last();
  await qty.scrollIntoViewIfNeeded(); await qty.tap(); await page.waitForTimeout(300);
  const attrs = await qty.evaluate((e) => ({ type: e.type, inputmode: e.inputMode, enterkeyhint: e.enterKeyHint, autocomplete: e.autocomplete }));
  await page.screenshot({ path: `${M}/kb-before.png` });
  await page.setViewportSize({ width: 390, height: 500 }); await page.waitForTimeout(700);
  const probe = () => page.evaluate(() => { const i = document.activeElement; const b = i.getBoundingClientRect(); const covers = [...document.querySelectorAll("body *")].filter((e) => { const s = getComputedStyle(e); if (!(s.position === "fixed" || s.position === "sticky")) return false; const r = e.getBoundingClientRect(); return r.height > 20 && r.top < b.bottom && r.bottom > b.top && !e.contains(i); }).map((e) => e.className.toString().split(" ")[0] + `[${Math.round(e.getBoundingClientRect().top)}-${Math.round(e.getBoundingClientRect().bottom)}]`); const chrome = [...document.querySelectorAll(".form-actions, .sample-mobile-nav, .mobile-app-topbar, header")].map((e) => e.className.toString().split(" ")[0] + `[${Math.round(e.getBoundingClientRect().top)}-${Math.round(e.getBoundingClientRect().bottom)}]`); return { focused: i.dataset.field, input: [Math.round(b.top), Math.round(b.bottom)], vh: innerHeight, visible: b.top >= 0 && b.bottom <= innerHeight, coveredBy: covers, chrome }; });
  console.log("KB attrs", JSON.stringify(attrs));
  console.log("KB 500", JSON.stringify(await probe()));
  await page.screenshot({ path: `${M}/kb-500.png` });
  // detail drawer with keyboard
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.getByRole("button", { name: /详情$/ }).first().tap(); await page.waitForTimeout(800);
  await page.getByRole("button", { name: "单位与换算" }).tap(); await page.waitForTimeout(600);
  await page.screenshot({ path: `${M}/drawer-conversion.png` });
  const f = page.locator(".preview-conversion-editor input").last(); await f.tap().catch(() => {});
  await page.setViewportSize({ width: 390, height: 500 }); await page.waitForTimeout(700);
  console.log("KB drawer", JSON.stringify(await probe()));
  await page.screenshot({ path: `${M}/kb-drawer-500.png` });
  await ctx.close();
} finally { await browser.close(); }
