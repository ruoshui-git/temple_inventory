import { reactive } from "vue";

export interface ActivityType {
  id: string;
  label: string;
  enabled: boolean;
  order: number;
}
export interface PreviewActivity {
  id: string;
  title: string;
  typeId: string;
  start: string;
  end: string;
  description: string;
  notes: string;
  status: "active" | "archived";
  created: string;
  modified: string;
  owner: string;
  modifiedBy: string;
  version: number;
}
export const activityTypes = reactive<ActivityType[]>(
  ["捐赠", "购买", "分发", "节目", "投入使用", "其它"].map((label, index) => ({
    id: `AT-${index + 1}`,
    label,
    enabled: true,
    order: index,
  })),
);
const titles = [
  "秋季法会",
  "日常供餐",
  "秋季斋堂补给",
  "物资房月度盘点",
  "秋季法会布置",
  "厨房补给",
  "厨房备餐",
  "法会收场",
  "库房整理",
];
export const activities = reactive<PreviewActivity[]>(
  titles.map((title, index) => ({
    id: `ACT-${String(index + 1).padStart(4, "0")}`,
    title,
    typeId: `AT-${(index % 6) + 1}`,
    start: index === 1 ? "" : "2026-10-12",
    end: index === 1 ? "" : "2026-10-14",
    description: index === 0 ? "秋季义工活动与物资统筹" : "",
    notes:
      index === 0
        ? "活动准备\n请按库位核对物资。\n\n详细安排保留段落。<b>此内容是纯文本</b>"
        : "",
    status: "active",
    created: "2026-10-01 09:00",
    modified: `2026-10-${String(14 - index).padStart(2, "0")} 10:00`,
    owner: "预览管理员",
    modifiedBy: "预览管理员",
    version: 1,
  })),
);
export function activityLabel(id?: string) {
  return activities.find((row) => row.id === id)?.title || id || "未填写";
}
export function activityTypeLabel(id: string) {
  return activityTypes.find((row) => row.id === id)?.label || id;
}
export function activityOptions(current = "", includeArchived = false) {
  return activities
    .filter(
      (row) => includeArchived || row.status === "active" || row.id === current,
    )
    .map((row) => ({
      value: row.id,
      label: row.title,
      detail: `${row.id} · ${activityTypeLabel(row.typeId)}${row.status === "archived" ? " · 已归档" : ""}`,
    }));
}
