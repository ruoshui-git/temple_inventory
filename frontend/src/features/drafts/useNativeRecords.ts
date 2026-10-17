import { computed, onBeforeUnmount, ref, watch } from "vue";
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
import {
  createRecoveryStore,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import {
  reportFilterChips,
  clearReportSecondaryFilters,
} from "../../lib/reportFilters";
import type { OperationGroup } from "../movements/useOperationBrowse";
import { isUnavailableError } from "../../lib/serviceFailure";
import { useBrowseState } from "../../lib/browseMemory";

export interface NativeRecord extends OperationGroup {
  time?: string;
  whole: NonNullable<OperationGroup["whole"]> & {
    version: string;
    editable: boolean;
    can_delete: boolean;
  };
}
interface NativeRecordPage {
  rows: NativeRecord[];
  matched_count: number;
  next_start: number | null;
  snapshot: string;
}
export function useNativeRecords(
  props: {
    mode: "drafts" | "counts";
    initialQuery?: ReportQuery;
    routeQuery?: string;
  },
  changed: (query: ReportQuery) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const query = ref(newReportQuery("movements")),
    routeError = ref("");
  const rows = ref<NativeRecord[]>([]),
    total = ref(0),
    next = ref<number | null>(null);
  const loading = ref(false),
    initialized = ref(false),
    stale = ref(false),
    error = ref("");
  const snapshot = ref(""),
    deleteTarget = ref<NativeRecord>(),
    deleteBusy = ref(false),
    deleteError = ref("");
  const localEntries = ref<RecoverySnapshot[]>([]),
    localError = ref(""),
    localTarget = ref<RecoverySnapshot>();
  let disposed = false,
    generation = 0,
    request: AbortController | undefined;
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* The open editor remains usable. */
  }
  const recovery = createRecoveryStore(reference.site, account, storage);
  const active = () => !disposed && reference.user === account;
  function readLocal() {
    if (!active()) return;
    const result = recovery.list();
    localEntries.value = result.entries;
    localError.value = result.error;
  }
  function enter() {
    const dataset = props.mode === "counts" ? "counts" : "movements";
    const decoded = decodeReportQuery(
      props.initialQuery || props.routeQuery,
      dataset,
    );
    routeError.value =
      decoded.error ||
      (decoded.query.dataset !== dataset ? "此页面的数据范围不匹配" : "");
    const value = { ...decoded.query, view: "records", grouping: "none" };
    if (props.mode === "drafts") value.statuses = [0];
    if (!props.initialQuery && !props.routeQuery) {
      value.sortBy = props.mode === "drafts" ? "modified" : "date";
      value.sort = "desc";
    }
    if (value.sortBy === "quantity")
      routeError.value = "记录包含不同单位，请选择日期或编号排序";
    if (JSON.stringify(value) !== JSON.stringify(query.value))
      query.value = value;
  }
  watch(
    () => JSON.stringify([props.mode, props.initialQuery, props.routeQuery]),
    enter,
    { immediate: true },
  );
  useBrowseState(
    `records/${props.mode}`,
    () => query.value,
    () => ({}),
    () => undefined,
    () => initialized.value && !loading.value && !stale.value,
  );
  async function load(more = false) {
    if (more && (loading.value || next.value === null || stale.value)) return;
    request?.abort();
    const current = ++generation;
    if (!active() || routeError.value) {
      rows.value = [];
      initialized.value = false;
      return;
    }
    const controller = new AbortController();
    request = controller;
    loading.value = true;
    error.value = "";
    if (!more) stale.value = rows.value.length > 0;
    try {
      const page = await services.call<NativeRecordPage>(
        props.mode === "drafts" ? "browse.native_drafts" : "browse.counts_page",
        {
          query: JSON.parse(JSON.stringify(query.value)),
          start: more ? next.value : 0,
          page_length: 30,
        },
        controller.signal,
      );
      if (!active() || current !== generation) return;
      rows.value = more
        ? [
            ...rows.value,
            ...page.rows.filter(
              (row) => !rows.value.some((old) => old.id === row.id),
            ),
          ]
        : page.rows;
      total.value = page.matched_count;
      next.value = page.next_start;
      snapshot.value = page.snapshot;
      initialized.value = true;
      stale.value = false;
    } catch (reason) {
      if (active() && current === generation) {
        if (isUnavailableError(reason)) {
          rows.value = [];
          total.value = 0;
          next.value = null;
          snapshot.value = "";
          initialized.value = false;
          stale.value = false;
        }
        error.value = reason instanceof Error ? reason.message : "记录读取失败";
      }
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  watch(
    () => [JSON.stringify(query.value), routeError.value],
    () => {
      void load();
      if (!routeError.value) changed(JSON.parse(JSON.stringify(query.value)));
    },
    { immediate: true },
  );
  watch(
    () => reference.user,
    () => {
      if (!active()) {
        request?.abort();
        generation++;
        rows.value = [];
        localEntries.value = [];
        deleteTarget.value = undefined;
        localTarget.value = undefined;
      }
    },
  );
  const scope = computed({
    get: () => query.value.scope,
    set: (value) => (query.value.scope = value),
  });
  const extraChips = computed(() =>
    reportFilterChips(query.value, reference).map((chip) =>
      props.mode === "drafts" && chip.key === "statuses"
        ? { ...chip, label: "原生草稿", reset: {}, fixed: true }
        : chip,
    ),
  );
  function clear() {
    clearReportSecondaryFilters(query.value, reference);
    query.value.scope = newReportQuery(query.value.dataset).scope;
  }
  function canDelete(row: NativeRecord) {
    return active() && !loading.value && !stale.value && row.whole.can_delete;
  }
  async function removeNative() {
    const selected = deleteTarget.value;
    if (!selected || !canDelete(selected) || deleteBusy.value) return;
    deleteBusy.value = true;
    deleteError.value = "";
    try {
      await services.call("native_api.delete_document", {
        doctype: selected.doctype,
        name: selected.document,
        version: selected.whole.version,
      });
      if (!active()) return;
      deleteTarget.value = undefined;
      await load();
    } catch (reason) {
      if (active())
        deleteError.value =
          reason instanceof Error ? reason.message : "草稿删除失败";
    } finally {
      if (active()) deleteBusy.value = false;
    }
  }
  function removeLocal() {
    const selected = localTarget.value;
    if (!selected || !active()) return;
    if (!recovery.remove(selected.editorId, selected.revision)) {
      localError.value = "此输入已在另一窗口更新或无法删除；请重新核对";
      return;
    }
    localTarget.value = undefined;
    readLocal();
  }
  const localSupported = (entry: RecoverySnapshot) =>
    [
      "Stock Entry",
      "Stock Reconciliation",
      "Item",
      "Inventory Activity",
      "Warehouse",
    ].includes(entry.editorKind);
  readLocal();
  if (typeof window !== "undefined")
    window.addEventListener("storage", readLocal);
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
    if (typeof window !== "undefined")
      window.removeEventListener("storage", readLocal);
  });
  return {
    reference,
    query,
    scope,
    routeError,
    rows,
    total,
    next,
    loading,
    initialized,
    stale,
    error,
    snapshot,
    extraChips,
    clear,
    load,
    deleteTarget,
    deleteBusy,
    deleteError,
    canDelete,
    removeNative,
    localEntries,
    localError,
    localTarget,
    removeLocal,
    readLocal,
    localSupported,
  };
}
export type NativeRecordsController = ReturnType<typeof useNativeRecords>;
