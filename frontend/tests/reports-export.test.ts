import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, reactive } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import ExportDialog from "../src/components/ExportDialog.vue";
import Reports from "../src/pages/Reports.vue";

const state = vi.hoisted(() => ({
  route: { path: "/reports", query: {} as Record<string, unknown> },
  replace: vi.fn(),
  api: vi.fn(),
  downloadReport: vi.fn(),
}));
const route = reactive(state.route);

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock("../src/lib/api", async () => {
  const actual = await vi.importActual<any>("../src/lib/api");
  return { ...actual, api: state.api, downloadReport: state.downloadReport };
});

const SimpleSelector = defineComponent({
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template: "<div class='selector-stub'></div>",
});

describe("reports and exports", () => {
  beforeEach(() => {
    route.query = {};
    state.replace.mockReset();
    state.downloadReport.mockReset().mockResolvedValue(undefined);
    state.api
      .mockReset()
      .mockResolvedValue({ item_groups: [], physical_tree: [] });
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("defaults the report center to this month and the three core movement kinds", async () => {
    const wrapper = mount(Reports, {
      global: {
        stubs: {
          CategorySelector: SimpleSelector,
          WarehouseSelector: SimpleSelector,
        },
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("报表与导出");
    expect(wrapper.find('[aria-pressed="true"]').text()).toContain("货物流动");
    expect(
      wrapper.findAll(".compact-filter-section").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      wrapper.find(".compact-filter-field input[type='search']").exists(),
    ).toBe(true);
    await wrapper.find(".report-actions button").trigger("click");
    await flushPromises();
    expect(state.downloadReport).toHaveBeenCalledWith(
      "movement",
      "xlsx",
      expect.objectContaining({
        period_key: "this_month",
        movement_kinds: ["Receive", "Issue", "Transfer"],
      }),
    );
  });

  it("requires a warehouse before exporting a warehouse report", async () => {
    route.query = { type: "warehouse_stock" };
    const wrapper = mount(Reports, {
      global: {
        stubs: {
          CategorySelector: SimpleSelector,
          WarehouseSelector: SimpleSelector,
        },
      },
    });
    await flushPromises();
    await wrapper.find(".report-actions button").trigger("click");
    expect(wrapper.text()).toContain("请选择一个仓库或位置");
    expect(state.downloadReport).not.toHaveBeenCalled();
  });

  it("exports all current filtered rows from the contextual dialog", async () => {
    const wrapper = mount(ExportDialog, {
      attachTo: document.body,
      props: {
        open: true,
        reportType: "current_stock",
        filters: { search: "米", warehouses: ["A"] },
        title: "导出当前库存",
        summary: "当前筛选",
      },
    });
    (
      document.body.querySelector(
        ".export-dialog .primary",
      ) as HTMLButtonElement
    ).click();
    await flushPromises();
    expect(state.downloadReport).toHaveBeenCalledWith("current_stock", "xlsx", {
      search: "米",
      warehouses: ["A"],
    });
    expect(document.body.textContent).toContain("不限于已经加载的页面");
    wrapper.unmount();
  });
});
