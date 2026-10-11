import { mount } from "@vue/test-utils";
import { h, nextTick, ref, defineComponent } from "vue";
import { describe, expect, it, vi, afterEach } from "vitest";
import MobileBrowseHeader from "../src/components/MobileBrowseHeader.vue";
import ReturnToTop from "../src/components/ReturnToTop.vue";
import { useCompactBrowse } from "../src/composables/useCompactBrowse";
import {
  loanBrowseContext,
  movementBrowseContext,
} from "../src/lib/browseContext";

const Tabs = defineComponent({
  template: '<nav aria-label="页面标签">标签</nav>',
});

describe("browse tab query behavior", () => {
  it("preserves the full movement query and applies loan mode status defaults", () => {
    const movement = movementBrowseContext({
      kind: ["Receive", "Transfer"],
      warehouses: ["Room A", "Room B"],
      search: "bell",
    } as any);
    expect(movement[0].query).toEqual(movement[1].query);
    expect(movement[1].query.kind).toEqual(["Receive", "Transfer"]);

    const itemMode = loanBrowseContext("/loans/items", {
      status: "settled",
      search: "bell",
      sort_by: "loan_date",
    } as any);
    expect(itemMode[0].query.status).toBe("settled");
    expect(itemMode[1].query).toEqual({ search: "bell" });

    const recordMode = loanBrowseContext("/loans/records", {
      status: "settled",
      search: "bell",
    } as any);
    expect(recordMode[1].query.status).toBe("settled");
    expect(recordMode[0].query).toEqual({ search: "bell" });
  });
});

describe("mobile browse header", () => {
  it("keeps one semantic heading, search and tabs available in compact mode", async () => {
    const wrapper = mount(MobileBrowseHeader, {
      props: {
        title: "货物流动 · 明细",
        shortTitle: "货物流动",
        compact: true,
        destinationKey: "items",
      },
      slots: {
        tabs: Tabs,
        "search-actions":
          '<label><input type="search" aria-label="搜索货物流动"></label>',
        secondary: '<button type="button">近30天</button>',
      },
      attachTo: document.body,
    });

    expect(wrapper.findAll("h1")).toHaveLength(1);
    expect(wrapper.find('[aria-label="搜索货物流动"]').exists()).toBe(true);
    expect(wrapper.find('[aria-label="页面标签"]').exists()).toBe(true);
    expect(
      wrapper.get(".mobile-browse-tools-toggle").attributes("aria-expanded"),
    ).toBe("false");
    expect(wrapper.get(".mobile-browse-tools-chevron").exists()).toBe(true);
    expect(
      wrapper.get(".mobile-browse-secondary").attributes("aria-hidden"),
    ).toBe("true");
    await wrapper.get(".mobile-browse-tools-toggle").trigger("click");
    expect(
      wrapper.get(".mobile-browse-secondary").attributes("aria-hidden"),
    ).toBeUndefined();
    expect(
      wrapper.get(".mobile-browse-tools-toggle").attributes("aria-expanded"),
    ).toBe("true");
    expect(
      wrapper.get(".mobile-browse-tools-chevron").attributes("aria-hidden"),
    ).toBe("true");

    const secondaryButton = wrapper.get(".mobile-browse-secondary button");
    (secondaryButton.element as HTMLButtonElement).focus();
    await wrapper.get(".mobile-browse-tools-toggle").trigger("click");
    await nextTick();
    expect(document.activeElement).toBe(
      wrapper.get(".mobile-browse-tools-toggle").element,
    );
    await wrapper.setProps({ destinationKey: "records" });
    expect(
      wrapper.get(".mobile-browse-tools-toggle").attributes("aria-expanded"),
    ).toBe("false");
    wrapper.unmount();
  });
});

