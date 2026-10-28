import {
  computed,
  onActivated,
  onBeforeUnmount,
  reactive,
  ref,
  watch,
} from "vue";
import {
  newReportQuery,
  type ReportQuery,
  type ReportRow,
} from "../../lib/reportContract";
import type { DatePeriod } from "../../lib/browseQuery";
import { decodeReportQuery } from "../../lib/reportQuery";
import {
  clearScopeField,
  scopeFilterFieldChips,
  type ScopeFilterField,
} from "../../lib/filterPresentation";
import { reportFilterChips } from "../../lib/reportFilters";
import { movementLabels } from "../../lib/presentationLabels";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { useReportController } from "../export/useReportController";
import { useBrowseState } from "../../lib/browseMemory";
import type { NativeActivity } from "./useActivityEditor";

interface ActivityDetail extends NativeActivity {
  summary: ReportRow;
  movement_totals: ReportRow[];
  loan_totals: ReportRow[];
  outstanding_line_count: number;
}
const presentActivity = (row: Record<string, unknown>) => ({
  id: String(row.name || row.activity || row.id),
  title: String(row.title || ""),
  typeId: String(row.activity_type || ""),
  start: String(row.start_date || ""),
  end: String(row.end_date || ""),
  status: row.status === "Archived" ? "archived" : "active",
  modified: String(row.modified || ""),
  created: String(row.creation || ""),
  owner: String(row.owner || ""),
  modifiedBy: String(row.modified_by || ""),
  description: String(row.description || ""),
  notes: String(row.notes || ""),
  has_outstanding: Boolean(row.has_outstanding),
  ...Object.fromEntries(
    Object.entries(row).filter(
      ([key]) => key.startsWith("count_") || key === "has_outstanding",
    ),
  ),
});

