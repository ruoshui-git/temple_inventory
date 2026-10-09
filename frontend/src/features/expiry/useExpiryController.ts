import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useRoute, useRouter } from "vue-router";

import { api } from "../../lib/api";

import { warehousePresentation } from "../../lib/warehousePresenter";

import {
  hydrateFilterQuery,
  sameFilterValue,
  serializeFilterQuery,
} from "../../composables/filters";

import type { MobileSummaryMetric } from "../../components/MobileInventorySummary.vue";
import type { SortState } from "../../components/SortableDataTable.vue";

import type {
  InventoryFilterNode,
  InventoryFilterState,
} from "../../components/InventoryFilterPanel.vue";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";

export function useExpiryController() {
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
  const error = ref("");
  const busy = ref(true);
  const refreshing = ref(false);
  const appending = ref(false);
  const total = ref(0);
  const overallTotal = ref(0);
  const quantityTotals = ref<
    Record<string, Array<{ uom: string; qty: number }>>
  >({});
  const columnSummaries = ref<Record<string, any>>({});
  const facetCounts = ref<any>({ warehouses: {}, item_groups: {}, expiry: {} });
  const start = ref(0);
  const pageLength = 25;
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const exportOpen = ref(false);
  const compact = ref(false);
  const expandedSummary = ref("");
  const scanner = ref(false);
  const scanBusy = ref(false);
  const view = ref<"card" | "table">("table");
  const viewStorageKey = "temple_inventory.expiry.view";
  const itemGroupRoot = "All Item Groups";
  const operationCaps = computed(
    () => boot.value?.stock_operation_capabilities || {},
  );
  const movementActions = computed(() =>
    ["Receive", "Issue", "Transfer"]
      .filter((kind) => operationCaps.value[kind])
      .map((kind) => ({
        kind,
        label: ({ Receive: "入库", Issue: "出库", Transfer: "转移" } as any)[
          kind
        ],
      })),
  );
  const overflowActions = computed(() => [
    ...movementActions.value,
    { kind: "Export", label: "导出" },
  ]);
  const expirySummary = ref({
    expiring_soon: 0,
    expired: 0,
    within_7_days: 0,
    days_8_to_30: 0,
    average_remaining_days: null as number | null,
  });
  const mobileExpiryMetrics = computed<MobileSummaryMetric[]>(() => [
    {
      key: "soon",
      label: "即将到期",
      overall: Number(expirySummary.value.expiring_soon || 0),
      tone: "warning",
      details: [
        {
          label: "7 天内",
          value: Number(expirySummary.value.within_7_days || 0),
        },
        {
          label: "8–30 天内",
          value: Number(expirySummary.value.days_8_to_30 || 0),
        },
        ...(expirySummary.value.average_remaining_days == null
          ? []
          : [
              {
                label: "平均剩余",
                value: expirySummary.value.average_remaining_days,
                uom: "天",
              },
            ]),
      ],
    },
    {
      key: "expired",
      label: "已过期",
      overall: Number(expirySummary.value.expired || 0),
      tone: "danger",
      details: [
        {
          label: "已过期批次",
          value: Number(expirySummary.value.expired || 0),
        },
      ],
    },
  ]);

  const scrollKey = "temple_inventory.scroll.expiry";
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
  const defaultSort: SortState = { sort_by: "expiry_date", sort_order: "asc" };
  const sort = ref<SortState>({ ...defaultSort });
  const sortColumns = [
    {
      key: "item_name",
      label: "物品 / 批次",
      sortable: true,
      initialOrder: "asc" as const,
    },
    { key: "item_group", label: "类别" },
    {
      key: "expiry_date",
      label: "到期日期",
      sortable: true,
      initialOrder: "asc" as const,
    },
    { key: "days_to_expiry", label: "剩余" },
    {
      key: "total_qty",
      label: "数量",
      summary: "total_qty",
      sortable: true,
      initialOrder: "desc" as const,
    },
    { key: "locations", label: "位置" },
  ];
  const expiryWindows = [
    "all",
    "overdue",
    "overdue_within",
    "overdue_beyond",
    "remaining_within",
    "remaining_beyond",
    "none",
    "custom",
  ];
  const routeValidationError = ref("");
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
  const expiryDays = computed(() =>
    /^[1-9]\d*$/.test(filters.value.expiry_days)
      ? filters.value.expiry_days
      : "30",
  );
  const expiryWindowLabel = (value = filters.value.expiry_window) =>
    (
      ({
        overdue: "已过期",
        overdue_within: `已过期 ${expiryDays.value} 天以下`,
        overdue_beyond: `已过期 ${expiryDays.value} 天以上`,
        remaining_within: `还剩 ${expiryDays.value} 天以下`,
        remaining_beyond: `还剩 ${expiryDays.value} 天以上`,
        none: "无效期",
        custom: `自定义 ${filters.value.expiry_from_days} – ${filters.value.expiry_to_days} 天`,
      }) as Record<string, string>
    )[value] || "全部效期";

  const activeCount = computed(
    () =>
      filters.value.warehouses.length +
      filters.value.item_groups.length +
      (filters.value.search ? 1 : 0) +
      (!filters.value.in_stock ? 1 : 0) +
      (filters.value.expiry_window !== "all" ? 1 : 0),
  );
  const sortQuery = () =>
    JSON.stringify(sort.value) === JSON.stringify(defaultSort)
      ? { sort_by: undefined, sort_order: undefined }
      : { sort_by: sort.value.sort_by, sort_order: sort.value.sort_order };
  const exportFilters = computed(() => ({
    ...filters.value,
    ...sort.value,
    warehouses: filters.value.warehouses,
    item_groups: filters.value.item_groups,
  }));
  const expiryTabQuery = computed(() => ({
    search: filters.value.search || undefined,
    warehouses: filters.value.warehouses.length
      ? filters.value.warehouses
      : undefined,
    item_groups: filters.value.item_groups.length
      ? filters.value.item_groups
      : undefined,
  }));
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
        boot.value?.item_groups?.find((group: any) => group.name === value)
          ?.item_group_name || value,
    })),
    ...(filters.value.search
      ? [{ key: "search", label: `搜索：${filters.value.search}` }]
      : []),
    ...(!filters.value.in_stock
      ? [{ key: "in_stock", label: "包含零库存" }]
      : []),
    ...(filters.value.expiry_window !== "all"
      ? [{ key: "expiry_window", label: expiryWindowLabel() }]
      : []),
  ]);

  function removeChip(chip: any) {
    if (chip.key === "warehouses")
      filters.value.warehouses = filters.value.warehouses.filter(
        (value) => value !== chip.value,
      );
    else if (chip.key === "item_groups")
      filters.value.item_groups = filters.value.item_groups.filter(
        (value) => value !== chip.value,
      );
    else if (chip.key === "in_stock") filters.value.in_stock = true;
    else if (chip.key === "expiry_window") filters.value.expiry_window = "all";
    else (filters.value as any)[chip.key] = "";
  }
  function clearAll() {
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
    start.value = 0;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let sequence = 0;
  let syncingRoute = false;
  let restoringRoute = false;
  let lastRequestKey = "";
  function operation(kind: string) {
    if (kind === "Export") {
      exportOpen.value = true;
      return;
    }
    void router.push(`/new/${kind}`);
  }
  function openItem(itemCode: string, batchNo?: string) {
    const query = batchNo ? `?batch=${encodeURIComponent(batchNo)}` : "";
    return router.push(`/item/${encodeURIComponent(itemCode)}${query}`);
  }
  function setQuickExpiry(kind: "all" | "soon" | "expired") {
    filters.value = {
      ...filters.value,
      expiry_window:
        kind === "all"
          ? "all"
          : kind === "soon"
            ? "remaining_within"
            : "overdue",
      expiry_days: "30",
    };
  }
  async function scan(value: string) {
    if (scanBusy.value) return;
    scanBusy.value = true;
    try {
      const result = await api("scan", { value });
      scanner.value = false;
      if (result.item_code)
        await router.push(`/item/${encodeURIComponent(result.item_code)}`);
    } catch (cause: any) {
      error.value = cause.message || "条码查询失败";
    } finally {
      scanBusy.value = false;
    }
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
      /* optional */
    }
  }
  function openFilters(
    event?: Event,
    panel?: { openPanel: (event?: Event) => void } | null,
  ) {
    if (isSurface("desktop"))
      desktopFilterOpen.value = !desktopFilterOpen.value;
    else panel?.openPanel(event);
  }
  function onResultsScroll(event?: Event) {
    const scrollTop =
      (event?.currentTarget as HTMLElement | null)?.scrollTop || 0;
    compact.value = scrollTop > 80;
  }

  async function load(append = false) {
    if (!boot.value) return;
    if (customError.value) {
      busy.value = false;
      refreshing.value = false;
      appending.value = false;
      return;
    }
    if (timer) clearTimeout(timer);
    controller?.abort();
    const current = ++sequence;
    controller = new AbortController();
    const run = async () => {
      appending.value = append;
      refreshing.value = !append && rows.value.length > 0;
      busy.value = !append && rows.value.length === 0;
      error.value = "";
      try {
        const data = await api(
          "expiring_batches",
          {
            ...filters.value,
            ...sort.value,
            in_stock: filters.value.in_stock ? 1 : 0,
            expiry_window:
              filters.value.expiry_window === "all"
                ? ""
                : filters.value.expiry_window,
            expiry_days: expiryDays.value,
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
            start: append ? rows.value.length : start.value,
            page_length: pageLength,
          },
          controller?.signal,
        );
        if (current !== sequence) return;
        rows.value = append
          ? [
              ...rows.value,
              ...(data.results || []).filter(
                (row: any) =>
                  !rows.value.some((old) => old.batch_no === row.batch_no),
              ),
            ]
          : data.results || [];
        total.value = data.total || 0;
        facetCounts.value = data.facets || facetCounts.value;
        overallTotal.value = data.overall_total || 0;
        quantityTotals.value = data.quantity_totals || {};
        columnSummaries.value = data.column_summaries || {};
        expirySummary.value = {
          ...expirySummary.value,
          ...(data.expiry_summary || {}),
        };
        syncingRoute = true;
        void router
          .replace({
            query: {
              ...route.query,
              sort: undefined,
              ...serializeFilterQuery({
                ...filters.value,
                in_stock: filters.value.in_stock ? undefined : 0,
                expiry_window:
                  filters.value.expiry_window === "all"
                    ? undefined
                    : filters.value.expiry_window,
                start: start.value || undefined,
              }),
              ...sortQuery(),
            },
          })
          .finally(() => {
            syncingRoute = false;
          });
      } catch (cause: any) {
        if (current === sequence && cause?.name !== "AbortError") {
          error.value = cause.message;
          if (!append) quantityTotals.value = {};
        }
      } finally {
        if (current === sequence) {
          busy.value = false;
          refreshing.value = false;
          appending.value = false;
        }
      }
    };
    if (filters.value.search) timer = setTimeout(() => void run(), 300);
    else await run();
  }

  watch(
    [filters, sort],
    () => {
      const requestKey = JSON.stringify({
        ...filters.value,
        sort: sort.value,
      });
      if (requestKey === lastRequestKey) return;
      lastRequestKey = requestKey;
      const preserveStart = restoringRoute;
      restoringRoute = false;
      if (!preserveStart) start.value = 0;
      if (!preserveStart) requestScrollReset();
      void load();
    },
    { deep: true },
  );

  watch(
    () => route.query,
    (query) => {
      if (syncingRoute || !boot.value) return;
      const hydrated = hydrateFilterQuery(query as Record<string, unknown>, {
        search: "",
        warehouses: [] as string[],
        item_groups: [] as string[],
        in_stock: true,
        expiry_window: "all",
        expiry_days: "30",
        expiry_from_days: "-30",
        expiry_to_days: "30",
        start: "0",
      });
      const requestedWindow = String(hydrated.expiry_window || "all");
      const requestedDays = String(hydrated.expiry_days || "");
      const validWindow = expiryWindows.includes(requestedWindow);
      const validDays = /^[1-9]\d*$/.test(requestedDays);
      if (!validWindow || !validDays)
        routeValidationError.value = "效期范围参数无效，已恢复为默认值。";
      const next = {
        search: String(hydrated.search || ""),
        warehouses: hydrated.warehouses as string[],
        item_groups: (hydrated.item_groups as string[]).filter(
          (value) => value !== itemGroupRoot,
        ),
        in_stock: !["0", "false"].includes(
          String((query as any).in_stock ?? "1"),
        ),
        expiry_window: validWindow ? requestedWindow : "all",
        expiry_days: validDays ? requestedDays : "30",
        expiry_from_days: String(hydrated.expiry_from_days ?? "-30"),
        expiry_to_days: String(hydrated.expiry_to_days ?? "30"),
      };
      const changed = Object.keys(next).some(
        (key) =>
          !sameFilterValue((filters.value as any)[key], (next as any)[key]),
      );
      const sortBy = String(query.sort_by || "expiry_date");
      const sortOrder = String(query.sort_order || query.sort || "asc");
      const nextSort =
        ["item_name", "expiry_date", "total_qty"].includes(sortBy) &&
        ["asc", "desc"].includes(sortOrder)
          ? { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" }
          : { ...defaultSort };
      const sortChanged =
        sort.value.sort_by !== nextSort.sort_by ||
        sort.value.sort_order !== nextSort.sort_order;
      if (
        !changed &&
        start.value === (Number(hydrated.start) || 0) &&
        !sortChanged
      )
        return;
      restoringRoute = true;
      filters.value = next;
      start.value = Number(hydrated.start) || 0;
      sort.value = nextSort;
    },
    { deep: true },
  );

  onMounted(async () => {
    try {
      try {
        const savedView = localStorage.getItem(viewStorageKey);
        if (savedView === "card" || savedView === "table")
          view.value = savedView;
      } catch {
        view.value = "table";
      }
      boot.value = await api("bootstrap");
      const hydrated = hydrateFilterQuery(
        route.query as Record<string, unknown>,
        {
          search: "",
          warehouses: [] as string[],
          item_groups: [] as string[],
          in_stock: true,
          expiry_window: "all",
          expiry_days: "30",
          expiry_from_days: "-30",
          expiry_to_days: "30",
          start: "0",
        },
      );
      filters.value = {
        search: String(hydrated.search || ""),
        warehouses: hydrated.warehouses as string[],
        item_groups: (hydrated.item_groups as string[]).filter(
          (value) => value !== itemGroupRoot,
        ),
        in_stock: !["0", "false"].includes(String(route.query.in_stock ?? "1")),
        expiry_window: String(hydrated.expiry_window || "all"),
        expiry_days: /^[1-9]\d*$/.test(String(hydrated.expiry_days || ""))
          ? String(hydrated.expiry_days)
          : "30",
        expiry_from_days: String(hydrated.expiry_from_days ?? "-30"),
        expiry_to_days: String(hydrated.expiry_to_days ?? "30"),
      };
      lastRequestKey = JSON.stringify({
        ...filters.value,
        sort: sort.value,
      });
      const sortBy = String(route.query.sort_by || "expiry_date");
      const sortOrder = String(
        route.query.sort_order || route.query.sort || "asc",
      );
      if (
        ["item_name", "expiry_date", "total_qty"].includes(sortBy) &&
        ["asc", "desc"].includes(sortOrder)
      )
        sort.value = {
          sort_by: sortBy,
          sort_order: sortOrder as "asc" | "desc",
        };
      start.value = Number(hydrated.start) || 0;
      await load();
    } catch (cause: any) {
      error.value = cause.message;
      busy.value = false;
      refreshing.value = false;
      appending.value = false;
    }
  });
  onBeforeUnmount(() => {
    controller?.abort();
  });
  return {
    route,
    router,
    surface,
    scrollResetToken,
    boot,
    rows,
    error,
    busy,
    refreshing,
    appending,
    total,
    overallTotal,
    quantityTotals,
    columnSummaries,
    facetCounts,
    start,
    pageLength,
    filterOpen,
    desktopFilterOpen,
    exportOpen,
    compact,
    expandedSummary,
    scanner,
    scanBusy,
    view,
    viewStorageKey,
    itemGroupRoot,
    operationCaps,
    movementActions,
    overflowActions,
    expirySummary,
    mobileExpiryMetrics,
    scrollKey,
    filters,
    defaultSort,
    sort,
    sortColumns,
    expiryWindows,
    routeValidationError,
    warehouseRows,
    warehouseNodes,
    categoryNodes,
    panelFilters,
    customError,
    warehouseText,
    expiryDays,
    expiryWindowLabel,
    activeCount,
    sortQuery,
    exportFilters,
    expiryTabQuery,
    chips,
    removeChip,
    clearAll,
    timer,
    sequence,
    syncingRoute,
    restoringRoute,
    lastRequestKey,
    operation,
    openItem,
    setQuickExpiry,
    scan,
    applySort,
    setView,
    openFilters,
    onResultsScroll,
    load,
  };
}

export type ExpiryController = ReturnType<typeof useExpiryController>;
