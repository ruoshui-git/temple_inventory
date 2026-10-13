import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewSearchSelect from "../src/design-preview/components/PreviewSearchSelect.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewReceive from "../src/design-preview/PreviewReceive.vue";
import PreviewBrowsePages from "../src/design-preview/PreviewBrowsePages.vue";
import PreviewActivityBrowse from "../src/design-preview/PreviewActivityBrowse.vue";
import PreviewUtilityPages from "../src/design-preview/PreviewUtilityPages.vue";
import PreviewApp from "../src/design-preview/PreviewApp.vue";
import {
  createReviewSession,
  createDraft,
  resetReviewSession,
  reviewSession,
  pageHash,
} from "../src/design-preview/reviewModel";
import { validateOperation } from "../src/design-preview/formModel";
import {
  matchesExpiry,
  movementSummary,
} from "../src/design-preview/browseModel";
import { locations, previewDate } from "../src/design-preview/model";

const wrappers: VueWrapper[] = [];
async function chooseSearch(wrapper: VueWrapper, label: string, value: string) {
  const select = wrapper
    .findAllComponents(PreviewSearchSelect)
    .find((row) => row.props("label") === label)!;
  await select.get("input").setValue(value);
  const option = select
    .findAll("[role=option]")
    .find((row) => row.text().includes(value))!;
  await option.trigger("click");
}

const body = () => new DOMWrapper(document.body);
function render(component: any, props = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
function button(wrapper: VueWrapper | DOMWrapper<Element>, label: string) {
  return wrapper.findAll("button").find((row) => row.text().trim() === label)!;
}
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
});

