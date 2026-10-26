// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createNativeEditor,
  type DocumentServices,
  type NativeDocument,
} from "../src/features/documents/nativeEditor";
import {
  createRecoveryStore,
  type RecoverySnapshot,
} from "../src/lib/browserRecovery";
import * as confirmService from "../src/services/confirm";

const document = (changes: Partial<NativeDocument> = {}): NativeDocument => ({
  doctype: "Stock Entry",
  name: "NATIVE-1",
  version: "v1",
  docstatus: 0,
  items: [{ name: "ROW-1", qty: 1 }],
  ...changes,
});
function setup() {
  localStorage.clear();
  const recovery = createRecoveryStore("site", "alice", localStorage);
  const services: DocumentServices = {
    load: vi.fn(async () => document()),
    create: vi.fn(async () => document()),
    save: vi.fn(async () => document({ version: "v2" })),
    submit: vi.fn(async () => document({ version: "v3", docstatus: 1 })),
  };
  let account = "alice";
  const editor = createNativeEditor({
    site: "site",
    account: "alice",
    tabId: "tab-a",
    editorKind: "Receive",
    doctype: "Stock Entry",
    services,
    recovery,
    currentAccount: () => account,
    valid: (values) => Array.isArray(values.items) && values.items.length > 0,
    values: { items: [] },
  });
  return {
    editor,
    recovery,
    services,
    switchAccount: () => {
      account = "bob";
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("native editor lifecycle", () => {
  it("starts pristine before the first edit", () => {
    const { editor } = setup();
    expect(editor.state.status).toBe("pristine");
  });
  it("asks before replacing dirty input during a reload", async () => {
    const { editor } = setup();
    await editor.load({ doctype: "Stock Entry", name: "NATIVE-1" });
    editor.state.values.remarks = "保留此输入";
    editor.edited();
    expect(editor.state.revision).toBeGreaterThan(editor.state.savedRevision);
    const confirm = vi
      .spyOn(confirmService, "confirm")
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const cancelledReload = editor.load({
      doctype: "Stock Entry",
      name: "NATIVE-1",
    });
    await cancelledReload;
    expect(confirm).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: "放弃未保存输入并重新读取？" }),
    );
    expect(editor.state.values.remarks).toBe("保留此输入");
    expect(editor.state.status).toBe("local");
    expect(editor.state.error).toBe("");

    const acceptedReload = editor.load({
      doctype: "Stock Entry",
      name: "NATIVE-1",
    });
    await acceptedReload;
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(editor.state.values.remarks).toBeUndefined();
    expect(editor.state.status).toBe("saved");
    confirm.mockRestore();
  });
  it("revalidates after login without replacing unsaved values or files, and blocks newer native versions", async () => {
    const { editor, services } = setup();
    await editor.load({ doctype: "Stock Entry", name: "NATIVE-1" });
    editor.state.values.remarks = "本窗口未完成输入";
    editor.edited();
    editor.state.values.attachments = [
      { id: "local-file", name: "凭证.pdf", state: "pending" },
    ];
    await editor.revalidate();
    expect(editor.state.status).toBe("local");
    expect(editor.state.values.remarks).toBe("本窗口未完成输入");
    expect(editor.state.values.attachments).toHaveLength(1);
    vi.mocked(services.load).mockResolvedValue(
      document({ version: "desk-v2" }),
    );
    await editor.revalidate();
    expect(editor.state.status).toBe("conflict");
    expect(editor.state.version).toBe("v1");
    expect(editor.state.values.remarks).toBe("本窗口未完成输入");
  });
  it("retains invalid input locally and does not attempt a native draft", async () => {
    const { editor, services, recovery } = setup();
    editor.edited();
    await editor.save();
    expect(services.create).not.toHaveBeenCalled();
    expect(editor.state.status).toBe("browser");
    expect(recovery.list().entries).toHaveLength(1);
  });
  it("retains edits made in flight and reconciles row identity without replacing input", async () => {
    const { editor, services, recovery } = setup();
    const first = deferred<NativeDocument>();
    vi.mocked(services.create).mockReturnValue(first.promise);
    editor.state.values.items = [{ localId: "local-row", qty: 1 }];
    editor.edited();
    const saving = editor.save();
    (editor.state.values.items as any[])[0].qty = 2;
    editor.edited();
    first.resolve(document());
    await saving;
    expect(services.save).toHaveBeenCalledWith(
      { doctype: "Stock Entry", name: "NATIVE-1" },
      "v1",
      expect.objectContaining({
        items: [{ localId: "local-row", name: "ROW-1", qty: 2 }],
      }),
    );
    expect((editor.state.values.items as any[])[0].qty).toBe(2);
    expect(editor.state.status).toBe("saved");
    expect(recovery.list().entries).toHaveLength(0);
  });
  it("keeps a server-generated batch ID on the matching line after a receipt save", async () => {
    const { editor, services } = setup();
    vi.mocked(services.create).mockImplementation(
      async (_doctype, _requestId, values) => {
        const items = values.items as Record<string, unknown>[];
        items[0]!.batch = "BATCH-1";
        return document({ items: [{ name: "ROW-1", batch: "BATCH-1" }] });
      },
    );
    editor.state.values.items = [{ localId: "local-row", qty: 1 }];
    editor.edited();

    await editor.save();

    expect((editor.state.values.items as any[])[0]).toMatchObject({
      localId: "local-row",
      name: "ROW-1",
      batch: "BATCH-1",
    });
  });
  it("does not send queued input or apply responses after an account switch", async () => {
    const { editor, services, switchAccount } = setup();
    const first = deferred<NativeDocument>();
    vi.mocked(services.create).mockReturnValue(first.promise);
    editor.state.values.items = [{ qty: 1 }];
    editor.edited();
    const saving = editor.save();
    switchAccount();
    first.resolve(document());
    await saving;
    expect(editor.state.identity).toBeUndefined();
    expect(services.save).not.toHaveBeenCalled();
  });
  it("preserves dirty input on stale save and exposes conflict for copy/recovery", async () => {
    const { editor, services, recovery } = setup();
    await editor.load({ doctype: "Stock Entry", name: "NATIVE-1" });
    editor.state.values.remarks = "未完成输入";
    editor.edited();
    vi.mocked(services.save).mockRejectedValue(
      Object.assign(new Error("Desk changed"), {
        kind: "TimestampMismatchError",
      }),
    );
    await editor.save();
    expect(editor.state.status).toBe("conflict");
    expect(editor.state.values.remarks).toBe("未完成输入");
    expect(recovery.list().entries).toHaveLength(1);
    const confirm = vi
      .spyOn(confirmService, "confirm")
      .mockResolvedValueOnce(false);
    await editor.load({ doctype: "Stock Entry", name: "NATIVE-1" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(editor.state.values.remarks).toBe("未完成输入");
    confirm.mockRestore();
  });
  it("retries a lost confirmation response using the same native draft version", async () => {
    const { editor, services } = setup();
    editor.state.values.items = [{ qty: 1 }];
    editor.edited();
    vi.mocked(services.submit).mockRejectedValueOnce(
      new Error("lost response"),
    );
    await editor.confirm();
    expect(editor.state.status).toBe("error");
    await editor.confirm();
    expect(services.create).toHaveBeenCalledTimes(1);
    expect(services.save).not.toHaveBeenCalled();
    expect(services.submit).toHaveBeenNthCalledWith(
      2,
      { doctype: "Stock Entry", name: "NATIVE-1" },
      "v1",
    );
    expect(editor.state.status).toBe("submitted");
  });
  it("checks native state before recovery and cannot resurrect a deleted record", async () => {
    const { editor, services } = setup();
    const candidate: RecoverySnapshot = {
      schema: 1,
      site: "site",
      account: "alice",
      tabId: "old-tab",
      editorId: "old-editor",
      editorKind: "Receive",
      revision: 2,
      updatedAt: "now",
      values: { items: [{ qty: 3 }] },
      identity: { doctype: "Stock Entry", name: "NATIVE-1" },
      baseVersion: "v1",
      pendingUploadReselection: true,
    };
    vi.mocked(services.load).mockRejectedValueOnce(
      Object.assign(new Error("missing"), { kind: "DoesNotExistError" }),
    );
    await editor.inspectRecovery(candidate);
    expect(editor.state.status).toBe("deleted");
    expect(editor.applyRecovery()).toBe(false);
    expect(editor.state.recoveryCandidate?.values).toEqual(candidate.values);
    vi.mocked(services.load).mockResolvedValueOnce(
      document({ version: "newer" }),
    );
    await editor.inspectRecovery(candidate);
    expect(editor.applyRecovery()).toBe(false);
    vi.mocked(services.load).mockResolvedValueOnce(document());
    await editor.inspectRecovery(candidate);
    expect(editor.applyRecovery()).toBe(true);
    expect(editor.state.editorId).not.toBe(candidate.editorId);
    expect(editor.state.pendingUploadReselection).toBe(true);
  });
  it("durably replaces recovered input and reuses its native create request identity", async () => {
    const { editor, recovery, services } = setup();
    const candidate: RecoverySnapshot = {
      schema: 1,
      site: "site",
      account: "alice",
      tabId: "old-tab",
      editorId: "old-editor",
      editorKind: "Receive",
      revision: 3,
      updatedAt: "now",
      values: { items: [{ qty: 3 }] },
      identity: undefined,
      requestId: "stable-create-request",
      pendingUploadReselection: false,
    };
    recovery.save(candidate);
    await editor.inspectRecovery(candidate);
    expect(editor.applyRecovery()).toBe(true);
    expect(editor.state.requestId).toBe("stable-create-request");
    const entries = recovery.list().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.editorId).toBe(editor.state.editorId);
    await editor.save();
    expect(services.create).toHaveBeenCalledWith(
      "Stock Entry",
      "stable-create-request",
      expect.objectContaining({ items: [{ qty: 3 }] }),
    );
  });
  it("keeps a source recovery snapshot changed by another tab while replacing its own copy", async () => {
    const { editor, recovery } = setup();
    const candidate: RecoverySnapshot = {
      schema: 1,
      site: "site",
      account: "alice",
      tabId: "old-tab",
      editorId: "old-editor",
      editorKind: "Receive",
      revision: 3,
      updatedAt: "now",
      values: { items: [{ qty: 3 }] },
      identity: undefined,
      requestId: "stable-create-request",
      pendingUploadReselection: false,
    };
    recovery.save(candidate);
    await editor.inspectRecovery(candidate);
    const competitor = {
      ...candidate,
      tabId: "other-tab",
      revision: 4,
      updatedAt: "later",
      values: { items: [{ qty: 4 }] },
    };
    localStorage.setItem(
      "temple-inventory:recovery:v1:site:alice:old-editor",
      JSON.stringify(competitor),
    );
    expect(editor.applyRecovery()).toBe(true);
    const entries = recovery.list().entries;
    expect(entries).toHaveLength(2);
    expect(
      entries.find((entry) => entry.editorId === "old-editor")?.values,
    ).toEqual(competitor.values);
    expect(
      entries.some((entry) => entry.editorId === editor.state.editorId),
    ).toBe(true);
  });
});
