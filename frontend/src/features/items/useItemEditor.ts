import { useUpdateBlocker } from "../../lib/updateSafety";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
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
  presentCatalogItem,
  type CatalogItem,
} from "../../lib/catalogPresentation";
import {
  useAttachments,
  type AttachmentEntry,
} from "../attachments/useAttachments";
import { showToast } from "../../services/toast";
import { useConfirm } from "../../services/confirm";

export interface ItemInput {
  code: string;
  name: string;
  category: string;
  uom: string;
  barcode: string;
  description: string;
  tracksBatch: boolean;
  tracksExpiry: boolean;
}
export function useItemEditor(
  props: {
    code?: string;
    barcode?: string;
    contextual?: boolean;
    lazy?: boolean;
    recoveryId?: string;
  },
  saved: (item: CatalogItem) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const { confirm } = useConfirm();
  const account = reference.user;
  let disposed = false,
    generation = 0;
  let request: AbortController | undefined;
  const active = () => !disposed && account === reference.user;
  async function loadItem(code: string, signal?: AbortSignal) {
    const result = await services.call<{
      items: CatalogItem[];
      errors: { item_code: string; error: string }[];
    }>("catalog.operation_items", { item_codes: [code] }, signal);
    const item = result.items.find((row) => row.item_code === code);
    if (!item)
      throw new Error(
        result.errors.find((row) => row.item_code === code)?.error ||
          "物品不存在或无权访问",
      );
    return item;
  }
  const model = reactive<ItemInput>({
    code: "",
    name: "",
    category: "",
    uom: reference.units.some((row) => row.name === "Nos") ? "Nos" : "",
    barcode: props.barcode || "",
    description: "",
    tracksBatch: false,
    tracksExpiry: false,
  });
  const suggestedCode = ref("");
  const existing = ref<
      CatalogItem & {
        tracking_changeable?: boolean;
        tracking_change_reason?: string;
        disabled?: boolean;
        can_delete?: boolean;
      }
    >(),
    loading = ref(false),
    busy = ref(false),
    error = ref(""),
    recoveryError = ref(""),
    conflict = ref(false),
    discardOpen = ref(false),
    baseline = ref(JSON.stringify(model));
  let editorId = crypto.randomUUID();
  const tabId = crypto.randomUUID();
  let revision = 0,
    ready = false,
    discarded = false;
  let storage: Storage | undefined;
  try {
    storage = localStorage;
  } catch {
    /* Memory state remains usable. */
  }
  const recovery = createRecoveryStore(reference.site, account, storage);
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (model.category === oldName) model.category = category.name;
  });
  const initialized = ref(false);
  function discard() {
    discarded = true;
    recovery.remove(editorId, revision);
    baseline.value = JSON.stringify(model);
  }
  async function requestLeave(): Promise<boolean> {
    if (!dirty.value) return true;
    if (
      !(await confirm({
        title: "离开物品编辑？",
        message: "未保存的输入将丢失。",
      }))
    )
      return false;
    discard();
    return true;
  }
  function beforeUnload(event: BeforeUnloadEvent) {
    if (dirty.value && !discarded) {
      retain();
      event.preventDefault();
    }
  }
  if (typeof window !== "undefined")
    window.addEventListener("beforeunload", beforeUnload);
  const canWrite = computed(() =>
    existing.value ? true : props.code ? false : true,
  );
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () =>
      existing.value
        ? { doctype: "Item", name: existing.value.item_code }
        : undefined,
    writable: () => canWrite.value && !conflict.value,
    primary: async (file) => {
      if (!existing.value) return;
      const value = await services.call<CatalogItem>("catalog.set_item_image", {
        item_code: existing.value.item_code,
        version: existing.value.version,
        file_name: file,
      });
      if (active()) existing.value = value;
    },
    changed: () => retain(),
    parentChanged: (version) => {
      if (existing.value) existing.value.version = version;
    },
  });
  const dirty = computed(
    () =>
      !discarded &&
      (JSON.stringify(model) !== baseline.value || files.incomplete.value),
  );
  function retain() {
    if (!ready || !active() || discarded) return false;
    revision++;
    const result = recovery.save({
      schema: 1,
      site: reference.site,
      account,
      tabId,
      editorId,
      editorKind: "Item",
      baseVersion: existing.value?.version,
      revision,
      updatedAt: new Date().toISOString(),
      pendingUploadReselection: files.incomplete.value,
      values: recoveryValues({
        ...model,
        editingCode: existing.value?.item_code || props.code || "",
        creating: !props.code,
        attachments: files.files,
      }),
    });
    recoveryError.value = result.error;
    return result.durable;
  }
  async function suggest() {
    if (props.code || model.code || !active()) return;
    const result = await services.call<{ item_code: string }>(
      "catalog.suggest_item_code",
    );
    if (active()) suggestedCode.value = result.item_code;
    if (active() && !model.code) {
      const previous = JSON.parse(baseline.value || JSON.stringify(model));
      model.code = result.item_code;
      previous.code = result.item_code;
      baseline.value = JSON.stringify(previous);
    }
  }
  async function load() {
    const current = ++generation;
    request?.abort();
    request = new AbortController();
    ready = false;
    loading.value = true;
    error.value = "";
    conflict.value = false;
    try {
      if (props.code) {
        const [loaded, lifecycle] = await Promise.all([
          loadItem(props.code, request.signal),
          services.call<{
            tracking_changeable: boolean;
            tracking_change_reason: string;
          }>(
            "catalog.item_lifecycle",
            { item_code: props.code },
            request.signal,
          ),
        ]);
        const item = { ...loaded, ...lifecycle };
        if (!active() || current !== generation) return;
        existing.value = item;
        Object.assign(model, {
          code: item.item_code,
          name: item.item_name,
          category: item.item_group,
          uom: item.stock_uom,
          barcode: item.barcodes.map((row) => row.barcode).join("\n"),
          description: item.description,
          tracksBatch: item.has_batch_no,
          tracksExpiry: item.has_expiry_date,
        });
        files.load(item.attachments || [], item.image);
      } else await suggest();
      if (!active() || current !== generation) return;
      baseline.value = JSON.stringify(model);
      ready = true;
      initialized.value = true;
      if (props.recoveryId) {
        const entry = recovery.read(props.recoveryId);
        if (entry?.editorKind === "Item") await recover(entry);
        else
          recoveryError.value =
            "未找到这份浏览器暂存内容，请从草稿列表重新打开";
      }
    } catch (reason) {
      if (active() && current === generation)
        error.value = reason instanceof Error ? reason.message : "物品读取失败";
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  async function recover(snapshot: RecoverySnapshot) {
    if (
      !active() ||
      snapshot.account !== account ||
      snapshot.site !== reference.site
    )
      return;
    const code = String(snapshot.values.editingCode || "");
    if (props.code && code !== props.code) {
      error.value = "此输入属于其它物品";
      return;
    }
    const source = { editorId: snapshot.editorId, revision: snapshot.revision };
    if (code) {
      try {
        const [loaded, lifecycle] = await Promise.all([
          loadItem(code),
          services.call<{
            tracking_changeable: boolean;
            tracking_change_reason: string;
          }>("catalog.item_lifecycle", { item_code: code }),
        ]);
        const current = { ...loaded, ...lifecycle };
        if (!active() || disposed) return;
        if (current.version !== snapshot.baseVersion) {
          error.value = "物品已更改，不能覆盖原记录；请复制恢复文字后核对";
          return;
        }
        existing.value = current;
        files.clear();
        files.load(current.attachments || [], current.image);
      } catch (reason) {
        error.value =
          reason instanceof Error
            ? reason.message
            : "原物品无法读取，请复制恢复文字";
        return;
      }
    }
    ready = false;
    editorId = crypto.randomUUID();
    revision = 0;
    for (const key of Object.keys(model) as (keyof ItemInput)[])
      if (key in snapshot.values)
        Object.assign(model, { [key]: snapshot.values[key] });
    files.restore(
      (snapshot.values.attachments || []) as unknown as AttachmentEntry[],
    );
    ready = true;
    const durable = retain();
    if (durable && !recovery.remove(source.editorId, source.revision))
      recoveryError.value = "另一窗口已更新这份未完成输入；其内容保持原样";
    showToast("已恢复上次在此浏览器暂存的内容");
  }
  async function reset() {
    ready = false;
    recovery.remove(editorId, revision);
    editorId = crypto.randomUUID();
    revision = 0;
    discarded = false;
    existing.value = undefined;
    files.clear();
    Object.assign(model, {
      code: "",
      name: "",
      category: "",
      uom: reference.units.some((row) => row.name === "Nos") ? "Nos" : "",
      barcode: props.barcode || "",
      description: "",
      tracksBatch: false,
      tracksExpiry: false,
    });
    suggestedCode.value = "";
    initialized.value = false;
    await load();
  }
  function setBarcode(value: string) {
    if (existing.value || busy.value) return;
    ready = false;
    model.barcode = value.trim();
    baseline.value = JSON.stringify(model);
    ready = true;
  }
  async function save() {
    if (
      !active() ||
      busy.value ||
      loading.value ||
      !canWrite.value ||
      conflict.value
    )
      return;
    busy.value = true;
    error.value = "";
    const wasExisting = Boolean(existing.value);
    try {
      const item = await services.call<CatalogItem>("catalog.save_item", {
        data: {
          item_code: model.code.trim(),
          item_name: model.name.trim(),
          item_group: model.category,
          stock_uom: model.uom,
          barcodes: model.barcode,
          description: model.description,
          has_batch_no: model.tracksBatch || model.tracksExpiry,
          has_expiry_date: model.tracksExpiry,
        },
        ...(existing.value
          ? {
              item_code: existing.value.item_code,
              version: existing.value.version,
            }
          : {}),
      });
      if (!active()) return;
      existing.value = item;
      baseline.value = JSON.stringify(model);
      await files.finalize();
      if (!active()) return;
      if (files.incomplete.value || files.error.value) {
        retain();
        error.value =
          files.error.value ||
          "物品资料已保存，附件尚未全部上传；请重试或移除未完成附件";
        return;
      }
      recovery.remove(editorId, revision);
      showToast(wasExisting ? "物品资料已更新" : "物品已创建");
      saved(existing.value);
    } catch (reason) {
      if (!active()) return;
      error.value =
        reason instanceof Error ? reason.message : "物品保存失败，输入已保留";
      showToast(`物品保存失败：${error.value}`, "danger");
      conflict.value = ["TimestampMismatchError", "DoesNotExistError"].includes(
        String((reason as { kind?: string })?.kind),
      );
      retain();
    } finally {
      if (active()) busy.value = false;
    }
  }
  watch(
    model,
    () => {
      if (ready) retain();
    },
    { deep: true, flush: "sync" },
  );
  watch(
    () => props.code,
    () => {
      if (!props.lazy) void load();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    stopCategoryRename();
    if (ready && dirty.value) retain();
    window.removeEventListener("beforeunload", beforeUnload);
    disposed = true;
    generation++;
    request?.abort();
  });
  useUpdateBlocker(() => dirty.value || busy.value);

  return {
    requestLeave,
    conversionsUpdated: (value: {
      version: string;
      conversions: { uom: string; conversion_factor: number }[];
    }) => {
      if (existing.value) {
        existing.value.version = value.version;
        existing.value.uoms = value.conversions;
        retain();
      }
    },
    initialized,
    model,
    existing,
    loading,
    busy,
    error,
    recoveryError,
    conflict,
    discardOpen,
    dirty,
    canWrite,
    recovery,
    recover,
    load,
    save,
    suggest,
    suggestedCode,
    files,
    reference,
    baseline,
    reset,
    setBarcode,
    stockItem: computed(() =>
      existing.value ? presentCatalogItem(existing.value) : undefined,
    ),
    recoveryText: computed(() =>
      JSON.stringify({ ...model, attachments: files.files }, null, 2),
    ),
    discard,
  };
}
