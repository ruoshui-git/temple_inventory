import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import {
  shouldShowFloatingScrollbar,
  useFloatingScrollbar,
} from "../src/composables/useFloatingScrollbar";

function rect(top: number, left = 20, width = 500, height = 240) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {},
  } as DOMRect;
}

describe("floating table scrollbar", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows only while the native bar is below the viewport and syncs both ways", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    let tableRef = ref<HTMLElement>();
    let proxyRef = ref<HTMLElement>();
    let state: ReturnType<typeof useFloatingScrollbar>;
    const wrapper = mount(
      defineComponent({
        setup() {
          tableRef = ref<HTMLElement>();
          proxyRef = ref<HTMLElement>();
          state = useFloatingScrollbar(tableRef, proxyRef);
          return () => h("div", { ref: tableRef });
        },
      }),
    );
    const table = tableRef.value!;
    Object.defineProperties(table, {
      scrollWidth: { configurable: true, value: 1200 },
      clientWidth: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      getBoundingClientRect: { configurable: true, value: () => rect(700) },
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    await nextTick();
    expect(state!.visible.value).toBe(true);
    expect(state!.spacerWidth.value).toBe(1200);

    proxyRef.value = document.createElement("div");
    Object.defineProperty(proxyRef.value, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 320,
    });
    state!.fromProxy({ currentTarget: proxyRef.value } as unknown as Event);
    expect(table.scrollLeft).toBe(320);
    Object.defineProperty(table, "scrollLeft", {
      configurable: true,
      writable: true,
      value: 180,
    });
    table.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(proxyRef.value.scrollLeft).toBe(180);

    Object.defineProperty(table, "getBoundingClientRect", {
      configurable: true,
      value: () => rect(500),
    });
    window.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    expect(state!.visible.value).toBe(false);
    wrapper.unmount();
  });

  it("hides for a visible native bar, offscreen tables, and tables behind stuck chrome", () => {
    expect(
      shouldShowFloatingScrollbar({ top: 300, bottom: 900 }, 900, 80, true),
    ).toBe(false);
    expect(
      shouldShowFloatingScrollbar({ top: 900, bottom: 1200 }, 900, 80, true),
    ).toBe(false);
    expect(
      shouldShowFloatingScrollbar({ top: 0, bottom: 80 }, 900, 80, true),
    ).toBe(false);
    expect(
      shouldShowFloatingScrollbar({ top: 200, bottom: 900.2 }, 900, 80, true),
    ).toBe(false);
    expect(
      shouldShowFloatingScrollbar({ top: 200, bottom: 900.6 }, 900, 80, true),
    ).toBe(true);
    expect(
      shouldShowFloatingScrollbar({ top: 200, bottom: 950 }, 900, 80, false),
    ).toBe(false);
  });
});
