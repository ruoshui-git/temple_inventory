import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOMWrapper,
  flushPromises,
  mount,
  type VueWrapper,
} from "@vue/test-utils";
import { nextTick, h, KeepAlive } from "vue";
import PreviewBrowseFilters from "../src/design-preview/components/PreviewBrowseFilters.vue";
import PreviewSearchSelect from "../src/design-preview/components/PreviewSearchSelect.vue";
import PreviewCountWorkspace from "../src/design-preview/components/PreviewCountWorkspace.vue";
import PreviewDocumentState from "../src/design-preview/components/PreviewDocumentState.vue";
import PreviewScanPanel from "../src/design-preview/components/PreviewScanPanel.vue";
import PreviewOperationLines from "../src/design-preview/components/PreviewOperationLines.vue";
import PreviewAttachments from "../src/design-preview/components/PreviewAttachments.vue";
import PreviewCategoryField from "../src/design-preview/components/PreviewCategoryField.vue";
import PreviewSetupWorkspace from "../src/design-preview/components/PreviewSetupWorkspace.vue";
import PreviewTransactionContext from "../src/design-preview/components/PreviewTransactionContext.vue";
import PreviewActivityBrowse from "../src/design-preview/PreviewActivityBrowse.vue";
import PreviewBrowsePages from "../src/design-preview/PreviewBrowsePages.vue";
import PreviewFormPages from "../src/design-preview/PreviewFormPages.vue";
import PreviewUtilityPages from "../src/design-preview/PreviewUtilityPages.vue";
import PreviewInventory from "../src/design-preview/PreviewInventory.vue";
import PreviewItemImage from "../src/design-preview/PreviewItemImage.vue";
import {
  createDraft,
  createReviewSession,
  resetReviewSession,
  reviewSession,
  reviewMovementRows,
  captureSavedDraft,
  submitDraft,
} from "../src/design-preview/reviewModel";
import {
  addLoanToDraft,
  cancelPreviewDocument,
  countLocationLines,
  latestOptionSearch,
  refreshCountBaseline,
  warehouseEditError,
  type PreviewAttachment,
} from "../src/design-preview/workflowModel";
import { matchesItem, emptyScope } from "../src/design-preview/browseModel";
import { validateOperation } from "../src/design-preview/formModel";

const wrappers: VueWrapper[] = [];
function render(component: any, props: Record<string, unknown> = {}) {
  const wrapper = mount(component, { props, attachTo: document.body });
  wrappers.push(wrapper);
  return wrapper;
}
const body = () => new DOMWrapper(document.body);
function button(wrapper: VueWrapper | DOMWrapper<Element>, label: string) {
  const target = wrapper
    .findAll("button")
    .find((row) => row.text().trim() === label);
  if (!target) throw new Error(`Missing button: ${label}`);
  return target;
}
async function select(wrapper: VueWrapper, label: string, value: string) {
  const control = wrapper
    .findAllComponents(PreviewSearchSelect)
    .find((row) => row.props("label") === label)!;
  await control.get("input").setValue(value);
  await control
    .findAll('[role="option"]')
    .find((row) => row.text().includes(value))!
    .trigger("click");
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
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  delete document.documentElement.dataset.previewDensity;
  vi.unstubAllGlobals();
});

