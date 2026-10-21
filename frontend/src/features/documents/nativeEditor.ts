import { reactive } from "vue";
import {
  recoveryValues,
  type BrowserRecoveryStore,
  type NativeIdentity,
  type RecoverySnapshot,
} from "../../lib/browserRecovery";

export interface NativeDocument extends NativeIdentity {
  version: string;
  docstatus: 0 | 1 | 2;
  items: Record<string, unknown>[];
  [field: string]: unknown;
}
export interface MatchingCountResult {
  no_adjustment: true;
  existing_draft?: string;
}
export type NativeSaveResult = NativeDocument | MatchingCountResult;
function matching(result: NativeSaveResult): result is MatchingCountResult {
  return result.no_adjustment === true;
}
export interface DocumentServices {
  load(identity: NativeIdentity): Promise<NativeDocument>;
  create(
    doctype: NativeIdentity["doctype"],
    requestId: string,
    values: Record<string, unknown>,
  ): Promise<NativeSaveResult>;
  save(
    identity: NativeIdentity,
    version: string,
    values: Record<string, unknown>,
  ): Promise<NativeSaveResult>;
  submit(identity: NativeIdentity, version: string): Promise<NativeDocument>;
}
export type EditorState =
  | "matching"
  | "local"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "deleted"
  | "forbidden"
  | "submitted"
  | "cancelled";

