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
import { browseDefaults } from "../../lib/browseDefaults";
import {
  reportFilterChips,
  clearReportSecondaryFilters,
} from "../../lib/reportFilters";
import type { BrowseRowsPage } from "../movements/useOperationBrowse";
import { isUnavailableError } from "../../lib/serviceFailure";
import { useBrowseState } from "../../lib/browseMemory";
import type { StockItem } from "../../lib/stockPresentation";
import {
  clearScopeField,
  scopeFilterFieldChips,
  type ScopeFilterField,
} from "../../lib/filterPresentation";
import { useReportGroups } from "../../composables/useReportGroups";
export interface ExpiryPageData extends BrowseRowsPage {
  item_count: number;
  batch_count: number;
  snapshot: string;
  query: ReportQuery;
  totals: ReportRow[];
  facets: Record<string, number>;
  analysis: Record<string, BrowseRowsPage>;
}
export function useExpiryBrowse(
  props: { initialQuery?: ReportQuery; routeQuery?: string },
  changed: (query: ReportQuery) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const query = ref(browseDefaults("expiry", "batches")),
    routeError = ref("");
  const groups = useReportGroups(query, services);
  const result = reactive({
    rows: [] as ReportRow[],
    total: 0,
    next: null as number | null,
    itemCount: 0,
    batchCount: 0,
    snapshot: "",
    totals: [] as ReportRow[],
    facets: {} as Record<string, number>,
    loading: false,
    error: "",
    stale: false,
    initialized: false,
  });
  const dimension = ref("category"),
    analyses = reactive<
      Record<string, BrowseRowsPage & { loading: boolean; error: string }>
    >({});
  let generation = 0,
    disposed = false,
    retryMore = false;
  const requests = new Set<AbortController>();
  const active = (current = generation) =>
    !disposed && current === generation && reference.user === account;
  function cancel() {
    generation++;
    for (const request of requests) request.abort();
    requests.clear();
  }
  function clearUnavailable() {
    cancel();
    Object.assign(result, {
      rows: [],
      total: 0,
      next: null,
      itemCount: 0,
      batchCount: 0,
      totals: [],
      facets: {},
      snapshot: "",
      loading: false,
      stale: false,
      initialized: false,
    });
    for (const key of Object.keys(analyses)) delete analyses[key];
  }
  function defaults() {
    return browseDefaults("expiry", "batches");
  }
  watch(
    () => JSON.stringify(props.initialQuery || props.routeQuery),
    () => {
      const decoded =
        props.initialQuery || props.routeQuery
          ? decodeReportQuery(props.initialQuery || props.routeQuery, "expiry")
          : { query: defaults(), error: "" };
      routeError.value =
        decoded.error ||
        (decoded.query.dataset !== "expiry" ? "此页面需要效期筛选条件" : "");
      if (
        ![
          "expiry_date",
          "identity",
          "stock_qty",
          "item_name",
          "item_code",
          "category",
          "stock_uom",
          "warehouse",
          "remaining_days",
          "batch_no",
        ].includes(decoded.query.sortBy)
      ) {
        decoded.query.sortBy = "expiry_date";
        decoded.query.sort = "asc";
      }
      if (JSON.stringify(query.value) !== JSON.stringify(decoded.query))
        query.value = decoded.query;
    },
    { immediate: true },
  );
  useBrowseState(
    "expiry",
    () => query.value,
    () => ({ dimension: dimension.value }),
    (value) => {
      dimension.value = String(value.dimension || "category");
    },
    () =>
      result.initialized &&
      !result.loading &&
      !result.stale &&
      Object.values(analyses).every((table) => !table.loading),
  );
  async function load(more = false, refresh = false) {
    if (
      routeError.value ||
      !active() ||
      (more && (result.loading || result.next === null))
    )
      return;
    if (!more) {
      cancel();
      for (const key of Object.keys(analyses)) delete analyses[key];
    }
    const current = generation,
      request = new AbortController();
    requests.add(request);
    result.loading = true;
    result.error = "";
    retryMore = more;
    if (!more) result.stale = result.rows.length > 0;
    try {
      const value = await services.call<ExpiryPageData>(
        "browse.expiry_page",
        {
          query: query.value,
          start: more ? result.next : 0,
          page_length: 30,
          ...(refresh ? { refresh: true } : {}),
        },
        request.signal,
      );
      if (!active(current)) return;
      result.rows = more
        ? [
            ...result.rows,
            ...value.rows.filter(
              (row) => !result.rows.some((old) => old.id === row.id),
            ),
          ]
        : value.rows;
      Object.assign(result, {
        total: value.matched_count,
        next: value.next_start,
        itemCount: value.item_count,
        batchCount: value.batch_count,
        snapshot: value.snapshot,
        totals: value.totals,
        facets: value.facets,
        stale: false,
        initialized: true,
      });
      if (!more)
        for (const [key, page] of Object.entries(value.analysis))
          analyses[key] = { ...page, loading: false, error: "" };
    } catch (reason) {
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        result.error =
          reason instanceof Error ? reason.message : "读取效期批次失败";
      }
    } finally {
      requests.delete(request);
      if (active(current)) result.loading = false;
    }
  }
  watch(
    () => [JSON.stringify(query.value), routeError.value],
    () => {
      if (routeError.value) {
        cancel();
        result.stale = true;
        result.loading = false;
      } else {
        changed(JSON.parse(JSON.stringify(query.value)));
        void load();
      }
    },
    { immediate: true },
  );
  async function moreAnalysis() {
    const key = dimension.value,
      value = analyses[key];
    if (
      !value ||
      value.loading ||
      value.next_start === null ||
      result.stale ||
      !active()
    )
      return;
    const current = generation,
      request = new AbortController();
    requests.add(request);
    value.loading = true;
    value.error = "";
    try {
      const page = await services.call<BrowseRowsPage>(
        "browse.expiry_analysis",
        {
          query: query.value,
          dimension: key,
          start: value.next_start,
          page_length: 30,
        },
        request.signal,
      );
      if (!active(current)) return;
      value.rows.push(
        ...page.rows.filter(
          (row) => !value.rows.some((old) => old.id === row.id),
        ),
      );
      value.matched_count = page.matched_count;
      value.next_start = page.next_start;
    } catch (reason) {
      if (active(current)) {
        if (isUnavailableError(reason)) clearUnavailable();
        value.error = reason instanceof Error ? reason.message : "读取分析失败";
        if (isUnavailableError(reason)) result.error = value.error;
      }
    } finally {
      requests.delete(request);
      if (active(current)) value.loading = false;
    }
  }
  const scope = computed({
    get: () => query.value.scope,
    set: (value) => (query.value.scope = value),
  });
  const chips = computed(() => reportFilterChips(query.value, reference));
  const analysis = computed(() => analyses[dimension.value]);
  const metrics = computed(() =>
    [
      ["available", "可用"],
      ["loaned", "借出"],
      ["damaged", "损坏"],
    ].map(([key, label]) => ({
      key: key!,
      label: label!,
      quantities: result.totals.map((row) => ({
        uom: String(row.stock_uom),
        qty: Number(row[key!] || 0),
      })),
    })),
  );
  const scopeChips = computed(() =>
    scopeFilterFieldChips(scope.value, reference),
  );
  function removeScope(field: ScopeFilterField | "period", value?: string) {
    if (value === undefined) {
      clearScopeField(scope.value, field);
      return;
    }
    const previous = scope.value[field];
    Object.assign(scope.value, {
      [field]: Array.isArray(previous)
        ? previous.filter((item) => item !== value)
        : "",
    });
  }
  function clearSecondary() {
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
      view: query.value.view,
    };
    clearReportSecondaryFilters(query.value, reference);
    Object.assign(query.value, newReportQuery("expiry"), routeScope);
    scope.value = newReportQuery("expiry").scope;
  }
  function reset() {
    const value = defaults();
    query.value = value;
    scope.value = value.scope;
    routeError.value = "";
  }
  function item(row: ReportRow): StockItem {
    return {
      code: String(row.item_code),
      name: String(row.item_name),
      category: String(row.category),
      uom: String(row.stock_uom),
      image: String(row.image || ""),
      tracksBatch: true,
      tracksExpiry: !!row.expiry_date,
      locations: [],
      available: Number(row.available),
      loaned: Number(row.loaned),
      damaged: Number(row.damaged),
    };
  }
  function batchQuery(row: ReportRow) {
    const value = JSON.parse(JSON.stringify(query.value)) as ReportQuery;
    value.restrictAllocations = true;
    value.allocationKeys = [String(row.id)];
    return value;
  }
  watch(
    () => reference.user,
    () => {
      if (reference.user !== account) {
        cancel();
        result.rows = [];
        result.totals = [];
        result.error = "账户已更改，请重新打开页面";
      }
    },
  );
  onBeforeUnmount(() => {
    disposed = true;
    cancel();
  });
  return {
    query,
    groups,
    scope,
    scopeChips,
    removeScope,
    routeError,
    result,
    reference,
    chips,
    metrics,
    dimension,
    analysis,
    load,
    retry: () => load(retryMore, true),
    moreAnalysis,
    clearSecondary,
    reset,
    item,
    batchQuery,
  };
}
export type ExpiryBrowse = ReturnType<typeof useExpiryBrowse>;
