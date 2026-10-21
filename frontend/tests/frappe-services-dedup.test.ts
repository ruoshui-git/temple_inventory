import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../src/lib/api", () => ({
  request: mocked.request,
  ApiError: class extends Error {},
}));
vi.mock("../src/lib/sessionState", () => ({ sessionExpired: { value: false } }));
vi.mock("../src/lib/uiPreferences", async () => {
  const { ref } = await import("vue");
  return { preferenceUser: ref("alice") };
});

import { frappeServices } from "../src/services/frappeServices";
import { preferenceUser } from "../src/lib/uiPreferences";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("read request sharing", () => {
  beforeEach(() => {
    mocked.request.mockReset();
    preferenceUser.value = "alice";
  });

  it("shares an opted-in read while isolating one caller's cancellation", async () => {
    const pending = deferred<{ rows: number[] }>();
    mocked.request.mockReturnValue(pending.promise);
    const first = new AbortController();
    const second = new AbortController();
    const query = { dataset: "inventory", view: "summary" } as never;
    const firstRead = frappeServices.report(query, {}, first.signal);
    const secondRead = frappeServices.report(query, {}, second.signal);
    await Promise.resolve();
    expect(mocked.request).toHaveBeenCalledTimes(1);
    const underlying = mocked.request.mock.calls[0]?.[3] as AbortSignal;
    first.abort();
    await expect(firstRead).rejects.toMatchObject({ name: "AbortError" });
    expect(underlying.aborted).toBe(false);
    pending.resolve({ rows: [1] });
    await expect(secondRead).resolves.toEqual({ rows: [1] });
  });

  it("keeps mutations independent and drops pending reads when the account changes", async () => {
    mocked.request.mockImplementation((_path: string, _args: unknown, _form: unknown, signal: AbortSignal) => {
      if (_path.includes("native_api.delete_document"))
        return Promise.resolve({ deleted: true });
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const query = { dataset: "inventory", view: "summary" } as never;
    const oldRead = frappeServices.report(query).catch((error) => error);
    await Promise.resolve();
    preferenceUser.value = "bob";
    await nextTick();
    await expect(oldRead).resolves.toMatchObject({ name: "AbortError" });

    await Promise.all([
      frappeServices.call("native_api.delete_document", { name: "x" }).catch(() => undefined),
      frappeServices.call("native_api.delete_document", { name: "x" }).catch(() => undefined),
    ]);
    expect(mocked.request).toHaveBeenCalledTimes(3);
  });
});
