import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { reactive, defineComponent, nextTick, ref } from "vue";
import ItemDetail from "../src/pages/ItemDetail.vue";
import Reconciliation from "../src/pages/Reconciliation.vue";
import Workspace from "../src/pages/Workspace.vue";
import History from "../src/pages/History.vue";
import { returnToOpener, routeInstanceKey } from "../src/lib/navigation";

vi.mock("frappe-ui", () => ({
  Combobox: defineComponent({ template: "<input />" }),
}));

const state = vi.hoisted(() => ({
  route: {
    path: "/inventory/item/A001",
    params: { code: "A001" },
    query: {} as Record<string, any>,
  },
  api: vi.fn(),
  workspaceApi: vi.fn(),
  replace: vi.fn(() => Promise.resolve()),
  push: vi.fn(),
}));
const route = reactive(state.route);
const media = vi.hoisted(() => ({
  matches: true,
  listener: undefined as ((event: MediaQueryListEvent) => void) | undefined,
}));
vi.mock("../src/lib/api", () => ({
  api: state.api,
  workspaceApi: state.workspaceApi,
  upload: vi.fn(),
  labels: { Receive: "入库" },
  roomFor: vi.fn(() => ""),
  sessionExpired: ref(false),
}));
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    replace: state.replace,
    push: state.push,
    back: vi.fn(),
  }),
  onBeforeRouteLeave: vi.fn(),
}));
vi.mock("../src/lib/toast", () => ({ toast: vi.fn() }));

const scanner = defineComponent({
  props: { presentation: { type: String, default: "inline" } },
  emits: ["scan", "close"],
  template:
    "<button class=\"test-scanner\" @click=\"$emit('scan', 'CODE-1')\">scanner</button>",
});
const child = defineComponent({ template: "<div><slot /></div>" });
const globals = {
  stubs: {
    Scanner: scanner,
    LoadingIndicator: child,
    ItemImagePreview: child,
    AttachmentList: child,
    ItemPicker: child,
    LoanItemPicker: child,
    FloatingActionMenu: child,
    ResponsiveFilterPanel: child,
    WarehouseSelector: child,
    ActiveFilterChips: child,
    RouterLink: defineComponent({
      props: ["to"],
      template: '<a :href="String(to)"><slot /></a>',
    }),
  },
};
async function clickText(wrapper: any, text: string) {
  const button = wrapper
    .findAll("button")
    .find((candidate: any) => candidate.text() === text);
  if (!button) throw new Error(`button not found: ${text}`);
  await button.trigger("click");
}

beforeEach(() => {
  state.route.path = "/inventory/item/A001";
  state.route.params = { code: "A001" };
  state.route.query = {};
  state.api.mockReset();
  state.workspaceApi.mockReset();
  state.replace.mockClear();
  state.push.mockClear();
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
  state.api.mockImplementation(async (method: string) => {
    if (method === "bootstrap")
      return {
        item_groups: [],
        warehouse_tree: [],
        stock_operation_capabilities: {},
      };
    if (method === "inventory") return { results: [], total: 0 };
    return {
      item_code: "A001",
      item_name: "物品",
      item_group: "类别",
      stock_uom: "件",
      barcodes: [],
      images: [],
      stock: [],
      history: [],
      can_edit: true,
    };
  });
  state.workspaceApi.mockImplementation(async (method: string) =>
    method === "item_detail"
      ? {
          item_code: "A001",
          item_name: "物品",
          item_group: "类别",
          stock_uom: "件",
          barcodes: [],
          images: [],
          stock: [],
          history: [],
          can_edit: true,
        }
      : [],
  );
});

