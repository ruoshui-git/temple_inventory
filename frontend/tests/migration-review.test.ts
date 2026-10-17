import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import OperationEditorPage from "../src/features/documents/OperationEditorPage.vue";
import CountEditorPage from "../src/features/counts/CountEditorPage.vue";
import QuickExport from "../src/components/QuickExport.vue";
import ReportTable from "../src/components/ui/ReportTable.vue";
import {
  createReferenceData,
  provideInventoryServices,
  type InventoryServices,
} from "../src/services/contracts";
import { savedDocumentExport } from "../src/features/documents/savedDocumentExport";
import type { NativeDocument } from "../src/features/documents/nativeEditor";
import { siteDateTime } from "../src/lib/nativeTime";
import { decodeReportQuery } from "../src/lib/reportQuery";
import { reportFilterChips } from "../src/lib/reportFilters";
const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((w) => w.unmount());
  localStorage.clear();
});
function record(
  doctype: NativeDocument["doctype"],
  docstatus: 0 | 1 | 2 = 1,
): NativeDocument {
  return {
    doctype,
    name: "SAME-NATIVE-NAME",
    version: "2026-10-17 14:34:48.267486",
    docstatus,
    editable: docstatus === 0,
    kind: "Loan",
    ti_movement_kind: "Loan",
    ti_borrower: "借用团队",
    posting_date: "2026-10-13",
    posting_time: "12:34:56",
    amended_from: "ORIGINAL-1",
    permissions: {},
    items: [],
  };
}
function render(
  doc: NativeDocument,
  activityCall?: (name: string) => Promise<unknown>,
) {
  const reference = createReferenceData();
  Object.assign(reference, {
    site: "unit-site",
    user: "manager",
    siteDate: "2026-10-17",
    siteTime: "2026-10-17 10:00:00",
  });
  const call = vi.fn(
    async (endpoint: string, args?: Record<string, unknown>) => {
      if (endpoint === "activities.load_activity")
        return activityCall?.(String(args?.name));
      return endpoint === "native_api.load_document"
        ? structuredClone(doc)
        : [];
    },
  );
  const report = vi.fn(async (_query: unknown) => ({
    query: {},
    scope: {},
    period: {},
    snapshot: "2026-10-17 14:34:48.267486",
    table: "records",
    columns: ["id", "document", "stock_qty"],
    rows: [
      {
        id: '["records", "hidden-key"]',
        doctype: doc.doctype,
        document: doc.name,
        stock_qty: 2,
      },
    ],
    matched_count: 1,
    next_start: null,
    summary: [],
    tables: [{ id: "records", label: "记录", count: 1 }],
  }));
  const wrapper = mount(
    defineComponent({
      setup() {
        provideInventoryServices(
          { call, report, upload: vi.fn() } as InventoryServices,
          reference,
        );
        return () =>
          doc.doctype === "Stock Entry"
            ? h(OperationEditorPage, {
                identity: { doctype: doc.doctype, name: doc.name },
              })
            : h(CountEditorPage, { name: doc.name });
      },
    }),
  );
  wrappers.push(wrapper);
  return { wrapper, report, call, reference };
}
describe("migration review saved details", () => {
  it.each([0, 1, 2] as const)(
    "scopes both native detail exports to the saved identity and status %s",
    async (status) => {
      for (const doctype of ["Stock Entry", "Stock Reconciliation"] as const) {
        const doc = record(doctype, status);
        const { wrapper, report } = render(doc);
        await flushPromises();
        const quick = wrapper.getComponent(QuickExport);
        expect(quick.props("query")).toMatchObject({
          record: doc.name,
          recordDoctype: doctype,
          statuses: [status],
        });
        if (doctype === "Stock Entry" && status === 0) {
          const c = wrapper.getComponent(OperationEditorPage).vm.controller;
          c.draft.value.borrower = "未保存的更改";
          c.draft.value.name = "未保存的名字";
          expect(c.savedExportQuery.value?.record).toBe(doc.name);
        }
        await quick.get("button").trigger("click");
        await flushPromises();
        expect(report.mock.calls[0]?.[0]).toMatchObject({
          record: doc.name,
          recordDoctype: doctype,
          statuses: [status],
        });
        expect(document.body.textContent).not.toContain("hidden-key");
        const dialog = document.body.querySelector('[role="dialog"]')!;
        expect(dialog.textContent).toContain("2026-10-17 14:34");
        expect(dialog.textContent).not.toContain(".267486");
        expect(dialog.querySelector("tbody button")).toBeNull();
        expect(dialog.querySelector("tbody")?.textContent).toContain(doc.name);
        (
          Array.from(dialog.querySelectorAll("button")).find(
            (button) => button.textContent === "打开导出页面",
          ) as HTMLButtonElement
        ).click();
        await flushPromises();
        expect(quick.emitted("openFull")?.[0]?.[0]).toEqual(
          quick.props("query"),
        );
        expect(
          decodeReportQuery(JSON.stringify(quick.props("query"))).query
            .recordDoctype,
        ).toBe(doctype);
        const chip = reportFilterChips(
          quick.props("query"),
          createReferenceData(),
        ).find((chip) => chip.key === "record");
        expect(chip?.reset).toEqual({ record: "", recordDoctype: "" });
      }
    },
  );
  it.each([1, 2] as const)(
    "shows saved Loan metadata as selectable information at status %s",
    async (status) => {
      const { wrapper } = render(record("Stock Entry", status));
      await flushPromises();
      const text = wrapper.get("dl").text();
      expect(text).toContain("操作日期2026-10-13");
      expect(text).toContain("操作时间（站点时间）12:34:56");
      expect(text).toContain("借用方借用团队");
      expect(wrapper.text()).toContain("修订来源：ORIGINAL-1");
      expect(wrapper.find('input[type="date"]').exists()).toBe(false);
    },
  );
  it("retains edit controls and values during a conflict and busy save", async () => {
    const { wrapper } = render(record("Stock Entry", 0));
    await flushPromises();
    const c = wrapper.getComponent(OperationEditorPage).vm.controller;
    c.draft.value.borrower = "保留输入";
    c.busy.value = true;
    c.state.server!.editable = false;
    c.state.server!.docstatus = 1;
    c.state.status = "conflict";
    await flushPromises();
    expect(
      wrapper.get('input[type="date"]').attributes("disabled"),
    ).toBeDefined();
    expect(
      (wrapper.get('input[type="date"]').element as HTMLInputElement).value,
    ).toBe("2026-10-13");
    expect(
      wrapper
        .findAll("input")
        .some((input) => input.element.value === "保留输入"),
    ).toBe(true);
  });
  it("reveals recovered attachments that require file reselection", async () => {
    const { wrapper } = render(record("Stock Entry", 0));
    await flushPromises();
    const c = wrapper.getComponent(OperationEditorPage).vm.controller;
    c.files.restore([
      {
        id: "file",
        name: "凭据.txt",
        type: "text/plain",
        state: "pending",
        progress: 0,
        error: "",
      },
    ]);
    await flushPromises();
    expect(
      (wrapper.get(".form-main > details").element as HTMLDetailsElement).open,
    ).toBe(true);
  });
  it("excludes local-only, missing and unavailable saved parents", () => {
    expect(savedDocumentExport(undefined, "matching")).toBeUndefined();
    expect(
      savedDocumentExport(record("Stock Entry"), "deleted"),
    ).toBeUndefined();
    expect(
      savedDocumentExport(record("Stock Entry"), "forbidden"),
    ).toBeUndefined();
  });
});
it("hides internal row keys from real API-shaped summary/group/detail tables", () => {
  for (const id of [
    "summary",
    "locations",
    "batches",
    "records",
    "lines",
    "outcomes",
    "settlements",
    "metadata",
    "grouped",
    "balances",
    "ledger",
  ]) {
    const wrapper = mount(ReportTable, {
      props: {
        table: {
          id,
          label: id,
          columns: [
            "id",
            "item_name",
            "stock_qty",
            "stock_uom",
            "document",
            "line_name",
          ],
          rows: [
            {
              id: '["summary", "ITEM-1", "长名称"]',
              item_name: "可读物品",
              stock_qty: 5,
              stock_uom: "Nos",
              document: "STE-1",
              line_name: "CHILD-1",
            },
          ],
        },
      },
    });
    wrappers.push(wrapper);
    expect(wrapper.text()).not.toContain('["summary"');
    expect(wrapper.text()).toContain("可读物品");
    expect(wrapper.text()).toContain("CHILD-1");
    expect(wrapper.get("tbody tr").attributes("data-browse-row")).toContain(
      '["summary"',
    );
  }
});
it("formats site wall time without changing exact concurrency tokens", () => {
  const doc = record("Stock Entry");
  expect(siteDateTime(doc.version)).toBe("2026-10-17 14:34");
  expect(doc.version).toBe("2026-10-17 14:34:48.267486");
  expect(siteDateTime("2026-10-17 9:04:48")).toBe("2026-10-17 09:04");
  expect(siteDateTime("2026-10-17")).toBe("2026-10-17");
});

