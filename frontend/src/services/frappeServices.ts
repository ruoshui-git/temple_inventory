import { request, ApiError } from "../lib/api";
import { sessionExpired } from "../lib/sessionState";
import { preferenceUser } from "../lib/uiPreferences";
import type { InventoryServices } from "./contracts";

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
  call: (endpoint, args, signal) =>
    request(`temple_inventory.${endpoint}`, args, undefined, signal),
  report: (query, options = {}, signal) =>
    request(
      "temple_inventory.projections.report_page",
      { query, ...options },
      undefined,
      signal,
    ),
  upload,
};
