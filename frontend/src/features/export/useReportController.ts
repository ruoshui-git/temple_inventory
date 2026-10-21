import { computed, onBeforeUnmount, reactive, ref, watch, type Ref } from "vue";
import {
  newReportQuery,
  groupsForView,
  reportDefinitions,
  sortableColumnsForView,
  type ReportDataset,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import {
  useInventoryServices,
  useReferenceData,
  type NamedView,
  type ReportPage,
} from "../../services/contracts";

import { decodeReportQuery, readReportQuery } from "../../lib/reportQuery";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { isUnavailableError } from "../../lib/serviceFailure";
import { useBrowseState } from "../../lib/browseMemory";
import { useReportGroups } from "../../composables/useReportGroups";
export { readReportQuery } from "../../lib/reportQuery";

import {
  reportFilterChips,
  clearReportSecondaryFilters,
} from "../../lib/reportFilters";

export interface ReportTableState {
  id: string;
  label: string;
  columns: string[];
  rows: ReportRow[];
  total: number;
  next: number | null;
  loading: boolean;
  error: string;
  initialized: boolean;
}
export function useReportController(
  query: Ref<ReportQuery>,
  options: { personalViews?: boolean; enabled?: Ref<boolean> } = {},
) {
  const services = useInventoryServices();
  const reference = useReferenceData(),
    account = reference.user;
  const groups = useReportGroups(query, services, false);
  const result = reactive({
    tables: [] as ReportTableState[],
    main: "",
    snapshot: "",
    summary: [] as ReportRow[],
    total: 0,
    loading: false,
    error: "",
    stale: false,
    period: "",
  });
  const namedViews = ref<NamedView[]>([]),
    viewError = ref(""),
    viewBusy = ref(false);
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    const selected = query.value.scope.categories;
    if (!selected.includes(oldName)) return;
    query.value.scope.categories = [
      ...new Set(
        selected.map((name) => (name === oldName ? category.name : name)),
      ),
    ];
  });
  let generation = 0;
  const requests = new Set<AbortController>();
  function cancel() {
    generation++;
    requests.forEach((request) => request.abort());
    requests.clear();
  }
  function clearUnavailable() {
    cancel();
    Object.assign(result, {
      tables: [],
      total: 0,
      summary: [],
      snapshot: "",
      stale: false,
      loading: false,
    });
  }
  function merge(table: ReportTableState, page: ReportPage, append = false) {
    table.columns = page.columns;
    table.rows = append
      ? [
          ...table.rows,
          ...page.rows.filter(
            (row) => !table.rows.some((old) => old.id === row.id),
          ),
        ]
      : page.rows;
    table.total = page.matched_count;
    table.next = page.next_start;
    table.initialized = true;
    table.error = "";
  }
  async function refresh(forceFresh = false) {
    cancel();
    if (options.enabled?.value === false) {
      result.tables = [];
      result.total = 0;
      result.loading = false;
      result.stale = false;
      result.error = "";
      result.summary = [];
      result.snapshot = "";
      return;
    }
    const requestGeneration = generation;
    const controller = new AbortController();
    requests.add(controller);
    result.loading = true;
    result.error = "";
    result.stale = result.tables.some((table) => table.rows.length > 0);
    try {
      const page = await services.report(
        query.value,
        { page_length: 30, ...(forceFresh ? { refresh: true } : {}) },
        controller.signal,
      );
      if (requestGeneration !== generation || reference.user !== account)
        return;
      result.main = page.table;
      result.tables = page.tables.map((table) => ({
        id: table.id,
        label: table.label,
        columns: [],
        rows: [],
        total: table.count,
        next: null,
        loading: false,
        error: "",
        initialized: false,
      }));
      const main = result.tables.find((table) => table.id === page.table)!;
      merge(main, page);
      if (query.value.groupBy.length)
        groups.seed(
          page.rows as unknown as import("../../services/contracts").GroupedReportRow[],
          page.next_start,
          page.leaf_columns || [],
        );
      result.total = page.matched_count;
      result.snapshot = page.snapshot;
      result.summary = page.summary;
      result.period = page.period.date_from
        ? `${page.period.date_from} 至 ${page.period.date_to}`
        : "全部时间";
      result.stale = false;
    } catch (error) {
      if (requestGeneration === generation && reference.user === account) {
        if (isUnavailableError(error)) clearUnavailable();
        result.error =
          error instanceof Error ? error.message : "读取导出数据失败";
      }
    } finally {
      requests.delete(controller);
      if (requestGeneration === generation) result.loading = false;
    }
  }
  async function loadTable(
    table: ReportTableState,
    more = false,
    forceFresh = false,
  ) {
    if (
      options.enabled?.value === false ||
      result.stale ||
      table.loading ||
      (!more && table.initialized && !forceFresh) ||
      (more && table.next === null)
    )
      return;
    const controller = new AbortController();
    const requestGeneration = generation;
    requests.add(controller);
    table.loading = true;
    table.error = "";
    try {
      const page = await services.report(
        query.value,
        {
          table: table.id,
          start: more ? table.next || 0 : 0,
          page_length: 30,
          ...(forceFresh ? { refresh: true } : {}),
        },
        controller.signal,
      );
      if (requestGeneration !== generation || reference.user !== account)
        return;
      merge(table, page, more);
    } catch (error) {
      if (requestGeneration === generation && reference.user === account) {
        if (isUnavailableError(error)) clearUnavailable();
        table.error = error instanceof Error ? error.message : "加载数据失败";
        if (isUnavailableError(error)) result.error = table.error;
      }
    } finally {
      requests.delete(controller);
      if (requestGeneration === generation) table.loading = false;
    }
  }
  watch(
    [() => JSON.stringify(query.value), () => options.enabled?.value],
    () => {
      void refresh();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    stopCategoryRename();
    cancel();
  });
  async function loadViews() {
    try {
      namedViews.value = await services.call<NamedView[]>(
        "preferences.named_views",
      );
    } catch (error) {
      viewError.value = error instanceof Error ? error.message : "读取视图失败";
    }
  }
  async function manageView(
    action: "save" | "rename" | "delete",
    title: string,
    selected?: NamedView,
  ) {
    viewBusy.value = true;
    viewError.value = "";
    try {
      if (action === "delete" && selected)
        await services.call("preferences.delete_named_view", {
          view_id: selected.id,
          revision: selected.revision,
        });
      else
        await services.call("preferences.save_named_view", {
          title,
          ...(action === "save"
            ? { query: query.value }
            : { view_id: selected?.id, revision: selected?.revision }),
        });
      await loadViews();
      return true;
    } catch (error) {
      viewError.value = error instanceof Error ? error.message : "视图操作失败";
      return false;
    } finally {
      viewBusy.value = false;
    }
  }
  if (options.personalViews !== false) void loadViews();
  return {
    result,
    mainTable: computed(() =>
      result.tables.find((table) => table.id === result.main),
    ),
    refresh,
    loadTable,
    namedViews,
    viewError,
    viewBusy,
    manageView,
    loadViews,
    groups,
  };
}

