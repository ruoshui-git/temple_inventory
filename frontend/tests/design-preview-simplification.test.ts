import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import {
  createDraft,
  resetReviewSession,
  reviewSession,
  savedDraftSnapshot,
  submitDraft,
  reviewMovementRows,
} from "../src/design-preview/reviewModel";
import {
  applyLineConversion,
  conversionAccess,
  conversionError,
  createPreviewUnit,
  saveItemConversion,
  setEnteredQty,
} from "../src/design-preview/conversionModel";
import { operationIssues } from "../src/design-preview/formModel";
import PreviewOperationLines from "../src/design-preview/components/PreviewOperationLines.vue";
import PreviewConversionEditor from "../src/design-preview/components/PreviewConversionEditor.vue";
import PreviewAllocationSummary from "../src/design-preview/components/PreviewAllocationSummary.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewVirtualList from "../src/design-preview/components/PreviewVirtualList.vue";
import PreviewSearchSelect from "../src/design-preview/components/PreviewSearchSelect.vue";
import { installLargePickerFixture } from "../src/design-preview/usabilityFixtures";
import { moreNavigation } from "../src/design-preview/navigation";
const wrappers: VueWrapper[] = [];
const body = () => new DOMWrapper(document.body);
const button = (scope: VueWrapper | DOMWrapper<Element>, text: string) =>
  scope.findAll("button").find((row) => row.text().trim() === text)!;
