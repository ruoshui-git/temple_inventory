import type {
  PreviewPage,
  PreviewPageKey,
  PreviewPageRoute,
} from "./reviewModel";

export type Destination =
  "home" | "inventory" | "movements" | "loans" | "reports" | "more";
export interface PreviewNavigationItem {
  key: string;
  label: string;
  route: PreviewPageKey;
  icon: string;
  description?: string;
}
export const inventoryNavigation: PreviewNavigationItem[] = [
  { key: "stock", label: "库存列表", route: "inventory/list", icon: "box" },
  { key: "expiry", label: "效期批次", route: "expiry/all", icon: "table" },
  {
    key: "warehouses",
    label: "仓库",
    route: "warehouses/tree",
    icon: "warehouse",
  },
  {
    key: "pending",
    label: "损坏待处理",
    route: "pending/actionable",
    icon: "warning",
  },
];
export const primaryNavigation: (PreviewNavigationItem & {
  key: Destination;
})[] = [
  { key: "home", label: "首页", route: "dashboard/overview", icon: "total" },
  { key: "inventory", label: "库存", route: "inventory/list", icon: "box" },
  {
    key: "movements",
    label: "货物流动",
    route: "movement-items/list",
    icon: "movement",
  },
  {
    key: "loans",
    label: "借用",
    route: "loan-items/outstanding",
    icon: "loan",
  },
  {
    key: "reports",
    label: "报表",
    route: "reports/overview",
    icon: "download",
  },
];
export const moreNavigation: {
  label: string;
  items: PreviewNavigationItem[];
}[] = [
  {
    label: "工作工具",
    items: [
      {
        key: "activities",
        label: "活动",
        route: "activity-list/active",
        icon: "calendar",
        description: "活动资料、关联记录与借用结余",
      },
      {
        key: "count",
        label: "盘点调整",
        route: "reconciliation-form/new",
        icon: "adjust",
        description: "新建单一库位的实物盘点",
      },
      {
        key: "drafts",
        label: "草稿",
        route: "drafts/open",
        icon: "select",
        description: "继续未完成的登记、盘点或物品编辑",
      },
    ],
  },
  {
    label: "使用偏好",
    items: [
      {
        key: "settings",
        label: "显示设置",
        route: "settings/density",
        icon: "adjust",
        description: "选择适合自己的文字与显示密度",
      },
    ],
  },
];
const owners: Partial<Record<PreviewPage, Destination>> = {
  dashboard: "home",
  inventory: "inventory",
  expiry: "inventory",
  warehouses: "inventory",
  "warehouse-detail": "inventory",
  pending: "inventory",
  "item-detail": "inventory",
  "item-form": "inventory",
  "reconciliation-form": "inventory",
  "movement-items": "movements",
  "movement-records": "movements",
  "loan-items": "loans",
  "loan-records": "loans",
  "loan-detail": "loans",
  drafts: "more",
  reports: "reports",
  "activity-list": "more",
  "activity-detail": "more",
  "activity-form": "more",
  more: "more",
  settings: "more",
};
export function destinationFor(
  route: PreviewPageRoute,
  context?: { loanName?: string },
): Destination | undefined {
  if (route.page === "movement-form")
    return ["Loan", "Return"].includes(route.variant) ||
      (!!context?.loanName && ["Damage", "Loss"].includes(route.variant))
      ? "loans"
      : "movements";
  return owners[route.page];
}
export function inventorySectionFor(page: PreviewPage): string {
  if (page === "expiry") return "expiry";
  if (["warehouses", "warehouse-detail"].includes(page)) return "warehouses";
  if (page === "pending") return "pending";
  return "stock";
}
