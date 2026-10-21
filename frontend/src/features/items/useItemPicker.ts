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
export function useItemPicker(
  props: { eligible?: string[]; timestamp?: string },
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
    rows: [] as StockItem[],
    total: 0,
    next: null as number | null,
    loading: false,
    error: "",
    stale: false,
  });
  const details = ref<StockItem>(),
    detailError = ref(""),
    detailLoading = ref(false);
  let generation = 0,
    detailGeneration = 0,
    disposed = false,
    retryMore = false;
  let request: AbortController | undefined,
    detailRequest: AbortController | undefined;
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
    request?.abort();
    request = new AbortController();
    result.loading = true;
    result.error = "";
    if (!more) result.stale = result.rows.length > 0;
    try {
      const page = await services.call<{
        results: CatalogItem[];
        matched_count: number;
        next_start: number | null;
      }>(
        "catalog.search_items",
        {
          search: search.value,
          start: more ? result.next : 0,
          page_length: 50,
          warehouses: warehouseFilters.value,
          categories: categoryFilters.value,
          uncategorized: uncategorizedFilter.value,
          in_stock_only: onlyStock.value,
          ...(props.timestamp ? { timestamp: props.timestamp } : {}),
          ...(props.eligible ? { item_codes: props.eligible } : {}),
        },
        request.signal,
      );
      if (current !== generation || disposed) return;
      const rows = page.results.map(presentCatalogItem);
      rows.forEach(remember);
      result.rows = more
        ? [
            ...result.rows,
            ...rows.filter(
              (row) =>
                !result.rows.some((previous) => previous.code === row.code),
            ),
          ]
        : rows;
      result.total = page.matched_count;
      result.next = page.next_start;
      result.stale = false;
    } catch (reason) {
      if (current === generation && !disposed)
        result.error =
          reason instanceof Error ? reason.message : "物品加载失败";
    } finally {
      if (current === generation && !disposed) result.loading = false;
    }
  }
  watch(
    () =>
      JSON.stringify([
        search.value,
        categoryFilters.value,
        uncategorizedFilter.value,
        warehouseFilters.value,
        onlyStock.value,
        props.eligible,
        props.timestamp,
      ]),
    () => {
      void load();
    },
    { immediate: true },
  );
  async function showDetail(code: string) {
    const current = ++detailGeneration;
    detailRequest?.abort();
    details.value = undefined;
    detailError.value = "";
    if (!code) return;
    detailRequest = new AbortController();
    detailLoading.value = true;
    try {
      const item = await services.call<CatalogItem>(
        "catalog.operation_item",
        { item_code: code, timestamp: props.timestamp },
        detailRequest.signal,
      );
      if (current !== detailGeneration || disposed) return;
      details.value = presentCatalogItem(item);
      remember(details.value);
    } catch (reason) {
      if (current === detailGeneration && !disposed)
        detailError.value =
          reason instanceof Error ? reason.message : "库存详情读取失败";
    } finally {
      if (current === detailGeneration && !disposed)
        detailLoading.value = false;
    }
  }
  function toggle(code: string) {
    const index = selected.value.indexOf(code);
    if (index < 0) selected.value.push(code);
    else selected.value.splice(index, 1);
  }
  onBeforeUnmount(() => {
    stopCategoryRename();
    disposed = true;
    generation++;
    detailGeneration++;
    request?.abort();
    detailRequest?.abort();
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
    details,
    detailError,
    detailLoading,
    load,
    retry: () => load(retryMore),
    showDetail,
    toggle,
  };
}
