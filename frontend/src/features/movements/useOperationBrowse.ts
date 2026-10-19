import { useRelatedLoans } from "../loans/useRelatedLoans";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  newReportQuery,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import { decodeReportQuery } from "../../lib/reportQuery";
import { reportFilterChips } from "../../lib/reportFilters";
import type { CatalogItem } from "../../lib/catalogPresentation";
import { presentCatalogItem } from "../../lib/catalogPresentation";
import { scopeFilterChips } from "../../lib/filterPresentation";
import { isUnavailableError } from "../../lib/serviceFailure";
import { useBrowseState } from "../../lib/browseMemory";
export interface OperationGroup {
  id: string;
  item?: CatalogItem;
  item_code?: string;
  item_name?: string;
  category?: string;
  stock_uom?: string;
  date?: string;
  posting_timestamp?: string;
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
    branches: { source: string; destination: string }[];
    original_loans: string[];
    loan_status?: string;
  };
}
export interface BrowseRowsPage {
  rows: ReportRow[];
  matched_count: number;
  next_start: number | null;
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
    account = reference.user;
  function defaults() {
    const query = newReportQuery(props.family);
    query.view = props.records
      ? "records"
      : props.family === "movements"
        ? "summary"
        : "outcomes";
    query.sortBy =
      props.records || props.family === "movements" ? "date" : "name";
    query.sort = query.sortBy === "date" ? "desc" : "asc";
    if (props.family === "movements" && !props.records)
      query.includeAdjustments = false;
    if (props.family === "loans" && !props.records)
      query.loanOutcome = "outstanding";
    return query;
  }
  const query = ref(defaults()),
    routeError = ref("");
  const result = reactive({
    rows: [] as OperationGroup[],
    total: 0,
    next: null as number | null,
    summary: {} as ReportRow,
    totals: [] as ReportRow[],
    snapshot: "",
    loading: false,
    error: "",
    stale: false,
    initialized: false,
  });
  const details = reactive<Record<string, BrowseDetail>>({}),
    analyses = reactive<Record<string, BrowseDetail>>({}),
    expanded = reactive(new Set<string>()),
    dimension = ref("category");
  let restoring = false,
    generation = 0,
    disposed = false,
    retryMore = false;
  const requests = new Set<AbortController>();
  const active = (current = generation) =>
    !disposed && current === generation && reference.user === account;
  function cancel() {
    generation++;
    requests.forEach((request) => request.abort());
    requests.clear();
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
      routeError.value = "数据范围与当前页面不一致，请返回来源页面";
      incoming.restrictItems = true;
      incoming.itemCodes = [];
      incoming.dataset = props.family;
    }
    incoming.view = props.records
      ? "records"
      : props.family === "movements"
        ? "summary"
        : "outcomes";
    const supportedSorts =
      props.family === "loans" && !props.records
        ? ["name", "quantity"]
        : ["date"];
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
  useBrowseState(
    `operations/${props.family}/${props.records ? "records" : "items"}`,
    () => query.value,
    () => ({ expanded: [...expanded], dimension: dimension.value }),
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
      if (!active(current)) return;
      result.rows = more
        ? [
            ...result.rows,
            ...page.rows.filter(
              (row) => !result.rows.some((old) => old.id === row.id),
            ),
          ]
        : page.rows;
      result.total = page.matched_count;
      result.next = page.next_start;
      result.summary = page.summary;
      result.totals = page.totals;
      result.snapshot = page.snapshot;
      result.stale = false;
      result.initialized = true;
      if (!more) {
        Object.keys(details).forEach((key) => delete details[key]);
        Object.keys(analyses).forEach((key) => delete analyses[key]);
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
      for (const row of page.rows)
        if (expanded.has(row.id)) void loadDetails(row);
    } catch (reason) {
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        result.error =
          reason instanceof Error ? reason.message : "读取失败，原结果仍保留";
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
      void load();
    },
    { immediate: true },
  );
  async function loadDetails(row: OperationGroup, more = false) {
    if (result.stale || !active()) return;
    if (!details[row.id])
      details[row.id] = detail(
        row.id,
        props.records ? "符合筛选的明细" : "符合筛选的记录与明细",
      );
    const table = details[row.id]!;
    if (
      table.loading ||
      (!more && table.initialized) ||
      (more && table.next === null)
    )
      return;
    const current = generation,
      request = new AbortController();
    requests.add(request);
    table.loading = true;
    table.error = "";
    try {
      const page = await services.call<BrowseRowsPage & { columns: string[] }>(
        "browse.operation_contributions",
        {
          query: JSON.parse(JSON.stringify(query.value)),
          records: props.records,
          ...(props.records
            ? { doctype: row.doctype, name: row.document }
            : { item_code: row.item_code, outcome: row.outcome_key }),
          start: more ? table.next : 0,
          page_length: 30,
        },
        request.signal,
      );
      if (!active(current)) return;
      table.rows = more
        ? [
            ...table.rows,
            ...page.rows.filter(
              (row) => !table.rows.some((old) => old.id === row.id),
            ),
          ]
        : page.rows;
      table.columns = page.columns;
      table.total = page.matched_count;
      table.next = page.next_start;
      table.initialized = true;
    } catch (reason) {
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        table.error = reason instanceof Error ? reason.message : "明细读取失败";
        if (isUnavailableError(reason)) result.error = table.error;
      }
    } finally {
      requests.delete(request);
      if (active(current)) table.loading = false;
    }
  }
  function toggle(row: OperationGroup, open: boolean) {
    if (open) {
      expanded.add(row.id);
      void loadDetails(row);
    } else expanded.delete(row.id);
  }
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
    props.family === "movements"
      ? props.records && key === "statuses"
      : key === (props.records ? "loanStatus" : "loanOutcome");
  const extraChips = computed(() =>
    reportFilterChips(query.value, reference).filter(
      (chip) => !chip.fixed && !primaryChip(chip.key),
    ),
  );
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
  const status = computed({
    get: () =>
      props.family === "movements"
        ? query.value.statuses.length !== 1
          ? "multiple"
          : query.value.statuses[0] === 0
            ? "draft"
            : query.value.statuses[0] === 2
              ? "cancelled"
              : "completed"
        : props.records
          ? query.value.statuses.length === 1 && query.value.statuses[0] === 0
            ? "draft"
            : query.value.loanStatus
          : query.value.loanOutcome,
    set: (value: string) => {
      if (props.family === "movements")
        query.value.statuses = [
          value === "draft" ? 0 : value === "cancelled" ? 2 : 1,
        ];
      else if (props.records) {
        query.value.statuses = value === "draft" ? [0] : [1];
        query.value.loanStatus = value === "draft" ? "all" : value;
      } else query.value.loanOutcome = value;
    },
  });
  const statusChoices = computed(() =>
    props.family === "movements"
      ? [
          ["completed", "已提交"],
          ["draft", "草稿"],
          ["cancelled", "已取消"],
          ...(status.value === "multiple" ? [["multiple", "多个状态"]] : []),
        ]
      : props.records
        ? [
            ["all", "全部"],
            ["open", "未结清"],
            ["settled", "已结清"],
            ["draft", "草稿"],
          ]
        : [
            ["all", "全部"],
            ["outstanding", "未归还"],
            ["returned", "完好归还"],
            ["damaged", "损坏归还"],
            ["lost", "遗失"],
          ],
  );
  const analysis = computed(() => analyses[dimension.value]);
  function viewQuery(records: boolean): ReportQuery {
    return {
      ...JSON.parse(JSON.stringify(query.value)),
      view: records
        ? "records"
        : props.family === "movements"
          ? "summary"
          : "outcomes",
    };
  }
  function loanHistory() {
    const value: ReportQuery = JSON.parse(JSON.stringify(query.value));
    value.dataset = "movements";
    value.scope.kinds = ["Loan", "Return", "Damage", "Loss"];
    value.view = "records";
    return value;
  }
  onBeforeUnmount(() => {
    disposed = true;
    cancel();
  });
  return {
    relatedLoans,
    query,
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
    toggle,
    moreAnalysis,
    viewQuery,
    loanHistory,
    stockItem: (row: OperationGroup) =>
      row.item ? presentCatalogItem(row.item) : undefined,
  };
}
export type OperationBrowse = ReturnType<typeof useOperationBrowse>;
