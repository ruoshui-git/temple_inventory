import { mkdir } from "node:fs/promises";
import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";

const out = process.argv[2];
const base = process.env.TI_UI_BASE_URL || "http://127.0.0.1:8091";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: ["--no-sandbox"],
});
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(700);
}
async function login(page) {
  await page.goto(`${base}/inventory/`);
  await page.evaluate(() =>
    fetch("/api/method/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
    }),
  );
}
async function hitItems(page, selector) {
  return page.locator(selector).evaluateAll((items) =>
    items
      .filter((item) => {
        const rect = item.getBoundingClientRect();
        if (
          !rect.width ||
          !rect.height ||
          getComputedStyle(item).visibility === "hidden"
        )
          return false;
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return !hit || (hit !== item && !item.contains(hit));
      })
      .map(
        (item) =>
          item.textContent?.trim() ||
          item.getAttribute("aria-label") ||
          item.tagName,
      ),
  );
}
async function save(page, name) {
  await page.screenshot({ path: `${out}/${name}.png` });
}
try {
  for (const [tag, viewport] of [
    ["desk", { width: 1440, height: 900 }],
    ["narrow", { width: 1100, height: 800 }],
    ["mob", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: "zh-CN",
    });
    const page = await context.newPage();
    await login(page);
    await page.goto(`${base}/inventory/stock`);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 620));
    await page.waitForTimeout(400);
    if (tag !== "mob") {
      const inventoryTrigger = page.locator("[data-inventory-menu-trigger]");
      if ((await inventoryTrigger.getAttribute("aria-expanded")) !== "true")
        await inventoryTrigger.click();
      await page.waitForTimeout(150);
      const navMisses = await hitItems(page, ".inventory-menu button:visible");
      if (navMisses.length)
        throw new Error(
          `${tag} nav item hit misses: ${JSON.stringify(navMisses)}`,
        );
      await save(page, `${tag}-inventory-nav-stuck`);
      await page.keyboard.press("Escape");
    } else {
      const brand = page.locator(".mobile-app-topbar strong").first();
      if (await brand.count())
        await brand.screenshot({ path: `${out}/mob-brand.png` });
    }
    if (tag !== "mob") {
      await page.locator(".app-account-trigger").click();
      await page.waitForTimeout(100);
      const accountMisses = await hitItems(
        page,
        ".app-account-dropdown [role=menuitem]",
      );
      if (accountMisses.length)
        throw new Error(
          `${tag} account hit misses: ${JSON.stringify(accountMisses)}`,
        );
      await save(page, `${tag}-account-stuck`);
      await page.keyboard.press("Escape");
    }
    if (tag === "desk") {
      const bell = page.locator(".notification-trigger");
      if (await bell.count()) {
        await bell.click();
        await page.waitForTimeout(150);
        await save(page, "desk-notifications-stuck");
      }
    }
    if (tag === "mob") {
      await page.goto(`${base}/inventory/stock`);
      await settle(page);
      const splitTrigger = page
        .locator(".browse-split-button .popup-menu-trigger-split:visible")
        .first();
      await page.mouse.move(2, 2);
      await page.waitForTimeout(150);
      const split = page.locator(".browse-split-button:visible").first();
      if (await split.count()) {
        await save(page, "mob-split-fab-idle");
        await split.screenshot({ path: `${out}/mob-split-fab.png` });
      }
      const triggerBox = await splitTrigger.boundingBox();
      if (triggerBox) {
        await page.mouse.move(
          triggerBox.x + triggerBox.width / 2,
          triggerBox.y + triggerBox.height / 2,
        );
        await page.mouse.down();
        await page.waitForTimeout(100);
        await page
          .locator(".browse-split-button:visible")
          .first()
          .screenshot({ path: `${out}/mob-split-fab-tapped.png` });
        await page.mouse.up();
      }
      await page.waitForTimeout(150);
      await save(page, "mob-split-menu");
      await page.keyboard.press("Escape");
      await page
        .locator("button.popup-menu-trigger-icon:visible")
        .first()
        .click();
      await page.waitForTimeout(150);
      await save(page, "mob-stock-overflow-menu");
      await page.goto(`${base}/inventory/movements`);
      await settle(page);
      await page
        .locator("button.popup-menu-trigger-icon:visible")
        .first()
        .click();
      await page.waitForTimeout(150);
      await save(page, "mob-movements-overflow-menu");
      await page.keyboard.press("Escape");
      const movementSplit = page
        .locator(".browse-split-button .popup-menu-trigger-split:visible")
        .first();
      if (await movementSplit.count()) {
        await movementSplit.click();
        await page.waitForTimeout(150);
        await save(page, "mob-movements-split-menu");
        await page.keyboard.press("Escape");
      }
      await context.close();
      continue;
    }
    await page.goto(`${base}/inventory/movements`);
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 620));
    await page.waitForTimeout(300);
    await page
      .locator("button.popup-menu-trigger-icon:visible")
      .first()
      .click();
    await page.waitForTimeout(150);
    const menuMisses = await hitItems(
      page,
      ".popup-menu-panel:visible :is(button,a)[role^=menuitem]",
    );
    if (menuMisses.length)
      throw new Error(
        `${tag} movement menu misses: ${JSON.stringify(menuMisses)}`,
      );
    await save(page, `${tag}-movements-overflow-menu`);
    await page.keyboard.press("Escape");
    const splitTrigger = page
      .locator(".browse-split-button .popup-menu-trigger-split:visible")
      .first();
    if (await splitTrigger.count()) {
      await splitTrigger.click();
      await page.waitForTimeout(150);
      await save(page, `${tag}-movements-split-menu`);
      await page.keyboard.press("Escape");
    }
    if (tag !== "mob") {
      await page.goto(`${base}/inventory/stock`);
      await settle(page);
      const table = page.locator(".data-table-scroll").first();
      if (await table.count()) {
        await table.scrollIntoViewIfNeeded();
        await table.evaluate((el) => {
          el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2);
        });
        await page.waitForTimeout(350);
        const hintCount = await page
          .locator(".data-table-overflow-hint:visible")
          .count();
        if (hintCount !== 2)
          throw new Error(`Expected paired overflow hints, found ${hintCount}`);
        await save(page, `${tag}-stock-horizontal-middle`);
        await page.evaluate(() => {
          const el = document.querySelector(".data-table-scroll");
          if (!el) return;
          const bottom = el.getBoundingClientRect().bottom;
          window.scrollBy(0, Math.max(0, bottom - window.innerHeight - 40));
        });
        await page.waitForTimeout(350);
        if (!(await page.locator(".floating-table-scrollbar:visible").count()))
          throw new Error(
            "Floating scrollbar did not appear with the native bar below the viewport",
          );
        await save(page, `${tag}-stock-floating-scrollbar`);
      }
    }
    const brand = page
      .locator(
        tag === "mob" ? ".mobile-app-topbar strong" : ".sample-sidebar strong",
      )
      .first();
    if (await brand.count())
      await brand.screenshot({ path: `${out}/${tag}-brand.png` });
    await context.close();
  }
} finally {
  await browser.close();
}
