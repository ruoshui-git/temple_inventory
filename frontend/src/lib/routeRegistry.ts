import type { LocationQueryRaw, RouteRecordRaw } from "vue-router";
import {
  newReportQuery,
  type ReportQuery,
  type ReportDataset,
} from "./reportContract";
import { operationLabels } from "../features/documents/operationCodec";

export type AppRouteName =
  | "home"
  | "stock"
  | "item-new"
  | "item-detail"
  | "item-edit"
  | "expiry"
  | "batch-detail"
  | "warehouses"
  | "warehouse-detail"
  | "categories"
  | "pending"
  | "movements"
  | "movement-new"
  | "movement-detail"
  | "loans"
  | "loan-overview"
  | "counts"
  | "count-new"
  | "count-detail"
  | "activities"
  | "activity-new"
  | "activity-detail"
  | "activity-edit"
  | "drafts"
  | "reports"
  | "settings"
  | "setup"
  | "more"
  | "auth-complete"
  | "not-found";

export interface AppRouteTarget {
  name: AppRouteName;
  params?: Record<string, string>;
  query?: LocationQueryRaw;
}
export type AppOwner =
  "home" | "inventory" | "movements" | "loans" | "reports" | "more";
export interface BreadcrumbDefinition {
  label?: string;
  param?: string;
  paramLabel?: "movement-kind";
  authorizedLabel?: boolean;
  to?: AppRouteTarget;
  toName?: AppRouteName;
}
export interface AppRouteDefinition {
  name: AppRouteName;
  path: string;
  component: NonNullable<RouteRecordRaw["component"]>;
  owner: AppOwner;
  inventorySection?: "stock" | "expiry" | "warehouses" | "pending";
  stateIdentity?: string;
  reservedParams?: Readonly<Record<string, readonly string[]>>;
  allowedParams?: Readonly<Record<string, readonly string[]>>;
  capabilities: readonly (
    "browse" | "create" | "edit" | "detail" | "recovery" | "auth"
  )[];
  breadcrumbs: readonly BreadcrumbDefinition[];
}

const root = { label: "寺院物资", to: { name: "home" } as AppRouteTarget };
const inventory = { label: "库存", to: { name: "stock" } as AppRouteTarget };
const movements = {
  label: "货物流动",
  to: { name: "movements", query: { view: "items" } } as AppRouteTarget,
};
const loans = {
  label: "借用",
  to: { name: "loans", query: { view: "items" } } as AppRouteTarget,
};
const counts = { label: "盘点调整", to: { name: "counts" } as AppRouteTarget };
const activities = {
  label: "活动",
  to: { name: "activities" } as AppRouteTarget,
};
const pages = {
  Dashboard: () => import("../pages/Dashboard.vue"),
  AuthComplete: () => import("../pages/AuthComplete.vue"),
  Inventory: () => import("../pages/Inventory.vue"),
  NewItem: () => import("../pages/NewItem.vue"),
  ItemDetail: () => import("../pages/ItemDetail.vue"),
  Expiry: () => import("../pages/Expiry.vue"),
  BatchDetail: () => import("../pages/BatchDetail.vue"),
  Warehouses: () => import("../pages/Warehouses.vue"),
  WarehouseDetail: () => import("../pages/WarehouseDetail.vue"),
  Categories: () => import("../pages/Categories.vue"),
  Pending: () => import("../pages/Pending.vue"),
  Movements: () => import("../pages/Movements.vue"),
  NativeOperation: () => import("../pages/NativeOperation.vue"),
  Loans: () => import("../pages/Loans.vue"),
  LoanDetail: () => import("../pages/LoanDetail.vue"),
  NativeRecords: () => import("../pages/NativeRecords.vue"),
  Reconciliation: () => import("../pages/Reconciliation.vue"),
  Activities: () => import("../pages/Activities.vue"),
  Reports: () => import("../pages/Reports.vue"),
  Settings: () => import("../pages/Settings.vue"),
  Setup: () => import("../pages/Setup.vue"),
  More: () => import("../pages/More.vue"),
} as const;

const route = (
  name: AppRouteName,
  path: string,
  page: string,
  owner: AppOwner,
  capabilities: AppRouteDefinition["capabilities"],
  breadcrumbs: BreadcrumbDefinition[],
  inventorySection?: AppRouteDefinition["inventorySection"],
  reservedParams?: AppRouteDefinition["reservedParams"],
  stateIdentity?: string,
  allowedParams?: AppRouteDefinition["allowedParams"],
): AppRouteDefinition => ({
  name,
  path,
  component: pages[page as keyof typeof pages],
  owner,
  capabilities,
  breadcrumbs,
  inventorySection,
  reservedParams,
  allowedParams,
  stateIdentity,
});

