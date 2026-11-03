// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectInstallPlatform,
  installInstructions,
  installPwa,
  dismissUpdate,
  isUpdateDismissed,
} from "../src/lib/pwa";

afterEach(() => vi.restoreAllMocks());

describe("PWA installation helpers", () => {
  it("recognizes iOS, iPadOS, Android, and generic browsers", () => {
    expect(detectInstallPlatform("Mozilla/5.0 (iPhone)", "iPhone", 5)).toBe(
      "ios",
    );
    expect(detectInstallPlatform("Mozilla/5.0", "MacIntel", 5)).toBe("ios");
    expect(
      detectInstallPlatform(
        "Mozilla/5.0 (Linux; Android 14)",
        "Linux armv8l",
        1,
      ),
    ).toBe("android");
    expect(
      detectInstallPlatform(
        "Mozilla/5.0 (X11; Linux x86_64)",
        "Linux x86_64",
        0,
      ),
    ).toBe("other");
  });

  it("provides platform-specific install guidance", () => {
    expect(installInstructions("ios")).toContain("Safari");
    expect(installInstructions("android")).toContain("Chrome");
    expect(installInstructions("other")).toContain("浏览器菜单");
  });

  it("does not attempt a native prompt when the browser has not offered one", async () => {
    await expect(installPwa()).resolves.toBe(false);
  });

  it("keeps update dismissal scoped to a worker version for the current session", () => {
    sessionStorage.clear();
    expect(isUpdateDismissed("worker-a")).toBe(false);
    dismissUpdate("worker-a");
    expect(isUpdateDismissed("worker-a")).toBe(true);
    expect(isUpdateDismissed("worker-b")).toBe(false);
  });
});

describe("PWA updates", () => {
  type Listener = (event?: Event) => void;
  let containerListeners: Map<string, Listener[]>;
  let registrationListeners: Map<string, Listener[]>;
  let registration: {
    waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
    installing: unknown;
    update: ReturnType<typeof vi.fn>;
    addEventListener: (type: string, listener: Listener) => void;
  };
  let container: {
    controller: { scriptURL: string } | null;
    register: ReturnType<typeof vi.fn>;
    addEventListener: (type: string, listener: Listener) => void;
  };
  const fire = (listeners: Map<string, Listener[]>, type: string) =>
    listeners.get(type)?.forEach((listener) => listener());
  const listen =
    (listeners: Map<string, Listener[]>) =>
    (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) || []), listener]);

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("DEV", false);
    containerListeners = new Map();
    registrationListeners = new Map();
    registration = {
      waiting: null,
      installing: null,
      update: vi.fn(() => Promise.resolve()),
      addEventListener: listen(registrationListeners),
    };
    container = {
      controller: { scriptURL: "/temple-inventory-sw.js" },
      register: vi.fn(() => Promise.resolve(registration)),
      addEventListener: listen(containerListeners),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: container,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("worker"))),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("activates a worker already waiting at load without offering an update", async () => {
    const waiting = { postMessage: vi.fn() };
    registration.waiting = waiting;
    const pwa = await import("../src/lib/pwa");
    await pwa.registerPwa();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    fire(containerListeners, "controllerchange");
    await vi.waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(pwa.updateAvailable.value).toBe(false);
  });

  it("offers an update found while the page is open", async () => {
    const pwa = await import("../src/lib/pwa");
    await pwa.registerPwa();
    const worker = {
      state: "installing",
      addEventListener: (type: string, listener: Listener) =>
        type === "statechange" && (worker.onstate = listener),
      onstate: undefined as Listener | undefined,
    };
    registration.installing = worker;
    fire(registrationListeners, "updatefound");
    worker.state = "installed";
    worker.onstate?.();
    await vi.waitFor(() => expect(pwa.updateAvailable.value).toBe(true));
  });

  it("offers an update when another tab activates a newer worker", async () => {
    const pwa = await import("../src/lib/pwa");
    await pwa.registerPwa();
    fire(containerListeners, "controllerchange");
    await vi.waitFor(() => expect(pwa.updateAvailable.value).toBe(true));
  });

  it("reloads on 更新 when the new worker is already active", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    const pwa = await import("../src/lib/pwa");
    await pwa.registerPwa();
    pwa.applyUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });
});
