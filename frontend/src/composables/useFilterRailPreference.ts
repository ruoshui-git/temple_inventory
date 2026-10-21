import { computed, onScopeDispose, ref, unref, watch, type Ref } from "vue";
import type { InventoryServices, ReferenceData } from "../services/contracts";
import { useOptionalInventoryServices } from "../services/contracts";

type SaveState = "saved" | "saving" | "error";
const CACHE_PREFIX = "temple-inventory:filter-rail:v2:";
const queues = new Map<string, Promise<void>>();

function scopeKey(site: string, user: string, pageKey: string) {
  return `${CACHE_PREFIX}${encodeURIComponent(site)}:${encodeURIComponent(user)}:${encodeURIComponent(pageKey)}`;
}
function readCache(key: string): { open: boolean; dirty: boolean } | undefined {
  if (typeof window === "undefined") return;
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) || "null");
    if (saved?.version !== 2 || typeof saved.open !== "boolean") return;
    return { open: saved.open, dirty: saved.dirty === true };
  } catch {
    return;
  }
}
function writeCache(key: string, open: boolean, dirty: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 2, open, dirty }),
    );
  } catch {
    // Browser storage is a presentation fallback; Frappe owns the saved default.
  }
}

/** Server-backed Frappe user default with a site/account-scoped presentation cache. */
export function useFilterRailPreference(
  pageKey: string | Ref<string>,
  reference: ReferenceData,
  defaultOpen: boolean | Ref<boolean>,
  services: InventoryServices | undefined = useOptionalInventoryServices(),
) {
  const open = ref(unref(defaultOpen));
  const saveState = ref<SaveState>("saved");
  const saveError = ref("");
  const key = computed(() =>
    scopeKey(reference.site, reference.user, unref(pageKey)),
  );
  const currentPageKey = computed(() => unref(pageKey));
  let epoch = 0;
  let revision = 0;
  let dirty = false;
  let hydrating = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cache(isDirty: boolean, ownKey = key.value) {
    writeCache(ownKey, open.value, isDirty);
  }
  async function send(
    isOpen: boolean,
    ownRevision: number,
    ownEpoch: number,
    ownKey: string,
    ownPageKey: string,
  ) {
    if (!services || ownEpoch !== epoch || ownKey !== key.value) return;
    try {
      const result = await services.call<unknown>(
        "table_preferences.save_presentation_preference",
        { preference_id: `browse.rail.${ownPageKey}`, value: isOpen },
      );
      if (
        result !== isOpen &&
        (result as { value?: unknown })?.value !== isOpen
      )
        throw new Error("服务器未确认侧栏设置");
      if (ownEpoch !== epoch || ownRevision !== revision) return;
      dirty = false;
      writeCache(ownKey, isOpen, false);
      saveState.value = "saved";
      saveError.value = "";
    } catch (error) {
      if (ownEpoch !== epoch || ownRevision !== revision) return;
      dirty = true;
      writeCache(ownKey, isOpen, true);
      saveState.value = "error";
      saveError.value = `侧栏设置未保存，当前设备仍会保留：${error instanceof Error ? error.message : "保存失败"}`;
    }
  }
  function persist(
    isOpen: boolean,
    ownRevision: number,
    ownEpoch: number,
    ownKey: string,
    ownPageKey: string,
  ) {
    const previous = queues.get(ownKey) || Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => send(isOpen, ownRevision, ownEpoch, ownKey, ownPageKey));
    queues.set(ownKey, queued);
    void queued.finally(() => {
      if (queues.get(ownKey) === queued) queues.delete(ownKey);
    });
    return queued;
  }
  function scheduleSave() {
    revision += 1;
    dirty = true;
    cache(true);
    saveState.value = services ? "saving" : "saved";
    saveError.value = "";
    if (timer) clearTimeout(timer);
    const ownRevision = revision;
    const ownEpoch = epoch;
    const ownKey = key.value;
    const ownPageKey = currentPageKey.value;
    const isOpen = open.value;
    if (!services) {
      dirty = false;
      cache(false, ownKey);
      return;
    }
    timer = setTimeout(
      () => void persist(isOpen, ownRevision, ownEpoch, ownKey, ownPageKey),
      120,
    );
  }
  async function hydrate() {
    const ownEpoch = ++epoch;
    revision = 0;
    if (timer) clearTimeout(timer);
    timer = undefined;
    const ownKey = key.value;
    const ownPageKey = currentPageKey.value;
    const local = readCache(ownKey);
    dirty = local?.dirty === true;
    hydrating = true;
    open.value = local?.open ?? unref(defaultOpen);
    hydrating = false;
    if (dirty) {
      saveState.value = "error";
      saveError.value = "此前的侧栏设置尚未同步到此账户，可重试保存。";
    } else {
      saveState.value = "saved";
      saveError.value = "";
    }
    if (!services || !reference.site || !reference.user) return;
    try {
      const saved = await services.call<unknown>(
        "table_preferences.get_presentation_preference",
        { preference_id: `browse.rail.${ownPageKey}` },
      );
      const serverOpen =
        typeof saved === "boolean"
          ? saved
          : typeof (saved as { value?: unknown })?.value === "boolean"
            ? (saved as { value: boolean }).value
            : undefined;
      if (
        ownEpoch === epoch &&
        !dirty &&
        revision === 0 &&
        serverOpen !== undefined
      ) {
        hydrating = true;
        open.value = serverOpen;
        hydrating = false;
        writeCache(ownKey, serverOpen, false);
      }
    } catch {
      if (ownEpoch === epoch && !dirty) {
        saveState.value = "error";
        saveError.value =
          "无法读取账户侧栏设置；当前设备的显示状态仍然可用。可重试同步。";
      }
    }
  }
  watch(key, () => void hydrate(), { immediate: true, flush: "sync" });
  watch([() => unref(defaultOpen), currentPageKey], ([defaultValue]) => {
    if (!readCache(key.value)) {
      hydrating = true;
      open.value = defaultValue;
      hydrating = false;
    }
  });
  onScopeDispose(() => {
    epoch += 1;
    if (timer) clearTimeout(timer);
    timer = undefined;
  });
  return {
    open,
    saveState,
    saveError,
    toggle: () => {
      if (hydrating) return;
      open.value = !open.value;
      scheduleSave();
    },
    retry: () => {
      if (!services) return;
      if (!dirty) {
        void hydrate();
        return;
      }
      revision += 1;
      saveState.value = "saving";
      saveError.value = "";
      void persist(
        open.value,
        revision,
        epoch,
        key.value,
        currentPageKey.value,
      );
    },
  };
}
