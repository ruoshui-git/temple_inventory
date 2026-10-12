import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, DOMWrapper, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  createReviewSession,
  resetReviewSession,
  reviewSession,
  createDraft,
  submitDraft,
} from "../src/design-preview/reviewModel";
import {
  emptyScope,
  resolvePeriod,
  inPeriod,
  filterMovements,
  groupMovements,
  filterLoans,
  groupLoans,
  loanStatus,
  remaining,
} from "../src/design-preview/browseModel";
import {
  dashboardData,
  expiryBucket,
} from "../src/design-preview/dashboardModel";
import PreviewPeriodFilter from "../src/design-preview/components/PreviewPeriodFilter.vue";
import PreviewActivityBrowse from "../src/design-preview/PreviewActivityBrowse.vue";
import PreviewDashboard from "../src/design-preview/PreviewDashboard.vue";
import PreviewInventory from "../src/design-preview/PreviewInventory.vue";
import PreviewItemImage from "../src/design-preview/PreviewItemImage.vue";
import { items, previewDate, locations } from "../src/design-preview/model";
const wrappers: VueWrapper[] = [];
function render(component: any, props: Record<string, unknown> = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper | DOMWrapper<Element>, label: string) {
  const result = wrapper
    .findAll("button")
    .find((row) => row.text().trim() === label);
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
const body = () => new DOMWrapper(document.body);
beforeEach(() => {
  resetReviewSession();
  window.history.replaceState(null, "", "/");
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
  vi.useRealTimers();
});

describe("preview date and scoped projections", () => {
  it("resolves rolling, natural, leap-year and inclusive same-day periods", () => {
    expect(
      resolvePeriod({ key: "last_7_days", from: "", to: "" }, "2026-01-02"),
    ).toEqual({ from: "2025-12-27", to: "2026-01-02" });
    expect(
      resolvePeriod({ key: "this_week", from: "", to: "" }, "2026-10-11"),
    ).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(
      resolvePeriod({ key: "this_month", from: "", to: "" }, "2024-02-29").from,
    ).toBe("2024-02-01");
    expect(
      resolvePeriod({ key: "this_year", from: "", to: "" }, "2026-10-11").from,
    ).toBe("2026-01-01");
    const period = {
      key: "custom" as const,
      from: previewDate,
      to: previewDate,
    };
    expect(inPeriod(previewDate, period)).toBe(true);
    expect(inPeriod("2026-10-10", period)).toBe(false);
  });
  it("combines type OR selection with date, category, exact item, activity and physical location filters", () => {
    const session = createReviewSession();
    const scope = emptyScope();
    Object.assign(scope, {
      kinds: ["Receive", "Loan"],
      categories: ["食品"],
      warehouses: ["斋堂"],
      destinations: [locations[0]],
      item: "ITM-000128",
      activity: "秋季斋堂补给",
      period: { key: "custom", from: "2026-10-11", to: "2026-10-11" },
    });
    expect(
      filterMovements(session.movements, scope, "珍珠", session).map(
        (row) => row.name,
      ),
    ).toEqual(["PREV-MOV-001"]);
    scope.sources = [locations[2]];
    expect(filterMovements(session.movements, scope, "", session)).toEqual([]);
  });
  it("groups repeated movement lines by item with distinct record counts and separate quantities", () => {
    const session = createReviewSession();
    const original = session.movements.find(
      (row) => row.name === "PREV-MOV-001",
    )!;
    const groups = groupMovements([
      original,
      { ...original, name: "SECOND", kind: "Issue", qty: 2 },
      { ...original, qty: 1, batch: "SECOND-BATCH" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].lines).toHaveLength(3);
    expect(groups[0].totals).toEqual([
      { kind: "Receive", text: "13 袋" },
      { kind: "Issue", text: "2 袋" },
    ]);
  });
  it("groups positive loan outcomes across records including partially settled loans", () => {
    const session = createReviewSession();
    expect(
      loanStatus(session.loans.find((loan) => loan.name === "PREV-LOAN-005")!),
    ).toBe("部分结清");
    const groups = groupLoans(session.loans, "all", session);
    const outstanding = groups.find(
      (group) => group.code === "ITM-000130" && group.outcome === "outstanding",
    )!;
    expect(outstanding.qty).toBe(5);
    expect(outstanding.count).toBe(2);
    expect(
      groups.find(
        (group) => group.code === "ITM-000130" && group.outcome === "returned",
      )?.qty,
    ).toBe(1);
    const scope = emptyScope();
    scope.period = { key: "custom", from: "2026-10-09", to: "2026-10-09" };
    expect(
      filterLoans(session.loans, scope, "", session).map((loan) => loan.name),
    ).toEqual(["PREV-LOAN-005"]);
  });
  it("settles a linked preview loan once and links its movement to the same loan", () => {
    const session = createReviewSession();
    const loan = session.loans.find((loan) => loan.name === "PREV-LOAN-005")!;
    const draft = createDraft("Return", "TEST-RETURN", session);
    draft.loanName = loan.name;
    draft.lines = [
      {
        id: "1",
        code: "ITM-000130",
        qty: 1,
        uom: "件",
        location: locations[1],
      },
    ];
    submitDraft("Return", draft.name, session);
    submitDraft("Return", draft.name, session);
    expect(remaining(loan.lines[0])).toBe(0);
    expect(loanStatus(loan)).toBe("已结清");
    expect(
      session.movements.filter((row) => row.name === draft.name),
    ).toHaveLength(1);
    expect(
      session.movements.find((row) => row.name === draft.name)?.loanName,
    ).toBe(loan.name);
  });
  it("keeps an excessive settlement draft without mutating the loan", () => {
    const session = createReviewSession();
    const draft = createDraft("Return", "EXCESS", session);
    draft.loanName = "PREV-LOAN-005";
    draft.lines = [
      {
        id: "1",
        code: "ITM-000130",
        qty: 2,
        uom: "件",
        location: locations[1],
      },
    ];
    expect(submitDraft("Return", draft.name, session)).toBeUndefined();
    expect(draft.status).toBe("draft");
    expect(
      remaining(
        session.loans.find((loan) => loan.name === draft.loanName)!.lines[0],
      ),
    ).toBe(1);
  });
});

describe("date and browse interactions", () => {
  it("validates pending custom edits, cancels without applying, then commits and restores focus", async () => {
    const wrapper = render(PreviewPeriodFilter, {
      modelValue: { key: "all", from: "", to: "" },
      label: "流动日期",
    });
    const trigger = wrapper.get("button");
    (trigger.element as HTMLElement).focus();
    await trigger.trigger("click");
    await body().get("select").setValue("custom");
    await button(body(), "应用").trigger("click");
    expect(body().get('[role="alert"]').text()).toContain("开始日期");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    await body().get('[aria-label="开始日期"]').setValue("2026-10-12");
    await body().get('[aria-label="结束日期"]').setValue("2026-10-11");
    await button(body(), "应用").trigger("click");
    expect(body().get('[role="alert"]').text()).toContain("不能早于");
    await button(body(), "取消").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(document.activeElement).toBe(trigger.element);
    await trigger.trigger("click");
    await body().get("select").setValue("custom");
    await body().get('[aria-label="开始日期"]').setValue(previewDate);
    await body().get('[aria-label="结束日期"]').setValue(previewDate);
    await button(body(), "应用").trigger("click");
    expect(wrapper.emitted("update:modelValue")).toEqual([
      [{ key: "custom", from: previewDate, to: previewDate }],
    ]);
  });
  it("synchronizes shortcuts and advanced combination checkboxes", async () => {
    const wrapper = render(PreviewActivityBrowse, {
      family: "movement",
      records: false,
      variant: "list",
    });
    await button(wrapper, "入库").trigger("click");
    expect(reviewSession.filters.movementScope.kinds).toEqual(["Receive"]);
    await button(wrapper, "筛选 · 1").trigger("click");
    await wrapper
      .findAll(".preview-check")
      .find((row) => row.text() === "借出")!
      .get("input")
      .setValue(true);
    expect(reviewSession.filters.movementScope.kinds).toEqual([
      "Receive",
      "Loan",
    ]);
    expect(wrapper.get('.browse-kind-tabs [aria-pressed="true"]').text()).toBe(
      "多种类型 · 2",
    );
    await button(wrapper, "借出").trigger("click");
    expect(reviewSession.filters.movementScope.kinds).toEqual(["Loan"]);
    await button(wrapper, "全部").trigger("click");
    expect(reviewSession.filters.movementScope.kinds).toEqual([]);
  });
  it("expands contributors without opening an arbitrary record", async () => {
    const wrapper = render(PreviewActivityBrowse, {
      family: "movement",
      records: false,
      variant: "list",
    });
    await wrapper.get(".preview-group summary").trigger("click");
    expect(wrapper.emitted("movement")).toBeUndefined();
    await wrapper.get(".preview-contribution button").trigger("click");
    expect(wrapper.emitted("movement")).toHaveLength(1);
  });
  it("shows complete operation branches but exports only matching lines", async () => {
    reviewSession.filters.movementScope.item = "ITM-000128";
    const wrapper = render(PreviewActivityBrowse, {
      family: "movement",
      records: true,
      variant: "completed",
    });
    const row = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes("PREV-MOV-001"))!;
    expect(row.text()).toContain(locations[0]);
    expect(row.text()).toContain(locations[1]);
    expect(row.text()).toContain("2 种物品");
    expect(row.text()).toContain("12 袋");
    await button(wrapper, "导出").trigger("click");
    expect(body().get('[role="dialog"] ul').text()).not.toContain("菜籽油");
    expect(body().get('[role="dialog"] ul').text()).toContain("12 袋");
  });
  it("hands the loan date range to borrowing and return history", async () => {
    reviewSession.filters.loanScope.period = {
      key: "custom",
      from: "2026-10-09",
      to: "2026-10-11",
    };
    const wrapper = render(PreviewActivityBrowse, {
      family: "loan",
      records: false,
      variant: "outstanding",
    });
    await button(wrapper, "查看期间借还流动").trigger("click");
    expect(reviewSession.filters.movementScope.period).toEqual(
      reviewSession.filters.loanScope.period,
    );
    expect(reviewSession.filters.movementScope.kinds).toEqual([
      "Loan",
      "Return",
    ]);
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "movement-records",
      "completed",
    ]);
  });
});