describe("ERPNext-native preview lifecycle", () => {
  it("keeps the saved version across editor remounts and preserves extra Desk fields", async () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    const original = draft.lines[0].qty;
    Object.assign(draft, {
      deskFields: { costCenter: "Temple", project: "Service" },
    });
    captureSavedDraft(draft);
    draft.lines[0].qty += 8;
    const wrapper = render(PreviewDocumentState, { draft });
    await button(wrapper, "外部修改").trigger("click");
    expect(wrapper.text()).toContain("保存已暂停");
    await button(wrapper, "载入最新记录并保留输入副本").trigger("click");
    expect(draft.lines[0].qty).toBe(original);
    expect(draft).toHaveProperty("deskFields.costCenter", "Temple");
    expect(
      wrapper.get('textarea[aria-label="保留的输入副本"]').element.value,
    ).toContain(`"qty": ${original + 8}`);
  });
  it("never substitutes a different document when a selected record is missing", () => {
    reviewSession.selectedDraftName = "DELETED-DOCUMENT";
    const before = reviewSession.drafts.length;
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive",
    });
    expect(wrapper.text()).toContain("DELETED-DOCUMENT 记录不可用");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(reviewSession.drafts).toHaveLength(before);
  });
  it("uses the borrowing Stock Entry as the loan identity", () => {
    const borrowed = reviewSession.loans.find(
      (row) => row.name === "MAT-STE-2026-00004",
    )!;
    const rows = reviewMovementRows().filter(
      (row) => row.kind === "Loan" && row.loanName === borrowed.name,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe(borrowed.name);
    expect(rows[0].documentType).toBe("Stock Entry");
  });
  it("opens Desk drafts by ERPNext identity and saves incomplete input without submission", async () => {
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive",
    });
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    expect(wrapper.text()).toContain(
      `Stock Entry · ${draft.name} · ERPNext 创建`,
    );
    draft.lines = [];
    await nextTick();
    await button(wrapper, "保存草稿").trigger("click");
    expect(draft.saved).toBe(true);
    expect(draft.status).toBe("draft");
    expect(reviewSession.movements.some((row) => row.name === draft.name)).toBe(
      false,
    );
  });
  it("blocks dirty writes and reloads saved remote input with a retained local copy", async () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    const wrapper = render(PreviewFormPages, {
      page: "movement-form",
      variant: "Receive",
    });
    const savedQty = draft.lines[0].qty;
    draft.lines[0].qty = savedQty + 7;
    await button(wrapper, "外部修改").trigger("click");
    expect(
      wrapper.findAll("button").some((row) => row.text() === "保存草稿"),
    ).toBe(false);
    await button(wrapper, "载入最新记录并保留输入副本").trigger("click");
    expect(draft.lines[0].qty).toBe(savedQty);
    expect(draft.note).toBe("ERPNext 更新的备注");
    expect(
      wrapper.get('textarea[aria-label="保留的输入副本"]').element.value,
    ).toContain(`"qty": ${savedQty + 7}`);
    expect(
      wrapper.findAll("button").some((row) => row.text() === "保存草稿"),
    ).toBe(true);
  });
  it("external submission uses saved lines and updates one document without changing stock", async () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    const original = draft.lines[0].qty;
    const stock = JSON.stringify(reviewSession.stock);
    const wrapper = render(PreviewDocumentState, { draft });
    draft.lines[0].qty = 999;
    await button(wrapper, "外部提交").trigger("click");
    await button(wrapper, "载入最新记录并保留输入副本").trigger("click");
    expect(draft.status).toBe("completed");
    expect(
      reviewMovementRows().filter((row) => row.name === draft.name),
    ).toHaveLength(1);
    expect(
      reviewSession.movements.find((row) => row.name === draft.name)?.qty,
    ).toBe(original);
    expect(JSON.stringify(reviewSession.stock)).toBe(stock);
    await button(wrapper, "外部删除").trigger("click");
    expect(wrapper.text()).toContain("不能直接删除");
  });
  it("keeps deleted dirty records unavailable after session recovery", async () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    const wrapper = render(PreviewDocumentState, { draft });
    draft.note = "未保存输入";
    await button(wrapper, "外部删除").trigger("click");
    await button(wrapper, "载入最新记录并保留输入副本").trigger("click");
    await button(wrapper, "登录过期").trigger("click");
    await button(wrapper, "重新登录并继续").trigger("click");
    expect(wrapper.emitted("blocked")?.at(-1)).toEqual([true]);
    expect(wrapper.text()).toContain("记录已删除");
    expect(
      wrapper.get('textarea[aria-label="保留的输入副本"]').element.value,
    ).toContain("未保存输入");
    expect(reviewSession.drafts.some((row) => row.name === draft.name)).toBe(
      false,
    );
  });
  it("cancels and amends without changing the original identity", async () => {
    const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
    submitDraft("Receive", draft.name);
    const wrapper = render(PreviewDocumentState, { draft });
    await button(wrapper, "取消已提交记录").trigger("click");
    expect(draft.status).toBe("cancelled");
    expect(
      reviewSession.movements.find((row) => row.name === draft.name)?.docstatus,
    ).toBe(2);
    await button(wrapper, "修订为新草稿").trigger("click");
    expect(wrapper.emitted("amend")?.[0]?.[0]).toMatchObject({
      name: `${draft.name}-1`,
      status: "draft",
      saved: false,
      amendedFrom: draft.name,
    });
    expect(draft.status).toBe("cancelled");
  });
  it("preserves multi-loan references, rejects incompatible loans and mixed Loss, and reverses cancellation", () => {
    const session = createReviewSession();
    const first = session.loans.find((loan) => loan.status === "outstanding")!;
    const second = JSON.parse(JSON.stringify(first));
    second.name = "MAT-STE-2026-09999";
    session.loans.push(second);
    const draft = createDraft("Return", "MULTI", session);
    expect(addLoanToDraft(draft, first.name, session)).toBe("");
    expect(addLoanToDraft(draft, second.name, session)).toBe("");
    const incompatible = JSON.parse(JSON.stringify(first));
    incompatible.name = "OTHER";
    incompatible.borrower = "另一借用方";
    session.loans.push(incompatible);
    expect(addLoanToDraft(draft, incompatible.name, session)).toContain(
      "同一借用方",
    );
    draft.lines[0].returnOutcome = "lost";
    expect(validateOperation(draft, session)).toContain("单独");
    expect(submitDraft("Return", draft.name, session)).toBeUndefined();
    draft.lines[0].returnOutcome = "damaged";
    expect(submitDraft("Return", draft.name, session)?.status).toBe(
      "completed",
    );
    expect(
      new Set(
        session.movements
          .filter((row) => row.name === draft.name)
          .map((row) => row.loanName),
      ),
    ).toEqual(new Set([first.name, second.name]));
    const borrowing = createDraft("Loan", second.name, session);
    borrowing.status = "completed";
    expect(cancelPreviewDocument(borrowing, session)).toContain("关联记录");
    expect(cancelPreviewDocument(draft, session)).toBe("");
    expect(first.lines.every((row) => !row.returned && !row.damaged)).toBe(
      true,
    );
    expect(second.lines.every((row) => !row.returned && !row.damaged)).toBe(
      true,
    );
  });
  it("offers separate linked Loss and accurate unsupported voucher identity", async () => {
    const loan = reviewSession.loans.find(
      (row) => row.status === "outstanding",
    )!;
    reviewSession.selectedLoanName = loan.name;
    const detail = render(PreviewBrowsePages, {
      route: "loan-detail/selected",
    });
    await button(detail, "记录遗失").trigger("click");
    expect(
      reviewSession.drafts.find(
        (row) => row.name === reviewSession.selectedDraftName,
      ),
    ).toMatchObject({ kind: "Loss", loanName: loan.name });
    const other = render(PreviewBrowsePages, {
      route: "movement-records/external",
    });
    expect(other.text()).toContain("Purchase Receipt · MAT-PRE-2026-00001");
    expect(other.get('a[target="_blank"]').attributes("href")).toContain(
      "/app/purchase-receipt/",
    );
    expect(
      other
        .findAll("button")
        .some((row) => row.text().includes("查看记录生命周期")),
    ).toBe(false);
  });
});

