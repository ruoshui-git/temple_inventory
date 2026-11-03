import { computed, ref, watch } from "vue";
import {
  newReportQuery,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import { decodeReportQuery } from "../../lib/reportQuery";
import { browseDefaults, filtersAtDefaults } from "../../lib/browseDefaults";
import {
  clearScopeField,
  scopeFilterFieldChips,
  type ScopeFilterField,
} from "../../lib/filterPresentation";
import {
  reportFilterChips,
  clearReportSecondaryFilters,
} from "../../lib/reportFilters";
import { useReferenceData } from "../../services/contracts";
import { useReportController } from "../export/useReportController";
import type { InitialAllocation } from "../../lib/routeSelection";
import { useBrowseState } from "../../lib/browseMemory";
import { useBrowseSelection } from "../../composables/useBrowseSelection";
import {
  browseLayoutStorageKey,
  useBrowseViewMode,
} from "../../composables/useBrowseViewMode";

import { useResponsiveLayout } from "../../composables/useResponsiveLayout";
export function usePendingController(
  props: { initialQuery?: ReportQuery; routeQuery?: string },
  changed: (query: ReportQuery) => void,
) {
  const reference = useReferenceData(),
    account = reference.user,
    selection = useBrowseSelection(),
    responsive = useResponsiveLayout(),
    query = ref(browseDefaults("inventory", "locations")),
    routeError = ref(""),
    analysisOpen = ref(false),
    dimension = ref("category");
  // One field selection drives the table, cards and phone rows; the layout choice is per account.
  const layoutKey = computed(() =>
    reference.site && reference.user
      ? browseLayoutStorageKey(reference.site, reference.user, "pending")
      : undefined,
  );
  const browseViewMode = useBrowseViewMode(responsive.isMobile, {
    phone: "list",
    desktop: "table",
    phoneOptions: ["list", "card"],
    desktopOptions: ["table", "card"],
    storageKey: layoutKey,
  });
  function enter() {
    const decoded = decodeReportQuery(
      props.initialQuery || props.routeQuery,
      "inventory",
    );
    routeError.value =
      decoded.error ||
      (decoded.query.dataset !== "inventory" ||
      !["summary", "locations"].includes(decoded.query.view)
        ? "此页面需要当前损坏库存范围"
        : "");
    const value: ReportQuery = {
      ...decoded.query,
      view: "locations",
      damageOnly: true,
      includeZero: false,
    };
    if (!props.initialQuery && !props.routeQuery) {
      const defaults = browseDefaults("inventory", "locations");
      value.sortBy = defaults.sortBy;
      value.sort = defaults.sort;
    }
    if (JSON.stringify(query.value) !== JSON.stringify(value))
      query.value = value;
  }
  watch(() => JSON.stringify([props.initialQuery, props.routeQuery]), enter, {
    immediate: true,
  });
  const valid = computed(() => !routeError.value && reference.user === account);
  watch(
    () => reference.user,
    (user) => {
      if (user !== account) selection.exit();
    },
  );
  const report = useReportController(query, {
    personalViews: false,
    enabled: valid,
  });
  const analysisQuery = computed(() => ({
    ...query.value,
    groupBy: [dimension.value === "warehouse" ? "location" : dimension.value],
  }));
  const analysis = useReportController(analysisQuery, {
    personalViews: false,
    enabled: computed(() => valid.value && analysisOpen.value),
  });
  watch(
    () => report.mainTable.value?.rows.map((row) => String(row.id)) || [],
    (keys) => selection.retain(keys),
    { deep: true, immediate: true },
  );
  useBrowseState(
    "pending",
    () => query.value,
    () => ({
      dimension: dimension.value,
      analysisOpen: analysisOpen.value,
      ...browseViewMode.snapshot(),
    }),
    (value) => {
      dimension.value = String(value.dimension || "category");
      analysisOpen.value = value.analysisOpen === true;
      browseViewMode.restore(value);
    },
    () =>
      !report.result.loading &&
      !!report.mainTable.value?.initialized &&
      !analysis.result.loading,
  );
  watch(
    () => JSON.stringify(query.value),
    () => {
      if (!routeError.value) changed(JSON.parse(JSON.stringify(query.value)));
    },
    { immediate: true },
  );
  const scope = computed({
    get: () => query.value.scope,
    set: (value) => (query.value.scope = value),
  });
  const scopeChips = computed(() =>
    scopeFilterFieldChips(scope.value, reference),
  );
  // The damaged-stock scope itself (damageOnly, forced includeZero) has no control, so it has no chip.
  const chips = computed(() =>
    reportFilterChips(query.value, reference).filter(
      (chip) => !["damageOnly", "includeZero"].includes(chip.key),
    ),
  );
  const atDefaults = computed(() =>
    filtersAtDefaults(query.value, browseDefaults("inventory", "locations"), [
      "damageOnly",
      "includeZero",
    ]),
  );
  const metrics = computed(() => [
    {
      key: "damaged",
      label: "损坏待处理",
      tone: "danger",
      quantities: report.result.summary.map((row) => ({
        uom: String(row.stock_uom),
        qty: Number(row.damaged || 0),
      })),
    },
  ]);
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
  function clear() {
    clearReportSecondaryFilters(
      query.value,
      browseDefaults("inventory", "locations"),
    );
    scope.value = {
      ...newReportQuery("inventory").scope,
      period: scope.value.period,
    };
    query.value.damageOnly = true;
    query.value.includeZero = false;
  }
  function reset() {
    const value = browseDefaults("inventory", "locations");
    value.view = "locations";
    value.damageOnly = true;
    value.includeZero = false;
    query.value = value;
    routeError.value = "";
  }
  function canAct(kind: "Repair" | "Disposal", row: ReportRow) {
    return (
      valid.value &&
      !report.result.stale &&
      !report.result.loading &&
      reference.operations[kind] === true &&
      Number(row.damaged) > 0
    );
  }
  function allocation(row: ReportRow): InitialAllocation {
    return {
      item_code: String(row.item_code),
      warehouse: String(row.warehouse),
      batch_no: String(row.batch_no || ""),
      qty: Number(row.damaged),
    };
  }
  function rowQuery(row: ReportRow) {
    return {
      ...JSON.parse(JSON.stringify(query.value)),
      restrictAllocations: true,
      allocationKeys: [String(row.id)],
    } as ReportQuery;
  }
  return {
    selecting: selection.selecting,
    selected: selection.selected,
    enterSelection: selection.enter,
    exitSelection: selection.exit,
    setSelected: selection.set,
    reference,
    query,
    view: browseViewMode.view,
    viewOptions: browseViewMode.viewOptions,
    scope,
    scopeChips,
    chips,
    atDefaults,
    routeError,
    report,
    analysis,
    analysisOpen,
    dimension,
    metrics,
    removeScope,
    clear,
    reset,
    canAct,
    allocation,
    rowQuery,
  };
}
export type PendingController = ReturnType<typeof usePendingController>;
