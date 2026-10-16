import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  activities,
  activityTypes,
  activityOptions,
  activityLabel,
} from "../src/design-preview/activityData";
import {
  saveActivity,
  activityPermissions,
  activityDeleteError,
  activityMovementCounts,
  relatedActivityRecords,
  setActivityArchived,
  deleteActivity,
  deleteActivityType,
} from "../src/design-preview/activityModel";
import {
  resetReviewSession,
  reviewSession,
  reviewMovementRows,
  createDraft,
} from "../src/design-preview/reviewModel";
import {
  newReportQuery,
  projectReport,
  reportDefinitions,
  saveReportView,
  renameReportView,
  namedReportViews,
  historicalBalances,
  reportStates,
} from "../src/design-preview/reportModel";
import PreviewActivityEditor from "../src/design-preview/components/PreviewActivityEditor.vue";
import PreviewTransactionContext from "../src/design-preview/components/PreviewTransactionContext.vue";
import PreviewSearchSelect from "../src/design-preview/components/PreviewSearchSelect.vue";
import PreviewDocumentDisplay from "../src/design-preview/components/PreviewDocumentDisplay.vue";
import PreviewQuickReport from "../src/design-preview/components/PreviewQuickReport.vue";
import PreviewReports from "../src/design-preview/PreviewReports.vue";
import PreviewReceive from "../src/design-preview/PreviewReceive.vue";
const initialActivities = JSON.stringify(activities),
  initialTypes = JSON.stringify(activityTypes);