export const routeRegistry: readonly AppRouteDefinition[] = [
  route(
    "home",
    "/",
    "Dashboard",
    "home",
    ["browse"],
    [root, { label: "首页" }],
  ),
  route(
    "stock",
    "/stock",
    "Inventory",
    "inventory",
    ["browse"],
    [root, inventory],
    "stock",
  ),
  route(
    "item-new",
    "/stock/items/new",
    "NewItem",
    "inventory",
    ["create"],
    [root, inventory, { label: "新建物品" }],
    "stock",
  ),
  route(
    "item-detail",
    "/stock/items/:code",
    "ItemDetail",
    "inventory",
    ["detail"],
    [root, inventory, { param: "code", authorizedLabel: true }],
    "stock",
  ),
  route(
    "item-edit",
    "/stock/items/:code/edit",
    "NewItem",
    "inventory",
    ["edit"],
    [
      root,
      inventory,
      { param: "code", toName: "item-detail", authorizedLabel: true },
      { label: "编辑" },
    ],
    "stock",
  ),
  route(
    "expiry",
    "/stock/expiry",
    "Expiry",
    "inventory",
    ["browse"],
    [root, inventory, { label: "效期批次" }],
    "expiry",
  ),
  route(
    "batch-detail",
    "/stock/batches/:name",
    "BatchDetail",
    "inventory",
    ["detail"],
    [
      root,
      inventory,
      { label: "效期批次", to: { name: "expiry" } },
      { param: "name" },
    ],
    "expiry",
  ),
  route(
    "warehouses",
    "/stock/warehouses",
    "Warehouses",
    "inventory",
    ["browse", "create", "edit"],
    [root, inventory, { label: "仓库" }],
    "warehouses",
  ),
  route(
    "warehouse-detail",
    "/stock/warehouses/:warehouse",
    "WarehouseDetail",
    "inventory",
    ["detail", "edit"],
    [
      root,
      inventory,
      { label: "仓库", to: { name: "warehouses" } },
      { param: "warehouse", authorizedLabel: true },
    ],
    "warehouses",
  ),
  route(
    "categories",
    "/stock/categories",
    "Categories",
    "inventory",
    ["browse", "create", "edit"],
    [root, inventory, { label: "分类" }],
    "stock",
  ),
  route(
    "pending",
    "/stock/damaged",
    "Pending",
    "inventory",
    ["browse"],
    [root, inventory, { label: "损坏待处理" }],
    "pending",
  ),
  route(
    "movements",
    "/movements",
    "Movements",
    "movements",
    ["browse"],
    [root, movements],
  ),
  route(
    "movement-new",
    "/movements/new/:kind",
    "NativeOperation",
    "movements",
    ["create", "recovery"],
    [root, movements, { param: "kind", paramLabel: "movement-kind" }],
    undefined,
    undefined,
    "movement-editor",
    { kind: Object.keys(operationLabels) },
  ),
  route(
    "movement-detail",
    "/movements/:name",
    "NativeOperation",
    "movements",
    ["detail", "edit", "recovery"],
    [root, movements, { param: "name" }],
    undefined,
    { name: ["items", "records"] },
    "movement-editor",
  ),
  route("loans", "/loans", "Loans", "loans", ["browse"], [root, loans]),
  route(
    "loan-overview",
    "/loans/:name",
    "LoanDetail",
    "loans",
    ["detail"],
    [root, loans, { param: "name" }],
    undefined,
    { name: ["items", "records"] },
  ),
  route(
    "counts",
    "/counts",
    "NativeRecords",
    "more",
    ["browse"],
    [root, counts],
  ),
  route(
    "count-new",
    "/counts/new",
    "Reconciliation",
    "more",
    ["create", "recovery"],
    [root, counts, { label: "新建盘点" }],
    undefined,
    undefined,
    "count-editor",
  ),
  route(
    "count-detail",
    "/counts/:name",
    "Reconciliation",
    "more",
    ["detail", "edit", "recovery"],
    [root, counts, { param: "name" }],
    undefined,
    undefined,
    "count-editor",
  ),
  route(
    "activities",
    "/activities",
    "Activities",
    "more",
    ["browse"],
    [root, activities],
  ),
  route(
    "activity-new",
    "/activities/new",
    "Activities",
    "more",
    ["create", "recovery"],
    [root, activities, { label: "新建活动" }],
  ),
  route(
    "activity-detail",
    "/activities/:name",
    "Activities",
    "more",
    ["detail"],
    [root, activities, { param: "name", authorizedLabel: true }],
  ),
  route(
    "activity-edit",
    "/activities/:name/edit",
    "Activities",
    "more",
    ["edit", "recovery"],
    [
      root,
      activities,
      { param: "name", toName: "activity-detail", authorizedLabel: true },
      { label: "编辑" },
    ],
  ),
  route(
    "drafts",
    "/drafts",
    "NativeRecords",
    "more",
    ["browse", "recovery"],
    [root, { label: "草稿", to: { name: "drafts" } }],
  ),
  route(
    "reports",
    "/reports",
    "Reports",
    "reports",
    ["browse"],
    [root, { label: "报表", to: { name: "reports" } }],
  ),
  route(
    "settings",
    "/settings",
    "Settings",
    "more",
    ["browse"],
    [root, { label: "显示设置" }],
  ),
  route(
    "setup",
    "/settings/setup",
    "Setup",
    "more",
    ["browse", "recovery"],
    [root, { label: "配置与恢复" }],
  ),
  route("more", "/more", "More", "more", ["browse"], [root, { label: "更多" }]),
  {
    name: "auth-complete",
    path: "/auth-complete",
    component: pages.AuthComplete,
    owner: "more",
    capabilities: ["auth"],
    breadcrumbs: [root, { label: "登录成功" }],
  },
  {
    name: "not-found",
    path: "/:pathMatch(.*)*",
    component: () => import("../pages/NotFound.vue"),
    owner: "more",
    capabilities: [],
    breadcrumbs: [root, { label: "页面不存在" }],
  },
];

