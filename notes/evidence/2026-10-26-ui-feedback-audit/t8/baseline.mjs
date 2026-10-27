import { launch, login, settle, base } from "../lib.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t8";
await mkdir(OUT, { recursive: true });
const browser = await launch();
const results = [];
const onlyFamily = process.argv[2];
const onlyN = Number(process.argv[3] || 0);
try {
  for (const family of ["movements", "loans"]) for (const n of [1, 5, 10]) {
    if ((onlyFamily && family !== onlyFamily) || (onlyN && n !== onlyN)) continue;
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const calls = [];
    page.on("request", (req) => { if (req.url().includes("/api/method/temple_inventory.browse.") || req.url().includes("/api/method/browse.")) req.__started = Date.now(); req.__phase = phase; });
    page.on("requestfinished", (req) => {
      if (req.__started) calls.push({ method: req.url().split("/api/method/")[1]?.split("?")[0], ms: Date.now() - req.__started, phase: req.__phase });
    });
    let phase = "setup";
    await login(page); await page.goto(`${base}/${family}`); await settle(page, 1200);
    const toggles = page.locator(".data-table-group-toggle");
    const available = await toggles.count();
    const count = Math.min(n, available);
    for (let i = 0; i < count; i++) await toggles.nth(i).click();
    await page.waitForFunction((expected) => document.querySelectorAll(".data-table-group-toggle[aria-expanded='true']").length >= expected, count, { timeout: 30000 });
    const setupDeadline = Date.now() + 30000;
    while (
      Date.now() < setupDeadline &&
      calls.filter((call) => call.phase === "setup" && /operation_contributions|movement_history/.test(call.method || "")).length < count
    ) await page.waitForTimeout(100);
    await page.waitForFunction(() => document.querySelectorAll("tr[data-row-id^=\"history:\"]").length > 0, null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(250);
    const expandedBefore = await page.locator(".data-table-group-toggle[aria-expanded='true']").count();
    const historyRowsBefore = await page.locator("tr[data-row-id^='history:']").count();
    const doc = page.locator(".browse-row-link").first();
    await doc.waitFor({ state: "visible", timeout: 15000 });
    await doc.click(); await page.waitForTimeout(700);
    phase = "back";
    const backAt = Date.now();
    await page.goBack();
    await page.waitForURL(new RegExp(`/${family}(?:[/?#]|$)`), { timeout: 15000 }).catch(() => {});
    await page.waitForFunction((expected) => document.querySelectorAll(".data-table-group-toggle[aria-expanded='true']").length >= expected, count, { timeout: 30000 }).catch(() => {});
    const waitUntil = Date.now() + 30000;
    while (Date.now() < waitUntil && calls.filter((c) => c.phase === "back" && /operation_contributions|movement_history/.test(c.method || "")).length < count) await page.waitForTimeout(100);
    await page.waitForFunction(() => {
      const rows = document.querySelectorAll(".data-table-group-toggle[aria-expanded='true']");
      return [...rows].every((toggle) => {
        const group = toggle.closest("tr");
        const parent = group?.parentElement;
        const next = group?.nextElementSibling;
        const details = next?.classList.contains("data-table-group-detail-row") ? next : null;
        return !!details;
      });
    }, null, { timeout: 30000 }).catch(() => {});
    await page.waitForFunction((expected) => document.querySelectorAll("tr[data-row-id^=\"history:\"]").length >= expected, historyRowsBefore, { timeout: 30000 }).catch(() => {});
    const elapsed = Date.now() - backAt;
    await page.waitForTimeout(500);
    const historyRowsAfter = await page.locator("tr[data-row-id^='history:']").count();
    const relevant = calls.filter((c) => c.phase === "back" && /operation_contributions|movement_history/.test(c.method || ""));
    const result = { family, requestedExpanded: n, available, expandedBefore, historyRowsBefore, historyRowsAfter, restoreMs: elapsed, calls: relevant.length, callTimingsMs: relevant.map(x => x.ms), methods: relevant.map(x => x.method) };
    results.push(result); console.log(JSON.stringify(result));
    if (family === "movements" && n === 5) await page.screenshot({ path: `${OUT}/before-movements-5.jpg`, type: "jpeg", quality: 80 });
    if (family === "loans" && n === 5) await page.screenshot({ path: `${OUT}/before-loans-5.jpg`, type: "jpeg", quality: 80 });
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${OUT}/baseline-${onlyFamily || "all"}-${onlyN || "all"}.json`, JSON.stringify(results, null, 2));
