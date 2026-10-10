import { h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import UiLoadingBoundary from "../src/components/UiLoadingBoundary.vue";

const box = (left: number, top: number, right: number, bottom: number) =>
  ({
    x: left,
    y: top,
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  }) as DOMRect;
const settleFrame = async () => {
  await nextTick();
  for (let index = 0; index < 3; index++) {
    await new Promise((resolve) =>
      requestAnimationFrame(() => resolve(undefined)),
    );
    await nextTick();
  }
};
const viewport = () => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 800,
  });
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UiLoadingBoundary", () => {
  it("centers in the visible nested scroll intersection and tracks scrolling", async () => {
    viewport();
    const region = document.createElement("div");
    const clip = document.createElement("div");
    const scroll = document.createElement("div");
    clip.style.overflow = "auto";
    scroll.append(region);
    clip.append(scroll);
    document.body.append(clip);
    vi.spyOn(clip, "getBoundingClientRect").mockReturnValue(
      box(20, 30, 220, 180),
    );
    const scrollRect = vi
      .spyOn(scroll, "getBoundingClientRect")
      .mockReturnValue(box(50, 60, 190, 160));
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue(
      box(-100, 0, 500, 900),
    );
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: {
        busy: true,
        region,
        scrollElement: scroll,
        message: "正在更新…",
      },
      slots: { default: () => h("p", "retained data") },
    });
    await settleFrame();
    let indicator = document.body.querySelector<HTMLElement>(
      ".ui-loading-boundary__indicator",
    );
    expect(indicator?.textContent).toContain("正在更新…");
    expect(indicator?.style.left).toBe("120px");
    expect(indicator?.style.top).toBe("110px");
    expect(wrapper.text()).toContain("retained data");

    scrollRect.mockReturnValue(box(80, 100, 180, 150));
    window.dispatchEvent(new Event("scroll"));
    await settleFrame();
    indicator = document.body.querySelector<HTMLElement>(
      ".ui-loading-boundary__indicator",
    );
    expect(indicator?.style.left).toBe("130px");
    expect(indicator?.style.top).toBe("125px");
    wrapper.unmount();
    expect(removeSpy).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true,
    );
  });

  it("moves its dim state when the region changes and removes listeners on unmount", async () => {
    viewport();
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue(
      box(10, 10, 600, 500),
    );
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(
      box(20, 20, 700, 600),
    );
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: { busy: true, region: first, dimRegion: true },
      slots: { default: () => h("p", "old value") },
    });
    await settleFrame();
    expect(first.classList.contains("ui-loading-boundary__dim-region")).toBe(
      true,
    );
    await wrapper.setProps({ region: second });
    await settleFrame();
    expect(first.classList.contains("ui-loading-boundary__dim-region")).toBe(
      false,
    );
    expect(second.classList.contains("ui-loading-boundary__dim-region")).toBe(
      true,
    );
    wrapper.unmount();
    expect(second.classList.contains("ui-loading-boundary__dim-region")).toBe(
      false,
    );
  });

  it("keeps an announced status when no visible region can show the indicator", async () => {
    viewport();
    const region = document.createElement("div");
    document.body.append(region);
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue(
      box(1200, 900, 1400, 1100),
    );
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: { busy: true, mode: "initial", region },
      slots: { default: () => h("p", "empty state") },
    });
    await settleFrame();
    const indicator = document.body.querySelector<HTMLElement>(
      ".ui-loading-boundary__indicator",
    );
    expect(
      indicator?.classList.contains("ui-loading-boundary__indicator--hidden"),
    ).toBe(true);
    expect(
      document.body.querySelector('[role="status"]')?.textContent,
    ).toContain("正在加载…");
    expect(wrapper.find(".ui-loading-boundary").attributes("aria-busy")).toBe(
      "true",
    );
    wrapper.unmount();
  });

  it("hides the indicator when a clipped strip is narrower than its measured size", async () => {
    viewport();
    const region = document.createElement("div");
    document.body.append(region);
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue(
      box(995, 100, 1200, 500),
    );
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: { busy: true, region },
    });
    await settleFrame();
    const indicator = document.body.querySelector<HTMLElement>(
      ".ui-loading-boundary__indicator",
    )!;
    Object.defineProperty(indicator, "offsetWidth", {
      configurable: true,
      value: 180,
    });
    Object.defineProperty(indicator, "offsetHeight", {
      configurable: true,
      value: 48,
    });
    window.dispatchEvent(new Event("scroll"));
    await settleFrame();
    expect(
      indicator.classList.contains("ui-loading-boundary__indicator--hidden"),
    ).toBe(true);
    wrapper.unmount();
  });

  it("cancels a pending frame and disconnects resize observers on unmount", async () => {
    viewport();
    let observer:
      | {
          callback: ResizeObserverCallback;
          disconnect: ReturnType<typeof vi.fn>;
        }
      | undefined;
    class MockResizeObserver {
      callback: ResizeObserverCallback;
      disconnect = vi.fn();
      observe = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
        observer = this;
      }
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockReturnValue(77);
    const cancelFrame = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: { busy: true },
    });
    await nextTick();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(cancelFrame).toHaveBeenCalledWith(77);
    expect(observer?.disconnect).toHaveBeenCalledTimes(1);
    observer?.callback([], {} as ResizeObserver);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });

  it("renders within the active modal stacking context", async () => {
    viewport();
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    const region = document.createElement("div");
    dialog.append(region);
    document.body.append(dialog);
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue(
      box(100, 100, 700, 600),
    );
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: { busy: true, region },
    });
    await settleFrame();
    const indicator = document.querySelector(".ui-loading-boundary__indicator");
    expect(dialog.contains(indicator)).toBe(true);
    wrapper.unmount();
  });

  it("keeps initial loading distinct from retained refresh styling and honors reduced motion", async () => {
    viewport();
    const region = document.createElement("div");
    document.body.append(region);
    vi.spyOn(region, "getBoundingClientRect").mockReturnValue(
      box(50, 80, 650, 480),
    );
    const wrapper = mount(UiLoadingBoundary, {
      attachTo: document.body,
      props: { busy: true, mode: "initial", region },
      slots: { default: () => h("p", "empty") },
    });
    await settleFrame();
    expect(document.body.textContent).toContain("正在加载…");
    expect(
      document.body
        .querySelector(".ui-loading-boundary__indicator")
        ?.classList.contains("ui-loading-boundary__indicator--hidden"),
    ).toBe(false);
    expect(wrapper.find(".ui-loading-boundary").classes()).not.toContain(
      "ui-loading-boundary--busy",
    );
    expect(wrapper.find(".ui-loading-boundary").attributes("aria-busy")).toBe(
      "true",
    );
    wrapper.unmount();
    const source = await readFile(
      "src/components/UiLoadingBoundary.vue",
      "utf8",
    );
    expect(source).toContain(
      ".ui-loading-boundary__spinner {\n\t\tanimation: none;",
    );
  });
});
