import { computed, onBeforeUnmount, ref } from "vue";
import { useInventoryServices } from "../../services/contracts";
import type { CatalogItem } from "../../lib/catalogPresentation";
export interface ScanResult { unknown: boolean; barcode: string; matches: CatalogItem[]; batches: string[]; warehouse?: { name: string; label: string; is_group: boolean } }
export function useScanController(props: { paused?: boolean; allowCreate?: boolean }, item: (code: string, batch?: string) => void, location: (name: string) => void) {
  const services = useInventoryServices();
  const value = ref(""), result = ref<ScanResult>(), loading = ref(false), error = ref(""), camera = ref(false), continuous = ref(true), stopped = ref(false), recent = ref<string[]>([]);
  let generation = 0, disposed = false; let request: AbortController | undefined;
  const paused = computed(() => props.paused || stopped.value || loading.value);
  async function scan(scanned = value.value) {
    if (props.paused || stopped.value || !scanned.trim()) return;
    const current = ++generation; request?.abort(); request = new AbortController();
    const barcode = scanned.trim(); value.value = barcode; loading.value = true; error.value = ""; result.value = undefined;
    try {
      const data = await services.call<ScanResult>("catalog.scan_code", { value: barcode }, request.signal);
      if (disposed || current !== generation) return;
      result.value = data; recent.value = [barcode, ...recent.value.filter((row) => row !== barcode)].slice(0, 5);
    } catch (reason) { if (!disposed && current === generation) error.value = reason instanceof Error ? reason.message : "条码读取失败，输入已保留"; }
    finally { if (!disposed && current === generation) loading.value = false; }
  }
  function choose(code?: string) {
    if (!result.value || props.paused) return;
    if (code) item(code, result.value.batches.length === 1 ? result.value.batches[0] : undefined);
    else if (result.value.warehouse && !result.value.warehouse.is_group) location(result.value.warehouse.name);
    else return;
    stopped.value = !continuous.value; result.value = undefined;
    // Keep the scanned text until the next deliberate lookup or edit.
  }
  onBeforeUnmount(() => { disposed = true; generation++; request?.abort(); });
  return { value, result, loading, error, camera, continuous, stopped, recent, paused, scan, choose };
}
