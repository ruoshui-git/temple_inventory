// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  badgeLabel,
  isDownloadLink,
  notificationGroups,
  notificationIcon,
  type InventoryNotification,
} from "../src/features/notifications/model";
import { resolvePushState } from "../src/features/settings/useNotificationSettings";
import { markExportWatched } from "../src/features/export/watchedExport";

const row = (
  name: string,
  creation: string,
  type = "库存流动",
  read = 0,
  email_content = "{}",
) =>
  ({
    name,
    type,
    subject: name,
    link: "/inventory/movements/1",
    read,
    creation,
    email_content,
  }) satisfies InventoryNotification;

describe("notification presentation", () => {
  it("formats unread badges with a 99+ cap", () => {
    expect(badgeLabel(0)).toBe("");
    expect(badgeLabel(8)).toBe("8");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
  it("groups newest records into today and earlier using local calendar days", () => {
    const groups = notificationGroups(
      [row("today", "2026-10-24 10:00:00"), row("old", "2026-10-23 23:59:00")],
      new Date(2026, 9, 24, 12),
    );
    expect(
      groups.map(({ label, items }) => [label, items.map(({ name }) => name)]),
    ).toEqual([
      ["今天", ["today"]],
      ["更早", ["old"]],
    ]);
  });
  it("selects movement and export icons and recognizes download actions", () => {
    expect(
      notificationIcon(
        row("入库", "2026-10-24", "库存流动", 0, '{"kind":"Receive"}'),
      ),
    ).toBe("receive");
    expect(
      notificationIcon(
        row("导出", "2026-10-24", "导出完成", 0, '{"status":"Failed"}'),
      ),
    ).toBe("warning");
    expect(
      isDownloadLink(
        "/api/method/temple_inventory.exports.download_export?name=EXP-1",
      ),
    ).toBe(true);
    expect(isDownloadLink("/inventory/reports")).toBe(false);
  });
});

describe("push state selection", () => {
  it("covers unsupported, blocked, iOS install, and subscribed states", () => {
    expect(
      resolvePushState({
        supported: false,
        ios: false,
        standalone: false,
        subscribed: false,
      }),
    ).toBe("unsupported");
    expect(
      resolvePushState({
        supported: true,
        ios: false,
        standalone: false,
        permission: "denied",
        subscribed: false,
      }),
    ).toBe("denied");
    expect(
      resolvePushState({
        supported: true,
        ios: true,
        standalone: false,
        permission: "granted",
        subscribed: false,
      }),
    ).toBe("install");
    expect(
      resolvePushState({
        supported: true,
        ios: true,
        standalone: true,
        permission: "granted",
        subscribed: true,
      }),
    ).toBe("subscribed");
  });
});

it("marks an open export dialog result as watched and refreshes the bell count", async () => {
  const call = vi.fn(async () => ({ watched: true }));
  const refresh = vi.fn();
  window.addEventListener("inventory-notification-refresh", refresh);
  await markExportWatched({ call }, "EXP-1");
  window.removeEventListener("inventory-notification-refresh", refresh);
  expect(call).toHaveBeenCalledWith("exports.mark_watched", { name: "EXP-1" });
  expect(refresh).toHaveBeenCalledTimes(1);
});
