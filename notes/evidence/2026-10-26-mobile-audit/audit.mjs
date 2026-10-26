// Mobile audit: screenshots + layout probes for every main route. Usage: node audit.mjs OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const [out] = process.argv.slice(2);
const base = "http://development.localhost:8000/inventory";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(1200); }
async function probe(page) {
  return page.evaluate(() => {
    const vw = innerWidth, r = [];
    const docOverflow = document.documentElement.scrollWidth - vw;
    const hints = [...document.querySelectorAll(".data-table-overflow-hint")].map((h) => {
      const b = h.getBoundingClientRect(); const f = h.closest(".data-table-frame, .data-table")?.getBoundingClientRect();
      const fixedAncestor = (() => { let n = h.parentElement; while (n && n !== document.body) { const s = getComputedStyle(n); if (s.transform !== "none" || s.filter !== "none" || s.contain.includes("paint") || s.willChange.includes("transform")) return n.className.toString().slice(0, 40); n = n.parentElement; } return ""; })();
      return { cls: h.className.includes("end") ? ">" : "<", x: Math.round(b.x), y: Math.round(b.y), frame: f ? [Math.round(f.x), Math.round(f.y), Math.round(f.right), Math.round(f.bottom)] : null, inFrame: f ? b.y >= f.y && b.bottom <= f.bottom && b.x >= f.x - 2 && b.right <= f.right + 2 : null, transformedAncestor: fixedAncestor };
    });
    const isScrollX = (n) => { const s = getComputedStyle(n); return /(auto|scroll|hidden|clip)/.test(s.overflowX); };
    const overflowEls = [];
    for (const el of document.querySelectorAll("body *")) {
      const b = el.getBoundingClientRect(); if (!b.width || b.right <= vw + 1) continue;
      let p = el.parentElement, clipped = false; while (p) { if (isScrollX(p) && p.getBoundingClientRect().right <= vw + 1) { clipped = true; break; } p = p.parentElement; }
      if (!clipped && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).position !== "fixed") overflowEls.push(`${el.tagName}.${el.className.toString().slice(0, 40)}→${Math.round(b.right)}`);
    }
    const small = [...document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select, [role=tab], [role=menuitem]")].filter((e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width && b.height && s.visibility !== "hidden" && b.top < innerHeight && b.bottom > 0 && (b.height < 32 || b.width < 32) && !e.closest("[inert]"); }).map((e) => `${e.tagName}"${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 12)}"${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    return { docOverflow, hints, overflowEls: overflowEls.slice(0, 6), small: small.slice(0, 10), smallCount: small.length };
  });
}
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
  const links = {};
  async function grab(path, re) { await page.goto(base + path); await settle(page); return page.evaluate((re) => [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")).find((h) => new RegExp(re).test(h)), re); }
  links.item = await grab("/stock", "/stock/items/[^/]+$");
  links.movement = await grab("/movements?view=records", "/movements/MAT");
  links.loan = await grab("/movements?view=records", "/loans/");
  links.activity = await grab("/activities", "/activities/[^/n][^/]*$");
  links.count = await grab("/counts", "/counts/[^/n][^/]*$");
  links.batch = await grab("/stock/expiry", "/stock/batches/");
  links.warehouse = await grab("/stock/warehouses", "/stock/warehouses/.+");
  console.log("links", JSON.stringify(links));
  const strip = (h) => h ? h.replace(/^\/inventory/, "") : null;
  const routes = [["home", "/"], ["stock", "/stock"], ["expiry", "/stock/expiry"], ["warehouses", "/stock/warehouses"], ["categories", "/stock/categories"], ["damaged", "/stock/damaged"], ["movements-items", "/movements"], ["movements-records", "/movements?view=records"], ["receive-new", "/movements/new/Receive"], ["transfer-new", "/movements/new/Transfer"], ["counts", "/counts"], ["count-new", "/counts/new"], ["activities", "/activities"], ["activity-new", "/activities/new"], ["drafts", "/drafts"], ["reports", "/reports"], ["notifications", "/notifications"], ["settings", "/settings"], ["setup", "/settings/setup"], ["notif-settings", "/settings/notifications"], ["item-new", "/stock/items/new"],
    ["item", strip(links.item)], ["item-edit", links.item ? strip(links.item) + "/edit" : null], ["movement", strip(links.movement)], ["loan", strip(links.loan)], ["activity", strip(links.activity)], ["count", strip(links.count)], ["batch", strip(links.batch)], ["warehouse", strip(links.warehouse)]];
  for (const [name, path] of routes) {
    if (!path) { console.log(name, "SKIP no link"); continue; }
    await page.goto(base + path); await settle(page);
    await page.screenshot({ path: `${out}/${name}-1.png` });
    const p1 = await probe(page);
    await page.mouse.wheel(0, 700); await page.evaluate(() => window.scrollBy(0, 700)); await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/${name}-2.png` });
    const p2 = await probe(page);
    console.log(`## ${name} ${path}\n  p1 ${JSON.stringify(p1)}\n  p2 hints ${JSON.stringify(p2.hints)} overflow ${JSON.stringify(p2.overflowEls)}`);
  }
  await ctx.close();
} finally { await browser.close(); }
