import { beforeEach, describe, expect, it, vi } from "vitest";
import { reactive, defineComponent, nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import Loans from "../src/pages/Loans.vue";
import Pending from "../src/pages/Pending.vue";
import History from "../src/pages/History.vue";

const state = vi.hoisted(() => ({
  route: { path: "/drafts", query: {} as Record<string, unknown> },
  api: vi.fn(),
  workspaceApi: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(async () => undefined),
}));
const route = reactive(state.route);
vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({
    push: state.push,
    replace: state.replace,
    currentRoute: { value: route },
  }),
}));
vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<any>("../src/lib/api");
  return { ...actual, api: state.api, workspaceApi: state.workspaceApi };
});
const globals = {
  stubs: {
    RouterLink: defineComponent({ template: "<a><slot /></a>" }),
  },
};

describe("compact desktop filter rails", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    state.api.mockReset().mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      if (method === "pending")
        return { results: [], total: 0, overall_total: 0 };
      if (method === "loan_items") return { results: [], total: 0 };
      return { results: [], total: 0, facets: {} };
    });
    state.workspaceApi.mockReset().mockResolvedValue({ results: [], total: 0 });
    state.replace.mockClear();
  });
  async function assertToggle(wrapper: any) {
    await flushPromises();
    expect(wrapper.find(".compact-filter-layout").exists()).toBe(true);
    expect(wrapper.find(".compact-filter-layout").classes()).not.toContain(
      "filters-open",
    );
    await wrapper.find(".desktop-filter-button").trigger("click");
    await nextTick();
    expect(wrapper.find(".compact-filter-layout").classes()).toContain(
      "filters-open",
    );
  }
  it("collapses and opens Loans desktop filters", async () => {
    await assertToggle(mount(Loans, { global: globals }));
  });
  it("renders loan quantity columns from per-UOM row values", async () => {
    state.api.mockImplementation(async (method: string) => {
      if (method === "bootstrap")
        return {
          physical_tree: [],
          item_groups: [],
          stock_operation_capabilities: {},
        };
      if (method === "loan_items")
        return {
          results: [
            {
              name: "LOAN-1",
              borrower: "借用方",
              loan_date: "2026-10-01",
              line_count: 1,
              outstanding_lines: 1,
              loan_status: "Outstanding",
              loaned_qty: [{ uom: "Nos", qty: 2 }],
              outstanding_qty: [{ uom: "Nos", qty: 1 }],
              items: [],
            },
          ],
          total: 1,
          quantity_totals: {
            loaned_qty: [{ uom: "Nos", qty: 2 }],
            outstanding_qty: [{ uom: "Nos", qty: 1 }],
          },
          column_summaries: {},
        };
      return [];
    });
    const wrapper = mount(Loans, { global: globals });
    await flushPromises();
    expect(wrapper.text()).toContain("借出数量");
    expect(wrapper.text()).toContain("2 Nos");
    expect(wrapper.text()).toContain("1 Nos");
  });
  it("collapses and opens Pending desktop filters", async () => {
    await assertToggle(mount(Pending, { global: globals }));
  });
  it("collapses and opens Drafts desktop filters", async () => {
    const wrapper = mount(History, {
      props: { destination: "drafts" },
      global: globals,
    });
    await assertToggle(wrapper);
    expect(wrapper.find("#drafts-posting-date").exists()).toBe(true);
    expect(wrapper.find("#drafts-posting-date").attributes("aria-label")).toBe(
      "日期",
    );
  });
});
