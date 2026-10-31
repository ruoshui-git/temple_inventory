import { useRelatedLoans } from "../loans/useRelatedLoans";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  newReportQuery,
  type MovementHistoryPage,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import { decodeReportQuery } from "../../lib/reportQuery";
import { browseDefaults } from "../../lib/browseDefaults";
import { reportFilterChips } from "../../lib/reportFilters";
import type { CatalogItem } from "../../lib/catalogPresentation";
import { presentCatalogItem } from "../../lib/catalogPresentation";
import { scopeFilterChips } from "../../lib/filterPresentation";
import { isUnavailableError } from "../../lib/serviceFailure";
import { useBrowseState } from "../../lib/browseMemory";
import { sortableColumnsForView } from "../../lib/reportContract";
import { useReportGroups } from "../../composables/useReportGroups";
import { useBrowseSelection } from "../../composables/useBrowseSelection";
export interface OperationGroup {
  id: string;
  item?: CatalogItem;
  item_code?: string;
  item_name?: string;
  image?: string;
  category?: string;
  stock_uom?: string;
  stock_qty?: number;
  date?: string;
  posting_timestamp?: string;
  modified?: string;
  outcome_key?: string;
  docstatus?: number;
  doctype?: string;
  document?: string;
  kind?: string;
  borrower?: string;
  activity_title?: string;
  document_count: number;
  item_count: number;
  allocation_count?: number;
  totals?: ReportRow[];
  whole?: {
    quantities: { uom: string; qty: number }[];
    available_effects: { uom: string; qty: number }[];
    outstanding?: { uom: string; qty: number }[];
    item_count: number;
    line_count: number;
    branches: {
      source: string;
      destination: string;
      source_path?: string;
      source_native_name?: string;
      destination_path?: string;
      destination_native_name?: string;
    }[];
    original_loans: string[];
    settlement_records?: { name: string; kind: string }[];
    original_loan_details?: { name: string; borrower: string; date: string }[];
    loan_status?: string;
  };
}
export interface BrowseRowsPage {
  rows: ReportRow[];
  matched_count: number;
  next_start: number | null;
  history_complete?: boolean;
}
export interface OperationBrowsePage {
  rows: OperationGroup[];
  matched_count: number;
  next_start: number | null;
  query: ReportQuery;
  snapshot: string;
  summary: ReportRow;
  totals: ReportRow[];
  analysis: Record<string, BrowseRowsPage>;
}
export interface BrowseDetail {
  id: string;
  label: string;
  rows: ReportRow[];
  columns: string[];
  total: number;
  next: number | null;
  loading: boolean;
  error: string;
  initialized: boolean;
  historyComplete?: boolean;
  failedMore?: boolean;
}
export function useOperationBrowse(
  props: {
    family: "movements" | "loans";
    records: boolean;
    initialQuery?: ReportQuery;
    routeQuery?: string;
  },
  changed: (query: ReportQuery) => void,
) {
  const relatedLoans = useRelatedLoans();
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user,
    selection = useBrowseSelection();
  function defaults(records = props.records) {
    const view = records
      ? "records"
      : props.family === "movements"
        ? "summary"
        : "items";
    const query = browseDefaults(props.family, view);
    if (!records) query.groupBy = [];
    if (props.family === "loans" && !records) {
      query.loanOutcome = "all";
      query.outstandingOnly = false;
      query.statuses = [1];
    }
    return query;
  }
  const query = ref(defaults()),
    routeError = ref("");
  const groups = useReportGroups(query, services);
  const result = reactive({
    rows: [] as OperationGroup[],
    total: 0,
    next: null as number | null,
    summary: {} as ReportRow,
    totals: [] as ReportRow[],
    snapshot: "",
    loading: false,
    error: "",
    refreshFailed: false,
    stale: false,
    initialized: false,
  });
  const details = reactive<Record<string, BrowseDetail>>({}),
    analyses = reactive<Record<string, BrowseDetail>>({}),
    detailSorts = reactive<
      Record<string, { field: string; direction: "asc" | "desc" }>
    >({}),
    sharedHistorySort = reactive({
      field: "date",
      direction: "desc" as "asc" | "desc",
    }),
    expanded = reactive(new Set<string>()),
    dimension = ref("category");
  let restoring = false,
    skipNextQueryLoad = false,
    generation = 0,
    disposed = false,
    retryMore = false;
  const requests = new Set<AbortController>();
  const detailRequests = new Map<string, AbortController>();
  const detailRows = new Map<string, OperationGroup>();
  const active = (current = generation) =>
    !disposed && current === generation && reference.user === account;
  function detailSort(row: OperationGroup) {
    return sharedHistorySort;
  }
  function cancel() {
    generation++;
    requests.forEach((request) => request.abort());
    requests.clear();
    detailRequests.clear();
    for (const table of Object.values(details)) table.loading = false;
  }
  function clearUnavailable() {
    cancel();
    Object.assign(result, {
      rows: [],
      total: 0,
      next: null,
      summary: {},
      totals: [],
      snapshot: "",
      loading: false,
      refreshFailed: false,
      stale: false,
      initialized: false,
    });
    for (const key of Object.keys(details)) delete details[key];
    for (const key of Object.keys(analyses)) delete analyses[key];
    expanded.clear();
  }
  function detail(id: string, label: string): BrowseDetail {
    return {
      id,
      label,
      rows: [],
      columns: [],
      total: 0,
      next: null,
      loading: false,
      error: "",
      initialized: false,
      failedMore: false,
      historyComplete: true,
    };
  }
  function enter() {
    restoring = true;
    const decoded =
      props.initialQuery || props.routeQuery
        ? decodeReportQuery(props.initialQuery || props.routeQuery)
        : undefined;
    routeError.value = decoded?.error || "";
    const incoming = decoded?.query || defaults();
    if (incoming.dataset !== props.family) {
      routeError.value = "链接中的筛选条件无效，已显示默认结果";
      Object.assign(incoming, defaults());
    }
    incoming.view = props.records
      ? "records"
      : props.family === "movements"
        ? "summary"
        : "items";
    if (props.family === "loans") {
      incoming.statuses = [1];
    }
    const supportedSorts = sortableColumnsForView(props.family, incoming.view);
    if (!supportedSorts.includes(incoming.sortBy)) {
      incoming.sortBy = defaults().sortBy;
      incoming.sort = defaults().sort;
    }
    if (JSON.stringify(query.value) !== JSON.stringify(incoming))
      query.value = incoming;
    restoring = false;
  }
  watch(
    () =>
      JSON.stringify([
        props.family,
        props.records,
        props.routeQuery,
        props.initialQuery,
      ]),
    enter,
    { immediate: true },
  );
  watch(
    () => reference.user,
    (user) => {
      if (user !== account) selection.exit();
    },
  );
  useBrowseState(
    `operations/${props.family}/${props.records ? "records" : "items"}`,
    () => query.value,
    () => ({
      expanded: [...expanded],
      dimension: dimension.value,
    }),
    (value) => {
      expanded.clear();
      for (const id of (value.expanded || []) as string[]) expanded.add(id);
      dimension.value = String(value.dimension || "category");
    },
    () =>
      result.initialized &&
      !result.loading &&
      !result.stale &&
      Object.values(details).every((table) => !table.loading),
  );
  async function load(more = false) {
    if (more && (result.loading || result.next === null || result.stale))
      return;
    if (!more) cancel();
    const current = generation,
      request = new AbortController();
    requests.add(request);
    retryMore = more;
    result.loading = true;
    result.error = "";
    result.refreshFailed = false;
    if (!more) result.stale = result.initialized;
    const sent = JSON.parse(JSON.stringify(query.value));
    try {
      const page = await services.call<OperationBrowsePage>(
        "browse.operation_page",
        {
          query: sent,
          records: props.records,
          start: more ? result.next : 0,
          page_length: 20,
        },
        request.signal,
      );
      if (!active(current) || request.signal.aborted) return;
      result.rows = more
        ? [
            ...result.rows,
            ...page.rows.filter(
              (row) => !result.rows.some((old) => old.id === row.id),
            ),
          ]
        : page.rows;
      if (!more) selection.retain(result.rows.map((row) => String(row.id)));
      result.total = page.matched_count;
      result.next = page.next_start;
      result.summary = page.summary;
      result.totals = page.totals;
      result.snapshot = page.snapshot;
      result.stale = false;
      result.refreshFailed = false;
      result.initialized = true;
      if (!more) {
        Object.keys(details).forEach((key) => delete details[key]);
        Object.keys(analyses).forEach((key) => delete analyses[key]);
        detailRows.clear();
      }
      for (const [key, value] of Object.entries(page.analysis)) {
        if (!more || !analyses[key])
          analyses[key] = {
            ...detail(key, "当前结果分析"),
            rows: value.rows,
            total: value.matched_count,
            next: value.next_start,
            initialized: true,
          };
      }
      for (const row of page.rows) {
        if (expanded.has(row.id)) void loadDetails(row);
      }
      if (
        !props.records &&
        !query.value.groupBy.length &&
        ((props.family === "loans" && query.value.view === "items") ||
          (props.family === "movements" && query.value.view === "summary"))
      ) {
        const flatHistory: OperationGroup = {
          id: "flat-history-scope",
          document_count: 0,
          item_count: 0,
        };
        expanded.add(flatHistory.id);
        await loadDetails(flatHistory);
      }
    } catch (reason) {
      if (request.signal.aborted) return;
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        result.error =
          reason instanceof Error ? reason.message : "读取失败，原结果仍保留";
        result.refreshFailed = result.initialized;
        result.stale = false;
      }
    } finally {
      requests.delete(request);
      if (active(current)) result.loading = false;
    }
  }
  watch(
    () => JSON.stringify(query.value),
    () => {
      if (!restoring) changed(JSON.parse(JSON.stringify(query.value)));
      if (skipNextQueryLoad) {
        skipNextQueryLoad = false;
        return;
      }
      void load();
    },
    { immediate: true },
  );
  async function loadDetails(row: OperationGroup, more = false, retry = false) {
    if (result.stale || !active()) return;
    detailRows.set(row.id, row);
    if (!details[row.id])
      details[row.id] = detail(
        row.id,
        props.records ? "符合筛选的明细" : "相关记录",
      );
    const table = details[row.id]!;
    if (
      table.loading ||
      (!more && !retry && table.initialized) ||
      (more && table.next === null)
    )
      return;
    const current = generation,
      request = new AbortController();
    requests.add(request);
    detailRequests.set(row.id, request);
    table.loading = true;
    table.error = "";
    try {
      const detailQuery = JSON.parse(
        JSON.stringify(query.value),
      ) as ReportQuery;
      detailQuery.dataset = props.family;
      detailQuery.view = props.records
        ? "records"
        : props.family === "movements"
          ? "lines"
          : query.value.view === "items"
            ? "items"
            : "outcomes";
      detailQuery.groupBy = [];
      const independentLoanItemSort =
        props.family === "loans" &&
        query.value.view === "items" &&
        !props.records;
      if (!independentLoanItemSort) {
        detailQuery.sortBy = detailSort(row).field;
        detailQuery.sort = detailSort(row).direction;
      }
      const page =
        props.family === "movements" &&
        query.value.view === "summary" &&
        !props.records
          ? await services.call<MovementHistoryPage>(
              "browse.movement_history",
              {
                query: detailQuery,
                item_code: row.item_code,
                sort_by: detailSort(row).field,
                sort: detailSort(row).direction,
                start: more ? table.next : 0,
                page_length: 30,
              },
              request.signal,
            )
          : await services.call<BrowseRowsPage & { columns: string[] }>(
              "browse.operation_contributions",
              {
                query: detailQuery,
                records: props.records,
                ...(independentLoanItemSort
                  ? {
                      history_sort_by: detailSort(row).field,
                      history_sort: detailSort(row).direction,
                    }
                  : {}),
                ...(props.records
                  ? { doctype: row.doctype, name: row.document }
                  : {
                      ...(row.id === "flat-history-scope"
                        ? {}
                        : { item_code: row.item_code }),
                      outcome: row.outcome_key,
                    }),
                start: more ? table.next : 0,
                page_length: 30,
              },
              request.signal,
            );
      if (!active(current) || request.signal.aborted) return;
      table.rows = more
        ? [
            ...table.rows,
            ...page.rows.filter(
              (row) => !table.rows.some((old) => old.id === row.id),
            ),
          ]
        : page.rows;
      table.columns = "columns" in page ? page.columns : [];
      table.total = page.matched_count;
      table.next = page.next_start;
      table.historyComplete =
        "history_complete" in page ? (page.history_complete ?? true) : true;
      table.initialized = true;
      table.failedMore = false;
    } catch (reason) {
      if (request.signal.aborted || detailRequests.get(row.id) !== request)
        return;
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        table.error = reason instanceof Error ? reason.message : "明细读取失败";
        table.failedMore = more;
        if (isUnavailableError(reason)) result.error = table.error;
      }
    } finally {
      requests.delete(request);
      if (detailRequests.get(row.id) === request) {
        detailRequests.delete(row.id);
        table.loading = false;
      }
    }
  }
  function retryDetails(row: OperationGroup) {
    const table = details[row.id];
    if (!table) return;
    void loadDetails(row, table.failedMore === true, true);
  }
  function setDetailSort(row: OperationGroup, field: string) {
    const allowed =
      props.family === "movements"
        ? [
            "identity",
            "document",
            "doctype",
            "item_name",
            "item_code",
            "kind",
            "docstatus",
            "date",
            "time",
            "source_warehouse",
            "destination_warehouse",
            "stock_uom",
            "stock_qty",
            "available_effect",
            "borrower",
          ]
        : [
            "identity",
            "document",
            "doctype",
            "item_name",
            "item_code",
            "kind",
            "docstatus",
            "date",
            "time",
            "source_warehouse",
            "destination_warehouse",
            "stock_uom",
            "borrower",
            "borrowed",
            "outstanding",
          ];
    if (!allowed.includes(field)) return;
    const state = detailSort(row);
    state.direction =
      state.field === field
        ? state.direction === "asc"
          ? "desc"
          : "asc"
        : "asc";
    state.field = field;
    for (const [id, table] of Object.entries(details)) {
      detailRequests.get(id)?.abort();
      table.loading = false;
      table.rows = [];
      table.total = 0;
      table.next = 0;
      table.initialized = false;
      if (expanded.has(id)) {
        const item =
          id === "flat-history-scope"
            ? { id, document_count: 0, item_count: 0 }
            : detailRows.get(id);
        if (item) void loadDetails(item);
      }
    }
  }
  function detailSortBy(row: OperationGroup) {
    return detailSort(row).field;
  }
  function detailSortDirection(row: OperationGroup) {
    return detailSort(row).direction;
  }
  function toggle(row: OperationGroup, open: boolean) {
    if (open) {
      expanded.add(row.id);
      if (!details[row.id]?.error) void loadDetails(row);
    } else expanded.delete(row.id);
  }
  function reloadExpandedLoanHistory() {
    for (const [id, table] of Object.entries(details)) {
      detailRequests.get(id)?.abort();
      detailRequests.delete(id);
      table.loading = false;
      table.rows = [];
      table.total = 0;
      table.next = 0;
      table.initialized = false;
      table.error = "";
      table.failedMore = false;
      if (!expanded.has(id)) continue;
      const row =
        detailRows.get(id) ||
        (id === "flat-history-scope"
          ? { id, document_count: 0, item_count: 0 }
          : undefined);
      if (row) void loadDetails(row);
    }
  }
  watch(
    () => query.value.loanStatus,
    (value, previous) => {
      if (props.family === "loans" && value !== previous)
        reloadExpandedLoanHistory();
    },
    { flush: "post" },
  );
  async function moreAnalysis() {
    const table = analyses[dimension.value];
    if (!table || table.loading || table.next === null || result.stale) return;
    const current = generation,
      request = new AbortController();
    requests.add(request);
    table.loading = true;
    table.error = "";
    try {
      const page = await services.call<BrowseRowsPage>(
        "browse.operation_analysis",
        {
          query: JSON.parse(JSON.stringify(query.value)),
          records: props.records,
          dimension: dimension.value,
          start: table.next,
          page_length: 30,
        },
        request.signal,
      );
      if (!active(current)) return;
      table.rows.push(
        ...page.rows.filter(
          (row) => !table.rows.some((old) => old.id === row.id),
        ),
      );
      table.total = page.matched_count;
      table.next = page.next_start;
    } catch (reason) {
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        table.error =
          reason instanceof Error ? reason.message : "分析分组读取失败";
        if (isUnavailableError(reason)) result.error = table.error;
      }
    } finally {
      requests.delete(request);
      if (active(current)) table.loading = false;
    }
  }
  const scope = computed({
    get: () => query.value.scope,
    set: (value) => {
      query.value.scope = value;
    },
  });
  const search = computed({
    get: () => query.value.search,
    set: (value) => {
      query.value.search = value;
    },
  });
  const primaryChip = (key: string) =>
    props.family === "movements" && props.records && key === "statuses";
  const extraChips = computed(() => [
    ...reportFilterChips(query.value, reference).filter(
      (chip) => !chip.fixed && !primaryChip(chip.key),
    ),
  ]);
  const scopeChips = computed(() => scopeFilterChips(scope.value, reference));
  function clearFilters() {
    const routeScope = {
      restrictItems: query.value.restrictItems,
      itemCodes: [...query.value.itemCodes],
      itemLocationKeys: [...query.value.itemLocationKeys],
      restrictAllocations: query.value.restrictAllocations,
      allocationKeys: [...query.value.allocationKeys],
      loan: query.value.loan,
      record: query.value.record,
      recordDoctype: query.value.recordDoctype,
      batchNo: query.value.batchNo,
      search: query.value.search,
      sortBy: query.value.sortBy,
      sort: query.value.sort,
    };
    const next = defaults();
    Object.assign(query.value, next, routeScope);
    routeError.value = "";
  }
  function reset() {
    routeError.value = "";
    query.value = defaults();
  }
  // Movement records only; loans use the 借用状态 (loanStatus) filter.
  const status = computed({
    get: () =>
      query.value.statuses.length !== 1
        ? "multiple"
        : query.value.statuses[0] === 0
          ? "draft"
          : query.value.statuses[0] === 2
            ? "cancelled"
            : "completed",
    set: (value: string) => {
      query.value.statuses = [
        value === "draft" ? 0 : value === "cancelled" ? 2 : 1,
      ];
    },
  });
  const statusChoices = computed(() => [
    ["completed", "已提交"],
    ["draft", "草稿"],
    ["cancelled", "已取消"],
    ...(status.value === "multiple" ? [["multiple", "多个状态"]] : []),
  ]);
  const analysis = computed(() => analyses[dimension.value]);
  function viewQuery(records: boolean): ReportQuery {
    if (records === props.records)
      return JSON.parse(JSON.stringify(query.value));
    cancel();
    groups.cancel();
    sharedHistorySort.field = "date";
    sharedHistorySort.direction = "desc";
    dimension.value = "category";
    const next = defaults(records);
    expanded.clear();
    for (const key of Object.keys(details)) delete details[key];
    for (const key of Object.keys(analyses)) delete analyses[key];
    detailRows.clear();
    return next;
  }
  function loanHistory() {
    const source = query.value;
    const value = newReportQuery("movements");
    value.view = "records";
    value.scope = JSON.parse(JSON.stringify(source.scope));
    value.search = source.search;
    value.restrictItems = source.restrictItems;
    value.itemCodes = [...source.itemCodes];
    value.sort = "desc";
    value.sortBy = "date";
    value.statuses = [...source.statuses];
    value.scope.kinds = ["Loan", "Return", "Damage", "Loss"];
    return value;
  }
  onBeforeUnmount(() => {
    disposed = true;
    cancel();
  });
  return {
    selecting: selection.selecting,
    selected: selection.selected,
    enterSelection: selection.enter,
    exitSelection: selection.exit,
    setSelected: selection.set,
    relatedLoans,
    query,
    groups,
    routeError,
    result,
    details,
    analyses,
    dimension,
    analysis,
    expanded,
    reference,
    scope,
    search,
    status,
    statusChoices,
    extraChips,
    scopeChips,
    clearFilters,
    reset,
    load,
    retry: () => load(retryMore),
    loadDetails,
    retryDetails,
    setDetailSort,
    detailSortBy,
    detailSortDirection,
    toggle,
    moreAnalysis,
    viewQuery,
    loanHistory,
    stockItem: (row: OperationGroup) => {
      if (row.item) return presentCatalogItem(row.item);
      if (!row.item_code || !row.item_name) return undefined;
      return {
        code: row.item_code,
        name: row.item_name,
        image: row.image || undefined,
        category: row.category || "",
        uom: row.stock_uom || "",
        tracksBatch: false,
        tracksExpiry: false,
        locations: [],
        available: 0,
        loaned: 0,
        damaged: 0,
      };
    },
  };
}
export type OperationBrowse = ReturnType<typeof useOperationBrowse>;
