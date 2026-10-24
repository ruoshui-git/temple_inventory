import { movementIcon } from "../../lib/kindIcons";

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

export function notificationGroups(
  rows: InventoryNotification[],
  today = new Date(),
) {
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
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

export function relativeTime(value: string, now = Date.now()) {
  const stamp = Date.parse(value.replace(" ", "T"));
  const minutes = Math.max(0, Math.floor((now - stamp) / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return `${Math.floor(minutes / 1440)} 天前`;
}
