import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../lib/api";
import {
  presentWarehouse,
  type WarehouseRecord,
} from "../../lib/warehousePresenter";
import { returnToOpener } from "../../lib/navigation";

export function useWarehouseDetailController() {
  const route = useRoute(),
    router = useRouter(),
    detail = ref<any>(),
    boot = ref<any>(),
    error = ref(""),
    stockError = ref(""),
    movementsError = ref(""),
    exportOpen = ref(false),
    stockLoading = ref(true),
    movementsLoading = ref(true);
  const node = computed(
      () => detail.value?.warehouse || detail.value?.node || detail.value,
    ),
    presented = computed(() =>
      node.value
        ? presentWarehouse(
            node.value as WarehouseRecord,
            detail.value?.warehouse_tree || boot.value?.warehouse_tree || [],
          )
        : undefined,
    );
  const stock = computed(
      () => detail.value?.stock_preview || detail.value?.stock || [],
    ),
    movements = computed(
      () => detail.value?.movements || detail.value?.history || [],
    ),
    groups = computed(
      () => detail.value?.item_groups || detail.value?.groups || [],
    );
  const capabilities = computed(
      () => detail.value?.capabilities || detail.value?.quick_actions || {},
    ),
    actionKinds = ["Receive", "Issue", "Transfer", "Reconcile"];
  const permittedActions = computed(() =>
    actionKinds.filter(
      (kind) =>
        capabilities.value[kind] !== false &&
        (capabilities.value[kind] || detail.value?.can_operate),
    ),
  );
  const queryValue = computed(
    () => presented.value?.filterValue || String(route.params.warehouse),
  );
  function link(path: string) {
    return `${path}?${path === "/movements" ? "rooms" : "warehouses"}=${encodeURIComponent(queryValue.value)}`;
  }
  function operation(kind: string) {
    const value = presented.value?.operationValue;
    if (!value) return;
    sessionStorage.setItem(
      `ti-scope:${kind}`,
      JSON.stringify({ warehouse: value }),
    );
    void router.push(kind === "Reconcile" ? "/reconcile/new" : `/new/${kind}`);
  }
  function close() {
    void returnToOpener(router, "/warehouses");
  }
  function retry() {
    router.go(0);
  }
  async function loadStock() {
    stockLoading.value = true;
    stockError.value = "";
    try {
      detail.value = await api("warehouse_detail", {
        warehouse: route.params.warehouse,
      });
    } catch (cause: any) {
      stockError.value = cause.message;
    } finally {
      stockLoading.value = false;
    }
  }
  async function loadMovements() {
    movementsLoading.value = true;
    movementsError.value = "";
    try {
      if (!detail.value)
        detail.value = await api("warehouse_detail", {
          warehouse: route.params.warehouse,
        });
    } catch (cause: any) {
      movementsError.value = cause.message;
    } finally {
      movementsLoading.value = false;
    }
  }
  onMounted(async () => {
    try {
      boot.value = await api("bootstrap");
    } catch (cause: any) {
      error.value = cause.message;
    }
    await Promise.all([loadStock(), loadMovements()]);
  });

  return {
    route,
    router,
    detail,
    boot,
    error,
    stockError,
    movementsError,
    exportOpen,
    stockLoading,
    movementsLoading,
    node,
    presented,
    stock,
    movements,
    groups,
    capabilities,
    actionKinds,
    permittedActions,
    queryValue,
    link,
    operation,
    close,
    retry,
    loadStock,
    loadMovements,
  };
}

export type WarehouseDetailController = ReturnType<
  typeof useWarehouseDetailController
>;