export function createNativeEditor(options: {
  site: string;
  account: string;
  tabId: string;
  editorKind: string;
  doctype: NativeIdentity["doctype"];
  services: DocumentServices;
  recovery: BrowserRecoveryStore;
  currentAccount(): string;
  valid(values: Record<string, unknown>): boolean;
  values: Record<string, unknown>;
}) {
  const state = reactive({
    editorId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    identity: undefined as NativeIdentity | undefined,
    version: undefined as string | undefined,
    revision: 0,
    savedRevision: -1,
    values: options.values,
    server: undefined as NativeDocument | undefined,
    status: "local" as EditorState,
    error: "",
    recoveryError: "",
    durable: false,
    pendingUploadReselection: false,
    recoveryCandidate: undefined as RecoverySnapshot | undefined,
    confirmationVersion: undefined as string | undefined,
    noAdjustment: false,
  });
  let running: Promise<void> | undefined;
  let pending = false;
  let epoch = 0;
  let disposed = false;
  function active(requestEpoch = epoch) {
    return (
      !disposed &&
      requestEpoch === epoch &&
      options.currentAccount() === options.account
    );
  }
  function retain() {
    if (!active()) return;
    const result = options.recovery.save({
      schema: 1,
      site: options.site,
      account: options.account,
      tabId: options.tabId,
      editorId: state.editorId,
      editorKind: options.editorKind,
      identity: state.identity,
      baseVersion: state.version,
      revision: state.revision,
      updatedAt: new Date().toISOString(),
      values: recoveryValues(state.values),
      pendingUploadReselection: state.pendingUploadReselection,
    });
    state.durable = result.durable;
    state.recoveryError = result.error;
  }
  function edited() {
    if (
      !active() ||
      state.status === "submitted" ||
      state.status === "cancelled"
    )
      return;
    state.revision += 1;
    if (!["conflict", "deleted", "forbidden"].includes(state.status))
      state.status = "local";
    retain();
  }
  function fail(error: unknown) {
    const kind =
      error && typeof error === "object" && "kind" in error
        ? String(error.kind)
        : "";
    state.status =
      kind === "TimestampMismatchError"
        ? "conflict"
        : kind === "DoesNotExistError"
          ? "deleted"
          : kind === "PermissionError"
            ? "forbidden"
            : "error";
    state.error =
      error instanceof Error ? error.message : "保存失败，请保留当前输入并重试";
    retain();
  }
  function mergeRowIdentities(
    sent: Record<string, unknown>,
    response: NativeDocument,
  ) {
    if (!Array.isArray(sent.items) || !Array.isArray(state.values.items))
      return;
    const identifiers = new Map<string, string>();
    sent.items.forEach((row, index) => {
      if (
        row &&
        typeof row === "object" &&
        "localId" in row &&
        response.items[index]?.name
      )
        identifiers.set(
          String(row.localId),
          String(response.items[index]!.name),
        );
    });
    for (const row of state.values.items) {
      if (row && typeof row === "object" && "localId" in row) {
        const name = identifiers.get(String(row.localId));
        if (name) Object.assign(row, { name });
      }
    }
  }
  async function save() {
    if (
      !active() ||
      state.confirmationVersion ||
      ["conflict", "deleted", "forbidden", "submitted", "cancelled"].includes(
        state.status,
      )
    )
      return;
    pending = true;
    if (running) return running;
    const requestEpoch = epoch;
    running = (async () => {
      while (pending && active(requestEpoch)) {
        pending = false;
        if (!options.valid(state.values)) {
          state.status = "local";
          retain();
          return;
        }
        const revision = state.revision;
        const sent = structuredClone(recoveryValues(state.values));
        state.status = "saving";
        state.error = "";
        try {
          const response =
            state.identity && state.version
              ? await options.services.save(state.identity, state.version, sent)
              : await options.services.create(
                  options.doctype,
                  state.requestId,
                  sent,
                );
          if (!active(requestEpoch)) return;
          if (matching(response)) {
            state.noAdjustment = true;
            state.savedRevision = revision;
            state.status = state.revision === revision ? "matching" : "local";
            retain();
            if (state.revision !== revision) pending = true;
            continue;
          }
          state.noAdjustment = false;
          state.server = response;
          state.identity = { doctype: response.doctype, name: response.name };
          state.version = response.version;
          state.savedRevision = revision;
          mergeRowIdentities(sent, response);
          if (state.revision === revision) {
            state.status = "saved";
            options.recovery.remove(state.editorId, revision);
          } else {
            state.status = "local";
            retain();
            pending = true;
          }
        } catch (error) {
          if (active(requestEpoch)) fail(error);
          pending = false;
          return;
        }
      }
    })();
    try {
      await running;
    } finally {
      running = undefined;
    }
  }
  async function confirm() {
    const intendedRevision = state.revision;
    if (!state.confirmationVersion) await save();
    if (
      !active() ||
      (!state.confirmationVersion && state.status !== "saved") ||
      state.savedRevision !== intendedRevision ||
      state.revision !== intendedRevision ||
      !state.identity ||
      !state.version
    )
      throw new Error(state.error || "输入尚未保存或已更改，请重新复核后确认");
    const requestEpoch = epoch;
    try {
      state.confirmationVersion ||= state.version;
      const response = await options.services.submit(
        state.identity,
        state.confirmationVersion,
      );
      if (!active(requestEpoch)) return;
      state.server = response;
      state.version = response.version;
      state.status =
        response.docstatus === 1
          ? "submitted"
          : response.docstatus === 2
            ? "cancelled"
            : "saved";
      state.confirmationVersion = undefined;
      options.recovery.remove(state.editorId, intendedRevision);
    } catch (error) {
      if (active(requestEpoch)) fail(error);
    }
  }
  async function load(identity: NativeIdentity, discardDirty = false) {
    const requestEpoch = ++epoch;
    try {
      const response = await options.services.load(identity);
      if (!active(requestEpoch)) return;
      state.server = response;
      if (
        !discardDirty &&
        state.revision > 0 &&
        state.revision > state.savedRevision
      ) {
        state.status = "conflict";
        state.error = "当前仍有未保存输入，请选择保留、复制或放弃后重新载入";
        retain();
        return;
      }
      state.noAdjustment = false;
      state.identity = identity;
      state.version = response.version;
      state.values = JSON.parse(JSON.stringify(response)) as Record<string, unknown>;
      state.status =
        response.docstatus === 1
          ? "submitted"
          : response.docstatus === 2
            ? "cancelled"
            : "saved";
      state.savedRevision = state.revision;
      state.error = "";
      state.confirmationVersion = undefined;
    } catch (error) {
      if (active(requestEpoch)) fail(error);
    }
  }
  async function revalidate() {
    if (!state.identity || !active()) return;
    const requestEpoch = ++epoch;
    try {
      const response = await options.services.load(state.identity);
      if (!active(requestEpoch)) return;
      state.server = response;
      if (
        response.docstatus === 1 &&
        state.confirmationVersion &&
        response.ti_confirmation_version === state.confirmationVersion
      ) {
        state.version = response.version;
        state.status = "submitted";
        state.savedRevision = state.revision;
        state.error = "";
        return;
      }
      if (response.version !== state.version) {
        state.status = "conflict";
        state.error =
          "记录已在其它窗口更改，当前输入已保留；请复制或重新读取后核对";
      } else if (response.docstatus === 0 && response.editable === false) {
        state.status = "forbidden";
        state.error = "当前已无权编辑此记录，输入仍保留";
      } else {
        state.status =
          response.docstatus === 1
            ? "submitted"
            : response.docstatus === 2
              ? "cancelled"
              : state.revision > state.savedRevision
                ? "local"
                : "saved";
        state.error = "";
      }
      retain();
    } catch (reason) {
      if (active(requestEpoch)) fail(reason);
    }
  }
  async function inspectRecovery(snapshot: RecoverySnapshot) {
    if (
      snapshot.site !== options.site ||
      snapshot.account !== options.account ||
      !active()
    )
      return;
    state.recoveryCandidate = snapshot;
    if (snapshot.identity) await load(snapshot.identity);
  }
  function applyRecovery() {
    const candidate = state.recoveryCandidate;
    if (!candidate || !active()) return false;
    if (
      candidate.identity &&
      (!state.server ||
        state.server.doctype !== candidate.identity.doctype ||
        state.server.name !== candidate.identity.name ||
        state.server.docstatus !== 0 ||
        state.server.version !== candidate.baseVersion)
    ) {
      state.error =
        "原记录已更改、完成、删除或无权访问；请复制未完成输入后处理";
      return false;
    }
    // Recover into a fresh editor so another tab's snapshot is never overwritten.
    state.editorId = crypto.randomUUID();
    state.values = structuredClone(recoveryValues(candidate.values));
    state.pendingUploadReselection = candidate.pendingUploadReselection;
    state.revision = 0;
    state.savedRevision = -1;
    state.recoveryCandidate = undefined;
    state.status = "local";
    edited();
    return true;
  }
  function dispose() {
    disposed = true;
    epoch += 1;
    pending = false;
  }
  return {
    state,
    edited,
    retain,
    save,
    confirm,
    load,
    revalidate,
    inspectRecovery,
    applyRecovery,
    dispose,
  };
}
