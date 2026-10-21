import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import MorePage from "../src/features/more/MorePage.vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import type { MoreHost } from "../src/features/more/useMoreController";
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
describe("shared More workspace", () => {
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
});
