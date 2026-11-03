import { computed, ref } from "vue";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const updateAvailable = ref(false);
export const updateVersion = ref("");
function updateDismissalKey(version: string) {
  return `temple-inventory:update-dismissed:${version}`;
}
export function isUpdateDismissed(version: string) {
  try {
    return window.sessionStorage.getItem(updateDismissalKey(version)) === "1";
  } catch {
    return false;
  }
}
export function dismissUpdate(version: string) {
  try {
    window.sessionStorage.setItem(updateDismissalKey(version), "1");
  } catch {
    // The current tab still dismisses the toast if storage is unavailable.
  }
}
const installEvent = ref<InstallPromptEvent | null>(null);
const standalone = ref(false);
let registration: ServiceWorkerRegistration | undefined;
let registered = false;
let reloading = false;
// Set when this tab asks a worker to take over, so its own controller change is not news.
let expectingController = false;

async function workerVersion(worker: ServiceWorker) {
  try {
    const response = await fetch(worker.scriptURL, { cache: "no-store" });
    if (!response.ok) return worker.scriptURL;
    const content = await response.text();
    let hash = 2166136261;
    for (let index = 0; index < content.length; index++) {
      hash = Math.imul(hash ^ content.charCodeAt(index), 16777619);
    }
    return `${worker.scriptURL}:${(hash >>> 0).toString(36)}`;
  } catch {
    return worker.scriptURL;
  }
}

async function markUpdateAvailable(
  worker: ServiceWorker | null,
  controller: ServiceWorker | null,
) {
  if (worker?.state !== "installed" || !controller) return;
  updateVersion.value = await workerVersion(worker);
  updateAvailable.value = true;
}

export {
  detectInstallPlatform,
  installInstructions,
  type InstallPlatform,
} from "./installGuidance";

function detectStandalone() {
  standalone.value =
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export const isStandalone = computed(() => standalone.value);
export const canInstall = computed(
  () => !!installEvent.value && !standalone.value,
);

if (typeof window !== "undefined") {
  detectStandalone();
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installEvent.value = event as InstallPromptEvent;
  });
  window.addEventListener("appinstalled", () => {
    installEvent.value = null;
    detectStandalone();
  });
}

export async function installPwa() {
  const event = installEvent.value;
  if (!event) return false;
  await event.prompt();
  await event.userChoice.catch(() => undefined);
  installEvent.value = null;
  return true;
}

export async function registerPwa() {
  // The dev server has no built /temple-inventory-sw.js of its own; registering here would
  // only reattach a stale production worker and block Vite HMR reloads with cached responses.
  if (
    import.meta.env.DEV ||
    registered ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  )
    return;
  registered = true;
  try {
    registration = await navigator.serviceWorker.register(
      "/temple-inventory-sw.js",
      {
        scope: "/",
        updateViaCache: "none",
      },
    );
    // The /inventory shell is never cached, so this page loaded the deployed bundle and is
    // current; a worker still waiting from that deploy only lags behind it. Activate it without
    // a prompt, which would offer an update this page already has.
    if (registration.waiting && navigator.serviceWorker.controller) {
      expectingController = true;
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    // Another tab activated a newer worker: this tab still runs the code it loaded with.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (expectingController) {
        expectingController = false;
        return;
      }
      const controller = navigator.serviceWorker.controller;
      if (!controller) return;
      void workerVersion(controller).then((version) => {
        updateVersion.value = version;
        updateAvailable.value = true;
      });
    });
    registration.addEventListener("updatefound", () => {
      const worker = registration?.installing;
      worker?.addEventListener(
        "statechange",
        () =>
          void markUpdateAvailable(worker, navigator.serviceWorker.controller),
      );
    });
    void registration.update().catch(() => undefined);
    const check = () => {
      if (document.visibilityState === "visible")
        void registration?.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
  } catch (error) {
    registered = false;
    console.warn("PWA registration failed", error);
  }
}

function reload() {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

export function applyUpdate() {
  const waiting = registration?.waiting;
  // Without a waiting worker the new one is already active (another tab activated it); this
  // tab only needs to load the new bundle.
  if (!waiting) return reload();
  expectingController = true;
  navigator.serviceWorker.addEventListener("controllerchange", reload, {
    once: true,
  });
  waiting.postMessage({ type: "SKIP_WAITING" });
}
