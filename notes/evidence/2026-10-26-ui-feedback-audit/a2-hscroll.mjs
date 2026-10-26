// A2: step a wide table to its right and left limits at 1100px; log geometry and toggled classes.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: "zh-CN" });
  const page = await ctx.newPage(); await login(page);
  for (const [name, path] of [["records", "/movements?view=records"], ["stock", "/stock"]]) {
    await page.goto(base + path); await settle(page, 1500);
    await page.evaluate(() => window.scrollTo(0, 200)); await page.waitForTimeout(400);
    const state = () => page.evaluate(() => {
      const s = document.querySelector(".data-table-scroll"); const f = s.closest(".data-table-frame");
      const th = s.querySelector("th.data-table-settings-heading"); const tbl = s.querySelector("table");
      const hints = [...document.querySelectorAll(".data-table-overflow-hint")].map((h) => (h.className.includes("end") ? "E" : "S") + "@" + Math.round(h.getBoundingClientRect().x));
      const thumb = document.querySelector(".floating-table-scrollbar-thumb"); const prox = document.querySelector(".floating-table-scrollbar");
      const fb = getComputedStyle(f, "::before").opacity, fa = getComputedStyle(f, "::after").opacity;
      return { sl: Math.round(s.scrollLeft), sw: s.scrollWidth, cw: s.clientWidth, tblW: Math.round(tbl.getBoundingClientRect().width), cls: s.className.replace("data-table-scroll", "").trim(), settingsTh: th ? { pos: getComputedStyle(th).position, w: Math.round(th.getBoundingClientRect().width), x: Math.round(th.getBoundingClientRect().x) } : null, shade: `${fb}/${fa}`, hints, thumb: thumb ? `${thumb.style.left || thumb.style.transform}|${thumb.style.width}` : null, proxySL: prox ? Math.round(prox.scrollLeft) : null, proxySW: prox?.scrollWidth };
    });
    console.log(`## ${name} initial`, JSON.stringify(await state()));
    const box = await page.locator(".data-table-scroll").boundingBox();
    await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 200, 700));
    let i = 0, last = -1, same = 0;
    // step right with horizontal wheel (like trackpad), 60px per step
    while (same < 3 && i < 80) {
      await page.mouse.wheel(60, 0); await page.waitForTimeout(140); i++;
      const st = await state(); console.log(`R${i}`, JSON.stringify(st));
      if (st.sw - st.cw - st.sl < 130) await page.screenshot({ path: `${OUT}/a/a2-${name}-R${String(i).padStart(2, "0")}.png`, clip: { x: box.x + box.width - 420, y: box.y - 4, width: 430, height: Math.min(380, 790 - box.y) } });
      if (st.sl === last) same++; else same = 0; last = st.sl;
    }
    // small nudges at the right limit (trackpad jitter)
    for (const dx of [-8, 8, -2, 2, 30]) { await page.mouse.wheel(dx, 0); await page.waitForTimeout(160); const st = await state(); console.log(`J${dx}`, JSON.stringify(st)); await page.screenshot({ path: `${OUT}/a/a2-${name}-J${dx}.png`, clip: { x: box.x + box.width - 420, y: box.y - 4, width: 430, height: Math.min(380, 790 - box.y) } }); }
    i = 0; same = 0; last = -1;
    while (same < 3 && i < 80) {
      await page.mouse.wheel(-60, 0); await page.waitForTimeout(140); i++;
      const st = await state(); console.log(`L${i}`, JSON.stringify(st));
      if (st.sl < 130) await page.screenshot({ path: `${OUT}/a/a2-${name}-L${String(i).padStart(2, "0")}.png`, clip: { x: box.x - 6, y: box.y - 4, width: 430, height: Math.min(380, 790 - box.y) } });
      if (st.sl === last) same++; else same = 0; last = st.sl;
    }
    await page.screenshot({ path: `${OUT}/a/a2-${name}-full-left.png` });
  }
  await ctx.close();
} finally { await browser.close(); }
