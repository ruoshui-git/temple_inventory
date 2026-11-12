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
} from "./operationCodec";
import { operationLabels } from "../../lib/presentationLabels";
import {
  operationIssues,
  lineStock,
  lineCapacity,
  provideOperationContext,
  type AllocationLine,
  type OperationDraft,
  type OperationKind,
} from "./operationModel";
import {
  useAttachments,
  type AttachmentEntry,
} from "../attachments/useAttachments";
import { showToast } from "../../services/toast";
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
    reviewChecking = ref(false),
    savePending = ref(0),
    showError = ref(false),
    reviewOpen = ref(false),
    action = ref<"delete" | "cancel" | "amend" | "duplicate">();
  const hydrating = ref(false);
  const itemCache = new Map<string, StockItem>();
  const loanDetails = new Map<string, Promise<NativeDocument>>();
  const generatedBatches = new Map<string, { key: string; name: string }>();
  // Explicit batches the server already resolved for this exact line content.
  const confirmedBatches = new Map<string, string>();
  const batchRequestIds = new Map<string, string>();
  let ready = false,
    disposed = false,
    discarded = false,
    loadController: AbortController | undefined,
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
    itemCache.set(cacheKey(item.code), item);
    const existing = stock.find((row) => row.code === item.code);
    if (existing) Object.assign(existing, item);
    else stock.push(item);
  }
  function trackingDisplay(item: StockItem) {
    return {
      displayTracksBatch: item.tracksBatch,
      displayTracksExpiry: item.tracksExpiry,
      displayTracksSerial: Boolean(
        (item as StockItem & { tracksSerial?: boolean }).tracksSerial,
      ),
    };
  }
  function timestamp() {
    return draft.value.timeMode === "manual"
      ? `${draft.value.postingDate} ${draft.value.postingTime}`
      : undefined;
  }
  function cacheKey(code: string) {
    return `${code}\u0000${timestamp() || "now"}`;
  }
  async function ensure(code: string) {
    if (!active()) throw new DOMException("Account changed", "AbortError");
    const cached = itemCache.get(cacheKey(code));
    if (cached) return cached;
    const items = await ensureMany([code]);
    const item = items.get(code);
    if (!item) throw new Error("物品不存在或无权访问");
    return item;
  }
  async function ensureMany(codes: string[]) {
    if (!active()) throw new DOMException("Account changed", "AbortError");
    const unique = [...new Set(codes.filter(Boolean))];
    const missing = unique.filter((code) => !itemCache.has(cacheKey(code)));
    if (missing.length) {
      const result = await services.call<{
        items: CatalogItem[];
        errors: { item_code: string; error: string }[];
      }>("catalog.operation_items", {
        item_codes: missing,
        timestamp: timestamp(),
      });
      if (!active()) throw new DOMException("Account changed", "AbortError");
      for (const entry of result.items) {
        const item = Object.assign(presentCatalogItem(entry), {
          tracksSerial: Boolean(entry.has_serial_no),
          serialNoSeries: String(entry.serial_no_series || ""),
        });
        itemCache.set(cacheKey(entry.item_code), item);
        if (active()) remember(item);
      }
    }
    return new Map(
      unique.flatMap((code) => {
        const item = itemCache.get(cacheKey(code));
        return item ? [[code, item] as const] : [];
      }),
    );
  }
  async function availableSerials(
    itemCode: string,
    warehouse: string,
    search: string,
    start: number,
  ) {
    if (!active()) throw new DOMException("Account changed", "AbortError");
    const result = await services.call<{
      serials: { name: string }[];
      next: number | null;
    }>("catalog.available_serials", {
      item_code: itemCode,
      warehouse,
      search,
      start,
      limit: 50,
    });
    if (!active()) throw new DOMException("Account changed", "AbortError");
    return {
      serials: result.serials.map((row) => row.name),
      next: result.next,
    };
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
    if (sent.kind === "Receive") {
      const keyFor = (line: AllocationLine) =>
        JSON.stringify([
          line.code,
          line.manufacturingDate || "",
          line.expiry || "",
        ]);
      for (const line of sent.items) {
        const generated = generatedBatches.get(line.localId);
        if (!generated) continue;
        if (line.batch === generated.name && keyFor(line) !== generated.key) {
          // A sole holder keeps its request identity so the server can re-date
          // its own batch; a shared batch must stay as it is for the others.
          const shared = sent.items.some(
            (other) =>
              other !== line &&
              generatedBatches.get(other.localId)?.name === generated.name,
          );
          line.batch = "";
          generatedBatches.delete(line.localId);
          if (shared) batchRequestIds.set(line.localId, crypto.randomUUID());
        } else if (line.batch !== generated.name) {
          generatedBatches.delete(line.localId);
        }
      }
      const eligible = sent.items.filter(
        (line) =>
          stock.find((row) => row.code === line.code)?.tracksBatch &&
          !line.nativeBundle,
      );
      const groups = new Map<string, AllocationLine[]>();
      for (const line of eligible) {
        if (line.batch) continue;
        const key = keyFor(line);
        const group = groups.get(key) || [];
        group.push(line);
        groups.set(key, group);
      }
      const rows: {
        item_code: string;
        batch_id: string;
        local_id: string;
        row_name?: string;
        manufacturing_date: string | null;
        expiry_date: string | null;
      }[] = [];
      const requestLines = new Map<string, AllocationLine>();
      for (const [key, lines] of groups) {
        const existing = eligible
          .map((line) => generatedBatches.get(line.localId))
          .find((entry) => entry?.key === key);
        if (existing) {
          for (const line of lines) {
            line.batch = existing.name;
            generatedBatches.set(line.localId, existing);
          }
        } else {
          const leader = lines[0]!;
          const localId = batchRequestIds.get(leader.localId) || leader.localId;
          rows.push({
            item_code: leader.code,
            batch_id: "",
            local_id: localId,
            row_name: leader.name,
            manufacturing_date: leader.manufacturingDate || null,
            expiry_date: leader.expiry || null,
          });
          requestLines.set(localId, leader);
        }
      }
      const confirmation = (line: AllocationLine) =>
        JSON.stringify([line.batch, keyFor(line)]);
      for (const line of eligible) {
        if (!line.batch || generatedBatches.has(line.localId)) continue;
        if (confirmedBatches.get(line.localId) === confirmation(line)) continue;
        const localId = batchRequestIds.get(line.localId) || line.localId;
        rows.push({
          item_code: line.code,
          batch_id: line.batch,
          local_id: localId,
          row_name: line.name,
          manufacturing_date: line.manufacturingDate || null,
          expiry_date: line.expiry || null,
        });
        requestLines.set(localId, line);
      }
      if (rows.length) {
        const result = await services.call<{
          batches: { local_id: string; name: string }[];
        }>("catalog.receipt_batches", { rows });
        const names = new Map(
          result.batches.map((row) => [row.local_id, row.name]),
        );
        for (const row of rows) {
          const line = requestLines.get(row.local_id);
          if (line) {
            const name = names.get(row.local_id) || line.batch;
            line.batch = name;
            if (row.batch_id)
              confirmedBatches.set(line.localId, confirmation(line));
            if (!row.batch_id && name) {
              const generated = { key: keyFor(line), name };
              for (const grouped of groups.get(generated.key) || []) {
                grouped.batch = name;
                generatedBatches.set(grouped.localId, generated);
              }
            }
          }
        }
      }
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
      // A Return's activity comes from its settled loans, so it never starts from a route value.
      activity: props.kind === "Return" ? "" : props.initialActivity || "",
    },
    valid: (value) =>
      !issues(value as unknown as OperationDraft).length && writable.value,
    services: {
      load: async (identity, signal) =>
        decodeOperation(
          await services.call<NativeDocument>(
            "native_api.load_document",
            identity as unknown as Record<string, unknown>,
            signal,
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
  const canSubmit = computed(
    () => !state.server || state.server.docstatus === 0,
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
    writable: () => attachmentsWritable.value && !busy.value,
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
    ensureMany,
    availableSerials,
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
        ({
          name: _name,
          outstanding: _outstanding,
          displayName: _displayName,
          displayImage: _displayImage,
          displayTracksBatch: _displayTracksBatch,
          displayTracksSerial: _displayTracksSerial,
          displayTracksExpiry: _displayTracksExpiry,
          ...line
        }) => line,
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
    if (!state.identity || state.server?.editable === true) {
      const codes = [...new Set(draft.value.items.map((line) => line.code))];
      const loaded = await ensureMany(codes);
      if (codes.some((code) => !loaded.has(code)))
        throw new Error("部分物品不存在或无权访问，请检查草稿明细");
      if (!active()) return;
    }
    const batchNames = state.identity
      ? [
          ...new Set(
            draft.value.items
              .filter((line) => line.batch && !line.batchAllocations?.length)
              .map((line) => line.batch),
          ),
        ]
      : [];
    const batchMetadata = batchNames.length
      ? await services.call<
          Record<
            string,
            {
              item_code: string;
              expiry_date: string;
              manufacturing_date: string;
            }
          >
        >("catalog.batch_metadata_many", { names: batchNames })
      : {};
    for (const line of draft.value.items) {
      const item = stock.find((row) => row.code === line.code),
        batch = item?.locations
          .flatMap((place) => place.batches || [])
          .find((row) => row.id === line.batch);
      if (!state.identity) continue;
      if (batch) {
        line.expiry = batch.expiry || "";
        line.manufacturingDate = batch.manufacturingDate || "";
      } else if (line.batchAllocations?.length) {
        const recorded = line.batchAllocations.find(
          (allocation) => allocation.batch === line.batch,
        );
        if (recorded) {
          line.expiry = recorded.expiry || "";
          line.manufacturingDate = recorded.manufacturingDate || "";
        }
      } else if (line.batch && !line.batchAllocations?.length) {
        const metadata = batchMetadata[line.batch];
        if (!metadata) throw new Error("批次资料无法读取");
        if (metadata.item_code !== line.code)
          throw new Error("批次不属于此物品");
        line.expiry = metadata.expiry_date;
        line.manufacturingDate = metadata.manufacturing_date;
      }
    }
    if (state.identity) await files.fetch();
  }
  let initialItemsApplied = false;
  async function load(discardDirty = false) {
    if (loading.value) return;
    loadController?.abort();
    loadController = new AbortController();
    const signal = loadController.signal;
    loanDetails.clear();
    state.error = "";
    loading.value = true;
    hydrating.value = true;
    ready = false;
    clearTimeout(timer);
    try {
      if (props.identity || state.identity)
        await editor.load(
          (props.identity || state.identity)!,
          discardDirty,
          undefined,
          signal,
        );
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
      if (
        !state.identity &&
        !initialItemsApplied &&
        props.initialItems?.length &&
        draft.value.kind !== "Return"
      ) {
        const additions: AllocationLine[] = [];
        const codes = [...new Set(props.initialItems)];
        const loaded = await ensureMany(codes);
        for (const code of codes) {
          const item = loaded.get(code);
          if (!item) continue;
          const id = crypto.randomUUID();
          const eligible = item.locations.filter((place) =>
            ["Repair", "Disposal"].includes(draft.value.kind)
              ? place.damaged > 0
              : place.available > 0,
          );
          const source =
            props.initialWarehouse ||
            (eligible.length === 1 ? eligible[0]!.location : "");
          const target = "";
          additions.push({
            id,
            localId: id,
            code,
            ...trackingDisplay(item),
            qty: 1,
            entryQty: 1,
            uom: item.uom,
            entryUom: item.uom,
            conversionFactor: 1,
            location:
              draft.value.kind === "Receive"
                ? props.initialWarehouse || ""
                : ["Transfer", "Repair"].includes(draft.value.kind)
                  ? target
                  : source,
            sourceLocation: draft.value.kind === "Receive" ? "" : source,
          });
        }
        draft.value.items.push(...additions);
        initialItemsApplied = true;
      }
      if (!state.identity && props.initialAllocations?.length) {
        await ensureMany([
          ...new Set(props.initialAllocations.map((row) => row.item_code)),
        ]);
        for (const allocation of props.initialAllocations) {
          const item = itemCache.get(cacheKey(allocation.item_code)),
            id = crypto.randomUUID();
          if (!item) continue;
          if (!active()) return;
          const batch = item.locations
            .find((place) => place.location === allocation.warehouse)
            ?.batches?.find((batch) => batch.id === allocation.batch_no);
          draft.value.items.push({
            id,
            localId: id,
            code: item.code,
            ...trackingDisplay(item),
            qty: allocation.qty,
            entryQty: allocation.qty,
            uom: item.uom,
            entryUom: item.uom,
            conversionFactor: 1,
            sourceLocation:
              draft.value.kind === "Receive" ? "" : allocation.warehouse,
            location: ["Transfer", "Repair"].includes(draft.value.kind)
              ? ""
              : allocation.warehouse,
            batch: allocation.batch_no,
            expiry: batch?.expiry,
            manufacturingDate: batch?.manufacturingDate,
          });
        }
      }
      state.recoveryError = recovery.list().error;
      if (
        !state.identity &&
        draft.value.kind === "Return" &&
        props.initialItems?.length
      ) {
        const itemCodes = [...new Set(props.initialItems)];
        const rows = await services.call<
          {
            loan: string;
            original_loan_line: string;
            item_code: string;
            batch_no: string;
            qty: number;
          }[]
        >(
          "temple_inventory.loans.outstanding_lines",
          {
            item_codes: itemCodes,
          },
          signal,
        );
        const byLoan = new Map<string, typeof rows>();
        for (const row of rows)
          byLoan.set(row.loan, [...(byLoan.get(row.loan) || []), row]);
        await Promise.all(
          [...byLoan].map(([name, allocations]) =>
            appendLoan(name, allocations, signal),
          ),
        );
        initialItemsApplied = true;
      }
      if (!state.identity && props.originalLoan) {
        let loanNames = [props.originalLoan];
        try {
          const parsed = JSON.parse(props.originalLoan);
          if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            parsed.every((name) => typeof name === "string" && name.trim())
          )
            loanNames = parsed;
        } catch {
          // Existing single-loan prefill values are plain names.
        }
        await Promise.all(
          [...new Set(loanNames)].map((name) =>
            appendLoan(name, undefined, signal),
          ),
        );
      }
      if (draft.value.items.some((line) => line.loanName))
        await refreshLoanBalances(false, signal);
    } catch (reason) {
      state.error =
        reason instanceof Error ? reason.message : "操作资料读取失败";
    } finally {
      if (active()) {
        loading.value = false;
        hydrating.value = false;
        ready = true;
        if (!state.identity && draft.value.items.length) editor.retain();
      }
    }
  }
  async function save(showIssues = false) {
    if (showIssues) showError.value = true;
    if (!active() || !writable.value || busy.value) return;
    clearTimeout(timer);
    if (issues(draft.value).length) {
      editor.retainIncomplete();
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
    if (issues(draft.value).length) return;
    reviewOpen.value = true;
    reviewChecking.value = true;
    state.error = "";
    void Promise.allSettled([
      Promise.all(
        [...new Set(draft.value.items.map((line) => line.code))].map(ensure),
      ),
      refreshLoanBalances(),
    ])
      .then((checks) => {
        const failure = checks.find(
          (check): check is PromiseRejectedResult =>
            check.status === "rejected",
        );
        if (failure) throw failure.reason;
        if (!active()) return;
        const issue = issues(draft.value)[0];
        if (issue) {
          reviewOpen.value = false;
          showError.value = true;
          state.error = issue.message;
        }
      })
      .catch((reason) => {
        if (active())
          state.error =
            reason instanceof Error ? reason.message : "复核失败，请重试";
      })
      .finally(() => {
        if (active()) reviewChecking.value = false;
      });
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
  async function appendLoan(
    name: string,
    selectedAllocations?: {
      original_loan_line: string;
      batch_no: string;
      qty: number;
    }[],
    signal?: AbortSignal,
  ) {
    if (!name || !active()) return;
    const loan = await loadLoanDetail(name, false, signal);
    if (loan.docstatus !== 1 || loan.kind !== "Loan")
      throw new Error("请选择已提交的原借出记录");
    const additions = [];
    for (const row of loan.items) {
      const item = await ensure(String(row.item_code));
      const serialTracked = Boolean(
        (item as StockItem & { tracksSerial?: boolean }).tracksSerial,
      );
      const allocations = row.allocations as {
        batch_no: string;
        outstanding_qty: number;
      }[];
      const outstandingSerials =
        (row.outstanding_serials as string[] | undefined) || [];
      for (const allocation of allocations || []) {
        const selectedAllocation = selectedAllocations?.find(
          (entry) =>
            entry.original_loan_line === row.name &&
            entry.batch_no === allocation.batch_no,
        );
        if (
          !(allocation.outstanding_qty > 0) ||
          (selectedAllocations && !selectedAllocation) ||
          draft.value.items.some(
            (line) =>
              line.loanName === name &&
              line.originalLoanLine === row.name &&
              line.batch === allocation.batch_no,
          )
        )
          continue;
        const id = crypto.randomUUID();
        const factor = Number(row.conversion_factor);
        let qty = selectedAllocation?.qty ?? allocation.outstanding_qty;
        const serials = serialTracked
          ? outstandingSerials.slice(0, Math.max(0, Math.floor(qty)))
          : undefined;
        if (serialTracked) qty = serials?.length || 0;
        if (qty <= 0) continue;
        additions.push({
          id,
          localId: id,
          code: String(row.item_code),
          ...trackingDisplay(item),
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
          loanBorrower: String(loan.ti_borrower || ""),
          loanActivity: String(loan.ti_activity || ""),
          loanActivityTitle: String(loan.activity_title || ""),
          originalLoanLine: String(row.name),
          batch: allocation.batch_no,
          ...(serialTracked
            ? { serials, outstandingSerials: [...outstandingSerials] }
            : {}),
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
    draft.value.loanName ||= name;
    draft.value.items.push(...additions);
  }
  async function loadLoanDetail(
    name: string,
    refresh = false,
    signal?: AbortSignal,
  ) {
    if (refresh || !loanDetails.has(name)) {
      const pending = services.call<NativeDocument>(
        "native_api.loan_detail",
        {
          name,
        },
        signal,
      );
      loanDetails.set(name, pending);
      return pending;
    }
    return loanDetails.get(name)!;
  }
  async function refreshLoanBalances(refresh = true, signal?: AbortSignal) {
    const checks = await Promise.allSettled(
      [
        ...new Set(
          draft.value.items.flatMap((line) =>
            line.loanName ? [line.loanName] : [],
          ),
        ),
      ].map(async (name) => {
        const loan = await loadLoanDetail(name, refresh, signal);
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
          line.outstandingSerials =
            (row?.outstanding_serials as string[] | undefined) || [];
        }
      }),
    );
    const failure = checks.find(
      (check): check is PromiseRejectedResult => check.status === "rejected",
    );
    if (failure) throw failure.reason;
  }
  async function recover(snapshot: RecoverySnapshot) {
    ready = false;
    await editor.inspectRecovery(snapshot);
    if (editor.applyRecovery()) {
      files.restore(
        (state.values.attachments || []) as unknown as AttachmentEntry[],
      );
      await hydrate();
      await refreshLoanBalances();
      showToast("已恢复上次在此浏览器暂存的内容");
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
          await refreshLoanBalances();
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
    loadController?.abort();
    if (dirty.value && !discarded) editor.retain();
    disposed = true;
    ready = false;
    editor.dispose();
    window.removeEventListener("beforeunload", beforeUnload);
    document.removeEventListener("inventory-session-restored", sessionRestored);
  });
  void load()
    .then(async () => {
      await refreshLoanBalances(false, loadController?.signal);
      if (!props.recoveryId) return;
      const entry = recovery.read(props.recoveryId);
      if (!entry || entry.editorKind !== "Stock Entry") {
        state.recoveryError = "未找到这份浏览器暂存内容，请从草稿列表重新打开";
        return;
      }
      await recover(entry);
    })
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

  watch(
    () => props.identity?.name,
    (name, previous) => {
      if (previous && name !== previous) {
        loadController?.abort();
        void load(true);
      }
    },
  );

  return {
    existingDocument: computed(() => Boolean(props.identity)),
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
    hydrating,
    busy,
    reviewChecking,
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
    recover,
    save,
    review,
    confirm,
    load,
    appendLoan,
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
