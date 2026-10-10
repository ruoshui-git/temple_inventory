import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../lib/api";
import {
  hydrateFilterQuery,
  serializeFilterQuery,
} from "../../composables/filters";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export function useDashboardController() {
  const route = useRoute();
  const router = useRouter();
  const { surface } = useResponsiveLayout();
  const defaults = { warehouses: [] as string[], item_groups: [] as string[] };
  const filters = ref(hydrateFilterQuery(route.query, defaults));
  const data = ref<any>();
  const loading = ref(true);
  const refreshing = ref(false);
  const error = ref("");
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const movementPeriod = ref("this_month");
  const expiryPreview = ref<"expired" | "upcoming">("expired");
  const distributionMode = ref<"warehouse" | "category">("warehouse");
  let requestSequence = 0;

  const boot = computed(() => data.value || {});
  const warehouseRows = computed(() => boot.value.warehouses || []);
  const categoryRows = computed(() =>
    (boot.value.item_groups || []).filter(
      (row: any) => row.name !== "All Item Groups",
    ),
  );
  const activeFilterCount = computed(
    () => filters.value.warehouses.length + filters.value.item_groups.length,
  );
  const activeScopeLabel = computed(() => {
    if (!activeFilterCount.value) return "全部仓库 · 全部类别";
    const labels = [
      ...filters.value.warehouses.map(
        (name) =>
          warehouseRows.value.find((row: any) => row.name === name)
            ?.local_label || name,
      ),
      ...filters.value.item_groups.map(
        (name) =>
          categoryRows.value.find((row: any) => row.name === name)
            ?.item_group_name || name,
      ),
    ];
    return labels.join(" · ");
  });
  const movementSummaries = computed(
    () => data.value?.movement?.summaries || [],
  );
  const expiryBuckets = computed(
    () => Object.values(data.value?.expiry?.buckets || {}) as any[],
  );

  async function load() {
    const sequence = ++requestSequence;
    if (data.value) refreshing.value = true;
    else loading.value = true;
    error.value = "";
    try {
      const result = await api("dashboard_summary", {
        warehouses: filters.value.warehouses,
        item_groups: filters.value.item_groups,
        period_key: movementPeriod.value,
        expiry_preview: expiryPreview.value,
        distribution_mode: distributionMode.value,
      });
      if (sequence === requestSequence) data.value = result;
    } catch (cause: any) {
      if (sequence === requestSequence)
        error.value = cause?.message || "加载首页失败";
    } finally {
      if (sequence === requestSequence) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  }

  async function updateFilters(next: typeof defaults) {
    filters.value = next;
    await router.replace({ query: serializeFilterQuery(next) });
    await load();
  }
  function clearFilters() {
    void updateFilters({ warehouses: [], item_groups: [] });
  }
  function refresh() {
    void load();
  }

  watch(
    () => route.query,
    (query) => {
      const next = hydrateFilterQuery(query, defaults);
      if (JSON.stringify(next) !== JSON.stringify(filters.value)) {
        filters.value = next;
        void load();
      }
    },
    { deep: true },
  );
  watch([movementPeriod, expiryPreview, distributionMode], () => void load());
  watch(surface, (next) => {
    if (next === "mobile" && desktopFilterOpen.value) filterOpen.value = true;
    if (next === "desktop" && filterOpen.value) desktopFilterOpen.value = true;
  });
  onMounted(() => void load());

  return {
    surface,
    route,
    filters,
    data,
    boot,
    loading,
    refreshing,
    error,
    filterOpen,
    desktopFilterOpen,
    movementPeriod,
    expiryPreview,
    distributionMode,
    warehouseRows,
    categoryRows,
    activeFilterCount,
    activeScopeLabel,
    movementSummaries,
    expiryBuckets,
    updateFilters,
    clearFilters,
    refresh,
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;