describe("return to top", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the active surface threshold, hides under overlays and restores heading focus", async () => {
    const root = document.createElement("div");
    Object.defineProperties(root, {
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, writable: true, value: 599 },
    });
    const scrollTo = vi.fn();
    Object.defineProperty(root, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    const heading = document.createElement("h1");
    const focus = vi.spyOn(heading, "focus");
    const target = ref<HTMLElement | undefined>(root);
    const hidden = ref(false);
    const wrapper = mount(ReturnToTop, {
      props: { target: target.value, heading, hidden: hidden.value },
    });

    expect(wrapper.find("button").exists()).toBe(false);
    (root as HTMLElement).scrollTop = 600;
    root.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(wrapper.find("button").exists()).toBe(false);
    (root as HTMLElement).scrollTop = 601;
    root.dispatchEvent(new Event("scroll"));
    await nextTick();
    expect(wrapper.get("button").attributes("aria-label")).toBe("返回顶部");
    expect(wrapper.get("button").attributes("title")).toBe("返回顶部");
    expect(wrapper.get("button svg").exists()).toBe(true);
    expect(wrapper.get(".return-to-top-tooltip").text()).toBe("返回顶部");
    expect(
      wrapper.get(".return-to-top-tooltip").attributes("aria-hidden"),
    ).toBe("true");

    await wrapper.setProps({ hidden: true });
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.setProps({ hidden: false, floatingActionOpen: true });
    expect(wrapper.find("button").exists()).toBe(false);
    await wrapper.setProps({ floatingActionOpen: false });
    await wrapper.get("button").trigger("click");
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    wrapper.unmount();
  });

  it("reattaches listeners for a new root and honors reduced motion", async () => {
    const makeRoot = (scrollTop: number) => {
      const root = document.createElement("div");
      Object.defineProperties(root, {
        clientHeight: { configurable: true, value: 200 },
        scrollTop: { configurable: true, writable: true, value: scrollTop },
      });
      root.scrollTo = vi.fn();
      return root;
    };
    const firstRoot = makeRoot(500);
    const secondRoot = makeRoot(401);
    const heading = document.createElement("h1");
    const resizeObservers: Array<{
      observe: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = vi.fn();
        constructor(_callback: ResizeObserverCallback) {
          resizeObservers.push(this);
        }
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const wrapper = mount(ReturnToTop, {
      props: { target: firstRoot, heading },
    });
    await nextTick();
    expect(wrapper.find("button").exists()).toBe(true);

    await wrapper.setProps({ target: secondRoot });
    expect(wrapper.find("button").exists()).toBe(true);
    expect(resizeObservers[0].disconnect).toHaveBeenCalledOnce();
    await wrapper.get("button").trigger("click");
    expect(secondRoot.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "auto",
    });
    wrapper.unmount();
    expect(resizeObservers[1].disconnect).toHaveBeenCalledOnce();
  });
});

describe("compact browse scroll tracking", () => {
  it("follows the restored active root and disconnects listeners and observers", async () => {
    const makeRoot = (scrollTop: number) => {
      const root = document.createElement("div");
      Object.defineProperty(root, "scrollTop", {
        configurable: true,
        writable: true,
        value: scrollTop,
      });
      return root;
    };
    const firstRoot = makeRoot(81);
    const secondRoot = makeRoot(0);
    const root = ref<HTMLElement | undefined>(firstRoot);
    const observers: Array<{
      callback: ResizeObserverCallback;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) {
          observers.push({ callback, disconnect: this.disconnect });
        }
        observe = vi.fn();
      },
    );
    let compact = ref(false);
    const Harness = defineComponent({
      setup() {
        compact = useCompactBrowse(root).compact;
        return () => h("div", { "data-compact": String(compact.value) });
      },
    });
    const wrapper = mount(Harness);
    await nextTick();
    expect(compact.value).toBe(true);

    root.value = secondRoot;
    await nextTick();
    expect(compact.value).toBe(false);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    firstRoot.dispatchEvent(new Event("scroll"));
    expect(compact.value).toBe(false);

    secondRoot.scrollTop = 81;
    secondRoot.dispatchEvent(new Event("scroll"));
    expect(compact.value).toBe(true);
    secondRoot.scrollTop = 0;
    observers[1].callback([], {} as ResizeObserver);
    expect(compact.value).toBe(false);
    wrapper.unmount();
    expect(observers[1].disconnect).toHaveBeenCalledOnce();
  });
});
