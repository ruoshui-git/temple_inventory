import { launch, login, settle, base } from "../lib.mjs";
import { mkdir } from "node:fs/promises";

const OUT = "/workspace/development/frappe-bench/apps/temple_inventory/notes/evidence/2026-10-26-ui-feedback-audit/t2";
await mkdir(OUT, { recursive: true });
const browser = await launch(["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]);
const capture = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log("CAPTURE", `${name}.png`);
};
const tryStep = async (name, fn) => {
  try { await fn(); }
  catch (error) { console.log("STEP FAIL", name, String(error).slice(0, 300)); }
};

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "zh-CN", permissions: ["camera"] });
  const page = await desktop.newPage();
  page.setDefaultTimeout(10000);
  await login(page);

  await tryStep("hover and toast", async () => {
    await page.goto(base + "/"); await settle(page, 1400);
    await page.locator("button[aria-label*='通知']").first().click(); await page.waitForTimeout(500);
    const subject = page.locator(".notification-popover .notification-subject").first();
    await subject.hover(); await page.waitForTimeout(250);
    await capture(page, "item-1-notification-hover-desktop");
    const inset = await page.evaluate(() => { const e = document.querySelector(".notification-popover .notification-subject"); if (!e) return null; const r = document.createRange(); r.selectNodeContents(e); const t = r.getBoundingClientRect(), b = e.getBoundingClientRect(); return { left: +(t.left-b.left).toFixed(1), right: +(b.right-t.right).toFixed(1) }; });
    console.log("NOTIFICATION HOVER INSET", JSON.stringify(inset));
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("temple-inventory-toast", { detail: { id: crypto.randomUUID(), message: "界面反馈：保存成功", tone: "success", persistent: true } })));
    await page.waitForTimeout(150);
    await capture(page, "item-11-toast-desktop");
  });

  await tryStep("table edges", async () => {
    await page.setViewportSize({ width: 1100, height: 800 });
    for (const [name, route] of [["records", "/movements?view=records"], ["stock", "/stock"]]) {
      await page.goto(base + route); await settle(page, 1400);
      const sc = page.locator(".data-table-scroll").first();
      await sc.evaluate((e) => { e.scrollLeft = 0; }); await page.waitForTimeout(250);
      await capture(page, `item-2-${name}-left-1100`);
      await sc.evaluate((e) => { e.scrollLeft = e.scrollWidth; }); await page.waitForTimeout(300);
      await capture(page, `item-2-${name}-right-1100`);
    }
  });

  await tryStep("SearchSelect", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/stock/items/new"); await settle(page, 1200);
    const input = page.locator(".search-select-input input").first();
    if (await input.count()) { await input.focus(); await input.evaluate((e) => e.select()); await page.waitForTimeout(250); }
    await capture(page, "item-10-search-select-desktop");
  });

  await tryStep("cropper", async () => {
    await page.goto(base + "/stock/items/ITM-000044/edit"); await settle(page, 1200);
    const dataUrl = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 1600; c.height = 1200; const g = c.getContext("2d"); g.fillStyle = "#488f79"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "white"; g.font = "bold 100px sans-serif"; g.fillText("1600 × 1200", 450, 620); return c.toDataURL("image/png"); });
    const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
    const input = page.locator("input[type=file][accept='image/*']").first();
    if (await input.count()) {
      await input.setInputFiles({ name: "t2-test.png", mimeType: "image/png", buffer }); await page.waitForTimeout(1800);
      await capture(page, "item-12-cropper-desktop");
      console.log("CROP COVERAGE", await page.locator("cropper-selection").getAttribute("initial-coverage").catch(() => null));
    }
  });

  await tryStep("scanner desktop", async () => {
    await page.goto(base + "/stock"); await settle(page, 1000);
    await page.locator("button[aria-label*='扫']").first().click(); await page.waitForTimeout(1200);
    await capture(page, "item-14-scanner-desktop");
  });
  await desktop.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN", permissions: ["camera"] });
  const mobile = await phone.newPage(); mobile.setDefaultTimeout(10000); await login(mobile);
  await tryStep("phone shell", async () => {
    await mobile.goto(base + "/stock"); await settle(mobile, 1200); await capture(mobile, "item-10-stock-phone-390x844");
    await mobile.goto(base + "/movements/new/Receive"); await settle(mobile, 1200); await capture(mobile, "item-10-editor-phone-390x844");
  });
  await tryStep("phone scanner", async () => {
    await mobile.goto(base + "/stock"); await settle(mobile, 1000);
    await mobile.locator("button[aria-label*='扫']").first().tap(); await mobile.waitForTimeout(1000);
    await capture(mobile, "item-14-scanner-phone-390x844");
  });
  await tryStep("phone toast and cropper", async () => {
    await mobile.goto(base + "/stock"); await settle(mobile, 500);
    await mobile.evaluate(() => window.dispatchEvent(new CustomEvent("temple-inventory-toast", { detail: { id: crypto.randomUUID(), message: "界面反馈：保存成功", tone: "success", persistent: true } })));
    await mobile.waitForTimeout(150); await capture(mobile, "item-11-toast-phone-390x844");
    await mobile.goto(base + "/stock/items/ITM-000044/edit"); await settle(mobile, 1200);
    const file = mobile.locator("input[type=file][accept='image/*']").first();
    if (await file.count()) {
      const data = await mobile.evaluate(() => { const c = document.createElement("canvas"); c.width = 1200; c.height = 1200; const g = c.getContext("2d"); g.fillStyle = "#488f79"; g.fillRect(0, 0, c.width, c.height); return c.toDataURL("image/png"); });
      await file.setInputFiles({ name: "t2-phone.png", mimeType: "image/png", buffer: Buffer.from(data.split(",")[1], "base64") }); await mobile.waitForTimeout(1200);
      await capture(mobile, "item-12-cropper-phone-390x844");
    }
  });
  await phone.close();

  const landscapeCtx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const landscape = await landscapeCtx.newPage(); landscape.setDefaultTimeout(10000); await login(landscape);
  await tryStep("landscape shell", async () => {
    await landscape.goto(base + "/stock"); await settle(landscape, 1200); await capture(landscape, "item-10-stock-landscape-844x390");
  });
  await landscapeCtx.close();
} finally { await browser.close(); }
