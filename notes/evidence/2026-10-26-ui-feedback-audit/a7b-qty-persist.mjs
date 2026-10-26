// A7b: verify quantity edits persist in an autosaved draft (stable editor), and log save calls.
import { launch, login, settle, base, OUT, netLog } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000); await login(page);
  const t0 = { t: Date.now() }; const log = netLog(page, t0);
  await page.goto(base + "/movements/MAT-STE-2026-01581");
  for (let k = 0; k < 400; k++) { const ok = await page.evaluate(() => { const q = [...document.querySelectorAll("input[data-field=qty]")]; return q.length >= 6 && q.every((x) => !x.disabled); }); if (ok) break; await page.waitForTimeout(100); }
  await page.waitForTimeout(1000);
  log.length = 0; t0.t = Date.now();
  const q = page.locator("input[data-field=qty]");
  await q.nth(0).click(); await q.nth(0).fill("5"); await page.waitForTimeout(300);
  await q.nth(1).click(); await page.keyboard.press("Control+A"); await page.keyboard.type("6"); await page.waitForTimeout(300);
  await page.locator("body").click({ position: { x: 5, y: 400 } });
  console.log("values now", await q.evaluateAll((els) => els.map((e) => e.value)));
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/a/a7b-after-edit.png` });
  console.log("status text", await page.evaluate(() => [...document.querySelectorAll("[role=status], .editor-save-state, .draft-state")].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 5)));
  for (const l of log) console.log("  NET", JSON.stringify(l));
  await ctx.close();
} finally { await browser.close(); }