describe("preview form refinement", () => {
  it("creates an item and integer-only unit inside receiving, preserves allocations and catalog after deleting the receipt", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive",
    });
    const receipt = reviewSession.drafts.find(
      (draft) => draft.kind === "Receive",
    )!;
    const original = receipt.lines[0];
    await button(wrapper, "添加物品").trigger("click");
    await button(body(), "新建物品").trigger("click");
    const inputs = body()
      .get('[role="dialog"] form')
      .findAll('input:not([type="checkbox"])');
    await inputs[0].setValue("ITM-TEST-NEW");
    await inputs[1].setValue("供餐套装");
    await button(body(), "新建单位").trigger("click");
    await body().get("fieldset input:not([type=checkbox])").setValue("套");
    await body().get("fieldset input[type=checkbox]").setValue(true);
    await button(body(), "保存并使用单位").trigger("click");
    await body()
      .get('[role="dialog"] form input[type=checkbox]')
      .setValue(true);
    await button(body(), "创建并使用").trigger("click");
    expect(body().find('[role="dialog"]').exists()).toBe(false);
    expect(receipt.lines[0]).toBe(original);
    const created = receipt.lines.find((line) => line.code === "ITM-TEST-NEW")!;
    expect(created.uom).toBe("套");
    expect(created.batch).toBe("");
    created.qty = 1.5;
    created.batch = "SET-001";
    expect(validateOperation(receipt)).toContain("整数");
    created.qty = 2;
    expect(validateOperation(receipt)).toBe("");
    reviewSession.drafts.splice(reviewSession.drafts.indexOf(receipt), 1);
    expect(
      reviewSession.stock.some((item) => item.code === "ITM-TEST-NEW"),
    ).toBe(true);
    expect(reviewSession.units.find((unit) => unit.name === "套")?.whole).toBe(
      true,
    );
  });

  it("shares receiving controls and keeps batch allocation totals derived", async () => {
    const wrapper = render(PreviewReceive, { pattern: "proposed" });
    await button(wrapper, "添加批次分配").trigger("click");
    const quantities = wrapper.findAll("input[type=number]");
    await quantities[1].setValue(5);
    expect(wrapper.get(".receive-line").text()).toContain("合计 17 袋");
    expect(
      wrapper.get(".receive-line").findAll("input[type=date]"),
    ).toHaveLength(2);
    expect(
      wrapper.get(".receive-line").findAll("[role=combobox]"),
    ).toHaveLength(2);
  });

  it("shows source, target, existing batch and availability without a disclosure, and restricts creation to receiving", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Transfer",
    });
    const draft = reviewSession.drafts.find(
      (draft) => draft.kind === "Transfer" && draft.status === "draft",
    )!;
    draft.lines[0] = {
      id: "rice",
      code: "ITM-000128",
      qty: 1,
      uom: "袋",
      sourceLocation: locations[0],
      location: locations[1],
      batch: "RICE-2609",
    };
    await nextTick();
    expect(wrapper.get(".preview-operation-lines").text()).toContain(
      "可用 60 袋",
    );
    expect(
      wrapper.get(".preview-operation-lines").findAll("[role=combobox]"),
    ).toHaveLength(3);
    await chooseSearch(wrapper, "来源库位", locations[1]);
    expect(wrapper.text()).toContain("可用 32 袋");
    await button(wrapper, "添加物品").trigger("click");
    expect(body().get('[role="dialog"]').text()).not.toContain("新建物品");
    expect(body().get('[role="dialog"]').text()).not.toContain("香菇干货");
  });

  it("rejects aggregate over-allocation, preserves expired donations, and checks damaged stock separately", () => {
    const session = createReviewSession();
    const draft = createDraft("Issue", "TEST", session);
    draft.lines = [
      {
        id: "1",
        code: "ITM-000128",
        qty: 40,
        uom: "袋",
        sourceLocation: locations[0],
        location: locations[0],
        batch: "RICE-2609",
      },
      {
        id: "2",
        code: "ITM-000128",
        qty: 30,
        uom: "袋",
        sourceLocation: locations[0],
        location: locations[0],
        batch: "RICE-2609",
      },
    ];
    expect(validateOperation(draft, session)).toContain("超过可用库存");
    draft.kind = "Receive";
    draft.lines.forEach((line) => (line.expiry = "2020-01-01"));
    expect(validateOperation(draft, session)).toBe("");
    draft.kind = "Repair";
    draft.lines = [{ ...draft.lines[0], qty: 3 }];
    expect(validateOperation(draft, session)).toContain("超过损坏库存");
    draft.lines[0].qty = 2;
    expect(validateOperation(draft, session)).toBe("");
  });

  it("supports zero counts with required difference reason and immutable item identity", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "reconciliation-form",
      variant: "detail",
    });
    const draft = reviewSession.drafts.find(
      (draft) => draft.name === "MAT-RECO-2026-00015",
    )!;
    draft.lines[0].countedQty = 0;
    expect(validateOperation(draft)).toContain("差异原因");
    draft.lines[0].reason = "复点确认空库位";
    expect(validateOperation(draft)).toBe("");
    await nextTick();
    expect(wrapper.text()).toContain("差异 -48");
    const editor = render(PreviewFormPages, {
      page: "item-form",
      variant: "edit",
    });
    expect(
      editor.get('input[placeholder="例如 ITM-000134"]').attributes("readonly"),
    ).toBeDefined();
    expect(
      editor.get(".preview-unit-field [role=combobox]").attributes("disabled"),
    ).toBeDefined();
    expect(
      editor
        .findAll(".form-check-row input[type=checkbox]")
        .every((input) => input.attributes("disabled") !== undefined),
    ).toBe(true);
  });

  it("settles good and damaged returns in one document and exposes history", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Return",
    });
    await chooseSearch(wrapper, "关联借用记录", "MAT-STE-2026-00004");
    await button(wrapper, "加入此借用").trigger("click");
    const draft = reviewSession.drafts.find(
      (draft) => draft.kind === "Return",
    )!;
    await button(wrapper, "添加处理分配").trigger("click");
    for (const input of wrapper.findAll("input[type=number]"))
      await input.setValue(1);
    const outcomes = wrapper
      .findAll("select")
      .filter((select) => select.text().includes("损坏归还"));
    await outcomes[1].setValue("damaged");
    expect(wrapper.text()).not.toContain("遗失结清");
    await nextTick();
    await button(wrapper, "复核并确认").trigger("click");
    await button(body(), "确认提交").trigger("click");
    expect(
      reviewSession.loans.find((loan) => loan.name === "MAT-STE-2026-00004")
        ?.lines[0],
    ).toMatchObject({ returned: 1, damaged: 1, lost: 0 });
    expect(
      reviewSession.movements
        .filter((row) => row.name === draft.name)
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["Damage", "Return"]);
    reviewSession.selectedLoanName = "MAT-STE-2026-00004";
    const detail = render(PreviewBrowsePages, {
      route: "loan-detail/selected",
    });
    expect(detail.text()).toContain(draft.name);
    expect(detail.text()).toContain("未结清 2");
  });
});