describe("counting and searchable supporting data", () => {
  it("distinguishes blank, zero and not-found, preserves counts and requires baseline re-review", async () => {
    const draft = createDraft("Reconcile", "COUNT");
    const wrapper = render(PreviewCountWorkspace, { draft });
    await select(wrapper, "盘点库位", "斋堂 / A-01");
    await wrapper.get("select").setValue("full");
    expect(draft.lines.every((row) => row.countedQty === undefined)).toBe(true);
    expect(validateOperation(draft)).toContain("至少核对");
    await wrapper.findAll('input[type="number"]')[0].setValue(0);
    expect(draft.lines[0]).toMatchObject({
      countedQty: 0,
      countState: "counted",
    });
    await button(wrapper, "未找到").trigger("click");
    expect(draft.lines[0]).toMatchObject({
      countedQty: 0,
      countState: "not_found",
      reason: "未找到",
    });
    const row = draft.lines[0];
    reviewSession.stock.find(
      (item) => item.code === row.code,
    )!.locations[0].batches![0].available += 3;
    await button(wrapper, "模拟账面变化").trigger("click");
    expect(validateOperation(draft)).toContain("刷新");
    await button(wrapper, "刷新账面基准").trigger("click");
    expect(row.countedQty).toBe(0);
    expect(validateOperation(draft)).toContain("重新核对");
    await wrapper.get('input[type="checkbox"]').setValue(true);
    expect(validateOperation(draft)).toBe("");
    await select(wrapper, "盘点库位", "斋堂 / A-02");
    expect(wrapper.text()).toContain("清除本次盘点输入");
    await button(wrapper, "保留当前盘点").trigger("click");
    expect(draft.countLocation).toBe("斋堂 / A-01");
    submitDraft("Reconcile", draft.name);
    expect(
      reviewSession.movements.filter(
        (movement) => movement.name === draft.name,
      ),
    ).toHaveLength(1);
  });
  it("refreshes removed and newly present rows without discarding full-count input", () => {
    const session = createReviewSession();
    const draft = createDraft("Reconcile", "REFRESH", session);
    draft.countLocation = "斋堂 / A-01";
    draft.countMode = "full";
    draft.lines = countLocationLines(draft.countLocation, session);
    draft.lines[0].countedQty = 0;
    const removed = draft.lines[0];
    const item = session.stock.find((item) => item.code === removed.code)!;
    item.locations[0].batches = item.locations[0].batches!.filter(
      (batch) => batch.id !== removed.batch,
    );
    item.locations[0].batches.push({ id: "NEW-BATCH", available: 8 });
    refreshCountBaseline(draft, session);
    expect(removed).toMatchObject({ qty: 0, countedQty: 0 });
    expect(draft.lines.find((row) => row.batch === "NEW-BATCH")).toMatchObject({
      qty: 8,
      countedQty: undefined,
    });
    expect(draft.baselineReviewed).toBe(false);
  });
  it("searches the full option set, skips disabled entries and closes without committing typed text", async () => {
    const options = Array.from({ length: 35 }, (_, index) => ({
      value: `CODE-${index}`,
      label: `物品 ${index}`,
      disabled: index === 1,
    }));
    const wrapper = render(PreviewSearchSelect, {
      modelValue: "CODE-34",
      options,
      label: "测试选择",
      pageSize: 3,
    });
    await wrapper.get("input").setValue("CODE-34");
    expect(wrapper.findAll('[role="option"]')).toHaveLength(1);
    await wrapper.get("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["CODE-34"]);
    await wrapper.get("input").setValue("");
    await wrapper.get("input").trigger("keydown", { key: "ArrowDown" });
    await wrapper.get("input").trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["CODE-2"]);
    await wrapper.get("input").setValue("没有这个选项");
    expect(wrapper.text()).toContain("没有匹配");
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await nextTick();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(wrapper.get("input").element.value).toBe("物品 34");
  });
  it("retains selection through failure/retry and ignores superseded async results", async () => {
    const wrapper = render(PreviewSearchSelect, {
      modelValue: "Nos",
      options: ["Nos"],
      label: "单位",
    });
    await wrapper.get("input").setValue("");
    await wrapper.get('select[aria-label="选项加载状态"]').setValue("error");
    expect(wrapper.text()).toContain("已选：Nos");
    await button(wrapper, "重试").trigger("click");
    expect(wrapper.get('[role="option"]').text()).toBe("Nos");
    let resolveFirst!: (value: string[]) => void;
    const search = latestOptionSearch((query) =>
      query === "a"
        ? new Promise<string[]>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(["b"]),
    );
    const first = search("a");
    expect(await search("b")).toEqual(["b"]);
    resolveFirst(["a"]);
    expect(await first).toBeUndefined();
  });
  it("creates activities/categories in the retained draft and honors parent-category filtering", async () => {
    const draft = createDraft("Receive", "CONTEXT");
    draft.note = "保持输入";
    const activity = render(PreviewTransactionContext, { draft });
    await button(activity, "新建活动").trigger("click");
    await activity.get("fieldset input").setValue("新法会");
    await button(activity, "创建并使用活动").trigger("click");
    expect(draft.activity).toBe("新法会");
    expect(draft.note).toBe("保持输入");
    const category = render(PreviewCategoryField);
    await button(category, "新建分类").trigger("click");
    await category.get("fieldset input").setValue("香品");
    await button(category, "创建并使用分类").trigger("click");
    expect(reviewSession.categories.some((row) => row.name === "香品")).toBe(
      true,
    );
    const scope = emptyScope();
    scope.categories = ["全部物资"];
    expect(matchesItem(reviewSession.stock[0].code, scope, reviewSession)).toBe(
      true,
    );
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(0);
  });
  it("protects system nodes/cycles and allows physical reparenting", () => {
    expect(warehouseEditError("斋堂", "斋堂 / A-01")).toContain("自身");
    expect(warehouseEditError("借出 / 法会义工组", "斋堂")).toContain("系统");
    expect(warehouseEditError("新位置", "借出")).toContain("实体");
    expect(warehouseEditError("斋堂 / A-01", "物资房")).toBe("");
  });
});