export const routeRecords: RouteRecordRaw[] = routeRegistry.map((entry) => ({
  name: entry.name,
  path: entry.path,
  component: entry.component,
  meta: {
    owner: entry.owner,
    capabilities: entry.capabilities,
    breadcrumbs: entry.breadcrumbs,
    inventorySection: entry.inventorySection,
    stateIdentity: entry.stateIdentity,
    reservedParams: entry.reservedParams,
  },
}));

export function guardReservedRoute(to: {
  name?: string | symbol | null;
  params: Record<string, unknown>;
  path: string;
  query: LocationQueryRaw;
}) {
  const entry = routeRegistry.find((candidate) => candidate.name === to.name);
  for (const [param, values] of Object.entries(entry?.reservedParams || {})) {
    if (values.includes(String(to.params[param] || "")))
      return {
        name: "not-found" as const,
        params: { pathMatch: to.path.split("/").filter(Boolean) },
        query: to.query,
      };
  }
  for (const [param, values] of Object.entries(entry?.allowedParams || {})) {
    if (!values.includes(String(to.params[param] || "")))
      return {
        name: "not-found" as const,
        params: { pathMatch: to.path.split("/").filter(Boolean) },
        query: to.query,
      };
  }
  return true;
}

export function routeTarget(
  name: AppRouteName,
  params: Record<string, string> = {},
  query: LocationQueryRaw = {},
): AppRouteTarget {
  return { name, params, query } as AppRouteTarget;
}

export function routeViewIdentity(
  path: string,
  position: number,
  stateIdentity?: string,
): string {
  return `${stateIdentity || path}:${position}`;
}

export function nativeDocumentTarget(
  doctype: string,
  name: string,
): AppRouteTarget {
  if (doctype === "Stock Entry")
    return routeTarget("movement-detail", { name });
  if (doctype === "Stock Reconciliation")
    return routeTarget("count-detail", { name });
  throw new Error(`Unsupported native inventory document: ${doctype}`);
}

