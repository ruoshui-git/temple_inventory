import { onBeforeUnmount, reactive, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";
import {
  presentCatalogItem,
  type CatalogItem,
} from "../../lib/catalogPresentation";
import type { StockItem } from "../../lib/stockPresentation";
import { onCategoryRenamed } from "../../lib/categoryRename";
export type PickerStockItem = StockItem & {
  pickerWarehouse: string;
  pickerWarehouseLabel: string;
  pickerQuantity: number;
};
export function useItemPicker(
  props: {
    eligible?: string[];
    timestamp?: string;
    receivingWarehouse?: string;
    purpose?: "outbound" | "damaged" | "inbound" | "count";
  },
  remember: (item: StockItem) => void,
) {
  const services = useInventoryServices(),
    reference = useReferenceData();
  const search = ref(""),
    categoryFilters = ref<string[]>([]),
    uncategorizedFilter = ref(false),
    warehouseFilters = ref<string[]>([]),
    onlyStock = ref(false),
    selected = ref<string[]>([]);
  const result = reactive({
    rows: [] as PickerStockItem[],
    total: 0,
    next: null as number | null,
    loading: false,
    loadingMore: false,
    initialized: false,
    error: "",
    stale: false,
  });
  let generation = 0,
    disposed = false,
    retryMore = false;
  const loadedItems = new Map<string, StockItem>();
  const pendingSelected = new Map<string, (() => void)[]>();
  let selectedFlushScheduled = false;
  let request: AbortController | undefined;
  const stopCategoryRename = onCategoryRenamed(({ oldName, category }) => {
    if (!categoryFilters.value.includes(oldName)) return;
    categoryFilters.value = [
      ...new Set(
        categoryFilters.value.map((name) =>
          name === oldName ? category.name : name,
        ),
      ),
    ];
  });
  async function load(more = false) {
    if (more && (result.loading || result.next === null)) return;
    retryMore = more;
    const current = ++generation;
    const account = reference.user;
    request?.abort();
    request = new AbortController();
    result.loading = true;
    result.loadingMore = more;
    result.error = "";
    if (!more) result.stale = result.rows.length > 0;
    if (!more) loadedItems.clear();
    try {
      const page = await services.call<{
        results: (CatalogItem & {
          warehouse?: string;
          warehouse_label?: string;
          picker_quantity?: number;
        })[];
        matched_count: number;
        next_start: number | null;
      }>(
        "catalog.picker_rows",
        {
          search: search.value,
          start: more ? result.next : 0,
          page_length: 50,
          ...(props.purpose === "inbound"
            ? {}
            : { warehouses: warehouseFilters.value }),
          categories: categoryFilters.value,
          uncategorized: uncategorizedFilter.value,
          purpose: props.purpose || "outbound",
          ...(props.purpose === "inbound" && props.receivingWarehouse
            ? { receiving_warehouse: props.receivingWarehouse }
            : {}),
          only_stock: onlyStock.value,
          ...(props.timestamp ? { timestamp: props.timestamp } : {}),
          ...(props.eligible ? { item_codes: props.eligible } : {}),
        },
        request.signal,
      );
      if (current !== generation || disposed || account !== reference.user)
        return;
      const rows: PickerStockItem[] = page.results.map((row) => ({
        ...presentCatalogItem(row),
        pickerWarehouse: row.warehouse || "",
        pickerWarehouseLabel: row.warehouse_label || "",
        pickerQuantity: Number(row.picker_quantity || 0),
      }));
      result.initialized = true;
      result.rows = more
        ? [
            ...result.rows,
            ...rows.filter(
              (row) =>
                !result.rows.some(
                  (previous) => pickerRowKey(previous) === pickerRowKey(row),
                ),
            ),
          ]
        : rows;
      result.total = page.matched_count;
      result.next = page.next_start;
      result.stale = false;
    } catch (reason) {
      if (current === generation && !disposed && account === reference.user)
        result.error =
          reason instanceof Error ? reason.message : "物品加载失败";
    } finally {
      if (current === generation && !disposed && account === reference.user)
        result.loading = false;
      result.loadingMore = false;
    }
  }
  function pickerRowKey(row: PickerStockItem) {
    return `${row.code}\u0000${row.pickerWarehouse || ""}`;
  }
  let observedAccount = reference.user;
  watch(
    () =>
      JSON.stringify([
        reference.user,
        search.value,
        categoryFilters.value,
        uncategorizedFilter.value,
        warehouseFilters.value,
        onlyStock.value,
        props.eligible,
        props.timestamp,
        props.purpose,
        props.receivingWarehouse,
      ]),
    () => {
      if (observedAccount !== reference.user) {
        observedAccount = reference.user;
        selected.value = [];
        result.rows = [];
        result.total = 0;
        result.next = null;
        result.error = "";
        result.stale = false;
        request?.abort();
      }
      void load();
    },
    { immediate: true },
  );
  async function ensureSelected(code: string) {
    const account = reference.user;
    if (!code || disposed || !account) return;
    const key = `${code}\u0000${props.timestamp || "now"}`;
    const cached = loadedItems.get(key);
    if (cached) {
      remember(cached);
      return;
    }
    await new Promise<void>((resolve) => {
      const pending = pendingSelected.get(key) || [];
      pending.push(resolve);
      pendingSelected.set(key, pending);
      if (selectedFlushScheduled) return;
      selectedFlushScheduled = true;
      queueMicrotask(() => void flushSelected(account));
    });
  }
  async function flushSelected(account: string) {
    selectedFlushScheduled = false;
    const keys = [...pendingSelected.keys()];
    const codes = keys.map((key) => key.slice(0, key.indexOf("\u0000")));
    const callbacks = new Map(
      keys.map((key) => [key, pendingSelected.get(key) || []]),
    );
    for (const key of keys) pendingSelected.delete(key);
    const resolveAll = () => {
      for (const key of keys) {
        for (const resolve of callbacks.get(key) || []) resolve();
      }
    };
    if (disposed || account !== reference.user) {
      resolveAll();
      return;
    }
    try {
      const result = await services.call<{
        items: CatalogItem[];
        errors: { item_code: string; error: string }[];
      }>("catalog.operation_items", {
        item_codes: codes,
        timestamp: props.timestamp,
      });
      if (!disposed && account === reference.user) {
        for (const item of result.items) {
          const presented = presentCatalogItem(item);
          loadedItems.set(
            `${item.item_code}\u0000${props.timestamp || "now"}`,
            presented,
          );
          remember(presented);
        }
      }
    } catch {
      // The receiving editor reports any complete-context read failure.
    } finally {
      resolveAll();
    }
  }
  function toggle(key: string) {
    const index = selected.value.indexOf(key);
    if (index < 0) selected.value.push(key);
    else selected.value.splice(index, 1);
  }
  onBeforeUnmount(() => {
    stopCategoryRename();
    disposed = true;
    generation++;
    request?.abort();
  });
  return {
    reference,
    search,
    categoryFilters,
    uncategorizedFilter,
    warehouseFilters,
    onlyStock,
    selected,
    result,
    load,
    retry: () => load(retryMore),
    ensureSelected,
    toggle,
    pickerRowKey,
  };
}