describe("preview scope and navigation", () => {
  it("treats today as unexpired and includes batch-only undated rows in browse and reports", async () => {
    expect(matchesExpiry(previewDate, "unexpired")).toBe(true);
    expect(matchesExpiry(previewDate, "expired")).toBe(false);
    const expiry = render(PreviewBrowsePages, { route: "expiry/undated" });
    expect(expiry.text()).toContain("TEXTILE-2610");
    const report = render(PreviewUtilityPages, {
      page: "reports",
      variant: "expiry",
    });
    await report
      .findAll("select")
      .find((select) => select.text().includes("无效期"))!
      .setValue("undated");
    expect(report.get("tbody").text()).toContain("TEXTILE-2610");
    expect(report.get("tbody").text()).not.toContain("RICE-2609");
  });

  it("counts distinct records, items and categories and keeps export dataset independent of format", async () => {
    const summary = movementSummary(
      reviewSession.movements.filter(
        (row) => row.docstatus === 1 && row.kind === "Receive",
      ),
      reviewSession,
    );
    expect(summary).toMatchObject({ records: 2, items: 2, categories: 1 });
    expect(
      movementSummary(
        [{ ...reviewSession.movements[0], code: "" }],
        reviewSession,
      ).items,
    ).toBe(0);
    const wrapper = render(PreviewActivityBrowse, {
      family: "movement",
      records: false,
      variant: "list",
    });
    await button(wrapper, "导出").trigger("click");
    const dataset = body()
      .findAll("select")
      .find((select) => select.text().includes("逐行明细"))!;
    expect(dataset.element.value).toBe("summary");
    const summaryRows = body().findAll("li").length;
    await dataset.setValue("details");
    expect(body().findAll("li").length).toBeGreaterThan(summaryRows);
    await body()
      .findAll("select")
      .find((select) => select.text().includes("XLSX"))!
      .setValue("XLSX");
    expect(dataset.element.value).toBe("details");
  });

  it("returns to the local inventory with search, view, selection and shell scroll restored", async () => {
    window.location.hash = "#review/local/inventory";
    const wrapper = render(PreviewApp);
    await nextTick();
    await wrapper.get('input[aria-label="搜索物品或条码"]').setValue("珍珠米");
    await wrapper.get('input[aria-label="选择东北珍珠米"]').setValue(true);
    const main = wrapper.get("#sample-content").element;
    main.scrollTop = 240;
    await button(wrapper, "东北珍珠米").trigger("click");
    expect(window.location.hash).toBe(pageHash("item-detail/overview"));
    expect(wrapper.get(".browse-detail-card").text()).toContain("批次管理");
    await wrapper.get(".preview-back").trigger("click");
    await nextTick();
    expect(window.location.hash).toBe("#review/local/inventory");
    expect(main.scrollTop).toBe(240);
    expect(
      wrapper.get('input[aria-label="搜索物品或条码"]').element.value,
    ).toBe("珍珠米");
    expect(
      wrapper.get('input[aria-label="选择东北珍珠米"]').element.checked,
    ).toBe(true);
  });
});
