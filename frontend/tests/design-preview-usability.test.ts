import {
  applyLineConversion,
  setEnteredQty,
} from "../src/design-preview/conversionModel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewOverlay from "../src/design-preview/PreviewOverlay.vue";
import PreviewApp from "../src/design-preview/PreviewApp.vue";
import PreviewDashboard from "../src/design-preview/PreviewDashboard.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewItemPicker from "../src/design-preview/components/PreviewItemPicker.vue";
import PreviewOperationLines from "../src/design-preview/components/PreviewOperationLines.vue";
import PreviewScanPanel from "../src/design-preview/components/PreviewScanPanel.vue";
import PreviewSearchSelect from "../src/design-preview/components/PreviewSearchSelect.vue";
import PreviewUtilityPages from "../src/design-preview/PreviewUtilityPages.vue";
import {
  createDraft,
  pageHash,
  resetReviewSession,
  reviewSession,
} from "../src/design-preview/reviewModel";
import {
  defaults,
  preferenceKey,
  readPreferences,
  writePreferences,
} from "../src/design-preview/model";
import {
  operationIssues,
  validateOperation,
} from "../src/design-preview/formModel";
import { receivingFixture } from "../src/design-preview/usabilityFixtures";

const wrappers: VueWrapper[] = [];
const body = () => new DOMWrapper(document.body);
const button = (scope: VueWrapper | DOMWrapper<Element>, name: string) =>
  scope.findAll("button").find((row) => row.text().trim() === name)!;
async function settle() {
  await nextTick();
  await nextTick();
}
function render(component: any, props = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
let responsiveListener: ((event: { matches: boolean }) => void) | undefined;
beforeEach(() => {
  resetReviewSession();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
  responsiveListener = undefined;
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      addEventListener: (_: string, listener: typeof responsiveListener) => {
        responsiveListener = listener;
      },
      removeEventListener: vi.fn(),
    })),
  );
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
async function check(code: string) {
  const row = body()
    .findAll(".picker-row")
    .find((row) => row.text().includes(code))!;
  await row.get("input[type=checkbox]").setValue(true);
}
async function chooseFilter(picker: VueWrapper, label: string, value: string) {
  const field = picker
    .findAllComponents(PreviewSearchSelect)
    .find((field) => field.props("label") === label)!;
  await field.get("input").setValue(value);
  await field
    .findAll("[role=option]")
    .find((row) => row.text().includes(value))!
    .trigger("click");
}

