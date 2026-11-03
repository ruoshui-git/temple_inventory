import { computed, isRef, ref, watch, type Ref } from "vue";

export type BrowseView = "table" | "list" | "card";

const views: readonly BrowseView[] = ["table", "list", "card"];

function isView(value: unknown): value is BrowseView {
  return (
    typeof value === "string" && (views as readonly string[]).includes(value)
  );
}

/** Per-account, per-page storage key for the browse layout choice. */
export function browseLayoutStorageKey(
  site: string,
  account: string,
  page: string,
) {
  return `temple-inventory:browse-layout:v1:${encodeURIComponent(site)}:${encodeURIComponent(account)}:${page}`;
}

export interface BrowseViewModeOptions {
  phone?: BrowseView;
  desktop?: BrowseView;
  /** Layouts offered on each form factor; other stored or restored values fall back to the default. */
  phoneOptions?: readonly BrowseView[];
  desktopOptions?: readonly BrowseView[];
  storageKey?: Readonly<Ref<string | undefined>> | string;
}

function readStored(
  key: string,
): { phone?: BrowseView; desktop?: BrowseView } | undefined {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(key) || "null",
    );
    if (!parsed || typeof parsed !== "object") return;
    const candidate = parsed as { phone?: unknown; desktop?: unknown };
    return {
      phone: isView(candidate.phone) ? candidate.phone : undefined,
      desktop: isView(candidate.desktop) ? candidate.desktop : undefined,
    };
  } catch {
    // Storage is a per-browser convenience; an unreadable value falls back to the defaults.
    return;
  }
}

function writeStored(
  key: string,
  value: { phone: BrowseView; desktop: BrowseView },
) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked or full storage only loses the remembered choice.
  }
}

export function useBrowseViewMode(
  isMobile: Readonly<Ref<boolean>>,
  options: BrowseViewModeOptions = {},
) {
  const defaults = {
    phone: options.phone ?? "table",
    desktop: options.desktop ?? "table",
  };
  const phoneOptions = options.phoneOptions ?? views;
  const desktopOptions = options.desktopOptions ?? views;
  const phoneChoice = (value: unknown) =>
    isView(value) && phoneOptions.includes(value) ? value : defaults.phone;
  const desktopChoice = (value: unknown) =>
    isView(value) && desktopOptions.includes(value) ? value : defaults.desktop;
  const phoneView = ref<BrowseView>(defaults.phone);
  const desktopView = ref<BrowseView>(defaults.desktop);
  const storageKey = computed(() => {
    const source = options.storageKey;
    return typeof source === "string"
      ? source
      : isRef(source)
        ? source.value
        : undefined;
  });
  const view = computed<BrowseView>({
    get: () => (isMobile.value ? phoneView.value : desktopView.value),
    set: (value) => {
      if (isMobile.value) phoneView.value = phoneChoice(value);
      else desktopView.value = desktopChoice(value);
    },
  });
  // The key's load runs before the save watcher, so a switched key never receives the
  // previous account's choices.
  watch(
    storageKey,
    (key) => {
      if (!key) return;
      const stored = readStored(key);
      phoneView.value = phoneChoice(stored?.phone);
      desktopView.value = desktopChoice(stored?.desktop);
    },
    { immediate: true },
  );
  watch([phoneView, desktopView], () => {
    const key = storageKey.value;
    if (key)
      writeStored(key, { phone: phoneView.value, desktop: desktopView.value });
  });
  function snapshot() {
    return { phoneView: phoneView.value, desktopView: desktopView.value };
  }
  function restore(value: {
    phoneView?: unknown;
    desktopView?: unknown;
    view?: unknown;
  }) {
    phoneView.value = phoneChoice(value.phoneView);
    desktopView.value = desktopChoice(
      isView(value.desktopView) ? value.desktopView : value.view,
    );
  }
  const viewOptions = computed(() =>
    isMobile.value ? phoneOptions : desktopOptions,
  );
  return { phoneView, desktopView, view, viewOptions, snapshot, restore };
}
