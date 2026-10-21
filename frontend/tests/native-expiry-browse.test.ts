import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  useExpiryBrowse,
  type ExpiryPageData,
} from "../src/features/expiry/useExpiryBrowse";
import { newReportQuery } from "../src/lib/reportContract";
import { createRouter, createMemoryHistory, RouterView } from "vue-router";
import PreviewExpiryBrowse from "./support/FixtureHostExpiryBrowse.vue";
import ExpiryBrowsePage from "../src/features/expiry/ExpiryBrowsePage.vue";
import { routeRecords } from "../src/lib/routeRegistry";
import { resetReviewSession } from "./support/reviewModel";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});
function page(start = 0): ExpiryPageData {
  return {
    query: newReportQuery("expiry"),
    rows: [
      {
        id: JSON.stringify(["ITEM-A", "ROOM-A", `BATCH-${start}`]),
        item_code: "ITEM-A",
        item_name: "物品甲",
        stock_uom: "Nos",
        batch_no: `BATCH-${start}`,
        warehouse: "ROOM-A",
        available: 2,
        stock_qty: 11,
        expiry_date: "2026-10-16",
      },
    ],
    matched_count: 205,
    next_start: start === 0 ? 30 : null,
    item_count: 4,
    batch_count: 200,
    snapshot: "now",
    totals: [{ stock_uom: "Nos", available: 999 }],
    facets: { all: 200, expired: 100, unexpired: 99, undated: 1 },
    analysis: {
      category: {
        rows: [
          { id: "CAT-A", category: "ROOT", stock_uom: "Nos", available: 999 },
        ],
        matched_count: 100,
        next_start: 30,
      },
    },
  };
}
function setup(
  call = vi.fn(async (_endpoint, args) => page(Number(args.start || 0))),
  props = reactive<{
    initialQuery?: ReturnType<typeof newReportQuery>;
    routeQuery?: string;
  }>({}),
  view = false,
) {
  let c!: ReturnType<typeof useExpiryBrowse>;
  const changed = vi.fn(),
    reference = createReferenceData();
  Object.assign(reference, { site: "unit-site", user: "volunteer" });
  const child = defineComponent({
    setup() {
      c = useExpiryBrowse(props, changed);
      return () => (view ? h(ExpiryBrowsePage, props) : h("div"));
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => h(child);
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { c, call, reference, props, changed, wrapper };
}
describe("native expiry browser", () => {
  it("keeps repeated URL query parameters invalid at the real route boundary", async () => {
    const call = vi.fn(),
      reference = createReferenceData();
    Object.assign(reference, { user: "volunteer", site: "unit-site" });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: routeRecords,
    });
    await router.push({
      path: "/stock/expiry",
      query: { query: ["one", "two"] },
    });
    const root = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(RouterView);
      },
    });
    const wrapper = mount(root, { global: { plugins: [router] } });
    wrappers.push(wrapper);
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(
      call.mock.calls.some(([endpoint]) => String(endpoint).startsWith("browse.")),
    ).toBe(false);
  });
  it("renders the same browser with real gallery services and reactive query state", async () => {
    resetReviewSession();
    const wrapper = mount(PreviewExpiryBrowse, { props: { variant: "all" } });
    wrappers.push(wrapper);
    await flushPromises();
    const controller = wrapper.findComponent(ExpiryBrowsePage).vm.controller;
    expect(controller.result.error).toBe("");
    expect(controller.result.batchCount).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("条存放明细");
    controller.query.value.search = "RICE";
    await flushPromises();
    expect(controller.result.error).toBe("");
  });
  it("keeps complete distinct facets and UOM totals independent of downloaded allocations and analysis", async () => {
    const call = vi.fn(async (endpoint, args) =>
      endpoint === "browse.expiry_analysis"
        ? {
            rows: [{ id: "CAT-B", category: "SECOND" }],
            matched_count: 100,
            next_start: null,
          }
        : page(Number(args.start || 0)),
    );
    const { c } = setup(call);
    await flushPromises();
    expect(c.result.rows).toHaveLength(1);
    expect(c.result.total).toBe(205);
    expect(c.result.batchCount).toBe(200);
    expect(c.result.facets.unexpired).toBe(99);
    expect(c.metrics.value[0]?.quantities).toEqual([{ uom: "Nos", qty: 999 }]);
    await c.moreAnalysis();
    expect(c.analysis.value?.rows).toHaveLength(2);
    expect(c.analysis.value?.matched_count).toBe(100);
    await c.load(true);
    expect(c.result.rows).toHaveLength(2);
    expect(c.result.batchCount).toBe(200);
  });
  it("sorts Item and Batch identities independently and shows warehouse stock once", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const { wrapper } = setup(undefined, reactive({}), true);
    await flushPromises();
    const quantityHeader = wrapper
      .findAll("th")
      .find((header) => header.text().includes("库存数量"))!
      .find("button");
    expect(quantityHeader.text()).toContain("库存数量");
    const headers = wrapper.findAll("thead th").map((header) => header.text());
    const quantityIndex = headers.findIndex((header) =>
      header.includes("库存数量"),
    );
    const quantityCell = wrapper.find(
      `tbody tr td:nth-child(${quantityIndex + 1})`,
    );
    expect(quantityCell.text()).toContain("11");
    expect(quantityCell.text()).not.toContain("2");
    const unitIndex = headers.findIndex((header) =>
      header.includes("库存单位"),
    );
    expect(
      wrapper.find(`tbody tr td:nth-child(${unitIndex + 1})`).text(),
    ).toContain("Nos");
    await quantityHeader.trigger("click");
    expect(wrapper.find('th[aria-sort="ascending"] button').text()).toContain(
      "库存数量 ↑",
    );
    expect(
      wrapper.findComponent(ExpiryBrowsePage).vm.controller.query.value.sortBy,
    ).toBe("stock_qty");
    await wrapper
      .findAll("th button")
      .find((button) => button.text().includes("物品名称"))!
      .trigger("click");
    expect(
      wrapper.findComponent(ExpiryBrowsePage).vm.controller.query.value.sortBy,
    ).toBe("item_name");
    await wrapper
      .findAll("th button")
      .find((button) => button.text().includes("批次编号"))!
      .trigger("click");
    expect(
      wrapper.findComponent(ExpiryBrowsePage).vm.controller.query.value.sortBy,
    ).toBe("batch_no");
  });
  it("does not present confirmed zero summaries while the first result is pending", async () => {
    let resolve!: (value: ExpiryPageData) => void;
    const call = vi.fn(
      () => new Promise<ExpiryPageData>((done) => (resolve = done)),
    );
    const { wrapper } = setup(call, reactive({}), true);
    expect(wrapper.find(".quantity-summary-empty").exists()).toBe(false);
    resolve(page());
    await flushPromises();
    expect(wrapper.find(".quantity-summary-empty").exists()).toBe(false);
  });
  it("retries a failed appended page at the same native offset", async () => {
    let fail = true;
    const call = vi.fn(async (_endpoint, args) => {
      if (args.start && fail) throw new Error("下一页失败");
      return page(Number(args.start || 0));
    });
    const { c } = setup(call);
    await flushPromises();
    await c.load(true);
    expect(c.result.rows).toHaveLength(1);
    expect(c.result.error).toBe("下一页失败");
    expect(c.result.next).toBe(30);
    fail = false;
    await c.retry();
    expect(call.mock.calls.at(-1)?.[1].start).toBe(30);
    expect(c.result.rows).toHaveLength(2);
  });
  it("retains exact inherited batch restrictions for export and clears secondary filters independently of dates/window/search", async () => {
    const query = newReportQuery("expiry");
    query.restrictAllocations = true;
    query.allocationKeys = [];
    query.itemLocationKeys = [JSON.stringify(["ITEM-A", "ROOM-A"])];
    query.loan = "LOAN-EXACT";
    query.record = "RECORD-EXACT";
    query.recordDoctype = "Stock Entry";
    query.expiryWindow = "expired";
    query.search = "batch";
    query.scope.period = {
      key: "custom",
      from: "2026-10-01",
      to: "2026-10-16",
    };
    query.scope.warehouses = ["ROOM-A"];
    const { c } = setup(undefined, reactive({ initialQuery: query }));
    await flushPromises();
    expect(c.query.value.restrictAllocations).toBe(true);
    expect(c.query.value.allocationKeys).toEqual([]);
    const row = c.result.rows[0]!,
      exact = c.batchQuery(row);
    expect(exact.allocationKeys).toEqual([row.id]);
    expect(exact.scope.period.from).toBe("2026-10-01");
    c.clearSecondary();
    expect(c.query.value.scope.warehouses).toEqual([]);
    expect(c.query.value.restrictAllocations).toBe(true);
    expect(c.query.value.scope.period.from).toBe("");
    expect(c.query.value.expiryWindow).toBe("period");
    expect(c.query.value.search).toBe("batch");
    expect(c.batchQuery(row)).toMatchObject({
      itemLocationKeys: [JSON.stringify(["ITEM-A", "ROOM-A"])],
      loan: "LOAN-EXACT",
      record: "RECORD-EXACT",
      recordDoctype: "Stock Entry",
    });
  });
  it("does not request an unrestricted fallback for malformed or wrong-family route data", async () => {
    const call = vi.fn(),
      props = reactive({ routeQuery: '{ "scope": { "warehouses": [3] } }' });
    const { c } = setup(call, props);
    await flushPromises();
    expect(c.routeError.value).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
    props.routeQuery = JSON.stringify(newReportQuery("inventory"));
    await flushPromises();
    expect(c.routeError.value).toContain("效期");
    expect(call).not.toHaveBeenCalled();
  });
  it("discards old account responses and clears cached Item information", async () => {
    let resolve!: (value: ExpiryPageData) => void;
    const { c, reference } = setup(
      vi.fn(() => new Promise<ExpiryPageData>((done) => (resolve = done))),
    );
    reference.user = "other";
    await flushPromises();
    resolve(page());
    await flushPromises();
    expect(c.result.rows).toEqual([]);
    expect(c.result.error).toContain("账户");
  });
});
