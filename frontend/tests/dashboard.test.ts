import { computed, defineComponent, ref } from "vue";
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import DashboardView from "../src/features/dashboard/DashboardView.vue";

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
    distribution: { bars: [{ key: "A02", label: "A02", distinct_items: 3 }] },
  });
  return {
    surface: ref(surface),
    route: { query: {} },
    filters,
    data,
    boot: computed(() => data.value),
    loading: ref(false),
    refreshing: ref(false),
    error: ref(""),
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
    expect(wrapper.findAll(".expiry-card")).toHaveLength(6);
    expect(wrapper.text()).toContain("义工组 · 部分归还");
    expect(wrapper.text()).toContain("法会布置");
    expect(wrapper.text()).toContain("2026-10-01");
    expect(wrapper.text()).toContain("A02");
    expect(wrapper.text()).not.toContain("逾期借用");
    expect(wrapper.text()).not.toContain("应归还日期");
    expect(wrapper.find('[data-path="/stock"]').exists()).toBe(true);
    expect(wrapper.find('[data-path="/loans/TI-LOAN-1"]').exists()).toBe(true);
  });

  it("opens the in-layout filter rail on desktop", async () => {
    const state = controller();
    const wrapper = mount(DashboardView, {
      props: { controller: state as any },
      global: globals,
    });
    expect(wrapper.find(".dashboard-desktop-filter").exists()).toBe(false);
    await wrapper.find(".dashboard-header .dashboard-filter-trigger").trigger("click");
    expect(state.desktopFilterOpen.value).toBe(true);
    expect(wrapper.find(".dashboard-desktop-filter").exists()).toBe(true);
    expect(wrapper.find(".filter-drawer-backdrop").exists()).toBe(false);
  });
});
