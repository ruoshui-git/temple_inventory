import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, KeepAlive, nextTick, ref } from "vue";
import PreviewFilterPanel from "../src/design-preview/components/PreviewFilterPanel.vue";
import PreviewCompactFilters from "../src/design-preview/components/PreviewCompactFilters.vue";
import PreviewBrowseFilters from "../src/design-preview/components/PreviewBrowseFilters.vue";
import PreviewPeriodFilter from "../src/design-preview/components/PreviewPeriodFilter.vue";
import PreviewReports from "../src/design-preview/PreviewReports.vue";
import PreviewBrowsePages from "../src/design-preview/PreviewBrowsePages.vue";
import PreviewDashboard from "../src/design-preview/PreviewDashboard.vue";
import PreviewActivities from "../src/design-preview/PreviewActivities.vue";
import {
  emptyScope,
  type BrowseScope,
} from "../src/design-preview/browseModel";
import { activityUi } from "../src/design-preview/activityUiState";
import { activities } from "../src/design-preview/activityData";
import {
  resetReviewSession,
  reviewSession,
  createDraft,
} from "../src/design-preview/reviewModel";
import {
  namedReportViews,
  newReportQuery,
  openFullReport,
  projectReport,
  reportDefinitions,
  reportStates,
  reportWorkspace,
  type ReportDataset,
} from "../src/design-preview/reportModel";
import { reportFilterChips } from "../src/design-preview/reportFilters";

const wrappers: VueWrapper[] = [];
const body = () => new DOMWrapper(document.body);
const dialog = () => body().get('[role="dialog"]');
const button = (scope: VueWrapper | DOMWrapper<Element>, label: string) =>
  scope
    .findAll("button")
    .find((element) =>
      element.text().replace(/\s+/g, " ").trim().startsWith(label),
    )!;
const field = (scope: VueWrapper | DOMWrapper<Element>, label: string) =>
  scope
    .findAll("label")
    .find((element) => element.text().trim().startsWith(label))!;
