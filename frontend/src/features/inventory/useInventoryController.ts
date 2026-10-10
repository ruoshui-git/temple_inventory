import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useRoute, useRouter } from "vue-router";

import { api } from "../../lib/api";

import { warehousePresentation } from "../../lib/warehousePresenter";

import type { InventoryCardRow } from "../../lib/inventoryTypes";
import type { SortState } from "../../components/SortableDataTable.vue";
import type { MobileSummaryMetric } from "../../components/MobileInventorySummary.vue";
import type {
  InventoryFilterNode,
  InventoryFilterState,
} from "../../components/InventoryFilterPanel.vue";

import {
  hydrateFilterQuery,
  serializeFilterQuery,
} from "../../composables/filters";

import { toast } from "../../lib/toast";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type { PageAction } from "../../components/pageActions";

export function useInventoryController() {
  const route = useRoute(),
    router = useRouter();
  const { surface: responsiveSurface, isSurface } = useResponsiveLayout();
  const surface = responsiveSurface;
  const scrollResetToken = ref(0);
  function requestScrollReset() {
    scrollResetToken.value += 1;
  }
  const boot = ref<any>(),
    rows = ref<InventoryCardRow[]>([]),
    total = ref(0),
    overall = ref<number | null>(null),
    facetCounts = ref<any>({ warehouses: {}, item_groups: {} }),
    quantityTotals = ref<Record<string, Array<{ uom: string; qty: number }>>>(
      {},
    ),
    columnSummaries = ref<Record<string, any>>({});
  const error = ref(""),
    loading = ref(true),
    loadingMore = ref(false),
    desktopFilterOpen = ref(false),
    filterOpen = ref(false),
    exportOpen = ref(false);
  const compact = ref(false);
  const expandedSummary = ref("");
  const selection = ref(false),
    selected = ref<string[]>([]),
    scanner = ref(false),
    scanBusy = ref(false),
    unknownBarcodePrompt = ref("");

  const start = ref(0);
  const filters = ref({
    search: "",
    warehouses: [] as string[],
    item_groups: [] as string[],
    in_stock: true,
    expiry_window: "all",
    expiry_days: "30",
    expiry_from_days: "-30",
    expiry_to_days: "30",
  });
  const defaultSort: SortState = { sort_by: "item_name", sort_order: "asc" };
  const sort = ref<SortState>({ ...defaultSort });
  const view = ref<"card" | "table">("card");
  const viewStorageKey = "temple_inventory.inventory.view";
  const itemGroupRoot = "All Item Groups";
  const summaryMetrics = computed(() =>
    [
      ["available_stock", "可用"],
      ["total_stock", "总计"],
      ["on_loan_qty", "借出"],
      ["damaged_qty", "损坏"],
    ].map(([key, label], index) => ({
      key,
      label,
      icon: ["box", "total", "loan", "warning"][index],
      tone: ["available", "total", "loaned", "damaged"][index],
      quantities: quantityTotals.value[key] || [],
    })),
  );
  const sortColumns = computed(() => [
    {
      key: "item_name",
      label: "物品",
      sortable: true,
      initialOrder: "asc" as const,
    },
    {
      key: "item_code",
      label: "物品编码 / 类别",
      sortable: true,
      initialOrder: "asc" as const,
    },
    {
      key: "available_stock",
      label: "可用数量",
      summary: "available_stock",
      sortable: true,
      initialOrder: "desc" as const,
    },
    {
      key: "total_stock",
      label: "总计",
      summary: "total_stock",
      sortable: true,
      initialOrder: "desc" as const,
    },
    {
      key: "on_loan_qty",
      label: "借出",
      summary: "on_loan_qty",
      sortable: true,
      initialOrder: "desc" as const,
    },
    {
      key: "damaged_qty",
      label: "损坏",
      summary: "damaged_qty",
      sortable: true,
      initialOrder: "desc" as const,
    },
    { key: "details", label: "库位 / 批次信息" },
    { key: "open", label: "" },
    ...(selection.value ? [{ key: "selection", label: "选择" }] : []),
  ]);
  const pageTitle = "库存列表";
  const activeFilterCount = computed(
    () =>
      filters.value.warehouses.length +
      filters.value.item_groups.length +
      Number(Boolean(filters.value.search)) +
      Number(!filters.value.in_stock) +
      Number(filters.value.expiry_window !== "all"),
  );
  const exportFilters = computed(() => ({
    ...filters.value,
    ...sort.value,
    warehouses: filters.value.warehouses,
    item_groups: filters.value.item_groups,
  }));
  const inventoryTabQuery = computed(() => ({
    search: filters.value.search || undefined,
    warehouses: filters.value.warehouses.length
      ? filters.value.warehouses
      : undefined,
    item_groups: filters.value.item_groups.length
      ? filters.value.item_groups
      : undefined,
  }));
  const operationCaps = computed(
    () => boot.value?.stock_operation_capabilities || {},
  );
  const primaryActions = computed(() =>
    ["Receive", "Issue", "Transfer"].filter(
      (kind) => operationCaps.value[kind],
    ),
  );
  const pageActions = computed<PageAction[]>(() => {
    const loading = !boot.value;
    const available = (kind: string) =>
      loading || Boolean(operationCaps.value[kind]);
    const actions: PageAction[] = [
      ...(loading || boot.value?.capabilities?.Item
        ? [{ kind: "CreateItem", label: "新建物品", tone: "primary" as const }]
        : []),
      ...["Receive", "Issue", "Transfer"].filter(available).map((kind) => ({
        kind,
        label: (
          { Receive: "↓ 入库", Issue: "↑ 出库", Transfer: "⇄ 转移" } as Record<
            string,
            string
          >
        )[kind],
        mobileLabel: (
          { Receive: "入库", Issue: "出库", Transfer: "转移" } as Record<
            string,
            string
          >
        )[kind],
      })),
      { kind: "Export", label: "导出", disabled: loading },
    ];
    return actions.map((action) => ({
      ...action,
      disabled: loading || action.disabled,
    }));
  });
  const overflowActions = computed(() => [
    ...(boot.value?.capabilities?.Item
      ? [{ kind: "CreateItem", label: "新建物品" }]
      : []),
    ...primaryActions.value.map((kind) => ({
      kind,
      label: ({ Receive: "入库", Issue: "出库", Transfer: "转移" } as any)[
        kind
      ],
    })),
    { kind: "Export", label: "导出" },
  ]);
  const mobileOverflowActions = computed(() =>
    pageActions.value.filter((action) => action.kind !== "Export"),
  );
  const mobileInventoryMetrics = computed<MobileSummaryMetric[]>(() =>
    summaryMetrics.value.map((metric) => ({
      key: metric.key,
      label: metric.label,
      overall: (metric.quantities || []).reduce(
        (total, row) => total + Number(row.qty || 0),
        0,
      ),
      tone: (metric.tone === "loaned"
        ? "warning"
        : metric.tone === "damaged"
          ? "danger"
          : metric.tone) as MobileSummaryMetric["tone"],
      details: (metric.quantities || []).map((row) => ({
        label: row.uom,
        value: Number(row.qty || 0),
        uom: row.uom,
      })),
    })),
  );
  const warehouseRows = computed(() => boot.value?.physical_tree || []);
  const warehouseNodes = computed<InventoryFilterNode[]>(() =>
    warehouseRows.value.map((row: any) => ({
      name: row.name,
      label: row.local_label || row.warehouse_name || row.name,
      parent: row.parent_warehouse,
      isGroup: Boolean(row.is_group),
      count: facetCounts.value.warehouses?.[row.name],
    })),
  );
  const categoryNodes = computed<InventoryFilterNode[]>(() =>
    (boot.value?.item_groups || [])
      .filter((row: any) => row.name !== itemGroupRoot)
      .map((row: any) => ({
        name: row.name,
        label: row.item_group_name || row.name,
        parent:
          row.parent_item_group === itemGroupRoot
            ? undefined
            : row.parent_item_group,
        isGroup: Boolean(row.is_group),
        count: facetCounts.value.item_groups?.[row.name],
      })),
  );
  const panelFilters = computed<InventoryFilterState>({
    get: () => ({
      warehouses: filters.value.warehouses,
      categories: filters.value.item_groups,
      inStock: filters.value.in_stock,
      expiry: filters.value.expiry_window as InventoryFilterState["expiry"],
      expiryDays: filters.value.expiry_days,
      expiryFromDays: filters.value.expiry_from_days,
      expiryToDays: filters.value.expiry_to_days,
    }),
    set: (value) => {
      filters.value = {
        ...filters.value,
        warehouses: value.warehouses,
        item_groups: value.categories,
        in_stock: value.inStock,
        expiry_window: value.expiry,
        expiry_days: value.expiryDays || "30",
        expiry_from_days: value.expiryFromDays || "",
        expiry_to_days: value.expiryToDays || "",
      };
    },
  });
  const customError = computed(() => {
    if (filters.value.expiry_window !== "custom") return "";
    const from = Number(filters.value.expiry_from_days),
      to = Number(filters.value.expiry_to_days);
    if (!Number.isInteger(from) || !Number.isInteger(to))
      return "请输入完整的整数范围";
    if (from < -3650 || to > 3650 || from > to)
      return "范围须为 -3650 至 3650，且起始不大于结束";
    return "";
  });
  const warehouseText = (name: string) =>
    warehousePresentation(name, warehouseRows.value).breadcrumb;
  const categoryText = (name: string) =>
    boot.value?.item_groups?.find((row: any) => row.name === name)
      ?.item_group_name || name;
  const chips = computed(() => [
    ...filters.value.warehouses.map((value) => ({
      key: "warehouses",
      value,
      label: warehouseText(value),
    })),
    ...filters.value.item_groups.map((value) => ({
      key: "item_groups",
      value,
      label: categoryText(value),
    })),
    ...(filters.value.search
      ? [{ key: "search", label: `搜索：${filters.value.search}` }]
      : []),
    ...(!filters.value.in_stock
      ? [{ key: "in_stock", label: "包含零库存" }]
      : []),
    ...(filters.value.expiry_window !== "all"
      ? [
          {
            key: "expiry_window",
            label:
              filters.value.expiry_window === "none"
                ? "效期：无效期"
                : "效期：已筛选",
          },
        ]
      : []),
  ]);
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0,
    syncingRoute = false;
  const sortQuery = () =>
    JSON.stringify(sort.value) === JSON.stringify(defaultSort)
      ? { sort_by: undefined, sort_order: undefined }
      : { sort_by: sort.value.sort_by, sort_order: sort.value.sort_order };
  async function load(append = false) {
    if (customError.value) return;
    controller?.abort();
    controller = new AbortController();
    const current = ++sequence;
    append ? (loadingMore.value = true) : (loading.value = true);
    error.value = "";
    try {
      const data = await api(
        "inventory",
        {
          ...filters.value,
          in_stock: filters.value.in_stock ? 1 : 0,
          expiry_window:
            filters.value.expiry_window === "all"
              ? ""
              : filters.value.expiry_window,
          expiry_from_days:
            filters.value.expiry_window === "custom"
              ? filters.value.expiry_from_days
              : undefined,
          expiry_to_days:
            filters.value.expiry_window === "custom"
              ? filters.value.expiry_to_days
              : undefined,
          warehouses: filters.value.warehouses.length
            ? filters.value.warehouses
            : undefined,
          item_groups: filters.value.item_groups.length
            ? filters.value.item_groups
            : undefined,
          start: append ? rows.value.length : 0,
          page_length: 25,
          ...sort.value,
        },
        controller.signal,
      );
      if (current !== sequence) return;
      const incoming: InventoryCardRow[] = data.results || [];
      rows.value = append
        ? [
            ...rows.value,
            ...incoming.filter(
              (row) =>
                !rows.value.some((old) => old.item_code === row.item_code),
            ),
          ]
        : incoming;
      total.value = Number(data.total || 0);
      overall.value = data.overall_total ?? null;
      facetCounts.value = data.facets || facetCounts.value;
      quantityTotals.value = data.quantity_totals || {};
      columnSummaries.value = data.column_summaries || {};
    } catch (cause: any) {
      if (cause?.name !== "AbortError" && current === sequence) {
        error.value = cause.message;
        if (!append) quantityTotals.value = {};
        if (!append) columnSummaries.value = {};
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
    timer = setTimeout(() => void load(), 280);
  }
  function removeChip(chip: any) {
    if (chip.key === "warehouses" || chip.key === "item_groups")
      (filters.value as any)[chip.key] = (filters.value as any)[
        chip.key
      ].filter((value: string) => value !== chip.value);
    else if (chip.key === "in_stock") filters.value.in_stock = true;
    else if (chip.key === "expiry_window") filters.value.expiry_window = "all";
    else filters.value.search = "";
  }
  function clearFilters() {
    filters.value = {
      search: "",
      warehouses: [],
      item_groups: [],
      in_stock: true,
      expiry_window: "all",
      expiry_days: "30",
      expiry_from_days: "-30",
      expiry_to_days: "30",
    };
  }
  function operation(kind: string) {
    if (kind === "Export") {
      exportOpen.value = true;
      return;
    }
    void router.push(kind === "CreateItem" ? "/items/new" : `/new/${kind}`);
  }
  function openItem(itemCode: string) {
    return router.push(`/item/${encodeURIComponent(itemCode)}`);
  }
  function selectedOperation(kind: string) {
    if (!selected.value.length) return operation(kind);
    sessionStorage.setItem(
      `ti-seed:${kind}`,
      JSON.stringify({ items: selected.value }),
    );
    operation(kind);
  }
  function toggle(code: string) {
    selected.value = selected.value.includes(code)
      ? selected.value.filter((value) => value !== code)
      : [...selected.value, code];
  }
  function toggleSelection() {
    if (
      selection.value &&
      selected.value.length &&
      !window.confirm(
        `将放弃已选的 ${selected.value.length} 项物品，确定继续吗？`,
      )
    )
      return;
    selection.value = !selection.value;
    if (!selection.value) selected.value = [];
  }
  function applySort(value: SortState) {
    sort.value = value;
    start.value = 0;
  }
  function setView(value: "card" | "table") {
    view.value = value;
    try {
      localStorage.setItem(viewStorageKey, value);
    } catch {
      // Storage is optional; the in-memory choice still applies.
    }
  }
  function toggleSortOrder() {
    sort.value = {
      ...sort.value,
      sort_order: sort.value.sort_order === "asc" ? "desc" : "asc",
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
  async function scan(value: string) {
    if (scanBusy.value) return;
    scanBusy.value = true;
    try {
      const result = await api("scan", { value });
      scanner.value = false;
      if (result.item_code)
        await router.push(`/item/${encodeURIComponent(result.item_code)}`);
      else unknownBarcodePrompt.value = value;
    } catch (cause: any) {
      error.value = cause.message || "条码查询失败";
    } finally {
      scanBusy.value = false;
    }
  }
  async function createUnknownItem() {
    const value = unknownBarcodePrompt.value;
    unknownBarcodePrompt.value = "";
    sessionStorage.setItem("ti-unknown-barcode", value);
    await router.push("/items/new");
  }
  function dismissUnknownItem() {
    unknownBarcodePrompt.value = "";
    toast("未找到该条码对应的物品", "warning");
  }
  function hydrateInventoryFilters(query: Record<string, unknown>) {
    const hydrated = hydrateFilterQuery(
      query,
      filters.value,
    ) as typeof filters.value;
    hydrated.item_groups = hydrated.item_groups.filter(
      (value) => value !== itemGroupRoot,
    );
    hydrated.in_stock =
      String(query.mode || "") === "catalog"
        ? false
        : !["0", "false"].includes(String(query.in_stock ?? "1"));
    const requestedWindow = String(query.expiry_window || "all");
    hydrated.expiry_window = [
      "all",
      "overdue",
      "overdue_within",
      "overdue_beyond",
      "remaining_within",
      "remaining_beyond",
      "none",
      "custom",
    ].includes(requestedWindow)
      ? requestedWindow
      : "all";
    const requestedDays = String(query.expiry_days || "30");
    hydrated.expiry_days =
      /^\d+$/.test(requestedDays) &&
      Number(requestedDays) >= 1 &&
      Number(requestedDays) <= 3650
        ? requestedDays
        : "30";
    return hydrated;
  }
  function onResultsScroll(event?: Event) {
    const scrollTop =
      (event?.currentTarget as HTMLElement | null)?.scrollTop || 0;
    compact.value = scrollTop > 80;
  }
  async function initializeInventory() {
    error.value = "";
    try {
      if (!boot.value) {
        boot.value = await api("bootstrap");
        window.dispatchEvent(new CustomEvent("ti:refresh-shell"));
      }
      await load();
    } catch (cause: any) {
      error.value = cause.message;
      loading.value = false;
      loadingMore.value = false;
    }
  }
  watch(
    [filters, sort],
    () => {
      if (!boot.value) return;
      requestScrollReset();
      if (!syncingRoute) {
        syncingRoute = true;
        void router
          .replace({
            query: {
              ...route.query,
              mode: undefined,
              ...serializeFilterQuery({
                ...filters.value,
                in_stock: filters.value.in_stock ? undefined : 0,
                expiry_window:
                  filters.value.expiry_window === "all"
                    ? undefined
                    : filters.value.expiry_window,
              }),
              ...sortQuery(),
            },
          })
          .finally(() => {
            syncingRoute = false;
          });
      }
      scheduleLoad();
    },
    { deep: true },
  );
  watch(
    () => route.query,
    (query) => {
      const next = hydrateInventoryFilters(query as Record<string, unknown>);
      if (JSON.stringify(next) !== JSON.stringify(filters.value))
        filters.value = next;
      const sortBy = String(query.sort_by || defaultSort.sort_by),
        sortOrder = String(query.sort_order || defaultSort.sort_order);
      if (
        [
          "item_name",
          "item_code",
          "available_stock",
          "total_stock",
          "on_loan_qty",
          "damaged_qty",
        ].includes(sortBy) &&
        ["asc", "desc"].includes(sortOrder) &&
        (sort.value.sort_by !== sortBy || sort.value.sort_order !== sortOrder)
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
      const savedView = localStorage.getItem(viewStorageKey);
      if (savedView === "card" || savedView === "table") view.value = savedView;
    } catch {
      view.value = "card";
    }
    filters.value = hydrateInventoryFilters(
      route.query as Record<string, unknown>,
    );
    const sortBy = String(route.query.sort_by || defaultSort.sort_by),
      sortOrder = String(route.query.sort_order || defaultSort.sort_order);
    if (
      [
        "item_name",
        "item_code",
        "available_stock",
        "total_stock",
        "on_loan_qty",
        "damaged_qty",
      ].includes(sortBy) &&
      ["asc", "desc"].includes(sortOrder)
    )
      sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
    await initializeInventory();
  });
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    controller?.abort();
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
    facetCounts,
    quantityTotals,
    columnSummaries,
    error,
    loading,
    loadingMore,
    desktopFilterOpen,
    filterOpen,
    exportOpen,
    compact,
    expandedSummary,
    selection,
    selected,
    scanner,
    scanBusy,
    unknownBarcodePrompt,
    start,
    filters,
    defaultSort,
    sort,
    view,
    viewStorageKey,
    itemGroupRoot,
    summaryMetrics,
    sortColumns,
    pageTitle,
    activeFilterCount,
    exportFilters,
    inventoryTabQuery,
    operationCaps,
    primaryActions,
    overflowActions,
    pageActions,
    mobileOverflowActions,
    mobileInventoryMetrics,
    warehouseRows,
    warehouseNodes,
    categoryNodes,
    panelFilters,
    customError,
    warehouseText,
    categoryText,
    chips,
    timer,
    sequence,
    syncingRoute,
    sortQuery,
    load,
    scheduleLoad,
    removeChip,
    clearFilters,
    operation,
    openItem,
    selectedOperation,
    toggle,
    toggleSelection,
    applySort,
    setView,
    toggleSortOrder,
    openFilters,
    scan,
    createUnknownItem,
    dismissUnknownItem,
    hydrateInventoryFilters,
    onResultsScroll,
    initializeInventory,
  };
}

export type InventoryController = ReturnType<typeof useInventoryController>;
