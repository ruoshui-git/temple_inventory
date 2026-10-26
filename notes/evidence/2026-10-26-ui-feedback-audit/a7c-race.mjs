// A7c: type quantities right after adding lines (while the first autosave is in flight); check for lost input.
import { launch, login, settle, base, OUT, netLog } from "./lib.mjs";
const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const page = await ctx.newPage(); page.setDefaultTimeout(30000); await login(page);
  await page.goto(base + "/movements/new/Receive"); await settle(page, 1500);
  await page.getByRole("button", { name: "添加物品" }).first().click(); await settle(page, 1200);
  await page.locator(".preview-item-picker-dialog input").first().fill("A4"); await settle(page, 1500);
  const boxes = page.locator(".preview-item-picker-dialog tbody input[type=checkbox]");
  for (let i = 0; i < 3; i++) await boxes.nth(i).click();
  await page.getByRole("button", { name: /添加所选/ }).click();
  await page.waitForFunction(() => !document.querySelector(".preview-item-picker-dialog") && document.querySelectorAll("input[data-field=qty]").length >= 3, null, { timeout: 60000 });
  const t0 = { t: Date.now() }; const log = netLog(page, t0);
  const q = page.locator("input[data-field=qty]");
  const vals = ["11", "12", "13"]; const trace = [];
  for (let i = 0; i < 3; i++) { await q.nth(i).fill(vals[i]); trace.push(`${Date.now() - t0.t}ms set#${i}=${vals[i]}`); await page.waitForTimeout(400); }
  for (let k = 0; k < 10; k++) { trace.push(`${Date.now() - t0.t}ms values=${(await q.evaluateAll((e) => e.map((x) => x.value))).join(",")} url=${page.url().split("/").pop()}`); await page.waitForTimeout(800); }
  console.log(trace.join("\n"));
  for (const l of log) console.log("  NET", JSON.stringify(l));
  await page.screenshot({ path: `${OUT}/a/a7c-race-after.png` });
  await ctx.close();
} finally { await browser.close(); }
