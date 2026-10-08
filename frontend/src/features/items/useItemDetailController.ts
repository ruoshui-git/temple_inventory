import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, upload, workspaceApi } from "../../lib/api";
import { warehousePresentation } from "../../lib/warehousePresenter";
import { toast } from "../../lib/toast";
import { returnToOpener } from "../../lib/navigation";
import { formatExpiryDuration } from "../../lib/duration";

export function useItemDetailController() {
  const route = useRoute(),
    router = useRouter(),
    item = ref<any>(),
    boot = ref<any>(),
    error = ref(""),
    chosen = ref(""),
    editing = ref(false),
    saving = ref(false),
    scanner = ref(false);
  const selectedImage = computed(
    () =>
      item.value?.images?.find(
        (image: any) => image.file_url === chosen.value,
      ) || item.value?.images?.[0],
  );
  const itemGroups = computed(() =>
    (boot.value?.item_groups || []).filter(
      (group: any) => group.name !== "All Item Groups",
    ),
  );
  const operationCaps = computed(
    () => boot.value?.stock_operation_capabilities || {},
  );
  const warehouseText = (name: string) =>
    warehousePresentation(name, boot.value?.warehouse_tree || []).breadcrumb;
  const batchSort = ref<"expiry_date" | "total_qty">("expiry_date");
  const batchSortOrder = ref<"asc" | "desc">("asc");
  const batches = computed(() =>
    [...(item.value?.batches || [])].sort((a: any, b: any) => {
      const left =
        batchSort.value === "expiry_date"
          ? String(a.expiry_date || "9999-12-31")
          : Number(a.total_qty ?? a.qty ?? 0);
      const right =
        batchSort.value === "expiry_date"
          ? String(b.expiry_date || "9999-12-31")
          : Number(b.total_qty ?? b.qty ?? 0);
      const result =
        left < right
          ? -1
          : left > right
            ? 1
            : String(a.batch_no).localeCompare(String(b.batch_no));
      return batchSortOrder.value === "asc" ? result : -result;
    }),
  );
  function toggleBatchSort(column: "expiry_date" | "total_qty") {
    if (batchSort.value === column)
      batchSortOrder.value = batchSortOrder.value === "asc" ? "desc" : "asc";
    else {
      batchSort.value = column;
      batchSortOrder.value = "asc";
    }
  }
  const batchSelected = (batch: any) =>
    String(route.query.batch || "") === String(batch.batch_no);
  const signedChange = (value: number) => `${value > 0 ? "+" : ""}${value}`;
  function operation(kind: string) {
    sessionStorage.setItem(
      `ti-seed:${kind}`,
      JSON.stringify({ items: [item.value?.item_code] }),
    );
    void router.push(`/new/${kind}`);
  }
  function addBarcode(value: string) {
    const codes = String(item.value?.barcodes || "")
      .split(/[\n,]/)
      .map((code: string) => code.trim())
      .filter(Boolean);
    if (!codes.includes(value))
      item.value.barcodes = [...codes, value].join("\n");
    scanner.value = false;
  }
  function close() {
    void returnToOpener(router, "/");
  }
  function retry() {
    router.go(0);
  }
  async function saveEdit() {
    if (!item.value) return;
    saving.value = true;
    try {
      const value = await api("update_item", {
        item_code: item.value.item_code,
        data: {
          item_name: item.value.item_name,
          item_group: item.value.item_group,
          description: item.value.description,
          image: item.value.image,
          barcodes: String(item.value.barcodes || "")
            .split(/[\n,]/)
            .map((code: string) => code.trim())
            .filter(Boolean),
        },
      });
      Object.assign(item.value, value, {
        barcodes: (value.barcodes || []).join("\n"),
      });
      editing.value = false;
      toast("物品资料已保存");
    } catch (cause: any) {
      error.value = cause.message;
      toast(cause.message, "error");
    } finally {
      saving.value = false;
    }
  }
  async function uploadAttachments(files: File[]) {
    try {
      for (const file of files)
        await upload(file, "Item", item.value.item_code);
      item.value = await workspaceApi("item_detail", {
        item_code: item.value.item_code,
      });
    } catch (cause: any) {
      error.value = cause.message;
    }
  }
  async function setPrimary(file: any) {
    try {
      await api("set_item_image", {
        item_code: item.value.item_code,
        image: file.file_url,
      });
      item.value = await workspaceApi("item_detail", {
        item_code: item.value.item_code,
      });
      chosen.value = file.file_url;
      toast("主图已更新");
    } catch (cause: any) {
      error.value = cause.message;
    }
  }
  async function removeFile(file: any) {
    try {
      if (
        file.file_url === item.value.image &&
        !window.confirm("此文件是主图，确定清除主图并删除吗？")
      )
        return;
      item.value = await workspaceApi("remove_item_attachment", {
        item_code: item.value.item_code,
        file_name: file.name,
        clear_primary: file.file_url === item.value.image ? 1 : 0,
      });
    } catch (cause: any) {
      error.value = cause.message;
    }
  }
  onMounted(async () => {
    try {
      [boot.value, item.value] = await Promise.all([
        api("bootstrap"),
        workspaceApi("item_detail", { item_code: route.params.code }),
      ]);
      item.value.barcodes = (item.value.barcodes || []).join("\n");
      chosen.value = item.value.images?.[0]?.file_url || "";
    } catch (cause: any) {
      error.value = cause.message;
    }
  });

  return {
    route,
    router,
    item,
    boot,
    error,
    chosen,
    editing,
    saving,
    scanner,
    selectedImage,
    itemGroups,
    operationCaps,
    warehouseText,
    batchSort,
    batchSortOrder,
    batches,
    toggleBatchSort,
    batchSelected,
    signedChange,
    formatExpiryDuration,
    operation,
    addBarcode,
    close,
    retry,
    saveEdit,
    uploadAttachments,
    setPrimary,
    removeFile,
  };
}

export type ItemDetailController = ReturnType<typeof useItemDetailController>;
