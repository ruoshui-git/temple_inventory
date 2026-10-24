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
              summary: {},
              movement_totals: [],
              loan_totals: [],
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

  it("debounces activity detail search, edits and removes kind chips, and exposes tab roles", async () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const { wrapper, controller } = await mountActivityView("detail");
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2);
    // Compact toolbars hide their expanded tools, so results must sit outside them.
    expect(wrapper.find(".browse-inline-tools table").exists()).toBe(false);
    expect(wrapper.find('[role="tab"].ui-button').exists()).toBe(false);
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toContain(
      "关联记录",
    );
    expect(
      wrapper
        .findAll(".browse-active-chip")
        .some((chip) => chip.text().includes("活动：")),
    ).toBe(false);
    expect(
      document.querySelector('[data-filter-field="activity"]'),
    ).toBeFalsy();
    expect(controller.report.value.scope.activity).toBe("ACT-A");
    controller.setRecordKinds(["Issue"]);
    await flushPromises();
    const kindChip = wrapper
      .findAll(".browse-active-chip")
      .find((chip) => chip.text().includes("流动类型"));
    expect(kindChip?.text()).toContain("出库");
    await kindChip!.get(".browse-active-chip-label").trigger("click");
    await flushPromises();
    expect(
      document.querySelector('details[data-filter-field="kinds"][open]'),
    ).toBeTruthy();
    await kindChip!.get(".browse-active-chip-remove").trigger("click");
    await flushPromises();
    expect(controller.recordKinds.value).toEqual([]);
    const search = wrapper.get<HTMLInputElement>(
      "#activity-records-panel input[data-browse-search]",
    );
    await search.setValue("配方奶粉");
    expect(controller.recordSearch.value).toBe("");
    await new Promise((resolve) => setTimeout(resolve, 240));
    await flushPromises();
    expect(controller.recordSearch.value).toBe("配方奶粉");
    await wrapper.get('[role="tab"]:nth-child(2)').trigger("click");
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toContain(
      "借用结余",
    );
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
  it("carries the complete native detail tab and original-loan constraint in the URL", async () => {
    const first = setup({ mode: "detail", name: "ACT-A" });
    await flushPromises();
    first.controller.tab.value = "loans";
    first.controller.recordSearch.value = "ITEM/A";
    first.controller.relatedLoan.value = "LOAN-A";
    await flushPromises();
    const query = { ...first.changed.mock.lastCall![0], statuses: [0, 1, 2] };
    const linked = setup({
      mode: "detail",
      name: "ACT-A",
      routeQuery: JSON.stringify(query),
    });
    await flushPromises();
    expect(linked.controller.tab.value).toBe("loans");
    expect(linked.controller.recordSearch.value).toBe("ITEM/A");
    expect(linked.controller.relatedLoan.value).toBe("LOAN-A");
    expect(linked.controller.report.value).toMatchObject({
      view: "loans",
      statuses: [1],
      scope: { activity: "ACT-A" },
      loan: "LOAN-A",
    });
  });
  it("maps activity detail kind filters to the scope kinds array and table sort to the query", async () => {
    const { controller, changed } = setup({ mode: "detail", name: "ACT-A" });
    await flushPromises();
    controller.setRecordKinds(["Issue", "Transfer"]);
    controller.setRecordSort("document");
    await flushPromises();
    expect(changed.mock.lastCall?.[0]).toMatchObject({
      scope: { activity: "ACT-A", kinds: ["Issue", "Transfer"] },
      sortBy: "identity",
    });
    controller.setRecordKinds([]);
    await flushPromises();
    expect(changed.mock.lastCall?.[0].scope.kinds).toEqual([]);
  });
  it("opens lifetime kind counts with submitted records and no prior related search or dates", async () => {
    const { controller, navigate } = setup({ mode: "list" });
    await flushPromises();
    controller.chip("ACT-A", "Loan");
    expect(navigate).toHaveBeenCalledWith(
      "detail",
      "ACT-A",
      expect.objectContaining({
        view: "records",
        statuses: [1],
        relatedSearch: "",
        relatedPeriod: { key: "all", from: "", to: "" },
        scope: expect.objectContaining({ activity: "ACT-A", kinds: ["Loan"] }),
      }),
    );
  });
});
