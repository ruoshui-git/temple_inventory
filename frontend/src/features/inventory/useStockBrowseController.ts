import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  newReportQuery,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import {
  clearScopeField,
  scopeFilterFieldChips,
} from "../../lib/filterPresentation";
import { reportFilterChips } from "../../lib/reportFilters";
import { expiryStatus, type StockItem } from "../../lib/stockPresentation";
import { isUnavailableError } from "../../lib/serviceFailure";
import { useBrowseState } from "../../lib/browseMemory";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { useReportGroups } from "../../composables/useReportGroups";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";

interface InventoryPage {
  rows: StockItem[];
  matched_count: number;
  next_start: number | null;
  snapshot: string;
  query: ReportQuery;
  summary: ReportRow[];
  analysis: Record<"category" | "location", ReportRow[]>;
}
export function useStockBrowseController(
  props: { active?: boolean; initialQuery?: ReportQuery; queryError?: string },
  navigate: (kind: string, codes?: string[]) => void,
  openItem: (code: string) => void,
  changed?: (query: ReportQuery) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const scopeError = computed(
    () =>
      props.queryError ||
      (props.initialQuery &&
      (props.initialQuery.dataset !== "inventory" ||
        !["summary", "locations"].includes(props.initialQuery.view))
        ? "库存列表需要当前库存范围"
        : ""),
  );
  const search = ref(""),
    view = ref("table"),
    sort = ref("item_name"),
    descending = ref(false),
    selected = ref<string[]>([]),
    inStockOnly = ref(true),
    analysisDimension = ref<"category" | "location">("category");
  const scope = ref(newReportQuery("inventory").scope);
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (!scope.value.categories.includes(oldName)) return;
    scope.value.categories = [
      ...new Set(
        scope.value.categories.map((name) =>
          name === oldName ? category.name : name,
        ),
      ),
    ];
  });
  const constraints = ref(newReportQuery("inventory"));
  const data = reactive({
    rows: [] as StockItem[],
    total: 0,
    next: null as number | null,
    loading: true,
    error: "",
    moreError: "",
    summary: [] as ReportRow[],
    analysis: { category: [], location: [] } as InventoryPage["analysis"],
    snapshot: "",
    stale: false,
  });
  const query = computed<ReportQuery>(() => {
    const value = JSON.parse(JSON.stringify(constraints.value)) as ReportQuery;
    value.search = search.value;
    value.includeZero = !inStockOnly.value;
    value.sortBy = sort.value;
    value.sort = descending.value ? "desc" : "asc";
    value.scope = JSON.parse(JSON.stringify(scope.value));
    return value;
  });
  const groups = useReportGroups(query, services);
  watch(
    () => JSON.stringify(props.initialQuery),
    () => {
      const incoming = props.initialQuery;
      if (!incoming) return;
      constraints.value = JSON.parse(JSON.stringify(incoming));
      scope.value = JSON.parse(JSON.stringify(incoming.scope));
      search.value = incoming.search;
      inStockOnly.value = !incoming.includeZero;
      sort.value = [
        "item_name",
        "item_code",
        "category",
        "stock_uom",
        "available",
        "loaned",
        "damaged",
      ].includes(incoming.sortBy)
        ? incoming.sortBy
        : "item_name";
      descending.value = incoming.sort === "desc";
    },
    { immediate: true },
  );
  let generation = 0;
  let request: AbortController | undefined;
  useBrowseState(
    "inventory",
    () => query.value,
    () => ({
      view: view.value,
      selected: selected.value,
      dimension: analysisDimension.value,
    }),
    (value) => {
      view.value = String(value.view || "table");
      selected.value = (value.selected || []) as string[];
      analysisDimension.value =
        value.dimension === "location" ? "location" : "category";
    },
    () => !data.loading && !data.stale,
  );
  function clearData() {
    Object.assign(data, {
      rows: [],
      total: 0,
      next: null,
      summary: [],
      analysis: { category: [], location: [] },
      snapshot: "",
      stale: false,
    });
  }
  async function load(more = false, refresh = false) {
    if (more && (data.loading || data.next === null)) return;
    const current = ++generation;
    request?.abort();
    if (scopeError.value || reference.user !== account) {
      clearData();
      data.loading = false;
      return;
    }
    if (props.active === false) {
      data.loading = false;
      return;
    }
    request = new AbortController();
    data.loading = true;
    data.error = "";
    data.moreError = "";
    if (!more) data.stale = data.rows.length > 0;
    try {
      const result = await services.call<InventoryPage>(
        "browse.inventory_page",
        {
          query: query.value,
          start: more ? data.next : 0,
          page_length: 30,
          ...(refresh ? { refresh: true } : {}),
        },
        request.signal,
      );
      if (current !== generation || reference.user !== account) return;
      data.rows = more
        ? [
            ...data.rows,
            ...result.rows.filter(
              (row) => !data.rows.some((old) => old.code === row.code),
            ),
          ]
        : result.rows;
      data.total = result.matched_count;
      data.next = result.next_start;
      data.summary = result.summary;
      data.analysis = result.analysis;
      data.snapshot = result.snapshot;
      data.stale = false;
    } catch (error) {
      if (current !== generation || reference.user !== account) return;
      if (isUnavailableError(error)) clearData();
      const message = error instanceof Error ? error.message : "库存加载失败";
      if (more) data.moreError = message;
      else data.error = message;
    } finally {
      if (current === generation) data.loading = false;
    }
  }
  watch(
    [() => JSON.stringify(query.value), scopeError, () => props.active],
    () => {
      void load();
    },
    { immediate: true },
  );
  watch(
    () => reference.user,
    () => {
      if (reference.user !== account) {
        generation++;
        request?.abort();
        clearData();
        data.loading = false;
        selected.value = [];
      }
    },
  );
  onBeforeUnmount(() => {
    stopCategoryRename();
    generation++;
    request?.abort();
  });
  const metrics = computed(() =>
    [
      { key: "available", label: "可用库存", icon: "box", tone: "available" },
      { key: "loaned", label: "借出", icon: "loan", tone: "loaned" },
      { key: "damaged", label: "损坏待处理", icon: "warning", tone: "damaged" },
    ].map((metric) => ({
      ...metric,
      quantities: data.summary
        .filter((row) => Number(row[metric.key] || 0) !== 0)
        .map((row) => ({
          uom: String(row.stock_uom || ""),
          qty: Number(row[metric.key] || 0),
        })),
    })),
  );
  function clear() {
    const routeScope = {
      restrictItems: constraints.value.restrictItems,
      itemCodes: [...constraints.value.itemCodes],
      restrictAllocations: constraints.value.restrictAllocations,
      allocationKeys: [...constraints.value.allocationKeys],
      itemLocationKeys: [...constraints.value.itemLocationKeys],
      loan: constraints.value.loan,
      record: constraints.value.record,
      recordDoctype: constraints.value.recordDoctype,
    };
    constraints.value = Object.assign(newReportQuery("inventory"), routeScope);
    inStockOnly.value = true;
    scope.value = newReportQuery("inventory").scope;
  }
  const appliedChips = computed(() => [
    ...scopeFilterFieldChips(query.value.scope, reference).map((chip) => ({
      ...chip,
      remove: () => {
        const nextScope = JSON.parse(
          JSON.stringify(query.value.scope),
        ) as ReportQuery["scope"];
        clearScopeField(nextScope, chip.field);
        scope.value = nextScope;
      },
    })),
    ...reportFilterChips(query.value, reference).map((chip) => ({
      ...chip,
      remove: () => {
        Object.assign(constraints.value, chip.reset);
        if ("includeZero" in chip.reset)
          inStockOnly.value = !chip.reset.includeZero;
      },
    })),
  ]);
  const actions = computed(() =>
    reference.capabilities.Item?.create === true
      ? [{ name: "新建物品", kind: "Item", icon: "box" }]
      : [],
  );
  const selectedActions = computed(() =>
    selected.value.length
      ? [
          { name: "入库", kind: "Receive", icon: "download" },
          { name: "出库", kind: "Issue", icon: "loan" },
          { name: "调拨", kind: "Transfer", icon: "movement" },
        ].filter((action) => reference.operations[action.kind] === true)
      : [],
  );
  function selectedAction(kind: string) {
    if (
      scopeError.value ||
      reference.user !== account ||
      props.active === false
    )
      return;
    if (!selectedActions.value.some((action) => action.kind === kind)) return;
    navigate(kind, [...new Set(selected.value)]);
  }
  watch(
    () => JSON.stringify(query.value),
    () => {
      if (!scopeError.value && reference.user === account)
        changed?.(JSON.parse(JSON.stringify(query.value)));
    },
  );
  function action(name: string) {
    if (scopeError.value || reference.user !== account) return;
    const selectedAction = actions.value.find((action) => action.name === name);
    if (!selectedAction) return;
    navigate(selectedAction.kind);
  }
  return {
    actions,
    selectedActions,
    selectedAction,
    scopeError,
    appliedChips,
    reference,
    data,
    search,
    view,
    sort,
    descending,
    selected,
    inStockOnly,
    analysisDimension,
    scope,
    query,
    groups,
    setGroupBy: (groupBy: string[]) => {
      constraints.value.groupBy = groupBy.slice(0, 2);
    },
    metrics,
    load,
    clear,
    reset: () => {
      clear();
      search.value = "";
    },
    action,
    rows: computed(() => data.rows),
    analysis: computed(() => data.analysis[analysisDimension.value]),
    status: computed(() =>
      data.loading
        ? data.rows.length
          ? "refresh"
          : "loading"
        : data.error && !data.rows.length
          ? "error"
          : "ready",
    ),
    toggle: (code: string) => {
      selected.value = selected.value.includes(code)
        ? selected.value.filter((value) => value !== code)
        : [...selected.value, code];
    },
    sortBy: (key: string) => {
      descending.value = sort.value === key ? !descending.value : false;
      sort.value = key;
    },
    openItem: (item: StockItem) => {
      if (!data.stale) openItem(item.code);
    },
    openItemCode: (code: string) => {
      if (!data.stale && code) openItem(code);
    },
    expiryStatus: (item: StockItem) => expiryStatus(item, reference.siteDate),
  };
}
