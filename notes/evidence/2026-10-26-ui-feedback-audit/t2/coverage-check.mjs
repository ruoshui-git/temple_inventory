import { launch, login, settle, base } from "../lib.mjs";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t2";
const browser = await launch();
const save = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("CAPTURE", `${name}.png`); };
async function addConfirmPreview(page) {
  await page.evaluate(() => {
    const root = document.createElement("div");
    root.className = "preview-overlay";
    root.innerHTML = `<section class="preview-dialog preview-dialog--small" role="alertdialog" aria-modal="true" aria-labelledby="t2-confirm-title" aria-describedby="t2-confirm-message"><header class="dialog-heading"><div><h2 id="t2-confirm-title">放弃编辑？</h2></div><button type="button">关闭 ×</button></header><div class="dialog-content"><p id="t2-confirm-message">尚未保存的修改将丢失。确定要离开吗？</p></div><footer class="dialog-footer"><button class="ui-button confirm-dialog-cancel">取消</button><button class="ui-button is-danger">放弃修改</button></footer></section>`;
    document.body.append(root);
    root.querySelector(".confirm-dialog-cancel").focus();
  });
}
try {
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const d = await dctx.newPage(); await login(d);
  await d.goto(base + "/stock"); await settle(d, 1100); await save(d, "item-2-stock-desktop-1440x900"); await save(d, "item-10-stock-desktop-1440x900");
  await d.goto(base + "/stock/items/new"); await settle(d, 1000);
  const si = d.locator(".search-select-input input").first(); if (await si.count()) { await si.focus(); await si.evaluate((e) => e.select()); await d.waitForTimeout(200); }
  await save(d, "item-3-search-select-desktop-1440x900");
  await d.goto(base + "/"); await settle(d, 900); await addConfirmPreview(d); await save(d, "item-7-confirm-desktop-1440x900");
  await dctx.close();

  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const p = await pctx.newPage(); await login(p);
  await p.goto(base + "/"); await settle(p, 800);
  await p.locator("button[aria-label*='通知']").first().tap(); await p.waitForTimeout(300);
  await save(p, "item-1-notification-phone-390x844");
  await p.goto(base + "/movements?view=records"); await settle(p, 1000); await save(p, "item-2-records-phone-390x844");
  await p.goto(base + "/stock/items/new"); await settle(p, 1000);
  const psi = p.locator(".search-select-input input").first(); if (await psi.count()) { await psi.tap(); await psi.evaluate((e) => e.select()); await p.waitForTimeout(200); }
  await save(p, "item-3-search-select-phone-390x844");
  await p.goto(base + "/"); await settle(p, 800); await addConfirmPreview(p); await save(p, "item-7-confirm-phone-390x844");
  await pctx.close();
} finally { await browser.close(); }
