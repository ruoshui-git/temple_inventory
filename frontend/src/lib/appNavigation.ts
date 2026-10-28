import {
  routeRegistry,
  routeTarget,
  type AppOwner,
  type AppRouteTarget,
} from "./routeRegistry";
import { kindIcons } from "./kindIcons";

export type AppDestination = AppOwner;
export interface NavigationItem {
  key: string;
  label: string;
  route: AppRouteTarget;
  icon: string;
}

export const primaryNavigation: (NavigationItem & { key: AppDestination })[] = [
  { key: "home", label: "首页", route: routeTarget("home"), icon: "total" },
  { key: "inventory", label: "库存", route: routeTarget("stock"), icon: "box" },
  {
    key: "movements",
    label: "货物流动",
    route: routeTarget("movements", {}, { view: "items" }),
    icon: "movement",
  },
  {
    key: "loans",
    label: "借用",
    route: routeTarget("loans", {}, { view: "items" }),
    icon: kindIcons.Loan.icon,
  },
  {
    key: "reports",
    label: "报表",
    route: routeTarget("reports"),
    icon: "report",
  },
  { key: "more", label: "更多", route: routeTarget("more"), icon: "more" },
];

export const mobilePrimaryNavigation = primaryNavigation;
export const inventoryNavigation: NavigationItem[] = [
  { key: "stock", label: "库存列表", route: routeTarget("stock"), icon: "box" },
  {
    key: "expiry",
    label: "效期批次",
    route: routeTarget("expiry"),
    icon: "table",
  },
  {
    key: "warehouses",
    label: "仓库",
    route: routeTarget("warehouses"),
    icon: "warehouse",
  },
  {
    key: "pending",
    label: "损坏待处理",
    route: routeTarget("pending"),
    icon: "warning",
  },
];

export const moreNavigation = [
  {
    label: "工作工具",
    items: [
      {
        key: "activities",
        label: "活动",
        route: routeTarget("activities"),
        icon: "calendar",
        description: "活动资料、关联记录与借用结余",
      },
      {
        key: "count",
        label: "盘点调整",
        route: routeTarget("counts"),
        icon: kindIcons.Reconcile.icon,
        description: "查看和调整盘点调整记录",
      },
      {
        key: "drafts",
        label: "草稿",
        route: routeTarget("drafts"),
        icon: "select",
        description: "继续未完成的库存登记或本机输入",
      },
    ],
  },
  {
    label: "管理与设置",
    items: [
      {
        key: "categories",
        label: "分类",
        route: routeTarget("categories"),
        icon: "tag",
        description: "管理分类层级与物品归属",
      },
      {
        key: "units",
        label: "单位",
        route: routeTarget("units"),
        icon: "table",
        description: "管理计量单位与显示名称",
      },
      {
        key: "setup",
        label: "配置与恢复",
        route: routeTarget("setup"),
        icon: "sliders",
        description: "配置库存范围并恢复开发样例",
      },
      {
        key: "settings",
        label: "显示设置",
        route: routeTarget("settings"),
        icon: kindIcons.Reconcile.icon,
        description: "主题、显示密度与文字大小",
      },
    ],
  },
];

export function destinationForRoute(owner?: string): AppDestination {
  return (
    ["home", "inventory", "movements", "loans", "reports", "more"].includes(
      owner || "",
    )
      ? owner
      : "more"
  ) as AppDestination;
}

export function inventorySectionForRoute(name?: string) {
  return (
    routeRegistry.find((route) => route.name === name)?.inventorySection ||
    "stock"
  );
}
