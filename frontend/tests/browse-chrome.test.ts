import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import BrowseToolbar from "../src/components/ui/BrowseToolbar.vue";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import HierarchyFilter from "../src/components/ui/HierarchyFilter.vue";
import OperationBrowseFilters from "../src/features/movements/OperationBrowseFilters.vue";
import type { OperationBrowse } from "../src/features/movements/useOperationBrowse";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";

const wrappers: VueWrapper[] = [];
const button = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll("button").find((node) => node.text().trim() === label)!;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("collapses once, honors manual choices, and keeps focus on the persistent disclosure", async () => {
  const surface = document.createElement("div");
  surface.style.overflowY = "auto";
  Object.defineProperties(surface, {
    scrollHeight: { value: 2000 },
    clientHeight: { value: 500 },
  });
  document.body.append(surface);
  const wrapper = mount(BrowseToolbar, {
    attachTo: surface,
    props: { title: "库存", summary: "库存 · 30 种" },
    slots: {
      default: '<input aria-label="排序搜索" />',
      "result-tools": "<button>分析结果</button>",
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  wrapper.get("input").element.focus();
  surface.scrollTop = 200;
  surface.dispatchEvent(new Event("scroll"));
  await flushPromises();
  const toggle = wrapper.get(".browse-tools-toggle");
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle.element);
  expect(wrapper.get("h1").isVisible()).toBe(true);
  expect(button(wrapper, "分析结果").isVisible()).toBe(false);
  expect(
    document.getElementById(toggle.attributes("aria-controls")),
  ).toBeTruthy();
  expect(wrapper.find(".browse-compact-summary").exists()).toBe(false);
  surface.scrollTop = 0;
  surface.dispatchEvent(new Event("scroll"));
  await flushPromises();
  expect(toggle.attributes("aria-expanded")).toBe("false");
  await toggle.trigger("click");
  surface.scrollTop = 400;
  surface.dispatchEvent(new Event("scroll"));
  await flushPromises();
  expect(toggle.attributes("aria-expanded")).toBe("true");
  expect(button(wrapper, "分析结果").isVisible()).toBe(true);
  await toggle.trigger("click");
  await button(wrapper, "搜索").trigger("click");
  await flushPromises();
  expect(toggle.attributes("aria-expanded")).toBe("false");
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  const search = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input',
  )!;
  search.value = "法会物品";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  expect(wrapper.emitted("update:search")?.at(-1)).toEqual(["法会物品"]);
  await wrapper.setProps({ active: false });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps all quick tabs in the shared expanded toolbar", async () => {
  const wrapper = mount(BrowseToolbar, {
    props: { title: "货物流动", summary: "货物流动" },
    slots: {
      default:
        '<nav class="browse-tabs" aria-label="流动类型"><button>全部</button><button>入库</button><button>出库</button><button>调拨</button></nav>',
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  expect(wrapper.get(".expanded-browse-tools .browse-tabs").exists()).toBe(
    true,
  );
  expect(wrapper.get(".browse-tabs").findAll("button")).toHaveLength(4);
});

it("exposes every movement filter in the shared panel content", async () => {
  const reference = createReferenceData();
  reference.siteDate = "2026-10-18";
  const call = vi.fn(async () => []);
  const query = ref(newReportQuery("movements"));
  const scope = ref(query.value.scope);
  const controller = {
    reference,
    query,
    scope,
    status: ref("completed"),
    statusChoices: ref(["completed", "draft"].map((value) => [value, value])),
    extraChips: ref([]),
    reset: vi.fn(),
  } as unknown as OperationBrowse;
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () =>
          h(OperationBrowseFilters, {
            controller,
            family: "movements",
            records: true,
          });
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  await flushPromises();
  const titles = wrapper
    .findAllComponents(HierarchyFilter)
    .map((tree) => tree.props("title"));
  expect(titles).toContain("来源位置");
  expect(titles).toContain("去向位置");
  expect(wrapper.text()).toContain("流动日期");
  expect(wrapper.text()).toContain("包括盘点调整");
  expect(wrapper.text()).toContain("状态");
});

function stock() {
  const initialQuery = newReportQuery("inventory");
  initialQuery.scope.categories = ["food", "cloth"];
  initialQuery.scope.warehouses = ["ROOM"];
  const props = reactive({ initialQuery });
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "manager",
    site: "header-test",
    operations: { Receive: true, Issue: true, Transfer: true },
    capabilities: { Item: { create: true } },
    categories: [
      { name: "food", label: "食品", is_group: true, lft: 1, rgt: 4 },
      { name: "rice", label: "米", parent: "food", lft: 2, rgt: 3 },
      { name: "cloth", label: "服装", lft: 5, rgt: 6 },
    ],
    warehouses: [{ name: "ROOM", label: "库房" }],
  });
  const call = vi.fn(async () => ({
    rows: [
      {
        code: "A",
        name: "物品甲",
        category: "食品",
        uom: "个",
        available: 2,
        loaned: 0,
        damaged: 0,
        locations: [],
        tracksBatch: false,
      },
    ],
    matched_count: 50,
    next_start: null,
    snapshot: "2026-10-18 10:00:00",
    summary: [],
    analysis: { category: [], location: [] },
  }));
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(StockBrowsePage, props);
      },
    }),
    { attachTo: document.body },
  );
  wrappers.push(wrapper);
  const page = wrapper.getComponent(StockBrowsePage);
  return { wrapper, page, c: page.vm.controller, call, reference, props };
}