describe("scanner, files and recovery examples", () => {
  it("gates repeated scanning behind allocation configuration and retains batch context", async () => {
    const draft = createDraft("Issue", "SCAN");
    const wrapper = render(PreviewOperationLines, { draft });
    const scanner = wrapper.getComponent(PreviewScanPanel);
    await scanner.get('input:not([type="checkbox"])').setValue("RICE-2609");
    await button(scanner, "查找").trigger("click");
    await button(scanner, "配置数量与库位").trigger("click");
    expect(draft.lines[0]).toMatchObject({
      code: "ITM-000128",
      batch: "RICE-2609",
      sourceLocation: "",
    });
    expect(
      button(wrapper, "配置完成，继续扫描").attributes("disabled"),
    ).toBeDefined();
    await select(wrapper, "来源库位", "斋堂 / A-01");
    expect(draft.lines[0].batch).toBe("RICE-2609");
    expect(
      scanner.get('input:not([type="checkbox"])').attributes("disabled"),
    ).toBeDefined();
    await button(wrapper, "配置完成，继续扫描").trigger("click");
    expect(
      scanner.get('input:not([type="checkbox"])').attributes("disabled"),
    ).toBeUndefined();
  });
  it("looks up multiple barcodes manually, stops single scanning and handles unknown codes/camera failure", async () => {
    reviewSession.stock[0].barcode = "FIRST\nSECOND";
    const scanner = render(PreviewScanPanel, { allowCreate: false });
    await scanner.get('input[type="checkbox"]').setValue(false);
    await scanner.get('input:not([type="checkbox"])').setValue("SECOND");
    await button(scanner, "查找").trigger("click");
    await button(scanner, "配置数量与库位").trigger("click");
    expect(scanner.emitted("item")?.[0]?.[0]).toBe(reviewSession.stock[0].code);
    expect(
      scanner.get('input:not([type="checkbox"])').attributes("disabled"),
    ).toBeDefined();
    await button(scanner, "扫描下一项").trigger("click");
    await scanner.get('input:not([type="checkbox"])').setValue("UNKNOWN");
    await button(scanner, "查找").trigger("click");
    expect(scanner.text()).toContain("未找到 UNKNOWN");
    expect(
      scanner.findAll("button").some((row) => row.text() === "新建物品"),
    ).toBe(false);
    await button(scanner, "切换相机不可用").trigger("click");
    expect(scanner.text()).toContain("手动输入");
  });
  it("retains attachment content across remount, retries upload and changes primary images", async () => {
    let files: PreviewAttachment[] = [];
    const wrapper = render(PreviewAttachments, {
      modelValue: files,
      imagesOnly: true,
      "onUpdate:modelValue": (value: PreviewAttachment[]) => {
        files = value;
        wrapper.setProps({ modelValue: files });
      },
    });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      value: [new File(["sample"], "photo.png", { type: "image/png" })],
    });
    await input.trigger("change");
    await vi.waitFor(() => expect(files[0].state).toBe("ready"));
    expect(files[0].url).toMatch(/^data:image\/png;base64,/);
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    files.push({
      id: "two",
      name: "second.png",
      type: "image/png",
      url: files[0].url,
      state: "error",
    });
    const restored = render(PreviewAttachments, {
      modelValue: files,
      imagesOnly: true,
      "onUpdate:modelValue": (value: PreviewAttachment[]) => {
        files = value;
        restored.setProps({ modelValue: files });
      },
    });
    expect(restored.findAll("img")).toHaveLength(2);
    await button(restored, "重试上传").trigger("click");
    await button(restored, "设为主图").trigger("click");
    await flushPromises();
    expect(files[0].name).toBe("second.png");
    const image = render(PreviewItemImage, {
      item: { ...reviewSession.stock[0], illustration: "none", files },
    });
    expect(image.get("img").attributes("src")).toBe(files[0].url);
    await button(restored, "查看附件").trigger("click");
    expect(body().get('[role="dialog"] img').attributes("src")).toBe(
      files[0].url,
    );
  });
  it("distinguishes configuration failures from access and repairs only a reviewed pointer", async () => {
    const wrapper = render(PreviewSetupWorkspace);
    await wrapper.get("select").setValue("denied");
    expect(wrapper.text()).toContain("不能将其当作缺失仓库重建");
    expect(wrapper.findAll("button")).toHaveLength(0);
    await wrapper.get("select").setValue("role");
    expect(wrapper.text()).toContain("仅供 System Manager");
    await wrapper.get("select").setValue("root");
    await select(wrapper, "替代根节点", "斋堂");
    const before = JSON.stringify(reviewSession.stock);
    await button(wrapper, "查看修复影响").trigger("click");
    expect(button(wrapper, "应用修复").attributes("disabled")).toBeDefined();
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await button(wrapper, "应用修复").trigger("click");
    expect(wrapper.text()).toContain("未移动库存");
    expect(JSON.stringify(reviewSession.stock)).toBe(before);
  });
  it("keeps the prior confirmed preference during failure and retries the current display", async () => {
    const wrapper = render(PreviewUtilityPages, {
      page: "settings",
      variant: "density",
      density: "balanced",
    });
    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('input[value="spacious"]').setValue();
    expect(wrapper.text()).toContain("确认的偏好仍为 balanced");
    expect(document.documentElement.dataset.previewDensity).toBe("spacious");
    await button(wrapper, "重试保存偏好").trigger("click");
    expect(wrapper.text()).toContain("预览偏好已确认：spacious");
  });
  it("keeps complete analysis and selection through paginated failure/retry", async () => {
    const first = reviewSession.stock[0];
    for (let index = 0; index < 25; index++)
      reviewSession.stock.push({
        ...JSON.parse(JSON.stringify(first)),
        code: `EXTRA-${index}`,
        name: `更多物品 ${index}`,
      });
    const wrapper = render(PreviewInventory, { pattern: "proposed" });
    expect(wrapper.findAll(".stock-grid article")).toHaveLength(20);
    await wrapper.get(`input[aria-label="选择${first.name}"]`).setValue(true);
    await wrapper.get(".demo-state-control select").setValue("load-more-error");
    expect(wrapper.findAll(".stock-grid article")).toHaveLength(20);
    expect(
      wrapper.get(`input[aria-label="选择${first.name}"]`).element.checked,
    ).toBe(true);
    await button(wrapper, "重试加载").trigger("click");
    expect(wrapper.findAll(".stock-grid article").length).toBeGreaterThan(20);
    const movement = render(PreviewActivityBrowse, {
      family: "movement",
      records: false,
      variant: "list",
    });
    const analysis = movement
      .findAll("details")
      .find((row) => row.text().includes("分析当前结果"))!;
    expect(analysis.text()).toContain("已提交");
    expect(analysis.text()).toContain("入库");
    expect(analysis.text()).toContain("借出");
  });
});

