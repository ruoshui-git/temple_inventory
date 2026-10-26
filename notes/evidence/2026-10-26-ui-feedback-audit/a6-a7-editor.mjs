// A6 batch detail + conversion focus; A7 reopen autosaved draft timing.
import { launch, login, settle, base, OUT, netLog } from "./lib.mjs";
const browser = await launch();
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log("STEP FAIL", name, String(e).slice(0, 300)); } };
const focusInfo = (page) => page.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName}.${a.className.toString().slice(0, 30)} "${(a.getAttribute("aria-label") || a.textContent || a.value || "").trim().slice(0, 30)}" field=${a.dataset?.field || ""}` : "none"; });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
  await step("A7", async () => {
    const SKIP = true; let name = "MAT-STE-2026-01581";
    if (!SKIP) {
    await page.goto(base + "/movements/new/Receive"); await settle(page, 1500);
    await page.getByRole("button", { name: "添加物品" }).first().click(); await settle(page, 1200);
    await page.locator(".preview-item-picker-dialog input").first().fill("A4"); await settle(page, 1500);
    const boxes = page.locator(".preview-item-picker-dialog tbody input[type=checkbox]");
    for (let i = 0; i < 6; i++) { await boxes.nth(i).click(); await page.waitForTimeout(80); }
    await page.getByRole("button", { name: /添加所选/ }).click(); await settle(page, 1500);
    const qtys = page.locator("input[data-field=qty]");
    for (let i = 0; i < await qtys.count(); i++) await qtys.nth(i).fill(String(i + 1));
    // wait for autosave to put a docname into the URL
    name = null;
    for (let k = 0; k < 60; k++) { const m = page.url().match(/movements\/(MAT-[^/?#]+)/); if (m) { name = m[1]; break; } await page.waitForTimeout(500); }
    console.log("A7 autosaved draft", name, page.url());
    await page.screenshot({ path: `${OUT}/a/a7-0-editor-autosaved.png` });
    // A11: manual save toast
    await page.locator("input[data-field=qty]").first().fill("7");
    await page.getByRole("button", { name: "保存草稿" }).first().click();
    let toast = null;
    for (let k = 0; k < 80; k++) { toast = await page.evaluate(() => { const t = document.querySelector(".preview-toast"); if (!t) return null; const b = t.getBoundingClientRect(); return { text: t.textContent.trim().slice(0, 60), r: [b.x, b.y, b.width, b.height].map(Math.round), vw: innerWidth, vh: innerHeight }; }); if (toast) break; await page.waitForTimeout(100); }
    console.log("A11 toast", JSON.stringify(toast));
    await page.screenshot({ path: `${OUT}/a/a11-toast-d.png` });
    }
    await settle(page, 1500);
    await page.goto(base + "/"); await settle(page, 1500);
    await page.goto(base + "/drafts"); await settle(page, 1500);
    await page.screenshot({ path: `${OUT}/a/a7-drafts.png` });
    const t0 = { t: Date.now() }; const log = netLog(page, t0);
    const li = page.locator("li").filter({ hasText: "6 种物品 → TMP" }).first();
    await li.hover(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/a/a7-drafts-hover.png` });
    const btn = li.getByRole("button", { name: "继续编辑" });
    console.log("A7 continue btn visible before hover?", await btn.isVisible());
    t0.t = Date.now();
    await btn.click();
    const shots = [500, 1500, 3000]; let si = 0; let ready = -1;
    for (let k = 0; k < 600; k++) {
      const el = Date.now() - t0.t;
      if (si < shots.length && el >= shots[si]) { await page.screenshot({ path: `${OUT}/a/a7-t${shots[si]}.png` }); si++; }
      const st = await page.evaluate(() => { const q = [...document.querySelectorAll("input[data-field=qty]")]; return { n: q.length, enabled: q.filter((x) => !x.disabled).length }; });
      if (ready < 0 && st.n >= 6 && st.enabled === st.n) { ready = el; await page.screenshot({ path: `${OUT}/a/a7-ready.png` }); if (si >= shots.length) break; }
      if (ready >= 0 && si >= shots.length) break;
      await page.waitForTimeout(50);
    }
    await settle(page, 800);
    console.log("A7 ready after", ready, "ms; url", page.url());
    const counts = {}; for (const l of log) { const k = l.m.split("?")[0]; counts[k] = (counts[k] || 0) + 1; }
    console.log("A7 request counts", JSON.stringify(counts));
    for (const l of log) console.log("  NET", JSON.stringify(l));
  });
  await ctx.close();
} finally { await browser.close(); }
