import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, upload, workspaceApi } from "../../lib/api";
import { warehousePresentation } from "../../lib/warehousePresenter";
import { toast } from "../../lib/toast";
import { returnToOpener } from "../../lib/navigation";

export function useReconciliationController() {
  const route = useRoute(),
    router = useRouter();
  const requestId = crypto.randomUUID().replaceAll("-", "");
  const boot = ref<any>(),
    record = ref<any>(),
    error = ref(""),
    loading = ref(true),
    saving = ref(false),
    scanner = ref(false),
    conflict = ref(false);
  const warehouse = ref(""),
    mode = ref("selective"),
    search = ref(""),
    results = ref<any[]>([]),
    postingDate = ref(""),
    postingTime = ref("");
  const rows = ref<any[]>([]),
    notes = ref(""),
    batchChoices = ref<any[]>([]),
    batchItem = ref<any>(),
    review = ref(false);
  const reviewDialog = ref<HTMLElement>(),
    reviewTrigger = ref<HTMLElement>();
  const audit = ref({
    recorder_name: "",
    handler_name: "",
    reviewer_name: "",
  });
  const readonly = computed(() =>
    Boolean(
      record.value?.stock_reconciliation ||
      record.value?.docstatus === 1 ||
      !boot.value?.can_reconcile_stock,
    ),
  );
  const leaves = computed(() =>
    (boot.value?.physical_tree || []).filter((row: any) =>
      (boot.value?.reconciliation_warehouses || []).includes(row.name),
    ),
  );
  const warehouseLabel = (name: string, _tree?: any[]) =>
    warehousePresentation(name, _tree || boot.value?.warehouse_tree || [])
      .breadcrumb;
  const countedRows = computed(() =>
    rows.value.filter(
      (row) =>
        row.count_state === "counted" ||
        row.count_state === "not_found" ||
        row.counted_qty !== "",
    ),
  );
  const discrepancyRows = computed(() =>
    countedRows.value.filter(
      (row) => Number(row.counted_qty) !== Number(row.ledger_qty),
    ),
  );
  const uomSummary = computed(() =>
    countedRows.value.reduce(
      (
        summary: Record<string, { increase: number; decrease: number }>,
        row,
      ) => {
        const uom = row.uom || "";
        summary[uom] ||= { increase: 0, decrease: 0 };
        const delta = Number(row.counted_qty) - Number(row.ledger_qty);
        if (delta > 0) summary[uom].increase += delta;
        if (delta < 0) summary[uom].decrease += Math.abs(delta);
        return summary;
      },
      {},
    ),
  );
  function adopt(data: any) {
    record.value = data;
    const payload = data.data || {};
    warehouse.value = payload.warehouse || warehouse.value;
    mode.value = payload.mode || "selective";
    postingDate.value = payload.posting_date || "";
    postingTime.value = payload.posting_time || "";
    notes.value = payload.notes || "";
    rows.value = (payload.items || []).map((row: any) => ({
      ...row,
      count_state:
        row.count_state ||
        (row.counted_qty !== "" && row.counted_qty != null ? "counted" : ""),
    }));
    audit.value = {
      recorder_name: payload.recorder_name || "",
      handler_name: payload.handler_name || "",
      reviewer_name: payload.reviewer_name || "",
    };
  }
  async function load() {
    try {
      boot.value = await api("bootstrap");
      if (!boot.value.can_read_reconciliations && route.params.name)
        throw new Error("您没有查看盘点记录的权限");
      if (route.params.name) {
        try {
          adopt(
            await workspaceApi("load_workspace", { name: route.params.name }),
          );
        } catch {
          adopt(
            await workspaceApi("open_reconciliation", {
              name: route.params.name,
            }),
          );
        }
      } else {
        if (!boot.value.can_reconcile_stock)
          throw new Error("您没有发起盘点调整的权限");
        warehouse.value = leaves.value[0]?.name || "";
        postingDate.value = new Date().toISOString().slice(0, 10);
        postingTime.value = new Date().toTimeString().slice(0, 8);
      }
    } catch (cause: any) {
      error.value = cause.message;
    } finally {
      loading.value = false;
    }
  }
  async function find() {
    if (!warehouse.value || !search.value) return;
    try {
      const data = await api("inventory", {
        mode: "current",
        search: search.value,
        warehouses: [warehouse.value],
        page_length: 20,
      });
      results.value = data.results || [];
    } catch (cause: any) {
      error.value = cause.message;
    }
  }
  async function add(item: any, batchNo = "") {
    if (item.has_batch_no && !batchNo) {
      batchItem.value = item;
      batchChoices.value = await workspaceApi("reconciliation_batches", {
        item_code: item.item_code,
        warehouse: warehouse.value,
      });
      return;
    }
    const existing = rows.value.find(
      (row) =>
        row.item_code === item.item_code && (row.batch_no || "") === batchNo,
    );
    if (existing) {
      existing.counted_qty = Number(existing.counted_qty || 0) + 1;
      existing.count_state = "counted";
    } else
      rows.value.push({
        item_code: item.item_code,
        warehouse: warehouse.value,
        uom: item.stock_uom,
        ledger_qty:
          batchChoices.value.find((row) => row.batch_no === batchNo)?.qty ??
          item.warehouse_stock?.[warehouse.value] ??
          0,
        counted_qty: "",
        count_state: "",
        item_name: item.item_name,
        image: item.image,
        batch_no: batchNo,
      });
    batchItem.value = undefined;
    batchChoices.value = [];
    results.value = [];
    search.value = "";
    void persist();
  }
  function markNotFound(row: any) {
    row.counted_qty = 0;
    row.count_state = "not_found";
    void persist();
  }
  async function scan(value: string) {
    scanner.value = false;
    search.value = value;
    await nextTick();
    await find();
  }
  function close() {
    void returnToOpener(router, "/movements");
  }
  function payload() {
    return {
      ...audit.value,
      warehouse: warehouse.value,
      mode: mode.value,
      posting_date: postingDate.value,
      posting_time: postingTime.value,
      notes: notes.value,
      items: rows.value,
    };
  }
  function resetPostingTime() {
    if (readonly.value) return;
    postingDate.value = new Date().toISOString().slice(0, 10);
    postingTime.value = new Date().toTimeString().slice(0, 8);
    void persist();
  }
  let persistChain: Promise<void> = Promise.resolve();
  async function persistNow() {
    if (readonly.value || !warehouse.value) return;
    saving.value = true;
    error.value = "";
    try {
      const creating = !record.value?.name;
      const result = creating
        ? await workspaceApi("create_reconciliation", {
            request_id: requestId,
            data: payload(),
          })
        : await workspaceApi("save_reconciliation", {
            name: record.value.name,
            revision: record.value.revision,
            data: payload(),
          });
      adopt(result);
      if (creating)
        await router.replace(`/reconcile/${encodeURIComponent(result.name)}`);
      window.dispatchEvent(new Event("ti:refresh-shell"));
    } catch (cause: any) {
      error.value = cause.message;
    } finally {
      saving.value = false;
    }
  }
  function persist() {
    persistChain = persistChain.then(persistNow);
    return persistChain;
  }
  async function confirm() {
    review.value = false;
    await persist();
    if (error.value || !record.value?.name) return;
    try {
      saving.value = true;
      conflict.value = false;
      adopt(
        await workspaceApi("confirm_reconciliation", {
          name: record.value.name,
          revision: record.value.revision,
        }),
      );
      toast("盘点已完成");
      window.dispatchEvent(new Event("ti:refresh-shell"));
    } catch (cause: any) {
      error.value = cause.message;
      conflict.value = String(cause.message || "").includes("账面数量");
    } finally {
      saving.value = false;
    }
  }
  async function refreshBaseline() {
    if (!record.value?.name) return;
    try {
      saving.value = true;
      adopt(
        await workspaceApi("refresh_reconciliation_baseline", {
          name: record.value.name,
          revision: record.value.revision,
        }),
      );
      conflict.value = false;
      error.value = "";
    } catch (cause: any) {
      error.value = cause.message;
    } finally {
      saving.value = false;
    }
  }
  async function showReview() {
    await persist();
    if (error.value) return;
    if (
      !rows.value.some(
        (row) =>
          row.count_state === "counted" || row.count_state === "not_found",
      )
    ) {
      error.value = "请至少确认一行盘点数量";
      return;
    }
    review.value = true;
  }
  async function attach(event: Event) {
    if (!record.value?.name) {
      await persist();
      if (!record.value?.name) return;
    }
    for (const file of Array.from(
      (event.target as HTMLInputElement).files || [],
    ))
      await upload(file, "Inventory Workspace", record.value.name);
    adopt(await workspaceApi("load_workspace", { name: record.value.name }));
  }
  async function uploadAttachmentFiles(files: File[]) {
    if (!record.value?.name) {
      await persist();
      if (!record.value?.name) return;
    }
    for (const file of files)
      await upload(file, "Inventory Workspace", record.value.name);
    adopt(await workspaceApi("load_workspace", { name: record.value.name }));
  }
  async function removeFile(name: string) {
    if (!record.value?.name) return;
    adopt(
      await workspaceApi("remove_attachment", {
        name: record.value.name,
        file_name: name,
      }),
    );
  }
  async function removeAttachmentFile(file: any) {
    await removeFile(file.name);
  }
  onMounted(load);
  watch(review, async (open) => {
    if (open) {
      reviewTrigger.value =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
      await nextTick(() => reviewDialog.value?.focus());
    } else await nextTick(() => reviewTrigger.value?.focus());
  });
  function trapReview(event: KeyboardEvent) {
    const focusable = reviewDialog.value
      ? Array.from(
          reviewDialog.value.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        )
      : [];
    if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && current <= 0) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && current === focusable.length - 1) {
      event.preventDefault();
      focusable[0].focus();
    }
  }

  return {
    route,
    router,
    requestId,
    boot,
    record,
    error,
    loading,
    saving,
    scanner,
    conflict,
    warehouse,
    mode,
    search,
    results,
    postingDate,
    postingTime,
    rows,
    notes,
    batchChoices,
    batchItem,
    review,
    reviewDialog,
    reviewTrigger,
    audit,
    readonly,
    leaves,
    warehouseLabel,
    countedRows,
    discrepancyRows,
    uomSummary,
    adopt,
    load,
    find,
    add,
    markNotFound,
    scan,
    close,
    payload,
    resetPostingTime,
    persistChain,
    persistNow,
    persist,
    confirm,
    refreshBaseline,
    showReview,
    attach,
    uploadAttachmentFiles,
    removeFile,
    removeAttachmentFile,
    trapReview,
  };
}

export type ReconciliationController = ReturnType<
  typeof useReconciliationController
>;
