// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newOperation } from "../src/features/documents/operationCodec";
import OperationEditorView from "../src/features/documents/OperationEditorView.vue";
import AllocationSummary from "../src/features/documents/AllocationSummary.vue";
import type { OperationEditor } from "../src/features/documents/useOperationEditor";
import { provideOperationContext } from "../src/features/documents/operationModel";
import type { OperationDraft } from "../src/features/documents/operationModel";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

const ButtonStub = defineComponent({
  name: "UiButton",
  props: ["disabled", "type", "loading", "variant", "ariaPressed"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" :type="type || \'button\'" :data-variant="variant" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});
const revealIssue = vi.fn();
const OperationLinesStub = defineComponent({
  name: "OperationLines",
  props: ["expanded"],
  emits: ["expand", "notify"],
  setup(_, { expose }) {
    expose({ itemPickerReady: () => true, openPicker: vi.fn(), revealIssue });
    return () => h("div");
  },
});
const PageHeaderStub = defineComponent({
  name: "PageHeader",
  template:
    '<header class="form-page-heading"><slot /><slot name="back" /><slot name="actions" /></header>',
});
const OverlayStub = defineComponent({
  template: '<div class="overlay-stub"><slot /><slot name="footer" /></div>',
});
const AllocationSummaryStub = defineComponent({
  props: ["draft", "linkItems"],
  template:
    '<div class="allocation-summary-stub" :data-link-items="linkItems">{{ draft.items[0]?.code }}</div>',
});

function setDesktop(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function setup(matches: boolean, attach = false) {
  setDesktop(matches);
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "review-test.local",
    user: "operator",
    siteDate: "2026-10-21",
    siteTime: "2026-10-21 10:00:00",
    physicalLeaves: ["ROOM-A"],
    warehouses: [{ name: "ROOM-A", label: "房间甲", is_group: false }],
    units: [
      { name: "Nos", label: "个", whole: true },
      { name: "Sheet", label: "张", whole: true },
    ],
  });
  const draft = reactive(newOperation("Receive", reference));
  const state = reactive({
    status: "local",
    identity: undefined,
    server: undefined,
    error: "",
    recoveryError: "",
    confirmationVersion: undefined,
    values: {},
    pendingUploadReselection: false,
  });
  const files = reactive({ files: [], busy: ref(false) });
  const controller = {
    draft: ref(draft),
    state,
    activityLabel: ref(""),
    reference,
    loading: ref(false),
    busy: ref(false),
    writable: ref(true),
    dirty: ref(false),
    files,
    issues: ref([]),
    showError: ref(false),
    reviewOpen: ref(false),
    action: ref(undefined),
    candidates: ref([]),
    supportingDirty: ref(false),
    leaveRequested: ref(false),
    existingDocument: ref(undefined),
    savedExportQuery: ref(undefined),
    canSubmit: ref(false),
    lifecycle: vi.fn(),
    appendLoan: vi.fn(),
    confirm: vi.fn(),
    finishLeave: vi.fn(),
    load: vi.fn(),
    recover: vi.fn(),
    recoveryText: ref(""),
    requestLeave: vi.fn(async () => true),
    review: vi.fn(async () => {}),
    save: vi.fn(),
  };
  const host = defineComponent({
    setup() {
      provideInventoryServices(
        {
          call: vi.fn(async () => ({})),
          report: vi.fn(async () => ({
            rows: [],
            matched_count: 0,
            next_start: null,
          })),
          upload: vi.fn(async () => ({})),
        },
        reference,
      );
      return () =>
        h(OperationEditorView, {
          controller: controller as unknown as OperationEditor,
        });
    },
  });
  const wrapper = mount(host, {
    ...(attach ? { attachTo: document.body } : {}),
    global: {
      stubs: {
        UiButton: ButtonStub,
        PageHeader: PageHeaderStub,
        OperationLines: OperationLinesStub,
        QuickExport: true,
        TransactionContext: true,
        Attachments: true,
        RecoverySummary: true,
        AllocationSummary: AllocationSummaryStub,
        Overlay: OverlayStub,
        SearchSelect: true,
        RemoteSelect: true,
        NativeStatusBadge: true,
        DocumentLoadingState: true,
      },
    },
  });
  wrappers.push(wrapper);
  return { wrapper, draft, controller };
}

describe("operation review rail collapse", () => {
  beforeEach(() => revealIssue.mockClear());
  it("shows only location and overall aggregates in a read-only review rail", async () => {
    const { wrapper, draft, controller } = setup(true);
    Object.assign(controller.state, { server: { editable: false } });
    draft.items.push(
      {
        id: "LINE-A",
        localId: "LINE-A",
        code: "ITEM-A",
        qty: 24,
        uom: "Nos",
        entryQty: 2,
        entryUom: "Box",
        location: "ROOM-A",
      },
      {
        id: "LINE-B",
        localId: "LINE-B",
        code: "ITEM-B",
        qty: 3,
        uom: "Nos",
        location: "ROOM-B",
      },
    );
    await flushPromises();
    expect(wrapper.findAll(".review-location-totals li")).toHaveLength(2);
    expect(wrapper.text()).toContain("3 个");
    expect(wrapper.text()).toContain("24 个");
    expect(wrapper.text()).toContain("27 个");
    expect(wrapper.text()).not.toContain("2 箱");
    expect(wrapper.find(".review-lines-disclosure").exists()).toBe(false);
    expect(wrapper.find(".review-content .eyebrow").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("确认前请核对物品、数量和库位");
  });

  it("keeps stock-unit labels on every overall and location total", async () => {
    const { wrapper, draft, controller } = setup(true);
    Object.assign(controller.state, { server: { editable: false } });
    draft.items.push(
      {
        id: "LINE-NOS",
        localId: "LINE-NOS",
        code: "ITEM-NOS",
        qty: 24,
        uom: "Nos",
        entryQty: 2,
        entryUom: "Box",
        location: "ROOM-A",
      },
      {
        id: "LINE-SHEET",
        localId: "LINE-SHEET",
        code: "ITEM-SHEET",
        qty: 1,
        uom: "",
        entryQty: 1,
        entryUom: "Sheet",
        nativeFields: { stock_uom: "Sheet" },
        location: "ROOM-B",
      },
    );
    await flushPromises();
    expect(wrapper.text()).toContain("24 个 · 1 张");
    expect(wrapper.text()).not.toMatch(/(?:^| · )1(?: ·|$)/);
  });

  it("summarizes only relevant empty review fields and omits empty irrelevant fields", async () => {
    const { wrapper, draft, controller } = setup(true);
    controller.reviewOpen.value = true;
    draft.items.push({
      id: "LINE-A",
      localId: "LINE-A",
      code: "ITEM-A",
      qty: 1,
      uom: "Nos",
      location: "ROOM-A",
    });
    await flushPromises();
    expect(wrapper.text()).toContain(
      "未填写：关联活动、来源、记录人、经手人、鉴证人",
    );
    expect(wrapper.text()).not.toContain("借用方");
    expect(wrapper.text()).not.toContain("未填写来源");
  });

  it("renders confirmation item names as plain text while document summaries link items", async () => {
    const { wrapper, draft, controller } = setup(true, false, true);
    controller.reviewOpen.value = true;
    draft.items.push({
      id: "LINE-A",
      localId: "LINE-A",
      code: "ITEM-A",
      qty: 1,
      uom: "Nos",
      location: "ROOM-A",
    });
    await flushPromises();

    expect(
      wrapper.get(".allocation-summary-stub").attributes("data-link-items"),
    ).toBe("false");
    expect(wrapper.text()).toContain("ITEM-A");

    const reference = createReferenceData();
    reference.warehouses = [
      { name: "ROOM-A", label: "房间甲", is_group: false },
    ];
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/items/:code",
          name: "item-detail",
          component: { template: "<div />" },
        },
      ],
    });
    const linkHost = defineComponent({
      setup() {
        provideOperationContext({
          stock: [],
          remember: vi.fn(),
          ensure: vi.fn(async () => {
            throw new Error("missing item");
          }),
          ensureMany: vi.fn(async () => new Map()),
          timestamp: () => undefined,
          issues: () => [],
          lineStock: () => undefined,
          lineCapacity: () => 0,
        });
        provideInventoryServices(
          { call: vi.fn(), upload: vi.fn(), report: vi.fn() },
          reference,
        );
        return () =>
          h(AllocationSummary, { draft: draft as unknown as OperationDraft });
      },
    });
    const linkedSummary = mount(linkHost, { global: { plugins: [router] } });
    wrappers.push(linkedSummary);
    await flushPromises();
    expect(linkedSummary.find("a.allocation-item-link").exists()).toBe(true);
  });

  it("uses 操作汇总 in the read-only phone summary", async () => {
    const { wrapper, draft, controller } = setup(false);
    Object.assign(controller.state, { server: { editable: false } });
    draft.items.push({
      id: "LINE-A",
      localId: "LINE-A",
      code: "ITEM-A",
      qty: 1,
      uom: "Nos",
      location: "ROOM-A",
    });
    await flushPromises();
    expect(wrapper.find(".review-summary").text()).toContain("操作汇总");
    expect(wrapper.find(".review-summary").text()).not.toContain("确认前检查");
  });

  it("keeps the edit aside aggregated and jumps to the first incomplete line", async () => {
    const { wrapper, draft, controller } = setup(true);
    draft.items.push(
      {
        id: "LINE-A",
        localId: "LINE-A",
        code: "ITEM-A",
        qty: 0,
        uom: "Nos",
        location: "ROOM-A",
      },
      {
        id: "LINE-B",
        localId: "LINE-B",
        code: "ITEM-B",
        qty: 1,
        uom: "Nos",
        location: "ROOM-B",
      },
    );
    controller.issues.value = [
      { lineId: "LINE-A", field: "qty", message: "请填写有效数量" },
      { lineId: "LINE-A", field: "expiry", message: "请填写效期" },
      { lineId: "LINE-B", field: "location", message: "请选择库位" },
    ];
    await flushPromises();

    expect(wrapper.findAll(".review-location-totals li")).toHaveLength(2);
    expect(wrapper.text()).toContain("2 行待完善");
    expect(wrapper.text()).toContain("数量 1 行 · 效期 1 行 · 库位 1 行");
    expect(wrapper.find(".review-lines-disclosure").exists()).toBe(false);
    await wrapper.get(".review-line-checks button").trigger("click");
    expect(revealIssue).toHaveBeenCalledWith(controller.issues.value[0]);
  });

  it("uses a normal primary confirmation tone when duplicating a document", async () => {
    const { wrapper, controller } = setup(true);
    controller.action.value = "duplicate";
    await flushPromises();
    expect(
      wrapper
        .findAll(".overlay-stub button")
        .at(-1)
        ?.attributes("data-variant"),
    ).toBe("primary");
  });

  it("opens review with Ctrl+Enter from a text field and never confirms", async () => {
    const { wrapper, controller } = setup(true, true);
    controller.canSubmit.value = true;
    controller.review = vi.fn(async () => {
      controller.reviewOpen.value = true;
    });
    controller.confirm = vi.fn();
    await flushPromises();
    const input = wrapper.get("input").element;
    input.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    await flushPromises();
    expect(event.defaultPrevented).toBe(true);
    expect(controller.review).toHaveBeenCalledOnce();
    expect(controller.confirm).not.toHaveBeenCalled();
    expect(controller.reviewOpen.value).toBe(true);
  });

  it("collapses only the review rail and restores the user's preview state after full workspace", async () => {
    const { wrapper } = setup(true);
    await flushPromises();
    const form = wrapper.get("form");
    await wrapper.get(".form-review-edge-rail").trigger("click");
    await flushPromises();
    expect(form.classes()).toContain("workspace-review-collapsed");
    expect(wrapper.get(".form-date-section").exists()).toBe(true);
    expect(wrapper.get(".form-main").exists()).toBe(true);
    expect(wrapper.get(".document-actions").exists()).toBe(true);
    const handle = wrapper.get(".form-review-edge-rail");
    const panelId = handle.attributes("aria-controls");
    expect(panelId).toBe("operation-review-content");
    expect(wrapper.get(`#${panelId}`).attributes("aria-hidden")).toBe("true");

    await wrapper.get(".full-workspace-action").trigger("click");
    await flushPromises();
    expect(wrapper.get("#operation-editor-preview").classes()).toContain(
      "workspace-expanded",
    );
    expect(form.classes()).not.toContain("workspace-review-collapsed");
    await wrapper.get(".full-workspace-action").trigger("click");
    await flushPromises();
    expect(wrapper.get("#operation-editor-preview").classes()).not.toContain(
      "workspace-expanded",
    );
    expect(form.classes()).toContain("workspace-review-collapsed");
    expect(wrapper.get(".form-date-section").exists()).toBe(true);
  });

  it("uses a normal disclosure on mobile and never exposes the desktop edge handle", async () => {
    const { wrapper } = setup(false);
    await flushPromises();
    expect(wrapper.find(".form-review-edge-rail").exists()).toBe(false);
    const disclosure = wrapper.get(".review-disclosure");
    expect((disclosure.element as HTMLDetailsElement).open).toBe(false);
    await wrapper.get(".review-summary").trigger("click");
    await flushPromises();
    expect((disclosure.element as HTMLDetailsElement).open).toBe(true);
    expect(wrapper.get("form").classes()).not.toContain(
      "workspace-review-collapsed",
    );
  });
});
