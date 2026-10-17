export type AppDestination =
  "home" | "inventory" | "movements" | "loans" | "reports" | "more";
export interface NavigationItem {
  key: string;
  label: string;
  route: string;
  icon: string;
}
export const primaryNavigation: (NavigationItem & { key: AppDestination })[] = [
  { key: "home", label: "首页", route: "/", icon: "total" },
  { key: "inventory", label: "库存", route: "/stock", icon: "box" },
  {
    key: "movements",
    label: "货物流动",
    route: "/movements/items",
    icon: "movement",
  },
  { key: "loans", label: "借用", route: "/loans/items", icon: "loan" },
  { key: "reports", label: "报表", route: "/reports", icon: "download" },
];
export const inventoryNavigation: NavigationItem[] = [
  { key: "stock", label: "库存列表", route: "/stock", icon: "box" },
  { key: "expiry", label: "效期批次", route: "/expiry", icon: "table" },
  { key: "warehouses", label: "仓库", route: "/warehouses", icon: "warehouse" },
  { key: "pending", label: "损坏待处理", route: "/pending", icon: "warning" },
];

export const moreNavigation = [
  {
    label: "工作工具",
    items: [
      {
        key: "activities",
        label: "活动",
        route: "/activities",
        icon: "calendar",
        description: "活动资料、关联记录与借用结余",
      },
      {
        key: "count",
        label: "盘点调整",
        route: "/reconcile/new",
        icon: "adjust",
        description: "新建单一库位的实物盘点",
      },
      {
        key: "drafts",
        label: "草稿",
        route: "/drafts",
        icon: "select",
        description: "继续未完成的库存登记或本机输入",
      },
    ],
  },
  {
    label: "使用偏好",
    items: [
      {
        key: "settings",
        label: "显示设置",
        route: "/settings",
        icon: "adjust",
        description: "主题、显示密度与文字大小",
      },
    ],
  },
];
export function destinationForPath(
  path: string,
  kind = "",
  loanRelated = false,
): AppDestination {
  if (path === "/") return "home";
  if (path.startsWith("/reports")) return "reports";
  if (path.startsWith("/loans")) return "loans";
  if (path.startsWith("/movements")) return "movements";
  if (
    path.startsWith("/new/") ||
    path.startsWith("/documents/Stock%20Entry/") ||
    path.startsWith("/documents/Stock Entry/")
  )
    return ["Loan", "Return"].includes(kind) || loanRelated
      ? "loans"
      : "movements";
  if (
    path === "/stock" ||
    path === "/expiry" ||
    path === "/pending" ||
    path.startsWith("/warehouses") ||
    path.startsWith("/item/") ||
    path === "/items/new"
  )
    return "inventory";
  return "more";
}
export function inventorySectionForPath(path: string) {
  if (path === "/expiry") return "expiry";
  if (path === "/pending") return "pending";
  if (path.startsWith("/warehouses")) return "warehouses";
  return "stock";
}