export function useActivitiesController(
  props: {
    mode: "list" | "detail" | "form";
    name?: string;
    routeQuery?: string;
  },
  navigate: (
    mode: "list" | "detail" | "form",
    name?: string,
    query?: ReportQuery,
  ) => void,
  openDocument: (doctype: string, name: string) => void,
  createMovement: (kind: string, activity: string) => void,
  changed: (query: ReportQuery) => void = () => undefined,
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const inherited = ref(newReportQuery("activities"));
  const scopeError = ref("");
  const state = reactive({
    search: "",
    status: "active" as ReportQuery["activityStatus"],
    typeId: "",
    period: { key: "all", from: "", to: "" } as DatePeriod,
    kind: "",
    presence: "all",
    outstanding: false,
    sort: "updated",
    sortDirection: "desc" as "asc" | "desc",
  });
  const detail = ref<ActivityDetail>(),
    loading = ref(false),
    error = ref(""),
    busy = ref(false),
    deleteOpen = ref(false);
  let generation = 0,
    disposed = false;
  let request: AbortController | undefined;
  watch(
    () => props.routeQuery,
    (value) => {
      if (!value) return;
      const decoded = decodeReportQuery(value, "activities");
      const query = decoded.query;
      inherited.value = query;
      scopeError.value =
        decoded.error ||
        (query.dataset !== "activities"
          ? "此链接不是活动范围，请恢复活动默认范围。"
          : "");
      Object.assign(state, {
        search: query.search,
        status: query.activityStatus,
        typeId: query.typeId,
        period: query.scope.period,
        kind: query.activityKind,
        presence: query.relatedPresence,
        outstanding: query.outstandingOnly,
        sort:
          query.sortBy === "title"
            ? "title"
            : query.sortBy === "start_date"
              ? "start"
              : "updated",
        sortDirection: query.sort,
      });
    },
    { immediate: true },
  );
  const report = computed(() => {
    const query = JSON.parse(JSON.stringify(inherited.value)) as ReportQuery;
    query.dataset = "activities";
    query.view = "metadata";
    query.sortBy =
      state.sort === "title"
        ? "title"
        : state.sort === "start"
          ? "start_date"
          : "modified";
    query.sort = state.sortDirection;
    query.search = state.search;
    query.activityStatus = state.status;
    query.typeId = state.typeId;
    query.scope.period = state.period;
    query.activityKind = state.kind;
    query.relatedPresence = state.presence;
    query.outstandingOnly = state.outstanding;
    return query;
  });
  const projection = useReportController(report, {
    personalViews: false,
    enabled: computed(() => props.mode === "list" && !scopeError.value),
  });
  useBrowseState(
    `activities/${props.mode}/${props.name || "list"}`,
    () => report.value,
    () => ({}),
    () => undefined,
    () =>
      !loading.value &&
      !projection.result.loading &&
      !projection.result.stale &&
      projection.result.tables.every((table) => !table.loading),
  );
  watch([() => JSON.stringify(report.value), scopeError], () => {
    if (props.mode !== "form" && !scopeError.value)
      changed(JSON.parse(JSON.stringify(report.value)));
  });
  async function loadDetail() {
    const current = ++generation;
    request?.abort();
    detail.value = undefined;
    error.value = "";
    deleteOpen.value = false;
    if (props.mode !== "detail" || !props.name) return;
    loading.value = true;
    request = new AbortController();
    try {
      const value = await services.call<ActivityDetail>(
        "activities.load_activity",
        { name: props.name },
        request.signal,
      );
      if (disposed || current !== generation) return;
      detail.value = value;
    } catch (reason) {
      if (!disposed && current === generation)
        error.value = reason instanceof Error ? reason.message : "活动读取失败";
    } finally {
      if (!disposed && current === generation) loading.value = false;
    }
  }
  watch(
    () => [props.mode, props.name],
    () => {
      void loadDetail();
    },
    { immediate: true },
  );
  let activated = false;
  onActivated(() => {
    if (activated) {
      // Returning from the separately cached editor must re-read its saved data.
      void loadDetail();
      if (props.mode === "list" && !scopeError.value) void projection.refresh();
    }
    activated = true;
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
  });
  const current = computed(() =>
    detail.value
      ? presentActivity(detail.value as unknown as Record<string, unknown>)
      : undefined,
  );
  const filtered = computed(
    () =>
      projection.mainTable.value?.rows.map((row) => presentActivity(row)) || [],
  );
  const activityMovementCounts = (id: string) => {
    const source =
      id === detail.value?.name
        ? detail.value.summary
        : projection.mainTable.value?.rows.find((row) => row.activity === id);
    return Object.keys(movementLabels).flatMap((kind) =>
      source && Number(source[`count_${kind}`])
        ? [{ kind, count: Number(source[`count_${kind}`]) }]
        : [],
    );
  };
  const activityTypeLabel = (id: string) =>
    reference.activityTypes.find((row) => row.value === id)?.label || id;
  const secondaryChips = computed(() => [
    ...(state.kind
      ? [
          {
            key: "kind",
            label: `流动类型：${movementLabels[state.kind] || state.kind}`,
          },
        ]
      : []),
    ...(state.presence !== "all"
      ? [
          {
            key: "presence",
            label: state.presence === "yes" ? "有关联记录" : "无关联记录",
          },
        ]
      : []),
    ...(state.outstanding
      ? [{ key: "outstanding", label: "有未归还借用" }]
      : []),
  ]);
  function clearSecondary() {
    state.kind = "";
    state.presence = "all";
    state.outstanding = false;
  }
  function clear() {
    clearSecondary();
    inherited.value = newReportQuery("activities");
    scopeError.value = "";
    state.status = "active";
    state.typeId = "";
    state.period = { key: "all", from: "", to: "" };
  }
  const inheritedChips = computed(() => [
    ...scopeFilterFieldChips(report.value.scope, reference)
      .filter(
        (chip) =>
          !(
            props.mode === "detail" &&
            ["activity", "kinds"].includes(chip.field || "")
          ),
      )
      .map((chip) => ({
        key: chip.key,
        field: chip.field,
        label:
          chip.field === "period"
            ? chip.label.replace(/^日期：/, "活动日期：")
            : chip.label,
        remove: () => {
          if (chip.field)
            clearScopeField(
              inherited.value.scope,
              chip.field as ScopeFilterField | "period",
            );
        },
      })),
    ...reportFilterChips(report.value, reference)
      .filter(
        (chip) => !["statuses", "activityStatus", "typeId"].includes(chip.key),
      )
      .map((chip) => ({
        key: chip.key,
        field: chip.field,
        label: chip.label,
        remove: () => {
          Object.assign(inherited.value, chip.reset);
        },
      })),
  ]);
  async function archive() {
    if (!detail.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await services.call("activities.save_activity", {
        name: detail.value.name,
        version: detail.value.modified,
        data: {
          status: detail.value.status === "Archived" ? "Active" : "Archived",
        },
      });
      await loadDetail();
      await projection.refresh();
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "活动更新失败";
    } finally {
      busy.value = false;
    }
  }
  async function remove() {
    if (!detail.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      await services.call("activities.delete_activity", {
        name: detail.value.name,
        version: detail.value.modified,
      });
      navigate("list");
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : "活动删除失败";
    } finally {
      busy.value = false;
    }
  }
  return {
    reference,
    scopeError,
    inheritedChips,
    state,
    current,
    detail,
    filtered,
    report,
    projection,
    loading,
    error,
    busy,
    deleteOpen,
    loadDetail,
    archive,
    remove,
    clear,
    resetScope: () => {
      inherited.value = newReportQuery("activities");
      Object.assign(state, {
        search: "",
        status: "active",
        typeId: "",
        period: { key: "all", from: "", to: "" },
        kind: "",
        presence: "all",
        outstanding: false,
        sort: "updated",
        sortDirection: "desc",
      });
      scopeError.value = "";
    },
    clearSecondary,
    secondaryChips,
    activityMovementCounts,
    activityTypeLabel,
    canWrite: computed(() => Boolean(detail.value)),
    canDelete: computed(() => Boolean(detail.value)),
    open: (id: string) => navigate("detail", id),
    saved: (id: string) => navigate("detail", id),
    edit: () => navigate("form", props.name),
    cancel: () => navigate(props.name ? "detail" : "list", props.name),
    newActivity: () => navigate("form"),
    linked: (name: string, doctype = "Stock Entry") =>
      openDocument(doctype, name),
    movement: (kind: string) => {
      if (detail.value?.status === "Active")
        createMovement(kind, detail.value.name);
    },
    removeSecondary: (key: string) => {
      if (key === "kind") state.kind = "";
      if (key === "presence") state.presence = "all";
      if (key === "outstanding") state.outstanding = false;
    },
    more: () => {
      const table = projection.mainTable.value;
      if (table) void projection.loadTable(table, true);
    },
  };
}
