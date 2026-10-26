// A3: per-item location popover; find one listing 借出 with 0 and compare the count label with rows.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage(); await login(page);
  await page.goto(base + "/stock"); await settle(page, 1500);
  const triggers = page.locator(".data-table-scroll .stock-detail-chips button", { hasText: "个库位" });
  const n = await triggers.count(); console.log("triggers", n);
  const summary = [];
  let shot = 0;
  for (let i = 0; i < Math.min(n, 26); i++) {
    const t = triggers.nth(i); const label = (await t.textContent()).trim();
    await t.scrollIntoViewIfNeeded(); await t.click(); await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const pops = [...document.querySelectorAll(".detail-popover-content")];
      const p = pops.at(-1); if (!p) return null;
      const rows = [...p.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((c) => c.textContent.trim()).filter(Boolean).join(" | "));
      return { name: p.querySelector("strong")?.textContent, rows, total: p.querySelector(".stock-breakdown-total")?.textContent };
    });
    const avail = await t.evaluate((b) => [...b.closest("tr").querySelectorAll("td")].map((c) => c.textContent.trim()).slice(-3).join(" / "));
    summary.push({ label, avail, ...info });
    if (info && info.rows.some((r) => /借出|损坏/.test(r)) && shot < 3) { shot++; await page.screenshot({ path: `${OUT}/a/a3-popover-${shot}.png` }); }
    await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  }
  for (const s of summary) console.log(JSON.stringify(s));
  await ctx.close();
} finally { await browser.close(); }
