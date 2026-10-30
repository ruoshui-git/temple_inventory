import { computed, onBeforeUnmount, ref, watch } from "vue";
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
  const rejected = ref("");
  const loading = ref(false);
  let request: AbortController | undefined;
  let disposed = false;
  const active = () =>
    !disposed && reference.user === account && reference.site === site;
  const label = computed(() => {
    if (!activity()) return "未填写";
    if (!active()) return "活动暂不可用";
    if (rejected.value === activity()) return "活动暂不可用";
    const known = reference.activities.find((row) => row.value === activity());
    if (resolved.value === activity() || known)
      return known?.label || "活动暂不可用";
    return loading.value ? "正在读取活动…" : "活动暂不可用";
  });

  async function refresh() {
    request?.abort();
    const current = new AbortController();
    request = current;
    const id = activity();
    resolved.value = "";
    rejected.value = "";
    loading.value = false;
    if (!id || !active()) return;
    const option = reference.activities.find((row) => row.value === id);
    const snapshot = documentSnapshot() as Record<string, unknown> | undefined;
    const knownTitle =
      option?.label ||
      (snapshot &&
        String(snapshot.activity_title || snapshot.ti_activity_title || ""));
    if (knownTitle) {
      if (!option) reference.activities.push({ value: id, label: knownTitle });
      resolved.value = id;
    }
    loading.value = true;
    try {
      const result = await services.call<{
        name: string;
        title: string;
        archived: boolean;
      }>("activities.activity_label", { name: id }, current.signal);
      if (request !== current || !active() || activity() !== id) return;
      if (result.name !== id || !result.title) {
        rejected.value = id;
        reference.activities = reference.activities.filter(
          (row) => row.value !== id,
        );
        return;
      }
      const option = reference.activities.find((row) => row.value === id);
      if (option) option.label = result.title;
      else reference.activities.push({ value: id, label: result.title });
      resolved.value = id;
    } catch {
      if (request === current && active() && activity() === id) {
        rejected.value = id;
        reference.activities = reference.activities.filter(
          (row) => row.value !== id,
        );
      }
    } finally {
      if (request === current) loading.value = false;
    }
  }

  watch([activity, () => reference.user, () => reference.site], refresh, {
    immediate: true,
  });
  onBeforeUnmount(() => {
    disposed = true;
    request?.abort();
  });
  return label;
}
