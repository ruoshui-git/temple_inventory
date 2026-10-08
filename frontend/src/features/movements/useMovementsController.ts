import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useRoute, useRouter } from "vue-router";

import type { MovementPeriodKey } from "../../components/MovementPeriodSelector.vue";
import type {
  DataTableColumn,
  SortState,
} from "../../components/SortableDataTable.vue";

import { api, labels, workspaceApi } from "../../lib/api";

import { warehousePresentation } from "../../lib/warehousePresenter";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export type Kind =
  | "Receive"
  | "Issue"
  | "Transfer"
  | "Loan"
  | "Return"
  | "Damage"
  | "Loss"
  | "Repair"
  | "Disposal"
  | "Reconcile"
  | "Opening";
export function useMovementsController() {
  type Mode = "items" | "records";
  type Filters = {
    search: string;
    period_key: MovementPeriodKey;
    date_from: string;
    date_to: string;
    item_groups: string[];
    item_code: string;
    warehouses: string[];
    source_warehouses: string[];
    destination_warehouses: string[];
    activity: string;
    docstatuses: number[];
    kinds: Kind[];
  };
  const route = useRoute();
  const router = useRouter();
  const { surface: responsiveSurface, isSurface } = useResponsiveLayout();
  const surface = responsiveSurface;
  const scrollResetToken = ref(0);
  function requestScrollReset() {
    scrollResetToken.value += 1;
  }
  const mode = computed<Mode>(() =>
    route.path.endsWith("/records") ? "records" : "items",
  );
  const kinds: Kind[] = [
    "Receive",
    "Issue",
    "Transfer",
    "Loan",
    "Return",
    "Damage",
    "Loss",
    "Repair",
    "Disposal",
    "Reconcile",
    "Opening",
  ];
  const kindLabels: Record<string, string> = {
    ...labels,
    Reconcile: "库存调整",
    Opening: "期初库存",
  };
  const boot = ref<any>();
  const itemOptions = ref<any[]>([]);
  const activityOptions = ref<any[]>([]);
  const itemQuery = ref("");
  const activityQuery = ref("");
  const filterOptionsBusy = ref(false);
  let filterOptionsController: AbortController | undefined;
  let filterOptionsTimer: ReturnType<typeof setTimeout> | undefined;
  let filterOptionsSequence = 0;
  const rows = ref<any[]>([]);
  const total = ref(0);
  const allTotal = ref(0);
  const counts = ref<Record<string, number>>({});
  const columnSummaries = ref<Record<string, any>>({});
  const resolved = ref({ date_from: "", date_to: "" });
  const busy = ref(true);
  const loadingMore = ref(false);
  const error = ref("");
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const exportOpen = ref(false);

  const controller = ref<AbortController>();
  const appendController = ref<AbortController>();
  const sequence = ref(0);
  const compact = ref(false);
  const zeroKindsExpanded = ref(false);
  const pageLength = 30;
  const filters = ref<Filters>({
    search: "",
    period_key: "this_month",
    date_from: "",
    date_to: "",
    item_groups: [],
    item_code: "",
    warehouses: [],
    source_warehouses: [],
    destination_warehouses: [],
    activity: "",
    docstatuses: [0, 1],
    kinds: [],
  });
  const warehouseRows = computed(() => boot.value?.physical_tree || []);
  const operationKinds = computed(() =>
    kinds.filter(
      (kind) =>
        kind !== "Reconcile" &&
        kind !== "Opening" &&
        boot.value?.stock_operation_capabilities?.[kind],
    ),
  );
  const kindMeta: Record<Kind, { label: string; icon: string; tone: string }> =
    {
      Receive: { label: "入库", icon: "↓", tone: "receive" },
      Issue: { label: "出库", icon: "↑", tone: "issue" },
      Transfer: { label: "转移", icon: "⇄", tone: "transfer" },
      Loan: { label: "借出", icon: "↗", tone: "loan" },
      Return: { label: "归还", icon: "↙", tone: "return" },
      Damage: { label: "损坏", icon: "⚠", tone: "damage" },
      Loss: { label: "遗失", icon: "−", tone: "loss" },
      Repair: { label: "修复", icon: "✦", tone: "repair" },
      Disposal: { label: "报废", icon: "×", tone: "disposal" },
      Reconcile: { label: "库存调整", icon: "±", tone: "reconcile" },
      Opening: { label: "期初库存", icon: "○", tone: "opening" },
    };
  const visibleKinds = computed(() =>
    kinds.filter(
      (kind) =>
        Number(counts.value[kind] || 0) > 0 ||
        filters.value.kinds.includes(kind) ||
        zeroKindsExpanded.value,
    ),
  );
  const zeroKindCount = computed(
    () =>
      kinds.filter(
        (kind) =>
          Number(counts.value[kind] || 0) === 0 &&
          !filters.value.kinds.includes(kind),
      ).length,
  );
  const tableColumns = computed<DataTableColumn[]>(() =>
    mode.value === "items"
      ? [
          { key: "date", label: "日期" },
          { key: "item", label: "物品" },
          { key: "action", label: "动作" },
          { key: "quantity", label: "数量", summary: "quantity" },
          { key: "from", label: "从" },
          { key: "to", label: "到" },
          { key: "record", label: "关联记录" },
          { key: "notes", label: "备注" },
        ]
      : [
          { key: "date", label: "日期" },
          { key: "record", label: "记录编号" },
          { key: "action", label: "类型" },
          { key: "line_count", label: "物品行数", summary: "line_count" },
          { key: "quantity", label: "数量", summary: "quantity" },
          { key: "flow", label: "流向" },
          { key: "activity", label: "活动" },
          { key: "notes", label: "备注" },
        ],
  );
  const tableSort: SortState = { sort_by: "posting_date", sort_order: "desc" };
  const rowKey = computed(() =>
    mode.value === "items" ? "id" : "record_name",
  );
  const activeFilterCount = computed(
    () =>
      filters.value.item_groups.length +
      filters.value.warehouses.length +
      filters.value.source_warehouses.length +
      filters.value.destination_warehouses.length +
      (filters.value.item_code ? 1 : 0) +
      (filters.value.activity ? 1 : 0) +
      (mode.value === "records" &&
      JSON.stringify(filters.value.docstatuses) !== JSON.stringify([0, 1])
        ? 1
        : 0),
  );
  const periodFilters = computed(() => ({
    period_key: filters.value.period_key,
    date_from:
      filters.value.period_key === "custom"
        ? filters.value.date_from
        : undefined,
    date_to:
      filters.value.period_key === "custom" ? filters.value.date_to : undefined,
    search: filters.value.search || undefined,
    item_groups: filters.value.item_groups.length
      ? filters.value.item_groups
      : undefined,
    item_code: filters.value.item_code || undefined,
    warehouses: filters.value.warehouses.length
      ? filters.value.warehouses
      : undefined,
    source_warehouses: filters.value.source_warehouses.length
      ? filters.value.source_warehouses
      : undefined,
    destination_warehouses: filters.value.destination_warehouses.length
      ? filters.value.destination_warehouses
      : undefined,
    activity: filters.value.activity || undefined,
    movement_kinds: filters.value.kinds.length
      ? filters.value.kinds
      : undefined,
  }));
  const exportFilters = computed(() => ({
    ...periodFilters.value,
    docstatuses: filters.value.docstatuses,
  }));
  const itemSelectOptions = computed(() => {
    const selected = itemOptions.value.find(
      (item) => item.name === filters.value.item_code,
    );
    const options =
      selected && !itemOptions.value.some((item) => item.name === selected.name)
        ? [selected, ...itemOptions.value]
        : itemOptions.value;
    return [
      { label: "全部物品", value: "" },
      ...options.map((item) => ({
        label: `${item.item_name || item.name} · ${item.name}`,
        value: item.name,
      })),
    ];
  });
  const activitySelectOptions = computed(() => [
    { label: "全部活动", value: "" },
    ...activityOptions.value.map((activity) => ({
      label: activity.title || activity.name,
      value: activity.name,
    })),
  ]);
  function scheduleFilterOptionSearch(
    kind: "item" | "activity",
    value: string,
  ) {
    if (kind === "item") itemQuery.value = value;
    else activityQuery.value = value;
    const selected =
      kind === "item" ? filters.value.item_code : filters.value.activity;
    const options = kind === "item" ? itemOptions.value : activityOptions.value;
    if (
      selected &&
      options.some(
        (option) =>
          option.name === selected &&
          (option.item_name === value || option.title === value),
      )
    )
      return;
    if (filterOptionsTimer) clearTimeout(filterOptionsTimer);
    filterOptionsTimer = setTimeout(() => void loadFilterOptions(value), 250);
  }
  async function loadFilterOptions(search = "") {
    filterOptionsController?.abort();
    const controller = new AbortController();
    filterOptionsController = controller;
    const sequence = ++filterOptionsSequence;
    filterOptionsBusy.value = true;
    try {
      const options = await workspaceApi(
        "movement_filter_options",
        { search, start: 0, page_length: 100 },
        controller.signal,
      );
      if (sequence !== filterOptionsSequence) return;
      const selectedItem = itemOptions.value.find(
        (item) => item.name === filters.value.item_code,
      );
      const selectedActivity = activityOptions.value.find(
        (activity) => activity.name === filters.value.activity,
      );
      itemOptions.value =
        selectedItem &&
        !(options.items || []).some(
          (item: any) => item.name === selectedItem.name,
        )
          ? [selectedItem, ...(options.items || [])]
          : options.items || [];
      activityOptions.value =
        selectedActivity &&
        !(options.activities || []).some(
          (activity: any) => activity.name === selectedActivity.name,
        )
          ? [selectedActivity, ...(options.activities || [])]
          : options.activities || [];
    } catch (cause: any) {
      if (cause?.name !== "AbortError" && sequence === filterOptionsSequence)
        error.value = cause.message || "筛选选项加载失败";
    } finally {
      if (sequence === filterOptionsSequence) filterOptionsBusy.value = false;
    }
  }
  function location(name: string) {
    return name
      ? warehousePresentation(name, warehouseRows.value).breadcrumb || name
      : "—";
  }
  function kindLabel(kind: Kind) {
    return kindMeta[kind]?.label || kindLabels[kind] || kind;
  }
  function flow(row: any) {
    if (row.movement_kind === "Loan")
      return `${location(row.source_warehouse)} → 借出`;
    if (row.movement_kind === "Return")
      return `借出 → ${location(row.destination_warehouse)}`;
    return `${row.source_warehouse ? location(row.source_warehouse) : "—"} → ${row.destination_warehouse ? location(row.destination_warehouse) : "—"}`;
  }
  function fromLocation(row: any) {
    return row.movement_kind === "Return"
      ? "借出"
      : location(row.source_warehouse);
  }
  function toLocation(row: any) {
    return row.movement_kind === "Loan"
      ? "借出"
      : location(row.destination_warehouse);
  }
  function recordFlow(row: any) {
    if (row.movement_kind === "Loan")
      return `${location(row.source_warehouse)} → 借出`;
    if (row.movement_kind === "Return")
      return `借出 → ${location(row.destination_warehouse)}`;
    const sources =
      (row.source_warehouses || []).map(location).join("、") || "—";
    const destinations =
      (row.destination_warehouses || []).map(location).join("、") || "—";
    return `${sources} → ${destinations}`;
  }
  function quantity(row: any) {
    let value = Number(row.qty ?? 0);
    if (["Issue", "Loss", "Disposal"].includes(row.movement_kind))
      value = -Math.abs(value);
    if (row.movement_kind === "Receive") value = Math.abs(value);
    const sign = row.movement_kind === "Receive" && value >= 0 ? "+" : "";
    return `${sign}${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value)} ${row.uom || ""}`;
  }
  function displayTime(value: unknown) {
    const text = String(value || "");
    const match = text.match(/(?:^|\s)(\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?/);
    return match?.[1] || (text ? text.slice(0, 5) : "");
  }
  function recordQuantity(row: any) {
    return (
      (row.quantities || [])
        .map(
          (value: any) =>
            `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value.qty)} ${value.uom}`,
        )
        .join(" · ") || "—"
    );
  }
  function toggleKind(kind: Kind) {
    filters.value.kinds = filters.value.kinds.includes(kind)
      ? filters.value.kinds.filter((value) => value !== kind)
      : [...filters.value.kinds, kind];
  }
  function clearKinds() {
    filters.value.kinds = [];
  }
  function clearFilters() {
    filters.value.item_groups = [];
    filters.value.item_code = "";
    filters.value.warehouses = [];
    filters.value.source_warehouses = [];
    filters.value.destination_warehouses = [];
    filters.value.activity = "";
    if (mode.value === "records") filters.value.docstatuses = [0, 1];
  }
  function openFilters(
    event?: Event,
    panel?: { openPanel: (event?: Event) => void } | null,
  ) {
    if (isSurface("desktop"))
      desktopFilterOpen.value = !desktopFilterOpen.value;
    else panel?.openPanel(event);
  }
  function onResultsScroll(event: Event) {
    compact.value = (event.currentTarget as HTMLElement).scrollTop > 80;
  }
  function openRow(row: any) {
    if (row.detail_route) void router.push(row.detail_route);
  }
  function openOperation(kind: string) {
    return router.push(`/new/${kind}`);
  }
  function openReconciliation() {
    return router.push("/reconcile/new");
  }
  function recordRoute(row: any) {
    return (
      row.detail_route ||
      (row.record_name ? `/entry/${encodeURIComponent(row.record_name)}` : "")
    );
  }
  function queryArgs() {
    return {
      filters: periodFilters.value,
      ...(mode.value === "records"
        ? { docstatuses: filters.value.docstatuses }
        : {}),
    };
  }
  async function load(append = false) {
    if (append && (loadingMore.value || rows.value.length >= total.value))
      return;
    if (!append) {
      controller.value?.abort();
      appendController.value?.abort();
    } else appendController.value?.abort();
    const current = ++sequence.value;
    const requestController = new AbortController();
    if (!append) controller.value = requestController;
    else appendController.value = requestController;
    if (append) loadingMore.value = true;
    else {
      busy.value = true;
      error.value = "";
    }
    try {
      const data = await workspaceApi(
        mode.value === "records" ? "movement_records" : "movement_items",
        {
          ...queryArgs(),
          start: append ? rows.value.length : 0,
          page_length: pageLength,
        },
        requestController.signal,
      );
      if (current !== sequence.value) return;
      rows.value = append
        ? [...rows.value, ...(data.results || [])]
        : data.results || [];
      total.value = Number(data.total || 0);
      allTotal.value = Number(data.all_total ?? data.total ?? 0);
      counts.value = data.facets?.movement_kind || {};
      columnSummaries.value = data.column_summaries || {};
      resolved.value = data.resolved_period || resolved.value;
    } catch (cause: any) {
      if (current === sequence.value && cause?.name !== "AbortError")
        error.value = cause.message || "加载失败";
    } finally {
      if (current === sequence.value) {
        busy.value = false;
        loadingMore.value = false;
      }
    }
  }

  let syncingRoute = false;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  function applyRouteQuery() {
    const query = route.query as Record<string, unknown>;
    const rawKinds = query.kind || query.movement_kind;
    const values = Array.isArray(rawKinds)
      ? rawKinds
      : rawKinds
        ? [rawKinds]
        : [];
    filters.value.kinds = values
      .map((kind) => String(kind) as Kind)
      .filter((kind) => kinds.includes(kind));
    filters.value.search = String(query.search || "");
    filters.value.item_code = String(query.item_code || "");
    const list = (value: unknown) =>
      (Array.isArray(value) ? value : value ? [value] : []).map(String);
    filters.value.item_groups = list(query.item_groups);
    filters.value.warehouses = list(query.warehouses);
    filters.value.source_warehouses = list(query.source_warehouses);
    filters.value.destination_warehouses = list(query.destination_warehouses);
    filters.value.activity = String(query.activity || "");
    if (mode.value === "records" && query.docstatuses)
      filters.value.docstatuses = list(query.docstatuses)
        .map(Number)
        .filter((status) => [0, 1, 2].includes(status));
    const period = String(query.period || "this_month") as MovementPeriodKey;
    if (
      [
        "today",
        "last_7_days",
        "last_30_days",
        "last_90_days",
        "last_365_days",
        "this_week",
        "this_month",
        "this_year",
        "custom",
      ].includes(period)
    )
      filters.value.period_key = period;
    if (filters.value.period_key === "custom") {
      filters.value.date_from = String(query.date_from || "");
      filters.value.date_to = String(query.date_to || "");
    }
  }
  watch(
    [filters, mode],
    () => {
      if (!syncingRoute) {
        syncingRoute = true;
        void router
          .replace({
            query: {
              ...route.query,
              period: filters.value.period_key,
              date_from:
                filters.value.period_key === "custom"
                  ? filters.value.date_from
                  : undefined,
              date_to:
                filters.value.period_key === "custom"
                  ? filters.value.date_to
                  : undefined,
              search: filters.value.search || undefined,
              item_code: filters.value.item_code || undefined,
              item_groups: filters.value.item_groups.length
                ? filters.value.item_groups
                : undefined,
              warehouses: filters.value.warehouses.length
                ? filters.value.warehouses
                : undefined,
              source_warehouses: filters.value.source_warehouses.length
                ? filters.value.source_warehouses
                : undefined,
              destination_warehouses: filters.value.destination_warehouses
                .length
                ? filters.value.destination_warehouses
                : undefined,
              activity: filters.value.activity || undefined,
              docstatuses:
                mode.value === "records"
                  ? filters.value.docstatuses
                  : undefined,
              kind: filters.value.kinds.length
                ? filters.value.kinds
                : undefined,
              movement_kind: undefined,
            },
          })
          .finally(() => {
            syncingRoute = false;
          });
      }
      if (searchTimer) clearTimeout(searchTimer);
      if (filters.value.search)
        searchTimer = setTimeout(() => void load(), 300);
      else void load();
    },
    { deep: true },
  );
  watch(
    () => [route.path, route.query],
    () => {
      if (syncingRoute) return;
      syncingRoute = true;
      applyRouteQuery();
      syncingRoute = false;
      void load();
    },
    { deep: true },
  );
  onMounted(async () => {
    try {
      applyRouteQuery();
      boot.value = await api("bootstrap");
      await loadFilterOptions(
        filters.value.item_code || filters.value.activity || "",
      );
      await load();
    } catch (cause: any) {
      error.value = cause.message || "加载失败";
      busy.value = false;
    }
  });
  onBeforeUnmount(() => {
    controller.value?.abort();
    appendController.value?.abort();
    filterOptionsController?.abort();
    if (searchTimer) clearTimeout(searchTimer);
    if (filterOptionsTimer) clearTimeout(filterOptionsTimer);
  });
  return {
    route,
    router,
    surface,
    scrollResetToken,
    mode,
    kinds,
    kindLabels,
    boot,
    itemOptions,
    activityOptions,
    itemQuery,
    activityQuery,
    filterOptionsBusy,
    rows,
    total,
    allTotal,
    counts,
    columnSummaries,
    resolved,
    busy,
    loadingMore,
    error,
    filterOpen,
    desktopFilterOpen,
    exportOpen,
    compact,
    zeroKindsExpanded,
    pageLength,
    filters,
    warehouseRows,
    operationKinds,
    kindMeta,
    visibleKinds,
    zeroKindCount,
    tableColumns,
    tableSort,
    rowKey,
    activeFilterCount,
    periodFilters,
    exportFilters,
    itemSelectOptions,
    activitySelectOptions,
    scheduleFilterOptionSearch,
    loadFilterOptions,
    location,
    kindLabel,
    flow,
    fromLocation,
    toLocation,
    recordFlow,
    quantity,
    displayTime,
    recordQuantity,
    toggleKind,
    clearKinds,
    clearFilters,
    openFilters,
    onResultsScroll,
    openRow,
    openOperation,
    openReconciliation,
    recordRoute,
    queryArgs,
    load,
    applyRouteQuery,
  };
}

export type MovementsController = ReturnType<typeof useMovementsController>;
