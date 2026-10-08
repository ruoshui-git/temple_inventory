import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, defineComponent } from "vue";
import Inventory from "../src/pages/Inventory.vue";
import Expiry from "../src/pages/Expiry.vue";
import InventoryFilterPanel from "../src/components/InventoryFilterPanel.vue";

const state = vi.hoisted(() => ({
  route: { query: {} as Record<string, any>, path: "/" },
  api: vi.fn(),
  replace: vi.fn(async (value: any) => {
    state.route.query = value.query || state.route.query;
  }),
  push: vi.fn(),
}));
const route = reactive(state.route);
const media = vi.hoisted(() => ({
  matches: false,
  listener: undefined as ((event: MediaQueryListEvent) => void) | undefined,
}));
vi.mock("../src/lib/api", () => ({ api: state.api }));
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: state.replace, push: state.push }),
}));
vi.mock("../src/lib/toast", () => ({ toast: vi.fn() }));

const child = defineComponent({ template: "<div><slot /></div>" });
const scanner = defineComponent({
  emits: ["scan", "close"],
  template:
    "<button class=\"test-scan\" @click=\"$emit('scan', 'A001')\">scan</button>",
});
const globals = {
  stubs: {
    WarehouseSelector: child,
    CategorySelector: child,
    ActiveFilterChips: child,
    FloatingActionMenu: child,
    ResponsiveFilterPanel: child,
    LoadingIndicator: child,
    ItemImagePreview: child,
    Scanner: scanner,
    RouterLink: defineComponent({
      props: ["to"],
      template: '<a :href="String(to)"><slot /></a>',
    }),
  },
};
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 320));
  await flushPromises();
};

function setSurface(surface: "desktop" | "mobile") {
  media.matches = surface === "desktop";
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
}

function inventoryRows() {
  return [
    {
      item_code: "A001",
      item_name: "一号",
      item_group: "杂项",
      available_stock: 3,
      total_stock: 5,
      on_loan_qty: 1,
      damaged_qty: 0,
      stock_uom: "件",
    },
  ];
}
function expiryRows() {
  return [
    {
      batch_no: "B001",
      item_code: "A001",
      item_name: "一号",
      item_group: "杂项",
      expiry_date: "2026-10-01",
      days_to_expiry: 10,
      total_qty: 2,
      stock_uom: "件",
      locations: [],
    },
  ];
}

beforeEach(() => {
  state.route.query = {};
  state.route.path = "/";
  state.api.mockReset();
  state.replace.mockClear();
  state.push.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  setSurface("mobile");
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(window, "IntersectionObserver", {
    value: class {
      observe() {}
      disconnect() {}
    },
    configurable: true,
  });
  state.api.mockImplementation(async (method: string) =>
    method === "bootstrap"
      ? { item_groups: [], physical_tree: [], stock_operation_capabilities: {} }
      : method === "inventory"
        ? { results: inventoryRows(), total: 1, overall_total: 1, facets: {} }
        : { results: expiryRows(), total: 1, overall_total: 1, facets: {} },
  );
});

