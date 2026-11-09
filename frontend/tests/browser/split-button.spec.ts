import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { nativeUiSession } from "./fixtures/nativeUi";

const shots = "/tmp/codex-runs/split-pill-shots";
mkdirSync(shots, { recursive: true });

async function prepare(page: Page) {
  await nativeUiSession(page, 100, {
    capabilities: {
      Item: { create: true },
      "Stock Entry": { create: true },
    },
  });
  await page.route(
    "**/api/method/temple_inventory.browse.inventory_page",
    (route) =>
      route.fulfill({
        json: {
          message: {
            rows: [],
            matched_count: 0,
            next_start: null,
            snapshot: "2026-11-09 12:00:00",
            summary: [],
            analysis: { category: [], location: [] },
          },
        },
      }),
  );
}

async function expectJoinedHeights(page: Page) {
  const button = page.locator(".browse-split-button > .ui-button");
  const trigger = page.locator(
    ".browse-split-button > .popup-menu-host > .popup-menu-trigger",
  );
  await expect(button).toBeVisible();
  await expect(trigger).toBeVisible();
  const boxes = await Promise.all([
    button.boundingBox(),
    trigger.boundingBox(),
  ]);
  expect(boxes[0]).not.toBeNull();
  expect(boxes[1]).not.toBeNull();
  const [primary, menu] = boxes as [
    { x: number; y: number; height: number },
    { x: number; y: number; height: number },
  ];
  expect(Math.abs(primary.height - menu.height)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(primary.y - menu.y)).toBeLessThanOrEqual(0.5);
  return menu;
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900, hasTouch: false },
  { name: "coarse", width: 1280, height: 800, hasTouch: true },
  { name: "phone", width: 390, height: 844, hasTouch: true },
]) {
  test(`split pill segments stay equal at ${viewport.name}`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.hasTouch,
    });
    const page = await context.newPage();
    await prepare(page);
    await page.goto("/inventory/stock");
    const trigger = page.locator(
      ".browse-split-button > .popup-menu-host > .popup-menu-trigger",
    );
    await expect(trigger).toBeVisible();

    for (const density of ["compact", "balanced", "spacious"]) {
      for (const scale of [100, 125, 150, 200]) {
        await page.evaluate(
          ({ density, scale }) => {
            document.documentElement.dataset.tiDensity = density;
            document.documentElement.dataset.tiTextScale = String(scale);
            document.documentElement.style.setProperty(
              "--p-text-scale",
              String(scale / 100),
            );
          },
          { density, scale },
        );
        const menu = await expectJoinedHeights(page);
        const minimum = viewport.width < 1024 ? 44 : viewport.hasTouch ? 44 : 0;
        expect(menu.height).toBeGreaterThanOrEqual(minimum);
        if (
          (viewport.name === "desktop" &&
            density === "compact" &&
            scale === 125) ||
          (viewport.name === "coarse" && density === "compact" && scale === 100)
        ) {
          await page.screenshot({
            path: `${shots}/split-${viewport.name}-${density}-${scale}.png`,
          });
        }
      }
    }
    if (viewport.name === "phone") {
      await page.screenshot({ path: `${shots}/split-phone-fab.png` });
      const menu = await trigger.boundingBox();
      expect(menu?.height).toBe(48);
    }

    for (const path of [
      "/inventory/movements",
      "/inventory/loans",
      "/inventory/counts",
      "/inventory/drafts",
      "/inventory/stock/warehouses",
      "/inventory/activities",
      "/inventory/activities/types",
      "/inventory/stock/units",
      "/inventory/stock/categories",
      "/inventory/reports",
    ]) {
      await page.goto(path);
      const pageTrigger = page.locator(
        ".browse-split-button > .popup-menu-host > .popup-menu-trigger",
      );
      if ((await pageTrigger.count()) === 0) continue;
      for (const density of ["compact", "balanced", "spacious"]) {
        for (const scale of [100, 125, 150, 200]) {
          await page.evaluate(
            ({ density, scale }) => {
              document.documentElement.dataset.tiDensity = density;
              document.documentElement.dataset.tiTextScale = String(scale);
              document.documentElement.style.setProperty(
                "--p-text-scale",
                String(scale / 100),
              );
            },
            { density, scale },
          );
          await expectJoinedHeights(page);
        }
      }
    }
    await context.close();
    expect(testInfo.title).toContain(viewport.name);
  });
}
