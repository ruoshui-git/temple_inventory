import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { useRoute, useRouter } from "vue-router";

import type { MovementPeriodKey } from "../../components/MovementPeriodSelector.vue";
import type { SortState } from "../../components/SortableDataTable.vue";

import {
  hydrateFilterQuery,
  sameFilterValue,
  serializeFilterQuery,
} from "../../composables/filters";

import { api, labels, workspaceApi } from "../../lib/api";

import { warehousePresentation } from "../../lib/warehousePresenter";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export function useMovementOverviewController() {
  type MovementKind =
    | "Receive"
    | "Issue"
    | "Transfer"
    | "Loan"
    | "Return"
    | "Damage"
    | "Loss"
    | "Repair"
    | "Disposal";
  type Filters = {
    search: string;
    period_key: MovementPeriodKey;
    date_from: string;
    date_to: string;
    item_groups: string[];
    warehouses: string[];
    movement_kinds: string[];
  };
  type Quantity = { uom: string; qty: number };
  type ActionSummary = {
    movement_kind: MovementKind;
    quantities: Quantity[];
    item_count: number;
    record_count: number;
  };

  const actionGroups: Array<{ label: string; kinds: MovementKind[] }> = [
    { label: "日常流动", kinds: ["Receive", "Issue", "Transfer"] },
    {
      label: "借用与状态变化",
      kinds: ["Loan", "Return", "Damage", "Loss", "Repair", "Disposal"],
    },
  ];
  const allKinds = actionGroups.flatMap((group) => group.kinds);
  const route = useRoute();
  const router = useRouter();
  const { surface: responsiveSurface, isSurface } = useResponsiveLayout();
  const surface = responsiveSurface;
  const scrollResetToken = ref(0);
  function requestScrollReset() {
    scrollResetToken.value += 1;
  }
  const boot = ref<any>();
  const rows = ref<any[]>([]);
  const total = ref(0);
  const summaries = ref<ActionSummary[]>([]);
  const columnSummaries = ref<Record<string, any>>({});
  const facets = ref<Record<string, Record<string, number>>>({
    movement_kinds: {},
    item_groups: {},
    warehouses: {},
  });
  const resolved = ref({ date_from: "", date_to: "" });
  const busy = ref(true);
  const refreshing = ref(false);
  const appending = ref(false);
  const error = ref("");
  const appendError = ref("");
  const filterOpen = ref(false);
  const exportOpen = ref(false);

  const pageLength = 25;
  const defaultSort: SortState = {
    sort_by: "last_posting_date",
    sort_order: "desc",
  };
  const sort = ref<SortState>({ ...defaultSort });
  const filters = ref<Filters>({
    search: "",
    period_key: "last_30_days",
    date_from: "",
    date_to: "",
    item_groups: [],
    warehouses: [],
    movement_kinds: [],
  });
  const columns = [
    { key: "item_name", label: "物品", sortable: true },
    { key: "item_group", label: "类别" },
    { key: "movement_totals", label: "动作明细", summary: "movement_totals" },
    {
      key: "record_count",
      label: "相关记录",
      sortable: true,
      summary: "record_count",
    },
    {
      key: "last_posting_date",
      label: "最近变动",
      sortable: true,
      initialOrder: "desc" as const,
    },
  ];
  const activeCount = computed(
    () =>
      filters.value.item_groups.length +
      filters.value.warehouses.length +
      filters.value.movement_kinds.length,
  );
  const warehouseRows = computed(() => boot.value?.physical_tree || []);
  const recordTotal = computed(() =>
    filters.value.movement_kinds.length
      ? summaries.value
          .filter((summary) =>
            filters.value.movement_kinds.includes(summary.movement_kind),
          )
          .reduce((sum, summary) => sum + summary.record_count, 0)
      : summaries.value.reduce((sum, summary) => sum + summary.record_count, 0),
  );
  const chips = computed(() => [
    ...filters.value.movement_kinds.map((value) => ({
      key: "movement_kinds",
      value,
      label: `动作：${labels[value] || value}`,
    })),
    ...filters.value.item_groups.map((value) => ({
      key: "item_groups",
      value,
      label: `类别：${value}`,
    })),
    ...filters.value.warehouses.map((value) => ({
      key: "warehouses",
      value,
      label: `位置：${warehousePresentation(value, warehouseRows.value).breadcrumb}`,
    })),
    ...(filters.value.search
      ? [{ key: "search", label: `搜索：${filters.value.search}` }]
      : []),
  ]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let sequence = 0;
  let syncingRoute = false;
  let restoringRoute = false;

  const formatQuantity = (value: number) =>
    new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(
      Number(value || 0),
    );
  function actionSummary(kind: MovementKind) {
    return (
      summaries.value.find((summary) => summary.movement_kind === kind) || {
        movement_kind: kind,
        quantities: [],
        item_count: 0,
        record_count: 0,
      }
    );
  }
  function openItem(itemCode: string) {
    return router.push(`/item/${encodeURIComponent(itemCode)}`);
  }
  function nonzeroActions(row: any) {
    return allKinds.filter(
      (kind) => Number(row.movement_totals?.[kind] || 0) !== 0,
    );
  }
  function toggleKind(kind: MovementKind) {
    filters.value.movement_kinds = filters.value.movement_kinds.includes(kind)
      ? filters.value.movement_kinds.filter((value) => value !== kind)
      : [...filters.value.movement_kinds, kind];
  }
  function removeChip(chip: any) {
    const value = filters.value[chip.key as keyof Filters];
    if (Array.isArray(value))
      (filters.value as any)[chip.key] = value.filter(
        (item) => item !== chip.value,
      );
    else (filters.value as any)[chip.key] = "";
  }
  function clearAll() {
    filters.value.search = "";
    filters.value.item_groups = [];
    filters.value.warehouses = [];
    filters.value.movement_kinds = [];
  }
  function requestFilters() {
    return {
      period_key: filters.value.period_key,
      date_from:
        filters.value.period_key === "custom"
          ? filters.value.date_from
          : undefined,
      date_to:
        filters.value.period_key === "custom"
          ? filters.value.date_to
          : undefined,
      search: filters.value.search || undefined,
      item_groups: filters.value.item_groups.length
        ? filters.value.item_groups
        : undefined,
      warehouses: filters.value.warehouses.length
        ? filters.value.warehouses
        : undefined,
      movement_kinds: filters.value.movement_kinds.length
        ? filters.value.movement_kinds
        : undefined,
    };
  }
  const exportFilters = computed(() => ({
    ...requestFilters(),
    ...sort.value,
  }));
  function routeQuery() {
    return {
      ...serializeFilterQuery({
        period: filters.value.period_key,
        date_from:
          filters.value.period_key === "custom"
            ? filters.value.date_from
            : undefined,
        date_to:
          filters.value.period_key === "custom"
            ? filters.value.date_to
            : undefined,
        search: filters.value.search,
        item_groups: filters.value.item_groups,
        warehouses: filters.value.warehouses,
        actions: filters.value.movement_kinds,
      }),
      ...(JSON.stringify(sort.value) === JSON.stringify(defaultSort)
        ? {}
        : sort.value),
    };
  }
  function applyQuery(query: Record<string, unknown>) {
    const hydrated = hydrateFilterQuery(query, {
      period: "last_30_days",
      date_from: "",
      date_to: "",
      posting_date: "",
      search: "",
      item_groups: [] as string[],
      warehouses: [] as string[],
      actions: [] as string[],
    });
    const legacyDate = String(hydrated.posting_date || "");
    const requestedPeriod = legacyDate
      ? "custom"
      : String(hydrated.period || "last_30_days");
    const validPeriods = [
      "today",
      "last_7_days",
      "last_30_days",
      "last_90_days",
      "last_365_days",
      "this_week",
      "this_month",
      "this_year",
      "custom",
    ];
    const next: Filters = {
      search: String(hydrated.search || ""),
      period_key: (validPeriods.includes(requestedPeriod)
        ? requestedPeriod
        : "last_30_days") as MovementPeriodKey,
      date_from: legacyDate || String(hydrated.date_from || ""),
      date_to: legacyDate || String(hydrated.date_to || ""),
      item_groups: hydrated.item_groups as string[],
      warehouses: hydrated.warehouses as string[],
      movement_kinds: (hydrated.actions as string[]).filter((kind) =>
        allKinds.includes(kind as MovementKind),
      ),
    };
    const requestedSort = String(query.sort_by || "");
    const requestedOrder = String(query.sort_order || "");
    const nextSort =
      ["item_name", "item_code", "record_count", "last_posting_date"].includes(
        requestedSort,
      ) && ["asc", "desc"].includes(requestedOrder)
        ? {
            sort_by: requestedSort,
            sort_order: requestedOrder as "asc" | "desc",
          }
        : { ...defaultSort };
    const changed = Object.keys(next).some(
      (key) =>
        !sameFilterValue(
          filters.value[key as keyof Filters],
          next[key as keyof Filters],
        ),
    );
    const sortChanged =
      sort.value.sort_by !== nextSort.sort_by ||
      sort.value.sort_order !== nextSort.sort_order;
    if (!changed && !sortChanged) return false;
    restoringRoute = true;
    filters.value = next;
    sort.value = nextSort;
    void nextTick(() => {
      restoringRoute = false;
    });
    return true;
  }
  function openFilters(
    event?: Event,
    panel?: { openPanel: (event?: Event) => void } | null,
  ) {
    if (isSurface("desktop")) {
      filterOpen.value = !filterOpen.value;
      return;
    }
    panel?.openPanel(event);
  }
  async function load(append = false, debounce = false) {
    if (
      !boot.value ||
      (append && (appending.value || rows.value.length >= total.value))
    )
      return;
    if (timer) clearTimeout(timer);
    if (!append) controller?.abort();
    const current = ++sequence;
    const requestController = new AbortController();
    if (!append) controller = requestController;
    if (append) appending.value = true;
    else if (rows.value.length) refreshing.value = true;
    else busy.value = true;
    if (append) appendError.value = "";
    else error.value = "";
    const run = async () => {
      try {
        const data = await workspaceApi(
          "movement_overview",
          {
            filters: requestFilters(),
            start: append ? rows.value.length : 0,
            page_length: pageLength,
            ...sort.value,
          },
          requestController.signal,
        );
        if (current !== sequence) return;
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
        summaries.value = data.action_summaries || [];
        columnSummaries.value = data.column_summaries || {};
        facets.value = data.facets || facets.value;
        resolved.value = {
          date_from: data.resolved_period?.date_from || "",
          date_to: data.resolved_period?.date_to || "",
        };
        if (!append) {
          syncingRoute = true;
          await router.replace({ query: routeQuery() });
          syncingRoute = false;
        }
      } catch (cause: any) {
        syncingRoute = false;
        if (current === sequence && cause?.name !== "AbortError") {
          if (append) appendError.value = cause.message;
          else error.value = cause.message;
        }
      } finally {
        if (current === sequence) {
          busy.value = false;
          refreshing.value = false;
          appending.value = false;
        }
      }
    };
    if (debounce) timer = setTimeout(() => void run(), 300);
    else await run();
  }

  watch(
    filters,
    (value, previous) => {
      if (!boot.value || restoringRoute) return;
      requestScrollReset();
      void load(false, value.search !== previous.search);
    },
    { deep: true },
  );
  watch(
    sort,
    () => {
      if (!boot.value || restoringRoute) return;
      requestScrollReset();
      void load();
    },
    { deep: true },
  );
  watch(
    () => route.query,
    (query) => {
      if (!syncingRoute && applyQuery(query as Record<string, unknown>))
        void load();
    },
    { deep: true },
  );
  onMounted(async () => {
    try {
      boot.value = await api("bootstrap");
      applyQuery(route.query as Record<string, unknown>);
      await load();
    } catch (cause: any) {
      error.value = cause.message;
      busy.value = false;
    }
  });
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    controller?.abort();
  });
  return {
    actionGroups,
    allKinds,
    route,
    router,
    surface,
    scrollResetToken,
    boot,
    rows,
    total,
    summaries,
    columnSummaries,
    facets,
    resolved,
    busy,
    refreshing,
    appending,
    error,
    appendError,
    filterOpen,
    exportOpen,
    pageLength,
    defaultSort,
    sort,
    filters,
    columns,
    activeCount,
    warehouseRows,
    recordTotal,
    chips,
    formatQuantity,
    actionSummary,
    openItem,
    nonzeroActions,
    toggleKind,
    removeChip,
    clearAll,
    requestFilters,
    exportFilters,
    routeQuery,
    applyQuery,
    openFilters,
    load,
    labels,
  };
}

export type MovementOverviewController = ReturnType<
  typeof useMovementOverviewController
>;
