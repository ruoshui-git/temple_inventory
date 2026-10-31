// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive, ref } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import OperationEditorView from "../src/features/documents/OperationEditorView.vue";
import TransactionContext from "../src/features/documents/TransactionContext.vue";
import RecoverySummary from "../src/components/ui/RecoverySummary.vue";
import type { OperationEditor } from "../src/features/documents/useOperationEditor";
import {
  newOperation,
  encodeOperation,
} from "../src/features/documents/operationCodec";
import {
  operationIssues,
  type AllocationLine,
  type OperationDraft,
} from "../src/features/documents/operationModel";
import type { StockItem } from "../src/lib/stockPresentation";

const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: "(min-width: 1024px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

function referenceData() {
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "return-test.local",
    user: "operator",
    company: "TEMPLE",
    siteDate: "2026-10-31",
    siteTime: "2026-10-31 10:00:00",
    physicalLeaves: ["ROOM-A"],
    leasedLeaves: ["LEASED"],
    damagedLeaves: ["DAMAGED"],
    warehouses: [{ name: "ROOM-A", label: "房间甲", is_group: false }],
    activities: [
      { value: "ACT-A", label: "活动甲" },
      { value: "ACT-B", label: "活动乙" },
    ],
    units: [{ name: "Nos", whole: true }],
  });
  return reference;
}

