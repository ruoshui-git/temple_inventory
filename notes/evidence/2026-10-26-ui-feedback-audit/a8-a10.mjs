// A8 image crop initial box, A9 scanner panel (fake media), A10 dashboard recent records.
import { launch, login, settle, base, OUT } from "./lib.mjs";
const browser = await launch(["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]);
const step = async (name, fn) => { try { await fn(); } catch (e) { console.log("STEP FAIL", name, String(e).slice(0, 300)); } };
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", permissions: ["camera"] });
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); await login(page);
  await step("A8", async () => {
    await page.goto(base + "/stock/items/ITM-000044/edit"); await settle(page, 1500);
    await page.screenshot({ path: `${OUT}/a/a8-0-edit.png` });
    const dataUrl = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1200; const g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, 1600, 1200); gr.addColorStop(0, "#2a6"); gr.addColorStop(1, "#246"); g.fillStyle = gr; g.fillRect(0, 0, 1600, 1200); g.strokeStyle = "#fff"; g.lineWidth = 6; for (let x = 0; x <= 1600; x += 200) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 1200); g.stroke(); } for (let y = 0; y <= 1200; y += 200) { g.beginPath(); g.moveTo(0, y); g.lineTo(1600, y); g.stroke(); } g.fillStyle = "#fff"; g.font = "bold 120px sans-serif"; g.fillText("1600×1200", 480, 640); return c.toDataURL("image/png"); });
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    const input = page.locator(".main-image-preview").locator("xpath=ancestor::*[1]").locator("input[type=file][accept='image/*']").first();
    const target = (await input.count()) ? input : page.locator("input[type=file][accept='image/*']").first();
    await target.setInputFiles({ name: "test-1600x1200.png", mimeType: "image/png", buffer: buf });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/a/a8-1-cropper.png` });
    const geo = await page.evaluate(() => { const sel = document.querySelector("cropper-selection"); const img = document.querySelector("cropper-image"); const can = document.querySelector("cropper-canvas"); const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); }; return { canvas: r(can), image: r(img), selection: r(sel), selAttrs: sel ? { x: sel.x, y: sel.y, w: sel.width, h: sel.height, initialCoverage: sel.initialCoverage } : null }; });
    console.log("A8 crop geo", JSON.stringify(geo));
    await page.getByRole("button", { name: "取消此图片" }).click(); await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/a/a8-2-after-cancel.png` });
  });
  await step("A9", async () => {
    await page.goto(base + "/stock"); await settle(page, 1200);
    await page.locator("button[aria-label*='扫']").first().click(); await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/a/a9-scanner-d.png` });
    const info = await page.evaluate(() => ({ video: !!document.querySelector("video"), playing: (() => { const v = document.querySelector("video"); return v ? { w: v.videoWidth, h: v.videoHeight, paused: v.paused } : null; })(), text: [...document.querySelectorAll("[role=dialog] p, [role=dialog] [role=status], [role=dialog] [role=alert]")].map((p) => p.textContent.trim()).filter(Boolean).slice(0, 8) }));
    console.log("A9", JSON.stringify(info));
  });
  await step("overflow-item-new", async () => {
    await page.goto(base + "/stock/items/new"); await settle(page, 1200);
    const o = await page.evaluate(() => { const vw = document.documentElement.clientWidth; return { sw: document.documentElement.scrollWidth, vw, els: [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > vw + 1).slice(0, 8).map((e) => `${e.tagName}.${e.className.toString().slice(0, 40)} r=${Math.round(e.getBoundingClientRect().right)}`) }; });
    console.log("item-new overflow", JSON.stringify(o));
  });
  await step("A10", async () => {
    await page.goto(base + "/"); await settle(page, 1500);
    const sec = page.locator("h3, h4, strong, p", { hasText: /^最近记录$/ }).first();
    await sec.scrollIntoViewIfNeeded(); const b = await sec.boundingBox();
    await page.screenshot({ path: `${OUT}/a/a10-recent-d.png`, clip: { x: b.x - 20, y: b.y - 10, width: 560, height: 360 } });
  });
  await ctx.close();
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN", permissions: ["camera"] });
  const p = await pc.newPage(); p.setDefaultTimeout(10000); await login(p);
  await step("A10p", async () => {
    await p.goto(base + "/"); await settle(p, 1500);
    const sec = p.locator("h3, h4, strong, p", { hasText: /^最近记录$/ }).first();
    await sec.scrollIntoViewIfNeeded(); await p.evaluate(() => window.scrollBy(0, -60)); await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/a/a10-recent-p.png` });
  });
  await step("A9p", async () => {
    await p.goto(base + "/stock"); await settle(p, 1200);
    await p.locator("button[aria-label*='扫']").first().tap(); await p.waitForTimeout(3000);
    await p.screenshot({ path: `${OUT}/a/a9-scanner-p.png` });
  });
  await pc.close();
} finally { await browser.close(); }
