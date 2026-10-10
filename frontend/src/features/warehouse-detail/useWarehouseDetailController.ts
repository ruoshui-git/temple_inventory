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
    exportOpen = ref(false),
    stockLoading = ref(true),
    movementsLoading = ref(true);
  let detailSequence = 0;
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
  async function loadDetail() {
    const currentRequest = ++detailSequence;
    stockLoading.value = true;
    movementsLoading.value = true;
    error.value = "";
    try {
      if (!boot.value) boot.value = await api("bootstrap");
      if (currentRequest !== detailSequence) return;
      const value = await api("warehouse_detail", {
        warehouse: route.params.warehouse,
      });
      if (currentRequest === detailSequence) detail.value = value;
    } catch (cause: any) {
      if (currentRequest === detailSequence) error.value = cause.message;
    } finally {
      if (currentRequest === detailSequence) {
        stockLoading.value = false;
        movementsLoading.value = false;
      }
    }
  }
  function retry() {
    return loadDetail();
  }
  function loadStock() {
    return loadDetail();
  }
  function loadMovements() {
    return loadDetail();
  }
  onMounted(loadDetail);

  return {
    route,
    router,
    detail,
    boot,
    error,
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
