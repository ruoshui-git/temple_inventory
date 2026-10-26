import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import MorePage from "../src/features/more/MorePage.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import type { MoreHost } from "../src/features/more/useMoreController";
import { useLogoutController } from "../src/features/more/useLogoutController";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});
function setup(
  call = vi.fn(async () => ({ draft_count: 42 })),
  changes: Partial<MoreHost> = {},
) {
  const reference = createReferenceData();
  Object.assign(reference, { user: "volunteer", site: "site" });
  const host: MoreHost = {
    platform: () => "ios",
    standalone: () => false,
    install: vi.fn(async () => false),
    logout: vi.fn(async () => undefined),
    afterLogout: vi.fn(),
    ...changes,
  };
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(MorePage, { host });
    },
  });
  const wrapper = mount(root, { attachTo: document.body });
  wrappers.push(wrapper);
  const page = wrapper.findComponent(MorePage);
  return { wrapper, page, c: page.vm.controller, host, reference };
}
function logoutSetup(host: Pick<MoreHost, "logout" | "afterLogout">) {
  const reference = createReferenceData();
  Object.assign(reference, { user: "volunteer", site: "site" });
  let controller!: ReturnType<typeof useLogoutController>;
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call: vi.fn(), report: vi.fn(), upload: vi.fn() },
        reference,
      );
      controller = useLogoutController(host, () => reference.user);
      return () => h("div");
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { controller, reference };
}
describe("shared More workspace", () => {
  it("renders destinations as compact content rows with title and description", async () => {
    const { wrapper } = setup();
    await flushPromises();
    const row = wrapper.find("button.more-card");
    expect(row.exists()).toBe(true);
    expect(row.element.children[0]?.tagName).toBe("SPAN");
    expect(row.find("strong").exists()).toBe(true);
    expect(row.find("small").exists()).toBe(true);
  });
  it("uses the shared native count browser as the single count card destination", async () => {
    const { wrapper, page } = setup();
    await flushPromises();
    expect(wrapper.text()).toContain("42");
    const count = wrapper
      .findAll("button")
      .filter((button) => button.text().includes("盘点调整"));
    expect(count).toHaveLength(1);
    await count[0]!.trigger("click");
    expect(page.emitted("navigate")?.[0]).toEqual([
      { name: "counts", params: {}, query: {} },
    ]);
    expect(wrapper.text()).toContain("volunteer");
  });
  it("keeps failures distinct from zero and allows retrying a failed draft counter", async () => {
    let fail = true;
    const { c } = setup(
      vi.fn(async () => {
        if (fail) throw new Error("草稿数量读取失败");
        return { draft_count: 0 };
      }),
    );
    await flushPromises();
    expect(c.draftCount.value).toBeUndefined();
    expect(c.summaryError.value).toBeTruthy();
    fail = false;
    await c.load();
    expect(c.draftCount.value).toBe(0);
    expect(c.summaryError.value).toBe("");
  });
  it("shows platform-specific guidance without claiming installation", async () => {
    const { c, host } = setup();
    await flushPromises();
    await c.install();
    expect(host.install).toHaveBeenCalledOnce();
    expect(c.installOpen.value).toBe(true);
    expect(c.guidance.value).toContain("Safari");
    expect(c.canInstall.value).toBe(true);
  });
  it("retains a failed logout and retries the native host action before redirecting", async () => {
    let fail = true;
    const { c, host } = setup(undefined, {
      logout: vi.fn(async () => {
        if (fail) throw new Error("退出失败");
      }),
    });
    await flushPromises();
    c.logoutOpen.value = true;
    await c.logout();
    expect(c.error.value).toBe("退出失败");
    expect(c.logoutOpen.value).toBe(true);
    expect(host.afterLogout).not.toHaveBeenCalled();
    fail = false;
    await c.logout();
    expect(host.afterLogout).toHaveBeenCalledOnce();
  });
  it("ignores a late logout response from a previous account", async () => {
    let finish!: () => void;
    const { c, host, reference } = setup(undefined, {
      logout: vi.fn(() => new Promise<void>((done) => (finish = done))),
    });
    await flushPromises();
    const pending = c.logout();
    reference.user = "other";
    finish();
    await pending;
    expect(host.afterLogout).not.toHaveBeenCalled();
  });
  it("shares confirmed logout dismissal, failure retry, and account-change protection", async () => {
    let fail = true;
    const host = {
      logout: vi.fn(async () => {
        if (fail) throw new Error("退出失败");
      }),
      afterLogout: vi.fn(),
    };
    const { controller, reference } = logoutSetup(host);
    controller.show();
    expect(controller.open.value).toBe(true);
    controller.close();
    expect(controller.open.value).toBe(false);
    controller.show();
    await controller.logout();
    expect(controller.error.value).toBe("退出失败");
    expect(controller.open.value).toBe(true);
    fail = false;
    await controller.logout();
    expect(host.afterLogout).toHaveBeenCalledOnce();

    let finish!: () => void;
    const guarded = logoutSetup({
      logout: vi.fn(() => new Promise<void>((done) => (finish = done))),
      afterLogout: vi.fn(),
    });
    guarded.controller.show();
    const pending = guarded.controller.logout();
    guarded.reference.user = "another-user";
    await flushPromises();
    expect(guarded.controller.open.value).toBe(false);
    finish();
    await pending;
    expect(guarded.controller.open.value).toBe(false);
  });
});