const wrappers: VueWrapper[] = [];
function render(component: unknown, props: Record<string, unknown>) {
  const wrapper = mount(component as never, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll("button").find((row) => row.text() === text)!;
}
beforeEach(() => {
  resetReviewSession();
  activities.splice(0, activities.length, ...JSON.parse(initialActivities));
  activityTypes.splice(0, activityTypes.length, ...JSON.parse(initialTypes));
  Object.assign(activityPermissions, {
    write: true,
    delete: true,
    hiddenReferences: [],
  });
  namedReportViews.splice(0);
  for (const dataset of Object.keys(reportDefinitions))
    Object.assign(
      reportStates[dataset as keyof typeof reportStates],
      newReportQuery(dataset as keyof typeof reportStates),
    );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});
const input = () => ({
  title: "新活动",
  typeId: "AT-1",
  start: "2026-10-01",
  end: "2026-10-15",
  description: "简短说明",
  notes: "第一段\n第二行\n\n<b>纯文本</b>",
});
describe("stable activity metadata and lifecycle", () => {
  it("uses approved ordered data-driven types and accepts an additional type", () => {
    expect(activityTypes.map((row) => row.label)).toEqual([
      "捐赠",
      "购买",
      "分发",
      "节目",
      "投入使用",
      "其它",
    ]);
    activityTypes.push({
      id: "AT-NEW",
      label: "新增类型",
      order: 9,
      enabled: true,
    });
    expect(
      saveActivity({ ...input(), typeId: "AT-NEW" }).activity?.typeId,
    ).toBe("AT-NEW");
  });
  it("keeps submitted references after title changes and round trips notes without interpreting markup", () => {
    const original = activities[0]!;
    const linked = reviewSession.loans.find(
      (row) => row.activity === original.id,
    )!;
    expect(linked).toBeDefined();
    const result = saveActivity(
      { ...input(), title: "修改名称" },
      original.id,
      original.version,
    );
    expect(result.activity?.id).toBe(original.id);
    expect(linked.activity).toBe(original.id);
    expect(activityLabel(linked.activity)).toBe("修改名称");
    const wrapper = render(PreviewActivityEditor, { activityId: original.id });
    expect(wrapper.get("textarea").element.value).toBe(input().notes);
    const query = newReportQuery("activities");
    query.scope.activity = original.id;
    expect(projectReport(query).rows[0]?.notes).toBe(input().notes);
  });
  it("validates duplicate titles and end dates", () => {
    expect(
      saveActivity({ ...input(), title: activities[0]!.title }).error,
    ).toContain("已存在");
    expect(saveActivity({ ...input(), end: "2026-09-30" }).error).toContain(
      "早于",
    );
  });
  it("retains retired types for existing activities while rejecting new assignments", () => {
    const original = activities[0]!;
    activityTypes[0]!.enabled = false;
    expect(
      saveActivity(
        { ...input(), typeId: original.typeId },
        original.id,
        original.version,
      ).error,
    ).toBeUndefined();
    expect(saveActivity({ ...input(), title: "另一活动" }).error).toContain(
      "启用",
    );
    expect(deleteActivityType(original.typeId)).toContain("引用");
  });
  it("archives without dates driving lifecycle, allows existing links, restores, and blocks hidden references", () => {
    const created = saveActivity(input()).activity!;
    expect(created.status).toBe("active");
    setActivityArchived(created.id, true);
    expect(activityOptions().some((row) => row.value === created.id)).toBe(
      false,
    );
    expect(
      activityOptions(created.id).some((row) => row.value === created.id),
    ).toBe(true);
    setActivityArchived(created.id, false);
    activityPermissions.hiddenReferences = [created.id];
    expect(deleteActivity(created.id)).toContain("关联记录");
    activityPermissions.hiddenReferences = [];
    expect(deleteActivity(created.id)).toBe("");
    expect(activities.some((row) => row.id === created.id)).toBe(false);
  });
  it("guards drafts and cancelled references and rejects stale or forbidden writes", () => {
    const created = saveActivity(input()).activity!;
    const draft = createDraft("Issue", "ACTIVITY-DELETE-BLOCK");
    draft.activity = created.id;
    draft.status = "cancelled";
    expect(activityDeleteError(created.id)).toContain("关联记录");
    expect(
      saveActivity(input(), created.id, created.version - 1).error,
    ).toContain("更改");
    activityPermissions.write = false;
    expect(saveActivity(input(), created.id, created.version).error).toContain(
      "权限",
    );
  });
  it("counts submitted direct documents once and labels indirect settlements once", () => {
    const loan = reviewSession.loans.find(
      (row) => row.activity === "ACT-0001",
    )!;
    const source = reviewMovementRows().find((row) => row.name === loan.name)!;
    reviewSession.movements.push(
      { ...source, lineId: "DUP-LINE", name: "DIRECT", activity: "ACT-0001" },
      { ...source, lineId: "DUP-LINE", name: "DIRECT", activity: "ACT-0001" },
    );
    reviewSession.movements.push({
      ...source,
      name: "SETTLEMENT",
      lineId: "settlement-line",
      kind: "Return",
      activity: "",
      loanName: loan.name,
    });
    const records = relatedActivityRecords("ACT-0001");
    expect(records.filter((row) => row.name === "SETTLEMENT")).toHaveLength(1);
    expect(records.find((row) => row.name === "SETTLEMENT")?.relationship).toBe(
      "经原借用关联",
    );
    expect(
      activityMovementCounts("ACT-0001").find((row) => row.kind === "Loan")
        ?.count,
    ).toBeGreaterThanOrEqual(1);
    expect(
      activityMovementCounts("ACT-0001").some(
        (row) => row.kind === "Return" && row.count > 1,
      ),
    ).toBe(false);
  });
  it("preserves movement buffers and restores focus after contextual creation", async () => {
    const draft = createDraft("Receive", "CONTEXT-ACTIVITY");
    draft.note = "保留备注";
    const wrapper = render(PreviewTransactionContext, { draft });
    await button(wrapper, "新建活动").trigger("click");
    await wrapper
      .get(".preview-supporting-editor input")
      .setValue("创建并使用");
    const type = wrapper
      .findAllComponents(PreviewSearchSelect)
      .find((row) => row.props("label") === "类型 *")!;
    await type.get("input").setValue("购买");
    await type.get("[role=option]").trigger("click");
    await wrapper.get("textarea").setValue(input().notes);
    await button(wrapper, "创建并使用活动").trigger("click");
    await nextTick();
    expect(draft.note).toBe("保留备注");
    expect(activityLabel(draft.activity)).toBe("创建并使用");
    expect(document.activeElement?.textContent).toBe("新建活动");
  });
  it("renders completed context and allocations as selectable information", () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    draft.status = "completed";
    draft.note = input().notes;
    const wrapper = render(PreviewDocumentDisplay, { draft });
    expect(wrapper.findAll("input,select,textarea")).toHaveLength(0);
    expect(wrapper.find("b").exists()).toBe(false);
    expect(wrapper.text()).toContain("<b>纯文本</b>");
    expect(wrapper.text()).not.toContain("负责人");
  });
  it("canonical Receive shares create-and-use source context", async () => {
    const wrapper = render(PreviewReceive, {
      pattern: "current",
      active: true,
    });
    const context = wrapper.getComponent(PreviewTransactionContext);
    const draft = context.props("draft");
    draft.source = "来源缓冲";
    draft.activity = "ACT-0002";
    await nextTick();
    expect(
      wrapper.getComponent(PreviewTransactionContext).props("draft").source,
    ).toBe("来源缓冲");
    expect(
      wrapper.getComponent(PreviewTransactionContext).props("draft").activity,
    ).toBe("ACT-0002");
  });
});
describe("shared report projections", () => {
  it("projects every supported dataset/view without mutating stock", () => {
    const before = JSON.stringify(reviewSession.stock);
    for (const [dataset, definition] of Object.entries(reportDefinitions)) {
      for (const view of definition.views) {
        const query = newReportQuery(dataset as keyof typeof reportDefinitions);
        query.view = view.id;
        if (view.id === "historical")
          query.scope.period = { key: "this_month", from: "", to: "" };
        const projection = projectReport(query);
        expect(projection.error).toBe("");
        expect(projection.tables[0]?.rows).toEqual(projection.rows);
        expect(projection.count).toBe(projection.rows.length);
      }
    }
    expect(JSON.stringify(reviewSession.stock)).toBe(before);
  });
  it("filters full allocation scope before movement aggregation and keeps statuses and units separate", () => {
    const query = newReportQuery("movements");
    query.search = "珍珠米";
    query.statuses = [0, 1, 2];
    const result = projectReport(query);
    const details = result.tables.find((table) => table.id === "lines")!.rows;
    expect(details.length).toBeGreaterThan(0);
    expect(details.every((row) => String(row.item).includes("珍珠米"))).toBe(
      true,
    );
    expect(
      result.rows.reduce((sum, row) => sum + Number(row.stockQty), 0),
    ).toBe(details.reduce((sum, row) => sum + Number(row.stockQty), 0));
    expect(
      details.every(
        (row) =>
          row.lineId &&
          row.status &&
          typeof row.postingTime === "string" &&
          typeof row.conversionFactor === "number",
      ),
    ).toBe(true);
  });
  it("uses inclusive dates and validates incomplete custom periods", () => {
    const query = newReportQuery("movements");
    query.view = "lines";
    query.scope.period = {
      key: "custom",
      from: "2026-10-11",
      to: "2026-10-11",
    };
    expect(
      projectReport(query).rows.every(
        (row) => row.postingDate === "2026-10-11",
      ),
    ).toBe(true);
    query.scope.period.to = "";
    expect(projectReport(query).error).toContain("完整日期");
  });
  it("reconciles authoritative history including transfer branches, adjustment and reversal", () => {
    const query = newReportQuery("inventory");
    query.view = "historical";
    query.scope.period = {
      key: "custom",
      from: "2026-10-01",
      to: "2026-10-11",
    };
    const history = historicalBalances(query);
    expect(
      history.rows.reduce((sum, row) => sum + Number(row.opening), 0),
    ).toBe(120);
    expect(
      history.rows.reduce((sum, row) => sum + Number(row.closing), 0),
    ).toBe(147);
    expect(
      history.events.filter((row) => row.documentId === "HIST-TRANSFER"),
    ).toHaveLength(2);
    expect(
      history.rows.reduce((sum, row) => sum + Number(row.adjustment), 0),
    ).toBe(-3);
    query.scope.warehouses = ["斋堂 / A-01"];
    expect(historicalBalances(query).rows[0]?.closing).toBe(117);
    query.scope.period = { key: "all", from: "", to: "" };
    expect(historicalBalances(query).error).toContain("开始和结束");
  });
  it("reconciles batch allocations to item breakdown and includes zero-stock catalog items", () => {
    const query = newReportQuery("inventory");
    query.includeZero = true;
    const summary = projectReport(query);
    query.view = "locations";
    const detail = projectReport(query);
    for (const row of summary.rows) {
      const matches = detail.rows.filter((line) => line.itemId === row.itemId);
      for (const field of ["available", "loaned", "damaged", "total"])
        expect(
          matches.reduce((sum, line) => sum + Number(line[field]), 0),
        ).toBe(row[field]);
    }
    expect(summary.count).toBe(reviewSession.stock.length);
  });
  it("searches activity notes, exports identifiers and preserves undated activity all-dates scope", () => {
    const query = newReportQuery("activities");
    query.search = "纯文本";
    expect(projectReport(query).rows[0]?.activityId).toBe("ACT-0001");
    query.search = "";
    expect(projectReport(query).rows.some((row) => row.start === "")).toBe(
      true,
    );
    query.scope.period = { key: "this_month", from: "", to: "" };
    expect(projectReport(query).rows.some((row) => row.start === "")).toBe(
      false,
    );
  });
  it("keeps blank counts unreviewed and deliberate zero numeric", () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Reconcile")!;
    draft.lines = [
      {
        id: "a",
        code: "ITM-000128",
        qty: 10,
        uom: "袋",
        location: "斋堂 / A-01",
      },
      {
        id: "b",
        code: "ITM-000128",
        qty: 5,
        uom: "袋",
        location: "斋堂 / A-01",
        countedQty: 0,
      },
    ];
    const query = newReportQuery("counts");
    query.view = "lines";
    query.statuses = [0];
    const rows = projectReport(query).rows;
    expect(rows.find((row) => row.lineId === "a")).toMatchObject({
      actual: "",
      variance: "",
      reviewed: false,
    });
    expect(rows.find((row) => row.lineId === "b")).toMatchObject({
      actual: 0,
      variance: -5,
      reviewed: true,
    });
  });
  it("retains relative named presets, fixed custom dates and dataset filters with rename/delete", () => {
    const query = newReportQuery("movements");
    query.scope.period = { key: "last_7_days", from: "", to: "" };
    expect(saveReportView("最近", query)).toBe("");
    query.scope.period.key = "custom";
    query.scope.period.from = "2026-10-01";
    expect(namedReportViews[0]!.query.scope.period.key).toBe("last_7_days");
    expect(renameReportView(namedReportViews[0]!.id, "改名")).toBe("");
    expect(namedReportViews[0]!.name).toBe("改名");
  });
  it("defaults quick reports to XLSX and retains content/format on opt-in failure and retry", async () => {
    const query = newReportQuery("movements");
    const wrapper = render(PreviewQuickReport, { query });
    await button(wrapper, "快速导出").trigger("click");
    await nextTick();
    let dialog = mount({ template: "<div />" });
    dialog.unmount();
    const selects = [
      ...document.querySelectorAll<HTMLSelectElement>("[role=dialog] select"),
    ];
    expect(selects[0]!.value).toBe("xlsx");
    selects[1]!.value = "lines";
    selects[1]!.dispatchEvent(new Event("change"));
    const failure = document.querySelector<HTMLInputElement>(
      "[role=dialog] details input",
    )!;
    failure.click();
    [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
      .find((row) => row.textContent === "模拟生成")!
      .click();
    await nextTick();
    expect(document.querySelector("[role=dialog]")?.textContent).toContain(
      "选择已保留",
    );
    expect(selects[0]!.value).toBe("xlsx");
    expect(selects[1]!.value).toBe("lines");
    [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")]
      .find((row) => row.textContent === "重试生成")!
      .click();
    await nextTick();
    expect(wrapper.emitted("notify")?.[0]?.[0]).toContain("XLSX");
  });
  it("keeps dataset state while switching Reports datasets", async () => {
    const wrapper = render(PreviewReports, {
      page: "reports",
      variant: "movements",
    });
    reportStates.movements.search = "米";
    const select = wrapper
      .findAll("select")
      .find((row) => row.text().includes("效期 / 批次"))!;
    await select.setValue("activities");
    await select.setValue("movements");
    expect(reportStates.movements.search).toBe("米");
  });
});

describe("complete contextual scope regressions", () => {
  it("keeps an empty Inventory or pending scope empty", () => {
    const query = newReportQuery("inventory");
    query.restrictItems = true;
    query.itemCodes = [];
    expect(projectReport(query).count).toBe(0);
    query.damageOnly = true;
    expect(projectReport(query).count).toBe(0);
  });
  it("groups categories without inventing item IDs and uses relevant fixed columns", () => {
    const query = newReportQuery("inventory");
    query.grouping = "category";
    const result = projectReport(query);
    expect(result.rows.every((row) => !("itemId" in row))).toBe(true);
    expect(result.tables[0]!.columns).toEqual([
      "group",
      "groupLabel",
      "stockUom",
      "available",
      "loaned",
      "damaged",
      "total",
    ]);
  });
  it("preserves activity related-record period, status, type and search in reports", () => {
    const query = newReportQuery("activities");
    query.scope.activity = "ACT-0001";
    query.view = "records";
    query.relatedPeriod = {
      key: "custom",
      from: "2026-10-10",
      to: "2026-10-10",
    };
    query.scope.kinds = ["Loan"];
    query.relatedSearch = "义工";
    query.statuses = [1];
    const result = projectReport(query);
    expect(result.count).toBeGreaterThan(0);
    expect(
      result.rows.every(
        (row) => row.postingDate === "2026-10-10" && row.kind === "Loan",
      ),
    ).toBe(true);
    expect(result.scope).toContain("关联单据：2026-10-10 至 2026-10-10");
  });
  it("includes incomplete loan drafts and retains submitted line IDs across new records", () => {
    const query = newReportQuery("loans");
    query.statuses = [0];
    expect(
      projectReport(query).rows.some(
        (row) => row.documentId === "MAT-STE-2026-00001",
      ),
    ).toBe(true);
    const before = reviewMovementRows()
      .filter((row) => row.docstatus === 1)
      .map((row) => row.lineId);
    reviewSession.movements.unshift({
      ...reviewSession.movements[0]!,
      name: "ADDED-LATER",
      lineId: "ADDED-LINE",
    });
    expect(
      reviewMovementRows()
        .filter((row) => row.docstatus === 1 && row.name !== "ADDED-LATER")
        .map((row) => row.lineId),
    ).toEqual(before);
  });
});

it("keeps expiry windows independent and excludes fictitious loaned batch rows", () => {
  const query = newReportQuery("expiry");
  query.expiryWindow = "undated";
  query.scope.period = { key: "custom", from: "2026-10-01", to: "2026-10-02" };
  const result = projectReport(query);
  expect(result.rows.some((row) => row.batchId === "TEXTILE-2610")).toBe(true);
  expect(result.rows.every((row) => row.batchId && row.expiry === "")).toBe(
    true,
  );
  query.expiryWindow = "next_30";
  expect(
    projectReport(query).rows.every(
      (row) =>
        Number(row.remainingDays) >= 0 && Number(row.remainingDays) <= 30,
    ),
  ).toBe(true);
});
it("separates mixed-unit loan records and keeps matching settlement scope", () => {
  const loan = reviewSession.loans[0]!;
  loan.lines.push({
    ...loan.lines[0]!,
    code: "ITM-000129",
    qty: 2,
    returned: 0,
    damaged: 0,
    lost: 0,
  });
  const query = newReportQuery("loans");
  query.loan = loan.name;
  const result = projectReport(query);
  expect(new Set(result.rows.map((row) => row.stockUom)).size).toBe(2);
  expect(result.rows.every((row) => typeof row.borrowed === "number")).toBe(
    true,
  );
  expect(
    result.tables.find((table) => table.id === "balances")!.rows,
  ).toHaveLength(2);
});

it("groups historical warehouse branches by item without losing transfer reconciliation", () => {
  const query = newReportQuery("inventory");
  query.view = "historical";
  query.scope.period = { key: "this_month", from: "", to: "" };
  query.grouping = "item";
  const result = projectReport(query);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    opening: 120,
    incoming: 40,
    outgoing: 10,
    adjustment: -3,
    closing: 147,
  });
  expect(result.tables[0]!.columns).toContain("closing");
});