describe("complete dashboard", () => {
  it("covers all six expiry buckets including expiry today", () => {
    expect(
      [
        "2026-10-12",
        "2026-11-11",
        "2027-01-11",
        "2026-10-11",
        "2026-10-10",
        "2026-09-10",
        "2026-07-12",
      ].map((date) => expiryBucket(date)),
    ).toEqual([
      "upcoming_0_30",
      "upcoming_31_90",
      "upcoming_over_90",
      "upcoming_0_30",
      "expired_1_30",
      "expired_31_90",
      "expired_over_90",
    ]);
  });
  it("scopes every section while keeping the movement period independent of current stock and loans", () => {
    const session = createReviewSession();
    const initial = dashboardData(session);
    session.filters.dashboard.period = {
      key: "custom",
      from: "2000-01-01",
      to: "2000-01-01",
    };
    const old = dashboardData(session);
    expect(old.movements).toHaveLength(0);
    expect(old.metric("total")).toEqual(initial.metric("total"));
    expect(old.loanQuantities).toEqual(initial.loanQuantities);
    session.filters.dashboard.categories = ["日用品"];
    session.filters.dashboard.warehouses = [locations[1]];
    const scoped = dashboardData(session);
    expect(scoped.stock.map((item) => item.category)).toEqual(["日用品"]);
    expect(scoped.batches).toEqual([]);
    expect(scoped.loans).toEqual([]);
    expect(scoped.damaged).toBe(0);
  });
  it("deduplicates batch counts across locations", () => {
    const data = dashboardData(createReviewSession());
    expect(
      data.batches.filter(
        (row) => row.item.code === "ITM-000128" && row.id === "RICE-2609",
      ),
    ).toHaveLength(2);
    expect(
      data.buckets.find((row) => row.key === "upcoming_over_90")!.count,
    ).toBe(
      new Set(
        data.batches
          .filter((row) => row.bucket === "upcoming_over_90")
          .map((row) => `${row.item.code}:${row.id}`),
      ).size,
    );
  });
  it("renders all sections, carries drill scope, and retries a failed section", async () => {
    vi.useFakeTimers();
    const wrapper = render(PreviewDashboard);
    expect(
      wrapper
        .findAll("[data-section]")
        .map((row) => row.attributes("data-section")),
    ).toEqual([
      "inventory",
      "distribution",
      "expiry",
      "movement",
      "loans",
      "reminders",
    ]);
    expect(wrapper.findAll(".preview-expiry-grid button")).toHaveLength(6);
    reviewSession.filters.dashboard.categories = ["食品"];
    await nextTick();
    expect(wrapper.get('[role="status"]').text()).toContain("已保留");
    expect(button(wrapper, "查看库存").attributes("disabled")).toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    await button(wrapper, "查看库存").trigger("click");
    expect(reviewSession.filters.inventory.scope.categories).toEqual(["食品"]);
    await wrapper
      .get(".preview-state-controls label:nth-of-type(2) select")
      .setValue("借出中");
    expect(wrapper.get('[role="alert"]').text()).toContain("借用更新失败");
    await button(wrapper, "重试借出中").trigger("click");
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });
});