describe("migration follow-up", () => {
  it("routes Opening Stock through movements in quick and full export", async () => {
    const doc = {
      ...record("Stock Reconciliation"),
      purpose: "Opening Stock",
      kind: "Opening",
      items: [{ item_code: "ITEM-A", qty: 7 }],
    };
    const { wrapper, report } = render(doc);
    await flushPromises();
    const quick = wrapper.getComponent(QuickExport);
    expect(quick.props("query")).toMatchObject({
      dataset: "movements",
      view: "records",
      record: doc.name,
      recordDoctype: doc.doctype,
      statuses: [1],
      includeAdjustments: true,
    });
    await quick.get("button").trigger("click");
    await flushPromises();
    expect(report.mock.calls[0]?.[0]).toEqual(quick.props("query"));
    Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "打开导出页面")!
      .click();
    await flushPromises();
    expect(quick.emitted("openFull")?.[0]?.[0]).toEqual(quick.props("query"));
    expect(
      savedDocumentExport(
        { ...doc, purpose: "Stock Reconciliation" },
        "submitted",
      )?.dataset,
    ).toBe("counts");
  });
  it.each(["Active", "Archived"])(
    "resolves permitted %s titles on fresh operation and count entry and reload",
    async (status) => {
      for (const doctype of ["Stock Entry", "Stock Reconciliation"] as const) {
        const doc = { ...record(doctype), ti_activity: "OPAQUE-ID" };
        let title = "可读关联活动";
        const activityCall = vi.fn(async (name: string) => ({
          name,
          title,
          status,
        }));
        const { wrapper } = render(doc, activityCall);
        await flushPromises();
        expect(activityCall).toHaveBeenCalledWith("OPAQUE-ID");
        expect(wrapper.text()).toContain(title);
        expect(wrapper.text()).not.toContain("OPAQUE-ID");
        title = "重命名后的活动";
        const c =
          doctype === "Stock Entry"
            ? wrapper.getComponent(OperationEditorPage).vm.controller
            : wrapper.getComponent(CountEditorPage).vm.controller;
        await c.load();
        await flushPromises();
        expect(wrapper.text()).toContain(title);
      }
    },
  );
  it("resolves restored input and shows a truthful permission fallback", async () => {
    const { wrapper, reference } = render(
      record("Stock Entry", 0),
      async (name) => {
        if (name === "DENIED") throw new Error("PermissionError");
        return { name, title: "恢复的归档活动", status: "Archived" };
      },
    );
    await flushPromises();
    const c = wrapper.getComponent(OperationEditorPage).vm.controller;
    await c.recover({
      schema: 1,
      site: reference.site,
      account: reference.user,
      tabId: "old-tab",
      editorId: "old-editor",
      editorKind: "Receive",
      revision: 1,
      updatedAt: "2026-10-17",
      pendingUploadReselection: false,
      values: {
        ...JSON.parse(JSON.stringify(c.draft.value)),
        activity: "RESTORED",
      },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("恢复的归档活动");
    reference.activities.push({ value: "DENIED", label: "不得使用的缓存标题" });
    c.draft.value.activity = "DENIED";
    await flushPromises();
    expect(wrapper.text()).toContain("活动暂不可用");
    expect(wrapper.text()).not.toContain("不得使用的缓存标题");
    expect(c.draft.value.activity).toBe("DENIED");
  });
});
