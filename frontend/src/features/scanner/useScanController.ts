import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useInventoryServices } from "../../services/contracts";
import type { CatalogItem } from "../../lib/catalogPresentation";

export interface ScanResult {
  unknown: boolean;
  barcode: string;
  matches: CatalogItem[];
  batches: string[];
  warehouse?: { name: string; label: string; is_group: boolean };
  scanContext?: unknown;
}

type ScanRequest = { barcode: string; context: unknown };
type ScanAcknowledger = (
  code: string,
  batch?: string,
  context?: unknown,
) => void | Promise<void>;
type LocationAcknowledger = (
  name: string,
  context?: unknown,
) => void | Promise<void>;

export function useScanController(
  props: { paused?: boolean; allowCreate?: boolean; autoUnique?: boolean },
  item: ScanAcknowledger,
  location: LocationAcknowledger,
  captureContext?: () => unknown,
) {
  const services = useInventoryServices();
  const value = ref("");
  const result = ref<ScanResult>();
  const loading = ref(false);
  const error = ref("");
  const camera = ref(false);
  const continuous = ref(true);
  const stopped = ref(false);
  const recent = ref<string[]>([]);
  const queue: ScanRequest[] = [];
  const pendingCount = ref(0);
  const paused = computed(() => props.paused || stopped.value);
  let generation = 0;
  let disposed = false;
  let draining = false;
  let request: AbortController | undefined;
  let retryPending: (() => Promise<void>) | undefined;

  function remember(barcode: string) {
    recent.value = [
      barcode,
      ...recent.value.filter((row) => row !== barcode),
    ].slice(0, 5);
  }
  function canResolveAutomatically(data: ScanResult) {
    if (!props.autoUnique) return false;
    if (data.matches.length === 1 && !data.warehouse) return true;
    return (
      !data.matches.length &&
      Boolean(data.warehouse && !data.warehouse.is_group)
    );
  }
  function afterAccepted() {
    if (!continuous.value) stopped.value = true;
  }
  async function acknowledgeItem(
    code: string,
    batch: string | undefined,
    context: unknown,
    ownGeneration: number,
  ) {
    await item(code, batch, context);
    return !disposed && ownGeneration === generation;
  }
  async function acknowledgeLocation(
    name: string,
    context: unknown,
    ownGeneration: number,
  ) {
    await location(name, context);
    return !disposed && ownGeneration === generation;
  }
  async function drain() {
    if (draining || disposed || paused.value || result.value || error.value)
      return;
    draining = true;
    const ownGeneration = generation;
    try {
      while (
        queue.length &&
        !disposed &&
        ownGeneration === generation &&
        !paused.value &&
        !result.value &&
        !error.value
      ) {
        const current = queue[0]!;
        value.value = current.barcode;
        loading.value = true;
        request = new AbortController();
        let data: ScanResult;
        try {
          data = await services.call<ScanResult>(
            "catalog.scan_code",
            { value: current.barcode },
            request.signal,
          );
        } catch (reason) {
          if (
            request.signal.aborted ||
            disposed ||
            ownGeneration !== generation
          )
            return;
          error.value =
            reason instanceof Error
              ? reason.message
              : "条码读取失败，输入已保留";
          break;
        }
        if (disposed || ownGeneration !== generation) return;
        if (canResolveAutomatically(data)) {
          try {
            if (data.matches.length === 1) {
              const matched = data.matches[0]!;
              await acknowledgeItem(
                matched.item_code,
                data.batches.length === 1 ? data.batches[0] : undefined,
                current.context,
                ownGeneration,
              );
            } else if (data.warehouse) {
              await acknowledgeLocation(
                data.warehouse.name,
                current.context,
                ownGeneration,
              );
            }
          } catch (reason) {
            if (ownGeneration !== generation || disposed) return;
            error.value =
              reason instanceof Error ? reason.message : "扫描明细未能添加";
            break;
          }
          if (disposed || ownGeneration !== generation) return;
          queue.shift();
          pendingCount.value = queue.length;
          remember(current.barcode);
          afterAccepted();
          if (stopped.value) break;
          continue;
        }
        result.value = { ...data, scanContext: current.context };
        break;
      }
    } finally {
      if (ownGeneration === generation && !disposed) {
        loading.value = false;
        draining = false;
      }
    }
  }
  function scan(scanned = value.value) {
    if (props.paused || stopped.value || !scanned.trim()) return;
    const barcode = scanned.trim();
    value.value = barcode;
    if (error.value && queue[0]?.barcode === barcode) {
      error.value = "";
      if (retryPending) void retryPending();
      else void drain();
      return;
    }
    error.value = "";
    queue.push({ barcode, context: captureContext?.() });
    pendingCount.value = queue.length;
    remember(barcode);
    void drain();
  }
  async function choose(code?: string, batch?: string) {
    const currentResult = result.value;
    const current = queue[0];
    if (!currentResult || !current || props.paused) return;
    if (code) {
      if (!currentResult.matches.some((match) => match.item_code === code))
        return;
      try {
        await item(
          code,
          batch ||
            (currentResult.batches.length === 1
              ? currentResult.batches[0]
              : undefined),
          current.context,
        );
      } catch (reason) {
        if (disposed || result.value !== currentResult || queue[0] !== current)
          return;
        error.value =
          reason instanceof Error ? reason.message : "扫描明细未能添加";
        retryPending = () => choose(code, batch);
        return;
      }
    } else if (currentResult.warehouse && !currentResult.warehouse.is_group) {
      try {
        await location(currentResult.warehouse.name, current.context);
      } catch (reason) {
        if (disposed || result.value !== currentResult || queue[0] !== current)
          return;
        error.value = reason instanceof Error ? reason.message : "库位未能应用";
        retryPending = () => choose();
        return;
      }
    } else return;
    if (disposed || result.value !== currentResult) return;
    queue.shift();
    retryPending = undefined;
    pendingCount.value = queue.length;
    remember(current.barcode);
    result.value = undefined;
    afterAccepted();
    if (!stopped.value) void drain();
  }
  async function chooseGroupLocation(name: string) {
    const currentResult = result.value;
    const current = queue[0];
    if (!currentResult?.warehouse?.is_group || !current || props.paused) return;
    try {
      await location(name, current.context);
    } catch (reason) {
      if (disposed || result.value !== currentResult || queue[0] !== current)
        return;
      error.value = reason instanceof Error ? reason.message : "库位未能应用";
      retryPending = () => chooseGroupLocation(name);
      return;
    }
    if (disposed || result.value !== currentResult) return;
    queue.shift();
    retryPending = undefined;
    pendingCount.value = queue.length;
    remember(current.barcode);
    result.value = undefined;
    afterAccepted();
    if (!stopped.value) void drain();
  }
  function skipResult() {
    if (result.value && queue.length) {
      const [skipped] = queue.splice(0, 1);
      if (skipped) remember(skipped.barcode);
    }
    pendingCount.value = queue.length;
    result.value = undefined;
    retryPending = undefined;
    afterAccepted();
    if (!stopped.value) void drain();
  }
  function retry() {
    error.value = "";
    if (retryPending) void retryPending();
    else void drain();
  }
  function cancelPending() {
    generation++;
    request?.abort();
    request = undefined;
    retryPending = undefined;
    queue.splice(0);
    pendingCount.value = 0;
    result.value = undefined;
    error.value = "";
    loading.value = false;
    draining = false;
    stopped.value = false;
  }
  function hold() {
    stopped.value = true;
  }
  function resume() {
    stopped.value = false;
  }
  watch(
    () => props.paused,
    (value, previous) => {
      if (previous && !value) void drain();
    },
  );
  watch(stopped, (value) => {
    if (!value) void drain();
  });
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    request?.abort();
  });
  return {
    value,
    result,
    loading,
    error,
    camera,
    continuous,
    stopped,
    recent,
    paused,
    pendingCount,
    scan,
    choose,
    chooseGroupLocation,
    skipResult,
    retry,
    cancelPending,
    hold,
    resume,
  };
}
