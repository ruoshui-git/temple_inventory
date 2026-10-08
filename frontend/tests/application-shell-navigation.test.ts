import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive } from "vue";
import { mount } from "@vue/test-utils";
import ApplicationShell from "../src/components/ApplicationShell.vue";

const state = vi.hoisted(() => ({
  route: {
    path: "/",
    query: {} as Record<string, unknown>,
    params: {} as Record<string, unknown>,
  },
  api: vi.fn(async () => ({ pending_count: 0 })),
  request: vi.fn(),
}));
const route = reactive(state.route);

vi.mock("../src/lib/api", () => ({ api: state.api, request: state.request }));
vi.mock("vue-router", () => ({ useRoute: () => route }));

const RouterLink = defineComponent({
  props: ["to", "ariaCurrent"],
  emits: ["click"],
  template:
    "<a :data-to=\"typeof to === 'string' ? to : to.path\" :data-query=\"typeof to === 'string' ? '' : JSON.stringify(to.query)\" :aria-current=\"ariaCurrent\" @click=\"$emit('click', $event)\"><slot /></a>",
});

describe("ApplicationShell navigation contract", () => {
  beforeEach(() => {
    route.path = "/";
    route.query = {};
    route.params = {};
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        disconnect() {}
      },
    });
  });

  it("keeps all six primary destinations in the agreed order", () => {
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    const labels = wrapper
      .find('nav[aria-label="主导航"]')
      .findAll(":scope > a, :scope > button")
      .map((link) => link.text());
    expect(labels).toEqual([
      "库存",
      "货物流动",
      "盘点调整",
      "借用",
      "仓库",
      "更多",
    ]);
  });

  it("keeps the product brand ahead of the primary navigation on every route", async () => {
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    const brand = wrapper.find(".shell-brand").element;
    expect(wrapper.find(".desktop-nav").element.children[0]).toBe(brand);
    expect(wrapper.find(".shell-brand").text()).toBe("寺院物资");
    expect(
      wrapper.find(".shell-brand").attributes("aria-current"),
    ).toBeUndefined();
    route.path = "/adjustments";
    await nextTick();
    expect(wrapper.find(".shell-brand").element).toBe(brand);
    expect(wrapper.find(".shell-brand").text()).toBe("寺院物资");
  });

  it("shows the complete Inventory context on Expiry and selects exactly one item", async () => {
    route.path = "/expiry";
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    await nextTick();
    const context = wrapper.find(".desktop-inventory-context");
    expect(context.findAll("a").map((link) => link.text())).toEqual([
      "库存列表",
      "效期批次",
    ]);
    expect(context.findAll('a[aria-current="page"]')).toHaveLength(1);
    expect(context.find('a[aria-current="page"]').text()).toBe("效期批次");
  });

  it("leaves Inventory and Expiry tabs to the production page on mobile", async () => {
    route.path = "/expiry";
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    await nextTick();
    expect(wrapper.find(".mobile-context-nav").exists()).toBe(false);
    expect(wrapper.findAll(".desktop-inventory-context")).toHaveLength(1);
  });

  it("normalizes default context state and gives Adjustments no subnavigation", async () => {
    route.path = "/movements";
    route.query = {};
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    await nextTick();
    expect(
      wrapper.findAll('.desktop-inventory-context a[aria-current="page"]'),
    ).toHaveLength(1);
    expect(
      wrapper
        .findAll(".desktop-inventory-context a")
        .map((link) => link.text()),
    ).toEqual(["明细", "记录"]);
    expect(
      wrapper.find('.desktop-inventory-context a[aria-current="page"]').text(),
    ).toBe("明细");
    route.path = "/adjustments";
    await nextTick();
    expect(wrapper.find(".desktop-inventory-context").exists()).toBe(false);
  });

  it("expands Inventory destinations while another desktop module is active", async () => {
    route.path = "/movements";
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    await nextTick();

    expect(wrapper.findAll(".desktop-inventory-context")).toHaveLength(1);
    await wrapper.find("button.inventory-parent").trigger("click");

    const contexts = wrapper.findAll(".desktop-inventory-context");
    expect(contexts).toHaveLength(2);
    expect(contexts[0].findAll("a").map((link) => link.text())).toEqual([
      "库存列表",
      "效期批次",
    ]);
    expect(
      contexts[0].findAll("a").map((link) => link.attributes("data-to")),
    ).toEqual(["/", "/expiry"]);
    expect(contexts[1].findAll("a").map((link) => link.text())).toEqual([
      "明细",
      "记录",
    ]);

    const warehouse = wrapper
      .find('nav[aria-label="主导航"]')
      .findAll(":scope > a")
      .find((link) => link.text() === "仓库");
    expect(warehouse).toBeDefined();
    await warehouse!.trigger("click");
    expect(wrapper.findAll(".desktop-inventory-context")).toHaveLength(1);

    route.path = "/warehouses";
    await nextTick();
    expect(wrapper.findAll(".desktop-inventory-context")).toHaveLength(0);
    expect(
      wrapper.find('nav[aria-label="主导航"] a[aria-current="page"]').text(),
    ).toBe("仓库");

    route.path = "/warehouses/warehouse-1";
    await nextTick();
    expect(wrapper.findAll(".desktop-inventory-context")).toHaveLength(0);
    expect(
      wrapper.find('nav[aria-label="主导航"] a[aria-current="page"]').text(),
    ).toBe("仓库");
  });

  it("treats the report center as part of More", async () => {
    route.path = "/reports";
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    await nextTick();
    expect(wrapper.find(".shell-brand").text()).toBe("寺院物资");
    expect(
      wrapper.find('nav[aria-label="主导航"] a[aria-current="page"]').text(),
    ).toBe("更多");
  });

  it("carries every movement filter across detail and record tabs", async () => {
    route.path = "/movements/items";
    route.query = {
      kind: ["Loan", "Return"],
      item_code: "ITM-1",
      item_groups: ["食品"],
      source_warehouses: ["A"],
      destination_warehouses: ["B"],
      activity: "ACT-1",
      period: "last_90_days",
      date_from: "2026-07-01",
      date_to: "2026-09-28",
      search: "相机",
      docstatuses: [0, 1],
    };
    const wrapper = mount(ApplicationShell, {
      global: { stubs: { RouterLink } },
    });
    await nextTick();
    const record = wrapper
      .findAll(".desktop-inventory-context a")
      .find((link) => link.text() === "记录");
    expect(record?.attributes("data-query")).toContain('"item_code":"ITM-1"');
    expect(record?.attributes("data-query")).toContain(
      '"kind":["Loan","Return"]',
    );
    expect(record?.attributes("data-query")).toContain('"docstatuses":[0,1]');
  });
});
