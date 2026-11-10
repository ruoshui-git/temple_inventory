import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { createRecoveryStore } from "../../lib/browserRecovery";
import {
  createNativeEditor,
  type NativeDocument,
} from "../documents/nativeEditor";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import { postingTime } from "../../lib/nativeTime";
import type { RecoverySnapshot } from "../../lib/browserRecovery";
import { confirm as confirmDialog } from "../../services/confirm";
import { useLinkedActivity } from "../activities/useLinkedActivity";
import { useAttachments } from "../attachments/useAttachments";

type OpeningLine = {
  name?: string;
  localId: string;
  item_code: string;
  item_name?: string;
  warehouse: string;
  batch_no: string;
  serial_no: string;
  autoSerialCount?: number;
  qty: number | null;
  stock_uom?: string;
  valuation_rate: number | null;
  allow_zero_valuation_rate?: number;
  has_batch_no?: boolean;
  has_serial_no?: boolean;
  has_expiry_date?: boolean;
  expiry_date?: string;
  manufacturing_date?: string;
  item_image?: string;
  serial_no_series?: string;
  use_serial_batch_fields: number;
  eligibility_error?: string;
};
type OpeningValues = {
  purpose: "Opening Stock";
  company: string;
  posting_date: string;
  posting_time: string;
  remarks: string;
  ti_activity: string;
  items: OpeningLine[];
};