describe("Inventory and Expiry integrations", () => {
  it("mounts dedicated Inventory and Expiry surface boundaries", async () => {
    const inventory = mount(Inventory, { global: globals });
    const expiry = mount(Expiry, { global: globals, props: {} });
    await flushPromises();
    expect(
      inventory.findComponent({ name: "InventoryMobileView" }).exists(),
    ).toBe(true);
    expect(
      inventory.findComponent({ name: "InventoryDesktopView" }).exists(),
    ).toBe(false);
    expect(inventory.find(".mobile-results").exists()).toBe(true);
    expect(inventory.find(".desktop-list-layout").exists()).toBe(false);
    expect(expiry.findComponent({ name: "ExpiryMobileView" }).exists()).toBe(
      true,
    );
    expect(expiry.findComponent({ name: "ExpiryDesktopView" }).exists()).toBe(
      false,
    );
    expect(expiry.find(".mobile-results").exists()).toBe(true);
    expect(expiry.find(".desktop-list-layout").exists()).toBe(false);
    inventory.unmount();
    expiry.unmount();
  });

  it("renders a unitless Inventory headline and expands exact per-UOM details", async () => {
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            item_groups: [],
            physical_tree: [],
            stock_operation_capabilities: {},
          }
        : {
            results: inventoryRows(),
            total: 1,
            overall_total: 1,
            facets: {},
            quantity_totals: {
              available_stock: [
                { uom: "Nos", qty: 4 },
                { uom: "包", qty: 6 },
              ],
            },
          },
    );
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    const firstSummary = wrapper.find(".mobile-summary-card");
    expect(firstSummary.text()).toContain("10");
    await firstSummary.trigger("click");
    expect(wrapper.find(".mobile-summary-details").text()).toContain("Nos");
    expect(wrapper.find(".mobile-summary-details").text()).toContain("包");
  });

  it("switches the production Inventory mobile card and list views", async () => {
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    expect(wrapper.find(".mobile-results .inventory-card-grid").exists()).toBe(
      true,
    );
    await wrapper.findAll(".mobile-result-controls button")[0].trigger("click");
    expect(
      wrapper.find(".mobile-results .mobile-inventory-list").exists(),
    ).toBe(true);
  });

  it("maps Expiry quick filters and renders complete summary details for separate batches", async () => {
    state.route.path = "/expiry";
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            item_groups: [],
            physical_tree: [],
            stock_operation_capabilities: {},
          }
        : {
            results: [
              { ...expiryRows()[0], batch_no: "B001" },
              { ...expiryRows()[0], batch_no: "B002" },
            ],
            total: 2,
            overall_total: 2,
            facets: { expiry: { all: 2 } },
            expiry_summary: {
              expiring_soon: 4,
              expired: 2,
              within_7_days: 1,
              days_8_to_30: 3,
              average_remaining_days: 12,
            },
          },
    );
    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    await wrapper.find(".mobile-summary-card").trigger("click");
    expect(wrapper.find(".mobile-summary-details").text()).toContain("7 天内");
    expect(wrapper.findAll(".mobile-expiry-result-row")).toHaveLength(2);
    const quick = wrapper.findAll(".expiry-quick-filters button");
    await quick[1].trigger("click");
    await flushPromises();
    let request = state.api.mock.calls
      .filter((call) => call[0] === "expiring_batches")
      .at(-1);
    expect(request?.[1].expiry_window).toBe("remaining_within");
    await quick[2].trigger("click");
    await flushPromises();
    request = state.api.mock.calls
      .filter((call) => call[0] === "expiring_batches")
      .at(-1);
    expect(request?.[1].expiry_window).toBe("overdue");
    await quick[0].trigger("click");
    await flushPromises();
    request = state.api.mock.calls
      .filter((call) => call[0] === "expiring_batches")
      .at(-1);
    expect(request?.[1].expiry_window).toBe("");
  });

  it("compacts mobile browse chrome while retaining the compact page title", async () => {
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    const results = wrapper.find<HTMLElement>(".mobile-results");
    Object.defineProperty(results.element, "scrollTop", {
      value: 100,
      configurable: true,
    });
    await results.trigger("scroll");
    expect(wrapper.find(".mobile-inventory-page").classes()).toContain(
      "compact",
    );
    expect(wrapper.find(".compact-page-title").exists()).toBe(true);
    Object.defineProperty(results.element, "scrollTop", {
      value: 0,
      configurable: true,
    });
    await results.trigger("scroll");
    expect(wrapper.find(".mobile-inventory-page").classes()).not.toContain(
      "compact",
    );
  });

  it("restores Inventory compact state from a saved mobile scroll position", async () => {
    sessionStorage.setItem("ti:inventory-results-scroll", "120");
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    expect(wrapper.find(".mobile-inventory-page").classes()).toContain(
      "compact",
    );
    expect(wrapper.find(".compact-page-title").exists()).toBe(true);
  });

  it("compacts and restores the Expiry mobile header with its results scroll", async () => {
    state.route.path = "/expiry";
    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    const results = wrapper.find<HTMLElement>(".mobile-results");
    Object.defineProperty(results.element, "scrollTop", {
      value: 100,
      configurable: true,
    });
    await results.trigger("scroll");
    expect(wrapper.find(".mobile-expiry-page").classes()).toContain("compact");
    Object.defineProperty(results.element, "scrollTop", {
      value: 0,
      configurable: true,
    });
    await results.trigger("scroll");
    expect(wrapper.find(".mobile-expiry-page").classes()).not.toContain(
      "compact",
    );
  });

  it("restores Expiry compact state from a saved scroll position", async () => {
    state.route.path = "/expiry";
    sessionStorage.setItem("temple_inventory.scroll.expiry", "120");
    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    expect(wrapper.find(".mobile-expiry-page").classes()).toContain("compact");
  });

  it("hides the ERPNext item-group root and sanitizes legacy selection", async () => {
    setSurface("desktop");
    state.route.query = { item_groups: "All Item Groups" };
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            item_groups: [
              {
                name: "All Item Groups",
                item_group_name: "All Item Groups",
                is_group: 1,
              },
              {
                name: "daily",
                item_group_name: "生活物资",
                parent_item_group: "All Item Groups",
                is_group: 1,
              },
              {
                name: "food",
                item_group_name: "食品",
                parent_item_group: "daily",
                is_group: 0,
              },
            ],
            physical_tree: [],
            stock_operation_capabilities: {},
          }
        : { results: inventoryRows(), total: 1, overall_total: 1, facets: {} },
    );

    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    const categories = wrapper
      .findComponent(InventoryFilterPanel)
      .props("categories") as any[];
    expect(categories.map((node) => node.name)).toEqual(["daily", "food"]);
    expect(categories[0].parent).toBeUndefined();
    expect(categories[1].parent).toBe("daily");
    const inventoryRequest = state.api.mock.calls.find(
      (call) => call[0] === "inventory",
    );
    expect(inventoryRequest?.[1].item_groups).toBeUndefined();
  });

  it("shows Expiry primary actions and permission-filtered overflow actions", async () => {
    setSurface("desktop");
    state.route.path = "/expiry";
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            item_groups: [],
            physical_tree: [],
            stock_operation_capabilities: {
              Receive: true,
              Issue: true,
              Transfer: true,
            },
          }
        : { results: expiryRows(), total: 1, overall_total: 1, facets: {} },
    );

    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    expect(
      wrapper
        .findAll(".inventory-heading-actions button")
        .map((button) => button.text()),
    ).toEqual(["↓ 入库", "↑ 出库", "⇄ 转移", "导出"]);
    expect(wrapper.find(".action-fab").exists()).toBe(false);
    wrapper.unmount();
    setSurface("mobile");
    const mobile = mount(Expiry, { global: globals });
    await flushPromises();
    const overflow = mobile.find(".overflow-action-trigger");
    await overflow.trigger("click");
    expect(
      mobile.findAll('[role="menuitem"]').map((item) => item.text()),
    ).toEqual(["入库", "出库", "转移", "导出"]);
    mobile.unmount();
  });

  it("filters Inventory overflow actions by capabilities and keeps Export last", async () => {
    setSurface("mobile");
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            item_groups: [],
            physical_tree: [],
            capabilities: { Item: true },
            stock_operation_capabilities: {
              Receive: true,
              Issue: false,
              Transfer: true,
            },
          }
        : { results: inventoryRows(), total: 1, overall_total: 1, facets: {} },
    );
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    await wrapper.find(".overflow-action-trigger").trigger("click");
    expect(
      wrapper.findAll('[role="menuitem"]').map((item) => item.text()),
    ).toEqual(["新建物品", "入库", "转移", "导出"]);
  });

  it("restores bootstrap-dependent filters and actions when retry succeeds", async () => {
    setSurface("desktop");
    let bootstrapAttempts = 0;
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap") {
        bootstrapAttempts += 1;
        if (bootstrapAttempts === 1) throw new Error("初始化失败");
        return {
          item_groups: [{ name: "供品", item_group_name: "供品" }],
          physical_tree: [
            {
              name: "主殿 - T",
              warehouse_name: "主殿",
              local_label: "主殿",
              is_group: 0,
            },
          ],
          stock_operation_capabilities: {
            Receive: true,
            Issue: true,
            Transfer: true,
          },
        };
      }
      return {
        results: inventoryRows(),
        total: 1,
        overall_total: 1,
        facets: {},
      };
    });

    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("初始化失败");

    const retry = wrapper
      .findAll("button")
      .find((button) => button.text() === "重试");
    expect(retry).toBeDefined();
    await retry!.trigger("click");
    await flushPromises();

    expect(bootstrapAttempts).toBe(2);
    const filterPanel = wrapper.findComponent(InventoryFilterPanel);
    expect(filterPanel.props("warehouses")).toEqual([
      expect.objectContaining({ name: "主殿 - T", label: "主殿" }),
    ]);
    expect(filterPanel.props("categories")).toEqual([
      expect.objectContaining({ name: "供品", label: "供品" }),
    ]);
    expect(
      wrapper
        .findAll(".inventory-heading-actions button")
        .map((button) => button.text()),
    ).toEqual(expect.arrayContaining(["↓ 入库", "↑ 出库", "⇄ 转移"]));
    expect(wrapper.text()).not.toContain("初始化失败");
  });

  it("keeps browse chrome outside the dedicated results scroll and uses shared primary cells", async () => {
    setSurface("desktop");
    const inventory = mount(Inventory, { global: globals });
    await flushPromises();
    expect(inventory.find(".results-chrome").exists()).toBe(true);
    expect(inventory.find(".results-scroll").exists()).toBe(true);
    await inventory.find('button[aria-pressed="false"]').trigger("click");
    expect(inventory.find(".primary-cell .primary-text").text()).toBe("一号");
    state.route.path = "/expiry";
    const expiry = mount(Expiry, { global: globals });
    await flushPromises();
    expect(expiry.find(".results-chrome").exists()).toBe(true);
    expect(expiry.find(".results-scroll").exists()).toBe(true);
    expect(expiry.find(".primary-cell .secondary-text").text()).toBe(
      "A001 · B001",
    );
  });

  it("requests Inventory default sort, reverses it, resets rows, and serializes non-default state", async () => {
    setSurface("desktop");
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    const request = state.api.mock.calls.find(
      (call) => call[0] === "inventory",
    );
    expect(request[1]).toMatchObject({
      sort_by: "item_name",
      sort_order: "asc",
    });
    await wrapper.find('button[aria-pressed="false"]').trigger("click");
    await wrapper.find(".sortable-data-table th button").trigger("click");
    await settle();
    expect(
      state.api.mock.calls.some(
        (call) =>
          call[0] === "inventory" &&
          call[1].sort_by === "item_name" &&
          call[1].sort_order === "desc",
      ),
    ).toBe(true);
    expect(state.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          sort_by: "item_name",
          sort_order: "desc",
        }),
      }),
    );
    await wrapper.find(".sortable-data-table th button").trigger("click");
    await settle();
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort_by).toBeUndefined();
    expect(
      state.replace.mock.calls.at(-1)?.[0].query.sort_order,
    ).toBeUndefined();
  });

  it("keeps Inventory scanner modal lookup pending and handles known and unknown results", async () => {
    setSurface("desktop");
    state.api.mockImplementation(async (method: string, payload?: any) => {
      if (method === "bootstrap")
        return {
          item_groups: [],
          physical_tree: [],
          stock_operation_capabilities: {},
        };
      if (method === "scan")
        return payload.value === "UNKNOWN"
          ? { unknown: true }
          : { item_code: "A001" };
      return {
        results: inventoryRows(),
        total: 1,
        overall_total: 1,
        facets: {},
      };
    });
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    await wrapper.find('[aria-label="扫描条码"]').trigger("click");
    const scan = wrapper.findComponent(scanner);
    expect(scan.exists()).toBe(true);
    await scan.vm.$emit("scan", "A001");
    await flushPromises();
    expect(state.push).toHaveBeenCalledWith("/item/A001");
    await wrapper.find('[aria-label="扫描条码"]').trigger("click");
    await wrapper.findComponent(scanner).vm.$emit("scan", "UNKNOWN");
    await flushPromises();
    expect(wrapper.text()).toContain("未找到物品");
  });

  it("keeps the Inventory scanner open after a lookup failure", async () => {
    setSurface("desktop");
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          item_groups: [],
          physical_tree: [],
          stock_operation_capabilities: {},
        };
      if (method === "scan") throw new Error("查询失败");
      return {
        results: inventoryRows(),
        total: 1,
        overall_total: 1,
        facets: {},
      };
    });
    const wrapper = mount(Inventory, { global: globals });
    await flushPromises();
    await wrapper.find('[aria-label="扫描条码"]').trigger("click");
    await wrapper.findComponent(scanner).vm.$emit("scan", "BROKEN");
    await flushPromises();
    expect(wrapper.findComponent(scanner).exists()).toBe(true);
    expect(wrapper.text()).toContain("查询失败");
  });

  it("hydrates Expiry legacy sort, removes the sidebar sorter, and sends canonical sort state", async () => {
    setSurface("desktop");
    state.route.path = "/expiry";
    state.route.query = { sort: "desc" };
    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("全部效期");
    expect(
      wrapper
        .findAll("fieldset")
        .some((fieldset) => fieldset.text().includes("排序")),
    ).toBe(false);
    expect(
      state.api.mock.calls.find((call) => call[0] === "expiring_batches")?.[1],
    ).toMatchObject({ sort_by: "expiry_date", sort_order: "desc" });
    expect(state.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          sort_by: "expiry_date",
          sort_order: "desc",
        }),
      }),
    );
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort).toBeUndefined();
  });

  it("uses Expiry first-click directions and resets to the default canonical sort", async () => {
    setSurface("desktop");
    state.route.path = "/expiry";
    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    await wrapper.findAll(".sortable-data-table th button")[0].trigger("click");
    await settle();
    expect(
      state.api.mock.calls.some(
        (call) =>
          call[0] === "expiring_batches" &&
          call[1].sort_by === "item_name" &&
          call[1].sort_order === "asc",
      ),
    ).toBe(true);
    await wrapper.findAll(".sortable-data-table th button")[1].trigger("click");
    await settle();
    await wrapper.findAll(".sortable-data-table th button")[1].trigger("click");
    await settle();
    expect(
      state.api.mock.calls.some(
        (call) =>
          call[0] === "expiring_batches" &&
          call[1].sort_by === "expiry_date" &&
          call[1].sort_order === "desc",
      ),
    ).toBe(true);
    await wrapper.findAll(".sortable-data-table th button")[1].trigger("click");
    await settle();
    expect(state.replace.mock.calls.at(-1)?.[0].query.sort_by).toBeUndefined();
    expect(
      state.replace.mock.calls.at(-1)?.[0].query.sort_order,
    ).toBeUndefined();
  });

  it("hydrates Expiry when browser navigation changes only the sort", async () => {
    setSurface("desktop");
    state.route.path = "/expiry";
    mount(Expiry, { global: globals });
    await flushPromises();
    route.query = { sort_by: "total_qty", sort_order: "desc" };
    await settle();
    expect(state.api.mock.calls.at(-1)?.[1]).toMatchObject({
      sort_by: "total_qty",
      sort_order: "desc",
    });
  });

  it("shows server expiry counts and blocks an invalid signed custom range", async () => {
    setSurface("desktop");
    state.route.path = "/expiry";
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            item_groups: [],
            physical_tree: [],
            stock_operation_capabilities: {},
          }
        : {
            results: expiryRows(),
            total: 1,
            overall_total: 1,
            facets: { expiry: { all: 9, custom: 2, none: 3 } },
          },
    );
    const wrapper = mount(Expiry, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("全部效期");
    expect(wrapper.text()).toContain("9");
    const custom = wrapper.find('input[type="radio"][value="custom"]');
    await custom.setValue(true);
    await wrapper.find('input[aria-label="自定义效期起始天数"]').setValue("20");
    await wrapper
      .find('input[aria-label="自定义效期结束天数"]')
      .setValue("-20");
    await settle();
    expect(wrapper.get('[role="alert"]').text()).toContain("起始不大于结束");
    const invalidRequest = state.api.mock.calls.find(
      (call) =>
        call[0] === "expiring_batches" &&
        call[1].expiry_window === "custom" &&
        call[1].expiry_from_days === "20" &&
        call[1].expiry_to_days === "-20",
    );
    expect(invalidRequest).toBeUndefined();
  });
});