const ButtonStub = defineComponent({
  name: "UiButton",
  props: ["disabled", "type", "loading", "variant", "ariaPressed"],
  emits: ["click"],
  template:
    '<button :disabled="disabled" :type="type || \'button\'" :data-variant="variant" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});
const OperationLinesStub = defineComponent({
  name: "OperationLines",
  props: ["expanded"],
  emits: ["expand", "notify"],
  setup(_, { expose }) {
    expose({
      itemPickerReady: () => true,
      openPicker: vi.fn(),
      revealIssue: vi.fn(),
    });
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

const borrowerGroups = [
  {
    borrower: "借用方甲",
    loan_count: 1,
    item_count: 1,
    latest_date: "2026-10-20",
  },
  {
    borrower: "借用方乙",
    loan_count: 1,
    item_count: 1,
    latest_date: "2026-10-21",
  },
];
const borrowerLoans: Record<string, unknown[]> = {
  借用方甲: [
    {
      name: "LOAN-A",
      date: "2026-10-20",
      borrower: "借用方甲",
      activity: "ACT-A",
      items: [
        { code: "ITEM-A", name: "物品甲", image: "", quantity: 2, uom: "Nos" },
      ],
    },
  ],
  借用方乙: [
    {
      name: "LOAN-C",
      date: "2026-10-21",
      borrower: "借用方乙",
      activity: "ACT-B",
      items: [
        { code: "ITEM-A", name: "物品甲", image: "", quantity: 1, uom: "Nos" },
      ],
    },
  ],
};
function loanDetail(name: string, borrower: string, activity: string) {
  return {
    name,
    doctype: "Stock Entry",
    kind: "Loan",
    docstatus: 1,
    ti_borrower: borrower,
    ti_activity: activity,
    items: [],
  };
}
const loanDetails: Record<string, ReturnType<typeof loanDetail>> = {
  "LOAN-A": loanDetail("LOAN-A", "借用方甲", "ACT-A"),
  "LOAN-B": loanDetail("LOAN-B", "借用方乙", "ACT-B"),
};

function returnLine(name: string, loanName: string, qty = 2): AllocationLine {
  return {
    id: name,
    localId: name,
    code: "ITEM-A",
    qty,
    entryQty: qty,
    entryUom: "Nos",
    uom: "Nos",
    conversionFactor: 1,
    sourceLocation: "LEASED",
    location: "ROOM-A",
    loanName,
    originalLoanLine: `LINE-${loanName}`,
    batch: "",
    outstanding: 5,
    returnOutcome: "returned",
  };
}

function setupEditorView(options: {
  lines: AllocationLine[];
  server?: Record<string, unknown>;
  reference?: ReturnType<typeof referenceData>;
}) {
  const reference = options.reference ?? referenceData();
  const draft = reactive(newOperation("Return", reference)) as OperationDraft;
  draft.items.push(...options.lines);
  const state = reactive({
    status: options.server ? "saved" : "local",
    identity: options.server
      ? { doctype: "Stock Entry", name: "MAT-STE-1" }
      : undefined,
    server: options.server,
    error: "",
    recoveryError: "",
    confirmationVersion: undefined,
    values: {},
    pendingUploadReselection: false,
    version: "v1",
  });
  const call = vi.fn(async (method: string, args: Record<string, unknown>) => {
    if (method === "native_api.outstanding_loan_groups")
      return { rows: borrowerGroups, next: null };
    if (method === "native_api.outstanding_loans")
      return { rows: borrowerLoans[String(args.borrower)] || [], next: null };
    if (method === "native_api.loan_detail")
      return loanDetails[String(args.name)];
    return {};
  });
  const controller = {
    draft: ref(draft),
    state,
    stock: reactive<StockItem[]>([]),
    activityLabel: ref(""),
    reference,
    loading: ref(false),
    hydrating: ref(false),
    busy: ref(false),
    writable: ref(!options.server),
    dirty: ref(false),
    files: reactive({ files: [], busy: ref(false), incomplete: ref(false) }),
    issues: ref([]),
    showError: ref(false),
    reviewOpen: ref(false),
    action: ref(undefined),
    supportingDirty: ref(false),
    leaveRequested: ref(false),
    existingDocument: ref(Boolean(options.server)),
    savedExportQuery: ref(undefined),
    canSubmit: ref(!options.server),
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
          call,
          report: vi.fn(),
          upload: vi.fn(),
        } as unknown as InventoryServices,
        reference,
      );
      return () =>
        h(OperationEditorView, {
          controller: controller as unknown as OperationEditor,
        });
    },
  });
  const wrapper = mount(host, {
    global: {
      stubs: {
        UiButton: ButtonStub,
        PageHeader: PageHeaderStub,
        OperationLines: OperationLinesStub,
        QuickExport: true,
        TransactionContext: true,
        Attachments: true,
        RecoverySummary: true,
        AllocationSummary: true,
        Overlay: OverlayStub,
        DocumentLoadingState: true,
        NativeStatusBadge: true,
      },
    },
  });
  wrappers.push(wrapper);
  return { wrapper, draft, controller, call };
}

describe("mixed-borrower Return editor", () => {
  it("lists each settled loan with its own borrower and activity in the editor", async () => {
    const { wrapper } = setupEditorView({
      lines: [returnLine("LINE-A", "LOAN-A"), returnLine("LINE-B", "LOAN-B")],
    });
    await flushPromises();
    const chips = wrapper
      .findAll(".selected-loan-chips button")
      .map((chip) => chip.text());
    expect(chips).toHaveLength(2);
    expect(chips[0]).toContain("原借出 LOAN-A · 借用方 借用方甲 · 活动 活动甲");
    expect(chips[1]).toContain("原借出 LOAN-B · 借用方 借用方乙 · 活动 活动乙");
    expect(wrapper.find('[data-field="borrower"]').exists()).toBe(false);
  });

  it("keeps every outstanding borrower pickable after the first loan is chosen", async () => {
    const { wrapper, controller } = setupEditorView({
      lines: [returnLine("LINE-A", "LOAN-A")],
    });
    await flushPromises();
    const groupNames = () =>
      wrapper
        .findAll(".outstanding-borrower-toggle > span")
        .map((node) => node.text());
    expect(groupNames()).toEqual(["借用方甲", "借用方乙"]);
    const toggle = wrapper
      .findAll(".outstanding-borrower-toggle")
      .find((button) => button.text().includes("借用方乙"))!;
    await toggle.trigger("click");
    await flushPromises();
    const addButton = wrapper
      .findAll("button")
      .find((button) => button.text() === "加入")!;
    expect(addButton.attributes("disabled")).toBeUndefined();
    await addButton.trigger("click");
    expect(controller.appendLoan).toHaveBeenCalledWith("LOAN-C");
  });

  it("shows 多个借用方 and every loan in the detail header when the loans disagree", async () => {
    const { wrapper } = setupEditorView({
      lines: [returnLine("LINE-A", "LOAN-A"), returnLine("LINE-B", "LOAN-B")],
      server: { editable: false, docstatus: 1 },
    });
    await flushPromises();
    const header = wrapper.find("dl.info-grid.form-section");
    expect(header.text()).toContain("多个借用方");
    expect(header.text()).toContain("多个活动");
    const entries = wrapper
      .findAll(".form-main .return-loan-context-list li")
      .map((item) => item.text());
    expect(entries).toEqual([
      "原借出 LOAN-A · 借用方 借用方甲 · 活动 活动甲",
      "原借出 LOAN-B · 借用方 借用方乙 · 活动 活动乙",
    ]);
  });

  it("shows one shared borrower and activity in the detail header when every loan agrees", async () => {
    const { wrapper } = setupEditorView({
      lines: [returnLine("LINE-A", "LOAN-A"), returnLine("LINE-C", "LOAN-A")],
      server: { editable: false, docstatus: 1 },
    });
    await flushPromises();
    const header = wrapper.find("dl.info-grid.form-section");
    expect(header.text()).toContain("借用方甲");
    expect(header.text()).toContain("活动甲");
    expect(
      wrapper.findAll(".form-main .return-loan-context-list"),
    ).toHaveLength(0);
  });

  it("lists each loan with its own borrower and activity in the confirmation dialog", async () => {
    const { wrapper, controller } = setupEditorView({
      lines: [returnLine("LINE-A", "LOAN-A"), returnLine("LINE-B", "LOAN-B")],
    });
    await flushPromises();
    controller.reviewOpen.value = true;
    await flushPromises();
    const dialog = wrapper.find(".overlay-stub");
    expect(dialog.findAll("li").map((item) => item.text())).toEqual([
      "原借出 LOAN-A · 借用方 借用方甲 · 活动 活动甲",
      "原借出 LOAN-B · 借用方 借用方乙 · 活动 活动乙",
    ]);
  });
});

describe("Return transaction context", () => {
  function mountContext(props: Record<string, unknown>) {
    const reference = referenceData();
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          {
            call: vi.fn(async () => ({})),
            report: vi.fn(),
            upload: vi.fn(),
          } as unknown as InventoryServices,
          reference,
        );
        return () => h(TransactionContext, props as never);
      },
    });
    const wrapper = mount(host);
    wrappers.push(wrapper);
    return wrapper;
  }

  it("shows each loan's activity read-only and leaves a single purpose field", () => {
    const wrapper = mountContext({
      mode: "edit",
      activityLabel: "",
      draft: {
        kind: "Return",
        source: "",
        purpose: "",
        activity: "",
        loanName: "LOAN-A",
      },
      returnLoanDetails: [
        { name: "LOAN-A", activityLabel: "活动甲" },
        { name: "LOAN-B", activityLabel: "活动乙" },
      ],
    });
    expect(wrapper.findAll("input")).toHaveLength(1);
    expect(
      wrapper.findAll("button").some((button) => button.text() === "新建活动"),
    ).toBe(false);
    expect(wrapper.text()).toContain("由原借用记录确定");
    expect(wrapper.text()).toContain("原借出 LOAN-B · 活动 活动乙");
  });

  it("keeps the activity row out of a Return detail", () => {
    const wrapper = mountContext({
      mode: "display",
      activityLabel: "",
      draft: {
        kind: "Return",
        source: "",
        purpose: "盘点归还",
        activity: "",
        loanName: "LOAN-A",
      },
    });
    const labels = wrapper.findAll("dt").map((node) => node.text());
    expect(labels).not.toContain("关联活动");
    expect(labels.filter((label) => label === "用途")).toHaveLength(1);
  });
});

