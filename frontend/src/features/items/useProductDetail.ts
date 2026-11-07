import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  presentCatalogItem,
  type NativeFile,
  type CatalogItem,
} from "../../lib/catalogPresentation";
import { newReportQuery, type ReportDataset } from "../../lib/reportContract";
import { useAttachments } from "../attachments/useAttachments";
import type { SavedItemConversions } from "../conversions/useConversionEditor";
import { useBrowseState } from "../../lib/browseMemory";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { useMovementHistory } from "../movements/useMovementHistory";
import { isForbiddenError } from "../../lib/serviceFailure";
export function useProductDetail(props: { code: string; tab?: string }) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const item = ref<
      CatalogItem & {
        disabled?: boolean;
        tracking_changeable?: boolean;
        tracking_change_reason?: string;
        can_delete?: boolean;
        has_serial_no?: boolean;
      }
    >(),
    loading = ref(false),
    error = ref(""),
    lifecycleBusy = ref(false),
    tab = ref(
      ["batches", "serials"].includes(props.tab || "")
        ? props.tab!
        : "overview",
    ),
    serialRows = ref<Array<Record<string, unknown>>>([]),
    serialStatus = ref("Active"),
    serialSearch = ref(""),
    serialNext = ref<number | null>(null),
    serialLoading = ref(false),
    serialError = ref(""),
    conversionDirty = ref(false);
  const forbidden = ref(false);
  let generation = 0,
    serialGeneration = 0,
    disposed = false,
    request: AbortController | undefined;
  const active = () => !disposed && reference.user === account;
  async function loadItem(code: string, signal?: AbortSignal) {
    const result = await services.call<{
      items: CatalogItem[];
      errors: { item_code: string; error: string }[];
    }>("catalog.operation_items", { item_codes: [code] }, signal);
    const loaded = result.items.find((row) => row.item_code === code);
    if (!loaded)
      throw new Error(
        result.errors.find((row) => row.item_code === code)?.error ||
          "物品不存在或无权访问",
      );
    return loaded;
  }
  const files = useAttachments({
    account,
    currentAccount: () => reference.user,
    parent: () =>
      item.value ? { doctype: "Item", name: item.value.item_code } : undefined,
    writable: () => false,
  });
  const stockItem = computed(() =>
    item.value ? presentCatalogItem(item.value) : undefined,
  );
  async function loadSerials(reset = true) {
    if (!item.value?.has_serial_no) return;
    const current = ++serialGeneration;
    serialLoading.value = true;
    serialError.value = "";
    try {
      const result = await services.call<{
        rows: Array<Record<string, unknown>>;
        next: number | null;
      }>("catalog.item_serials", {
        item_code: props.code,
        status: serialStatus.value,
        search: serialSearch.value,
        start: reset ? 0 : serialNext.value || 0,
        limit: 50,
      });
      if (current !== serialGeneration || !active()) return;
      serialRows.value = reset
        ? result.rows
        : [...serialRows.value, ...result.rows];
      serialNext.value = result.next;
    } catch (reason) {
      if (current === serialGeneration)
        serialError.value =
          reason instanceof Error ? reason.message : "序列号读取失败";
    } finally {
      if (current === serialGeneration) serialLoading.value = false;
    }
  }
  const batches = computed(
    () =>
      stockItem.value?.locations.flatMap((place) =>
        (place.batches || []).map((batch) => ({
          ...batch,
          location: place.location,
          label: place.label,
        })),
      ) || [],
  );
  function query(dataset: ReportDataset) {
    const value = newReportQuery(dataset);
    value.scope.item = props.code;
    value.restrictItems = true;
    value.itemCodes = [props.code];
    return value;
  }
  const exportQuery = computed(() => query("inventory"));
  const movementQuery = computed(() => {
    const value = query("movements");
    value.view = "records";
    value.statuses = [1];
    value.sortBy = "date";
    value.sort = "desc";
    return value;
  });
  const loanQuery = computed(() => {
    const value = query("loans");
    value.view = "records";
    return value;
  });
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (item.value?.item_group === oldName)
      item.value.item_group = category.name;
  });
  const visible = computed(
    () => item.value?.item_code === props.code && active(),
  );
  const movements = useMovementHistory(movementQuery, {
    itemCode: () => props.code,
    enabled: () => visible.value,
  });
  const loans = useMovementHistory(loanQuery, {
    itemCode: () => props.code,
    enabled: () => visible.value,
    loanAllocations: true,
  });
  useBrowseState(
    "item-detail",
    () => [props.code, tab.value],
    () => ({}),
    () => undefined,
    () => !loading.value && !movements.result.loading && !loans.result.loading,
  );
  async function load() {
    const current = ++generation;
    serialGeneration++;
    serialRows.value = [];
    serialNext.value = null;
    request?.abort();
    request = new AbortController();
    loading.value = true;
    error.value = "";
    forbidden.value = false;
    if (item.value?.item_code !== props.code) {
      item.value = undefined;
      files.clear();
    }
    try {
      const [loaded, lifecycle, attachmentFiles] = await Promise.all([
        loadItem(props.code, request.signal),
        services.call<{
          disabled: boolean;
          tracking_changeable: boolean;
          tracking_change_reason: string;
          can_delete: boolean;
        }>("catalog.item_lifecycle", { item_code: props.code }, request.signal),
        services
          .call<NativeFile[]>(
            "native_files.attachments",
            { doctype: "Item", name: props.code },
            request.signal,
          )
          .catch(() => []),
      ]);
      const result = { ...loaded, ...lifecycle };
      if (!active() || current !== generation) return;
      item.value = result;
      if (tab.value === "serials" && result.has_serial_no)
        void loadSerials(true);
      files.load(
        attachmentFiles.length ? attachmentFiles : result.attachments || [],
        result.image,
      );
    } catch (reason) {
      if (active() && current === generation) {
        forbidden.value = isForbiddenError(reason);
        if (forbidden.value) {
          item.value = undefined;
          files.clear();
        }
        error.value =
          reason instanceof Error ? reason.message : "物品不存在或无权访问";
      }
    } finally {
      if (active() && current === generation) loading.value = false;
    }
  }
  function conversionsUpdated(value: SavedItemConversions) {
    if (item.value && value.item_code === item.value.item_code) {
      item.value.version = value.version;
      item.value.uoms = value.conversions;
    }
  }
  async function setDisabled(disabled: boolean) {
    if (!item.value || lifecycleBusy.value) return;
    lifecycleBusy.value = true;
    try {
      const result = await services.call<{ version: string }>(
        "catalog.set_item_disabled",
        {
          item_code: item.value.item_code,
          disabled,
          version: item.value.version,
        },
      );
      if (item.value) {
        item.value.version = result.version;
        item.value.disabled = disabled;
      }
    } finally {
      lifecycleBusy.value = false;
    }
  }
  async function deleteItem() {
    if (!item.value || lifecycleBusy.value) return false;
    lifecycleBusy.value = true;
    try {
      await services.call("catalog.delete_item", {
        item_code: item.value.item_code,
        version: item.value.version,
      });
      item.value = undefined;
      return true;
    } finally {
      lifecycleBusy.value = false;
    }
  }
  watch(
    () => props.code,
    () => {
      tab.value = ["batches", "serials"].includes(props.tab || "")
        ? props.tab!
        : "overview";
      void load();
    },
    { immediate: true },
  );
  watch(
    () => props.tab,
    (value) => {
      tab.value = ["batches", "serials"].includes(value || "")
        ? value!
        : "overview";
    },
  );
  watch([tab, serialStatus, serialSearch], () => {
    if (tab.value === "serials") void loadSerials(true);
  });
  onBeforeUnmount(() => {
    stopCategoryRename();
    disposed = true;
    generation++;
    request?.abort();
  });
  return {
    item,
    stockItem,
    loading,
    error,
    forbidden,
    tab,
    batches,
    serialRows,
    serialStatus,
    serialSearch,
    serialNext,
    serialLoading,
    serialError,
    loadSerials,
    files,
    exportQuery,
    movementQuery,
    loanQuery,
    movements,
    loans,
    load,
    conversionsUpdated,
    conversionDirty,
    lifecycleBusy,
    setDisabled,
    deleteItem,
  };
}
export type ProductDetail = ReturnType<typeof useProductDetail>;
