import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Loans from "../src/pages/Loans.vue";

const state = vi.hoisted(() => ({
  route: {
    path: "/loans/items",
    query: {} as Record<string, unknown>,
  },
  push: vi.fn(),
  replace: vi.fn(async () => undefined),
  api: vi.fn(),
  workspaceApi: vi.fn(),
}));
const route = reactive(state.route);

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ push: state.push, replace: state.replace }),
}));
vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<any>("../src/lib/api");
  return { ...actual, api: state.api, workspaceApi: state.workspaceApi };
});

const RouterLink = defineComponent({
  props: ["to"],
  template:
    "<a :href=\"typeof to === 'string' ? to : (to?.path || '#')\"><slot /></a>",
});
const globals = {
  stubs: {
    RouterLink,
    Combobox: defineComponent({
      inheritAttrs: false,
      props: ["modelValue", "options", "query"],
      emits: ["update:modelValue", "update:query"],
      template:
        '<div><input v-bind="$attrs" :value="query" /><button v-for="option in options" :key="option.value">{{ option.label }}</button></div>',
    }),
  },
};

beforeEach(() => {
  route.path = "/loans/items";
  route.query = {};
  state.api.mockReset();
  state.workspaceApi
    .mockReset()
    .mockImplementation(async (method: string) =>
      method === "movement_filter_options"
        ? { items: [{ name: "ITM-1", item_name: "相机" }], activities: [] }
        : [],
    );
  state.push.mockClear();
  state.replace.mockClear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
});

