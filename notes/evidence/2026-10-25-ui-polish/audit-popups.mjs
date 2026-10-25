import { chromium } from "/workspace/development/frappe-bench/apps/temple_inventory/frontend/node_modules/@playwright/test/index.mjs";

const base = process.env.TI_UI_BASE_URL || "http://127.0.0.1:8091";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium-headless-shell",
  args: ["--no-sandbox"],
});
const errors = [];
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(650);
}
async function inspect(page, label) {
  const misses = await page.evaluate(() => {
    const surfaces = document.querySelectorAll(
      ".inventory-menu, .app-account-dropdown, .notification-popover, .popup-menu-panel, .preview-filter-popover, .search-select-menu, .data-table-column-panel",
    );
    const failures = [];
    for (const surface of surfaces) {
      const style = getComputedStyle(surface);
      const rect = surface.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.pointerEvents === "none" ||
        Number.parseFloat(style.opacity) <= 0.01 ||
        !rect.width ||
        !rect.height
      )
        continue;
      for (const item of surface.querySelectorAll(
        "button,a[href],[role=option],[role=menuitem]",
      )) {
        // Disclosure toggles inside nested filter trees are controls in the
        // popup content, not menu items in the popup layer contract.
        if (item.matches(".tree-toggle")) continue;
        const box = item.getBoundingClientRect();
        const itemStyle = getComputedStyle(item);
        const hiddenAncestor = item.closest(
          '[aria-hidden="true"], .sr-only, .visually-hidden',
        );
        let transparent = false;
        for (
          let ancestor = item;
          ancestor && surface.contains(ancestor);
          ancestor = ancestor.parentElement
        ) {
          if (Number.parseFloat(getComputedStyle(ancestor).opacity) <= 0.01) {
            transparent = true;
            break;
          }
          if (ancestor === surface) break;
        }
        if (
          !box.width ||
          !box.height ||
          (item.tagName === "INPUT" && box.width <= 2 && box.height <= 2) ||
          itemStyle.display === "none" ||
          itemStyle.visibility === "hidden" ||
          itemStyle.pointerEvents === "none" ||
          itemStyle.clipPath !== "none" ||
          (itemStyle.clip !== "auto" && itemStyle.clip !== "none") ||
          hiddenAncestor ||
          transparent
        )
          continue;
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        let clipped = false;
        for (
          let ancestor = item.parentElement;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const ancestorStyle = getComputedStyle(ancestor);
          const ancestorBox = ancestor.getBoundingClientRect();
          if (
            ["auto", "scroll", "hidden", "clip"].some((value) =>
              [ancestorStyle.overflowX, ancestorStyle.overflowY].includes(
                value,
              ),
            ) &&
            (x < ancestorBox.left ||
              x >= ancestorBox.right ||
              y < ancestorBox.top ||
              y >= ancestorBox.bottom)
          ) {
            clipped = true;
            break;
          }
          if (ancestor === surface) break;
        }
        if (clipped) continue;
        const hit = document.elementFromPoint(x, y);
        const sameControl = (a, b) => {
          if (!a || !b) return false;
          if (a === b || a.contains(b) || b.contains(a)) return true;
          const region =
            "label, button, a[href], [role=button], [role=menuitem], [role=option], .browse-filter-disclosure, .preview-field, .preview-choice-label, .hierarchy-row, .compact-filter-content > *";
          const aRegions = new Set(
            a.closest(region) ? [a.closest(region)] : [],
          );
          for (
            let parent = a.parentElement;
            parent && surface.contains(parent);
            parent = parent.parentElement
          ) {
            if (parent.matches(region)) aRegions.add(parent);
            if (parent === surface) break;
          }
          for (
            let parent = b;
            parent && surface.contains(parent);
            parent = parent.parentElement
          ) {
            if (aRegions.has(parent)) return true;
            if (parent === surface) break;
          }
          return false;
        };
        const popupChrome = hit?.closest("header, footer");
        if (popupChrome && surface.contains(popupChrome)) continue;
        if (!sameControl(item, hit))
          failures.push({
            text: item.textContent?.trim(),
            itemTag: item.tagName,
            itemClass: item.className?.toString(),
            surface: surface.className.toString(),
            hit: hit?.className?.toString(),
            hitTag: hit?.tagName,
          });
      }
    }
    return failures;
  });
  if (misses.length) errors.push({ label, misses });
  console.log(`${label}: checked open popup surfaces; misses=${misses.length}`);
}
async function openFirst(page, selector, label) {
  const target = page.locator(`${selector}:visible`).first();
  if (!(await target.count())) return false;
  await target.click({ timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(250);
  await inspect(page, label);
  return true;
}
try {
  for (const [tag, viewport] of [
    ["1440x900", { width: 1440, height: 900 }],
    ["1100x800", { width: 1100, height: 800 }],
    ["390x844", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport, locale: "zh-CN" });
    const page = await context.newPage();
    await page.goto(`${base}/inventory/`);
    await page.evaluate(() =>
      fetch("/api/method/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usr: "Administrator", pwd: "admin" }),
      }),
    );
    for (const route of ["stock", "movements", "counts", "activities"]) {
      await page.goto(`${base}/inventory/${route}`);
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, 680));
      await page.waitForTimeout(200);
      if (route === "stock" && tag !== "390x844") {
        const nav = page.locator("[data-inventory-menu-trigger]");
        if ((await nav.getAttribute("aria-expanded")) !== "true")
          await openFirst(
            page,
            "[data-inventory-menu-trigger]",
            `${tag} stock navigation`,
          );
      }
      if (tag !== "390x844")
        await openFirst(page, ".app-account-trigger", `${tag} account menu`);
      await openFirst(page, ".notification-trigger", `${tag} notifications`);
      await openFirst(
        page,
        ".popup-menu-trigger-icon",
        `${tag} ${route} overflow`,
      );
      await openFirst(
        page,
        ".popup-menu-trigger-split",
        `${tag} ${route} split create`,
      );
      await openFirst(
        page,
        ".browse-sort-control .popup-menu-trigger",
        `${tag} ${route} sort`,
      );
      await openFirst(
        page,
        ".preview-filter-control button[aria-haspopup=dialog]",
        `${tag} ${route} filter`,
      );
      await openFirst(
        page,
        ".preview-period-trigger",
        `${tag} ${route} period`,
      );
      await openFirst(
        page,
        ".data-table-column-trigger",
        `${tag} ${route} column settings`,
      );
      const combos = page.locator("input[role=combobox]:visible");
      if (await combos.count()) {
        await combos.first().focus();
        await page.waitForTimeout(400);
        await inspect(page, `${tag} ${route} SearchSelect`);
      }
    }
    for (const route of [
      "stock/items/new",
      "movements/new/receive",
      "counts/new",
      "activities/new",
    ]) {
      await page.goto(`${base}/inventory/${route}`);
      await settle(page);
      await page.evaluate(() => window.scrollTo(0, 520));
      await page.waitForTimeout(150);
      await openFirst(
        page,
        ".popup-menu-trigger-icon",
        `${tag} ${route} overflow`,
      );
      await openFirst(
        page,
        ".preview-period-trigger",
        `${tag} ${route} period editor`,
      );
      const combos = page.locator("input[role=combobox]:visible");
      for (let i = 0; i < Math.min(await combos.count(), 3); i++) {
        await combos.nth(i).focus();
        await page.waitForTimeout(350);
        await inspect(page, `${tag} ${route} SearchSelect ${i + 1}`);
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error(JSON.stringify(errors, null, 2));
  process.exitCode = 1;
}
