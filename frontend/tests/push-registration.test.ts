// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resyncPushDevice,
  subscribePushDevice,
} from "../src/features/settings/useNotificationSettings";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setupPush(subscription: PushSubscription | null) {
  const activeSubscription = subscription;
  const pushManager = {
    getSubscription: vi.fn(async () => activeSubscription),
    subscribe: vi.fn(),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal("Notification", {
    permission: "granted",
    requestPermission: vi.fn(),
  });
  vi.stubGlobal("PushManager", class {});
  return pushManager;
}

function browserSubscription(unsubscribe = vi.fn(async () => true)) {
  const subscription = {
    toJSON: () => ({
      endpoint: `https://push.example.test/${"x".repeat(600)}`,
      keys: { p256dh: "public-key", auth: "auth-key" },
    }),
    unsubscribe,
  } as unknown as PushSubscription;
  return { subscription, unsubscribe };
}

describe("push registration", () => {
  it("unsubscribes a new browser subscription when saving it to the server fails", async () => {
    const { subscription, unsubscribe } = browserSubscription();
    const pushManager = setupPush(null);
    pushManager.subscribe.mockResolvedValue(subscription);
    const services = {
      call: vi.fn(async (method: string) => {
        if (method === "push.public_key") return "AQID";
        throw new Error("server save failed");
      }),
    } as any;

    await expect(subscribePushDevice(services, false)).rejects.toThrow(
      "server save failed",
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("saves an existing long endpoint without creating or replacing the browser subscription", async () => {
    const { subscription, unsubscribe } = browserSubscription();
    const pushManager = setupPush(subscription);
    const services = {
      call: vi.fn(async (method: string) =>
        method === "push.public_key" ? "AQID" : { name: "SUB-1" },
      ),
    } as any;

    const result = await subscribePushDevice(services, false);
    expect(result.subscription).toBe(subscription);
    expect(result.name).toBe("SUB-1");
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(services.call).toHaveBeenCalledWith(
      "push.subscribe",
      expect.objectContaining({ endpoint: expect.stringMatching(/x{600}$/) }),
    );
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("only resaves a browser subscription when the server has not stored its endpoint hash", async () => {
    const { subscription } = browserSubscription();
    setupPush(subscription);
    vi.stubGlobal("crypto", {
      subtle: { digest: vi.fn(async () => new Uint8Array(32).buffer) },
    });
    const services = {
      call: vi.fn(async () => [{ endpoint_hash: "00".repeat(32) }]),
    } as any;

    await resyncPushDevice(services);

    expect(services.call).toHaveBeenCalledWith("push.my_devices");
    expect(services.call).not.toHaveBeenCalledWith(
      "push.subscribe",
      expect.anything(),
    );
  });
});
