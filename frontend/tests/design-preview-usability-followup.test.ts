import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewReceive from "../src/design-preview/PreviewReceive.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewItemPicker from "../src/design-preview/components/PreviewItemPicker.vue";
import PreviewOperationLines from "../src/design-preview/components/PreviewOperationLines.vue";
import {
  createDraft,
  resetReviewSession,
  reviewSession,
} from "../src/design-preview/reviewModel";
import { receivingFixture } from "../src/design-preview/usabilityFixtures";

const wrappers: VueWrapper[] = [];
const body = () => new DOMWrapper(document.body);
const button = (scope: VueWrapper | DOMWrapper<Element>, text: string) =>
  scope.findAll("button").find((row) => row.text().trim() === text)!;
const settle = async () => {
  await nextTick();
  await nextTick();
};
beforeEach(() => {
  resetReviewSession();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
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

it("keeps ordinary receiving separate after both large review samples are opened", () => {
  const ordinary = createDraft("Receive");
  const before = JSON.stringify(ordinary.lines);
  receivingFixture();
  receivingFixture(true);
  expect(createDraft("Receive")).toBe(ordinary);
  expect(JSON.stringify(ordinary.lines)).toBe(before);
});

it("discloses the complete draft and preserves every allocation in confirmation after filtering", async () => {
  const form = mount(PreviewFormPages, {
    props: { page: "movement-form", variant: "Receive-50" },
    attachTo: document.body,
  });
  wrappers.push(form);
  const draft = receivingFixture();
  draft.lines[0]!.manufacturingDate = "2026-10-01";
  draft.lines[0]!.reason = "完整复核信息";
  await settle();
  const disclosure = form.get(".review-lines-disclosure");
  expect(disclosure.attributes("open")).toBeUndefined();
  expect(form.get(".review-scope").text()).toBe("50 种物品 · 55 行分配");
  const summary = form.get(".form-review").text();
  await form
    .getComponent(PreviewOperationLines)
    .get('input[type="search"]')
    .setValue("PREVIEW-50-050");
  expect(form.get(".form-review").text()).toBe(summary);
  (disclosure.element as HTMLDetailsElement).open = true;
  expect(disclosure.findAll("[data-summary-line-id]")).toHaveLength(55);
  await button(form, "复核并确认").trigger("click");
  const dialog = body().get('[role="dialog"]');
  expect(dialog.findAll("[data-summary-line-id]")).toHaveLength(55);
  for (const index of [0, 27, 54]) {
    const line = draft.lines[index]!;
    expect(
      dialog.get('[data-summary-line-id="' + line.id + '"]').text(),
    ).toContain(line.code);
  }
  expect(dialog.text()).toContain("REVIEW-ADDITIONAL");
  expect(dialog.text()).toContain("到期");
  expect(dialog.text()).toContain("生产 2026-10-01");
  expect(dialog.text()).toContain("原因 完整复核信息");
});

it("keeps supporting editors inside the same creation form across picker transitions", async () => {
  const picker = mount(PreviewItemPicker, {
    props: { mode: "add-multiple", allowCreate: true },
    attachTo: document.body,
  });
  wrappers.push(picker);
  await button(body(), "新建物品").trigger("click");
  await body().get("form").findAll("input")[1]!.setValue("保留物品名称");
  await button(body(), "新建分类").trigger("click");
  await button(body(), "新建单位").trigger("click");
  await settle();
  const host = body().get(".preview-supporting-editors");
  expect(host.findAll("fieldset")).toHaveLength(2);
  expect(host.element.closest("form")).toBe(
    body().get(".preview-creation-fields").element,
  );
  expect(body().findAll('[role="dialog"]')).toHaveLength(1);
  await host.findAll("fieldset")[0]!.get("input").setValue("后续复核分类");
  await host.findAll("fieldset")[1]!.get("input").setValue("后续复核单位");
  await button(body(), "返回选择物品（保留填写）").trigger("click");
  await button(body(), "新建物品").trigger("click");
  expect(
    (host.findAll("fieldset")[0]!.get("input").element as HTMLInputElement)
      .value,
  ).toBe("后续复核分类");
  expect(
    (host.findAll("fieldset")[1]!.get("input").element as HTMLInputElement)
      .value,
  ).toBe("后续复核单位");
  await button(host, "创建并使用分类").trigger("click");
  await button(host, "保存并使用单位").trigger("click");
  await button(body(), "创建并选中").trigger("click");
  const created = reviewSession.stock.find(
    (item) => item.name === "保留物品名称",
  )!;
  expect(created).toMatchObject({
    category: "后续复核分类",
    uom: "后续复核单位",
  });
  expect(button(body(), "添加所选（1）").exists()).toBe(true);
  await button(body(), "关闭 ×").trigger("click");
  expect(picker.emitted("close")).toHaveLength(1);
  expect(
    reviewSession.categories.some((row) => row.name === created.category),
  ).toBe(true);
  expect(reviewSession.units.some((row) => row.name === created.uom)).toBe(
    true,
  );
});

it("adds a batch in its item group while retaining all allocation controls and IDs", async () => {
  const draft = receivingFixture();
  const editor = mount(PreviewOperationLines, {
    props: { draft },
    attachTo: document.body,
  });
  wrappers.push(editor);
  const ids = draft.lines.map((line) => line.id);
  const group = editor.get(".draft-line");
  const oldTotal = group.get(".preview-line-total").text();
  await button(group, "添加批次分配").trigger("click");
  expect(draft.lines.slice(0, 55).map((line) => line.id)).toEqual(ids);
  expect(editor.findAll("[data-line-id]")).toHaveLength(56);
  const newLine = draft.lines.at(-1)!;
  const row = group.get('[data-line-id="' + newLine.id + '"]');
  expect(row.get('input[data-field="qty"]').exists()).toBe(true);
  expect(row.get('input[data-field="batch"]').exists()).toBe(true);
  expect(row.get('input[data-field="expiry"]').exists()).toBe(true);
  expect(row.get('[data-field="location"] input').exists()).toBe(true);
  expect(group.get(".preview-line-total").text()).not.toBe(oldTotal);
  await button(row, "移除明细").trigger("click");
  expect(draft.lines.map((line) => line.id)).toEqual(ids);
});

it.each([
  ["新建分类", "分类名称", "返回选择"],
  ["新建单位", "单位名称", "取消"],
])(
  "protects unfinished %s input when leaving creation",
  async (open, label, cancel) => {
    const picker = mount(PreviewItemPicker, {
      props: { mode: "add-multiple", allowCreate: true },
      attachTo: document.body,
    });
    wrappers.push(picker);
    await button(body(), "新建物品").trigger("click");
    await button(body(), open).trigger("click");
    await settle();
    const field = body().get(".preview-supporting-editors fieldset input");
    expect(document.activeElement).toBe(field.element);
    expect(field.element.closest("label")?.textContent).toContain(label);
    await field.setValue("待保存资料");
    await button(body(), "关闭 ×").trigger("click");
    expect(picker.emitted("close")).toBeUndefined();
    expect(body().get('[role="alert"]').text()).toContain("放弃未保存");
    await button(body(), "继续填写").trigger("click");
    expect((field.element as HTMLInputElement).value).toBe("待保存资料");
    await button(body(), "返回选择物品（保留填写）").trigger("click");
    await body().get('.picker-row input[type="checkbox"]').setValue(true);
    await button(body(), "添加所选（1）").trigger("click");
    expect(picker.emitted("selectMultiple")).toBeUndefined();
    await button(body(), "继续填写").trigger("click");
    await button(body().get(".preview-supporting-editors"), cancel).trigger(
      "click",
    );
    await settle();
    expect(document.activeElement).toBe(button(body(), open).element);
    await button(body(), "关闭 ×").trigger("click");
    expect(picker.emitted("close")).toHaveLength(1);
  },
);

it("does not create an item while supporting-record edits would be lost", async () => {
  const picker = mount(PreviewItemPicker, {
    props: { mode: "replace-single", allowCreate: true },
    attachTo: document.body,
  });
  wrappers.push(picker);
  const before = reviewSession.stock.length;
  await button(body(), "新建物品").trigger("click");
  await body().get("form").findAll("input")[1]!.setValue("新物品");
  await button(body(), "新建单位").trigger("click");
  await body().get(".preview-supporting-editors input").setValue("未保存单位");
  await button(body(), "创建并更换").trigger("click");
  expect(reviewSession.stock).toHaveLength(before);
  expect(picker.emitted("select")).toBeUndefined();
  expect(body().get('[role="alert"]').text()).toContain("请先保存或取消");
  await button(body(), "保存并使用单位").trigger("click");
  await button(body(), "创建并更换").trigger("click");
  expect(picker.emitted("select")).toHaveLength(1);
  expect(reviewSession.stock.at(-1)?.uom).toBe("未保存单位");
});

it("shows canonical receipt expiry and conversion even with an automatic batch", async () => {
  const form = mount(PreviewReceive, {
    props: { pattern: "proposed" },
    attachTo: document.body,
  });
  wrappers.push(form);
  const editor = form.getComponent(PreviewOperationLines);
  const draft = editor.props("draft");
  const line = draft.lines[0]!;
  line.batch = "";
  line.qty = 20;
  line.entryUom = "箱";
  line.manufacturingDate = "2026-10-01";
  await settle();
  await form.get("form").trigger("submit");
  const summary = body().get('[role="dialog"] [data-summary-line-id]');
  expect(summary.text()).toContain("自动生成");
  expect(summary.text()).toContain("到期 2027-03-01");
  expect(summary.text()).toContain("生产 2026-10-01");
  expect(summary.text()).toContain("输入 2 箱");
  expect(summary.text()).toContain("20 袋");
  expect(summary.text()).toContain(line.code);
});
