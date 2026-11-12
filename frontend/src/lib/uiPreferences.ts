import { ref } from "vue";
import {
  defaultDisplayPreferences,
  applyDisplayPreferences,
  themes,
  textScales,
  defaultPeriodOptions,
  type Density,
  type DisplayPreferences,
} from "./displayPreferences";
export type { Density, DisplayPreferences } from "./displayPreferences";

type PreferenceSaveState = "saved" | "saving" | "error";
export const density = ref(defaultDisplayPreferences.density);
export const theme = ref(defaultDisplayPreferences.theme);
export const textScale = ref(defaultDisplayPreferences.textScale);
export const defaultPeriods = ref({
  ...defaultDisplayPreferences.default_periods,
});
export const preferenceUser = ref("");
export const preferenceSaveState = ref<PreferenceSaveState>("saved");
export const preferenceError = ref("");

const CACHE_PREFIX = "temple-inventory:ui-preferences:v2:";
const COLUMN_WIDTHS_PREFIX = `${CACHE_PREFIX}column-widths:`;
let accountEpoch = 0;
let editRevision = 0;

function isDisplayPreferences(value: unknown): value is DisplayPreferences {
  if (!value || typeof value !== "object") return false;
  const candidate = value as DisplayPreferences;
  const periods = candidate.default_periods;
  return (
    themes.some((entry) => entry.id === candidate.theme) &&
    ["xcompact", "compact", "balanced", "spacious"].includes(
      candidate.density,
    ) &&
    textScales.includes(candidate.textScale) &&
    (!periods ||
      (typeof periods === "object" &&
        Object.keys(periods).length === 4 &&
        (["dashboard", "movements", "loans", "counts"] as const).every((area) =>
          defaultPeriodOptions.includes(periods[area]),
        )))
  );
}

function snapshot(): DisplayPreferences {
  return {
    theme: theme.value,
    density: density.value,
    textScale: textScale.value,
    default_periods: { ...defaultPeriods.value },
  };
}

function cacheKey(user: string) {
  return `${CACHE_PREFIX}${encodeURIComponent(user)}`;
}

function columnWidthsKey(user: string, tableKey: string) {
  return `${COLUMN_WIDTHS_PREFIX}${encodeURIComponent(user)}:${encodeURIComponent(tableKey)}`;
}

/** Browser-only table sizing stays per account and separate from server-backed display settings. */
export function getColumnWidths(user: string, tableKey: string) {
  if (!user || typeof window === "undefined") return {};
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(columnWidthsKey(user, tableKey)) || "null",
    );
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([, width]) =>
          typeof width === "number" && Number.isFinite(width) && width > 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}

export function setColumnWidths(
  user: string,
  tableKey: string,
  widths: Record<string, number>,
) {
  if (!user || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      columnWidthsKey(user, tableKey),
      JSON.stringify(widths),
    );
  } catch {
    // Browser storage is a presentation preference only.
  }
}

function readCache(user: string): DisplayPreferences | undefined {
  if (!user || typeof window === "undefined") return;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(cacheKey(user)) || "null",
    );
    return saved?.version === 2 && isDisplayPreferences(saved?.values)
      ? saved.values
      : undefined;
  } catch {
    return;
  }
}

function cacheConfirmed(user: string, values: DisplayPreferences) {
  if (!user || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      cacheKey(user),
      JSON.stringify({ version: 2, values }),
    );
  } catch {
    // Browser storage does not control server persistence.
  }
}

function apply(values: DisplayPreferences) {
  density.value = values.density;
  theme.value = values.theme;
  textScale.value = values.textScale;
  defaultPeriods.value = {
    ...defaultDisplayPreferences.default_periods,
    ...values.default_periods,
  };
  applyDisplayPreferences(values);
}

export function hydrateUiPreferences(user: string, serverValues?: unknown) {
  accountEpoch += 1;
  editRevision = 0;
  preferenceUser.value = String(user || "");
  apply(
    isDisplayPreferences(serverValues)
      ? serverValues
      : readCache(preferenceUser.value) || defaultDisplayPreferences,
  );
  if (isDisplayPreferences(serverValues))
    cacheConfirmed(preferenceUser.value, serverValues);
  preferenceSaveState.value = "saved";
  preferenceError.value = "";
  return accountEpoch;
}

export function capturePreferenceRevision() {
  return editRevision;
}

export function refreshServerPreferences(
  user: string,
  values: unknown,
  revisionAtRequest: number,
) {
  if (String(user || "") !== preferenceUser.value) {
    hydrateUiPreferences(user, values);
    return;
  }
  if (
    revisionAtRequest !== editRevision ||
    preferenceSaveState.value !== "saved"
  )
    return;
  apply(
    isDisplayPreferences(values)
      ? values
      : readCache(user) || defaultDisplayPreferences,
  );
  if (isDisplayPreferences(values)) cacheConfirmed(user, values);
}

let savePreferences: (
  values: DisplayPreferences,
) => Promise<unknown> = async () => {
  throw new Error("保存设置暂不可用");
};
export function configurePreferenceSave(
  save: (values: DisplayPreferences) => Promise<unknown>,
) {
  savePreferences = save;
}

export function createPreferenceSaveQueue() {
  let queued:
    | {
        values: DisplayPreferences;
        revision: number;
        epoch: number;
        user: string;
      }
    | undefined;
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queued) {
        const current = queued;
        queued = undefined;
        if (
          current.epoch !== accountEpoch ||
          current.user !== preferenceUser.value
        )
          continue;
        try {
          const confirmed = await savePreferences(current.values);
          if (!isDisplayPreferences(confirmed))
            throw new Error("服务器未确认显示设置");
          if (
            current.epoch === accountEpoch &&
            current.user === preferenceUser.value &&
            current.revision === editRevision
          ) {
            cacheConfirmed(current.user, confirmed);
            preferenceSaveState.value = "saved";
            preferenceError.value = "";
          }
        } catch (error) {
          if (
            current.epoch === accountEpoch &&
            current.user === preferenceUser.value &&
            current.revision === editRevision
          ) {
            preferenceSaveState.value = "error";
            preferenceError.value = `设置未保存，当前选择仅在本次会话生效：${error instanceof Error ? error.message : "保存失败"}`;
          }
        }
      }
    } finally {
      running = false;
    }
  }
  function enqueue(change: Partial<DisplayPreferences>) {
    const values = { ...snapshot(), ...change };
    if (!isDisplayPreferences(values)) return;
    editRevision += 1;
    apply(values);
    preferenceSaveState.value = "saving";
    preferenceError.value = "";
    queued = {
      values,
      revision: editRevision,
      epoch: accountEpoch,
      user: preferenceUser.value,
    };
    void drain();
  }
  return { enqueue, retry: () => enqueue(snapshot()) };
}
export const preferenceSaveQueue = createPreferenceSaveQueue();
