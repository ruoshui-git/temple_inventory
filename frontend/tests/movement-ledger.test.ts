import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Movements from "../src/pages/Movements.vue";

const state = vi.hoisted(() => ({
  route: { path: "/movements/items", query: {} as Record<string, unknown> },
  replace: vi.fn(async () => undefined),
  push: vi.fn(),
  api: vi.fn(),
  workspaceApi: vi.fn(),
}));
const route = reactive(state.route);
const media = vi.hoisted(() => ({
  matches: true,
  listener: undefined as ((event: MediaQueryListEvent) => void) | undefined,
}));
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}));
vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<any>("../src/lib/api");
  return { ...actual, api: state.api, workspaceApi: state.workspaceApi };
});
const globals = {
  stubs: {
    RouterLink: defineComponent({ template: "<a><slot /></a>" }),
    Combobox: defineComponent({
      inheritAttrs: false,
      props: ["modelValue", "options", "query"],
      emits: ["update:modelValue", "update:query"],
      template: `<div><input v-bind="$attrs" :value="query" @input="$emit('update:query', $event.target.value)" /><button v-for="option in options" :key="option.value" type="button" @click="$emit('update:modelValue', option.value)">{{ option.label }}</button></div>`,
    }),
  },
};
function page(kind: "items" | "records" = "items") {
  state.workspaceApi.mockImplementation(async (method: string) =>
    method === "movement_filter_options"
      ? {
          items: [{ name: "ITM-1", item_name: "物品一" }],
          activities: [{ name: "ACT-1", title: "法会" }],
        }
      : {
          resolved_period: { date_from: "2026-09-01", date_to: "2026-09-30" },
          results:
            kind === "items"
              ? [
                  {
                    id: "L1",
                    movement_kind: "Loan",
                    item_name: "相机",
                    item_code: "ITM-1",
                    stock_qty: 1,
                    stock_uom: "Nos",
                    source_warehouse: "A04",
                    destination_warehouse: "Leased",
                  },
                ]
              : [
                  {
                    record_name: "REC-1",
                    movement_kind: "Return",
                    docstatus: 0,
                    line_count: 2,
                    quantities: [{ uom: "Nos", qty: 2 }],
                    source_warehouses: ["Leased"],
                    destination_warehouses: ["A04"],
                  },
                ],
          total: 1,
          all_total: 1,
          facets: { movement_kind: { Loan: 1, Return: 1 } },
        },
  );
}
describe("movement ledger", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    route.path = "/movements/items";
    route.query = {};
    state.replace.mockClear();
    state.push.mockClear();
    state.api.mockResolvedValue({
      item_groups: [],
      physical_tree: [],
      can_reconcile_stock: true,
      stock_operation_capabilities: { Receive: true },
    });
    state.workspaceApi.mockReset();
    media.matches = true;
    media.listener = undefined;
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
          media.listener = callback;
        },
        removeEventListener: () => undefined,
      }),
    });
  });
  it("loads line rows and restores item filters and legacy kinds", async () => {
    route.query = {
      period: "last_90_days",
      item_code: "ITM-1",
      kind: ["Loan", "Return"],
    };
    page();
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_items",
      expect.objectContaining({
        filters: expect.objectContaining({
          item_code: "ITM-1",
          movement_kinds: ["Loan", "Return"],
          period_key: "last_90_days",
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("相机");
    expect(wrapper.text()).toContain("借出");
  });
  it("counts records and exposes status-aware creation", async () => {
    route.path = "/movements/records";
    page("records");
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_records",
      expect.objectContaining({ docstatuses: [0, 1] }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("草稿");
    expect(wrapper.text()).toContain("归还");
  });

  it("searches remote item options and commits a result beyond the initial page", async () => {
    state.workspaceApi.mockImplementation(async (method: string, args: any) => {
      if (method === "movement_filter_options") {
        return args.search
          ? {
              items: [{ name: "ITM-999", item_name: "远端物品" }],
              activities: [],
            }
          : { items: [{ name: "ITM-1", item_name: "物品一" }], activities: [] };
      }
      return {
        resolved_period: {},
        results: [],
        total: 0,
        all_total: 0,
        facets: {},
      };
    });
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    await wrapper.find('input[aria-label="物品"]').setValue("远端");
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_filter_options",
      expect.objectContaining({ search: "远端", page_length: 100 }),
      expect.any(AbortSignal),
    );
    const remoteOption = wrapper
      .findAll("button")
      .find((button) => button.text() === "远端物品 · ITM-999");
    expect(remoteOption).toBeDefined();
    await remoteOption!.trigger("click");
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_items",
      expect.objectContaining({
        filters: expect.objectContaining({ item_code: "ITM-999" }),
      }),
      expect.any(AbortSignal),
    );
    await wrapper.find('input[aria-label="活动"]').setValue("大型法会");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_filter_options",
      expect.objectContaining({ search: "大型法会" }),
      expect.any(AbortSignal),
    );
  });

  it("rehydrates filters when the canonical route query changes after mount", async () => {
    page();
    mount(Movements, { global: globals });
    await flushPromises();
    route.query = {
      period: "last_90_days",
      item_code: "ITM-999",
      kind: ["Loan", "Return"],
    };
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_items",
      expect.objectContaining({
        filters: expect.objectContaining({
          period_key: "last_90_days",
          item_code: "ITM-999",
          movement_kinds: ["Loan", "Return"],
        }),
      }),
      expect.any(AbortSignal),
    );
  });
  it("renders all chips, desktop collapse/mobile drawer, compact chrome, and item columns", async () => {
    page();
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    expect(
      wrapper.find(".movement-item-cell .image-placeholder").exists(),
    ).toBe(true);
    expect(
      wrapper.find(".movement-item-cell .image-thumb-button").exists(),
    ).toBe(false);
    expect(wrapper.findAll(".movement-kind-chip")).toHaveLength(11);
    expect(wrapper.text()).toContain("关联记录");
    expect(wrapper.text()).toContain("从");
    expect(wrapper.text()).toContain("到");
    const originalMatchMedia = window.matchMedia;
    try {
      await wrapper.find(".movement-filter-button").trigger("click");
      expect(wrapper.find(".desktop-list-layout").classes()).toContain(
        "filters-open",
      );
      await wrapper.find(".movement-filter-button").trigger("click");
      expect(wrapper.find(".desktop-list-layout").classes()).not.toContain(
        "filters-open",
      );
      media.matches = false;
      media.listener?.({ matches: false } as MediaQueryListEvent);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.find(".movement-filter-button").trigger("click");
      await flushPromises();
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
    }
    expect(wrapper.find(".movement-heading").exists()).toBe(true);
    expect(wrapper.find(".compact-heading").exists()).toBe(true);
    expect(
      wrapper.find(".movement-ledger-actions .column-summary-trigger").exists(),
    ).toBe(true);
    expect(wrapper.find(".sortable-data-table-toolbar").exists()).toBe(false);
    const resultScroll = wrapper.find(".results-scroll");
    Object.defineProperty(resultScroll.element, "scrollTop", {
      value: 81,
      configurable: true,
    });
    await resultScroll.trigger("scroll");
    expect(wrapper.find(".results-column").classes()).toContain("compact");
  });
  it("uses linked record and line-count cells with draft/cancelled status", async () => {
    route.path = "/movements/records";
    page("records");
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("记录编号");
    expect(wrapper.text()).toContain("物品行数");
    expect(
      wrapper.findAll("a").some((link) => link.text().includes("2 项")),
    ).toBe(true);
    expect(
      wrapper.findAll(".status-badge").some((badge) => badge.text() === "草稿"),
    ).toBe(true);
  });
  it("sends multi-select movement kinds and All clear to the API", async () => {
    page();
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    const chips = wrapper.findAll(".movement-kind-chip");
    await chips.find((chip) => chip.text().includes("借出"))!.trigger("click");
    await chips.find((chip) => chip.text().includes("归还"))!.trigger("click");
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_items",
      expect.objectContaining({
        filters: expect.objectContaining({
          movement_kinds: ["Loan", "Return"],
        }),
      }),
      expect.any(AbortSignal),
    );
    await wrapper.find(".movement-kind-chips > button").trigger("click");
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenLastCalledWith(
      "movement_items",
      expect.objectContaining({
        filters: expect.objectContaining({ movement_kinds: undefined }),
      }),
      expect.any(AbortSignal),
    );
  });

  it("collapses unselected zero kinds, keeps selected zero kinds, and preserves period chrome", async () => {
    page();
    route.query = { kind: "Reconcile" };
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    expect(wrapper.findAll(".clear-all-filters")).toHaveLength(1);
    expect(
      wrapper
        .findAll("button")
        .filter((button) => button.text().trim() === "清除全部"),
    ).toHaveLength(0);
    expect(wrapper.findAll(".movement-kind-chip-zero").length).toBeGreaterThan(
      0,
    );
    const hiddenZero = wrapper.find(".movement-kind-chip-zero");
    expect(hiddenZero.attributes("style")).toContain("display: none");
    expect(hiddenZero.attributes("disabled")).toBeDefined();
    const reconcile = wrapper
      .findAll(".movement-kind-chip")
      .find((chip) => chip.text().includes("库存调整"));
    expect(reconcile!.attributes("aria-pressed")).toBe("true");
    expect(reconcile!.isVisible()).toBe(true);
    const scroll = wrapper.find(".results-scroll");
    Object.defineProperty(scroll.element, "scrollTop", {
      value: 81,
      configurable: true,
    });
    await scroll.trigger("scroll");
    expect(wrapper.find(".movement-heading").exists()).toBe(true);
    expect(wrapper.find(".period-compact-resolved").exists()).toBe(true);
    expect(wrapper.find(".movement-title").exists()).toBe(false);
    expect(wrapper.find(".compact-heading").isVisible()).toBe(true);
    expect(
      wrapper
        .find(".movement-ledger-actions .column-summary-trigger")
        .isVisible(),
    ).toBe(true);
    const zeroToggle = wrapper.find(".movement-zero-kinds-toggle");
    await zeroToggle.trigger("click");
    expect(hiddenZero.attributes("style")).not.toContain("display: none");
    expect(hiddenZero.attributes("disabled")).toBeUndefined();
    expect(zeroToggle.text()).toContain("收起无记录");
    await zeroToggle.trigger("click");
    expect(hiddenZero.attributes("style")).toContain("display: none");
  });
  it("aborts replaced initial requests", async () => {
    const requests: Array<{
      args: any;
      signal: AbortSignal;
      resolve: (value: any) => void;
    }> = [];
    state.workspaceApi.mockImplementation(
      (method: string, args: any, signal: AbortSignal) => {
        if (method === "movement_filter_options")
          return Promise.resolve({ items: [], activities: [] });
        return new Promise((resolve) =>
          requests.push({ args, signal, resolve }),
        );
      },
    );
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    const initialRequest = requests.at(-1)!;
    route.query = { search: "替换" };
    await flushPromises();
    expect(initialRequest.signal.aborted).toBe(true);
    const replacement = requests
      .filter((request) => !request.signal.aborted)
      .at(-1)!;
    replacement.resolve({
      resolved_period: {},
      results: [{ id: "L1", item_name: "新结果", item_code: "ITM-2" }],
      total: 2,
      all_total: 2,
      facets: {},
    });
    await flushPromises();
    await flushPromises();
    expect(wrapper.text()).toContain("新结果");
  });
  it("requests one observer page with its own abort signal", async () => {
    let observerCallback:
      ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
    class FakeObserver {
      constructor(callback: typeof observerCallback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    state.workspaceApi.mockImplementation(async (method: string, args: any) => {
      if (method === "movement_filter_options")
        return { items: [], activities: [] };
      return args.start
        ? {
            resolved_period: {},
            results: [{ id: "L2", item_name: "追加结果", item_code: "ITM-3" }],
            total: 2,
            all_total: 2,
            facets: {},
          }
        : {
            resolved_period: {},
            results: [{ id: "L1", item_name: "新结果", item_code: "ITM-2" }],
            total: 2,
            all_total: 2,
            facets: {},
          };
    });
    const wrapper = mount(Movements, { global: globals });
    await flushPromises();
    observerCallback?.([{ isIntersecting: true }]);
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_items",
      expect.objectContaining({ start: 1, page_length: 30 }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("追加结果");
  });
});