export function browseRouteTarget(query: ReportQuery): AppRouteTarget {
  if (query.dataset === "inventory" && query.view === "historical")
    return routeTarget(
      "reports",
      {},
      { query: serializeReportRouteQuery(query) },
    );
  if (query.dataset === "inventory" && query.damageOnly) {
    const encoded = serializeBrowseQuery(query);
    return routeTarget(
      "pending",
      {},
      {
        view: query.view,
        ...(encoded ? { query: encoded } : {}),
      },
    );
  }
  const names: Partial<Record<ReportDataset, AppRouteName>> = {
    inventory: "stock",
    expiry: "expiry",
    movements: "movements",
    loans: "loans",
    activities: "activities",
    counts: "counts",
  };
  const name = names[query.dataset];
  if (!name) throw new Error(`Unsupported browse dataset: ${query.dataset}`);
  const view =
    query.dataset === "movements" || query.dataset === "loans"
      ? query.view === "records"
        ? "records"
        : "items"
      : query.view;
  const encoded = serializeBrowseQuery(query);
  return routeTarget(
    name,
    {},
    { view, ...(encoded ? { query: encoded } : {}) },
  );
}

function deepDifference(initial: unknown, actual: unknown): unknown {
  if (
    initial &&
    actual &&
    typeof initial === "object" &&
    typeof actual === "object" &&
    !Array.isArray(initial) &&
    !Array.isArray(actual)
  ) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(actual)) {
      const difference = deepDifference(
        (initial as Record<string, unknown>)[key],
        value,
      );
      if (difference !== undefined) result[key] = difference;
    }
    return Object.keys(result).length ? result : undefined;
  }
  return JSON.stringify(initial) === JSON.stringify(actual)
    ? undefined
    : actual;
}

export function serializeBrowseQuery(query: ReportQuery): string | undefined {
  const defaults = newReportQuery(query.dataset);
  const { dataset: _dataset, view: _view, ...state } = query;
  const {
    dataset: _defaultDataset,
    view: _defaultView,
    ...defaultState
  } = defaults;
  const difference = deepDifference(defaultState, state);
  return difference === undefined ? undefined : JSON.stringify(difference);
}

export function serializeReportRouteQuery(query: ReportQuery): string {
  const filters = serializeBrowseQuery(query);
  return JSON.stringify({
    dataset: query.dataset,
    view: query.view,
    ...(filters ? JSON.parse(filters) : {}),
  });
}

export function restoreBrowseQueryPayload(
  encoded: unknown,
  dataset: ReportDataset,
  browserView: unknown,
): string | undefined {
  if (encoded == null) return undefined;
  const source =
    typeof encoded === "string" ? encoded : JSON.stringify(encoded);
  try {
    const state: unknown = JSON.parse(source);
    if (!state || typeof state !== "object" || Array.isArray(state))
      return source;
    const {
      dataset: _dataset,
      view: _view,
      ...filters
    } = state as Record<string, unknown>;
    const defaults = newReportQuery(dataset);
    const view =
      dataset === "movements"
        ? browserView === "records"
          ? "records"
          : "summary"
        : dataset === "loans"
          ? browserView === "records"
            ? "records"
            : "items"
          : typeof browserView === "string" && browserView
            ? browserView
            : defaults.view;
    const scope =
      filters.scope === undefined
        ? defaults.scope
        : filters.scope &&
            typeof filters.scope === "object" &&
            !Array.isArray(filters.scope)
          ? { ...defaults.scope, ...(filters.scope as Record<string, unknown>) }
          : filters.scope;
    return JSON.stringify({ ...defaults, ...filters, scope, dataset, view });
  } catch {
    return source;
  }
}

export interface RouteBreadcrumb {
  label: string;
  to?: AppRouteTarget;
  current?: boolean;
  authorizedLabel?: boolean;
}
export function breadcrumbsForRoute(route: {
  name?: string | symbol | null;
  params: Record<string, unknown>;
}): RouteBreadcrumb[] {
  const entry = routeRegistry.find(
    (candidate) => candidate.name === route.name,
  );
  if (!entry) return [{ label: "寺院物资" }, { label: "页面不存在" }];
  return entry.breadcrumbs.map((crumb, index) => {
    const paramValue = String(route.params[crumb.param || ""] ?? "");
    return {
      label:
        crumb.paramLabel === "movement-kind"
          ? operationLabels[paramValue as keyof typeof operationLabels] ||
            paramValue
          : (crumb.label ?? paramValue),
      to:
        index === entry.breadcrumbs.length - 1
          ? undefined
          : (crumb.to ??
            (crumb.toName && crumb.param
              ? routeTarget(crumb.toName, { [crumb.param]: paramValue })
              : undefined)),
      current: index === entry.breadcrumbs.length - 1,
      authorizedLabel: crumb.authorizedLabel,
    };
  });
}
