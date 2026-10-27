import { launch, login, settle, base } from "../lib.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t8";
await mkdir(OUT, { recursive: true });
const browser = await launch();
const results = [];
try {
  for (const family of ["movements", "loans"]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    const details = [];
    page.on("requestfinished", async (request) => {
      const method = request.url().split("/api/method/")[1]?.split("?")[0];
      if (!/browse\.(movement_history|operation_contributions)$/.test(method || "")) return;
      const body = request.postDataJSON();
      const response = await request.response();
      const json = await response?.json().catch(() => null);
      details.push({ method, args: body, page: json?.message });
    });
    await login(page); await page.goto(`${base}/${family}`); await settle(page, 1200);
    const toggles = page.locator(".data-table-group-toggle");
    const count = Math.min(5, await toggles.count());
    for (let i = 0; i < count; i++) await toggles.nth(i).click();
    await page.waitForFunction((n) => document.querySelectorAll(".data-table-group-toggle[aria-expanded='true']").length >= n, count);
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline && details.length < count) await page.waitForTimeout(100);
    const source = details.slice(0, count);
    if (source.length !== count) throw new Error(`${family}: captured ${source.length}/${count} single-group requests`);
    const groups = source.map(({ args }) => family === "movements"
      ? { id: args.item_code, item_code: args.item_code, start: 0, page_length: 30, sort_by: args.sort_by, sort: args.sort }
      : { id: args.item_code, item_code: args.item_code, outcome: args.outcome, history_scope: args.history_scope, history_sort_by: args.history_sort_by, history_sort: args.history_sort, start: 0, page_length: 30 });
    const endpoint = family === "movements" ? "movement_history_many" : "operation_contributions_many";
    const payload = { query: source[0].args.query, groups, ...(family === "loans" ? { records: source[0].args.records } : {}) };
    const start = Date.now();
    const result = await page.evaluate(async ({ endpoint, payload }) => {
      const response = await fetch(`/api/method/temple_inventory.browse.${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Frappe-CSRF-Token": window.csrf_token }, body: JSON.stringify(payload) });
      return { status: response.status, body: await response.json() };
    }, { endpoint, payload });
    const duration = Date.now() - start;
    const batchResults = result.body?.message?.results || [];
    const parity = batchResults.map((batch, i) => JSON.stringify(batch.page?.rows) === JSON.stringify(source[i].page?.rows));
    const record = { family, groups: count, endpoint, status: result.status, durationMs: duration, requestCount: 1, results: batchResults.length, rowCounts: batchResults.map((entry) => entry.page?.rows?.length || 0), parity, errors: batchResults.filter((entry) => entry.error).map((entry) => entry.error) };
    results.push(record); console.log(JSON.stringify(record));
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(`${OUT}/benchmark-batch.json`, JSON.stringify(results, null, 2));
