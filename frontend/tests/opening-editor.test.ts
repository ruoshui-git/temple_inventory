// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h } from "vue";
import {
  createReferenceData,
  emptyCapabilities,
  provideInventoryServices,
} from "../src/services/contracts";
import { useOpeningEditor } from "../src/features/opening/useOpeningEditor";
import { resolveConfirm, useConfirm } from "../src/services/confirm";

const wrappers: VueWrapper[] = [];
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  localStorage.clear();
});

describe("Opening Stock editor controller", () => {
  it("does not save a loaded draft; one edit saves once despite server normalization", async () => {
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "opening-baseline-test",
      user: "manager",
      company: "TEMPLE",
      siteDate: "2026-11-07",
      siteTime: "2026-11-07 10:00:00",
      physicalLeaves: ["ROOM-A"],
      capabilities: emptyCapabilities(),
    });
    reference.capabilities.stock_reconciliation.create = true;
    const doc = {
      doctype: "Stock Reconciliation",
      name: "SR-OPEN-DRAFT",
      version: "v1",
      docstatus: 0,
      purpose: "Opening Stock",
      editable: true,
      expense_account: "Temporary Opening - TC",
      posting_date: "2026-11-06",
      posting_time: "09:00:00",
      items: [
        {
          name: "row-old",
          item_code: "ITEM-A",
          warehouse: "ROOM-A",
          qty: 2,
          valuation_rate: 3,
          allow_zero_valuation_rate: 0,
          ti_display_tracks_expiry: 0,
        },
      ],
    };
    const call = vi.fn(
      async (method: string, args: Record<string, unknown>) => {
        if (method === "native_api.load_document") return doc;
        if (method === "catalog.item_display_summaries")
          return { "ITEM-A": {} };
        if (method === "native_api.save_document") {
          const data = args.data as { items: Record<string, unknown>[] };
          return {
            ...doc,
            version: "v2",
            items: [
              {
                ...data.items[0],
                name: "row-new",
                allow_zero_valuation_rate: 1,
                ti_display_expiry_date: "2027-01-01",
              },
            ],
          };
        }
        throw new Error(`Unexpected service ${method}`);
      },
    );
    let controller!: ReturnType<typeof useOpeningEditor>;
    const child = defineComponent({
      setup() {
        controller = useOpeningEditor({ name: doc.name });
        return () => h("div");
      },
    });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(child);
      },
    });
    wrappers.push(mount(host));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushPromises();
    expect(
      call.mock.calls.filter(
        ([method]) => method === "native_api.save_document",
      ),
    ).toHaveLength(0);

    controller.values.items[0]!.qty = 5;
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 900));
    await flushPromises();
    expect(
      call.mock.calls.filter(
        ([method]) => method === "native_api.save_document",
      ),
    ).toHaveLength(1);
  });

  it("requires the opening review dialog before native submit", async () => {
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "opening-review-test",
      user: "manager",
      company: "TEMPLE",
      siteDate: "2026-11-07",
      siteTime: "2026-11-07 10:00:00",
      physicalLeaves: ["ROOM-A"],
      capabilities: emptyCapabilities(),
    });
    reference.capabilities.stock_reconciliation.create = true;
    const doc = {
      doctype: "Stock Reconciliation",
      name: "SR-OPEN-REVIEW",
      version: "v1",
      docstatus: 0,
      purpose: "Opening Stock",
      editable: true,
      expense_account: "Temporary Opening - TC",
      posting_date: "2026-11-06",
      posting_time: "09:30:00",
      items: [
        {
          name: "row-1",
          item_code: "ITEM-A",
          warehouse: "ROOM-A",
          qty: 2,
          valuation_rate: 3,
        },
      ],
    };
    const call = vi.fn(async (method: string) => {
      if (method === "native_api.load_document") return doc;
      if (method === "catalog.item_display_summaries") return { "ITEM-A": {} };
      if (method === "native_api.submit_document")
        return { ...doc, version: "v2", docstatus: 1, editable: false };
      throw new Error(`Unexpected service ${method}`);
    });
    let controller!: ReturnType<typeof useOpeningEditor>;
    const child = defineComponent({
      setup() {
        controller = useOpeningEditor({ name: doc.name });
        return () => h("div");
      },
    });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(child);
      },
    });
    wrappers.push(mount(host));
    await flushPromises();
    const pending = controller.confirm();
    await flushPromises();
    expect(
      call.mock.calls.some(
        ([method]) => method === "native_api.submit_document",
      ),
    ).toBe(false);
    const review = useConfirm().state.pending;
    expect(review?.options.title).toBe("确认期初库存？");
    expect(review?.options.message).toContain("1 行、1 个位置");
    expect(review?.options.message).toContain("2026-11-06 09:30:00");
    expect(review?.options.message).toContain("Temporary Opening - TC");
    expect(review?.options.message).toContain("写入库存和会计记录");
    resolveConfirm(true);
    await pending;
    expect(
      call.mock.calls.filter(
        ([method]) => method === "native_api.submit_document",
      ),
    ).toHaveLength(1);
    expect(
      call.mock.calls.some(([method]) => method === "native_api.save_document"),
      "confirming an unchanged draft must not save it first",
    ).toBe(false);
  });

  it("creates a native Opening Stock document through nativeEditor autosave", async () => {
    const reference = createReferenceData();
    const now = new Date();
    Object.assign(reference, {
      site: "opening-test",
      user: "manager",
      company: "TEMPLE",
      siteDate: now.toISOString().slice(0, 10),
      siteTime: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 8)}`,
      physicalLeaves: ["ROOM-A"],
      items: [{ value: "ITEM-A", label: "测试物品" }],
      capabilities: emptyCapabilities(),
    });
    reference.capabilities.stock_reconciliation.create = true;
    const call = vi.fn(
      async (method: string, args: Record<string, unknown>) => {
        if (method === "native_api.create_document") {
          expect(args.doctype).toBe("Stock Reconciliation");
          expect((args.data as Record<string, unknown>).purpose).toBe(
            "Opening Stock",
          );
          return {
            doctype: "Stock Reconciliation",
            name: "SR-OPEN-1",
            version: "v1",
            docstatus: 0,
            purpose: "Opening Stock",
            expense_account: "Temporary Opening - TC",
            editable: true,
            items: [
              {
                name: "row-1",
                item_code: "ITEM-A",
                warehouse: "ROOM-A",
                qty: 2,
                valuation_rate: 3,
              },
            ],
          };
        }
        throw new Error(`Unexpected service ${method}`);
      },
    );
    let controller!: ReturnType<typeof useOpeningEditor>;
    const child = defineComponent({
      setup() {
        controller = useOpeningEditor({});
        return () => h("div");
      },
    });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(child);
      },
    });
    wrappers.push(mount(host));
    controller.values.items.push({
      localId: "line-1",
      item_code: "ITEM-A",
      warehouse: "ROOM-A",
      batch_no: "",
      serial_no: "",
      qty: 2,
      valuation_rate: 3,
      use_serial_batch_fields: 1,
    });
    await controller.save();
    await flushPromises();
    expect(controller.state.identity?.name).toBe("SR-OPEN-1");
    expect(controller.state.server?.purpose).toBe("Opening Stock");
  });

  it("keeps an opening record read-only for a Viewer without autosaving", async () => {
    const reference = createReferenceData();
    Object.assign(reference, {
      site: "opening-test",
      user: "viewer",
      company: "TEMPLE",
      siteDate: "2026-11-07",
      siteTime: "2026-11-07 10:00:00",
      physicalLeaves: ["ROOM-A"],
      capabilities: emptyCapabilities(),
    });
    reference.capabilities.stock_reconciliation.read = true;
    const doc = {
      doctype: "Stock Reconciliation",
      name: "SR-OPEN-READ",
      version: "v1",
      docstatus: 0,
      purpose: "Opening Stock",
      editable: false,
      expense_account: "Temporary Opening - TC",
      posting_date: "2026-11-07",
      posting_time: "09:00:00",
      items: [
        {
          name: "row-1",
          item_code: "ITEM-A",
          warehouse: "ROOM-A",
          qty: 2,
          valuation_rate: 3,
        },
      ],
    };
    const call = vi.fn(async (method: string) => {
      if (method === "native_api.load_document") return doc;
      if (method === "catalog.item_display_summaries") return { "ITEM-A": {} };
      throw new Error(`Unexpected write ${method}`);
    });
    let controller!: ReturnType<typeof useOpeningEditor>;
    const child = defineComponent({
      setup() {
        controller = useOpeningEditor({ name: doc.name });
        return () => h("div");
      },
    });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(child);
      },
    });
    wrappers.push(mount(host));
    await flushPromises();
    expect(controller.writable.value).toBe(false);
    expect(controller.values.items[0]?.valuation_rate).toBe(3);
    controller.values.items[0]!.qty = 4;
    await flushPromises();
    expect(
      call.mock.calls.some(([method]) => method === "native_api.save_document"),
    ).toBe(false);
    expect(
      call.mock.calls.some(
        ([method]) => method === "native_api.create_document",
      ),
    ).toBe(false);
  });

  it("creates a typed batch only after blur or confirmation, never on keystrokes", async () => {
    const reference = createReferenceData();
    const now = new Date();
    Object.assign(reference, {
      site: "opening-batch-test",
      user: "manager",
      company: "TEMPLE",
      siteDate: now.toISOString().slice(0, 10),
      siteTime: `${now.toISOString().slice(0, 10)} ${now.toTimeString().slice(0, 8)}`,
      physicalLeaves: ["ROOM-A"],
      items: [{ value: "BATCH-A", label: "批次物品" }],
      capabilities: emptyCapabilities(),
    });
    reference.capabilities.stock_reconciliation.create = true;
    const call = vi.fn(
      async (method: string, args: Record<string, unknown>) => {
        if (method === "opening.ensure_batch") return { name: "B-001" };
        if (method === "native_api.create_document") {
          const data = args.data as { items: Record<string, unknown>[] };
          return {
            doctype: "Stock Reconciliation",
            name: "SR-OPEN-BATCH",
            version: "v1",
            docstatus: 0,
            purpose: "Opening Stock",
            editable: true,
            items: [{ name: "row-1", ...(data.items[0] || {}) }],
          };
        }
        throw new Error(`Unexpected service ${method}`);
      },
    );
    let controller!: ReturnType<typeof useOpeningEditor>;
    const child = defineComponent({
      setup() {
        controller = useOpeningEditor({});
        return () => h("div");
      },
    });
    const host = defineComponent({
      setup() {
        provideInventoryServices(
          { call, report: vi.fn(), upload: vi.fn() },
          reference,
        );
        return () => h(child);
      },
    });
    wrappers.push(mount(host));
    const row = {
      localId: "batch-line",
      item_code: "BATCH-A",
      warehouse: "ROOM-A",
      batch_no: "B-001",
      serial_no: "",
      qty: 2,
      valuation_rate: 3,
      has_batch_no: true,
      use_serial_batch_fields: 1,
    };
    controller.values.items.push(row);
    controller.markBatchDirty(row);
    await controller.save();
    await flushPromises();
    expect(
      call.mock.calls.some(([method]) => method === "opening.ensure_batch"),
    ).toBe(false);
    expect(
      call.mock.calls.some(
        ([method]) => method === "native_api.create_document",
      ),
    ).toBe(false);

    expect(await controller.ensureBatch(row)).toBe(true);
    expect(
      call.mock.calls.filter(([method]) => method === "opening.ensure_batch"),
    ).toHaveLength(1);
    expect(
      call.mock.calls.filter(
        ([method]) => method === "native_api.create_document",
      ),
    ).toHaveLength(1);
  });
});
