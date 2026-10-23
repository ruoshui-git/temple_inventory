import { request, ApiError } from "../lib/api";
import { sessionExpired } from "../lib/sessionState";
import { preferenceUser } from "../lib/uiPreferences";
import { watch } from "vue";
import type { InventoryServices } from "./contracts";

const shareableReads = new Set([
  "browse.dashboard_card",
  "browse.expiry_page",
  "browse.inventory_page",
  "browse.operation_analysis",
  "browse.operation_contributions",
  "browse.operation_page",
  "browse.counts_page",
  "browse.native_drafts",
  "temple_inventory.projections.group_page",
]);
interface SharedRead {
  account: string;
  controller: AbortController;
  consumers: Set<symbol>;
  settled: boolean;
  promise: Promise<unknown>;
}
const pendingReads = new Map<string, SharedRead>();
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
function accountKey() {
  return `${window.location.host}:${preferenceUser.value}`;
}
function sharedRead<T>(
  key: string,
  signal: AbortSignal | undefined,
  start: (signal: AbortSignal) => Promise<T>,
) {
  if (signal?.aborted)
    return Promise.reject(
      signal.reason || new DOMException("Aborted", "AbortError"),
    );
  let entry = pendingReads.get(key) as SharedRead | undefined;
  if (!entry) {
    const controller = new AbortController();
    entry = {
      account: accountKey(),
      controller,
      consumers: new Set(),
      settled: false,
      promise: Promise.resolve().then(() => start(controller.signal)),
    };
    const current = entry;
    pendingReads.set(key, current);
    current.promise
      .finally(() => {
        current.settled = true;
        if (pendingReads.get(key) === current) pendingReads.delete(key);
      })
      .catch(() => undefined);
  }
  const current = entry;
  const consumer = Symbol("read-consumer");
  current.consumers.add(consumer);
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      signal?.removeEventListener("abort", abort);
      current.consumers.delete(consumer);
    };
    const abort = () => {
      finish();
      reject(signal?.reason || new DOMException("Aborted", "AbortError"));
      if (!current.settled && current.consumers.size === 0) {
        if (pendingReads.get(key) === current) pendingReads.delete(key);
        current.controller.abort();
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    current.promise.then(
      (value) => {
        if (done) return;
        finish();
        if (current.account !== accountKey()) {
          reject(new DOMException("Account changed", "AbortError"));
          return;
        }
        resolve(value as T);
      },
      (error) => {
        if (done) return;
        finish();
        reject(error);
      },
    );
  });
}
function readKey(endpoint: string, args: Record<string, unknown>) {
  return `${accountKey()}:${endpoint}:${stable(args)}`;
}
function methodPath(endpoint: string) {
  return endpoint.startsWith("temple_inventory.")
    ? endpoint
    : `temple_inventory.${endpoint}`;
}
watch(preferenceUser, (next, previous) => {
  if (!previous || next === previous) return;
  for (const entry of pendingReads.values()) entry.controller.abort();
  pendingReads.clear();
});

function upload(
  file: File,
  doctype: string,
  name: string,
  progress?: (value: number) => void,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const data = new FormData();
    data.append("file", file);
    data.append("is_private", "1");
    data.append("doctype", doctype);
    data.append("docname", name);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/method/upload_file");
    xhr.withCredentials = true;
    if (preferenceUser.value)
      xhr.setRequestHeader("X-Inventory-Account", preferenceUser.value);
    xhr.setRequestHeader(
      "X-Frappe-CSRF-Token",
      String((window as unknown as { csrf_token?: string }).csrf_token || ""),
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress?.(
          Math.min(99, Math.round((event.loaded / event.total) * 100)),
        );
    };
    xhr.onerror = () =>
      reject(new ApiError("网络中断，文件尚未确认上传完成", 0, "NetworkError"));
    xhr.onabort = () =>
      reject(new ApiError("上传已中断，请重试", 0, "NetworkError"));
    xhr.onload = () => {
      let body: {
        message?: Record<string, unknown>;
        exc?: string;
        exc_type?: string;
      };
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new ApiError(`上传失败（${xhr.status}）`, xhr.status, "UploadError"),
        );
        return;
      }
      if (
        xhr.status === 401 ||
        ["AuthenticationError", "CSRFTokenError"].includes(body.exc_type || "")
      )
        sessionExpired.value = true;
      if (xhr.status < 200 || xhr.status >= 300 || body.exc || !body.message) {
        reject(
          new ApiError(
            xhr.status === 403
              ? "没有上传到此记录的权限"
              : "上传失败，文件仍保留在当前窗口，请重试",
            xhr.status,
            body.exc_type || "UploadError",
          ),
        );
        return;
      }
      progress?.(100);
      resolve(body.message);
    };
    progress?.(0);
    xhr.send(data);
  });
}
export const frappeServices: InventoryServices = {
  call: (endpoint, args = {}, signal) =>
    shareableReads.has(endpoint) || shareableReads.has(methodPath(endpoint))
      ? sharedRead(
          readKey(methodPath(endpoint), args),
          signal,
          (sharedSignal) =>
            request(methodPath(endpoint), args, undefined, sharedSignal),
        )
      : request(methodPath(endpoint), args, undefined, signal),
  report: (query, options = {}, signal) => {
    const args = { query, ...options };
    return sharedRead(
      readKey("temple_inventory.projections.report_page", args),
      signal,
      (sharedSignal) =>
        request(
          "temple_inventory.projections.report_page",
          args,
          undefined,
          sharedSignal,
        ),
    );
  },
  upload,
};
