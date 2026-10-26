import { launch, login, settle, base, netLog } from "../lib.mjs";

const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t1";
const browser = await launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await login(page);
  await page.goto(`${base}/movements/new/Receive`);
  await settle(page, 1000);
  await page.getByRole("button", { name: "添加物品" }).first().click();
  await settle(page, 1000);
  await page.locator(".preview-item-picker-dialog input").first().fill("A4");
  await settle(page, 1000);
  const checks = page.locator(".preview-item-picker-dialog tbody input[type=checkbox]");
  if ((await checks.count()) < 6) throw new Error("Picker returned fewer than six A4 items");
  for (let index = 0; index < 6; index++) await checks.nth(index).click();

  const started = Date.now();
  const log = netLog(page, { get t() { return started; } });
  const add = page.getByRole("button", { name: /添加所选/ });
  await add.click();
  let pickerClosed = -1;
  let interactive = -1;
  for (let index = 0; index < 1200; index++) {
    const elapsed = Date.now() - started;
    const state = await page.evaluate(() => {
      const quantities = [...document.querySelectorAll("input[data-field=qty]")];
      return {
        pickerOpen: !!document.querySelector(".preview-item-picker-dialog"),
        lineCount: quantities.length,
        enabledCount: quantities.filter((input) => !input.disabled).length,
      };
    });
    if (pickerClosed < 0 && !state.pickerOpen) pickerClosed = elapsed;
    if (state.lineCount >= 6 && state.enabledCount >= 6) {
      interactive = elapsed;
      break;
    }
    if (index === 20) await page.screenshot({ path: `${OUT}/add-six-waiting.png` });
    await page.waitForTimeout(50);
  }
  if (interactive < 0) throw new Error("Six added lines did not become interactive");
  await page.screenshot({ path: `${OUT}/add-six-interactive.png`, fullPage: true });
  let documentName = "";
  for (let index = 0; index < 60; index++) {
    documentName = page.url().match(/movements\/(MAT-[^/?#]+)/)?.[1] || "";
    if (documentName) break;
    await page.waitForTimeout(500);
  }
  if (!documentName) throw new Error(`Could not find autosaved document in ${page.url()}`);
  console.log(JSON.stringify({ phase: "add-six", pickerClosedMs: pickerClosed, interactiveMs: interactive, documentName }));
  for (const request of log) console.log("NET", JSON.stringify(request));

  await page.goto(`${base}/drafts`);
  await settle(page, 1200);
  const row = page.locator(".draft-entry").filter({ hasText: "6 种物品" }).first();
  await row.waitFor({ state: "visible", timeout: 10000 });
  console.log("reopen-row", (await row.innerText()).replace(/\s+/g, " ").slice(0, 180));
  await row.hover();
  const reopenStarted = Date.now();
  await row.getByRole("button", { name: "继续编辑" }).click();
  let reopenInteractive = -1;
  for (let index = 0; index < 1200; index++) {
    const elapsed = Date.now() - reopenStarted;
    const state = await page.evaluate(() => {
      const quantities = [...document.querySelectorAll("input[data-field=qty]")];
      return {
        lineCount: quantities.length,
        enabledCount: quantities.filter((input) => !input.disabled).length,
      };
    });
    if (index === 10) await page.screenshot({ path: `${OUT}/reopen-six-500ms.png` });
    if (index === 30) await page.screenshot({ path: `${OUT}/reopen-six-1500ms.png` });
    if (index === 60) await page.screenshot({ path: `${OUT}/reopen-six-3000ms.png` });
    if (state.lineCount >= 6 && state.enabledCount >= 6) {
      reopenInteractive = elapsed;
      break;
    }
    await page.waitForTimeout(50);
  }
  if (reopenInteractive < 0) throw new Error("Six reopened lines did not become interactive");
  await page.screenshot({ path: `${OUT}/reopen-six-interactive.png`, fullPage: true });
  console.log(JSON.stringify({ phase: "reopen-six", interactiveMs: reopenInteractive, documentName }));
  await context.close();
} finally {
  await browser.close();
}
