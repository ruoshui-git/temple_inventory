import { computed, onBeforeUnmount, ref, unref, watch, type Ref } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import type { MovementHistoryRow, ReportRow } from "../../lib/reportContract";
import { useFormValidation } from "../../composables/useFormValidation";
import { useConfirm } from "../../services/confirm";

export interface BatchDetail {
  name: string;
  item_code: string;
  item: { item_code: string; item_name: string; image: string };
  manufacturing_date: string;
  expiry_date: string;
  description: string;
  disabled: boolean;
  version: string;
  can_edit: boolean;
  locations: {
    rows: ReportRow[];
    matched_count: number;
    next_start: number | null;
    summary: ReportRow[];
  };
  history: {
    rows: MovementHistoryRow[];
    matched_count: number;
    next_start: number | null;
  };
}

export function useBatchDetailController(props: {
  name: string | Ref<string>;
}) {
  const services = useInventoryServices();
  const reference = useReferenceData();
  const validation = useFormValidation();
  let account = reference.user,
    generation = 0,
    disposed = false,
    request: AbortController | undefined,
    historyRequest: AbortController | undefined,
    locationRequest: AbortController | undefined;
  const batch = ref<BatchDetail>(),
    manufacturingDate = ref(""),
    expiryDate = ref(""),
    description = ref(""),
    loading = ref(false),
    saving = ref(false),
    historyLoading = ref(false),
    locationsLoading = ref(false),
    locationsSortBy = ref("identity"),
    locationsSortDirection = ref<"asc" | "desc">("asc"),
    error = ref(""),
    historyError = ref(""),
    locationError = ref(""),
    success = ref(""),
    editing = ref(false);
  const dirty = computed(
    () =>
      !!batch.value &&
      (manufacturingDate.value !== batch.value.manufacturing_date ||
        expiryDate.value !== batch.value.expiry_date ||
        description.value !== batch.value.description),
  );
  validation.register(
    "batch-manufacturing-date",
    () => manufacturingDate.value,
    [
      (v) =>
        !v || !expiryDate.value || v <= expiryDate.value
          ? true
          : "生产日期不能晚于到期日期",
    ],
    () => document.getElementById("batch-manufacturing-date")?.focus(),
  );
  validation.register(
    "batch-expiry-date",
    () => expiryDate.value,
    [
      (v) =>
        !v || !manufacturingDate.value || v >= manufacturingDate.value
          ? true
          : "到期日期不能早于生产日期",
    ],
    () => document.getElementById("batch-expiry-date")?.focus(),
  );
  const active = (current: number) =>
    !disposed && current === generation && account === reference.user;
  function clear() {
    batch.value = undefined;
    manufacturingDate.value = expiryDate.value = description.value = "";
    editing.value = false;
    success.value = historyError.value = locationError.value = "";
    loading.value =
      saving.value =
      historyLoading.value =
      locationsLoading.value =
        false;
  }
  async function load() {
    const current = ++generation;
    request?.abort();
    historyRequest?.abort();
    locationRequest?.abort();
    request = new AbortController();
    clear();
    loading.value = true;
    error.value = "";
    try {
      const result = await services.call<BatchDetail>(
        "catalog.batch_details",
        { name: unref(props.name) },
        request.signal,
      );
      if (!active(current)) return;
      batch.value = result;
      setDraft(result);
    } catch (reason) {
      if (active(current))
        error.value = reason instanceof Error ? reason.message : "批次读取失败";
    } finally {
      if (active(current)) loading.value = false;
    }
  }
  async function reload() {
    if (
      dirty.value &&
      !(await useConfirm().confirm({
        title: "重新读取批次资料？",
        message: "重新读取会放弃未保存的修改。",
        confirmLabel: "放弃并重新读取",
        tone: "danger",
      }))
    )
      return;
    void load();
  }
  function setDraft(value: BatchDetail) {
    manufacturingDate.value = value.manufacturing_date;
    expiryDate.value = value.expiry_date;
    description.value = value.description;
  }
  function beginEdit() {
    if (batch.value) editing.value = true;
  }
  async function cancelEdit() {
    if (saving.value || !batch.value) return;
    if (
      dirty.value &&
      !(await useConfirm().confirm({
        title: "放弃批次修改？",
        message: "未保存的修改将丢失。",
        confirmLabel: "放弃修改",
        tone: "danger",
      }))
    )
      return;
    {
      setDraft(batch.value);
      editing.value = false;
      error.value = "";
    }
  }
  async function save() {
    const current = generation,
      target = batch.value;
    if (!target || saving.value || !editing.value) return;
    error.value = "";
    if (!validation.validate().ok) return;
    const sent = {
      manufacturing_date: manufacturingDate.value,
      expiry_date: expiryDate.value,
      description: description.value,
    };
    saving.value = true;
    error.value = "";
    success.value = "";
    try {
      const result = await services.call<BatchDetail>("catalog.save_batch", {
        name: target.name,
        version: target.version,
        data: sent,
      });
      if (!active(current) || batch.value?.name !== target.name) return;
      batch.value = result;
      const changedWhileSaving =
        manufacturingDate.value !== sent.manufacturing_date ||
        expiryDate.value !== sent.expiry_date ||
        description.value !== sent.description;
      if (!changedWhileSaving) {
        setDraft(result);
        editing.value = false;
        success.value = "批次资料已保存。";
      } else {
        success.value = "已保存提交时的资料；当前编辑内容仍保留。";
      }
    } catch (reason) {
      if (active(current))
        error.value =
          reason instanceof Error
            ? reason.message
            : "保存失败，请保留输入后重试。";
    } finally {
      if (active(current)) saving.value = false;
    }
  }
  async function moreHistory() {
    const target = batch.value,
      current = generation;
    if (!target || historyLoading.value || target.history.next_start === null)
      return;
    historyRequest?.abort();
    historyRequest = new AbortController();
    historyLoading.value = true;
    historyError.value = "";
    try {
      const page = await services.call<BatchDetail["history"]>(
        "catalog.batch_history",
        {
          name: target.name,
          start: target.history.next_start,
          page_length: 20,
        },
        historyRequest.signal,
      );
      if (!active(current) || batch.value?.name !== target.name) return;
      const seen = new Set(target.history.rows.map((row) => String(row.id)));
      target.history.rows.push(
        ...page.rows.filter((row) => !seen.has(String(row.id))),
      );
      target.history.next_start = page.next_start;
      target.history.matched_count = page.matched_count;
    } catch (reason) {
      if (active(current))
        historyError.value =
          reason instanceof Error ? reason.message : "记录读取失败";
    } finally {
      if (active(current)) historyLoading.value = false;
    }
  }
  async function moreLocations() {
    const target = batch.value,
      current = generation;
    if (
      !target ||
      locationsLoading.value ||
      target.locations.next_start === null
    )
      return;
    locationRequest?.abort();
    locationRequest = new AbortController();
    locationsLoading.value = true;
    locationError.value = "";
    try {
      const page = await services.call<BatchDetail["locations"]>(
        "catalog.batch_locations",
        {
          name: target.name,
          start: target.locations.next_start,
          page_length: 100,
          sort_by: locationsSortBy.value,
          sort: locationsSortDirection.value,
        },
        locationRequest.signal,
      );
      if (!active(current) || batch.value?.name !== target.name) return;
      const seen = new Set(target.locations.rows.map((row) => String(row.id)));
      target.locations.rows.push(
        ...page.rows.filter((row) => !seen.has(String(row.id))),
      );
      target.locations.next_start = page.next_start;
      target.locations.matched_count = page.matched_count;
      target.locations.summary = page.summary;
    } catch (reason) {
      if (active(current))
        locationError.value =
          reason instanceof Error ? reason.message : "位置读取失败";
    } finally {
      if (active(current)) locationsLoading.value = false;
    }
  }
  async function sortLocations(field: string) {
    const target = batch.value;
    const allowed = [
      "identity",
      "warehouse_label",
      "stock_qty",
      "available",
      "stock_uom",
    ];
    if (!target || !allowed.includes(field) || locationsLoading.value) return;
    if (locationsSortBy.value === field) {
      locationsSortDirection.value =
        locationsSortDirection.value === "asc" ? "desc" : "asc";
    } else {
      locationsSortBy.value = field;
      locationsSortDirection.value = "asc";
    }
    locationRequest?.abort();
    const current = generation;
    const controller = new AbortController();
    locationRequest = controller;
    locationsLoading.value = true;
    locationError.value = "";
    try {
      const page = await services.call<BatchDetail["locations"]>(
        "catalog.batch_locations",
        {
          name: target.name,
          start: 0,
          page_length: 100,
          sort_by: locationsSortBy.value,
          sort: locationsSortDirection.value,
        },
        controller.signal,
      );
      if (!active(current) || batch.value?.name !== target.name) return;
      target.locations.rows = page.rows;
      target.locations.next_start = page.next_start;
      target.locations.matched_count = page.matched_count;
      target.locations.summary = page.summary;
    } catch (reason) {
      if (!controller.signal.aborted && active(current))
        locationError.value =
          reason instanceof Error ? reason.message : "位置读取失败";
    } finally {
      if (active(current) && locationRequest === controller)
        locationsLoading.value = false;
    }
  }

  watch(
    () => unref(props.name),
    () => void load(),
    { immediate: true },
  );
  watch(
    () => reference.user,
    (value) => {
      generation++;
      request?.abort();
      historyRequest?.abort();
      locationRequest?.abort();
      account = value;
      clear();
      if (value) void load();
    },
  );
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
    historyRequest?.abort();
    locationRequest?.abort();
  });
  return {
    batch,
    manufacturingDate,
    expiryDate,
    description,
    loading,
    saving,
    historyLoading,
    locationsLoading,
    locationsSortBy,
    locationsSortDirection,
    error,
    historyError,
    locationError,
    success,
    editing,
    dirty,
    validation,
    load,
    reload,
    beginEdit,
    cancelEdit,
    save,
    moreHistory,
    moreLocations,
    sortLocations,
  };
}
export type BatchDetailController = ReturnType<typeof useBatchDetailController>;
