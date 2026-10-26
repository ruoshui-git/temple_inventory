// @vitest-environment jsdom
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
import { newReportQuery, type ReportQuery } from "../src/lib/reportContract";
import { createRecoveryStore } from "../src/lib/browserRecovery";
const wrappers: VueWrapper[] = [];
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
  if (originalScrollIntoView)
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
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
    initialQuery?: ReportQuery;
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
function service(operationPage = page()) {
  return vi.fn(async (endpoint, args) => {
    if (endpoint === "temple_inventory.projections.group_page") {
      const path = args.parent_path || [];
      return {
        rows: path.length
          ? [
              {
                id: "ITEM-LEAF",
                row_grain: "record",
                item_code: "ITEM-A",
                item_name: "物品甲",
                stock_uom: "Nos",
              },
            ]
          : [
              {
                id: "PROJECTION-ITEM-A",
                row_grain: "group",
                group_field: "item",
                group_path: ["ITEM-A"],
                group_depth: 1,
                group_label: "物品甲",
                item_code: "ITEM-A",
                item_name: "物品甲",
                has_children: true,
                stock_uom: "Nos",
                item_count: 1,
                document_count: 42,
                allocation_count: 50,
                row_count: 42,
                borrowed: 2,
                outstanding: 1,
                stock_qty: 2,
              },
            ],
        matched_count: 1,
        next_start: null,
        parent_path: path,
        parent_unit: args.parent_unit || null,
        row_grain: path.length ? "record" : "group",
        query: args.query,
      };
    }
    if (endpoint === "browse.operation_page") return operationPage;
    if (endpoint === "browse.movement_history")
      return {
        rows: [
          {
            id: "movement-history-row",
            document: "STE-MOVE-1",
            doctype: "Stock Entry",
            kind: "Receive",
            date_time: "2026-10-20 09:00:00",
            stock_qty: 7,
            available_effect: 7,
            stock_uom: "Nos",
            item_code: "ITEM-A",
            item_name: "物品甲",
            docstatus: 1,
          },
        ],
        matched_count: 1,
        next_start: null,
        history_complete: true,
      };
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
            quantity: 5,
            signed: true,
            stock_uom: "Nos",
            outstanding: 5,
            loan_status: "Open",
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
            quantity: 4,
            signed: true,
            stock_uom: "Nos",
            outstanding: 4,
            loan_status: "Open",
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
  it("preserves an outstanding-only loan chooser query from dashboard navigation", async () => {
    const query = newReportQuery("loans");
    query.view = "items";
    query.outstandingOnly = true;
    query.statuses = [1];
    const { c } = setup(
      service(),
      reactive({
        family: "loans" as const,
        records: false,
        routeQuery: JSON.stringify(query),
      }),
    );
    await flushPromises();
    expect(c.query.value.outstandingOnly).toBe(true);
    expect(c.query.value.statuses).toEqual([1]);
  });

  it("uses paginated flat group metadata for thumbnail identity after the first page", async () => {
    const rows = Array.from({ length: 35 }, (_, index) => ({
      id: `item:${index + 1}`,
      row_grain: "group",
      group_field: "item",
      group_path: [`ITEM-${index + 1}`],
      group_depth: 1,
      group_label: `物品${index + 1}`,
      item_code: `ITEM-${index + 1}`,
      item_name: `物品${index + 1}`,
      image: `/private/files/item-${index + 1}.webp`,
      has_children: true,
      stock_uom: "Nos",
      item_count: 1,
      document_count: 1,
    }));
    const call = vi.fn(async (endpoint, args) => {
      if (endpoint === "temple_inventory.projections.group_page") {
        const start = Number(args.start || 0);
        return {
          rows: rows.slice(start, start + 30),
          matched_count: rows.length,
          next_start: start + 30 < rows.length ? start + 30 : null,
          parent_path: [],
          parent_unit: null,
          row_grain: "group",
          query: args.query,
        };
      }
      if (endpoint === "browse.operation_page") return page();
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { c } = setup(call);
    await flushPromises();
    expect(c.groups.entries.value).toHaveLength(30);
    await c.groups.loadMore();
    expect(c.groups.entries.value).toHaveLength(35);
    const last = c.groups.entries.value.at(-1);
    expect(last?.kind).toBe("group");
    if (last?.kind !== "group") throw new Error("Expected a grouped item row");
    expect(c.stockItem(last.value as never)).toMatchObject({
      code: "ITEM-35",
      name: "物品35",
      image: "/private/files/item-35.webp",
    });
  });

  it("builds both view resets from family defaults and leaves the active view untouched", async () => {
    const props = reactive({ family: "loans" as const, records: false });
    const query = newReportQuery("loans");
    Object.assign(query, {
      search: "held text",
      loan: "LOAN-1",
      restrictItems: true,
      itemCodes: ["ITEM-A"],
      groupBy: ["borrower"],
      sortBy: "borrower",
    });
    props.initialQuery = query;
    const { c } = setup(service(), props);
    await flushPromises();
    const records = c.viewQuery(true);
    expect(records).toMatchObject({
      dataset: "loans",
      view: "records",
      search: "",
      loan: "",
      restrictItems: false,
      itemCodes: [],
      groupBy: [],
      sortBy: "date",
      sort: "desc",
    });

    props.records = true;
    await flushPromises();
    expect(c.viewQuery(true)).toEqual(c.query.value);
    const items = c.viewQuery(false);
    expect(items).toMatchObject({
      view: "items",
      search: "",
      loan: "",
      restrictItems: false,
      itemCodes: [],
      groupBy: ["item"],
      sortBy: "item_name",
      sort: "asc",
      includeZero: false,
    });
  });
  it("cancels outstanding operation and group reads and clears history state on view reset", async () => {
    const signals: AbortSignal[] = [];
    const call = vi.fn(
      (
        _endpoint: string,
        _args: Record<string, unknown>,
        signal?: AbortSignal,
      ) =>
        new Promise<never>((_resolve, reject) => {
          if (signal) {
            signals.push(signal);
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }
        }),
    );
    const props = reactive({ family: "loans" as const, records: false });
    const { c } = setup(call, props);
    c.expanded.add("ITEM-A");
    c.dimension.value = "kind";
    c.setDetailSort({ id: "ITEM-A" } as never, "item_name");
    void c.load();
    await flushPromises();

    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(c.viewQuery(true).groupBy).toEqual([]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(c.expanded.size).toBe(0);
    expect(c.dimension.value).toBe("category");
    expect(c.detailSortBy({ id: "ITEM-A" } as never)).toBe("date");
    expect(c.detailSortDirection({ id: "ITEM-A" } as never)).toBe("desc");
  });
  it("loads and renders flat Movement Item history for the canonical summary view", async () => {
    const query = newReportQuery("movements");
    query.view = "summary";
    query.groupBy = [];
    const call = service();
    const { wrapper } = setup(
      call,
      reactive({
        family: "movements" as const,
        records: false,
        initialQuery: query,
      }),
      true,
    );
    await flushPromises();
    expect(call).toHaveBeenCalledWith(
      "browse.movement_history",
      expect.objectContaining({
        query: expect.objectContaining({ view: "lines", groupBy: [] }),
        sort_by: "date",
        sort: "desc",
        start: 0,
      }),
      expect.any(AbortSignal),
    );
    const controller = wrapper.getComponent(OperationBrowsePage).vm.controller;
    expect(controller.details["flat-history-scope"]?.rows).toHaveLength(1);
    expect(wrapper.text()).toContain("STE-MOVE-1");
    expect(wrapper.text()).toContain("可用库存增加 7 Nos");
  });
  it("renders grouped native records in the shared table and loads whole-document leaves", async () => {
    const query = newReportQuery("loans");
    query.view = "records";
    query.groupBy = ["borrower"];
    const call = vi.fn(async (endpoint, args) => {
      if (endpoint === "temple_inventory.projections.group_page") {
        if (!(args.parent_path || []).length)
          return {
            rows: [
              {
                id: "borrower-group",
                row_grain: "group",
                group_path: ["BORROWER-A"],
                group_depth: 1,
                group_label: "借用方甲",
                document_count: 1,
                has_children: true,
                stock_uom: "Nos",
              },
            ],
            matched_count: 1,
            next_start: null,
          };
        return {
          rows: [
            {
              id: "Stock Entry:SE-1:Nos",
              row_grain: "record",
              doctype: "Stock Entry",
              document: "SE-1",
              borrower: "BORROWER-A",
              docstatus: 1,
              stock_uom: "Nos",
              whole: {
                quantities: [{ uom: "Nos", qty: 3 }],
                branches: [{ source: "ROOM-A", destination: "LOAN" }],
                original_loans: [],
                loan_status: "Open",
              },
              can_settle: true,
            },
          ],
          matched_count: 1,
          next_start: null,
        };
      }
      if (endpoint === "browse.operation_page")
        return { ...page(), rows: [], matched_count: 1, next_start: null };
      throw new Error(`Unexpected ${endpoint}`);
    });
    const { wrapper } = setup(
      call,
      reactive({
        family: "loans" as const,
        records: true,
        routeQuery: JSON.stringify(query),
      }),
      true,
    );
    await flushPromises();
    expect(wrapper.findAll(".data-table table")).toHaveLength(1);
    expect(wrapper.text()).toContain("借用方甲");
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".data-table table")).toHaveLength(1);
    expect(wrapper.get(".browse-row-link").text()).toBe("SE-1");
    expect(wrapper.find("tbody").text()).not.toContain("借用数量与结余");
  });

  it.each([1440, 1024])(
    "keeps loan item identity first and metrics in their columns at %ipx",
    async (width) => {
      const previousInnerWidth = Object.getOwnPropertyDescriptor(
        window,
        "innerWidth",
      );
      const previousMatchMedia = globalThis.matchMedia;
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: width,
      });
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("min-width") ? width >= 1024 : false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
      try {
        const query = newReportQuery("loans");
        query.view = "items";
        query.groupBy = ["item"];
        const { wrapper } = setup(
          service(),
          reactive({
            family: "loans" as const,
            records: false,
            initialQuery: query,
          }),
          true,
        );
        await flushPromises();
        const row = wrapper.get(".data-table-group-row");
        const identity = row.get(".data-table-group-identity").text();
        expect(identity).toContain("物品甲");
        expect(identity).not.toContain("借出 2 Nos");
        expect(identity).not.toContain("未归还 1 Nos");
        const cells = row.findAll("td").map((cell) => cell.text());
        expect(cells).toContain("借出 2 Nos");
        expect(cells).toContain("未归还 1 Nos");
        expect(
          row
            .findAll(".operation-group-metrics[title]")
            .map((cell) => cell.attributes("title")),
        ).toContain("借出 2 Nos · 未归还 1 Nos");
      } finally {
        if (previousInnerWidth)
          Object.defineProperty(window, "innerWidth", previousInnerWidth);
        else Reflect.deleteProperty(window, "innerWidth");
        vi.stubGlobal("matchMedia", previousMatchMedia);
      }
    },
  );

  it("shows loan settlement status only for Loan records and keeps malformed Loan unknown", async () => {
    const query = newReportQuery("loans");
    query.view = "records";
    query.groupBy = [];
    const base = {
      doctype: "Stock Entry" as const,
      docstatus: 1,
      date: "2026-10-21",
      stock_uom: "Nos",
      stock_qty: 1,
      whole: { quantities: [{ uom: "Nos", qty: 1 }], branches: [] },
    };
    const operationPage = {
      ...page(),
      query,
      rows: [
        {
          ...base,
          id: "return",
          document: "MAT-STE-2026-000010",
          kind: "Return",
        },
        { ...base, id: "loss", document: "MAT-STE-2026-000012", kind: "Loss" },
        { ...base, id: "loan", document: "MALFORMED-LOAN", kind: "Loan" },
      ],
      matched_count: 3,
      next_start: null,
    } satisfies OperationBrowsePage;
    const { wrapper } = setup(
      service(operationPage),
      reactive({
        family: "loans" as const,
        records: true,
        routeQuery: JSON.stringify(query),
      }),
      true,
    );
    await flushPromises();
    const headers = wrapper.findAll("thead th");
    const statusIndex = headers.findIndex((header) =>
      header.text().startsWith("状态"),
    );
    expect(statusIndex).toBeGreaterThanOrEqual(0);
    const status = wrapper
      .findAll("tbody tr")
      .map((row) => row.findAll("td")[statusIndex]?.text());
    expect(status).toEqual(["已提交", "已提交", "已提交借用状态未知"]);
  });

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
  it("uses the sortable date header as the single record sort control", async () => {
    const { wrapper } = setup(
      service(),
      reactive({ family: "movements" as const, records: true }),
      true,
    );
    await flushPromises();
    const c = wrapper.getComponent(OperationBrowsePage).vm.controller;
    expect(c.query.value.sortBy).toBe("date");
    expect(c.query.value.sort).toBe("desc");
    expect(wrapper.find('select[aria-label="流动排序"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="切换为升序"]').exists()).toBe(
      false,
    );
    expect(wrapper.get('th[aria-sort="descending"] button').text()).toContain(
      "日期↓",
    );

    await wrapper.get('th[aria-sort="descending"] button').trigger("click");
    expect(c.query.value.sort).toBe("asc");
    expect(wrapper.get('th[aria-sort="ascending"] button').exists()).toBe(true);

    await wrapper.get('th[aria-sort="ascending"] button').trigger("click");
    expect(c.query.value.sort).toBe("desc");
    expect(wrapper.find('select[aria-label="流动排序"]').exists()).toBe(false);
  });

  it("uses the sort chip for loan item cards and table headers for loan records", async () => {
    const call = service();
    const { wrapper } = setup(
      call,
      reactive({ family: "loans" as const, records: false }),
      true,
    );
    await flushPromises();
    const c = wrapper.getComponent(OperationBrowsePage).vm.controller;
    expect(c.query.value.sortBy).toBe("item_name");
    expect(
      wrapper.find('button[aria-label="排序：物品名称，A→Z"]').exists(),
    ).toBe(true);
    expect(wrapper.find(".data-table th button").exists()).toBe(false);

    const recordView = setup(
      service(),
      reactive({ family: "loans" as const, records: true }),
      true,
    );
    await flushPromises();
    const records =
      recordView.wrapper.getComponent(OperationBrowsePage).vm.controller;
    expect(records.query.value.sortBy).toBe("date");
    expect(
      recordView.wrapper.find('select[aria-label="借用排序"]').exists(),
    ).toBe(false);
    await recordView.wrapper
      .get('th[aria-sort="descending"] button')
      .trigger("click");
    expect(records.query.value.sortBy).toBe("date");
    expect(records.query.value.sort).toBe("asc");
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
        query: expect.objectContaining({ view: "items" }),
        item_code: "ITEM-A",
        history_scope: "outstanding",
        history_sort_by: "date",
        history_sort: "desc",
        records: false,
        start: 0,
      }),
      expect.any(AbortSignal),
    );
    expect(c.details[row.id]?.total).toBe(42);
    expect(c.details[row.id]?.rows).toHaveLength(2);
    c.setHistoryScope("all");
    await flushPromises();
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({ item_code: "ITEM-A", history_scope: "all" }),
      expect.any(AbortSignal),
    );
    expect(c.historyScope.value).toBe("all");
  });
  it("loads ungrouped Loan Item history for the entire filtered Item scope", async () => {
    const query = newReportQuery("loans");
    query.view = "items";
    query.groupBy = [];
    const call = service();
    const { c } = setup(
      call,
      reactive({
        family: "loans" as const,
        records: false,
        initialQuery: query,
      }),
    );
    await flushPromises();
    const request = call.mock.calls.find(
      ([endpoint, args]) =>
        endpoint === "browse.operation_contributions" &&
        args.query?.groupBy?.length === 0,
    );
    expect(request?.[1]).toMatchObject({
      query: expect.objectContaining({ view: "items", groupBy: [] }),
      history_scope: "outstanding",
      history_sort_by: "date",
      history_sort: "desc",
    });
    expect(request?.[1]).not.toHaveProperty("item_code");
    expect(c.details["flat-history-scope"]?.rows).toHaveLength(2);
    c.setHistoryScope("all");
    await flushPromises();
    expect(call.mock.calls.at(-1)?.[1]).toMatchObject({ history_scope: "all" });
    c.setDetailSort(
      { id: "flat-history-scope", document_count: 0, item_count: 0 },
      "document",
    );
    await flushPromises();
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({
        history_sort_by: "document",
        history_sort: "asc",
      }),
      expect.any(AbortSignal),
    );
  });
  it("reloads expanded terminal groups outside the root page when the shared history sort changes", async () => {
    const call = service();
    const { c } = setup(call);
    await flushPromises();
    const terminal = {
      id: "terminal-item-outside-root-page",
      item_code: "ITEM-B",
      document_count: 0,
      item_count: 0,
    };
    c.toggle(terminal, true);
    await flushPromises();
    expect(c.details[terminal.id]?.initialized).toBe(true);
    c.setDetailSort(terminal, "document");
    await flushPromises();
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({
        item_code: "ITEM-B",
        history_sort_by: "document",
        history_sort: "asc",
      }),
      expect.any(AbortSignal),
    );
  });
  it("renders flat native history values in the shared Item history table", async () => {
    const query = newReportQuery("loans");
    query.view = "items";
    query.groupBy = [];
    const { wrapper } = setup(
      service(),
      reactive({
        family: "loans" as const,
        records: false,
        initialQuery: query,
      }),
      true,
    );
    await flushPromises();
    expect(wrapper.text()).toContain("LOAN-1");
    expect(wrapper.text()).toContain("+5");
    expect(wrapper.find(".loan-history-scope").exists()).toBe(false);
    expect(wrapper.text()).toContain("LOAN-2");
    expect(
      wrapper.findAll("tbody tr").filter((row) => /LOAN-[12]/.test(row.text())),
    ).toHaveLength(2);
  });
  it("renders each outstanding amount once and leaves it blank on non-Loan history", async () => {
    const query = newReportQuery("loans");
    query.view = "items";
    query.groupBy = [];
    const base = service();
    const call = vi.fn(async (endpoint, args, signal) => {
      const result = await base(endpoint, args, signal);
      if (endpoint !== "browse.operation_contributions") return result;
      return {
        ...result,
        rows: [
          ...result.rows,
          {
            id: "RETURN-ROW",
            document: "RETURN-1",
            kind: "Return",
            quantity: -2,
            signed: true,
            stock_uom: "Nos",
          },
        ],
      };
    });
    const { wrapper } = setup(
      call,
      reactive({
        family: "loans" as const,
        records: false,
        initialQuery: query,
      }),
      true,
    );
    await flushPromises();
    const outstandingIndex = wrapper
      .findAll("thead th")
      .findIndex((header) => header.text().includes("未还数量"));
    expect(outstandingIndex).toBeGreaterThanOrEqual(0);
    const loanRow = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes("LOAN-1"))!;
    expect(loanRow.findAll("td")[outstandingIndex]?.text()).toBe("5 Nos");
    const returnRow = wrapper
      .findAll("tbody tr")
      .find((row) => row.text().includes("RETURN-1"))!;
    expect(returnRow.findAll("td")[outstandingIndex]?.text()).toBe("");
  });
  it("shows terminal history loading and errors only while expanded, then retries", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const query = newReportQuery("loans");
    query.view = "items";
    query.groupBy = ["item"];
    const base = service();
    let attempts = 0;
    let rejectFirst!: (reason: Error) => void;
    const pending = new Promise<never>((_, reject) => {
      rejectFirst = reject;
    });
    const call = vi.fn((endpoint, args, signal) => {
      if (endpoint === "browse.operation_contributions" && attempts++ === 0)
        return pending;
      return base(endpoint, args, signal);
    });
    const { wrapper } = setup(
      call,
      reactive({
        family: "loans" as const,
        records: false,
        initialQuery: query,
      }),
      true,
    );
    await flushPromises();
    await wrapper.get(".data-table-group-toggle").trigger("click");
    await flushPromises();
    expect(
      wrapper.get(".data-table-group-detail-row .data-table-group-skeleton"),
    ).toBeTruthy();
    rejectFirst(new Error("浏览检查：暂时无法读取历史"));
    await flushPromises();
    expect(
      wrapper.get('.data-table-group-detail-row [role="alert"]').text(),
    ).toBe("浏览检查：暂时无法读取历史");
    await wrapper.get(".data-table-group-toggle").trigger("click");
    expect(
      wrapper.find('.data-table-group-detail-row [role="alert"]').exists(),
    ).toBe(false);
    await wrapper.get(".data-table-group-toggle").trigger("click");
    expect(
      wrapper.get('.data-table-group-detail-row [role="alert"]').text(),
    ).toBe("浏览检查：暂时无法读取历史");
    await wrapper.get(".data-table-group-detail-row button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("LOAN-1");
    expect(
      call.mock.calls.filter(
        ([endpoint]) => endpoint === "browse.operation_contributions",
      ),
    ).toHaveLength(2);
  });
  it("keeps settled item history in the global outstanding scope by default", async () => {
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
    expect(c.historyScope.value).toBe("outstanding");
    expect(call).toHaveBeenLastCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({
        item_code: "ITEM-A",
        history_scope: "outstanding",
      }),
      expect.any(AbortSignal),
    );
  });
  it("does not let an aborted history request clear the replacement request loading state", async () => {
    let resolveOutstanding: (value: unknown) => void = () => {};
    let resolveAll: (value: unknown) => void = () => {};
    const base = service();
    const call = vi.fn((endpoint, args, signal) => {
      if (endpoint === "browse.operation_contributions")
        return new Promise((resolve) => {
          if (args.history_scope === "outstanding")
            resolveOutstanding = resolve;
          else resolveAll = resolve;
        });
      return base(endpoint, args, signal);
    });
    const { c } = setup(call);
    await flushPromises();
    const row = c.result.rows[0]!;
    c.toggle(row, true);
    await flushPromises();
    expect(c.details[row.id]?.loading).toBe(true);
    c.setHistoryScope("all");
    await flushPromises();
    expect(c.details[row.id]?.loading).toBe(true);

    resolveOutstanding({
      rows: [],
      columns: [],
      matched_count: 0,
      next_start: null,
    });
    await flushPromises();
    expect(c.details[row.id]?.loading).toBe(true);

    resolveAll({
      rows: [{ id: "ALL-HISTORY" }],
      columns: [],
      matched_count: 1,
      next_start: null,
    });
    await flushPromises();
    expect(c.details[row.id]?.loading).toBe(false);
    expect(c.details[row.id]?.rows.map(({ id }) => id)).toEqual([
      "ALL-HISTORY",
    ]);
  });
  it("does not change global history scope when an item settles on refresh", async () => {
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
    expect(c.historyScope.value).toBe("outstanding");
    await c.load();
    await flushPromises();
    expect(c.historyScope.value).toBe("outstanding");
    expect(call.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ history_scope: "outstanding" }),
    );
  });
  it("shows a settled-item hint under the outstanding history scope", async () => {
    const base = service();
    const call = vi.fn(async (endpoint, args, signal) => {
      if (endpoint === "browse.operation_page") {
        const result = await base(endpoint, args, signal);
        return { ...result, rows: [{ ...result.rows[0], stock_qty: 0 }] };
      }
      if (
        endpoint === "browse.operation_contributions" &&
        args.history_scope === "outstanding"
      )
        return {
          ...(await base(endpoint, args, signal)),
          rows: [],
          matched_count: 0,
          next_start: null,
        };
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
    expect(controller.historyScope.value).toBe("outstanding");
    expect(wrapper.text()).toContain("当前范围没有未结清借用记录");
    expect(wrapper.find(".loan-history-scope").exists()).toBe(false);
  });
  it("retains prior groups on load-more failure and retries the failed offset", async () => {
    const base = service();
    let operationCalls = 0;
    const call = vi.fn(async (endpoint, args, signal) => {
      if (endpoint === "browse.operation_page") {
        operationCalls += 1;
        if (operationCalls === 2) throw new Error("load-more");
        if (operationCalls === 3)
          return {
            ...page(),
            rows: [{ ...page().rows[0]!, id: "GROUP-B" }],
            next_start: null,
          };
      }
      return base(endpoint, args, signal);
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
    c.setHistoryScope("all");
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
    const chips = wrapper.get(".browse-persistent-chips");
    expect(chips.text()).toContain("LOAN-EXACT");
    const item = chips
      .findAll("button")
      .find(
        (button) =>
          button.classes().includes("browse-active-chip-remove") &&
          button.attributes("aria-label")?.includes("ITEM-A"),
      )!;
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
    const chips = wrapper.get(".browse-persistent-chips");
    const removeButtons = chips.findAll(".browse-active-chip-remove");
    await removeButtons[0]!.trigger("click");
    await wrapper.get(".browse-active-chip-remove").trigger("click");
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
    expect(c.query.value.sortBy).toBe("identity");
    expect(c.query.value.sort).toBe("asc");
    expect(c.query.value.scope).toEqual(query.scope);
  });
  it("clears editable filters while retaining route allocation scope and toolbar state", async () => {
    const query = newReportQuery("loans");
    query.view = "items";
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
      sortBy: "item_name",
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
      restrictItems: false,
      itemCodes: [],
      loan: "",
      loanOutcome: "all",
      groupBy: [],
      sortBy: "date",
      sort: "desc",
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
    expect(c.viewQuery(true).itemLocationKeys).toEqual([]);
    expect(c.viewQuery(true)).toMatchObject({
      loan: "",
      record: "",
      recordDoctype: "",
    });
    expect(c.query.value.restrictAllocations).toBe(true);
    expect(c.query.value.allocationKeys).toEqual(["ALLOC-EXACT"]);
  });
  it("uses one mobile Item disclosure for native loan history and preserves it when switching to desktop", async () => {
    let mediaChange: ((event: { matches: boolean }) => void) | undefined;
    const media = { matches: false };
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return media.matches;
      },
      addEventListener: (
        _: string,
        listener: (event: { matches: boolean }) => void,
      ) => {
        mediaChange = listener;
      },
      removeEventListener: vi.fn(),
    }));
    const call = service();
    const { wrapper } = setup(
      call,
      reactive({ family: "loans" as const, records: false }),
      true,
    );
    await flushPromises();
    const surface = wrapper.findComponent(OperationBrowsePage);
    expect(wrapper.findAll(".preview-group")).toHaveLength(1);
    expect(wrapper.get(".mobile-item-group-list").classes()).toContain(
      "browse-card",
    );
    expect(wrapper.get(".preview-group").classes()).toContain(
      "preview-group--mobile-list",
    );
    expect(
      wrapper.get(".mobile-item-group-list").element.children,
    ).toHaveLength(1);
    expect(wrapper.get(".preview-group-trigger").text()).toContain(
      "明细条数 42",
    );
    expect(wrapper.get(".preview-group-metrics").text()).toMatch(
      /借出\s+2\s+Nos/,
    );
    expect(wrapper.find(".preview-group-thumbnail").exists()).toBe(true);
    expect(
      wrapper.get(".preview-group-trigger").find(".ti-disclosure-icon").element,
    ).toBe(wrapper.get(".preview-group-trigger").element.lastElementChild);
    expect(
      wrapper.findAll('[data-browse-scroll="operation-items"]'),
    ).toHaveLength(0);
    await wrapper.get(".preview-group-trigger").trigger("click");
    await flushPromises();
    expect(
      wrapper.get(".preview-group-trigger").attributes("aria-expanded"),
    ).toBe("true");
    const historyContent = wrapper.get(".movement-history-surface").element
      .parentElement;
    expect(historyContent?.getAttribute("style")).not.toContain(
      "display: none",
    );
    expect(
      historyContent?.parentElement?.classList.contains("preview-group"),
    ).toBe(true);
    expect(wrapper.text()).not.toContain("查看历史");
    expect(call).toHaveBeenCalledWith(
      "browse.operation_contributions",
      expect.objectContaining({
        query: expect.objectContaining({ view: "items", groupBy: [] }),
        history_scope: "outstanding",
      }),
      expect.any(AbortSignal),
    );
    expect(wrapper.findAll(".loan-history-scope")).toHaveLength(0);
    await wrapper.get(".preview-group-trigger").trigger("click");
    await flushPromises();
    expect(
      wrapper.get(".preview-group-trigger").attributes("aria-expanded"),
    ).toBe("false");
    expect(historyContent?.getAttribute("style")).toContain("display: none");
    await wrapper.get(".preview-group-trigger").trigger("click");
    await flushPromises();
    expect(surface.emitted("openLoan")).toBeUndefined();
    const buttons = wrapper
      .findAll("button")
      .filter((button) => button.text() === "登记归还");
    expect(buttons).toHaveLength(2);
    media.matches = true;
    mediaChange?.({ matches: true });
    await flushPromises();
    expect(
      wrapper.findAll('[data-browse-scroll="operation-items"]'),
    ).toHaveLength(1);
    expect(wrapper.text()).toContain("LOAN-1");
    await buttons[1]!.trigger("click");
    expect(surface.emitted("settle")).toEqual([["LOAN-2"]]);
  });
  it("reopens filter fields collapsed and opens the grouping editor from its applied chip", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const { wrapper } = setup(
      service(),
      reactive({ family: "loans" as const, records: false }),
      true,
    );
    await flushPromises();
    await wrapper
      .get('.preview-filter-control button[aria-haspopup="dialog"]')
      .trigger("click");
    await flushPromises();
    const disclosures = Array.from(
      document.querySelectorAll<HTMLDetailsElement>(
        ".compact-filter-content .browse-filter-disclosure",
      ),
    );
    expect(disclosures.length).toBeGreaterThan(0);
    expect(disclosures.every((disclosure) => !disclosure.open)).toBe(true);
    const done = document.querySelector<HTMLButtonElement>(
      ".preview-filter-popover footer button",
    );
    expect(done).toBeTruthy();
    done?.click();
    await flushPromises();
    await wrapper
      .findAll(".browse-persistent-chips .browse-active-chip-label")
      .find((button) => button.text().includes("分组：物品"))!
      .trigger("click");
    await flushPromises();
    const groupBy = document.querySelector<HTMLElement>(
      '[data-filter-field="groupBy"]',
    );
    expect(groupBy).toBeTruthy();
    expect(groupBy?.contains(document.activeElement)).toBe(true);
  });
  it("shows the combined server and browser movement draft count in the browse header", async () => {
    localStorage.clear();
    createRecoveryStore("unit-site", "volunteer", localStorage).save({
      schema: 1,
      site: "unit-site",
      account: "volunteer",
      tabId: "tab-a",
      editorId: "browser-draft-a",
      editorKind: "Stock Entry",
      revision: 1,
      updatedAt: "2026-10-20T09:00:00Z",
      values: { kind: "Receive", items: [] },
      pendingUploadReselection: false,
    });
    const call = service();
    call.mockImplementation(async (endpoint, args) =>
      endpoint === "browse.native_drafts"
        ? { matched_count: 3 }
        : await service()(endpoint, args),
    );
    const { wrapper } = setup(
      call,
      reactive({ family: "movements" as const, records: true }),
      true,
    );
    await flushPromises();
    await wrapper.get('[aria-label="更多操作"]').trigger("click");
    const drafts = document.querySelector<HTMLAnchorElement>(
      '.popup-menu-panel a[href="/drafts"]',
    )!;
    expect(drafts.textContent).toContain("草稿");
    expect(drafts.querySelector(".menu-item-icon")).toBeTruthy();
    expect(drafts.querySelector(".menu-item-meta")?.textContent).toBe("4");
  });
});
