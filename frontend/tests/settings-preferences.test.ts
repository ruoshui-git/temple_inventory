import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent } from "vue";
import {
  capturePreferenceRevision,
  configureDensitySave,
  density,
  hydrateUiPreferences,
  preferenceSaveState,
  preferenceUser,
  refreshServerDensity,
} from "../src/lib/uiPreferences";

const api = vi.hoisted(() => ({
  refreshSession: vi.fn<() => Promise<void>>(),
  saveUiPreferences: vi.fn<(value: string) => Promise<unknown>>(),
}));
vi.mock("../src/lib/api", () => api);

import Settings from "../src/pages/Settings.vue";

const globals = {
  stubs: {
    RouterLink: defineComponent({ template: "<a><slot /></a>" }),
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockSession(
  serverDensity: "compact" | "balanced" | "spacious" = "balanced",
) {
  api.refreshSession.mockImplementation(async () => {
    if (preferenceUser.value !== "alice@example.test") {
      hydrateUiPreferences("alice@example.test", serverDensity);
      return;
    }
    const revision = capturePreferenceRevision();
    await Promise.resolve();
    refreshServerDensity("alice@example.test", serverDensity, revision);
  });
}

describe("Settings density preferences integration", () => {
  const wrappers: VueWrapper[] = [];
  let localStorageDescriptor: PropertyDescriptor | undefined;

  function openSettings() {
    const wrapper = mount(Settings, { global: globals });
    wrappers.push(wrapper);
    return wrapper;
  }

  beforeEach(() => {
    localStorageDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "localStorage",
    );
    window.localStorage.clear();
    hydrateUiPreferences("", undefined);
    api.refreshSession.mockReset();
    api.saveUiPreferences.mockReset();
    api.saveUiPreferences.mockResolvedValue(undefined);
    mockSession();
  });

  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    configureDensitySave(async () => undefined);
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    } else {
      Reflect.deleteProperty(window, "localStorage");
    }
    hydrateUiPreferences("", undefined);
    vi.clearAllMocks();
  });

  it("applies a choice immediately and exposes save failure with a working retry", async () => {
    const failedSave = deferred<void>();
    api.saveUiPreferences
      .mockReturnValueOnce(failedSave.promise)
      .mockResolvedValueOnce(undefined);
    const wrapper = openSettings();
    await flushPromises();

    await wrapper.get('input[name="density"][value="compact"]').setValue();
    expect(density.value).toBe("compact");
    expect(document.documentElement.dataset.tiDensity).toBe("compact");
    expect(wrapper.get('[role="status"]').text()).toContain("正在保存");
    failedSave.reject(new Error("offline"));
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("error"));
    expect(wrapper.get('[role="alert"]').text()).toContain("offline");

    await wrapper.get('[role="alert"] button').trigger("click");
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("saved"));
    expect(api.saveUiPreferences.mock.calls.map(([value]) => value)).toEqual([
      "compact",
      "compact",
    ]);
    expect(wrapper.get('[role="status"]').text()).toContain("已保存");
  });

  it("keeps a queued save alive across Settings unmount and remount", async () => {
    const pendingSave = deferred<void>();
    api.saveUiPreferences.mockReturnValue(pendingSave.promise);
    const first = openSettings();
    await flushPromises();
    await first.get('input[name="density"][value="spacious"]').setValue();
    expect(document.documentElement.dataset.tiDensity).toBe("spacious");
    first.unmount();
    wrappers.splice(wrappers.indexOf(first), 1);

    const second = openSettings();
    await flushPromises();
    expect(density.value).toBe("spacious");
    expect(document.documentElement.dataset.tiDensity).toBe("spacious");
    pendingSave.resolve();
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("saved"));
    expect(api.saveUiPreferences).toHaveBeenCalledTimes(1);
    expect(
      (
        second.get('input[name="density"][value="spacious"]')
          .element as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("keeps the current density when session refresh fails", async () => {
    hydrateUiPreferences("alice@example.test", "compact");
    api.refreshSession.mockRejectedValue(new Error("offline"));
    const wrapper = openSettings();
    await flushPromises();
    expect(density.value).toBe("compact");
    expect(document.documentElement.dataset.tiDensity).toBe("compact");
    expect(wrapper.get('[role="alert"]').text()).toContain("offline");
    expect(wrapper.get('[role="alert"]').text()).toContain("保持不变");
  });

  it("continues to hydrate server preferences when localStorage access throws", () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("storage disabled");
      },
    });
    expect(() =>
      hydrateUiPreferences("alice@example.test", "spacious"),
    ).not.toThrow();
    expect(density.value).toBe("spacious");
    expect(document.documentElement.dataset.tiDensity).toBe("spacious");
  });
});
