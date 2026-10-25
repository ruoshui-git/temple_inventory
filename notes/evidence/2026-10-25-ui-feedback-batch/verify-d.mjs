// Claude's live keyboard checks for Task D. Usage: node verify-d.mjs OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const [out] = process.argv.slice(2);
const base = "http://development.localhost:8000/inventory";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(900); }
const focused = (page) => page.evaluate(() => { const a = document.activeElement; return `${a?.tagName}.${a?.className?.toString().slice(0, 30)} row=${a?.closest("tr")?.dataset.rowId || ""}`; });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
  await page.goto(base + "/movements"); await settle(page);
  const firstRow = page.locator(".data-table-scroll tbody tr[data-row-id]").first();
  await page.locator(".data-table-scroll tbody tr[data-row-id][tabindex='0']").first().focus();
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  console.log("after ↓↓", await focused(page));
  await page.screenshot({ path: `${out}/d-movements-row-focus.png` });
  await page.keyboard.press("Enter"); await settle(page);
  console.log("after Enter url", page.url().replace(base, ""), "overlay", await page.locator(".preview-overlay").count());
  if (await page.locator(".preview-overlay").count()) await page.keyboard.press("Escape"); else await page.goBack();
  await settle(page);
  console.log("after return", page.url().replace(base, ""), await focused(page));
  // Ctrl+Enter on an empty receive editor should not submit anything
  await page.goto(base + "/movements/new/Receive"); await settle(page);
  await page.locator("input").first().focus();
  await page.keyboard.press("Control+Enter"); await page.waitForTimeout(800);
  console.log("ctrl+enter url", page.url().replace(base, ""), "dialogs", await page.locator(".preview-overlay, [role=dialog]").count());
  await page.screenshot({ path: `${out}/d-ctrl-enter-empty.png` });
  await ctx.close();
} finally { await browser.close(); }
