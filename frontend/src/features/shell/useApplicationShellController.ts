import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, type LocationQueryRaw } from "vue-router";
import { api, request } from "../../lib/api";

export function useApplicationShellController() {
  type Destination = {
    key: "inventory" | "movements" | "loans" | "warehouses" | "more";
    label: string;
    path: string;
  };
  type ContextItem = {
    key: string;
    label: string;
    path: string;
    query: LocationQueryRaw;
  };

  const route = useRoute();
  const boot = ref<any>();
  const inventoryExpanded = ref(route.path === "/" || route.path === "/expiry");
  const destinations: Destination[] = [
    { key: "inventory", label: "库存", path: "/" },
    { key: "movements", label: "货物流动", path: "/movements" },
    { key: "loans", label: "借用", path: "/loans" },
    { key: "warehouses", label: "仓库", path: "/warehouses" },
    { key: "more", label: "更多", path: "/more" },
  ];

  const activeDestination = computed(() => {
    if (
      route.path === "/movements" ||
      route.path === "/movements/items" ||
      route.path === "/movements/records" ||
      route.path === "/history" ||
      ["Receive", "Issue", "Transfer"].includes(String(route.params.kind || ""))
    )
      return "/movements";
    if (route.path.startsWith("/reconcile")) return "/movements";
    if (route.path.startsWith("/loans") || route.path === "/new/Loan")
      return "/loans";
    if (route.path.startsWith("/warehouses") || route.path === "/settings")
      return "/warehouses";
    if (
      route.path === "/more" ||
      route.path === "/reports" ||
      route.path === "/drafts" ||
      route.path === "/pending"
    )
      return "/more";
    return "/";
  });

  const inventorySharedQuery = computed<LocationQueryRaw>(() => ({
    search: route.query.search,
    warehouses: route.query.warehouses,
    item_groups: route.query.item_groups,
  }));
  const movementSharedQuery = computed<LocationQueryRaw>(() => ({
    // Keep the complete canonical movement query when switching the two ledger
    // views.  Repeated kind/warehouse/status values must survive as arrays.
    ...route.query,
  }));
  const loanSharedQuery = computed<LocationQueryRaw>(() => ({
    search: route.query.search,
    loan_date: route.query.loan_date,
    item_groups: route.query.item_groups,
    warehouses: route.query.warehouses,
    activity: route.query.activity,
    sort_by: route.query.sort_by,
    sort_order: route.query.sort_order,
  }));

  const inventoryContextItems = computed<ContextItem[]>(() => [
    {
      key: "current",
      label: "当前库存",
      path: "/",
      query: inventorySharedQuery.value,
    },
    {
      key: "expiry",
      label: "效期批次",
      path: "/expiry",
      query: inventorySharedQuery.value,
    },
  ]);
  const contextItems = computed<ContextItem[]>(() => {
    if (route.path === "/" || route.path === "/expiry")
      return inventoryContextItems.value;
    if (
      route.path === "/movements" ||
      route.path === "/movements/items" ||
      route.path === "/movements/records" ||
      route.path === "/history"
    )
      return [
        {
          key: "items",
          label: "明细",
          path: "/movements/items",
          query: movementSharedQuery.value,
        },
        {
          key: "records",
          label: "记录",
          path: "/movements/records",
          query: movementSharedQuery.value,
        },
      ];
    if (route.path === "/loans")
      return [
        {
          key: "outstanding",
          label: "未结借用",
          path: "/loans",
          query: loanSharedQuery.value,
        },
        {
          key: "settled",
          label: "已结借用",
          path: "/loans",
          query: { ...loanSharedQuery.value, status: "settled" },
        },
      ];
    return [];
  });

  const contextKey = computed(() => {
    if (route.path === "/") return "current";
    if (route.path === "/expiry") return "expiry";
    if (
      route.path === "/movements" ||
      route.path === "/movements/items" ||
      route.path === "/movements/records" ||
      route.path === "/history"
    ) {
      const requested = String(
        route.query.kind || route.query.movement_kind || "",
      );
      return route.path === "/movements/records"
        ? "records"
        : route.path === "/movements/items"
          ? "items"
          : ["Receive", "Issue", "Transfer"].includes(requested)
            ? requested
            : "items";
    }
    if (route.path === "/loans")
      return route.query.status === "settled" ? "settled" : "outstanding";
    return "";
  });

  const pending = computed(() => Number(boot.value?.pending_count || 0));
  const expiryCount = computed(() =>
    Number(boot.value?.expiry_batch_count || 0),
  );
  async function refresh() {
    try {
      boot.value = await api("bootstrap");
    } catch {
      /* page-level API renders errors */
    }
  }
  async function logout() {
    await request("logout");
    window.location.href = "/login?redirect-to=%2Finventory";
  }
  function closeNavigationContext() {
    inventoryExpanded.value = false;
  }

  watch(
    () => route.path,
    (path) => {
      inventoryExpanded.value = path === "/" || path === "/expiry";
    },
  );
  onMounted(() => {
    void refresh();
    window.addEventListener("ti:refresh-shell", refresh);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("ti:refresh-shell", refresh);
  });
  return {
    route,
    boot,
    inventoryExpanded,
    destinations,
    activeDestination,
    inventorySharedQuery,
    movementSharedQuery,
    loanSharedQuery,
    inventoryContextItems,
    contextItems,
    contextKey,
    pending,
    expiryCount,
    refresh,
    logout,
    closeNavigationContext,
  };
}

export type ApplicationShellController = ReturnType<
  typeof useApplicationShellController
>;
