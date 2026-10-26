// Probe the stock table's 可用数量 / 借出 cells for the first rows.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" }); const page = await ctx.newPage(); await login(page);
  await page.goto(base + "/stock"); await settle(page, 2500);
  const r = await page.evaluate(() => { const hs = [...document.querySelectorAll(".data-table-scroll thead th")].map((h) => h.textContent.trim()); const rows = [...document.querySelectorAll(".data-table-scroll tbody tr")].slice(0, 9).map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim().slice(0, 14))); const s = document.querySelector(".data-table-scroll"); return { hs, rows, sw: s.scrollWidth, cw: s.clientWidth }; });
  console.log(JSON.stringify(r));
  await page.evaluate(() => { const s = document.querySelector(".data-table-scroll"); s.scrollLeft = s.scrollWidth; }); await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/a/stock-scrolled-right.png` });
  await ctx.close();
} finally { await browser.close(); }
