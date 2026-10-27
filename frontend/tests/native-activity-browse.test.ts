// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type ReportPage,
} from "../src/services/contracts";
import { newReportQuery } from "../src/lib/reportContract";
import { useActivitiesController } from "../src/features/activities/useActivitiesController";
import ActivitiesView from "../src/features/activities/ActivitiesView.vue";
import { createMemoryHistory, createRouter } from "vue-router";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function setup(input: {
  mode: "list" | "detail" | "form";
  name?: string;
  routeQuery?: string;
}) {
  const props = reactive(input),
    changed = vi.fn(),
    navigate = vi.fn();
  const report = vi.fn(
    async (query) =>
      ({
        query,
        scope: query.scope,
        rows: [],
        matched_count: 0,
        next_start: null,
        table: "metadata",
        columns: [],
        tables: [{ id: "metadata", label: "活动", count: 0 }],
        summary: [],
        snapshot: "2026-10-16",
        period: { key: "all", date_from: "", date_to: "" },
      }) as ReportPage,
  );
  const call = vi.fn(async () => ({
    name: props.name,
    title: "活动",
    status: "Active",
  }));
  let controller!: ReturnType<typeof useActivitiesController>;
  const child = defineComponent({
    setup() {
      controller = useActivitiesController(
        props,
        navigate,
        vi.fn(),
        vi.fn(),
        changed,
      );
      return () => h("section");
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call: call as never, report, upload: vi.fn() },
        createReferenceData(),
      );
      return () => h(child);
    },
  });
  wrappers.push(mount(root));
  return { controller, props, changed, navigate, report, call };
}
describe("native Activity browse scopes", () => {
  async function mountActivityView(
    mode: "list" | "detail",
    pendingCall?: ReturnType<typeof vi.fn>,
  ) {
    const reference = createReferenceData();
    reference.user = "Administrator";
    reference.site = "unit-site";
    reference.siteDate = "2026-10-23";
    reference.capabilities = {
      "Inventory Activity": { read: true, write: true, create: true },
    };
    reference.activityTypes = [
      { value: "TYPE-A", label: "分发", enabled: true },
    ];
    const props = reactive({ mode, name: "ACT-A" });
    const report = vi.fn(async (query) => ({
      query,
      scope: query.scope,
      rows:
        mode === "list"
          ? [
              {
                id: "ACT-A",
                title: "活动名称",
                activity_type: "TYPE-A",
                start_date: "2026-10-01",
                status: "Active",
              },
            ]
          : [],
      matched_count: 1,
      next_start: null,
      table: "metadata",
      columns: [],
      tables: [{ id: "metadata", label: "活动", count: 1 }],
      summary: [],
      snapshot: "2026-10-23",
      period: { key: "all", date_from: "", date_to: "" },
    }));
    const call =
      pendingCall ??
      vi.fn(async (method: string) =>
        method === "activities.load_activity"
          ? {
              name: "ACT-A",
              title: "活动名称",
              status: "Active",
              summary: { count_Receive: 2, count_Issue: 1 },
              movement_totals: [
                { kind: "Receive", stock_uom: "件", stock_qty: 8 },
                { kind: "Issue", stock_uom: "套", stock_qty: 2 },
              ],
              loan_totals: [{ stock_uom: "个", outstanding: 3 }],
              outstanding_line_count: 0,
            }
          : null,
      );
    let controller!: ReturnType<typeof useActivitiesController>;
    const child = defineComponent({
      setup() {
        controller = useActivitiesController(
          props as never,
          vi.fn(),
          vi.fn(),
          vi.fn(),
        );
        return () =>
          h(ActivitiesView, {
            controller,
            mode,
            name: "ACT-A",
            active: true,
          });
      },
    });
    const root = defineComponent({
      setup() {
        provideInventoryServices(
          { call: call as never, report: report as never, upload: vi.fn() },
          reference,
        );
        return () => h(child);
      },
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: { render: () => h("div") } },
        {
          path: "/activities/:name",
          name: "activity-detail",
          component: { render: () => h("div") },
        },
        {
          path: "/movements",
          name: "movements",
          component: { render: () => h("div") },
        },
        {
          path: "/loans",
          name: "loans",
          component: { render: () => h("div") },
        },
      ],
    });
    await router.push("/");
    await router.isReady();
    const wrapper = mount(root, { global: { plugins: [router] } });
    wrappers.push(wrapper);
    if (!pendingCall) await flushPromises();
    return { wrapper, controller };
  }

  it("keeps the detail heading neutral until the first activity response settles", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => (resolve = done));
    const call = vi.fn(() => pending);
    const { wrapper } = await mountActivityView("detail", call);
    expect(wrapper.get("h1").text()).toBe("正在加载活动…");
    expect(wrapper.text()).not.toContain("活动不可用");
    resolve({
      name: "ACT-A",
      title: "活动名称",
      status: "Active",
      summary: {},
      movement_totals: [],
      loan_totals: [],
      outstanding_line_count: 0,
    });
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe("活动名称");
  });

  it("renders linked overview tiles without record tabs or empty icon slots", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const { wrapper } = await mountActivityView("detail");
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(wrapper.find("#activity-records-panel").exists()).toBe(false);
    expect(wrapper.find(".activity-movement-tiles").exists()).toBe(true);
    expect(wrapper.findAll(".activity-movement-tile")).toHaveLength(3);
    expect(wrapper.text()).toContain("入库");
    expect(wrapper.text()).toContain("出库");
    expect(wrapper.text()).toContain("当前未归还");
    expect(wrapper.find(".activity-movement-tile-icon").exists()).toBe(false);
    expect(wrapper.text()).toContain("查看全部记录");
    expect(wrapper.text()).toContain("查看借用");
  });

  it("renders the activity name as a route link in the activities list", async () => {
    const { wrapper } = await mountActivityView("list");
    const link = wrapper.get('tbody a[href="/activities/ACT-A"]');
    expect(link.text()).toBe("活动名称");
    expect(wrapper.find("tbody button").exists()).toBe(false);
  });

  it.each(["{", JSON.stringify(newReportQuery("inventory"))])(
    "requires an explicit reset for invalid scope %s",
    async (routeQuery) => {
      const { controller, report, changed } = setup({
        mode: "list",
        routeQuery,
      });
      await flushPromises();
      expect(report).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(controller.scopeError.value).toBeTruthy();
      controller.resetScope();
      await flushPromises();
      expect(report).toHaveBeenCalledTimes(1);
      expect(changed.mock.lastCall?.[0].dataset).toBe("activities");
    },
  );
  it("does not load report rows in a new Activity editor", async () => {
    const { report, call } = setup({ mode: "form" });
    await flushPromises();
    expect(report).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
  });
  it("serializes list filters and restores them from a deep link", async () => {
    const first = setup({ mode: "list" });
    await flushPromises();
    Object.assign(first.controller.state, {
      search: "功课",
      status: "all",
      kind: "Loan",
      typeId: "TYPE-A",
      outstanding: true,
      sort: "start",
    });
    await flushPromises();
    const query = first.changed.mock.lastCall![0];
    expect(query).toMatchObject({
      dataset: "activities",
      search: "功课",
      activityStatus: "all",
      activityKind: "Loan",
      typeId: "TYPE-A",
      outstandingOnly: true,
      sortBy: "start_date",
    });
    const linked = setup({ mode: "list", routeQuery: JSON.stringify(query) });
    await flushPromises();
    expect(linked.controller.state).toMatchObject({
      search: "功课",
      status: "all",
      kind: "Loan",
      typeId: "TYPE-A",
      outstanding: true,
      sort: "start",
    });
    expect(linked.controller.report.value).toEqual(query);
  });
});
