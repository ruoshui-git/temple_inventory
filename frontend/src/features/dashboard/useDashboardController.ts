import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../lib/api";
import {
  hydrateFilterQuery,
  serializeFilterQuery,
} from "../../composables/filters";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export const DASHBOARD_SECTIONS = [
  "inventory",
  "expiry",
  "movement",
  "loans",
  "reminders",
  "distribution",
] as const;
export type DashboardSection = (typeof DASHBOARD_SECTIONS)[number];
type SectionState = { loading: boolean; error: string; stale: boolean };

export function useDashboardController() {
  const route = useRoute();
  const router = useRouter();
  const { surface } = useResponsiveLayout();
  const defaults = { warehouses: [] as string[], item_groups: [] as string[] };
  const filters = ref(hydrateFilterQuery(route.query, defaults));
  const data = ref<any>({});
  const sectionState = ref<Record<DashboardSection, SectionState>>(
    Object.fromEntries(
      DASHBOARD_SECTIONS.map((section) => [
        section,
        { loading: false, error: "", stale: false },
      ]),
    ) as Record<DashboardSection, SectionState>,
  );
  const hasSuccessfulData = ref(false);
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const movementPeriod = ref("this_month");
  const expiryPreview = ref<"expired" | "upcoming">("expired");
  const distributionMode = ref<"warehouse" | "category">("warehouse");
  let scopeGeneration = 0;
  const sectionSequences: Record<DashboardSection, number> = {
    inventory: 0,
    expiry: 0,
    movement: 0,
    loans: 0,
    reminders: 0,
    distribution: 0,
  };

  const loading = computed(() =>
    DASHBOARD_SECTIONS.some((name) => sectionState.value[name].loading),
  );
  const refreshing = computed(() => hasSuccessfulData.value && loading.value);
  const error = computed(
    () =>
      DASHBOARD_SECTIONS.map((name) => sectionState.value[name].error).find(
        Boolean,
      ) || "",
  );
  const boot = computed(() => data.value);
  const warehouseRows = computed(() => data.value.warehouses || []);
  const categoryRows = computed(() =>
    (data.value.item_groups || []).filter(
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

  function sectionBusy(section: DashboardSection) {
    return sectionState.value[section].loading;
  }
  function sectionStale(section: DashboardSection) {
    return (
      sectionState.value[section].stale ||
      Boolean(sectionState.value[section].error)
    );
  }
  function sectionError(section: DashboardSection) {
    return sectionState.value[section].error;
  }
  function retrySection(section: DashboardSection) {
    void load([section]);
  }

  function markGlobalScopePending() {
    scopeGeneration += 1;
    for (const section of DASHBOARD_SECTIONS) {
      sectionState.value[section] = {
        ...sectionState.value[section],
        loading: true,
        error: "",
        stale: Boolean(data.value[section]),
      };
    }
  }

  async function load(sections?: DashboardSection[]) {
    const full = !sections?.length || !hasSuccessfulData.value;
    const requested = full ? [...DASHBOARD_SECTIONS] : [...new Set(sections)];
    if (full) scopeGeneration += 1;
    const generation = scopeGeneration;
    const sequences = Object.fromEntries(
      requested.map((section) => {
        const sequence = ++sectionSequences[section];
        sectionState.value[section] = {
          ...sectionState.value[section],
          loading: true,
          error: "",
          stale: Boolean(data.value[section]),
        };
        return [section, sequence];
      }),
    ) as Partial<Record<DashboardSection, number>>;
    const params: Record<string, unknown> = {
      warehouses: filters.value.warehouses,
      item_groups: filters.value.item_groups,
      period_key: movementPeriod.value,
      expiry_preview: expiryPreview.value,
      distribution_mode: distributionMode.value,
    };
    if (!full) params.sections = requested;
    try {
      const result = await api("dashboard_summary", params);
      if (generation !== scopeGeneration) return;
      const accepted = requested.filter(
        (section) => sequences[section] === sectionSequences[section],
      );
      if (!accepted.length) return;
      const next = { ...data.value };
      for (const section of accepted) {
        if (result[section] !== undefined) next[section] = result[section];
      }
      if (full) {
        next.scope = result.scope;
        next.generated_at = result.generated_at;
        next.warehouses = result.warehouses;
        next.item_groups = result.item_groups;
      } else {
        next.scope = result.scope;
        next.generated_at = result.generated_at;
      }
      data.value = next;
      for (const section of requested) {
        if (sequences[section] !== sectionSequences[section]) continue;
        sectionState.value[section] = {
          loading: false,
          error: "",
          stale: false,
        };
      }
      if (
        full &&
        requested.every((section) => data.value[section] !== undefined)
      ) {
        hasSuccessfulData.value = true;
      }
    } catch (cause: any) {
      if (generation !== scopeGeneration) return;
      for (const section of requested) {
        if (sequences[section] !== sectionSequences[section]) continue;
        sectionState.value[section] = {
          loading: false,
          error: cause?.message || "加载失败",
          stale: Boolean(data.value[section]),
        };
      }
    }
  }

  async function updateFilters(next: typeof defaults) {
    markGlobalScopePending();
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
        markGlobalScopePending();
        filters.value = next;
        void load();
      }
    },
    { deep: true, flush: "sync" },
  );
  watch(movementPeriod, () => void load(["movement"]));
  watch(expiryPreview, () => void load(["expiry"]));
  watch(distributionMode, () => void load(["distribution"]));
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
    hasSuccessfulData,
    sectionState,
    sectionBusy,
    sectionStale,
    sectionError,
    retrySection,
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
