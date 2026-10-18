import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import {
  createReferenceData,
  provideInventoryServices,
} from "../src/services/contracts";
import {
  useOperationBrowse,
  type OperationBrowsePage,
} from "../src/features/movements/useOperationBrowse";
import OperationBrowsePage from "../src/features/movements/OperationBrowsePage.vue";
import { newReportQuery } from "../src/lib/reportContract";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});
function page(): OperationBrowsePage {
  return {
    rows: [
      {
        id: "GROUP-A",
        item_code: "ITEM-A",
        item_name: "物品甲",
        category: "ROOT",
        stock_uom: "Nos",
        outcome_key: "outstanding",
        item_count: 1,
        document_count: 42,
        allocation_count: 50,
        totals: [
          { kind: "Loan", stock_uom: "Nos", stock_qty: 99, docstatus: 1 },
        ],
      },
    ],
    query: newReportQuery("loans"),
    matched_count: 10,
    next_start: 1,
    snapshot: "2026-10-16 10:00:00",
    summary: {
      item_count: 10,
      document_count: 42,
      category_count: 2,
      allocation_count: 205,
    },
    totals: [
      {
        kind: "Loan",
        outcome_key: "outstanding",
        stock_uom: "Nos",
        stock_qty: 999,
        docstatus: 1,
      },
    ],
    analysis: {
      category: {
        rows: [
          {
            id: "CATEGORY-A",
            category: "ROOT",
            stock_uom: "Nos",
            stock_qty: 999,
            document_count: 42,
            item_count: 10,
          },
        ],
        matched_count: 1,
        next_start: null,
      },
    },
  };
}
function setup(
  call: ReturnType<typeof vi.fn>,
  props = reactive<{
    family: "movements" | "loans";
    records: boolean;
    routeQuery?: string;
  }>({ family: "loans", records: false }),
  view = false,
) {
  let c!: ReturnType<typeof useOperationBrowse>;
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "unit-site",
    user: "volunteer",
    operations: { Return: true },
  });
  const changed = vi.fn();
  const child = defineComponent({
    setup() {
      c = useOperationBrowse(props, changed);
      return () => h("div");
    },
  });
  const root = defineComponent({
    setup() {
      provideInventoryServices(
        { call, report: vi.fn(), upload: vi.fn() },
        reference,
      );
      return () => (view ? h(OperationBrowsePage, props) : h(child));
    },
  });
  const wrapper = mount(root, { attachTo: document.body });
  wrappers.push(wrapper);
  return { c, wrapper, changed, reference, props };
}
function service() {
  return vi.fn(async (endpoint) => {
    if (endpoint === "browse.operation_page") return page();
    if (endpoint === "browse.operation_contributions")
      return {
        rows: [
          {
            id: "NATIVE-ROW-1",
            document: "LOAN-1",
            doctype: "Stock Entry",
            original_loan: "LOAN-1",
            original_loan_line: "ORIGINAL-1",
            stock_qty: 5,
          },
          {
            id: "NATIVE-ROW-2",
            document: "LOAN-2",
            doctype: "Stock Entry",
            original_loan: "LOAN-2",
            original_loan_line: "ORIGINAL-2",
            stock_qty: 4,
          },
        ],
        columns: ["document", "original_loan_line", "stock_qty"],
        matched_count: 42,
        next_start: 2,
      };
    throw new Error(`Unexpected ${endpoint}`);
  });
}
describe("native operation browsing", () => {
  it("keeps complete server groups and totals independent of the loaded page, then loads contributions lazily", async () => {
    const call = service(),
      { c } = setup(call);
    await flushPromises();
    expect(c.result.rows).toHaveLength(1);
    expect(c.result.total).toBe(10);
    expect(c.result.summary.document_count).toBe(42);
    expect(c.result.totals[0]?.stock_qty).toBe(999);
    expect(
      call.mock.calls.some(
        ([endpoint]) => endpoint === "browse.operation_contributions",
      ),
    ).toBe(false);
    const row = c.result.rows[0]!;
    c.toggle(row, true);
    await flushPromises();
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({
        item_code: "ITEM-A",
        outcome: "outstanding",
        records: false,
        start: 0,
      }),
      expect.any(AbortSignal),
    );
    expect(c.details[row.id]?.total).toBe(42);
    expect(c.details[row.id]?.rows).toHaveLength(2);
  });
  it("retains prior groups on load-more failure and retries the failed offset", async () => {
    const base = service(),
      call = vi
        .fn()
        .mockImplementationOnce(base)
        .mockRejectedValueOnce(new Error("load-more"))
        .mockResolvedValueOnce({
          ...page(),
          rows: [{ ...page().rows[0]!, id: "GROUP-B" }],
          next_start: null,
        });
    const { c } = setup(call);
    await flushPromises();
    await c.load(true);
    expect(c.result.error).toBe("load-more");
    expect(c.result.rows[0]?.id).toBe("GROUP-A");
    await c.retry();
    expect(call.mock.calls.at(-1)?.[1].start).toBe(1);
    expect(c.result.rows.map((row) => row.id)).toEqual(["GROUP-A", "GROUP-B"]);
  });
  it("ignores late scope responses and keeps restrictive-empty malformed route queries", async () => {
    let resolve!: (value: OperationBrowsePage) => void;
    const call = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<OperationBrowsePage>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(page());
    const { c } = setup(call);
    c.search.value = "new-scope";
    await flushPromises();
    resolve({ ...page(), rows: [{ ...page().rows[0]!, id: "OLD" }] });
    await flushPromises();
    expect(c.result.rows[0]?.id).toBe("GROUP-A");
    const malformed = service(),
      state = setup(
        malformed,
        reactive({
          family: "movements" as const,
          records: true,
          routeQuery: '{"dataset":"movements","scope":{"warehouses":[3]}}',
        }),
      );
    await flushPromises();
    expect(state.c.routeError.value).toBeTruthy();
    expect(malformed.mock.calls[0]?.[1].query).toMatchObject({
      restrictItems: true,
      itemCodes: [],
    });
  });
  it("renders inherited restriction chips and removes only the selected condition", async () => {
    const query = newReportQuery("loans");
    Object.assign(query, {
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      loan: "LOAN-EXACT",
      search: "typed",
    });
    const { wrapper } = setup(
      service(),
      reactive({
        family: "loans" as const,
        records: false,
        routeQuery: JSON.stringify(query),
      }),
      true,
    );
    await flushPromises();
    const chips = wrapper.get(".compact-filter-chips");
    expect(chips.text()).toContain("LOAN-EXACT");
    const item = chips
      .findAll("button")
      .find((button) => button.text().includes("ITEM-A"))!;
    expect(item).toBeTruthy();
    await item.trigger("click");
    const current =
      wrapper.getComponent(OperationBrowsePage).vm.controller.query.value;
    expect(current.restrictItems).toBe(false);
    expect(current.itemCodes).toEqual([]);
    expect(current.loan).toBe("LOAN-EXACT");
    expect(current.search).toBe("typed");
  });
  it("keeps inherited restrictions through view changes and clears only secondary restrictions", async () => {
    const query = newReportQuery("loans");
    Object.assign(query, {
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      search: "typed",
      loan: "LOAN-EXACT",
      loanOutcome: "outstanding",
      sortBy: "name",
      sort: "asc",
    });
    query.scope.period.key = "this_month";
    const { c } = setup(
      service(),
      reactive({
        family: "loans" as const,
        records: false,
        routeQuery: JSON.stringify(query),
      }),
    );
    await flushPromises();
    expect(c.viewQuery(true)).toMatchObject({
      view: "records",
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      loan: "LOAN-EXACT",
      loanOutcome: "outstanding",
    });
    expect(c.loanHistory()).toMatchObject({
      dataset: "movements",
      view: "records",
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      loan: "LOAN-EXACT",
      scope: { kinds: ["Loan", "Return", "Damage", "Loss"] },
    });
    c.clearSecondary();
    expect(c.query.value.search).toBe("typed");
    expect(c.query.value.scope.period.key).toBe("this_month");
    expect(c.query.value.loanOutcome).toBe("outstanding");
    expect(c.query.value.loan).toBe("");
    expect(c.query.value.restrictItems).toBe(false);
  });
  it("expands an aggregate Item without choosing an arbitrary loan and settles only the explicitly selected native source", async () => {
    const { wrapper } = setup(
      service(),
      reactive({ family: "loans" as const, records: false }),
      true,
    );
    await flushPromises();
    const surface = wrapper.findComponent(OperationBrowsePage);
    await wrapper.get(".preview-group-trigger").trigger("click");
    await flushPromises();
    expect(surface.emitted("openLoan")).toBeUndefined();
    const buttons = wrapper
      .findAll("button")
      .filter((button) => button.text() === "登记归还");
    expect(buttons).toHaveLength(2);
    await buttons[1]!.trigger("click");
    expect(surface.emitted("settle")).toEqual([["LOAN-2"]]);
  });
});
