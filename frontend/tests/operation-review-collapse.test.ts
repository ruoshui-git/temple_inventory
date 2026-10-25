import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import { newOperation } from "../src/features/documents/operationCodec";
import OperationEditorView from "../src/features/documents/OperationEditorView.vue";
import type { OperationEditor } from "../src/features/documents/useOperationEditor";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

const ButtonStub = defineComponent({
  name: "UiButton",
  props: ["disabled", "type", "loading", "variant", "ariaPressed"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" :type="type || \'button\'" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});
const OperationLinesStub = defineComponent({
  name: "OperationLines",
  props: ["expanded"],
  emits: ["expand", "notify"],
  template: "<div />",
});
const PageHeaderStub = defineComponent({
  name: "PageHeader",
  template:
    '<header class="form-page-heading"><slot /><slot name="back" /><slot name="actions" /></header>',
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
    units: [{ name: "Nos", whole: true }],
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
    setLoanDestination: vi.fn(),
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
        AllocationSummary: true,
        TransactionContext: true,
        Attachments: true,
        RecoverySummary: true,
        Overlay: true,
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
    await wrapper.get(".preview-edge-rail").trigger("click");
    await flushPromises();
    expect(form.classes()).toContain("workspace-review-collapsed");
    expect(wrapper.get(".form-date-section").exists()).toBe(true);
    expect(wrapper.get(".form-main").exists()).toBe(true);
    expect(wrapper.get(".preview-document-actions").exists()).toBe(true);
    const handle = wrapper.get(".preview-edge-rail");
    const panelId = handle.attributes("aria-controls");
    expect(panelId).toBe("operation-review-content");
    expect(wrapper.get(`#${panelId}`).attributes("aria-hidden")).toBe("true");

    await wrapper.get(".preview-full-workspace-action").trigger("click");
    await flushPromises();
    expect(wrapper.get("#operation-editor-preview").classes()).toContain(
      "workspace-expanded",
    );
    expect(form.classes()).not.toContain("workspace-review-collapsed");
    await wrapper.get(".preview-full-workspace-action").trigger("click");
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
    expect(wrapper.find(".preview-edge-rail").exists()).toBe(false);
    const disclosure = wrapper.get(".review-preview-disclosure");
    expect((disclosure.element as HTMLDetailsElement).open).toBe(false);
    await wrapper.get(".review-preview-summary").trigger("click");
    await flushPromises();
    expect((disclosure.element as HTMLDetailsElement).open).toBe(true);
    expect(wrapper.get("form").classes()).not.toContain(
      "workspace-review-collapsed",
    );
  });
});
