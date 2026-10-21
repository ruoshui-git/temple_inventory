import {
  computed,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
  type ComputedRef,
} from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import type {
  LoanItemHistoryRow,
  MovementHistoryPage,
  ReportQuery,
} from "../../lib/reportContract";
import { isUnavailableError } from "../../lib/serviceFailure";

export type HistoryRow =
  MovementHistoryPage["rows"][number] | LoanItemHistoryRow;
export function useMovementHistory(
  query: ComputedRef<ReportQuery>,
  options: {
    itemCode?: () => string;
    warehouse?: () => string;
    batchNo?: () => string;
    enabled?: () => boolean;
    loanAllocations?: boolean;
  } = {},
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  let account = reference.user;
  const result = reactive({
    rows: [] as HistoryRow[],
    total: 0,
    next: null as number | null,
    historyComplete: true,
    loading: false,
    error: "",
    stale: false,
    initialized: false,
  });
  const sortBy = ref("date");
  const sortDirection = ref<"asc" | "desc">("desc");
  const sortableFields = options.loanAllocations
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
        "borrower",
        "borrowed",
        "outstanding",
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
        "stock_qty",
        "available_effect",
        "borrower",
      ];
  function setSort(field: string) {
    if (!sortableFields.includes(field)) return;
    if (sortBy.value === field)
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
    else {
      sortBy.value = field;
      sortDirection.value = "asc";
    }
  }
  let generation = 0,
    request: AbortController | undefined,
    disposed = false,
    failedMore = false;
  const active = (current: number) =>
    !disposed && generation === current && account === reference.user;
  function clear(error = "") {
    generation++;
    request?.abort();
    request = undefined;
    result.rows = [];
    result.total = 0;
    result.next = null;
    result.historyComplete = true;
    result.loading = false;
    result.stale = false;
    result.initialized = false;
    result.error = error;
    failedMore = false;
  }
  async function load(more = false) {
    if (!reference.user || (options.enabled && !options.enabled())) return;
    if (more && (result.loading || result.next === null || result.stale))
      return;
    if (!more) {
      generation++;
      request?.abort();
      result.stale = result.initialized;
      failedMore = false;
    }
    const current = generation,
      controller = new AbortController();
    request = controller;
    result.loading = true;
    result.error = "";
    const start = more ? result.next || 0 : 0;
    try {
      const historyQuery = JSON.parse(
        JSON.stringify(query.value),
      ) as ReportQuery;
      historyQuery.dataset = options.loanAllocations ? "loans" : "movements";
      historyQuery.view = options.loanAllocations ? "outcomes" : "lines";
      historyQuery.groupBy = [];
      historyQuery.sortBy = sortBy.value;
      historyQuery.sort = sortDirection.value;
      const args: Record<string, unknown> = {
        query: historyQuery,
        sort_by: sortBy.value,
        sort: sortDirection.value,
        start,
        page_length: 20,
      };
      if (options.itemCode?.()) args.item_code = options.itemCode();
      if (options.warehouse?.()) args.warehouse = options.warehouse();
      if (options.batchNo?.()) args.batch_no = options.batchNo();
      const page = await services.call<
        | MovementHistoryPage
        | {
            rows: LoanItemHistoryRow[];
            matched_count: number;
            next_start: number | null;
          }
      >(
        options.loanAllocations
          ? "browse.loan_item_history"
          : "browse.movement_history",
        args,
        controller.signal,
      );
      if (!active(current) || controller.signal.aborted) return;
      const previous = more ? result.rows : [];
      result.rows = [
        ...previous,
        ...page.rows.filter(
          (row) => !previous.some((old) => old.id === row.id),
        ),
      ];
      result.total = page.matched_count;
      result.next = page.next_start;
      result.historyComplete =
        "history_complete" in page ? page.history_complete !== false : true;
      failedMore = false;
      result.stale = false;
      result.initialized = true;
    } catch (reason) {
      if (!controller.signal.aborted && active(current)) {
        if (isUnavailableError(reason)) {
          clear(reason instanceof Error ? reason.message : "流动记录暂不可用");
        } else {
          failedMore = more;
          result.error =
            reason instanceof Error ? reason.message : "流动记录读取失败";
          result.stale = more ? false : result.initialized;
        }
      }
    } finally {
      if (active(current) && request === controller) result.loading = false;
    }
  }
  const signature = computed(() =>
    JSON.stringify([
      query.value,
      options.itemCode?.(),
      options.warehouse?.(),
      options.batchNo?.(),
      options.enabled ? options.enabled() : true,
      options.loanAllocations,
      sortBy.value,
      sortDirection.value,
    ]),
  );
  watch(
    [signature, () => reference.user],
    ([, currentUser]) => {
      if (currentUser !== account) {
        account = currentUser;
        clear();
      }
      if (options.enabled && !options.enabled()) {
        clear();
        return;
      }
      if (!currentUser) {
        clear();
        return;
      }
      void load();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
  });
  return {
    result,
    refresh: () => load(),
    loadMore: () => load(true),
    retry: () => load(failedMore),
    sortBy,
    sortDirection,
    setSort,
  };
}
