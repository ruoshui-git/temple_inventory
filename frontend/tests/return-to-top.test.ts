// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import ReturnToTop from "../src/components/ui/ReturnToTop.vue";
import { useFocusVisibility } from "../src/composables/useFocusVisibility";
import { ref } from "vue";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("ReturnToTop", () => {
  it("scrolls the active element owner to zero and focuses the routed page heading", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const scrollTo = vi.fn();
    const Page = defineComponent({
      setup() {
        return () =>
          h("main", { class: "scroll-owner" }, [
            h("section", { class: "browse-page" }, [
              h("h1", "库存"),
              h(ReturnToTop),
            ]),
          ]);
      },
    });
    const wrapper = mount(Page, { attachTo: document.body });
    const owner = wrapper.get(".scroll-owner").element as HTMLElement;
    Object.defineProperties(owner, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 0 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    owner.style.overflowY = "auto";
    await flushPromises();
    owner.scrollTop = 200;
    window.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(wrapper.get("button[aria-label='返回顶部']").exists()).toBe(true);
    await wrapper.get("button[aria-label='返回顶部']").trigger("click");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(document.activeElement).toBe(wrapper.get("h1").element);
    wrapper.unmount();
  });

  it("targets the dashboard heading when cached route headings are also mounted", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const scrollTo = vi.fn();
    const Page = defineComponent({
      setup() {
        return () =>
          h("main", { class: "scroll-owner" }, [
            h("div", { class: "dashboard" }, [
              h("h1", "Dashboard"),
              h("section", { class: "cached browse-page" }, [
                h("h1", "Cached"),
              ]),
              h(ReturnToTop),
            ]),
          ]);
      },
    });
    const wrapper = mount(Page, { attachTo: document.body });
    const owner = wrapper.get(".scroll-owner").element as HTMLElement;
    Object.defineProperties(owner, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 200 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    owner.style.overflowY = "auto";
    await flushPromises();
    owner.dispatchEvent(new Event("scroll"));
    await flushPromises();
    await wrapper.get("button[aria-label='返回顶部']").trigger("click");
    expect(document.activeElement).toBe(wrapper.get(".dashboard > h1").element);
    wrapper.unmount();
  });
  it("does not let focus visibility interrupt ReturnToTop for a visible sticky inventory heading", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const scrollTo = vi.fn();
    const scrollBy = vi.fn();
    vi.spyOn(window, "scrollTo").mockImplementation(scrollTo);
    vi.spyOn(window, "scrollBy").mockImplementation(scrollBy);
    let queued: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      queued = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const Page = defineComponent({
      setup() {
        const root = ref<HTMLElement>();
        const chrome = ref<HTMLElement>();
        useFocusVisibility(
          root,
          ref<HTMLElement>(),
          () => true,
          () => true,
          chrome,
        );
        return () =>
          h("div", { ref: root, class: "inventory-example" }, [
            h("header", { ref: chrome, class: "inventory-browse-header" }, [
              h("h1", "库存"),
            ]),
            h(ReturnToTop),
          ]);
      },
    });
    const wrapper = mount(Page, { attachTo: document.body });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function () {
        if (this.matches(".inventory-example"))
          return {
            left: 0,
            right: 1000,
            top: 0,
            bottom: 800,
            width: 1000,
            height: 800,
            x: 0,
            y: 0,
            toJSON: () => {},
          } as DOMRect;
        if (this.matches(".inventory-browse-header"))
          return {
            left: 0,
            right: 1000,
            top: 0,
            bottom: 48,
            width: 1000,
            height: 48,
            x: 0,
            y: 0,
            toJSON: () => {},
          } as DOMRect;
        if (this.matches("h1"))
          return {
            left: 20,
            right: 200,
            top: 0,
            bottom: 40,
            width: 180,
            height: 40,
            x: 20,
            y: 0,
            toJSON: () => {},
          } as DOMRect;
        return {
          left: 0,
          right: 44,
          top: 200,
          bottom: 244,
          width: 44,
          height: 44,
          x: 0,
          y: 200,
          toJSON: () => {},
        } as DOMRect;
      },
    );
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 220,
    });
    await flushPromises();
    await wrapper.get("button[aria-label='返回顶部']").trigger("click");
    queued?.(0);
    await flushPromises();
    expect(document.activeElement).toBe(wrapper.get("h1").element);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(scrollBy).not.toHaveBeenCalled();
    wrapper.unmount();
  });
  it("stays hidden on an inactive surface", async () => {
    const wrapper = mount(ReturnToTop, { props: { active: false } });
    await flushPromises();
    expect(wrapper.find("button").exists()).toBe(false);
    wrapper.unmount();
  });
  it("hides only while the caller reports the mobile filter sheet open", async () => {
    const owner = document.createElement("main");
    owner.className = "browse-page";
    owner.style.overflowY = "auto";
    Object.defineProperties(owner, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 500 },
      scrollTop: { configurable: true, writable: true, value: 220 },
    });
    document.body.append(owner);
    const wrapper = mount(ReturnToTop, {
      attachTo: owner,
      props: { active: true, hidden: false },
    });
    await flushPromises();
    expect(wrapper.find("button[aria-label='返回顶部']").exists()).toBe(true);
    await wrapper.setProps({ hidden: true });
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.setProps({ hidden: false });
    await flushPromises();
    expect(wrapper.find("button[aria-label='返回顶部']").exists()).toBe(true);
    wrapper.unmount();
    owner.remove();
  });
});