export function useExportWorkspaceController(
  props: { variant?: string; routeQuery?: string; initialQuery?: ReportQuery },
  changed: (query: ReportQuery) => void,
) {
  const reference = useReferenceData();
  const dataset = ref<ReportDataset>("inventory");
  const routeError = ref("");
  const states = reactive(
    Object.fromEntries(
      (Object.keys(reportDefinitions) as ReportDataset[]).map((id) => [
        id,
        newReportQuery(id),
      ]),
    ) as Record<ReportDataset, ReportQuery>,
  );
  const query = computed(() => states[dataset.value]);
  let restoring = false;
  function enter() {
    restoring = true;
    const decoded =
      props.initialQuery || props.routeQuery
        ? decodeReportQuery(props.initialQuery || props.routeQuery)
        : undefined;
    routeError.value = decoded?.error || "";
    const incoming = decoded?.query;
    if (incoming) {
      dataset.value = incoming.dataset;
      states[incoming.dataset] = readReportQuery(JSON.stringify(incoming));
    } else if (props.variant && props.variant in reportDefinitions)
      dataset.value = props.variant as ReportDataset;
    restoring = false;
  }
  watch(() => [props.variant, props.routeQuery, props.initialQuery], enter, {
    immediate: true,
  });
  const report = useReportController(query, {
    enabled: computed(() => !routeError.value),
  });
  const viewName = ref(""),
    selectedPreset = ref("");
  useBrowseState(
    "reports",
    () => query.value,
    () => ({ viewName: viewName.value, selectedPreset: selectedPreset.value }),
    (value) => {
      viewName.value = String(value.viewName || "");
      selectedPreset.value = String(value.selectedPreset || "");
    },
    () =>
      !report.result.loading &&
      report.result.tables.every((table) => !table.loading),
  );
  const definition = computed(() => reportDefinitions[dataset.value]);
  const panelContext = computed(() => `${dataset.value}/${query.value.view}`);
  const chips = computed(() => reportFilterChips(query.value, reference));
  const extraCount = computed(
    () => chips.value.filter((chip) => !chip.fixed).length,
  );
  const movementFilters = computed(
    () =>
      dataset.value === "movements" ||
      (dataset.value === "activities" && query.value.view === "records"),
  );
  watch(
    () => [query.value.dataset, query.value.view] as const,
    ([dataset, view]) => {
      if (view === "historical" && query.value.scope.period.key === "all")
        query.value.scope.period = { key: "this_month", from: "", to: "" };
      query.value.groupBy = query.value.groupBy.filter((field) =>
        groupsForView(dataset, view).includes(field),
      );
      if (!sortableColumnsForView(dataset, view).includes(query.value.sortBy))
        query.value.sortBy = "identity";
    },
  );
  watch([() => JSON.stringify(query.value), routeError], () => {
    if (!restoring && !routeError.value)
      changed(JSON.parse(JSON.stringify(query.value)));
  });
  const chosenView = computed(() =>
    report.namedViews.value.find((row) => row.id === selectedPreset.value),
  );
  function usePreset() {
    const selected = chosenView.value;
    if (!selected) return;
    dataset.value = selected.query.dataset;
    states[dataset.value] = readReportQuery(JSON.stringify(selected.query));
    viewName.value = selected.title;
  }
  async function save() {
    if (await report.manageView("save", viewName.value)) viewName.value = "";
  }
  function clear() {
    routeError.value = "";
    states[dataset.value] = newReportQuery(dataset.value);
  }
  return {
    ...report,
    routeError,
    dataset,
    query,
    definition,
    panelContext,
    chips,
    extraCount,
    movementFilters,
    reference,
    viewName,
    selectedPreset,
    usePreset,
    save,
    clear,
    rename: () => report.manageView("rename", viewName.value, chosenView.value),
    remove: async () => {
      if (await report.manageView("delete", "", chosenView.value))
        selectedPreset.value = "";
    },
    clearSecondary: () => clearReportSecondaryFilters(query.value, reference),
  };
}
