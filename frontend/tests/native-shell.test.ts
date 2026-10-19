import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import AppFrame from "../src/components/AppFrame.vue";
import {
  primaryNavigation,
  mobilePrimaryNavigation,
  inventoryNavigation,
  destinationForPath,
} from "../src/lib/appNavigation";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});
describe("shared application frame", () => {
  it("mounts one navigation surface, retains page input across breakpoint changes and removes its listener", async () => {
    let change: ((event: { matches: boolean }) => void) | undefined;
    const remove = vi.fn(),
      media = {
        matches: false,
        addEventListener: vi.fn((_name, callback) => {
          change = callback;
        }),
        removeEventListener: remove,
      };
    vi.stubGlobal("matchMedia", () => media);
    const wrapper = mount(AppFrame, {
      props: {
        primary: primaryNavigation,
        mobilePrimary: mobilePrimaryNavigation,
        inventory: inventoryNavigation,
        moreRoute: "/more",
        user: "volunteer",
        active: "inventory",
      },
      slots: { default: '<input aria-label="未完成输入" />' },
    });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.findAll('nav[aria-label="应用主导航"]')).toHaveLength(1);
    expect(wrapper.find(".sample-mobile-nav").exists()).toBe(true);
    expect(wrapper.findAll(".sample-mobile-nav button")).toHaveLength(6);
    await wrapper.find("input").setValue("保留输入");
    media.matches = true;
    change?.({ matches: true });
    await flushPromises();
    expect(wrapper.findAll('nav[aria-label="应用主导航"]')).toHaveLength(1);
    expect(wrapper.find(".sample-sidebar").exists()).toBe(true);
    expect(
      wrapper.findAll(".sample-sidebar > nav > .nav-group > button"),
    ).toHaveLength(5);
    expect(wrapper.findAll(".preview-tools-link")).toHaveLength(1);
    expect(wrapper.find("input").element.value).toBe("保留输入");
    await wrapper.find(".nav-group button").trigger("click");
    expect(wrapper.emitted("primary")?.at(-1)).toEqual(["/"]);
    wrapper.unmount();
    wrappers.pop();
    expect(remove).toHaveBeenCalledWith("change", expect.any(Function));
  });
  it("assigns inventory, count and loan settlement details to their owning domains", () => {
    expect(destinationForPath("/expiry")).toBe("inventory");
    expect(destinationForPath("/pending")).toBe("inventory");
    expect(destinationForPath("/counts")).toBe("more");
    expect(destinationForPath("/reconcile/new")).toBe("more");
    expect(destinationForPath("/new/Loss", "Loss", true)).toBe("loans");
    expect(destinationForPath("/documents/Stock%20Entry/LOAN-A", "Loan")).toBe(
      "loans",
    );
    expect(destinationForPath("/reports")).toBe("reports");
  });
});
