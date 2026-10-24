import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
import fs from "node:fs";

const out = new URL("./", import.meta.url);
const base = "http://development.localhost:8000";
const pages = {
  "loans-items": "/inventory/loans?view=items",
  "mv-items": "/inventory/movements?view=items",
  damaged: "/inventory/stock/damaged",
};
const widths = { 1440: 900, 1024: 768, 390: 844 };
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"],
});
const errors = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${page.url()} ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  const login = await page.evaluate(async () => {
    const response = await fetch("/api/method/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
    });
    return response.ok;
  });
  if (!login) throw new Error("Development login failed");

  for (const [width, height] of Object.entries(widths)) {
    await page.setViewportSize({ width: Number(width), height });
    for (const [name, path] of Object.entries(pages)) {
      try {
        await page.goto(base + path, { waitUntil: "networkidle", timeout: 45000 });
        await page.waitForTimeout(1800);
        if (await page.locator('[aria-busy="true"], .skeleton-block').count())
          await page.waitForTimeout(2500);
        const result = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          bodyScrollWidth: document.body.scrollWidth,
        }));
        if (result.scrollWidth > result.innerWidth)
          errors.push(`${name}@${width} horizontal overflow ${result.scrollWidth - result.innerWidth}px`);
        if (result.bodyScrollWidth > result.innerWidth)
          errors.push(`${name}@${width} body overflow ${result.bodyScrollWidth - result.innerWidth}px`);
        await page.screenshot({ path: new URL(`${name}-${width}.png`, out).pathname, fullPage: false });
      } catch (error) {
        errors.push(`${name}@${width} ${String(error).split("\n")[0]}`);
      }
    }
  }
  await context.close();
} finally {
  await browser.close();
}
fs.writeFileSync(new URL("capture-round-errors.txt", out), errors.join("\n"));
console.log(`captured ${Object.keys(pages).length * Object.keys(widths).length} pages; ${errors.length} issues`);
