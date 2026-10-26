// A1 + A11 (popover position): notification center row hover measurements.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await ctx.newPage(); await login(page);
  await page.goto(base + "/"); await settle(page);
  const bell = page.locator("button[aria-label*='通知']").first();
  await bell.click(); await page.waitForTimeout(1200);
  const pop = await page.evaluate(() => { const p = document.querySelector(".notification-popover"); if (!p) return null; const b = p.getBoundingClientRect(); const bell = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("aria-label") || "").includes("通知")).getBoundingClientRect(); return { popover: [b.x, b.y, b.width, b.height].map(Math.round), bell: [bell.x, bell.y, bell.width, bell.height].map(Math.round), vw: innerWidth }; });
  console.log("popover", JSON.stringify(pop));
  await page.screenshot({ path: `${OUT}/a/a1-popover.png` });
  const subj = page.locator(".notification-popover .notification-subject").first();
  const measure = () => page.evaluate(() => {
    const el = document.querySelector(".notification-popover .notification-subject");
    const r = document.createRange(); r.selectNodeContents(el); const rects = [...r.getClientRects()];
    const tb = r.getBoundingClientRect(); const eb = el.getBoundingClientRect(); const s = getComputedStyle(el);
    const li = el.closest("li"); const ls = getComputedStyle(li); const lb = li.getBoundingClientRect();
    return { text: el.textContent.trim().slice(0, 60), lines: rects.length, textRect: [tb.left, tb.top, tb.right, tb.bottom].map((v) => +v.toFixed(1)), btnRect: [eb.left, eb.top, eb.right, eb.bottom].map((v) => +v.toFixed(1)), pad: { l: +(tb.left - eb.left).toFixed(1), t: +(tb.top - eb.top).toFixed(1), r: +(eb.right - tb.right).toFixed(1), b: +(eb.bottom - tb.bottom).toFixed(1) }, btnStyle: { bg: s.backgroundColor, padding: s.padding, radius: s.borderRadius, outline: s.outline, boxShadow: s.boxShadow, lineHeight: s.lineHeight, fontSize: s.fontSize, scrollH: el.scrollHeight, clientH: el.clientHeight }, li: { bg: ls.backgroundColor, rect: [lb.left, lb.top, lb.right, lb.bottom].map(Math.round) } };
  });
  console.log("before", JSON.stringify(await measure()));
  const box = await subj.boundingBox();
  const clip = { x: box.x - 60, y: box.y - 20, width: Math.min(460, box.width + 140), height: box.height + 40 };
  await page.screenshot({ path: `${OUT}/a/a1-row-before.png`, clip });
  await subj.hover(); await page.waitForTimeout(400);
  console.log("hover", JSON.stringify(await measure()));
  await page.screenshot({ path: `${OUT}/a/a1-row-hover.png`, clip });
  // also find which rule paints hover
  const rules = await page.evaluate(() => { const out = []; for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch { continue; } const walk = (list) => { for (const r of list) { if (r.cssRules) walk(r.cssRules); if (r.selectorText && /:hover/.test(r.selectorText)) { const el = document.querySelector(".notification-popover .notification-subject"); const base = r.selectorText.split(",").map((s) => s.replace(/:hover/g, "").trim()).filter(Boolean); if (base.some((b) => { try { return el.matches(b) || el.closest("li")?.matches(b); } catch { return false; } })) out.push(r.cssText.slice(0, 220)); } } }; walk(rs); } return out; });
  console.log("hover rules", JSON.stringify(rules));
  // keyboard focus too
  await page.keyboard.press("Tab"); await page.waitForTimeout(200);
  await subj.focus(); await page.waitForTimeout(200);
  console.log("focus", JSON.stringify(await measure()));
  await page.screenshot({ path: `${OUT}/a/a1-row-focus.png`, clip });
  await ctx.close();
} finally { await browser.close(); }
