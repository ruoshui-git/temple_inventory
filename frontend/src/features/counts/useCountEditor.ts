import { useLinkedActivity } from "../activities/useLinkedActivity";
import { savedDocumentExport } from "../documents/savedDocumentExport";
import { useUpdateBlocker } from "../../lib/updateSafety";
import { postingTime } from "../../lib/nativeTime";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { newReportQuery } from "../../lib/reportContract";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import {
  createNativeEditor,
  type NativeDocument,
  type NativeSaveResult,
} from "../documents/nativeEditor";
import {
  useAttachments,
  type AttachmentEntry,
} from "../attachments/useAttachments";
import {
  countKey,
  countIssues,
  countSummary,
  type CountRow,
  type CountValues,
} from "./countModel";
import { useMovementHistory } from "../movements/useMovementHistory";
export function useCountEditor(props: {
  name?: string;
  initialItems?: string[];
  warehouse?: string;
  recoveryId?: string;
}) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const loading = ref(false),
    busy = ref(false),
    savePending = ref(0),
    baselineBusy = ref(false),
    showError = ref(false),
    reviewOpen = ref(false),
    finished = ref(false),
    discardOpen = ref(false),
    reloadOpen = ref(false),
    removalAcknowledged = ref(true),
    removed = ref<CountRow[]>([]),
    baselineError = ref("");
  const names = reactive<Record<string, string>>({});
  const images = reactive<Record<string, string>>({});
  const candidates = ref<RecoverySnapshot[]>([]),
    action = ref<"delete" | "cancel" | "amend">(),
    leaveRequested = ref(false),
    supportingDirty = ref(false);
  let ready = false,
    disposed = false,
    suppressed = false,
    discarded = false,
    epoch = 0,
    timer: ReturnType<typeof setTimeout> | undefined,
    leaveResolve: ((value: boolean) => void) | undefined,
    allowLeave = false;
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* The open form remains usable. */
  }
  let amendmentRequestId = crypto.randomUUID();
  const recovery = createRecoveryStore(reference.site, account, storage);
  const active = () => !disposed && reference.user === account;
  const initial: CountValues = {
    posting_date: reference.siteDate,
    posting_time: reference.siteTime.split(" ")[1] || "00:00:00",
    ti_count_warehouses: props.warehouse
      ? [props.warehouse]
      : [...reference.physicalLeaves],
    ti_count_scope: props.initialItems?.length ? "Selected" : "Full Location",
    ti_count_items: props.initialItems || [],
    ti_baseline_timestamp: "",
    ti_baseline_fingerprint: "",
    ti_count_review: [],
    items: [],
    ti_activity: "",
    ti_recorder_name: "",
    ti_handler_name: "",
    ti_reviewer_name: "",
    ti_notes: "",
  };
  function decodeCount(doc: NativeDocument): NativeDocument {
    const selected =
      typeof doc.ti_count_items === "string"
        ? JSON.parse(doc.ti_count_items || "[]")
        : doc.ti_count_items;
    const warehouses =
      typeof doc.ti_count_warehouses === "string"
        ? JSON.parse(doc.ti_count_warehouses || "[]")
        : doc.ti_count_warehouses;
    return {
      ...doc,
      posting_time: postingTime(doc.posting_time),
      ti_count_items: Array.isArray(selected) ? selected : [],
      ti_count_review: Array.isArray(doc.ti_count_review)
        ? doc.ti_count_review.map((value) => {
            if (!value || typeof value !== "object") return value;
            const row = value as CountRow;
            if (row.review_state === "Reviewed") return row;
            return {
              ...row,
              review_state: "Unreviewed",
              actual_qty: null,
            };
          })
        : [],
      ti_count_warehouses: Array.isArray(warehouses) ? warehouses : [],
      ti_count_scope: doc.ti_count_scope,
    };
  }
  async function write(
    requestId: string,
    values: Record<string, unknown>,
    name?: string,
    version?: string,
  ): Promise<NativeSaveResult> {
    if (deskOrigin.value && name) {
      const result = await services.call<NativeDocument>(
        "native_api.save_document",
        {
          doctype: "Stock Reconciliation",
          name,
          version,
          data: values,
        },
      );
      return decodeCount(result);
    }
    const result = await services.call<NativeSaveResult>("counts.save_count", {
      request_id: requestId,
      data: { ...values, company: reference.company },
      ...(name ? { name, version } : {}),
    });
    return "no_adjustment" in result ? result : decodeCount(result);
  }
  const editor = createNativeEditor({
    site: reference.site,
    account,
    currentAccount: () => reference.user,
    tabId: crypto.randomUUID(),
    editorKind: "Stock Reconciliation",
    doctype: "Stock Reconciliation",
    recovery,
    values: initial,
    valid: () => valid.value && writable.value,
    services: {
      load: async (identity) =>
        decodeCount(
          await services.call<NativeDocument>("native_api.load_document", {
            ...identity,
          }),
        ),
      create: (_doctype, requestId, values) => write(requestId, values),
      save: (identity, version, values) =>
        write(editor.state.requestId, values, identity.name, version),
      submit: (identity, version) =>
        services.call<NativeDocument>("native_api.submit_document", {
          ...identity,
          version,
        }),
    },
  });
  const { state } = editor;
  const values = computed(() => state.values as unknown as CountValues);
  const activityLabel = useLinkedActivity(
    () => values.value.ti_activity,
    () => state.server,
  );
  const deskOrigin = computed(
    () => !!state.server && !state.server.ti_count_scope,
  );
  const opening = computed(() => state.server?.purpose === "Opening Stock");
  const writable = computed(
    () =>
      active() &&
      !loading.value &&
      !finished.value &&
      !opening.value &&
      !state.confirmationVersion &&
      !["conflict", "deleted", "forbidden", "submitted", "cancelled"].includes(
        state.status,
      ) &&
      (state.server
        ? state.server.editable === true
        : reference.capabilities["Stock Reconciliation"]?.create === true),
  );
  const rows = computed(() => values.value.ti_count_review || []);
  const historyTarget = ref<CountRow>();
  const historyQuery = computed(() => {
    const query = newReportQuery("movements");
    query.view = "lines";
    query.statuses = [1];
    query.batchNoExact = true;
    query.sortBy = "date";
    query.sort = "desc";
    if (historyTarget.value) {
      query.scope.item = historyTarget.value.item_code;
      query.scope.warehouses = [historyTarget.value.warehouse];
      query.batchNo = historyTarget.value.batch_no || "";
    }
    return query;
  });
  const history = useMovementHistory(historyQuery, {
    itemCode: () => historyTarget.value?.item_code || "",
    warehouse: () => historyTarget.value?.warehouse || "",
    batchNo: () => historyTarget.value?.batch_no || "",
    enabled: () => Boolean(historyTarget.value) && active(),
  });
  const summary = computed(() => countSummary(rows.value));
  const issues = computed(() => countIssues(rows.value, reference.units));
  const timestamp = computed(
    () => `${values.value.posting_date} ${values.value.posting_time}`,
  );
  const baselineScope = () =>
    JSON.stringify([
      values.value.ti_count_warehouses,
      values.value.ti_count_scope,
      values.value.ti_count_items,
    ]);
  const currentBaseline = computed(
    () =>
      !!values.value.ti_baseline_fingerprint &&
      values.value.ti_baseline_timestamp === timestamp.value &&
      state.values.baselineScope === baselineScope() &&
      removalAcknowledged.value,
  );
  const valid = computed(() =>
    deskOrigin.value
      ? values.value.items.length > 0 &&
        values.value.items.every(
          (row) => Number.isFinite(Number(row.qty)) && Number(row.qty) >= 0,
        )
      : currentBaseline.value &&
        rows.value.length > 0 &&
        summary.value.reviewed > 0 &&
        !issues.value.length &&
        !rows.value.some(
          (row) => row.needs_review && row.actual_qty !== null,
        ) &&
        !baselineBusy.value,
  );
  const canRefresh = computed(
    () =>
      active() &&
      !loading.value &&
      !finished.value &&
      !deskOrigin.value &&
      !opening.value &&
      !state.confirmationVersion &&
      !["deleted", "forbidden", "submitted", "cancelled"].includes(
        state.status,
      ) &&
      (state.server
        ? state.server.editable === true
        : reference.capabilities["Stock Reconciliation"]?.create === true),
  );
  const canSubmit = computed(() =>
    state.server
      ? ((state.server.permissions as Record<string, boolean> | undefined)
          ?.submit ??
        reference.capabilities["Stock Reconciliation"]?.submit === true)
      : reference.capabilities["Stock Reconciliation"]?.submit === true,
  );
  const hasDifferences = computed(
    () =>
      deskOrigin.value ||
      rows.value.some(
        (row) =>
          row.review_state !== "Unreviewed" &&
          row.actual_qty !== null &&
          row.actual_qty !== row.baseline_qty,
      ),
  );
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () => state.identity,
    writable: () => writable.value && !busy.value,
    changed() {
      if (!ready || suppressed || !active()) return;
      state.values.attachments = recoveryValues({
        attachments: files.files,
      }).attachments;
      state.pendingUploadReselection = files.incomplete.value;
      editor.edited();
    },
  });
  const dirty = computed(
    () =>
      (state.revision > 0 && state.revision > state.savedRevision) ||
      files.incomplete.value ||
      (state.noAdjustment && !finished.value),
  );
  function changed() {
    if (!ready || suppressed || !writable.value || discarded) return;
    editor.edited();
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 1000);
  }
  watch(
    () =>
      JSON.stringify([
        values.value.posting_date,
        values.value.posting_time,
        values.value.ti_count_warehouses,
        values.value.ti_count_scope,
        values.value.ti_count_items,
        values.value.ti_count_review,
        values.value.items,
        values.value.ti_activity,
        values.value.ti_recorder_name,
        values.value.ti_handler_name,
        values.value.ti_reviewer_name,
        values.value.ti_notes,
      ]),
    changed,
    { flush: "sync" },
  );
  async function loadNames() {
    const codes = [
      ...new Set([
        ...rows.value.map((row) => row.item_code),
        ...values.value.items.map((row) => String(row.item_code)),
      ]),
    ];
    if (!codes.length) return;
    const result = await services.call<
      { name: string; item_name: string; image: string }[]
    >("catalog.item_summaries", { item_codes: codes });
    if (!active()) return;
    for (const item of result) {
      names[item.name] = item.item_name;
      images[item.name] = item.image || "";
    }
  }
  async function load(discardDirty = false) {
    loading.value = true;
    ready = false;
    clearTimeout(timer);
    try {
      if (props.name || state.identity)
        await editor.load(
          {
            doctype: "Stock Reconciliation",
            name: props.name || state.identity!.name,
          },
          discardDirty,
        );
      if (!active()) return;
      state.values.baselineScope = baselineScope();
      await loadNames();
      if (state.identity) await files.fetch();
      const local = recovery.list();
      candidates.value = local.entries.filter(
        (entry) =>
          entry.editorKind === "Stock Reconciliation" &&
          (props.recoveryId
            ? entry.editorId === props.recoveryId
            : state.identity
              ? entry.identity?.name === state.identity.name
              : !entry.identity),
      );
      state.recoveryError = local.error;
    } catch (reason) {
      if (active())
        state.error = reason instanceof Error ? reason.message : "盘点读取失败";
    } finally {
      if (active()) {
        loading.value = false;
        ready = true;
      }
    }
    if (
      !state.identity &&
      values.value.ti_count_warehouses.length &&
      (values.value.ti_count_scope === "Full Location" ||
        values.value.ti_count_items.length)
    )
      await refresh();
  }
  async function refresh() {
    if (!canRefresh.value || baselineBusy.value) return;
    if (
      !values.value.ti_count_warehouses.length ||
      values.value.ti_count_warehouses.some(
        (name) => !reference.physicalLeaves.includes(name),
      )
    ) {
      baselineError.value = "盘点范围包含无权访问的实体末级位置";
      return;
    }
    if (
      values.value.ti_count_scope === "Selected" &&
      !values.value.ti_count_items.length
    ) {
      baselineError.value = "请选择盘点物品";
      return;
    }
    const current = ++epoch,
      sentScope = JSON.stringify([
        values.value.ti_count_warehouses,
        timestamp.value,
        values.value.ti_count_scope,
        values.value.ti_count_items,
      ]);
    baselineBusy.value = true;
    baselineError.value = "";
    try {
      if (state.status === "conflict" && state.identity) {
        const currentDocument = await services.call<NativeDocument>(
          "native_api.load_document",
          { ...state.identity },
        );
        if (
          currentDocument.version !== state.version ||
          currentDocument.docstatus !== 0 ||
          !currentDocument.editable
        )
          throw new Error(
            "原生记录版本或状态已更改；请复制输入后重新读取原记录",
          );
      }
      const result = await services.call<{
        rows: CountRow[];
        fingerprint: string;
        timestamp: string;
        warehouses: string[];
        removed_rows: CountRow[];
      }>("counts.count_baseline", {
        warehouses: values.value.ti_count_warehouses,
        timestamp: timestamp.value,
        scope: values.value.ti_count_scope,
        item_codes: values.value.ti_count_items,
        previous_rows: [
          ...rows.value,
          ...removed.value.filter(
            (old) => !rows.value.some((row) => countKey(row) === countKey(old)),
          ),
        ],
      });
      if (
        !active() ||
        current !== epoch ||
        sentScope !==
          JSON.stringify([
            values.value.ti_count_warehouses,
            timestamp.value,
            values.value.ti_count_scope,
            values.value.ti_count_items,
          ])
      )
        return;
      suppressed = true;
      // Retain every removed input for explicit review and copying; never turn it into zero.
      const activeKeys = new Set(result.rows.map(countKey));
      const removedByKey = new Map(
        [...removed.value, ...result.removed_rows]
          .filter((row) => !activeKeys.has(countKey(row)))
          .map((row) => [countKey(row), row]),
      );
      removed.value = [...removedByKey.values()];
      removalAcknowledged.value = !removed.value.length;
      values.value.ti_count_review = result.rows;
      for (const row of result.rows) {
        if (row.item_name) names[row.item_code] = row.item_name;
        if (row.image !== undefined) images[row.item_code] = row.image || "";
      }
      values.value.ti_baseline_timestamp = result.timestamp;
      values.value.ti_baseline_fingerprint = result.fingerprint;
      state.values.baselineScope = baselineScope();
      if (state.status === "conflict") {
        state.status = "local";
        state.error = "";
      }
      suppressed = false;
      editor.edited();
      await loadNames();
    } catch (reason) {
      if (active() && current === epoch)
        baselineError.value =
          reason instanceof Error
            ? reason.message
            : "账面基准读取失败，输入已保留";
    } finally {
      suppressed = false;
      if (active() && current === epoch) baselineBusy.value = false;
    }
  }
  async function chooseItems(codes: string[]) {
    values.value.ti_count_items = [
      ...new Set([...values.value.ti_count_items, ...codes]),
    ];
    await refresh();
  }
  function input(row: CountRow, value: string) {
    row.actual_qty = value === "" ? null : Number(value);
    row.review_state = value === "" ? "Unreviewed" : "Reviewed";
    row.needs_review = false;
  }
  function clearInput(row: CountRow) {
    row.actual_qty = null;
    row.review_state = "Unreviewed";
    row.reason = "";
    row.needs_review = false;
  }
  function rereview(row: CountRow) {
    row.needs_review = false;
    row.review_state = row.actual_qty === null ? "Unreviewed" : "Reviewed";
  }
  function openHistory(row: CountRow) {
    historyTarget.value = row;
  }
  function closeHistory() {
    historyTarget.value = undefined;
  }
  async function save(manual = false) {
    if (!active() || !writable.value || busy.value) return;
    if (manual) showError.value = true;
    clearTimeout(timer);
    if (!valid.value || supportingDirty.value) {
      editor.retain();
      return;
    }
    savePending.value++;
    try {
      await editor.save();
      if (state.status === "saved") {
        await files.finalize();
        if (files.incomplete.value) editor.retain();
        else if (state.revision !== state.savedRevision) await editor.save();
      }
    } finally {
      savePending.value--;
    }
  }
  async function review() {
    showError.value = true;
    if (!valid.value || !writable.value || supportingDirty.value) return;
    reviewOpen.value = true;
  }
  async function confirm() {
    if (!active() || busy.value) return;
    if (!state.confirmationVersion) {
      await save(true);
      if (state.status === "matching") {
        reviewOpen.value = false;
        return;
      }
      if (
        state.status !== "saved" ||
        files.incomplete.value ||
        files.busy.value
      ) {
        state.error ||= files.incomplete.value
          ? "请完成附件上传后确认"
          : "请先核对并保存盘点";
        return;
      }
    }
    if (!canSubmit.value) {
      state.error = "没有确认库存调整的权限，已保存的原生草稿可继续编辑";
      return;
    }
    busy.value = true;
    try {
      await editor.confirm();
      if (active() && state.status === "submitted") {
        reviewOpen.value = false;
        finished.value = true;
      }
    } catch (reason) {
      if (active())
        state.error = reason instanceof Error ? reason.message : "盘点确认失败";
    } finally {
      if (active()) busy.value = false;
    }
  }
  function finishMatching() {
    if (
      state.status !== "matching" ||
      !valid.value ||
      state.revision !== state.savedRevision ||
      state.identity ||
      files.files.length
    )
      return;
    finished.value = true;
    discarded = true;
    recovery.remove(state.editorId, state.revision);
  }
  async function recover(snapshot: RecoverySnapshot) {
    ready = false;
    await editor.inspectRecovery(snapshot);
    if (editor.applyRecovery()) {
      removed.value = (state.values.removedRows || []) as unknown as CountRow[];
      removalAcknowledged.value = !removed.value.length;
      files.restore(
        (state.values.attachments || []) as unknown as AttachmentEntry[],
      );
      await loadNames();
      candidates.value = [];
    }
    ready = true;
  }
  watch(
    removed,
    (value) => {
      if (!ready) return;
      state.values.removedRows = recoveryValues({ rows: value }).rows;
      editor.retain();
    },
    { deep: true },
  );
  async function lifecycle() {
    if (!action.value || !state.identity || !state.version || busy.value)
      return;
    busy.value = true;
    try {
      const selected = action.value,
        response = await services.call<NativeDocument>(
          `native_api.${selected}_document`,
          {
            ...state.identity,
            version: state.version,
            ...(selected === "amend" ? { request_id: amendmentRequestId } : {}),
          },
        );
      if (!active()) return;
      ready = false;
      if (selected === "delete") {
        if (state.noAdjustment) {
          state.identity = undefined;
          state.version = undefined;
          state.server = undefined;
          state.status = "matching";
        } else {
          state.status = "deleted";
          discard();
        }
      } else {
        state.identity = { doctype: response.doctype, name: response.name };
        state.server = decodeCount(response);
        state.version = response.version;
        state.values = structuredClone(recoveryValues(decodeCount(response)));
        state.status = response.docstatus === 0 ? "saved" : "cancelled";
        if (selected === "amend") {
          finished.value = false;
          state.requestId = amendmentRequestId;
          amendmentRequestId = crypto.randomUUID();
          state.revision = 0;
          state.savedRevision = 0;
          files.clear();
        }
      }
      action.value = undefined;
      ready = true;
    } catch (reason) {
      if (active())
        state.error = reason instanceof Error ? reason.message : "操作未完成";
    } finally {
      if (active()) busy.value = false;
    }
  }
  function discard() {
    discarded = true;
    clearTimeout(timer);
    recovery.remove(state.editorId, state.revision);
  }
  function requestLeave(): Promise<boolean> {
    if (allowLeave || (!dirty.value && !supportingDirty.value))
      return Promise.resolve(true);
    leaveRequested.value = true;
    return new Promise((resolve) => {
      leaveResolve = resolve;
    });
  }
  function finishLeave(choice: "stay" | "retain" | "discard") {
    if (choice === "discard") discard();
    else if (choice === "retain") editor.retain();
    allowLeave = choice !== "stay";
    leaveRequested.value = false;
    leaveResolve?.(allowLeave);
    leaveResolve = undefined;
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if ((dirty.value || supportingDirty.value) && !discarded) {
      editor.retain();
      event.preventDefault();
    }
  }
  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", beforeUnload);
  const sessionRestored = () => {
    void editor.revalidate();
  };
  if (typeof document !== "undefined")
    document.addEventListener("inventory-session-restored", sessionRestored);
  onBeforeUnmount(() => {
    clearTimeout(timer);
    if (dirty.value && !discarded) editor.retain();
    disposed = true;
    epoch++;
    editor.dispose();
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("inventory-session-restored", sessionRestored);
  });
  void load();
  useUpdateBlocker(
    () =>
      dirty.value ||
      supportingDirty.value ||
      busy.value ||
      state.status === "saving",
  );

  return {
    activityLabel,
    savedExportQuery: computed(() =>
      savedDocumentExport(state.server, state.status),
    ),
    state,
    editor,
    values,
    rows,
    names,
    images,
    reference,
    deskOrigin,
    opening,
    loading,
    busy,
    savePending,
    baselineBusy,
    baselineError,
    writable,
    valid,
    dirty,
    summary,
    issues,
    currentBaseline,
    historyTarget,
    history,
    canRefresh,
    canSubmit,
    hasDifferences,
    removed,
    removalAcknowledged,
    showError,
    reviewOpen,
    finished,
    discardOpen,
    reloadOpen,
    files,
    candidates,
    recovery,
    supportingDirty,
    action,
    leaveRequested,
    requestLeave,
    finishLeave,
    load,
    refresh,
    chooseItems,
    input,
    clearInput,
    rereview,
    openHistory,
    closeHistory,
    save,
    review,
    confirm,
    finishMatching,
    recover,
    lifecycle,
    discard,
    recoveryText: computed(() =>
      JSON.stringify(recoveryValues(state.values), null, 2),
    ),
    countKey,
  };
}
export type CountEditor = ReturnType<typeof useCountEditor>;
