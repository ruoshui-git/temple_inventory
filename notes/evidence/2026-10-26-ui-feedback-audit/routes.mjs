// Part B: screenshot every main route at desktop 1440x900 and phone 390x844.
import { launch, login, settle, base, OUT, DESKTOP, PHONE } from "./lib.mjs";
const browser = await launch();
try {
  for (const [vp, opts] of [["d", DESKTOP], ["p", PHONE]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    await login(page);
    const links = {};
    async function grab(path, re) { await page.goto(base + path); await settle(page, 800); return page.evaluate((re) => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).find((h) => new RegExp(re).test(h)), re); }
    const strip = (h) => (h ? h.replace(/^\/inventory/, "") : null);
    links.item = strip(await grab("/stock", "/stock/items/[^/]+$"));
    links.movement = strip(await grab("/movements?view=records", "/movements/MAT"));
    links.loan = strip(await grab("/loans", "/loans/.+"));
    links.batch = strip(await grab("/stock/expiry", "/stock/batches/"));
    links.warehouse = strip(await grab("/stock/warehouses", "/stock/warehouses/.+"));
    links.count = strip(await grab("/counts", "/counts/[^/n][^/]*$"));
    console.log(vp, "links", JSON.stringify(links));
    const routes = [["dashboard", "/"], ["stock", "/stock"], ["item", links.item], ["expiry", "/stock/expiry"], ["batch", links.batch], ["warehouses", "/stock/warehouses"], ["warehouse", links.warehouse], ["categories", "/stock/categories"], ["damaged", "/stock/damaged"], ["movements-items", "/movements"], ["movements-records", "/movements?view=records"], ["movement", links.movement],
      ["new-receive", "/movements/new/Receive"], ["new-issue", "/movements/new/Issue"], ["new-transfer", "/movements/new/Transfer"], ["new-loan", "/movements/new/Loan"], ["new-return", "/movements/new/Return"], ["loans", "/loans"], ["loan", links.loan], ["counts", "/counts"], ["count-new", "/counts/new"], ["count", links.count], ["reports", "/reports"], ["activities", "/activities"], ["activity-new", "/activities/new"], ["drafts", "/drafts"], ["more", "/more"], ["settings", "/settings"], ["setup", "/settings/setup"], ["notif-settings", "/settings/notifications"], ["notifications", "/notifications"], ["item-new", "/stock/items/new"], ["item-edit", links.item ? links.item + "/edit" : null]];
    for (const [name, path] of routes) {
      if (!path) { console.log(name, "SKIP"); continue; }
      await page.goto(base + path); await settle(page, 1200);
      await page.screenshot({ path: `${OUT}/routes/${name}-${vp}.png`, fullPage: true });
      const info = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, docOverflowX: document.documentElement.scrollWidth - innerWidth, h1: document.querySelector("h1")?.textContent?.trim().slice(0, 40) }));
      console.log(vp, name, path, JSON.stringify(info));
    }
    // stock card view toggle
    await page.goto(base + "/stock"); await settle(page);
    const toggles = await page.evaluate(() => [...document.querySelectorAll("button,[role=radio],[role=tab]")].map((b) => (b.getAttribute("aria-label") || b.textContent).trim()).filter((t) => /卡片|表格|列表|视图/.test(t)));
    console.log(vp, "stock toggles", JSON.stringify(toggles));
    await ctx.close();
  }
} finally { await browser.close(); }