const settle = async () => {
  await nextTick();
  await nextTick();
  await nextTick();
};
function render(component: unknown, props: Record<string, unknown>) {
  const wrapper = mount(component as never, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => {
  resetReviewSession();
  Object.assign(conversionAccess, {
    createUnit: true,
    updateItem: true,
    failSave: false,
    staleItem: false,
  });
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount());
  wrappers.length = 0;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
const receipt = () => createDraft("Receive");
it("records factors in save, movement history and submitted snapshots independently of Item defaults", () => {
  const draft = receipt(),
    line = draft.lines[0]!;
  applyLineConversion(line, "箱", 10, 3);
  submitDraft("Receive", draft.name);
  reviewSession.stock[0]!.alternateUnits![0]!.factor = 20;
  expect(JSON.parse(savedDraftSnapshot(draft)).lines[0]).toMatchObject({
    qty: 30,
    entryQty: 3,
    entryUom: "箱",
    conversionFactor: 10,
  });
  expect(
    reviewMovementRows().find((row) => row.name === draft.name),
  ).toMatchObject({ qty: 30, entryQty: 3, conversionFactor: 10 });
  const summary = render(PreviewAllocationSummary, { draft });
  expect(summary.text()).toContain("输入 3 箱");
  expect(summary.text()).toContain("1 箱 = 10 袋");
});
it.each([0, -1, Infinity, NaN, 0.1234567])(
  "rejects invalid factor %s without rounding",
  (factor) => {
    expect(conversionError(1, "箱", factor, "袋")).toContain("比例");
  },
);
it("validates both whole-unit rules and valid fractional factors", () => {
  reviewSession.units.push({ name: "半件", whole: false });
  expect(conversionError(2, "半件", 0.5, "Nos")).toBe("");
  expect(conversionError(1, "半件", 0.5, "Nos")).toContain("Nos只允许整数");
  expect(conversionError(0.5, "Nos", 1, "袋")).toContain("Nos只允许整数");
  const line = receipt().lines[0]!;
  applyLineConversion(line, "半件", 0.1234567, 1);
  expect(line.qty).toBe(0.1234567);
  expect(conversionError(0.14, "半件", 100, "Nos")).toBe("");
});
it("saves fractional Item factors without validating a fictional one-unit movement", async () => {
  const line = {
    id: "configuration",
    code: reviewSession.stock[0]!.code,
    qty: 1,
    uom: "Nos",
    location: "",
    entryUom: "Nos",
    entryQty: 1,
    conversionFactor: 1,
  };
  reviewSession.stock[0]!.uom = "Nos";
  reviewSession.units.push({ name: "半件", whole: false });
  const editor = render(PreviewConversionEditor, {
    line,
    reusableOnly: true,
    selectedUnit: "半件",
  });
  await editor.get('[data-field="conversionFactor"]').setValue(0.5);
  await button(editor, "应用换算").trigger("click");
  expect(editor.find('[role="alert"]').exists()).toBe(false);
  expect(reviewSession.stock[0]!.alternateUnits).toContainEqual({
    uom: "半件",
    factor: 0.5,
  });
});
it("does not apply a conversion while new-unit text would be abandoned", async () => {
  const editor = render(PreviewConversionEditor, { line: receipt().lines[0]! });
  await button(editor, "新建单位").trigger("click");
  await editor
    .get('fieldset input:not([type="checkbox"])')
    .setValue("尚未保存单位");
  await button(editor, "应用换算").trigger("click");
  expect(editor.get('[role="alert"]').text()).toContain("请先保存或取消");
  expect(editor.emitted("applied")).toBeUndefined();
});
it("preserves stock quantity when switching configured units and preserves entered quantity during staged factor editing", async () => {
  const draft = receipt(),
    line = draft.lines[0]!;
  const editor = render(PreviewOperationLines, { draft });
  const units = editor
    .findAllComponents(PreviewSearchSelect)
    .find((select) => select.props("label") === "单位")!;
  units.vm.$emit("update:modelValue", "箱");
  await settle();
  expect(line.qty).toBe(12);
  expect(line.entryQty).toBe(1.2);
  await button(editor, "详情").trigger("click");
  await button(body(), "单位与换算").trigger("click");
  await body().get("[data-field=conversionFactor]").setValue(20);
  expect(line.qty).toBe(12);
  expect(body().text()).toContain("原换算：1 箱 = 10 袋");
  await button(body(), "更新常用换算并应用").trigger("click");
  expect(line).toMatchObject({ qty: 24, entryQty: 1.2, conversionFactor: 20 });
  expect(reviewSession.stock[0]!.alternateUnits![0]!.factor).toBe(20);
});
it("makes line-only Apply independent of supporting-record save failure and retains failed checked input", async () => {
  const line = receipt().lines[0]!;
  const editor = render(PreviewConversionEditor, { line, selectedUnit: "箱" });
  await editor.get("[data-field=conversionFactor]").setValue(15);
  conversionAccess.failSave = true;
  await button(editor, "更新常用换算并应用").trigger("click");
  expect(line.conversionFactor).toBe(1);
  expect(editor.get("[role=alert]").text()).toContain("保存失败");
  await editor.get("input[type=checkbox]").setValue(false);
  await button(editor, "应用换算").trigger("click");
  expect(line.conversionFactor).toBe(15);
  expect(reviewSession.stock[0]!.alternateUnits![0]!.factor).toBe(10);
});
it("handles denied writes, duplicate names and stale version without mutation", () => {
  conversionAccess.createUnit = false;
  expect(createPreviewUnit("测试", true)).toContain("权限");
  conversionAccess.createUnit = true;
  expect(createPreviewUnit("箱", true)).toContain("已存在");
  conversionAccess.updateItem = false;
  expect(saveItemConversion("ITM-000128", "箱", 20, 0)).toContain("权限");
  conversionAccess.updateItem = true;
  expect(saveItemConversion("ITM-000128", "箱", 20, 4)).toContain("修改");
  expect(reviewSession.stock[0]!.alternateUnits![0]!.factor).toBe(10);
});
it("reveals expiry hidden by a search and retains ordinary Details edits on close", async () => {
  const draft = receipt(),
    line = draft.lines[0]!;
  line.expiry = "";
  const editor = render(PreviewOperationLines, { draft });
  await editor.get("input[type=search]").setValue("hidden");
  await editor.vm.revealIssue(
    operationIssues(draft).find((issue) => issue.field === "expiry"),
  );
  await settle();
  const expiry = body().get("input[data-field=expiry]");
  expect(document.activeElement).toBe(expiry.element);
  await expiry.setValue("2027-04-01");
  await button(body(), "完成详情").trigger("click");
  expect(line.expiry).toBe("2027-04-01");
  expect(editor.get("input[type=search]").element).toHaveProperty("value", "");
});
it("keeps the same editor, IDs, quantity and sole save action through expanded workspace", async () => {
  const form = render(PreviewFormPages, {
    page: "movement-form",
    variant: "Receive",
  });
  const editor = form.getComponent(PreviewOperationLines).element;
  await form.get("input[data-field=qty]").setValue(25);
  const ids = form
    .findAll("[data-line-id]")
    .map((row) => row.attributes("data-line-id"));
  await button(form, "展开工作区").trigger("click");
  expect(form.classes()).toContain("workspace-expanded");
  expect(form.getComponent(PreviewOperationLines).element).toBe(editor);
  await button(form, "收起工作区").trigger("click");
  expect(
    form.findAll("[data-line-id]").map((row) => row.attributes("data-line-id")),
  ).toEqual(ids);
  expect(form.get("input[data-field=qty]").element).toHaveProperty(
    "value",
    "25",
  );
  expect(
    form.findAll("button").filter((row) => row.text() === "保存草稿"),
  ).toHaveLength(1);
});
it("retains manual warehouse disclosure state through edits", async () => {
  const draft = receipt();
  const summary = render(PreviewAllocationSummary, {
    draft,
    collapsible: true,
  });
  expect(summary.get("details").attributes("open")).toBeDefined();
  (summary.get("details").element as HTMLDetailsElement).open = false;
  await summary.get("details").trigger("toggle");
  setEnteredQty(draft.lines[0]!, 4);
  await settle();
  expect(summary.get("details").attributes("open")).toBeUndefined();
});
it("virtualizes complete flat results and navigates to the final option", async () => {
  installLargePickerFixture();
  const keys = reviewSession.stock.map((row) => row.code);
  const list = render(PreviewVirtualList, { keys });
  expect(list.findAll("[data-virtual-index]").length).toBeLessThan(25);
  await list.vm.scrollToIndex(keys.length - 1);
  await settle();
  expect(list.find(`[data-virtual-index="${keys.length - 1}"]`).exists()).toBe(
    true,
  );
  const selector = render(PreviewSearchSelect, {
    label: "大型单位",
    options: keys,
  });
  await selector.get("input").trigger("focus");
  await selector.get("input").trigger("keydown", { key: "End" });
  await settle();
  await selector.get("input").trigger("keydown", { key: "Enter" });
  expect(selector.emitted("update:modelValue")?.at(-1)).toEqual([keys.at(-1)]);
});
it("has one new count entry under work tools", () => {
  expect(
    moreNavigation[0]!.items.filter(
      (row) => row.route === "reconciliation-form/new",
    ),
  ).toHaveLength(1);
});

it("keeps large fixture templates stable and installation idempotent", () => {
  const original = reviewSession.stock.map((item) => ({
    code: item.code,
    name: item.name,
  }));
  installLargePickerFixture();
  const size = reviewSession.stock.length;
  installLargePickerFixture();
  expect(reviewSession.stock).toHaveLength(size);
  expect(
    reviewSession.stock
      .slice(0, original.length)
      .map(({ code, name }) => ({ code, name })),
  ).toEqual(original);
  for (const item of reviewSession.stock.filter((item) =>
    item.code.startsWith("PICKER-1000-"),
  )) {
    expect(item.name.match(/大型选择器物品/g)).toHaveLength(1);
  }
});
it("keeps imported Desk drafts visible until an editable draft owns their projection", () => {
  const imported = {
    ...reviewSession.movements[0]!,
    name: "DESK-DRAFT",
    docstatus: 0 as const,
  };
  reviewSession.movements.push(imported);
  expect(
    reviewMovementRows().filter((row) => row.name === imported.name),
  ).toHaveLength(1);
  const draft = createDraft("Receive", imported.name);
  expect(
    reviewMovementRows().filter((row) => row.name === imported.name),
  ).toHaveLength(Math.max(1, draft.lines.length));
});