describe("Return wire format and validation", () => {
  it("does not send header borrower or activity for a Return, but keeps them for a Loan", () => {
    const reference = referenceData();
    const giving = {
      ...newOperation("Return", reference),
      activity: "ACT-A",
      borrower: "借用方甲",
    };
    expect(encodeOperation(giving, reference)).not.toHaveProperty(
      "ti_borrower",
    );
    expect(encodeOperation(giving, reference)).not.toHaveProperty(
      "ti_activity",
    );
    const lending = {
      ...newOperation("Loan", reference),
      activity: "ACT-A",
      borrower: "借用方甲",
    };
    expect(encodeOperation(lending, reference)).toMatchObject({
      ti_borrower: "借用方甲",
      ti_activity: "ACT-A",
    });
  });

  it("accepts a Return whose loans have different borrowers and no header value", () => {
    const reference = referenceData();
    const draft: OperationDraft = {
      ...newOperation("Return", reference),
      postingDate: "2026-10-31",
      items: [
        returnLine("LINE-A", "LOAN-A"),
        returnLine("LINE-B", "LOAN-B", 1),
      ],
      loanName: "LOAN-A",
    };
    const stock = [
      {
        code: "ITEM-A",
        uom: "Nos",
        tracksBatch: false,
        tracksExpiry: false,
        locations: [],
      },
    ] as unknown as StockItem[];
    const issues = operationIssues(draft, {
      stock,
      units: reference.units,
      physicalLeaves: reference.physicalLeaves,
      leasedLeaves: reference.leasedLeaves,
      damagedLeaves: reference.damagedLeaves,
    });
    expect(issues).toEqual([]);
  });

  it("still requires a borrower on a Loan", () => {
    const reference = referenceData();
    const draft: OperationDraft = {
      ...newOperation("Loan", reference),
      postingDate: "2026-10-31",
      items: [],
    };
    const issues = operationIssues(draft, {
      stock: [],
      units: reference.units,
      physicalLeaves: reference.physicalLeaves,
      leasedLeaves: reference.leasedLeaves,
      damagedLeaves: reference.damagedLeaves,
    });
    expect(issues.map((issue) => issue.field)).toContain("borrower");
  });
});

describe("Return recovery summary", () => {
  it("shows each recovered line's own loan context instead of a blank header borrower", () => {
    const wrapper = mount(RecoverySummary, {
      props: {
        kind: "Stock Entry",
        copyText: "{}",
        values: {
          kind: "Return",
          ti_borrower: "",
          ti_activity: "",
          items: [
            {
              ...returnLine("LINE-A", "LOAN-A"),
              loanBorrower: "借用方甲",
              loanActivity: "ACT-A",
            },
            {
              ...returnLine("LINE-B", "LOAN-B", 1),
              loanBorrower: "借用方乙",
              loanActivity: "ACT-B",
            },
          ],
        },
      },
    });
    const labels = wrapper.findAll("dt").map((node) => node.text());
    expect(labels).not.toContain("借用方");
    expect(labels).not.toContain("关联活动");
    expect(wrapper.text()).toContain(
      "原借出 LOAN-A · 借用方 借用方甲 · 活动 ACT-A",
    );
    expect(wrapper.text()).toContain(
      "原借出 LOAN-B · 借用方 借用方乙 · 活动 ACT-B",
    );
  });
});
