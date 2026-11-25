import { expect, test } from "@playwright/test";

const fixture = "/tests/browser/fixtures/location-tooltips.html";

test("location tooltip is shared by mouse, keyboard and a dialog", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await page.goto(fixture);
  const location = page.locator("main .location-label");
  const tip = page.getByRole("tooltip");
  await expect(location).toHaveText("T2/FUN/A01");
  await expect(location).toHaveAttribute("aria-label", "T2/FUN/A01，阅览室");
  await location.hover();
  await expect(tip).toContainText("阅览室");
  await expect(tip.locator(".inventory-tooltip-level")).toHaveCount(3);
  await expect(location).toHaveAttribute(
    "aria-describedby",
    "inventory-tooltip",
  );
  await expect(location).not.toHaveAttribute("title");
  const anchor = await location.boundingBox();
  const tipBox = await tip.boundingBox();
  expect(tipBox!.y).toBeGreaterThanOrEqual(anchor!.y + anchor!.height);
  await page.screenshot({ path: testInfo.outputPath("mouse-location.png") });

  await tip.hover();
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(location).not.toHaveAttribute("aria-describedby");
  await page.keyboard.press("Tab");
  await expect(location).toBeFocused();
  await expect(tip).toContainText("第2寺院");
  await page.screenshot({ path: testInfo.outputPath("keyboard-location.png") });

  await page.getByRole("button", { name: "打开详情" }).click();
  const dialog = page.getByRole("dialog", { name: "库位详情" });
  await expect(dialog).toBeVisible();
  await dialog.locator(".location-label").hover();
  await expect(tip).toContainText("阅览室");
  await expect(page.locator("body > #inventory-tooltip")).toBeVisible();
  await expect(page.locator("[data-inventory-app]")).toHaveJSProperty(
    "inert",
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("dialog-location.png") });
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("disabled controls provide the reason with pointer and keyboard", async ({
  page,
}) => {
  await page.goto(fixture);
  const tip = page.getByRole("tooltip");
  const disabled = page.locator(".disabled-button-tip");
  await disabled.nth(0).hover();
  await expect(tip).toHaveText("还有库存");
  await disabled.nth(1).hover();
  await expect(tip).toHaveText("等待审核");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(disabled.nth(0)).toBeFocused();
  await expect(tip).toHaveText("还有库存");
});

test("a phone hold opens the tip and consumes only its own tap", async ({
  browser,
  baseURL,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    await page.goto(fixture);
    const button = page.getByRole("button", { name: "确认" });
    const tip = page.getByRole("tooltip");
    const count = page.getByLabel("确认次数");
    const point = await button.boundingBox();
    const client = await context.newCDPSession(page);
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: point!.x + point!.width / 2, y: point!.y + point!.height / 2 },
      ],
    });
    await expect(tip).toHaveText("核对库位");
    await page.screenshot({ path: testInfo.outputPath("phone-hold.png") });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(count).toHaveText("0");
    await page.getByRole("heading", { name: "库位" }).tap();
    await expect(tip).toBeHidden();
    await button.tap();
    await expect(count).toHaveText("1");
  } finally {
    await context.close();
  }
});
