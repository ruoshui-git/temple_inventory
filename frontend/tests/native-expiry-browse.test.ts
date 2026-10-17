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
import Expiry from "../src/pages/Expiry.vue";
import PreviewExpiryBrowse from "../src/design-preview/PreviewExpiryBrowse.vue";
import ExpiryBrowsePage from "../src/features/expiry/ExpiryBrowsePage.vue";
import { resetReviewSession } from "../src/design-preview/reviewModel";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
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
        stock_qty: 2,
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
) {
  let c!: ReturnType<typeof useExpiryBrowse>;
  const changed = vi.fn(),
    reference = createReferenceData();
  Object.assign(reference, { site: "unit-site", user: "volunteer" });
  const child = defineComponent({
    setup() {
      c = useExpiryBrowse(props, changed);
      return () => h("div");
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
  return { c, call, reference, props, changed };
}
describe("native expiry browser", () => {
  it("keeps repeated URL query parameters invalid at the real route boundary", async () => {
    const call = vi.fn(),
      reference = createReferenceData();
    Object.assign(reference, { user: "volunteer", site: "unit-site" });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/expiry", component: Expiry }],
    });
    await router.push({ path: "/expiry", query: { query: ["one", "two"] } });
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
    expect(call).not.toHaveBeenCalled();
  });
  it("renders the same browser with real gallery services and reactive query state", async () => {
    resetReviewSession();
    const wrapper = mount(PreviewExpiryBrowse, { props: { variant: "all" } });
    wrappers.push(wrapper);
    await flushPromises();
    const controller = wrapper.findComponent(ExpiryBrowsePage).vm.controller;
    expect(controller.result.error).toBe("");
    expect(controller.result.batchCount).toBeGreaterThan(0);
    expect(wrapper.text()).toContain("条库位分配");
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
    expect(c.query.value.restrictAllocations).toBe(false);
    expect(c.query.value.scope.period.from).toBe("2026-10-01");
    expect(c.query.value.expiryWindow).toBe("expired");
    expect(c.query.value.search).toBe("batch");
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