export function useOpeningEditor(props: {
  name?: string;
  recoveryId?: string;
  initialDocument?: NativeDocument;
}) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const loading = ref(false),
    busy = ref(false),
    savePending = ref(0),
    pickerOpen = ref(false),
    reviewOpen = ref(false),
    supportingDirty = ref(false);
  const values = reactive<OpeningValues>({
    purpose: "Opening Stock",
    company: reference.company,
    posting_date: reference.siteDate,
    posting_time: postingTime(reference.siteTime.split(" ")[1]),
    remarks: "",
    ti_activity: "",
    items: [],
  });
  const recovery = createRecoveryStore(reference.site, account, localStorage);
  const pendingBatches = new Set<string>();
  const batchOptions = reactive<
    Record<
      string,
      { name: string; manufacturing_date?: string; expiry_date?: string }[]
    >
  >({});
  const editor = createNativeEditor({
    site: reference.site,
    account,
    currentAccount: () => reference.user,
    tabId: crypto.randomUUID(),
    editorKind: "Opening Stock",
    doctype: "Stock Reconciliation",
    recovery,
    values: values as unknown as Record<string, unknown>,
    recoveryDebounceMs: 500,
    valid: (raw) => {
      const model = raw as unknown as OpeningValues;
      const timestamp = new Date(
        `${model.posting_date}T${model.posting_time}`,
      ).getTime();
      return (
        Number.isFinite(timestamp) &&
        timestamp <= Date.now() &&
        model.items.length > 0 &&
        model.items.every((line) =>
          Boolean(
            line.item_code &&
            line.warehouse &&
            Number(line.qty) > 0 &&
            (!line.has_batch_no ||
              (line.batch_no && !pendingBatches.has(line.localId))) &&
            (!line.has_expiry_date || Boolean(line.expiry_date)) &&
            (!line.has_serial_no ||
              serialValues(line).length === Number(line.qty)) &&
            !line.eligibility_error,
          ),
        )
      );
    },
    services: {
      load: async (identity) =>
        services.call<NativeDocument>("native_api.load_document", {
          ...identity,
        }),
      create: (_doctype, requestId, data) =>
        services.call<NativeDocument>("native_api.create_document", {
          doctype: "Stock Reconciliation",
          request_id: requestId,
          data: {
            ...data,
            purpose: "Opening Stock",
            company: reference.company,
          },
        }),
      save: (identity, version, data) =>
        services.call<NativeDocument>("native_api.save_document", {
          ...identity,
          version,
          data,
        }),
      submit: (identity, version) =>
        services.call<NativeDocument>("native_api.submit_document", {
          ...identity,
          version,
        }),
    },
  });
  const state = editor.state;
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () => state.identity,
    writable: () => false,
  });
  watch(
    () => state.identity?.name,
    (name) => {
      if (name) void files.fetch();
      else files.clear();
    },
    { immediate: true },
  );
  const activityLabel = useLinkedActivity(
    () => values.ti_activity,
    () => state.server,
  );
  const writable = computed(
    () =>
      !loading.value &&
      !busy.value &&
      !state.confirmationVersion &&
      (state.server
        ? state.server.editable === true
        : reference.capabilities?.stock_reconciliation.create === true),
  );
  const queueError = computed(() => String(state.server?.queue_error || ""));
  const dirty = computed(() => state.revision > state.savedRevision);
  let timer: ReturnType<typeof setTimeout> | undefined,
    poller: ReturnType<typeof setInterval> | undefined;
  let ready = false;
  let baselineFingerprint = "";
  let activeSaveRevision: number | undefined;
  const fingerprint = () =>
    JSON.stringify({
      ...values,
      items: values.items.map(
        ({ name: _name, eligibility_error: _error, ...row }) => row,
      ),
    });
  function decode(doc: NativeDocument) {
    values.purpose = "Opening Stock";
    values.company = String(doc.company || reference.company);
    values.posting_date = String(doc.posting_date || "");
    values.posting_time = postingTime(doc.posting_time);
    values.remarks = String(doc.remarks || "");
    values.ti_activity = String(doc.ti_activity || "");
    values.items = (Array.isArray(doc.items) ? doc.items : []).map(
      (row: Record<string, unknown>) => ({
        name: String(row.name || ""),
        localId: crypto.randomUUID(),
        item_code: String(row.item_code || ""),
        item_name: String(row.ti_display_item_name || row.item_name || ""),
        warehouse: String(row.warehouse || ""),
        batch_no: String(row.batch_no || ""),
        serial_no: String(row.serial_no || ""),
        qty: Number(row.qty || 0),
        stock_uom: String(row.stock_uom || ""),
        valuation_rate:
          row.valuation_rate == null ? null : Number(row.valuation_rate),
        allow_zero_valuation_rate: Number(row.allow_zero_valuation_rate || 0),
        has_batch_no: Boolean(row.ti_display_tracks_batch),
        has_serial_no: Boolean(row.ti_display_tracks_serial),
        has_expiry_date: Boolean(row.ti_display_tracks_expiry),
        item_image: String(row.ti_display_image || ""),
        serial_no_series: String(row.ti_display_serial_no_series || ""),
        expiry_date: String(row.ti_display_expiry_date || ""),
        manufacturing_date: String(row.ti_display_manufacturing_date || ""),
        use_serial_batch_fields: 1,
      }),
    );
    return loadItemMetadata(values.items.map((row) => row.item_code));
  }
  async function recover(snapshot: RecoverySnapshot) {
    await editor.inspectRecovery(snapshot);
    if (!editor.applyRecovery()) return;
    const recovered = state.values as unknown as OpeningValues;
    values.purpose = "Opening Stock";
    values.company = recovered.company || reference.company;
    values.posting_date = recovered.posting_date || reference.siteDate;
    values.posting_time =
      recovered.posting_time || postingTime(reference.siteTime.split(" ")[1]);
    values.remarks = recovered.remarks || "";
    values.ti_activity = recovered.ti_activity || "";
    values.items = recovered.items || [];
    state.values = values as unknown as Record<string, unknown>;
  }
  async function loadItemMetadata(codes: string[]) {
    if (!codes.length) return;
    try {
      const metadata = await services.call<
        Record<string, Record<string, unknown>>
      >("catalog.item_display_summaries", { item_codes: [...new Set(codes)] });
      values.items.forEach((row) => {
        const item = metadata[row.item_code];
        if (item)
          Object.assign(row, {
            item_name: String(item.item_name || row.item_name || ""),
            stock_uom: String(item.stock_uom || row.stock_uom || ""),
            has_batch_no: Boolean(item.has_batch_no),
            has_serial_no: Boolean(item.has_serial_no),
            has_expiry_date: Boolean(item.has_expiry_date),
            item_image: String(item.image || ""),
            serial_no_series: String(item.serial_no_series || ""),
          });
      });
      await Promise.all(
        values.items
          .filter((row) => row.has_batch_no)
          .map(async (row) => {
            try {
              batchOptions[row.item_code] = await services.call<
                {
                  name: string;
                  manufacturing_date?: string;
                  expiry_date?: string;
                }[]
              >("opening.batch_options", { item_code: row.item_code });
            } catch {
              batchOptions[row.item_code] = [];
            }
          }),
      );
    } catch {
      /* Metadata only controls optional tracking fields. */
    }
  }
  async function load() {
    if (!props.name) {
      if (props.recoveryId) {
        const snapshot = recovery.read(props.recoveryId);
        if (snapshot?.editorKind === "Opening Stock") await recover(snapshot);
        else
          state.recoveryError =
            "未找到这份期初库存暂存内容，请从草稿列表重新打开";
      }
      await nextTick();
      baselineFingerprint = fingerprint();
      ready = true;
      return;
    }
    loading.value = true;
    try {
      const document =
        props.initialDocument ||
        (await services.call<NativeDocument>("native_api.load_document", {
          doctype: "Stock Reconciliation",
          name: props.name,
        }));
      await editor.load(
        { doctype: "Stock Reconciliation", name: props.name },
        true,
        document,
      );
      await decode(document);
      state.values = values as unknown as Record<string, unknown>;
      if (document.docstatus === 0 && !document.editable)
        editor.state.status = "saved";
      if (props.recoveryId) {
        const snapshot = recovery.read(props.recoveryId);
        if (snapshot?.editorKind === "Opening Stock") await recover(snapshot);
        else
          state.recoveryError =
            "未找到这份期初库存暂存内容，请从草稿列表重新打开";
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "记录读取失败";
    } finally {
      loading.value = false;
      await nextTick();
      baselineFingerprint = fingerprint();
      ready = true;
    }
  }
  function changed() {
    if (!ready || !writable.value) return;
    if (fingerprint() === baselineFingerprint) return;
    state.error = "";
    values.items.forEach((row) => {
      row.eligibility_error = "";
    });
    editor.edited();
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 800);
  }
  function markBatchDirty(row: OpeningLine) {
    pendingBatches.add(row.localId);
    row.eligibility_error = "";
    changed();
  }
  async function ensureBatch(row: OpeningLine) {
    if (!row.has_batch_no || !row.batch_no.trim()) {
      if (row.has_batch_no) row.eligibility_error = "请输入批次编号。";
      return false;
    }
    if (row.has_expiry_date && !row.expiry_date) {
      row.eligibility_error = "此物品需要填写批次到期日期。";
      return false;
    }
    try {
      const batch = await services.call<{ name: string }>(
        "opening.ensure_batch",
        {
          item_code: row.item_code,
          batch_id: row.batch_no.trim(),
          manufacturing_date: row.manufacturing_date || null,
          expiry_date: row.expiry_date || null,
        },
      );
      row.batch_no = batch.name;
      pendingBatches.delete(row.localId);
      row.eligibility_error = "";
      clearTimeout(timer);
      await save();
      return true;
    } catch (error) {
      row.eligibility_error =
        error instanceof Error ? error.message : "批次创建失败。";
      return false;
    }
  }
  function chooseBatch(row: OpeningLine, name: string) {
    row.batch_no = name;
    const batch = batchOptions[row.item_code]?.find(
      (candidate) => candidate.name === name,
    );
    if (batch) {
      row.manufacturing_date = String(batch.manufacturing_date || "");
      row.expiry_date = String(batch.expiry_date || "");
    }
    pendingBatches.delete(row.localId);
    row.eligibility_error = "";
  }
  function serialValues(row: OpeningLine) {
    return row.serial_no
      .replaceAll(",", "\n")
      .split(/\r?\n/)
      .map((serial) => serial.trim())
      .filter(Boolean);
  }
  function addSerials(row: OpeningLine, input: string) {
    const next = [...serialValues(row)];
    for (const serial of input
      .split(/[\s,，;；]+/)
      .map((value) => value.trim())
      .filter(Boolean))
      if (!next.includes(serial)) next.push(serial);
    row.serial_no = next.join("\n");
    if (row.autoSerialCount === undefined) row.qty = next.length;
  }
  function removeSerial(row: OpeningLine, serial: string) {
    row.serial_no = serialValues(row)
      .filter((value) => value !== serial)
      .join("\n");
    if (row.autoSerialCount === undefined) row.qty = serialValues(row).length;
  }
  function toggleAutoSerial(row: OpeningLine, enabled: boolean) {
    row.serial_no = "";
    if (enabled) {
      const quantity = Math.max(1, Number(row.qty || 1));
      row.autoSerialCount = quantity;
      row.qty = quantity;
    } else {
      row.autoSerialCount = undefined;
    }
  }
  function setAutoSerialCount(row: OpeningLine, quantity: number) {
    row.autoSerialCount = quantity;
    row.qty = quantity;
  }
  async function generateSerials(row: OpeningLine) {
    if (
      !row.autoSerialCount ||
      serialValues(row).length === row.autoSerialCount
    )
      return;
    try {
      const serials = await services.call<string[]>(
        "opening.generate_serials",
        {
          item_code: row.item_code,
          quantity: row.autoSerialCount,
        },
      );
      row.serial_no = serials.join("\n");
      row.eligibility_error = "";
    } catch (error) {
      row.eligibility_error =
        error instanceof Error ? error.message : "序列号生成失败。";
    }
  }
  watch(fingerprint, changed);
  watch(
    () => state.error,
    (message) => {
      if (!message) return;
      const line = values.items.find((row) => message.includes(row.item_code));
      if (line) line.eligibility_error = message;
    },
  );
  watch(
    () => state.server?.items,
    (serverItems) => {
      if (!Array.isArray(serverItems)) return;
      serverItems.forEach((item: Record<string, unknown>, index) => {
        if (values.items[index]) {
          values.items[index]!.name = String(item.name || "");
          values.items[index]!.allow_zero_valuation_rate = Number(
            item.allow_zero_valuation_rate || 0,
          );
          values.items[index]!.expiry_date = String(
            item.ti_display_expiry_date || "",
          );
          values.items[index]!.has_batch_no = Boolean(
            item.ti_display_tracks_batch,
          );
          values.items[index]!.has_serial_no = Boolean(
            item.ti_display_tracks_serial,
          );
          values.items[index]!.has_expiry_date = Boolean(
            item.ti_display_tracks_expiry,
          );
          values.items[index]!.item_image = String(item.ti_display_image || "");
          values.items[index]!.serial_no_series = String(
            item.ti_display_serial_no_series || "",
          );
        }
      });
      if (activeSaveRevision !== undefined) baselineFingerprint = fingerprint();
    },
  );
  async function addItem(
    item: { item_code?: string; item_name?: string; stock_uom?: string },
    warehouse: string,
  ) {
    if (
      values.items.some(
        (row) =>
          row.item_code === item.item_code && row.warehouse === warehouse,
      )
    )
      return;
    values.items.push({
      localId: crypto.randomUUID(),
      item_code: String(item.item_code || ""),
      warehouse,
      batch_no: "",
      serial_no: "",
      qty: null,
      valuation_rate: null,
      use_serial_batch_fields: 1,
    });
    await loadItemMetadata([String(item.item_code || "")]);
  }
  function removeItem(row: OpeningLine) {
    pendingBatches.delete(row.localId);
    values.items = values.items.filter((item) => item.localId !== row.localId);
  }
  async function confirm() {
    if (!writable.value) return;
    for (const row of values.items) {
      if (row.has_batch_no && !(await ensureBatch(row))) return;
      if (
        row.has_serial_no &&
        row.autoSerialCount &&
        serialValues(row).length !== row.autoSerialCount
      )
        await generateSerials(row);
    }
    await nextTick();
    const accepted = await confirmDialog({
      title: "确认期初库存？",
      message: `将登记 ${values.items.length} 行、${new Set(values.items.map((row) => row.warehouse)).size} 个位置；期初日期 ${values.posting_date} ${values.posting_time}；差额科目 ${state.server?.expense_account || "由 ERPNext 设置"}。确认后将写入库存和会计记录。`,
      confirmLabel: "确认并登记",
      cancelLabel: "返回检查",
    });
    if (!accepted) return;
    busy.value = true;
    try {
      await save();
      await editor.confirm();
    } finally {
      busy.value = false;
    }
    if (state.server?.queued) {
      poller = setInterval(async () => {
        if (!state.identity) return;
        const latest = await services.call<NativeDocument>(
          "native_api.load_document",
          state.identity,
        );
        state.server = latest;
        if (!latest.queued) {
          clearInterval(poller);
          poller = undefined;
          if (latest.docstatus === 1) state.status = "submitted";
        }
      }, 1500);
    }
  }
  async function save() {
    const requestRevision = state.revision;
    activeSaveRevision = requestRevision;
    try {
      await editor.save();
      await nextTick();
      if (state.status === "saved" && state.savedRevision === state.revision)
        baselineFingerprint = fingerprint();
    } finally {
      if (activeSaveRevision === requestRevision)
        activeSaveRevision = undefined;
    }
  }
  async function action(kind: "cancel" | "amend" | "delete") {
    if (!state.identity || !state.version) return;
    busy.value = true;
    try {
      const endpoint = `native_api.${kind}_document`;
      const response = await services.call<NativeDocument | { deleted: true }>(
        endpoint,
        {
          ...state.identity,
          version: state.version,
          request_id: crypto.randomUUID(),
        },
      );
      if ("deleted" in response) state.status = "deleted";
      else {
        state.server = response;
        state.version = response.version;
        state.status = response.docstatus === 2 ? "cancelled" : "saved";
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : "操作失败";
    } finally {
      busy.value = false;
    }
  }
  async function requestLeave() {
    if (!dirty.value && !state.confirmationVersion) return true;
    const leave = await confirmDialog({
      title: "保留期初库存输入？",
      message: "未完成内容会保存在此浏览器，可稍后从草稿列表恢复。",
      confirmLabel: "离开并保留",
      cancelLabel: "继续编辑",
    });
    if (leave) editor.flushRecovery();
    return leave;
  }
  onBeforeUnmount(() => {
    clearTimeout(timer);
    clearInterval(poller);
    if (dirty.value) editor.flushRecovery();
    editor.dispose();
  });
  void load();
  const labels = new Map(
    reference.items.map((item) => [item.value, item.label]),
  );
  const warehouses = computed(() =>
    reference.warehouses.filter((row) =>
      reference.physicalLeaves.includes(row.name),
    ),
  );
  return {
    state,
    values,
    loading,
    busy,
    savePending,
    reviewOpen,
    supportingDirty,
    files,
    dirty,
    writable,
    pickerOpen,
    queueError,
    activityLabel,
    labels,
    warehouses,
    addItem,
    removeItem,
    markBatchDirty,
    ensureBatch,
    chooseBatch,
    batchOptions,
    serialValues,
    addSerials,
    removeSerial,
    toggleAutoSerial,
    setAutoSerialCount,
    generateSerials,
    confirm,
    action,
    save,
    requestLeave,
  };
}
