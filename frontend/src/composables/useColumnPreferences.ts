import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import type { InventoryServices, ReferenceData } from "../services/contracts";
import {
  reconcileColumns,
  type ColumnPreference,
  type DataColumn,
} from "../lib/dataTable";

type ColumnSaveState = "saved" | "saving" | "error";

const CACHE_PREFIX = "temple-inventory:table-columns:v1:";
const memory = new Map<string, ColumnPreference>();
// A validated result belongs to the active account/site scope. Responsive
// table/card switches can remount row details; reuse that server-confirmed
// presentation state instead of issuing another preference read per remount.
const validated = new Set<string>();
const saveQueues = new Map<string, Promise<void>>();
let activeScope = "";

function removeLocal(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser storage is only the presentation fallback.
  }
}

function scopeKey(site: string, account: string) {
  return `${encodeURIComponent(site)}:${encodeURIComponent(account)}`;
}

function storageKey(scope: string, tableId: string) {
  return `${CACHE_PREFIX}${scope}:${encodeURIComponent(tableId)}`;
}

function normalizedPreference(value: unknown): ColumnPreference | undefined {
  if (!value || typeof value !== "object") return;
  const candidate = value as Partial<ColumnPreference>;
  if (!Array.isArray(candidate.order) || !Array.isArray(candidate.hidden))
    return;
  return {
    order: candidate.order.filter(
      (item): item is string => typeof item === "string",
    ),
    hidden: candidate.hidden.filter(
      (item): item is string => typeof item === "string",
    ),
  };
}

function readLocal(
  key: string,
): { values: ColumnPreference; dirty: boolean } | undefined {
  if (typeof window === "undefined") return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    if (parsed?.version !== 1) return;
    const values = normalizedPreference(parsed.values);
    return values ? { values, dirty: parsed.dirty === true } : undefined;
  } catch {
    return;
  }
}

function writeLocal(key: string, value: ColumnPreference, dirty: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ version: 1, values: value, dirty }),
    );
  } catch {
    // Browser storage is only the presentation fallback; Frappe owns persistence.
  }
}

