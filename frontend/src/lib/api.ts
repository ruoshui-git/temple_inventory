import {
  capturePreferenceRevision,
  refreshServerPreferences,
  preferenceUser,
  type DisplayPreferences,
} from "./uiPreferences";
import { sessionExpired } from "./sessionState";
export { sessionExpired } from "./sessionState";
let sessionInfoRequestId = 0;
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind = "",
  ) {
    super(message);
  }
}
export async function request(
  path: string,
  args: Record<string, unknown> = {},
  form?: FormData,
  signal?: AbortSignal,
): Promise<any> {
  let r: Response;
  try {
    r = await fetch(`/api/method/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        ...(!form ? { "Content-Type": "application/json" } : {}),
        "X-Frappe-CSRF-Token": (window as any).csrf_token || "",
        ...(preferenceUser.value
          ? { "X-Inventory-Account": preferenceUser.value }
          : {}),
      },
      body: form || JSON.stringify(args),
      signal,
    });
  } catch (reason) {
    if (signal?.aborted) throw reason;
    throw new ApiError("网络连接失败，请保留当前输入后重试", 0, "NetworkError");
  }
  if (r.status === 401) sessionExpired.value = true;
  let body: any;
  try {
    body = await r.json();
  } catch {
    throw new ApiError(
      r.status ? `请求失败（${r.status}）` : "网络连接失败",
      r.status,
      "NetworkError",
    );
  }
  if (!r.ok || body.exc) {
    if (
      r.status === 401 ||
      body.exc_type === "AuthenticationError" ||
      body.exc_type === "CSRFTokenError"
    )
      sessionExpired.value = true;
    let message = body.message || "操作失败";
    try {
      const messages = JSON.parse(body._server_messages || "[]");
      message =
        messages
          .map((m: any) =>
            typeof m === "string" ? JSON.parse(m).message : m.message,
          )
          .join("\n") || message;
    } catch {
      /* use server message */
    }
    const clean = String(message).replace(/<[^>]*>/g, "");
    const translated =
      body.exc_type === "MandatoryError" || clean.includes("MandatoryError")
        ? "请填写所有必填字段"
        : clean.includes("Permission") ||
            /Not permitted|permission denied/i.test(clean)
          ? "您没有执行此操作的权限"
          : clean || "操作失败";
    throw new ApiError(translated, r.status, body.exc_type);
  }
  return body.message;
}
export async function refreshSession() {
  const requestId = ++sessionInfoRequestId;
  const preferenceRevision = capturePreferenceRevision();
  let r: Response;
  try {
    r = await fetch("/api/method/temple_inventory.session.info", {
      credentials: "same-origin",
    });
  } catch (error) {
    if (requestId !== sessionInfoRequestId) return;
    throw new ApiError("网络连接失败，请检查连接后重试", 0, "NetworkError");
  }
  if (requestId !== sessionInfoRequestId) return;
  let body: any;
  try {
    body = await r.json();
  } catch {
    if (requestId !== sessionInfoRequestId) return;
    if (r.status === 401) {
      sessionExpired.value = true;
      throw new ApiError("请先完成登录", r.status, "AuthenticationError");
    }
    throw new ApiError("无法读取登录状态，请重试", r.status, "SessionError");
  }
  if (!r.ok || body.exc) {
    if (
      r.status === 401 ||
      body.exc_type === "AuthenticationError" ||
      body.exc_type === "CSRFTokenError"
    ) {
      sessionExpired.value = true;
      throw new ApiError(
        "请先完成登录",
        r.status,
        body.exc_type || "AuthenticationError",
      );
    }
    throw new ApiError(
      r.status === 403
        ? "当前账户无权使用物资管理，请联系管理员"
        : "无法读取登录状态，请重试",
      r.status,
      body.exc_type || "SessionError",
    );
  }
  const d = body.message;
  if (!d?.user || !d.csrf_token)
    throw new ApiError(
      "未能确认登录状态，请重新登录",
      r.status,
      "AuthenticationError",
    );
  if (requestId !== sessionInfoRequestId) return;
  (window as any).csrf_token = d.csrf_token;
  refreshServerPreferences(
    String(d.user || ""),
    d.ui_preferences,
    preferenceRevision,
  );
  sessionExpired.value = false;
  return d as {
    user: string;
    csrf_token: string;
    ui_preferences: DisplayPreferences;
  };
}
