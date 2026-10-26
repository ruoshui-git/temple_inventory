// Shared helpers for the 2026-10-26 UI feedback audit. Run through scripts/dx + heavy + ui-visual-preflight.
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
export const base = "http://development.localhost:8000/inventory";
export const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit";
export async function launch(extraArgs = []) {
  return chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1", ...extraArgs] });
}
export const DESKTOP = { viewport: { width: 1440, height: 900 }, locale: "zh-CN" };
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" };
export async function login(page) {
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
}
export async function settle(page, ms = 1000) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); }
export function netLog(page, t0ref) {
  const log = [];
  page.on("request", (r) => { if (!/\/api\//.test(r.url())) return; r._s = Date.now(); });
  page.on("requestfinished", (r) => { if (!/\/api\//.test(r.url())) return; log.push({ m: r.url().replace(/^.*\/api\/method\//, "").replace(/^.*\/api\//, "api/").slice(0, 110), method: r.method(), start: r._s - t0ref.t, end: Date.now() - t0ref.t }); });
  page.on("requestfailed", (r) => { if (!/\/api\//.test(r.url())) return; log.push({ m: "FAILED " + r.url().slice(-80), start: r._s - t0ref.t, end: Date.now() - t0ref.t }); });
  return log;
}
