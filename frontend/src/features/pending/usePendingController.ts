import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useRoute, useRouter } from "vue-router";

import { api } from "../../lib/api";

import { warehousePresentation } from "../../lib/warehousePresenter";

import {
  hydrateFilterQuery,
  serializeFilterQuery,
} from "../../composables/filters";

import { returnToOpener } from "../../lib/navigation";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export function usePendingController() {
  const route = useRoute(),
    router = useRouter();
  const { surface: responsiveSurface, isSurface } = useResponsiveLayout();
  const surface = responsiveSurface;
  const scrollResetToken = ref(0);
  function requestScrollReset() {
    scrollResetToken.value += 1;
  }
  const boot = ref<any>(),
    rows = ref<any[]>([]),
    total = ref(0),
    overall = ref(0),
    facets = ref<any>({ warehouses: {}, item_groups: {} }),
    quantityTotals = ref<Record<string, Array<{ uom: string; qty: number }>>>(
      {},
    );
  const error = ref(""),
    loading = ref(false),
    loadingMore = ref(false),
    mode = ref<"all" | "damaged" | "unlocated">(
      route.query.mode === "unlocated"
        ? "unlocated"
        : route.query.mode === "all"
          ? "all"
          : "damaged",
    );

  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const operationCaps = computed(
    () => boot.value?.stock_operation_capabilities || {},
  );
  const filters = ref({
    search: "",
    warehouses: [] as string[],
    item_groups: [] as string[],
  });
  const warehouseRows = computed(() => boot.value?.physical_tree || []);
  const summaryMetrics = computed(() => [
    {
      key: "damaged_qty",
      label: "损坏",
      quantities: quantityTotals.value.damaged_qty || [],
    },
    {
      key: "pending_qty",
      label: "未定位",
      quantities: quantityTotals.value.pending_qty || [],
    },
  ]);
  const warehouseText = (name: string) =>
    warehousePresentation(name, warehouseRows.value).breadcrumb;
  const chips = computed(() => [
    ...filters.value.warehouses.map((value) => ({
      key: "warehouses",
      value,
      label: warehouseText(value),
    })),
    ...filters.value.item_groups.map((value) => ({
      key: "item_groups",
      value,
      label:
        boot.value?.item_groups?.find((row: any) => row.name === value)
          ?.item_group_name || value,
    })),
    ...(filters.value.search
      ? [{ key: "search", label: `搜索：${filters.value.search}` }]
      : []),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function load(append = false) {
    if (
      append &&
      (loading.value || loadingMore.value || rows.value.length >= total.value)
    )
      return;
    append ? (loadingMore.value = true) : (loading.value = true);
    error.value = "";
    try {
      const data = await api("pending", {
        mode: mode.value,
        ...filters.value,
        warehouses: filters.value.warehouses.length
          ? filters.value.warehouses
          : undefined,
        item_groups: filters.value.item_groups.length
          ? filters.value.item_groups
          : undefined,
        start: append ? rows.value.length : 0,
        page_length: 25,
      });
      const incoming = data.results || [];
      rows.value = append
        ? [
            ...rows.value,
            ...incoming.filter(
              (row: any) =>
                !rows.value.some((old) => old.item_code === row.item_code),
            ),
          ]
        : incoming;
      total.value = Number(data.total || 0);
      overall.value = Number(data.overall_total || 0);
      facets.value = data.facets || facets.value;
      quantityTotals.value = data.quantity_totals || {};
    } catch (cause: any) {
      error.value = cause.message;
      if (!append) quantityTotals.value = {};
    } finally {
      loading.value = false;
      loadingMore.value = false;
    }
  }
  function begin(row: any, kind: string) {
    sessionStorage.setItem(
      `ti-seed:${kind}`,
      JSON.stringify({ items: [row.item_code] }),
    );
    void router.push(`/new/${kind}`);
  }
  function removeChip(chip: any) {
    if (chip.key === "search") filters.value.search = "";
    else
      (filters.value as any)[chip.key] = (filters.value as any)[
        chip.key
      ].filter((value: string) => value !== chip.value);
  }
  function clearFilters() {
    filters.value = { search: "", warehouses: [], item_groups: [] };
  }
  function openFilters(
    event?: Event,
    panel?: { openPanel: (event?: Event) => void } | null,
  ) {
    if (isSurface("desktop"))
      desktopFilterOpen.value = !desktopFilterOpen.value;
    else panel?.openPanel(event);
  }
  function close() {
    void returnToOpener(router, "/");
  }
  watch(
    [mode, filters],
    () => {
      if (!boot.value) return;
      if (timer) clearTimeout(timer);
      void router.replace({
        query: { ...serializeFilterQuery(filters.value), mode: mode.value },
      });
      timer = setTimeout(() => void load(), 280);
    },
    { deep: true },
  );
  watch(
    () => route.query,
    (query) => {
      mode.value =
        query.mode === "unlocated"
          ? "unlocated"
          : query.mode === "all"
            ? "all"
            : "damaged";
      const next = hydrateFilterQuery(
        query as Record<string, unknown>,
        filters.value,
      );
      if (JSON.stringify(next) !== JSON.stringify(filters.value))
        filters.value = next;
    },
    { deep: true },
  );
  onMounted(async () => {
    try {
      boot.value = await api("bootstrap");
      filters.value = hydrateFilterQuery(
        route.query as Record<string, unknown>,
        filters.value,
      );
      await load();
    } catch (cause: any) {
      error.value = cause.message;
    }
  });
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
  });
  return {
    route,
    router,
    surface,
    scrollResetToken,
    boot,
    rows,
    total,
    overall,
    facets,
    quantityTotals,
    error,
    loading,
    loadingMore,
    mode,
    filterOpen,
    desktopFilterOpen,
    operationCaps,
    filters,
    warehouseRows,
    summaryMetrics,
    warehouseText,
    chips,
    load,
    begin,
    removeChip,
    clearFilters,
    openFilters,
    close,
  };
}

export type PendingController = ReturnType<typeof usePendingController>;