describe("preview usability", () => {
  it("isolates simultaneous retained-result failures and retries one snapshot", async () => {
    vi.useFakeTimers();
    const dashboard = render(PreviewDashboard);
    const fail = dashboard.get(
      ".preview-state-controls label:nth-of-type(2) select",
    );
    await fail.setValue("库存概览");
    await fail.setValue("借出中");
    const inventory = dashboard.get("[data-section=inventory]");
    const oldResult = inventory.get(".dashboard-result").text();
    reviewSession.stock[0]!.locations[0]!.available += 100;
    await settle();
    expect(inventory.get(".dashboard-result").text()).toBe(oldResult);
    expect(inventory.text()).toContain("上次结果 · 尚未更新");
    expect(button(inventory, "查看库存").attributes("disabled")).toBeDefined();
    expect(
      button(dashboard, "查看全部批次").attributes("disabled"),
    ).toBeUndefined();
    await dashboard.get('button[aria-label="重试库存概览"]').trigger("click");
    expect(inventory.text()).toContain("正在重试…");
    expect(dashboard.get("[data-section=loans] [role=alert]").exists()).toBe(
      true,
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(inventory.find("[role=alert]").exists()).toBe(false);
    expect(inventory.get(".dashboard-result").text()).not.toBe(oldResult);
    expect(dashboard.get("[data-section=loans] [role=alert]").exists()).toBe(
      true,
    );
    expect(dashboard.get("[aria-live=polite]").text()).toContain("更新成功");
  });
  it("ends global refresh feedback when one card fails and the other requests finish", async () => {
    vi.useFakeTimers();
    const dashboard = render(PreviewDashboard);
    await button(dashboard, "刷新").trigger("click");
    await dashboard
      .get(".preview-state-controls label:nth-of-type(2) select")
      .setValue("库存概览");
    await vi.advanceTimersByTimeAsync(500);
    expect(
      dashboard.get(".preview-dashboard-grid").attributes("aria-busy"),
    ).toBe("false");
    expect(
      dashboard.get("[data-section=inventory] [role=alert]").exists(),
    ).toBe(true);
    expect(
      button(dashboard, "查看全部批次").attributes("disabled"),
    ).toBeUndefined();
    expect(dashboard.text()).not.toContain("正在更新当前范围");
  });
  it("shows no fixture values without a prior result, then loads only that card", async () => {
    vi.useFakeTimers();
    const dashboard = render(PreviewDashboard);
    await dashboard
      .get(".preview-state-controls input[type=checkbox]")
      .setValue(true);
    await dashboard
      .get(".preview-state-controls label:nth-of-type(2) select")
      .setValue("库存分布");
    const distribution = dashboard.get("[data-section=distribution]");
    expect(distribution.text()).toContain("暂时无法加载");
    expect(distribution.find(".dashboard-result").exists()).toBe(false);
    await distribution
      .get('button[aria-label="重试库存分布"]')
      .trigger("click");
    await vi.advanceTimersByTimeAsync(500);
    expect(distribution.find(".preview-bar").exists()).toBe(true);
  });
  it("disables empty scope clearing and provides mobile completion", async () => {
    const dashboard = render(PreviewDashboard);
    await button(dashboard, "总览范围 · 全部").trigger("click");
    expect(button(dashboard, "清空范围").attributes("disabled")).toBeDefined();
    reviewSession.filters.dashboard.categories = ["食品"];
    await settle();
    await button(dashboard, "清空范围").trigger("click");
    expect(reviewSession.filters.dashboard.categories).toEqual([]);
    responsiveListener?.({ matches: false });
    await settle();
    await button(body(), "完成").trigger("click");
    expect(body().find("[role=dialog]").exists()).toBe(false);
  });
  it("retains ordered selections across search and filters; cancellation does not add lines", async () => {
    const picker = render(PreviewItemPicker, {
      mode: "add-multiple",
      allowCreate: true,
    });
    await check("ITM-000130");
    await body().get("input[type=search]").setValue("珍珠米");
    await check("ITM-000128");
    await body().get("input[type=search]").setValue("");
    await chooseFilter(picker, "分类筛选", "日用品");
    await check("ITM-000131");
    await button(body(), "添加所选（3）").trigger("click");
    expect(picker.emitted("selectMultiple")?.[0]).toEqual([
      ["ITM-000130", "ITM-000128", "ITM-000131"],
    ]);
    expect(picker.emitted("select")).toBeUndefined();
    const draft = createDraft("Receive", "CANCEL-SELECTION");
    const editor = render(PreviewOperationLines, { draft });
    picker.unmount();
    wrappers.splice(wrappers.indexOf(picker), 1);
    await button(editor, "添加物品").trigger("click");
    await check("ITM-000129");
    await button(body(), "关闭 ×").trigger("click");
    expect(draft.lines).toEqual([]);
    await button(editor, "添加物品").trigger("click");
    expect(
      button(body(), "添加所选（0）").attributes("disabled"),
    ).toBeDefined();
  });
  it("keeps one overlay, unfinished creation, pending selection and scroll across surface and responsive changes", async () => {
    const picker = render(PreviewItemPicker, {
      mode: "add-multiple",
      allowCreate: true,
    });
    await check("ITM-000130");
    await body().get("input[type=search]").setValue("工作服");
    const selection = body().get(".dialog-content").element as HTMLElement;
    selection.scrollTop = 80;
    await button(body(), "新建物品").trigger("click");
    expect(body().findAll("[role=dialog]")).toHaveLength(1);
    expect(body().get("[role=dialog]").classes()).toContain(
      "preview-adaptive-creation",
    );
    expect(document.activeElement).toBe(body().get("form input").element);
    expect(body().get(".dialog-heading").text()).toContain("入库登记");
    const identity = body().get("form").findAll("input:not([type=checkbox])");
    await identity[0]!.setValue("ITM-NEW-USABILITY");
    await identity[1]!.setValue("长名称新物品");
    window.dispatchEvent(new Event("resize"));
    await settle();
    await button(body(), "返回选择物品（保留填写）").trigger("click");
    expect(
      (body().get("input[type=search]").element as HTMLInputElement).value,
    ).toBe("工作服");
    expect(selection.scrollTop).toBe(80);
    expect(body().get("[role=dialog]").classes()).toContain("preview-drawer");
    await button(body(), "新建物品").trigger("click");
    expect(
      (body().get("form").findAll("input")[1]!.element as HTMLInputElement)
        .value,
    ).toBe("长名称新物品");
    await button(body(), "创建并选中").trigger("click");
    expect(picker.emitted("selectMultiple")).toBeUndefined();
    expect(
      reviewSession.stock.some((item) => item.code === "ITM-NEW-USABILITY"),
    ).toBe(true);
    expect(button(body(), "添加所选（2）").exists()).toBe(true);
    await button(body(), "添加所选（2）").trigger("click");
    expect(picker.emitted("selectMultiple")?.at(-1)?.[0]).toEqual([
      "ITM-000130",
      "ITM-NEW-USABILITY",
    ]);
  });
  it("requires an inline discard decision without stacking surfaces", async () => {
    const picker = render(PreviewItemPicker, {
      mode: "add-multiple",
      allowCreate: true,
    });
    await button(body(), "新建物品").trigger("click");
    await body().get("form").findAll("input")[1]!.setValue("未完成物品");
    await button(body(), "关闭 ×").trigger("click");
    expect(picker.emitted("close")).toBeUndefined();
    expect(body().findAll("[role=dialog]")).toHaveLength(1);
    expect(body().get("[role=alert]").text()).toContain("放弃");
    await button(body(), "继续填写").trigger("click");
    expect(
      (body().get("form").findAll("input")[1]!.element as HTMLInputElement)
        .value,
    ).toBe("未完成物品");
    await button(body(), "关闭 ×").trigger("click");
    await button(body(), "放弃填写").trigger("click");
    expect(picker.emitted("close")).toHaveLength(1);
  });
  it("requires quantity/location configuration after scanner creation before resuming", async () => {
    const draft = createDraft("Receive", "SCAN-CREATION-GATE");
    const editor = render(PreviewOperationLines, { draft });
    const scanner = editor.getComponent(PreviewScanPanel);
    await scanner.get("input:not([type=checkbox])").setValue("NEW-SCAN-CODE");
    await button(scanner, "查找").trigger("click");
    await button(scanner, "新建物品").trigger("click");
    await body().get("form").findAll("input")[1]!.setValue("扫描后配置");
    await button(body(), "创建并使用").trigger("click");
    await settle();
    expect(draft.lines).toHaveLength(1);
    expect(
      scanner.get("input:not([type=checkbox])").attributes("disabled"),
    ).toBeDefined();
    expect(document.activeElement).toBe(
      editor.get("input[data-field=qty]").element,
    );
    await button(editor, "配置完成，继续扫描").trigger("click");
    expect(
      scanner.get("input:not([type=checkbox])").attributes("disabled"),
    ).toBeUndefined();
  });
  it("keeps replacement single-select and scanning creation immediate", async () => {
    const picker = render(PreviewItemPicker, {
      mode: "replace-single",
      allowCreate: true,
    });
    expect(
      body().get(".picker-row").find("input[type=checkbox]").exists(),
    ).toBe(false);
    await button(body().get(".picker-row"), "选择").trigger("click");
    expect(picker.emitted("select")?.[0]).toEqual(["ITM-000128"]);
    picker.unmount();
    wrappers.splice(wrappers.indexOf(picker), 1);
    const scannerPicker = render(PreviewItemPicker, {
      mode: "add-multiple",
      allowCreate: true,
      createBarcode: "SCAN-NEW",
    });
    await body().get("form").findAll("input")[1]!.setValue("扫码新物品");
    await button(body(), "创建并使用").trigger("click");
    expect(scannerPicker.emitted("select")).toHaveLength(1);
    expect(scannerPicker.emitted("selectMultiple")).toBeUndefined();
    expect(reviewSession.stock.at(-1)?.barcode).toBe("SCAN-NEW");
  });
  it("mounts the entire 50-item draft, preserves totals while filtering and edits early/middle/last rows", async () => {
    const draft = receivingFixture();
    expect(new Set(draft.lines.map((line) => line.code)).size).toBe(50);
    expect(draft.lines).toHaveLength(55);
    expect(validateOperation(draft)).toBe("");
    const editor = render(PreviewOperationLines, { draft });
    const total = draft.lines.reduce((sum, line) => sum + line.qty, 0);
    await editor.get("input[type=search]").setValue("PREVIEW-50-050");
    expect(editor.findAll("[data-line-id]")).toHaveLength(55);
    expect(
      editor.findAll("[data-line-id]").filter((row) => row.isVisible()),
    ).toHaveLength(1);
    expect(editor.text()).toContain("显示 1 / 55 行");
    expect(draft.lines.reduce((sum, line) => sum + line.qty, 0)).toBe(total);
    await editor.get("input[type=search]").setValue("");
    for (const index of [0, 27, 54]) {
      const line = draft.lines[index]!;
      await editor
        .get(`[data-line-id="${line.id}"] input[data-field=qty]`)
        .setValue(6);
      expect(line.qty).toBe(6);
    }
    expect(validateOperation(draft)).toBe("");
  });
  it("reveals hidden errors, expands optional fields and focuses the precise invalid field on repeated confirmation", async () => {
    const form = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive-50-invalid",
    });
    const draft = receivingFixture(true);
    const editor = form.getComponent(PreviewOperationLines);
    expect(operationIssues(draft).map((issue) => issue.lineId)).toEqual([
      draft.lines[0]!.id,
      draft.lines[27]!.id,
      draft.lines[54]!.id,
    ]);
    await editor.get("input[type=search]").setValue("PREVIEW-50-050");
    await button(form, "复核并确认").trigger("click");
    await button(body(), "确认提交").trigger("click");
    await settle();
    expect(document.activeElement).toBe(
      editor.get(`[data-line-id="${draft.lines[0]!.id}"] input[data-field=qty]`)
        .element,
    );
    expect(
      (editor.get("input[type=search]").element as HTMLInputElement).value,
    ).toBe("");
    setEnteredQty(draft.lines[0]!, 1);
    draft.lines[27]!.location = "斋堂 / A-01";
    setEnteredQty(draft.lines[54]!, 1);
    draft.lines[27]!.manufacturingDate = "2030-01-01";
    draft.lines[27]!.expiry = "2027-03-01";
    await editor.get("input[type=search]").setValue("PREVIEW-50-001");
    await button(form, "复核并确认").trigger("click");
    await button(body(), "确认提交").trigger("click");
    await settle();
    expect(document.activeElement).toBe(
      body().get("[role=dialog] input[data-field=manufacturingDate]").element,
    );
  });
  it("adds without merging, clears hidden-row filters and focuses the first new quantity", async () => {
    const draft = createDraft("Receive", "MULTIPLE-ADD");
    draft.lines = [
      {
        id: "existing",
        code: "ITM-000130",
        qty: 1,
        uom: "件",
        location: "斋堂 / A-01",
      },
    ];
    const editor = render(PreviewOperationLines, { draft });
    await editor.get("input[type=search]").setValue("hidden");
    await button(editor, "添加物品").trigger("click");
    await check("ITM-000130");
    await check("ITM-000129");
    await button(body(), "添加所选（2）").trigger("click");
    await settle();
    expect(draft.lines.map((line) => line.code)).toEqual([
      "ITM-000130",
      "ITM-000130",
      "ITM-000129",
    ]);
    expect(document.activeElement).toBe(
      editor.get(`[data-line-id="${draft.lines[1]!.id}"] input[data-field=qty]`)
        .element,
    );
    expect(
      (editor.get("input[type=search]").element as HTMLInputElement).value,
    ).toBe("");
  });
  it("loads legacy preferences, validates scale, persists it and synchronizes both settings surfaces", async () => {
    localStorage.setItem(
      preferenceKey,
      JSON.stringify({ density: "spacious" }),
    );
    expect(readPreferences(localStorage)).toMatchObject({
      textScale: 100,
      density: "spacious",
    });
    localStorage.setItem(preferenceKey, JSON.stringify({ textScale: 101 }));
    expect(readPreferences(localStorage).textScale).toBe(100);
    writePreferences(localStorage, {
      ...defaults,
      density: "compact",
      textScale: 200,
    });
    expect(readPreferences(localStorage).textScale).toBe(200);
    window.history.replaceState(null, "", pageHash("settings/density"));
    const app = render(PreviewApp);
    await settle();
    expect(
      document.documentElement.style.getPropertyValue("--p-text-scale"),
    ).toBe("2");
    const settings = app.getComponent(PreviewUtilityPages);
    await settings.get('select[aria-label="文字大小"]').setValue(150);
    expect(
      app.get('.review-controls select[aria-label="文字大小"]').element.value,
    ).toBe("150");
    expect(readPreferences(localStorage)).toMatchObject({
      textScale: 150,
      density: "compact",
    });
    await app
      .get('.review-controls select[aria-label="文字大小"]')
      .setValue(175);
    expect(settings.get('select[aria-label="文字大小"]').element.value).toBe(
      "175",
    );
    await button(settings, "恢复默认").trigger("click");
    expect(readPreferences(localStorage)).toMatchObject({
      textScale: 100,
      density: "compact",
    });
  });
});

