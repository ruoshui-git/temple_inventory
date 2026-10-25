import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import BrowseToolbar from "../src/components/ui/BrowseToolbar.vue";
import FilterRailEdge from "../src/components/ui/FilterRailEdge.vue";
import BrowseChip from "../src/components/ui/BrowseChip.vue";
import StockBrowsePage from "../src/features/inventory/StockBrowsePage.vue";
import HierarchyFilter from "../src/components/ui/HierarchyFilter.vue";
import SortControl from "../src/components/ui/SortControl.vue";
import BrowseResultSummary from "../src/components/ui/BrowseResultSummary.vue";
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

it("keeps browse actions and result controls in the persistent toolbar", async () => {
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
      actions:
        '<button>新建</button><button aria-label="更多操作">更多</button>',
      "result-tools": "<button>分析结果</button>",
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  expect(wrapper.get(".browse-chrome").text()).not.toMatch(/^\s*>\s*$/m);
  wrapper.get("input").element.focus();
  surface.scrollTop = 200;
  surface.dispatchEvent(new Event("scroll"));
  await flushPromises();
  expect(wrapper.get("h1").isVisible()).toBe(true);
  expect(button(wrapper, "分析结果").isVisible()).toBe(true);
  expect(wrapper.get(".browse-header-actions").text()).toContain("新建");
  expect(
    wrapper
      .get(".browse-header-actions")
      .find('[aria-label="更多操作"]')
      .exists(),
  ).toBe(true);
  expect(wrapper.find(".browse-tools-toggle").exists()).toBe(false);
  const search = wrapper.get<HTMLInputElement>(
    ".browse-persistent-search input",
  );
  expect(search.isVisible()).toBe(true);
  expect(wrapper.findAll('input[type="search"]')).toHaveLength(1);
  await search.setValue("法会物品");
  await new Promise((resolve) => setTimeout(resolve, 230));
  expect(wrapper.emitted("update:search")?.at(-1)).toEqual(["法会物品"]);
  await wrapper.setProps({ active: false });
  expect(search.isVisible()).toBe(true);
});

it("waits for IME composition before emitting the debounced search", async () => {
  vi.useFakeTimers();
  const wrapper = mount(BrowseToolbar, {
    props: { title: "库存", summary: "库存", search: "" },
  });
  wrappers.push(wrapper);
  const input = wrapper.get<HTMLInputElement>(
    ".browse-persistent-search input",
  );
  await input.trigger("compositionstart");
  await input.setValue("法会物品");
  await vi.advanceTimersByTimeAsync(400);
  expect(wrapper.emitted("update:search")).toBeUndefined();
  await input.trigger("compositionend");
  await vi.advanceTimersByTimeAsync(220);
  expect(wrapper.emitted("update:search")?.at(-1)).toEqual(["法会物品"]);
  vi.useRealTimers();
});

it("uses / to focus search and ignores the shortcut while editing a field", async () => {
  const wrapper = mount(BrowseToolbar, {
    attachTo: document.body,
    props: { title: "库存", summary: "库存" },
  });
  wrappers.push(wrapper);
  const search = wrapper.get<HTMLInputElement>("[data-browse-search]");
  const text = document.createElement("input");
  document.body.append(text);
  text.focus();
  text.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
  expect(document.activeElement).toBe(text);
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: "/", bubbles: true }),
  );
  expect(document.activeElement).toBe(search.element);
  text.remove();
});

