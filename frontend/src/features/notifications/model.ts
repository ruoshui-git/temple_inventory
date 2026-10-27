import { getCurrentInstance } from "vue";
import { movementIcon } from "../../lib/kindIcons";
import { siteWallTimestamp } from "../../lib/nativeTime";
import { useOptionalReferenceData } from "../../services/contracts";

export interface InventoryNotification {
  name: string;
  type: string;
  subject: string;
  link: string;
  read: number;
  creation: string;
  email_content: string;
  unavailable?: boolean;
}

export interface NotificationPage {
  items: InventoryNotification[];
  unread_count: number;
  has_running_exports: boolean;
}

export function badgeLabel(count: number) {
  return count > 99 ? "99+" : count > 0 ? String(count) : "";
}

function siteTimezone() {
  return (
    (getCurrentInstance() ? useOptionalReferenceData() : undefined)?.timezone ||
    ""
  );
}

function siteDateKey(epoch: number, timezone: string) {
  try {
    if (timezone)
      return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
        new Date(epoch),
      );
  } catch {
    /* fall back to the browser date */
  }
  const date = new Date(epoch);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function notificationGroups(
  rows: InventoryNotification[],
  today?: Date | string,
) {
  const timezone = siteTimezone();
  const todayKey =
    typeof today === "string"
      ? today
      : today instanceof Date
        ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
        : siteDateKey(Date.now(), timezone);
  return [
    {
      label: "今天",
      items: rows.filter((row) => row.creation.slice(0, 10) === todayKey),
    },
    {
      label: "更早",
      items: rows.filter((row) => row.creation.slice(0, 10) !== todayKey),
    },
  ].filter((group) => group.items.length);
}

export function notificationData(
  row: InventoryNotification,
): Record<string, any> {
  try {
    const value = JSON.parse(row.email_content || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function notificationIcon(row: InventoryNotification) {
  const data = notificationData(row);
  if (row.type === "库存流动") return movementIcon(data.kind);
  if (row.type === "流动撤销") return "cancel";
  if (row.type === "盘点调整") return "count";
  if (row.type === "效期提醒") return "expiry";
  return data.status === "Failed" ? "warning" : "select";
}

export function isDownloadLink(link: string) {
  return link.includes("exports.download_export");
}

export function relativeTime(value: string, now?: number) {
  const stamp = siteWallTimestamp(value, siteTimezone());
  now ??= Date.now();
  const minutes = Math.max(0, Math.floor((now - stamp) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
