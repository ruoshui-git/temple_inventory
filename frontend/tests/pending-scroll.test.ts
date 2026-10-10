import { computed, defineComponent, nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import PendingView from "../src/features/pending/PendingView.vue";

const observerInstances: Array<{
  root: Element | null;
  callback: IntersectionObserverCallback;
  instance: TestIntersectionObserver;
}> = [];

class TestIntersectionObserver {
  root: Element | null;
  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = options?.root || null;
    observerInstances.push({ root: this.root, callback, instance: this });
  }
  observe = vi.fn();
  disconnect = vi.fn();
}

const RouterLink = defineComponent({
  props: ["to"],
  template: '<a :href="to"><slot /></a>',
});
const stub = defineComponent({ template: "<div><slot /></div>" });

function makeController() {
  const filters = ref({
    search: "",
    warehouses: [] as string[],
    item_groups: [] as string[],
  });
  return {
    scrollResetToken: ref(0),
    boot: ref({ item_groups: [] }),
    rows: ref([
      {
        item_code: "ITM-1",
        item_name: "物品",
        damaged_qty: 2,
        stock_uom: "个",
      },
    ]),
    total: ref(2),
    overall: ref(2),
    facets: ref({ warehouses: {}, item_groups: {} }),
    quantityTotals: ref({}),
    error: ref(""),
    loading: ref(false),
    loadingMore: ref(false),
    filterOpen: ref(false),
    desktopFilterOpen: ref(false),
    operationCaps: computed(() => ({ Repair: true, Disposal: true })),
    filters,
    warehouseRows: computed(() => []),
    summaryMetrics: computed(() => []),
    warehouseText: vi.fn(),
    chips: computed(() => []),
    load: vi.fn(),
    begin: vi.fn(),
    removeChip: vi.fn(),
    clearFilters: vi.fn(),
    openFilters: vi.fn(),
    close: vi.fn(),
  };
}

describe("Pending list scroll ownership", () => {
  afterEach(() => {
    observerInstances.length = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the desktop results scroller as its observer root and reconnects for mobile", async () => {
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    const controller = makeController();
    const wrapper = mount(PendingView, {
      props: { controller: controller as any, surface: "desktop" },
      global: {
        stubs: {
          RouterLink,
          ResponsiveFilterPanel: stub,
          WarehouseSelector: stub,
          CategorySelector: stub,
          CompactFilterSection: stub,
          LoadingIndicator: stub,
          QuantitySummary: stub,
          UiButton: stub,
          ActiveFilterChips: stub,
          ResultCountStrip: stub,
        },
      },
    });
    await nextTick();
    await nextTick();
    const results = wrapper.find(".results-scroll").element;
    expect(wrapper.find(".viewport-list-root").exists()).toBe(true);
    expect(results.classList.contains("results-scroll")).toBe(true);
    expect(observerInstances.at(-1)?.root).toBe(results);
    expect(wrapper.text()).toContain("物品");
    const resultColumn = wrapper.find(".pending-results");
    expect(resultColumn.find(".results-chrome").exists()).toBe(true);
    expect(resultColumn.find(".browse-result-meta").element.parentElement).toBe(
      resultColumn.element,
    );
    expect(resultColumn.find(".results-scroll").element.parentElement).toBe(
      resultColumn.element,
    );
    const scrollTo = vi.fn();
    Object.defineProperty(results, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    controller.scrollResetToken.value += 1;
    await nextTick();
    await nextTick();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });

    observerInstances
      .at(-1)
      ?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    expect(controller.load).toHaveBeenCalledWith(true);

    controller.loading.value = true;
    observerInstances
      .at(-1)
      ?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    expect(controller.load).toHaveBeenCalledTimes(1);
    controller.loading.value = false;
    controller.rows.value = [
      ...controller.rows.value,
      {
        item_code: "ITM-2",
        item_name: "物品二",
        damaged_qty: 1,
        stock_uom: "个",
      },
    ];
    observerInstances
      .at(-1)
      ?.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    expect(controller.load).toHaveBeenCalledTimes(1);
    controller.rows.value = controller.rows.value.slice(0, 1);

    await wrapper.setProps({ surface: "mobile" });
    await nextTick();
    await nextTick();
    expect(observerInstances[0].instance.disconnect).toHaveBeenCalled();
    expect(observerInstances.at(-1)?.root).toBeNull();
    expect(controller.rows.value[0].item_code).toBe("ITM-1");
    const mobileScrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    controller.scrollResetToken.value += 1;
    await nextTick();
    await nextTick();
    expect(mobileScrollTo).toHaveBeenCalledWith({ top: 0 });
    wrapper.unmount();
  });
});
