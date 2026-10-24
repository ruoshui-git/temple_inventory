// Capture every main page at three widths for the Phase 6 visual pass.
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";

const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });
const base = "http://development.localhost:8000";
const enc = encodeURIComponent;
const pages = {
  dashboard: "/inventory/",
  stock: "/inventory/stock",
  "stock-cards": "/inventory/stock?view=cards",
  expiry: "/inventory/stock/expiry",
  warehouses: "/inventory/stock/warehouses",
  damaged: "/inventory/stock/damaged",
  categories: "/inventory/stock/categories",
  item: "/inventory/stock/items/ITM-000001",
  batch: `/inventory/stock/batches/${enc("ITM-000001 BAT 000001")}`,
  "mv-items": "/inventory/movements?view=items",
  "mv-records": "/inventory/movements?view=records",
  "mv-detail": "/inventory/movements/MAT-STE-2026-00004",
  "loans-items": "/inventory/loans?view=items",
  "loans-records": "/inventory/loans?view=records",
  "loan-detail": "/inventory/loans/MAT-STE-2026-01530",
  counts: "/inventory/counts",
  "count-detail": "/inventory/counts/MAT-RECO-2026-00001",
  reports: "/inventory/reports",
  activities: "/inventory/activities",
  "activity-detail": "/inventory/activities/vknupp7j6e",
  drafts: "/inventory/drafts",
  more: "/inventory/more",
  settings: "/inventory/settings",
  notifications: "/inventory/notifications",
  "notify-settings": "/inventory/settings/notifications",
  setup: "/inventory/settings/setup",
};
const widths = { 1440: 900, 1024: 768, 390: 844 };
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"],
});
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(base + "/login");
await page.evaluate(async () => {
  await fetch("/api/method/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
  });
});
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url()} ${e.message}`));
for (const [w, h] of Object.entries(widths)) {
  await page.setViewportSize({ width: Number(w), height: h });
  for (const [name, path] of Object.entries(pages)) {
    try {
      await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
    } catch (e) {
      errors.push(`${name}@${w} goto ${e.message.split("\n")[0]}`);
    }
    await page.waitForTimeout(1500);
    const busy = await page.locator('[aria-busy="true"], .skeleton-block').count();
    if (busy) await page.waitForTimeout(3000);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) errors.push(`${name}@${w} horizontal page overflow ${overflow}px`);
    await page.screenshot({ path: `${out}/${name}-${w}.png`, fullPage: false });
  }
}
fs.writeFileSync(`${out}/errors.txt`, errors.join("\n"));
await browser.close();
console.log("done", errors.length, "issues");
