import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import { useRoute, useRouter } from "vue-router";

import { api, labels, workspaceApi } from "../../lib/api";

import { warehousePresentation } from "../../lib/warehousePresenter";

import {
  hydrateFilterQuery,
  sameFilterValue,
  serializeFilterQuery,
} from "../../composables/filters";

import type { MovementPeriodKey } from "../../components/MovementPeriodSelector.vue";
import type { SortState } from "../../components/SortableDataTable.vue";

import { returnToOpener } from "../../lib/navigation";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
type Destination = "movements" | "drafts";

export function useHistoryController(destination: Destination = "movements") {
  type HistoryFilters = {
    search: string;
    posting_date: string;
    period_key: MovementPeriodKey;
    date_from: string;
    date_to: string;
    movement_kind: string;
    item_groups: string[];
    warehouses: string[];
    source_warehouses: string[];
    destination_warehouses: string[];
  };
  type WarehouseRole = "source" | "destination";
  type MovementWarehouseColumn = {
    key: string;
    label: string;
    role: WarehouseRole;
    sortable?: boolean;
  };

  const props = { destination };
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
  const overallTotal = ref(0);
  const quantityTotals = ref<
    Record<string, Array<{ uom: string; qty: number }>>
  >({});
  const columnSummaries = ref<Record<string, any>>({});
  const resolvedPeriod = ref({ date_from: "", date_to: "" });
  const facets = ref<Record<string, Record<string, number>>>({
    movement_kind: {},
    warehouses: {},
    source_warehouses: {},
    destination_warehouses: {},
    item_groups: {},
  });
  const start = ref(0);
  const error = ref("");
  const appendError = ref("");
  const busy = ref(true);
  const refreshing = ref(false);
  const appending = ref(false);
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const exportOpen = ref(false);

  const pageLength = 25;
  const defaultSort: SortState = {
    sort_by: "posting_date",
    sort_order: "desc",
  };
  const sort = ref<SortState>({ ...defaultSort });
  const movementKind = computed(() => {
    const requested = String(
      route.query.kind || route.query.movement_kind || "",
    );
    return ["Issue", "Transfer"].includes(requested) ? requested : "Receive";
  });
  const statusGroup = computed(() =>
    props.destination === "drafts" ? "unfinished" : "completed",
  );
  const operationCaps = computed(
    () => boot.value?.stock_operation_capabilities || {},
  );
  const warehouseRows = computed(() => boot.value?.physical_tree || []);
  const scrollKey = computed(
    () => `temple_inventory.scroll.${props.destination}`,
  );
  const filters = ref<HistoryFilters>({
    search: "",
    posting_date: "",
    period_key: "all",
    date_from: "",
    date_to: "",
    movement_kind: "",
    item_groups: [],
    warehouses: [],
    source_warehouses: [],
    destination_warehouses: [],
  });

  const movementWarehouseColumns = computed<MovementWarehouseColumn[]>(() => {
    if (movementKind.value === "Receive") {
      return [
        {
          key: "destination_warehouses",
          label: "入库位置",
          role: "destination",
        },
      ];
    }
    if (movementKind.value === "Issue") {
      return [{ key: "source_warehouses", label: "出库位置", role: "source" }];
    }
    return [
      { key: "source_warehouses", label: "来源位置", role: "source" },
      { key: "destination_warehouses", label: "去向位置", role: "destination" },
    ];
  });
  const movementColumns = computed(() => [
    {
      key: "posting_date",
      label: "日期",
      sortable: true,
      initialOrder: "desc" as const,
    },
    {
      key: "line_count",
      label: "物品行数",
      sortable: true,
      summary: "line_count",
    },
    {
      key: "moved_qty",
      label: "数量",
      summary: "moved_qty",
    },
    ...movementWarehouseColumns.value,
    {
      key: "category_count",
      label: "相关类别",
      sortable: true,
      summary: "category_count",
    },
    { key: "status", label: "状态" },
  ]);
  const draftColumns = [
    { key: "movement_kind", label: "类型", sortable: true },
    {
      key: "posting_date",
      label: "日期",
      sortable: true,
      initialOrder: "desc" as const,
    },
    {
      key: "line_count",
      label: "物品行数",
      sortable: true,
      summary: "line_count",
    },
    {
      key: "draft_action_qty",
      label: "操作数量",
      summary: "draft_action_qty",
    },
    { key: "status", label: "状态" },
    { key: "actions", label: "操作" },
  ];
  const sortColumns = computed(() =>
    props.destination === "drafts" ? draftColumns : movementColumns.value,
  );
  const summaryMetrics = computed(() => {
    if (props.destination === "drafts")
      return [
        {
          key: "draft_action_qty",
          label: "草稿操作量",
          quantities: quantityTotals.value.draft_action_qty || [],
        },
      ];
    return [
      {
        key: "moved_qty",
        label:
          movementKind.value === "Receive"
            ? "入库数量"
            : movementKind.value === "Issue"
              ? "出库数量"
              : "转移数量",
        quantities: quantityTotals.value.moved_qty || [],
      },
    ];
  });
  function formatQuantities(
    values: Array<{ uom: string; qty: number }> | undefined,
  ) {
    return (
      (values || [])
        .map(
          (value) =>
            `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value.qty)} ${value.uom}`,
        )
        .join(" · ") || "—"
    );
  }
  const activeCount = computed(
    () =>
      (filters.value.search ? 1 : 0) +
      (props.destination !== "movements" && filters.value.posting_date
        ? 1
        : 0) +
      filters.value.item_groups.length +
      filters.value.warehouses.length +
      filters.value.source_warehouses.length +
      filters.value.destination_warehouses.length,
  );
  const warehouseText = (name: string) =>
    warehousePresentation(name, warehouseRows.value).breadcrumb;
  function locationsFor(row: any, role: WarehouseRole) {
    return (row.locations || []).filter((location: any) =>
      location.roles?.includes(role),
    );
  }
  function warehouseColumnLabel(role: WarehouseRole) {
    return (
      movementWarehouseColumns.value.find((column) => column.role === role)
        ?.label || "位置"
    );
  }
  const chips = computed(() => [
    ...filters.value.warehouses.map((value) => ({
      key: "warehouses",
      value,
      label: warehouseText(value),
    })),
    ...filters.value.source_warehouses.map((value) => ({
      key: "source_warehouses",
      value,
      label: `来源：${warehouseText(value)}`,
    })),
    ...filters.value.destination_warehouses.map((value) => ({
      key: "destination_warehouses",
      value,
      label: `去向：${warehouseText(value)}`,
    })),
    ...filters.value.item_groups.map((value) => ({
      key: "item_groups",
      value,
      label: `类别：${value}`,
    })),
    ...(filters.value.search
      ? [{ key: "search", label: `搜索：${filters.value.search}` }]
      : []),
    ...(props.destination !== "movements" && filters.value.posting_date
      ? [{ key: "posting_date", label: `日期：${filters.value.posting_date}` }]
      : []),
  ]);

  function removeChip(chip: any) {
    const value = filters.value[chip.key as keyof HistoryFilters];
    if (Array.isArray(value))
      (filters.value as any)[chip.key] = value.filter(
        (item) => item !== chip.value,
      );
    else (filters.value as any)[chip.key] = "";
  }
  function clearAll() {
    filters.value = {
      search: "",
      posting_date: "",
      period_key: "all",
      date_from: "",
      date_to: "",
      movement_kind: "",
      item_groups: [],
      warehouses: [],
      source_warehouses: [],
      destination_warehouses: [],
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
  function requestFilters() {
    const base: Record<string, unknown> = {
      search: filters.value.search || undefined,
      posting_date:
        props.destination === "movements"
          ? undefined
          : filters.value.posting_date || undefined,
      period_key:
        props.destination === "movements"
          ? filters.value.period_key
          : undefined,
      date_from:
        props.destination === "movements" &&
        filters.value.period_key === "custom"
          ? filters.value.date_from
          : undefined,
      date_to:
        props.destination === "movements" &&
        filters.value.period_key === "custom"
          ? filters.value.date_to
          : undefined,
      item_groups: filters.value.item_groups.length
        ? filters.value.item_groups
        : undefined,
    };
    if (props.destination === "movements") {
      base.movement_kind = movementKind.value;
      if (movementKind.value === "Receive")
        base.destination_warehouses = filters.value.destination_warehouses
          .length
          ? filters.value.destination_warehouses
          : undefined;
      if (movementKind.value === "Issue")
        base.source_warehouses = filters.value.source_warehouses.length
          ? filters.value.source_warehouses
          : undefined;
      if (movementKind.value === "Transfer") {
        base.source_warehouses = filters.value.source_warehouses.length
          ? filters.value.source_warehouses
          : undefined;
        base.destination_warehouses = filters.value.destination_warehouses
          .length
          ? filters.value.destination_warehouses
          : undefined;
      }
    } else {
      base.movement_kind = undefined;
      base.warehouses = filters.value.warehouses.length
        ? filters.value.warehouses
        : undefined;
    }
    return base;
  }
  const exportFilters = computed(() => ({
    ...requestFilters(),
    movement_kind: undefined,
    movement_kinds: movementKind.value ? [movementKind.value] : undefined,
    ...sort.value,
  }));
  function routeQuery() {
    const queryFilters: Record<string, unknown> = {
      search: filters.value.search,
      posting_date:
        props.destination === "movements"
          ? undefined
          : filters.value.posting_date,
      period:
        props.destination === "movements"
          ? filters.value.period_key === "all"
            ? undefined
            : filters.value.period_key
          : undefined,
      date_from:
        props.destination === "movements" &&
        filters.value.period_key === "custom"
          ? filters.value.date_from
          : undefined,
      date_to:
        props.destination === "movements" &&
        filters.value.period_key === "custom"
          ? filters.value.date_to
          : undefined,
      item_groups: filters.value.item_groups,
      warehouses: filters.value.warehouses,
      source_warehouses: filters.value.source_warehouses,
      destination_warehouses: filters.value.destination_warehouses,
      movement_kind: undefined,
      start: start.value || undefined,
    };
    return {
      ...(props.destination === "movements"
        ? { kind: movementKind.value }
        : {}),
      ...serializeFilterQuery(queryFilters),
      ...(JSON.stringify(sort.value) === JSON.stringify(defaultSort)
        ? {}
        : sort.value),
    };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let sequence = 0;
  let syncingRoute = false;
  let restoringRoute = false;

  function close() {
    void returnToOpener(router, "/more");
  }

  function operation(kind: string) {
    void router.push(`/new/${kind}`);
  }

  function activate(row: any) {
    const path =
      row.document_type === "Stock Reconciliation"
        ? `/reconcile/${encodeURIComponent(row.name)}`
        : row.legacy
          ? `/entry/${encodeURIComponent(row.name)}`
          : `/workspace/${encodeURIComponent(row.name)}`;
    void router.push(path);
  }

  async function deleteDraft(name: string) {
    if (!window.confirm("确定删除这条未完成记录吗？此操作无法撤销。")) return;
    try {
      await workspaceApi("delete_draft", { name });
      window.dispatchEvent(new Event("ti:refresh-shell"));
      await load();
    } catch (cause: any) {
      error.value = cause.message;
    }
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
        const offset = append ? rows.value.length : start.value;
        const data = await workspaceApi(
          "history",
          {
            filters: requestFilters(),
            start: offset,
            page_length: pageLength,
            status_group: statusGroup.value,
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
                (row: any) => !rows.value.some((old) => old.name === row.name),
              ),
            ]
          : incoming;
        total.value = Number(data.total || 0);
        overallTotal.value = Number(data.overall_total || 0);
        quantityTotals.value = data.quantity_totals || {};
        columnSummaries.value = data.column_summaries || {};
        if (data.resolved_period)
          resolvedPeriod.value = {
            date_from: data.resolved_period.date_from || "",
            date_to: data.resolved_period.date_to || "",
          };
        facets.value = data.facets || facets.value;
        if (!append) {
          syncingRoute = true;
          await router.replace({ query: routeQuery() });
          syncingRoute = false;
        }
      } catch (cause: any) {
        syncingRoute = false;
        if (current === sequence && cause?.name !== "AbortError") {
          if (append) appendError.value = cause.message;
          else {
            error.value = cause.message;
            quantityTotals.value = {};
          }
        }
      } finally {
        if (current === sequence) {
          busy.value = false;
          refreshing.value = false;
          appending.value = false;
        }
      }
    };
    if (debounce)
      timer = setTimeout(() => {
        void run();
      }, 300);
    else await run();
  }

  function applyQuery(query: Record<string, unknown>) {
    const hydrated = hydrateFilterQuery(query, {
      search: "",
      posting_date: "",
      period: "all",
      date_from: "",
      date_to: "",
      movement_kind: "",
      item_groups: [] as string[],
      warehouses: [] as string[],
      source_warehouses: [] as string[],
      destination_warehouses: [] as string[],
      start: "0",
    });
    const legacyDate =
      props.destination === "movements"
        ? String(hydrated.posting_date || "")
        : "";
    const requestedPeriod = legacyDate
      ? "custom"
      : String(hydrated.period || "all");
    const validPeriods = [
      "all",
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
    const next: HistoryFilters = {
      search: String(hydrated.search || ""),
      posting_date:
        props.destination === "movements"
          ? ""
          : String(hydrated.posting_date || ""),
      period_key: (validPeriods.includes(requestedPeriod)
        ? requestedPeriod
        : "all") as MovementPeriodKey,
      date_from: legacyDate || String(hydrated.date_from || ""),
      date_to: legacyDate || String(hydrated.date_to || ""),
      movement_kind: "",
      item_groups: hydrated.item_groups as string[],
      warehouses: hydrated.warehouses as string[],
      source_warehouses: hydrated.source_warehouses as string[],
      destination_warehouses: hydrated.destination_warehouses as string[],
    };
    const requestedSort = String(query.sort_by || "");
    const requestedOrder = String(query.sort_order || "");
    const validKeys = sortColumns.value
      .filter((column) => column.sortable)
      .map((column) => column.key);
    const nextSort: SortState =
      validKeys.includes(requestedSort) &&
      ["asc", "desc"].includes(requestedOrder)
        ? {
            sort_by: requestedSort,
            sort_order: requestedOrder as "asc" | "desc",
          }
        : { ...defaultSort };
    const nextStart = Math.max(0, Number(hydrated.start) || 0);
    const changed = Object.keys(next).some(
      (key) =>
        !sameFilterValue(
          filters.value[key as keyof HistoryFilters],
          next[key as keyof HistoryFilters],
        ),
    );
    const sortChanged =
      sort.value.sort_by !== nextSort.sort_by ||
      sort.value.sort_order !== nextSort.sort_order;
    if (!changed && !sortChanged && start.value === nextStart) return false;
    restoringRoute = true;
    filters.value = next;
    sort.value = nextSort;
    start.value = nextStart;
    void nextTick(() => {
      restoringRoute = false;
    });
    return true;
  }

  watch(
    filters,
    (value, previous) => {
      if (!boot.value || restoringRoute) return;
      start.value = 0;
      requestScrollReset();
      void load(false, value.search !== previous.search);
    },
    { deep: true },
  );
  watch(
    sort,
    () => {
      if (!boot.value || restoringRoute) return;
      start.value = 0;
      requestScrollReset();
      void load();
    },
    { deep: true },
  );
  watch(
    () => filters.value.period_key,
    (period) => {
      if (period === "all") {
        filters.value.date_from = "";
        filters.value.date_to = "";
      }
    },
  );
  watch(
    () => route.query,
    (query) => {
      if (!syncingRoute && applyQuery(query as Record<string, unknown>))
        void load();
    },
    { deep: true },
  );
  watch(movementKind, () => {
    if (!boot.value || props.destination !== "movements") return;
    start.value = 0;
    filters.value.source_warehouses = [];
    filters.value.destination_warehouses = [];
    void load();
  });

  onMounted(async () => {
    try {
      boot.value = await api("bootstrap");
      applyQuery(route.query as Record<string, unknown>);
      await load();
    } catch (cause: any) {
      error.value = cause.message;
    }
  });
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    controller?.abort();
  });
  return {
    destination,
    route,
    router,
    surface,
    scrollResetToken,
    boot,
    rows,
    total,
    overallTotal,
    quantityTotals,
    columnSummaries,
    resolvedPeriod,
    facets,
    start,
    error,
    appendError,
    busy,
    refreshing,
    appending,
    filterOpen,
    desktopFilterOpen,
    exportOpen,
    pageLength,
    defaultSort,
    sort,
    movementKind,
    statusGroup,
    operationCaps,
    warehouseRows,
    scrollKey,
    filters,
    movementWarehouseColumns,
    movementColumns,
    draftColumns,
    sortColumns,
    summaryMetrics,
    formatQuantities,
    activeCount,
    warehouseText,
    locationsFor,
    warehouseColumnLabel,
    chips,
    removeChip,
    clearAll,
    openFilters,
    requestFilters,
    exportFilters,
    routeQuery,
    load,
    applyQuery,
    operation,
    activate,
    deleteDraft,
    close,
  };
}

export type HistoryController = ReturnType<typeof useHistoryController>;
