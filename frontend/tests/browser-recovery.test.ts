import { describe, expect, it } from "vitest";
import {
  createRecoveryStore,
  recoveryValues,
  type RecoverySnapshot,
} from "../src/lib/browserRecovery";

function snapshot(change: Partial<RecoverySnapshot> = {}): RecoverySnapshot {
  return {
    schema: 1,
    site: "development.localhost",
    account: "alice",
    tabId: "tab-a",
    editorId: "editor-a",
    editorKind: "Receive",
    revision: 1,
    updatedAt: "2026-10-16T10:00:00Z",
    values: { qty: null },
    pendingUploadReselection: false,
    ...change,
  };
}

describe("browser incomplete input recovery", () => {
  it("skips malformed snapshot metadata without hiding other editors", () => {
    localStorage.clear();
    const store = createRecoveryStore(
      "development.localhost",
      "alice",
      localStorage,
    );
    store.save(snapshot());
    const key = localStorage.key(0)!;
    localStorage.setItem(
      key + "-malformed",
      JSON.stringify({ ...snapshot({ editorId: "bad" }), updatedAt: null }),
    );
    expect(store.list().error).toBe("");
    expect(store.list().entries.map((row) => row.editorId)).toEqual([
      "editor-a",
    ]);
  });
  it("isolates site/account/editor snapshots and preserves competing tabs", () => {
    localStorage.clear();
    const alice = createRecoveryStore(
      "development.localhost",
      "alice",
      localStorage,
    );
    expect(alice.save(snapshot()).durable).toBe(true);
    expect(
      alice.save(snapshot({ editorId: "editor-b", tabId: "tab-b" })).durable,
    ).toBe(true);
    expect(alice.list().entries).toHaveLength(2);
    expect(
      createRecoveryStore("another.site", "alice", localStorage).list().entries,
    ).toHaveLength(0);
    expect(
      createRecoveryStore("development.localhost", "bob", localStorage).list()
        .entries,
    ).toHaveLength(0);
    expect(alice.save(snapshot({ tabId: "tab-b", revision: 5 })).durable).toBe(
      false,
    );
    expect(alice.read("editor-a")?.revision).toBe(1);
  });
  it("removes only the revision acknowledged by a save or explicit discard", () => {
    localStorage.clear();
    const store = createRecoveryStore(
      "development.localhost",
      "alice",
      localStorage,
    );
    store.save(snapshot());
    store.save(snapshot({ revision: 2 }));
    expect(store.remove("editor-a", 1)).toBe(false);
    expect(store.read("editor-a")?.revision).toBe(2);
    expect(store.remove("editor-a", 2)).toBe(true);
  });
  it("does not persist bytes, temporary URLs, or authentication material", () => {
    expect(
      recoveryValues({
        notes: "保留\n段落",
        files: [
          { name: "FILE-1", previewUrl: "blob:123" },
          new Blob(["private"]),
        ],
        csrf_token: "secret",
        password: "secret",
        nested: { objectUrl: "blob:x", fileBytes: [1, 2] },
      }),
    ).toEqual({ notes: "保留\n段落", files: [{ name: "FILE-1" }], nested: {} });
  });
  it("reports storage denial without pretending input was retained durably", () => {
    const storage = {
      length: 1,
      key() {
        throw new Error("denied");
      },
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    };
    const store = createRecoveryStore(
      "development.localhost",
      "alice",
      storage,
    );
    expect(store.save(snapshot()).durable).toBe(false);
    expect(store.list().error).not.toBe("");
    expect(store.remove("editor-a", 1)).toBe(false);
  });
});