describe("receiving fixture navigation and preservation", () => {
  it("keeps incomplete-only filtering separate from saving and navigates through all invalid allocations", async () => {
    const form = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive-50-invalid",
    });
    const draft = receivingFixture(true);
    const editor = form.getComponent(PreviewOperationLines);
    const summary = form.get(".form-review").text();
    await editor
      .get(".preview-line-toolbar input[type=checkbox]")
      .setValue(true);
    expect(
      editor.findAll("[data-line-id]").filter((row) => row.isVisible()),
    ).toHaveLength(3);
    expect(form.get(".form-review").text()).toBe(summary);
    await button(form, "保存草稿").trigger("click");
    expect(
      reviewSession.drafts.find((row) => row.name === draft.name)?.lines,
    ).toHaveLength(55);
    await button(editor, "3 处待完善 · 下一个").trigger("click");
    await settle();
    expect(document.activeElement).toBe(
      editor.get(`[data-line-id="${draft.lines[0]!.id}"] input[data-field=qty]`)
        .element,
    );
    await button(editor, "3 处待完善 · 下一个").trigger("click");
    await settle();
    expect(document.activeElement).toBe(
      editor.get(
        `[data-line-id="${draft.lines[27]!.id}"] [data-field=location] input`,
      ).element,
    );
    await button(editor, "3 处待完善 · 下一个").trigger("click");
    await settle();
    expect(document.activeElement).toBe(
      editor.get(
        `[data-line-id="${draft.lines[54]!.id}"] input[data-field=qty]`,
      ).element,
    );
  });
  it("retains the focused allocation node when its location changes and keeps active alternate entry visible", async () => {
    const draft = createDraft("Receive", "STABLE-ALLOCATION");
    draft.lines = [0, 1, 2].map((index) => ({
      id: `stable-${index}`,
      code: "ITM-000128",
      qty: 10,
      uom: "袋",
      location: index === 1 ? "斋堂 / A-02" : "斋堂 / A-01",
      expiry: "2027-01-01",
    }));
    const editor = render(PreviewOperationLines, { draft });
    const row = editor.get('[data-line-id="stable-1"]');
    const quantity = row.get("input[data-field=qty]")
      .element as HTMLInputElement;
    quantity.focus();
    draft.lines[1]!.location = "物资房 / B-01";
    await settle();
    expect(editor.get('[data-line-id="stable-1"]').element).toBe(row.element);
    expect(document.activeElement).toBe(quantity);
    applyLineConversion(draft.lines[1]!, "箱", 10, 1);
    await settle();
    expect(row.text()).toContain("折合 10 袋");
    await button(row, "详情").trigger("click");
    await button(body(), "完成详情").trigger("click");
    expect(row.get("input[data-field=qty]").isVisible()).toBe(true);
    expect(row.text()).toContain("折合 10 袋");
  });
  it("retains values and pending selections when the form crosses the shared breakpoint", async () => {
    const form = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive",
    });
    const draft = reviewSession.drafts.find(
      (draft) => draft.kind === "Receive",
    )!;
    await form.get("input[data-field=qty]").setValue(17);
    await button(form, "添加物品").trigger("click");
    await check("ITM-000130");
    await button(body(), "新建物品").trigger("click");
    await body().get("form").findAll("input")[1]!.setValue("响应式保留");
    responsiveListener?.({ matches: false });
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(body().findAll("[role=dialog]")).toHaveLength(1);
    expect(draft.lines[0]!.qty).toBe(17);
    expect(
      (body().get("form").findAll("input")[1]!.element as HTMLInputElement)
        .value,
    ).toBe("响应式保留");
    await button(body(), "返回选择物品（保留填写）").trigger("click");
    expect(button(body(), "添加所选（1）").exists()).toBe(true);
    responsiveListener?.({ matches: true });
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(draft.lines[0]!.qty).toBe(17);
    expect(button(body(), "添加所选（1）").exists()).toBe(true);
  });
});

