import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capturePreferenceRevision,
  configureDensitySave,
  createDensitySaveQueue,
  density,
  hydrateUiPreferences,
  preferenceError,
  preferenceSaveState,
  preferenceUser,
  refreshServerDensity,
} from "../src/lib/uiPreferences";
import { refreshSession } from "../src/lib/api";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("account UI preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-ti-density");
    hydrateUiPreferences("alice@example.test", "balanced");
  });

  it("hydrates and caches only the authenticated account's server value", () => {
    hydrateUiPreferences("alice@example.test", "compact");
    expect(density.value).toBe("compact");
    expect(document.documentElement.dataset.tiDensity).toBe("compact");

    hydrateUiPreferences("bob@example.test", "spacious");
    expect(density.value).toBe("spacious");
    hydrateUiPreferences("alice@example.test");
    expect(density.value).toBe("compact");
  });

  it("does not apply invalid server or cached values", () => {
    localStorage.setItem(
      "temple-inventory:ui-preferences:v1:alice%40example.test",
      JSON.stringify({ version: 1, density: "giant" }),
    );
    hydrateUiPreferences("alice@example.test", "giant");
    expect(density.value).toBe("balanced");

    hydrateUiPreferences("alice@example.test", "compact");
    refreshServerDensity(
      "alice@example.test",
      "invalid",
      capturePreferenceRevision(),
    );
    expect(density.value).toBe("compact");
  });

  it("serializes rapid changes and confirms only the latest save", async () => {
    const first = deferred<void>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    configureDensitySave(save);
    const queue = createDensitySaveQueue();
    queue.enqueue("compact");
    queue.enqueue("spacious");
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("saved"));
    expect(save.mock.calls.map(([value]) => value)).toEqual([
      "compact",
      "spacious",
    ]);
    expect(density.value).toBe("spacious");
  });

  it("ignores a stale account response and skips queued saves after account switch", async () => {
    const pending = deferred<void>();
    const save = vi.fn().mockReturnValue(pending.promise);
    configureDensitySave(save);
    const queue = createDensitySaveQueue();
    queue.enqueue("compact");
    queue.enqueue("spacious");
    hydrateUiPreferences("bob@example.test", "balanced");
    pending.resolve();
    await vi.waitFor(() =>
      expect(preferenceUser.value).toBe("bob@example.test"),
    );
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(density.value).toBe("balanced");
    expect(preferenceSaveState.value).toBe("saved");
  });

  it("keeps failed appearance, avoids caching it, and can retry", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    configureDensitySave(save);
    const queue = createDensitySaveQueue();
    queue.enqueue("spacious");
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("error"));
    expect(density.value).toBe("spacious");
    expect(preferenceError.value).toContain("offline");
    const saved = JSON.parse(
      localStorage.getItem(
        "temple-inventory:ui-preferences:v1:alice%40example.test",
      ) || "null",
    );
    expect(saved).toEqual({ version: 1, density: "balanced" });
    queue.retry();
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("saved"));
    expect(density.value).toBe("spacious");
    hydrateUiPreferences("alice@example.test");
    expect(density.value).toBe("spacious");
  });

  it("does not let settings refresh replace a pending edit", () => {
    const revision = capturePreferenceRevision();
    const queue = createDensitySaveQueue();
    queue.enqueue("compact");
    refreshServerDensity("alice@example.test", "balanced", revision);
    expect(density.value).toBe("compact");
  });

  it("ignores an older session response that resolves after a newer account", async () => {
    const older = deferred<any>();
    const newer = deferred<any>();
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);

    const oldRefresh = refreshSession();
    const newRefresh = refreshSession();
    newer.resolve({
      ok: true,
      json: async () => ({
        message: {
          user: "bob@example.test",
          csrf_token: "bob-token",
          ui_preferences: { density: "spacious" },
        },
      }),
    });
    await newRefresh;
    older.resolve({
      ok: true,
      json: async () => ({
        message: {
          user: "alice@example.test",
          csrf_token: "alice-token",
          ui_preferences: { density: "compact" },
        },
      }),
    });
    await oldRefresh;

    expect(preferenceUser.value).toBe("bob@example.test");
    expect(density.value).toBe("spacious");
    expect((window as any).csrf_token).toBe("bob-token");
    vi.unstubAllGlobals();
  });
});
