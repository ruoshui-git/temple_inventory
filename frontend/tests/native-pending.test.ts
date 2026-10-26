// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import PendingPage from "../src/features/pending/PendingPage.vue";
import PreviewBrowsePages from "./support/FixtureHostBrowsePages.vue";
import { resetReviewSession } from "./support/reviewModel";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import { decodeAllocationSelection } from "../src/lib/routeSelection";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});
const row = {
  id: JSON.stringify(["ITEM,A", "DAMAGED / A,1", "BATCH-A"]),
  item_code: "ITEM,A",
  item_name: "待修物品",
  warehouse: "DAMAGED / A,1",
  batch_no: "BATCH-A",
  stock_uom: "Nos",
  damaged: 5,
};
function result(query: unknown) {
  return {
    query,
    table: "locations",
    columns: ["item_code", "warehouse", "batch_no", "damaged"],
    rows: [row],
    matched_count: 205,
    next_start: 30,
    tables: [{ id: "locations", label: "位置", count: 205 }],
    summary: [{ stock_uom: "Nos", damaged: 999 }],
    snapshot: "now",
    period: { date_from: "", date_to: "" },
  };
}
function setup(
  report = vi.fn(async (query) => result(query)),
  query = newReportQuery("inventory"),
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "site",
    operations: { Repair: true, Disposal: true },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call: vi.fn(), report, upload: vi.fn() } as never,
        reference,
      );
      return () => h(PendingPage, { initialQuery: query });
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  const page = wrapper.findComponent(PendingPage);
  return { wrapper, page, c: page.vm.controller, report, reference };
}
describe("native damaged-stock workspace", () => {
  it("uses complete unit totals and emits only the explicit native Item/location/batch allocation", async () => {
    const { c, wrapper, page, report } = setup();
    await flushPromises();
    expect(c.report.result.total).toBe(205);
    expect(c.metrics.value[0]?.quantities).toEqual([{ uom: "Nos", qty: 999 }]);
    expect(report.mock.calls[0]?.[0]).toMatchObject({
      dataset: "inventory",
      view: "locations",
      damageOnly: true,
      includeZero: false,
    });
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "修复归库")!
      .trigger("click");
    expect(page.emitted("operation")?.[0]).toEqual([
      "Repair",
      {
        item_code: "ITEM,A",
        warehouse: "DAMAGED / A,1",
        batch_no: "BATCH-A",
        qty: 5,
      },
    ]);
    expect(c.rowQuery(row)).toMatchObject({
      damageOnly: true,
      restrictAllocations: true,
      allocationKeys: [row.id],
    });
  });
  it("does not broaden malformed scopes or offer a stock action while results are stale", async () => {
    const query = newReportQuery("inventory");
    query.restrictAllocations = true;
    query.allocationKeys = [];
    const { c, report } = setup(undefined, query);
    await flushPromises();
    expect(report.mock.calls[0]?.[0]).toMatchObject({
      restrictAllocations: true,
      allocationKeys: [],
    });
    c.report.result.stale = true;
    expect(c.canAct("Repair", row)).toBe(false);
    const denied = setup(vi.fn(), newReportQuery("loans"));
    await flushPromises();
    expect(denied.c.routeError.value).toBeTruthy();
    expect(denied.report).not.toHaveBeenCalled();
  });
  it("shows loading before an empty result or apparent zero counter", async () => {
    const { wrapper } = setup(vi.fn(() => new Promise(() => {})));
    expect(wrapper.find(".skeleton-block--list").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("当前没有符合条件");
    expect(wrapper.text()).not.toContain("0 条分配");
  });
  it("keeps damaged row actions quiet and moves details and export into the row menu", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
    const { wrapper } = setup();
    await flushPromises();
    const actions = wrapper.get(".damaged-row-actions");
    const repair = actions
      .findAll("button")
      .find((button) => button.text() === "修复归库")!;
    const disposal = actions
      .findAll("button")
      .find((button) => button.text() === "报废")!;
    expect(repair.classes()).toContain("ui-button--secondary");
    expect(disposal.classes()).toContain("ui-button--ghost");
    expect(disposal.classes()).toContain("damaged-disposal-button");
    expect(
      actions.findAll("button").some((button) => button.text() === "物品详情"),
    ).toBe(false);
    expect(actions.find('[aria-label="更多损坏物品操作"]').exists()).toBe(true);
    expect(actions.findComponent({ name: "PopupMenu" }).props("sheet")).toBe(
      true,
    );
    expect(
      document.body.querySelector(".damaged-mobile-menu-action")?.textContent,
    ).toContain("修复归库");
    expect(wrapper.get(".damaged-callout").text()).toContain("条明细");
    expect(wrapper.get(".browse-summary-line").text()).toContain("条存放明细");
    const rail = wrapper.get(".browse-filter-rail").element;
    const results = wrapper.get(".damaged-results-card").element;
    expect(results.contains(rail)).toBe(false);
    expect(rail.parentElement).toBe(results.parentElement);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });
  it("keeps real gallery source locations and search state after query synchronization", async () => {
    resetReviewSession();
    const wrapper = mount(PreviewBrowsePages, {
      props: { route: "pending/actionable" },
    });
    wrappers.push(wrapper);
    await flushPromises();
    const c = wrapper.findComponent(PendingPage).vm.controller,
      table = c.report.mainTable.value!;
    expect(c.report.result.error).toBe("");
    expect(table.rows.length).toBeGreaterThan(0);
    expect(
      table.rows.every(
        (value) =>
          String(value.warehouse).startsWith("损坏待处理") &&
          Number(value.damaged) > 0,
      ),
    ).toBe(true);
    const code = String(table.rows[0]!.item_code);
    c.query.value.search = code;
    await flushPromises();
    expect(c.query.value.search).toBe(code);
    expect(c.report.result.error).toBe("");
    expect(c.metrics.value[0]?.quantities.some((value) => value.qty > 0)).toBe(
      true,
    );
  });
  it("decodes exact route allocations without splitting identifiers or accepting invalid quantities", () => {
    const value = {
      item_code: "ITEM,A",
      warehouse: "DAMAGED / A,1",
      batch_no: "BATCH/A,1",
      qty: 3,
    };
    expect(
      decodeAllocationSelection(JSON.stringify([value])).allocations,
    ).toEqual([value]);
    expect(
      decodeAllocationSelection(JSON.stringify([{ ...value, qty: -1 }])).error,
    ).toBeTruthy();
    expect(decodeAllocationSelection(["invalid"]).error).toBeTruthy();
  });
});
