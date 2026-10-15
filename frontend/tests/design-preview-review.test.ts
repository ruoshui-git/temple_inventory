import {
  applyLineConversion,
  setEnteredQty,
} from "../src/design-preview/conversionModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewActivityBrowse from "../src/design-preview/PreviewActivityBrowse.vue";
import PreviewBrowsePages from "../src/design-preview/PreviewBrowsePages.vue";
import PreviewOperationLines from "../src/design-preview/components/PreviewOperationLines.vue";
import {
  createDraft,
  resetReviewSession,
  reviewSession,
  submitDraft,
  getPreviewPage,
} from "../src/design-preview/reviewModel";
import { validateOperation } from "../src/design-preview/formModel";
import { destinationFor } from "../src/design-preview/navigation";
const wrappers: VueWrapper[] = [];
function render(component: any, props = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
const body = () => new DOMWrapper(document.body);
function button(wrapper: VueWrapper | DOMWrapper<Element>, label: string) {
  return wrapper.findAll("button").find((row) => row.text().trim() === label)!;
}
beforeEach(() => {
  resetReviewSession();
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
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});

describe("independent preview review regressions", () => {
  it("counts returned items and keeps mode-specific movement sorting", async () => {
    const loans = render(PreviewActivityBrowse, {
      family: "loan",
      records: false,
      variant: "returned",
    });
    expect(loans.get(".preview-activity-summary strong").text()).not.toContain(
      "0种物品",
    );
    const movement = render(PreviewActivityBrowse, {
      family: "movement",
      records: false,
      variant: "list",
    });
    await movement.get('select[aria-label="流动日期排序"]').setValue("oldest");
    await movement.setProps({ records: true, variant: "completed" });
    expect(
      movement.get('select[aria-label="流动日期排序"]').element.value,
    ).toBe("newest");
    expect(reviewSession.filters.movementItems.sort).toBe("oldest");
  });
  it("shows every type in a mixed settlement operation", () => {
    const sample = reviewSession.movements[0];
    reviewSession.movements.unshift(
      ...["Return", "Damage", "Loss"].map((kind) => ({
        ...sample,
        name: "MIXED",
        kind,
        docstatus: 1 as const,
      })),
    );
    const wrapper = render(PreviewActivityBrowse, {
      family: "movement",
      records: true,
      variant: "completed",
    });
    const row = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes("MIXED"))!;
    expect(row.text()).toContain("归还 / 损坏 / 遗失");
  });
  it("replaces every allocation in a group and preserves quantities", async () => {
    const draft = createDraft("Receive", "REPLACE");
    draft.lines = [1, 2].map((qty, index) => ({
      id: String(index),
      code: "ITM-000128",
      qty,
      uom: "袋",
      location: "斋堂 / A-01",
      batch: "OLD",
    }));
    const wrapper = render(PreviewOperationLines, { draft });
    await button(wrapper, "详情").trigger("click");
    await button(body(), "更换物品").trigger("click");
    await nextTick();
    await body()
      .findAll(".picker-row")
      .find((row) => row.text().includes("ITM-000129"))!
      .findAll("button")
      .find((row) => row.text() === "选择")!
      .trigger("click");
    expect(draft.lines.map((line) => line.code)).toEqual([
      "ITM-000129",
      "ITM-000129",
    ]);
    expect(draft.lines.map((line) => line.qty)).toEqual([1, 2]);
    expect(draft.lines.every((line) => !line.batch)).toBe(true);
  });
  it("settles the selected location's loan line, including original undated batches", () => {
    const loan = reviewSession.loans[0];
    loan.lines = ["斋堂 / A-01", "斋堂 / A-02"].map((location) => ({
      code: "ITM-000128",
      qty: 5,
      returned: 0,
      damaged: 0,
      lost: 0,
      location,
      batch: "RICE-2609",
    }));
    const draft = createDraft("Return", "EXACT");
    draft.loanName = loan.name;
    draft.borrower = loan.borrower;
    draft.activity = loan.activity;
    draft.lines = [
      {
        id: "second",
        loanLineIndex: 1,
        code: "ITM-000128",
        qty: 3,
        uom: "袋",
        location: "斋堂 / A-02",
        batch: "RICE-2609",
        returnOutcome: "returned",
      },
    ];
    expect(validateOperation(draft)).toBe("");
    submitDraft("Return", draft.name);
    expect(loan.lines.map((line) => line.returned)).toEqual([0, 3]);
    expect(
      destinationFor(getPreviewPage("movement-form/Damage")!, {
        loanName: loan.name,
      }),
    ).toBe("loans");
    expect(destinationFor(getPreviewPage("movement-form/Damage")!)).toBe(
      "movements",
    );
  });
  it("creates another editable settlement after a partial return", async () => {
    reviewSession.selectedLoanName = "MAT-STE-2026-00004";
    const detail = render(PreviewBrowsePages, {
      route: "loan-detail/selected",
    });
    await button(detail, "登记归还").trigger("click");
    const first = reviewSession.drafts.find(
      (draft) => draft.name === reviewSession.selectedDraftName,
    )!;
    setEnteredQty(first.lines[0], 1);
    submitDraft("Return", first.name);
    await nextTick();
    await button(detail, "登记归还").trigger("click");
    const second = reviewSession.drafts.find(
      (draft) => draft.name === reviewSession.selectedDraftName,
    )!;
    expect(second.name).not.toBe(first.name);
    expect(second.status).toBe("draft");
    expect(second.lines[0].qty).toBe(3);
  });
  it("can discard item edits without mutating catalog or deleting created units", async () => {
    const item = reviewSession.stock.find(
      (item) => item.code === reviewSession.selectedItemCode,
    )!;
    const name = item.name;
    const wrapper = render(PreviewFormPages, {
      page: "item-form",
      variant: "edit",
    });
    await wrapper
      .get('input[placeholder="填写清晰易识别的名称"]')
      .setValue("未保存名称");
    reviewSession.units.push({ name: "新单位", whole: true });
    await button(wrapper, "取消编辑").trigger("click");
    expect(body().get('[role="dialog"]').text()).toContain("放弃物品编辑");
    await button(body(), "放弃编辑").trigger("click");
    expect(item.name).toBe(name);
    expect(reviewSession.units.some((unit) => unit.name === "新单位")).toBe(
      true,
    );
    expect(wrapper.emitted("navigate")?.at(-1)).toEqual([
      "item-detail",
      "overview",
    ]);
  });
  it("retains stock-unit totals through alternate input and auto-generates receipt batch IDs", async () => {
    const draft = createDraft("Receive", "CONVERT");
    draft.lines = [
      {
        id: "rice",
        code: "ITM-000128",
        qty: 10,
        uom: "袋",
        location: "斋堂 / A-01",
        expiry: "2027-01-01",
      },
    ];
    const wrapper = render(PreviewOperationLines, { draft });
    applyLineConversion(draft.lines[0]!, "箱", 10, 1);
    await nextTick();
    await wrapper.get('input[data-field="qty"]').setValue(2);
    expect(draft.lines[0].qty).toBe(20);
    expect(wrapper.text()).toContain("折合 20 袋");
    expect(validateOperation(draft)).toBe("");
    submitDraft("Receive", draft.name);
    expect(draft.lines[0].batch).toBe("CONVERT-1");
  });
  it("offers no ineffective activity filter on expiry and retries detail errors", async () => {
    const expiry = render(PreviewBrowsePages, { route: "expiry/all" });
    await button(expiry, "筛选").trigger("click");
    expect(
      body()
        .findAll("label")
        .some((label) => label.text().startsWith("活动")),
    ).toBe(false);
    const detail = render(PreviewBrowsePages, {
      route: "item-detail/overview",
    });
    await detail.get(".preview-detail-state-control select").setValue("error");
    expect(detail.find(".browse-detail-card").exists()).toBe(false);
    await button(detail, "重试").trigger("click");
    expect(detail.find(".browse-detail-card").exists()).toBe(true);
    reviewSession.selectedItemCode = "MISSING";
    await nextTick();
    expect(detail.text()).toContain("这条记录不可用");
    expect(detail.find(".browse-detail-card").exists()).toBe(false);
  });
});
