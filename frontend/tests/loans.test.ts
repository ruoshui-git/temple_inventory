import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, reactive } from "vue";
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
  template: "<a :href=\"typeof to === 'string' ? to : to.path\"><slot /></a>",
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
  it("defaults the item ledger to all statuses without a persistent summary row", async () => {
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
            name: "LOAN-ITEM-1",
            loan_item: "LOAN-ITEM-1",
            loan: "LOAN-1",
            record_name: "LOAN-1",
            loan_date: "2026-10-01",
            item_code: "ITM-1",
            item_name: "相机",
            borrower: "借用方",
            loan_status: "Outstanding",
            original_warehouse: "A04",
            loaned_qty: [{ uom: "Nos", qty: 2 }],
            outstanding_qty: [{ uom: "Nos", qty: 1 }],
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
      "loan_items",
      expect.objectContaining({
        filters: expect.objectContaining({ status: undefined }),
      }),
      expect.any(AbortSignal),
    );
    expect(wrapper.text()).toContain("借用 · 明细");
    expect(wrapper.text()).toContain("相机");
    expect(wrapper.text()).toContain("LOAN-1");
    expect(wrapper.find(".quantity-summary").exists()).toBe(false);
    expect(wrapper.find(".loan-tabs").exists()).toBe(false);
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
  });
});
