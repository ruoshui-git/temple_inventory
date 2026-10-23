import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  useLoanDetail,
  type LoanDocument,
} from "../src/features/loans/useLoanDetail";
import LoanDetailView from "../src/features/loans/LoanDetailView.vue";
const wrappers: VueWrapper[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));
function loan(name = "LOAN-A", docstatus: 0 | 1 | 2 = 1): LoanDocument {
  return {
    name,
    doctype: "Stock Entry",
    version: "v1",
    kind: "Loan",
    docstatus,
    posting_date: "2026-10-01",
    posting_time: "13:22:33.123456",
    ti_borrower: "借用方甲",
    ti_activity: "ACT-A",
    activity_title: "秋季法会",
    balance_at: "2026-10-16 11:00:00",
    items: ["Nos", "Kg"].map((uom, index) => ({
      name: `${name}-CHILD-${index}`,
      item_code: `ITEM-${index}`,
      item_name: `物品${index}`,
      stock_uom: uom,
      uom,
      qty: 5,
      conversion_factor: 1,
      transfer_qty: 5,
      s_warehouse: `SOURCE-${index}`,
      t_warehouse: `LEASED-${index}`,
      outstanding_qty: docstatus === 1 ? 2 : 0,
      outcomes: { Returned: 1, Damaged: 1, Lost: 1 },
      allocations: [
        {
          batch_no: `BATCH-${index}`,
          borrowed_qty: 5,
          outstanding_qty: docstatus === 1 ? 2 : 0,
          outcomes: { Returned: 1, Damaged: 1, Lost: 1 },
        },
      ],
    })),
  };
}
function setup(
  call = vi.fn(async (endpoint, args) =>
    endpoint === "native_api.loan_detail"
      ? loan(args.name)
      : endpoint === "browse.movement_history"
        ? {
            rows: [
              {
                id: "RETURN-A",
                document: "RETURN-A",
                doctype: "Stock Entry",
                item_code: "ITEM-1",
                item_name: "物品1",
                date_time: "2026-10-02 09:00:00",
                kind: "Return",
                source_warehouse: "LEASED-1",
                destination_warehouse: "SOURCE-1",
                stock_uom: "Kg",
                docstatus: 1,
                quantity: -1,
                available_effect: 0,
                loan_balance_effect: -1,
                borrower: "借用方甲",
              },
            ],
            matched_count: 42,
            next_start: args.start ? null : 1,
          }
        : [],
  ),
  options: { view?: boolean; docstatus?: number } = {},
) {
  const props = reactive({ name: "LOAN-A" }),
    reference = createReferenceData();
  Object.assign(reference, {
    user: "volunteer",
    site: "unit-site",
    operations: { Return: true, Loss: true },
  });
  const report = vi.fn(async (query, paging) => ({
    query,
    table: "settlements",
    columns: ["document", "original_loan_line", "stock_qty"],
    rows: [
      {
        id: String(paging?.start || 0),
        document: "RETURN-A",
        doctype: "Stock Entry",
        original_loan_line: "LOAN-A-CHILD-1",
        stock_qty: 1,
      },
    ],
    matched_count: 42,
    next_start: paging?.start ? null : 1,
    tables: [{ id: "settlements", label: "结算明细", count: 42 }],
    summary: [],
    snapshot: "now",
    period: { date_from: "", date_to: "" },
  }));
  let c!: ReturnType<typeof useLoanDetail>;
  const settle = vi.fn();
  const child = defineComponent({
    setup() {
      c = useLoanDetail(props);
      return () =>
        options.view
          ? h(LoanDetailView, { controller: c, onSettle: settle })
          : h("div");
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report, upload: vi.fn() } as never,
        reference,
      );
      return () => h(child);
    },
  });
  const wrapper = mount(root);
  wrappers.push(wrapper);
  return { c, props, reference, report, call, wrapper, settle };
}
describe("native loan details", () => {
  it("keeps the loan detail in a neutral skeleton state before its first response", () => {
    const pending = new Promise(() => undefined);
    const call = vi.fn(() => pending);
    const { wrapper } = setup(call as never, { view: true });
    expect(wrapper.get("h1").text()).toBe("借用详情");
    expect(wrapper.find(".skeleton-block").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("借出记录不存在或无权访问");
  });

  it("shows exact original rows and independent stock units, with complete paged settlement history", async () => {
    const { c, wrapper, report, call, settle } = setup(undefined, {
      view: true,
    });
    await flushPromises();
    expect(
      c.metrics.value.find((metric) => metric.key === "outstanding")
        ?.quantities,
    ).toEqual([
      { uom: "Nos", qty: 2 },
      { uom: "Kg", qty: 2 },
    ]);
    expect(wrapper.text()).not.toContain("LOAN-A-CHILD-1");
    expect(wrapper.text()).toContain("BATCH-1");
    const historySummary = wrapper
      .findAll("summary")
      .find((summary) => summary.text().includes("处理历史"));
    expect(historySummary?.find(".ti-disclosure-section-count").text()).toBe(
      "42",
    );
    expect(c.history.result.rows).toHaveLength(1);
    expect(c.history.result.rows[0]?.document).toBe("RETURN-A");
    await c.history.loadMore();
    expect(
      call.mock.calls.some(
        ([endpoint, args]) =>
          endpoint === "browse.movement_history" && args.start === 1,
      ),
    ).toBe(true);
    const damaged = wrapper
      .findAll("button")
      .find((button) => button.text() === "登记损坏归还")!;
    await damaged.trigger("click");
    expect(settle).toHaveBeenCalledWith("LOAN-A", "damaged");
  });
  it("offers no settlement for draft/cancelled loans or missing native operation permissions", async () => {
    const { c, reference, props } = setup(
      vi.fn(async (endpoint, args) =>
        endpoint === "native_api.loan_detail"
          ? loan(args.name, args.name === "CANCELLED" ? 2 : 0)
          : [],
      ),
    );
    await flushPromises();
    expect(c.canSettle("returned")).toBe(false);
    expect(c.status.value).toBe("草稿");
    props.name = "CANCELLED";
    await flushPromises();
    expect(c.status.value).toBe("已取消");
    expect(c.canSettle("lost")).toBe(false);
    c.loan.value = loan();
    reference.operations.Return = false;
    expect(c.canSettle("returned")).toBe(false);
    expect(c.canSettle("lost")).toBe(true);
  });
  it("exports the viewed loan at its native status while settlement history stays submitted-only", async () => {
    const { c, props } = setup(
      vi.fn(async (endpoint, args) =>
        endpoint === "native_api.loan_detail"
          ? loan(args.name, args.name === "CANCELLED" ? 2 : 0)
          : [],
      ),
    );
    await flushPromises();
    expect(c.exportQuery.value.statuses).toEqual([0]);
    expect(c.historyQuery.value.statuses).toEqual([1]);
    props.name = "CANCELLED";
    await flushPromises();
    expect(c.exportQuery.value.statuses).toEqual([2]);
    expect(c.historyQuery.value.statuses).toEqual([1]);
  });
  it("rejects stale loan responses and clears unauthorized details and history on navigation", async () => {
    let resolve!: (value: LoanDocument) => void;
    const call = vi.fn((endpoint, args) =>
      endpoint === "native_api.loan_detail"
        ? args.name === "LOAN-A"
          ? new Promise<LoanDocument>((done) => (resolve = done))
          : Promise.reject(new Error("无权访问"))
        : Promise.resolve([]),
    );
    const { c, props, report } = setup(call);
    props.name = "DENIED";
    await flushPromises();
    resolve(loan());
    await flushPromises();
    expect(c.loan.value).toBeUndefined();
    expect(c.error.value).toBe("无权访问");
    expect(report).not.toHaveBeenCalled();
  });
  it("keeps authorized loan balances when attachments fail and retries without replacing the parent", async () => {
    let fail = true;
    const { c } = setup(
      vi.fn(async (endpoint, args) => {
        if (endpoint === "native_api.loan_detail") return loan(args.name);
        if (fail) throw new Error("附件读取失败");
        return [
          {
            name: "FILE-1",
            file_name: "凭证.pdf",
            file_url: "/private/files/proof.pdf",
          },
        ];
      }),
    );
    await flushPromises();
    expect(c.loan.value?.name).toBe("LOAN-A");
    expect(c.files.error.value).toBe("附件读取失败");
    fail = false;
    await c.loadFiles();
    expect(c.files.files[0]?.serverName).toBe("FILE-1");
    expect(c.files.error.value).toBe("");
  });
});
