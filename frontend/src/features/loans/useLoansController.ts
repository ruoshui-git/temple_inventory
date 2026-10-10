import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, workspaceApi } from "../../lib/api";
import {
  hydrateFilterQuery,
  serializeFilterQuery,
} from "../../composables/filters";
import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
import type {
  SortState,
  DataTableColumn,
} from "../../components/SortableDataTable.vue";
import type { PageAction } from "../../components/pageActions";
import { warehousePresentation } from "../../lib/warehousePresenter";

type Mode = "items" | "records";
type LoanStatus = "all" | "outstanding" | "settled";
type Filters = {
  search: string;
  loan_date: string;
  status: LoanStatus;
  item_code: string;
  item_groups: string[];
  warehouses: string[];
  activity: string;
};
const defaults = (): Filters => ({
  search: "",
  loan_date: "",
  status: "all",
  item_code: "",
  item_groups: [],
  warehouses: [],
  activity: "",
});

export function useLoansController() {
  const route = useRoute();
  const router = useRouter();
  const { surface: responsiveSurface, isSurface } = useResponsiveLayout();
  const surface = responsiveSurface;
  const mode = computed<Mode>(() =>
    String(route.path || "/loans/items").endsWith("/records")
      ? "records"
      : "items",
  );
  const boot = ref<any>();
  const items = ref<any[]>([]);
  const itemQuery = ref("");
  const filterOptionsBusy = ref(false);
  const activities = ref<any[]>([]);
  const activityQuery = ref("");
  const rows = ref<any[]>([]);
  const total = ref(0);
  const overall = ref(0);
  const facets = ref({
    warehouses: {},
    item_groups: {},
    activities: {},
  } as any);
  const columnSummaries = ref<Record<string, any>>({});
  const error = ref("");
  const appendError = ref("");
  const loading = ref(true);
  const loadingMore = ref(false);
  const filterOpen = ref(false);
  const desktopFilterOpen = ref(false);
  const filters = ref<Filters>(defaults());
  const sort = ref<SortState>({ sort_by: "loan_date", sort_order: "desc" });
  const scrollResetToken = ref(0);
  const pageLength = 30;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let syncingRoute = false;
  let controller: AbortController | undefined;
  let appendController: AbortController | undefined;
  let filterOptionsController: AbortController | undefined;
  let filterOptionsTimer: ReturnType<typeof setTimeout> | undefined;
  let filterOptionsSequence = 0;
  const compact = ref(false);

  const pageActions = computed<PageAction[]>(() => {
    const capabilities = boot.value?.stock_operation_capabilities || {};
    if (!boot.value)
      return [
        { kind: "Loan", label: "新建借出", disabled: true },
        { kind: "Return", label: "新建归还", disabled: true },
      ];
    return [
      ...(capabilities.Loan ? [{ kind: "Loan", label: "新建借出" }] : []),
      ...(capabilities.Return ? [{ kind: "Return", label: "新建归还" }] : []),
    ];
  });
  const columns = computed<DataTableColumn[]>(() =>
    mode.value === "items"
      ? [
          {
            key: "loan_date",
            label: "借出日期",
            sortable: true,
            initialOrder: "desc",
          },
          { key: "item", label: "物品" },
          { key: "borrower", label: "借用方", sortable: true },
          { key: "loaned", label: "借出数量", summary: "loaned_qty" },
          { key: "outstanding", label: "未归还", summary: "outstanding_qty" },
          { key: "loan_status", label: "状态", sortable: true },
          { key: "original_warehouse", label: "原始位置" },
          { key: "activity_title", label: "相关活动" },
          { key: "record_name", label: "借用记录" },
        ]
      : [
          {
            key: "loan_date",
            label: "借出日期",
            sortable: true,
            initialOrder: "desc",
          },
          { key: "record_name", label: "记录编号", sortable: true },
          { key: "borrower", label: "借用方", sortable: true },
          {
            key: "line_count",
            label: "物品行数",
            sortable: true,
            summary: "line_count",
          },
          { key: "loaned_qty", label: "借出数量", summary: "loaned_qty" },
          {
            key: "outstanding_qty",
            label: "未归还",
            summary: "outstanding_qty",
          },
          { key: "loan_status", label: "状态", sortable: true },
          { key: "activity_title", label: "相关活动" },
        ],
  );
  const statusOptions = [
    { value: "all", label: "全部" },
    { value: "outstanding", label: "未结" },
    { value: "settled", label: "已结清" },
  ];
  const statusLabel = (status: string) =>
    ({
      Outstanding: "未归还",
      "Partially Settled": "部分结清",
      Settled: "已结清",
    })[status] || status;
  const formatQuantities = (values: any[] | undefined) =>
    (values || [])
      .map(
        (value) =>
          `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value.qty)} ${value.uom}`,
      )
      .join(" · ") || "—";
  const warehouseText = (name: string) =>
    warehousePresentation(name, boot.value?.physical_tree || []).breadcrumb ||
    name;
  const activityOptions = computed(() =>
    activities.value.map((activity) => ({
      label: activity.title || activity.name,
      value: activity.name,
    })),
  );
  const itemOptions = computed(() => [
    { label: "全部物品", value: "" },
    ...items.value.map((item) => ({
      label: `${item.item_name || item.name} · ${item.name}`,
      value: item.name,
    })),
  ]);
  const activeCount = computed(
    () =>
      (filters.value.search ? 1 : 0) +
      (filters.value.loan_date ? 1 : 0) +
      (filters.value.item_code ? 1 : 0) +
      filters.value.item_groups.length +
      filters.value.warehouses.length +
      (filters.value.activity ? 1 : 0) +
      (filters.value.status !== "all" ? 1 : 0),
  );
  const chips = computed(() => [
    ...(filters.value.status !== "all"
      ? [
          {
            key: "status",
            label: `状态：${statusOptions.find((item) => item.value === filters.value.status)?.label}`,
          },
        ]
      : []),
    ...filters.value.warehouses.map((value) => ({
      key: "warehouses",
      value,
      label: `位置：${warehouseText(value)}`,
    })),
    ...filters.value.item_groups.map((value) => ({
      key: "item_groups",
      value,
      label: `类别：${value}`,
    })),
    ...(filters.value.item_code
      ? [
          {
            key: "item_code",
            label: `物品：${items.value.find((item) => item.name === filters.value.item_code)?.item_name || filters.value.item_code}`,
          },
        ]
      : []),
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
            label: `活动：${activities.value.find((activity) => activity.name === filters.value.activity)?.title || filters.value.activity}`,
          },
        ]
      : []),
  ]);
  function queryFilters() {
    return {
      ...filters.value,
      status: filters.value.status === "all" ? undefined : filters.value.status,
      item_code: filters.value.item_code || undefined,
      sort_by: sort.value.sort_by,
      sort_order: sort.value.sort_order,
    };
  }
  async function loadItemOptions(search = "") {
    filterOptionsController?.abort();
    const requestController = new AbortController();
    filterOptionsController = requestController;
    const current = ++filterOptionsSequence;
    filterOptionsBusy.value = true;
    try {
      const data = await workspaceApi(
        "movement_filter_options",
        { search, start: 0, page_length: 100 },
        requestController.signal,
      );
      if (current !== filterOptionsSequence) return;
      const selected = items.value.find(
        (item) => item.name === filters.value.item_code,
      );
      const incoming = data.items || [];
      items.value =
        selected && !incoming.some((item: any) => item.name === selected.name)
          ? [selected, ...incoming]
          : incoming;
    } catch (cause: any) {
      if (cause?.name !== "AbortError" && current === filterOptionsSequence)
        error.value = cause.message || "物品筛选选项加载失败";
    } finally {
      if (current === filterOptionsSequence) filterOptionsBusy.value = false;
    }
  }
  function scheduleItemSearch(value: string) {
    itemQuery.value = value;
    if (filterOptionsTimer) clearTimeout(filterOptionsTimer);
    filterOptionsTimer = setTimeout(() => void loadItemOptions(value), 250);
  }
  async function load(append = false) {
    if (append && (loadingMore.value || rows.value.length >= total.value))
      return;
    if (append) appendController?.abort();
    else {
      controller?.abort();
      appendController?.abort();
    }
    const requestController = new AbortController();
    const current = ++sequence;
    if (append) {
      loadingMore.value = true;
      appendError.value = "";
      appendController = requestController;
    } else {
      loading.value = true;
      error.value = "";
      controller = requestController;
    }
    try {
      const data = await api(
        mode.value === "items" ? "loan_items" : "loan_records",
        {
          filters: queryFilters(),
          start: append ? rows.value.length : 0,
          page_length: pageLength,
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
      overall.value = Number(data.overall_total ?? data.total ?? 0);
      facets.value = data.facets || {
        warehouses: {},
        item_groups: {},
        activities: {},
      };
      columnSummaries.value = data.column_summaries || {};
      if (!append) {
        syncingRoute = true;
        await router.replace({
          query: {
            ...serializeFilterQuery({
              ...filters.value,
              status:
                filters.value.status === "all" ? "" : filters.value.status,
            }),
            ...(sort.value.sort_by === "loan_date" &&
            sort.value.sort_order === "desc"
              ? {}
              : sort.value),
          },
        });
        syncingRoute = false;
      }
    } catch (cause: any) {
      if (current === sequence && cause?.name !== "AbortError") {
        if (append) appendError.value = cause.message || "加载更多失败";
        else error.value = cause.message || "加载借用记录失败";
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
  function applyQuery(query: Record<string, any>) {
    const hydrated = hydrateFilterQuery(query, defaults());
    const value = String(hydrated.status);
    filters.value = {
      ...hydrated,
      status: ["all", "outstanding", "settled"].includes(value)
        ? (value as LoanStatus)
        : "all",
    };
    const sortBy = String(query.sort_by || "loan_date");
    const sortOrder = String(query.sort_order || "desc");
    if (
      columns.value.some(
        (column) => column.key === sortBy && column.sortable,
      ) &&
      ["asc", "desc"].includes(sortOrder)
    )
      sort.value = { sort_by: sortBy, sort_order: sortOrder as "asc" | "desc" };
  }
  function removeChip(chip: any) {
    if (chip.key === "status") filters.value.status = "all";
    else if (Array.isArray((filters.value as any)[chip.key]))
      (filters.value as any)[chip.key] = (filters.value as any)[
        chip.key
      ].filter((value: string) => value !== chip.value);
    else (filters.value as any)[chip.key] = "";
  }
  function clearFilters() {
    filters.value = defaults();
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
    void router.push(`/loans/${encodeURIComponent(name)}`);
  }
  function createLoan() {
    return router.push("/new/Loan");
  }
  function createReturn() {
    return router.push("/new/Return");
  }
  function onResultsScroll(event: Event) {
    compact.value = (event.currentTarget as HTMLElement).scrollTop > 80;
  }
  watch(
    [filters, sort, mode],
    () => {
      if (boot.value) {
        scrollResetToken.value += 1;
        scheduleLoad();
      }
    },
    { deep: true },
  );
  watch(
    () => route.query,
    (query) => {
      if (!syncingRoute && boot.value) {
        applyQuery(query as Record<string, any>);
        void loadItemOptions(filters.value.item_code || "");
      }
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
        : activityData?.results || [];
      applyQuery(route.query as Record<string, any>);
      await loadItemOptions(filters.value.item_code || "");
      await load();
    } catch (cause: any) {
      error.value = cause.message || "加载借用记录失败";
      loading.value = false;
    }
  });
  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer);
    controller?.abort();
    appendController?.abort();
    filterOptionsController?.abort();
    if (filterOptionsTimer) clearTimeout(filterOptionsTimer);
  });
  return {
    route,
    router,
    surface,
    mode,
    boot,
    items,
    itemQuery,
    itemOptions,
    filterOptionsBusy,
    activities,
    activityQuery,
    activityOptions,
    statusOptions,
    rows,
    total,
    overall,
    facets,
    columnSummaries,
    error,
    appendError,
    loading,
    loadingMore,
    filterOpen,
    desktopFilterOpen,
    filters,
    sort,
    columns,
    statusLabel,
    formatQuantities,
    activeCount,
    chips,
    scrollResetToken,
    compact,
    load,
    scheduleLoad,
    removeChip,
    clearFilters,
    openFilters,
    openLoan,
    createLoan,
    createReturn,
    scheduleItemSearch,
    onResultsScroll,
    warehouseText,
    pageActions,
  };
}
export type LoansController = ReturnType<typeof useLoansController>;