const settle = async () => {
  await nextTick();
  await nextTick();
};
async function render(component: unknown, props = {}, slots = {}) {
  const wrapper = mount(component as never, {
    props,
    slots,
    attachTo: document.body,
  });
  wrappers.push(wrapper);
  await settle();
  return wrapper;
}
let desktop = true;
let listeners: Set<(event: { matches: boolean }) => void>;
function resize(value: boolean) {
  desktop = value;
  for (const listener of [...listeners]) listener({ matches: value });
}
beforeEach(() => {
  resetReviewSession();
  namedReportViews.splice(0);
  for (const dataset of Object.keys(reportDefinitions) as ReportDataset[])
    Object.assign(reportStates[dataset], newReportQuery(dataset));
  reportWorkspace.dataset = "inventory";
  reportWorkspace.incoming = undefined;
  Object.assign(activityUi, {
    search: "",
    status: "all",
    typeId: "",
    period: { key: "all", from: "", to: "" },
    kind: "",
    presence: "all",
    outstanding: false,
    sort: "updated",
  });
  desktop = true;
  listeners = new Set();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return desktop;
      },
      addEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => listeners.add(listener),
      removeEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => listeners.delete(listener),
    })),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bounded filter dialogs", () => {
  it("opens from a focused trigger, coordinates panels, dismisses outside and restores focus on Done/Escape", async () => {
    // Panels share one Vue app in the preview. Separate test apps restart useId(),
    // which would give both panels the same coordination owner and DOM IDs.
    const host = await render(
      defineComponent({
        components: { PreviewFilterPanel },
        template:
          '<div><PreviewFilterPanel label="位置"><input aria-label="测试输入" /></PreviewFilterPanel><PreviewFilterPanel label="类别" /></div>',
      }),
    );
    const first = host.findAllComponents(PreviewFilterPanel)[0]!;
    const second = host.findAllComponents(PreviewFilterPanel)[1]!;
    const trigger = first.get("button");
    trigger.element.focus();
    await trigger.trigger("click");
    await settle(); // Placement must become visible before the browser can accept focus.
    expect(dialog().attributes("aria-modal")).toBeUndefined();
    expect(document.activeElement).toBe(dialog().element);
    await button(second, "类别").trigger("click");
    await settle();
    expect(body().findAll('[role="dialog"]')).toHaveLength(1);
    expect(first.get("button").attributes("aria-expanded")).toBe("false");
    await dialog().trigger("keydown", { key: "Escape" });
    expect(document.activeElement).toBe(second.get("button").element);
    await trigger.trigger("click");
    await button(dialog(), "完成").trigger("click");
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await body().trigger("pointerdown");
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await trigger.trigger("click");
    const done = button(dialog(), "完成");
    done.element.focus();
    await done.trigger("keydown", { key: "Tab" });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
  });
  it("clamps first-open geometry, follows resize/scroll/content and disconnects observers/listeners", async () => {
    const observers: Array<{
      callback: () => void;
      disconnect: ReturnType<typeof vi.fn>;
      observe: ReturnType<typeof vi.fn>;
    }> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        callback: () => void;
        disconnect = vi.fn();
        observe = vi.fn();
        constructor(callback: () => void) {
          this.callback = callback;
          observers.push(this);
        }
      },
    );
    const removed = vi.spyOn(document, "removeEventListener");
    const windowRemoved = vi.spyOn(window, "removeEventListener");
    let anchorLeft = 10000;
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return {
          left: this.matches("button") ? anchorLeft : 0,
          top: 600,
          bottom: 644,
          height: this.matches("section") ? 500 : 44,
          width: 400,
          right: 10400,
          x: 0,
          y: 0,
          toJSON() {},
        };
      });
    const wrapper = await render(PreviewFilterPanel, { label: "位置" });
    await button(wrapper, "位置").trigger("click");
    const panel = dialog().element as HTMLElement;
    expect(Number.parseFloat(panel.style.left)).toBeLessThanOrEqual(
      window.innerWidth - 412,
    );
    expect(Number.parseFloat(panel.style.top)).toBeGreaterThanOrEqual(12);
    expect(panel.style.visibility).not.toBe("hidden");
    anchorLeft = 24;
    window.dispatchEvent(new Event("scroll"));
    await settle();
    expect(panel.style.left).toBe("24px");
    anchorLeft = 36;
    observers[0]!.callback();
    await settle();
    expect(panel.style.left).toBe("36px");
    anchorLeft = 48;
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(panel.style.left).toBe("48px");
    wrapper.unmount();
    wrappers.pop();
    expect(observers[0]!.disconnect).toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith(
      "preview-filter-panel-open",
      expect.any(Function),
    );
    expect(removed).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(windowRemoved).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      true,
    );
    expect(listeners.size).toBe(0);
    rect.mockRestore();
  });
  it("mobile sheet traps focus, locks scroll and returns focus without undoing immediate filters", async () => {
    desktop = false;
    const scope = ref(emptyScope());
    const wrapper = await render(
      defineComponent({
        setup: () => () =>
          h(PreviewCompactFilters, {
            modelValue: scope.value,
            "onUpdate:modelValue": (value) => (scope.value = value),
            movement: true,
            records: true,
            resultCount: scope.value.kinds.length ? 0 : 100,
          }),
      }),
    );
    const trigger = button(wrapper, "筛选");
    trigger.element.focus();
    await trigger.trigger("click");
    await settle();
    expect(document.body.style.overflow).toBe("hidden");
    expect(dialog().text()).toContain("100 项结果");
    await field(dialog(), "出库").get("input").setValue(true);
    expect(scope.value.kinds).toEqual(["Issue"]);
    expect(dialog().text()).toContain("0 项结果");
    const done = button(dialog(), "完成");
    done.element.focus();
    await done.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(button(dialog(), "关闭").element);
    await button(dialog(), "完成").trigger("click");
    expect(scope.value.kinds).toEqual(["Issue"]);
    expect(document.activeElement).toBe(trigger.element);
    expect(document.body.style.overflow).toBe("");
    await trigger.trigger("click");
    await body().get(".preview-overlay").trigger("click");
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("dismisses on breakpoint, context, inactive state and KeepAlive deactivation with selections retained", async () => {
    const visible = ref(true),
      scope = ref({ ...emptyScope(), kinds: ["Issue"] });
    const Subject = defineComponent({
      setup: () => () =>
        h(PreviewCompactFilters, {
          modelValue: scope.value,
          movement: true,
          records: true,
        }),
    });
    const host = await render(
      defineComponent({
        setup: () => () =>
          h(KeepAlive, null, {
            default: () => (visible.value ? h(Subject) : null),
          }),
      }),
    );
    await button(host, "流动类型").trigger("click");
    resize(false);
    await settle();
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await button(host, "筛选").trigger("click");
    visible.value = false;
    await settle();
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    expect(scope.value.kinds).toEqual(["Issue"]);
    const panel = await render(PreviewFilterPanel, {
      label: "上下文",
      context: "one",
    });
    await button(panel, "上下文").trigger("click");
    await panel.setProps({ context: "two" });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await button(panel, "上下文").trigger("click");
    await panel.setProps({ active: false });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("consumes nested selector/tree Escape before closing its dialog and supports long option searches", async () => {
    const scope = ref(emptyScope());
    reviewSession.stock.push(
      ...Array.from({ length: 110 }, (_, i) => ({
        ...reviewSession.stock[0]!,
        code: `LONG-${i}`,
        name: `很长的物品名称${i}`,
      })),
    );
    const wrapper = await render(
      defineComponent({
        setup: () => () =>
          h(PreviewCompactFilters, {
            modelValue: scope.value,
            "onUpdate:modelValue": (value) => (scope.value = value),
          }),
      }),
    );
    await button(wrapper, "物品").trigger("click");
    const input = dialog().get('[role="combobox"]');
    await input.setValue("很长的物品名称109");
    await input.trigger("keydown", { key: "ArrowDown" });
    await input.trigger("keydown", { key: "Enter" });
    expect(scope.value.item).toBe("LONG-109");
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await input.trigger("focus");
    await input.trigger("keydown", { key: "Escape" });
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await input.trigger("keydown", { key: "Escape" });
    await button(wrapper, "物品类别").trigger("click");
    const search = dialog().get('input[type="search"]');
    await search.setValue("不存在的类别");
    expect(dialog().text()).toContain("没有匹配的项目");
    await search.trigger("keydown", { key: "Escape" });
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await search.trigger("keydown", { key: "ArrowDown" });
    await settle();
    expect(document.activeElement?.matches('input[type="checkbox"]')).toBe(
      true,
    );
    await search.trigger("keydown", { key: "Escape" });
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("keeps multi-select open, removes only one chip, and clears scopes while retaining dates", async () => {
    const scope = ref<BrowseScope>({
      ...emptyScope(),
      period: { key: "this_month", from: "", to: "" },
    });
    const wrapper = await render(
      defineComponent({
        setup: () => () =>
          h(PreviewCompactFilters, {
            modelValue: scope.value,
            "onUpdate:modelValue": (value) => (scope.value = value),
            movement: true,
            records: true,
          }),
      }),
    );
    await button(wrapper, "流动类型").trigger("click");
    await field(dialog(), "出库").get("input").setValue(true);
    await field(dialog(), "入库").get("input").setValue(true);
    expect(scope.value.kinds).toHaveLength(2);
    expect(body().find('[role="dialog"]').exists()).toBe(true);
    await button(dialog(), "完成").trigger("click");
    await wrapper
      .get('button[aria-label="移除流动类型：出库"]')
      .trigger("click");
    expect(scope.value.kinds).toEqual(["Receive"]);
    await button(wrapper, "清空筛选").trigger("click");
    expect(scope.value.kinds).toEqual([]);
    expect(scope.value.period.key).toBe("this_month");
    await button(wrapper, "仓库 / 位置").trigger("click");
    const checkbox = dialog().get('input[type="checkbox"]');
    await checkbox.setValue(true);
    expect(scope.value.warehouses.length).toBeGreaterThan(0);
    expect(body().find('[role="dialog"]').exists()).toBe(true);
  });
  it("coordinates dates and Quick Reports while preserving draft-until-Apply dates", async () => {
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "movements",
      active: true,
    });
    await button(wrapper, "物品类别").trigger("click");
    await wrapper
      .getComponent(PreviewPeriodFilter)
      .get("button")
      .trigger("click");
    expect(body().findAll('[role="dialog"]')).toHaveLength(1);
    await dialog().get("select").setValue("custom");
    await button(dialog(), "应用").trigger("click");
    expect(dialog().text()).toContain("请填写");
    expect(reportStates.movements.scope.period.key).toBe("all");
    await dialog().get('input[aria-label="开始日期"]').setValue("2026-10-10");
    await dialog().get('input[aria-label="结束日期"]').setValue("2026-10-11");
    await button(dialog(), "取消").trigger("click");
    expect(reportStates.movements.scope.period.key).toBe("all");
    await button(wrapper, "物品").trigger("click");
    await button(wrapper, "快速报表").trigger("click");
    expect(body().findAll('[role="dialog"]')).toHaveLength(1);
    expect(dialog().text()).toContain("文件格式");
    resize(false);
    await settle();
    expect(body().find('[role="dialog"]').exists()).toBe(false);
  });
  it("retains every original control when BrowseFilters has no fields prop", async () => {
    const wrapper = await render(PreviewBrowseFilters, {
      modelValue: emptyScope(),
      movement: true,
      records: true,
    });
    for (const label of [
      "物品",
      "活动",
      "物品类别",
      "仓库 / 位置",
      "流动类型",
      "来源位置",
      "去向位置",
      "期初",
      "库存调整",
    ])
      expect(wrapper.text()).toContain(label);
  });
});

describe("report scope and presentation", () => {
  it("shows an applied undated exclusion and restores its default without changing the expiry window", async () => {
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "expiry",
    });
    const query = reportStates.expiry;
    const originalCount = projectReport(query).count;
    await button(wrapper, "更多筛选").trigger("click");
    await field(dialog(), "全部日期中包含无效期").get("input").setValue(false);
    expect(projectReport(query).count).toBeLessThan(originalCount);
    await button(dialog(), "完成").trigger("click");
    await wrapper
      .get('button[aria-label="移除全部日期中不包含无效期"]')
      .trigger("click");
    expect(query.includeUndated).toBe(true);
    expect(query.expiryWindow).toBe("period");
    expect(projectReport(query).count).toBe(originalCount);
  });
  it.each([true, false])(
    "keeps large inherited scopes concise with readable context (desktop=%s)",
    async (isDesktop) => {
      desktop = isDesktop;
      const query = newReportQuery("inventory");
      query.restrictItems = true;
      query.itemCodes = reviewSession.stock
        .slice(0, 3)
        .map((item) => item.code);
      query.restrictAllocations = true;
      query.allocationKeys = [
        "ITM-000128/斋堂 / A-01/RICE-2609",
        "ITM-000128/斋堂 / A-02/RICE-2609",
      ];
      openFullReport(query);
      const wrapper = await render(PreviewReports, {
        page: "reports",
        variant: "inventory",
      });
      await button(wrapper, "选定物品（3）").trigger("click");
      for (const code of query.itemCodes)
        expect(dialog().text()).toContain(code);
      await button(dialog(), "完成").trigger("click");
      await button(wrapper, "选定分配（2）").trigger("click");
      expect(dialog().text()).toContain("斋堂 / A-02/RICE-2609");
      await button(dialog(), "完成").trigger("click");
      await wrapper.get('button[aria-label^="移除选定物品"]').trigger("click");
      expect(reportStates.inventory.restrictItems).toBe(false);
      expect(reportStates.inventory.itemCodes).toEqual([]);
      expect(reportStates.inventory.allocationKeys).toHaveLength(2);
    },
  );
  it.each(Object.keys(reportDefinitions) as ReportDataset[])(
    "exposes applicable %s filters and preserves per-dataset state",
    async (dataset) => {
      const wrapper = await render(PreviewReports, {
        page: "reports",
        variant: dataset,
      });
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
      await button(wrapper, "更多筛选").trigger("click");
      if (["loans", "counts", "movements"].includes(dataset))
        expect(dialog().text()).toContain("单据状态");
      if (["inventory", "expiry"].includes(dataset))
        expect(dialog().text()).toContain("包含零库存");
      if (dataset === "expiry") expect(dialog().text()).toContain("包含无效期");
      if (dataset === "counts") expect(dialog().text()).toContain("核对状态");
      if (dataset === "activities")
        expect(dialog().text()).toContain("归档状态");
      reportStates[dataset].search = "保留搜索";
      await wrapper
        .get("select")
        .setValue(dataset === "inventory" ? "activities" : "inventory");
      expect(body().find('[role="dialog"]').exists()).toBe(false);
      await wrapper.get("select").setValue(dataset);
      expect(reportStates[dataset].search).toBe("保留搜索");
    },
  );
  it("retains empty inherited restrictions and removes the flag and its keys together without changing other conditions", async () => {
    const query = newReportQuery("inventory");
    Object.assign(query, {
      restrictItems: true,
      restrictAllocations: true,
      damageOnly: true,
      record: "DOCUMENT-X",
      loan: "LOAN-X",
      itemLocationKeys: ["ITM-000128/斋堂 / A-01"],
    });
    openFullReport(query);
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "inventory",
    });
    expect(projectReport(reportStates.inventory).count).toBe(0);
    expect(wrapper.text()).toContain("选定物品（0）：范围为空");
    expect(wrapper.text()).toContain("选定分配（0）：范围为空");
    await wrapper.get('button[aria-label^="移除选定物品"]').trigger("click");
    expect(reportStates.inventory.restrictItems).toBe(false);
    expect(reportStates.inventory.itemCodes).toEqual([]);
    expect(reportStates.inventory.restrictAllocations).toBe(true);
    await wrapper.get('button[aria-label^="移除选定分配"]').trigger("click");
    expect(reportStates.inventory.restrictAllocations).toBe(false);
    expect(reportStates.inventory.allocationKeys).toEqual([]);
    expect(reportStates.inventory.damageOnly).toBe(true);
    expect(reportStates.inventory.record).toBe("DOCUMENT-X");
    expect(wrapper.text()).toContain("东北珍珠米");
  });
  it("shows every inherited restriction with a field-specific reset and preserves default submitted status", async () => {
    const query = newReportQuery("activities");
    Object.assign(query, {
      view: "records",
      statuses: [0, 2],
      typeId: "AT-1",
      activityStatus: "archived",
      activityKind: "Loan",
      relatedPresence: "yes",
      outstandingOnly: true,
      loanStatus: "settled",
      loanOutcome: "damaged",
      itemCodes: ["ITM-000128"],
      allocationKeys: ["ITM-000128/斋堂 / A-01/RICE-2609"],
      restrictAllocations: true,
      countReviewed: "reviewed",
    });
    openFullReport(query);
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "activities",
    });
    for (const chip of reportFilterChips(query))
      expect(wrapper.text()).toContain(chip.label);
    await wrapper.get('button[aria-label^="移除单据状态"]').trigger("click");
    expect(reportStates.activities.statuses).toEqual([1]);
    expect(wrapper.text()).toContain("单据状态：已提交");
    expect(wrapper.find('button[aria-label^="移除单据状态"]').exists()).toBe(
      false,
    );
    expect(reportStates.activities.loanOutcome).toBe("damaged");
    await button(wrapper, "更多筛选").trigger("click");
    expect(dialog().text()).toContain("来源位置");
  });
  it("keeps mobile count complete and Clear independent from search/date/view/group/sort", async () => {
    desktop = false;
    const query = reportStates.movements;
    query.view = "lines";
    query.statuses = [0, 1, 2];
    query.search = "米";
    query.grouping = "none";
    query.sort = "desc";
    query.scope.period = { key: "this_month", from: "", to: "" };
    query.record = "missing";
    query.scope.kinds = ["Issue"];
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "movements",
    });
    await button(wrapper, "筛选").trigger("click");
    expect(dialog().text()).toContain("0 项结果");
    await button(dialog(), "清空筛选").trigger("click");
    expect(query.record).toBe("");
    expect(query.statuses).toEqual([1]);
    expect(query.scope.kinds).toEqual([]);
    expect(query.scope.period.key).toBe("this_month");
    expect(query.view).toBe("lines");
    expect(query.sort).toBe("desc");
    expect(query.search).toBe("米");
    expect(dialog().text()).toContain(`${projectReport(query).count} 项结果`);
  });
  it("supports named-view save/load/rename/delete and inline errors within the panel", async () => {
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "movements",
    });
    const open = async () => {
      await button(wrapper, "个人命名视图").trigger("click");
    };
    await open();
    await button(dialog(), "保存视图").trigger("click");
    expect(dialog().get('[role="alert"]').text()).toContain("请填写视图名称");
    await field(dialog(), "视图名称").get("input").setValue("常用");
    await button(dialog(), "保存视图").trigger("click");
    const id = String(namedReportViews[0]!.id);
    await field(dialog(), "已保存视图").get("select").setValue(id);
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await open();
    await field(dialog(), "视图名称").get("input").setValue("改名");
    await button(dialog(), "重命名").trigger("click");
    expect(namedReportViews[0]!.name).toBe("改名");
    await button(dialog(), "删除视图").trigger("click");
    expect(namedReportViews).toHaveLength(0);
  });
  it("preserves historical bounds, grouping/sorting, contribution drill and independent export selection", async () => {
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "inventory",
    });
    await wrapper.findAll("select")[1]!.setValue("historical");
    const query = reportStates.inventory;
    expect(query.scope.period.key).toBe("this_month");
    await button(wrapper, "分组").trigger("click");
    await dialog().get("select").setValue("item");
    await button(dialog(), "完成").trigger("click");
    expect(query.grouping).toBe("item");
    await button(wrapper, "排序").trigger("click");
    await field(dialog(), "排序依据").get("select").setValue("quantity");
    await dialog().findAll("select")[1]!.setValue("desc");
    expect(query.sort).toBe("desc");
    await button(dialog(), "完成").trigger("click");
    await button(wrapper, "查看 HIST-").trigger("click");
    expect(dialog().text()).toContain("贡献行");
    await button(dialog(), "关闭").trigger("click");
    await button(wrapper, "快速报表").trigger("click");
    await field(dialog(), "文件格式").get("select").setValue("csv");
    await field(dialog(), "CSV 导出表").get("select").setValue("ledger");
    expect(field(dialog(), "文件格式").get("select").element.value).toBe("csv");
    expect(dialog().text()).toContain(
      `${projectReport(query).count} 行完整结果`,
    );
  });
  it("loads results beyond the first 30 while complete counts/exports retain all rows", async () => {
    const source = reviewSession.movements[0]!;
    reviewSession.movements.push(
      ...Array.from({ length: 45 }, (_, i) => ({
        ...source,
        name: `MORE-${i}`,
        lineId: `MORE-LINE-${i}`,
      })),
    );
    reportStates.movements.view = "lines";
    const wrapper = await render(PreviewReports, {
      page: "reports",
      variant: "movements",
    });
    const table = wrapper.getComponent({ name: "PreviewReportTable" });
    expect(table.findAll("tbody tr")).toHaveLength(30);
    await button(wrapper, "加载更多").trigger("click");
    expect(table.findAll("tbody tr").length).toBeGreaterThan(30);
    await button(wrapper, "快速报表").trigger("click");
    expect(dialog().text()).toContain(
      `${projectReport(reportStates.movements).count} 行完整结果`,
    );
  });
});

