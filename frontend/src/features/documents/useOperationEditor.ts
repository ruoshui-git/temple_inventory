import { useLinkedActivity } from "../activities/useLinkedActivity";
import { savedDocumentExport } from "./savedDocumentExport";
import { useUpdateBlocker } from "../../lib/updateSafety";
import type { InitialAllocation } from "../../lib/routeSelection";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  createRecoveryStore,
  recoveryValues,
  type NativeIdentity,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";
import {
  presentCatalogItem,
  type CatalogItem,
} from "../../lib/catalogPresentation";
import type { StockItem } from "../../lib/stockPresentation";
import { createNativeEditor, type NativeDocument } from "./nativeEditor";
import {
  encodeOperation,
  decodeOperation,
  newOperation,
  operationLabels,
} from "./operationCodec";
import {
  operationIssues,
  lineStock,
  lineCapacity,
  provideOperationContext,
  type OperationDraft,
  type OperationKind,
} from "./operationModel";
import {
  useAttachments,
  type AttachmentEntry,
} from "../attachments/useAttachments";
export function useOperationEditor(props: {
  kind?: OperationKind;
  identity?: NativeIdentity;
  initialItems?: string[];
  initialAllocations?: InitialAllocation[];
  initialActivity?: string;
  initialWarehouse?: string;
  initialValues?: OperationDraft;
  initialReturnOutcome?: "returned" | "damaged";
  originalLoan?: string;
  recoveryId?: string;
}) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const stock = reactive<StockItem[]>([]),
    loading = ref(false),
    busy = ref(false),
    savePending = ref(0),
    showError = ref(false),
    reviewOpen = ref(false),
    action = ref<"delete" | "cancel" | "amend" | "duplicate">(),
    candidates = ref<RecoverySnapshot[]>([]);
  let ready = false,
    disposed = false,
    discarded = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const leaveRequested = ref(false),
    allowLeave = ref(false),
    supportingDirty = ref(false);
  let leaveResolve: ((value: boolean) => void) | undefined;
  function requestLeave(): Promise<boolean> {
    if (allowLeave.value || (!dirty.value && !supportingDirty.value))
      return Promise.resolve(true);
    leaveRequested.value = true;
    return new Promise((resolve) => {
      leaveResolve = resolve;
    });
  }
  function finishLeave(choice: "stay" | "retain" | "discard") {
    leaveRequested.value = false;
    if (choice === "discard") discard();
    if (choice === "retain") editor.retain();
    allowLeave.value = choice !== "stay";
    leaveResolve?.(allowLeave.value);
    leaveResolve = undefined;
  }
  const active = () => !disposed && reference.user === account;
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Keep the open editor usable. */
  }
  let amendmentRequestId = crypto.randomUUID();
  const recovery = createRecoveryStore(reference.site, account, storage);
  function remember(item: StockItem) {
    const existing = stock.find((row) => row.code === item.code);
    if (existing) Object.assign(existing, item);
    else stock.push(item);
  }
  function timestamp() {
    return draft.value.timeMode === "manual"
      ? `${draft.value.postingDate} ${draft.value.postingTime}`
      : undefined;
  }
  async function ensure(code: string) {
    const item = presentCatalogItem(
      await services.call<CatalogItem>("catalog.operation_item", {
        item_code: code,
        timestamp: timestamp(),
      }),
    );
    if (active()) remember(item);
    return item;
  }
  function issues(value: OperationDraft) {
    return operationIssues(value, {
      stock,
      units: reference.units,
      physicalLeaves: reference.physicalLeaves,
      leasedLeaves: reference.leasedLeaves,
      damagedLeaves: reference.damagedLeaves,
    });
  }
  async function prepare(value: Record<string, unknown>) {
    const sent = value as unknown as OperationDraft;
    if (sent.kind === "Receive")
      for (const line of sent.items) {
        if (!stock.find((row) => row.code === line.code)?.tracksBatch) continue;
        if (line.nativeBundle) continue;
        const result = await services.call<{ name: string }>(
          "catalog.receipt_batch",
          {
            item_code: line.code,
            batch_id: line.batch || `TI-B-${line.localId}`,
            manufacturing_date: line.manufacturingDate || null,
            expiry_date: line.expiry || null,
          },
        );
        line.batch = result.name;
      }
    return encodeOperation(sent, reference);
  }
  const editor = createNativeEditor({
    site: reference.site,
    account,
    currentAccount: () => reference.user,
    tabId: crypto.randomUUID(),
    editorKind: "Stock Entry",
    doctype: "Stock Entry",
    recovery,
    values: props.initialValues || {
      ...newOperation(props.kind || "Receive", reference),
      activity: props.initialActivity || "",
    },
    valid: (value) =>
      !issues(value as unknown as OperationDraft).length && writable.value,
    services: {
      load: async (identity) =>
        decodeOperation(
          await services.call<NativeDocument>(
            "native_api.load_document",
            identity as unknown as Record<string, unknown>,
          ),
        ),
      create: async (doctype, requestId, values) =>
        decodeOperation(
          await services.call<NativeDocument>("native_api.create_document", {
            doctype,
            request_id: requestId,
            data: await prepare(values),
          }),
        ),
      save: async (identity, version, values) =>
        decodeOperation(
          await services.call<NativeDocument>("native_api.save_document", {
            ...identity,
            version,
            data: await prepare(values),
          }),
        ),
      submit: async (identity, version) =>
        decodeOperation(
          await services.call<NativeDocument>("native_api.submit_document", {
            ...identity,
            version,
          }),
        ),
    },
  });
  const { state } = editor;
  const draft = computed(() => state.values as unknown as OperationDraft);
  const activityLabel = useLinkedActivity(
    () => draft.value.activity,
    () => state.server,
  );
  const knownKind = computed(() =>
    Object.hasOwn(operationLabels, draft.value.kind),
  );
  const writable = computed(
    () =>
      active() &&
      !loading.value &&
      knownKind.value &&
      !["conflict", "deleted", "forbidden", "submitted", "cancelled"].includes(
        state.status,
      ) &&
      !state.confirmationVersion &&
      (state.server
        ? state.server.editable === true
        : reference.capabilities["Stock Entry"]?.create === true),
  );
  const canSubmit = computed(() =>
    state.server
      ? ((state.server.permissions as Record<string, boolean> | undefined)
          ?.submit ?? reference.capabilities["Stock Entry"]?.submit === true)
      : reference.capabilities["Stock Entry"]?.submit === true,
  );
  const dirty = computed(
    () =>
      (state.revision > state.savedRevision && state.revision > 0) ||
      files.incomplete.value,
  );
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () => state.identity,
    writable: () => writable.value && !busy.value,
    changed() {
      if (!ready || !active()) return;
      state.values.attachments = recoveryValues({
        attachments: files.files,
      }).attachments;
      state.pendingUploadReselection = files.incomplete.value;
      editor.edited();
    },
  });
  provideOperationContext({
    stock,
    ensure,
    remember,
    timestamp,
    issues,
    lineStock: (line) => lineStock(line, stock),
    lineCapacity: (value, line) => lineCapacity(value, line, stock),
  });
  function fingerprint() {
    const value = draft.value;
    return JSON.stringify({
      ...encodeOperation(value, reference),
      items: value.items.map(
        ({ name: _name, outstanding: _outstanding, ...line }) => line,
      ),
    });
  }
  watch(
    fingerprint,
    () => {
      if (!ready || discarded || !writable.value) return;
      editor.edited();
      clearTimeout(timer);
      timer = setTimeout(() => void save(), 900);
    },
    { flush: "sync" },
  );
  async function hydrate() {
    for (const code of new Set(draft.value.items.map((line) => line.code))) {
      await ensure(code);
      if (!active()) return;
    }
    for (const line of draft.value.items) {
      const item = stock.find((row) => row.code === line.code),
        batch = item?.locations
          .flatMap((place) => place.batches || [])
          .find((row) => row.id === line.batch);
      if (!state.identity) continue;
      if (batch) {
        line.expiry = batch.expiry || "";
        line.manufacturingDate = batch.manufacturingDate || "";
      } else if (line.batch) {
        const metadata = await services.call<{
          item_code: string;
          expiry_date: string;
          manufacturing_date: string;
        }>("catalog.batch_details", { name: line.batch });
        if (metadata.item_code !== line.code)
          throw new Error("原生批次不属于此物品");
        line.expiry = metadata.expiry_date;
        line.manufacturingDate = metadata.manufacturing_date;
      }
    }
    if (state.identity) await files.fetch();
  }
  async function load(discardDirty = false) {
    loading.value = true;
    ready = false;
    clearTimeout(timer);
    try {
      if (props.identity || state.identity)
        await editor.load((props.identity || state.identity)!, discardDirty);
      if (!active()) return;
      await hydrate();
      if (!state.identity && props.initialWarehouse) {
        if (!reference.physicalLeaves.includes(props.initialWarehouse)) {
          state.status = "forbidden";
          throw new Error(
            "所选仓库不是当前可操作的实体叶子库位，请返回仓库重新选择",
          );
        }
        draft.value.preferredWarehouse = props.initialWarehouse;
      }
      if (!state.identity && props.initialItems?.length)
        for (const code of props.initialItems) {
          const item = await ensure(code);
          const id = crypto.randomUUID();
          const eligible = item.locations.filter((place) =>
            ["Repair", "Disposal"].includes(draft.value.kind)
              ? place.damaged > 0
              : place.available > 0,
          );
          const source =
            props.initialWarehouse ||
            (eligible.length === 1 ? eligible[0]!.location : "");
          const target =
            reference.physicalLeaves.length === 1 &&
            reference.physicalLeaves[0] !== source
              ? reference.physicalLeaves[0]!
              : "";
          draft.value.items.push({
            id,
            localId: id,
            code,
            qty: 1,
            entryQty: 1,
            uom: item.uom,
            entryUom: item.uom,
            conversionFactor: 1,
            location:
              draft.value.kind === "Receive"
                ? props.initialWarehouse ||
                  (reference.physicalLeaves.length === 1
                    ? reference.physicalLeaves[0]!
                    : "")
                : ["Transfer", "Repair"].includes(draft.value.kind)
                  ? target
                  : source,
            sourceLocation: draft.value.kind === "Receive" ? "" : source,
          });
        }
      if (!state.identity && props.initialAllocations?.length)
        for (const allocation of props.initialAllocations) {
          const item = await ensure(allocation.item_code),
            id = crypto.randomUUID();
          if (!active()) return;
          const batch = item.locations
            .find((place) => place.location === allocation.warehouse)
            ?.batches?.find((batch) => batch.id === allocation.batch_no);
          draft.value.items.push({
            id,
            localId: id,
            code: item.code,
            qty: allocation.qty,
            entryQty: allocation.qty,
            uom: item.uom,
            entryUom: item.uom,
            conversionFactor: 1,
            sourceLocation:
              draft.value.kind === "Receive" ? "" : allocation.warehouse,
            location: ["Transfer", "Repair"].includes(draft.value.kind)
              ? reference.physicalLeaves.length === 1
                ? reference.physicalLeaves[0]!
                : ""
              : allocation.warehouse,
            batch: allocation.batch_no,
            expiry: batch?.expiry,
            manufacturingDate: batch?.manufacturingDate,
          });
        }
      const local = recovery.list();
      candidates.value = local.entries.filter(
        (row) =>
          row.editorKind === "Stock Entry" &&
          (props.recoveryId
            ? row.editorId === props.recoveryId
            : state.identity
              ? row.identity?.doctype === state.identity.doctype &&
                row.identity.name === state.identity.name
              : !row.identity),
      );
      state.recoveryError = local.error;
      if (!state.identity && props.originalLoan)
        await appendLoan(props.originalLoan);
    } catch (reason) {
      state.error =
        reason instanceof Error ? reason.message : "操作资料读取失败";
    } finally {
      if (active()) {
        loading.value = false;
        ready = true;
        if (!state.identity && draft.value.items.length) editor.edited();
      }
    }
  }
  async function save(showIssues = false) {
    if (showIssues) showError.value = true;
    if (!active() || !writable.value || busy.value) return;
    clearTimeout(timer);
    if (issues(draft.value).length) {
      editor.retain();
      return;
    }
    savePending.value++;
    try {
      await editor.save();
      if (active() && state.status === "saved") {
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
    if (!writable.value || !canSubmit.value || busy.value) return;
    busy.value = true;
    try {
      await Promise.all(
        [...new Set(draft.value.items.map((line) => line.code))].map(ensure),
      );
      await refreshLoanBalances();
      if (draft.value.timeMode === "current") {
        const clock = await services.call<{ timestamp: string }>(
          "native_api.editor_clock",
        );
        draft.value.postingDate = clock.timestamp.split(" ")[0]!;
        draft.value.postingTime = clock.timestamp.split(" ")[1]!;
      }
      if (!issues(draft.value).length && active()) reviewOpen.value = true;
    } catch (reason) {
      if (active())
        state.error =
          reason instanceof Error ? reason.message : "复核失败，请重试";
    } finally {
      if (active()) busy.value = false;
    }
  }
  async function confirm() {
    if (!active() || busy.value) return;
    if (!canSubmit.value && !state.confirmationVersion) {
      state.error = "没有确认库存流动的权限，可继续保存草稿";
      return;
    }
    if (!state.confirmationVersion) {
      await save();
      if (
        state.status !== "saved" ||
        files.incomplete.value ||
        files.busy.value
      ) {
        state.error ||= files.incomplete.value
          ? "附件尚未上传完成，请重试或移除后确认"
          : "请先完成并保存全部输入";
        return;
      }
    }
    busy.value = true;
    try {
      await editor.confirm();
      if (active() && state.status === "submitted") {
        ready = false;
        Object.assign(draft.value, { status: "completed" });
        ready = true;
        reviewOpen.value = false;
      }
    } catch (reason) {
      if (active())
        state.error =
          reason instanceof Error ? reason.message : "确认失败，输入已保留";
    } finally {
      if (active()) busy.value = false;
    }
  }
  async function appendLoan(name: string) {
    if (!name || !active()) return;
    const loan = await services.call<NativeDocument>("native_api.loan_detail", {
      name,
    });
    if (loan.docstatus !== 1 || loan.kind !== "Loan")
      throw new Error("请选择已提交的原借出记录");
    if (
      draft.value.items.length &&
      draft.value.loanName &&
      (draft.value.borrower !== String(loan.ti_borrower || "") ||
        draft.value.activity !== String(loan.ti_activity || ""))
    )
      throw new Error("借用方或活动不同，请另建操作");
    const additions = [];
    for (const row of loan.items) {
      await ensure(String(row.item_code));
      const allocations = row.allocations as {
        batch_no: string;
        outstanding_qty: number;
      }[];
      for (const allocation of allocations || []) {
        if (
          !(allocation.outstanding_qty > 0) ||
          draft.value.items.some(
            (line) =>
              line.loanName === name &&
              line.originalLoanLine === row.name &&
              line.batch === allocation.batch_no,
          )
        )
          continue;
        const id = crypto.randomUUID(),
          factor = Number(row.conversion_factor),
          qty = allocation.outstanding_qty;
        additions.push({
          id,
          localId: id,
          code: String(row.item_code),
          qty,
          uom: String(row.stock_uom),
          entryQty: qty / factor,
          entryUom: String(row.uom),
          conversionFactor: factor,
          location: reference.physicalLeaves.includes(String(row.s_warehouse))
            ? String(row.s_warehouse)
            : "",
          sourceLocation: String(row.t_warehouse),
          loanedLocation: String(row.t_warehouse),
          loanName: name,
          originalLoanLine: String(row.name),
          batch: allocation.batch_no,
          returnOutcome:
            draft.value.kind === "Loss"
              ? ("lost" as const)
              : draft.value.kind === "Damage"
                ? ("damaged" as const)
                : props.initialReturnOutcome || ("returned" as const),
          outstanding: qty,
        });
      }
    }
    if (!active()) return;
    draft.value.borrower = String(loan.ti_borrower || "");
    draft.value.activity = String(loan.ti_activity || "");
    draft.value.loanName ||= name;
    draft.value.items.push(...additions);
  }
  function setLoanDestination(value: string) {
    if (!writable.value || draft.value.kind !== "Loan") return;
    draft.value.loanDestination = value;
    for (const line of draft.value.items) line.loanedLocation = value;
  }
  async function refreshLoanBalances() {
    for (const name of new Set(
      draft.value.items.flatMap((line) =>
        line.loanName ? [line.loanName] : [],
      ),
    )) {
      const loan = await services.call<NativeDocument>(
        "native_api.loan_detail",
        { name },
      );
      for (const line of draft.value.items.filter(
        (line) => line.loanName === name,
      )) {
        const row = loan.items.find(
          (row) => row.name === line.originalLoanLine,
        );
        const allocation = (
          row?.allocations as
            { batch_no: string; outstanding_qty: number }[] | undefined
        )?.find((row) => row.batch_no === (line.batch || ""));
        const saved =
          state.server?.items
            .filter(
              (row) =>
                row.loanName === name &&
                row.originalLoanLine === line.originalLoanLine &&
                row.batch === line.batch,
            )
            .reduce((total, row) => total + Number(row.qty), 0) || 0;
        line.outstanding =
          Number(allocation?.outstanding_qty || 0) +
          (state.server?.docstatus === 1 ? saved : 0);
      }
    }
  }
  async function recover(snapshot: RecoverySnapshot) {
    ready = false;
    await editor.inspectRecovery(snapshot);
    if (editor.applyRecovery()) {
      files.restore(
        (state.values.attachments || []) as unknown as AttachmentEntry[],
      );
      candidates.value = [];
      await hydrate();
      await refreshLoanBalances();
    }
    ready = true;
  }
  async function lifecycle() {
    if (
      !action.value ||
      !state.identity ||
      !state.version ||
      busy.value ||
      !active()
    )
      return;
    busy.value = true;
    state.error = "";
    try {
      const selected = action.value;
      const response = await services.call<NativeDocument>(
        `native_api.${selected}_document`,
        {
          ...state.identity,
          version: state.version,
          ...(["amend", "duplicate"].includes(selected)
            ? { request_id: amendmentRequestId }
            : {}),
        },
      );
      if (!active()) return;
      ready = false;
      if (selected === "delete") {
        state.status = "deleted";
        discard();
      } else {
        state.identity = { doctype: response.doctype, name: response.name };
        state.version = response.version;
        state.server = decodeOperation(response);
        state.values = structuredClone(recoveryValues(state.server));
        state.status = response.docstatus === 0 ? "saved" : "cancelled";
        if (selected === "amend" || selected === "duplicate") {
          state.requestId = amendmentRequestId;
          amendmentRequestId = crypto.randomUUID();
          state.revision = 0;
          state.savedRevision = 0;
          files.clear();
          await hydrate();
        }
      }
      action.value = undefined;
      ready = true;
    } catch (reason) {
      if (active())
        state.error =
          reason instanceof Error
            ? reason.message
            : "操作未完成，当前输入已保留";
    } finally {
      if (active()) busy.value = false;
    }
  }
  function discard() {
    discarded = true;
    clearTimeout(timer);
    recovery.remove(state.editorId, state.revision);
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
    ready = false;
    editor.dispose();
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("inventory-session-restored", sessionRestored);
  });
  void load()
    .then(() => refreshLoanBalances())
    .catch((reason) => {
      if (active())
        state.error =
          reason instanceof Error ? reason.message : "原借用读取失败";
    });
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
    leaveRequested,
    supportingDirty,
    requestLeave,
    finishLeave,
    state,
    editor,
    draft,
    stock,
    reference,
    loading,
    busy,
    savePending,
    writable,
    knownKind,
    canSubmit,
    dirty,
    files,
    issues: computed(() => issues(draft.value)),
    showError,
    reviewOpen,
    action,
    candidates,
    recover,
    save,
    review,
    confirm,
    load,
    appendLoan,
    setLoanDestination,
    refreshLoanBalances,
    lifecycle,
    discard,
    recovery,
    recoveryText: computed(() =>
      JSON.stringify(recoveryValues(state.values), null, 2),
    ),
  };
}
export type OperationEditor = ReturnType<typeof useOperationEditor>;
