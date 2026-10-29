import { expect, test } from "@playwright/test";
import { nativeUiSession } from "./fixtures/nativeUi";

test("notification popover loads the inbox rows at desktop and phone widths", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.notifications.inbox",
    (route) =>
      route.fulfill({
        json: {
          message: {
            items: [
              {
                name: "notification-fixture-1",
                type: "导出完成",
                subject: "导出已完成",
                link: "/inventory/notifications",
                read: 0,
                creation: "2026-10-29 09:00:00",
                email_content: "{}",
              },
            ],
            unread_count: 1,
            has_running_exports: false,
          },
        },
      }),
  );
  await page.route(
    "**/api/method/temple_inventory.notifications.unread_count",
    (route) => route.fulfill({ json: { message: 1 } }),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto("/inventory/");
    await page.getByRole("button", { name: /通知，\d+ 条未读/ }).click();
    await expect(page.getByText("导出已完成")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`notification-popover-${width}.png`),
      fullPage: true,
    });
  }
});

test("notification settings show the development push-disabled state at both widths", async ({
  page,
}, info) => {
  await nativeUiSession(page);
  await page.route(
    "**/api/method/temple_inventory.notifications.get_preferences",
    (route) =>
      route.fulfill({
        json: {
          message: {
            enabled: true,
            movement_submitted: true,
            movement_cancelled: true,
            count_adjustment: true,
            export_result: true,
            expiry_digest: false,
            movement_kinds: {},
          },
        },
      }),
  );
  await page.route("**/api/method/temple_inventory.push.my_devices", (route) =>
    route.fulfill({ json: { message: [] } }),
  );
  await page.goto("/inventory/settings/notifications");
  await expect(page.getByRole("heading", { name: "通知设置" })).toBeVisible();
  await expect(page.getByText(/开发环境未注册 Service Worker/)).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.screenshot({
      path: info.outputPath(`notification-settings-development-${width}.png`),
      fullPage: true,
    });
  }
});
