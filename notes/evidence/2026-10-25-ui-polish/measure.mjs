// Measure visible icon-only controls across routed surfaces. Usage: node measure.mjs
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const base = process.env.TI_UI_BASE_URL || "http://127.0.0.1:8091";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: [
    "--no-sandbox",
    "--host-resolver-rules=MAP development.localhost 127.0.0.1",
  ],
});
const pages = [
  "",
  "stock",
  "movements",
  "loans",
  "drafts",
  "activities",
  "counts",
  "reports",
  "stock/expiry",
  "stock/warehouses",
  "stock/damaged",
  "stock/categories",
  "more",
  "notifications",
];
function probe() {
  const rows = [];
  for (const b of document.querySelectorAll(
    "button, a[role=button], [role=menuitem]",
  )) {
    const r = b.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const st = getComputedStyle(b);
    if (st.visibility === "hidden" || st.display === "none") continue;
    const text = (b.innerText || "").trim();
    const svg = b.querySelector("svg");
    if (!svg || b.classList.contains("item-image-button")) continue;
    const knownIconOnly = b.matches(
      ".icon-button, .icon-only, .popup-menu-trigger, [aria-label]",
    );
    if (!knownIconOnly) continue;
    if (text) continue; // icon-only
    const s = svg.getBoundingClientRect();
    const dx = s.left + s.width / 2 - (r.left + r.width / 2);
    const dy = s.top + s.height / 2 - (r.top + r.height / 2);
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
      rows.push({
        cls: b.className.toString().slice(0, 60),
        label: b.getAttribute("aria-label") || b.title || "",
        w: Math.round(r.width),
        h: Math.round(r.height),
        dx: +dx.toFixed(1),
        dy: +dy.toFixed(1),
        display: st.display,
      });
  }
  return rows;
}
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
}
try {
  let violations = 0;
  for (const [vp, size] of [
    ["desk", { width: 1440, height: 900 }],
    ["narrow", { width: 1100, height: 800 }],
    ["mob", { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({
      viewport: size,
      deviceScaleFactor: 3,
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    await page.goto(base + "/login");
    await page.evaluate(() =>
      fetch("/api/method/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
      }),
    );
    for (const p of pages) {
      await page.goto(`${base}/inventory/${p}`);
      await settle(page);
      if (vp === "mob" && p === "stock") {
        const geometry = await page.evaluate(() => {
          const primary = document.querySelector(
            ".browse-split-button > .ui-button",
          );
          const chevron = document.querySelector(
            ".browse-split-button > .popup-menu-host > .popup-menu-trigger",
          );
          if (!primary || !chevron) return null;
          const a = primary.getBoundingClientRect();
          const b = chevron.getBoundingClientRect();
          return {
            primary: { top: a.top, bottom: a.bottom },
            chevron: { top: b.top, bottom: b.bottom },
            maxEdgeDifference: Math.max(
              Math.abs(a.top - b.top),
              Math.abs(a.bottom - b.bottom),
            ),
          };
        });
        console.log(
          `Mobile split geometry 390x844: ${JSON.stringify(geometry)}`,
        );
        if (!geometry || geometry.maxEdgeDifference > 0.5) violations += 1;
      }
      const found = await page.evaluate(probe);
      violations += found.length;
      for (const r of found) console.log(vp, "/" + p, JSON.stringify(r));
    }
    await ctx.close();
  }
  console.log(`Centering violations > 0.5px: ${violations}`);
  if (violations) process.exitCode = 1;
} finally {
  await browser.close();
}
