// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  capturePreferenceRevision,
  configurePreferenceSave,
  createPreferenceSaveQueue,
  density,
  hydrateUiPreferences,
  preferenceError,
  preferenceSaveState,
  preferenceUser,
  refreshServerPreferences,
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
    hydrateUiPreferences("alice@example.test", {
      theme: "jade",
      density: "balanced",
      textScale: 100,
    });
  });

  it("hydrates and caches only the authenticated account's server value", () => {
    hydrateUiPreferences("alice@example.test", {
      theme: "jade",
      density: "compact",
      textScale: 100,
    });
    expect(density.value).toBe("compact");
    expect(document.documentElement.dataset.tiDensity).toBe("compact");

    hydrateUiPreferences("bob@example.test", {
      theme: "jade",
      density: "spacious",
      textScale: 100,
    });
    expect(density.value).toBe("spacious");
    hydrateUiPreferences("alice@example.test");
    expect(density.value).toBe("compact");
  });

  it("does not apply invalid server or cached values", () => {
    localStorage.setItem(
      "temple-inventory:ui-preferences:v2:alice%40example.test",
      JSON.stringify({ version: 1, density: "giant" }),
    );
    hydrateUiPreferences("alice@example.test", "giant");
    expect(density.value).toBe("balanced");

    hydrateUiPreferences("alice@example.test", {
      theme: "jade",
      density: "compact",
      textScale: 100,
    });
    refreshServerPreferences(
      "alice@example.test",
      "invalid",
      capturePreferenceRevision(),
    );
    expect(density.value).toBe("compact");
  });

  it("serializes rapid changes and confirms only the latest save", async () => {
    const first = deferred<{
      theme: "jade";
      density: "compact" | "balanced" | "spacious";
      textScale: 100;
    }>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockImplementation(async (values) => values);
    configurePreferenceSave(save);
    const queue = createPreferenceSaveQueue();
    queue.enqueue({ density: "compact" });
    queue.enqueue({ density: "spacious" });
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ theme: "jade", density: "compact", textScale: 100 });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("saved"));
    expect(save.mock.calls.map(([value]) => value.density)).toEqual([
      "compact",
      "spacious",
    ]);
    expect(density.value).toBe("spacious");
  });

  it("ignores a stale account response and skips queued saves after account switch", async () => {
    const pending = deferred<{
      theme: "jade";
      density: "compact" | "balanced" | "spacious";
      textScale: 100;
    }>();
    const save = vi.fn().mockReturnValue(pending.promise);
    configurePreferenceSave(save);
    const queue = createPreferenceSaveQueue();
    queue.enqueue({ density: "compact" });
    queue.enqueue({ density: "spacious" });
    hydrateUiPreferences("bob@example.test", {
      theme: "jade",
      density: "balanced",
      textScale: 100,
    });
    pending.resolve({ theme: "jade", density: "compact", textScale: 100 });
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
      .mockImplementationOnce(async (values) => values);
    configurePreferenceSave(save);
    const queue = createPreferenceSaveQueue();
    queue.enqueue({ density: "spacious" });
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("error"));
    expect(density.value).toBe("spacious");
    expect(preferenceError.value).toContain("offline");
    const saved = JSON.parse(
      localStorage.getItem(
        "temple-inventory:ui-preferences:v2:alice%40example.test",
      ) || "null",
    );
    expect(saved).toEqual({
      version: 2,
      values: { theme: "jade", density: "balanced", textScale: 100 },
    });
    queue.retry();
    await vi.waitFor(() => expect(preferenceSaveState.value).toBe("saved"));
    expect(density.value).toBe("spacious");
    hydrateUiPreferences("alice@example.test");
    expect(density.value).toBe("spacious");
  });

  it("does not let settings refresh replace a pending edit", () => {
    const revision = capturePreferenceRevision();
    const queue = createPreferenceSaveQueue();
    queue.enqueue({ density: "compact" });
    refreshServerPreferences(
      "alice@example.test",
      { theme: "jade", density: "balanced", textScale: 100 },
      revision,
    );
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
          ui_preferences: {
            theme: "jade",
            density: "spacious",
            textScale: 100,
          },
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
          ui_preferences: { theme: "jade", density: "compact", textScale: 100 },
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
