import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useRoute, useRouter } from "vue-router";

import { api, workspaceApi } from "../../lib/api";

import {
  hydrateFilterQuery,
  serializeFilterQuery,
} from "../../composables/filters";

import type { SortState } from "../../components/SortableDataTable.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export function useLoansController() {
  const route = useRoute();
  const router = useRouter();
  const { surface: responsiveSurface, isSurface } = useResponsiveLayout();
  const surface = responsiveSurface;
  const scrollResetToken = ref(0);
  function requestScrollReset() {
    scrollResetToken.value += 1;
  }
  const boot = ref<any>();
  const activities = ref<any[]>([]);
  const activityQuery = ref("");
  const rows = ref<any[]>([]);
  const total = ref(0);
  const quantityTotals = ref<
    Record<string, Array<{ uom: string; qty: number }>>
  >({});
  const error = ref("");
  const loading = ref(false);
  const loadingMore = ref(false);
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);

  const filters = ref({
    search: "",
    loan_date: "",
    item_groups: [] as string[],
    warehouses: [] as string[],
    activity: "",
  });
  const status = computed(() =>
    route.query.status === "settled" ? "settled" : "outstanding",
  );
  const sort = ref<SortState>({ sort_by: "loan_date", sort_order: "desc" });
  const columns = [
    {
      key: "loan_date",
      label: "借出日期",
      sortable: true,
      initialOrder: "desc" as const,
    },
    { key: "borrower", label: "借用方", sortable: true },
    { key: "line_count", label: "物品行数", sortable: true },
    { key: "outstanding_lines", label: "未结物品行数", sortable: true },
    { key: "activity_title", label: "相关活动" },
    { key: "loan_status", label: "状态", sortable: true },
  ];
  const statusLabel = (value: string) =>
    (
      ({
        Outstanding: "未归还",
        "Partially Returned": "部分归还",
        Settled: "已结清",
      }) as Record<string, string>
    )[value] || value;
  const summaryMetrics = computed(() => [
    {
      key: "loaned_qty",
      label: "借出",
      quantities: quantityTotals.value.loaned_qty || [],
    },
    {
      key: "outstanding_qty",
      label: "未归还",
      quantities: quantityTotals.value.outstanding_qty || [],
    },
  ]);
  const activityOptions = computed(() =>
    activities.value.map((activity) => ({
      label: activity.title,
      value: activity.name,
    })),
  );
  const activeCount = computed(
    () =>
      (filters.value.search ? 1 : 0) +
      (filters.value.loan_date ? 1 : 0) +
      filters.value.item_groups.length +
      filters.value.warehouses.length +
      (filters.value.activity ? 1 : 0),
  );
  const chips = computed(() => [
    ...filters.value.warehouses.map((value) => ({
      key: "warehouses",
      value,
      label: `位置：${value}`,
    })),
    ...filters.value.item_groups.map((value) => ({
      key: "item_groups",
      value,
      label: `类别：${value}`,
    })),
    ...(filters.value.search
      ? [{ key: "search", label: `搜索：${filters.value.search}` }]
      : []),
    ...(filters.value.loan_date
      ? [{ key: "loan_date", label: `日期：${filters.value.loan_date}` }]
      : []),
    ...(filters.value.activity
      ? [
          {
            key: "activity",
            label: `活动：${activityOptions.value.find((option) => option.value === filters.value.activity)?.label || filters.value.activity}`,
          },
        ]
      : []),
  ]);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let syncingRoute = false;

  async function load(append = false) {
    const current = ++sequence;
    if (append) loadingMore.value = true;
    else loading.value = true;
    error.value = "";
    try {
      const data = await api("loans", {
        ...filters.value,
        status: status.value,
        start: append ? rows.value.length : 0,
        page_length: 25,
        ...sort.value,
      });
      if (current !== sequence) return;
      const incoming = data.results || [];
      rows.value = append
        ? [
            ...rows.value,
            ...incoming.filter(
              (row: any) => !rows.value.some((old) => old.name === row.name),
            ),
          ]
        : incoming;
      total.value = Number(data.total || 0);
      quantityTotals.value = data.quantity_totals || {};
      if (!append) {
        syncingRoute = true;
        await router.replace({
          query: {
            ...(status.value === "settled" ? { status: "settled" } : {}),
            ...serializeFilterQuery(filters.value),
            ...(sort.value.sort_by === "loan_date" &&
            sort.value.sort_order === "desc"
              ? {}
              : sort.value),
          },
        });
        syncingRoute = false;
      }
    } catch (cause: any) {
      syncingRoute = false;
      if (current === sequence) {
        error.value = cause.message;
        if (!append) quantityTotals.value = {};
      }
    } finally {
      if (current === sequence) {
        loading.value = false;
        loadingMore.value = false;
      }
    }
  }
  function scheduleLoad() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void load(), 220);
  }
  function removeChip(chip: any) {
    if (Array.isArray((filters.value as any)[chip.key]))
      (filters.value as any)[chip.key] = (filters.value as any)[
        chip.key
      ].filter((value: string) => value !== chip.value);
    else (filters.value as any)[chip.key] = "";
  }
  function clearFilters() {
    filters.value = {
      search: "",
      loan_date: "",
      item_groups: [],
      warehouses: [],
      activity: "",
    };
  }
  function openFilters(
    event?: Event,
    panel?: { openPanel: (event?: Event) => void } | null,
  ) {
    if (isSurface("desktop"))
      desktopFilterOpen.value = !desktopFilterOpen.value;
    else panel?.openPanel(event);
  }
  function openLoan(name: string) {
    void router.push("/loans/" + encodeURIComponent(name));
  }
  function createLoan() {
    return router.push("/new/Loan");
  }
  watch(
    [filters, status, sort],
    () => {
      if (boot.value) {
        requestScrollReset();
        scheduleLoad();
      }
    },
    { deep: true },
  );
  watch(
    () => route.query,
    (query) => {
      if (syncingRoute || !boot.value) return;
      const hydrated = hydrateFilterQuery(query as Record<string, unknown>, {
        search: "",
        loan_date: "",
        item_groups: [] as string[],
        warehouses: [] as string[],
        activity: "",
      });
      const next = {
        search: String(hydrated.search || ""),
        loan_date: String(hydrated.loan_date || ""),
        item_groups: hydrated.item_groups as string[],
        warehouses: hydrated.warehouses as string[],
        activity: String(hydrated.activity || ""),
      };
      if (JSON.stringify(next) !== JSON.stringify(filters.value))
        filters.value = next;
      const sortBy = String(query.sort_by || "loan_date"),
        sortOrder = String(query.sort_order || "desc");
      if (
        columns.some((column) => column.key === sortBy && column.sortable) &&
        ["asc", "desc"].includes(sortOrder)
      )
        sort.value = {
          sort_by: sortBy,
          sort_order: sortOrder as "asc" | "desc",
        };
    },
    { deep: true },
  );
  onMounted(async () => {
    try {
      const [bootstrap, activityData] = await Promise.all([
        api("bootstrap"),
        workspaceApi("activities"),
      ]);
      boot.value = bootstrap;
      activities.value = Array.isArray(activityData)
        ? activityData
        : Array.isArray(activityData?.results)
          ? activityData.results
          : [];
      const hydrated = hydrateFilterQuery(
        route.query as Record<string, unknown>,
        {
          search: "",
          loan_date: "",
          item_groups: [] as string[],
          warehouses: [] as string[],
          activity: "",
        },
      );
      filters.value = {
        search: String(hydrated.search || ""),
        loan_date: String(hydrated.loan_date || ""),
        item_groups: hydrated.item_groups as string[],
        warehouses: hydrated.warehouses as string[],
        activity: String(hydrated.activity || ""),
      };
      const sortBy = String(route.query.sort_by || "loan_date"),
        sortOrder = String(route.query.sort_order || "desc");
      if (
        columns.some((column) => column.key === sortBy && column.sortable) &&
        ["asc", "desc"].includes(sortOrder)
      )
        sort.value = {
          sort_by: sortBy,
          sort_order: sortOrder as "asc" | "desc",
        };
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
    activities,
    activityQuery,
    rows,
    total,
    quantityTotals,
    error,
    loading,
    loadingMore,
    filterOpen,
    desktopFilterOpen,
    filters,
    status,
    sort,
    columns,
    statusLabel,
    summaryMetrics,
    activityOptions,
    activeCount,
    chips,
    load,
    scheduleLoad,
    removeChip,
    clearFilters,
    openFilters,
    openLoan,
    createLoan,
  };
}

export type LoansController = ReturnType<typeof useLoansController>;