describe.each([
  "库存概览",
  "库存分布",
  "效期概览",
  "货物流动",
  "借出中",
  "提醒事项",
])("section recovery: %s", (title) => {
  it.each([false, true])(
    "demonstrates failure and isolated recovery with no prior result = %s",
    async (withoutPrior) => {
      vi.useFakeTimers();
      const dashboard = render(PreviewDashboard);
      await dashboard
        .get(".preview-state-controls input[type=checkbox]")
        .setValue(withoutPrior);
      await dashboard
        .get(".preview-state-controls label:nth-of-type(2) select")
        .setValue(title);
      const failed = dashboard
        .findAll("[data-section]")
        .find((row) => row.text().includes(`${title}未能更新`))!;
      expect(failed.find(".dashboard-result").exists()).toBe(!withoutPrior);
      if (!withoutPrior) {
        expect(failed.get(".dashboard-result").classes()).toContain("is-stale");
        expect(
          failed
            .findAll(".dashboard-result button")
            .every((row) => row.attributes("disabled") !== undefined),
        ).toBe(true);
      }
      await failed.get(`button[aria-label="重试${title}"]`).trigger("click");
      expect(
        dashboard.findAll('[data-section][aria-busy="true"]'),
      ).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(500);
      expect(failed.find("[role=alert]").exists()).toBe(false);
      expect(failed.find(".dashboard-result").exists()).toBe(true);
      expect(
        dashboard.findAll('[data-section][aria-busy="true"]'),
      ).toHaveLength(0);
    },
  );
});

