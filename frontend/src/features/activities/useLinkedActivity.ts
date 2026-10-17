import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  useInventoryServices,
  useReferenceData,
} from "../../services/contracts";

/** Resolve existing links independently of the active-only assignment picker. */
export function useLinkedActivity(
  activity: () => string,
  documentSnapshot: () => object | undefined,
) {
  const services = useInventoryServices();
  const reference = useReferenceData();
  const account = reference.user;
  const site = reference.site;
  const resolved = ref("");
  const loading = ref(false);
  let request: AbortController | undefined;
  let disposed = false;
  const active = () =>
    !disposed && reference.user === account && reference.site === site;
  const label = computed(() => {
    if (!activity()) return "未填写";
    if (!active()) return "活动暂不可用";
    if (resolved.value === activity())
      return (
        reference.activities.find((row) => row.value === activity())?.label ||
        "活动暂不可用"
      );
    return loading.value ? "正在读取活动…" : "活动暂不可用";
  });

  async function refresh() {
    request?.abort();
    const current = new AbortController();
    request = current;
    const id = activity();
    resolved.value = "";
    loading.value = false;
    if (!id || !active()) return;
    loading.value = true;
    try {
      // This endpoint checks app access and the exact Activity's read permission;
      // archived records remain readable without becoming new picker candidates.
      const result = await services.call<{ name: string; title: string }>(
        "activities.load_activity",
        { name: id },
        current.signal,
      );
      if (request !== current || !active() || activity() !== id) return;
      if (result.name !== id || !result.title) return;
      const option = reference.activities.find((row) => row.value === id);
      if (option) option.label = result.title;
      else reference.activities.push({ value: id, label: result.title });
      resolved.value = id;
    } catch {
      // Do not retain a previously cached title when access can no longer be verified.
    } finally {
      if (request === current) loading.value = false;
    }
  }

  watch(
    [activity, documentSnapshot, () => reference.user, () => reference.site],
    refresh,
    { immediate: true },
  );
  onMounted(() => {
    window.addEventListener("focus", refresh);
    document.addEventListener("inventory-session-restored", refresh);
  });
  onBeforeUnmount(() => {
    disposed = true;
    request?.abort();
    window.removeEventListener("focus", refresh);
    document.removeEventListener("inventory-session-restored", refresh);
  });
  return label;
}