describe("Task 04 history, scanner, and navigation integration", () => {
  it("uses separate page instances for list destinations but not query-only changes", () => {
    expect(routeInstanceKey("/movements")).not.toBe(
      routeInstanceKey("/adjustments"),
    );
    expect(routeInstanceKey("/adjustments")).not.toBe(
      routeInstanceKey("/drafts"),
    );
    expect(routeInstanceKey("/movements")).toBe(routeInstanceKey("/movements"));
  });

  it("uses a modal scanner for one-shot item barcode editing and closes after decode", async () => {
    const wrapper = mount(ItemDetail, { global: globals });
    await flushPromises();
    await wrapper.get('button[aria-label="编辑"]').trigger("click");
    await clickText(wrapper, "扫描添加条码");
    expect(wrapper.findComponent(scanner).props("presentation")).toBe("modal");
    await wrapper.findComponent(scanner).vm.$emit("scan", "CODE-1");
    expect(wrapper.findComponent(scanner).exists()).toBe(false);
    const barcodeField = wrapper
      .findAll("label")
      .find((label) => label.text().includes("条码"))
      ?.find("textarea");
    expect(barcodeField?.element.value).toContain("CODE-1");
  });

  it("uses a modal reconciliation scanner and exposes lookup results after closing", async () => {
    state.route.path = "/inventory/reconcile/new";
    state.route.params = {};
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          can_reconcile_stock: true,
          physical_tree: [{ name: "A", is_group: 0 }],
          reconciliation_warehouses: ["A"],
          warehouse_tree: [],
        };
      if (method === "inventory")
        return {
          results: [
            {
              item_code: "A001",
              item_name: "物品",
              stock_uom: "件",
              has_batch_no: false,
            },
          ],
        };
      return {};
    });
    const wrapper = mount(Reconciliation, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("现场人员（可选）");
    for (const label of ["记录人", "经手人", "鉴证人"]) {
      expect(
        wrapper.findAll("label").some((node) => node.text().includes(label)),
      ).toBe(true);
    }
    await clickText(wrapper, "扫描");
    expect(wrapper.findComponent(scanner).props("presentation")).toBe("modal");
    await wrapper.findComponent(scanner).vm.$emit("scan", "CODE-1");
    await flushPromises();
    expect(wrapper.findComponent(scanner).exists()).toBe(false);
    expect(
      (
        wrapper.get('input[placeholder="搜索物品或条码"]')
          .element as HTMLInputElement
      ).value,
    ).toBe("CODE-1");
    expect(wrapper.text()).toContain("物品");
  });

  it("keeps workspace scanning continuous and preserves the contextual fallback helper", async () => {
    state.route.path = "/inventory/new/Receive";
    state.route.params = { kind: "Receive" };
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          user: "user@example.invalid",
          warehouses: [],
          warehouse_tree: [],
          settings: {},
          capabilities: {},
        };
      return [];
    });
    state.workspaceApi.mockImplementation(async (method: string) =>
      method === "activities" ? [] : {},
    );
    const wrapper = mount(Workspace, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("现场人员（可选）");
    for (const label of ["记录人", "经手人", "鉴证人"]) {
      expect(
        wrapper.findAll("label").some((node) => node.text().includes(label)),
      ).toBe(true);
    }
    await clickText(wrapper, "▣ 连续扫码");
    expect(wrapper.findComponent(scanner).props("presentation")).toBe(
      "continuous",
    );

    window.history.replaceState({}, "", "/inventory/item/A001");
    await returnToOpener(
      { replace: state.replace, back: vi.fn() } as any,
      "/inventory",
    );
    expect(state.replace).toHaveBeenCalledWith("/inventory");
  });

  it("sorts History through the server and isolates draft controls from row activation", async () => {
    state.route.path = "/inventory/drafts";
    state.route.query = {};
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap" ? { stock_operation_capabilities: {} } : {},
    );
    state.workspaceApi.mockImplementation(async (method: string) => {
      if (method === "activities") return [];
      if (method === "history")
        return {
          results: [
            {
              name: "IW-1",
              movement_kind: "Receive",
              title: "Receive Donation",
              posting_date: "2026-09-01",
              line_count: 2,
              docstatus: 0,
              source_text: "Donation",
            },
          ],
          total: 1,
          overall_total: 1,
          unfinished_count: 1,
          facets: { movement_kind: {}, warehouses: {}, item_groups: {} },
        };
      return {};
    });
    Object.defineProperty(window, "IntersectionObserver", {
      value: class {
        observe() {}
        disconnect() {}
      },
      configurable: true,
    });
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: scrollTo,
      configurable: true,
    });
    const wrapper = mount(History, {
      props: { destination: "drafts" },
      global: globals,
    });
    await flushPromises();
    expect(
      state.workspaceApi.mock.calls.find((call) => call[0] === "history")?.[1],
    ).toMatchObject({ sort_by: "posting_date", sort_order: "desc" });
    await wrapper.find(".sortable-data-table th button").trigger("click");
    await flushPromises();
    expect(state.workspaceApi.mock.calls.at(-1)?.[1]).toMatchObject({
      sort_by: "movement_kind",
      sort_order: "asc",
    });
    expect(state.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          sort_by: "movement_kind",
          sort_order: "asc",
        }),
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await wrapper.find("[data-row-control]").trigger("click");
    expect(state.push).not.toHaveBeenCalledWith("/workspace/IW-1");
  });

  it.each([
    ["Receive", ["入库位置"]],
    ["Issue", ["出库位置"]],
    ["Transfer", ["来源位置", "去向位置"]],
  ])(
    "shows role-specific warehouse columns for %s movements",
    async (kind, expectedLabels) => {
      state.route.path = "/inventory/movements";
      state.route.query = { kind };
      state.api.mockImplementation(async (method: string) =>
        method === "bootstrap"
          ? {
              physical_tree: [],
              item_groups: [],
              stock_operation_capabilities: {},
            }
          : {},
      );
      state.workspaceApi.mockImplementation(async (method: string) =>
        method === "history"
          ? {
              results: [],
              total: 0,
              overall_total: 0,
              facets: {
                movement_kind: {},
                warehouses: {},
                source_warehouses: {},
                destination_warehouses: {},
                item_groups: {},
              },
            }
          : {},
      );
      Object.defineProperty(window, "IntersectionObserver", {
        value: class {
          observe() {}
          disconnect() {}
        },
        configurable: true,
      });
      Object.defineProperty(HTMLElement.prototype, "scrollTo", {
        value: vi.fn(),
        configurable: true,
      });

      const wrapper = mount(History, {
        props: { destination: "movements" },
        global: globals,
      });
      await flushPromises();

      const headings = wrapper
        .findAll(".sortable-data-table-desktop th")
        .map((column) => column.text());
      expect(headings).not.toContain("位置数量");
      for (const label of expectedLabels) expect(headings).toContain(label);
      wrapper.unmount();
    },
  );

  it("separates transfer warehouse roles and expands previews without activating the row", async () => {
    state.route.path = "/inventory/movements";
    state.route.query = { kind: "Transfer" };
    const warehouses = [
      { name: "SRC-1", breadcrumb: "东厢房 / 一架" },
      { name: "SRC-2", breadcrumb: "东厢房 / 二架" },
      { name: "SRC-3", breadcrumb: "东厢房 / 三架" },
      { name: "DEST-1", breadcrumb: "西厢房 / 四架" },
    ];
    state.api.mockImplementation(async (method: string) =>
      method === "bootstrap"
        ? {
            physical_tree: warehouses,
            item_groups: [],
            stock_operation_capabilities: {},
          }
        : {},
    );
    state.workspaceApi.mockImplementation(async (method: string) =>
      method === "history"
        ? {
            results: [
              {
                name: "IW-transfer",
                posting_date: "2026-09-20",
                line_count: 3,
                category_count: 1,
                docstatus: 1,
                locations: [
                  { warehouse: "SRC-1", roles: ["source"] },
                  { warehouse: "SRC-2", roles: ["source"] },
                  { warehouse: "SRC-3", roles: ["source"] },
                  { warehouse: "DEST-1", roles: ["destination"] },
                ],
              },
            ],
            total: 1,
            overall_total: 1,
            facets: {
              movement_kind: {},
              warehouses: {},
              source_warehouses: {},
              destination_warehouses: {},
              item_groups: {},
            },
          }
        : {},
    );
    Object.defineProperty(window, "IntersectionObserver", {
      value: class {
        observe() {}
        disconnect() {}
      },
      configurable: true,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      value: vi.fn(),
      configurable: true,
    });

    const wrapper = mount(History, {
      props: { destination: "movements" },
      global: globals,
      attachTo: document.body,
    });
    await flushPromises();

    const cells = wrapper
      .findAll(".sortable-data-table-desktop tbody tr")
      .at(0)!
      .findAll("td");
    expect(cells[2].text()).toContain("东厢房 / 一架");
    expect(cells[2].text()).toContain("东厢房 / 二架");
    expect(cells[2].text()).not.toContain("东厢房 / 三架");
    expect(cells[2].text()).not.toContain("西厢房 / 四架");
    expect(cells[2].get("button").text()).toBe("+1");
    expect(cells[3].text()).toContain("西厢房 / 四架");
    expect(cells[3].text()).not.toContain("东厢房 / 一架");

    wrapper.unmount();
    media.matches = false;
    const mobileWrapper = mount(History, {
      props: { destination: "movements" },
      global: globals,
      attachTo: document.body,
    });
    await nextTick();
    await flushPromises();
    const mobileWarehouses = mobileWrapper.findAll(".movement-card-warehouse");
    expect(mobileWarehouses.map((section) => section.text())).toEqual([
      expect.stringContaining("来源位置"),
      expect.stringContaining("去向位置"),
    ]);
    await mobileWarehouses[0].get("button").trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("东厢房 / 三架");
    expect(state.push).not.toHaveBeenCalled();
    mobileWrapper.unmount();
  });
});