describe("independent review regressions", () => {
  it("keeps healthy reminder links usable when the expiry card fails", async () => {
    const dashboard = render(PreviewDashboard);
    await dashboard
      .get(".preview-state-controls label:nth-of-type(2) select")
      .setValue("效期概览");
    const reminder = dashboard.get("[data-section=reminders] .browse-rank-row");
    expect(reminder.attributes("disabled")).toBeUndefined();
    await reminder.trigger("click");
    expect(dashboard.emitted("navigate")?.[0]).toEqual(["expiry", "soon"]);
  });

  it("retains loan status as well as quantities until that card retries", async () => {
    vi.useFakeTimers();
    const dashboard = render(PreviewDashboard);
    await dashboard
      .get(".preview-state-controls label:nth-of-type(2) select")
      .setValue("借出中");
    const result = dashboard.get("[data-section=loans] .dashboard-result");
    const before = result.text();
    reviewSession.loans.forEach((loan) =>
      loan.lines.forEach((line) => {
        line.returned = line.qty;
      }),
    );
    await settle();
    expect(result.text()).toBe(before);
    await dashboard.get('button[aria-label="重试借出中"]').trigger("click");
    await vi.advanceTimersByTimeAsync(500);
    expect(result.text()).not.toBe(before);
  });

  it("does not leave global busy feedback running after all six requests fail", async () => {
    vi.useFakeTimers();
    const dashboard = render(PreviewDashboard);
    await button(dashboard, "刷新").trigger("click");
    for (const name of [
      "库存概览",
      "库存分布",
      "效期概览",
      "货物流动",
      "借出中",
      "提醒事项",
    ]) {
      await dashboard
        .get(".preview-state-controls label:nth-of-type(2) select")
        .setValue(name);
    }
    expect(
      dashboard.get(".preview-dashboard-grid").attributes("aria-busy"),
    ).toBe("false");
    expect(dashboard.text()).not.toContain("正在更新当前范围");
  });

  it("counts and reveals incomplete allocations even while a document field is missing", async () => {
    const draft = receivingFixture(true);
    draft.postingDate = "";
    expect(validateOperation(draft)).toBe("请选择操作日期。");
    expect(operationIssues(draft).filter((issue) => issue.lineId)).toHaveLength(
      3,
    );
    const editor = render(PreviewOperationLines, { draft });
    await editor
      .get(".preview-line-toolbar input[type=checkbox]")
      .setValue(true);
    expect(
      editor.findAll("[data-line-id]").filter((row) => row.isVisible()),
    ).toHaveLength(3);
    await button(editor, "3 处待完善 · 下一个").trigger("click");
    await settle();
    expect(document.activeElement).toBe(
      editor.get('[data-field="qty"]').element,
    );
  });

  it("reveals a scanned existing item despite a line search hiding it", async () => {
    const draft = createDraft("Receive", "SCAN-EXISTING-FOCUS");
    const editor = render(PreviewOperationLines, { draft });
    await editor.get("input[type=search]").setValue("no-match");
    editor.getComponent(PreviewScanPanel).vm.$emit("item", "ITM-000130");
    await settle();
    expect(editor.get("[data-line-id]").isVisible()).toBe(true);
    expect(document.activeElement).toBe(
      editor.get('input[data-field="qty"]').element,
    );
  });

  it("keeps scanner configuration blocked when repeated allocations exceed stock", async () => {
    const draft = createDraft("Issue", "SCAN-AGGREGATE");
    const item = reviewSession.stock.find(
      (item) => item.code === "ITM-000130",
    )!;
    const stock = item.locations[0]!;
    draft.lines = [
      {
        id: "existing",
        code: item.code,
        qty: stock.available,
        uom: item.uom,
        location: stock.location,
        sourceLocation: stock.location,
      },
    ];
    const editor = render(PreviewOperationLines, { draft });
    editor.getComponent(PreviewScanPanel).vm.$emit("item", item.code);
    await settle();
    const line = draft.lines.at(-1)!;
    line.location = stock.location;
    line.sourceLocation = stock.location;
    await settle();
    expect(
      button(editor, "配置完成，继续扫描").attributes("disabled"),
    ).toBeDefined();
    expect(editor.text()).toContain("数量合计超过可用库存");
  });

  it("traps focus on visible picker controls across creation transitions", async () => {
    render(PreviewItemPicker, { mode: "replace-single", allowCreate: true });
    await settle();
    const dialog = body().get('[role="dialog"]');
    const close = button(body(), "关闭 ×");
    const lastRow = button(body().findAll(".picker-row").at(-1)!, "库存详情");
    (close.element as HTMLElement).focus();
    await close.trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastRow.element);
    await lastRow.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(close.element);
    await button(body(), "新建物品").trigger("click");
    const back = button(body(), "返回选择物品（保留填写）");
    (back.element as HTMLElement).focus();
    await back.trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(close.element);
    expect(dialog.classes()).toContain("preview-adaptive-creation");
  });

  it("focuses the inline discard decision and prevents background submission", async () => {
    const picker = render(PreviewItemPicker, {
      mode: "add-multiple",
      allowCreate: true,
    });
    await button(body(), "新建物品").trigger("click");
    await body().get("form").findAll("input")[1]!.setValue("未完成");
    await button(body(), "关闭 ×").trigger("click");
    await settle();
    expect(document.activeElement).toBe(body().get('[role="alert"]').element);
    expect(body().get("form").attributes("inert")).toBeDefined();
    expect(body().findAll('button[type="submit"]')).toHaveLength(0);
    await button(body(), "继续填写").trigger("click");
    expect(body().get("form").attributes("inert")).toBeUndefined();
    expect(picker.emitted("close")).toBeUndefined();
  });
});

