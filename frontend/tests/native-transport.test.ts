// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  request,
  refreshSession,
  sessionExpired,
} from "../src/lib/api";
import { preferenceUser } from "../src/lib/uiPreferences";
afterEach(() => {
  vi.unstubAllGlobals();
  sessionExpired.value = false;
  preferenceUser.value = "";
});
describe("account-bound native RPC transport", () => {
  it("reports a Chinese network error without declaring a lost session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(
      request("temple_inventory.warehouses.tree"),
    ).rejects.toMatchObject({
      message: "网络连接失败，请保留当前输入后重试",
      kind: "NetworkError",
      status: 0,
    });
    expect(sessionExpired.value).toBe(false);
  });
  it("recognizes unauthorized responses even when the server body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>Sign in</html>", { status: 401 })),
    );
    await expect(
      request("temple_inventory.warehouses.tree"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(sessionExpired.value).toBe(true);
    sessionExpired.value = false;
    await expect(refreshSession()).rejects.toMatchObject({
      kind: "AuthenticationError",
      message: "请先完成登录",
    });
    expect(sessionExpired.value).toBe(true);
  });
  it("sends the current account binding and keeps native identifiers in structured JSON", async () => {
    preferenceUser.value = "volunteer@example.test";
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: { ready: true } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await request("temple_inventory.configuration.repair_preview", {
      warehouse: "ROOM/A,1",
      field: "physical_root_warehouse",
    });
    const options = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(options.headers).toMatchObject({
      "X-Inventory-Account": "volunteer@example.test",
    });
    expect(JSON.parse(String(options.body)).warehouse).toBe("ROOM/A,1");
  });
});
