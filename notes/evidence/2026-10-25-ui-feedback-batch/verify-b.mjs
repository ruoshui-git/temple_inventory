// Claude's live checks for Task B (phone sheets, Back closes overlays). Usage: node verify-b.mjs OUTDIR
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";
const [out] = process.argv.slice(2);
const base = "http://development.localhost:8000/inventory";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium-headless-shell", args: ["--no-sandbox", "--host-resolver-rules=MAP development.localhost 127.0.0.1"] });
async function settle(page) { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(800); }
const sheet = (page) => page.locator(".popup-menu-sheet-overlay");
const hist = (page) => page.evaluate(() => [history.length, location.pathname, JSON.stringify(history.state?.tiOverlay ?? null)].join(" "));
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: "zh-CN" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.evaluate(() => fetch("/api/method/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usr: "Administrator", pwd: "admin" }) }));
  await page.goto(base + "/stock"); await settle(page);
  const chevron = page.locator(".browse-split-button .popup-menu-trigger");
  console.log("start", await hist(page));
  // 1 backdrop tap
  await chevron.tap(); await page.waitForTimeout(400);
  console.log("open", await sheet(page).count(), await hist(page));
  await page.touchscreen.tap(195, 120); await page.waitForTimeout(500);
  console.log("after backdrop tap open=", await sheet(page).count(), await hist(page));
  // 2 cancel
  await chevron.tap(); await page.waitForTimeout(400);
  await page.getByRole("button", { name: "取消" }).tap(); await page.waitForTimeout(500);
  console.log("after 取消 open=", await sheet(page).count(), await hist(page));
  // 3 Back
  await chevron.tap(); await page.waitForTimeout(400);
  await page.goBack(); await page.waitForTimeout(700);
  console.log("after Back open=", await sheet(page).count(), await hist(page));
  // 4 Back again should now leave /stock (no stale markers)
  // 5 item that navigates
  await chevron.tap(); await page.waitForTimeout(400);
  await sheet(page).getByRole("menuitem").first().tap();
  await page.waitForTimeout(2000);
  console.log("after menu item nav", await hist(page));
  await page.screenshot({ path: `${out}/b-after-menu-nav.png` });
  await page.goBack(); await settle(page);
  console.log("Back from editor ->", await hist(page), "sheet open=", await sheet(page).count());
  // 6 sort sheet
  await page.goto(base + "/stock"); await settle(page);
  await page.locator(".browse-sort-control .popup-menu-trigger").first().tap(); await page.waitForTimeout(400);
  const radio = sheet(page).getByRole("menuitemradio").nth(1);
  await radio.tap(); await settle(page);
  console.log("after sort pick open=", await sheet(page).count(), await hist(page));
  // 7 filter sheet (Overlay) + Back
  await page.locator("button[aria-label*='筛选']:visible").first().tap(); await page.waitForTimeout(600);
  console.log("filter overlay", await page.locator(".preview-overlay").count(), await hist(page));
  await page.goBack(); await page.waitForTimeout(700);
  console.log("filter after Back", await page.locator(".preview-overlay").count(), await hist(page));
  await page.screenshot({ path: `${out}/b-after-filter-back.png` });
  await ctx.close();
} finally { await browser.close(); }
