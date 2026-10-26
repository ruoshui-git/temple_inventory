import { launch, login, settle, base, DESKTOP } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext(DESKTOP); const page = await ctx.newPage(); await login(page);
  for (const p of ["/stock", "/movements?view=records", "/loans", "/stock/expiry", "/stock/warehouses", "/counts", "/drafts"]) {
    await page.goto(base + p); await settle(page, 1000);
    const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")))].filter((h) => !/^\/inventory\/?$|^\/inventory\/(stock|movements|loans|counts|reports|activities|drafts|more|settings|notifications)$/.test(h)).slice(0, 12));
    console.log(p, JSON.stringify(hrefs));
  }
  await ctx.close();
} finally { await browser.close(); }
