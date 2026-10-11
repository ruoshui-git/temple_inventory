import { computed, defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DashboardView from "../src/features/dashboard/DashboardView.vue";
import DashboardSectionLayout from "../src/features/dashboard/DashboardSectionLayout.vue";

const RouterLink = defineComponent({
  props: ["to"],
  template:
    "<a :data-path=\"typeof to === 'string' ? to : to.path\" :data-query=\"typeof to === 'string' ? '' : JSON.stringify(to.query)\"><slot /></a>",
});

function controller(surface: "desktop" | "mobile" = "desktop") {
  const filters = ref({ warehouses: ["A02"], item_groups: ["食品"] });
  const data = ref({
    warehouses: [{ name: "A02", local_label: "A02" }],
    item_groups: [{ name: "食品", item_group_name: "食品" }],
    inventory: {
      totals: {
        available_stock: {
          unitless_total: 12,
          by_uom: [{ uom: "Nos", qty: 12 }],
        },
        total_stock: { unitless_total: 15, by_uom: [{ uom: "Nos", qty: 15 }] },
        on_loan_qty: { unitless_total: 2, by_uom: [{ uom: "Nos", qty: 2 }] },
        damaged_qty: { unitless_total: 1, by_uom: [{ uom: "Nos", qty: 1 }] },
      },
    },
    expiry: {
      buckets: Object.fromEntries(
        [
          ["expired_1_30", "已过期 1–30 天"],
          ["expired_31_90", "已过期 31–90 天"],
          ["expired_over_90", "已过期 >90 天"],
          ["upcoming_0_30", "0–30 天内到期"],
          ["upcoming_31_90", "31–90 天内到期"],
          ["upcoming_over_90", ">90 天后到期"],
        ].map(([key, label]) => [key, { key, label, count: 1 }]),
      ),
      preview: [],
    },
    movement: {
      summaries: [
        {
          kind: "Receive",
          label: "入库",
          record_count: 1,
          quantity: { unitless_total: 5, by_uom: [{ uom: "Nos", qty: 5 }] },
        },
      ],
      recent: [],
    },
    loans: {
      record_count: 1,
      quantity: { unitless_total: 2, by_uom: [{ uom: "Nos", qty: 2 }] },
      rows: [
        {
          name: "TI-LOAN-1",
          borrower: "义工组",
          purpose: "法会布置",
          loan_date: "2026-10-01",
          status: "部分归还",
          outstanding_lines: 1,
          outstanding_qty: [{ uom: "Nos", qty: 2 }],
          items: [
            {
              item_name: "投影仪",
              outstanding: 2,
              original_warehouse: "A02",
            },
          ],
        },
      ],
    },
    reminders: [],
    distribution: {
      distinct_items: 2,
      mode: "warehouse",
      bars: [{ key: "A02", label: "A02", distinct_items: 3 }],
    },
  });
  const statuses = ref(
    Object.fromEntries(
      [
        "inventory",
        "expiry",
        "movement",
        "loans",
        "reminders",
        "distribution",
      ].map((section) => [
        section,
        { loading: false, error: "", stale: false },
      ]),
    ) as Record<string, { loading: boolean; error: string; stale: boolean }>,
  );
  return {
    surface: ref(surface),
    route: { query: {} },
    filters,
    data,
    boot: computed(() => data.value),
    loading: ref(false),
    refreshing: ref(false),
    globalLoading: ref(false),
    error: ref(""),
    hasSuccessfulData: ref(true),
    sectionBusy: (section: string) => statuses.value[section].loading,
    sectionStale: (section: string) =>
      statuses.value[section].stale || Boolean(statuses.value[section].error),
    sectionError: (section: string) => statuses.value[section].error,
    sectionState: statuses,
    retrySection: vi.fn(),
    filterOpen: ref(false),
    desktopFilterOpen: ref(false),
    movementPeriod: ref("this_month"),
    expiryPreview: ref("expired"),
    distributionMode: ref("warehouse"),
    warehouseRows: computed(() => data.value.warehouses),
    categoryRows: computed(() => data.value.item_groups),
    activeFilterCount: computed(() => 2),
    activeScopeLabel: computed(() => "A02 · 食品"),
    movementSummaries: computed(() => data.value.movement.summaries),
    expiryBuckets: computed(() => Object.values(data.value.expiry.buckets)),
    updateFilters: vi.fn(),
    clearFilters: vi.fn(),
    refresh: vi.fn(),
  };
}

const globals = {
  stubs: {
    RouterLink,
    ResponsiveFilterPanel: { template: "<aside><slot /></aside>" },
    WarehouseSelector: true,
    CategorySelector: true,
    UiButton: { template: "<button><slot /></button>" },
  },
};

describe("dashboard", () => {
  it("renders the approved sections and only authoritative loan information", () => {
    const wrapper = mount(DashboardView, {
      props: { controller: controller() as any },
      global: globals,
    });

    for (const heading of [
      "库存概览",
      "效期概览",
      "货物流动概览",
      "最近记录",
      "借出中",
      "提醒事项",
      "库存分布",
    ])
      expect(wrapper.text()).toContain(heading);
    expect(wrapper.findAll(".dashboard-section")).toHaveLength(6);
    expect(
      wrapper.find(".dashboard-sections").element.children[0].textContent,
    ).toContain("库存概览");
    expect(
      wrapper.find(".dashboard-sections").element.children[1].textContent,
    ).toContain("库存分布");
    expect(
      wrapper.find(".dashboard-sections").element.children[2].textContent,
    ).toContain("效期概览");
    expect(wrapper.find(".distribution-total").text()).toBe("物品种数 · 2 种");
    expect(wrapper.text()).toContain(
      "按物品编码去重统计有库存的物品种数，不是库存数量之和。",
    );
    expect(wrapper.text()).toContain(
      "同一种物品可出现在多个仓库中，因此各仓库种数相加可能大于总种数。",
    );
    const movementSection = wrapper.find(".movement-section");
    expect(
      movementSection
        .find(".movement-grid")
        .element.compareDocumentPosition(
          movementSection.find(".recent-panel").element,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(wrapper.findAll(".expiry-card")).toHaveLength(6);
    expect(wrapper.text()).toContain("义工组 · 部分归还");
    expect(wrapper.text()).toContain("法会布置");
    expect(wrapper.text()).toContain("2026-10-01");
    expect(wrapper.text()).toContain("A02");
    expect(wrapper.text()).not.toContain("逾期借用");
    expect(wrapper.text()).not.toContain("应归还日期");
    expect(wrapper.find('[data-path="/stock"]').exists()).toBe(true);
    expect(wrapper.find('[data-path="/stock"]').attributes("inert")).toBe(
      undefined,
    );
    expect(wrapper.find('[data-path="/loans/TI-LOAN-1"]').exists()).toBe(true);
  });

  it("opens the in-layout filter rail on desktop", async () => {
    const state = controller();
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    expect(wrapper.find(".dashboard-desktop-filter").exists()).toBe(false);
    const content = wrapper.find(".dashboard-content").element as HTMLElement;
    content.scrollTop = 240;
    await wrapper
      .find(".dashboard-header .dashboard-filter-trigger")
      .trigger("click");
    expect(state.desktopFilterOpen.value).toBe(true);
    expect(wrapper.find(".dashboard-desktop-filter").exists()).toBe(true);
    expect(wrapper.find(".filter-drawer-backdrop").exists()).toBe(false);
    expect(wrapper.find(".dashboard-content").element).toBe(content);
    expect(content.scrollTop).toBe(240);
    await wrapper
      .find(".dashboard-header .dashboard-filter-trigger")
      .trigger("click");
    expect(wrapper.find(".dashboard-content").element).toBe(content);
    expect(content.scrollTop).toBe(240);
  });

  it("renders canonical active filter chips in the routed dashboard consumer", async () => {
    const state = controller();
    state.filters.value = {
      warehouses: ["site", "room"],
      item_groups: ["food", "rice"],
    };
    state.data.value.warehouses = [
      { name: "site", local_label: "寺院", is_group: 1 },
      {
        name: "room",
        local_label: "A 室",
        parent_warehouse: "site",
        is_group: 1,
      },
      {
        name: "shelf",
        local_label: "A-01",
        parent_warehouse: "room",
        is_group: 0,
      },
    ];
    state.data.value.item_groups = [
      { name: "food", item_group_name: "食品", is_group: 1 },
      {
        name: "rice",
        item_group_name: "米",
        parent_item_group: "food",
        is_group: 0,
      },
    ];
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    const chips = wrapper.findAll(".dashboard-active-filters button");
    expect(chips).toHaveLength(3);
    expect(chips[0].text()).toContain("寺院");
    expect(chips[0].text()).not.toContain("A 室");
    expect(chips[1].text()).toContain("食品");
    expect(chips[1].text()).not.toContain("米");
    await chips[0].trigger("click");
    expect(state.updateFilters).toHaveBeenCalledWith({
      warehouses: [],
      item_groups: ["food"],
    });
  });

  it("preserves loading, error retry, and empty section states", async () => {
    const state = controller();
    state.loading.value = true;
    state.hasSuccessfulData.value = false;
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    expect(wrapper.find(".dashboard-loading").exists()).toBe(true);
    expect(wrapper.findAll(".dashboard-section")).toHaveLength(0);

    state.loading.value = false;
    state.error.value = "读取失败";
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="alert"]').text()).toContain("读取失败");
    await wrapper.find('[role="alert"] button').trigger("click");
    expect(state.refresh).toHaveBeenCalledTimes(1);

    state.error.value = "";
    state.hasSuccessfulData.value = true;
    state.data.value.expiry.preview = [];
    state.data.value.movement.recent = [];
    state.data.value.loans.rows = [];
    state.data.value.reminders = [];
    state.data.value.distribution.bars = [];
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("当前范围没有需要关注的批次");
    expect(wrapper.text()).toContain("当前没有未归还借用");
    expect(wrapper.text()).toContain("暂无需要处理的提醒");
    expect(wrapper.text()).toContain("当前范围没有可展示的分布数据");
  });

  it("keeps section layout steady and local controls reachable while disabling stale links", async () => {
    const state = controller();
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    state.sectionState.value.movement = {
      loading: true,
      error: "",
      stale: true,
    };
    await wrapper.vm.$nextTick();
    const section = wrapper.find(".movement-section");
    expect(section.attributes("aria-busy")).toBe("true");
    expect(document.body.textContent).toContain("正在更新");
    expect(section.findAll('a[aria-disabled="true"]').length).toBeGreaterThan(
      0,
    );
    expect(
      section.find(".movement-heading-actions .segmented button").exists(),
    ).toBe(true);

    state.sectionState.value.movement = {
      loading: false,
      error: "读取失败",
      stale: true,
    };
    await wrapper.vm.$nextTick();
    expect(section.find(".section-update").text()).toContain("更新失败");
    await section.find(".section-update button").trigger("click");
    expect(state.retrySection).toHaveBeenCalledWith("movement");
  });

  it("uses one global refresh indicator while dashboard controls stay live", async () => {
    const state = controller();
    state.globalLoading.value = true;
    state.error.value = "";
    for (const section of Object.keys(state.sectionState.value)) {
      state.sectionState.value[section] = {
        loading: true,
        error: "",
        stale: true,
      };
    }
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    await wrapper.vm.$nextTick();
    expect(
      document.body.querySelectorAll(".ui-loading-boundary__indicator"),
    ).toHaveLength(1);
    expect(wrapper.find(".ui-loading-boundary").attributes("aria-busy")).toBe(
      "true",
    );
    expect(
      wrapper.findAll(".dashboard-section .ui-loading-boundary__indicator"),
    ).toHaveLength(0);
    expect(wrapper.text()).toContain("最近记录");
    const localControl = wrapper.find(
      ".movement-heading-actions .segmented button",
    );
    expect(localControl.exists()).toBe(true);
    expect(localControl.element.closest("[inert]")).toBeNull();
    expect(
      wrapper.findAll('.dashboard-content a[aria-disabled="true"]').length,
    ).toBeGreaterThan(0);
    await wrapper.find(".dashboard-filter-trigger").trigger("click");
    expect(state.desktopFilterOpen.value).toBe(true);
    await wrapper.find(".dashboard-header-actions button").trigger("click");
    expect(state.refresh).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("groups desktop columns and restores the original stacked order", () => {
    const slots = {
      inventory: () => "inventory",
      expiry: () => "expiry",
      movement: () => "movement",
      loans: () => "loans",
      reminders: () => "reminders",
      distribution: () => "distribution",
    };
    const desktop = mount(DashboardSectionLayout, {
      props: { grouped: true },
      slots,
    });
    const columns = desktop.findAll(".dashboard-column");
    expect(columns).toHaveLength(2);
    expect(columns[0].text()).toBe("inventorydistributionexpiry");
    expect(columns[1].text()).toBe("movementloansreminders");

    const stacked = mount(DashboardSectionLayout, {
      props: { grouped: false },
      slots,
    });
    expect(stacked.find(".dashboard-sections").text()).toBe(
      "inventorydistributionexpirymovementloansreminders",
    );
  });

  it("renders exact zero counts with zero-width bars and an integer zero tick", () => {
    const state = controller();
    state.data.value.distribution.distinct_items = 0;
    state.data.value.distribution.bars = [
      { key: "A02", label: "A02", distinct_items: 0 },
    ];
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    expect(wrapper.find(".distribution-axis").text()).toBe("0");
    expect(wrapper.find(".distribution-row i").attributes("style")).toContain(
      "width: 0%",
    );
    expect(wrapper.find(".distribution-total").text()).toBe("物品种数 · 0 种");
    expect(wrapper.find(".distribution-row strong").text()).toBe("0");
  });

  it("omits the cross-warehouse overlap note while using category distribution", () => {
    const state = controller();
    state.data.value.distribution.mode = "category";
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    expect(wrapper.text()).toContain(
      "按物品编码去重统计有库存的物品种数，不是库存数量之和。",
    );
    expect(wrapper.text()).not.toContain(
      "同一种物品可出现在多个仓库中，因此各仓库种数相加可能大于总种数。",
    );
  });

  it("keeps dashboard drill-through destinations scoped to the active filters", () => {
    const state = controller();
    state.data.value.expiry.preview = [
      { batch_no: "BATCH-1", item_code: "ITEM-1", expiry_date: "2026-10-11" },
    ];
    state.data.value.movement.recent = [
      {
        record_name: "ENTRY-1",
        detail_route: "/movements/records?kind=Receive",
        movement_kind: "Repair",
        posting_date: "2026-10-10",
        item_code: "ITEM-1",
        stock_qty: 1,
        stock_uom: "Nos",
      },
    ];
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    expect(wrapper.find(".recent-panel .dashboard-list-row b").text()).toBe(
      "修复",
    );
    const scoped = (path: string) =>
      wrapper
        .findAll(`a[data-path="${path}"]`)
        .map((link) => JSON.parse(link.attributes("data-query") || "{}"));

    expect(scoped("/stock")).toContainEqual({
      warehouses: ["A02"],
      item_groups: ["食品"],
    });
    expect(scoped("/expiry")).toContainEqual({
      warehouses: ["A02"],
      item_groups: ["食品"],
    });
    expect(scoped("/expiry")).toContainEqual(
      expect.objectContaining({ warehouses: ["A02"], item_groups: ["食品"] }),
    );
    expect(scoped("/movements/records")).toContainEqual(
      expect.objectContaining({
        warehouses: ["A02"],
        item_groups: ["食品"],
        period: "this_month",
      }),
    );
    expect(scoped("/loans/records")).toContainEqual(
      expect.objectContaining({
        status: "outstanding",
        warehouses: ["A02"],
        item_groups: ["食品"],
      }),
    );
    wrapper.unmount();
  });

  it("changes between measured desktop columns and the approved stacked order without replacing the scroll root", async () => {
    let resize!: ResizeObserverCallback;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {
          resize(
            [{ contentRect: { width: 820 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
        }
        disconnect() {}
      },
    );
    const state = controller("desktop");
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    const content = wrapper.find(".dashboard-content").element as HTMLElement;
    content.scrollTop = 260;
    await wrapper.vm.$nextTick();
    const columns = wrapper.findAll(".dashboard-column");
    expect(columns[0].text()).toContain("库存分布");
    expect(columns[1].text()).toContain("货物流动概览");

    state.surface.value = "mobile";
    resize(
      [{ contentRect: { width: 600 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    );
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".dashboard-column")).toHaveLength(0);
    expect(
      wrapper
        .findAll(".dashboard-section")
        .map((section) => section.find("h2").text()),
    ).toEqual([
      "库存概览",
      "库存分布",
      "效期概览",
      "货物流动概览",
      "借出中",
      "提醒事项",
    ]);
    expect(wrapper.find(".dashboard-content").element).toBe(content);
    expect(content.scrollTop).toBe(260);
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  it("places unequal integer ticks at proportional positions", () => {
    const state = controller();
    state.data.value.distribution.bars = [
      { key: "a", label: "A", distinct_items: 1 },
      { key: "b", label: "B", distinct_items: 5 },
    ];
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    const ticks = wrapper.findAll(".distribution-axis span");
    expect(ticks.map((tick) => tick.text())).toEqual(["0", "2", "4", "5"]);
    expect(ticks[2].attributes("style")).toContain("left: 80%");
    expect(ticks[3].attributes("style")).toContain("left: 100%");
  });
});
