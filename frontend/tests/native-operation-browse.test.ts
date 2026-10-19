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
            kind: "Loan",
            can_settle: true,
            original_loan: "LOAN-1",
            original_loan_line: "ORIGINAL-1",
            stock_qty: 5,
          },
          {
            id: "NATIVE-ROW-2",
            document: "LOAN-2",
            doctype: "Stock Entry",
            kind: "Loan",
            can_settle: true,
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
  it("retries failed contribution reads and retries page failures at the same offset", async () => {
    const successPage = {
      rows: [
        {
          id: "HISTORY-1",
          document: "SE-1",
          doctype: "Stock Entry",
          quantity: 1,
        },
      ],
      matched_count: 2,
      next_start: 1,
    };
    const call = vi.fn(async (endpoint, args) => {
      if (endpoint === "browse.operation_page") return page();
      if (endpoint === "browse.movement_history") {
        if (
          args.start === 0 &&
          call.mock.calls.filter(([name]) => name === endpoint).length === 1
        )
          throw new Error("initial failure");
        if (
          args.start === 1 &&
          call.mock.calls.filter(([name]) => name === endpoint).length === 3
        )
          throw new Error("page failure");
        if (
          args.start === 0 &&
          call.mock.calls.filter(([name]) => name === endpoint).length === 5
        )
          throw new Error("refresh failure");
        return {
          ...successPage,
          rows: [{ ...successPage.rows[0]!, id: `HISTORY-${args.start}` }],
          next_start: args.start === 0 ? 1 : null,
        };
      }
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { c } = setup(
      call,
      reactive({ family: "movements" as const, records: false }),
    );
    await flushPromises();
    const row = c.result.rows[0]!;
    c.toggle(row, true);
    await flushPromises();
    expect(c.details[row.id]?.error).toBe("initial failure");
    c.retryDetails(row);
    await flushPromises();
    expect(c.details[row.id]?.rows).toHaveLength(1);
    await c.loadDetails(row, true);
    expect(c.details[row.id]?.error).toBe("page failure");
    c.retryDetails(row);
    await flushPromises();
    await c.loadDetails(row, false, true);
    expect(c.details[row.id]?.error).toBe("refresh failure");
    c.retryDetails(row);
    await flushPromises();
    const starts = call.mock.calls
      .filter(([endpoint]) => endpoint === "browse.movement_history")
      .map(([, args]) => args.start);
    expect(starts).toEqual([0, 0, 1, 1, 0, 0]);
    expect(c.details[row.id]?.rows.map((entry) => entry.id)).toEqual([
      "HISTORY-0",
    ]);
  });

  it("keeps the item/record switch in the persistent title slot when browse tools collapse", async () => {
    const { wrapper } = setup(
      service(),
      reactive({ family: "movements" as const, records: false }),
      true,
    );
    await flushPromises();
    const toolbar = wrapper.get(".refined-toolbar");
    const switcher = wrapper.get(".browse-view-switch");
    expect(switcher.element.closest(".app-page-title-row")).toBeTruthy();
    toolbar.element.classList.add("is-compact");
    await flushPromises();
    expect(wrapper.get(".browse-view-switch").text()).toContain("按记录");
    await wrapper
      .findAll(".browse-view-switch button")
      .find((button) => button.text() === "按记录")!
      .trigger("click");
    expect(
      wrapper
        .getComponent(OperationBrowsePage)
        .emitted("switchView")
        ?.at(-1)?.[0],
    ).toBe(true);
  });
  it("keeps the date header and direction control synchronized for record sorting", async () => {
    const { wrapper } = setup(
      service(),
      reactive({ family: "movements" as const, records: true }),
      true,
    );
    await flushPromises();
    const c = wrapper.getComponent(OperationBrowsePage).vm.controller;
    expect(c.query.value.sortBy).toBe("date");
    expect(c.query.value.sort).toBe("desc");
    expect(wrapper.get('select[aria-label="流动排序"]').element.value).toBe(
      "date",
    );
    expect(wrapper.get('th[aria-sort="descending"] button').text()).toContain(
      "日期 ↓",
    );

    await wrapper.get('button[aria-label="切换为升序"]').trigger("click");
    expect(c.query.value.sort).toBe("asc");
    expect(wrapper.get('select[aria-label="流动排序"]').element.value).toBe(
      "date",
    );
    expect(wrapper.get('th[aria-sort="ascending"] button').exists()).toBe(true);

    await wrapper.get('th[aria-sort="ascending"] button').trigger("click");
    expect(c.query.value.sort).toBe("desc");
    expect(wrapper.get('button[aria-label="切换为升序"]').exists()).toBe(true);
  });

  it("keeps loan record and item sort fields selected while changing fields and direction", async () => {
    const call = service();
    const { wrapper } = setup(
      call,
      reactive({ family: "loans" as const, records: false }),
      true,
    );
    await flushPromises();
    const c = wrapper.getComponent(OperationBrowsePage).vm.controller;
    const select = wrapper.get('select[aria-label="借用排序"]');
    expect(select.element.value).toBe("name");
    await select.setValue("quantity");
    expect(c.query.value.sortBy).toBe("quantity");
    expect(select.element.value).toBe("quantity");
    expect(c.query.value.sort).toBe("asc");
    await wrapper.get('button[aria-label="切换为降序"]').trigger("click");
    expect(c.query.value.sortBy).toBe("quantity");
    expect(c.query.value.sort).toBe("desc");
    await select.setValue("name");
    expect(c.query.value.sortBy).toBe("name");
    expect(select.element.value).toBe("name");
    expect(c.query.value.sort).toBe("desc");

    const recordView = setup(
      service(),
      reactive({ family: "loans" as const, records: true }),
      true,
    );
    await flushPromises();
    const records =
      recordView.wrapper.getComponent(OperationBrowsePage).vm.controller;
    const recordSort = recordView.wrapper.get('select[aria-label="借用排序"]');
    expect(records.query.value.sortBy).toBe("date");
    expect(recordSort.element.value).toBe("date");
    await recordView.wrapper
      .get('button[aria-label="切换为升序"]')
      .trigger("click");
    expect(records.query.value.sortBy).toBe("date");
    expect(recordSort.element.value).toBe("date");
  });

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
        history_scope: "outstanding",
        records: false,
        start: 0,
      }),
      expect.any(AbortSignal),
    );
    expect(c.details[row.id]?.total).toBe(42);
    expect(c.details[row.id]?.rows).toHaveLength(2);
    c.setHistoryScope(row, "all");
    await flushPromises();
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({ item_code: "ITEM-A", history_scope: "all" }),
      expect.any(AbortSignal),
    );
    expect(c.historyScopes[row.id]).toBe("all");
  });
  it("defaults settled item history to all and requests the matching scope", async () => {
    const base = service();
    const call = vi.fn(async (endpoint, args, signal) => {
      if (endpoint === "browse.operation_page") {
        const result = await base(endpoint, args, signal);
        return { ...result, rows: [{ ...result.rows[0], stock_qty: 0 }] };
      }
      return base(endpoint, args, signal);
    });
    const { c } = setup(call);
    await flushPromises();
    const row = c.result.rows[0]!;
    c.toggle(row, true);
    await flushPromises();
    expect(c.historyScopes[row.id]).toBe("all");
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({ item_code: "ITEM-A", history_scope: "all" }),
      expect.any(AbortSignal),
    );
  });
  it("switches an expanded card to all history when a refresh settles it", async () => {
    let pages = 0;
    const base = service();
    const call = vi.fn(async (endpoint, args, signal) => {
      if (endpoint === "browse.operation_page") {
        pages += 1;
        const result = await base(endpoint, args, signal);
        return {
          ...result,
          rows: [{ ...result.rows[0], stock_qty: pages === 1 ? 3 : 0 }],
        };
      }
      return base(endpoint, args, signal);
    });
    const { c } = setup(call);
    await flushPromises();
    const row = c.result.rows[0]!;
    c.toggle(row, true);
    await flushPromises();
    expect(c.historyScopes[row.id]).toBe("outstanding");
    await c.load();
    await flushPromises();
    expect(c.historyScopes[row.id]).toBe("all");
    expect(call.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ history_scope: "all" }),
    );
  });
  it("renders all history as the settled-card default and requests that scope", async () => {
    const base = service();
    const call = vi.fn(async (endpoint, args, signal) => {
      if (endpoint === "browse.operation_page") {
        const result = await base(endpoint, args, signal);
        return { ...result, rows: [{ ...result.rows[0], stock_qty: 0 }] };
      }
      return base(endpoint, args, signal);
    });
    const { wrapper } = setup(
      call,
      reactive({ family: "loans" as const, records: false }),
      true,
    );
    await flushPromises();
    const controller = wrapper.getComponent(OperationBrowsePage).vm.controller;
    const row = controller.result.rows[0]!;
    controller.toggle(row, true);
    await flushPromises();
    expect(wrapper.get(".loan-history-scope select").element.value).toBe("all");
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({ history_scope: "all", item_code: "ITEM-A" }),
      expect.any(AbortSignal),
    );
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
  it("ignores a late response after changing one card's history scope", async () => {
    let resolveOutstanding!: (value: {
      rows: { id: string }[];
      columns: string[];
      matched_count: number;
      next_start: null;
    }) => void;
    const call = vi.fn(async (endpoint, args) => {
      if (endpoint === "browse.operation_page") return page();
      if (endpoint === "browse.operation_contributions") {
        if (args.history_scope === "outstanding")
          return new Promise((resolve) => (resolveOutstanding = resolve));
        return {
          rows: [{ id: "ALL-SCOPE" }],
          columns: ["document"],
          matched_count: 1,
          next_start: null,
        };
      }
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { c } = setup(call);
    await flushPromises();
    const row = c.result.rows[0]!;
    c.toggle(row, true);
    c.setHistoryScope(row, "all");
    await flushPromises();
    expect(c.details[row.id]?.rows).toEqual([{ id: "ALL-SCOPE" }]);
    resolveOutstanding({
      rows: [{ id: "OLD-SCOPE" }],
      columns: ["document"],
      matched_count: 1,
      next_start: null,
    });
    await flushPromises();
    expect(c.details[row.id]?.rows).toEqual([{ id: "ALL-SCOPE" }]);
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
  it("removes scalar item and activity scope chips", async () => {
    const query = newReportQuery("movements");
    query.scope.item = "ITEM-A";
    query.scope.activity = "ACTIVITY-A";
    const { wrapper } = setup(
      service(),
      reactive({
        family: "movements" as const,
        records: false,
        routeQuery: JSON.stringify(query),
      }),
      true,
    );
    await flushPromises();
    const chips = wrapper.get(".compact-filter-chips");
    await chips.get('button[aria-label="移除物品：ITEM-A"]').trigger("click");
    await wrapper
      .get('.compact-filter-chips button[aria-label="移除活动：ACTIVITY-A"]')
      .trigger("click");
    const current =
      wrapper.getComponent(OperationBrowsePage).vm.controller.query.value;
    expect(current.scope.item).toBe("");
    expect(current.scope.activity).toBe("");
  });
  it("normalizes route sort fields that the active view cannot sort", async () => {
    const query = newReportQuery("movements");
    query.view = "records";
    query.sortBy = "quantity";
    const { c } = setup(
      service(),
      reactive({
        family: "movements" as const,
        records: true,
        routeQuery: JSON.stringify(query),
      }),
    );
    await flushPromises();
    expect(c.query.value.sortBy).toBe("date");
    expect(c.query.value.sort).toBe("desc");
    expect(c.query.value.scope).toEqual(query.scope);
  });
  it("clears editable filters while retaining route allocation scope and toolbar state", async () => {
    const query = newReportQuery("loans");
    Object.assign(query, {
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      itemLocationKeys: [JSON.stringify(["ITEM-A", "ROOM-A"])],
      search: "typed",
      loan: "LOAN-EXACT",
      record: "RECORD-EXACT",
      recordDoctype: "Stock Entry",
      restrictAllocations: true,
      allocationKeys: ["ALLOC-EXACT"],
      loanOutcome: "outstanding",
      sortBy: "name",
      sort: "asc",
    });
    query.scope.period.key = "this_month";
    query.scope.categories = ["CATEGORY-A"];
    query.scope.warehouses = ["ROOM-A"];
    query.scope.item = "ITEM-SCOPE";
    query.scope.activity = "ACTIVITY-SCOPE";
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
      loanOutcome: "all",
    });
    expect(c.loanHistory()).toMatchObject({
      dataset: "movements",
      view: "records",
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      loan: "LOAN-EXACT",
      scope: { kinds: ["Loan", "Return", "Damage", "Loss"] },
    });
    c.clearFilters();
    expect(c.query.value.search).toBe("typed");
    expect(c.query.value.scope.period.key).toBe("all");
    expect(c.query.value.scope.categories).toEqual([]);
    expect(c.query.value.scope.warehouses).toEqual([]);
    expect(c.query.value.scope.item).toBe("");
    expect(c.query.value.scope.activity).toBe("");
    expect(c.query.value.loanOutcome).toBe("all");
    expect(c.query.value.outstandingOnly).toBe(false);
    expect(c.query.value.loan).toBe("LOAN-EXACT");
    expect(c.query.value.restrictItems).toBe(true);
    expect(c.query.value.itemCodes).toEqual(["ITEM-A"]);
    expect(c.viewQuery(true).itemLocationKeys).toEqual([
      JSON.stringify(["ITEM-A", "ROOM-A"]),
    ]);
    expect(c.viewQuery(true)).toMatchObject({
      loan: "LOAN-EXACT",
      record: "RECORD-EXACT",
      recordDoctype: "Stock Entry",
    });
    expect(c.query.value.restrictAllocations).toBe(true);
    expect(c.query.value.allocationKeys).toEqual(["ALLOC-EXACT"]);
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