export function useColumnPreferences(
  tableId: string | Readonly<Ref<string>>,
  columns: Readonly<Ref<DataColumn[]>>,
  reference: ReferenceData,
  services: InventoryServices,
) {
  const currentTableId = computed(() =>
    typeof tableId === "string" ? tableId : tableId.value,
  );
  const order = ref<string[]>([]);
  const visible = ref<string[]>([]);
  const saveState = ref<ColumnSaveState>("saved");
  const saveError = ref("");
  const isReady = ref(false);
  let revision = 0;
  let epoch = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  const currentScope = computed(() => scopeKey(reference.site, reference.user));
  const currentKey = computed(() =>
    storageKey(currentScope.value, currentTableId.value),
  );

  function currentPreference(): ColumnPreference {
    return {
      order: [...order.value],
      hidden: columns.value
        .map((column) => String(column.id))
        .filter((id) => !visible.value.includes(id)),
    };
  }

  function apply(preference?: ColumnPreference | null) {
    const reconciled = reconcileColumns(columns.value, preference);
    order.value = reconciled.order;
    visible.value = reconciled.visible;
  }

  function schemaSignature() {
    return JSON.stringify(
      columns.value.map((column) => [
        String(column.id),
        column.defaultVisible,
        column.required,
      ]),
    );
  }

  function cache(value: ColumnPreference, isDirty: boolean) {
    const key = currentKey.value;
    memory.set(key, value);
    writeLocal(key, value, isDirty);
  }

  async function hydrate() {
    const ownEpoch = ++epoch;
    revision = 0;
    isReady.value = false;
    if (activeScope !== currentScope.value) {
      memory.clear();
      validated.clear();
      activeScope = currentScope.value;
    }
    const local = readLocal(currentKey.value);
    const remembered = memory.get(currentKey.value);
    dirty = local?.dirty === true;
    apply(remembered || local?.values);
    if (dirty) {
      saveState.value = "error";
      saveError.value = "此前的列设置尚未同步到此账户，可重试保存。";
    } else {
      saveState.value = "saved";
      saveError.value = "";
    }
    if (!reference.user || !reference.site) {
      isReady.value = true;
      return;
    }
    if (validated.has(currentKey.value)) {
      isReady.value = true;
      return;
    }
    try {
      const result = await services.call<unknown>(
        "table_preferences.get_column_preferences",
        {
          table_id: currentTableId.value,
        },
      );
      if (ownEpoch !== epoch) return;
      validated.add(currentKey.value);
      const saved = normalizedPreference(result);
      if (!saved && revision === 0 && !dirty) {
        // The account has no saved choice: a clean cached copy is stale, so show defaults.
        memory.delete(currentKey.value);
        removeLocal(currentKey.value);
        apply(undefined);
      }
      if (saved && revision === 0 && !dirty) {
        apply(saved);
        const reconciled = currentPreference();
        cache(reconciled, false);
        if (JSON.stringify(saved) !== JSON.stringify(reconciled)) {
          revision += 1;
          dirty = true;
          cache(reconciled, true);
          saveState.value = "saving";
          void persist(revision, ownEpoch);
        }
      }
    } catch {
      // Keep the account/site-scoped local presentation choice and expose retry on save.
    } finally {
      if (ownEpoch === epoch) isReady.value = true;
    }
  }

  async function send(
    ownRevision: number,
    ownEpoch: number,
    key: string,
    ownTableId: string,
    values: ColumnPreference,
  ) {
    if (ownEpoch !== epoch || key !== currentKey.value) return;
    try {
      const confirmed = await services.call<unknown>(
        "table_preferences.save_column_preferences",
        {
          table_id: ownTableId,
          preference: values,
        },
      );
      const normalized = normalizedPreference(confirmed);
      if (!normalized) throw new Error("服务器未确认列设置");
      if (ownEpoch === epoch && ownRevision === revision) {
        apply(normalized);
        dirty = false;
        cache(currentPreference(), false);
        saveState.value = "saved";
        saveError.value = "";
      }
    } catch (error) {
      if (ownEpoch === epoch && ownRevision === revision) {
        dirty = true;
        cache(values, true);
        saveState.value = "error";
        saveError.value = `列设置未保存，当前选择保留在此设备：${error instanceof Error ? error.message : "保存失败"}`;
      }
    }
  }

  function persist(ownRevision: number, ownEpoch: number) {
    const key = currentKey.value;
    const ownTableId = currentTableId.value;
    const values = currentPreference();
    const previous = saveQueues.get(key) || Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => send(ownRevision, ownEpoch, key, ownTableId, values));
    saveQueues.set(key, queued);
    void queued.finally(() => {
      if (saveQueues.get(key) === queued) saveQueues.delete(key);
    });
    return queued;
  }

  function commit() {
    revision += 1;
    const values = currentPreference();
    dirty = true;
    cache(values, true);
    saveState.value = "saving";
    saveError.value = "";
    if (pendingTimer) clearTimeout(pendingTimer);
    const ownRevision = revision;
    const ownEpoch = epoch;
    pendingTimer = setTimeout(() => void persist(ownRevision, ownEpoch), 120);
  }

  function toggle(id: string) {
    const column = columns.value.find(
      (candidate) => String(candidate.id) === id,
    );
    if (!column || column.required) return;
    const next = visible.value.includes(id)
      ? visible.value.filter((candidate) => candidate !== id)
      : [...visible.value, id];
    if (!next.length) return;
    visible.value = order.value.filter((candidate) => next.includes(candidate));
    commit();
  }

  function reorder(next: string[]) {
    const permitted = new Set(columns.value.map((column) => String(column.id)));
    const unique = next.filter(
      (id, index) => permitted.has(id) && next.indexOf(id) === index,
    );
    order.value = [
      ...unique,
      ...columns.value
        .map((column) => String(column.id))
        .filter((id) => !unique.includes(id)),
    ];
    visible.value = order.value.filter((id) => visible.value.includes(id));
    commit();
  }

  function reset() {
    apply();
    commit();
  }

  function retry() {
    if (pendingTimer) clearTimeout(pendingTimer);
    const ownRevision = ++revision;
    saveState.value = "saving";
    saveError.value = "";
    void persist(ownRevision, epoch);
  }

  watch(
    [currentScope, currentTableId],
    () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = undefined;
      void hydrate();
    },
    { immediate: true },
  );
  let currentSchema = schemaSignature();
  watch(columns, () => {
    const nextSchema = schemaSignature();
    if (nextSchema === currentSchema) return;
    currentSchema = nextSchema;
    const before = currentPreference();
    apply(before);
    if (isReady.value) commit();
  });
  onScopeDispose(() => {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = undefined;
    epoch += 1;
  });

  return {
    order,
    visible,
    isReady,
    saveState,
    saveError,
    toggle,
    reorder,
    reset,
    retry,
  };
}
