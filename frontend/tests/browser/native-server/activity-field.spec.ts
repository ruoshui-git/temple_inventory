import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test("activity options and nested creation dialog on desktop and phone", async ({
  page,
}) => {
  test.skip(
    !process.env.NATIVE_ADMIN_PASSWORD,
    "Requires local Administrator credentials",
  );
  const login = await page.request.post("/api/method/login", {
    form: { usr: "Administrator", pwd: process.env.NATIVE_ADMIN_PASSWORD! },
  });
  expect(login.ok()).toBe(true);
  const session = await page.request.get(
    "/api/method/temple_inventory.session.info",
  );
  const info = (await session.json()).message;
  const headers = {
    "X-Frappe-CSRF-Token": info.csrf_token,
    "X-Inventory-Account": "Administrator",
  };
  const screenshotDir = join(
    process.cwd(),
    "test-results/activity-field-shots",
  );
  mkdirSync(screenshotDir, { recursive: true });
  let created: { name: string; modified: string } | undefined;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/inventory/movements/new/Loan");
    await page.getByText("补充记录", { exact: true }).click();
    const activity = page.getByRole("combobox", { name: "关联活动" });
    await activity.click();
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.screenshot({
      path: join(screenshotDir, "activity-dropdown-desktop.png"),
    });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "新建活动" }).click();
    await expect(page.getByRole("dialog", { name: "新建活动" })).toBeVisible();
    await page.screenshot({
      path: join(screenshotDir, "activity-modal-desktop.png"),
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("dialog", { name: "新建活动" })).toBeVisible();
    await page.screenshot({
      path: join(screenshotDir, "activity-modal-phone.png"),
    });
    const title = `字段回归活动 ${Date.now()}`;
    await page.getByLabel("名称").fill(title);
    const type = page.getByRole("combobox", { name: "类型" });
    await type.click();
    await page.getByRole("option").first().click();
    const saved = page.waitForResponse((candidate) =>
      candidate.url().includes("activities.save_activity"),
    );
    await page.getByRole("button", { name: "创建并使用活动" }).click();
    const savedBody = await (await saved).json();
    created = savedBody.message;
    await expect(page.getByRole("dialog", { name: "新建活动" })).toHaveCount(0);
    await expect(activity).toHaveValue(title);
    await page.screenshot({
      path: join(screenshotDir, "activity-title-after-save.png"),
    });
  } finally {
    if (created) {
      await page.request.post(
        "/api/method/temple_inventory.activities.delete_activity",
        {
          data: { name: created.name, version: created.modified },
          headers,
        },
      );
    }
  }
});