describe("loan item and record browsing", () => {
  it("loads aggregate item outcomes in the four-column ledger without a persistent summary row", async () => {
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      if (method === "loan_item_group_records")
        return {
          results: [
            {
              loan: "LOAN-1",
              detail_route: "/loans/LOAN-1",
              borrower: "借用方",
              loan_date: "2026-10-01",
              activity_title: "义卖活动",
              quantity_values: [{ uom: "Nos", qty: 1 }],
              locations: [
                { warehouse: "A04", batch_no: "B-1", uom: "Nos", quantity: 1 },
              ],
            },
          ],
          total: 1,
        };
      return {
        results: [
          {
            name: "ITM-1::outstanding",
            item_code: "ITM-1",
            item_name: "相机",
            outcome: "outstanding",
            outcome_label: "未归还",
            quantity_values: [{ uom: "Nos", qty: 1 }],
            record_count: 1,
          },
        ],
        total: 1,
        overall_total: 1,
        facets: {},
        column_summaries: {},
      };
    });

    const wrapper = mount(Loans, { global: globals });
    await flushPromises();

    expect(state.api).toHaveBeenCalledWith(
      "loan_item_groups",
      expect.objectContaining({
        filters: expect.objectContaining({ outcome: "outstanding" }),
      }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("借用 · 明细");
    expect(wrapper.text()).toContain("相机");
    expect(wrapper.text()).toContain("1 条记录");
    expect(
      wrapper.findAll(".loan-status-chip").map((button) => button.text()),
    ).toEqual(["全部", "未归还", "已归还", "已归还（损坏）", "已登记遗失"]);
    expect(wrapper.find('.loan-status-chip[aria-pressed="true"]').text()).toBe(
      "未归还",
    );
    expect(wrapper.findAll("thead th").map((cell) => cell.text())).toEqual([
      "物品",
      "数量",
      "归还状态",
      "借用记录",
    ]);
    await wrapper.find("tbody tr[tabindex='0']").trigger("click");
    await flushPromises();
    expect(state.api).toHaveBeenCalledWith(
      "loan_item_group_records",
      expect.objectContaining({ item_code: "ITM-1", outcome: "outstanding" }),
      expect.any(AbortSignal),
    );
    expect(document.body.textContent).toContain("LOAN-1");
    expect(state.push).not.toHaveBeenCalled();
    expect(wrapper.find(".quantity-summary").exists()).toBe(false);
    expect(wrapper.find(".loan-tabs").exists()).toBe(false);
  });

  it("supports all and each item outcome through the top status chips", async () => {
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      return {
        results: [],
        total: 0,
        overall_total: 4,
        facets: {},
        column_summaries: {},
      };
    });

    const wrapper = mount(Loans, { global: globals });
    await flushPromises();

    const choose = async (label: string) => {
      const button = wrapper
        .findAll(".loan-status-chip")
        .find((candidate) => candidate.text() === label);
      expect(button).toBeDefined();
      await button!.trigger("click");
      await new Promise((resolve) => setTimeout(resolve, 250));
      await flushPromises();
    };
    const loanCalls = () =>
      state.api.mock.calls.filter(([method]) => method === "loan_item_groups");

    await choose("全部");
    expect(loanCalls().at(-1)?.[1]).toEqual(
      expect.objectContaining({
        filters: expect.objectContaining({ outcome: undefined }),
      }),
    );
    expect(state.replace).toHaveBeenLastCalledWith({
      query: expect.objectContaining({ status: "all" }),
    });

    for (const [label, outcome] of [
      ["未归还", "outstanding"],
      ["已归还", "returned"],
      ["已归还（损坏）", "damaged"],
      ["已登记遗失", "lost"],
    ]) {
      await choose(label);
      expect(loanCalls().at(-1)?.[1]).toEqual(
        expect.objectContaining({
          filters: expect.objectContaining({ outcome }),
        }),
      );
    }
    wrapper.unmount();
  });

  it("retains a pinned breakdown and loaded records across the Loans breakpoint", async () => {
    let matches = true;
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        get matches() {
          return matches;
        },
        addEventListener: (
          _: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => listeners.push(listener),
        removeEventListener: vi.fn(),
      }),
    });
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      if (method === "loan_item_group_records")
        return {
          results: [
            {
              loan: "LOAN-PERSIST",
              detail_route: "/loans/LOAN-PERSIST",
              borrower: "借用方",
              loan_date: "2026-10-01",
              quantity_values: [{ uom: "Nos", qty: 1 }],
              locations: [],
            },
          ],
          total: 1,
        };
      return {
        results: [
          {
            name: "ITM-1::outstanding",
            item_code: "ITM-1",
            item_name: "相机",
            outcome: "outstanding",
            outcome_label: "未归还",
            quantity_values: [{ uom: "Nos", qty: 1 }],
            record_count: 1,
          },
        ],
        total: 1,
        overall_total: 1,
        facets: {},
        column_summaries: {},
      };
    });
    const wrapper = mount(Loans, { global: globals });
    await flushPromises();
    await wrapper.find(".loan-record-count").trigger("click");
    await flushPromises();
    expect(
      wrapper.find(".sortable-data-table").attributes("data-surface"),
    ).toBe("desktop");
    expect(document.body.textContent).toContain("LOAN-PERSIST");
    expect(
      state.api.mock.calls.filter(
        ([method]) => method === "loan_item_group_records",
      ),
    ).toHaveLength(1);

    matches = false;
    for (const listener of listeners)
      listener({ matches } as MediaQueryListEvent);
    await nextTick();
    await flushPromises();
    expect(
      wrapper.find(".sortable-data-table").attributes("data-surface"),
    ).toBe("mobile");
    expect(document.body.textContent).toContain("LOAN-PERSIST");
    expect(
      state.api.mock.calls.filter(
        ([method]) => method === "loan_item_group_records",
      ),
    ).toHaveLength(1);

    matches = true;
    for (const listener of listeners)
      listener({ matches } as MediaQueryListEvent);
    await nextTick();
    await flushPromises();
    expect(
      wrapper.find(".sortable-data-table").attributes("data-surface"),
    ).toBe("desktop");
    expect(document.body.textContent).toContain("LOAN-PERSIST");
    expect(
      state.api.mock.calls.filter(
        ([method]) => method === "loan_item_group_records",
      ),
    ).toHaveLength(1);
    wrapper.unmount();
  });

  it("loads the selected group's own records when switching an open breakdown", async () => {
    state.api.mockImplementation(async (method: string, args: any) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      if (method === "loan_item_group_records")
        return {
          results: [
            {
              loan: `LOAN-${args.item_code}`,
              detail_route: `/loans/LOAN-${args.item_code}`,
              borrower: "借用方",
              loan_date: "2026-10-01",
              quantity_values: [{ uom: "Nos", qty: 1 }],
              locations: [],
            },
          ],
          total: 1,
        };
      return {
        results: ["A", "B"].map((code) => ({
          name: `ITM-${code}::outstanding`,
          item_code: `ITM-${code}`,
          item_name: `物品${code}`,
          outcome: "outstanding",
          outcome_label: "未归还",
          quantity_values: [{ uom: "Nos", qty: 1 }],
          record_count: 1,
        })),
        total: 2,
        overall_total: 2,
        facets: {},
        column_summaries: {},
      };
    });
    const wrapper = mount(Loans, { global: globals });
    await flushPromises();
    const triggers = wrapper.findAll(".loan-record-count");
    expect(triggers).toHaveLength(2);
    await triggers[0].trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("LOAN-ITM-A");
    expect(document.body.textContent).not.toContain("LOAN-ITM-B");

    const activeLoanLink = document.querySelector(
      ".loan-breakdown a[data-row-control]",
    );
    expect(activeLoanLink).not.toBeNull();
    activeLoanLink!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    await flushPromises();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("LOAN-ITM-A");
    expect(
      state.api.mock.calls.filter(
        ([method]) => method === "loan_item_group_records",
      ),
    ).toHaveLength(1);

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    await flushPromises();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(0);
    outside.remove();

    await wrapper.findAll(".loan-record-count")[1].trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("LOAN-ITM-B");
    expect(document.body.textContent).not.toContain("LOAN-ITM-A");
    expect(state.api).toHaveBeenCalledWith(
      "loan_item_group_records",
      expect.objectContaining({ item_code: "ITM-B" }),
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });

  it("loads complete records and hydrates the outstanding status filter", async () => {
    route.path = "/loans/records";
    route.query = { status: "outstanding" };
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      return {
        results: [
          {
            name: "LOAN-1",
            record_name: "LOAN-1",
            loan_date: "2026-10-01",
            borrower: "借用方",
            line_count: 2,
            loan_status: "Partially Settled",
            loaned_qty: [{ uom: "Nos", qty: 2 }],
            outstanding_qty: [{ uom: "Nos", qty: 1 }],
          },
        ],
        total: 1,
        overall_total: 3,
        facets: {},
        column_summaries: {},
      };
    });

    const wrapper = mount(Loans, { global: globals });
    await flushPromises();

    expect(state.api).toHaveBeenCalledWith(
      "loan_records",
      expect.objectContaining({
        filters: expect.objectContaining({ status: "outstanding" }),
      }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("借用 · 记录");
    expect(wrapper.text()).toContain("部分结清");
    expect(wrapper.text()).toContain("LOAN-1");
    expect(wrapper.find('.loan-status-chip[aria-pressed="true"]').text()).toBe(
      "未结",
    );
  });

  it("defaults records to all and filters them with status chips", async () => {
    route.path = "/loans/records";
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      return {
        results: [],
        total: 0,
        overall_total: 3,
        facets: {},
        column_summaries: {},
      };
    });

    const wrapper = mount(Loans, { global: globals });
    await flushPromises();

    expect(state.api).toHaveBeenCalledWith(
      "loan_records",
      expect.objectContaining({
        filters: expect.objectContaining({ status: undefined }),
      }),
      expect.any(AbortSignal),
    );
    expect(
      wrapper.findAll(".loan-status-chip").map((button) => button.text()),
    ).toEqual(["全部", "未结", "已结清"]);
    expect(wrapper.find('.loan-status-chip[aria-pressed="true"]').text()).toBe(
      "全部",
    );

    await wrapper.findAll(".loan-status-chip")[2].trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    expect(state.api).toHaveBeenLastCalledWith(
      "loan_records",
      expect.objectContaining({
        filters: expect.objectContaining({ status: "settled" }),
      }),
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });

  it("restores the mode-specific default when clearing item filters", async () => {
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      return {
        results: [],
        total: 0,
        overall_total: 3,
        facets: {},
        column_summaries: {},
      };
    });

    const wrapper = mount(Loans, { global: globals });
    await flushPromises();
    await wrapper.findAll(".loan-status-chip")[0].trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    await wrapper.find(".clear-filters").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();

    expect(wrapper.find('.loan-status-chip[aria-pressed="true"]').text()).toBe(
      "未归还",
    );
    expect(state.api).toHaveBeenLastCalledWith(
      "loan_item_groups",
      expect.objectContaining({
        filters: expect.objectContaining({ outcome: "outstanding" }),
      }),
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });

  it("applies each mode default when switching between loan views", async () => {
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      return {
        results: [],
        total: 0,
        overall_total: 3,
        facets: {},
        column_summaries: {},
      };
    });

    const wrapper = mount(Loans, { global: globals });
    await flushPromises();

    route.path = "/loans/records";
    route.query = { search: "借用方" };
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    expect(state.api).toHaveBeenLastCalledWith(
      "loan_records",
      expect.objectContaining({
        filters: expect.objectContaining({
          search: "借用方",
          status: undefined,
        }),
      }),
      expect.any(AbortSignal),
    );

    route.path = "/loans/items";
    route.query = { search: "相机" };
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await flushPromises();
    expect(state.api).toHaveBeenLastCalledWith(
      "loan_item_groups",
      expect.objectContaining({
        filters: expect.objectContaining({
          search: "相机",
          outcome: "outstanding",
        }),
      }),
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });

  it("maps the legacy settled item link to all resolved outcomes", async () => {
    route.path = "/loans/items";
    route.query = { status: "settled" };
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      return {
        results: [],
        total: 0,
        overall_total: 2,
        facets: {},
        column_summaries: {},
      };
    });
    const wrapper = mount(Loans, { global: globals });
    await flushPromises();
    expect(state.api).toHaveBeenCalledWith(
      "loan_item_groups",
      expect.objectContaining({
        filters: expect.objectContaining({ outcome: "settled" }),
      }),
      expect.any(AbortSignal),
    );
    wrapper.unmount();
  });

  it("invalidates an in-flight breakdown when browse filters change", async () => {
    let resolveBreakdown: ((value: any) => void) | undefined;
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      if (method === "loan_item_groups")
        return {
          results: [
            {
              name: "ITM-1::outstanding",
              item_code: "ITM-1",
              item_name: "相机",
              outcome: "outstanding",
              outcome_label: "未归还",
              quantity_values: [{ uom: "Nos", qty: 1 }],
              record_count: 1,
            },
          ],
          total: 1,
          overall_total: 1,
        };
      if (method === "loan_item_group_records")
        return new Promise((resolve) => {
          resolveBreakdown = resolve;
        });
      return { results: [], total: 0 };
    });
    const wrapper = mount(Loans, { global: globals });
    await flushPromises();
    await wrapper.find("tbody tr[tabindex='0']").trigger("click");
    expect(state.api).toHaveBeenCalledWith(
      "loan_item_group_records",
      expect.objectContaining({ item_code: "ITM-1", outcome: "outstanding" }),
      expect.any(AbortSignal),
    );
    await wrapper.find('[aria-label="搜索借用记录"]').setValue("changed");
    await new Promise((resolve) => setTimeout(resolve, 250));
    resolveBreakdown?.({
      results: [{ loan: "STALE-LOAN", quantity_values: [], locations: [] }],
      total: 1,
    });
    await flushPromises();
    expect(document.body.textContent).not.toContain("STALE-LOAN");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    wrapper.unmount();
  });
});