describe("independent review workflow regressions", () => {
  it("starts another count after completing one instead of reopening the completed record", async () => {
    const first = render(PreviewFormPages, {
      page: "reconciliation-form",
      variant: "new",
    });
    const previous = first.getComponent(PreviewCountWorkspace).props("draft");
    previous.countLocation = "斋堂 / A-01";
    previous.lines = countLocationLines(previous.countLocation);
    previous.lines[0].countedQty = previous.lines[0].qty;
    submitDraft("Reconcile", previous.name);
    const second = render(PreviewFormPages, {
      page: "reconciliation-form",
      variant: "new",
    });
    const fresh = second.getComponent(PreviewCountWorkspace).props("draft");
    expect(fresh.name).not.toBe(previous.name);
    expect(fresh.status).toBe("draft");
    expect(fresh.lines).toEqual([]);
    expect(previous.status).toBe("completed");
  });

  it("preserves book/count quantities and reasons when opening a direct Desk reconciliation", async () => {
    const name = "MAT-RECO-2026-DIRECT";
    reviewSession.movements.push({
      name,
      documentType: "Stock Reconciliation",
      kind: "Reconcile",
      docstatus: 1,
      date: "2026-10-11",
      code: "ITM-000131",
      itemName: "物品",
      qty: -3,
      bookQty: 48,
      countedQty: 45,
      reason: "复核差异",
      uom: "个",
      from: "账面",
      to: "斋堂 / A-02",
    });
    reviewSession.selectedMovementName = name;
    const detail = render(PreviewBrowsePages, {
      route: "movement-records/selected",
    });
    await button(detail, "查看记录生命周期").trigger("click");
    const draft = reviewSession.drafts.find((row) => row.name === name)!;
    expect(draft).toMatchObject({
      kind: "Reconcile",
      documentType: "Stock Reconciliation",
      countLocation: "斋堂 / A-02",
    });
    expect(draft.lines[0]).toMatchObject({
      qty: 48,
      countedQty: 45,
      reason: "复核差异",
      countState: "counted",
    });
    expect(detail.emitted("navigate")?.at(-1)).toEqual([
      "reconciliation-form",
      "detail",
    ]);
  });

  it("resumes scanning when its invalid allocation is removed", async () => {
    const draft = createDraft("Issue", "SCAN-REMOVE");
    const wrapper = render(PreviewOperationLines, { draft });
    const scanner = wrapper.getComponent(PreviewScanPanel);
    await scanner.get('input:not([type="checkbox"])').setValue("RICE-2609");
    await button(scanner, "查找").trigger("click");
    await button(scanner, "配置数量与库位").trigger("click");
    expect(
      button(wrapper, "配置完成，继续扫描").attributes("disabled"),
    ).toBeDefined();
    await button(wrapper, "移除").trigger("click");
    expect(draft.lines).toEqual([]);
    expect(
      scanner.get('input:not([type="checkbox"])').attributes("disabled"),
    ).toBeUndefined();
    expect(
      wrapper
        .findAll("button")
        .some((row) => row.text() === "配置完成，继续扫描"),
    ).toBe(false);
  });

  it("opens receiving item creation directly with the unknown barcode retained", async () => {
    const draft = createDraft("Receive", "SCAN-CREATE");
    const wrapper = render(PreviewOperationLines, { draft });
    const scanner = wrapper.getComponent(PreviewScanPanel);
    await scanner
      .get('input:not([type="checkbox"])')
      .setValue("UNKNOWN-NEW-BARCODE");
    await button(scanner, "查找").trigger("click");
    await button(scanner, "新建物品").trigger("click");
    const dialog = body().get('[role="dialog"]');
    expect(dialog.get("h2").text()).toBe("新建物品");
    expect(dialog.get("textarea").element.value).toBe("UNKNOWN-NEW-BARCODE");
    const inputs = dialog
      .findAll("label")
      .find((label) => label.text().startsWith("物品名称"))!;
    await inputs.get("input").setValue("新扫描物品");
    await dialog.get("form").trigger("submit");
    expect(
      reviewSession.stock.find((item) => item.name === "新扫描物品"),
    ).toMatchObject({ barcode: "UNKNOWN-NEW-BARCODE", uom: "Nos" });
    expect(draft.lines).toHaveLength(1);
  });

  it("reopens a focused selector by click and lets a second Escape reach the enclosing dialog", async () => {
    const onKeydown = vi.fn();
    const wrapper = render(PreviewSearchSelect, {
      label: "单位",
      modelValue: "Nos",
      options: ["Nos", "袋"],
      onKeydown,
    });
    const input = wrapper.get("input");
    await input.trigger("focus");
    await wrapper.findAll('[role="option"]')[0].trigger("click");
    expect(input.attributes("aria-expanded")).toBe("false");
    await input.trigger("click");
    expect(input.attributes("aria-expanded")).toBe("true");
    await input.trigger("keydown", { key: "Escape" });
    expect(onKeydown).not.toHaveBeenCalled();
    await input.trigger("keydown", { key: "Escape" });
    expect(onKeydown).toHaveBeenCalledOnce();
  });
});

