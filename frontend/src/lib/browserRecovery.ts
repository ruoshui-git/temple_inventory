/** This browser's unfinished input; never a stock record or a server draft. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export interface NativeIdentity {
  doctype: "Stock Entry" | "Stock Reconciliation";
  name: string;
}
export interface RecoverySnapshot {
  schema: 1;
  site: string;
  account: string;
  tabId: string;
  editorId: string;
  editorKind: string;
  identity?: NativeIdentity;
  requestId?: string;
  baseVersion?: string;
  revision: number;
  updatedAt: string;
  values: { [key: string]: JsonValue };
  pendingUploadReselection: boolean;
}
export interface RecoveryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const deniedFields =
  /^(?:password|csrf_token|csrfToken|accessToken|refreshToken|sessionToken|sid|fileBytes|contentBytes|objectUrl|previewUrl|_content|displayName|displayImage|displayTracksBatch|displayTracksExpiry|ti_display_item_name|ti_display_image|ti_display_tracks_batch|ti_display_tracks_expiry)$/i;
function safeValue(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > 30 || value === undefined) return;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string")
    return /^(blob:|data:)/i.test(value) ? undefined : value;
  if (typeof Blob !== "undefined" && value instanceof Blob) return;
  if (Array.isArray(value))
    return value.flatMap((entry) => {
      const result = safeValue(entry, depth + 1);
      return result === undefined ? [] : [result];
    });
  if (typeof value === "object") {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (deniedFields.test(key)) continue;
      const converted = safeValue(entry, depth + 1);
      if (converted !== undefined) result[key] = converted;
    }
    return result;
  }
}

export function recoveryValues(values: unknown): RecoverySnapshot["values"] {
  const result = safeValue(values);
  if (!result || Array.isArray(result) || typeof result !== "object")
    throw new Error("未完成输入的格式无效");
  return result;
}

export function createRecoveryStore(
  site: string,
  account: string,
  storage?: RecoveryStorage,
) {
  const prefix = `temple-inventory:recovery:v1:${encodeURIComponent(site)}:${encodeURIComponent(account)}:`;
  function valid(value: unknown): value is RecoverySnapshot {
    if (!value || typeof value !== "object") return false;
    const candidate = value as RecoverySnapshot;
    return (
      candidate.schema === 1 &&
      candidate.site === site &&
      candidate.account === account &&
      typeof candidate.editorId === "string" &&
      typeof candidate.tabId === "string" &&
      typeof candidate.editorKind === "string" &&
      typeof candidate.updatedAt === "string" &&
      typeof candidate.pendingUploadReselection === "boolean" &&
      (candidate.baseVersion === undefined ||
        typeof candidate.baseVersion === "string") &&
      (candidate.identity === undefined ||
        (!!candidate.identity &&
          ["Stock Entry", "Stock Reconciliation"].includes(
            candidate.identity.doctype,
          ) &&
          typeof candidate.identity.name === "string")) &&
      (candidate.requestId === undefined ||
        typeof candidate.requestId === "string") &&
      Number.isSafeInteger(candidate.revision) &&
      candidate.revision >= 0 &&
      !!candidate.values &&
      !Array.isArray(candidate.values) &&
      typeof candidate.values === "object"
    );
  }
  function read(editorId: string): RecoverySnapshot | undefined {
    if (!site || !account || !storage) return;
    const value = JSON.parse(
      storage.getItem(prefix + encodeURIComponent(editorId)) || "null",
    );
    return valid(value) ? value : undefined;
  }
  return {
    read,
    list(): { entries: RecoverySnapshot[]; error: string } {
      if (!site || !account || !storage)
        return { entries: [], error: "此浏览器无法持久保留未完成输入" };
      try {
        const entries: RecoverySnapshot[] = [];
        for (let index = 0; index < storage.length; index++) {
          const key = storage.key(index);
          if (!key?.startsWith(prefix)) continue;
          try {
            const value = JSON.parse(storage.getItem(key) || "null");
            if (valid(value)) entries.push(value);
          } catch {
            /* A corrupt snapshot does not hide other recoverable editors. */
          }
        }
        return {
          entries: entries.sort((a, b) =>
            b.updatedAt.localeCompare(a.updatedAt),
          ),
          error: "",
        };
      } catch {
        return { entries: [], error: "此浏览器无法读取未完成输入" };
      }
    },
    save(snapshot: RecoverySnapshot): { durable: boolean; error: string } {
      if (!site || !account || !storage || !valid(snapshot))
        return { durable: false, error: "输入尚未持久保留，请勿关闭此页面" };
      try {
        const previous = read(snapshot.editorId);
        if (
          previous &&
          (previous.tabId !== snapshot.tabId ||
            previous.revision > snapshot.revision)
        )
          return {
            durable: false,
            error: "另一窗口的未完成输入保持原样；请在当前编辑器另存",
          };
        storage.setItem(
          prefix + encodeURIComponent(snapshot.editorId),
          JSON.stringify({
            ...snapshot,
            values: recoveryValues(snapshot.values),
          }),
        );
        return { durable: true, error: "" };
      } catch {
        return {
          durable: false,
          error: "此浏览器无法持久保留输入，请保持页面开启或复制输入",
        };
      }
    },
    remove(editorId: string, acknowledgedRevision: number): boolean {
      try {
        const current = read(editorId);
        if (!current || current.revision !== acknowledgedRevision) return false;
        storage!.removeItem(prefix + encodeURIComponent(editorId));
        return true;
      } catch {
        return false;
      }
    },
  };
}
export type BrowserRecoveryStore = ReturnType<typeof createRecoveryStore>;
