// @vitest-environment jsdom
import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import { RouterLinkStub } from "./support/RouterLinkStub";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { useResponsiveLayout } from "../src/composables/useResponsiveLayout";

const media = vi.hoisted(() => ({
  matches: false,
  listener: undefined as ((event: MediaQueryListEvent) => void) | undefined,
  removed: false,
  listeners: new Set<(event: MediaQueryListEvent) => void>(),
}));

beforeEach(() => {
  media.matches = false;
  media.listeners.clear();
  media.listener = (event) => {
    for (const callback of [...media.listeners]) callback(event);
  };
  media.removed = false;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (
        _name: string,
        callback: (event: MediaQueryListEvent) => void,
      ) => {
        media.listeners.add(callback);
      },
      removeEventListener: (
        _name: string,
        callback: (event: MediaQueryListEvent) => void,
      ) => {
        media.listeners.delete(callback);
        media.removed = true;
      },
    }),
  });
});

describe("responsive presentation contract", () => {
  it("starts mobile-first, switches at 1024px, and cleans up the listener", async () => {
    const Probe = defineComponent({
      setup() {
        return useResponsiveLayout();
      },
      template: "<output data-surface>{{ surface }}</output>",
    });
    const wrapper = mount(Probe);
    expect(wrapper.get("output").text()).toBe("mobile");
    media.matches = true;
    media.listener?.({ matches: true } as MediaQueryListEvent);
    await nextTick();
    expect(wrapper.get("output").text()).toBe("desktop");
    wrapper.unmount();
    expect(media.removed).toBe(true);
  });

  it("retains the native controller, rows, filter and selection through breakpoint changes", async () => {
    const call = vi.fn(async () => ({
      rows: [
        {
          code: "ITEM-1",
          name: "中文物品",
          category: "物资",
          uom: "Nos",
          available: 3,
          loaned: 0,
          damaged: 0,
          locations: [],
          tracksBatch: false,
          tracksExpiry: false,
        },
      ],
      matched_count: 1,
      next_start: null,
      summary: [],
      analysis: { category: [], location: [] },
    }));
    const wrapper = mount(
      defineComponent({
        setup() {
          const reference = createReferenceData();
          reference.user = "manager";
          reference.site = "test";
          provideInventoryServices(
            { call, report: vi.fn(), upload: vi.fn() },
            reference,
          );
          return () => h(StockBrowsePage);
        },
      }),
      { global: { stubs: { RouterLink: RouterLinkStub } } },
    );
    await flushPromises();
    const controller = wrapper.getComponent(StockBrowsePage).vm.controller;
    controller.selected.value = ["ITEM-1"];
    controller.view.value = "table";
    const rows = controller.data.rows;
    const requests = call.mock.calls.length;
    media.matches = true;
    media.listener?.({ matches: true } as MediaQueryListEvent);
    await nextTick();
    media.matches = false;
    media.listener?.({ matches: false } as MediaQueryListEvent);
    await nextTick();
    expect(wrapper.getComponent(StockBrowsePage).vm.controller).toBe(
      controller,
    );
    expect(controller.data.rows).toBe(rows);
    expect(controller.selected.value).toEqual(["ITEM-1"]);
    expect(controller.view.value).toBe("table");
    expect(call.mock.calls.length).toBe(requests);
    wrapper.unmount();
    expect(media.removed).toBe(true);
  });
});
