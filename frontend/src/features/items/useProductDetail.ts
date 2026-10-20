import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  presentCatalogItem,
  type CatalogItem,
} from "../../lib/catalogPresentation";
import { newReportQuery, type ReportDataset } from "../../lib/reportContract";
import { useAttachments } from "../attachments/useAttachments";
import type { SavedItemConversions } from "../conversions/useConversionEditor";
import { useBrowseState } from "../../lib/browseMemory";
import { onCategoryRenamed } from "../../lib/categoryRename";
import { useMovementHistory } from "../movements/useMovementHistory";
export function useProductDetail(props: { code: string; tab?: string }) {
  const services = useInventoryServices(),
    reference = useReferenceData(),
    account = reference.user;
  const item = ref<CatalogItem>(),
    loading = ref(false),
    error = ref(""),
    tab = ref(props.tab === "batches" ? "batches" : "overview"),
    conversionDirty = ref(false);
  let generation = 0,
    disposed = false,
    request: AbortController | undefined;
  const active = () => !disposed && reference.user === account;
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
    request?.abort();
    request = new AbortController();
    loading.value = true;
    error.value = "";
    if (item.value?.item_code !== props.code) {
      item.value = undefined;
      files.clear();
    }
    try {
      const result = await services.call<CatalogItem>(
        "catalog.operation_item",
        { item_code: props.code },
        request.signal,
      );
      if (!active() || current !== generation) return;
      item.value = result;
      files.load(result.attachments || [], result.image);
    } catch (reason) {
      if (active() && current === generation)
        error.value =
          reason instanceof Error ? reason.message : "物品不存在或无权访问";
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
  watch(
    () => props.code,
    () => {
      tab.value = props.tab === "batches" ? "batches" : "overview";
      void load();
    },
    { immediate: true },
  );
  watch(
    () => props.tab,
    (value) => {
      tab.value = value === "batches" ? "batches" : "overview";
    },
  );
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
    tab,
    batches,
    files,
    exportQuery,
    movementQuery,
    loanQuery,
    movements,
    loans,
    load,
    conversionsUpdated,
    conversionDirty,
  };
}
export type ProductDetail = ReturnType<typeof useProductDetail>;