describe("other compact-filter consumers", () => {
  it("Drafts applies type and hierarchy filters, counts all matches, removes chips and continues a draft", async () => {
    const draft = createDraft("Transfer", "COMPACT-DRAFT");
    draft.saved = true;
    draft.lines = [
      {
        id: "compact-line",
        code: "ITM-000128",
        qty: 1,
        uom: "袋",
        sourceLocation: "斋堂 / A-01",
        location: "斋堂 / A-02",
      },
    ];
    const wrapper = await render(PreviewBrowsePages, { route: "drafts/open" });
    await button(wrapper, "流动类型").trigger("click");
    await field(dialog(), "转移").get("input").setValue(true);
    await button(dialog(), "完成").trigger("click");
    await button(wrapper, "更多筛选").trigger("click");
    const filters = wrapper
      .findAllComponents(PreviewBrowseFilters)
      .find((component) => component.props("fields")?.includes("sources"))!;
    filters.vm.$emit("update:modelValue", {
      ...filters.props("modelValue"),
      sources: ["斋堂 / A-01"],
      destinations: ["斋堂 / A-02"],
    });
    await settle();
    await button(dialog(), "完成").trigger("click");
    const row = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes(draft.name))!;
    expect(row.exists()).toBe(true);
    await row
      .findAll("button")
      .find((element) => element.text().includes("继续"))!
      .trigger("click");
    expect(reviewSession.selectedDraftName).toBe(draft.name);
    expect(wrapper.emitted("navigate")).toBeTruthy();
    await wrapper
      .get('button[aria-label="移除流动类型：转移"]')
      .trigger("click");
    resize(false);
    await settle();
    await button(wrapper, "筛选").trigger("click");
    expect(dialog().text()).toContain(
      `${wrapper.findAll("tbody tr").length} 项结果`,
    );
  });
  it("Dashboard opening/closing does not refresh; selecting scope updates all sections and breakpoint closes the sheet", async () => {
    vi.useFakeTimers();
    const wrapper = await render(PreviewDashboard);
    await button(wrapper, "总览范围").trigger("click");
    expect(button(dialog(), "清空范围").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).not.toContain("正在更新");
    await button(dialog(), "完成").trigger("click");
    expect(wrapper.findAll('[data-section][aria-busy="true"]')).toHaveLength(0);
    await button(wrapper, "总览范围").trigger("click");
    await dialog().get('input[type="checkbox"]').setValue(true);
    expect(reviewSession.filters.dashboard.warehouses.length).toBeGreaterThan(
      0,
    );
    expect(wrapper.findAll('[data-section][aria-busy="true"]')).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(500);
    resize(false);
    await settle();
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    await button(wrapper, "总览范围").trigger("click");
    expect(dialog().attributes("aria-modal")).toBe("true");
    expect(dialog().text()).toContain("种物品");
  });
  it("Activities secondary filters/sort apply immediately, remove independently and survive detail return", async () => {
    const wrapper = await render(PreviewActivities, {
      page: "activity-list",
      variant: "active",
      active: true,
    });
    await button(wrapper, "更多筛选").trigger("click");
    await field(dialog(), "流动类型").get("select").setValue("Loan");
    await field(dialog(), "关联记录").get("select").setValue("yes");
    expect(activityUi.kind).toBe("Loan");
    await button(dialog(), "完成").trigger("click");
    await wrapper.get('button[aria-label="移除有关联记录"]').trigger("click");
    expect(activityUi.presence).toBe("all");
    expect(activityUi.kind).toBe("Loan");
    await button(wrapper, "排序").trigger("click");
    await dialog().get("select").setValue("title");
    await button(dialog(), "完成").trigger("click");
    const card = wrapper.get(".activity-card");
    await card.get("button").trigger("click");
    const selected = activityUi.selected;
    await wrapper.setProps({ page: "activity-detail", variant: selected });
    await wrapper.setProps({ page: "activity-list", variant: "active" });
    expect(activityUi.kind).toBe("Loan");
    expect(activityUi.sort).toBe("title");
    expect(wrapper.get(".activity-list").text()).toContain(
      activities.find((activity) => activity.id === selected)!.title,
    );
    await button(wrapper, "更多筛选").trigger("click");
    await button(dialog(), "清空筛选").trigger("click");
    expect(activityUi.kind).toBe("");
    expect(activityUi.sort).toBe("title");
  });
});
