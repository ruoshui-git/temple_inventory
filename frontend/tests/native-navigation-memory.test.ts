// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import App from "../src/App.vue";
import Inventory from "../src/pages/Inventory.vue";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import type { InventoryServices } from "../src/services/contracts";
import { routeRecords } from "../src/lib/routeRegistry";

const mocked = vi.hoisted(() => ({
  call: vi.fn(),
  report: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("../src/services/frappeServices", () => ({ frappeServices: mocked }));
vi.mock("../src/features/application/useApplication", () => ({
  useApplication: (reference) => {
    Object.assign(reference, {
      user: "manager",
      site: "navigation-site",
      siteDate: "2026-10-16",
    });
    return {
      state: {
        gate: "ready",
        version: 1,
        error: "",
        status: undefined,
        accessBlocked: false,
      },
      resuming: ref(false),
      sessionExpired: ref(false),
      updateBlocked: ref(false),
    };
  },
}));

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  mocked.call.mockReset();
  mocked.call.mockImplementation(async (endpoint, args = {}) => {
    if (endpoint !== "browse.inventory_page") return [];
    const start = Number(args.start || 0),
      end = Math.min(start + 30, 65);
    return {
      rows: Array.from({ length: end - start }, (_, index) => ({
        code: `ITEM-${start + index}`,
        name: `物品${start + index}`,
        category: "用品",
        uom: "个",
        available: 7,
        loaned: 0,
        damaged: 0,
        tracksBatch: false,
        tracksExpiry: false,
        locations: [],
      })),
      matched_count: 65,
      next_start: end < 65 ? end : null,
      snapshot: "2026-10-16",
      summary: [],
      analysis: { category: [], location: [] },
      query: args.query,
    };
  });
});

describe("routed native browse restoration", () => {
  it("keeps the controller through query replacement, rereads Back/Forward depth and resets fresh primary navigation", async () => {
    const placeholder = defineComponent({
      setup: () => () => h("p", "原生详情"),
    });
    const routes = routeRecords.map((route) =>
      route.name === "stock"
        ? { ...route, component: Inventory }
        : route.name === "item-detail"
          ? { ...route, component: placeholder }
          : route,
    );
    const router = createRouter({
      history: createWebHistory("/memory-test"),
      routes,
    });
    await router.push("/stock");
    const wrapper = mount(App, {
      attachTo: document.body,
      global: { plugins: [router] },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const initial = wrapper.findComponent(StockBrowsePage).vm.controller;
    await wrapper.find('[aria-label="选择物品0"]').setValue(true);
    initial.view.value = "table";
    initial.search.value = "物品";
    await flushPromises();
    expect(router.currentRoute.value.query.query).toContain('"search":"物品"');
    expect(wrapper.findComponent(StockBrowsePage).vm.controller).toBe(initial);
    await initial.load(true);
    expect(initial.data.rows).toHaveLength(60);
    const stockPosition = window.history.state.position;
    await router.push("/stock/items/ITEM-42");
    expect(wrapper.text()).toContain("原生详情");
    router.back();
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/stock"),
    );
    await flushPromises();
    const returned = wrapper.findComponent(StockBrowsePage).vm.controller;
    expect(returned).not.toBe(initial);
    expect(returned.data.rows).toHaveLength(60);
    expect(returned.search.value).toBe("物品");
    expect(returned.view.value).toBe("table");
    expect(returned.selected.value).toEqual(["ITEM-0"]);
    expect(window.history.state.position).toBe(stockPosition);
    router.forward();
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/stock/items/ITEM-42"),
    );
    router.back();
    await vi.waitFor(() =>
      expect(router.currentRoute.value.path).toBe("/stock"),
    );
    await flushPromises();
    const primary = wrapper
      .findAll('nav[aria-label="应用主导航"] button')
      .find((button) => button.text() === "库存")!;
    await primary.trigger("click");
    await flushPromises();
    const fresh = wrapper.findComponent(StockBrowsePage).vm.controller;
    expect(fresh).not.toBe(returned);
    expect(fresh.search.value).toBe("");
    expect(fresh.selected.value).toEqual([]);
    expect(fresh.view.value).toBe("table");
    expect(fresh.data.rows).toHaveLength(30);
    const freshPosition = window.history.state.position;
    // Pressing the active primary again also creates a fresh, independent entry.
    fresh.selected.value = ["ITEM-1"];
    await primary.trigger("click");
    await flushPromises();
    expect(window.history.state.position).toBe(freshPosition + 1);
    expect(
      wrapper.findComponent(StockBrowsePage).vm.controller.selected.value,
    ).toEqual([]);
  });
});
