import { launch, login, settle, base } from "../lib.mjs";
const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t2";
const browser = await launch();
try {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const p = await phone.newPage(); p.setDefaultTimeout(10000); await login(p);
  await p.goto(base + "/stock/items/ITM-000044/edit"); await settle(p, 1200);
  const data = await p.evaluate(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 1200; const g = c.getContext("2d"); g.fillStyle = "#488f79"; g.fillRect(0, 0, c.width, c.height); return c.toDataURL("image/png"); });
  await p.locator("input[type=file][accept='image/*']").first().setInputFiles({ name: "t2-phone.png", mimeType: "image/png", buffer: Buffer.from(data.split(",")[1], "base64") });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: `${OUT}/item-12-cropper-phone-afterfix.png` });
  console.log("CAPTURE item-12-cropper-phone-afterfix.png");
  await phone.close();

  const landscape = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const l = await landscape.newPage(); l.setDefaultTimeout(10000); await login(l);
  await l.goto(base + "/stock"); await settle(l, 1200);
  await l.screenshot({ path: `${OUT}/item-10-stock-landscape-afterfix.png` });
  const visibleRows = await l.locator("[data-browse-row]").evaluateAll((rows) => rows.filter((row) => { const r = row.getBoundingClientRect(); return r.height > 0 && r.top < innerHeight && r.bottom > 0; }).length);
  console.log("CAPTURE item-10-stock-landscape-afterfix.png", "visible table rows", visibleRows);
  await landscape.close();
} finally { await browser.close(); }
