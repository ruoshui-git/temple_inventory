import {
  routeRegistry,
  routeTarget,
  type AppOwner,
  type AppRouteTarget,
} from "./routeRegistry";
import { kindIcons } from "./kindIcons";
import { routeAllowed, type CapabilityKey } from "./capabilities";
import type { CapabilitySet } from "../services/contracts";

type AppDestination = AppOwner;
export interface NavigationItem {
  key: string;
  label: string;
  route: AppRouteTarget;
  icon: string;
  requires?: CapabilityKey;
  description?: string;
}
export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export function filterNavigation<T extends object>(
  items: readonly T[],
  capabilities: CapabilitySet | null,
) {
  return items.filter((item) =>
    routeAllowed(
      (item as T & { requires?: CapabilityKey }).requires,
      capabilities,
    ),
  );
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

export const moreNavigation: NavigationGroup[] = [
  {
    label: "工作工具",
    items: [
      {
        key: "reports",
        label: "报表",
        route: routeTarget("reports"),
        icon: "report",
        description: "查看库存、流动与借用报表",
      },
      {
        key: "item-import",
        label: "物品导入",
        route: routeTarget("imports"),
        icon: "document",
        requires: "imports.create",
        description: "通过模板批量新建或更新物品",
      },
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
        key: "opening",
        label: "期初库存",
        route: routeTarget("opening-new"),
        icon: "document",
        requires: "stock_reconciliation.create",
        description: "录入尚无库存流水的期初数量",
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
        key: "activity-types",
        label: "活动类型",
        route: routeTarget("activity-types"),
        icon: "table",
        description: "管理活动类型、排序与停用",
      },
      {
        key: "setup",
        label: "配置与恢复",
        route: routeTarget("setup"),
        icon: "sliders",
        description: "配置库存范围并恢复开发样例",
        requires: "settings.write",
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
    ["home", "inventory", "movements", "loans", "more"].includes(owner || "")
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