it("hydrates the shared Inventory hierarchies and clears inherited categories without restoring them", async () => {
  const { wrapper, c, call } = stock();
  await flushPromises();
  await wrapper
    .findAll("button")
    .find((node) => node.text().trim().startsWith("筛选"))!
    .trigger("click");
  const category = wrapper
    .findAllComponents(HierarchyFilter)
    .find((tree) => tree.props("title") === "物品类别")!;
  expect(category.props("modelValue")).toEqual(["food", "cloth"]);
  await category.get('button[aria-label="清除本项"]').trigger("click");
  await flushPromises();
  expect(c.scope.value.categories).toEqual([]);
  expect(c.scope.value.warehouses).toEqual(["ROOM"]);
  expect(call.mock.calls.at(-1)?.[1].query.scope.categories).toEqual([]);
  category.vm.$emit("update:modelValue", ["rice", "cloth"]);
  await flushPromises();
  expect(c.query.value.scope.categories).toEqual(["rice", "cloth"]);
  c.appliedChips.value.find((chip) => chip.value === "rice")!.remove();
  await flushPromises();
  expect(c.query.value.scope.categories).toEqual(["cloth"]);
});

it("offers only Item creation until selection and dispatches exact permitted selected identities in compact mode", async () => {
  const { wrapper, page, c, reference } = stock();
  await flushPromises();
  expect(wrapper.get(".app-page-actions").text()).toContain("新建物品");
  expect(wrapper.find(".stock-selection-actions").exists()).toBe(false);
  c.toggle("A");
  c.toggle("隐藏,中文物品");
  await flushPromises();
  await button(wrapper, "收起工具").trigger("click");
  expect(wrapper.get(".stock-selection-actions").isVisible()).toBe(true);
  await button(wrapper, "调拨").trigger("click");
  expect(page.emitted("newOperation")?.at(-1)).toEqual([
    "Transfer",
    ["A", "隐藏,中文物品"],
  ]);
  reference.operations.Transfer = false;
  await flushPromises();
  expect(wrapper.findAll("button").some((node) => node.text() === "调拨")).toBe(
    false,
  );
  const count = page.emitted("newOperation")!.length;
  c.selectedAction("Transfer");
  expect(page.emitted("newOperation")).toHaveLength(count);
  await button(wrapper, "取消选择").trigger("click");
  expect(wrapper.find(".stock-selection-actions").exists()).toBe(false);
  c.selectedAction("Receive");
  expect(page.emitted("newOperation")).toHaveLength(count);
});