it("keeps a no-prior-result card empty while a global refresh is pending", async () => {
  vi.useFakeTimers();
  const dashboard = render(PreviewDashboard);
  await dashboard
    .get(".preview-state-controls input[type=checkbox]")
    .setValue(true);
  await dashboard
    .get(".preview-state-controls label:nth-of-type(2) select")
    .setValue("库存概览");
  await button(dashboard, "刷新").trigger("click");
  expect(
    dashboard
      .get("[data-section=inventory]")
      .find(".dashboard-result")
      .exists(),
  ).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(
    dashboard
      .get("[data-section=inventory]")
      .find(".dashboard-result")
      .exists(),
  ).toBe(true);
});

it("explains the error when navigating pending lines before the first submission", async () => {
  const draft = receivingFixture(true);
  const editor = render(PreviewOperationLines, { draft });
  expect(editor.find(".preview-allocation .notice-bar").exists()).toBe(false);
  await button(editor, "3 处待完善 · 下一个").trigger("click");
  expect(editor.get(".preview-allocation .notice-bar").text()).toContain(
    "数量必须大于 0",
  );
});

it("wraps focus through a closed disclosure summary without entering hidden fields", async () => {
  const overlay = mount(PreviewOverlay, {
    props: { title: "Disclosure" },
    slots: {
      default:
        '<details><summary>更多</summary><input aria-label="hidden field" /></details>',
    },
    attachTo: document.body,
  });
  wrappers.push(overlay);
  await settle();
  const close = button(body(), "关闭 ×");
  const summary = body().get("summary");
  (close.element as HTMLElement).focus();
  await close.trigger("keydown", { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(summary.element);
  await summary.trigger("keydown", { key: "Tab" });
  expect(document.activeElement).toBe(close.element);
});
