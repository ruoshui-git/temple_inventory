import { ref } from "vue";

export type Density = "compact" | "balanced" | "spacious";
export type PreferenceSaveState = "saved" | "saving" | "error";
export const DEFAULT_DENSITY: Density = "balanced";
export const density = ref<Density>(DEFAULT_DENSITY);
export const preferenceUser = ref("");
export const preferenceSaveState = ref<PreferenceSaveState>("saved");
export const preferenceError = ref("");

const CACHE_PREFIX = "temple-inventory:ui-preferences:v1:";
let accountEpoch = 0;
let editRevision = 0;

export function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "balanced" || value === "spacious";
}

function cacheKey(user: string) {
  return `${CACHE_PREFIX}${encodeURIComponent(user)}`;
}

function readCachedDensity(user: string): Density | undefined {
  if (!user || typeof window === "undefined") return;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(cacheKey(user)) || "null",
    );
    return saved?.version === 1 && isDensity(saved?.density)
      ? saved.density
      : undefined;
  } catch {
    return;
  }
}

function cacheConfirmedDensity(user: string, value: Density) {
  if (!user || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(user),
      JSON.stringify({ version: 1, density: value }),
    );
  } catch {
    // Storage can be disabled; server preferences remain available.
  }
}

export function hydrateUiPreferences(user: string, serverDensity?: unknown) {
  const normalizedUser = String(user || "");
  accountEpoch += 1;
  editRevision = 0;
  preferenceUser.value = normalizedUser;
  density.value = readCachedDensity(normalizedUser) || DEFAULT_DENSITY;
  if (isDensity(serverDensity)) {
    density.value = serverDensity;
    cacheConfirmedDensity(normalizedUser, serverDensity);
  }
  applyDensityAttribute();
  preferenceSaveState.value = "saved";
  preferenceError.value = "";
  return accountEpoch;
}

export function capturePreferenceRevision() {
  return editRevision;
}

export function setDensity(value: Density) {
  if (!isDensity(value)) return;
  editRevision += 1;
  density.value = value;
  applyDensityAttribute();
  preferenceSaveState.value = "saving";
  preferenceError.value = "";
}

export function refreshServerDensity(
  user: string,
  serverDensity: unknown,
  revisionAtRequest: number,
) {
  const normalizedUser = String(user || "");
  if (normalizedUser !== preferenceUser.value) {
    hydrateUiPreferences(normalizedUser, serverDensity);
    return;
  }
  if (revisionAtRequest !== editRevision) return;
  if (preferenceSaveState.value !== "saved") return;
  density.value = isDensity(serverDensity)
    ? serverDensity
    : readCachedDensity(normalizedUser) || DEFAULT_DENSITY;
  applyDensityAttribute();
  if (isDensity(serverDensity))
    cacheConfirmedDensity(normalizedUser, serverDensity);
  preferenceSaveState.value = "saved";
  preferenceError.value = "";
}

function applyDensityAttribute() {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.tiDensity = density.value;
  }
}

let saveDensity: (value: Density) => Promise<unknown> = async () => {
  throw new Error("保存设置暂不可用");
};
export function configureDensitySave(
  save: (value: Density) => Promise<unknown>,
) {
  saveDensity = save;
}

export function createDensitySaveQueue() {
  let queued:
    | { value: Density; revision: number; epoch: number; user: string }
    | undefined;
  let running = false;

  async function drain() {
    if (running) return;
    running = true;
    while (queued) {
      const current = queued;
      queued = undefined;
      if (
        current.epoch !== accountEpoch ||
        current.user !== preferenceUser.value
      )
        continue;
      const user = current.user;
      try {
        await saveDensity(current.value);
        if (
          current.epoch === accountEpoch &&
          user === preferenceUser.value &&
          current.revision === editRevision
        ) {
          cacheConfirmedDensity(user, current.value);
          preferenceSaveState.value = "saved";
          preferenceError.value = "";
        }
      } catch (error) {
        if (
          current.epoch === accountEpoch &&
          user === preferenceUser.value &&
          current.revision === editRevision
        ) {
          preferenceSaveState.value = "error";
          const reason = error instanceof Error ? error.message : "保存失败";
          preferenceError.value = `设置未保存，当前选择仅在本次会话生效：${reason}`;
        }
      }
    }
    running = false;
  }

  function enqueue(value: Density) {
    setDensity(value);
    queued = {
      value,
      revision: editRevision,
      epoch: accountEpoch,
      user: preferenceUser.value,
    };
    void drain();
  }

  return {
    enqueue,
    retry() {
      enqueue(density.value);
    },
  };
}

export const densitySaveQueue = createDensitySaveQueue();
