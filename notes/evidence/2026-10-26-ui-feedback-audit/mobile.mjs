// Mobile/PWA interaction audit: touch targets, thumb zone, sheets, keyboard, landscape, small phone, manifest.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch();
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log("STEP FAIL", name, String(e).slice(0, 250)); } };
const M = `${OUT}/mobile`;
const targets = (page) => page.evaluate(() => {
  const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width && b.height && s.visibility !== "hidden" && b.top < innerHeight && b.bottom > 0 && !e.closest("[inert]"); };
  const els = [...document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select, [role=tab], [role=menuitem], summary, label:has(input[type=checkbox])")].filter(vis);
  const small = els.filter((e) => { const b = e.getBoundingClientRect(); return b.height < 44 || b.width < 44; });
  // tight neighbours: centers within 44px and gap < 8px
  let tight = 0; const rects = els.map((e) => e.getBoundingClientRect());
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) { const a = rects[i], b = rects[j]; const gx = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)); const gy = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)); if (gx < 4 && gy < 4 && !(els[i].contains(els[j]) || els[j].contains(els[i]))) tight++; }
  const hist = {}; for (const e of small) { const h = Math.round(e.getBoundingClientRect().height); hist[h] = (hist[h] || 0) + 1; }
  const primary = [...document.querySelectorAll(".ui-button.primary, button.primary, [data-variant=primary], .ui-button--primary")].filter(vis).map((b) => `${b.textContent.trim().slice(0, 10)}@y${Math.round(b.getBoundingClientRect().top)}`);
  const fixed = [...document.querySelectorAll("body *")].filter((e) => { const s = getComputedStyle(e); return (s.position === "fixed" || s.position === "sticky") && vis(e) && e.getBoundingClientRect().height > 20; }).map((e) => `${e.className.toString().split(" ")[0].slice(0, 28)}[${Math.round(e.getBoundingClientRect().top)}-${Math.round(e.getBoundingClientRect().bottom)}]`).slice(0, 8);
  return { total: els.length, small: small.length, heights: hist, tightPairs: tight, examples: small.slice(0, 6).map((e) => `${(e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 10)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`), primary, fixed, overflowX: document.documentElement.scrollWidth - innerWidth };
});
try {
  // manifest + head
  await step("manifest", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await ctx.newPage(); await login(page); await page.goto(base + "/"); await settle(page);
    const head = await page.evaluate(async () => { const m = document.querySelector("link[rel=manifest]")?.href; let man = null; try { man = await (await fetch(m)).json(); } catch (e) { man = String(e); } return { manifest: m, man, theme: document.querySelector("meta[name=theme-color]")?.content, status: document.querySelector("meta[name=apple-mobile-web-app-status-bar-style]")?.content, touchIcon: document.querySelector("link[rel=apple-touch-icon]")?.href, viewport: document.querySelector("meta[name=viewport]")?.content, sw: !!navigator.serviceWorker?.controller, swRegs: (await navigator.serviceWorker?.getRegistrations?.())?.length }; });
    console.log("HEAD", JSON.stringify(head).slice(0, 1500));
    await ctx.close();
  });
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "zh-CN" };
  const ctx = await browser.newContext(phone); const page = await ctx.newPage(); page.setDefaultTimeout(8000); await login(page);
  const routes = [["dashboard", "/"], ["stock", "/stock"], ["movements", "/movements?view=records"], ["receive", "/movements/new/Receive"], ["issue", "/movements/new/Issue"], ["loans", "/loans"], ["counts", "/counts"], ["count-new", "/counts/new"], ["reports", "/reports"], ["drafts", "/drafts"], ["more", "/more"], ["notif-settings", "/settings/notifications"], ["item-new", "/stock/items/new"], ["warehouses", "/stock/warehouses"], ["expiry", "/stock/expiry"]];
  for (const [name, path] of routes) {
    await step(name, async () => {
      await page.goto(base + path); await settle(page, 1200);
      await page.screenshot({ path: `${M}/${name}-top.png` });
      console.log("T", name, JSON.stringify(await targets(page)));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(600);
      await page.screenshot({ path: `${M}/${name}-bottom.png` });
    });
  }
  // filter sheet on stock
  await step("sheet", async () => {
    await page.goto(base + "/stock"); await settle(page);
    await page.locator("button[aria-label*='筛选']").first().tap(); await page.waitForTimeout(800);
    await page.screenshot({ path: `${M}/sheet-filter.png` });
    const s = await page.evaluate(() => { const d = [...document.querySelectorAll("[role=dialog]")].filter((x) => x.offsetParent).at(-1); if (!d) return null; const b = d.getBoundingClientRect(); const sc = [...d.querySelectorAll("*")].find((x) => x.scrollHeight > x.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(x).overflowY)); return { cls: d.className, rect: [b.x, b.y, b.width, b.height].map(Math.round), handle: !!d.querySelector("[class*=handle], [class*=grabber]"), scroller: sc ? { cls: sc.className.slice(0, 40), ob: getComputedStyle(sc).overscrollBehaviorY } : null, bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(document.documentElement).overflow }; });
    console.log("SHEET", JSON.stringify(s));
    // try swipe down on the sheet header
    await page.touchscreen.tap(195, 120).catch(() => {});
  });
  // overflow menu sheet
  await step("overflow-sheet", async () => {
    await page.goto(base + "/stock"); await settle(page);
    await page.locator("button[aria-label*='更多']").first().tap(); await page.waitForTimeout(700);
    await page.screenshot({ path: `${M}/sheet-more.png` });
  });
  // keyboard simulation in receive editor with a line
  await step("keyboard", async () => {
    await page.goto(base + "/movements/new/Receive"); await settle(page);
    await page.getByRole("button", { name: "添加物品" }).first().tap(); await settle(page, 1200);
    const boxes = page.locator("[role=dialog] tbody input[type=checkbox], [role=dialog] .picker-card input[type=checkbox], [role=dialog] input[type=checkbox]");
    console.log("phone picker checkboxes", await boxes.count());
    await page.screenshot({ path: `${M}/picker.png` });
    for (let i = 0; i < 2; i++) await boxes.nth(i + 1).tap().catch((e) => console.log("tapfail", String(e).slice(0, 80)));
    await page.getByRole("button", { name: /添加所选/ }).tap(); await settle(page, 1500);
    const qty = page.locator("input[data-field=qty]").last();
    await qty.scrollIntoViewIfNeeded(); await qty.tap(); await page.waitForTimeout(300);
    const attrs = await qty.evaluate((e) => ({ type: e.type, inputmode: e.inputMode, enterkeyhint: e.enterKeyHint }));
    await page.screenshot({ path: `${M}/kb-before.png` });
    await page.setViewportSize({ width: 390, height: 500 }); await page.waitForTimeout(600);
    const vis = await page.evaluate(() => { const i = document.activeElement; const b = i.getBoundingClientRect(); const covers = [...document.querySelectorAll("body *")].filter((e) => { const s = getComputedStyle(e); if (!(s.position === "fixed" || s.position === "sticky")) return false; const r = e.getBoundingClientRect(); return r.height > 20 && r.top < b.bottom && r.bottom > b.top && r.left < b.right && r.right > b.left && !e.contains(i); }).map((e) => e.className.toString().slice(0, 40) + `[${Math.round(e.getBoundingClientRect().top)}-${Math.round(e.getBoundingClientRect().bottom)}]`); return { focused: i.dataset.field, inputRect: [Math.round(b.top), Math.round(b.bottom)], vh: innerHeight, visible: b.top >= 0 && b.bottom <= innerHeight, coveredBy: covers }; });
    console.log("KB", JSON.stringify(attrs), JSON.stringify(vis));
    await page.screenshot({ path: `${M}/kb-500.png` });
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await ctx.close();
  // small phone + landscape
  for (const [tag, vp] of [["s360", { width: 360, height: 740 }], ["land", { width: 844, height: 390 }]]) {
    const c = await browser.newContext({ viewport: vp, isMobile: true, hasTouch: true, deviceScaleFactor: 3, locale: "zh-CN" }); const p = await c.newPage(); p.setDefaultTimeout(8000); await login(p);
    for (const [name, path] of [["dashboard", "/"], ["stock", "/stock"], ["receive", "/movements/new/Receive"], ["movements", "/movements?view=records"], ["count-new", "/counts/new"]]) {
      await step(tag + name, async () => { await p.goto(base + path); await settle(p, 1200); await p.screenshot({ path: `${M}/${tag}-${name}.png` }); console.log(tag, name, JSON.stringify(await targets(p))); });
    }
    await c.close();
  }
} finally { await browser.close(); }
