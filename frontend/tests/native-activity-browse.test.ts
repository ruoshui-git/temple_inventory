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
      sortBy: "date",
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
    first.controller.recordStatus.value = "all";
    first.controller.recordSearch.value = "ITEM/A";
    first.controller.relatedLoan.value = "LOAN-A";
    await flushPromises();
    const query = first.changed.mock.lastCall![0];
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
      statuses: [0, 1, 2],
      scope: { activity: "ACT-A" },
      loan: "LOAN-A",
    });
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
