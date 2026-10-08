import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import MovementPeriodSelector from "../src/components/MovementPeriodSelector.vue";
import MovementOverview from "../src/pages/MovementOverview.vue";

const state = vi.hoisted(() => ({
  route: { path: "/movements", query: {} as Record<string, unknown> },
  replace: vi.fn(),
  push: vi.fn(),
  api: vi.fn(),
  workspaceApi: vi.fn(),
}));
const route = reactive(state.route);
let mediaMatches = false;
let mediaListener: ((event: MediaQueryListEvent) => void) | undefined;
let observerCallback:
  ((entries: IntersectionObserverEntry[]) => void) | undefined;

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}));
vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<any>("../src/lib/api");
  return { ...actual, api: state.api, workspaceApi: state.workspaceApi };
});

const RouterLink = defineComponent({
  props: ["to"],
  template: "<a :href=\"typeof to === 'string' ? to : to.path\"><slot /></a>",
});
const globals = { stubs: { RouterLink } };

describe("movement overview", () => {
  beforeEach(() => {
    route.query = {};
    state.replace.mockReset();
    state.push.mockReset();
    state.api
      .mockReset()
      .mockResolvedValue({ item_groups: [], physical_tree: [] });
    state.workspaceApi.mockReset().mockResolvedValue({
      resolved_period: {
        key: "last_30_days",
        date_from: "2026-08-30",
        date_to: "2026-09-28",
      },
      action_summaries: [
        {
          movement_kind: "Receive",
          quantities: [
            { uom: "Nos", qty: 12 },
            { uom: "kg", qty: 3 },
          ],
          item_count: 2,
          record_count: 1,
        },
      ],
      results: [
        {
          item_code: "A001",
          item_name: "物品",
          item_group: "类别",
          stock_uom: "Nos",
          movement_totals: { Receive: 12 },
          record_count: 1,
          last_posting_date: "2026-09-28",
        },
      ],
      total: 2,
      facets: { movement_kinds: {}, item_groups: {}, warehouses: {} },
    });
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: class {
        constructor(callback: (entries: IntersectionObserverEntry[]) => void) {
          observerCallback = callback;
        }
        observe() {}
        disconnect() {}
      },
    });
    mediaMatches = false;
    mediaListener = undefined;
    observerCallback = undefined;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        get matches() {
          return mediaMatches;
        },
        addEventListener: (
          _name: string,
          callback: (event: MediaQueryListEvent) => void,
        ) => {
          mediaListener = callback;
        },
        removeEventListener() {},
      }),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("switches period modes and emits custom dates", async () => {
    const wrapper = mount(MovementPeriodSelector, {
      props: {
        periodKey: "last_30_days",
        resolvedFrom: "2026-08-30",
        resolvedTo: "2026-09-28",
      },
    });
    expect(wrapper.text()).toContain("2026-08-30 至 2026-09-28");
    await wrapper.findAll(".period-mode button")[2].trigger("click");
    expect(wrapper.emitted("update:periodKey")?.at(-1)).toEqual(["custom"]);
  });

  it("renders independent multi-UOM summaries and item actions", async () => {
    const wrapper = mount(MovementOverview, { global: globals });
    await flushPromises();
    expect(state.workspaceApi).toHaveBeenCalledWith(
      "movement_overview",
      expect.objectContaining({
        filters: expect.objectContaining({ period_key: "last_30_days" }),
      }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("12 Nos");
    expect(wrapper.text()).toContain("3 kg");
    expect(wrapper.text()).toContain("2 种物品");
    expect(wrapper.find(".sortable-data-table-mobile").exists()).toBe(true);
    mediaMatches = true;
    mediaListener?.({ matches: true } as MediaQueryListEvent);
    await flushPromises();
    expect(wrapper.find(".sortable-data-table-desktop").exists()).toBe(true);
    expect(wrapper.find(".sortable-data-table-mobile").exists()).toBe(false);
    state.workspaceApi.mockResolvedValueOnce({
      resolved_period: {
        key: "last_30_days",
        date_from: "2026-08-30",
        date_to: "2026-09-28",
      },
      results: [
        {
          item_code: "A002",
          item_name: "追加物品",
          item_group: "类别",
          stock_uom: "Nos",
          movement_totals: { Receive: 2 },
          record_count: 1,
          last_posting_date: "2026-09-27",
        },
      ],
      total: 2,
      facets: { movement_kinds: {}, item_groups: {}, warehouses: {} },
    });
    observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry]);
    await flushPromises();
    expect(state.workspaceApi.mock.calls.at(-1)?.[1]).toMatchObject({
      start: 1,
    });
    expect(wrapper.text()).toContain("追加物品");
    const receive = wrapper.findAll(".movement-summary-card")[0];
    await receive.trigger("click");
    await flushPromises();
    expect(receive.attributes("aria-pressed")).toBe("true");
    expect(
      state.workspaceApi.mock.calls.at(-1)?.[1].filters.movement_kinds,
    ).toEqual(["Receive"]);
    wrapper.unmount();
  });
});
