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
  serialCountDifference,
  type CountRow,
  type CountValues,
} from "./countModel";
import { useMovementHistory } from "../movements/useMovementHistory";
import { showToast } from "../../services/toast";
export function useCountEditor(props: {
  name?: string;
  warehouse?: string;
  recoveryId?: string;
  initialDocument?: NativeDocument;
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
  const action = ref<"delete" | "cancel" | "amend">(),
    leaveRequested = ref(false),
    supportingDirty = ref(false);
  let ready = false,
    disposed = false,
    suppressed = false,
    discarded = false,
    baselineLoaded = false,
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
    ti_time_mode: "Current",
    baselineTimestamp: "",
    ti_count_review: [],
    items: [],
    ti_activity: "",
    ti_recorder_name: "",
    ti_handler_name: "",
    ti_reviewer_name: "",
    ti_notes: "",
  };
  function decodeCount(doc: NativeDocument): NativeDocument {
    const nativeItems = Array.isArray(doc.items)
      ? (doc.items as Record<string, unknown>[])
      : [];
    return {
      ...doc,
      posting_time: postingTime(doc.posting_time),
      ti_time_mode: doc.ti_time_mode || "Current",
      baselineTimestamp: "",
      ti_count_review: Array.isArray(doc.ti_count_review)
        ? doc.ti_count_review.map((value) => {
            if (!value || typeof value !== "object") return value;
            const row = value as CountRow;
            const native = nativeItems.find(
              (item) =>
                item.item_code === row.item_code &&
                item.warehouse === row.warehouse &&
                (item.batch_no || "") === (row.batch_no || ""),
            );
            const serialText = String(native?.serial_no || "");
            const actualSerials = native
              ? serialText
                  .split(/\r?\n/)
                  .map((serial) => serial.trim())
                  .filter(Boolean)
              : row.actual_serials;
            if (
              native &&
              (native.reconcile_all_serial_batch || native.serial_no)
            ) {
              row.is_serial = true;
              row.actual_serials = actualSerials || [];
            }
            if (row.review_state === "Reviewed") return row;
            return {
              ...row,
              review_state: "Unreviewed",
              actual_qty: null,
            };
          })
        : [],
    };
  }
  async function write(
    requestId: string,
    values: Record<string, unknown>,
    name?: string,
    version?: string,
  ): Promise<NativeSaveResult> {
    const { baselineTimestamp: _baselineTimestamp, ...countValues } = values;
    if (deskOrigin.value && name) {
      const result = await services.call<NativeDocument>(
        "native_api.save_document",
        {
          doctype: "Stock Reconciliation",
          name,
          version,
          data: countValues,
        },
      );
      return decodeCount(result);
    }
    const result = await services.call<NativeSaveResult>("counts.save_count", {
      request_id: requestId,
      data: { ...countValues, company: reference.company },
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
    recoveryDebounceMs: 500,
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
    () =>
      !!state.server &&
      !(state.server.ti_count_review as unknown[] | undefined)?.length,
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
      (state.server ? state.server.editable === true : true),
  );
  const attachmentsWritable = computed(
    () =>
      writable.value ||
      (active() &&
        !loading.value &&
        !busy.value &&
        state.server?.docstatus === 1),
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
  const currentBaseline = computed(
    () =>
      values.value.baselineTimestamp === timestamp.value &&
      removalAcknowledged.value,
  );
  const blockers = computed(() => {
    const reasons: string[] = [];
    if (baselineBusy.value) reasons.push("正在读取当前账面基准");
    else if (!currentBaseline.value) reasons.push("请先读取当前账面基准");
    if (!rows.value.length || !summary.value.reviewed)
      reasons.push("请至少核对一行盘点物品");
    if (rows.value.some((row) => row.needs_review && row.actual_qty !== null))
      reasons.push("有账面已变化的行尚未确认仍按当前实点");
    if (issues.value.length)
      reasons.push(`${issues.value.length} 行实点数量需要修正`);
    if (!removalAcknowledged.value)
      reasons.push("请先确认已移出账面范围的输入");
    if (files.incomplete.value || files.busy.value)
      reasons.push("请完成附件上传");
    if (supportingDirty.value) reasons.push("请先保存活动、人员或附件信息");
    return reasons;
  });
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
        !baselineBusy.value &&
        !files.incomplete.value &&
        !files.busy.value &&
        !supportingDirty.value,
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
      (state.server ? state.server.editable === true : true),
  );
  const canSubmit = computed(
    () => !state.server || state.server.docstatus === 0,
  );
  const hasDifferences = computed(
    () =>
      deskOrigin.value ||
      rows.value.some(
        (row) =>
          row.review_state !== "Unreviewed" &&
          row.actual_qty !== null &&
          (row.is_serial
            ? serialCountDifference(row).missing.length > 0 ||
              serialCountDifference(row).found.length > 0
            : row.actual_qty !== row.baseline_qty),
      ),
  );
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () => state.identity,
    writable: () => attachmentsWritable.value && !busy.value,
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
  // Server-assigned row names arrive after a save; they are not user edits.
  function fingerprint() {
    const { items, ti_count_review, ...rest } = values.value;
    const strip = (rows: Record<string, unknown>[] | undefined) =>
      (rows || []).map(({ name: _name, ...row }) => row);
    return JSON.stringify({
      ...rest,
      items: strip(items as Record<string, unknown>[] | undefined),
      ti_count_review: strip(
        ti_count_review as Record<string, unknown>[] | undefined,
      ),
    });
  }
  watch(fingerprint, changed);
  async function loadNames() {
    const codes = [
      ...new Set([
        ...rows.value.map((row) => row.item_code),
        ...values.value.items.map((row) => String(row.item_code)),
      ]),
    ];
    if (!codes.length) return;
    const displayRows = [
      ...values.value.items,
      ...values.value.ti_count_review,
    ];
    for (const row of displayRows) {
      const code = String(row.item_code || "");
      if (row.ti_display_item_name)
        names[code] = String(row.ti_display_item_name);
      else if (row.item_name) names[code] = String(row.item_name);
      if (row.ti_display_image !== undefined)
        images[code] = String(row.ti_display_image || "");
      else if (row.image !== undefined) images[code] = String(row.image || "");
    }
    const complete = codes.every((code) =>
      displayRows.some(
        (row) =>
          String(row.item_code || "") === code &&
          (row.ti_display_item_name !== undefined ||
            row.item_name !== undefined) &&
          (row.ti_display_image !== undefined || row.image !== undefined),
      ),
    );
    if (complete || baselineLoaded || deskOrigin.value) return;
    const missing = codes.filter(
      (code) =>
        !displayRows.some(
          (row) =>
            String(row.item_code || "") === code &&
            (row.ti_display_item_name !== undefined ||
              row.item_name !== undefined) &&
            (row.ti_display_image !== undefined || row.image !== undefined),
        ),
    );
    const result = await services.call<
      { name: string; item_name: string; image: string }[]
    >("catalog.item_summaries", { item_codes: missing });
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
          props.initialDocument,
        );
      if (!active()) return;
      if (state.identity?.doctype === "Stock Reconciliation") {
        const serialDetails = await services.call<
          (CountRow & {
            actual_serials: string[];
            missing_serials: string[];
            found_serials: string[];
          })[]
        >("counts.count_serial_details", { name: state.identity.name });
        if (!active()) return;
        const byKey = new Map(serialDetails.map((row) => [countKey(row), row]));
        for (const target of [state.values, state.server]) {
          if (!target) continue;
          const targetItems = (target.items || []) as Record<string, unknown>[];
          for (const item of targetItems) {
            const detail = byKey.get(countKey(item as unknown as CountRow));
            if (detail) item.recorded_count_serial_allocations = [detail];
          }
          const reviews = (target.ti_count_review || []) as CountRow[];
          for (const row of reviews) {
            const detail = byKey.get(countKey(row));
            if (detail) {
              Object.assign(row, {
                ...detail,
                is_serial: true,
                actual_qty: row.actual_qty ?? detail.actual_serials.length,
              });
            }
          }
        }
      }
      if (state.identity) await files.fetch();
      state.recoveryError = recovery.list().error;
    } catch (reason) {
      if (active())
        state.error = reason instanceof Error ? reason.message : "盘点读取失败";
    } finally {
      if (active()) {
        loading.value = false;
        ready = true;
      }
    }
    if (!deskOrigin.value) await refresh(false);
    await loadNames();
  }
  async function refresh(markEdited = true) {
    if (!canRefresh.value || baselineBusy.value) return;
    if (!reference.physicalLeaves.length) {
      baselineError.value = "没有可访问的实体末级位置";
      return;
    }
    const current = ++epoch,
      sentScope = JSON.stringify([timestamp.value]);
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
          throw new Error("记录版本或状态已更改；请复制输入后重新读取原记录");
      }
      const result = await services.call<{
        rows: CountRow[];
        timestamp: string;
        warehouses: string[];
        removed_rows: CountRow[];
      }>("counts.count_baseline", {
        timestamp: timestamp.value,
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
        sentScope !== JSON.stringify([timestamp.value])
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
      baselineLoaded = true;
      for (const row of result.rows) {
        row.ti_display_item_name = row.item_name || "";
        row.ti_display_image = row.image || "";
        if (row.item_name) names[row.item_code] = row.item_name;
        if (row.image !== undefined) images[row.item_code] = row.image || "";
      }
      values.value.baselineTimestamp = result.timestamp;
      if (state.status === "conflict") {
        state.status = "local";
        state.error = "";
      }
      suppressed = false;
      if (markEdited) editor.edited();
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
  async function chooseItems(
    selections: { code: string; warehouse: string }[],
  ) {
    const available = new Set(reference.physicalLeaves);
    const rowsToAdd = selections.filter(
      (selection) =>
        available.has(selection.warehouse) &&
        !rows.value.some(
          (row) =>
            row.item_code === selection.code &&
            row.warehouse === selection.warehouse,
        ),
    );
    if (rowsToAdd.length) {
      const items = await services.call<
        { name: string; item_name: string; image: string; stock_uom: string }[]
      >("catalog.item_summaries", {
        item_codes: [...new Set(rowsToAdd.map((row) => row.code))],
      });
      const byCode = new Map(items.map((item) => [item.name, item]));
      const addedRows: CountRow[] = rowsToAdd.flatMap((selection) => {
        const item = byCode.get(selection.code);
        return item
          ? [
              {
                item_code: item.name,
                item_name: item.item_name,
                image: item.image || "",
                ti_display_item_name: item.item_name,
                ti_display_image: item.image || "",
                warehouse: selection.warehouse,
                batch_no: null,
                stock_uom: item.stock_uom,
                baseline_qty: 0,
                actual_qty: null,
                review_state: "Unreviewed",
                reason: "",
              },
            ]
          : [];
      });
      values.value.ti_count_review.push(...addedRows);
    }
    await refresh();
  }
  async function markServerStaleRows(message: string) {
    const marker = "基准已变化的盘点行：";
    if (!message.includes(marker)) return false;
    state.confirmationVersion = undefined;
    if (values.value.ti_time_mode === "Current") {
      const clock = await services.call<{ timestamp: string }>(
        "native_api.editor_clock",
      );
      values.value.posting_date =
        clock.timestamp.split(" ")[0] || values.value.posting_date;
      values.value.posting_time =
        clock.timestamp.split(" ")[1] || values.value.posting_time;
    }
    await refresh(false);
    state.error = rows.value.some((row) => row.needs_review)
      ? blockers.value[0] || message
      : message;
    return true;
  }
  function input(row: CountRow, value: string) {
    row.actual_qty = value === "" ? null : Number(value);
    row.review_state = value === "" ? "Unreviewed" : "Reviewed";
    row.needs_review = false;
  }
  function setSerials(row: CountRow, serials: string[] | null) {
    const normalized = serials === null ? null : [...new Set(serials)].sort();
    row.actual_serials = normalized;
    row.actual_qty = normalized === null ? null : normalized.length;
    row.review_state = serials === null ? "Unreviewed" : "Reviewed";
    row.needs_review = false;
  }
  function clearInput(row: CountRow) {
    row.actual_qty = null;
    if (row.is_serial) row.actual_serials = null;
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
  async function save(manual = false, fromConfirm = false) {
    state.error = "";
    if (!active() || !writable.value || (busy.value && !fromConfirm)) return;
    if (manual) showError.value = true;
    clearTimeout(timer);
    if (!valid.value || supportingDirty.value) {
      // Autosave keeps incomplete input in recovery silently; only a manual save explains why.
      if (manual) state.error = blockers.value[0] || "请完成盘点核对后再保存";
      editor.retainIncomplete();
      return;
    }
    savePending.value++;
    try {
      await editor.save();
      if (state.error.includes("基准已变化的盘点行："))
        await markServerStaleRows(state.error);
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
    state.error = "";
    showError.value = true;
    try {
      if (values.value.ti_time_mode === "Current") {
        const clock = await services.call<{ timestamp: string }>(
          "native_api.editor_clock",
        );
        values.value.posting_date =
          clock.timestamp.split(" ")[0] || values.value.posting_date;
        values.value.posting_time =
          clock.timestamp.split(" ")[1] || values.value.posting_time;
      }
      if (!currentBaseline.value) await refresh(false);
      if (!valid.value || !writable.value || supportingDirty.value) {
        state.error = blockers.value[0] || "请完成盘点核对后再确认";
        return;
      }
      reviewOpen.value = true;
    } catch (reason) {
      state.error =
        reason instanceof Error ? reason.message : "盘点核对失败，请重试";
    }
  }
  async function confirm() {
    if (!active() || busy.value) return;
    busy.value = true;
    state.error = "";
    try {
      if (!state.confirmationVersion) {
        await save(true, true);
        if (state.status === "matching") {
          reviewOpen.value = false;
          return;
        }
        if (
          state.status !== "saved" ||
          files.incomplete.value ||
          files.busy.value
        ) {
          const message =
            state.error || blockers.value[0] || "请先保存盘点草稿";
          if (!(await markServerStaleRows(message))) state.error = message;
          return;
        }
      }
      if (!canSubmit.value) {
        state.error = "没有确认盘点调整的权限，已保存的草稿单据可继续编辑";
        return;
      }
      await editor.confirm();
      if (active() && state.status === "submitted") {
        state.error = "";
        reviewOpen.value = false;
        finished.value = true;
      }
    } catch (reason) {
      if (active()) {
        const message =
          reason instanceof Error ? reason.message : "盘点确认失败";
        if (!(await markServerStaleRows(message))) state.error = message;
      }
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
      showToast("已恢复上次在此浏览器暂存的内容");
    }
    ready = true;
    await refresh(false);
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
        state.values = JSON.parse(JSON.stringify(decodeCount(response)));
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
      editor.flushRecovery();
      event.preventDefault();
    }
  }
  const flushRecovery = () => editor.flushRecovery();
  if (typeof window !== "undefined")
    window.addEventListener("pagehide", flushRecovery);
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", flushRecovery);
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
    window.removeEventListener("pagehide", flushRecovery);
    document.removeEventListener("visibilitychange", flushRecovery);
    document.removeEventListener("inventory-session-restored", sessionRestored);
  });
  void load().then(async () => {
    if (!props.recoveryId) return;
    const entry = recovery.read(props.recoveryId);
    if (!entry || entry.editorKind !== "Stock Reconciliation") {
      state.recoveryError = "未找到这份浏览器暂存内容，请从草稿列表重新打开";
      return;
    }
    await recover(entry);
  });
  useUpdateBlocker(
    () =>
      dirty.value ||
      supportingDirty.value ||
      busy.value ||
      state.status === "saving",
  );

  return {
    existingDocument: computed(() => Boolean(props.name)),
    warehouseFilter: props.warehouse || "",
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
    blockers,
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
    setSerials,
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