describe("cached counting and draft filter review", () => {
  it("starts a fresh count when returning to the cached new-count page", async () => {
    const host = render(
      {
        props: ["visible"],
        setup(props: { visible: boolean }) {
          return () =>
            h(KeepAlive, null, {
              default: () =>
                props.visible
                  ? h(PreviewFormPages, {
                      page: "reconciliation-form",
                      variant: "new",
                    })
                  : null,
            });
        },
      },
      { visible: true },
    );
    const previous = host.getComponent(PreviewCountWorkspace).props("draft");
    previous.status = "completed";
    await host.setProps({ visible: false });
    await host.setProps({ visible: true });
    const current = host.getComponent(PreviewCountWorkspace).props("draft");
    expect(current.name).not.toBe(previous.name);
    expect(current.status).toBe("draft");
  });
  it("applies parent category and both source/destination filters to matching draft lines", async () => {
    const draft = createDraft("Transfer", "FILTERED-DRAFT");
    draft.saved = true;
    draft.lines = [
      {
        id: "filter-line",
        code: "ITM-000128",
        qty: 1,
        uom: "袋",
        sourceLocation: "斋堂 / A-01",
        location: "斋堂 / A-02",
        batch: "RICE-2609",
      },
    ];
    const wrapper = render(PreviewBrowsePages, { route: "drafts/open" });
    const filters = wrapper.getComponent(PreviewBrowseFilters);
    const scope = {
      ...emptyScope(),
      kinds: ["Transfer"],
      categories: ["全部物资"],
      sources: ["斋堂 / A-01"],
      destinations: ["斋堂 / A-02"],
    };
    filters.vm.$emit("update:modelValue", scope);
    await nextTick();
    expect(wrapper.text()).toContain("FILTERED-DRAFT");
    filters.vm.$emit("update:modelValue", {
      ...scope,
      sources: ["物资房 / B-01"],
    });
    await nextTick();
    expect(wrapper.text()).not.toContain("FILTERED-DRAFT");
    filters.vm.$emit("update:modelValue", {
      ...scope,
      destinations: ["斋堂 / A-01"],
    });
    await nextTick();
    expect(wrapper.text()).not.toContain("FILTERED-DRAFT");
  });
});

it("keeps failed or pending uploads editable instead of confirming an incomplete record", async () => {
  const draft = reviewSession.drafts.find((row) => row.kind === "Receive")!;
  const attachment: PreviewAttachment = {
    id: "PENDING",
    name: "receipt.png",
    type: "image/png",
    state: "uploading",
  };
  draft.files = [attachment];
  reviewSession.selectedDraftName = draft.name;
  const editor = render(PreviewFormPages, {
    page: "movement-form",
    variant: "Receive",
  });
  await button(editor, "复核并确认").trigger("click");
  await button(body(), "确认提交").trigger("click");
  expect(editor.text()).toContain("附件仍在上传");
  expect(draft.status).toBe("draft");
  draft.files[0].state = "error";
  await button(editor, "复核并确认").trigger("click");
  await button(body(), "确认提交").trigger("click");
  expect(editor.text()).toContain("附件上传失败");
  expect(draft.files[0].name).toBe("receipt.png");
  await button(editor, "重试上传").trigger("click");
  expect(validateOperation(draft)).toBe("");
  expect(draft.status).toBe("draft");
});