it("resolves immutable activity IDs in detail and edit navigation", async () => {
  const { getPreviewPage, pageHash, pageFromHash } =
    await import("../src/design-preview/reviewModel");
  expect(getPreviewPage("activity-detail/ACT-0002")).toMatchObject({
    page: "activity-detail",
    variant: "ACT-0002",
    path: "/activities/ACT-0002",
  });
  expect(getPreviewPage("activity-form/edit-ACT-0002")).toMatchObject({
    page: "activity-form",
    variant: "edit-ACT-0002",
    path: "/activities/ACT-0002/edit",
  });
  expect(pageFromHash(pageHash("activity-detail/ACT-0002"))?.key).toBe(
    "activity-detail/ACT-0002",
  );
});

it("keeps pending exports at the selected item/location grain", () => {
  const rice = reviewSession.stock.find((item) => item.code === "ITM-000128")!;
  rice.locations[1]!.damaged = 4;
  rice.locations[1]!.batches![0]!.damaged = 4;
  const query = newReportQuery("inventory");
  query.damageOnly = true;
  query.restrictItems = true;
  query.itemCodes = [rice.code];
  query.itemLocationKeys = [`${rice.code}/${rice.locations[0]!.location}`];
  const result = projectReport(query);
  expect(result.rows[0]?.damaged).toBe(2);
  expect(
    result.tables
      .find((table) => table.id === "allocations")!
      .rows.every((row) => row.locationId === rice.locations[0]!.location),
  ).toBe(true);
});

it("applies Dashboard item/warehouse scope to Activities through explicit references", () => {
  const unlinked = saveActivity({
    ...input(),
    title: "无关联范围样本",
  }).activity!;
  const query = newReportQuery("activities");
  query.scope.warehouses = ["未关联库位"];
  expect(projectReport(query).count).toBe(0);
  query.scope.warehouses = ["斋堂 / A-02"];
  expect(
    projectReport(query).rows.some((row) => row.activityId === "ACT-0001"),
  ).toBe(true);
  expect(
    projectReport(query).rows.some((row) => row.activityId === unlinked.id),
  ).toBe(false);
});