it("routes a hierarchy chip edit to the matching visible rail control", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const wrapper = mount(BrowseToolbar, {
    attachTo: host,
    props: {
      title: "库存",
      summary: "库存",
      sidebarAvailable: true,
      sidebarOpen: true,
    },
    slots: {
      chips: ({ editFilter }: { editFilter: (field?: string) => void }) =>
        h(BrowseChip, {
          label: "物品类别：2 项",
          onEdit: () => editFilter("categories"),
        }),
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  const rail = document.createElement("aside");
  rail.className = "browse-filter-rail";
  rail.innerHTML = `<fieldset data-filter-field="categories"><input aria-label="类别树搜索" /></fieldset><fieldset data-filter-field="warehouses"><input aria-label="仓库树搜索" /></fieldset>`;
  wrapper.element.append(rail);
  const tree = wrapper.element.querySelector<HTMLElement>(
    '[data-filter-field="categories"]',
  )!;
  tree.scrollIntoView = vi.fn();
  await wrapper.get(".browse-active-chip-label").trigger("click");
  expect(document.activeElement).toBe(
    wrapper.element.querySelector('[aria-label="类别树搜索"]'),
  );
  expect(tree.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  wrapper.unmount();
  host.remove();
});

it("keeps a dense chip list scrollable without placing search or actions inside it", async () => {
  const wrapper = mount(BrowseToolbar, {
    props: {
      title: "库存",
      summary: "库存",
      scannable: true,
      sidebarAvailable: true,
    },
    slots: {
      chips: () =>
        Array.from({ length: 40 }, (_, index) =>
          h("button", { key: index, type: "button" }, `筛选项 ${index + 1}`),
        ),
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  const chips = wrapper.get(".browse-persistent-chips");
  const bar = wrapper.get(".browse-persistent-bar");
  expect(chips.findAll("button")).toHaveLength(40);
  for (const selector of [".browse-persistent-search input"]) {
    const control = bar.get(selector);
    expect(chips.element.contains(control.element)).toBe(false);
    expect(control.isVisible()).toBe(true);
  }
  expect(bar.find(".browse-sidebar-toggle").exists()).toBe(false);
  expect(bar.get('button[aria-haspopup="dialog"]').isVisible()).toBe(true);
  expect(
    bar
      .findAll("button")
      .some((button) => button.attributes("aria-label") === "扫码"),
  ).toBe(true);
});

it("moves focus between the open rail collapse control and its collapsed edge", async () => {
  const wrapper = mount(FilterRailEdge, {
    attachTo: document.body,
    props: { open: true, active: true },
  });
  wrappers.push(wrapper);
  await wrapper.get('[aria-label="收起筛选侧栏"]').trigger("click");
  expect(wrapper.emitted("toggle")).toHaveLength(1);
  await wrapper.setProps({ open: false });
  await flushPromises();
  expect(document.activeElement).toBe(
    wrapper.get('[aria-label="展开筛选侧栏"]').element,
  );
  expect(wrapper.get(".filter-rail-edge").text()).toContain("筛选");
  await wrapper.get('[aria-label="展开筛选侧栏"]').trigger("click");
  await wrapper.setProps({ open: true });
  await flushPromises();
  expect(document.activeElement).toBe(
    wrapper.get('[aria-label="收起筛选侧栏"]').element,
  );
});

it("keeps all quick tabs in the shared browse header", async () => {
  const wrapper = mount(BrowseToolbar, {
    props: { title: "货物流动", summary: "货物流动" },
    slots: {
      default:
        '<nav class="browse-tabs" aria-label="流动类型"><button>全部</button><button>入库</button><button>出库</button><button>调拨</button></nav>',
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  expect(wrapper.get(".browse-inline-tools .browse-tabs").exists()).toBe(true);
  expect(wrapper.get(".browse-tabs").findAll("button")).toHaveLength(4);
});

it("shows sort state in a chip and emits the selected field and direction", async () => {
  const wrapper = mount(SortControl, {
    props: {
      field: "item_name",
      direction: "asc",
      fields: [
        { value: "item_name", label: "物品名称", kind: "text" },
        { value: "stock_qty", label: "库存数量", kind: "number" },
      ],
    },
  });
  wrappers.push(wrapper);
  expect(wrapper.get('[aria-label="排序：物品名称，A→Z"]').text()).toContain(
    "A→Z",
  );
  await wrapper.get('[aria-label="排序：物品名称，A→Z"]').trigger("click");
  await flushPromises();
  const choice = Array.from(
    document.querySelectorAll<HTMLElement>("[role='menuitemradio']"),
  ).find((item) => item.textContent?.includes("从多到少"));
  expect(choice).toBeDefined();
  await choice!.click();
  expect(wrapper.emitted("update:field")?.at(-1)).toEqual(["stock_qty"]);
  expect(wrapper.emitted("update:direction")?.at(-1)).toEqual(["desc"]);
});

it("keeps sort and view actions on the results summary line", async () => {
  const wrapper = mount(BrowseResultSummary, {
    props: { label: "10 种物品", metrics: [] },
    slots: { controls: "<button>排序</button><button>列表</button>" },
  });
  wrappers.push(wrapper);
  expect(
    wrapper.get(".browse-summary-controls").findAll("button"),
  ).toHaveLength(2);
  await wrapper.get(".browse-result-summary-trigger").trigger("click");
  expect(
    wrapper.get(".browse-summary-controls").findAll("button"),
  ).toHaveLength(2);
  expect(wrapper.get(".browse-result-summary-panel").exists()).toBe(true);
});

it("keeps full quantity labels and a one-quantity mobile preview with disclosure", async () => {
  const wrapper = mount(BrowseResultSummary, {
    props: {
      label: "599 种物品",
      metrics: [
        {
          key: "inbound",
          label: "入库",
          quantities: [
            { qty: 8643.5, uom: "Kg" },
            { qty: 2, uom: "Nos" },
          ],
        },
      ],
    },
    slots: { controls: "<button>分析结果</button>" },
  });
  wrappers.push(wrapper);
  const disclosure = wrapper.get(".browse-result-summary-trigger");
  expect(disclosure.attributes("aria-label")).toContain("599 种物品");
  expect(disclosure.text()).toContain("入库 8,643.5 Kg");
  expect(wrapper.get(".browse-summary-line").text()).toContain("599 种物品");
  expect(disclosure.findAll(".browse-result-summary-mobile-item")).toHaveLength(
    2,
  );
  expect(
    disclosure.find(".browse-result-summary-mobile-item").text(),
  ).toContain("入库");
  expect(
    disclosure.find(".browse-result-summary-mobile-item").text(),
  ).not.toContain("+1 单位");
  expect(
    disclosure
      .find(
        ".browse-result-summary-mobile-item + .browse-result-summary-mobile-item",
      )
      .text(),
  ).toBe("+1 单位▸");
  expect(wrapper.get(".quantity-summary").isVisible()).toBe(false);
  await disclosure.trigger("click");
  expect(disclosure.attributes("aria-expanded")).toBe("true");
  expect(wrapper.get(".quantity-summary").exists()).toBe(true);
  expect(
    wrapper.get(".browse-result-summary-panel").element.parentElement,
  ).toBe(wrapper.get(".browse-result-summary").element);
  expect(
    wrapper
      .get(".browse-summary-line")
      .element.contains(wrapper.get(".browse-summary-controls").element),
  ).toBe(true);
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
  await wrapper.get('button[aria-label^="筛选"]').trigger("click");
  const category = wrapper
    .findAllComponents(HierarchyFilter)
    .find((tree) => tree.props("title") === "物品类别")!;
  expect(category.props("modelValue")).toEqual(["food", "cloth"]);
  await category.get('input[data-facet-index="0"]').setValue(false);
  await flushPromises();
  expect(c.scope.value.categories).toEqual(["cloth"]);
  expect(c.scope.value.warehouses).toEqual(["ROOM"]);
  expect(call.mock.calls.at(-1)?.[1].query.scope.categories).toEqual(["cloth"]);
  category.vm.$emit("update:modelValue", ["rice", "cloth"]);
  await flushPromises();
  expect(c.query.value.scope.categories).toEqual(["rice", "cloth"]);
  c.appliedChips.value.find((chip) => chip.field === "categories")!.remove();
  await flushPromises();
  expect(c.query.value.scope.categories).toEqual([]);
});

it("offers new Item as the primary stock action and keeps selected actions available", async () => {
  const { wrapper, page, c, reference } = stock();
  await flushPromises();
  expect(wrapper.get(".browse-header-actions").text()).toContain("新建物品");
  expect(wrapper.find(".stock-selection-actions").exists()).toBe(false);
  expect(wrapper.find(".browse-tools-toggle").exists()).toBe(false);
  c.toggle("A");
  c.toggle("隐藏,中文物品");
  await flushPromises();
  expect(wrapper.get(".stock-selection-actions").isVisible()).toBe(true);
  await wrapper
    .get(".stock-selection-actions")
    .findAll("button")
    .find((node) => node.text().trim() === "调拨")!
    .trigger("click");
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

it("renders the Stock hierarchy rail beside, outside its result card", async () => {
  const { wrapper } = stock();
  await flushPromises();
  const rail = wrapper.get(".browse-filter-rail").element;
  const card = wrapper.get(".stock-results-card").element;
  expect(card.contains(rail)).toBe(false);
  expect(rail.parentElement).toBe(card.parentElement);
});