describe("image intent", () => {
  it("opens detail and lightbox separately without changing card selection", async () => {
    const wrapper = render(PreviewInventory, { pattern: "current" });
    const card = wrapper.get(".stock-card");
    await card.get(".preview-image-detail").trigger("click");
    expect(body().get('[role="dialog"]').text()).toContain("东北珍珠米");
    expect(document.querySelector(".lightbox-image")).toBeNull();
    await body().get('[aria-label="关闭对话框"]').trigger("click");
    const enlarge = card.get(".preview-image-enlarge");
    (enlarge.element as HTMLElement).focus();
    await enlarge.trigger("click");
    expect(document.querySelector(".lightbox-image")).not.toBeNull();
    expect(
      (card.get('input[type="checkbox"]').element as HTMLInputElement).checked,
    ).toBe(false);
    await body().get('[role="dialog"]').trigger("keydown", { key: "Escape" });
    expect(document.activeElement).toBe(enlarge.element);
  });
  it("offers detail but no enlarge action on missing-image cards", async () => {
    const wrapper = render(PreviewItemImage, {
      item: items.find((row) => row.illustration === "none")!,
      interaction: "detail",
    });
    expect(wrapper.find(".preview-image-enlarge").exists()).toBe(false);
    await wrapper.get("button").trigger("click");
    expect(wrapper.emitted("detail")).toHaveLength(1);
  });
});
