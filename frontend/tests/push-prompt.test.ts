// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { computed, defineComponent, h } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import PushPrompt from "../src/features/notifications/PushPrompt.vue";

vi.mock("vue-router", () => ({ useRoute: () => ({ meta: {} }) }));
vi.mock("../src/composables/useResponsiveLayout", () => ({
  useResponsiveLayout: () => ({ isMobile: computed(() => false) }),
}));

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("push prompt failure flow", () => {
  it("ends the prompt after permission succeeds but subscription registration fails", async () => {
    vi.stubEnv("DEV", false);
    vi.stubGlobal("Notification", {
      permission: "default",
      requestPermission: vi.fn(async () => {
        Object.defineProperty(Notification, "permission", { value: "granted" });
        return "granted";
      }),
    });
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve({
          pushManager: {
            getSubscription: vi.fn(async () => null),
            subscribe: vi.fn(async () => {
              throw new Error("subscription failed");
            }),
          },
        }),
      },
    });
    const call = vi.fn(async (method: string) => {
      if (method === "preferences.push_prompt_dismissed") return false;
      if (method === "push.public_key") return "AQID";
      return {};
    });
    const reference = createReferenceData();
    Object.assign(reference, { user: "alice", site: "site" });
    const Root = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(PushPrompt);
      },
    });
    const wrapper = mount(Root);
    wrappers.push(wrapper);
    await flushPromises();
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "subscription failed",
    );
    expect(wrapper.text()).toContain("关闭");
    await wrapper.get("button:nth-of-type(3)").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find("aside").exists()).toBe(false);
  });
});
